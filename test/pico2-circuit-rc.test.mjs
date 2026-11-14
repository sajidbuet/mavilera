// P1-B2 stage B2-2 (design docs/architecture/pico2-p1b2-user-circuits.md §2.5, §5.2-§5.4): capacitors against hand calculation,
// each calculation in a comment. A single RC in closed form (Thevenin seen by the capacitor; the cycle at which its net crosses the
// input's switching point, exact); a square wave into an RC (the steady state of the two exponentials); an ADC conversion sampling a
// charging net at its own cycle; two capacitors (backward Euler) against the exact solution of the 2 × 2 system; replay from reset
// and a snapshot with a capacitor charging; own exp/log.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/pico2/index.js';
import { validateCircuit, FORMAT } from '../src/arch/pico2/circuit/format.js';
import { compile } from '../src/arch/pico2/circuit/netlist.js';
import { CapIsland, SETTLE_V } from '../src/arch/pico2/circuit/transient.js';
import { R_OUT_HIGH, R_OUT_LOW, R_PD, V_RISE, V_FALL } from '../src/arch/pico2/circuit/pad.js';
import { exp, log } from '../src/arch/pico2/circuit/mathx.js';
import { build } from '../tools/pico2/record-circuit-compat.mjs';

const index = JSON.parse(readFileSync(new URL('../content/pico2/templates/index.json', import.meta.url), 'utf8'));
const tpl = (id) => index.templates.find((t) => t.id === id);
const circ = (parts, wires) => ({ format: FORMAT, version: 1, parts: parts.map((p) => ({ x: 0, y: 0, ...p })), wires: wires.map(([a, b]) => ({ a, b })) });
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-12), `${msg}: ${a} vs ${b}`);
const HIGH = 2 | (1 << 2), LOW = 1 | (1 << 2), NONE = 0; // pad codes (circuit/pad.js): chip high/low at 4 mA; an input without pulls
// GP16 → R 10 kΩ → net N1 → C to GND; GP17 reads N1
const RC = (r = '10k', c = '1u') => circ([{ id: 'R1', type: 'resistor', value: r }, { id: 'C1', type: 'capacitor', value: c }],
  [['GP16', 'R1.1'], ['R1.2', 'C1.1'], ['C1.2', 'GND'], ['C1.1', 'GP17']]);

test('own exp and log: equal to Math within 2 units in the last place, exact where they must be', () => {
  for (let i = 0; i <= 2000; i++) { const x = i / 25 - 40; const e = exp(x); assert.ok(Math.abs(e - Math.exp(x)) <= 4.5e-16 * Math.exp(x), `exp(${x})`); }
  for (let i = 1; i <= 2000; i++) { const y = i * 0.37; assert.ok(Math.abs(log(y) - Math.log(y)) <= 4.5e-16 * Math.max(1, Math.abs(Math.log(y))), `log(${y})`); }
  assert.deepEqual([exp(0), log(1), exp(-Infinity), log(0)], [1, 0, 0, -Infinity]);
});

test('one RC: the island seen from its capacitor, and the crossing time in closed form', () => {
  const k = compile(validateCircuit(RC())), isl = k.islands[k.padIsland[16]];
  assert.deepEqual(isl.pads.sort(), [16, 17]);
  const ci = new CapIsland(isl);
  const codes = isl.pads.map((g) => (g === 16 ? HIGH : NONE));
  const af = ci.affine(codes, new Map(), new Uint8Array(isl.prims.length));
  // Thevenin: 3.3 V behind R_out + 10 kΩ = 10 045 Ω; τ = 10 045 Ω × 1 µF = 10.045 ms
  const R = R_OUT_HIGH[1] + 10e3, tau = R * 1e-6;
  // (G_MIN, 1e-12 S on every node, shifts them by about 1e-8 relative)
  rel(af.A[0], 3.3, 1e-7, 'A'); rel(af.tau[0], tau, 1e-7, 'τ');
  // from 0 V the net crosses the rising point 1.75 V at t = τ·ln(3.3 / (3.3 − 1.75)) = 7.587 ms
  const w0 = Float64Array.of(0), tr = ci.trajectory(af, w0), j = isl.padNodeOf[17];
  const t = ci.nextTime(tr, af, w0, [{ q: (x) => x[j], thr: V_RISE }]);
  rel(t, tau * Math.log(3.3 / (3.3 - V_RISE)), 1e-7, 'crossing');
  // without a threshold to cross, the next event is settling within 1 mV: τ·ln(3.3 / 1 mV)
  rel(ci.nextTime(tr, af, w0, []), tau * Math.log(3.3 / SETTLE_V), 1e-7, 'settling');
  // the voltage on the way: v(t) = 3.3·(1 − e^(−t/τ))
  rel(CapIsland.wAt(tr, w0, af.tau[0])[0], af.A[0] * (1 - Math.exp(-1)), 1e-12, 'v(τ)');
});

