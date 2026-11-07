// sio.js -- the RP2350 single-cycle IO block as core 0 sees it (RP-001 §3.1; R-RP-01 §3.7-3.8): CPUID; GPIO_OUT/OE with their
// SET/CLR/XOR registers and GPIO_IN; the inter-core FIFO (core 1 is parked and never reads it: P1-M2 decision Q7); 32 spinlocks
// (a read claims and returns the lock bit, a write releases; RP-001 §3.1.4); RISCV_SOFTIRQ -> mip.msip; the RISC-V platform timer
// MTIME/MTIMEH (64-bit, counting RISC-V ticks from TICKS, or clk_sys cycles with MTIME_CTRL.FULLSPEED) and core 0's
// MTIMECMP/MTIMECMPH -> mip.mtip and IRQ 29 (SIO_IRQ_MTIMECMP) (RP-001 §3.1.8, §3.8.4.2.1). Interpolators, doorbells and the
// TMDS encoder keep their registers and are reported as not modelled when written.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';
import { RateCounter } from './counter.js';
import { TICK } from './clocks.js';
import { IRQ } from '../core/hart.js';

const TWO32 = 4294967296;
const PIN_MASK = 0x3fffffff; // GPIO 0-29

export class Sio extends Device {
  constructor(m) {
    super(m, 'SIO');
    const o = (n) => this.r.off(n);
    this.o = { cpuid: o('CPUID'), in: o('GPIO_IN'), out: o('GPIO_OUT'), outSet: o('GPIO_OUT_SET'), outClr: o('GPIO_OUT_CLR'), outXor: o('GPIO_OUT_XOR'),
      oe: o('GPIO_OE'), oeSet: o('GPIO_OE_SET'), oeClr: o('GPIO_OE_CLR'), oeXor: o('GPIO_OE_XOR'), fifoSt: o('FIFO_ST'), fifoWr: o('FIFO_WR'),
      fifoRd: o('FIFO_RD'), lockSt: o('SPINLOCK_ST'), lock0: o('SPINLOCK0'), softirq: o('RISCV_SOFTIRQ'), mtimeCtrl: o('MTIME_CTRL'),
      mtime: o('MTIME'), mtimeh: o('MTIMEH'), cmp: o('MTIMECMP'), cmph: o('MTIMECMPH'), interp0: o('INTERP0_ACCUM0'), doorbell: o('DOORBELL_OUT_SET'),
      tmds: o('TMDS_CTRL') };
    this.reset();
  }
  reset() {
    super.reset();
    this.gpioOut = 0; this.gpioOe = 0; this.locks = 0; this.fifo = 0; this.fifoFlags = 0; this.msip = 0; this.mtip = 0;
    this.mtime = new RateCounter(); this.cmpLo = 0xffffffff; this.cmpHi = 0xffffffff; // MTIMECMP resets to all ones
    if (this.m.ready) this.retime(this.now);
  }
  retime(now) {
    const ctrl = this.r.get(this.o.mtimeCtrl);
    const rate = !(ctrl & 1) ? [0, 1] : (ctrl & 2) ? [1, 1] : this.m.ticks.rate(TICK.RISCV);
    this.mtime.setRate(now, rate[0], rate[1]);
    this.planTimer(now);
  }

