// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Device } from './device.js';
export const NPU_BASE = 0x50000000;
export const NPU_N = 4;
export const NPU_REG = Object.freeze({ CTRL: 0x00, STATUS: 0x04, WEIGHT: 0x10, ACT: 0x20, RESULT: 0x30 });
export const NPU_CTRL = Object.freeze({ START: 1, CLEAR: 2 });
export const NPU_STATUS = Object.freeze({ BUSY: 1, DONE: 2 });
export const NPU_STATES = Object.freeze(['IDLE', 'LOADW', 'RUN']);
const sext8 = (v) => (v << 24) >> 24;
const sext16 = (v) => (v << 16) >> 16;
const matrix = (n, f = () => 0) => Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => f(r, c)));
export function product(a, w) { return sext16(sext8(a) * sext8(w)); }
export function pe({ w }, { wLoad = false, wIn = 0, aIn, pIn }) {
 return { w: wLoad ? sext8(wIn) : w, a: sext8(aIn), p: (pIn + product(aIn, w)) | 0 };
}
export function newArray(n) { return { n, w: matrix(n), a: matrix(n), p: matrix(n) }; }
export function peWeights(W) { return matrix(W.length, (r, c) => sext8(W[c][r])); }
export function arrayInputs(arr, aLeft) {
 const { n } = arr;
 const aIn = matrix(n, (r, c) => (c === 0 ? sext8(aLeft[r] ?? 0) : arr.a[r][c - 1]));
 const pIn = matrix(n, (r, c) => (r === 0 ? 0 : arr.p[r - 1][c]));
 return { aIn, pIn, prod: matrix(n, (r, c) => product(aIn[r][c], arr.w[r][c])) };
}
export function arrayStep(arr, aLeft, wLoad = false, wNext = null) {
 const { n } = arr;
 const { aIn, pIn } = arrayInputs(arr, aLeft);
 const next = newArray(n);
 for (let r = 0; r < n; r++) {
 for (let c = 0; c < n; c++) {
 const q = pe({ w: arr.w[r][c] }, { wLoad, wIn: wLoad ? wNext[r][c] : 0, aIn: aIn[r][c], pIn: pIn[r][c] });
 next.w[r][c] = q.w; next.a[r][c] = q.a; next.p[r][c] = q.p;
 }
 }
 return next;
}
export function bottom(arr) { return arr.p[arr.n - 1].slice(); }
export function skewInput(s, X, n) {
 return Array.from({ length: n }, (_, r) => (s - r >= 0 && s - r < X.length ? sext8(X[s - r][r]) : 0));
}
export function runArray(W, X) {
 const n = W.length;
 if (!(n >= 1) || W.some((row) => row.length !== n)) throw new Error('the weight matrix must be square');
 const batch = Array.isArray(X[0]) ? X : [X];
 if (batch.some((x) => x.length !== n)) throw new Error(`every vector needs ${n} elements`);
 const B = batch.length;
 let arr = arrayStep(newArray(n), new Array(n).fill(0), true, peWeights(W));
 const y = Array.from({ length: B }, () => ({ values: new Array(n).fill(0), steps: new Array(n).fill(0) }));
 const steps = [];
 for (let s = 0; s < B + 2 * n - 1; s++) {
 const aLeft = skewInput(s, batch, n);
 const out = [];
 const bot = bottom(arr);
 for (let c = 0; c < n; c++) {
 const b = s - n - c;
 if (b >= 0 && b < B) { out.push({ b, c, y: bot[c] }); y[b].values[c] = bot[c]; y[b].steps[c] = s; }
 }
 const comb = arrayInputs(arr, aLeft);
 arr = arrayStep(arr, aLeft);
 steps.push({ step: s, aLeft, ...comb, w: arr.w, a: arr.a, p: arr.p, out });
 }
 return { n, B, steps, y: y.map((v) => v.values), outSteps: y.map((v) => v.steps) };
}
export function ctrlStep(ctrl, { start = false, clear = false } = {}, n = NPU_N) {
 const { state, step, done } = ctrl;
 if (state === 'IDLE') return { state: start ? 'LOADW' : 'IDLE', step, done: start || clear ? false : done };
 if (state === 'LOADW') return { state: 'RUN', step: 0, done };
 if (step < 2 * n - 1) return { state: 'RUN', step: step + 1, done };
 return { state: 'IDLE', step, done: true };
}
export function ctrlOutputs({ state, step, done }) {
 return { busy: state !== 'IDLE', done, w_load: state === 'LOADW', run: state === 'RUN', step };
}
const REGISTERS = [
 { offset: 0x00, name: 'CTRL', width: 2, access: 'wo' },
 { offset: 0x04, name: 'STATUS', width: 2, access: 'ro' },
 ...[0, 1, 2, 3].map((i) => ({ offset: 0x10 + 4 * i, name: `WEIGHT${i}`, width: 32, access: 'rw' })),
 ...[0, 1, 2, 3].map((j) => ({ offset: 0x20 + 4 * j, name: `ACT${j}`, width: 8, access: 'rw' })),
 ...[0, 1, 2, 3].map((i) => ({ offset: 0x30 + 4 * i, name: `RESULT${i}`, width: 32, access: 'ro' })),
];
export function npuRegister(offset) {
 const w = (offset & 0xfff) >>> 2;
 if (w === 0) return 'CTRL';
 if (w === 1) return 'STATUS';
 if (w >= 4 && w < 8) return `WEIGHT${w - 4}`;
 if (w >= 8 && w < 12) return `ACT${w - 8}`;
 if (w >= 12 && w < 16) return `RESULT${w - 12}`;
 return '';
}
export function npuReset(n = NPU_N) {
 return {
 ctrl: { state: 'IDLE', step: 0, done: false },
 weight: new Array(n).fill(0),
 act: new Array(n).fill(0),
 result: new Array(n).fill(0),
 arr: newArray(n),
 };
}
export function npuEdge(S, req, n = NPU_N) {
 const { ctrl } = S;
 if (ctrl.state !== 'IDLE') req = null;
 const word = req ? (req.offset & 0xfff) >>> 2 : -1;
 const start = word === 0 && (req.value & NPU_CTRL.START) !== 0;
 const clear = word === 0 && (req.value & NPU_CTRL.CLEAR) !== 0;
 const run = ctrl.state === 'RUN';
 const wLoad = ctrl.state === 'LOADW';
 const quiet = ctrl.state === 'IDLE';
 let arr = S.arr;
 if (!quiet) {
 const aLeft = Array.from({ length: n }, (_, r) => (run && ctrl.step === r ? S.act[r] : 0));
 const wNext = wLoad ? matrix(n, (r, c) => sext8(S.weight[c] >>> (8 * r))) : null;
 arr = arrayStep(S.arr, aLeft, wLoad, wNext);
 }
 let result = S.result;
 if (run && ctrl.step >= n) {
 const c = ctrl.step - n;
 result = result.slice();
 result[c] = (result[c] + S.arr.p[n - 1][c]) | 0;
 }
 if (clear) result = new Array(n).fill(0);
 let { weight, act } = S;
 if (word >= 4 && word < 4 + n) { weight = weight.slice(); weight[word - 4] = req.value >>> 0; }
 if (word >= 8 && word < 8 + n) { act = act.slice(); act[word - 8] = sext8(req.value); }
 return { ctrl: ctrlStep(ctrl, { start, clear }, n), weight, act, result, arr };
}
export function npuPeek(S, offset, n = NPU_N) {
 const w = (offset & 0xfff) >>> 2;
 if (w === 1) return (S.ctrl.state !== 'IDLE' ? NPU_STATUS.BUSY : 0) | (S.ctrl.done ? NPU_STATUS.DONE : 0);
 if (w >= 4 && w < 4 + n) return S.weight[w - 4] >>> 0;
 if (w >= 8 && w < 8 + n) return S.act[w - 8] >>> 0;
 if (w >= 12 && w < 12 + n) return S.result[w - 12] >>> 0;
 return 0;
}
export function npuSignalInfo(n = NPU_N) {
 const info = {
 sel_acc: { width: 1 }, d_addr: { width: 32 }, d_wdata: { width: 32 }, d_rdata: { width: 32 },
 start: { width: 1 }, clear: { width: 1 }, busy: { width: 1 }, done: { width: 1 },
 w_load: { width: 1 }, run: { width: 1 }, step: { width: 3 },
 w_flat: { width: 32 * n }, act: { width: 8 * n }, result: { width: 32 * n }, psum_bottom: { width: 32 * n },
 };
 for (let r = 0; r < n; r++) {
 info[`a_left[${r}]`] = { width: 8 };
 info[`psum_bottom[${r}]`] = { width: 32 };
 for (let c = 0; c < n; c++) { info[`a[${r}][${c}]`] = { width: 8 }; info[`psum[${r}][${c}]`] = { width: 32 }; }
 }
 return info;
}
export const NPU_SIGNALS = Object.freeze(npuSignalInfo());
export function npuSignals(S, bus = null, n = NPU_N) {
 const o = ctrlOutputs(S.ctrl);
 const { aIn } = arrayInputs(S.arr, Array.from({ length: n }, (_, r) => (o.run && o.step === r ? S.act[r] : 0)));
 const v = {
 sel_acc: bus ? 1 : 0, d_addr: bus ? (NPU_BASE + bus.offset) >>> 0 : 0, d_wdata: bus?.kind === 'write' ? bus.value : 0,
 d_rdata: bus?.kind === 'read' ? bus.value : 0,
 start: bus?.kind === 'write' && !bus.ignored && bus.register === 'CTRL' && (bus.value & NPU_CTRL.START) ? 1 : 0,
 clear: bus?.kind === 'write' && !bus.ignored && bus.register === 'CTRL' && (bus.value & NPU_CTRL.CLEAR) ? 1 : 0,
 busy: o.busy ? 1 : 0, done: o.done ? 1 : 0, w_load: o.w_load ? 1 : 0, run: o.run ? 1 : 0, step: o.step,
 w_flat: S.weight.slice(), act: S.act.slice(), result: S.result.slice(), psum_bottom: bottom(S.arr),
 };
 const active = new Set();
 const live = (s) => o.run && o.step === s;
 for (let r = 0; r < n; r++) {
 v[`a_left[${r}]`] = aIn[r][0];
 v[`psum_bottom[${r}]`] = S.arr.p[n - 1][r];
 if (live(r)) active.add(`skew_r${r}`).add('abuf_skew');
 if (live(n + r)) active.add(`sum${r}`).add('sums_rbuf');
 for (let c = 0; c < n; c++) {
 v[`a[${r}][${c}]`] = S.arr.a[r][c];
 v[`psum[${r}][${c}]`] = S.arr.p[r][c];
 if (live(r + c + 1)) { if (c < n - 1) active.add(`a${r}${c}`); if (r < n - 1) active.add(`p${r}${c}_${r + 1}${c}`); }
 }
 }
 if (o.w_load) active.add('weights').add('w_load');
 if (o.run) active.add('run_step');
 if (bus) {
 active.add('d_bus');
 const reg = bus.register;
 if (bus.kind === 'write' && !bus.ignored) {
 if (reg.startsWith('WEIGHT')) active.add('rif_wbuf');
 if (reg.startsWith('ACT')) active.add('rif_abuf');
 if (reg === 'CTRL') active.add('ctrl_in');
 }
 if (bus.kind === 'read' && reg === 'STATUS') active.add('status');
 if (bus.kind === 'read' && reg.startsWith('RESULT')) active.add('rbuf_rif');
 }
 return { values: v, active };
}
const LOG_LIMIT = 4096;
const newCounters = () => ({ accesses: 0, statusReads: 0, ignoredWrites: 0, runs: 0 });
export class Npu extends Device {
 constructor({ stopOnBusyResult = false } = {}) {
 super({ name: 'NPU', size: 0x1000, registers: REGISTERS, widths: [4] });
 this.widthMessage = 'the NPU takes whole words, Table 11.4';
 this.n = NPU_N;
 this.options = { stopOnBusyResult };
 this.diagnostics = [];
 this.reset();
 }
 reset() {
 this.s = npuReset(this.n);
 this.now = 0;
 this.pending = null;
 this.prev = null;
 this.since = 0;
 this.counters = newCounters();
 this.last = null;
 this.log = [];
 this.logDropped = 0;
 this.diagnostics.length = 0;
 this.stopRequested = false;
 }
 get busy() { return this.s.ctrl.state !== 'IDLE'; }
 get quiescent() { return !this.busy && this.pending === null; }
 canRewind(t) { return t < this.now && this.quiescent && t >= this.since; }
 advance(t) {
 if (t <= this.now) {
 if (this.canRewind(t)) { this.now = t; this.prev = null; }
 return;
 }
 if (this.quiescent) { this.now = t; this.prev = null; return; }
 this.touch();
 while (this.now < t) {
 this.prev = { s: this.s, pending: this.pending };
 this.s = npuEdge(this.s, this.pending, this.n);
 this.pending = null;
 this.now += 1;
 if (this.quiescent) {
 this.since = this.now;
 if (this.now < t) { this.now = t; this.prev = null; break; }
 }
 }
 this.emit();
 }
 tick(cycle) { this.advance(cycle); }
 get visible() { return this.quiescent ? this.s : npuEdge(this.s, this.pending, this.n); }
 peek(offset) { return npuPeek(this.visible, offset, this.n); }
 read(offset, size, ctx) {
 if (ctx.cycle < this.now && !this.canRewind(ctx.cycle)) throw new Error(`NPU: a read of cycle ${ctx.cycle} reached the device at cycle ${this.now}`);
 this.advance(ctx.cycle);
 this.touch();
 const name = npuRegister(offset);
 const value = npuPeek(this.s, offset, this.n);
 this.counters = { ...this.counters, accesses: this.counters.accesses + 1, statusReads: this.counters.statusReads + (name === 'STATUS' ? 1 : 0) };
 let diagnostic = null;
 if (this.busy && name.startsWith('RESULT')) {
 diagnostic = { cycle: ctx.cycle, code: 'result-busy', offset, message: `${name} read while the NPU is busy: the value is partial` };
 this.diagnostics.push(diagnostic);
 if (this.options.stopOnBusyResult) this.stopRequested = true;
 }
 this.last = { kind: 'read', cycle: ctx.cycle, offset, register: name, value, ignored: false, diagnostic };
 this.record(this.last);
 this.emit();
 return value;
 }
 write(offset, size, value, ctx) {
 const t = ctx.cycle - 1;
 const replay = t === this.now - 1 && this.prev !== null && this.prev.pending === null;
 if (t > this.now || (!replay && this.canRewind(t))) this.advance(t);
 let base;
 if (t === this.now) {
 if (this.pending) throw new Error(`NPU: two bus writes in cycle ${t}`);
 base = this.s;
 } else if (replay) {
 base = this.prev.s;
 } else {
 throw new Error(`NPU: a write of cycle ${t} reached the device at cycle ${this.now}`);
 }
 this.touch();
 const name = npuRegister(offset);
 const ignored = base.ctrl.state !== 'IDLE';
 const c = this.counters;
 this.counters = { ...c, accesses: c.accesses + 1, ignoredWrites: c.ignoredWrites + (ignored ? 1 : 0),
 runs: c.runs + (!ignored && name === 'CTRL' && (value & NPU_CTRL.START) ? 1 : 0) };
 this.last = { kind: 'write', cycle: t, offset, register: name, value: value >>> 0, ignored, diagnostic: null };
 this.record(this.last);
 if (!ignored) {
 const req = { offset, value: value >>> 0 };
 if (base === this.s) this.pending = req;
 else { this.prev = { s: base, pending: req }; this.s = npuEdge(base, req, this.n); this.since = this.now; }
 }
 this.emit();
 }
 record(entry) {
 if (this.log.length < LOG_LIMIT) this.log.push(entry); else this.logDropped += 1;
 }
 nextEvent() { return null; }
 snapshot() {
 return { s: this.s, now: this.now, pending: this.pending, prev: this.prev, since: this.since, counters: this.counters,
 last: this.last, diagLen: this.diagnostics.length, stopRequested: this.stopRequested, logLen: this.log.length, logDropped: this.logDropped };
 }
 restore(st) {
 Object.assign(this, { s: st.s, now: st.now, pending: st.pending, prev: st.prev, since: st.since, counters: st.counters,
 last: st.last, stopRequested: st.stopRequested });
 this.diagnostics.length = st.diagLen;
 this.log.length = Math.min(this.log.length, st.logLen ?? 0);
 this.logDropped = st.logDropped ?? 0;
 this.emit();
 }
 view() {
 const s = this.visible;
 const m = (a) => a.map((row) => row.slice());
 return { cycle: this.now + 1, ctrl: { state: s.ctrl.state, ...ctrlOutputs(s.ctrl) },
 regs: { weight: s.weight.slice(), act: s.act.slice(), result: s.result.slice() },
 array: { w: m(s.arr.w), a: m(s.arr.a), p: m(s.arr.p) }, bus: this.last && { ...this.last }, counters: { ...this.counters } };
 }
}
