// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { IslandSolver, luFactor, luApply, Q_ACTIVE, Q_SAT } from './solve.js';
import { RAIL_V } from './netlist.js';
import { exp, log } from './mathx.js';
export const SETTLE_V = 1e-3;
export const STEPS_PER_TAU = 20;
const CACHE_KEYS = 256;
const at = (x, t) => (t >= 0 ? x[t] : RAIL_V[-t - 1]);
const STILL = Object.freeze({ kind: 'still' });
export class CapIsland {
 constructor(isl) {
 this.isl = isl; this.sv = new IslandSolver(isl); this.n = isl.n;
 this.caps = isl.caps.map((i) => isl.prims[i]); this.m = this.caps.length;
 this.cache = new Map(); this.num = new Map();
 }
 affine(codes, ctrl, st) {
 let num = -1;
 if (codes.length <= 3 && this.isl.controls.length === 0 && this.sv.pwl.length <= 10) {
 num = 0;
 for (let i = 0; i < codes.length; i++) num = num * 512 + codes[i];
 for (const i of this.sv.pwl) num = num * 4 + st[i];
 const h = this.num.get(num);
 if (h) return h;
 }
 const key = `${codes.join(',')}|${this.isl.controls.map((c) => ctrl.get(c) ?? 0).join(',')}|${st.join('')}`;
 const hit = this.cache.get(key);
 if (hit) { if (num >= 0) this.num.set(num, hit); return hit; }
 const { n, m, caps } = this;
 const [G, rhs] = this.sv.build(codes, ctrl, st);
 const F = luFactor(G, n);
 const x0 = luApply(F, rhs);
 const K = caps.map((c) => { const e = new Float64Array(n); if (c.a >= 0) e[c.a] -= 1; if (c.b >= 0) e[c.b] += 1; return luApply(F, e); });
 const A = Float64Array.from(caps, (c) => at(x0, c.a) - at(x0, c.b));
 const R = new Float64Array(m * m);
 caps.forEach((c, k) => K.forEach((col, j) => { R[k * m + j] = -((c.a >= 0 ? col[c.a] : 0) - (c.b >= 0 ? col[c.b] : 0)); }));
 const FR = luFactor(R, m), M = new Float64Array(m * m);
 for (let j = 0; j < m; j++) { const e = new Float64Array(m); e[j] = 1; const col = luApply(FR, e); for (let k = 0; k < m; k++) M[k * m + j] = col[k]; }
 const tau = Float64Array.from(caps, (c, k) => c.c / M[k * m + k]);
 const lin = m === 1 ? { alpha: Array.from(x0, (v, j) => v + K[0][j] * M[0] * A[0]), beta: Array.from(x0, (v, j) => -K[0][j] * M[0]) } : null;
 const af = { x0, K, A, M, tau, key, lin, st: Uint8Array.from(st), exp: null, be: null, _ckGen: 0, _ckIe: -1,
 floating: this.sv.floating(codes, ctrl, st), bounds: this.boundaries(st) };
 this.cache.set(key, af);
 if (this.cache.size > CACHE_KEYS) this.cache.delete(this.cache.keys().next().value);
 if (num >= 0) { if (this.num.size >= CACHE_KEYS) this.num.clear(); this.num.set(num, af); }
 return af;
 }
 nodes(af, w) {
 const { n, m } = this;
 if (af.lin) {
 const wv = w[0], { alpha, beta } = af.lin, x = new Array(n);
 for (let j = 0; j < n; j++) x[j] = alpha[j] + beta[j] * wv;
 return { i: [af.M[0] * (af.A[0] - wv)], x };
 }
 const d = new Array(m), i = new Array(m), x = Array.from(af.x0);
 for (let k = 0; k < m; k++) d[k] = af.A[k] - w[k];
 for (let k = 0; k < m; k++) { let s = 0; for (let j = 0; j < m; j++) s += af.M[k * m + j] * d[j]; i[k] = s; }
 for (let k = 0; k < m; k++) { const col = af.K[k], ik = i[k]; if (ik !== 0) for (let j = 0; j < n; j++) x[j] += col[j] * ik; }
 return { i, x };
 }
 statesAt(codes, ctrl, w, start) {
 if (this.sv.pwl.length === 0) { const af = this.affine(codes, ctrl, start), { x, i } = this.nodes(af, w); return { st: start, af, x, i, settled: true }; }
 let st = Uint8Array.from(start);
 const rounds = 3 * this.sv.pwl.length + 2;
 for (let r = 0; r < rounds; r++) {
 const af = this.affine(codes, ctrl, st), { x, i } = this.nodes(af, w);
 const nx = this.sv.next(x, st);
 if (nx.every((v, j) => v === st[j])) return { st, af, x, i, settled: true };
 st = nx;
 }
 const af = this.affine(codes, ctrl, st), { x, i } = this.nodes(af, w);
 return { st, af, x, i, settled: false };
 }
 beStep(af, w0, h) {
 const m = this.m;
 if (!af.be || af.be.h !== h) {
 const B = Float64Array.from(af.M), MA = new Float64Array(m);
 for (let k = 0; k < m; k++) { B[k * m + k] += this.caps[k].c / h; let s = 0; for (let j = 0; j < m; j++) s += af.M[k * m + j] * af.A[j]; MA[k] = s; }
 af.be = { h, F: luFactor(B, m), MA };
 }
 const b = new Float64Array(m);
 for (let k = 0; k < m; k++) b[k] = (this.caps[k].c / h) * w0[k] + af.be.MA[k];
 return luApply(af.be.F, b);
 }
 trajectory(af, w0) {
 let far = false;
 for (let k = 0; k < af.A.length; k++) if (Math.abs(w0[k] - af.A[k]) > SETTLE_V) { far = true; break; }
 if (!far) return STILL;
 if (this.m === 1) return af.exp ?? (af.exp = Object.freeze({ kind: 'exp', tau: af.tau[0], A: af.A[0] }));
 const h = Math.min(...af.tau) / STEPS_PER_TAU;
 return { kind: 'be', h, w1: this.beStep(af, w0, h) };
 }
 static wAt(tr, w0, t) {
 if (tr.kind === 'still') return Array.from(w0);
 if (tr.kind === 'exp') return [tr.A + (w0[0] - tr.A) * exp(-t / tr.tau)];
 const f = Math.min(1, Math.max(0, t / tr.h)), out = new Array(w0.length);
 for (let k = 0; k < w0.length; k++) out[k] = w0[k] + (tr.w1[k] - w0[k]) * f;
 return out;
 }
 static wEnd(tr, w0) { return tr.kind === 'exp' ? [tr.A] : tr.kind === 'be' ? tr.w1 : w0; }
 nextTime(tr, af, w0, watch) {
 if (tr.kind === 'still') return Infinity;
 let lin = af.lin;
 if (lin) for (let k = 0; k < watch.length; k++) if (watch[k].q) { lin = null; break; }
 let p = null, q = null;
 if (!lin) { p = this.nodes(af, w0).x; q = this.nodes(af, CapIsland.wEnd(tr, w0)).x; }
 const a = w0[0], e = tr.A;
 let best = Infinity;
 if (tr.kind === 'exp') {
 const d = Math.abs(w0[0] - tr.A);
 best = d > SETTLE_V ? tr.tau * log(d / SETTLE_V) : 0;
 } else best = tr.h;
 for (let k = 0; k < watch.length; k++) {
 const wq = watch[k], thr = wq.thr;
 const q0 = wq.q ? wq.q(p) : lin ? lin.alpha[wq.j] + lin.beta[wq.j] * a : p[wq.j];
 const qE = wq.q ? wq.q(q) : lin ? lin.alpha[wq.j] + lin.beta[wq.j] * e : q[wq.j];
 if (!((q0 - thr) * (qE - thr) < 0)) continue;
 const t = tr.kind === 'exp' ? tr.tau * log((q0 - qE) / (thr - qE)) : tr.h * ((thr - q0) / (qE - q0));
 if (t > 0 && t < best) best = t;
 }
 return best;
 }
 boundaries(st) {
 const out = [];
 for (const i of this.sv.pwl) {
 const p = this.isl.prims[i];
 if (p.kind === 'D') { out.push({ q: (x) => at(x, p.a) - at(x, p.k), thr: p.vf }); continue; }
 const vbe = (x) => at(x, p.b) - at(x, p.e);
 out.push({ q: vbe, thr: p.vbe });
 if (st[i] === Q_ACTIVE) out.push({ q: (x) => at(x, p.c) - at(x, p.e), thr: p.vcesat });
 else if (st[i] === Q_SAT) out.push({ q: (x) => (at(x, p.c) - at(x, p.e) - p.vcesat) / p.rce - (p.beta * (vbe(x) - p.vbe)) / p.rbe, thr: 0 });
 }
 return out;
 }
 integral(tr, af, w0, q, a, b) {
 if (b <= a) return 0;
 if (tr.kind === 'still') return q(this.nodes(af, w0).x) * (b - a);
 if (tr.kind === 'exp') {
 const q0 = q(this.nodes(af, w0).x), qE = q(this.nodes(af, Float64Array.of(tr.A)).x);
 return qE * (b - a) + (q0 - qE) * tr.tau * (exp(-a / tr.tau) - exp(-b / tr.tau));
 }
 const qa = q(this.nodes(af, CapIsland.wAt(tr, w0, a)).x), qb = q(this.nodes(af, CapIsland.wAt(tr, w0, b)).x);
 return ((qa + qb) / 2) * (b - a);
 }
}