  read(off, addr) {
    const o = this.o;
    if (off >= o.lock0 && off < o.lock0 + 128) { const n = (off - o.lock0) >>> 2; if (this.locks & (1 << n)) return 0; this.locks = (this.locks | (1 << n)) >>> 0; return (1 << n) >>> 0; }
    if (off === o.fifoRd) { if (!this.fifoIn) this.fifoFlags |= 0x8; return 0; } // core 1 never sends: read on empty (ROE)
    return super.read(off, addr);
  }
  readReg(off) {
    const o = this.o, now = this.now;
    switch (off) {
      case o.cpuid: return 0;
      case o.in: return this.m.pins.inMask;
      case o.out: return this.gpioOut;
      case o.oe: return this.gpioOe;
      case o.fifoSt: return (this.fifo < 4 ? 0x2 : 0) | this.fifoFlags;
      case o.lockSt: return this.locks;
      case o.softirq: return this.msip;
      case o.mtime: return this.mtime.value(now) % TWO32;
      case o.mtimeh: return Math.floor(this.mtime.value(now) / TWO32) >>> 0;
      case o.cmp: return this.cmpLo;
      case o.cmph: return this.cmpHi;
      default: return this.r.get(off);
    }
  }
  write(off, value, alias, addr, size, raw) {
    const o = this.o;
    if (off >= o.lock0 && off < o.lock0 + 128) { this.locks = (this.locks & ~(1 << ((off - o.lock0) >>> 2))) >>> 0; return; }
    super.write(off, value, alias, addr, size, raw);
  }
  onWrite(off, nv, old, value) {
    const o = this.o, now = this.now;
    let out = this.gpioOut, oe = this.gpioOe;
    switch (off) {
      case o.out: out = value; break;
      case o.outSet: out |= value; break;
      case o.outClr: out &= ~value; break;
      case o.outXor: out ^= value; break;
      case o.oe: oe = value; break;
      case o.oeSet: oe |= value; break;
      case o.oeClr: oe &= ~value; break;
      case o.oeXor: oe ^= value; break;
      case o.fifoSt: this.fifoFlags &= ~(value & 0xc); return;                       // write to clear WOF, ROE
      case o.fifoWr: if (this.fifo < 4) this.fifo++; else this.fifoFlags |= 0x4; this.m.diag('sioFifo'); return;
      case o.softirq: {
        if (value & 0x1) this.msip = 1;
        if (value & 0x100) this.msip = 0;
        this.m.coreIrq(IRQ.MSI, this.msip); return;
      }
      case o.mtimeCtrl: this.retime(now); return;
      case o.mtime: this.mtime.setValue(now, Math.floor(this.mtime.value(now) / TWO32) * TWO32 + (value >>> 0)); this.planTimer(now); return;
      case o.mtimeh: this.mtime.setValue(now, (value >>> 0) * TWO32 + (this.mtime.value(now) % TWO32)); this.planTimer(now); return;
      case o.cmp: this.cmpLo = value >>> 0; this.planTimer(now); return;
      case o.cmph: this.cmpHi = value >>> 0; this.planTimer(now); return;
      default:
        if (off >= o.interp0 && off < o.lock0) this.m.diag('sioInterp');
        else if (off >= o.doorbell && off < o.softirq) this.m.diag('sioDoorbell');
        else if (off >= o.tmds) this.m.diag('sioTmds');
        return;
    }
    out >>>= 0; oe >>>= 0;
    const changed = ((out ^ this.gpioOut) | (oe ^ this.gpioOe)) & PIN_MASK;
    this.gpioOut = out; this.gpioOe = oe;
    if (changed) this.m.pins.updateMask(changed);
  }
  /** mip.mtip and IRQ 29 follow MTIME >= MTIMECMP; the next crossing is a scheduled event. */
  planTimer(now) {
    const cmp = this.cmpHi * TWO32 + this.cmpLo, t = this.mtime.value(now), due = t >= cmp ? 1 : 0;
    if (due !== this.mtip) { this.mtip = due; this.m.coreIrq(IRQ.MTI, due); this.m.irq(29, due); }
    this.next = due ? Infinity : this.mtime.cycleFor(now, cmp);
    this.m.schedule(this);
  }
  event(now) { this.planTimer(now); }
  save() { return { ...super.save(), gpioOut: this.gpioOut, gpioOe: this.gpioOe, locks: this.locks, fifo: this.fifo, fifoFlags: this.fifoFlags, msip: this.msip, mtip: this.mtip, mtime: this.mtime.save(), cmpLo: this.cmpLo, cmpHi: this.cmpHi }; }
  load(s) {
    super.load(s);
    ({ gpioOut: this.gpioOut, gpioOe: this.gpioOe, locks: this.locks, fifo: this.fifo, fifoFlags: this.fifoFlags, msip: this.msip, mtip: this.mtip, cmpLo: this.cmpLo, cmpHi: this.cmpHi } = s);
    this.mtime.load(s.mtime);
  }
}
