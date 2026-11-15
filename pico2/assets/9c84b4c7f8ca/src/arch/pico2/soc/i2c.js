// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
const PAD_PUE = 0x8;
export const F_I2C = 3;
export const i2cOfPin = (n) => (n >>> 1) & 1;
const FIFO = 16, LOG = 256;
const O = { CON: 0x0, TAR: 0x4, SAR: 0x8, DATA_CMD: 0x10, SS_HCNT: 0x14, SS_LCNT: 0x18, FS_HCNT: 0x1c, FS_LCNT: 0x20, INTR_STAT: 0x2c, INTR_MASK: 0x30,
 RAW: 0x34, RX_TL: 0x38, TX_TL: 0x3c, CLR_INTR: 0x40, ENABLE: 0x6c, STATUS: 0x70, TXFLR: 0x74, RXFLR: 0x78, ABRT: 0x80, DMA_CR: 0x88, TDLR: 0x8c,
 RDLR: 0x90, EN_STATUS: 0x9c, SPKLEN: 0xa0, CLR_RESTART: 0xa8 };
const RX_UNDER = 1, RX_OVER = 2, RX_FULL = 4, TX_OVER = 8, TX_EMPTY = 0x10, RD_REQ = 0x20, TX_ABRT = 0x40, RX_DONE = 0x80, ACTIVITY = 0x100,
 STOP_DET = 0x200, START_DET = 0x400, GEN_CALL = 0x800, RESTART_DET = 0x1000;
const CLR = new Map([[0x44, RX_UNDER], [0x48, RX_OVER], [0x4c, TX_OVER], [0x50, RD_REQ], [0x54, TX_ABRT], [0x58, RX_DONE], [0x5c, ACTIVITY], [0x60, STOP_DET],
 [0x64, START_DET], [0x68, GEN_CALL], [0xa8, RESTART_DET]]);
