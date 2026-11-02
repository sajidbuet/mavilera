// armv7-equivalence.test.mjs -- ARM-A5, cross-implementation architectural validation (roadmap §6 ARM-A5 and §8): every
// template and 1 000 generated programs run on every ARMv7 model that accepts them (the instruction-level engine; the
// single-cycle, multicycle and pipelined processors, base design and Extended datapath), and the address, R0-R14,
// N Z C V and stores of every retired instruction, how the run stops and the memory written must agree. Hand programs
// give expected results for the rows of the validation matrix; seeded faults show that the comparison catches a
// difference. The recorded 10 000-program run is `node tools/armv7/equivalence.mjs` (A5 record). All the models are
// this application's own; their agreement is not evidence about any hardware or HDL (CLAUDE.md rule 7).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/arch/armv7/language.js';
import { ArmSingle } from '../src/arch/armv7/uarch/single.js';
import { ArmPipe } from '../src/arch/armv7/uarch/pipe.js';
import { MODELS, differential, runModel, compare, generate, campaign } from '../tools/armv7/equivalence.mjs';

const template = (name) => readFileSync(new URL(`../content/armv7/templates/${name}`, import.meta.url), 'utf8');
const ALL = MODELS.map((m) => m.id);
const BASE_ALL = ALL;
const EXT_ALL = ['iss', 'single-ext', 'multi-ext', 'pipe-ext'];

/** Run on every model; no divergence; the models that ran are `want`. Returns the engine's trace. */
function agree(text, want = BASE_ALL) {
  const r = differential(text);
  assert.deepEqual(r.divergences, [], text);
  assert.deepEqual(r.traces.map((t) => t.model), want, `models that ran (refused: ${r.refused})`);
  return r.traces[0];
}
const finalRegs = (t) => t.entries.at(-1).regs;

test('templates: each runs on every model that accepts it, with no divergence; Fig 7.60 stores 7 at 96 and 100 on all seven', () => {
  const index = JSON.parse(template('index.json'));
  const files = [...new Set(index.templates.filter((t) => t.lang === 'asm').map((t) => t.file))];
  assert.ok(files.length >= 5);
  for (const f of files) {
    const r = differential(template(f));
    assert.deepEqual(r.divergences, [], f);
    assert.ok(r.traces.length >= 1, f);
  }
  const t = differential(template('fig-7-60.s'));
  assert.equal(t.traces.length, 7);
  for (const x of t.traces) {
    assert.equal(x.outcome, 'halt', x.model);
    assert.equal(x.memory.get(96), 7, x.model);
    assert.equal(x.memory.get(100), 7, x.model);
  }
});

test('arithmetic corners (hand values, AddWithCarry, DDI A2.2.1): the same flags on all seven models', () => {
  // R11 = 0x10000 by doubling; corners loaded from the data table
  const pre = 'AND R11, R11, #0\nADD R11, R11, #128\n' + 'ADD R11, R11, R11\n'.repeat(9);
  const data = '.data\n.word 0x7fffffff, 0x80000000, 0xffffffff, 1\n';
  const t = agree(`${pre}LDR R0, [R11, #0]\nLDR R1, [R11, #4]\nLDR R2, [R11, #8]\nLDR R3, [R11, #12]\n`
    + 'ADDS R4, R0, R3\nADD R8, R8, #0\n'          // 0x7fffffff + 1: N=1 Z=0 C=0 V=1
    + 'SUBS R5, R1, R3\n'                          // 0x80000000 - 1: N=0 Z=0 C=1 V=1
    + 'ADDS R6, R2, R3\n'                          // 0xffffffff + 1: N=0 Z=1 C=1 V=0
    + 'SUBS R7, R3, R3\n'                          // 1 - 1: Z=1 C=1
    + 'ANDS R9, R2, R1\nORRS R10, R3, R3\nB .\n' + data);
  const flags = t.entries.slice(-6).map((e) => e.flags.toString(2).padStart(4, '0'));
  assert.deepEqual(flags, ['1001', '0011', '0110', '0110', '1010', '0010'], 'NZCV after ADDS, SUBS, ADDS, SUBS, ANDS (C, V kept), ORRS');
  assert.deepEqual(finalRegs(t).slice(4, 11), [0x80000000, 0x7fffffff, 0, 0, 0, 0x80000000, 1]);
});

