// armv7-multi.test.mjs -- the ARM multicycle processor (roadmap ARM-A3, §4): the Main FSM's per-state outputs and
// transitions against roadmap §4.3 and §4.4 (Harris and Harris, Fig 7.41, p. 423), the Instr Decoder (Table 7.6), the
// state sequences and cycle counts of §4.5 (Example 7.5, p. 424), the delayed CondEx (pp. 413-414), lock-step with the
// instruction-level engine at the end of every instruction (Fig 7.60, the templates in the base set and generated
// programs), the error rules, and step back of every register, the FSM and the delayed CondEx. The instruction-level
// engine is this application's own model (ARM-A1); agreement with it is not evidence of agreement with any HDL or
// hardware.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, STACK_TOP } from '../src/arch/armv7/language.js';
import { create } from '../src/arch/armv7/engine.js';
import { ArmMulti, STATES, STATE_OUTPUTS, FSM_OUTPUTS, nextState, instrDecode, SEQUENCES, classOf } from '../src/arch/armv7/uarch/multi.js';
import { MULTI_SIGNALS, MULTI_INFO } from '../src/arch/armv7/uarch/signals.js';

const template = (name) => readFileSync(new URL(`../content/armv7/templates/${name}`, import.meta.url), 'utf8');
const build = (text, profile = 'arm-multi') => assemble([{ name: 't.s', text }], { profile });
const ok = (text) => {
  const p = build(text);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};

/**
 * Step the engine one instruction and the processor to the end of that instruction (the next Fetch); then the
 * architectural state, the store and the number of cycles must agree with §4.5.
 */
function lockStep(program, limit = 10_000) {
  const iss = create(program);
  const m = new ArmMulti();
  m.load(program);
  for (let n = 0; n < limit; n++) {
    const rec = iss.step();
    const c0 = m.cycle;
    const w = m.mem.read(m.pc, 4);
    const r = m.stepInstruction();
    if (!rec) {
      assert.equal(r, 'error', `instruction ${n}: the engine stopped (${iss.state().error}), the processor did not`);
      return { m, iss, instructions: n, error: m.error };
    }
    assert.notEqual(r, 'error', `instruction ${n} at 0x${rec.pc.toString(16)}: ${m.error}`);
    assert.deepEqual(m.registers(), iss.state().registers, `instruction ${n} at 0x${rec.pc.toString(16)}`);
    const st = m.history.slice(c0 - m.cycle).map((h) => h.mem).filter(Boolean);
    assert.deepEqual(st.map(([a]) => [a, m.mem.read(a, 4)]), rec.memory.map((x) => [x.address, x.value]), `instruction ${n}: store`);
    const cls = classOf((w >>> 26) & 3, (w >>> 20) & 63);
    assert.equal(m.cycle - c0, SEQUENCES[cls].length, `instruction ${n}: cycles of ${cls}`);
    assert.equal(m.retired, n + 1);
    if (rec.halt) { assert.equal(r, 'halt'); return { m, iss, instructions: n + 1 }; }
    assert.equal(r, 'step');
    assert.equal(m.state, 'Fetch');
  }
  throw new Error('no halt');
}

test('signal dictionary: the signals of Figs 7.30 and 7.31 with their widths; every value fits', () => {
  const want = { PC: 32, Adr: 32, ReadData: 32, Instr: 32, Data: 32, RD1: 32, RD2: 32, A: 32, WriteData: 32, ExtImm: 32, SrcA: 32,
    SrcB: 32, ALUResult: 32, ALUOut: 32, Result: 32, ALUFlags: 4, Flags: 4, RA1: 4, RA2: 4, Cond: 4, Op: 2, Funct: 6, Rd: 4,
    PCWrite: 1, AdrSrc: 1, MemWrite: 1, IRWrite: 1, ResultSrc: 2, ALUControl: 2, ALUSrcB: 2, ALUSrcA: 1, ImmSrc: 2, RegWrite: 1,
    RegSrc: 2, NextPC: 1, Branch: 1, MemW: 1, RegW: 1, ALUOp: 1, FlagW: 2, PCS: 1, CondEx: 1, CondExDelayed: 1, FlagWrite: 2,
    state: 4, next: 4 };
  for (const [k, w] of Object.entries(want)) assert.equal(MULTI_INFO[k]?.width, w, k);
  const m = new ArmMulti();
  m.load(ok(template('fig-7-60.s')));
  for (let i = 0; i < 40; i++) {
    const s = m.evaluate().signals;
    for (const d of MULTI_SIGNALS) assert.ok(Number.isInteger(s[d.name]) && s[d.name] >= 0 && s[d.name] < 2 ** d.width, `cycle ${i}: ${d.name}`);
    m.step();
  }
});

