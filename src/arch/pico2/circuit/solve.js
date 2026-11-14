// pico2/circuit/solve.js -- the DC solve of one island (P1-B2; design docs/architecture/pico2-p1b2-user-circuits.md §2.4, research
// D50, D51): nodal analysis (every source has a series resistance or is a rail, which enters the right-hand side), dense LU with
// partial pivoting, G_min to ground on every node; piecewise-linear diodes/LEDs (off, or V_f + R_s) and NPN transistors (cut-off;
// active: V_BE + R_BE with I_C = β·I_B; saturated: V_BE and V_CE(sat) + R_CE), solved from the previous element states and flipped
// until consistent (at most 3k + 2 rounds for k elements). A net with no conductive path to a source is reported floating.
// Results are cached per input key (the pads' codes, the controls' values, the starting element states): a pure function, not
// machine state. Only +, −, ×, ÷ and comparisons in a fixed order: the same bits in every JavaScript engine.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { stampPad, padSources, padAnchors } from './pad.js';
import { RAIL_V } from './netlist.js';
import { SWITCH_RON } from './library.js';

export const G_MIN = 1e-12;
const CACHE_KEYS = 256;
/** Applied voltages are rounded to 10 µV (far below the ADC's 0.8 mV step), so that ideal results read exactly (3.3 V, 1.65 V). */
export const roundV = (v) => Math.round(v * 1e5) / 1e5;

/** Solve A x = b in place (A n × n row-major, b length n) by Gaussian elimination with partial pivoting; returns x (= b). */
export function luSolve(A, b, n) {
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) { const a = Math.abs(A[i * n + k]); if (a > best) { best = a; p = i; } }
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
      const t = b[k]; b[k] = b[p]; b[p] = t;
    }
    const d = A[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / d;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i * n + j] -= f * A[k * n + j];
      b[i] -= f * b[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j];
    b[i] = s / A[i * n + i];
  }
  return b;
}

/** B2-2: factor A (n × n, row-major, copied) once: {lu, piv, n}; solve with luApply for several right-hand sides. */
export function luFactor(A0, n) {
  const A = Float64Array.from(A0), piv = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) { const a = Math.abs(A[i * n + k]); if (a > best) { best = a; p = i; } }
    piv[k] = p;
    if (p !== k) for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
    const d = A[k * n + k];
    for (let i = k + 1; i < n; i++) {
      const f = A[i * n + k] / d;
      A[i * n + k] = f;
      if (f === 0) continue;
      for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
    }
  }
  return { lu: A, piv, n };
}
/** x = A⁻¹ b with a factorisation of luFactor (b is not changed); the same operations in the same order as luSolve. */
export function luApply({ lu, piv, n }, b0) {
  const b = Float64Array.from(b0);
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t; }
    for (let i = k + 1; i < n; i++) { const f = lu[i * n + k]; if (f !== 0) b[i] -= f * b[k]; }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= lu[i * n + j] * b[j];
    b[i] = s / lu[i * n + i];
  }
  return b;
}

// one name per export (the offline build, WS-N-002)
export const Q_CUT = 0;
export const Q_ACTIVE = 1;
export const Q_SAT = 2;

export class IslandSolver {
  /** @param {object} isl an island of netlist.js compile() */
  constructor(isl) {
    this.isl = isl; this.n = isl.n;
    this.G = new Float64Array(this.n * this.n); this.rhs = new Float64Array(this.n);
    this.cache = new Map(); this.num = new Map(); this.solves = 0; this.hits = 0;
    this.pwl = isl.prims.map((p, i) => (p.pwl ? i : -1)).filter((i) => i >= 0);
  }
  /** Volts at a terminal (a node index, or −(rail + 1)). */
  static at(v, t) { return t >= 0 ? v[t] : RAIL_V[-t - 1]; }

  /** A conductance g between terminals a and b, with a source e (volts, from a to b: i = g·(Va − Vb − e)). */
  stamp(a, b, g, e = 0) {
    const n = this.n, G = this.G, r = this.rhs;
    if (a >= 0) { G[a * n + a] += g; r[a] += g * e; if (b >= 0) G[a * n + b] -= g; else r[a] += g * RAIL_V[-b - 1]; }
    if (b >= 0) { G[b * n + b] += g; r[b] -= g * e; if (a >= 0) G[b * n + a] -= g; else r[b] += g * RAIL_V[-a - 1]; }
  }
  closed(p, ctrl) { const on = (ctrl.get(p.control) ?? 0) >= 0.5; return p.nc ? !on : on; }

