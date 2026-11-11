// spi.js -- SPI0 and SPI1 of the RP2350, Arm PL022 (RP-001 §12.3; P1-M7, design docs/architecture/pico2-p1m7-adc-spi-i2c.md) as
// a master at the frame level: SSPCR0 (DSS 4-16 bits, FRF, SPO, SPH, SCR), SSPCR1 (LBM, SSE, MS, SOD), SSPDR into the 8-deep TX
// FIFO and out of the 8-deep RX FIFO, SSPSR (TFE, TNF, RNE, RFF, BSY), SSPCPSR, the interrupts (TX: TX FIFO at most half full;
// RX: RX FIFO at least half full; RT: data in the RX FIFO and no frame for 32 bit times; ROR: a frame arrived with the RX FIFO
// full, the frame is lost) on IRQ 31/32, and DMA requests (TX while TXDMAE and the TX FIFO has room, RX while RXDMAE and the RX
// FIFO holds data; DREQ 24-27, pico-sdk dreq.h). One frame takes bits x CPSDVSR x (1 + SCR) cycles of clk_peri; frames follow each
// other without a gap (the gaps between frames are not modelled). LBM loops TX into RX. Otherwise each frame goes to the parts
// of the lab kit on this instance whose chip select pin is low (parts/kit.js), and their reply returns when the MISO pin selects
// SPI (else 0). With the PL022's own chip select (function SPI on a CSn pin) the pin is low while a frame is sent and goes high
// between frames when SPH = 0 (Motorola mode) and when the TX FIFO runs empty. Slave mode (MS = 1), TI and Microwire frames:
// the registers are kept and a diagnostic says they are not modelled. GPIO function F1: role n & 3 (0 RX, 1 CSn, 2 SCK, 3 TX),
// instance (n >> 3) & 1 (RP-001 §9.4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';

export const F_SPI = 1;
const FIFO = 8, O_CR0 = 0x0, O_CR1 = 0x4, O_DR = 0x8, O_SR = 0xc, O_CPSR = 0x10, O_IMSC = 0x14, O_RIS = 0x18, O_MIS = 0x1c, O_ICR = 0x20, O_DMACR = 0x24;
const CR1_LBM = 1, CR1_SSE = 2, CR1_MS = 4;
const RIS_ROR = 1, RIS_RT = 2, RIS_RX = 4, RIS_TX = 8;
export const spiOfPin = (n) => (n >>> 3) & 1;
const LOG = 256;

export class Spi extends Device {
  constructor(m, index) {
    super(m, `SPI${index}`, { regs: 'SPI0', resetBit: 18 + index });
    this.index = index; this.irqNum = 31 + index;
    this.log = []; this.frames = 0;
    this.reset();
  }
  reset() {
    if (this.line && this.m.ready) this.m.irq(this.irqNum, 0);
    super.reset();
    this.tx = []; this.rx = []; this.shifting = -1; this.endAt = 0; this.ris = 0; this.line = 0; this.rtAt = Infinity; this.csLow = false;
    if (this.m.ready) this.csPins();
  }
  get cr0() { return this.r.get(O_CR0); }
  get cr1() { return this.r.get(O_CR1); }
  bits() { return (this.cr0 & 0xf) + 1; }
  /** clk_sys cycles for one bit, or 0 when clk_peri or the prescaler is zero. */
  bitCycles() {
    const f = this.m.freq, cps = this.r.get(O_CPSR) & 0xfe, scr = (this.cr0 >>> 8) & 0xff;
    if (!f.peri || !f.sys || !cps) return 0;
    return (cps * (1 + scr) * f.sys) / f.peri;
  }