/** An engine running blink-c (which touches only GP25) with the circuit; GP16 as an SIO output and GP17 as an input, both without pulls. */
function rig(circuit) {
  const e = descriptor.engine.create(build(tpl('blink-c')), { runLimit: Infinity });
  e.configure({ circuit });
  e.advance({ cycles: 200_000 }); // past the program's clock set-up
  const m = e.machine, ups = [];
  const io = m.pio.inputChanged.bind(m.pio);
  m.pio.inputChanged = (n, input, now) => { if (n === 17) ups.push([now, input]); return io(n, input, now); };
  // GP16: SIO function, 4 mA, input on, no pulls, not isolated, Schmitt on (as at reset); GP17 the same, an input (RP-001 §9.11.3 Table 885)
  m.pins.ctrl[16] = 5; m.pins.pad[16] = 0x40 | 0x10 | 0x2; m.pins.pad[17] = 0x40 | 0x10 | 0x2;
  m.sio.gpioOe |= 1 << 16; m.pins.update(17);
  const drive = (v) => { if (v) m.sio.gpioOut |= 1 << 16; else m.sio.gpioOut &= ~(1 << 16); m.pins.update(16); };
  drive(0); m.pins.update(16);
  return { e, m, ups, drive };
}

test('one RC in the machine: GP17 reads 1 at the cycle of the closed form, and 0 again on the way down', () => {
  const { e, m, ups, drive } = rig(RC());
  e.advance({ cycles: 400_000 }); // discharged (it starts at 0 V anyway)
  const f = m.freq.sys, c0 = m.hart.ticks;
  drive(1);
  e.advance({ cycles: Math.ceil(0.05 * f) });
  const tauH = (R_OUT_HIGH[1] + 10e3) * 1e-6;
  const up = ups.find((u) => u[1] === 1);
  assert.ok(up, 'GP17 rose');
  // the event is at the first cycle at or after the crossing: c0 + ⌈τ·ln(3.3/1.55)·f⌉
  assert.equal(up[0], c0 + Math.ceil(tauH * log(3.3 / (3.3 - V_RISE)) * f));
  // now fully charged (50 ms = 5 τ: within 1 mV of 3.3 V after 9.0 τ; check the voltage on the way, then down)
  const c1 = m.hart.ticks, v1 = m.circuit.wNow(m.k ? 0 : m.circuit.k.padIsland[16])[0];
  rel(v1, 3.3 * (1 - Math.exp(-(c1 - c0) / f / tauH)), 1e-7, 'v after 50 ms');
  drive(0);
  e.advance({ cycles: Math.ceil(0.05 * f) });
  const tauL = (R_OUT_LOW[1] + 10e3) * 1e-6;
  const down = ups.find((u) => u[1] === 0 && u[0] > c1);
  // from v1 down to the falling point 1.55 V: t = τ_L·ln(v1 / 1.55)
  assert.equal(down[0], c1 + Math.ceil(tauL * log(v1 / V_FALL) * f));
});

