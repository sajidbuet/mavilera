// armv7-pipe.test.mjs -- the ARM pipelined processor (roadmap ARM-A4, §5): the Hazard Unit's equations (Harris and
// Harris, pp. 433-440, Fig 7.58) and their costs (Example 7.7, p. 441): forwarding priority (Memory before Writeback),
// the one-cycle load-use stall, the two flushed instructions of a taken branch and none for a branch not taken, the wait
// of a write to R15 until Writeback, bubbles without effect, flags set in Execute just before a conditional branch, the
// correction of StallF (A4-Q2, D15), the hold of a stalled Decode register over its flush, the stalls no register needs
// (A4-Q1, A4-Q3); lock-step with the instruction-level engine at every retired instruction (Fig 7.60, the templates in
// the base set, generated programs); the CPI of Example 7.7 from a program with its mix; the error rules; step back; the
// teaching modes without the full Hazard Unit. The instruction-level engine is this application's own model (ARM-A1);
// agreement with it is not evidence of agreement with any HDL or hardware.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, STACK_TOP } from '../src/arch/armv7/language.js';
import { create } from '../src/arch/armv7/engine.js';
import { ArmPipe, sourcesOf } from '../src/arch/armv7/uarch/pipe.js';
import { PIPE_SIGNALS, PIPE_INFO } from '../src/arch/armv7/uarch/signals.js';

const template = (name) => readFileSync(new URL(`../content/armv7/templates/${name}`, import.meta.url), 'utf8');
const build = (text, profile = 'arm-pipe') => assemble([{ name: 't.s', text }], { profile });
const ok = (text) => {
  const p = build(text);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};
const pipe = (text, hazard = 'full') => {
  const m = new ArmPipe({ hazard });
  m.load(ok(text));
  return m;
};
const flagsOf = (r) => (r.N << 3) | (r.Z << 2) | (r.C << 1) | r.V;

/** Step until the instruction at address `at` is in stage `stage` (IF, ID, EX, MEM, WB); returns its signals. */
function until(m, stage, at, limit = 200) {
  for (let i = 0; i < limit; i++) {
    const c = m.evaluate();
    const seq = c.seq[stage];
    const inst = seq && m.instance(seq);
    const live = stage === 'IF' || { ID: !m.D.bubble, EX: !m.E.bubble, MEM: !m.M.bubble, WB: !m.W.bubble }[stage];
    if (inst && inst.kind === 'instr' && inst.pc === at && live) return c.signals;
    assert.equal(m.step(), 'step');
  }
  throw new Error(`0x${at.toString(16)} never in ${stage}`);
}

/**
 * Run the processor and the engine side by side: each time an instruction retires (leaves Writeback), the engine steps
 * one instruction; the addresses must agree, and after the edge the register file (R0-R14) and the flags the
 * instruction left in Execute must equal the engine's. The stores, in order, and the final memory must agree too.
 */
function lockStep(program, limit = 200_000) {
  const iss = create(program);
  const m = new ArmPipe();
  m.load(program);
  const stores = [];
  const issStores = [];
  let n = 0;
  for (let k = 0; k < limit; k++) {
    const W = m.W;
    const r = m.step();
    if (r === 'error') {
      // every older instruction (in Memory and Writeback, for an error in Execute) completes in the engine; then the
      // engine stops too
      for (const x of m.errorStage === 'EX' ? [m.W, m.M] : []) if (!x.bubble) { const rec = iss.step(); assert.ok(rec, `engine stopped early: ${iss.state().error}`); n++; }
      assert.equal(iss.step(), null, `the processor stopped (${m.error}), the engine did not`);
      return { m, iss, instructions: n, error: m.error };
    }
    if (r === 'halt') {
      const rec = iss.step();
      assert.ok(rec?.halt, `the processor halted at 0x${m.W.at.toString(16)}, the engine did not`);
      assert.equal(rec.pc, m.W.at);
      n += 1;
      assert.deepEqual(stores, issStores, 'stores');
      const want = iss.state().registers;
      for (let i = 0; i < 15; i++) assert.equal(m.R[i], want[`r${i}`], `final R${i}`);
      return { m, iss, instructions: n };
    }
    const h = m.last;
    if (h.mem) stores.push([h.mem[0], m.dmem.read(h.mem[0], 4)]);
    if (W.bubble) continue;
    const rec = iss.step();
    assert.ok(rec, `instruction ${n} at 0x${W.at.toString(16)}: the engine stopped (${iss.state().error}), the processor did not`);
    assert.equal(W.at, rec.pc, `instruction ${n}: address`);
    for (const x of rec.memory) issStores.push([x.address, x.value]);
    const want = iss.state().registers;
    for (let i = 0; i < 15; i++) assert.equal(m.R[i], want[`r${i}`], `instruction ${n} at 0x${rec.pc.toString(16)}: R${i}`);
    assert.equal(W.flags, flagsOf(want), `instruction ${n} at 0x${rec.pc.toString(16)}: flags`);
    n += 1;
  }
  throw new Error('no halt');
}

