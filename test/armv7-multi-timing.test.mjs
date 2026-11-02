// armv7-multi-timing.test.mjs -- the critical path of each state of the ARM multicycle processor (uarch/multi-timing.js;
// author decision A3-Q6): every state's delay with the default illustrative delays (content/armv7/data/single-delays.json)
// against a hand calculation, the path's start and end, the clock period and the state that sets it, a delay edited, and
// the current cycle's path from the model's own signals. The delays are illustrative, not Harris and Harris's Table 7.5
// (W-D32 Q9); these values are this application's, not a statement about any hardware.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { multiCriticalPath, stateSignals, stateTable, MULTI_DELAY_KEYS, MULTI_EXT_DELAY_KEYS } from '../src/arch/armv7/uarch/multi-timing.js';
import { STATES_EXT } from '../src/arch/armv7/uarch/multi-ext.js';
import { delayMap } from '../src/arch/armv7/uarch/timing.js';
import { ArmMulti, STATES } from '../src/arch/armv7/uarch/multi.js';
import { assemble } from '../src/arch/armv7/language.js';

const json = JSON.parse(readFileSync(new URL('../content/armv7/data/single-delays.json', import.meta.url), 'utf8'));
const D = delayMap(json);

// Hand calculation (pcq 30, setup 40, memory 250, rf 120, ext 50, mux 30, alu 180, dec 60, aludec 30, cond 40, gate 20).
// Main FSM outputs 30 + 60 = 90; Instr Decoder 90; ALU Decoder max(90, 30) + 30 = 120.
const HAND = {
  Fetch: [410, 'IR'], //                 Adr 90 + 30 = 120; ReadData 370; IR 410 (PC: ALU 300, Result 330, PC 370)
  Decode: [490, 'A register'], //        RA1 = 15: Result = PC + 4 = 330; RD1 330 + 120 = 450; A 490
  MemAdr: [390, 'ALUOut register'], //   ExtImm 90 + 50 = 140; SrcB 170; ALU 350; ALUOut 390
  MemRead: [410, 'Data register'], //    Adr 120; ReadData 370; Data 410
  MemWB: [160, 'register file'], //      Result 120; rf 160 (RegWrite 110)
  MemWrite: [160, 'memory'], //          Adr 120; memory 160 (MemWrite 110)
  ExecuteR: [340, 'ALUOut register'], // SrcB 120; ALU max(120, 120, 120) + 180 = 300; ALUOut 340; the flags also 340
  ExecuteI: [390, 'ALUOut register'], // SrcB 170; ALU 350; ALUOut 390; the flags also 390
  ALUWB: [160, 'register file'], //      Result 120; rf 160
  Branch: [420, 'PC register'], //       ALU 350; Result 380; PC 420 (PCWrite 150)
};

test('every delay key the multicycle timing uses is in the delay table', () => {
  for (const k of MULTI_DELAY_KEYS) assert.ok(Number.isFinite(D[k]), k);
});

test('each state\'s critical path with the default delays equals the hand calculation', () => {
  for (const state of STATES) {
    const r = multiCriticalPath(D, stateSignals(state)).critical;
    assert.deepEqual([r.delay, r.end], HAND[state], state);
    assert.ok(['state', 'PC', 'Instr', 'Data', 'A', 'WriteData', 'ALUOut', 'Flags', 'CondExDelayed'].includes(r.path[0].node), `${state} starts at a register`);
    assert.equal(r.path[0].t, D.pcq);
  }
});

test('the clock period is the slowest state: Decode, which reads R15 through the ALU and the Result multiplexer', () => {
  const t = stateTable(D);
  assert.equal(t.tc, 490);
  assert.deepEqual(t.setBy, ['Decode']);
  assert.deepEqual(t.rows.find((r) => r.state === 'Decode').path.map((p) => p.node),
    ['state', 'Main FSM', 'SrcA', 'ALUResult', 'Result', 'RD1', 'A register']); // the select ALUSrcA comes after the PC
});

test('an edited delay moves the clock: a slower memory makes Fetch and MemRead set it', () => {
  const t = stateTable({ ...D, imem: 400 });
  assert.equal(t.tc, 560);
  assert.deepEqual(t.setBy, ['Fetch', 'MemRead']);
});

// The Extended processor (shift 90, byte 40): the shifter, the Byte unit, the A3 multiplexer and NoWrite on the paths.
const HAND_EXT = {
  ...HAND,
  MemRead: [480, 'Data register'], //     ReadData 370; ReadByte 410; DataIn 440; Data 480
  ExecuteR: [430, 'ALUOut register'], //  ShiftResult max(90, 30, 30) + 90 = 180; SrcB 210; ALU 390; ALUOut 430 (the flags also 430)
  Link: [390, 'ALUOut register'], //      ALUOut <- A + ExtImm: 390 (R14: Result 120, WA3 120, rf 160)
  BranchL: [220, 'PC register'], //       PCS after WA3 140; PCSGated 160; PCWrite 180; PC 220 (Result 120)
};

test('Extended: each state\'s critical path equals the hand calculation; Decode still sets the clock', () => {
  for (const state of STATES_EXT) {
    const r = multiCriticalPath(D, stateSignals(state, true), true).critical;
    assert.deepEqual([r.delay, r.end], HAND_EXT[state], state);
  }
  const t = stateTable(D, true);
  assert.deepEqual([t.tc, t.setBy], [490, ['Decode']]);
  assert.deepEqual(stateTable({ ...D, byte: 60 }, true).setBy, ['MemRead'], 'a slower Byte unit makes LDRB\'s MemRead set it');
  for (const k of MULTI_EXT_DELAY_KEYS) assert.ok(Number.isFinite(D[k]), k);
});

test('the current cycle: the path from the model\'s own signals; a failed condition removes the write endpoints', () => {
  const p = assemble([{ name: 't.s', text: 'SUBS R0, R0, #0\nADDNE R6, R6, #1\nB .\n' }], { profile: 'arm-multi' });
  const m = new ArmMulti();
  m.load(p);
  for (let i = 0; i < 7; i++) m.step(); // the ALUWB of ADDNE, whose condition failed
  const c = m.evaluate();
  assert.equal(c.state, 'ALUWB');
  const r = multiCriticalPath(D, c.signals);
  assert.deepEqual(r.endpoints.map((e) => e.end), ['CondExDelayed register']);
});