  /** One linear solve with the element states `st` (capacitors open). */
  linear(codes, ctrl, st) {
    const [G, rhs] = this.build(codes, ctrl, st);
    return luSolve(G, rhs, this.n);
  }
  /** The conductance matrix and right-hand side (copies) for the pads' codes, the controls and the element states; capacitors open. */
  build(codes, ctrl, st) {
    const { n, G, rhs, isl } = this;
    G.fill(0); rhs.fill(0);
    for (let j = 0; j < n; j++) G[j * n + j] += G_MIN;
    isl.pads.forEach((g, i) => stampPad(codes[i], isl.padNodeOf[g], n, G, rhs));
    isl.prims.forEach((p, i) => {
      switch (p.kind) {
        case 'R': this.stamp(p.a, p.b, 1 / Math.max(p.r, 1e-6)); break;
        case 'RX': this.stamp(p.a, p.b, 1 / Math.max(ctrl.get(p.control) ?? 1e6, 1e-6)); break; // B2-4: the environment sets it
        case 'SW': if (this.closed(p, ctrl)) this.stamp(p.a, p.b, 1 / SWITCH_RON); break;
        case 'POT': {
          const f = Math.min(1, Math.max(0, ctrl.get(p.control) ?? 0)), rmin = p.r * 1e-6;
          this.stamp(p.a, p.w, 1 / Math.max(p.r * (1 - f), rmin)); this.stamp(p.w, p.b, 1 / Math.max(p.r * f, rmin)); break;
        }
        case 'D': if (st[i]) this.stamp(p.a, p.k, 1 / p.rs, p.vf); else this.stamp(p.a, p.k, G_MIN); break;
        case 'Q': {
          if (st[i] === Q_CUT) { this.stamp(p.b, p.e, G_MIN); this.stamp(p.c, p.e, G_MIN); break; }
          const g = 1 / p.rbe;
          this.stamp(p.b, p.e, g, p.vbe);
          if (st[i] === Q_SAT) { this.stamp(p.c, p.e, 1 / p.rce, p.vcesat); break; }
          // active: a current β·g·(Vb − Ve − V_BE) into the collector, out of the emitter
          this.stamp(p.c, p.e, G_MIN);
          const k = p.beta * g;
          if (p.c >= 0) { if (p.b >= 0) G[p.c * n + p.b] += k; else rhs[p.c] -= k * RAIL_V[-p.b - 1]; if (p.e >= 0) G[p.c * n + p.e] -= k; else rhs[p.c] += k * RAIL_V[-p.e - 1]; rhs[p.c] += k * p.vbe; }
          if (p.e >= 0) { if (p.b >= 0) G[p.e * n + p.b] -= k; else rhs[p.e] += k * RAIL_V[-p.b - 1]; if (p.e >= 0) G[p.e * n + p.e] += k; rhs[p.e] -= k * p.vbe; }
          break;
        }
        default: break; // 'C': open in a DC solve (circuit/transient.js gives it its current)
      }
    });
    return [G.slice(), rhs.slice()];
  }

  /** The element states a solution `v` asks for, given the states `st` it was solved with. */
  next(v, st) {
    const out = st.slice(), V = IslandSolver.at;
    for (const i of this.pwl) {
      const p = this.isl.prims[i];
      if (p.kind === 'D') {
        const vd = V(v, p.a) - V(v, p.k);
        if (!st[i] && vd > p.vf + 1e-9) out[i] = 1;
        else if (st[i] && (vd - p.vf) / p.rs < -1e-12) out[i] = 0;
      } else {
        const vbe = V(v, p.b) - V(v, p.e), vce = V(v, p.c) - V(v, p.e), ib = (vbe - p.vbe) / p.rbe;
        if (st[i] === Q_CUT) { if (vbe > p.vbe + 1e-9) out[i] = Q_ACTIVE; }
        else if (ib < -1e-12) out[i] = Q_CUT;
        else if (st[i] === Q_ACTIVE) { if (vce < p.vcesat - 1e-9) out[i] = Q_SAT; }
        else { const ic = (vce - p.vcesat) / p.rce; if (ic > p.beta * ib + 1e-12) out[i] = Q_ACTIVE; }
      }
    }
    return out;
  }

  /** The nets with no conductive path to a source (their voltage is G_MIN's, not the circuit's). */
  floating(codes, ctrl, st) {
    const { n, isl } = this, anchored = new Uint8Array(n), adj = Array.from({ length: n }, () => []);
    const edge = (a, b) => { if (a >= 0 && b >= 0) { adj[a].push(b); adj[b].push(a); } else if (a >= 0) anchored[a] = 1; else if (b >= 0) anchored[b] = 1; };
    isl.pads.forEach((g, i) => { if (padAnchors(codes[i])) anchored[isl.padNodeOf[g]] = 1; });
    isl.prims.forEach((p, i) => {
      if (p.kind === 'R' || p.kind === 'RX' || p.kind === 'POT') { edge(p.a, p.kind === 'POT' ? p.w : p.b); if (p.kind === 'POT') edge(p.w, p.b); }
      else if (p.kind === 'SW') { if (this.closed(p, ctrl)) edge(p.a, p.b); }
      else if (p.kind === 'D') { if (st[i]) edge(p.a, p.k); }
      else if (p.kind === 'Q') { if (st[i] !== Q_CUT) edge(p.b, p.e); if (st[i] === Q_SAT) edge(p.c, p.e); }
      else if (p.kind === 'C') edge(p.a, p.b); // B2-2: a capacitor holds its voltage: a net on it is not floating
    });
    const stack = [];
    for (let j = 0; j < n; j++) if (anchored[j]) stack.push(j);
    while (stack.length) { const j = stack.pop(); for (const k of adj[j]) if (!anchored[k]) { anchored[k] = 1; stack.push(k); } }
    return Uint8Array.from(anchored, (a) => 1 - a);
  }