test('signal dictionary: the signals of Figs 7.47-7.58 with their widths; every value fits', () => {
  const want = { PCF: 32, InstrF: 32, PCPlus4F: 32, PCNext: 32, InstrD: 32, PCPlus8D: 32, RA1D: 4, RA2D: 4, WA3D: 4, WA3E: 4,
    WA3M: 4, WA3W: 4, RA1E: 4, RA2E: 4, SrcAE: 32, SrcBE: 32, WriteDataE: 32, ALUResultE: 32, ALUOutM: 32, ALUOutW: 32,
    ReadDataW: 32, ResultW: 32, FlagsE: 4, ALUFlags: 4, CondE: 4, CondExE: 1, BranchTakenE: 1, ForwardAE: 2, ForwardBE: 2,
    LDRstall: 1, PCWrPendingF: 1, StallF: 1, StallD: 1, FlushD: 1, FlushE: 1, PCSrcD: 1, PCSrcE: 1, PCSrcM: 1, PCSrcW: 1,
    RegWriteD: 1, RegWriteE: 1, RegWriteM: 1, RegWriteW: 1, MemtoRegD: 1, MemtoRegE: 1, MemtoRegM: 1, MemtoRegW: 1,
    MemWriteD: 1, MemWriteE: 1, MemWriteM: 1, ALUControlD: 2, ALUControlE: 2, BranchD: 1, BranchE: 1, ALUSrcD: 1, ALUSrcE: 1,
    FlagWriteD: 2, FlagWriteE: 2, ImmSrcD: 2, RegSrcD: 2, Match_1E_M: 1, Match_1E_W: 1, Match_2E_M: 1, Match_2E_W: 1, Match_12D_E: 1 };
  for (const [k, w] of Object.entries(want)) assert.equal(PIPE_INFO[k]?.width, w, k);
  assert.equal(new Set(PIPE_SIGNALS.map((s) => s.name)).size, PIPE_SIGNALS.length, 'no name twice');
  const m = pipe(template('fig-7-60.s'));
  for (let i = 0; i < 31; i++) {
    const s = m.evaluate().signals;
    for (const d of PIPE_SIGNALS) assert.ok(Number.isInteger(s[d.name]) && s[d.name] >= 0 && s[d.name] < 2 ** d.width, `cycle ${i}: ${d.name} = ${s[d.name]}`);
    m.step();
  }
});

test('forwarding: Memory before Writeback (ForwardAE 10 over 01); Writeback alone gives 01; a register written by Writeback reads new in Decode', () => {
  const m = pipe('ADD R1, R1, #1\nADD R1, R1, #2\nADD R2, R1, R1\nADD R3, R1, #0\nADD R4, R1, #0\nB .\n');
  let s = until(m, 'EX', 8);
  assert.deepEqual([s.Match_1E_M, s.Match_1E_W, s.Match_2E_M, s.Match_2E_W], [1, 1, 1, 1]);
  assert.deepEqual([s.ForwardAE, s.ForwardBE, s.SrcAE, s.WriteDataE], [0b10, 0b10, 3, 3], 'the newer value, 3, from Memory');
  s = until(m, 'EX', 12);
  assert.deepEqual([s.ForwardAE, s.SrcAE], [0b01, 3], 'R1 from Writeback (ADD R1, R1, #2)');
  s = until(m, 'EX', 16);
  assert.deepEqual([s.ForwardAE, s.SrcAE], [0b00, 3], 'read from the register file after the write');
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[2], m.R[3], m.R[4]], [6, 3, 3]);
  // a register written in the cycle Decode reads it: write first, read second (p. 431)
  const w = pipe('ADD R1, R1, #9\nADD R0, R0, #0\nADD R0, R0, #0\nADD R5, R1, #0\nB .\n');
  s = until(w, 'ID', 12);
  assert.deepEqual([s.RegWriteW, s.WA3W, s.RD1D], [1, 1, 9]);
});

