// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
import { RateCounter } from './counter.js';
import { TICK } from './clocks.js';
const TWO32 = 4294967296;
export class Timer extends Device {
 constructor(m, index) {
 super(m, `TIMER${index}`, { regs: 'TIMER0', resetBit: 23 + index });
 this.index = index; this.irqBase = 4 * index; this.tick = index ? TICK.TIMER1 : TICK.TIMER0;
 const o = (n) => this.r.off(n);
 this.o = { hw: o('TIMEHW'), lw: o('TIMELW'), hr: o('TIMEHR'), lr: o('TIMELR'), alarm0: o('ALARM0'), armed: o('ARMED'), rawh: o('TIMERAWH'),
 rawl: o('TIMERAWL'), pause: o('PAUSE'), locked: o('LOCKED'), source: o('SOURCE'), intr: o('INTR'), inte: o('INTE'), intf: o('INTF'), ints: o('INTS') };
 this.cnt = new RateCounter();
 this.reset();
 }
 reset() {
 if (this.lines && this.m.ready) for (let n = 0; n < 4; n++) if ((this.lines >>> n) & 1) this.m.irq(this.irqBase + n, 0);
 super.reset();
 this.cnt = new RateCounter(); this.armed = 0; this.latchHi = 0; this.lw = 0; this.lines = 0;
 if (this.m.ready) { this.retime(this.now); this.updateIrq(); }
 }
 time(now) { return this.cnt.value(now); }
 retime(now) {
 let rate = [0, 1];
 if (!(this.r.get(this.o.pause) & 1) && !this.held()) rate = (this.r.get(this.o.source) & 1) ? [1, 1] : this.m.ticks.rate(this.tick);
 this.cnt.setRate(now, rate[0], rate[1]);
 this.plan(now);
 }
 readReg(off) {
 const now = this.now, o = this.o;
 switch (off) {
 case o.rawl: return this.time(now) % TWO32;
 case o.rawh: return Math.floor(this.time(now) / TWO32) >>> 0;
 case o.lr: { const t = this.time(now); this.latchHi = Math.floor(t / TWO32) >>> 0; return t % TWO32; }
 case o.hr: return this.latchHi;
 case o.armed: return this.armed;
 case o.ints: return ((this.r.get(o.intr) | this.r.get(o.intf)) & this.r.get(o.inte)) & 0xf;
 default: return this.r.get(off);
 }
 }
 write(off, value, alias, addr, size, raw) {
 if (!this.held() && off === this.o.armed) {
 this.armed &= ~(alias === 3 ? 0 : value & 0xf); this.plan(this.now); return;
 }
 super.write(off, value, alias, addr, size, raw);
 }
 onWrite(off, nv) {
 const now = this.now, o = this.o;
 if (off >= o.alarm0 && off < o.alarm0 + 16) {
 const n = (off - o.alarm0) >>> 2;
 this.armed |= 1 << n;
 this.plan(now);
 } else if (off === o.lw) { this.lw = nv; }
 else if (off === o.hw) { if (!(this.r.get(o.locked) & 1)) { this.cnt.setValue(now, nv * TWO32 + this.lw); this.plan(now); } }
 else if (off === o.pause || off === o.source) this.retime(now);
 if (off === o.intr || off === o.inte || off === o.intf) this.updateIrq();
 }
 plan(now) {
 const t = this.time(now), low = t % TWO32;
 let next = Infinity;
 for (let n = 0; n < 4; n++) {
 if (!(this.armed & (1 << n))) continue;
 const d = (this.r.get(this.o.alarm0 + 4 * n) - low) >>> 0;
 if (d === 0) { this.fire(n); continue; }
 const c = this.cnt.cycleFor(now, t + d);
 if (c < next) next = c;
 }
 this.next = next;
 this.m.schedule(this);
 }
 fire(n) {
 this.armed &= ~(1 << n);
 this.r.set(this.o.intr, this.r.get(this.o.intr) | (1 << n));
 this.updateIrq();
 }
 event(now) { this.plan(now); }
 updateIrq() {
 const s = ((this.r.get(this.o.intr) | this.r.get(this.o.intf)) & this.r.get(this.o.inte)) & 0xf;
 if (s === this.lines) return;
 for (let n = 0; n < 4; n++) if (((s ^ this.lines) >>> n) & 1) this.m.irq(this.irqBase + n, (s >>> n) & 1);
 this.lines = s;
 }
 save() { return { ...super.save(), cnt: this.cnt.save(), armed: this.armed, latchHi: this.latchHi, lw: this.lw, lines: this.lines }; }
 load(s) { super.load(s); this.cnt.load(s.cnt); this.armed = s.armed; this.latchHi = s.latchHi; this.lw = s.lw; this.lines = s.lines; }
}
