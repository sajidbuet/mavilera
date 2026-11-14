// P1-B2 stage B2-1 (design docs/architecture/pico2-p1b2-user-circuits.md §5.2-§5.3, §5.7): the circuit file's validator, the
// netlist, the DC solver against hand calculation (each calculation in a comment), and the circuit in the machine: a program reads
// a user part, the ADC reads a loaded knob, the board LED's mean current, warnings, replay from reset and snapshots.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptor } from '../src/arch/pico2/index.js';
import { STOP } from '../src/arch/contract.js';
import { validateCircuit, parseValue, canonicalText, CircuitError, FORMAT } from '../src/arch/pico2/circuit/format.js';
import { compile, NetlistError } from '../src/arch/pico2/circuit/netlist.js';
import { effectiveCircuit } from '../src/arch/pico2/circuit/presets.js';
import { IslandSolver } from '../src/arch/pico2/circuit/solve.js';
import { R_OUT_HIGH, R_OUT_LOW, R_PD, R_PU, inputLevel } from '../src/arch/pico2/circuit/pad.js';
import { LED_COLOURS, NPN, DIODES } from '../src/arch/pico2/circuit/library.js';
import { build } from '../tools/pico2/record-circuit-compat.mjs';
import { readFileSync } from 'node:fs';

const index = JSON.parse(readFileSync(new URL('../content/pico2/templates/index.json', import.meta.url), 'utf8'));
const tpl = (id) => index.templates.find((t) => t.id === id);
const circ = (parts, wires, extra = {}) => ({ format: FORMAT, version: 1, parts: parts.map((p) => ({ x: 0, y: 0, ...p })), wires: wires.map(([a, b]) => ({ a, b })), ...extra });
// relative tolerance (G_MIN = 1e-12 S on every node shifts results by about 1e-9 relative)
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(b), 1e-3), `${msg}: ${a} vs ${b}`);
// pad codes (circuit/pad.js): chip low 1 / high 2, DRIVE in bits 2-3, pull in bits 4-5 (1 up, 2 down), outside drive bits 7-8
const HIGH = (d = 1) => 2 | (d << 2), LOW = (d = 1) => 1 | (d << 2), PULL_DOWN = 2 << 4, NONE = 0;
/** Solve the island of GPIO g of a circuit with every pad of that island at `code`. */
function solveAt(c, g, code, ctrl = new Map()) {
  const k = compile(validateCircuit(c)), isl = k.islands[k.padIsland[g]];
  const r = new IslandSolver(isl).solve(isl.pads.map(() => code), ctrl, new Uint8Array(isl.prims.length));
  const V = (name) => r.v[isl.netNames.indexOf(name)];
  return { r, isl, V, I: (part) => r.current[isl.prims.findIndex((p) => p.part === part)] };
}

test('circuit file: values with units, the validator\'s refusals name the field, the canonical form', () => {
  assert.deepEqual(['220', '4k7', '10k', '1M', '470R', '1R5', '2.2k', '100n', '4u7', 'x', '', '1kk'].map(parseValue).map((x) => (Number.isNaN(x) ? 'NaN' : +x.toPrecision(6))),
    [220, 4700, 10000, 1e6, 470, 1.5, 2200, 1e-7, 4.7e-6, 'NaN', 'NaN', 'NaN']);
  const bad = (c, field) => assert.throws(() => validateCircuit(c), (e) => e instanceof CircuitError && e.field.startsWith(field), field);
  bad({ format: 'x', version: 1 }, 'format');
  bad(circ([{ id: 'R1', type: 'resistr' }], []), 'parts[0].type');
  bad(circ([{ id: 'R1', type: 'resistor', value: '0.1' }], []), 'parts[0].value');
  bad(circ([{ id: 'R1', type: 'resistor', colour: 'red' }], []), 'parts[0]');
  bad(circ([{ id: 'R1', type: 'resistor' }, { id: 'R1', type: 'resistor' }], []), 'parts[1].id');
  bad(circ([{ id: 'R1', type: 'resistor' }], [['R1.1', 'RUN']]), 'wires[0].b');
  bad(circ([{ id: 'R1', type: 'resistor' }], [['R1.3', 'GND']]), 'wires[0].a');
  bad(circ([], [['GP23', 'GND']]), 'wires[0]');
  bad('{not json', 'file');
  const a = circ([{ id: 'R2', type: 'resistor' }, { id: 'R1', type: 'resistor' }], [['R2.1', 'GP3'], ['GND', 'R1.2']]);
  const b = circ([{ id: 'R1', type: 'resistor' }, { id: 'R2', type: 'resistor' }], [['R1.2', 'GND'], ['GP3', 'R2.1']]);
  assert.equal(canonicalText(validateCircuit(a)), canonicalText(validateCircuit(b)));
  assert.equal(compile(validateCircuit(a)).hash, compile(validateCircuit(b)).hash);
  // B2-4 (research D54 Q1 A): the kit is a preset of the effective circuit, so its hash differs with the kit
  assert.notEqual(compile(effectiveCircuit(validateCircuit(a))).hash, compile(effectiveCircuit(validateCircuit(a), { kit: true })).hash);
  assert.throws(() => compile(validateCircuit(circ([], [['3V3', 'GND']]))), NetlistError);
});