  // ---- frames ----
  kick(c) {
    if (this.shifting >= 0 || !this.tx.length || !(this.cr1 & CR1_SSE)) return;
    if (this.cr1 & CR1_MS) { this.m.diag('spiSlave', this.name); return; }
    const frf = (this.cr0 >>> 4) & 3;
    if (frf) this.m.diag('spiFormat', this.name, frf);
    const b = this.bitCycles();
    if (!b) { this.m.diag('spiNoClock', this.name); return; }
    this.shifting = this.tx.shift();
    this.endAt = c + Math.max(1, Math.ceil(this.bits() * b));
    if (!this.csLow) { this.csLow = true; this.csPins(); }
    this.next = Math.min(this.endAt, this.rtAt); this.m.schedule(this);
    this.update();
  }
  event(now) {
    if (this.shifting >= 0 && now >= this.endAt) this.finish(now);
    if (now >= this.rtAt) { this.rtAt = Infinity; if (this.rx.length) { this.ris |= RIS_RT; this.update(); } }
    this.next = this.shifting >= 0 ? Math.min(this.endAt, this.rtAt) : this.rtAt;
  }
  finish(now) {
    const mask = (1 << this.bits()) - 1, out = this.shifting & mask;
    this.shifting = -1;
    let inV;
    if (this.cr1 & CR1_LBM) { inV = out; this.logFrame(null, out, out); }
    else inV = this.exchange(out) & mask;
    this.frames++;
    if (this.rx.length >= FIFO) this.ris |= RIS_ROR; else this.rx.push(inV);
    const sph = (this.cr0 >>> 7) & 1;
    if (this.csLow && (!sph || !this.tx.length)) { this.csLow = false; this.csPins(); } // the PL022's own CSn goes high between frames
    this.rtAt = now + Math.ceil(32 * this.bitCycles());
    this.kick(now);
    this.update();
  }
  /** A frame to the parts on this instance's pins (the kit: SCK and MOSI must select SPI; MISO carries the reply back). */
  exchange(out) {
    const kit = this.m.kitOn ? this.m.kit?.spi[this.index] : null;
    let inV = 0;
    if (kit && kit.sck >= 0) {
      const p = this.m.pins, fn = (n) => p.ctrl[n] & 0x1f;
      const wired = fn(kit.sck) === F_SPI && fn(kit.mosi) === F_SPI;
      let reply = 0, who = null;
      if (wired) for (const { cs, part } of kit.parts) if (p.level[cs] === 0) { reply = part.transfer(out) ?? 0; who = cs; }
      if (who !== null && fn(kit.miso) === F_SPI) inV = reply;
      this.logFrame(who, out, inV);
      return inV;
    }
    this.logFrame(null, out, 0);
    return 0;
  }
  logFrame(cs, tx, rx) {
    this.log.push({ cycle: this.now, cs, tx, rx });
    if (this.log.length > LOG) this.log.splice(0, this.log.length - LOG);
    this.m.onBus?.('spi', this.index, { cs, tx, rx });
  }
  /** The kit parts' chip selects follow their pins (called by the machine when a pin's level changes). */
  pinLevel(n, level) {
    const kit = this.m.kit?.spi[this.index];
    if (!kit) return;
    for (const { cs, part } of kit.parts) if (cs === n) part.select(this.m.kitOn && level === 0);
  }
  /** Recompute the pins that show this instance's CSn (their level follows a frame in flight). */
  csPins() {
    const p = this.m.pins; if (!p) return;
    for (let n = 0; n < 30; n++) if ((p.ctrl[n] & 0x1f) === F_SPI && (n & 3) === 1 && spiOfPin(n) === this.index) p.update(n);
  }
  /** A pin with function SPI: [out, oe] for its role. */
  pinOut(n) {
    const role = n & 3, master = !(this.cr1 & CR1_MS);
    if (role === 0 || !master) return [0, 0];
    if (role === 1) return [this.csLow ? 0 : 1, 1];
    if (role === 2) return [(this.cr0 >>> 6) & 1, 1]; // SCK idles at SPO
    return [0, 1];
  }