test('the load-use stall: exactly one cycle for a dependent instruction, none for an independent one (Example 7.7)', () => {
  const run = (text) => { const m = pipe(text); assert.equal(m.run(), 'halt'); return m; };
  const base = run('LDR R1, [R0, #0x800]\nADD R2, R3, R3\nB .\n');
  const dep = run('LDR R1, [R0, #0x800]\nADD R2, R1, R3\nB .\n');
  const dep2 = run('LDR R1, [R0, #0x800]\nADD R2, R3, R1\nB .\n');
  assert.equal(dep.cycle - base.cycle, 1);
  assert.equal(dep2.cycle - base.cycle, 1, 'through RA2D as well');
  assert.deepEqual([dep.stats.loadUse, dep.stats.unneeded, base.stats.loadUse], [1, 0, 0]);
  // the stall cycle: StallF, StallD, FlushE; then the value comes from Writeback
  const m = pipe('LDR R1, [R0, #0x800]\nADD R2, R1, R3\nB .\n');
  m.dmem.write(0x800, 4, 41);
  let s = until(m, 'EX', 0);
  assert.deepEqual([s.Match_12D_E, s.MemtoRegE, s.LDRstall, s.StallF, s.StallD, s.FlushE, s.FlushD], [1, 1, 1, 1, 1, 1, 0]);
  m.step();
  s = m.evaluate().signals;
  assert.equal(m.E.bubble, 1, 'a bubble in Execute');
  assert.equal(m.instance(m.E.seq).kind, 'bubble');
  assert.equal(m.D.at, 4, 'ADD held in Decode');
  m.step();
  s = m.evaluate().signals;
  assert.deepEqual([m.E.at, s.ForwardAE, s.SrcAE], [4, 0b01, 41]);
  assert.equal(m.run(), 'halt');
  assert.equal(m.R[2], 41);
});

test('branches: a taken branch costs 3 cycles (2 flushed), one not taken 1 (Example 7.7); flushed instructions have no effect', () => {
  const run = (text) => { const m = pipe(text); assert.equal(m.run(), 'halt'); return m; };
  const plain = run('ADD R0, R0, #0\nADD R1, R1, #1\nB .\n');
  const taken = run('B x\nx: ADD R1, R1, #1\nB .\n');
  assert.equal(taken.cycle - plain.cycle, 2);
  assert.equal(taken.stats.flushed - plain.stats.flushed, 2, 'B . flushes two in both');
  const nt = run('ADDS R9, R9, #1\nBEQ x\nx: ADD R1, R1, #1\nB .\n');
  const nt0 = run('ADDS R9, R9, #1\nADD R0, R0, #0\nADD R1, R1, #1\nB .\n');
  assert.equal(nt.cycle, nt0.cycle, 'a branch not taken costs nothing');
  assert.equal(nt.stats.flushed, nt0.stats.flushed, 'only B . flushes');
  // the two instructions after a taken branch are fetched, then cleared: they write nothing
  const m = pipe('B x\nADD R5, R5, #1\nADD R6, R6, #1\nx: ADD R7, R7, #1\nB .\n');
  const s = until(m, 'EX', 0);
  assert.deepEqual([s.BranchE, s.CondExE, s.BranchTakenE, s.FlushD, s.FlushE, s.StallF, s.PCNext], [1, 1, 1, 1, 1, 0, 12]);
  m.step();
  assert.deepEqual([m.D.bubble, m.E.bubble, m.pcF], [1, 1, 12]);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[5], m.R[6], m.R[7]], [0, 0, 1]);
});

