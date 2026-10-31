// SAP-1 instruction-level engine (src/arch/sap-1/engine.js; arch-contract.md phase 5): the default program, every
// instruction's register writes, wrap-around arithmetic, an unknown opcode, the run budget, watchpoints and step back
// over the output. The conformance suite (arch-contract.test.mjs) checks the contract's part.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptor as d } from '../src/arch/sap-1/index.js';
import { STOP } from '../src/arch/contract.js';

const build = (text, options) => {
  const p = d.language.assemble([{ name: 'main.asm', text }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return d.engine.create(p, options);
};
const runAll = (e) => { let s; do s = e.run({}); while (s === STOP.CHUNK); return s; };

test('the default program shows 28 + 17 - 5 = 40 and halts after five instructions', () => {
  const e = build(d.language.defaultSource);
  assert.equal(runAll(e), STOP.HALT);
  const s = e.state();
  assert.deepEqual([s.registers.A, s.registers.B, s.registers.OUT, s.pc, s.retired, s.halted], [40, 5, 40, 5, 5, true]);
  assert.equal(s.output, 'OUT = 40 (00101000)\n');
  assert.deepEqual(e.counters(), [['Instructions', 5], ['LDA', 1], ['ADD', 1], ['SUB', 1], ['OUT', 1], ['HLT', 1]]);
});

test('each instruction writes MAR, IR and its own registers; LDA, ADD and SUB read memory', () => {
  const e = build('LDA 0EH\nADD 0FH\nSUB 0EH\nOUT\nHLT\nORG 0EH\nDB 3, 9\n');
  const recs = [];
  for (let r; (r = e.step());) recs.push(r);
  const ids = recs.map((r) => r.registers.map((w) => `${w.id}=${w.value}`).join(' '));
  assert.deepEqual(ids, ['MAR=14 IR=14 A=3', 'MAR=15 IR=31 B=9 A=12', 'MAR=14 IR=46 B=3 A=9', 'MAR=3 IR=224 OUT=9', 'MAR=4 IR=240']);
  assert.deepEqual(recs.map((r) => r.reads.map((x) => x.address)), [[14], [15], [14], [], []]);
  assert.equal(recs[4].halt, true);
  assert.equal(recs[3].output, 'OUT = 9 (00001001)\n');
  assert.equal(e.step(), null, 'nothing after HLT');
});

test('arithmetic wraps modulo 256', () => {
  const e = build('LDA x\nSUB y\nOUT\nADD z\nOUT\nHLT\nx: DB 1\ny: DB 2\nz: DB 0FFH\n');
  runAll(e);
  assert.equal(e.state().output, 'OUT = 255 (11111111)\nOUT = 254 (11111110)\n');
});

test('an opcode that is not one of the five stops the run with an error; step back clears it', () => {
  const e = build('LDA 2\nDB 30H\n');
  assert.equal(runAll(e), STOP.ERROR);
  const s = e.state();
  assert.match(s.error, /0x1 has opcode 0011/);
  assert.equal(s.pc, 1);
  assert.equal(e.back(), true);
  assert.deepEqual([e.state().error, e.state().halted, e.state().pc], [null, false, 1]);
  assert.equal(e.back(), true);
  assert.equal(e.state().pc, 0);
});

test('a program without HLT wraps round the memory until the run budget stops it', () => {
  const e = build('OUT\n', { runLimit: 1000 });
  assert.equal(runAll(e), STOP.BUDGET);
  assert.equal(e.state().retired, 1000);
  assert.deepEqual(e.loopRange(), { from: 0, to: 15 });
});

test('a watched register stops the run after the instruction that writes it; step back restores the output', () => {
  const e = build(d.language.defaultSource);
  assert.equal(e.run({ watch: { registers: new Set(['OUT']) } }), STOP.WATCH);
  assert.equal(e.state().pc, 4);
  assert.equal(e.state().output.length > 0, true);
  e.back();
  assert.equal(e.state().output, '');
  assert.equal(e.state().registers.OUT, 0);
});

test('the history limit drops the oldest steps and counts them', () => {
  const e = build('OUT\n', { historyLimit: 4, runLimit: 10 });
  runAll(e);
  assert.equal(e.state().historyDropped, 6);
  let n = 0;
  while (e.back()) n += 1;
  assert.equal(n, 4);
});

test('share links of SAP-1: a state without subset or language options round-trips; RISC-V refuses it', async () => {
  const { createShare } = await import('../src/shell/share.js');
  const { shareSchema } = await import('../src/shell/share-schema.js');
  const { descriptor: rv } = await import('../src/arch/riscv/index.js');
  const sap = createShare(shareSchema(d));
  const state = { arch: 'sap-1', view: 'bus', profile: 'sap1', subset: null, lang: 'asm', name: 'main.asm', source: d.language.defaultSource };
  const back = await sap.decodeFragment(`#${await sap.encodeFragment(state)}`);
  assert.equal(back.arch, 'sap-1');
  assert.equal(back.view, 'bus');
  assert.equal(back.source, d.language.defaultSource);
  await assert.rejects(createShare(shareSchema(rv)).decodeFragment(`#${await sap.encodeFragment(state)}`), /sap-1/);
});

test('trace exports: one record per instruction, as JSON lines and CSV', async () => {
  const p = d.language.assemble([{ name: 'm.asm', text: d.language.defaultSource }]);
  const { records, error } = d.exports.trace(p, { cap: 100 });
  assert.equal(error, null);
  assert.equal(records.length, 5);
  const lines = d.exports.traceJsonLines(records).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { pc: 0, word: 0x0d, asm: 'LDA 0DH', writes: { MAR: 13, IR: 13, A: 28 } });
  assert.equal(lines[4].halt, true);
  const csv = d.exports.traceCsv(records).trim().split('\n');
  assert.equal(csv[0], 'step,pc,word,instruction,A,B,OUT');
  assert.equal(csv[4], '4,0x03,0xe0,"OUT",0x28,0x05,0x28');
  const bad = d.exports.trace(d.language.assemble([{ name: 'b.asm', text: 'OUT\nDB 30H\n' }]), { cap: 100 });
  assert.equal(bad.records.length, 1);
  assert.match(bad.error, /opcode 0011/);
});
