// SAP-1 bus model (src/arch/sap-1/bus-model.js; arch-contract.md phase 5): the timing states and control signals of
// each instruction, one bus driver per state, the control word, and the same registers, output and count as the
// instruction-level engine at every instruction boundary; step back by clock and by instruction.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BusModel, controlSignals, controlWord, SIGNALS } from '../src/arch/sap-1/bus-model.js';
import { assemble } from '../src/arch/sap-1/language.js';
import { create } from '../src/arch/sap-1/engine.js';
import { DEFAULT_SOURCE } from '../src/arch/sap-1/index.js';

const prog = (text) => { const p = assemble([{ name: 'm.asm', text }]); assert.ok(p.ok, JSON.stringify(p.diagnostics)); return p; };

const PROGRAMS = [
  DEFAULT_SOURCE,
  'LDA x\nSUB y\nOUT\nADD z\nOUT\nHLT\nx: DB 1\ny: DB 2\nz: DB 0FFH\n',
  'LDA 0FH\nADD 0FH\nADD 0FH\nADD 0FH\nOUT\nSUB 0EH\nOUT\nHLT\nORG 0EH\nDB 100, 70\n',
  'OUT\nLDA 3\nOUT\nHLT\n',
];

test('fetch is T1 Ep Lm, T2 Cp, T3 CE Li; each instruction its own T4 to T6', () => {
  assert.deepEqual([1, 2, 3].map((t) => controlSignals(t, 0)), [['Ep', 'Lm'], ['Cp'], ['CE', 'Li']]);
  const ex = (ir) => [4, 5, 6].map((t) => controlSignals(t, ir).join(' '));
  assert.deepEqual(ex(0x09), ['Ei Lm', 'CE La', '']);
  assert.deepEqual(ex(0x19), ['Ei Lm', 'CE Lb', 'Eu La']);
  assert.deepEqual(ex(0x29), ['Ei Lm', 'CE Lb', 'Su Eu La']);
  assert.deepEqual(ex(0xe0), ['Ea Lo', '', '']);
});

test('the control word: twelve bits, active-low signals 0 when asserted', () => {
  assert.equal(SIGNALS.length, 12);
  assert.equal(controlWord([]), 0b001111100011); // nothing asserted: every active-low signal high
  assert.equal(controlWord(['Ep', 'Lm']), 0x5e3);
  assert.equal(controlWord(['Cp']), 0xbe3);
});

test('the microprogram: every CON word of Malvino and Brown, Table 10-5 and the fetch table of Sec. 10-7', () => {
  const con = (t, op) => controlWord(controlSignals(t, op << 4)).toString(16).toUpperCase().padStart(3, '0');
  for (const op of [0x0, 0x1, 0x2, 0xe, 0xf]) assert.deepEqual([1, 2, 3].map((t) => con(t, op)), ['5E3', 'BE3', '263']);
  assert.deepEqual([4, 5, 6].map((t) => con(t, 0x0)), ['1A3', '2C3', '3E3']); // LDA
  assert.deepEqual([4, 5, 6].map((t) => con(t, 0x1)), ['1A3', '2E1', '3C7']); // ADD
  assert.deepEqual([4, 5, 6].map((t) => con(t, 0x2)), ['1A3', '2E1', '3CF']); // SUB
  assert.deepEqual([4, 5, 6].map((t) => con(t, 0xe)), ['3F2', '3E3', '3E3']); // OUT
  assert.deepEqual([4, 5, 6].map((t) => con(t, 0xf)), ['3E3', '3E3', '3E3']); // HLT: no control routine, the clock stops
  // the electrical levels: an active-low signal is 0 exactly when asserted
  for (const t of [1, 2, 3, 4, 5, 6]) {
    for (const op of [0x0, 0x1, 0x2, 0xe]) {
      const on = controlSignals(t, op << 4);
      const w = controlWord(on);
      SIGNALS.forEach((s, i) => assert.equal((w >> (11 - i)) & 1, on.includes(s.name) !== s.low ? 1 : 0, `T${t} ${op} ${s.name}`));
    }
  }
});

test('timing: T1 PC to MAR, T2 count, T3 RAM to IR; ADD and SUB T6 load the sum or difference into A', () => {
  const m = new BusModel(prog('LDA 4\nADD 5\nSUB 6\nHLT\nDB 9, 5, 3\n'));
  let e = m.evaluate();
  assert.deepEqual([e.t, e.signals, e.driver, e.bus, e.loads], [1, ['Ep', 'Lm'], 'PC', 0, [['MAR', 0]]]);
  m.step();
  e = m.evaluate();
  assert.deepEqual([e.t, e.signals, e.driver, e.loads], [2, ['Cp'], null, [['PC', 1]]]);
  m.step();
  e = m.evaluate();
  assert.deepEqual([e.t, e.signals, e.driver, e.loads], [3, ['CE', 'Li'], 'RAM', [['IR', 0x04]]]);
  m.stepInstruction(); // LDA 4: A = 9
  for (let i = 0; i < 5; i++) m.step();
  e = m.evaluate(); // ADD, T6
  assert.deepEqual([e.t, e.signals, e.driver, e.bus, e.loads], [6, ['Eu', 'La'], 'ALU', 14, [['A', 14]]]);
  m.step();
  for (let i = 0; i < 5; i++) m.step();
  e = m.evaluate(); // SUB, T6
  assert.deepEqual([e.t, e.signals, e.driver, e.bus, e.loads], [6, ['Su', 'Eu', 'La'], 'ALU', 11, [['A', 11]]]);
  m.step();
  assert.deepEqual([m.regs.A, m.regs.B, m.t], [11, 3, 1]);
});