test('a write to R15 stalls Fetch and flushes Decode until Writeback, then the PC takes ResultW', () => {
  const m = pipe('ADD R15, R15, #4\nADD R5, R5, #1\nADD R6, R6, #1\nADD R7, R7, #1\nB .\n');
  const seen = [];
  for (const stage of ['ID', 'EX', 'MEM']) {
    const s = until(m, stage, 0);
    seen.push([s.PCWrPendingF, s.StallF, s.FlushD]);
    m.step();
  }
  assert.deepEqual(seen, [[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  const s = until(m, 'WB', 0);
  assert.deepEqual([s.PCSrcW, s.ResultW, s.PCWrPendingF, s.StallF, s.FlushD, s.PCNext], [1, 12, 0, 0, 1, 12]);
  m.step();
  assert.equal(m.pcF, 12);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[5], m.R[6], m.R[7]], [0, 0, 1]);
  assert.equal(m.stats.pcWrites, 1);
  // a write to R15 whose condition fails waits only until the condition is known
  const f = pipe('ADDS R9, R9, #1\nADDEQ R15, R15, #4\nADD R5, R5, #1\nB .\n');
  assert.equal(f.run(), 'halt');
  assert.equal(f.R[5], 1);
});

test('flags written in Execute reach the conditional branch right behind (no flag forwarding is needed)', () => {
  const m = pipe('SUBS R0, R1, R1\nBEQ x\nADD R5, R5, #1\nx: ADDS R2, R2, #1\nBNE y\nADD R6, R6, #1\ny: B .\n');
  let s = until(m, 'EX', 0);
  assert.deepEqual([s.FlagWriteE, s.CondExE, (s.FlagsNextE >>> 2) & 1], [0b11, 1, 1]);
  m.step();
  s = m.evaluate().signals;
  assert.equal(m.E.at, 4);
  assert.deepEqual([(s.FlagsE >>> 2) & 1, s.CondExE, s.BranchTakenE], [1, 1, 1], 'BEQ sees Z = 1 from SUBS');
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[5], m.R[6]], [0, 0]);
  lockStep(ok('SUBS R0, R1, R1\nBEQ x\nADD R5, R5, #1\nx: ADDS R2, R2, #1\nBNE y\nADD R6, R6, #1\ny: B .\n'));
});

test('A4-Q2 (D15): a taken branch followed by a write to R15 loads the branch target; the textbook StallF would not', () => {
  const text = 'SUBS R0, R0, R0\nBEQ x\nADD R15, R14, #0\nADD R5, R5, #1\nx: ADD R6, R6, #1\nB .\n';
  const m = pipe(text);
  const s = until(m, 'EX', 4);
  assert.deepEqual([s.BranchTakenE, s.PCSrcD, s.PCWrPendingF, s.StallFTextbook, s.StallF, s.FlushD, s.FlushE, s.PCNext], [1, 1, 1, 1, 0, 1, 1, 16]);
  assert.equal(m.record().corrected, true);
  m.step();
  assert.equal(m.pcF, 16);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[5], m.R[6]], [0, 1]);
  assert.equal(m.stats.corrected, 1);
  lockStep(ok(text));
});

test('a stalled Decode register holds even when FlushD is 1: LDR R1 then ADD R15, R1 (a write to R15 waiting for a load)', () => {
  const text = 'ADD R2, R2, #24\nSTR R2, [R0, #0x800]\nLDR R1, [R0, #0x800]\nADD R15, R1, #0\nADD R5, R5, #1\nADD R6, R6, #1\nB .\n';
  const m = pipe(text);
  const s = until(m, 'EX', 8);
  assert.deepEqual([s.LDRstall, s.PCSrcD, s.StallD, s.FlushD, s.StallF], [1, 1, 1, 1, 1]);
  m.step();
  assert.deepEqual([m.D.bubble, m.D.at], [0, 12], 'ADD R15 still in Decode');
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[5], m.R[6]], [0, 0]);
  lockStep(ok(text));
});

test('stalls no register needs are marked: the immediate\'s bits in RA2D (A4-Q1), an STR in Execute (A4-Q3)', () => {
  // ADD R2, R3, #1: Instr3:0 = 0001 = RA2D matches the load's R1
  let m = pipe('LDR R1, [R0, #0x800]\nADD R2, R3, #1\nB .\n');
  let s = until(m, 'EX', 0);
  assert.equal(s.LDRstall, 1);
  assert.equal(m.evaluate().unneeded, true);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.stats.loadUse, m.stats.unneeded], [1, 1]);
  // STR has MemtoReg 1 (the HDL's value for the don't-care): the next reader of its Rd stalls
  m = pipe('STR R1, [R0, #0x800]\nADD R3, R1, R4\nB .\n');
  s = until(m, 'EX', 0);
  assert.deepEqual([s.MemtoRegE, s.MemWriteE, s.LDRstall], [1, 1, 1]);
  assert.equal(m.record().unneeded, true);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.stats.loadUse, m.stats.unneeded], [1, 1]);
  assert.deepEqual(sourcesOf('b', 0xea000000), []);
});