test('circuit DC: an LED and 220 Ω from a pin at each drive strength, a divider, pulls, an NPN switch, a clamp diode', () => {
  const red = LED_COLOURS.red;
  const led = circ([{ id: 'R1', type: 'resistor', value: '220' }, { id: 'D1', type: 'led', color: 'red' }], [['GP16', 'R1.1'], ['R1.2', 'D1.A'], ['D1.K', 'GND']]);
  for (let d = 0; d < 4; d++) {
    // I = (3.3 V − V_f) / (R_out + 220 Ω + R_s)
    const s = solveAt(led, 16, HIGH(d));
    near(s.I('D1'), (3.3 - red.vf) / (R_OUT_HIGH[d] + 220 + red.rs), 1e-7, `LED current at DRIVE ${d}`);
    near(s.V('GP16'), 3.3 - R_OUT_HIGH[d] * s.I('D1'), 1e-7, `GP16 at DRIVE ${d}`);
  }
  const off = solveAt(led, 16, LOW());
  assert.equal(off.I('D1'), 0); near(off.V('GP16'), 0, 1e-7, 'driven low');
  // the divider 10 kΩ / 10 kΩ on GP27: 1.65 V; with the pad's pull-down 64 kΩ in parallel with the lower one: 3.3·Rp/(10k + Rp)
  const div = circ([{ id: 'RA', type: 'resistor', value: '10k' }, { id: 'RB', type: 'resistor', value: '10k' }], [['3V3', 'RA.1'], ['RA.2', 'GP27'], ['GP27', 'RB.1'], ['RB.2', 'GND']]);
  near(solveAt(div, 27, NONE).V('GP27'), 1.65, 1e-7, 'divider');
  const rp = (10e3 * R_PD) / (10e3 + R_PD);
  near(solveAt(div, 27, PULL_DOWN).V('GP27'), (3.3 * rp) / (10e3 + rp), 1e-7, 'divider with the pull-down');
  // an outside pull-up of 10 kΩ against the pad's pull-down 64 kΩ: 3.3·64/74 = 2.854 V, read as 1
  const pu = solveAt(circ([{ id: 'R1', type: 'resistor', value: '10k' }], [['3V3', 'R1.1'], ['R1.2', 'GP2']]), 2, PULL_DOWN);
  near(pu.V('GP2'), (3.3 * R_PD) / (10e3 + R_PD), 1e-7, 'pull-up against the pad\'s pull-down');
  assert.equal(inputLevel(pu.V('GP2'), 0), 1);
  // 1 MΩ to ground against the pad's pull-up 52 kΩ: 3.3·1000/1052 = 3.137 V
  const big = solveAt(circ([{ id: 'R1', type: 'resistor', value: '1M' }], [['GP2', 'R1.1'], ['R1.2', 'GND']]), 2, 1 << 4);
  near(big.V('GP2'), (3.3 * 1e6) / (1e6 + R_PU), 1e-7, 'pad pull-up against 1 MΩ');
  // NPN switch: GP17 high through 1 kΩ into the base; a green LED and 330 Ω from 3V3 into the collector; saturated:
  // I_B = (3.3 − V_BE)/(R_out + 1k + R_BE); I_C = (3.3 − V_f − V_CE(sat))/(330 + R_s + R_CE)
  const sw = circ([{ id: 'RB', type: 'resistor', value: '1k' }, { id: 'Q1', type: 'npn' }, { id: 'RC', type: 'resistor', value: '330' }, { id: 'D2', type: 'led', color: 'green' }],
    [['GP17', 'RB.1'], ['RB.2', 'Q1.B'], ['Q1.E', 'GND'], ['3V3', 'RC.1'], ['RC.2', 'D2.A'], ['D2.K', 'Q1.C']]);
  const on = solveAt(sw, 17, HIGH()), g = LED_COLOURS.green;
  near(on.I('RB'), (3.3 - NPN.vbe) / (R_OUT_HIGH[1] + 1000 + NPN.rbe), 1e-7, 'base current');
  near(on.I('D2'), (3.3 - g.vf - NPN.vcesat) / (330 + g.rs + NPN.rce), 1e-7, 'collector (LED) current, saturated');
  assert.equal(on.r.states[on.isl.prims.findIndex((p) => p.part === 'Q1')], 2, 'saturated');
  const cut = solveAt(sw, 17, LOW());
  near(cut.I('D2'), 0, 1e-7, 'cut off: no LED current');
  // a small base current leaves it active: 100 kΩ base resistor: I_C = β·I_B, below the saturation current
  const act = solveAt({ ...sw, parts: sw.parts.map((p) => (p.id === 'RB' ? { ...p, value: '1M' } : p)) }, 17, HIGH());
  const ib = (3.3 - NPN.vbe) / (R_OUT_HIGH[1] + 1e6 + NPN.rbe);
  near(act.I('D2'), NPN.beta * ib, 1e-6, 'active: I_C = β·I_B (G_MIN on the base: 2.5e-7 relative)');
  // a Schottky clamp from GP0 to 3V3 with VSYS (5 V) through 1 kΩ: (5 − V)/1k = (V − 3.3 − V_F)/R_s (B2-4: 1N5819's values)
  const cl = solveAt(circ([{ id: 'R1', type: 'resistor', value: '1k' }, { id: 'D1', type: 'diode', kind: 'schottky' }], [['VSYS', 'R1.1'], ['R1.2', 'GP0'], ['GP0', 'D1.A'], ['D1.K', '3V3']]), 0, NONE);
  const sk = DIODES.schottky;
  near(cl.V('GP0'), (5 / 1000 + (3.3 + sk.vf) / sk.rs) / (1 / 1000 + 1 / sk.rs), 1e-7, 'clamped');
  // a floating net: an LED from GP3 to nowhere with the pad undriven and no pull
  const fl = solveAt(circ([{ id: 'D1', type: 'led' }], [['GP3', 'D1.A']]), 3, NONE);
  assert.equal(fl.r.floating[fl.isl.netNames.indexOf('GP3')], 1);
});

