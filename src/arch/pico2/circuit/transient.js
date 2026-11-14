// pico2/circuit/transient.js -- capacitors (P1-B2 stage B2-2; design docs/architecture/pico2-p1b2-user-circuits.md §2.5, research
// D50 "capacitors from the start", D51 Q9 A "exact for every edge"). For an island with m capacitors and given element states the
// rest of the island is linear, so (superposition, one LU factorisation) the node voltages are affine in the capacitors' currents,
// x = x0 + K·i, and the capacitors' voltages are w = A − R·i, hence i = M·(A − w) with M = R⁻¹: the island seen from its
// capacitors (A: the voltages they settle to; R: the Thevenin resistance matrix). The capacitors obey C·dw/dt = i = M·(A − w).
//  - one capacitor: w(t) = A + (w0 − A)·e^(−t/τ), τ = C/M; every quantity the machine reads (a pin's voltage against its switching
//    point, a diode's or transistor's region boundary) is affine in w, so its crossing time is closed form,
//    t = τ·ln((q0 − q∞)/(q_threshold − q∞)): no stepping, exact to the cycle (rounded up);
//  - several: backward Euler on the m × m system, (C/h + M)·w1 = (C/h)·w0 + M·A, h = min τ_k / 20 (E-CIRC-SOLVER-1), crossings
//    interpolated linearly within a step.
// Settled when every capacitor is within 1 mV of A; then w := A and the island sleeps. All functions are pure (cached per pads'
// codes, controls and element states); exp and log are the module's own (mathx.js), so that every engine gives the same cycles.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { IslandSolver, luFactor, luApply, Q_ACTIVE, Q_SAT } from './solve.js';
import { RAIL_V } from './netlist.js';
import { exp, log } from './mathx.js';

export const SETTLE_V = 1e-3;          // V: settled within 1 mV of the final voltage
export const STEPS_PER_TAU = 20;       // backward Euler: h = τ_min / 20 (E-CIRC-SOLVER-1: about 93 steps to settle within 1 %)
const CACHE_KEYS = 256;
const at = (x, t) => (t >= 0 ? x[t] : RAIL_V[-t - 1]);
const STILL = Object.freeze({ kind: 'still' });

export class CapIsland {
  /** @param {object} isl an island of netlist.js compile() with capacitors (isl.caps: their primitive indices) */
  constructor(isl) {
    this.isl = isl; this.sv = new IslandSolver(isl); this.n = isl.n;
    this.caps = isl.caps.map((i) => isl.prims[i]); this.m = this.caps.length;
    this.cache = new Map(); this.num = new Map();
  }

  /** The affine maps for the pads' codes, the controls and the element states: {x0, K (columns), A, M (m × m), tau}. Cached. */
  affine(codes, ctrl, st) {
    // a small island (≤ 3 pads, no controls, ≤ 10 piecewise-linear elements) has a numeric key: no string on every edge
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
    // column k: the node voltages for 1 A through capacitor k (from its a to its b terminal), the island's sources at zero
    const K = caps.map((c) => { const e = new Float64Array(n); if (c.a >= 0) e[c.a] -= 1; if (c.b >= 0) e[c.b] += 1; return luApply(F, e); });
    const A = Float64Array.from(caps, (c) => at(x0, c.a) - at(x0, c.b));
    const R = new Float64Array(m * m);
    caps.forEach((c, k) => K.forEach((col, j) => { R[k * m + j] = -((c.a >= 0 ? col[c.a] : 0) - (c.b >= 0 ? col[c.b] : 0)); }));
    const FR = luFactor(R, m), M = new Float64Array(m * m);
    for (let j = 0; j < m; j++) { const e = new Float64Array(m); e[j] = 1; const col = luApply(FR, e); for (let k = 0; k < m; k++) M[k * m + j] = col[k]; }
    const tau = Float64Array.from(caps, (c, k) => c.c / M[k * m + k]); // each capacitor's own time constant, the others held
    // one capacitor: every node voltage is a line in its voltage w, x_j = alpha_j + beta_j·w (i = M·(A − w))
    const lin = m === 1 ? { alpha: Array.from(x0, (v, j) => v + K[0][j] * M[0] * A[0]), beta: Array.from(x0, (v, j) => -K[0][j] * M[0]) } : null;
    const af = { x0, K, A, M, tau, key, lin, st: Uint8Array.from(st), exp: null, be: null, _ckGen: 0, _ckIe: -1, // (memos declared: one shape)
      floating: this.sv.floating(codes, ctrl, st), bounds: this.boundaries(st) }; // both depend on the states only
    this.cache.set(key, af);
    if (this.cache.size > CACHE_KEYS) this.cache.delete(this.cache.keys().next().value);
    if (num >= 0) { if (this.num.size >= CACHE_KEYS) this.num.clear(); this.num.set(num, af); }
    return af;
  }

