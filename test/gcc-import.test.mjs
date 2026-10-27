// gcc-import.test.mjs -- import of GCC -S output (WS-F-085): the fixtures
// (test/fixtures/gcc/, made by the pinned GCC from two small programs) are
// imported, assembled and run in the ISA profile, and give the results that
// the same programs give when built by GCC and run in rvsim.py (recorded in
// the fixtures' README). Every change is reported; lines keep their numbers.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { importGcc, looksLikeGcc } from '../src/asm/gcc-import.js';
import { Session, STOP } from '../src/core/session.js';

const FX = (n) => readFileSync(fileURLToPath(new URL(`./fixtures/gcc/${n}`, import.meta.url)), 'utf8');
const CASES = [
  ['sum-O0-rv32im.s', 16, ''], ['sum-O2-rv32im.s', 16, ''], ['sum-O1-rv32i.s', 16, ''],
  ['calls-O1g-rv32i.s', 88, 'ok\n'], ['calls-O0-rv32im.s', 88, 'ok\n'],
];

function runImported(name) {
  const src = FX(name);
  const imp = importGcc(src);
  const s = new Session();
  s.files = [{ name, text: imp.text }];
  const p = s.assemble();
  return { src, imp, s, p };
}

for (const [name, code, out] of CASES) {
  test(`WS-F-085: ${name} imports and runs as GCC + rvsim.py`, () => {
    const { src, imp, s, p } = runImported(name);
    assert.ok(looksLikeGcc(src));
    assert.deepEqual(p.errors.map((e) => `${e.line}: ${e.message}`), []);
    assert.deepEqual(imp.missing, []);
    let r;
    do r = s.run(); while (r === STOP.CHUNK);
    assert.equal(r, STOP.HALT, s.error ?? '');
    assert.equal(s.hart.exitCode, code);
    assert.equal(new TextDecoder().decode(Uint8Array.from(s.hart.output)), out);
    assert.deepEqual(s.hart.abiViolations, []);
    // every original line keeps its number: the import only rewrites lines and appends
    const lines = imp.text.split('\n');
    src.split(/\r?\n/).forEach((l, i) => {
      if (l.trim() && lines[i] !== l) assert.match(lines[i], /# /, `line ${i + 1} changed without a note`);
    });
  });
}

test('WS-F-085: the report lists what was filtered and added', () => {
  const g = runImported('calls-O1g-rv32i.s').imp;
  const actions = new Set(g.report.map((r) => r.action));
  for (const a of ['dropped', 'skipped', 'comm', 'rodata']) assert.ok(actions.has(a), a);
  assert.deepEqual(g.added.sort(), ['__mulsi3', 'putchar']);
  const o2 = runImported('sum-O2-rv32im.s').imp;
  assert.ok(o2.report.some((r) => r.action === 'label' && /LANCHOR0/.test(r.what)));
  assert.ok(o2.report.some((r) => r.action === 'text' && r.what === '.text.startup'));
  assert.deepEqual(runImported('sum-O1-rv32i.s').imp.added.sort(), ['__modsi3', '__mulsi3']);
});

test('WS-F-085: a call to a routine the import does not supply is listed as missing', () => {
  const imp = importGcc('\t.file\t"x.c"\n\t.text\nmain:\n\tcall\tprintf\n\tret\n');
  assert.deepEqual(imp.missing, ['printf']);
  assert.equal(looksLikeGcc('loop: j loop\n'), false);
});
