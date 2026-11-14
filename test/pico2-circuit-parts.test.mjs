// P1-B2 stage B2-4 (design docs/architecture/pico2-p1b2-user-circuits.md §16, research D54): the new parts and the presets.
// Light sensor and thermistor follow the environment (hand calculations from their datasheets' formulas); the RGB LED and the
// 7-segment display are LEDs per colour and segment; kit modules answer on any pins whose nets reach their controller, when
// powered and pulled up; the speaker part gives the audio its pin; the lab-kit and speaker options are presets of the effective
// circuit. Each expected value is calculated in the test's comment.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/pico2/index.js';
import { validateCircuit } from '../src/arch/pico2/circuit/format.js';
import { compile } from '../src/arch/pico2/circuit/netlist.js';
import { LDR, NTC, RGB, SEVEN_SEG, rxValue, PART_TYPES } from '../src/arch/pico2/circuit/library.js';
import { effectiveCircuit, kitPreset, speakerPad } from '../src/arch/pico2/circuit/presets.js';
import { R_OUT_HIGH, R_PD } from '../src/arch/pico2/circuit/pad.js';
import { build } from '../tools/pico2/record-circuit-compat.mjs';
import { PIN_POS } from '../src/arch/pico2/ui/circuit-sheet.js';

const index = JSON.parse(readFileSync(new URL('../content/pico2/templates/index.json', import.meta.url), 'utf8'));
const tpl = (id) => index.templates.find((t) => t.id === id);
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);
/** A version-2 circuit (the demo parts are not added) of `parts` and wires [a, b]. */
const circ = (parts, wires, labels = []) => validateCircuit({ format: 'mavilera-pico2-circuit', version: 2, parts: parts.map((p, i) => ({ x: 0, y: 200 * i, ...p })),
  wires: wires.map(([a, b]) => ({ a, b })), labels: labels.map(([net, at]) => ({ net, at, x: 0, y: 0 })) });
const engine = (t = 'blink-c') => descriptor.engine.create(build(tpl(t)), { runLimit: Infinity });

test('every new part type has pins on the sheet', () => {
  for (const t of Object.keys(PART_TYPES)) assert.deepEqual(Object.keys(PIN_POS[t] ?? {}).sort(), [...PART_TYPES[t].pins].sort(), t);
});

test('the light sensor and the thermistor: their datasheets\' formulas, and a divider into the ADC follows the environment', () => {
  // PDV-P8001 [LIT-152]: R = R10·(E/10 lx)^(−0.6): at 10 lx R10, at 100 lx R10/10^0.6, in the dark the 1 MΩ cap
  const q = { model: 'ldr', r10: LDR.r10, gamma: LDR.gamma, rdark: LDR.rdark };
  near(rxValue(q, { light: 10 }), LDR.r10, 1e-12, 'LDR at 10 lx');
  near(rxValue(q, { light: 100 }), LDR.r10 / 10 ** 0.6, 1e-12, 'LDR at 100 lx');
  near(rxValue(q, { light: 0 }), LDR.r10 * (0.01 / 10) ** -0.6, 1e-12, 'LDR at the 0.01 lx floor (below the 1 MΩ cap)');
  // NTCLE100E3103 [LIT-151]: R = 10 kΩ·exp(3977·(1/T − 1/298.15)): 10 kΩ at 25 °C; 3563 Ω at 50 °C (the datasheet's table: 3605 Ω)
  const n = { model: 'ntc', r25: NTC.r25, beta: NTC.beta };
  near(rxValue(n, { temp: 25 }), 10000, 1e-12, 'NTC at 25 °C');
  near(rxValue(n, { temp: 50 }), 10000 * Math.exp(3977 * (1 / 323.15 - 1 / 298.15)), 1e-12, 'NTC at 50 °C');
  // in the machine: 3V3 – LDR – GP27 – 10 kΩ – GND, with GP27's reset pull-down (64 kΩ) in parallel with the 10 kΩ:
  // GP27 = 3.3·Rl/(Rl + R(E)), Rl = 10k ∥ 64k, at 300 lx (the default), then 1000 lx
  const e = engine();
  e.configure({ circuit: circ([{ id: 'L1', type: 'ldr' }, { id: 'R1', type: 'resistor', value: '10k' }], [['3V3', 'L1.1'], ['L1.2', 'GP27'], ['GP27', 'R1.1'], ['R1.2', 'GND']]) });
  e.advance({ cycles: 1000 });
  const par = (a, b) => (a * b) / (a + b), rl = par(10000, R_PD);
  const v = (lux) => 3.3 * rl / (rl + rxValue(q, { light: lux }));
  near(e.machine.adc.volts[1], v(300), 1e-4, 'GP27 at 300 lx');
  e.input({ kind: 'env', key: 'light', value: 1000 });
  e.advance({ cycles: 1000 });
  near(e.machine.adc.volts[1], v(1000), 1e-4, 'GP27 at 1000 lx');
  // the thermistor the same way: 3V3 – 10 kΩ – GP28 – NTC – GND at 25 °C then 60 °C
  const t = engine();
  t.configure({ circuit: circ([{ id: 'R1', type: 'resistor', value: '10k' }, { id: 'T1', type: 'ntc' }], [['3V3', 'R1.1'], ['R1.2', 'GP28'], ['GP28', 'T1.1'], ['T1.2', 'GND']]) });
  t.advance({ cycles: 1000 });
  const low = (r) => par(r, R_PD); // the NTC with GP28's pull-down beside it
  near(t.machine.adc.volts[2], 3.3 * low(10000) / (10000 + low(10000)), 1e-4, 'GP28 at 25 °C');
  t.input({ kind: 'env', key: 'temp', value: 60 });
  t.advance({ cycles: 1000 });
  const r60 = rxValue(n, { temp: 60 });
  near(t.machine.adc.volts[2], 3.3 * low(r60) / (10000 + low(r60)), 1e-4, 'GP28 at 60 °C');
  // replay from reset gives the same state
  const h = t.stateHash(); t.restart(t.inputs()); t.advance({ cycles: 2000 }); assert.equal(t.stateHash(), h);
});

