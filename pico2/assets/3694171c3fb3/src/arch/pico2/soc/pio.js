// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
export const F_PIO0 = 6;
const NB = 3, NSM = 4;
const O_CTRL = 0x0, O_FSTAT = 0x4, O_FDEBUG = 0x8, O_FLEVEL = 0xc, O_TXF = 0x10, O_RXF = 0x20, O_IRQ = 0x30, O_IRQ_FORCE = 0x34, O_SYNC = 0x38,
 O_PADOUT = 0x3c, O_PADOE = 0x40, O_CFGINFO = 0x44, O_IMEM = 0x48, O_SM = 0xc8, SM_STRIDE = 0x18, O_PUTGET = 0x128, O_GPIOBASE = 0x168, O_INTR = 0x16c,
 O_INTE0 = 0x170, O_INTF0 = 0x174, O_INTS0 = 0x178, O_INTE1 = 0x17c, O_INTF1 = 0x180, O_INTS1 = 0x184;
const R_CLKDIV = 0, R_EXEC = 4, R_SHIFT = 8, R_ADDR = 0xc, R_INSTR = 0x10, R_PIN = 0x14;
const rev32 = (v) => { v = ((v >>> 1) & 0x55555555) | ((v & 0x55555555) << 1); v = ((v >>> 2) & 0x33333333) | ((v & 0x33333333) << 2);
 v = ((v >>> 4) & 0x0f0f0f0f) | ((v & 0x0f0f0f0f) << 4); v = ((v >>> 8) & 0x00ff00ff) | ((v & 0x00ff00ff) << 8); return ((v >>> 16) | (v << 16)) >>> 0; };
