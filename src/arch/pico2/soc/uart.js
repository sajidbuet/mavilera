// uart.js -- UART0 and UART1 of the RP2350, Arm PL011 (RP-001 §12.1; R-RP-01 §3.12), at the level of the fidelity table:
// FIFO levels, flags, interrupt conditions and the character time from the baud divisor; no bit-level waveform. TX: a byte
// written to UARTDR enters the 32-deep FIFO (1-deep with LCR_H.FEN clear) and is sent in one character time,
// frame bits x 16 x (IBRD + FBRD/64) cycles of clk_peri; the output log stamps each byte at its FIFO write (decision D13: the
// comparison with SIM-001, whose UART has no character time). RX: bytes from the host enter the RX FIFO.
// Interrupts are modelled as levels: TX when the TX FIFO is at or below its trigger level, RX when the RX FIFO is at or above
// it (UARTIFLS); receive timeout and error interrupts are not modelled. IRQ 33 (UART0) and 34 (UART1) (RP-001 §3.2 Table 95).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';

const FR_BUSY = 0x8, FR_RXFE = 0x10, FR_TXFF = 0x20, FR_RXFF = 0x40, FR_TXFE = 0x80;
const CR_UARTEN = 0x1, CR_TXE = 0x100, CR_RXE = 0x200;
const LEVELS = [4, 8, 16, 24, 28]; // 1/8 .. 7/8 of 32 (UARTIFLS)

export class Uart extends Device {
  constructor(m, index) {
    super(m, `UART${index}`, { regs: 'UART0', resetBit: 26 + index });
    this.index = index; this.irqNum = 33 + index;
    const o = (n) => this.r.off(`UART${n}`);
    this.o = { dr: o('DR'), rsr: o('RSR'), fr: o('FR'), ibrd: o('IBRD'), fbrd: o('FBRD'), lcr: o('LCR_H'), cr: o('CR'), ifls: o('IFLS'),
      imsc: o('IMSC'), ris: o('RIS'), mis: o('MIS'), icr: o('ICR') };
    this.out = { cycles: [], bytes: [], base: 0 }; // the output log keeps its newest 2^20 bytes (base counts the dropped ones)
    this.reset();
  }
  reset() {
    if (this.line && this.m.ready) this.m.irq(this.irqNum, 0);
    super.reset();
    this.tx = []; this.shifting = -1; this.rx = []; this.line = 0;
  }
  get cap() { return (this.r.get(this.o.lcr) & 0x10) ? 32 : 1; }
  get enabledTx() { const cr = this.r.get(this.o.cr); return (cr & CR_UARTEN) && (cr & CR_TXE); }

  /** Cycles of clk_sys for one character, or Infinity when the divisor or clk_peri is zero. */
  charCycles() {
    const ibrd = this.r.get(this.o.ibrd) & 0xffff, fbrd = this.r.get(this.o.fbrd) & 0x3f, lcr = this.r.get(this.o.lcr), f = this.m.freq;
    const div = ibrd + fbrd / 64;
    if (!div || !f.peri || !f.sys) return Infinity;
    const bits = 1 + 5 + ((lcr >>> 5) & 3) + ((lcr & 0x2) ? 1 : 0) + ((lcr & 0x8) ? 2 : 1);
    return Math.max(1, Math.ceil((bits * 16 * div * f.sys) / f.peri));
  }

  read(off, addr) {
    if (!this.held() && off === this.o.dr) {
      const b = this.rx.length ? this.rx.shift() : 0;
      this.updateIrq();
      return b;
    }
    return super.read(off, addr);
  }
  readReg(off) {
    const o = this.o;
    if (off === o.fr) {
      return (this.tx.length >= this.cap ? FR_TXFF : 0) | (this.tx.length === 0 ? FR_TXFE : 0) | (this.shifting >= 0 || this.tx.length ? FR_BUSY : 0)
        | (this.rx.length === 0 ? FR_RXFE : 0) | (this.rx.length >= this.cap ? FR_RXFF : 0);
    }
    if (off === o.ris) return this.ris();
    if (off === o.mis) return this.ris() & this.r.get(o.imsc);
    return this.r.get(off);
  }
  write(off, value, alias, addr, size, raw) {
    if (!this.held() && off === this.o.dr) {
      // atomic aliases on UART registers go through a read-modify-write interposer (RP-001 §2.1.3): for DR that writes a byte
      const b = (alias === 0 ? value : (this.read(off) ^ value)) & 0xff;
      if (this.tx.length >= this.cap) { this.m.diag('uartOverflow', this.name); return; }
      this.tx.push(b);
      const o = this.out;
      o.cycles.push(this.now); o.bytes.push(b);
      if (o.bytes.length > 1 << 20) { o.cycles.splice(0, 1 << 19); o.bytes.splice(0, 1 << 19); o.base += 1 << 19; }
      this.m.onUart?.(this.index, b, this.now);
      this.kick(this.now);
      this.updateIrq();
      return;
    }
    super.write(off, value, alias, addr, size, raw);
  }
  onWrite(off) {
    if (off === this.o.cr || off === this.o.lcr) this.kick(this.now);
    this.updateIrq();
  }
  /** Start sending the next byte if the transmitter is idle and enabled. */
  kick(now) {
    if (this.shifting >= 0 || !this.tx.length || !this.enabledTx) return;
    this.shifting = this.tx.shift();
    this.next = now + this.charCycles();
    this.m.schedule(this);
  }
  event(now) {
    this.shifting = -1; this.next = Infinity;
    this.kick(now);
    this.updateIrq();
  }
  /** Bytes from the host (keyboard): into the RX FIFO when the receiver is enabled. */
  receive(bytes) {
    const cr = this.r.get(this.o.cr);
    if (!(cr & CR_UARTEN) || !(cr & CR_RXE)) { this.m.diag('uartRxDisabled', this.name); return; }
    for (const b of bytes) { if (this.rx.length < this.cap) this.rx.push(b & 0xff); else this.m.diag('uartRxOverrun', this.name); }
    this.updateIrq();
  }
  ris() {
    const ifls = this.r.get(this.o.ifls), fen = this.r.get(this.o.lcr) & 0x10;
    const txLevel = fen ? LEVELS[ifls & 7] ?? 16 : 0, rxLevel = fen ? LEVELS[(ifls >>> 3) & 7] ?? 16 : 1;
    return (this.tx.length <= txLevel ? 0x20 : 0) | (this.rx.length >= rxLevel ? 0x10 : 0);
  }
  updateIrq() {
    const v = (this.ris() & this.r.get(this.o.imsc)) ? 1 : 0;
    if (v !== this.line) { this.line = v; this.m.irq(this.irqNum, v); }
  }
  /** The text sent so far (bytes as Latin-1 characters). */
  text(from = 0) { let s = ''; for (let i = from; i < this.out.bytes.length; i++) s += String.fromCharCode(this.out.bytes[i]); return s; }

  save() { return { ...super.save(), tx: this.tx.slice(), shifting: this.shifting, rx: this.rx.slice(), line: this.line, outTotal: this.out.base + this.out.bytes.length }; }
  load(s) {
    super.load(s); this.tx = s.tx.slice(); this.shifting = s.shifting; this.rx = s.rx.slice(); this.line = s.line;
    const o = this.out, keep = s.outTotal - o.base;
    if (keep >= 0) { o.bytes.length = Math.min(keep, o.bytes.length); o.cycles.length = o.bytes.length; }
    else { o.bytes.length = 0; o.cycles.length = 0; o.base = s.outTotal; }
  }
}
