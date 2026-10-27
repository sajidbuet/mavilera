// random.test.mjs -- WS-V-011: generated random instruction streams run in
// lock-step with rvsim.py: every RV32I + M computational instruction, loads
// and stores of every width, forward branches, edge immediates, x0
// destinations, signed/unsigned boundaries and the M-extension division
// corner cases. Deterministic (fixed seeds). Skipped without the book
// repository or Python.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { assemble } from '../src/asm/assembler.js';
import { Hart, run, traceLine } from '../src/core/iss.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIM = process.env.MES_BOOK_SIM ?? join(ROOT, '..', 'book-MES', 'code', 'sim');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const skip = !existsSync(join(SIM, 'rvsim.py')) ? 'book repository not found beside this one'
  : spawnSync(PYTHON, ['--version']).status !== 0 ? 'Python 3 not found' : false;

function prng(seed) { // xorshift32
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
}

const EDGE = [0, 1, -1, 2, -2, 0x7fffffff, -0x80000000, 0x7ff, -0x800, 0x800, 0xffff, 0x8000, 31, 32, 0x55555555, -0x55555556];
const RR = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
  'mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'];
const RI = ['addi', 'slti', 'sltiu', 'xori', 'ori', 'andi'];
const SH = ['slli', 'srli', 'srai'];
const BR = ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'];
const LD = [['lb', 1], ['lh', 2], ['lw', 4], ['lbu', 1], ['lhu', 2]];
const ST = [['sb', 1], ['sh', 2], ['sw', 4]];

function program(seed, n) {
  const rnd = prng(seed);
  const pick = (a) => a[rnd() % a.length];
  // x0..x26 are used freely; s11 (x27) holds the data base and is never a destination.
  const reg = () => `x${rnd() % 27}`;
  const imm12 = () => pick([0, 1, -1, 2047, -2048, 0x7ff, -0x7ff, (rnd() % 4096) - 2048]);
  const lines = ['        .text', '_start: li s11, 0x10000'];
  for (let r = 1; r < 27; r++) lines.push(`        li x${r}, ${pick(EDGE)}`);
  for (let i = 0; i < n; i++) {
    const k = rnd() % 10;
    if (k < 4) lines.push(`        ${pick(RR)} ${reg()}, ${reg()}, ${reg()}`);
    else if (k < 6) lines.push(`        ${pick(RI)} ${reg()}, ${reg()}, ${imm12()}`);
    else if (k < 7) lines.push(`        ${pick(SH)} ${reg()}, ${reg()}, ${rnd() % 32}`);
    else if (k === 7) lines.push(`        lui ${reg()}, ${rnd() % 0x100000}`, `        auipc ${reg()}, ${rnd() % 0x100000}`);
    else if (k === 8) {
      const [mn, size] = pick(LD.concat(ST));
      const off = (rnd() % 256) & ~(size - 1);
      lines.push(`        ${mn} ${reg()}, ${off}(s11)`);
    } else {
      lines.push(`        ${pick(BR)} ${reg()}, ${reg()}, 8`, `        addi ${reg()}, ${reg()}, 1`);
    }
  }
  lines.push('        ebreak', '        .data', '        .space 256');
  return lines.join('\n') + '\n';
}

test('WS-V-011: random instruction streams in lock-step with rvsim.py', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pips-random-'));
  try {
    for (let seed = 1; seed <= 20; seed++) {
      const src = program(seed * 2654435761, 400);
      const file = join(dir, `r${seed}.s`);
      writeFileSync(file, src);
      const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'ref_trace.py'), SIM, file],
        { encoding: 'utf8', maxBuffer: 1 << 28 });
      assert.equal(r.status, 0, r.stderr);
      const ref = JSON.parse(r.stdout);
      assert.equal(ref.asm_error, undefined, ref.asm_error);
      const prog = assemble(src);
      assert.deepEqual(prog.errors, []);
      const hart = new Hart(prog);
      const trace = [];
      run(hart, 100_000, (rec) => trace.push(traceLine(rec)));
      const want = ref.trace.map((o) => JSON.stringify(o));
      for (let i = 0; i < Math.min(trace.length, want.length); i++) {
        assert.equal(trace[i], want[i], `seed ${seed}: first difference at step ${i}`);
      }
      assert.equal(trace.length, want.length, `seed ${seed}: trace length`);
      assert.deepEqual(hart.report(), ref.report, `seed ${seed}: final state`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