test('conditional execution: every condition code passes and fails on all seven models (DDI A8.3)', () => {
  const conds = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE'];
  const pre = 'AND R11, R11, #0\nADD R11, R11, #128\n' + 'ADD R11, R11, R11\n'.repeat(9)
    + 'LDR R6, [R11, #0]\nLDR R7, [R11, #4]\nLDR R8, [R11, #8]\n';
  // flag states: Z=1 C=1 (SUBS 1-1); N=1 V=1 (0x7fffffff + 1); all clear (ADDS 1 + 0); N=1 C=0 (0 - 1)
  const setters = ['SUBS R0, R8, R8', 'ADDS R0, R6, R8', 'ADDS R0, R8, R10', 'SUBS R0, R10, R8'];
  let body = '';
  conds.forEach((c, i) => { for (const s of setters) body += `${s}\nADD${c} R${1 + (i % 5)}, R${1 + (i % 5)}, #${1 + i}\n`; });
  const t = agree(`${pre}${body}B .\n.data\n.word 0x7fffffff, 0x80000000, 1\n`);
  assert.equal(t.outcome, 'halt');
});

test('PC behaviour (DDI A2.3): R15 reads +8, STR R15 stores +8, writes by ADD and by LDR, on all seven models', () => {
  const t = agree('ADD R0, R15, #0\nSTR R15, [R1, #0x800]\nLDR R2, [R1, #0x800]\nADD R3, R15, #12\nSTR R3, [R1, #0x804]\n'
    + 'LDR R15, [R1, #0x804]\nADD R4, R4, #1\nADD R4, R4, #2\nADD R15, R15, #0\nADD R5, R5, #1\nADD R6, R6, #7\nB .\n');
  const r = finalRegs(t);
  assert.deepEqual([r[0], r[2], r[3], r[4], r[5], r[6]], [8, 12, 32, 0, 0, 7]);
});

test('branches forward, backward and conditional, and a counted loop, on all seven; BL on the four that run it', () => {
  const t = agree('ADD R0, R0, #5\nL: ADD R1, R1, R0\nSUBS R0, R0, #1\nBNE L\nBEQ F\nADD R2, R2, #1\nF: B .\n');
  assert.deepEqual(finalRegs(t).slice(0, 3), [0, 15, 0]);
  const b = agree('MOV R0, #3\nBL f\nBL f\nB .\nf: ADD R0, R0, R0\nMOV PC, LR\n', EXT_ALL);
  assert.deepEqual([finalRegs(b)[0], finalRegs(b)[14]], [12, 12]);
});

test('loads and stores (+imm12, and the Extended negative offsets and LDRB) and load-use pairs agree', () => {
  agree('ADD R1, R1, #0x80\nADD R2, R2, #0x42\nSTR R2, [R1, #4]\nLDR R3, [R1, #4]\nADD R4, R3, R3\nSTR R4, [R1, #8]\nLDR R5, [R1, #8]\nSTR R5, [R1, #12]\nB .\n');
  agree('MOV R1, #0x80\nMOV R2, #0x42\nLSL R2, R2, #8\nORR R2, R2, #0x41\nSTR R2, [R1, #0]\nLDRB R3, [R1, #1]\nADD R4, R3, #1\n'
    + 'STR R4, [R1, #-4]\nLDR R5, [R1, #-4]\nLDRB R6, [R1, #-4]\nB .\n', EXT_ALL);
});

test('errors stop every model at the same instruction (W-D32 Q3): unaligned LDR, odd and half-word PC writes, leaving the code', () => {
  for (const text of [
    'ADD R1, R1, #2\nADD R0, R0, #1\nLDR R0, [R1, #0]\nB .\n',
    'ADD R1, R1, #2\nSTR R0, [R1, #4]\nB .\n',
    'ADD R1, R1, #9\nADD R0, R0, #1\nADD R15, R1, #0\nB .\n',
    'ADD R1, R1, #10\nADD R15, R1, #0\nB .\n',
    'ADD R0, R0, #1\nADD R15, R15, #64\nB .\n',
  ]) {
    const r = differential(text);
    assert.deepEqual(r.divergences, [], text);
    assert.equal(r.traces.length, 7, text);
    for (const t of r.traces) assert.equal(t.outcome, 'error', `${t.model}: ${text}`);
  }
});

