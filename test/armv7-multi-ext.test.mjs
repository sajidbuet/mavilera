// armv7-multi-ext.test.mjs -- the Extended multicycle processor (uarch/multi-ext.js; roadmap ARM-A3; W-D32 C5 ruling,
// author decisions A3-Q3 to A3-Q5): the per-state outputs of the base states (unchanged but for the two-bit ALUOp) and of
// Link and BranchL, the transitions, the Extended Instr Decoder (ShiftCtl, NoWrite, ByteSel), the cycle count of each
// class, the signal dictionary, lock-step with the instruction-level engine at the end of every instruction (a program
// with every tier-E class and 400 generated programs with BL, shifts, LDRB and negative offsets), NoWrite in ALUWB, BL's
// return address and target, the refused forms, and step back. The instruction-level engine is this application's own
// model (ARM-A1); agreement with it is not evidence of agreement with any HDL or hardware.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/arch/armv7/language.js';
import { create } from '../src/arch/armv7/engine.js';
import { STATE_OUTPUTS } from '../src/arch/armv7/uarch/multi.js';
import { ArmMultiExt, STATES_EXT, STATE_OUTPUTS_EXT, FSM_OUTPUTS_EXT, nextStateExt, instrDecodeExt, classOfExt, SEQUENCES_EXT } from '../src/arch/armv7/uarch/multi-ext.js';
import { MULTI_EXT_SIGNALS, MULTI_EXT_INFO } from '../src/arch/armv7/uarch/signals.js';

const buildExt = (text) => assemble([{ name: 't.s', text }], { profile: 'arm-multi', subset: 'extended' });
const ok = (text) => {
  const p = buildExt(text);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};

/** Step the engine one instruction and the processor to the next Fetch; the state, stores and cycle count must agree. */
function lockStep(program, limit = 20_000) {
  const iss = create(program);
  const m = new ArmMultiExt();
  m.load(program);
  for (let n = 0; n < limit; n++) {
    const rec = iss.step();
    const c0 = m.cycle;
    const w = m.mem.read(m.pc, 4);
    const r = m.stepInstruction();
    if (!rec) {
      assert.equal(r, 'error', `instruction ${n}: the engine stopped (${iss.state().error}), the processor did not`);
      return { m, iss, instructions: n, cycles: m.cycle };
    }
    assert.notEqual(r, 'error', `instruction ${n} at 0x${rec.pc.toString(16)}: ${m.error}`);
    assert.deepEqual(m.registers(), iss.state().registers, `instruction ${n} at 0x${rec.pc.toString(16)}`);
    const st = m.history.slice(c0 - m.cycle).map((h) => h.mem).filter(Boolean);
    assert.deepEqual(st.map(([a]) => [a, m.mem.read(a, 4)]), rec.memory.map((x) => [x.address & ~3, m.mem.read(x.address & ~3, 4)]), `instruction ${n}: store`);
    const cls = classOfExt((w >>> 26) & 3, (w >>> 20) & 63);
    assert.equal(m.cycle - c0, SEQUENCES_EXT[cls].length, `instruction ${n}: cycles of ${cls}`);
    if (rec.halt) { assert.equal(r, 'halt'); return { m, iss, instructions: n + 1, cycles: m.cycle }; }
    assert.equal(r, 'step');
    assert.equal(m.state, 'Fetch');
  }
  throw new Error('no halt');
}

const EVERY = 'MOV R0, #12\nMOV R1, #18\nBL gcd\nMOV R3, R0, LSL #2\nMOV R4, #0x80\nSTR R3, [R4, #0]\nLDRB R5, [R4, #0]\n'
  + 'LDRB R6, [R4, #1]\nSTR R5, [R4, #-4]\nLDR R7, [R4, #-4]\nADDS R8, R0, R1\nADC R9, R0, #1\nRSB R10, R0, #100\nEOR R11, R0, R1\n'
  + 'BIC R12, R1, #2\nTST R0, #1\nCMN R0, #3\nTEQ R0, R0\nCMP R0, #6\nMOVEQ R2, #7\nB .\n'
  + 'gcd: CMP R0, R1\nSUBGT R0, R0, R1\nSUBLT R1, R1, R0\nBNE gcd\nMOV PC, LR\n';