test('the RGB LED (three LEDs, common cathode) and the 7-segment display (a segment per LED) from pins driven high', () => {
  // GP16 high through 330 Ω into R: I = (3.3 − 1.5)/(R_out + 330 + 20); green and blue off (their pins low)
  const c = circ([{ id: 'R1', type: 'resistor', value: '330' }, { id: 'U1', type: 'rgb' }], [['GP16', 'R1.1'], ['R1.2', 'U1.R'], ['U1.COM', 'GND']]);
  const k = compile(c);
  const leds = k.leds.filter((x) => x.part === 'U1').map((x) => x.sub).sort();
  assert.deepEqual(leds, ['B', 'G', 'R']);
  const e = descriptor.engine.create(build({ file: 'leds.c', lang: 'c', text: '#include <rp2350.h>\nint main(void) { pin_output(16); pin_write(16, 1); pin_output(10); pin_write(10, 1); delay_ms(50); return 0; }\n' }), { runLimit: Infinity });
  e.configure({ circuit: circ([{ id: 'R1', type: 'resistor', value: '330' }, { id: 'U1', type: 'rgb' }, { id: 'R2', type: 'resistor', value: '330' }, { id: 'S1', type: 'sevenseg' }],
    [['GP16', 'R1.1'], ['R1.2', 'U1.R'], ['U1.COM', 'GND'], ['GP10', 'R2.1'], ['R2.2', 'S1.a'], ['S1.COM', 'GND']]) });
  e.advance({ cycles: Math.ceil(e.machine.freq.sys * 0.02) });
  const live = e.live().circuit.leds;
  const now = (part, sub) => live.find((x) => x.part === part && x.sub === sub).now;
  near(now('U1', 'R'), (3.3 - RGB.R.vf) / (R_OUT_HIGH[1] + 330 + RGB.R.rs) * 1000, 2e-3, 'RGB red (mA; the pad\'s 64 kΩ pull-down aside)');
  assert.equal(now('U1', 'G'), 0); assert.equal(now('U1', 'B'), 0);
  near(now('S1', 'a'), (3.3 - SEVEN_SEG.vf) / (R_OUT_HIGH[1] + 330 + SEVEN_SEG.rs) * 1000, 2e-3, 'segment a (mA)');
  assert.equal(now('S1', 'b'), 0);
});