  // ---- registers ----
  read(off, addr) {
    if (!this.held() && off === O_DR) {
      const v = this.rx.length ? this.rx.shift() : 0;
      if (!this.rx.length) { this.ris &= ~RIS_RT; this.rtAt = Infinity; }
      this.update();
      return v;
    }
    return super.read(off, addr);
  }
  readReg(off) {
    if (off === O_SR) {
      const t = this.tx.length, r = this.rx.length;
      return (t === 0 ? 1 : 0) | (t < FIFO ? 2 : 0) | (r > 0 ? 4 : 0) | (r >= FIFO ? 8 : 0) | (t || this.shifting >= 0 ? 0x10 : 0);
    }
    if (off === O_RIS) return this.rawIrq();
    if (off === O_MIS) return this.rawIrq() & this.r.get(O_IMSC);
    return this.r.get(off);
  }
  write(off, value, alias, addr, size, raw) {
    if (!this.held() && off === O_DR) {
      const v = (alias === 0 ? value : (this.read(off) ^ value)) & 0xffff; // an alias write is a read-modify-write (RP-001 §2.1.3)
      if (this.tx.length >= FIFO) { this.m.diag('spiOverflow', this.name); return; }
      this.tx.push(v);
      this.kick(this.now);
      this.update();
      return;
    }
    if (!this.held() && off === O_ICR) { this.ris &= ~(value & (RIS_ROR | RIS_RT)); this.update(); return; }
    super.write(off, value, alias, addr, size, raw);
  }
  onWrite(off) {
    if (off === O_CR1 || off === O_CR0) {
      this.kick(this.now);
      if (this.m.pins) for (let n = 0; n < 30; n++) if ((this.m.pins.ctrl[n] & 0x1f) === F_SPI && spiOfPin(n) === this.index) this.m.pins.update(n);
    }
    this.update();
  }
  rawIrq() { return (this.ris & (RIS_ROR | RIS_RT)) | (this.rx.length >= FIFO / 2 ? RIS_RX : 0) | (this.tx.length <= FIFO / 2 ? RIS_TX : 0); }
  update() {
    const v = (this.rawIrq() & this.r.get(O_IMSC)) ? 1 : 0;
    if (v !== this.line) { this.line = v; this.m.irq(this.irqNum, v); }
    this.m.dma?.levelChanged(24 + 2 * this.index); this.m.dma?.levelChanged(25 + 2 * this.index);
  }
  /** DREQ (TX: rx = 0; RX: rx = 1). */
  dreq(rx) {
    if (this.held()) return false;
    const d = this.r.get(O_DMACR);
    return rx ? (d & 1) !== 0 && this.rx.length > 0 : (d & 2) !== 0 && this.tx.length < FIFO;
  }
  view() {
    const cr0 = this.cr0, cr1 = this.cr1, b = this.bitCycles(), f = this.m.freq;
    return { index: this.index, enabled: (cr1 & CR1_SSE) !== 0, master: !(cr1 & CR1_MS), loopback: (cr1 & CR1_LBM) !== 0, bits: this.bits(), format: (cr0 >>> 4) & 3,
      cpol: (cr0 >>> 6) & 1, cpha: (cr0 >>> 7) & 1, baud: b ? f.sys / b : 0, tx: this.tx.slice(), rx: this.rx.slice(), busy: this.shifting >= 0 || this.tx.length > 0,
      ris: this.rawIrq(), imsc: this.r.get(O_IMSC), dmacr: this.r.get(O_DMACR), frames: this.frames, log: this.log.slice(-32) };
  }
  save() { return { ...super.save(), tx: this.tx.slice(), rx: this.rx.slice(), shifting: this.shifting, endAt: this.endAt, ris: this.ris, line: this.line, rtAt: this.rtAt, csLow: this.csLow, frames: this.frames }; }
  load(s) {
    super.load(s); this.tx = s.tx.slice(); this.rx = s.rx.slice(); this.shifting = s.shifting; this.endAt = s.endAt; this.ris = s.ris; this.line = s.line;
    this.rtAt = s.rtAt; this.csLow = s.csLow; this.frames = s.frames;
  }
}