const ABRT_7B_ADDR_NOACK = 1, ABRT_TXDATA_NOACK = 8, ABRT_USER_ABRT = 1 << 16;
const CON_MASTER = 1, CON_10BIT_MASTER = 0x10, CON_RESTART_EN = 0x20, CON_SLAVE_DISABLE = 0x40, CON_TX_EMPTY_CTRL = 0x100;
export class I2c extends Device {
 constructor(m, index) {
 super(m, `I2C${index}`, { regs: 'I2C0', resetBit: 4 + index });
 this.index = index; this.irqNum = 36 + index;
 this.log = []; this.bytes = 0;
 this.reset();
 }
 reset() {
 if (this.line && this.m.ready) this.m.irq(this.irqNum, 0);
 super.reset();
 this.tx = []; this.rx = []; this.raw = 0; this.abrt = 0; this.flush = false; this.line = 0;
 this.bus = null;
 this.phase = null;
 this.firstRead = false;
 }
 get con() { return this.r.get(O.CON); }
 get enabled() { return (this.r.get(O.ENABLE) & 1) === 1; }
 get active() { return this.enabled || this.bus !== null || this.phase !== null; }
 period() {
 const fast = ((this.con >>> 1) & 3) !== 1, sp = this.r.get(O.SPKLEN) & 0xff;
 const h = this.r.get(fast ? O.FS_HCNT : O.SS_HCNT) & 0xffff, l = this.r.get(fast ? O.FS_LCNT : O.SS_LCNT) & 0xffff;
 return h + sp + 7 + l + 1;
 }
 kick(c) {
 if (this.phase || !this.active || !this.tx.length || (this.r.get(O.ENABLE) & 4)) return;
 if (!(this.con & CON_MASTER) || !(this.con & CON_SLAVE_DISABLE)) { this.m.diag('i2cSlave', this.name); return; }
 if (this.con & CON_10BIT_MASTER) this.m.diag('i2c10bit', this.name);
 const cmd = this.tx.shift(), P = this.period();
 let periods = 9;
 const read = (cmd & 0x100) !== 0;
 if (!this.bus || (cmd & 0x400) || this.bus.read !== read) {
 const restart = !!this.bus;
 if (restart) { this.logEnd(); this.raw |= RESTART_DET; }
 this.raw |= START_DET | ACTIVITY;
 const addr = this.r.get(O.TAR) & 0x7f;
 const part = this.find(addr);
 const ack = part ? part.start(read) !== false : false;
 this.bus = { addr, read, bytes: [], ack, part, cycle: c };
 periods += 10;
 if (!ack) { this.phase = { kind: 'nack', end: c + P * 10, cmd }; this.next = this.phase.end; this.m.schedule(this); this.update(); return; }
 this.firstRead = read;
 }
 this.phase = { kind: 'byte', end: c + P * periods, cmd };
 this.next = this.phase.end; this.m.schedule(this);
 this.update();
 }
 find(addr) {
 if (!this.m.kitOn) return null;
 const p = this.m.pins, fn = (n) => p.ctrl[n] & 0x1f;
 const mine = (pads, odd) => pads.find((g) => fn(g) === F_I2C && (g & 1) === odd && ((g >>> 1) & 1) === this.index);
 for (const x of this.m.kit.modules) {
 if (x.bus !== 'i2c' || x.part.address !== addr) continue;
 const sda = mine(x.pins.SDA.pads, 0), scl = mine(x.pins.SCL.pads, 1);
 if (sda === undefined || scl === undefined) {
 if (x.pins.SDA.pads.length && x.pins.SCL.pads.length) this.m.diag('i2cKitPins', this.name, x.pins.SDA.pads[0], x.pins.SCL.pads[0]);
 continue;
 }
 if (!x.powered) { this.m.diag('moduleUnpowered', x.id, x.name); continue; }
 const pulled = (info, g) => info.pullUp || (p.pad[g] & PAD_PUE) !== 0;
 if (!pulled(x.pins.SDA, sda) || !pulled(x.pins.SCL, scl)) { this.m.diag('moduleNoPullUp', x.id, x.name); continue; }
 return x.part;
 }
 return null;
 }
 event(now) {
 const ph = this.phase;
 if (!ph || now < ph.end) { this.next = ph ? ph.end : Infinity; return; }
 this.phase = null;
 if (ph.kind === 'stop') { this.stopDone(); }
 else if (ph.kind === 'nack') this.abort(ABRT_7B_ADDR_NOACK, now);
 else {
 const cmd = ph.cmd, b = this.bus;
 if (b.read) {
 const v = b.part ? (b.part.read() ?? 0xff) & 0xff : 0xff;
 b.bytes.push(v); this.bytes++;
 if (this.rx.length >= FIFO) this.raw |= RX_OVER; else this.rx.push(v | (this.firstRead ? 0x800 : 0));
 this.firstRead = false;
 } else {
 const v = cmd & 0xff, ack = b.part ? b.part.write(v) !== false : false;
 b.bytes.push(v); this.bytes++;
 if (!ack) { b.ack = false; this.abort(ABRT_TXDATA_NOACK, now); this.update(); return; }
 }
 if (cmd & 0x200) this.startStop(now);
 }
 if (!this.phase) this.kick(now);
 this.next = this.phase ? this.phase.end : Infinity;
 this.update();
 }
 startStop(c) { this.phase = { kind: 'stop', end: c + this.period(), cmd: 0 }; this.next = this.phase.end; this.m.schedule(this); }
 stopDone() {
 if (this.bus) { this.bus.part?.stop(); this.logEnd(); }
 this.bus = null; this.raw |= STOP_DET;
 if (this.r.get(O.ENABLE) & 2) this.r.set(O.ENABLE, this.r.get(O.ENABLE) & ~2);
 }
 abort(src, c) {
 this.abrt = (src | (Math.min(this.tx.length, 0x1ff) << 23)) >>> 0;
 this.tx = []; this.flush = true; this.raw |= TX_ABRT;
 if (this.bus) this.bus.ack = this.bus.ack && src !== ABRT_7B_ADDR_NOACK;
 this.startStop(c);
 }
 logEnd() {
 const b = this.bus;
 if (!b) return;
 const e = { cycle: b.cycle, addr: b.addr, read: b.read, ack: b.ack, bytes: b.bytes.slice() };
 this.log.push(e);
 if (this.log.length > LOG) this.log.splice(0, this.log.length - LOG);
 this.m.onBus?.('i2c', this.index, e);
 }
 rawIrq() {
 let v = this.raw & ~(RX_FULL | TX_EMPTY);
 if (this.rx.length > (this.r.get(O.RX_TL) & 0xff)) v |= RX_FULL;
 const txe = this.active && this.tx.length <= (this.r.get(O.TX_TL) & 0xff) && (!(this.con & CON_TX_EMPTY_CTRL) || !this.phase || this.phase.kind === 'stop');
 if (txe) v |= TX_EMPTY;
 return v;
 }
 read(off, addr) {
 if (this.heldFlag) return super.read(off, addr);
 if (off === O.DATA_CMD) {
 if (!this.rx.length) { this.raw |= RX_UNDER; this.update(); return 0; }
 const v = this.rx.shift(); this.update(); return v & 0xfff;
 }
 if (off === O.CLR_INTR) { this.raw &= ~(RX_UNDER | RX_OVER | TX_OVER | RD_REQ | TX_ABRT | RX_DONE | ACTIVITY | STOP_DET | START_DET | GEN_CALL | RESTART_DET); this.clearAbort(); this.update(); return 0; }
 const bit = CLR.get(off);
 if (bit !== undefined) { this.raw &= ~bit; if (bit === TX_ABRT) this.clearAbort(); if (bit === ACTIVITY && (this.bus || this.phase)) this.raw |= ACTIVITY; this.update(); return 0; }
 return super.read(off, addr);
 }
 clearAbort() { this.abrt = 0; this.flush = false; this.kick(this.now); }
 readReg(off) {
 switch (off) {
 case O.RAW: return this.rawIrq();
 case O.INTR_STAT: return this.rawIrq() & this.r.get(O.INTR_MASK);
 case O.STATUS: {
 const t = this.tx.length, r = this.rx.length, act = this.bus || this.phase ? 1 : 0;
 return act | (t < FIFO ? 2 : 0) | (t === 0 ? 4 : 0) | (r > 0 ? 8 : 0) | (r >= FIFO ? 0x10 : 0) | (act << 5);
 }
 case O.TXFLR: return this.tx.length;
 case O.RXFLR: return this.rx.length;
 case O.ABRT: return this.abrt;
 case O.EN_STATUS: return this.active ? 1 : 0;
 default: return this.r.get(off);
 }
 }
 write(off, value, alias, addr, size, raw) {
 if (!this.heldFlag && off === O.DATA_CMD) {
 const v = alias === 0 ? value : (this.read(off) ^ value);
 if (!this.active) { this.m.diag('i2cDisabled', this.name); return; }
 if (this.flush) { this.abrt = ((this.abrt & 0x7fffff) | ((Math.min(0x1ff, (this.abrt >>> 23) + 1)) << 23)) >>> 0; return; }
 if (this.tx.length >= FIFO) { this.raw |= TX_OVER; this.update(); return; }
 this.tx.push(v & 0x7ff);
 this.kick(this.now); this.update();
 return;
 }
 super.write(off, value, alias, addr, size, raw);
 }
 onWrite(off, nv, old) {
 if (off === O.ENABLE) {
 if (!(nv & 1) && (old & 1) && !this.bus && !this.phase) { this.tx = []; this.rx = []; }
 if ((nv & 2) && !(old & 2)) {
 if (this.bus || this.tx.length) { this.phase = null; this.abort(ABRT_USER_ABRT, this.now); } else this.r.set(O.ENABLE, nv & ~2);
 }
 this.kick(this.now);
 }
 if (off === O.TAR && (nv & 0xc00)) this.m.diag('i2cGeneralCall', this.name);
 this.update();
 }
 update() {
 const v = (this.rawIrq() & this.r.get(O.INTR_MASK)) ? 1 : 0;
 if (v !== this.line) { this.line = v; this.m.irq(this.irqNum, v); }
 this.m.dma?.levelChanged(44 + 2 * this.index); this.m.dma?.levelChanged(45 + 2 * this.index);
 }
 dreq(rx) {
 if (this.heldFlag) return false;
 const d = this.r.get(O.DMA_CR);
 return rx ? (d & 1) !== 0 && this.rx.length >= (this.r.get(O.RDLR) & 0xf) + 1 : (d & 2) !== 0 && this.enabled && !this.flush && this.tx.length <= (this.r.get(O.TDLR) & 0xf);
 }
 view() {
 const P = this.period(), f = this.m.freq;
 return { index: this.index, enabled: this.enabled, master: (this.con & CON_MASTER) !== 0, speed: ((this.con >>> 1) & 3) === 1 ? 'standard' : 'fast', tar: this.r.get(O.TAR) & 0x3ff,
 baud: P && f.sys ? f.sys / P : 0, tx: this.tx.slice(), rx: this.rx.map((v) => v & 0xff), raw: this.rawIrq(), mask: this.r.get(O.INTR_MASK), abrt: this.abrt,
 busy: !!(this.bus || this.phase), bytes: this.bytes, log: this.log.slice(-32) };
 }
 save() {
 const b = this.bus ? { ...this.bus, bytes: this.bus.bytes.slice(), part: this.bus.part ? this.m.kit.all.indexOf(this.bus.part) : -1 } : null;
 return { ...super.save(), tx: this.tx.slice(), rx: this.rx.slice(), raw: this.raw, abrt: this.abrt, flush: this.flush, line: this.line, bus: b,
 phase: this.phase ? { ...this.phase } : null, firstRead: this.firstRead, bytes: this.bytes };
 }
 load(s) {
 super.load(s); this.tx = s.tx.slice(); this.rx = s.rx.slice(); this.raw = s.raw; this.abrt = s.abrt; this.flush = s.flush; this.line = s.line;
 this.bus = s.bus ? { ...s.bus, bytes: s.bus.bytes.slice(), part: s.bus.part >= 0 ? this.m.kit.all[s.bus.part] : null } : null;
 this.phase = s.phase ? { ...s.phase } : null; this.firstRead = s.firstRead; this.bytes = s.bytes;
 }
}