test('STR R15 stores the instruction\'s address + 8 (PCPlus8D); R15 as a source reads PCPlus8D', () => {
  const m = pipe('ADD R0, R0, #0\nSTR R15, [R12, #0x800]\nSUB R1, R15, #0\nB .\n');
  assert.equal(m.run(), 'halt');
  assert.equal(m.dmem.read(0x800, 4), 12);
  assert.equal(m.R[1], 16);
});

test('Fig 7.60 (p. 453): lock-step with the instruction-level engine; 7 stored at 96 and at 100', () => {
  const { m } = lockStep(ok(template('fig-7-60.s')));
  assert.equal(m.dmem.read(96, 4), 7);
  assert.equal(m.dmem.read(100, 4), 7);
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

/**
 * A generated program in the base set (as test/armv7-multi.test.mjs), with backward loops bounded by a counter, and
 * more of what the pipeline makes interesting: a load followed by a reader, a branch followed by a write to R15.
 */
function generate(seed) {
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  const conds = ['', '', '', 'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE'];
  const ops = ['ADD', 'SUB', 'AND', 'ORR'];
  const reg = () => `R${rnd(11)}`; // R0-R10; R11 is a loop counter, R12 the data base (0)
  const src = () => (rnd(8) === 0 ? 'R15' : reg());
  const n = 8 + rnd(40);
  const lines = ['ADD R11, R11, #3', ...Array.from({ length: 4 }, (_, i) => `ADD R${i}, R${i}, #${rnd(256)}`), 'L0:'];
  for (let i = 0; i < n; i++) {
    const k = rnd(22);
    const c = conds[rnd(conds.length)];
    if (k < 11) {
      const s = rnd(3) === 0 ? 'S' : '';
      const op2 = rnd(2) ? `#${rnd(256)}` : src();
      lines.push(`${ops[rnd(4)]}${c}${s} ${reg()}, ${src()}, ${op2}`);
    } else if (k < 14) lines.push(`LDR${c} ${reg()}, [R12, #${0x800 + 4 * rnd(256)}]`);
    else if (k < 16) { const r = reg(); lines.push(`LDR${c} ${r}, [R12, #${0x800 + 4 * rnd(256)}]`, `${ops[rnd(4)]} ${reg()}, ${r}, ${src()}`); }
    else if (k < 18) lines.push(`STR${c} ${rnd(10) === 0 ? 'R15' : reg()}, [R12, #${0x800 + 4 * rnd(256)}]`);
    else if (k < 20) lines.push(`B${c} L${i + 1 + rnd(3)}`);
    else if (k < 21) lines.push(`ADD${c} R15, R15, #${4 * rnd(3)}`);
    else lines.push(`B${c} L${i + 1 + rnd(3)}`, `ADD${conds[rnd(conds.length)]} R15, R15, #${4 * rnd(3)}`);
    lines.push(`L${i + 1}:`);
  }
  for (let j = n + 1; j <= n + 3; j++) lines.push(`L${j}:`);
  // the body again, three times in all; an ADD R15 skip (up to three words) lands on the padding, not past SUBS
  lines.push('ADD R12, R12, #0', 'ADD R12, R12, #0', 'ADD R12, R12, #0', 'SUBS R11, R11, #1', 'BNE L0');
  lines.push('NOP_END: B NOP_END');
  return lines.join('\n');
}

test('generated programs: lock-step with the instruction-level engine at every retired instruction (400 programs)', () => {
  let instructions = 0;
  let corrected = 0;
  let unneeded = 0;
  let loadUse = 0;
  for (let k = 1; k <= 400; k++) {
    const text = generate(k * 7919);
    const p = build(text);
    assert.ok(p.ok, `program ${k}: ${JSON.stringify(p.diagnostics)}\n${text}`);
    try {
      const r = lockStep(p);
      instructions += r.instructions;
      corrected += r.m.stats.corrected;
      unneeded += r.m.stats.unneeded;
      loadUse += r.m.stats.loadUse;
    } catch (e) { throw new Error(`program ${k}: ${e.message}\n${text}`); }
  }
  assert.ok(instructions > 8000, `${instructions} instructions`);
  assert.ok(corrected > 0, 'the D15 case occurred');
  assert.ok(loadUse > unneeded && unneeded > 0, `${loadUse} load-use stalls, ${unneeded} unneeded`);
});

test('Example 7.7 (p. 441): CPI 1.23 from a program with its mix (25 % LDR, 40 % of them followed by a reader; 10 % STR; 13 % B, half taken; 52 % data-processing)', () => {
  // 200 instructions: 50 LDR (20 followed by a reader), 20 STR, 26 B (13 taken), 104 data-processing; no other hazard
  const lines = ['SUBS R0, R0, R0']; // Z = 1: BEQ taken, BNE not (counted among the data-processing instructions)
  const counts = { ldr: 0, use: 0, str: 0, b: 0, taken: 0, dp: 1 };
  let label = 0;
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 5; j++) {
      lines.push(`LDR R${1 + j}, [R0, #${0x800 + 4 * j}]`); counts.ldr++;
      if (j < 2) { lines.push(`ADD R8, R${1 + j}, R9`); counts.use++; counts.dp++; } else { lines.push('ADD R8, R9, R10'); counts.dp++; }
    }
    lines.push('STR R10, [R0, #0x900]', 'STR R12, [R0, #0x904]'); counts.str += 2; // not R10 twice: A4-Q3's stall
    for (let j = 0; j < (i < 6 ? 3 : 2); j++) {
      const t = counts.taken < 13 && (counts.b % 2 === 0);
      lines.push(`${t ? 'BEQ' : 'BNE'} M${label}`, `M${label++}:`); counts.b++; if (t) counts.taken++;
    }
    while (lines.filter((l) => !l.endsWith(':')).length < 20 * (i + 1)) { lines.push('ADD R11, R12, R10'); counts.dp++; }
  }
  const n = lines.filter((l) => !l.endsWith(':')).length;
  assert.equal(n, 200);
  assert.deepEqual([counts.ldr, counts.use, counts.str, counts.b, counts.taken, counts.dp], [50, 20, 20, 26, 13, 104]);
  lines.push('B .');
  const m = pipe(lines.join('\n'));
  assert.equal(m.run(), 'halt');
  // B . (the halt) is a branch too, taken in Execute before it reaches Writeback
  assert.deepEqual([m.stats.loadUse, m.stats.unneeded, m.stats.taken, m.stats.branches], [20, 0, 14, 27]);
  // the halt reaches Writeback after n + 1 + 3 edges, plus the stalls and the taken branches' 2 cycles each
  const cpi = (m.cycle - 4) / n - 1 / n;
  assert.equal(cpi.toFixed(2), '1.23');
  // and the textbook's arithmetic from the measured per-class costs
  const ldrCpi = (30 * 1 + 20 * 2) / 50;
  const bCpi = (13 * 1 + 13 * 3) / 26;
  assert.equal((0.25 * ldrCpi + 0.10 * 1 + 0.13 * bCpi + 0.52 * 1).toFixed(2), '1.23');
});