test('Main FSM: the per-state outputs of roadmap §4.4 (Fig 7.41); unlisted enables 0, unlisted selects don\'t-care', () => {
  // state: NextPC Branch MemW RegW IRWrite AdrSrc ResultSrc ALUSrcA ALUSrcB ALUOp (x: don't-care)
  const want = {
    Fetch: '1 0 0 0 1 0 10 1 10 0',
    Decode: '0 0 0 0 0 x 10 1 10 0',
    MemAdr: '0 0 0 0 0 x x 0 01 0',
    MemRead: '0 0 0 0 0 1 00 x x 0',
    MemWB: '0 0 0 1 0 x 01 x x 0',
    MemWrite: '0 0 1 0 0 1 00 x x 0',
    ExecuteR: '0 0 0 0 0 x x 0 00 1',
    ExecuteI: '0 0 0 0 0 x x 0 01 1',
    ALUWB: '0 0 0 1 0 x 00 x x 0',
    Branch: '0 1 0 0 0 x 10 0 01 0',
  };
  const w2 = new Set(['ResultSrc', 'ALUSrcB']);
  assert.deepEqual(STATE_OUTPUTS.map((r) => r.state), STATES);
  for (const r of STATE_OUTPUTS) {
    const got = FSM_OUTPUTS.map((k) => (r[k] === null ? 'x' : r[k].toString(2).padStart(w2.has(k) ? 2 : 1, '0'))).join(' ');
    assert.equal(got, want[r.state], r.state);
  }
});

test('Main FSM: the transitions of roadmap §4.3; the Instr Decoder of Table 7.6', () => {
  assert.equal(nextState('Fetch', 0, 0), 'Decode');
  assert.equal(nextState('Decode', 0b01, 0b011001), 'MemAdr');
  assert.equal(nextState('Decode', 0b00, 0b001000), 'ExecuteR');
  assert.equal(nextState('Decode', 0b00, 0b101000), 'ExecuteI');
  assert.equal(nextState('Decode', 0b10, 0b100000), 'Branch');
  assert.equal(nextState('Decode', 0b11, 0), null);
  assert.equal(nextState('MemAdr', 0b01, 0b011001), 'MemRead');
  assert.equal(nextState('MemAdr', 0b01, 0b011000), 'MemWrite');
  assert.equal(nextState('MemRead', 1, 1), 'MemWB');
  for (const s of ['ExecuteR', 'ExecuteI']) assert.equal(nextState(s, 0, 0), 'ALUWB');
  for (const s of ['MemWB', 'MemWrite', 'ALUWB', 'Branch']) assert.equal(nextState(s, 0, 0), 'Fetch');
  // Table 7.6: LDR, STR (Op 01) RegSrc 1x/10 ImmSrc 01; data-processing (00) RegSrc 00, ImmSrc 00; B (10) RegSrc x1, ImmSrc 10
  assert.deepEqual(instrDecode(0b01), { RegSrc: 0b10, ImmSrc: 0b01 });
  assert.deepEqual(instrDecode(0b00), { RegSrc: 0b00, ImmSrc: 0b00 });
  assert.deepEqual(instrDecode(0b10), { RegSrc: 0b01, ImmSrc: 0b10 });
});

test('state sequences and cycle counts of §4.5 (3 for B, 4 for data-processing and STR, 5 for LDR); a failed condition takes them all', () => {
  const m = new ArmMulti();
  m.load(ok('ADD R0, R0, #1\nADD R1, R0, R0\nSTR R0, [R12, #0x800]\nLDR R2, [R12, #0x800]\nSUBS R3, R3, R3\nBNE x\nADDNE R4, R4, #1\nLDRNE R5, [R12, #0x800]\nx: B .\n'));
  const seen = [];
  let r;
  do { seen.push(m.state); r = m.step(); } while (r === 'step');
  assert.equal(r, 'halt');
  const per = [];
  for (const s of seen) { if (s === 'Fetch') per.push([]); per[per.length - 1].push(s); }
  assert.deepEqual(per, [SEQUENCES.dpImm, SEQUENCES.dpReg, SEQUENCES.str, SEQUENCES.ldr, SEQUENCES.dpReg, SEQUENCES.b, SEQUENCES.dpImm, SEQUENCES.ldr, SEQUENCES.b]);
  assert.equal(m.cycle, 4 + 4 + 4 + 5 + 4 + 3 + 4 + 5 + 3);
  assert.equal(m.retired, 9);
  assert.deepEqual([m.R[4], m.R[5]], [0, 0], 'NE failed: nothing written');
});