  /** The capacitors' currents and the node voltages at capacitor voltages w: {i, x}. */
  nodes(af, w) {
    const { n, m } = this;
    if (af.lin) { // one capacitor: the lines (plain arrays: small typed arrays are slow to make on every edge)
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

  /** The element states consistent at capacitor voltages w, from `start`: {st, af, x, i, settled}. */
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

  /** One backward-Euler step of h seconds from w0: (C/h + M)·w1 = (C/h)·w0 + M·A. */
  beStep(af, w0, h) {
    const m = this.m;
    // (C/h + M) factorised and M·A computed once per map and step size
    if (!af.be || af.be.h !== h) {
      const B = Float64Array.from(af.M), MA = new Float64Array(m);
      for (let k = 0; k < m; k++) { B[k * m + k] += this.caps[k].c / h; let s = 0; for (let j = 0; j < m; j++) s += af.M[k * m + j] * af.A[j]; MA[k] = s; }
      af.be = { h, F: luFactor(B, m), MA };
    }
    const b = new Float64Array(m);
    for (let k = 0; k < m; k++) b[k] = (this.caps[k].c / h) * w0[k] + af.be.MA[k];
    return luApply(af.be.F, b);
  }

  /**
   * The trajectory from w0 under the affine maps af: {kind 'exp' (one capacitor: tau, A) | 'be' (h, w1) | 'still' (settled)}.
   */
  trajectory(af, w0) {
    let far = false;
    for (let k = 0; k < af.A.length; k++) if (Math.abs(w0[k] - af.A[k]) > SETTLE_V) { far = true; break; }
    if (!far) return STILL;
    // one capacitor: the trajectory depends on the map only (kept on it; trajectories are never changed after they are made)
    if (this.m === 1) return af.exp ?? (af.exp = Object.freeze({ kind: 'exp', tau: af.tau[0], A: af.A[0] }));
    const h = Math.min(...af.tau) / STEPS_PER_TAU;
    return { kind: 'be', h, w1: this.beStep(af, w0, h) };
  }
  /** The capacitors' voltages t seconds into a trajectory from w0. */
  static wAt(tr, w0, t) {
    if (tr.kind === 'still') return Array.from(w0);
    if (tr.kind === 'exp') return [tr.A + (w0[0] - tr.A) * exp(-t / tr.tau)];
    const f = Math.min(1, Math.max(0, t / tr.h)), out = new Array(w0.length);
    for (let k = 0; k < w0.length; k++) out[k] = w0[k] + (tr.w1[k] - w0[k]) * f;
    return out;
  }
  /** The end of a trajectory: where it goes (exp: A; be: the step's w1). */
  static wEnd(tr, w0) { return tr.kind === 'exp' ? [tr.A] : tr.kind === 'be' ? tr.w1 : w0; }

  /**
   * The time (seconds, > 0) of the first event of a trajectory: a quantity crossing its threshold (`watch`: [{q(x) → number, thr}]),
   * the island settling (exp), or the end of the step (be); Infinity for none.
   */
  nextTime(tr, af, w0, watch) {
    if (tr.kind === 'still') return Infinity;
    // node voltages at the start and the end; with one capacitor only the watched ones, from its lines
    // (no closures or objects here: this runs on every edge of a capacitor island)
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

  /** The boundaries of the piecewise-linear elements in states st, as quantities of the node voltages: [{q, thr}]. */
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

  /**
   * The integral over [a, b] seconds of a trajectory of a quantity q(x) (affine in w), for an LED's mean current: exact for exp,
   * the trapezoid for be (w is linear within the step), constant for still.
   */
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
