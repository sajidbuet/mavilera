// cc.test.mjs -- the C-subset compiler (spec §10.1, §15.3). WS-V-030: the
// programs of code/sim/tests/c/programs.c inside the subset (1-5) and
// generated subset programs, compiled by the simulator's compiler (both
// modes, RV32I and RV32IM) and by the pinned GCC at -O0, run in the book's
// rvsim.py: identical exit codes, and every compiled program passes the ABI
// check. Without the book repository, Python or the toolchain those tests
// are skipped, saying so. Also: the targets of the Chapter 6-8 processors
// on their models (WS-F-083), diagnostics (WS-F-084), the source map
// (WS-F-082) and the two modes (WS-F-081).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { compile } from '../src/cc/compiler.js';
import { assemble } from '../src/asm/assembler.js';
import { Hart, run } from '../src/core/iss.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { ch07 } from './ch07-content.mjs';
import { Pipeline } from '../src/uarch/pipe.js';
import { cProgram } from './programs-c.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const SIM = join(BOOK, 'code', 'sim');
const CORPUS = join(SIM, 'tests', 'c', 'programs.c');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const TOOLDIR = process.env.MES_RISCV_TOOLCHAIN ?? 'C:\\pico\\riscv-toolchain-16\\bin';
const GCC = join(TOOLDIR, `riscv32-pico-elf-gcc${process.platform === 'win32' ? '.exe' : ''}`);
const skipGcc = !existsSync(CORPUS) ? 'book repository not found beside this one'
  : spawnSync(PYTHON, ['--version']).status !== 0 ? 'Python 3 not found'
    : !existsSync(GCC) && spawnSync('riscv32-pico-elf-gcc', ['--version']).status !== 0 ? 'the pinned RISC-V GCC (riscv32-pico-elf-gcc) not found' : false;
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const T6 = json('content/data/ch06-tables.json');
const T7 = ch07().t7;
const VARIANTS = [['rv32im', 'plain'], ['rv32im', 'register'], ['rv32i', 'plain'], ['rv32i', 'register']];

