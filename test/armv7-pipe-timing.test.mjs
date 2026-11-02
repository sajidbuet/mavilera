// armv7-pipe-timing.test.mjs -- the clock period of the ARM pipelined processor (uarch/pipe-timing.js; roadmap ARM-A4
// part 3): every stage's paths against a hand calculation from the illustrative delays (content/armv7/data/
// single-delays.json), Eq 7.5's form (p. 442) for the register file's two halves, the stage that sets the period moving
// when a delay changes, and the three processors' periods compared (Example 7.8's comparison, with these delays).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pipeTiming, PIPE_DELAY_KEYS } from '../src/arch/armv7/uarch/pipe-timing.js';
import { delayMap, classTable } from '../src/arch/armv7/uarch/timing.js';
import { stateTable } from '../src/arch/armv7/uarch/multi-timing.js';
import { MAIN_DECODER, MAIN_OUTPUTS } from '../src/arch/armv7/uarch/single.js';
import { MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT } from '../src/arch/armv7/uarch/single-ext.js';

const D = delayMap(JSON.parse(readFileSync(new URL('../content/armv7/data/single-delays.json', import.meta.url), 'utf8')));
const by = (t, end) => t.rows.find((r) => r.end === end).delay;

test('every delay key the timing uses is in the illustrative table', () => {
  for (const k of PIPE_DELAY_KEYS) assert.ok(Number.isFinite(D[k]), k);
});

test('the paths of each stage, by hand: pcq 30, setup 40, imem 250, rf 120, mux 30, alu 180, add 100, dmem 250, dec 60, aludec 30, cond 40, gate 20, hazard 40', () => {
  const t = pipeTiming(D);
  assert.equal(by(t, 'IF/ID register'), 30 + 250 + 40); // Fetch: t_pcq + t_mem + t_setup (Eq 7.5)
  assert.equal(by(t, 'MEM/WB register'), 30 + 250 + 40); // Memory: the same form
  assert.equal(by(t, 'register-file read, second half of Decode'), 2 * (120 + 40)); // Decode: 2 (t_RFread + t_setup)
  assert.equal(by(t, 'register-file write, first half of Writeback'), 2 * (30 + 30 + 40)); // Writeback: 2 (t_pcq + t_mux + t_setup)
  // Execute: the forwarding select (Hazard Unit), the forwarding and SrcB multiplexers, the ALU
  assert.equal(by(t, 'EX/MEM register'), 30 + 40 + 30 + 30 + 180 + 40);
  // a taken branch: one multiplexer more, into the PC
  assert.equal(by(t, 'PC register'), 30 + 40 + 30 + 30 + 180 + 30 + 40);
  assert.equal(t.rows.find((r) => r.end === 'PC register').stage, 'EX');
  assert.equal(t.tc, 380);
  assert.deepEqual(t.setBy, ['EX: PC register']);
});

test('the stage that sets the period moves with the delays', () => {
  assert.deepEqual(pipeTiming({ ...D, imem: 400 }).setBy, ['IF: IF/ID register']);
  assert.equal(pipeTiming({ ...D, imem: 400 }).tc, 30 + 400 + 40);
  const rf = pipeTiming({ ...D, rf: 200 });
  assert.deepEqual(rf.setBy, ['ID: register-file read, second half of Decode']);
  assert.equal(rf.tc, 2 * (200 + 40));
  assert.deepEqual(pipeTiming({ ...D, dmem: 400 }).setBy, ['MEM: MEM/WB register']);
});

test('the three processors with the same delays: single-cycle 990 ps, multicycle 490 ps, pipelined 380 ps', () => {
  assert.equal(classTable(D, MAIN_DECODER, MAIN_OUTPUTS).tc, 990);
  assert.equal(stateTable(D).tc, 490);
  assert.equal(pipeTiming(D).tc, 380);
});

test('Extended (A4-Q13): the shifter in Execute and the Byte unit in Writeback; ResultW, forwarded, now sets the clock', () => {
  const t = pipeTiming(D, true);
  // ResultW: t_pcq + t_byte + t_mux = 100, forwarded (01) after the Hazard Unit's select (70) is ready
  const srcA = 30 + 40 + 30 + 30; // MEM/WB, Byte unit, result multiplexer, forwarding multiplexer
  assert.equal(by(t, 'EX/MEM register'), srcA + 90 + 30 + 180 + 40); // the shifter, the SrcB multiplexer, the ALU, setup
  assert.equal(by(t, 'PC register'), srcA + 90 + 30 + 180 + 30 + 40);
  assert.equal(t.rows.find((r) => r.end === 'PC register').stage, 'EX');
  assert.equal(by(t, 'register-file write, first half of Writeback'), 2 * (30 + 40 + 30 + 40));
  assert.deepEqual([t.tc, t.setBy], [500, ['EX: PC register']]);
  assert.equal(classTable(D, MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT, true).tc, 1030);
  assert.equal(stateTable(D, true).tc, 490);
});