test('signal dictionary: the Extended signals and widths; every value fits its width', () => {
  const want = { state: 4, ALUOp: 2, ALUControl: 4, ResultSrc: 2, NoWrite: 1, Link: 1, ShiftCtl: 7, ByteSel: 1, WA3: 4, ShiftResult: 32,
    ShiftC: 1, ReadByte: 32, DataIn: 32, 'ALUOut1:0': 2 };
  for (const [k, w] of Object.entries(want)) assert.equal(MULTI_EXT_INFO[k]?.width, w, k);
  const m = new ArmMultiExt();
  m.load(ok(EVERY));
  for (let i = 0; i < 140 && !m.halted; i++) {
    const s = m.evaluate().signals;
    for (const d of MULTI_EXT_SIGNALS) assert.ok(Number.isInteger(s[d.name]) && s[d.name] >= 0 && s[d.name] < 2 ** d.width, `cycle ${i}: ${d.name} = ${s[d.name]}`);
    m.step();
  }
});

test('Main FSM: the base states unchanged but for ALUOp (00 add, 01 by U, 10 cmd); Link and BranchL (A3-Q3)', () => {
  for (const r of STATE_OUTPUTS) {
    const x = STATE_OUTPUTS_EXT.find((e) => e.state === r.state);
    for (const k of FSM_OUTPUTS_EXT.filter((o) => o !== 'ALUOp' && o !== 'Link')) assert.equal(x[k], r[k], `${r.state} ${k}`);
    assert.equal(x.ALUOp, { MemAdr: 0b01, ExecuteR: 0b10, ExecuteI: 0b10 }[r.state] ?? 0, r.state);
    assert.equal(x.Link, 0);
  }
  const link = STATE_OUTPUTS_EXT.find((e) => e.state === 'Link');
  assert.deepEqual([link.RegW, link.ResultSrc, link.Link, link.ALUSrcA, link.ALUSrcB, link.Branch, link.NextPC], [1, 0b11, 1, 0, 0b01, 0, 0]);
  const bl = STATE_OUTPUTS_EXT.find((e) => e.state === 'BranchL');
  assert.deepEqual([bl.Branch, bl.ResultSrc, bl.RegW, bl.MemW], [1, 0b00, 0, 0]);
  assert.deepEqual(STATES_EXT.slice(10), ['Link', 'BranchL']);
});

test('transitions: B to Branch, BL through Link and BranchL; the rest as the base FSM', () => {
  assert.equal(nextStateExt('Decode', 0b10, 0b000000), 'Branch');
  assert.equal(nextStateExt('Decode', 0b10, 0b010000), 'Link');
  assert.equal(nextStateExt('Link', 0b10, 0b010000), 'BranchL');
  assert.equal(nextStateExt('BranchL', 0b10, 0b010000), 'Fetch');
  assert.equal(nextStateExt('Decode', 0b01, 0b000101), 'MemAdr');
  assert.equal(nextStateExt('MemAdr', 0b01, 0b000101), 'MemRead');
  assert.equal(nextStateExt('Decode', 0b00, 0b100000), 'ExecuteI');
});

test('Extended Instr Decoder: ShiftCtl for a register operand only, NoWrite for TST/TEQ/CMP/CMN, ByteSel for LDRB/STRB', () => {
  const word = (text) => buildExt(`${text}\nB .\n`).segments.find((s) => s.executable).bytes.slice(0, 4).reduce((v, b, i) => v | (b << (8 * i)), 0) >>> 0;
  const dec = (text) => { const w = word(text); return instrDecodeExt((w >>> 26) & 3, (w >>> 20) & 63, w); };
  assert.equal(dec('ADD R0, R1, R2, LSL #3').ShiftCtl, (3 << 2) | 0);
  assert.equal(dec('ADD R0, R1, #3').ShiftCtl, 0);
  for (const t of ['TST R0, #1', 'TEQ R0, R1', 'CMP R0, #1', 'CMN R0, R1']) assert.equal(dec(t).NoWrite, 1, t);
  for (const t of ['ADDS R0, R0, #1', 'ORRS R0, R0, R1', 'MOVS R0, #1', 'BIC R0, R0, #1']) assert.equal(dec(t).NoWrite, 0, t);
  assert.equal(dec('LDRB R0, [R1, #1]').ByteSel, 1);
  assert.equal(dec('LDR R0, [R1, #4]').ByteSel, 0);
});