const mask = (n) => (n >= 32 ? 0xffffffff : ((1 << n) - 1) >>> 0);
const rotl = (v, s) => (s & 31 ? ((v << (s & 31)) | (v >>> (32 - (s & 31)))) >>> 0 : v >>> 0);
const rotr = (v, s) => (s & 31 ? ((v >>> (s & 31)) | (v << (32 - (s & 31)))) >>> 0 : v >>> 0);
export const STALL = Object.freeze({ NONE: 0, WAIT: 1, IRQ_WAIT: 2, PULL: 3, PUSH: 4, OUT: 5, IN: 6, EXEC: 7 });
class Sm {
 constructor(b, i) { this.b = b; this.i = i; this.clear(); }
 clear() {
 this.pc = 0; this.x = 0; this.y = 0; this.isr = 0; this.osr = 0; this.isrN = 0; this.osrN = 32;
 this.tx = []; this.rx = []; this.put = [0, 0, 0, 0];
 this.wait = 0;
 this.en0 = 0;
 this.d0 = 0;
 this.latch = -1;
 this.forced = false;
 this.stall = STALL.NONE; this.retry = false; this.irqWaiting = false;
 this.next = Infinity;
 this.executed = 0;
 this.ff = null;
 this.nextK = 0;
 this.n = 1; this.f = 0; this.on = false; this.ex = 0x1f000; this.sh = 0xc0000; this.pcf = 0x14000000;
 }
 save() {
 return [this.pc, this.x, this.y, this.isr, this.osr, this.isrN, this.osrN, this.tx.slice(), this.rx.slice(), this.put.slice(), this.wait, this.en0, this.d0, this.latch,
 this.forced ? 1 : 0, this.stall, this.retry ? 1 : 0, this.irqWaiting ? 1 : 0, this.next, this.executed, this.ff ? { ...this.ff } : null, this.nextK];
 }
 load(s) {
 let f, r, w;
 [this.pc, this.x, this.y, this.isr, this.osr, this.isrN, this.osrN, this.tx, this.rx, this.put, this.wait, this.en0, this.d0, this.latch, f, this.stall, r, w, this.next, this.executed, this.ff, this.nextK] = s;
 this.ff = this.ff ? { ...this.ff } : null;
 this.tx = this.tx.slice(); this.rx = this.rx.slice(); this.put = this.put.slice();
 this.forced = f === 1; this.retry = r === 1; this.irqWaiting = w === 1;
 }
}
class Block {
 constructor(pio, index) {
 this.pio = pio; this.index = index;
 this.sm = Array.from({ length: NSM }, (_, i) => new Sm(this, i));
 this.clear();
 }
 clear() {
 this.imem = new Uint16Array(32); this.flags = 0; this.padOut = 0; this.padOe = 0; this.lines = 0; this.sync = 0;
 for (const s of this.sm) s.clear();
 }
}
export class Pio {
 constructor(m) {
 this.m = m;
 this.next = Infinity;
 this.blocks = Array.from({ length: NB }, (_, i) => new Block(this, i));
 this.dev = this.blocks.map((b) => new PioBlockDevice(this, b));
 this.hc = new Float64Array(30 * 8); this.hv = new Uint8Array(30 * 8); this.hb = new Uint8Array(30 * 8); this.hn = new Uint8Array(30); this.hh = new Uint8Array(30);
 this.cyclePend = null;
 this.steps = 0; this.anyPinWait = false;
 }
 reset() { this.hn.fill(0); this.hh.fill(0); this.cyclePend = null; this.steps = 0; this.anyPinWait = false; this.next = Infinity; }
 save() { return { hc: Array.from(this.hc), hv: Array.from(this.hv), hb: Array.from(this.hb), hn: Array.from(this.hn), hh: Array.from(this.hh), steps: this.steps, anyPinWait: this.anyPinWait, next: this.next }; }
 load(s) {
 this.hc.set(s.hc); this.hv.set(s.hv); this.hb.set(s.hb); this.hn.set(s.hn); this.hh.set(s.hh);
 this.steps = s.steps; this.anyPinWait = s.anyPinWait; this.next = s.next;
 }
 div(b, s) { return [s.n, s.f]; }
 enCycle(b, s, k) { return s.d0 + k * s.n + (s.f ? Math.floor((k * s.f) / 256) : 0); }
 enAt(b, s, c) {
 if (c <= s.d0) return 0;
 const n = s.n, f = s.f;
 if (!f) return Math.floor((c - s.d0) / n);
 let k = Math.floor(((c - s.d0) * 256) / (256 * n + f));
 while (this.enCycle(b, s, k + 1) <= c) k++;
 while (k > 0 && this.enCycle(b, s, k) > c) k--;
 return k;
 }
 enabled(b, s) { return s.on; }
 sched(b, s, k) { s.nextK = k; s.next = this.enCycle(b, s, k); }
 plan(b, s, c = this.m.now) {
 if (!this.enabled(b, s) || (s.stall !== STALL.NONE && !s.woken)) s.next = Infinity;
 else this.sched(b, s, Math.max(s.en0 + s.wait + 1, this.enAt(b, s, c) + 1));
 this.replan();
 }
 replan() {
 let n = Infinity;
 for (const b of this.blocks) for (const s of b.sm) if (s.next < n) n = s.next;
 this.next = n;
 this.m.schedule(this);
 }
 wake(b, s, from = this.m.now + 1) {
 if (!this.enabled(b, s)) return;
 if (s.stall === STALL.NONE && (s.wait === 0 || !this.wantsPull(b, s))) return;
 s.woken = true;
 const k = Math.max(this.enAt(b, s, from - 1) + 1, s.en0 + 1);
 const t = this.enCycle(b, s, k);
 if (t < s.next) { s.next = t; s.nextK = k; }
 this.replan();
 }
 wantsPull(b, s) { const sh = s.sh; return (sh & (1 << 17)) !== 0 && s.osrN >= (((sh >>> 25) & 0x1f) || 32); }
 wakeIf(pred) { for (const b of this.blocks) for (const s of b.sm) if (s.stall !== STALL.NONE && pred(s)) this.wake(b, s); }
 inputChanged(n, v, c) {
 if (n >= 30) return;
 const base = n * 8, head = this.hh[n], cnt = this.hn[n];
 const before = cnt ? this.hv[base + ((head + 7) & 7)] : v ? 0 : 1;
 this.hc[base + head] = c; this.hv[base + head] = v; this.hb[base + head] = before;
 this.hh[n] = (head + 1) & 7; if (cnt < 8) this.hn[n] = cnt + 1;
 if (this.anyPinWait) for (const b of this.blocks) { const t = c + ((b.sync >>> n) & 1 ? 1 : 2); for (const s of b.sm) if (s.stall === STALL.WAIT) this.wake(b, s, t); }
 }
 pinAt(b, n, c) {
 n &= 31;
 if (n >= 30) return 0;
 const t = (b.sync >>> n) & 1 ? c : c - 2, base = n * 8, cnt = this.hn[n];
 let i = this.hh[n];
 for (let j = 0; j < cnt; j++) { i = (i + 7) & 7; if (this.hc[base + i] <= t) return this.hv[base + i]; }
 return cnt ? this.hb[base + i] : this.m.pins.input[n];
 }
 pinsAt(b, base, count, c) { let v = 0; for (let i = 0; i < count; i++) v |= this.pinAt(b, base + i, c) << i; return v >>> 0; }
 outWrite(b, dir, msk, val) {
 if (!msk) return;
 const old = dir ? b.padOe : b.padOut, nv = ((old & ~msk) | (val & msk)) >>> 0;
 if (nv === old) return;
 if (dir) b.padOe = nv; else b.padOut = nv;
 const ch = (old ^ nv) & 0x3fffffff, p = this.m.pins, f = F_PIO0 + b.index;
 let rest = ch;
 while (rest) { const n = 31 - Math.clz32(rest & -rest); rest &= rest - 1; if ((p.ctrl[n] & 0x1f) === f) p.update(n); }
 }
 pinOut(n, block) { const b = this.blocks[block]; return [(b.padOut >>> n) & 1, (b.padOe >>> n) & 1]; }
 mapped(base, count, data) {
 if (!count) return [0, 0];
 const m = mask(count);
 return [rotl(m, base), rotl((data & m) >>> 0, base)];
 }
 irqTarget(b, s, idx) {
 const mode = (idx >>> 3) & 3, k = idx & 7;
 if (mode === 1) return [this.blocks[(b.index + NB - 1) % NB], k];
 if (mode === 3) return [this.blocks[(b.index + 1) % NB], k];
 if (mode === 2) return [b, (k & 4) | ((k + s.i) & 3)];
 return [b, k];
 }
 flagLater(t, k, set) {
 const p = this.cyclePend ??= new Map();
 const e = p.get(t) ?? [0, 0];
 e[set ? 0 : 1] |= 1 << k;
 p.set(t, e);
 }
 flagsChanged(b) { b.dev.updateIrq(); this.wakeIf((s) => s.stall === STALL.WAIT || s.stall === STALL.IRQ_WAIT); }
 event(now) {
 for (const b of this.blocks) for (const s of b.sm) if (s.next <= now) { s.next = Infinity; this.step(b, s, now, s.nextK); }
 if (this.cyclePend) {
 const p = this.cyclePend; this.cyclePend = null;
 for (const [t, [set, clr]] of p) { t.flags = ((t.flags & ~clr) | set) & 0xff; this.flagsChanged(t); }
 }
 this.replan();
 }
 step(b, s, c, k) {
 s.ff = null;
 const woken = s.woken; s.woken = false;
 if (s.wait > 0) {
 const passed = k - s.en0;
 if (passed < s.wait) {
 s.wait -= passed; s.en0 = k; this.autopull(b, s);
 this.sched(b, s, s.en0 + s.wait + 1);
 return;
 }
 s.wait = 0;
 }
 s.en0 = k; s.wakeAt = 0;
 const fromLatch = s.latch >= 0, instr = fromLatch ? s.latch : b.imem[s.pc], pc0 = s.pc;
 const r = this.exec(b, s, instr, fromLatch ? (s.forced ? 'forced' : 'latch') : 'mem', c);
 this.steps++;
 if (r === 'stall') {
 s.retry = true;
 this.autopull(b, s);
 if (s.woken) this.sched(b, s, s.en0 + 1);
 else if (s.wakeAt) this.sched(b, s, Math.max(this.enAt(b, s, s.wakeAt - 1) + 1, s.en0 + 1));
 else s.next = Infinity;
 return;
 }
 s.retry = false; s.stall = STALL.NONE; s.executed++;
 if (r !== 'exec') this.autopull(b, s);
 if (!fromLatch && (instr & 0x1f) === pc0) this.skipLoop(b, s, instr);
 this.sched(b, s, s.en0 + s.wait + 1);
 }
 skipLoop(b, s, instr) {
 if ((instr & 0xe000) !== 0 || (instr & 0x1f) !== s.pc) return;
 const cond = (instr >>> 5) & 7;
 if (cond !== 2 && cond !== 4) return;
 const v = cond === 2 ? s.x : s.y;
 if (v < 4) return;
 const per = 1 + s.wait;
 s.ff = { start: s.en0, n: v, per, reg: cond === 2 ? 'x' : 'y' };
 s[s.ff.reg] = 0;
 s.en0 += v * per;
 }
 materialise(b, s, c) {
 const ff = s.ff;
 if (!ff) return;
 s.ff = null;
 const done = Math.min(ff.n, Math.max(0, Math.floor((this.enAt(b, s, c) - ff.start) / ff.per)));
 if (done >= ff.n) return;
 s[ff.reg] = ff.n - done;
 s.en0 = ff.start + done * ff.per;
 if (s.next !== Infinity) this.sched(b, s, s.en0 + s.wait + 1);
 }
 regAt(b, s, reg, c) {
 const ff = s.ff;
 if (!ff || ff.reg !== reg) return s[reg] >>> 0;
 const done = Math.min(ff.n, Math.max(0, Math.floor((this.enAt(b, s, c) - ff.start) / ff.per)));
 return done >= ff.n ? s[reg] >>> 0 : (ff.n - done) >>> 0;
 }
 autopull(b, s) {
 const sh = s.sh;
 if (!(sh & (1 << 17))) return;
 const th = ((sh >>> 25) & 0x1f) || 32;
 if (s.osrN >= th && s.tx.length) { s.osr = s.tx.shift(); s.osrN = 0; b.dev.fifoChanged(s); }
 }
 exec(b, s, instr, src, c) {
 const d = b.dev, ex = s.ex, sh = s.sh, pc = s.pcf;
 const sideCount = pc >>> 29, sideEn = (ex >>> 30) & 1, delayBits = 5 - sideCount;
 const field = (instr >>> 8) & 0x1f, delay = field & mask(delayBits);
 let sideN = -1, sideV = 0;
 if (sideCount && !s.retry) {
 const raw = field >>> delayBits;
 if (!sideEn || (raw >>> (sideCount - 1)) & 1) { sideN = sideEn ? sideCount - 1 : sideCount; sideV = raw & mask(sideN); }
 }
 const op = instr >>> 13;
 let jump = -1, stall = false, latched = false, pDir = -1, pMsk = 0, pVal = 0;
 const outCount = (pc >>> 20) & 0x3f, outBase = pc & 0x1f;
 switch (op) {
 case 0: {
 const cond = (instr >>> 5) & 7, addr = instr & 0x1f;
 let t;
 switch (cond) {
 case 0: t = true; break;
 case 1: t = s.x === 0; break;
 case 2: t = s.x !== 0; s.x = (s.x - 1) >>> 0; break;
 case 3: t = s.y === 0; break;
 case 4: t = s.y !== 0; s.y = (s.y - 1) >>> 0; break;
 case 5: t = s.x !== s.y; break;
 case 6: t = this.pinAt(b, (ex >>> 24) & 0x1f, c) === 1; break;
 default: t = s.osrN < (((sh >>> 25) & 0x1f) || 32);
 }
 if (t) jump = addr;
 break;
 }
 case 1: {
 const pol = (instr >>> 7) & 1, srcSel = (instr >>> 5) & 3, idx = instr & 0x1f;
 let v;
 if (srcSel === 0) v = this.pinAt(b, idx, c);
 else if (srcSel === 1) { const inCount = sh & 0x1f; v = inCount && idx >= inCount ? 0 : this.pinAt(b, ((pc >>> 15) & 0x1f) + idx, c); }
 else if (srcSel === 2) { const [t, k] = this.irqTarget(b, s, idx); v = (t.flags >>> k) & 1; if (v === pol && pol === 1) this.flagLater(t, k, false); }
 else v = this.pinAt(b, ((ex >>> 24) & 0x1f) + (idx & 3), c);
 if (v !== pol) {
 stall = true; s.stall = STALL.WAIT; this.anyPinWait = true;
 if (srcSel !== 2) {
 const n = (srcSel === 0 ? idx : srcSel === 1 ? ((pc >>> 15) & 0x1f) + idx : ((ex >>> 24) & 0x1f) + (idx & 3)) & 31;
 const last = n < 30 && this.hn[n] ? this.hc[n * 8 + ((this.hh[n] + 7) & 7)] + 2 : 0;
 if (last > c && !((b.sync >>> n) & 1)) s.wakeAt = last;
 }
 }
 break;
 }
 case 2: {
 const srcSel = (instr >>> 5) & 7, n = (instr & 0x1f) || 32;
 let data;
 switch (srcSel) {
 case 0: data = this.pinsAt(b, (pc >>> 15) & 0x1f, n, c); break;
 case 1: data = s.x; break;
 case 2: data = s.y; break;
 case 6: data = s.isr; break;
 case 7: data = s.osr; break;
 default: data = 0;
 }
 data = (data & mask(n)) >>> 0;
 const right = (sh >>> 18) & 1;
 const isr = n === 32 ? data : right ? ((s.isr >>> n) | (data << (32 - n))) >>> 0 : ((s.isr << n) | data) >>> 0;
 const cnt = Math.min(32, s.isrN + n), th = ((sh >>> 20) & 0x1f) || 32;
 if ((sh >>> 16) & 1 && cnt >= th) {
 if (s.rx.length >= d.rxDepth(s.i)) { stall = true; s.stall = STALL.IN; d.fdebug |= 1 << s.i; break; }
 s.rx.push(isr); s.isr = 0; s.isrN = 0; d.fifoChanged(s);
 } else { s.isr = isr; s.isrN = cnt; }
 break;
 }
 case 3: {
 const dst = (instr >>> 5) & 7, n = (instr & 0x1f) || 32, th = ((sh >>> 25) & 0x1f) || 32, auto = (sh >>> 17) & 1;
 if (auto && s.osrN >= th) {
 if (s.tx.length) { s.osr = s.tx.shift(); s.osrN = 0; d.fifoChanged(s); } else d.fdebug |= 1 << (24 + s.i);
 stall = true; s.stall = STALL.OUT; s.woken = s.tx.length > 0 || s.osrN === 0; break;
 }
 const right = (sh >>> 19) & 1;
 const data = n === 32 ? s.osr : right ? (s.osr & mask(n)) >>> 0 : s.osr >>> (32 - n);
 s.osr = n === 32 ? 0 : right ? s.osr >>> n : (s.osr << n) >>> 0;
 s.osrN = Math.min(32, s.osrN + n);
 switch (dst) {
 case 0: case 4: { const mk = mask(outCount); pDir = dst === 4 ? 1 : 0; pMsk = outCount ? rotl(mk, outBase) : 0; pVal = rotl((data & mk) >>> 0, outBase); break; }
 case 1: s.x = data; break;
 case 2: s.y = data; break;
 case 5: jump = data & 0x1f; break;
 case 6: s.isr = data; s.isrN = n; break;
 case 7: s.latch = data & 0xffff; s.forced = false; latched = true; break;
 default: break;
 }
 if (auto && s.osrN >= th && s.tx.length) { s.osr = s.tx.shift(); s.osrN = 0; d.fifoChanged(s); }
 break;
 }
 case 4: {
 const bit7 = (instr >>> 7) & 1, if1 = (instr >>> 6) & 1, blk = (instr >>> 5) & 1;
 if ((instr >>> 4) & 1) {
 const k = (instr >>> 3) & 1 ? instr & 3 : s.y & 3;
 if (!bit7) { if (!(sh & (1 << 15))) this.m.diag('pioPutGet', b.index, s.i, 'put'); s.put[k] = s.isr; d.fifoChanged(s); }
 else { if (!(sh & (1 << 14))) this.m.diag('pioPutGet', b.index, s.i, 'get'); s.osr = s.put[k]; s.osrN = 0; }
 break;
 }
 if (!bit7) {
 const th = ((sh >>> 20) & 0x1f) || 32;
 if (if1 && s.isrN < th) break;
 if (s.rx.length >= d.rxDepth(s.i)) {
 d.fdebug |= 1 << s.i;
 if (blk) { stall = true; s.stall = STALL.PUSH; break; }
 s.isr = 0; s.isrN = 0; break;
 }
 s.rx.push(s.isr); s.isr = 0; s.isrN = 0; d.fifoChanged(s);
 } else {
 const th = ((sh >>> 25) & 0x1f) || 32;
 if ((if1 || (sh >>> 17) & 1) && s.osrN < th) break;
 if (!s.tx.length) {
 d.fdebug |= 1 << (24 + s.i);
 if (blk) { stall = true; s.stall = STALL.PULL; break; }
 s.osr = s.x; s.osrN = 0; break;
 }
 s.osr = s.tx.shift(); s.osrN = 0; d.fifoChanged(s);
 }
 break;
 }
 case 5: {
 const dst = (instr >>> 5) & 7, opn = (instr >>> 3) & 3, srcSel = instr & 7;
 let v;
 switch (srcSel) {
 case 0: { const inCount = sh & 0x1f; v = this.pinsAt(b, (pc >>> 15) & 0x1f, inCount || 32, c); break; }
 case 1: v = s.x; break;
 case 2: v = s.y; break;
 case 3: v = 0; break;
 case 5: v = this.status(b, s, ex) ? 0xffffffff : 0; break;
 case 6: v = s.isr; break;
 case 7: v = s.osr; break;
 default: v = 0;
 }
 if (opn === 1) v = ~v >>> 0; else if (opn === 2) v = rev32(v >>> 0);
 v >>>= 0;
 switch (dst) {
 case 0: case 3: { const mk = mask(outCount); pDir = dst === 3 ? 1 : 0; pMsk = outCount ? rotl(mk, outBase) : 0; pVal = rotl((v & mk) >>> 0, outBase); break; }
 case 1: s.x = v; break;
 case 2: s.y = v; break;
 case 4: s.latch = v & 0xffff; s.forced = false; latched = true; break;
 case 5: jump = v & 0x1f; break;
 case 6: s.isr = v; s.isrN = 0; break;
 default: s.osr = v; s.osrN = 0;
 }
 break;
 }
 case 6: {
 const clr = (instr >>> 6) & 1, wt = (instr >>> 5) & 1, [t, k] = this.irqTarget(b, s, instr & 0x1f);
 if (clr) { this.flagLater(t, k, false); break; }
 if (s.irqWaiting) {
 if ((t.flags >>> k) & 1) { stall = true; s.stall = STALL.IRQ_WAIT; } else s.irqWaiting = false;
 break;
 }
 this.flagLater(t, k, true);
 if (wt) { s.irqWaiting = true; stall = true; s.stall = STALL.IRQ_WAIT; }
 break;
 }
 default: {
 const dst = (instr >>> 5) & 7, data = instr & 0x1f, setBase = (pc >>> 5) & 0x1f, setCount = (pc >>> 26) & 7;
 if (dst === 0 || dst === 4) { const mk = mask(setCount); pDir = dst === 4 ? 1 : 0; pMsk = setCount ? rotl(mk, setBase) : 0; pVal = rotl((data & mk) >>> 0, setBase); }
 else if (dst === 1) s.x = data;
 else if (dst === 2) s.y = data;
 }
 }
 if (pDir >= 0 && !stall) this.outWrite(b, pDir, pMsk, pVal);
 if (sideN > 0) { const sb = (pc >>> 10) & 0x1f; this.outWrite(b, (ex >>> 29) & 1, rotl(mask(sideN), sb), rotl(sideV, sb)); }
 if (stall) {
 if (src === 'forced' || s.forced) { s.latch = instr; s.forced = true; }
 return 'stall';
 }
 if (src !== 'mem') { if (!latched) { s.latch = -1; s.forced = false; } }
 if (jump >= 0) s.pc = jump;
 else if (src === 'mem') s.pc = s.pc === ((ex >>> 12) & 0x1f) ? (ex >>> 7) & 0x1f : (s.pc + 1) & 31;
 if (latched) { s.wait = 0; return 'exec'; }
 s.wait = src === 'forced' ? 0 : delay;
 return 'ok';
 }
 status(b, s, ex) {
 const sel = (ex >>> 5) & 3, n = ex & 0x1f;
 if (sel === 0) return s.tx.length < n;
 if (sel === 1) return s.rx.length < n;
 const t = n & 0x10 ? this.blocks[(b.index + 1) % NB] : n & 0x08 ? this.blocks[(b.index + NB - 1) % NB] : b;
 return ((t.flags >>> (n & 7)) & 1) === 1;
 }
 view() {
 return this.blocks.map((b) => ({ index: b.index, imem: Array.from(b.imem), flags: b.flags, padOut: b.padOut, padOe: b.padOe, ctrl: b.dev.r.get(O_CTRL),
 sm: b.sm.map((s) => ({ i: s.i, enabled: this.enabled(b, s), pc: s.pc, x: this.regAt(b, s, 'x', this.m.now), y: this.regAt(b, s, 'y', this.m.now), isr: s.isr >>> 0, osr: s.osr >>> 0, isrN: s.isrN, osrN: s.osrN,
 tx: s.tx.slice(), rx: s.rx.slice(), stall: s.stall, wait: s.wait, latch: s.latch, executed: s.executed,
 clkdiv: b.dev.r.get(O_SM + SM_STRIDE * s.i), execctrl: b.dev.execctrl(s.i), shiftctrl: b.dev.shift(s.i), pinctrl: b.dev.pinctrl(s.i) })) }));
 }
}
class PioBlockDevice extends Device {
 constructor(pio, b) {
 super(pio.m, `PIO${b.index}`, { regs: 'PIO0', resetBit: 11 + b.index });
 this.pio = pio; this.b = b; b.dev = this;
 this.fdebug = 0; this.line = [0, 0];
 }
 get next() { return Infinity; } set next(v) { }
 refresh() {
 const ctrl = this.r.get(O_CTRL);
 for (const s of this.b.sm) {
 const o = O_SM + SM_STRIDE * s.i, v = this.r.get(o + R_CLKDIV);
 s.n = (v >>> 16) || 65536; s.f = (v >>> 8) & 0xff; s.on = ((ctrl >>> s.i) & 1) === 1;
 s.ex = this.r.get(o + R_EXEC); s.sh = this.r.get(o + R_SHIFT); s.pcf = this.r.get(o + R_PIN);
 }
 this.b.sync = this.r.get(O_SYNC);
 }
 execctrl(i) { return this.r.get(O_SM + SM_STRIDE * i + R_EXEC); }
 shift(i) { return this.r.get(O_SM + SM_STRIDE * i + R_SHIFT); }
 pinctrl(i) { return this.r.get(O_SM + SM_STRIDE * i + R_PIN); }
 txDepth(i) { const sh = this.shift(i); return sh & (1 << 30) ? 8 : sh & (1 << 31) ? 0 : 4; }
 rxDepth(i) { const sh = this.shift(i); return sh & (1 << 31) ? 8 : sh & (1 << 30) ? 0 : 4; }
 reset() {
 if (this.m.ready) for (const k of [0, 1]) if (this.line[k]) this.m.irq(15 + 2 * this.b.index + k, 0);
 super.reset();
 const old = this.b.padOut | this.b.padOe;
 this.b.clear(); this.fdebug = 0; this.line = [0, 0]; this.refresh();
 if (this.m.ready && old) { const p = this.m.pins, f = F_PIO0 + this.b.index; for (let n = 0; n < 30; n++) if ((p.ctrl[n] & 0x1f) === f) p.update(n); }
 this.pio.replan?.();
 }
 fifoChanged(s) {
 const dma = this.m.dma, base = 8 * this.b.index;
 dma?.levelChanged(base + s.i); dma?.levelChanged(base + 4 + s.i);
 this.updateIrq();
 }
 dreq(k) {
 if (this.heldFlag) return false;
 const s = this.b.sm[k & 3];
 return k < 4 ? s.tx.length < this.txDepth(k) : s.rx.length > 0;
 }
 intr() {
 let v = this.b.flags << 8;
 for (const s of this.b.sm) { if (s.rx.length) v |= 1 << s.i; if (s.tx.length < this.txDepth(s.i)) v |= 1 << (4 + s.i); }
 return v >>> 0;
 }
 updateIrq() {
 const r = this.intr();
 for (const k of [0, 1]) {
 const v = ((r & this.r.get(k ? O_INTE1 : O_INTE0)) | this.r.get(k ? O_INTF1 : O_INTF0)) & 0xffff ? 1 : 0;
 if (v !== this.line[k]) { this.line[k] = v; this.m.irq(15 + 2 * this.b.index + k, v); }
 }
 }
 read(off, addr) {
 if (this.heldFlag) return super.read(off, addr);
 const b = this.b;
 if (off >= O_RXF && off < O_RXF + 16) {
 const s = b.sm[(off - O_RXF) >>> 2];
 if (!s.rx.length) { this.fdebug |= 1 << (8 + s.i); return 0; }
 const v = s.rx.shift();
 this.fifoChanged(s);
 if (s.stall === STALL.PUSH || s.stall === STALL.IN) this.pio.wake(b, s);
 return v >>> 0;
 }
 if (off >= O_TXF && off < O_TXF + 16) return 0;
 return super.read(off, addr);
 }
 readReg(off) {
 const b = this.b;
 switch (off) {
 case O_FSTAT: {
 let v = 0;
 for (const s of b.sm) {
 const td = this.txDepth(s.i), rd = this.rxDepth(s.i);
 if (s.rx.length >= rd) v |= 1 << s.i; if (!s.rx.length) v |= 1 << (8 + s.i);
 if (s.tx.length >= td) v |= 1 << (16 + s.i); if (!s.tx.length) v |= 1 << (24 + s.i);
 }
 return v >>> 0;
 }
 case O_FDEBUG: return this.fdebug >>> 0;
 case O_FLEVEL: { let v = 0; for (const s of b.sm) v |= ((s.tx.length & 0xf) | ((s.rx.length & 0xf) << 4)) << (8 * s.i); return v >>> 0; }
 case O_IRQ: return b.flags;
 case O_PADOUT: return b.padOut >>> 0;
 case O_PADOE: return b.padOe >>> 0;
 case O_CFGINFO: return 0x10200404;
 case O_INTR: return this.intr();
 case O_INTS0: return ((this.intr() & this.r.get(O_INTE0)) | this.r.get(O_INTF0)) & 0xffff;
 case O_INTS1: return ((this.intr() & this.r.get(O_INTE1)) | this.r.get(O_INTF1)) & 0xffff;
 default: break;
 }
 if (off >= O_SM && off < O_SM + 4 * SM_STRIDE) {
 const i = Math.floor((off - O_SM) / SM_STRIDE), r = (off - O_SM) % SM_STRIDE, s = b.sm[i];
 if (r === R_ADDR) return s.pc;
 if (r === R_INSTR) return s.latch >= 0 ? s.latch : b.imem[s.pc];
 if (r === R_EXEC) return ((this.r.get(off) & 0x7fffffff) | (s.forced && s.latch >= 0 ? 0x80000000 : 0)) >>> 0;
 }
 if (off >= O_PUTGET && off < O_PUTGET + 64) { const s = b.sm[(off - O_PUTGET) >>> 4]; return s.put[((off - O_PUTGET) >>> 2) & 3] >>> 0; }
 return this.r.get(off);
 }
 write(off, value, alias, addr, size, raw) {
 if (this.heldFlag) return super.write(off, value, alias, addr, size, raw);
 const b = this.b, c = this.now, p = this.pio;
 const av = (old) => (alias === 1 ? (old ^ value) >>> 0 : alias === 2 ? (old | value) >>> 0 : alias === 3 ? (old & ~value) >>> 0 : value >>> 0);
 if (off >= O_TXF && off < O_TXF + 16) {
 const s = b.sm[(off - O_TXF) >>> 2];
 if (s.tx.length >= this.txDepth(s.i)) { this.fdebug |= 1 << (16 + s.i); return; }
 if (s.ff && p.wantsPull(b, s)) p.materialise(b, s, c);
 s.tx.push(av(0));
 this.fifoChanged(s);
 p.wake(b, s);
 return;
 }
 if (off >= O_IMEM && off < O_IMEM + 128) { b.imem[(off - O_IMEM) >>> 2] = av(b.imem[(off - O_IMEM) >>> 2]) & 0xffff; return; }
 if (off === O_FDEBUG) { if (alias !== 3) this.fdebug = (this.fdebug & ~value) >>> 0; return; }
 if (off === O_IRQ) { if (alias !== 3) { b.flags &= ~value & 0xff; p.flagsChanged(b); } return; }
 if (off === O_IRQ_FORCE) { if (alias !== 3) { b.flags |= value & 0xff; p.flagsChanged(b); } return; }
 if (off >= O_PUTGET && off < O_PUTGET + 64) { const s = b.sm[(off - O_PUTGET) >>> 4], k = ((off - O_PUTGET) >>> 2) & 3; s.put[k] = av(s.put[k]); return; }
 if (off >= O_SM && off < O_SM + 4 * SM_STRIDE) {
 const i = Math.floor((off - O_SM) / SM_STRIDE), r = (off - O_SM) % SM_STRIDE, s = b.sm[i];
 p.materialise(b, s, c);
 if (r === R_INSTR) {
 const ins = av(0) & 0xffff;
 s.retry = false;
 const res = p.exec(b, s, ins, 'forced', c);
 if (res === 'stall') { s.retry = true; p.plan(b, s, c); }
 else { s.stall = STALL.NONE; if (res === 'exec') p.plan(b, s, c); }
 p.flushFlags();
 return;
 }
 if (r === R_ADDR) return;
 const oldShift = this.shift(i);
 super.write(off, value, alias, addr, size, raw);
 this.refresh();
 if (r === R_SHIFT && ((oldShift ^ this.shift(i)) & 0xc000c000)) { s.tx = []; s.rx = []; this.fifoChanged(s); }
 if (r === R_CLKDIV) { s.d0 = c; s.en0 = 0; }
 if (r === R_EXEC && (this.execctrl(i) & (1 << 18))) this.m.diag('pioNotModelled', 'INLINE_OUT_EN');
 if (r === R_EXEC && (this.execctrl(i) & (1 << 17))) this.m.diag('pioNotModelled', 'OUT_STICKY');
 p.wake(b, s); p.plan(b, s, c);
 return;
 }
 if (off === O_CTRL) {
 const v = av(this.r.get(O_CTRL)), en = v & 0xf, old = this.r.get(O_CTRL) & 0xf;
 this.r.set(O_CTRL, en);
 this.refresh();
 for (const s of b.sm) {
 if (((v >>> 4) | (v >>> 8) | (en ^ old)) >>> s.i & 1) p.materialise(b, s, c);
 if ((v >>> (4 + s.i)) & 1) this.restartSm(s);
 if ((v >>> (8 + s.i)) & 1) { s.d0 = c; s.en0 = 0; if (s.on) p.plan(b, s, c); }
 if (((en ^ old) >>> s.i) & 1) this.enableChanged(s, ((en >>> s.i) & 1) === 1, c);
 }
 if (v & 0x07000000) {
 for (const [blk, m4] of [[p.blocks[(b.index + NB - 1) % NB], (v >>> 16) & 0xf], [p.blocks[(b.index + 1) % NB], (v >>> 20) & 0xf]]) {
 if (!m4) continue;
 const d = blk.dev, e0 = d.r.get(O_CTRL) & 0xf;
 let e = e0;
 if (v & (1 << 24)) e |= m4;
 if (v & (1 << 25)) e &= ~m4;
 d.r.set(O_CTRL, e); d.refresh();
 for (const s of blk.sm) {
 if ((v & (1 << 26)) && ((m4 >>> s.i) & 1)) { p.materialise(blk, s, c); s.d0 = c; s.en0 = 0; if (s.on) p.plan(blk, s, c); }
 if (((e ^ e0) >>> s.i) & 1) d.enableChanged(s, ((e >>> s.i) & 1) === 1, c);
 }
 }
 }
 p.replan();
 return;
 }
 if (off === O_GPIOBASE) { super.write(off, value, alias, addr, size, raw); if (this.r.get(O_GPIOBASE)) this.m.diag('pioNotModelled', 'GPIOBASE 16'); return; }
 super.write(off, value, alias, addr, size, raw);
 if (off >= O_INTE0 && off <= O_INTF1) this.updateIrq();
 if (off === O_SYNC) { this.refresh(); p.wakeIf(() => true); }
 }
 restartSm(s) {
 s.isr = 0; s.isrN = 0; s.osrN = 32; s.wait = 0; s.irqWaiting = false; s.latch = -1; s.forced = false; s.stall = STALL.NONE; s.retry = false;
 }
 enableChanged(s, on, c) {
 const p = this.pio, b = this.b;
 if (on) { s.en0 = p.enAt(b, s, c); s.woken = true; p.plan(b, s, c); }
 else { s.next = Infinity; p.replan(); }
 }
 save() { return { ...super.save(), imem: Array.from(this.b.imem), flags: this.b.flags, padOut: this.b.padOut, padOe: this.b.padOe, fdebug: this.fdebug, line: this.line.slice(), sm: this.b.sm.map((s) => s.save()) }; }
 load(s) {
 super.load(s); this.b.imem.set(s.imem); this.b.flags = s.flags; this.b.padOut = s.padOut; this.b.padOe = s.padOe; this.fdebug = s.fdebug; this.line = s.line.slice();
 s.sm.forEach((x, i) => this.b.sm[i].load(x));
 this.refresh();
 }
}
Pio.prototype.flushFlags = function flushFlags() {
 if (!this.cyclePend) return;
 const p = this.cyclePend; this.cyclePend = null;
 for (const [t, [set, clr]] of p) { t.flags = ((t.flags & ~clr) | set) & 0xff; this.flagsChanged(t); }
};