test('Example 7.5 (p. 424): the CPI arithmetic from measured counts (3, 4, 4, 5 cycles; 13 % B, 52 % DP, 10 % STR, 25 % LDR)', () => {
  const measure = (text) => { const m = new ArmMulti(); m.load(ok(`${text}\nB .\n`)); m.stepInstruction(); return m.cycle; };
  const c = { b: measure('B y\ny:'), dp: measure('ADD R0, R0, #1'), str: measure('STR R0, [R12, #0x800]'), ldr: measure('LDR R0, [R12, #0x800]') };
  assert.deepEqual(c, { b: 3, dp: 4, str: 4, ldr: 5 });
  const cpi = 0.13 * c.b + (0.52 + 0.10) * c.dp + 0.25 * c.ldr;
  assert.equal(cpi.toFixed(2), '4.12');
});

test('delayed CondEx: flags written in Execute are not seen by the same instruction\'s write-back (pp. 413-414)', () => {
  // ANDSEQ R0, R1, R2 with Z = 1 before: the result 0 keeps Z = 1; ORRSEQ with a non-zero result clears Z in ExecuteI,
  // but ALUWB is still gated by the CondEx of ExecuteI (EQ passed), so R5 is written.
  const m = new ArmMulti();
  m.load(ok('SUBS R0, R0, R0\nORRSEQ R5, R5, #7\nB .\n'));
  m.stepInstruction();
  assert.equal(m.F.Z, 1);
  assert.equal(m.step(), 'step'); // Fetch
  assert.equal(m.step(), 'step'); // Decode
  assert.equal(m.state, 'ExecuteI');
  let s = m.evaluate().signals;
  assert.deepEqual([s.CondEx, s.FlagWrite], [1, 0b10]);
  m.step();
  assert.equal(m.state, 'ALUWB');
  assert.equal(m.F.Z, 0, 'Z cleared at the end of ExecuteI');
  s = m.evaluate().signals;
  assert.equal(s.CondEx, 0, 'EQ now fails on the new flags');
  assert.equal(s.CondExDelayed, 1, 'the delayed CondEx still holds the pass of ExecuteI');
  assert.equal(s.RegWrite, 1);
  m.step();
  assert.equal(m.R[5], 7);
});

test('R15: Decode feeds PC + 8 to the R15 port; STR R15 stores the address + 8; ADD R15 and LDR R15 write the PC', () => {
  const m = new ArmMulti();
  m.load(ok('ADD R0, R0, #0\nSTR R15, [R12, #0x800]\nB .\n'));
  m.stepInstruction();
  m.step(); // Fetch of STR (address 4)
  const s = m.evaluate().signals;
  assert.equal(m.state, 'Decode');
  assert.deepEqual([s.ResultSrc, s.Result, s.RA2, s.RD2], [0b10, 12, 15, 12]);
  assert.equal(m.stepInstruction(), 'step');
  assert.equal(m.mem.read(0x800, 4), 12);
  lockStep(ok('ADD R1, R1, #20\nSTR R1, [R12, #0x800]\nLDR R15, [R12, #0x800]\nB .\nB .\nADD R15, R15, #0\nB .\nB .\n'));
});

test('Fig 7.60 (p. 453): lock-step with the instruction-level engine; 7 stored at 96 and at 100', () => {
  const { m } = lockStep(ok(template('fig-7-60.s')));
  assert.equal(m.mem.read(96, 4), 7);
  assert.equal(m.mem.read(100, 4), 7);
  assert.ok(m.halted);
});

test('templates: those in the base set run in lock-step; the others are refused by the assembler', () => {
  const index = JSON.parse(template('index.json'));
  let base = 0;
  for (const t of index.templates ?? index) {
    const p = build(template(t.file));
    if (!p.ok) { assert.ok(p.diagnostics.some((x) => x.kind === 'profile'), t.file); continue; }
    lockStep(p);
    base += 1;
  }
  assert.ok(base >= 1);
});