test('a program with every tier-E class: lock-step with the instruction-level engine; BL takes 4 cycles, LDRB 5', () => {
  const { m, instructions, cycles } = lockStep(ok(EVERY));
  assert.equal(instructions, 34);
  assert.equal(cycles, 135);
  assert.deepEqual([...m.R].slice(0, 13), [6, 6, 7, 24, 128, 24, 0, 24, 12, 7, 94, 0, 4]);
});

test('BL: Link writes R14 = the address + 4 and ALUOut = the target; BranchL writes the PC from ALUOut', () => {
  const m = new ArmMultiExt();
  m.load(ok('MOV R0, #1\nBL f\nB .\nf: MOV PC, LR\n'));
  m.stepInstruction(); // MOV
  m.step(); m.step(); // BL: Fetch, Decode
  assert.equal(m.state, 'Link');
  const s = m.evaluate().signals;
  assert.deepEqual([s.WA3, s.Result, s.RegWrite, s.PCWrite, s.ALUResult], [14, 8, 1, 0, 12]); // BL at 4: LR = 8, f at 12
  m.step();
  assert.equal(m.R[14], 8);
  assert.equal(m.ALUOut, 12);
  assert.equal(m.state, 'BranchL');
  assert.equal(m.evaluate().signals.Result, 12);
  m.step();
  assert.deepEqual([m.pc, m.state], [12, 'Fetch']);
});

test('NoWrite: CMP passes through ALUWB with RegWrite held at 0; its flags are written in ExecuteI', () => {
  const m = new ArmMultiExt();
  m.load(ok('MOV R3, #5\nCMP R3, #5\nB .\n'));
  m.stepInstruction();
  m.step(); m.step(); // CMP: Fetch, Decode
  assert.equal(m.state, 'ExecuteI');
  assert.equal(m.evaluate().signals.FlagWrite, 0b11);
  m.step();
  const s = m.evaluate().signals;
  assert.deepEqual([m.state, s.RegW, s.NoWrite, s.CondExDelayed, s.RegWrite], ['ALUWB', 1, 1, 1, 0]);
  m.step();
  assert.deepEqual([m.R[3], m.F.Z, m.F.C], [5, 1, 1]);
});

test('LDRB: the Byte unit loads Data with the byte at ALUOut1:0 in MemRead; no alignment is needed', () => {
  const m = new ArmMultiExt();
  m.load(ok('MOV R1, #0x80\nLSL R1, R1, #4\nMOV R2, #0x42\nLSL R2, R2, #8\nORR R2, R2, #0x41\nSTR R2, [R1, #0]\nLDRB R3, [R1, #1]\nLDRB R4, [R1, #0]\nB .\n'));
  for (let i = 0; i < 6; i++) m.stepInstruction();
  m.step(); m.step(); m.step(); // Fetch, Decode, MemAdr
  const s = m.evaluate().signals;
  assert.deepEqual([m.state, s.ByteSel, s['ALUOut1:0'], s.ReadByte, s.DataIn], ['MemRead', 1, 1, 0x42, 0x42]);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[3], m.R[4]], [0x42, 0x41]);
});