test('HLT: the decoder asserts HLT bar from opcode 1111; the clock stops in T4', async () => {
  const { haltLine } = await import('../src/arch/sap-1/bus-model.js');
  assert.equal(haltLine(0xf0), true);
  assert.equal(haltLine(0xe0), false);
  const m = new BusModel(prog('HLT\n'));
  assert.equal(m.step(), 'step');
  assert.equal(m.step(), 'step');
  assert.equal(m.step(), 'step');
  assert.ok(haltLine(m.regs.IR));
  assert.equal(m.step(), 'halt');
  assert.deepEqual([m.t, m.cycle, m.halted], [4, 4, true]);
  assert.equal(m.step(), 'halt'); // no further clock
  assert.equal(m.cycle, 4);
});

test('at most one driver on the bus in every state; a load always has a driver', () => {
  for (const text of PROGRAMS) {
    const m = new BusModel(prog(text));
    for (let i = 0; i < 200 && !m.halted; i++) {
      const e = m.evaluate();
      const drivers = e.signals.filter((s) => ['Ep', 'CE', 'Ei', 'Ea', 'Eu'].includes(s));
      assert.ok(drivers.length <= 1, `${e.t}: ${e.signals}`);
      if (e.loads.some(([id]) => id !== 'PC')) assert.ok(e.driver, `T${e.t} loads without a driver`);
      m.step();
    }
  }
});

test('the bus model agrees with the engine after every instruction', () => {
  for (const text of PROGRAMS) {
    const p = prog(text);
    const m = new BusModel(p);
    const e = create(p);
    for (let i = 0; i < 40; i++) {
      const r = m.stepInstruction();
      const rec = e.step();
      const s = e.state();
      assert.deepEqual(m.regs, s.registers, `${text.split('\n')[0]}: instruction ${i}`);
      assert.equal(m.output, s.output);
      assert.equal(m.retired, s.retired);
      assert.equal(m.halted, s.halted);
      if (r === 'halt') { assert.ok(rec.halt); break; }
    }
    assert.ok(m.halted, 'halts');
  }
});

test('six states per instruction, HLT stops in T4; CPI of the default program', () => {
  const m = new BusModel(prog(DEFAULT_SOURCE));
  while (m.step() === 'step');
  assert.deepEqual([m.cycle, m.retired, m.t], [4 * 6 + 4, 5, 4]);
});

test('step back by clock returns every state; by instruction to its T1', () => {
  const m = new BusModel(prog(DEFAULT_SOURCE));
  const seen = [];
  while (!m.halted) { seen.push(JSON.stringify([m.regs, m.t, m.cycle, m.retired, m.output])); m.step(); }
  for (let i = seen.length - 1; i >= 0; i--) {
    assert.ok(m.back());
    assert.equal(JSON.stringify([m.regs, m.t, m.cycle, m.retired, m.output]), seen[i]);
  }
  assert.equal(m.back(), false);
  m.step(); m.step();
  assert.ok(m.backInstruction());
  assert.deepEqual([m.t, m.cycle], [1, 0]);
});

test('an unknown opcode stops in T4 with an error; step back clears it', () => {
  const m = new BusModel(prog('DB 30H\n'));
  let r;
  do r = m.step(); while (r === 'step');
  assert.equal(r, 'error');
  assert.equal(m.t, 4);
  assert.match(m.error, /opcode 0011/);
  assert.ok(m.back());
  assert.equal(m.error, null);
});

test('waveforms and VCD of the bus view: one frame per timing state, up to the halt', async () => {
  const { exportModel, WAVE_SIGNALS } = await import('../src/arch/sap-1/ui/bus-view.js');
  const { recordFrames, vcd } = await import('../src/shell/vcd.js');
  const { frames, stop } = recordFrames(exportModel(prog(DEFAULT_SOURCE)), 1000);
  assert.equal(stop, 'halt');
  assert.equal(frames.length, 28);
  assert.deepEqual([frames[0].T, frames[0].Ep, frames[0].Lm, frames[0].bus], [1, 1, 1, 0]);
  assert.deepEqual([frames[3].T, frames[3].Ei, frames[3].bus], [4, 1, 0x0d]); // LDA first: the address field on the bus
  assert.equal(frames[27].T, 4); // HLT's T4, the halt cycle
  for (const f of frames) for (const s of WAVE_SIGNALS) assert.ok(Number.isInteger(f[s.name]), s.name);
  const text = vcd(frames, WAVE_SIGNALS, { module: 'sap1' });
  assert.match(text, /\$var wire 1 \S+ Ep \$end/);
  assert.match(text, /\$var wire 8 \S+ bus \[7:0\] \$end/);
});
