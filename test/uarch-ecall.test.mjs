// uarch-ecall.test.mjs -- ecall and ebreak in the three chapter processors (no trap hardware): ebreak and
// ecall with a7 = 93 stop the run like the halt word, in the same cycle count as the halt; any other
// ecall is an error that names a7. The register results are those of the instruction-level view.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { ch07 } from './ch07-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const T7 = ch07().t7;

const MAKE = {
  ch06: () => new SingleCycle(T6),
  ch07: () => new Multicycle(T6, T7, { jalr: true }),
  ch08: () => new Pipeline(T6),
};

const run = (profile, text) => {
  const p = assemble([{ name: 't.s', text }], { profile });
  assert.deepEqual(p.errors, []);
  const m = MAKE[profile]();
  m.load(p);
  return { m, stop: m.run() };
};

const prog = (end) => `
        .text
_start: li    t0, 7
        addi  t1, t0, 5
        ${end}
        li    t1, 99
        sw    t1, 0x100(zero)
`;

for (const profile of Object.keys(MAKE)) {
  test(`${profile}: ecall with a7 = 93 stops the run; nothing after it executes`, () => {
    const { m, stop } = run(profile, prog('li a7, 93\n        ecall'));
    assert.equal(stop, 'halt');
    assert.equal(m.x[6], 12);
    assert.equal(m.x[17], 93);
    assert.equal(m.dmem?.words?.[0x100 >> 2] ?? m.mem.words[0x100 >> 2], 0, 'the store after ecall did not happen');
  });

  test(`${profile}: ebreak stops the run`, () => {
    const { m, stop } = run(profile, prog('ebreak'));
    assert.equal(stop, 'halt');
    assert.equal(m.x[6], 12);
  });

  test(`${profile}: ecall with another a7 is an error that names it`, () => {
    const { m, stop } = run(profile, prog('li a7, 64\n        ecall'));
    assert.equal(stop, 'error');
    assert.match(m.error, /ecall with a7 = 64 is not implemented/);
  });

  test(`${profile}: ecall directly after the li a7 (hazard) still sees a7 = 93; back-step undoes the halt`, () => {
    const { m, stop } = run(profile, prog('li a7, 93\n        ecall'));
    assert.equal(stop, 'halt');
    assert.ok(m.back());
    assert.equal(m.halted, false);
    assert.equal(m.step() === 'step' || m.step() === 'halt', true);
  });
}