/** Run jobs through tools/ref_cc.py (GCC builds and rvsim.py runs). */
function reference(jobs) {
  const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'ref_cc.py'), SIM], { input: JSON.stringify(jobs), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** Compile, assemble and run on the instruction-level simulator: {exit, output, abi, asm}. */
function ours(src, options) {
  const c = compile(src, options);
  assert.ok(c.ok, JSON.stringify(c.errors));
  const p = assemble([{ name: 'out.s', text: c.asm }], { profile: options.profile ?? 'iss' });
  assert.deepEqual(p.errors, []);
  const h = new Hart(p, { abiCheck: true });
  run(h, 50_000_000);
  return { exit: h.exitCode >>> 0, output: h.output, abi: h.abiViolations, asm: c.asm, map: c.map };
}

/** Compare our four variants of each source with GCC -O0 builds, all run in rvsim.py. */
function differential(sources, gccOptions) {
  const dir = mkdtempSync(join(tmpdir(), 'pips-cc-'));
  try {
    const jobs = [];
    const cases = [];
    sources.forEach(({ name, text, defines = {} }, k) => {
      const c = join(dir, `src${k}.c`);
      writeFileSync(c, text);
      for (const march of ['rv32im', 'rv32i']) {
        jobs.push({ kind: 'gcc', src: c, march, opt: '-O0', defines, ...gccOptions });
        const gccJob = jobs.length - 1;
        for (const [m, mode] of VARIANTS.filter(([x]) => x === march)) {
          const mine = ours(text, { name, march: m, mode, defines });
          const s = join(dir, `src${k}-${m}-${mode}.s`);
          writeFileSync(s, mine.asm);
          jobs.push({ kind: 'asm', src: s });
          cases.push({ what: `${name} ${m} ${mode}`, gccJob, asmJob: jobs.length - 1, mine });
        }
      }
    });
    const ref = reference(jobs);
    for (const c of cases) {
      const g = ref[c.gccJob];
      const a = ref[c.asmJob];
      assert.equal(g.error, undefined, `${c.what}: GCC build: ${g.error}`);
      assert.equal(a.error, undefined, `${c.what}: rvsim.py on our assembly: ${a.error}`);
      assert.equal(a.exit_code >>> 0, g.exit_code >>> 0, `${c.what}: exit code, ours ${(a.exit_code >>> 0).toString(16)} vs GCC ${(g.exit_code >>> 0).toString(16)}`);
      assert.deepEqual(a.abi_violations, [], `${c.what}: --abi-check`);
      assert.equal(c.mine.exit, a.exit_code >>> 0, `${c.what}: our ISS and rvsim.py agree`);
    }
    return cases.length;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- WS-V-030 --------------------------------------------------------------------------------
test('WS-V-030: programs.c 1-5 (in the subset) give the exit code of GCC -O0, in rvsim.py, ABI check clean', { skip: skipGcc }, () => {
  const text = readFileSync(CORPUS, 'utf8');
  const n = differential([1, 2, 3, 4, 5].map((p) => ({ name: `programs.c PROG=${p}`, text, defines: { PROG: String(p) } })), { werror: true });
  assert.equal(n, 20);
});

test('WS-V-030: 32 generated subset programs give the exit code of GCC -O0, in rvsim.py, ABI check clean', { skip: skipGcc }, () => {
  const sources = Array.from({ length: 32 }, (_, k) => ({ name: `generated ${k + 1}`, text: cProgram(k + 1) }));
  assert.equal(differential(sources, { werror: false }), 128);
});

test('programs.c 6 uses 64-bit types and is reported as outside the subset', { skip: existsSync(CORPUS) ? false : 'book repository not found beside this one' }, () => {
  const c = compile(readFileSync(CORPUS, 'utf8'), { defines: { PROG: '6' } });
  assert.equal(c.ok, false);
  assert.equal(c.errors[0].subset, true);
  assert.match(c.errors[0].message, /int64_t is not a type of the simulator's C subset; 64-bit types are outside the subset/);
  assert.equal(c.errors[0].line, 102);
});

// --- WS-F-083: the processors of Chapters 6-8 ---------------------------------------------
const SMALL = `int data[8] = { 5, -3, 12, 7, 0, 9, -1, 4 };

int fact(int n)
{
    if (n <= 1)
        return 1;
    return n * fact(n - 1);
}

int main(void)
{
    int s = 0;
    for (int i = 0; i < 8; i++)
        s += data[i] * (i + 1);
    int m = data[0];
    for (int i = 1; i < 8; i++)
        if (data[i] > m)
            m = data[i];
    data[7] = s;
    return s + fact(5) * 1000 + m;
}
`;
// Small enough for the 128 code words of the Chapter 7 memory in plain mode.
const CALLS = `int twice(int x)
{
    return x + x;
}

int main(void)
{
    int s = 0;
    for (int i = 0; i < 5; i++)
        s += twice(i);
    return s;
}
`;
const NOCALL = `int v[6] = { 3, 1, 4, 1, 5, 9 };
int main(void)
{
    int s = 0;
    for (int i = 0; i < 6; i++) {
        s = s + (v[i] << 2) - i;
        v[i] = s;
    }
    return s;
}
`;

function onModel(src, profile, { mode = 'plain', jalr = true } = {}) {
  const c = compile(src, { profile, mode });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const p = assemble([{ name: 'out.s', text: c.asm }], { profile });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.profileErrors, []);
  const m = profile === 'ch06' ? new SingleCycle(T6, { historyLimit: 0 })
    : profile === 'ch07' ? new Multicycle(T6, T7, { jalr, historyLimit: 0 }) : new Pipeline(T6, { historyLimit: 0 });
  m.load(p);
  const stop = m.run(2_000_000);
  return { stop, a0: m.x[10] >>> 0, error: m.error, model: m };
}

for (const profile of ['ch06', 'ch07', 'ch08']) {
  for (const mode of ['plain', 'register']) {
    test(`WS-F-083: compiled for the ${profile} processor (${mode}), main's result is in a0 at the halt, as on the ISS`, () => {
      for (const src of profile === 'ch07' ? [CALLS, NOCALL] : [SMALL, CALLS, NOCALL]) {
        const want = ours(src, { march: 'rv32i', mode }).exit;
        const r = onModel(src, profile, { mode });
        assert.equal(r.stop, 'halt', r.error ?? '');
        assert.equal(r.a0, want);
      }
    });
  }
}

test('WS-F-083: on Chapter 7, a program without calls runs without the JALR option; returns need it', () => {
  assert.equal(onModel(NOCALL, 'ch07', { jalr: false }).stop, 'halt');
  const r = onModel(CALLS, 'ch07', { jalr: false });
  assert.equal(r.stop, 'error');
  assert.match(r.error, /jalr at .*the JALR state is an optional extension of the controller/);
});

test('WS-F-083: byte and halfword access, putchar and the M extension on the chapter processors', () => {
  const bytes = '#include <stdint.h>\nuint8_t b[4] = { 1, 2, 3, 4 };\nint main(void)\n{\n    return b[2];\n}\n';
  let c = compile(bytes, { profile: 'ch06' });
  assert.equal(c.ok, false);
  assert.match(c.errors[0].message, /needs lbu, which the single-cycle processor does not have.*the lbu extension adds lbu/);
  assert.equal(c.errors[0].line, 5);
  c = compile(bytes, { profile: 'ch06', lbu: true });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const p = assemble([{ name: 'o.s', text: c.asm }], { profile: 'ch06', subset: 'ext' });
  const m = new SingleCycle(T6, { ext: true });
  m.load(p);
  assert.equal(m.run(), 'halt');
  assert.equal(m.x[10], 3);
  c = compile('#include <stdint.h>\nuint8_t b[4];\nint main(void)\n{\n    b[1] = 7;\n    return 0;\n}\n', { profile: 'ch06', lbu: true });
  assert.match(c.errors[0].message, /writing an unsigned char needs sb, which the single-cycle processor does not have/);
  c = compile('int main(void)\n{\n    putchar(65);\n    return 0;\n}\n', { profile: 'ch08' });
  assert.match(c.errors[0].message, /putchar needs the console of the ISA profile/);
  const mul = 'int main(void)\n{\n    int a = 6, b = 7;\n    return a * b / 3 % 5;\n}\n';
  assert.doesNotMatch(compile(mul, { profile: 'ch06' }).asm, /^\s+(mul|div|divu|rem|remu)\s/m);
  assert.match(compile(mul, { profile: 'ch06' }).asm, /call\s+__mulsi3/);
  assert.match(compile(mul, { march: 'rv32im' }).asm, /\n\s+mul\s/);
  assert.equal(ours(mul, { march: 'rv32i' }).exit, 4);
  assert.equal(ours(mul, { march: 'rv32im' }).exit, 4);
});

test('the chapter processors\' memories: a compiled program too large for them is reported', () => {
  const big = cProgram(1, { words: true });
  const c = compile(big, { profile: 'ch06' });
  assert.ok(c.ok);
  const p = assemble([{ name: 'o.s', text: c.asm }], { profile: 'ch06' });
  assert.equal(p.ok, false);
  assert.match(p.errors[0].message, /does not fit: the single-cycle processor's instruction memory holds 256 words/);
  const p7 = assemble([{ name: 'o.s', text: c.asm }], { profile: 'ch07' });
  assert.match(p7.errors[0].message, /the code runs into the data at 0x200 of the multicycle processor's memory/);
});

// --- built-ins, modes, source map -----------------------------------------------------------
test('putchar writes to the console and exit ends with its code (ISA profile)', () => {
  const src = 'int main(void)\n{\n    const char *s = "Hi!\\n";\n    while (*s)\n        putchar(*s++);\n    exit(42);\n    return 1;\n}\n';
  for (const [march, mode] of VARIANTS) {
    const r = ours(src, { march, mode });
    assert.equal(r.exit, 42);
    assert.equal(String.fromCharCode(...r.output), 'Hi!\n');
    assert.deepEqual(r.abi, []);
  }
});

test('WS-F-081: plain mode keeps variables in the frame; register mode keeps them in s registers', () => {
  const src = 'int f(int a, int b)\n{\n    int c = a + b;\n    int d[2];\n    d[0] = c;\n    return d[0] * 2;\n}\nint main(void)\n{\n    return f(3, 4);\n}\n';
  const plain = compile(src, { mode: 'plain' }).asm;
  const reg = compile(src, { mode: 'register' }).asm;
  assert.doesNotMatch(plain, /\bs1\b/);
  assert.match(reg, /# frame: \d+ bytes; a in s1, b in s2, c in s3/);
  assert.match(reg, /add\s+s3, s1, s2|add\s+t0, s1, s2/);
  assert.equal(ours(src, { mode: 'plain' }).exit, 14);
  assert.equal(ours(src, { mode: 'register' }).exit, 14);
  assert.match(plain, /real compiler \(GCC\) produces different code/);
});

test('WS-F-082: every assembly line maps to a C line; each statement has its comment and code', () => {
  const src = SMALL;
  const c = compile(src);
  const lines = c.asm.trimEnd().split('\n');
  assert.equal(c.map.length, lines.length);
  const cLines = src.split('\n');
  for (const k of [6, 7, 13, 14, 15, 16, 17, 18, 19, 20]) {
    const at = c.map.map((l, i) => (l === k ? i : -1)).filter((i) => i >= 0);
    assert.ok(at.length > 0, `C line ${k} has assembly`);
    assert.ok(lines[at[0]].includes(`# ${k}: ${cLines[k - 1].trim()}`), `C line ${k} is named: ${lines[at[0]]}`);
  }
  assert.ok(c.map.every((l) => l >= 0 && l <= cLines.length));
});

// --- WS-F-084: diagnostics -----------------------------------------------------------------------
const WRONG = [
  ['int main(void)\n{\n    long x = 1;\n    return x;\n}\n', 3, /long \(and 64-bit types\): not in the simulator's C subset/, true],
  ['struct p { int x; };\nint main(void) { return 0; }\n', 1, /structures: not in the simulator's C subset/, true],
  ['int main(void)\n{\n    float f;\n    return 0;\n}\n', 3, /floating point: not in the simulator's C subset/, true],
  ['#include <stdio.h>\nint main(void) { return 0; }\n', 1, /only #include <stdint.h>; putchar and exit are built in/, true],
  ['#define SQ(x) ((x)*(x))\nint main(void) { return 0; }\n', 1, /macros with parameters are not in the simulator's C subset/, true],
  ['int main(void)\n{\n    uint32_t x = 1;\n    return x;\n}\n', 3, /uint32_t needs #include <stdint.h>/, false],
  ['int main(void)\n{\n    return y;\n}\n', 3, /y is not declared/, false],
  ['int main(void)\n{\n    int a[2][2];\n    return 0;\n}\n', 3, /more than one dimension/, true],
  ['int f(int a) { return a; }\nint main(void)\n{\n    return f(1, 2);\n}\n', 4, /f takes 1 argument, not 2/, false],
  ['int main(void)\n{\n    int x = 1\n    return x;\n}\n', 4, /expected ; after the declaration, found return/, false],
  ['int main(void)\n{\n    int *p = 5;\n    return 0;\n}\n', 3, /an integer given where the pointer int \* is needed/, false],
  ['int main(void)\n{\n    const int k = 1;\n    k = 2;\n    return k;\n}\n', 4, /k is const/, false],
  ['int main(void)\n{\n    break;\n}\n', 3, /break outside a loop or a switch/, false],
  ['int f(void) { return 1; }\n', 1, /needs a function main/, false],
  ['int main(void)\n{\n    int i, j;\n    for (i = 0, j = 0; i < 3; i++) {}\n    return 0;\n}\n', 4, /comma operator is not in the simulator's C subset/, true],
  ['int f(int a, int b, int c, int d, int e, int f2, int g, int h, int i) { return a; }\nint main(void) { return 0; }\n', 1, /at most 8, all in registers a0–a7/, false],
  ['int main(void)\n{\n    int a = 08;\n    return a;\n}\n', 3, /08 is not a valid integer constant/, false],
  ['int main(void)\n{\n    unsigned x = 3000000000;\n    return 0;\n}\n', 3, /write 3000000000u for an unsigned constant/, true],
  ['#if 1\nint main(void) { return 0; }\n', 1, /#if without a matching #endif/, false],
  ['int main(void)\n{\n    switch (1) { case 1: case 1: break; }\n    return 0;\n}\n', 3, /case 1 appears twice/, false],
];

for (const [src, line, re, subset] of WRONG) {
  test(`WS-F-084: ${re.source.slice(0, 50)} (line ${line})`, () => {
    const c = compile(src);
    assert.equal(c.ok, false, 'compiled');
    assert.match(c.errors[0].message, re);
    assert.equal(c.errors[0].line, line);
    assert.ok(c.errors[0].column >= 1);
    assert.equal(c.errors[0].subset, subset);
  });
}