test('generated programs: 1 000 (500 base on seven models, 500 Extended on four) with no divergence, and what they cover', () => {
  const { stats, failures } = campaign({ n: 1000, seed: 1, keep: 3 });
  assert.deepEqual(failures.map((f) => `${f.k} ${f.tier}: ${f.what}\n${f.text}`), []);
  assert.deepEqual([stats.programs, stats.base, stats.extended, stats.halted], [1000, 500, 500, 1000]);
  assert.equal(stats.comparisons, 500 * 6 + 500 * 3);
  assert.ok(stats.instructions > 50_000, `${stats.instructions} instructions`);
  const c = stats.coverage;
  for (const k of ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE']) {
    assert.ok(c[`cond ${k} pass`] >= 10, `${k} passes ${c[`cond ${k} pass`]}`);
    assert.ok(c[`cond ${k} fail`] >= 10, `${k} fails ${c[`cond ${k} fail`]}`);
  }
  for (const op of ['ADD', 'ADDS', 'SUB', 'SUBS', 'AND', 'ANDS', 'ORR', 'ORRS', 'LDR', 'STR', 'B', 'BL', 'LDRB', 'MOV', 'LSL', 'LSR', 'ASR', 'ROR',
    'ADC', 'SBC', 'RSB', 'EOR', 'BIC', 'CMPS', 'CMNS', 'TSTS', 'TEQS', 'LDR -imm', 'STR -imm', 'LDRB -imm']) {
    assert.ok(c[`op ${op} run`] >= 10, `${op} run ${c[`op ${op} run`]}`);
    assert.ok(c[`op ${op} skip`] >= 10, `${op} skipped ${c[`op ${op} skip`]}`);
  }
  for (let r = 0; r <= 14; r++) assert.ok(c[`Rd R${r}`] >= 10 && c[`Rn R${r}`] >= 10, `R${r} as Rd and Rn`);
  for (const r of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15]) assert.ok(c[`Rm R${r}`] >= 10, `R${r} as Rm`);
  for (const k of ['R15 written by data processing', 'R15 written by LDR', 'R15 stored by STR', 'branch B backward', 'branch B forward', 'branch BL forward', 'branch not taken']) {
    assert.ok(c[k] >= 10, `${k}: ${c[k]}`);
  }
});

test('the comparison catches seeded faults: no forwarding or no Hazard Unit in the pipeline, a wrong register, a wrong store', () => {
  class WrongRegister extends ArmSingle {
    step() { const r = super.step(); if (this.cycle === 25) this.R[3] ^= 1; return r; }
  }
  class WrongStore extends ArmSingle {
    step() { const r = super.step(); const m = this.last?.mem; if (m && this.cycle > 20) this.dmem.write(m[0], 4, (this.dmem.read(m[0], 4) + 4) >>> 0); return r; }
  }
  const faults = [
    { id: 'pipe', tier: 'H', profile: 'arm-pipe', subset: null, make: () => new ArmPipe({ hazard: 'forward' }) },
    { id: 'pipe', tier: 'H', profile: 'arm-pipe', subset: null, make: () => new ArmPipe({ hazard: 'none' }) },
    { id: 'single', tier: 'H', profile: 'arm-single', subset: null, make: () => new WrongRegister() },
    { id: 'single', tier: 'H', profile: 'arm-single', subset: null, make: () => new WrongStore() },
  ];
  for (const f of faults) {
    let caught = 0;
    for (let k = 0; k < 40; k++) {
      const text = generate(4242 + k, 'H');
      const p = assemble([{ name: 't.s', text }], { profile: f.profile });
      const ref = runModel(MODELS[0], assemble([{ name: 't.s', text }]), 5000);
      if (compare(ref, runModel(f, p, 5000))) caught += 1;
    }
    assert.ok(caught >= 20, `${f.make().constructor.name} (${f.make().hazard ?? ''}): caught in ${caught} of 40 programs`);
  }
});
