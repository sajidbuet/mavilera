// armv7-pipe-ext.test.mjs -- the Extended ARM pipelined processor (uarch/pipe-ext.js; roadmap ARM-A4 part 3; A4-Q5 to
// A4-Q8): lock-step with the instruction-level engine at every retired instruction on a program with every tier-E class
// and on generated tier-E programs; BL's link value carried down the pipeline; the target of BL reading R14 at once; NoWrite;
// LDRB through the Byte unit in WB and its load-use stall; no stall after an STR (A4-Q7); ADC and the shifter reading the
// flags the instruction ahead has just written; a forwarded value shifted; the refusals; step back. The instruction-level
// engine is this application's own model (ARM-A1); agreement with it is not evidence of agreement with any hardware.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/arch/armv7/language.js';
import { create } from '../src/arch/armv7/engine.js';
import { ArmPipeExt } from '../src/arch/armv7/uarch/pipe-ext.js';
import { PIPE_EXT_SIGNALS, PIPE_EXT_INFO } from '../src/arch/armv7/uarch/signals.js';

const buildExt = (text) => assemble([{ name: 't.s', text }], { profile: 'arm-pipe', subset: 'extended' });
const ok = (text) => {
  const p = buildExt(text);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};
const pipe = (text) => { const m = new ArmPipeExt(); m.load(ok(text)); return m; };
const flagsOf = (r) => (r.N << 3) | (r.Z << 2) | (r.C << 1) | r.V;