test('a 50 % square wave into an RC reaches the steady state of the two exponentials; the ADC samples a charging net', () => {
  // 1 kHz on GP16 into 10 kΩ / 1 µF: high half-period a = e^(−T/2/τ_H), low b = e^(−T/2/τ_L);
  // steady state at the end of a high half: v1 = 3.3·(1 − a)/(1 − a·b); at the end of a low half: v0 = v1·b
  const { e, m, drive } = rig(RC());
  const f = m.freq.sys, half = Math.round(0.0005 * f);
  const T2 = half / f, a = Math.exp(-T2 / ((R_OUT_HIGH[1] + 10e3) * 1e-6)), b = Math.exp(-T2 / ((R_OUT_LOW[1] + 10e3) * 1e-6));
  const v1 = (3.3 * (1 - a)) / (1 - a * b), v0 = v1 * b;
  const ii = m.circuit.k.padIsland[16];
  let hi = 0, lo = 0;
  for (let p = 0; p < 400; p++) {           // 400 periods: 40 τ, the start long forgotten
    drive(1); e.advance({ cycles: half }); hi = m.circuit.wNow(ii)[0];
    drive(0); e.advance({ cycles: half }); lo = m.circuit.wNow(ii)[0];
  }
  rel(hi, v1, 1e-6, 'top of the ripple'); rel(lo, v0, 1e-6, 'bottom of the ripple');
  // the mean is near 1.65 V and, with τ much longer than T/2, the ripple about 1.65 V × T/2 / τ = 0.082 V
  assert.ok(Math.abs((hi + lo) / 2 - 1.65) < 0.01 && hi - lo > 0.07 && hi - lo < 0.09, `${hi} ${lo}`);
  // ADC input 1 is GP27: a second RC from GP16 to GP27 (10 kΩ, 10 µF); GP27's pad keeps its reset pull-down (64 kΩ), so the
  // capacitor sees A = 3.3·Rp/(Rp + R) behind R ∥ Rp (R = R_out + 10 kΩ); 20 ms after GP16 rises, a conversion samples
  // A·(1 − e^(−t/τ)), τ = 10 µF × (R ∥ Rp), at its own cycle
  const e2 = rig(circ([{ id: 'R1', type: 'resistor', value: '10k' }, { id: 'C1', type: 'capacitor', value: '10u' }], [['GP16', 'R1.1'], ['R1.2', 'GP27'], ['GP27', 'C1.1'], ['C1.2', 'GND']]));
  const c0 = e2.m.hart.ticks; e2.drive(1);
  e2.e.advance({ cycles: Math.round(0.02 * f) });
  const Rr = R_OUT_HIGH[1] + 10e3, Rp = R_PD, A = (3.3 * Rp) / (Rp + Rr), tauA = 10e-6 * ((Rr * Rp) / (Rr + Rp));
  const t = (e2.m.hart.ticks - c0) / f, want = A * (1 - Math.exp(-t / tauA));
  assert.ok(Math.abs(e2.m.adc.input(1) - want) < 2e-5, `${e2.m.adc.input(1)} vs ${want}`);
  void lo;
});

