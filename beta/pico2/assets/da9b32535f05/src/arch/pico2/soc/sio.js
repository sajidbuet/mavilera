// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
import { RateCounter } from './counter.js';
import { TICK } from './clocks.js';
import { IRQ } from '../core/hart.js';
const TWO32 = 4294967296;
const PIN_MASK = 0x3fffffff;
const FIFO_DEPTH = 4;
export const IRQ_SIO_FIFO = 25;
export const IRQ_SIO_BELL = 26;
export const IRQ_SIO_MTIMECMP = 29;
export class Sio extends Device {
 constructor(m) {
 super(m, 'SIO');
 const o = (n) => this.r.off(n);
 this.o = { cpuid: o('CPUID'), in: o('GPIO_IN'), out: o('GPIO_OUT'), outSet: o('GPIO_OUT_SET'), outClr: o('GPIO_OUT_CLR'), outXor: o('GPIO_OUT_XOR'),
 oe: o('GPIO_OE'), oeSet: o('GPIO_OE_SET'), oeClr: o('GPIO_OE_CLR'), oeXor: o('GPIO_OE_XOR'), fifoSt: o('FIFO_ST'), fifoWr: o('FIFO_WR'),
 fifoRd: o('FIFO_RD'), lockSt: o('SPINLOCK_ST'), lock0: o('SPINLOCK0'), softirq: o('RISCV_SOFTIRQ'), mtimeCtrl: o('MTIME_CTRL'),
 mtime: o('MTIME'), mtimeh: o('MTIMEH'), cmp: o('MTIMECMP'), cmph: o('MTIMECMPH'), interp0: o('INTERP0_ACCUM0'),
 outSetBell: o('DOORBELL_OUT_SET'), outClrBell: o('DOORBELL_OUT_CLR'), inSetBell: o('DOORBELL_IN_SET'), inClrBell: o('DOORBELL_IN_CLR'),
 tmds: o('TMDS_CTRL') };
 this.reset();
 }
 reset() {
 if (this.m.ready && this.lines) for (const c of [0, 1]) { this.m.irqCore(c, IRQ_SIO_FIFO, 0); this.m.irqCore(c, IRQ_SIO_BELL, 0); }
 super.reset();
 this.gpioOut = 0; this.gpioOe = 0; this.locks = 0;
 this.fifos = [[], []];
 this.fifoFlags = [0, 0];
 this.bells = [0, 0];
 this.msip = 0; this.mtip = 0;
 this.lines = [0, 0];
 this.mtime = new RateCounter();
 this.cmp = [[0xffffffff, 0xffffffff], [0xffffffff, 0xffffffff]];
 if (this.m.ready) { this.retime(this.now); this.updateIrqs(); }
 }
 get core() { return this.m.hart.hartid; }
 retime(now) {
 const ctrl = this.r.get(this.o.mtimeCtrl);
 const rate = !(ctrl & 1) ? [0, 1] : (ctrl & 2) ? [1, 1] : this.m.ticks.rate(TICK.RISCV);
 this.mtime.setRate(now, rate[0], rate[1]);
 this.planTimer(now);
 }
 push(c, w) {
 const f = this.fifos[c];
 if (f.length >= FIFO_DEPTH) this.fifoFlags[c] |= 0x4; else f.push(w >>> 0);
 this.updateIrqs();
 }
 drain(c) { this.fifos[c].length = 0; this.updateIrqs(); }
 updateIrqs() {
 for (const c of [0, 1]) {
 const v = (this.fifos[1 - c].length > 0 || (this.fifoFlags[c] & 0xc) ? 1 : 0) | (this.bells[c] ? 2 : 0);
 const d = v ^ this.lines[c];
 if (!d) continue;
 this.lines[c] = v;
 if (d & 1) this.m.irqCore(c, IRQ_SIO_FIFO, v & 1);
 if (d & 2) this.m.irqCore(c, IRQ_SIO_BELL, (v >>> 1) & 1);
 }
 }
 read(off, addr) {
 const o = this.o, c = this.core;
 if (off >= o.lock0 && off < o.lock0 + 128) { const n = (off - o.lock0) >>> 2; if (this.locks & (1 << n)) return 0; this.locks = (this.locks | (1 << n)) >>> 0; return (1 << n) >>> 0; }
 if (off === o.fifoRd) {
 const f = this.fifos[1 - c];
 if (!f.length) { this.fifoFlags[c] |= 0x8; this.updateIrqs(); return 0; }
 const w = f.shift(); this.updateIrqs(); return w;
 }
 return super.read(off, addr);
 }
 readReg(off) {
 const o = this.o, now = this.now, c = this.core;
 switch (off) {
 case o.cpuid: return c;
 case o.in: return this.m.pins.inMask;
 case o.out: return this.gpioOut;
 case o.oe: return this.gpioOe;
 case o.fifoSt: return (this.fifos[1 - c].length ? 0x1 : 0) | (this.fifos[c].length < FIFO_DEPTH ? 0x2 : 0) | this.fifoFlags[c];
 case o.lockSt: return this.locks;
 case o.softirq: return this.msip;
 case o.mtime: return this.mtime.value(now) % TWO32;
 case o.mtimeh: return Math.floor(this.mtime.value(now) / TWO32) >>> 0;
 case o.cmp: return this.cmp[c][0];
 case o.cmph: return this.cmp[c][1];
 case o.outSetBell: case o.outClrBell: return this.bells[1 - c];
 case o.inSetBell: case o.inClrBell: return this.bells[c];
 default: return this.r.get(off);
 }
 }
 write(off, value, alias, addr, size, raw) {
 const o = this.o;
 if (off >= o.lock0 && off < o.lock0 + 128) { this.locks = (this.locks & ~(1 << ((off - o.lock0) >>> 2))) >>> 0; return; }
 super.write(off, value, alias, addr, size, raw);
 }
 onWrite(off, nv, old, value) {
 const o = this.o, now = this.now, c = this.core;
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
 case o.fifoSt: this.fifoFlags[c] = 0; this.updateIrqs(); return;
 case o.fifoWr:
 if (c === 0 && this.m.core1.parked && !this.m.core1.off) this.m.core1.receive(value);
 else this.push(c, value);
 return;
 case o.outSetBell: this.bells[1 - c] |= value & 0xff; this.updateIrqs(); return;
 case o.outClrBell: this.bells[1 - c] &= ~value & 0xff; this.updateIrqs(); return;
 case o.inSetBell: this.bells[c] |= value & 0xff; this.updateIrqs(); return;
 case o.inClrBell: this.bells[c] &= ~value & 0xff; this.updateIrqs(); return;
 case o.softirq: {
 const was = this.msip;
 this.msip = (this.msip & ~((value >>> 8) & 3) | (value & 3)) & 3;
 for (const k of [0, 1]) if (((was ^ this.msip) >>> k) & 1) this.m.coreIrq(k, IRQ.MSI, (this.msip >>> k) & 1);
 return;
 }
 case o.mtimeCtrl: this.retime(now); return;
 case o.mtime: this.mtime.setValue(now, Math.floor(this.mtime.value(now) / TWO32) * TWO32 + (value >>> 0)); this.planTimer(now); return;
 case o.mtimeh: this.mtime.setValue(now, (value >>> 0) * TWO32 + (this.mtime.value(now) % TWO32)); this.planTimer(now); return;
 case o.cmp: this.cmp[c][0] = value >>> 0; this.planTimer(now); return;
 case o.cmph: this.cmp[c][1] = value >>> 0; this.planTimer(now); return;
 default:
 if (off >= o.interp0 && off < o.lock0) this.m.diag('sioInterp');
 else if (off >= o.tmds) this.m.diag('sioTmds');
 return;
 }
 out >>>= 0; oe >>>= 0;
 const changed = ((out ^ this.gpioOut) | (oe ^ this.gpioOe)) & PIN_MASK;
 this.gpioOut = out; this.gpioOe = oe;
 if (changed) this.m.pins.updateMask(changed);
 }
 planTimer(now) {
 const t = this.mtime.value(now);
 let next = Infinity;
 for (const c of [0, 1]) {
 const cmp = this.cmp[c][1] * TWO32 + this.cmp[c][0], due = t >= cmp ? 1 : 0;
 if (due !== ((this.mtip >>> c) & 1)) {
 this.mtip = due ? this.mtip | (1 << c) : this.mtip & ~(1 << c);
 this.m.coreIrq(c, IRQ.MTI, due); this.m.irqCore(c, IRQ_SIO_MTIMECMP, due);
 }
 if (!due) { const k = this.mtime.cycleFor(now, cmp); if (k < next) next = k; }
 }
 this.next = next;
 this.m.schedule(this);
 }
 event(now) { this.planTimer(now); }
 save() {
 return { ...super.save(), gpioOut: this.gpioOut, gpioOe: this.gpioOe, locks: this.locks, fifos: this.fifos.map((f) => f.slice()), fifoFlags: this.fifoFlags.slice(),
 bells: this.bells.slice(), msip: this.msip, mtip: this.mtip, lines: this.lines.slice(), mtime: this.mtime.save(), cmp: this.cmp.map((x) => x.slice()) };
 }
 load(s) {
 super.load(s);
 ({ gpioOut: this.gpioOut, gpioOe: this.gpioOe, locks: this.locks, msip: this.msip, mtip: this.mtip } = s);
 this.fifos = s.fifos.map((f) => f.slice()); this.fifoFlags = s.fifoFlags.slice(); this.bells = s.bells.slice(); this.lines = s.lines.slice();
 this.cmp = s.cmp.map((x) => x.slice());
 this.mtime.load(s.mtime);
 }
}