/** As test/armv7-pipe.test.mjs: at every retired instruction the address, R0-R14 and the flags agree; stores in order. */
function lockStep(program, limit = 200_000) {
  const iss = create(program);
  const m = new ArmPipeExt();
  m.load(program);
  const stores = [];
  const issStores = [];
  let n = 0;
  for (let k = 0; k < limit; k++) {
    const W = m.W;
    const r = m.step();
    if (r === 'error') {
      for (const x of m.errorStage === 'EX' ? [m.W, m.M] : []) if (!x.bubble) { assert.ok(iss.step(), `engine stopped early: ${iss.state().error}`); n++; }
      assert.equal(iss.step(), null, `the processor stopped (${m.error}), the engine did not`);
      return { m, iss, instructions: n, error: m.error };
    }
    if (r === 'halt') {
      const rec = iss.step();
      assert.ok(rec?.halt, `the processor halted at 0x${m.W.at.toString(16)}, the engine did not`);
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

const EVERY = 'MOV R0, #12\nMOV R1, #18\nBL gcd\nMOV R3, R0, LSL #2\nMOV R4, #0x80\nSTR R3, [R4, #0]\nLDRB R5, [R4, #0]\n'
  + 'LDRB R6, [R4, #1]\nSTR R5, [R4, #-4]\nLDR R7, [R4, #-4]\nADDS R8, R0, R1\nADC R9, R0, #1\nRSB R10, R0, #100\nEOR R11, R0, R1\n'
  + 'BIC R12, R1, #2\nTST R0, #1\nCMN R0, #3\nTEQ R0, R0\nCMP R0, #6\nMOVEQ R2, #7\nB .\n'
  + 'gcd: CMP R0, R1\nSUBGT R0, R0, R1\nSUBLT R1, R1, R0\nBNE gcd\nMOV PC, LR\n';

test('signal dictionary: MemtoReg replaced by ResultSrc, the added signals; every value fits its width', () => {
  for (const k of ['MemtoRegD', 'MemtoRegE', 'MemtoRegM', 'MemtoRegW']) assert.equal(PIPE_EXT_INFO[k], undefined, k);
  const want = { ResultSrcD: 2, ResultSrcE: 2, ResultSrcM: 2, ResultSrcW: 2, ALUControlD: 4, ALUControlE: 4, NoWriteD: 1, NoWriteE: 1, LinkD: 1,
    ShiftCtlD: 7, ShiftCtlE: 7, PCPlus4D: 32, PCPlus4W: 32, ShiftResultE: 32, ShiftCE: 1, ReadByteW: 32, 'ALUOutW1:0': 2 };
  for (const [k, w] of Object.entries(want)) assert.equal(PIPE_EXT_INFO[k]?.width, w, k);
  assert.equal(new Set(PIPE_EXT_SIGNALS.map((s) => s.name)).size, PIPE_EXT_SIGNALS.length);
  const m = pipe(EVERY);
  for (let i = 0; i < 80; i++) {
    const s = m.evaluate().signals;
    for (const d of PIPE_EXT_SIGNALS) assert.ok(Number.isInteger(s[d.name]) && s[d.name] >= 0 && s[d.name] < 2 ** d.width, `cycle ${i}: ${d.name} = ${s[d.name]}`);
    if (m.step() !== 'step') break;
  }
});

test('a program with every tier-E class: lock-step with the instruction-level engine; the end state of the multicycle test', () => {
  const { m, instructions } = lockStep(ok(EVERY));
  assert.equal(instructions, 34);
  assert.deepEqual([...m.R].slice(0, 13), [6, 6, 7, 24, 128, 24, 0, 24, 12, 7, 94, 0, 4]);
});

test('BL: the link value PCPlus4 travels with it to WB (A4-Q5); the target reads R14 in ID while BL writes it in WB', () => {
  const m = pipe('MOV R0, #1\nBL f\nB .\nf: MOV PC, LR\n');
  for (let i = 0; i < 20; i++) {
    const c = m.evaluate();
    if (c.live.WB && m.W.at === 4) break;
    m.step();
  }
  let s = m.evaluate().signals;
  assert.deepEqual([s.ResultSrcW, s.PCPlus4W, s.ResultW, s.WA3W, s.RegWriteW], [0b11, 8, 8, 14, 1], 'BL at 4 writes LR = 8');
  assert.equal(m.D.at, 12, 'MOV PC, LR, the target, in ID');
  assert.deepEqual([s.RA1D, s.RA2D, s.RD2D], [0, 14, 8], 'R14 read as the new value (write first)');
  assert.equal(m.run(), 'halt');
  assert.equal(m.R[14], 8);
  lockStep(ok('MOV R0, #1\nBL f\nB .\nf: MOV PC, LR\n'));
});

test('NoWrite: CMP writes the flags in EX and no register (RegWriteM = 0)', () => {
  const m = pipe('MOV R3, #5\nCMP R3, #5\nB .\n');
  for (let i = 0; i < 10 && !(m.evaluate().live.EX && m.E.at === 4); i++) m.step();
  const s = m.evaluate().signals;
  assert.deepEqual([s.RegWriteE, s.NoWriteE, s.CondExE, s.FlagWriteE], [1, 1, 1, 0b11]);
  m.step();
  assert.equal(m.M.RegWriteM, 0);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[3], m.F.Z, m.F.C], [5, 1, 1]);
});

test('LDRB: the Byte unit in WB (A4-Q6); a dependent instruction stalls one cycle (A4-Q7); no alignment needed', () => {
  const text = 'MOV R1, #0x80\nMOV R2, #0x42\nLSL R2, R2, #8\nORR R2, R2, #0x41\nSTR R2, [R1, #0]\nLDRB R3, [R1, #1]\nADD R4, R3, #1\nB .\n';
  const m = pipe(text);
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[3], m.R[4]], [0x42, 0x43]);
  assert.deepEqual([m.stats.loadUse, m.stats.unneeded], [1, 0], 'the stall after LDRB; none after STR (ResultSrc 00)');
  lockStep(ok(text));
  const w = pipe('MOV R1, #0x80\nMOV R2, #0x42\nSTR R2, [R1, #0]\nLDRB R3, [R1, #0]\nB .\n');
  for (let i = 0; i < 20 && !(w.evaluate().live.WB && w.W.at === 12); i++) w.step();
  const s = w.evaluate().signals;
  assert.deepEqual([s.ResultSrcW, s['ALUOutW1:0'], s.ReadByteW, s.ResultW], [0b10, 0, 0x42, 0x42]);
});

test('flags in EX: ADC right after ADDS takes its carry, and a shifted operand right after a write is forwarded, then shifted', () => {
  const m = pipe('MOV R0, #0\nSUB R0, R0, #1\nADDS R1, R0, #1\nADC R2, R2, #5\nMOV R3, #3\nADD R4, R4, R3, LSL #4\nB .\n');
  assert.equal(m.run(), 'halt');
  assert.deepEqual([m.R[1], m.R[2], m.R[4]], [0, 6, 48]);
  assert.equal(m.stats.loadUse, 0);
  lockStep(ok('MOV R0, #0\nSUB R0, R0, #1\nADDS R1, R0, #1\nADC R2, R2, #5\nMOV R3, #3\nADD R4, R4, R3, LSL #4\nB .\n'));
});

