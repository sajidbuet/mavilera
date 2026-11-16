// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
export const NUM_SLICES = 12;
export const F_PWM = 4;
export const DREQ_PWM_WRAP0 = 32;
const IRQ_WRAP0 = 8, IRQ_WRAP1 = 9;
const CSR_EN = 0x1, CSR_PH_CORRECT = 0x2, CSR_A_INV = 0x4, CSR_B_INV = 0x8, CSR_PH_RET = 0x40, CSR_PH_ADV = 0x80;
const PEND_ADV = 1, PEND_RET = 2;
const SLICE_BYTES = 0x14, O_EN = 0xf0, O_INTR = 0xf4, O_INTE0 = 0xf8, O_INTF0 = 0xfc, O_INTS0 = 0x100, O_INTE1 = 0x104, O_INTF1 = 0x108, O_INTS1 = 0x10c;
export const sliceOfPin = (n) => (n < 32 ? (n >>> 1) & 7 : 8 + (((n - 32) >>> 1) & 3));
class Slice {
 constructor(i) { this.i = i; this.clear(); }
 clear() {
 this.d16 = 16;
 this.run = false;
 this.c0 = 0; this.p0 = 0; this.acc = 0;
 this.w = 0;
 this.L = 0x10000;
 this.pc = false;
 this.top = 0xffff; this.ccA = 0; this.ccB = 0;
 this.mode = 0; this.en = 0;
 this.out = 0;
 this.bIn = 0;
 this.pend = 0;
 this.pins = 0;
 this.next = Infinity;
 }
 enables(c) { return !this.run || c <= this.c0 ? this.p0 : this.p0 + Math.floor((this.acc + (c - this.c0) * 16) / this.d16); }
 rebase(c) {
 if (c <= this.c0) return;
 if (this.run) { const t = this.acc + (c - this.c0) * 16; this.p0 += Math.floor(t / this.d16); this.acc = t % this.d16; }
 this.c0 = c;
 }
 cycleFor(p, from) {
 if (p <= this.enables(from)) return from;
 if (!this.run) return Infinity;
 return Math.max(from, this.c0 + Math.ceil(((p - this.p0) * this.d16 - this.acc) / 16));
 }
 ctr(q) { return this.pc && q > this.top ? 2 * this.top + 1 - q : q; }
 save() { return [this.d16, this.run ? 1 : 0, this.c0, this.p0, this.acc, this.w, this.L, this.pc ? 1 : 0, this.top, this.ccA, this.ccB, this.mode, this.en, this.out, this.bIn, this.pend, this.pins, this.next]; }
 load(s) {
 let r, pc;
 [this.d16, r, this.c0, this.p0, this.acc, this.w, this.L, pc, this.top, this.ccA, this.ccB, this.mode, this.en, this.out, this.bIn, this.pend, this.pins, this.next] = s;
 this.run = r === 1; this.pc = pc === 1;
 }
}
export class Pwm extends Device {
 constructor(m) {
 super(m, 'PWM', { resetBit: 16 });
 this.s = Array.from({ length: NUM_SLICES }, (_, i) => new Slice(i));
 this.lines = 0; this.tapPin = -1; this.tapSlice = -1;
 this.reset();
 }
 reset() {
 if (this.lines && this.m.ready) { if (this.lines & 1) this.m.irq(IRQ_WRAP0, 0); if (this.lines & 2) this.m.irq(IRQ_WRAP1, 0); }
 super.reset();
 this.lines = 0;
 for (const s of this.s) s.clear();
 const ctrl = this.m.pins?.ctrl;
 if (ctrl) for (let n = 0; n < ctrl.length; n++) if ((ctrl[n] & 0x1f) === F_PWM) this.s[sliceOfPin(n)].pins |= 1 << n;
 this.next = Infinity;
 if (this.m.ready) for (const s of this.s) { this.updateBQuiet(s); this.refresh(s); }
 }
 updateBQuiet(s) { let b = 0, rest = s.pins & 0xaaaaaaaa; while (rest) { const n = 31 - Math.clz32(rest & -rest); rest &= rest - 1; b |= this.m.pins.input[n]; } s.bIn = b; }
 csrOff(i) { return SLICE_BYTES * i; }
 latch(s) {
 const o = this.csrOff(s.i), cc = this.r.get(o + 0xc);
 s.top = this.r.get(o + 0x10) & 0xffff; s.ccA = cc & 0xffff; s.ccB = cc >>> 16;
 s.pc = (this.r.get(o) & CSR_PH_CORRECT) !== 0;
 s.L = (s.top + 1) * (s.pc ? 2 : 1);
 }
 catchUp(s, c) {
 const p = s.enables(c);
 if (p - s.w < s.L) return;
 s.w += s.L;
 this.latch(s);
 let k = 1;
 if (p - s.w >= s.L) { const more = Math.floor((p - s.w) / s.L); s.w += more * s.L; k += more; }
 const bit = 1 << s.i, o = O_INTR;
 if (!(this.r.get(o) & bit)) { this.r.set(o, this.r.get(o) | bit); this.updateIrq(); }
 this.m.dma?.dreq(DREQ_PWM_WRAP0 + s.i, k);
 if (s.i === this.tapSlice && this.m.audio?.mode === 'ideal') {
 const ch = this.tapPin & 1, cc = ch ? s.ccB : s.ccA, inv = this.r.get(this.csrOff(s.i)) & (ch ? CSR_B_INV : CSR_A_INV);
 const d = Math.min(cc, s.top + 1) / (s.top + 1);
 this.m.audio.duty(c, inv ? 1 - d : d, (s.L * s.d16) / 16);
 }
 }
 setTap(pin) {
 const old = this.tapSlice;
 this.tapPin = pin; this.tapSlice = pin >= 0 ? sliceOfPin(pin) : -1;
 if (old >= 0 && old !== this.tapSlice) this.wake(old);
 if (this.tapSlice >= 0) this.wake(this.tapSlice);
 }
 idealOk(n) {
 if ((this.m.pins.ctrl[n] & 0x1f) !== F_PWM) return false;
 const s = this.s[sliceOfPin(n)];
 return s.mode === 0 && !(this.r.get(this.csrOff(s.i)) & CSR_PH_CORRECT);
 }
 outputs(s, p) {
 const q = p - s.w, x = s.ctr(q), csr = this.r.get(this.csrOff(s.i));
 let o = (x < s.ccA ? 1 : 0) ^ (csr & CSR_A_INV ? 1 : 0);
 if (s.mode === 0) o |= ((x < s.ccB ? 1 : 0) ^ (csr & CSR_B_INV ? 1 : 0)) << 1;
 return o;
 }
 sync(s, c) { this.catchUp(s, c); this.refresh(s, c); }
 refresh(s, c = this.now) {
 const o = this.outputs(s, s.enables(c));
 if (o === s.out) return;
 s.out = o;
 if (s.pins) this.m.pins.updateMask(s.pins);
 }
 watched(s) {
 const bit = 1 << s.i;
 return ((this.r.get(O_INTE0) | this.r.get(O_INTF0) | this.r.get(O_INTE1) | this.r.get(O_INTF1)) & bit) !== 0
 || (this.m.dma?.listening(DREQ_PWM_WRAP0 + s.i) ?? false)
 || (s.i === this.tapSlice && this.m.audio?.mode === 'ideal');
 }
 nextEdge(s, q) {
 let t = Infinity;
 const cand = (cc) => {
 if (!s.pc) { if (cc > q && cc < s.L && cc < t) t = cc; return; }
 if (cc > q && cc <= s.top && cc < t) t = cc;
 const r = 2 * s.top + 2 - cc;
 if (cc >= 1 && r > q && r < s.L && r < t) t = r;
 };
 cand(s.ccA); if (s.mode === 0) cand(s.ccB);
 return t;
 }
 pinsNeedWraps(s) {
 if (!s.pins) return false;
 const o = this.csrOff(s.i), cc = this.r.get(o + 0xc), top = this.r.get(o + 0x10) & 0xffff;
 if (top !== s.top || (cc & 0xffff) !== s.ccA || (s.mode === 0 && cc >>> 16 !== s.ccB)) return true;
 if (((this.r.get(o) & CSR_PH_CORRECT) !== 0) !== s.pc) return true;
 const varies = (cc) => cc > 0 && cc <= s.top;
 return varies(s.ccA) || (s.mode === 0 && varies(s.ccB));
 }
 nextGap(s, c) {
 if (!s.en) return Infinity;
 if (!s.run) return c + 1;
 if (s.d16 <= 16) return Infinity;
 for (let k = 1; k <= s.d16; k++) if (s.enables(c + k) === s.enables(c + k - 1)) return c + k;
 return Infinity;
 }
 plan(s, c) {
 let nx = Infinity;
 if (s.pend === PEND_ADV) nx = this.nextGap(s, c);
 else if (s.pend === PEND_RET && s.run) nx = s.cycleFor(s.enables(c) + 1, c + 1);
 if (s.run) {
 if (this.watched(s) || this.pinsNeedWraps(s)) nx = Math.min(nx, s.cycleFor(s.w + s.L, c + 1));
 if (s.pins) { const e = this.nextEdge(s, s.enables(c) - s.w); if (e !== Infinity) nx = Math.min(nx, s.cycleFor(s.w + e, c + 1)); }
 }
 s.next = nx;
 let n = Infinity; for (const x of this.s) if (x.next < n) n = x.next;
 this.next = n;
 this.m.schedule(this);
 }
 event() {
 const c = this.next;
 for (const s of this.s) {
 if (s.next !== c) continue;
 if (s.pend) this.applyPend(s, c);
 this.sync(s, c);
 this.plan(s, c);
 }
 let n = Infinity; for (const x of this.s) if (x.next < n) n = x.next;
 this.next = n;
 }
 applyPend(s, c) {
 if (s.pend === PEND_ADV) {
 if (this.nextGap(s, c - 1) !== c) return;
 s.rebase(c); s.p0 += 1;
 } else {
 if (!s.run || s.enables(c) === s.enables(c - 1)) return;
 s.rebase(c); s.p0 -= 1;
 }
 s.pend = 0;
 }
 wake(i) { const s = this.s[i], c = this.now; this.sync(s, c); this.plan(s, c); }
 pinsChanged() {
 const ctrl = this.m.pins.ctrl, masks = new Array(NUM_SLICES).fill(0);
 for (let n = 0; n < ctrl.length; n++) if ((ctrl[n] & 0x1f) === F_PWM) masks[sliceOfPin(n)] |= 1 << n;
 const c = this.now;
 this.s.forEach((s, i) => {
 if (masks[i] === s.pins) return;
 this.sync(s, c); s.pins = masks[i];
 this.updateB(s, c);
 this.plan(s, c);
 });
 }
 pinOut(n) { const s = this.s[sliceOfPin(n)], ch = n & 1; return ch === 0 || s.mode === 0 ? ((s.out >>> ch) & 1) | 2 : 0; }
 pinInput(n) { if (n & 1) { const s = this.s[sliceOfPin(n)], c = this.now; this.updateB(s, c); } }
 updateB(s, c) {
 const p = this.m.pins;
 let b = 0, rest = s.pins & 0xaaaaaaaa;
 while (rest) { const n = 31 - Math.clz32(rest & -rest); rest &= rest - 1; b |= p.input[n]; }
 if (b === s.bIn) return;
 s.bIn = b;
 if (!s.en) return;
 if (s.mode === 1) { this.sync(s, c); s.rebase(c); s.run = b === 1; s.c0 = c; this.sync(s, c); this.plan(s, c); }
 else if ((s.mode === 2 && b) || (s.mode === 3 && !b)) {
 this.sync(s, c);
 if (s.pend === PEND_RET) s.pend = 0;
 else { s.acc += 16; while (s.acc >= s.d16) { s.p0++; s.acc -= s.d16; } }
 this.sync(s, c); this.plan(s, c);
 }
 }
 readReg(off) {
 const c = this.now;
 if (off < O_EN) {
 const i = Math.floor(off / SLICE_BYTES), k = off - SLICE_BYTES * i, s = this.s[i];
 if (k === 0) return (this.r.get(off) & 0x3f) | (s.pend === PEND_ADV ? CSR_PH_ADV : 0) | (s.pend === PEND_RET ? CSR_PH_RET : 0);
 if (k === 8) { this.sync(s, c); return s.ctr(s.enables(c) - s.w) & 0xffff; }
 return this.r.get(off);
 }
 if (off === O_EN) { let v = 0; for (const s of this.s) v |= s.en << s.i; return v; }
 if (off === O_INTR || off === O_INTS0 || off === O_INTS1) for (const s of this.s) this.catchUp(s, c);
 if (off === O_INTS0) return ((this.r.get(O_INTR) | this.r.get(O_INTF0)) & this.r.get(O_INTE0)) & 0xfff;
 if (off === O_INTS1) return ((this.r.get(O_INTR) | this.r.get(O_INTF1)) & this.r.get(O_INTE1)) & 0xfff;
 return this.r.get(off);
 }
 write(off, value, alias, addr, size, raw) {
 if (!this.held() && off < O_EN) {
 const i = Math.floor(off / SLICE_BYTES), k = off - SLICE_BYTES * i;
 if (k === 0 && alias !== 3 && (value & (CSR_PH_ADV | CSR_PH_RET))) this.s[i].pend = value & CSR_PH_ADV ? PEND_ADV : PEND_RET;
 if (k === 8) { this.setCounter(this.s[i], aliasValue(this.readReg(off), value, alias) & 0xffff); return; }
 }
 if (!this.held() && off === O_INTR) for (const s of this.s) this.catchUp(s, this.now);
 super.write(off, value, alias, addr, size, raw);
 }
 onWrite(off, nv, old) {
 const c = this.now;
 if (off < O_EN) {
 const i = Math.floor(off / SLICE_BYTES), k = off - SLICE_BYTES * i, s = this.s[i];
 this.sync(s, c);
 if (k === 0) this.setCsr(s, nv, c);
 else if (k === 4) { s.rebase(c); const di = (nv >>> 4) & 0xff; s.d16 = (di || 256) * 16 + (nv & 0xf); }
 this.refresh(s, c);
 this.plan(s, c);
 return;
 }
 if (off === O_EN) {
 for (const s of this.s) {
 const o = this.csrOff(s.i), csr = this.r.get(o), en = (nv >>> s.i) & 1;
 if (en === s.en) continue;
 this.sync(s, c);
 this.r.set(o, (csr & ~CSR_EN) | en);
 this.setCsr(s, (csr & ~CSR_EN) | en, c);
 this.refresh(s, c); this.plan(s, c);
 }
 return;
 }
 this.updateIrq();
 for (const s of this.s) this.plan(s, c);
 }
 setCsr(s, csr, c) {
 const en = csr & CSR_EN, mode = (csr >>> 4) & 3, ph = (csr & CSR_PH_CORRECT) !== 0;
 s.rebase(c);
 const p = s.enables(c), q = p - s.w, x = s.ctr(q), down = s.pc && q > s.top;
 if (en && !s.en) this.latch(s);
 else if (ph !== s.pc && s.L !== 0x10000) { s.pc = ph; s.L = (s.top + 1) * (ph ? 2 : 1); }
 if (x > s.top) { s.pc = false; s.L = 0x10000; s.w = p - x; }
 else s.w = p - (s.pc && down ? 2 * s.top + 1 - x : x);
 s.en = en; s.mode = mode;
 s.run = en === 1 && (mode === 0 || (mode === 1 && s.bIn === 1));
 s.c0 = c;
 }
 setCounter(s, v) {
 const c = this.now;
 this.sync(s, c);
 const p = s.enables(c), q = p - s.w, down = s.pc && q > s.top;
 if (v > s.top) { s.pc = false; s.L = 0x10000; s.w = p - v; }
 else s.w = down ? p - (2 * s.top + 1 - v) : p - v;
 this.refresh(s, c); this.plan(s, c);
 }
 updateIrq() {
 const r = this.r.get(O_INTR);
 const l0 = ((r | this.r.get(O_INTF0)) & this.r.get(O_INTE0) & 0xfff) ? 1 : 0, l1 = ((r | this.r.get(O_INTF1)) & this.r.get(O_INTE1) & 0xfff) ? 2 : 0;
 const v = l0 | l1;
 if (v === this.lines) return;
 if ((v ^ this.lines) & 1) this.m.irq(IRQ_WRAP0, v & 1);
 if ((v ^ this.lines) & 2) this.m.irq(IRQ_WRAP1, (v >>> 1) & 1);
 this.lines = v;
 }
 view(i) {
 const o = this.csrOff(i), c = this.now, csr = this.r.get(o), cc = this.r.get(o + 0xc);
 const s = Object.assign(new Slice(i), this.s[i]);
 const p = s.enables(c);
 if (p - s.w >= s.L) {
 s.w += s.L; s.top = this.r.get(o + 0x10) & 0xffff; s.ccA = cc & 0xffff; s.ccB = cc >>> 16; s.pc = (csr & CSR_PH_CORRECT) !== 0;
 s.L = (s.top + 1) * (s.pc ? 2 : 1);
 if (p - s.w >= s.L) s.w += Math.floor((p - s.w) / s.L) * s.L;
 }
 const div = s.d16 / 16, period = (s.top + 1) * (s.pc ? 2 : 1) * div;
 return { slice: i, en: s.en, mode: s.mode, phaseCorrect: s.pc, aInv: (csr & CSR_A_INV) !== 0, bInv: (csr & CSR_B_INV) !== 0, div, top: this.r.get(o + 0x10) & 0xffff,
 ccA: cc & 0xffff, ccB: cc >>> 16, latched: { top: s.top, ccA: s.ccA, ccB: s.ccB }, counter: s.ctr(s.enables(c) - s.w) & 0xffff,
 periodCycles: period, frequency: s.mode === 0 ? this.m.freq.sys / period : null, outputs: s.out, pins: s.pins };
 }
 save() { return { ...super.save(), s: this.s.map((x) => x.save()), lines: this.lines }; }
 load(st) { super.load(st); st.s.forEach((x, i) => this.s[i].load(x)); this.lines = st.lines; }
}
function aliasValue(old, value, alias) {
 return alias === 1 ? (old ^ value) >>> 0 : alias === 2 ? (old | value) >>> 0 : alias === 3 ? (old & ~value) >>> 0 : value >>> 0;
}