test('errors: a word outside the base set, an unaligned access, an odd address written to R15, leaving the code', () => {
  const runIss = (text) => { const m = new ArmPipe(); m.load(build(text, 'arm-iss')); return [m.run(), m.error, m]; };
  let [r, e, m] = runIss('MOV R0, #1\nB .\n');
  assert.equal(r, 'error');
  assert.match(e, /pipelined processor does not run MOV/);
  assert.equal(m.E.at, 0, 'stopped with MOV in Execute');
  [r, e, m] = runIss('ADD R1, R1, #2\nLDR R0, [R1, #0]\nB .\n');
  assert.match(e, /Unaligned load/);
  assert.deepEqual([m.E.at, m.M.at, m.R[1]], [4, 0, 0], 'stopped in Execute; the older ADD, in Memory, has not written yet');
  [r, e] = runIss('ADD R1, R1, #2\nSTR R0, [R1, #4]\nB .\n');
  assert.match(e, /Unaligned store/);
  [r, e, m] = runIss('ADD R1, R1, #9\nADD R15, R1, #0\nB .\n');
  assert.match(e, /Thumb/);
  assert.equal(m.W.at, 4, 'stopped with the write in Writeback');
  [r, e] = runIss('ADD R1, R1, #10\nADD R15, R1, #0\nB .\n');
  assert.match(e, /bits 1:0 = 10/);
  [r, e, m] = runIss('ADD R15, R15, #64\nB .\n');
  assert.match(e, /has left the program/);
  // a failed condition makes no access; a word fetched past the end on the wrong path is flushed, not an error
  [r, e] = runIss('ADD R1, R1, #2\nADDS R2, R2, #1\nLDREQ R0, [R1, #0]\nB .\n');
  assert.equal(r, 'halt', e);
  // the errors in lock-step: the engine stops at the same instruction
  lockStep(ok('ADD R1, R1, #2\nADD R3, R3, #3\nLDR R0, [R1, #0]\nB .\n'));
  lockStep(ok('ADD R1, R1, #9\nADD R15, R1, #0\nB .\n'));
});

