// P1-B2 compatibility gate (design docs/architecture/pico2-p1b2-user-circuits.md §5.1): with no user parts, every pico2 template and
// the input scenarios of tools/pico2/record-circuit-compat.mjs behave as on the code before P1-B2 (main bc2e446; fixtures in
// test/fixtures/pico2-circuit-compat.json): the same UART text, pin log, steps, levels, input mask and ADC volts (to 10 µV). The
// expected differences are listed with their reasons and checked to be exactly those.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIOS, runScenario, FIXTURE } from '../tools/pico2/record-circuit-compat.mjs';

const want = new Map(JSON.parse(readFileSync(FIXTURE, 'utf8')).scenarios.map((s) => [s.name, s]));

/**
 * Expected differences, per scenario: the fields that may differ and why.
 * - adc_read clears GP26's pulls (research D51 Q7 A, as the SDK's adc_gpio_init): one more pin-log entry (pd -> in).
 * - the knob is a potentiometer on GP26 (the fixed circuit in the netlist): at 2.2 V GP26's input reads 1 (above 1.75 V).
 */
const EXPECTED = {
  'run:adc-knob': { pins: 'D51 Q7 A', pinEvents: 'D51 Q7 A' },
  knob: { pins: 'D51 Q7 A', pinEvents: 'D51 Q7 A' },
  'knob-12': { pins: 'D51 Q7 A', pinEvents: 'D51 Q7 A', levels: 'the knob at 2.2 V on GP26' },
};

for (const sc of SCENARIOS) {
  test(`P1-B2 compatibility: ${sc[0]}`, () => {
    const got = runScenario(sc), w = want.get(sc[0]);
    assert.ok(w, `no fixture for ${sc[0]}`);
    const allowed = EXPECTED[sc[0]] ?? {};
    for (const k of Object.keys(w)) {
      if (k === 'volts') { w.volts.forEach((v, i) => assert.ok(Math.abs(got.volts[i] - v) <= 1e-5, `${sc[0]} volts[${i}] ${got.volts[i]} vs ${v}`)); continue; }
      if (allowed[k]) { assert.notDeepEqual(got[k], w[k], `${sc[0]}: ${k} was expected to differ (${allowed[k]}); update EXPECTED`); continue; }
      assert.deepEqual(got[k], w[k], `${sc[0]}: ${k}`);
    }
    if (sc[0] === 'run:adc-knob' || sc[0] === 'knob' || sc[0] === 'knob-12') assert.equal(got.pinEvents, w.pinEvents + 1, 'exactly one more pin event: GP26 pd -> in');
  });
}