test('circuit in the machine: a user button on GP15 counts five presses, replay from reset and a snapshot are equal', () => {
  const c = circ([{ id: 'B1', type: 'button' }], [['GP15', 'B1.1'], ['B1.2', 'GND']]);
  const p = build(tpl('gpio-button'));
  const e = descriptor.engine.create(p, { runLimit: Infinity });
  e.configure({ circuit: JSON.stringify(c) });
  const slice = Math.ceil(e.machine.freq.sys * 0.02);
  let snap = null, mid = null;
  for (let k = 0; k < 5; k++) {
    e.advance({ cycles: slice }); e.input({ kind: 'part', id: 'B1', value: 1 });
    e.advance({ cycles: slice }); e.input({ kind: 'part', id: 'B1', value: 0 });
    if (k === 2) { snap = e.snapshot(); mid = { hash: e.stateHash(), inputs: e.inputs() }; }
  }
  let r; do r = e.advance({ cycles: slice }); while (r.stop === STOP.CHUNK && e.clock().timeNs < 2e9);
  assert.equal(e.state().halted, true, e.state().output);
  assert.match(e.state().output, /5/);
  const replay = descriptor.engine.create(p, { inputs: e.inputs(), runLimit: Infinity });
  replay.configure({ circuit: c });
  do r = replay.run({ chunk: 1_000_000, resumed: true }); while (r === STOP.CHUNK);
  assert.equal(replay.state().output, e.state().output);
  assert.equal(replay.state().steps, e.state().steps);
  // the whole machine state, circuit included, at the third release: a replay from reset of the inputs given by then
  const half = descriptor.engine.create(p, { inputs: mid.inputs, runLimit: Infinity });
  half.configure({ circuit: c });
  for (let k = 0; k < 6; k++) half.advance({ cycles: slice });
  assert.equal(half.stateHash(), mid.hash);
  // a snapshot carries its circuit (as the Worker's engine gets it: create, then restore): the same state, and with the same
  // later presses the same end
  const w = descriptor.engine.create(p, { runLimit: Infinity });
  w.restore(snap);
  assert.equal(w.stateHash(), mid.hash);
  for (let k = 3; k < 5; k++) {
    w.advance({ cycles: slice }); w.input({ kind: 'part', id: 'B1', value: 1 });
    w.advance({ cycles: slice }); w.input({ kind: 'part', id: 'B1', value: 0 });
  }
  do r = w.advance({ cycles: slice }); while (r.stop === STOP.CHUNK && w.clock().timeNs < 2e9);
  assert.equal(w.state().output, e.state().output);
  assert.equal(w.state().steps, e.state().steps);
  // the machine state of another circuit is refused
  const other = descriptor.engine.create(p, { runLimit: Infinity });
  assert.throws(() => other.machine.load(snap.m), /another circuit/);
  // without the circuit the same inputs do nothing (B1 is not there): the program does not end
  const none = descriptor.engine.create(p, { inputs: e.inputs(), runLimit: Infinity });
  do r = none.advance({ cycles: slice }); while (r.stop === STOP.CHUNK && none.clock().timeNs < 1e9);
  assert.equal(none.state().halted, false);
});