test('two capacitors (backward Euler at τ/20) against the exact solution of the 2 × 2 system', () => {
  // GP16 → 10 kΩ → N1 (C1 1 µF) → 10 kΩ → N2 (C2 1 µF); with R1' = R_out + 10 kΩ: C dw/dt = −G·w + g1·3.3·e1, G = [[g1 + g2, −g2], [−g2, g2]]
  const c = circ([{ id: 'R1', type: 'resistor', value: '10k' }, { id: 'C1', type: 'capacitor', value: '1u' }, { id: 'R2', type: 'resistor', value: '10k' }, { id: 'C2', type: 'capacitor', value: '1u' }],
    [['GP16', 'R1.1'], ['R1.2', 'C1.1'], ['C1.2', 'GND'], ['C1.1', 'R2.1'], ['R2.2', 'C2.1'], ['C2.2', 'GND'], ['C2.1', 'GP17']]);
  const { e, m, drive } = rig(c);
  const f = m.freq.sys, ii = m.circuit.k.padIsland[16];
  const g1 = 1 / (R_OUT_HIGH[1] + 10e3), g2 = 1e-4, C = 1e-6;
  // the exact solution: w(t) = 3.3·1 − Σ c_i·v_i·e^(λ_i t), λ the eigenvalues of −G/C, starting from 0
  const a = -(g1 + g2) / C, bb = g2 / C, d = -g2 / C, tr = a + d, det = a * d - bb * bb, disc = Math.sqrt(tr * tr / 4 - det);
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  const vec = (l) => [bb, l - a]; // (A − λI)v = 0 with A = [[a, bb], [bb, d]]
  const [v1, v2] = [vec(l1), vec(l2)];
  // w(0) − 3.3·1 = −3.3·1 = c1·v1 + c2·v2
  const D = v1[0] * v2[1] - v2[0] * v1[1], c1 = (-3.3 * v2[1] + 3.3 * v2[0]) / D, c2 = (-3.3 * v1[0] + 3.3 * v1[1]) / D;
  const exact = (t) => [3.3 + c1 * v1[0] * Math.exp(l1 * t) + c2 * v2[0] * Math.exp(l2 * t), 3.3 + c1 * v1[1] * Math.exp(l1 * t) + c2 * v2[1] * Math.exp(l2 * t)];
  const c0 = m.hart.ticks;
  drive(1);
  let worst = 0;
  for (let k = 1; k <= 30; k++) {
    e.advance({ cycles: Math.round(0.002 * f) });
    const t = (m.hart.ticks - c0) / f, w = m.circuit.wNow(ii), x = exact(t);
    worst = Math.max(worst, Math.abs(w[0] - x[0]), Math.abs(w[1] - x[1]));
  }
  // backward Euler's error at h = τ_min/20 is of order h/(2τ) of the swing: within 3 % of 3.3 V here
  assert.ok(worst < 0.03 * 3.3, `worst ${worst} V`);
  // and it settles to 3.3 V on both
  e.advance({ cycles: Math.round(0.4 * f) });
  const w = m.circuit.wNow(ii);
  assert.ok(Math.abs(w[0] - 3.3) < 2e-3 && Math.abs(w[1] - 3.3) < 2e-3, `${w}`);
  assert.equal(m.circuit.rt[ii].tr.kind, 'still', 'settled: the island sleeps');
});

test('a charging capacitor in replay from reset and in a snapshot: the same state', () => {
  // a user switch from 3V3 through 10 kΩ onto 1 µF on GP17: closing it at an input's cycle charges the capacitor
  const c = circ([{ id: 'S1', type: 'switch' }, { id: 'R1', type: 'resistor', value: '10k' }, { id: 'C1', type: 'capacitor', value: '1u' }],
    [['3V3', 'S1.1'], ['S1.2', 'R1.1'], ['R1.2', 'GP17'], ['GP17', 'C1.1'], ['C1.2', 'GND']]);
  const p = build(tpl('blink-c'));
  const e = descriptor.engine.create(p, { runLimit: Infinity });
  e.configure({ circuit: c });
  const slice = 37_311;
  e.advance({ cycles: slice }); e.input({ kind: 'part', id: 'S1', value: 1 });
  e.advance({ cycles: slice }); e.advance({ cycles: slice });
  const snap = e.snapshot(), hash = e.stateHash(), inputs = e.inputs();
  const ii = e.machine.circuit.k.padIsland[17];
  assert.ok(e.machine.circuit.rt[ii].tr.kind === 'exp', 'charging');
  const r = descriptor.engine.create(p, { inputs, runLimit: Infinity });
  r.configure({ circuit: c });
  for (let k = 0; k < 3; k++) r.advance({ cycles: slice });
  assert.equal(r.stateHash(), hash, 'replay from reset');
  const w = descriptor.engine.create(p, { runLimit: Infinity });
  w.restore(snap);
  assert.equal(w.stateHash(), hash, 'snapshot');
  e.advance({ cycles: 5 * slice }); w.advance({ cycles: 5 * slice });
  assert.equal(w.stateHash(), e.stateHash(), 'and on from there');
  assert.deepEqual(Array.from(w.machine.circuit.wNow(ii)), Array.from(e.machine.circuit.wNow(ii)));
});
