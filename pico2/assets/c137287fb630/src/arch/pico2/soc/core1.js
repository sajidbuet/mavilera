// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
import { CORE1_RETURN } from '../boot/rom.js';
const EXPECT = [0, 0, 1];
export const PROC1_BIT = 1 << 24;
export class Core1 {
 constructor(m) { this.m = m; this.reset(); }
 reset() { this.parked = true; this.off = false; this.seq = 0; this.vals = [0, 0, 0]; this.launches = 0; }
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
 h.ticks = t;
 h.mtvec = this.vals[0]; h.x[2] = this.vals[1] | 0; h.pc = this.vals[2] | 0; h.x[1] = CORE1_RETURN;
 h.irqc.irq.set(a.irqc.irq); h.irqc.dirty = true;
 this.parked = false; this.seq = 0; this.launches++;
 m.core1Changed();
 m.sio.updateIrqs(); m.io.updateIrq();
 }
 park() {
 this.parked = true; this.seq = 0;
 const h = this.m.harts[1];
 h.sleeping = false; h.reservation = -1;
 this.m.core1Changed();
 }
 power(off) {
 if (off === this.off) return;
 this.off = off;
 if (off) { this.park(); this.m.harts[1].reset(); return; }
 this.m.sio.drain(0);
 this.m.sio.push(1, 0);
 }
 get running() { return !this.parked && !this.off; }
 save() { return { parked: this.parked, off: this.off, seq: this.seq, vals: this.vals.slice(), launches: this.launches }; }
 load(s) { ({ parked: this.parked, off: this.off, seq: this.seq, launches: this.launches } = s); this.vals = s.vals.slice(); }
}
export class Psm extends Device {
 constructor(m) { super(m, 'PSM'); this.oOff = this.r.off('FRCE_OFF'); this.oDone = this.r.off('DONE'); }
 readReg(off) {
 if (off === this.oDone) return (this.r.get(off) & ~this.r.get(this.oOff)) >>> 0;
 return this.r.get(off);
 }
 onWrite(off, nv, old) {
 if (off === this.oOff && ((nv ^ old) & PROC1_BIT)) this.m.core1.power((nv & PROC1_BIT) !== 0);
 }
}
