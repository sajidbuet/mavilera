// adc.js -- the ADC of the RP2350 (RP-001 §12.4; P1-M7, design docs/architecture/pico2-p1m7-adc-spi-i2c.md): a 12-bit converter
// taking 96 cycles of clk_adc per conversion; inputs 0-3 on GPIO 26-29 (the RP2350A of the Pico 2) and 4 the temperature sensor
// (Vbe = 0.706 V at 27 °C, slope -1.721 mV/°C, its bias enabled by CS.TS_EN, §12.4.6). CS: EN (READY at once while clk_adc
// runs), START_ONCE, START_MANY with the DIV pacing timer (16.8, first-order sigma-delta: one start per 1 + INT + FRAC/256 cycles of
// clk_adc on average; a start while a conversion is in progress is ignored; DIV = 0: back to back), round robin over RROBIN
// (AINSEL moves to the next set bit after each conversion), the 8-deep FIFO with SHIFT, ERR, OVER, UNDER, LEVEL and THRESH,
// INTR/INTE/INTF/INTS on IRQ 35 (ADC_IRQ_FIFO) and DREQ 48 (FIFO level >= THRESH with DREQ_EN) (pico-sdk 2.3.1 intctrl.h, dreq.h).
// The converter is ideal (design Q1): code = round(V / 3.3 V x 4096) clamped to 0..4095, sampled at the start of the conversion,
// no noise, no conversion errors. The inputs are machine state set by the host through the input queue (kind 'adc': a channel's
// voltage, 'env': the die temperature among the parts kit's environment), so that a run replays exactly.
// Not stated, chosen (in the module's limitations): READY rises at once when EN is set; clearing EN ends a conversion in progress
// without a result; START_ONCE while a conversion is in progress is ignored; channel 4 without TS_EN reads 0; FCS.EMPTY follows
// the FIFO (the datasheet's reset column says 0).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';

export const ADC_VREF = 3.3;           // ADC_AVDD of the Pico 2 (RP-002)
export const ADC_CHANNELS = 5;         // QFN-60: GPIO 26-29 and the temperature sensor
export const DREQ_ADC = 48;
const IRQ_ADC = 35, CONV_ADC_CYCLES = 96, FIFO_DEPTH = 8;
const CS_EN = 0x1, CS_TS_EN = 0x2, CS_START_ONCE = 0x4, CS_START_MANY = 0x8, CS_READY = 0x100;
const FCS_EN = 0x1, FCS_SHIFT = 0x2, FCS_DREQ_EN = 0x8, FCS_EMPTY = 0x100, FCS_FULL = 0x200, FCS_UNDER = 0x400, FCS_OVER = 0x800;
const O_CS = 0x0, O_RESULT = 0x4, O_FCS = 0x8, O_FIFO = 0xc, O_DIV = 0x10, O_INTR = 0x14, O_INTE = 0x18, O_INTF = 0x1c, O_INTS = 0x20;

/** The temperature sensor's voltage at t °C (RP-001 §12.4.6). */
export const tempSensorVolts = (t) => 0.706 - 0.001721 * (t - 27);
/** The ideal converter's code for a voltage. */
export const adcCode = (v) => Math.max(0, Math.min(4095, Math.round((v / ADC_VREF) * 4096)));

export class Adc extends Device {
  constructor(m) {
    super(m, 'ADC', { resetBit: 0 });
    // the analogue inputs (machine state, not registers): volts on GPIO 26-29; the die temperature lives in m.env
    this.volts = [0, 0, 0, 5 / 3]; // GPIO 29 of the Pico 2: VSYS / 3 through the board's divider, VSYS 5 V (RP-002)
    this.reset();
  }
  reset() {
    if (this.line && this.m.ready) this.m.irq(IRQ_ADC, 0);
    super.reset();
    this.fifo = []; this.busy = false; this.convCh = 0; this.line = 0;
    this.pace = -1;          // the next pacing tick, a clk_sys cycle (fractional), or -1 (no pacing)
    this.conversions = 0;
  }
  /** Analogue inputs survive a block reset (they are outside the chip); powerOn restores the defaults. */
  powerOn() { this.volts = [0, 0, 0, 5 / 3]; }