test('circuit in the machine: a 10 kΩ load on the knob\'s wiper, read by adc-knob; the board LED\'s mean current; warnings', () => {
  // the knob at mid-travel (Thevenin 1.65 V, 2.5 kΩ) into 10 kΩ to ground: 1.65·10/12.5 = 1.32 V (adc_read clears the pulls)
  const c = circ([{ id: 'RL', type: 'resistor', value: '10k' }], [['GP26', 'RL.1'], ['RL.2', 'GND']]);
  const e = descriptor.engine.create(build(tpl('adc-knob')), { runLimit: Infinity });
  e.configure({ circuit: c });
  const slice = Math.ceil(e.machine.freq.sys * 0.15);
  e.advance({ cycles: slice }); e.input({ kind: 'adc', channel: 0, volts: 1.65 });
  let r; do r = e.advance({ cycles: slice }); while (r.stop === STOP.CHUNK && e.clock().timeNs < 3e9);
  near(e.machine.adc.volts[0], 1.32, 1e-5, 'GP26');
  assert.match(e.state().output, /= 13[12]\d mV/, e.state().output);
  // blink: GP25 high lights the board's green LED through 470 Ω; the pad's reset pull-down (64 kΩ) stays on: Thevenin of the pad
  // 3.3·64000/64045 V behind 45 Ω ∥ 64 kΩ; I = (V_th − 2.1)/(R_th + 470 + 20) = 2.2388 mA while on
  const vth = (3.3 * R_PD) / (R_PD + R_OUT_HIGH[1]), rth = (R_OUT_HIGH[1] * R_PD) / (R_OUT_HIGH[1] + R_PD);
  const b = descriptor.engine.create(build(tpl('blink-c')), { runLimit: Infinity });
  let seen = 0;
  for (let k = 0; k < 40; k++) {
    b.advance({ cycles: Math.ceil(b.machine.freq.sys * 0.01) });
    const led = b.live().circuit.leds.find((x) => x.part === 'GP25 LED');
    if (b.machine.pins.level[25] && led.now > 0) { near(led.now, ((vth - 2.1) / (rth + 470 + 20)) * 1000, 1e-7, 'GP25 LED'); seen++; }
  }
  assert.ok(seen > 0, 'the LED was on at some point');
  // a pin driven high by the program (two-cores blinks GP15) into a user button held closed: over-current warning
  const t = descriptor.engine.create(build(tpl('two-cores')), { runLimit: Infinity });
  t.configure({ circuit: circ([{ id: 'B1', type: 'button' }], [['GP15', 'B1.1'], ['B1.2', 'GND']]) });
  t.input({ kind: 'part', id: 'B1', value: 1 });
  for (let k = 0; k < 40 && !t.diagnostics().some((d) => d.kind === 'circuitOverCurrent'); k++) t.advance({ cycles: Math.ceil(t.machine.freq.sys * 0.01) });
  const d = t.diagnostics().find((x) => x.kind === 'circuitOverCurrent');
  assert.ok(d, JSON.stringify(t.diagnostics()));
  // 3.3 V over R_out (45 Ω) + the closed switch (0.05 Ω): 3.3/45.05 = 73.25 mA, shown to 0.1 mA
  assert.match(d.message, /GP15 carries 73\.3 mA, more than its 4 mA/);
  // the Pins panel drives GP15 low while the program drives it high: contention
  const u = descriptor.engine.create(build(tpl('two-cores')), { runLimit: Infinity });
  u.configure({ circuit: circ([{ id: 'R1', type: 'resistor', value: '1k' }], [['GP15', 'R1.1'], ['R1.2', 'GND']]) });
  u.input({ kind: 'pin', pin: 15, level: 0 });
  for (let k = 0; k < 40 && !u.diagnostics().some((x) => x.kind === 'circuitContention'); k++) u.advance({ cycles: Math.ceil(u.machine.freq.sys * 0.01) });
  assert.ok(u.diagnostics().some((x) => x.kind === 'circuitContention'), JSON.stringify(u.diagnostics()));
  // an invalid circuit is reported and leaves the demo circuit (B2-3, research D52: no file = the demo circuit)
  const v = descriptor.engine.create(build(tpl('blink-c')), { runLimit: Infinity });
  v.configure({ circuit: '{"format":"x"}' });
  assert.ok(v.diagnostics().some((x) => x.kind === 'circuitInvalid'));
  assert.ok(v.machine.circuit.k.controls.has('KNOB') && v.machine.circuit.k.controls.has('BTN'), 'the demo circuit');
  void R_OUT_LOW;
});

