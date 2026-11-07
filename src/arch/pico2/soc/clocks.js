// clocks.js -- the RP2350 clock blocks as register behaviour (P1-M2; R-RP-01 §3.5 and its fidelity table: "register-visible
// lock/stable/ready flags; resulting frequencies; analogue start-up times not modelled"): CLOCKS (generators with their CTRL,
// DIV and SELECTED), XOSC, ROSC, PLL_SYS, PLL_USB, and TICKS (the tick generators that divide clk_ref for TIMER0/1 and the
// RISC-V platform timer, RP-001 §8.5). Field layouts from pico-sdk 2.3.1 hardware/regs (RP-020) and the SVD (RP-010).
// Frequencies: XOSC 12 MHz (the Pico 2 crystal: RP-002; SDK XOSC_HZ, RP-020 platform_defs.h), ROSC 11 MHz (nominal, RP-001
// §8.1.2), LPOSC 32.768 kHz; PLL: FREF / REFDIV x FBDIV / (POSTDIV1 x POSTDIV2) (RP-001 §8.6.1). A write that can change a
// frequency makes the machine re-time its tick consumers (machine.retime).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';

export const XOSC_HZ = 12_000_000;
export const ROSC_HZ = 11_000_000;
export const LPOSC_HZ = 32_768;
const GEN = ['GPOUT0', 'GPOUT1', 'GPOUT2', 'GPOUT3', 'REF', 'SYS', 'PERI', 'HSTX', 'USB', 'ADC'];

export class Clocks extends Device {
  constructor(m) {
    super(m, 'CLOCKS');
    this.ctrl = {}; this.div = {}; this.sel = {};
    for (const g of GEN) { this.ctrl[g] = this.r.off(`CLK_${g}_CTRL`); this.div[g] = this.r.off(`CLK_${g}_DIV`); this.sel[g] = this.r.off(`CLK_${g}_SELECTED`); }
    this.watch = new Set(GEN.flatMap((g) => [this.ctrl[g], this.div[g]]));
  }
  readReg(off) {
    if (off === this.sel.REF) return 1 << (this.r.get(this.ctrl.REF) & 3);  // glitchless mux: one-hot of SRC
    if (off === this.sel.SYS) return 1 << (this.r.get(this.ctrl.SYS) & 1);
    return this.r.get(off);
  }
  onWrite(off) { if (this.watch.has(off)) this.m.retime(); }

  /** The generator frequencies in Hz from the sources: {ref, sys, peri, usb, adc}. */
  frequencies(src) {
    const c = (g) => this.r.get(this.ctrl[g]), d = (g) => this.r.get(this.div[g]);
    const div16 = (g) => { const v = d(g); const n = (v >>> 16) || 65536; return n + (v & 0xffff) / 65536; };
    let ref;
    switch (c('REF') & 3) {
      case 0: ref = src.rosc; break;
      case 1: ref = ((c('REF') >>> 5) & 3) === 0 ? src.pllUsb : 0; break;   // aux: pll_usb (GPIN not modelled)
      case 2: ref = src.xosc; break;
      default: ref = LPOSC_HZ;
    }
    ref /= ((d('REF') >>> 16) & 0xff) || 256;
    const auxSys = [src.pllSys, src.pllUsb, src.rosc, src.xosc, 0, 0, 0, 0][(c('SYS') >>> 5) & 7];
    const sys = ((c('SYS') & 1) ? auxSys : ref) / div16('SYS');
    const aux = (g, list) => (c(g) & (1 << 11) ? list[(c(g) >>> 5) & 7] ?? 0 : 0);
    const peri = aux('PERI', [sys, src.pllSys, src.pllUsb, src.rosc, src.xosc, 0, 0]) / (((d('PERI') >>> 16) & 3) || 4);
    const usb = aux('USB', [src.pllUsb, src.pllSys, src.rosc, src.xosc, 0, 0]) / (((d('USB') >>> 16) & 0xf) || 16);
    const adc = aux('ADC', [src.pllUsb, src.pllSys, src.rosc, src.xosc, 0, 0]) / (((d('ADC') >>> 16) & 0xf) || 16);
    return { ref: Math.round(ref), sys: Math.round(sys), peri: Math.round(peri), usb: Math.round(usb), adc: Math.round(adc) };
  }
}

