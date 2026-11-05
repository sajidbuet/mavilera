// sap2-bus-model.test.mjs -- the SAP-2 bus model (src/arch/sap-2/bus-model.js; plan step 5) against the microprogram
// approved by the author (docs/architecture/sap-2-microprogram.md) and against the instruction-level engine: every op
// code takes the T states of Table 11-3 (reference sheet §2); after every instruction the model and the engine agree
// (lock-step) on every template, every exercise test and a program of all 43 instructions, the ALU results with B or C
// once T2 of the next fetch has written them; one bus driver per state; step back restores everything.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { BusModel, executeStates, microinstruction, signalsOf, DEFERRED, SIGNALS } from '../src/arch/sap-2/bus-model.js';
import { INSTRUCTIONS, assemble, memoryImage } from '../src/arch/sap-2/language.js';
import { create } from '../src/arch/sap-2/engine.js';
import { parseExercise } from '../src/arch/sap-2/exercise.js';
import { golden } from '../src/arch/sap-2/exports.js';
import { exportModel, WAVE_SIGNALS, transfer } from '../src/arch/sap-2/ui/bus-view.js';

const ROOT = new URL('../', import.meta.url);
const asm = (text) => {
  const p = assemble([{ name: 'p.asm', text }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};

export const ALL = `        MVI A,05H
        MVI B,03H
        MVI C,0FEH
        ADD B
        ADD C
        SUB B
        SUB C
        ANA B
        ANA C
        ORA B
        ORA C
        XRA B
        XRA C
        ANI 0F0H
        ORI 0FH
        XRI 55H
        INR A
        INR B
        INR C
        DCR A
        DCR B
        DCR C
        CMA
        RAL
        RAR
        MOV A,B
        MOV A,C
        MOV B,A
        MOV B,C
        MOV C,A
        MOV C,B
        STA 2000H
        LDA 2000H
        NOP
        CALL twice
        OUT 03H
        MVI A,81H
        OUT 04H
        IN 01H
        IN 02H
        MVI A,01H
        DCR A
        JNZ 0000H
        JZ zero
        HLT
zero:   DCR A
        JM minus
        HLT
minus:  INR A
        JM 0000H
        JZ last
        HLT
last:   JMP end
        HLT
end:    MVI C,02H
loop:   DCR C
        JNZ loop
        HLT
twice:  MOV B,A
        ADD B
        RET
`;

const COMPARE = ['A', 'B', 'C', 'S', 'Z', 'IN1', 'IN2', 'OUT3', 'OUT4'];

/**
 * Run the engine and the model side by side, an instruction at a time, with `inputs` entered before the instruction
 * after `at` of them (the engine's input log). Returns the instructions compared.
 */
function lockStep(program, { inputs = [], limit = 5000, label = '' } = {}) {
  const e = create(program, { inputs });
  const m = new BusModel(program);
  for (const x of inputs.filter((y) => y.at === 0)) m.input(x);
  let n = 0;
  for (; n < limit; n++) {
    const rec = e.step();
    const r = m.stepInstruction();
    const es = e.state();
    if (!rec) { // the engine stopped on an error; the model too, in the same instruction
      assert.equal(r, 'error', `${label}: instruction ${n + 1}: engine error ${es.error}, model ${r}`);
      assert.equal(m.error, es.error, label);
      break;
    }
    const where = `${label}: instruction ${n + 1} at ${rec.pc.toString(16)}`;
    assert.equal(m.retired, es.retired, where);
    assert.equal(m.cycle, e.counters()[1][1], `${where}: T states`);
    if (r === 'halt') {
      assert.ok(rec.halt, where);
      for (const id of COMPARE) assert.equal(m.regs[id], es.registers[id], `${where}: ${id}`);
      break;
    }
    assert.equal(r, 'step', where);
    assert.equal(m.regs.PC, es.pc, `${where}: PC`);
    assert.deepEqual(m.mem, e.peek(0, 0x10000), `${where}: memory`);
    for (const x of inputs.filter((y) => y.at === n + 1)) m.input(x);
    // T1 and T2 of the next fetch: T2 finishes an ALU instruction with B or C
    m.step(); m.step();
    for (const id of COMPARE) assert.equal(m.regs[id], es.registers[id], `${where}: ${id}`);
    assert.equal(m.output, es.output, `${where}: output`);
  }
  assert.ok(n < limit, `${label}: no stop within ${limit} instructions`);
  return n + 1;
}

test('every op code takes the T states of Table 11-3; one bus driver per state; signals of known units', () => {
  for (const ins of INSTRUCTIONS) {
    const s = executeStates(ins.opcode, 0, 0);
    const taken = ins.notTaken ? executeStates(ins.opcode, ins.mnemonic === 'JM' ? 1 : 0, ins.mnemonic === 'JZ' ? 1 : 0) : s;
    assert.equal(3 + taken.length, ins.states, ins.form);
    if (ins.notTaken) {
      const not = executeStates(ins.opcode, ins.mnemonic === 'JM' ? 0 : 0, ins.mnemonic === 'JZ' ? 0 : 1);
      assert.equal(3 + not.length, ins.notTaken, `${ins.form} not taken`);
      assert.equal(not[0].test && taken[0].test, true, `${ins.form}: T4 tests the flag (p. 187)`);
    }
    for (const mi of taken) {
      const sig = signalsOf(mi);
      assert.ok(sig.filter((x) => /^E/.test(x) || x === 'CE').length <= 1, `${ins.form}: one driver`);
      for (const x of sig) assert.ok(SIGNALS.some((y) => y.name === x), x);
    }
  }
  assert.deepEqual(microinstruction(1, 0).dst, ['MAR']);
  assert.deepEqual(signalsOf(microinstruction(3, 0)), ['CE', 'Lmd', 'Li']);
  // the ALU instructions with B or C: 14, finished in T2 of the next fetch (author, 2026-10-30)
  assert.equal(Object.keys(DEFERRED).length, 14);
  assert.deepEqual(signalsOf(microinstruction(2, 0x80)), ['Cp', 'Lf', 'La', 'Eu']);
  assert.deepEqual(signalsOf(microinstruction(2, 0x04)), ['Cp', 'Lf', 'Eu', 'Lb']);
});

test('lock-step with the engine: a program of all 43 instructions', () => {
  const p = asm(ALL);
  const used = new Set(p.listing.map((l) => l.word >>> (8 * (l.size - 1))));
  assert.equal(used.size, 43, 'every op code is in the program');
  lockStep(p, { inputs: [{ at: 0, key: 0x5a }, { at: 0, serialIn: 1 }], label: 'all' });
});

test('lock-step with the engine: every template and every exercise test', () => {
  const T = new URL('content/sap-2/templates/', ROOT);
  for (const f of readdirSync(T).filter((x) => x.endsWith('.asm'))) {
    const inputs = f === 'keyboard.asm' ? [{ at: 0, key: 5 }, { at: 100, key: 10 }, { at: 200, key: 3 }] : [];
    lockStep(asm(readFileSync(new URL(f, T), 'utf8')), { inputs, label: f });
  }
  const X = new URL('content/sap-2/exercises/', ROOT);
  const SOL = new URL('test/fixtures/exercise-solutions/sap-2/', ROOT);
  // the model solutions stay in the private repository (tools/site-files.mjs PRIVATE_ONLY): a public clone checks the templates only
  if (existsSync(SOL)) for (const f of readdirSync(X).filter((x) => x !== 'index.json')) {
    const ex = parseExercise(JSON.parse(readFileSync(new URL(f, X), 'utf8')));
    const p = asm(readFileSync(new URL(f.replace('.json', '.asm'), SOL), 'utf8'));
    for (const t of ex.tests) {
      const image = memoryImage(p);
      for (const b of t.memory) b.bytes.forEach((v, i) => { image[(p.symbols[b.at] ?? b.at) + i] = v; });
      lockStep({ ...p, segments: [{ address: 0, bytes: image, executable: true }] }, { inputs: t.inputs, label: `${f} ${t.name}` });
    }
  }
});

test('errors stop the model in the instruction the engine stops in', () => {
  lockStep(asm('MVI A,1\nSTA 0010H\n'), { label: 'rom' });
  lockStep(asm('DB 0DDH\n'), { label: 'opcode' });
  lockStep(asm('DB 0DBH, 07H\n'), { label: 'port' });
});

test('the ALU result waits for T2 of the next fetch, which the view shows as pending', () => {
  const m = new BusModel(asm('MVI A,5\nMVI B,3\nADD B\nHLT\n'));
  m.stepInstruction(); m.stepInstruction();
  m.stepInstruction(); // ADD B: T1 to T4
  assert.equal(m.regs.TMP, 3);
  assert.equal(m.regs.A, 5, 'not yet');
  assert.equal(m.pending().dst[0], 'A');
  m.step(); m.step(); // T1, T2 of HLT
  assert.equal(m.regs.A, 8);
  assert.equal(m.pending(), null);
  assert.equal(m.stepInstruction(), 'halt');
  assert.equal(m.cycle, 7 + 7 + 4 + 5);
});

test('step back undoes every clock: registers, memory, output, inputs', () => {
  const p = asm(ALL);
  const m = new BusModel(p);
  const regs0 = { ...m.regs };
  const states = [];
  for (let i = 0; i < 400 && !m.halted; i++) {
    if (i === 50) m.input({ key: 9 });
    states.push(JSON.stringify([m.regs, m.t, m.output, m.log]));
    m.step();
  }
  for (let i = states.length - 1; i >= 0; i--) {
    assert.ok(m.back());
    assert.equal(JSON.stringify([m.regs, m.t, m.output, m.log.filter((x) => x.at <= m.cycle)]), states[i], `clock ${i}`);
  }
  assert.deepEqual(m.regs, regs0);
  assert.deepEqual(m.mem, memoryImage(p));
  assert.deepEqual(m.log, []);
  assert.equal(m.back(), false);
});

test('the golden dump: the port writes in order, then the RAM stored, by address (author, 2026-10-30)', () => {
  const sub = readFileSync(new URL('content/sap-2/templates/subroutine.asm', ROOT), 'utf8');
  const m = exportModel(asm(sub));
  assert.equal(m.run(100_000), 'halt');
  assert.deepEqual(golden(m), { text: 'o 3 0e\no 3 1c\nm fffe 0a\nm ffff 00\n', count: 4 });
  const s = exportModel(asm('MVI A,81H\nOUT 04H\nSTA 0900H\nINR A\nSTA 0800H\nSTA 0900H\nHLT\n'));
  assert.equal(s.run(1000), 'halt');
  assert.equal(golden(s).text, 'o 4 81\nm 0800 82\nm 0900 82\n');
  const loop = exportModel(asm('l: JMP l\n'));
  assert.equal(loop.run(1000), 'budget');
});

test('waveforms: every signal of the list has a value in every state; the transfers read as the table', () => {
  const m = exportModel(asm(ALL));
  for (let i = 0; i < 300; i++) {
    const { signals } = m.evaluate();
    assert.deepEqual(Object.keys(signals).sort(), WAVE_SIGNALS.map((x) => x.name).sort());
    for (const w of WAVE_SIGNALS) assert.ok(signals[w.name] >= 0 && signals[w.name] < 2 ** w.width, `${w.name} = ${signals[w.name]}`);
    if (m.step() !== 'step') break;
  }
  assert.equal(transfer(microinstruction(1, 0)), 'MAR ← PC');
  assert.equal(transfer(microinstruction(2, 0)), 'PC ← PC + 1');
  assert.equal(transfer(microinstruction(3, 0)), 'IR ← M[MAR]; MDR ← M[MAR]');
  assert.equal(transfer(microinstruction(2, 0x81)), 'A ← ALU (A + TMP); S, Z ← ALU (A + TMP); PC ← PC + 1');
  assert.equal(transfer(microinstruction(12, 0x32)), 'M[MAR] ← MDR');
  assert.equal(transfer(microinstruction(10, 0xcd)), 'MAR ← 0FFFEH');
});