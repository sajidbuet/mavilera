// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
export const GPIO_BASE = 0x40000000;
export const TIMER_BASE = 0x40001000;
export const UART_BASE = 0x40002000;
export const PERIPH_LO = 0x40000000;
export const PERIPH_SIZE = 0x10000000;
export const BUTTON_BIT = 8;
const MASK64 = (1n << 64n) - 1n;
const M32 = 0xffffffffn;
const NO_EVENTS = Object.freeze({ open() {}, ack() {} });
class Base extends Device {
 constructor(o) {
 super({ widths: [4], ...o });
 this.now = 0;
 this.events = NO_EVENTS;
 }
}
export class PeripheralWindow extends Base {
 constructor() {
 super({ name: 'periph', size: PERIPH_SIZE });
 this.window = true;
 }
 peek() { return 0; }
}
export class Gpio extends Base {
 constructor({ stimulus = [] } = {}) {
 super({
 name: 'GPIO',
 registers: [
 { offset: 0x00, name: 'OUT', width: 32, access: 'rw' }, { offset: 0x04, name: 'IN', width: 32, access: 'ro' },
 { offset: 0x08, name: 'DIR', width: 32, access: 'rw' }, { offset: 0x0c, name: 'OUT_SET', width: 32, access: 'wo' },
 { offset: 0x10, name: 'OUT_CLR', width: 32, access: 'wo' }, { offset: 0x14, name: 'OUT_TGL', width: 32, access: 'wo' },
 { offset: 0x18, name: 'IRQ_EN', width: 32, access: 'rw' }, { offset: 0x1c, name: 'IRQ_PEND', width: 32, access: 'w1c' },
 ],
 });
 this.stim = stimulus.map((s) => ({ ...s }));
 this.reset();
 }
 reset() {
 this.out = 0; this.dir = 0; this.inp = 0; this.irqEn = 0; this.irqPend = 0;
 this.si = 0;
 this.now = 0;
 }
 static source(bit) { return bit === BUTTON_BIT ? 'button' : `gpio${bit}`; }
 irq() { return (this.irqPend & this.irqEn) !== 0; }
 peek(offset) {
 switch (offset) {
 case 0x00: return this.out >>> 0;
 case 0x04: return this.inp >>> 0;
 case 0x08: return this.dir >>> 0;
 case 0x18: return this.irqEn >>> 0;
 case 0x1c: return this.irqPend >>> 0;
 default: return 0;
 }
 }
 write(offset, size, value, ctx) {
 const v = value >>> 0;
 this.touch();
 switch (offset) {
 case 0x00: this.out = v; break;
 case 0x08: this.dir = v; break;
 case 0x0c: this.out = (this.out | v) >>> 0; break;
 case 0x10: this.out = (this.out & ~v) >>> 0; break;
 case 0x14: this.out = (this.out ^ v) >>> 0; break;
 case 0x18: {
 const newly = v & ~this.irqEn & this.irqPend;
 this.irqEn = v;
 for (let b = 0; b < 32; b++) if ((newly >>> b) & 1) this.events.open(Gpio.source(b), ctx.cycle);
 break;
 }
 case 0x1c: {
 const cleared = v & this.irqPend;
 this.irqPend = (this.irqPend & ~v) >>> 0;
 for (let b = 0; b < 32; b++) if ((cleared >>> b) & 1) this.events.ack(Gpio.source(b), ctx.cycle);
 break;
 }
 default: break;
 }
 this.emit();
 }
 tick(cycle) {
 while (this.si < this.stim.length && this.stim[this.si].cycle <= cycle) {
 this.touch();
 const { cycle: at, mask, value } = this.stim[this.si++];
 const next = ((this.inp & ~mask) | value) >>> 0;
 const rising = (next & ~this.inp) >>> 0;
 this.inp = next;
 for (let b = 0; b < 32; b++) {
 if (((rising >>> b) & 1) && !((this.irqPend >>> b) & 1)) {
 this.irqPend = (this.irqPend | (1 << b)) >>> 0;
 if ((this.irqEn >>> b) & 1) this.events.open(Gpio.source(b), at);
 }
 }
 this.emit();
 }
 this.now = cycle;
 }
 setPins(mask, value, cycle = this.now) {
 let i = this.stim.length;
 while (i > this.si && this.stim[i - 1].cycle > cycle) i--;
 const ev = { cycle, mask: mask >>> 0, value: value >>> 0 };
 this.stim.splice(i, 0, ev);
 this.tick(Math.max(cycle, this.now));
 return ev;
 }
 nextEvent() { return this.si < this.stim.length ? this.stim[this.si].cycle : null; }
 snapshot() { return { out: this.out, dir: this.dir, inp: this.inp, irqEn: this.irqEn, irqPend: this.irqPend, si: this.si }; }
 restore(s) { Object.assign(this, s); }
}
export class Timer extends Base {
 constructor({ div = 1 } = {}) {
 super({
 name: 'TIMER',
 registers: [
 { offset: 0x00, name: 'MTIME', width: 32, access: 'rw' }, { offset: 0x04, name: 'MTIMEH', width: 32, access: 'rw' },
 { offset: 0x08, name: 'MTIMECMP', width: 32, access: 'rw' }, { offset: 0x0c, name: 'MTIMECMPH', width: 32, access: 'rw' },
 ],
 });
 if (!(Number.isInteger(div) && div >= 1)) throw new Error('the MTIME divider must be at least 1');
 this.div = BigInt(div);
 this.reset();
 }
 reset() {
 this.off = 0n;
 this.cmp = MASK64;
 this.cmpWritten = 0;
 this.timerWas = false;
 this.now = 0;
 }
 mtime(cycle = this.now) { return (BigInt(cycle) / this.div + this.off) & MASK64; }
 mtip(cycle = this.now) { return this.mtime(cycle) >= this.cmp; }
 irq() { return this.mtip(); }
 peek(offset) {
 switch (offset) {
 case 0x00: return Number(this.mtime() & M32);
 case 0x04: return Number(this.mtime() >> 32n);
 case 0x08: return Number(this.cmp & M32);
 case 0x0c: return Number(this.cmp >> 32n);
 default: return 0;
 }
 }
 write(offset, size, value, ctx) {
 const v = BigInt(value >>> 0);
 const done = ctx.cycle;
 this.touch();
 if (offset === 0x00 || offset === 0x04) {
 let t = this.mtime(done);
 t = offset === 0 ? (t & ~M32 & MASK64) | v : (t & M32) | (v << 32n);
 this.off = t - BigInt(done) / this.div;
 } else if (offset === 0x08 || offset === 0x0c) {
 this.cmp = offset === 0x08 ? (this.cmp & ~M32 & MASK64) | v : (this.cmp & M32) | (v << 32n);
 this.cmpWritten = done;
 }
 if (!this.mtip(done)) {
 this.events.ack('timer', done);
 this.timerWas = false;
 }
 this.emit();
 }
 tick(cycle) {
 const tip = this.mtip(cycle);
 if (tip && !this.timerWas) {
 this.touch();
 const reach = (this.cmp - this.off) * this.div;
 const at = [BigInt(cycle), [reach > 0n ? reach : 0n, BigInt(this.cmpWritten), BigInt(this.now)].reduce((a, b) => (a > b ? a : b))]
 .reduce((a, b) => (a < b ? a : b));
 this.events.open('timer', Number(at));
 }
 if (tip !== this.timerWas) { this.touch(); this.timerWas = tip; this.emit(); }
 this.now = cycle;
 }
 nextEvent() {
 if (this.mtip() || this.cmp === MASK64) return null;
 const at = (this.cmp - this.off) * this.div;
 return Number(at > BigInt(this.now + 1) ? at : BigInt(this.now + 1));
 }
 snapshot() { return { off: this.off, cmp: this.cmp, cmpWritten: this.cmpWritten, timerWas: this.timerWas }; }
 restore(s) { Object.assign(this, s); }
}
export const UART_STATUS = Object.freeze({ TXRDY: 1, RXVALID: 2, TXOVR: 4, RXOVR: 8 });
export const UART_CTRL = Object.freeze({ RXIE: 1, TXIE: 2 });
export const UART_FIFO = 8;
export class Uart extends Base {
 constructor({ txCycles = 4, rx = [] } = {}) {
 super({
 name: 'UART',
 registers: [
 { offset: 0x00, name: 'TXDATA', width: 8, access: 'wo' }, { offset: 0x04, name: 'RXDATA', width: 8, access: 'ro' },
 { offset: 0x08, name: 'STATUS', width: 4, access: 'w1c' }, { offset: 0x0c, name: 'CTRL', width: 2, access: 'rw' },
 ],
 });
 this.txCycles = txCycles;
 this.rxStim = rx.map((s) => ({ ...s }));
 this.reset();
 }
 reset() {
 this.tx = [];
 this.busyUntil = 0;
 this.rxFifo = [];
 this.rxi = 0;
 this.ctrl = 0;
 this.flags = 0;
 this.irqWas = false;
 this.now = 0;
 }
 txReady(cycle = this.now) { return cycle >= this.busyUntil; }
 irq() {
 return ((this.ctrl & UART_CTRL.RXIE) !== 0 && this.rxFifo.length > 0) || ((this.ctrl & UART_CTRL.TXIE) !== 0 && this.txReady());
 }
 status() {
 return (this.txReady() ? UART_STATUS.TXRDY : 0) | (this.rxFifo.length ? UART_STATUS.RXVALID : 0) | this.flags;
 }
 peek(offset) {
 switch (offset) {
 case 0x04: return this.rxFifo.length ? this.rxFifo[0] : 0;
 case 0x08: return this.status();
 case 0x0c: return this.ctrl;
 default: return 0;
 }
 }
 read(offset, size, ctx) {
 if (offset !== 0x04) return this.peek(offset);
 this.touch();
 const b = this.rxFifo.length ? this.rxFifo.shift() : 0;
 this.sync(ctx.cycle);
 this.emit();
 return b;
 }
 write(offset, size, value, ctx) {
 this.touch();
 if (offset === 0x00) {
 if (this.txReady(ctx.cycle)) {
 this.tx.push(value & 0xff);
 this.busyUntil = ctx.cycle + this.txCycles;
 } else {
 this.flags |= UART_STATUS.TXOVR;
 }
 } else if (offset === 0x08) {
 this.flags &= ~(value & (UART_STATUS.TXOVR | UART_STATUS.RXOVR));
 } else if (offset === 0x0c) {
 this.ctrl = value & (UART_CTRL.RXIE | UART_CTRL.TXIE);
 } else {
 return;
 }
 this.sync(ctx.cycle);
 this.emit();
 }
 sync(cycle) {
 const lvl = this.irq();
 if (lvl !== this.irqWas) {
 this.irqWas = lvl;
 if (lvl) this.events.open('uart', cycle);
 else this.events.ack('uart', cycle);
 }
 }
 receive(byte, cycle = this.now) {
 let i = this.rxStim.length;
 while (i > this.rxi && this.rxStim[i - 1].cycle > cycle) i--;
 const ev = { cycle, byte: byte & 0xff };
 this.rxStim.splice(i, 0, ev);
 this.tick(Math.max(cycle, this.now));
 return ev;
 }
 tick(cycle) {
 while (this.rxi < this.rxStim.length && this.rxStim[this.rxi].cycle <= cycle) {
 this.touch();
 const { cycle: at, byte } = this.rxStim[this.rxi++];
 if (this.rxFifo.length >= UART_FIFO) this.flags |= UART_STATUS.RXOVR;
 else this.rxFifo.push(byte);
 this.sync(at);
 this.emit();
 }
 const prev = this.now;
 this.now = cycle;
 if (this.irq() !== this.irqWas) {
 this.touch();
 this.sync(Math.min(cycle, Math.max(this.busyUntil, prev)));
 }
 }
 nextEvent() {
 const c = [];
 if (this.rxi < this.rxStim.length) c.push(this.rxStim[this.rxi].cycle);
 if ((this.ctrl & UART_CTRL.TXIE) && !this.txReady()) c.push(this.busyUntil);
 return c.length ? Math.min(...c) : null;
 }
 snapshot() {
 return { txLen: this.tx.length, busyUntil: this.busyUntil, rxFifo: this.rxFifo.slice(), rxi: this.rxi, ctrl: this.ctrl, flags: this.flags, irqWas: this.irqWas };
 }
 restore(s) {
 this.tx.length = s.txLen;
 Object.assign(this, { busyUntil: s.busyUntil, rxFifo: s.rxFifo.slice(), rxi: s.rxi, ctrl: s.ctrl, flags: s.flags, irqWas: s.irqWas });
 }
}