test('kit modules on any pins: found by their nets, when powered and pulled up; otherwise a diagnostic says why', () => {
  // an MCP9808 on GP8 (SDA) and GP9 (SCL), both I2C0 (even/odd pins, (n >> 1) & 1 = 0), 4.7 kΩ pull-ups, VCC and GND on the rails
  const wired = (extra = {}) => circ([{ id: 'M1', type: 'mcp9808', address: '0x1a' }, { id: 'RA', type: 'resistor', value: '4k7' }, { id: 'RB', type: 'resistor', value: '4k7' }],
    [['GP8', 'M1.SDA'], ['GP9', 'M1.SCL'], ['M1.VCC', extra.vcc ?? '3V3'], ['M1.GND', 'GND'], ...(extra.noPull ? [] : [['RA.1', 'GP8'], ['RA.2', '3V3'], ['RB.1', 'GP9'], ['RB.2', '3V3']])]);
  const e = engine();
  e.configure({ circuit: wired() });
  const m = e.machine;
  assert.equal(m.kit.modules.length, 1);
  assert.equal(m.i2c[0].find(0x1a), null, 'GP8 and GP9 do not select I2C yet');
  m.pins.ctrl[8] = (m.pins.ctrl[8] & ~0x1f) | 3; m.pins.ctrl[9] = (m.pins.ctrl[9] & ~0x1f) | 3;
  assert.ok(m.i2c[0].find(0x1a), 'it answers on I2C0 at 0x1a');
  assert.equal(m.i2c[1].find(0x1a), null, 'not on I2C1');
  assert.equal(m.i2c[0].find(0x18), null, 'not at another address');
  // unpowered (VCC on nothing), no pull-up: no answer, and the reason
  const u = engine(); u.configure({ circuit: wired({ vcc: 'GND' }) });
  u.machine.pins.ctrl[8] = (u.machine.pins.ctrl[8] & ~0x1f) | 3; u.machine.pins.ctrl[9] = (u.machine.pins.ctrl[9] & ~0x1f) | 3;
  assert.equal(u.machine.i2c[0].find(0x1a), null);
  assert.ok(u.diagnostics().some((d) => d.kind === 'moduleUnpowered'), JSON.stringify(u.diagnostics()));
  const n = engine(); n.configure({ circuit: wired({ noPull: true }) });
  n.machine.pins.ctrl[8] = (n.machine.pins.ctrl[8] & ~0x1f) | 3; n.machine.pins.ctrl[9] = (n.machine.pins.ctrl[9] & ~0x1f) | 3;
  assert.equal(n.machine.i2c[0].find(0x1a), null);
  assert.ok(n.diagnostics().some((d) => d.kind === 'moduleNoPullUp'));
  // the pads' own pull-ups count as pull-ups
  n.machine.pins.pad[8] |= 0x8; n.machine.pins.pad[9] |= 0x8;
  assert.ok(n.machine.i2c[0].find(0x1a), 'with the pads\' pull-ups on');
});

test('rc-debounce without its capacitor: each bouncing press counts three times (the template\'s comment)', () => {
  const t = tpl('rc-debounce');
  const e = descriptor.engine.create(build(t), { runLimit: Infinity });
  const c = JSON.parse(readFileSync(new URL('../content/pico2/templates/rc-debounce.circuit.json', import.meta.url), 'utf8'));
  c.parts = c.parts.filter((p) => p.id !== 'C1'); c.wires = c.wires.filter((w) => !w.a.startsWith('C1.') && !w.b.startsWith('C1.')); c.labels = c.labels.filter((l) => !l.at.startsWith('C1.'));
  e.configure({ circuit: JSON.stringify(c) });
  const at = (ms) => { while (e.clock().timeNs < ms * 1e6) e.advance({ cycles: Math.min(2000, Math.max(1, Math.ceil(((ms * 1e6 - e.clock().timeNs) / 1e9) * e.machine.freq.sys))) }); };
  // closed at 0, 0.2 and 0.4 ms (open between): three high-to-low changes per press
  for (const base of [100, 300]) for (const [dt, v] of [[0, 1], [0.1, 0], [0.2, 1], [0.3, 0], [0.4, 1], [50, 0]]) { at(base + dt); e.input({ kind: 'part', id: 'SW1', value: v }); }
  let s; do s = e.run({ chunk: 1_000_000, resumed: true }); while (s === 'chunk' || s?.stop === 'chunk');
  assert.equal(e.state().output, [1, 2, 3, 4, 5, 6].map((n) => `press ${n}\n`).join(''));
});

