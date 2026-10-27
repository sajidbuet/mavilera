// exercise.test.mjs -- the exercise mode (WS-F-148): the file format is checked and its errors
// named; a correct program passes every test, a wrong one fails with expected against actual; a
// procedure is called at its entry label and must keep the calling convention when asked; output,
// exit code and memory expectations; a C program. The sample file lives in test/fixtures/ and is
// never shipped (C5).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { compile } from '../src/cc/compiler.js';
import { parseExercise, runExercise, registerNumber, isExercise } from '../src/core/exercise.js';
import { shippedFiles } from '../tools/site-files.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SUM = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/exercise/sum.json'), 'utf8'));
const asm = (text) => { const p = assemble([{ name: 's.s', text }], { profile: 'iss' }); assert.ok(p.ok, p.errors.map((e) => e.message).join('; ')); return p; };

const GOOD = `        .data
arr:    .space 64
        .text
sum:    li   t0, 0
loop:   beqz a1, done
        lw   t1, 0(a0)
        add  t0, t0, t1
        addi a0, a0, 4
        addi a1, a1, -1
        j    loop
done:   mv   a0, t0
        ret
`;

test('register names: x0-x31, ABI names, fp', () => {
  assert.deepEqual(['x0', 'x31', 'a0', 'sp', 'fp', 's0', 't6', 'X5'].map(registerNumber), [0, 31, 10, 2, 8, 8, 31, 5]);
  assert.equal(registerNumber('x32'), null);
  assert.equal(registerNumber('r1'), null);
});

test('WS-F-148: a correct procedure passes every test', () => {
  const r = runExercise(asm(GOOD), parseExercise(SUM));
  assert.deepEqual(r.map((t) => t.pass), [true, true, true], JSON.stringify(r));
});

test('WS-F-148: a wrong procedure fails, with expected against actual', () => {
  const wrong = GOOD.replace('beqz a1, done', 'blez a1, done').replace('addi a1, a1, -1', 'addi a1, a1, -2'); // two iterations: 1 + 2
  const r = runExercise(asm(wrong), parseExercise(SUM));
  assert.equal(r[0].pass, false);
  const c = r[0].checks.find((x) => x.what === 'a0');
  assert.deepEqual([c.expected, c.actual, c.ok], ['10 (0x0000000a)', '3 (0x00000003)', false]);
});

test('WS-F-148: a procedure that breaks the calling convention fails the test that asks for it', () => {
  const bad = GOOD.replace('li   t0, 0', 'li   s0, 0').replace('add  t0, t0, t1', 'add  s0, s0, t1').replace('mv   a0, t0', 'mv   a0, s0');
  const r = runExercise(asm(bad), parseExercise(SUM));
  assert.deepEqual(r.map((t) => t.pass), [false, false, true]);
  assert.match(r[0].checks.find((c) => c.what === 'calling convention').actual, /s0 changed/);
});

test('WS-F-148: whole programs: output, exit code and memory; a missing label and a program that does not halt', () => {
  const ex = parseExercise({ format: 'risc-vista-exercise', version: 1, title: 'Output', tests: [
    { name: 'prints and exits', expect: { output: 'ok\n', exit: 3, memory: [{ at: 'res', words: [42] }] } },
    { name: 'needs a label', registers: { a0: 'nowhere' }, expect: { exit: 3 } },
  ] });
  const p = asm(`        .data
msg:    .asciz "ok\\n"
res:    .word 0
        .text
main:   la   t0, res
        li   t1, 42
        sw   t1, 0(t0)
        li   a0, 1
        la   a1, msg
        li   a2, 3
        li   a7, 64
        ecall
        li   a0, 3
        li   a7, 93
        ecall
`);
  const r = runExercise(p, ex);
  assert.equal(r[0].pass, true, JSON.stringify(r[0]));
  assert.equal(r[1].pass, false);
  assert.match(r[1].error, /no label "nowhere"/);
  const loop = runExercise(asm('l: addi t0, t0, 1\nj l\n'), parseExercise({ format: 'risc-vista-exercise', version: 1, title: 'x', tests: [{ expect: { exit: 0 }, limit: 1000 }] }));
  assert.match(loop[0].error, /no halt within 1,000/);
});

test('WS-F-148: a C program, compiled as the student would, is tested the same way', () => {
  const c = compile('int dbl(int x) { return 2 * x; }\nint main(void) { return dbl(21); }\n', { mode: 'register' });
  assert.ok(c.ok);
  const ex = parseExercise({ format: 'risc-vista-exercise', version: 1, title: 'C', lang: 'c', entry: 'dbl', tests: [
    { registers: { a0: 5 }, expect: { registers: { a0: 10 }, abi: true } }, { expect: { registers: { a0: 0 } } }] });
  assert.deepEqual(runExercise(asm(c.asm), ex).map((t) => t.pass), [true, true]);
});

test('WS-F-148: the file is checked and its problems named', () => {
  const bad = (o, re) => assert.throws(() => parseExercise({ format: 'risc-vista-exercise', version: 1, title: 'T', ...o }), re);
  assert.equal(isExercise({ format: 'risc-vista' }), false);
  assert.throws(() => parseExercise({ format: 'risc-vista-exercise', version: 2, title: 'T', tests: [{}] }), /version 2/);
  bad({ tests: [] }, /no tests/);
  bad({ tests: [{ name: 'a' }] }, /test 1 \(a\) expects nothing/);
  bad({ tests: [{ expect: { registers: { r9: 1 } } }] }, /"r9" is not a register/);
  bad({ tests: [{ memory: [{ at: 0 }], expect: { exit: 0 } }] }, /one of words, halves or bytes/);
  bad({ lang: 'py', tests: [{ expect: { exit: 0 } }] }, /unknown language/);
});

test('C5: no test fixture or model solution is published with the site (the practice exercises of W-D24 are)', () => {
  const bad = shippedFiles().filter((p) => /fixtures|solution/.test(p));
  assert.deepEqual(bad, []);
});
