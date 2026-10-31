// SAP-2 instruction-level engine (src/arch/sap-2/engine.js; plan step 3 of docs/architecture/sap-2-plan.md). No
// reference simulator exists: every expected value is computed by hand from the reference sheet
// (docs/architecture/sap-2-reference.md §2 and its decisions, §9). Each of the 43 instructions on fixed registers;
// flags; INR and DCR of B and C keep A; the book's rotate examples; T states of taken and not-taken jumps; CALL and
// RET through FFFEH-FFFFH; the read-only region; ports and the keyboard handshake; errors; the run budget; watched
// registers and memory; step back with memory; the output cap; and the contract's behavioural checks
// (test/arch-contract.test.mjs), run here until the descriptor is registered (plan step 4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, INSTRUCTIONS } from '../src/arch/sap-2/language.js';
import { create, execute, REGISTER_IDS } from '../src/arch/sap-2/engine.js';
import { STOP, OUTPUT_KEEP } from '../src/arch/contract.js';

const build = (text, options) => {
  const p = assemble([{ name: 'main.asm', text }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return create(p, options);
};
const runAll = (e, options = {}) => { let s; do s = e.run(options); while (s === STOP.CHUNK); return s; };
const h = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const all = (e) => e.peek(0, 0x10000);

// A = 5AH, B = 0FH, C = F0H, S = 0, Z = 1; byte operand 33H; address 1234H holding 77H; FFFEH-FFFFH hold 1020H;
// port 1 = 11H, port 2 = 81H; the instruction at 2000H
const EXPECT = {
  'ADD B': 'A=69 S=0 Z=0 PC=2001 4T', 'ADD C': 'A=4A S=0 Z=0 PC=2001 4T',
  'ANA B': 'A=0A S=0 Z=0 PC=2001 4T', 'ANA C': 'A=50 S=0 Z=0 PC=2001 4T', 'ANI byte': 'A=12 S=0 Z=0 PC=2002 7T',
  'CALL address': 'MFFFE=2003 PC=1234 18T', 'CMA': 'A=A5 PC=2001 4T',
  'DCR A': 'A=59 S=0 Z=0 PC=2001 4T', 'DCR B': 'B=0E S=0 Z=0 PC=2001 4T', 'DCR C': 'C=EF S=1 Z=0 PC=2001 4T',
  'HLT': 'PC=2001 5T', 'IN byte': 'A=81 PC=2002 10T',
  'INR A': 'A=5B S=0 Z=0 PC=2001 4T', 'INR B': 'B=10 S=0 Z=0 PC=2001 4T', 'INR C': 'C=F1 S=1 Z=0 PC=2001 4T',
  'JM address': 'PC=2003 7T', 'JMP address': 'PC=1234 10T', 'JNZ address': 'PC=2003 7T', 'JZ address': 'PC=1234 10T',
  'LDA address': 'A=77 PC=2003 13T',
  'MOV A,B': 'A=0F PC=2001 4T', 'MOV A,C': 'A=F0 PC=2001 4T', 'MOV B,A': 'B=5A PC=2001 4T', 'MOV B,C': 'B=F0 PC=2001 4T',
  'MOV C,A': 'C=5A PC=2001 4T', 'MOV C,B': 'C=0F PC=2001 4T',
  'MVI A,byte': 'A=33 PC=2002 7T', 'MVI B,byte': 'B=33 PC=2002 7T', 'MVI C,byte': 'C=33 PC=2002 7T',
  'NOP': 'PC=2001 4T', 'ORA B': 'A=5F S=0 Z=0 PC=2001 4T', 'ORA C': 'A=FA S=1 Z=0 PC=2001 4T', 'ORI byte': 'A=7B S=0 Z=0 PC=2002 7T',
  'OUT byte': 'OUT3=5A PC=2002 10T', 'RAL': 'A=B4 PC=2001 4T', 'RAR': 'A=2D PC=2001 4T', 'RET': 'PC=1020 10T',
  'STA address': 'M1234=5A PC=2003 13T', 'SUB B': 'A=4B S=0 Z=0 PC=2001 4T', 'SUB C': 'A=6A S=0 Z=0 PC=2001 4T',
  'XRA B': 'A=55 S=0 Z=0 PC=2001 4T', 'XRA C': 'A=AA S=1 Z=0 PC=2001 4T', 'XRI byte': 'A=69 S=0 Z=0 PC=2002 7T',
};

test('each of the 43 instructions on fixed registers: registers, flags, memory, next PC and T states', () => {
  assert.deepEqual(Object.keys(EXPECT).sort(), INSTRUCTIONS.map((i) => i.form).sort());
  for (const ins of INSTRUCTIONS) {
    const mem = new Uint8Array(0x10000);
    mem.set([0x77], 0x1234);
    mem.set([0x20, 0x10], 0xfffe);
    const operand = { IN: [2], OUT: [3] }[ins.mnemonic] ?? (ins.operand === 'byte' ? [0x33] : ins.operand === 'address' ? [0x34, 0x12] : []);
    mem.set([ins.opcode, ...operand], 0x2000);
    const regs = { A: 0x5a, B: 0x0f, C: 0xf0, S: 0, Z: 1, PC: 0x2000, IR: 0, IN1: 0x11, IN2: 0x81, OUT3: 0, OUT4: 0 };
    const x = execute(regs, (a) => mem[a]);
    assert.equal(x.error, undefined, ins.form);
    assert.deepEqual(x.rec.registers[0], { id: 'IR', old: 0, value: ins.opcode }, ins.form);
    const got = [...x.rec.registers.slice(1).map((r) => `${r.id}=${r.id === 'S' || r.id === 'Z' ? r.value : h(r.value)}`), ...x.rec.memory.map((m) => `M${h(m.address)}=${h(m.value)}`),
      `PC=${h(x.rec.nextPc)}`, `${x.states}T`].join(' ');
    assert.equal(got, EXPECT[ins.form], ins.form);
    assert.equal(x.rec.size, ins.bytes, ins.form);
    assert.equal(x.halt, ins.form === 'HLT', ins.form);
  }
});

test('flags: set by the ten flag instructions from the result, kept by the others', () => {
  const e = build('MVI A,05H\nMVI B,03H\nADD B\nSUB B\nSUB B\nSUB B\nMVI C,0FH\nANA C\nXRA C\nORI 80H\nXRI 0FFH\nANI 0F0H\nORA B\nCMA\nHLT\n');
  const seen = [];
  for (let r; (r = e.step());) { const s = e.state().registers; seen.push(`${h(s.A)}${s.S}${s.Z}`); }
  assert.deepEqual(seen, ['0500', '0500', '0800', '0500', '0200', 'FF10', 'FF10', '0F00', '0001', '8010', '7F00', '7000', '7300', '8C00', '8C00']);
  assert.deepEqual(e.counters().slice(0, 2), [['Instructions', 15], ['T states', 79]]);
});

test('INR and DCR of B and C keep A; the flags follow the register (decision 2)', () => {
  const e = build('MVI A,42H\nMVI B,01H\nDCR B\nDCR B\nINR C\nDCR C\nHLT\n');
  e.step(); e.step();
  const r = e.step();
  assert.deepEqual(r.registers.map((w) => `${w.id}=${w.value}`), ['IR=5', 'B=0', 'S=0', 'Z=1']);
  e.step();
  assert.deepEqual([e.state().registers.B, e.state().registers.S, e.state().registers.Z], [0xff, 1, 0]);
  runAll(e);
  const s = e.state().registers;
  assert.deepEqual([s.A, s.B, s.C, s.S, s.Z], [0x42, 0xff, 0, 0, 1]);
});

test('RAL and RAR: the book\'s examples (A = B4H gives 69H and 5AH); the flags are kept', () => {
  const e = build('MVI A,0B4H\nRAL\nMOV B,A\nMVI A,0B4H\nRAR\nHLT\n');
  runAll(e);
  const s = e.state().registers;
  assert.deepEqual([s.B, s.A, s.S, s.Z], [0x69, 0x5a, 0, 0]);
});

test('jumps: taken 10 T states, not taken 7; the counters by mnemonic; step back undoes them', () => {
  const e = build('MVI C,03H\nloop: DCR C\nJNZ loop\nJZ done\nHLT\ndone: JM 0\nHLT\n');
  assert.equal(runAll(e), STOP.HALT);
  assert.equal(e.state().pc, 0x0e);
  assert.deepEqual(e.counters(), [['Instructions', 10], ['T states', 68], ['DCR', 3], ['HLT', 1], ['JM', 1], ['JNZ', 3], ['JZ', 1], ['MVI', 1]]);
  while (e.back());
  assert.deepEqual(e.counters(), [['Instructions', 0], ['T states', 0]]);
});

test('LDA reads and STA writes memory; step back restores the byte', () => {
  const e = build('LDA 0800H\nINR A\nSTA 0801H\nHLT\nORG 0800H\nDB 2AH, 0\n');
  const recs = [e.step(), e.step(), e.step()];
  assert.deepEqual(recs[0].reads, [{ address: 0x800, size: 1 }]);
  assert.deepEqual(recs[2].memory, [{ address: 0x801, size: 1, old: 0, value: 0x2b }]);
  assert.deepEqual([...e.peek(0x800, 2)], [0x2a, 0x2b]);
  assert.deepEqual(e.last().memory, recs[2].memory);
  e.back();
  assert.deepEqual([...e.peek(0x800, 2)], [0x2a, 0]);
});

test('a STA to 0000H-07FFH stops the run with an error naming the address; step back clears it (decision 4)', () => {
  const e = build('MVI A,1\nSTA 07FFH\nHLT\n');
  assert.equal(runAll(e), STOP.ERROR);
  const s = e.state();
  assert.match(s.error, /STA at 0002H writes to 07FFH, in the read-only memory/);
  assert.equal(s.pc, 2);
  assert.equal(e.peek(0x7ff, 1)[0], 0);
  assert.equal(e.step(), null);
  assert.equal(e.back(), true);
  assert.deepEqual([e.state().error, e.state().halted, e.state().pc], [null, false, 2]);
  assert.equal(build('MVI A,1\nSTA 0800H\nHLT\n').run({}), STOP.HALT, '0800H is RAM');
});

test('CALL keeps the return address low byte first at FFFEH; RET returns there; the call hooks (decision 3)', () => {
  const e = build('JMP 2000H\nORG 2000H\nMVI A,01H\nCALL subr\nOUT 03H\nHLT\nsubr: INR A\nRET\n');
  e.step(); e.step();
  assert.equal(e.state().pc, 0x2002);
  assert.equal(e.stepOverTarget(), 0x2005);
  assert.deepEqual(e.dataAccess(), { address: 0xfffe, size: 2 });
  const call = e.step();
  assert.deepEqual(call.memory, [{ address: 0xfffe, size: 2, old: 0, value: 0x2005 }]);
  assert.deepEqual([...e.peek(0xfffe, 2)], [0x05, 0x20]);
  assert.deepEqual([e.state().pc, e.callDepth(), e.stepOutTarget(), e.stepOverTarget()], [0x2008, 1, 0x2005, null]);
  e.step();
  const ret = e.step();
  assert.deepEqual([ret.nextPc, ret.reads], [0x2005, [{ address: 0xfffe, size: 2 }]]);
  assert.deepEqual([e.callDepth(), e.stepOutTarget()], [0, null]);
  assert.equal(runAll(e), STOP.HALT);
  assert.equal(e.state().output, 'Port 3 = 02H = 2 (00000010)\n');
  assert.equal(e.counters()[1][1], 10 + 7 + 18 + 4 + 10 + 10 + 5);
  // step over: run to the address after the CALL at the CALL's depth
  e.reset(); e.step(); e.step();
  assert.equal(e.run({ target: e.stepOverTarget(), depth: e.callDepth() }), STOP.TARGET);
  assert.deepEqual([e.state().pc, e.state().registers.A], [0x2005, 2]);
});

test('ports: a program waits for READY, reads the key, shows it on port 3 and acknowledges (decision 6)', () => {
  const e = build('wait: IN 02H\nANI 01H\nJZ wait\nIN 01H\nOUT 03H\nMVI A,80H\nOUT 04H\nHLT\n');
  assert.equal(e.run({ chunk: 30 }), STOP.CHUNK, 'no key yet');
  assert.equal(e.state().pc, 0);
  e.input({ key: 0x3c, serialIn: 1 });
  assert.deepEqual([e.state().registers.IN1, e.state().registers.IN2], [0x3c, 0x81]);
  const recs = [];
  for (let r; (r = e.step());) recs.push(r);
  const s = e.state().registers;
  assert.deepEqual([s.A, s.IN1, s.IN2, s.OUT3, s.OUT4], [0x80, 0x3c, 0x80, 0x3c, 0x80]);
  assert.deepEqual(recs.at(-2).registers.slice(1), [{ id: 'OUT4', old: 0, value: 0x80 }, { id: 'IN2', old: 0x81, value: 0x80 }]);
  assert.equal(e.state().output, 'Port 3 = 3CH = 60 (00111100)\n');
  e.back(); e.back();
  assert.equal(e.state().registers.IN2, 0x81, 'step back restores READY');
  e.input({ serialIn: 0 });
  assert.equal(e.state().registers.IN2, 0x01);
});

test('inputs are logged by step count: a replay reproduces the run; step back past an input withdraws it', () => {
  const text = 'wait: IN 02H\nANI 01H\nJZ wait\nIN 01H\nOUT 03H\nHLT\n';
  const e = build(text);
  e.input({ serialIn: 1 });
  e.run({ chunk: 9 });
  e.input({ key: 0x41 });
  assert.equal(runAll(e), STOP.HALT);
  assert.deepEqual(e.inputs(), [{ at: 0, serialIn: 1 }, { at: 9, key: 0x41 }]);
  const replay = create(assemble([{ name: 'main.asm', text }]), { inputs: e.inputs() });
  for (let i = 0; i < e.state().steps; i++) replay.step();
  assert.deepEqual(replay.state(), e.state());
  assert.deepEqual(replay.inputs(), e.inputs());
  while (e.state().steps > 9) e.back();
  assert.equal(e.inputs().length, 2, 'at step 9 the key is still entered');
  assert.deepEqual([e.state().registers.IN1, e.state().registers.IN2], [0x41, 0x81]);
  e.back();
  assert.deepEqual(e.inputs(), [{ at: 0, serialIn: 1 }]);
  assert.deepEqual([e.state().registers.IN1, e.state().registers.IN2], [0, 0x80]);
  e.reset();
  assert.deepEqual(e.inputs(), [], 'a reset keeps only the inputs the engine was created with');
  assert.deepEqual(structuredClone(replay.snapshot()).log, replay.inputs());
});

test('a byte that names another port, or is not an op code, stops the run with an error (decision 5)', () => {
  const cases = [['DB 0DBH, 05H\n', /IN at 0000H names input port 5/], ['DB 0D3H, 01H\n', /OUT at 0000H names output port 1/],
    ['NOP\nDB 08H\n', /The byte at 0001H is 08H, which is not an op code of SAP-2/]];
  for (const [text, want] of cases) {
    const e = build(text);
    assert.equal(runAll(e), STOP.ERROR, text);
    assert.match(e.state().error, want);
  }
});

test('a program without HLT runs through the zero bytes (NOP) and wraps at FFFFH until the run budget stops it', () => {
  const e = build('NOP\n', { runLimit: 70000 });
  assert.equal(runAll(e), STOP.BUDGET);
  assert.deepEqual([e.state().retired, e.state().pc], [70000, 70000 - 0x10000]);
  assert.deepEqual(e.loopRange(), { from: 4400, to: 4463 });
});

test('watched registers and memory stop a run after the instruction that writes them', () => {
  const e = build('LDA 0800H\nINR A\nSTA 0801H\nCALL 0900H\nHLT\nORG 0900H\nRET\n');
  assert.equal(e.run({ watch: { registers: new Set(['Z']) } }), STOP.WATCH);
  assert.equal(e.state().pc, 4);
  assert.equal(e.run({ watch: { memory: new Set([0x801]) } }), STOP.WATCH);
  assert.equal(e.state().pc, 7);
  assert.equal(e.run({ watch: { memory: new Set([0xffff]) } }), STOP.WATCH, 'the high byte of the return address');
  assert.equal(e.state().pc, 0x900);
});

test('the history limit drops the oldest steps and counts them', () => {
  const e = build('NOP\n', { historyLimit: 4, runLimit: 10 });
  runAll(e);
  assert.equal(e.state().historyDropped, 6);
  let n = 0;
  while (e.back()) n += 1;
  assert.equal(n, 4);
});

test('the output cap: a long run keeps OUTPUT_KEEP to 2 x OUTPUT_KEEP characters; step back over the drop', () => {
  const e = build('loop: OUT 03H\nJMP loop\n', { runLimit: 200_000 });
  assert.equal(runAll(e), STOP.BUDGET);
  const s = e.state();
  assert.ok(s.outputDropped > 0 && s.output.length <= 2 * OUTPUT_KEEP && s.output.length >= OUTPUT_KEEP);
  assert.equal(s.outputDropped + s.output.length, 100_000 * 28);
  while (e.back());
  assert.deepEqual([e.state().output, e.state().outputDropped], ['', 0]);
});

// the contract's behavioural checks (test/arch-contract.test.mjs) on a program with every kind of step record
const CONTRACT = 'MVI A,01H\nCALL subr\nSTA 0900H\nOUT 03H\nMVI A,80H\nOUT 04H\nLDA 0900H\nHLT\nsubr: INR A\nRET\n';

test('contract: state after each step agrees with the step record and last(); reset', () => {
  const e = build(CONTRACT);
  let s = e.state();
  assert.deepEqual(Object.keys(s.registers).sort(), [...REGISTER_IDS].sort());
  assert.deepEqual([s.pc, s.retired, s.halted], [0, 0, false]);
  for (let r; (r = e.step());) {
    s = e.state();
    for (const w of r.registers) assert.equal(s.registers[w.id], w.value, w.id);
    for (const m of r.memory) assert.equal(e.peek(m.address, m.size).reduceRight((a, b) => a * 256 + b, 0), m.value);
    assert.equal(s.pc, r.nextPc);
    const last = e.last();
    for (const k of ['pc', 'word', 'size', 'nextPc', 'registers', 'memory', 'reads']) assert.deepEqual(last[k], r[k], k);
  }
  assert.deepEqual([s.halted, s.retired, s.steps], [true, 10, 10]);
  e.reset();
  assert.equal(e.last(), null);
});

test('contract: step back restores registers, the whole memory and the PC', () => {
  const e = build(CONTRACT);
  const before = [];
  for (;;) {
    before.push([e.state(), all(e)]);
    if (!e.step()) { before.pop(); break; }
  }
  for (let i = before.length - 1; i >= 0; i--) {
    assert.ok(e.back());
    assert.deepEqual([e.state(), all(e)], before[i], `after ${i} steps`);
  }
  assert.equal(e.back(), false);
});

test('contract: run stops at a breakpoint, then runs to the halt; snapshot and restore; peek has no side effects', () => {
  const e = build(CONTRACT);
  assert.equal(e.run({ breakpoints: new Set([2]) }), STOP.BREAK);
  assert.equal(e.state().pc, 2);
  for (let i = 0; i < 2; i++) e.step();
  const snap = structuredClone(e.snapshot());
  const at = [e.state(), all(e), e.counters(), e.callDepth()];
  assert.deepEqual(all(e), at[1]);
  assert.equal(runAll(e), STOP.HALT);
  e.restore(snap);
  assert.deepEqual([e.state(), all(e), e.counters(), e.callDepth()], at);
  while (e.back());
  assert.deepEqual([e.state().pc, e.state().retired, [...e.peek(0xfffe, 2)]], [0, 0, [0, 0]]);
});