test('a part of the student\'s own definition (research D54 Q4 A): placed, lit like a library part; a bad definition is refused, naming the field', () => {
  const def = { type: 'ledbar2', label: 'Two-LED bar', pins: [{ name: 'A1', x: -63.5, y: -12.7 }, { name: 'A2', x: -63.5, y: 12.7 }, { name: 'K', x: 63.5, y: 0 }],
    symbol: ['M-40 -25 H40 V25 H-40 Z'], primitives: [{ kind: 'D', a: 'A1', k: 'K', color: 'red' }, { kind: 'D', a: 'A2', k: 'K', color: 'green' }] };
  const c = validateCircuit({ format: 'mavilera-pico2-circuit', version: 2, defs: [def], parts: [{ id: 'U1', type: 'ledbar2', x: 0, y: 900 }, { id: 'R1', type: 'resistor', value: '220', x: 0, y: 1000 }],
    wires: [{ a: 'GP16', b: 'R1.1' }, { a: 'R1.2', b: 'U1.A1' }, { a: 'U1.K', b: 'GND' }] });
  const k = compile(c);
  assert.equal(k.leds.filter((x) => x.part === 'U1').length, 2);
  assert.equal(k.pins.get('U1.A1').island, k.padIsland[16]);
  const bad = (prims, field) => assert.throws(() => validateCircuit({ format: 'mavilera-pico2-circuit', version: 2, defs: [{ ...def, primitives: prims }] }), (e) => e.field === field, field);
  bad([{ kind: 'R', a: 'A1', b: 'K' }], 'defs[0].primitives[0].r');
  bad([{ kind: 'D', a: 'A1', k: 'K', color: 'purple' }], 'defs[0].primitives[0].color');
  bad([{ kind: 'RX', a: 'A1', b: 'K' }], 'defs[0].primitives[0]');
  bad([{ kind: 'D', a: 'A1', k: 'X9' }], 'defs[0].primitives[0].k');
});

test('the presets: Parts = lab kit adds the kit, the speaker menu wires the sounding part; the templates of the kit still run', () => {
  const kit = compile(effectiveCircuit(null, { kit: true }));
  assert.deepEqual(kit.modules.map((x) => x.model).sort(), ['bme280', 'bmp280', 'eeprom', 'lcd', 'mcp9808', 'mpu6050']);
  assert.ok(kit.modules.every((x) => x.powered), 'every module powered');
  assert.ok(kit.modules.filter((x) => x.bus === 'i2c').every((x) => x.pins.SDA.pads.includes(4) && x.pins.SCL.pads.includes(5) && x.pins.SDA.pullUp && x.pins.SCL.pullUp));
  const bme = kit.modules.find((x) => x.model === 'bme280');
  assert.deepEqual([bme.pins.SDO.pads, bme.pins.CSB.pads, bme.pins.SCK.pads, bme.pins.SDI.pads], [[16], [17], [18], [19]]);
  // a circuit with its own kit module gets no second kit
  const own = validateCircuit({ format: 'mavilera-pico2-circuit', version: 2, parts: [{ id: 'X1', type: 'mcp9808', x: 0, y: 0 }] });
  assert.equal(compile(effectiveCircuit(own, { kit: true })).modules.length, 1);
  // the speaker: none in the demo, so the preset; with one, it is moved to the chosen pin
  assert.equal(speakerPad('gp14'), 14); assert.equal(speakerPad('gp25'), -1, 'GP25 has no pad'); assert.equal(speakerPad('none'), -1);
  const sp = compile(effectiveCircuit(null, { speaker: 14 }));
  assert.equal(sp.tap, 14);
  const moved = compile(effectiveCircuit(effectiveCircuit(null, { speaker: 14 }), { speaker: 20 }));
  assert.equal(moved.tap, 20); assert.equal(moved.sounders.length, 1);
  // the engine: the audio follows the sounding part, and the I2C LCD template prints on the kit's LCD
  const e = engine('pwm-tone');
  e.configure({ speaker: 'gp14' });
  assert.equal(e.audioStatus().pin, 14);
  const l = engine('i2c-lcd');
  l.configure({ parts: 'kit' });
  for (let i = 0; i < 40 && !l.machine.kit.lcd?.lines().some((x) => x.trim()); i++) l.advance({ cycles: Math.ceil(l.machine.freq.sys * 0.05) });
  assert.ok(l.machine.kit.lcd.lines().some((x) => x.trim()), JSON.stringify(l.machine.kit.lcd.lines()));
  void kitPreset;
});
