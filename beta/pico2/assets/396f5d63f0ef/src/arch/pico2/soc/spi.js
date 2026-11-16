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
 bitCycles() {
 const f = this.m.freq, cps = this.r.get(O_CPSR) & 0xfe, scr = (this.cr0 >>> 8) & 0xff;
 if (!f.peri || !f.sys || !cps) return 0;
 return (cps * (1 + scr) * f.sys) / f.peri;
 }
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
 if (this.csLow && (!sph || !this.tx.length)) { this.csLow = false; this.csPins(); }
 this.rtAt = now + Math.ceil(32 * this.bitCycles());
 this.kick(now);
 this.update();
 }
 exchange(out) {
 const p = this.m.pins, fn = (n) => p.ctrl[n] & 0x1f;
 const role = (pads, r) => pads.some((g) => fn(g) === F_SPI && (g & 3) === r && spiOfPin(g) === this.index);
 let inV = 0, who = null;
 if (this.m.kitOn) {
 for (const x of this.m.kit.modules) {
 if (x.bus !== 'spi') continue;
 const cs = (x.pins.CSB?.pads ?? []).find((g) => p.level[g] === 0);
 if (cs === undefined) continue;
 if (!role(x.pins.SCK.pads, 2) || !role(x.pins.SDI.pads, 3)) { this.m.diag('spiModulePins', x.id, x.name); continue; }
 if (!x.powered) { this.m.diag('moduleUnpowered', x.id, x.name); continue; }
 const reply = x.part.transfer(out) ?? 0;
 who = cs;
 if (role(x.pins.SDO.pads, 0)) inV = reply;
 }
 }
 this.logFrame(who, out, inV);
 return inV;
 }
 logFrame(cs, tx, rx) {
 this.log.push({ cycle: this.now, cs, tx, rx });
 if (this.log.length > LOG) this.log.splice(0, this.log.length - LOG);
 this.m.onBus?.('spi', this.index, { cs, tx, rx });
 }
 pinLevel(n, level) {
 if (this.index !== 0) return;
 for (const x of this.m.kit?.modules ?? []) if (x.bus === 'spi' && (x.pins.CSB?.pads ?? []).includes(n)) x.part.select(level === 0);
 }
 csPins() {
 const p = this.m.pins; if (!p) return;
 for (let n = 0; n < 30; n++) if ((p.ctrl[n] & 0x1f) === F_SPI && (n & 3) === 1 && spiOfPin(n) === this.index) p.update(n);
 }
 pinOut(n) {
 const role = n & 3, master = !(this.cr1 & CR1_MS);
 if (role === 0 || !master) return [0, 0];
 if (role === 1) return [this.csLow ? 0 : 1, 1];
 if (role === 2) return [(this.cr0 >>> 6) & 1, 1];
 return [0, 1];
 }
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
 const v = (alias === 0 ? value : (this.read(off) ^ value)) & 0xffff;
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