/** A generated program in the base set (as test/armv7-single.test.mjs), with backward loops bounded by a counter. */
function generate(seed) {
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  const conds = ['', '', '', 'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE'];
  const ops = ['ADD', 'SUB', 'AND', 'ORR'];
  const reg = () => `R${rnd(11)}`; // R0-R10; R11 is a loop counter, R12 the data base (0)
  const src = () => (rnd(8) === 0 ? 'R15' : reg());
  const n = 8 + rnd(40);
  const lines = ['ADD R11, R11, #3', ...Array.from({ length: 4 }, (_, i) => `ADD R${i}, R${i}, #${rnd(256)}`), 'L0:'];
  for (let i = 0; i < n; i++) {
    const k = rnd(20);
    const c = conds[rnd(conds.length)];
    if (k < 11) {
      const s = rnd(3) === 0 ? 'S' : '';
      const op2 = rnd(2) ? `#${rnd(256)}` : src();
      lines.push(`${ops[rnd(4)]}${c}${s} ${reg()}, ${src()}, ${op2}`);
    } else if (k < 14) lines.push(`LDR${c} ${reg()}, [R12, #${0x800 + 4 * rnd(256)}]`);
    else if (k < 17) lines.push(`STR${c} ${rnd(10) === 0 ? 'R15' : reg()}, [R12, #${0x800 + 4 * rnd(256)}]`);
    else if (k < 19) lines.push(`B${c} L${i + 1 + rnd(3)}`);
    else lines.push(`ADD${c} R15, R15, #${4 * rnd(3)}`);
    lines.push(`L${i + 1}:`);
  }
  for (let j = n + 1; j <= n + 3; j++) lines.push(`L${j}:`);
  // the body again, three times in all; an ADD R15 skip (up to three words) lands on the padding, not past SUBS
  lines.push('ADD R12, R12, #0', 'ADD R12, R12, #0', 'ADD R12, R12, #0', 'SUBS R11, R11, #1', 'BNE L0');
  lines.push('NOP_END: B NOP_END');
  return lines.join('\n');
}

test('generated programs: lock-step with the instruction-level engine at the end of every instruction (400 programs)', () => {
  let instructions = 0;
  for (let k = 1; k <= 400; k++) {
    const text = generate(k * 7919);
    const p = build(text);
    assert.ok(p.ok, `program ${k}: ${JSON.stringify(p.diagnostics)}\n${text}`);
    try { instructions += lockStep(p).instructions; } catch (e) { throw new Error(`program ${k}: ${e.message}\n${text}`); }
  }
  assert.ok(instructions > 8000, `${instructions} instructions`);
});

test('errors: a word outside the base set, an unaligned access, a write of an odd address to R15, leaving the code', () => {
  const runIss = (text) => { const m = new ArmMulti(); m.load(build(text, 'arm-iss')); return [m.run(), m.error, m]; };
  let [r, e, m] = runIss('MOV R0, #1\nB .\n');
  assert.equal(r, 'error');
  assert.match(e, /multicycle processor does not run MOV/);
  assert.equal(m.state, 'Decode');
  [r, e, m] = runIss('ADD R1, R1, #2\nLDR R0, [R1, #0]\nB .\n');
  assert.match(e, /Unaligned load/);
  assert.equal(m.state, 'MemRead');
  [r, e] = runIss('ADD R1, R1, #2\nSTR R0, [R1, #4]\nB .\n');
  assert.match(e, /Unaligned store/);
  [r, e, m] = runIss('ADD R1, R1, #9\nADD R15, R1, #0\nB .\n');
  assert.match(e, /Thumb/);
  assert.equal(m.state, 'ALUWB');
  [r, e] = runIss('ADD R1, R1, #10\nADD R15, R1, #0\nB .\n');
  assert.match(e, /bits 1:0 = 10/);
  [r, e, m] = runIss('ADD R15, R15, #64\nB .\n');
  assert.match(e, /has left the program/);
  assert.equal(m.state, 'Fetch');
  // a failed condition makes no access, so an unaligned address is not an error then
  [r, e] = runIss('ADD R1, R1, #2\nADDS R2, R2, #1\nLDREQ R0, [R1, #0]\nB .\n');
  assert.equal(r, 'halt', e);
});

test('step back restores the registers, flags, memory, PC, FSM state, non-architectural registers and delayed CondEx', () => {
  const p = ok(generate(12345));
  const m = new ArmMulti();
  m.load(p);
  const states = [];
  const snap = () => JSON.stringify([m.registers(), m.state, m.IR, m.Data, m.A, m.WD, m.ALUOut, m.CondExDelayed, m.retired, m.at,
    Array.from({ length: 512 }, (_, i) => m.mem.read(0x800 + 4 * i, 4))]);
  let r;
  do { states.push(snap()); r = m.step(); } while (r === 'step' && states.length < 3000);
  assert.equal(r, 'halt');
  states.push(snap());
  for (let i = states.length - 2; i >= 0; i--) {
    assert.ok(m.back());
    assert.equal(snap(), states[i], `back to cycle ${i}`);
  }
  assert.equal(m.back(), false);
  assert.equal(m.R[13], STACK_TOP);
  // by instruction
  m.load(p);
  m.stepInstruction();
  m.stepInstruction();
  m.step();
  assert.ok(m.backInstruction());
  assert.equal(m.state, 'Fetch');
  assert.equal(m.retired, 2);
  assert.ok(m.backInstruction());
  assert.equal(m.retired, 1);
});