test('the Pins panel and the circuit (D51 Q8 A): GP27 with parts wired is not a source; the panel\'s drive is reported apart from ext', () => {
  // a divider 10 kΩ / 10 kΩ on GP27 (1.65 V); the panel's ADC input 1 (3 V) is then ignored; input 2 (GP28, unwired) is a source
  const c = circ([{ id: 'RA', type: 'resistor', value: '10k' }, { id: 'RB', type: 'resistor', value: '10k' }], [['3V3', 'RA.1'], ['RA.2', 'GP27'], ['GP27', 'RB.1'], ['RB.2', 'GND']]);
  const e = descriptor.engine.create(build(tpl('blink-c')), { runLimit: Infinity });
  e.configure({ circuit: c });
  e.input({ kind: 'adc', channel: 1, volts: 3 }); e.input({ kind: 'adc', channel: 2, volts: 2.5 });
  e.advance({ cycles: 1000 });
  const st = e.live();
  assert.deepEqual(st.parts.wired, [false, true, false, false]);
  // the pad's pull-down (64 kΩ) is on at reset, in parallel with the lower 10 kΩ: 3.3·Rp/(10k + Rp)
  const rp = (10e3 * R_PD) / (10e3 + R_PD);
  near(st.parts.volts[1], (3.3 * rp) / (10e3 + rp), 1e-5, 'GP27 from the divider');
  assert.equal(st.parts.volts[2], 2.5);
  // the panel's drive of a circuit pin: drv is the drive given, ext what the circuit makes the pin read
  e.input({ kind: 'pin', pin: 27, level: 1 });
  e.advance({ cycles: 1000 });
  const s2 = e.live();
  assert.equal(s2.pins.drv[27], 1);
  assert.equal(s2.pins.ext[27], 1);
  assert.ok(s2.parts.volts[1] > 3.2, 'the outside drive through 1 Ω wins over the divider');
});