  get cs() { return this.r.get(O_CS); }
  /** clk_sys cycles per clk_adc cycle, or 0 when clk_adc is stopped. */
  ratio() { const f = this.m.freq; return f.adc && f.sys ? f.sys / f.adc : 0; }
  input(ch) {
    if (ch < 4) return this.m.circuit?.adcNow(ch) ?? this.volts[ch]; // P1-B2: a settling net (a capacitor) at this cycle
    if (!(this.cs & CS_TS_EN)) { this.m.diag('adcTempOff'); return 0; }
    return tempSensorVolts(this.m.env?.temp ?? 25);
  }

  // ---- conversions ----
  start(c) {
    const k = this.ratio();
    if (!k) { this.m.diag('adcNoClock'); return; }
    this.busy = true; this.convCh = (this.cs >>> 12) & 0xf;
    this.convCode = adcCode(this.input(this.convCh < ADC_CHANNELS ? this.convCh : 0));
    if (this.convCh >= ADC_CHANNELS) this.m.diag('adcChannel', this.convCh);
    this.convEnd = c + Math.max(1, Math.ceil(CONV_ADC_CYCLES * k));
    this.plan();
  }
  plan() {
    let n = Infinity;
    if (this.busy) n = this.convEnd;
    if (this.pace >= 0) n = Math.min(n, Math.ceil(this.pace));
    this.next = n;
    this.m.schedule(this);
  }
  event(now) {
    if (this.busy && now >= this.convEnd) this.finish(now);
    if (this.pace >= 0 && now >= Math.ceil(this.pace)) {
      const k = this.ratio(), d = this.r.get(O_DIV);
      this.pace += (((d >>> 8) & 0xffff) + 1 + (d & 0xff) / 256) * k;
      if (!this.busy && (this.cs & CS_START_MANY) && (this.cs & CS_EN)) this.start(now);
    }
    this.plan();
  }
  finish(now) {
    this.busy = false; this.conversions++;
    const code = this.convCode;
    this.r.set(O_RESULT, code);
    const fcs = this.r.get(O_FCS);
    if (fcs & FCS_EN) {
      if (this.fifo.length >= FIFO_DEPTH) this.r.set(O_FCS, fcs | FCS_OVER);
      else this.fifo.push(fcs & FCS_SHIFT ? code >>> 4 : code);
    }
    const rr = (this.cs >>> 16) & 0x1ff;
    if (rr) { // the next channel whose RROBIN bit is set, after the present one
      let ch = this.convCh;
      for (let i = 0; i < ADC_CHANNELS; i++) { ch = (ch + 1) % ADC_CHANNELS; if ((rr >>> ch) & 1) break; }
      this.r.set(O_CS, (this.cs & ~0xf000) | (ch << 12));
    }
    if ((this.cs & CS_START_MANY) && (this.cs & CS_EN) && this.pace < 0) this.start(now); // DIV = 0: back to back
    this.update();
  }