  /**
   * Solve for the pads' codes (in isl.pads order), the controls (a Map id → value) and the element states to start from:
   * {v (raw), vr (rounded), states, floating, current (per primitive, A), settled, key}. Cached.
   */
  solve(codes, ctrl, start) {
    // a small island (≤ 3 pads of 9-bit codes, no controls, ≤ 10 piecewise-linear elements of 2-bit states) has a numeric key,
    // cheaper than a string on every edge of a PWM pin
    let num = -1;
    if (codes.length <= 3 && this.isl.controls.length === 0 && this.pwl.length <= 10) {
      num = 0;
      for (let i = 0; i < codes.length; i++) num = num * 512 + codes[i];
      for (const i of this.pwl) num = num * 4 + start[i];
      const h = this.num.get(num);
      if (h) { this.hits++; return h; }
    }
    const key = `${codes.join(',')}|${this.isl.controls.map((c) => ctrl.get(c) ?? 0).join(',')}|${start.join('')}`;
    const hit = this.cache.get(key);
    if (hit) { this.hits++; this.cache.delete(key); this.cache.set(key, hit); if (num >= 0) this.num.set(num, hit); return hit; }
    this.solves++;
    let st = Uint8Array.from(start), v = null, settled = false;
    const rounds = 3 * this.pwl.length + 2;
    for (let r = 0; r < rounds; r++) {
      v = this.linear(codes, ctrl, st);
      const nx = this.next(v, st);
      if (nx.every((x, i) => x === st[i])) { settled = true; break; }
      st = nx;
    }
    if (!settled) v = this.linear(codes, ctrl, st);
    const res = { key, v, vr: Float64Array.from(v, roundV), states: st, floating: this.floating(codes, ctrl, st), current: this.currents(v, st, ctrl), settled, padI: this.padCurrents(v, codes),
      // the machine's memos (soc/circuit.js: the warnings checked, the next result of a one-pad island), declared here so that every
      // result has one shape (fields added later made the per-edge reads slower)
      _ckGen: 0, _ckIe: -1, _toGen: 0, _toC: -1, _toR: null };
    this.cache.set(key, res);
    if (this.cache.size > CACHE_KEYS) this.cache.delete(this.cache.keys().next().value);
    if (num >= 0) { if (this.num.size >= CACHE_KEYS) this.num.clear(); this.num.set(num, res); }
    return res;
  }
  /** The current through each primitive from its a (or c) terminal to its b (or e/k) terminal, amperes. */
  currents(v, st, ctrl) {
    const V = IslandSolver.at;
    return Float64Array.from(this.isl.prims, (p, i) => {
      switch (p.kind) {
        case 'R': return (V(v, p.a) - V(v, p.b)) / Math.max(p.r, 1e-6);
        case 'RX': return (V(v, p.a) - V(v, p.b)) / Math.max(ctrl.get(p.control) ?? 1e6, 1e-6);
        case 'SW': return this.closed(p, ctrl) ? (V(v, p.a) - V(v, p.b)) / SWITCH_RON : 0;
        case 'POT': { const f = Math.min(1, Math.max(0, ctrl.get(p.control) ?? 0)); return (V(v, p.a) - V(v, p.w)) / Math.max(p.r * (1 - f), p.r * 1e-6); }
        case 'D': return st[i] ? (V(v, p.a) - V(v, p.k) - p.vf) / p.rs : 0;
        case 'Q': { if (st[i] === Q_CUT) return 0; const ib = (V(v, p.b) - V(v, p.e) - p.vbe) / p.rbe; return st[i] === Q_ACTIVE ? p.beta * ib : (V(v, p.c) - V(v, p.e) - p.vcesat) / p.rce; }
        default: return 0;
      }
    });
  }
  /** Per pad: the current out of each of its sources into the net [[role, amperes]] (positive: sourced by the pad). */
  padCurrents(v, codes) {
    return this.isl.pads.map((g, i) => { const vn = v[this.isl.padNodeOf[g]]; return padSources(codes[i]).map(([e, r, role]) => [role, (e - vn) / r]); });
  }
}
