// uninit.test.mjs -- the uninitialised-value check (WS-F-147). It has no rvsim.py reference, so it
// is verified by its own corpus of planted faults (each with the warnings it must give, by address)
// and of correct programs that must give none (the ISA templates, compiled C, a prologue that saves
// registers it never wrote); and through step back, the Worker snapshot and the session.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { Hart } from '../src/core/iss.js';
import { Session } from '../src/core/session.js';
import { compile } from '../src/cc/compiler.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function run(text, limit = 100_000) {
  const p = assemble([{ name: 't.s', text }], { profile: 'iss' });
  assert.ok(p.ok, p.errors.map((e) => e.message).join('; '));
  const h = new Hart(p, { profile: 'iss', uninitCheck: true, abiCheck: true });
  try { while (!h.halted && h.instret < limit) h.stepFast(); } catch { /* a planted fault may also end in an error */ }
  return h;
}
const found = (h) => h.uninitSoFar.map((u) => (u.reg !== undefined ? `x${u.reg}@${u.pc}` : `M${u.addr}@${u.pc}`));

// Planted faults: the program and the warnings it must give, as x<reg>@<pc> or M<address>@<pc>.
const FAULTS = [
  ['registers read before any write', `
        add  a0, t0, t1          # pc 0: t0 and t1 are unwritten
        li   a7, 93
        ecall`, ['x5@0', 'x6@0']],
  ['an argument the caller did not set', `
main:   li   a0, 4               # a1 is never set
        call addab
        li   a7, 93
        ecall
addab:  add  a0, a0, a1          # pc 16 (after li, call = jal, li, ecall)
        ret`, ['x11@16']],
  ['exit code never set', `
        li   a7, 93
        ecall                    # pc 4 reads a0`, ['x10@4']],
  ['a stack word loaded before it is stored', `
main:   addi sp, sp, -16
        lw   t0, 8(sp)           # pc 4: nothing stored at sp + 8
        li   a0, 0
        li   a7, 93
        ecall`, [`M${0x100000 - 16 + 8}@4`]],
  ['a byte of a half-word never stored', `
main:   addi sp, sp, -16
        sb   zero, 0(sp)
        lh   t0, 0(sp)           # pc 8: byte sp + 1 never stored
        li   a0, 0
        li   a7, 93
        ecall`, [`M${0x100000 - 16}@8`]],
  ['ra used by a return that no call set', `
        li   a0, 0
        li   a7, 93
        jalr x0, 12(ra)          # pc 8: ra unwritten (0 + 12: the ecall below)
        ecall`, ['x1@8']],
];

for (const [name, src, want] of FAULTS) {
  test(`WS-F-147 planted fault: ${name}`, () => assert.deepEqual(found(run(src)), want));
}

test('WS-F-147: a prologue that saves ra and s0-s11 it never wrote, then restores them, is not a fault', () => {
  const h = run(`
main:   addi sp, sp, -32
        sw   ra, 28(sp)
        sw   s0, 24(sp)
        sw   s1, 20(sp)
        sw   s11, 16(sp)
        li   s0, 5
        lw   s11, 16(sp)
        lw   s1, 20(sp)
        lw   s0, 24(sp)
        lw   ra, 28(sp)
        addi sp, sp, 32
        li   a0, 0
        li   a7, 93
        ecall`);
  assert.deepEqual(found(h), []);
  assert.ok(h.halted);
});

test('WS-F-147: the ISA templates and the compiled C templates give no warning', () => {
  const index = JSON.parse(readFileSync(join(ROOT, 'content/templates/index.json'), 'utf8'));
  for (const t of index.templates.filter((x) => x.view === 'isa')) {
    let text = readFileSync(join(ROOT, 'content/templates', t.file), 'utf8');
    if (t.lang === 'c') for (const mode of ['plain', 'register']) {
      text = compile(readFileSync(join(ROOT, 'content/templates', t.file), 'utf8'), { mode }).asm;
      assert.deepEqual(found(run(text)), [], `${t.file} (${mode})`);
    } else assert.deepEqual(found(run(text)), [], t.file);
  }
});

test('WS-F-147: step back withdraws the warnings of the undone steps; stepping again gives them once', () => {
  const s = new Session();
  s.files = [{ name: 't.s', text: 'li a0, 1\nadd a1, a0, t0\nadd a2, a0, t1\nli a7, 93\necall\n' }];
  s.uninitCheck = true;
  s.assemble();
  s.step(); s.step(); s.step();
  assert.deepEqual(s.hart.uninitSoFar.map((u) => u.reg), [5, 6]);
  s.back();
  assert.deepEqual(s.hart.uninitSoFar.map((u) => u.reg), [5]);
  s.step();
  assert.deepEqual(s.hart.uninitSoFar.map((u) => u.reg), [5, 6]);
  // a Worker continues from a snapshot with the check's state
  const w = Session.fromWorkerRequest(s.workerRequest({}));
  assert.equal(w.hart.uninitCheck, true);
  assert.deepEqual(w.hart.uninitSoFar.map((u) => u.reg), [5, 6]);
});

test('WS-F-147: off by default in the engine (the conformance runs and the exports are unchanged)', () => {
  const p = assemble([{ name: 't.s', text: 'add a0, t0, t1\nli a7, 93\necall\n' }], { profile: 'iss' });
  const h = new Hart(p, { profile: 'iss' });
  while (!h.halted) h.stepFast();
  assert.deepEqual(h.uninitWarnings, []);
});