test('step back restores the registers, flags, memory, PC, pipeline registers, statistics and wrong-path marks', () => {
  for (const hazard of ['full', 'none']) {
    const p = ok(generate(12345));
    const m = new ArmPipe({ hazard });
    m.load(p);
    const states = [];
    const snap = () => JSON.stringify([m.registers(), m.R, m.pcF, m.D, m.E, m.M, m.W, m.ifSeq, m.nextSeq, m.stats,
      [...m.instances].filter(([q]) => q < m.nextSeq).map(([, i]) => i.wrongPath), Array.from({ length: 512 }, (_, i) => m.dmem.read(0x800 + 4 * i, 4))]);
    let r;
    do { states.push(snap()); r = m.step(); } while (r === 'step' && states.length < 3000);
    assert.ok(r === 'halt' || hazard === 'none', `${hazard}: ${r} ${m.error}`);
    if (r !== 'step') { states.push(snap()); assert.ok(m.back()); states.pop(); }
    for (let i = states.length - 2; i >= 0; i--) {
      assert.ok(m.back());
      assert.equal(snap(), states[i], `${hazard}: back to cycle ${i}`);
    }
    assert.equal(m.back(), false);
    assert.equal(m.R[13], STACK_TOP);
  }
});

test('teaching modes: without forwarding an operand is stale; forwarding without the stall forwards a load\'s address; without flushes the wrong path runs', () => {
  let m = pipe('ADD R1, R1, #5\nADD R2, R1, #0\nB .\n', 'none');
  let s = until(m, 'EX', 4);
  assert.deepEqual([s.ForwardAE, s.SrcAE], [0, 0]);
  assert.equal(m.evaluate().stale.length, 1);
  assert.equal(m.run(), 'halt');
  assert.equal(m.R[2], 0, 'the old R1');
  m = pipe('ADD R1, R1, #5\nADD R2, R1, #0\nB .\n', 'forward');
  assert.equal(m.run(), 'halt');
  assert.equal(m.R[2], 5);
  m = pipe('LDR R1, [R0, #0x800]\nADD R2, R1, #0\nB .\n', 'forward');
  m.dmem.write(0x800, 4, 77);
  s = until(m, 'EX', 4);
  assert.deepEqual([s.ForwardAE, s.SrcAE, s.LDRstall], [0b10, 0x800, 0], 'the address, not the data');
  assert.equal(m.run(), 'halt');
  assert.equal(m.R[2], 0x800);
  assert.equal(m.stats.stale, 1);
  m = pipe('B x\nADD R5, R5, #1\nADD R6, R6, #1\nx: ADD R7, R7, #1\nB .\n', 'forward');
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[5], m.R[6], m.R[7]], [1, 1, 1], 'the two instructions after the branch ran');
  const wrong = [...m.instances.values()].filter((i) => i.wrongPath && !i.noCode).map((i) => i.pc);
  assert.deepEqual(wrong, [4, 8], 'marked on the wrong path (and, after B ., the words past the program)');
  assert.throws(() => new ArmPipe({ hazard: 'stall' }), /unknown hazard mode/);
});