  // ---- registers ----
  read(off, addr) {
    if (!this.held() && off === O_FIFO) {
      if (!this.fifo.length) { this.r.set(O_FCS, this.r.get(O_FCS) | FCS_UNDER); return 0; }
      const v = this.fifo.shift();
      this.update();
      return v;
    }
    return super.read(off, addr);
  }
  readReg(off) {
    if (off === O_CS) return ((this.cs & ~CS_READY) | ((this.cs & CS_EN) && !this.busy && this.ratio() ? CS_READY : 0)) >>> 0;
    if (off === O_FCS) {
      const n = this.fifo.length;
      return ((this.r.get(O_FCS) & ~0xf0300) | (n << 16) | (n >= FIFO_DEPTH ? FCS_FULL : 0) | (n === 0 ? FCS_EMPTY : 0)) >>> 0;
    }
    if (off === O_INTR) return this.raw();
    if (off === O_INTS) return (this.raw() & this.r.get(O_INTE)) | this.r.get(O_INTF);
    return this.r.get(off);
  }
  onWrite(off, nv, old, value, alias) {
    const c = this.now;
    if (off === O_CS) {
      if (!(nv & CS_EN) && this.busy) { this.busy = false; } // power off: the conversion in progress gives no result
      if (nv & CS_EN && !(old & CS_EN) && !this.ratio()) this.m.diag('adcNoClock');
      // START_ONCE is self-clearing (not stored): a write of 1 through any alias but CLR starts a conversion
      if ((value & CS_START_ONCE) && alias !== 3 && (nv & CS_EN) && !(nv & CS_START_MANY) && !this.busy) this.start(c);
      if ((nv & CS_START_MANY) && !(old & CS_START_MANY)) this.paceFrom(c);
      if (!(nv & CS_START_MANY)) this.pace = -1;
      if ((nv & CS_START_MANY) && (nv & CS_EN) && !this.busy && this.pace < 0) this.start(c);
    } else if (off === O_DIV && (this.cs & CS_START_MANY)) this.paceFrom(c); // the divider restarts when it is written
    this.update();
    this.plan();
  }
  /** Start the pacing timer at cycle c (DIV non-zero), the first start at once. */
  paceFrom(c) {
    const d = this.r.get(O_DIV);
    if (!d || !(this.cs & CS_START_MANY)) { this.pace = -1; return; }
    if (!this.busy && (this.cs & CS_EN)) this.start(c);
    this.pace = c + (((d >>> 8) & 0xffff) + 1 + (d & 0xff) / 256) * this.ratio();
  }
  /** INTR.FIFO: the level at or above THRESH; an empty FIFO never (THRESH 0 would otherwise raise it at reset, where the SVD gives 0). */
  raw() { const t = (this.r.get(O_FCS) >>> 24) & 0xf, n = this.fifo.length; return n > 0 && n >= t ? 1 : 0; }
  update() {
    const v = ((this.raw() & this.r.get(O_INTE)) | this.r.get(O_INTF)) & 1;
    if (v !== this.line) { this.line = v; this.m.irq(IRQ_ADC, v); }
    this.m.dma?.levelChanged(DREQ_ADC);
  }
  /** DREQ_ADC: FCS.DREQ_EN and the FIFO level at or above THRESH (RP-001 FCS.THRESH). */
  dreq() {
    if (this.held()) return false;
    const f = this.r.get(O_FCS);
    return (f & FCS_DREQ_EN) !== 0 && this.fifo.length > 0 && this.fifo.length >= ((f >>> 24) & 0xf);
  }
  /** The host sets a channel's voltage (an input of the run). */
  setVolts(ch, v) { if (ch >= 0 && ch < 4 && Number.isFinite(v)) this.volts[ch] = Math.max(0, Math.min(ADC_VREF + 0.33, v)); }

  view() {
    const cs = this.readReg(O_CS), fcs = this.readReg(O_FCS), d = this.r.get(O_DIV);
    return { en: (cs & 1) === 1, tsEn: (cs & 2) !== 0, many: (cs & CS_START_MANY) !== 0, ready: (cs & CS_READY) !== 0, busy: this.busy, ainsel: (cs >>> 12) & 0xf,
      rrobin: (cs >>> 16) & 0x1ff, result: this.r.get(O_RESULT), fifo: this.fifo.slice(), fifoEn: (fcs & 1) === 1, shift: (fcs & 2) !== 0, dreqEn: (fcs & 8) !== 0,
      thresh: (fcs >>> 24) & 0xf, over: (fcs & FCS_OVER) !== 0, under: (fcs & FCS_UNDER) !== 0, div: ((d >>> 8) & 0xffff) + (d & 0xff) / 256, clkAdc: this.m.freq.adc,
      volts: this.volts.slice(), temp: this.m.env?.temp ?? 25, conversions: this.conversions, irq: this.line === 1 };
  }

  save() { return { ...super.save(), fifo: this.fifo.slice(), busy: this.busy, convCh: this.convCh, convCode: this.convCode, convEnd: this.convEnd, line: this.line, pace: this.pace, volts: this.volts.slice(), conversions: this.conversions }; }
  load(s) {
    super.load(s); this.fifo = s.fifo.slice(); this.busy = s.busy; this.convCh = s.convCh; this.convCode = s.convCode; this.convEnd = s.convEnd;
    this.line = s.line; this.pace = s.pace; this.volts = s.volts.slice(); this.conversions = s.conversions;
  }
}