/** A generated tier-E program (as test/armv7-single.test.mjs generateExt), with a subroutine called by BL. */
function generateExt(seed) {
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  const conds = ['', '', '', 'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE'];
  const three = ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'ORR', 'BIC'];
  const tests = ['TST', 'TEQ', 'CMP', 'CMN'];
  const shifts = ['LSL', 'LSR', 'ASR', 'ROR'];
  const reg = () => `R${rnd(11)}`; // R0-R10; R11 = 0x800 base, R12 = 0x1000 base
  const src = () => (rnd(8) === 0 ? 'R15' : reg());
  const op2 = () => {
    const k = rnd(4);
    if (k === 0) return `#${rnd(256)}`;
    if (k === 1) return src();
    const s = shifts[rnd(4)];
    return `${reg()}, ${s} #${s === 'LSL' || s === 'ROR' ? 1 + rnd(31) : 1 + rnd(32)}`;
  };
  const n = 8 + rnd(40);
  const lines = ['MOV R11, #128', 'LSL R11, R11, #4', 'MOV R12, #1', 'LSL R12, R12, #12', ...Array.from({ length: 4 }, (_, i) => `MOV R${i}, #${rnd(256)}`)];
  for (let i = 0; i < n; i++) {
    const k = rnd(24);
    const c = conds[rnd(conds.length)];
    const s = rnd(3) === 0 ? 'S' : '';
    if (k < 8) lines.push(`${three[rnd(three.length)]}${c}${s} ${reg()}, ${src()}, ${op2()}`);
    else if (k < 10) lines.push(`${tests[rnd(4)]}${c} ${src()}, ${op2()}`);
    else if (k < 12) lines.push(rnd(2) ? `MOV${c}${s} ${reg()}, ${op2()}` : `${shifts[rnd(4)]}${c}${s} ${reg()}, ${reg()}, #${1 + rnd(31)}`);
    else if (k < 14) lines.push(`LDR${c} ${reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${4 * rnd(256)}]`);
    else if (k < 16) lines.push(`LDRB${c} ${reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${rnd(1024)}]`);
    else if (k < 18) lines.push(`STR${c} ${rnd(10) === 0 ? 'R15' : reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${4 * rnd(256)}]`);
    else if (k < 20) lines.push(`B${c} L${i + 1 + rnd(3)}`);
    else if (k < 22) lines.push(`BL${c} SUB`);
    else lines.push(`ADD${c} R15, R15, #${4 * rnd(3)}`);
    lines.push(`L${i + 1}:`);
  }
  for (let j = n + 1; j <= n + 3; j++) lines.push(`L${j}:`);
  lines.push('B END', 'B END', 'B END', 'END: B END', 'SUB: ADD R10, R10, #1', 'MOV PC, LR');
  return lines.join('\n');
}

test('generated tier-E programs: lock-step with the instruction-level engine at the end of every instruction (400 programs)', () => {
  let cycles = 0;
  const seen = new Set();
  for (let k = 1; k <= 400; k++) {
    const text = generateExt(k * 104729);
    const p = buildExt(text);
    assert.ok(p.ok, `program ${k}: ${JSON.stringify(p.diagnostics.slice(0, 3))}\n${text}`);
    try {
      const r = lockStep(p);
      cycles += r.cycles;
      for (const h of r.m.history) seen.add(h.state);
    } catch (e) { throw new Error(`program ${k}: ${e.message}\n${text}`); }
  }
  assert.ok(cycles > 10_000, `${cycles} cycles`);
  assert.deepEqual([...seen].sort(), [...STATES_EXT].sort(), 'every state is visited');
});

test('refused: an instruction-level form names the Extended processor; the base model still refuses MOV', () => {
  const m = new ArmMultiExt();
  m.load(assemble([{ name: 't.s', text: 'MOV R0, #0x10000\nB .\n' }]));
  assert.equal(m.run(), 'error');
  assert.match(m.error, /Extended multicycle processor does not run/);
  assert.equal(buildExt('ADD R0, R1, R2, LSL R3\nB .\n').ok, false);
});

test('step back restores every register, the state, CondExDelayed and the memory, through BL and LDRB', () => {
  const m = new ArmMultiExt();
  m.load(ok(EVERY));
  const snap = () => JSON.stringify([m.registers(), m.state, m.IR, m.Data, m.A, m.WD, m.ALUOut, m.CondExDelayed, m.cycle, m.mem.read(0x80, 4), m.mem.read(0x7c, 4)]);
  const seen = [];
  while (!m.halted) { seen.push(snap()); m.step(); }
  for (let i = seen.length - 1; i >= 0; i--) { assert.ok(m.back()); assert.equal(snap(), seen[i], `cycle ${i}`); }
});