export class Xosc extends Device {
  constructor(m) { super(m, 'XOSC'); this.oCtrl = this.r.off('CTRL'); this.oStatus = this.r.off('STATUS'); }
  get enabled() { return ((this.r.get(this.oCtrl) >>> 12) & 0xfff) === 0xfab; }
  readReg(off) {
    if (off === this.oStatus) return (this.r.get(off) & ~0x80001000 | (this.enabled ? 0x80001000 : 0)) >>> 0; // STABLE, ENABLED at once
    return this.r.get(off);
  }
  onWrite(off) { if (off === this.oCtrl) this.m.retime(); }
}

export class Pll extends Device {
  constructor(m, name, resetBit) {
    super(m, name, { regs: 'PLL_SYS', resetBit });
    this.oCs = this.r.off('CS'); this.oPwr = this.r.off('PWR'); this.oFb = this.r.off('FBDIV_INT'); this.oPrim = this.r.off('PRIM');
  }
  get powered() { const p = this.r.get(this.oPwr); return !(p & 0x1) && !(p & 0x20); }  // PD and VCOPD clear
  readReg(off) {
    if (off === this.oCs) return ((this.r.get(off) & 0x7fffffff) | (this.powered && !this.held() ? 0x80000000 : 0)) >>> 0; // LOCK
    return this.r.get(off);
  }
  onWrite() { this.m.retime(); }
  reset() { super.reset(); if (this.m.ready) this.m.retime(); }
  frequency(xosc) {
    if (this.held()) return 0;
    const cs = this.r.get(this.oCs);
    if (cs & 0x100) return xosc;                                     // BYPASS
    if (!this.powered || (this.r.get(this.oPwr) & 0x8)) return 0;    // POSTDIVPD
    const refdiv = cs & 0x3f, fb = this.r.get(this.oFb) & 0xfff, prim = this.r.get(this.oPrim);
    const pd1 = (prim >>> 16) & 7, pd2 = (prim >>> 12) & 7;
    if (!refdiv || !pd1 || !pd2) return 0;
    return (xosc / refdiv) * fb / (pd1 * pd2);
  }
}

/** TICKS: six generators (PROC0, PROC1, TIMER0, TIMER1, WATCHDOG, RISCV), each ENABLE + CYCLES (clk_ref cycles per tick). */
export const TICK = Object.freeze({ PROC0: 0, PROC1: 1, TIMER0: 2, TIMER1: 3, WATCHDOG: 4, RISCV: 5 });
const TICK_NAMES = ['PROC0', 'PROC1', 'TIMER0', 'TIMER1', 'WATCHDOG', 'RISCV'];
export class Ticks extends Device {
  constructor(m) {
    super(m, 'TICKS');
    this.oCtrl = TICK_NAMES.map((n) => this.r.off(`${n}_CTRL`));
    this.oCycles = TICK_NAMES.map((n) => this.r.off(`${n}_CYCLES`));
  }
  readReg(off) {
    const g = this.oCtrl.indexOf(off);
    if (g >= 0) { const v = this.r.get(off) & 1; return v | (v << 1); } // RUNNING follows ENABLE
    return this.r.get(off);
  }
  onWrite() { this.m.retime(); }
  /** Ticks per clk_sys cycle of generator g as [num, den] (0 when stopped). */
  rate(g) {
    const en = this.r.get(this.oCtrl[g]) & 1, cyc = this.r.get(this.oCycles[g]) & 0x1ff, f = this.m.freq;
    if (!en || !cyc || !f.ref || !f.sys) return [0, 1];
    return [f.ref, f.sys * cyc];
  }
}
