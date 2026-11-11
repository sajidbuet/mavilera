// core1.js -- core 1's wait in the bootrom and its launch, modelled at a high level (P1-M6, docs/architecture/pico2-p1m6-second-core.md
// Q1 A; ADR-0008 high-level boot, research D7): after reset core 1 sleeps in the bootrom until core 0 sends, through the SIO FIFO,
// 0, 0, 1, the vector table (mtvec on RISC-V), the stack pointer and the entry, each echoed back; a word out of sequence starts the
// sequence again (RP-001 §5.3; pico-sdk pico_multicore multicore_launch_core1_raw). Here each word core 0 writes while core 1 waits
// is taken at once (the bootrom's own cycles are not modelled) and echoed into core 0's incoming FIFO. After the entry word core 1
// starts there with sp, mtvec and ra = the ROM's "core 1 return" slot: returning to it parks core 1 in the wait again (Q3 A).
// PSM FRCE_OFF.PROC1 (bit 24) holds core 1 off; clearing it restarts the wait, in which core 1 drains its incoming FIFO and pushes a
// 0 to core 0 (the pico-sdk comment in multicore_reset_core1). Not machine time: nothing here is scheduled.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';
import { CORE1_RETURN } from '../boot/rom.js';

const EXPECT = [0, 0, 1];
export const PROC1_BIT = 1 << 24; // PSM FRCE_OFF/FRCE_ON/DONE: PROC1 (pico-sdk hardware/regs/psm.h)

export class Core1 {
  constructor(m) { this.m = m; this.reset(); }
  reset() { this.parked = true; this.off = false; this.seq = 0; this.vals = [0, 0, 0]; this.launches = 0; }
  /** Core 0 wrote w into the 0→1 FIFO while core 1 waits (sio.js): echo it and step the sequence. */
  receive(w) {
    w >>>= 0;
    this.m.sio.push(1, w);
    if (this.seq < 3) this.seq = w === EXPECT[this.seq] ? this.seq + 1 : w === 0 ? 1 : 0;
    else { this.vals[this.seq - 3] = w; this.seq++; }
    if (this.seq === 6) this.launch();
  }
  launch() {
    const m = this.m, h = m.harts[1], a = m.harts[0];
    const t = m.now;
    h.reset();
    h.ticks = t; // core 1 starts at the present cycle
    h.mtvec = this.vals[0]; h.x[2] = this.vals[1] | 0; h.pc = this.vals[2] | 0; h.x[1] = CORE1_RETURN;
    h.irqc.irq.set(a.irqc.irq); h.irqc.dirty = true; // the shared lines as they are now; the core-local ones follow
    this.parked = false; this.seq = 0; this.launches++;
    m.core1Changed();
    m.sio.updateIrqs(); m.io.updateIrq();
  }
  /** Back to the wait (core 1 returned from its entry, or the PSM holds it off). */
  park() {
    this.parked = true; this.seq = 0;
    const h = this.m.harts[1];
    h.sleeping = false; h.reservation = -1;
    this.m.core1Changed();
  }
  /** PSM FRCE_OFF.PROC1 changed (Psm.onWrite). */
  power(off) {
    if (off === this.off) return;
    this.off = off;
    if (off) { this.park(); this.m.harts[1].reset(); return; }
    // out of reset: the bootrom drains core 1's incoming FIFO and tells core 0 with a 0
    this.m.sio.drain(0);
    this.m.sio.push(1, 0);
  }
  get running() { return !this.parked && !this.off; }
  save() { return { parked: this.parked, off: this.off, seq: this.seq, vals: this.vals.slice(), launches: this.launches }; }
  load(s) { ({ parked: this.parked, off: this.off, seq: this.seq, launches: this.launches } = s); this.vals = s.vals.slice(); }
}

/** PSM: the registers (FRCE_ON, FRCE_OFF, WDSEL, DONE), with FRCE_OFF.PROC1 holding core 1 off and DONE following FRCE_OFF. */
export class Psm extends Device {
  constructor(m) { super(m, 'PSM'); this.oOff = this.r.off('FRCE_OFF'); this.oDone = this.r.off('DONE'); }
  readReg(off) {
    if (off === this.oDone) return (this.r.get(off) & ~this.r.get(this.oOff)) >>> 0; // a domain forced off is not done
    return this.r.get(off);
  }
  onWrite(off, nv, old) {
    if (off === this.oOff && ((nv ^ old) & PROC1_BIT)) this.m.core1.power((nv & PROC1_BIT) !== 0);
  }
}