/** A generated tier-E program (as test/armv7-multi-ext.test.mjs), with loads followed by a reader and BL. */
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
    const k = rnd(26);
    const c = conds[rnd(conds.length)];
    const s = rnd(3) === 0 ? 'S' : '';
    if (k < 8) lines.push(`${three[rnd(three.length)]}${c}${s} ${reg()}, ${src()}, ${op2()}`);
    else if (k < 10) lines.push(`${tests[rnd(4)]}${c} ${src()}, ${op2()}`);
    else if (k < 12) lines.push(rnd(2) ? `MOV${c}${s} ${reg()}, ${op2()}` : `${shifts[rnd(4)]}${c}${s} ${reg()}, ${reg()}, #${1 + rnd(31)}`);
    else if (k < 14) lines.push(`LDR${c} ${reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${4 * rnd(256)}]`);
    else if (k < 16) lines.push(`LDRB${c} ${reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${rnd(1024)}]`);
    else if (k < 18) { const r = reg(); lines.push(`LDR${rnd(2) ? 'B' : ''} ${r}, [R11, #${4 * rnd(64)}]`, `${three[rnd(three.length)]} ${reg()}, ${r}, ${op2()}`); }
    else if (k < 20) lines.push(`STR${c} ${rnd(10) === 0 ? 'R15' : reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${4 * rnd(256)}]`);
    else if (k < 22) lines.push(`B${c} L${i + 1 + rnd(3)}`);
    else if (k < 24) lines.push(`BL${c} SUB`);
    else lines.push(`ADD${c} R15, R15, #${4 * rnd(3)}`);
    lines.push(`L${i + 1}:`);
  }
  for (let j = n + 1; j <= n + 3; j++) lines.push(`L${j}:`);
  lines.push('B END', 'B END', 'B END', 'END: B END', 'SUB: ADD R10, R10, #1', 'MOV PC, LR');
  return lines.join('\n');
}

test('generated tier-E programs: lock-step with the instruction-level engine at every retired instruction (400 programs)', () => {
  let instructions = 0;
  let loadUse = 0;
  for (let k = 1; k <= 400; k++) {
    const text = generateExt(k * 104729);
    const p = buildExt(text);
    assert.ok(p.ok, `program ${k}: ${JSON.stringify(p.diagnostics.slice(0, 3))}\n${text}`);
    try {
      const r = lockStep(p);
      instructions += r.instructions;
      loadUse += r.m.stats.loadUse;
    } catch (e) { throw new Error(`program ${k}: ${e.message}\n${text}`); }
  }
  assert.ok(instructions > 8000, `${instructions} instructions`);
  assert.ok(loadUse > 100, `${loadUse} load-use stalls`);
});

test('refused: an instruction-level form names the Extended pipelined processor; the assembler refuses it in this subset', () => {
  const m = new ArmPipeExt();
  m.load(assemble([{ name: 't.s', text: 'MOV R0, #0x10000\nB .\n' }]));
  assert.equal(m.run(), 'error');
  assert.match(m.error, /Extended pipelined processor does not run/);
  assert.equal(buildExt('ADD R0, R1, R2, LSL R3\nB .\n').ok, false);
});

test('step back restores every register, the pipeline registers and the memory, through BL and LDRB', () => {
  const m = pipe(EVERY);
  const snap = () => JSON.stringify([m.registers(), m.R, m.pcF, m.D, m.E, m.M, m.W, m.stats, Array.from({ length: 8 }, (_, i) => m.dmem.read(0x7c + 4 * i, 4))]);
  const states = [];
  let r;
  do { states.push(snap()); r = m.step(); } while (r === 'step');
  assert.equal(r, 'halt');
  assert.ok(m.back());
  for (let i = states.length - 2; i >= 0; i--) {
    assert.ok(m.back());
    assert.equal(snap(), states[i], `back to cycle ${i}`);
  }
});
