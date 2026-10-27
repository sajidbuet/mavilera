// examples.test.mjs -- the example library (WS-F-123): every example of
// content/examples/index.json exists, carries its tags, comes from a
// student-facing folder (C5), and assembles (or compiles) in its profile;
// the ISA examples run to their halt. With the book repository and Python,
// the files equal a fresh export (tools/export_examples.py --check).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { Session, STOP } from '../src/core/session.js';
import { importGcc } from '../src/asm/gcc-import.js';
import { compile } from '../src/cc/compiler.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'content', 'examples');
const INDEX = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const skipBook = existsSync(join(BOOK, 'code')) ? (spawnSync(PYTHON, ['--version']).status === 0 ? false : 'Python 3 not found') : 'book repository not found beside this one';

test('WS-F-123: the index tags every example and names only student-facing sources (C5)', () => {
  assert.ok(INDEX.examples.length >= 30);
  const ids = new Set();
  for (const e of INDEX.examples) {
    assert.ok(!ids.has(e.id), e.id);
    ids.add(e.id);
    assert.ok(existsSync(join(DIR, e.file)), e.file);
    assert.ok(['iss', 'ch06', 'ch07', 'ch08'].includes(e.profile), e.id);
    assert.ok(e.title && !/chapter|laborator|exercise|\bWE\d/i.test(e.title), `${e.id}: ${e.title}`); // W-D16
    assert.ok(e.chapter || e.topic === 'tests', e.id); // the simulator's own tests belong to no chapter
    assert.doesNotMatch(e.source, /\/(ref|lab|cep|mutants)\//, e.source);
    const text = readFileSync(join(DIR, e.file), 'utf8');
    assert.doesNotMatch(text.split('\n').slice(0, 4).join(' '), /PRB-|\bCEP\b|solution|Exercise|Challenge/i, e.id);
    // the header names nothing of the book (W-D16): no chapter, worked example, laboratory or book tool
    const header = text.split('\n').filter((l) => l.startsWith('#')).slice(0, 8).join('\n');
    assert.doesNotMatch(header, /Chapter \d|\bWE\s?\d|laborator|rvsim\.py|Guided Self-study|textbook|the book/i, e.id);
    assert.match(text.split('\n')[0], new RegExp(`^# ${e.file.replace('.', '\\.')} -- `), e.id);
  }
  const taken = new Set(INDEX.examples.map((e) => e.source));
  for (const s of INDEX.skipped) assert.ok(!taken.has(s.source), s.source);
});

for (const e of INDEX.examples) {
  test(`WS-F-123: ${e.id} assembles in ${e.profile}${e.subset ? ` (${e.subset})` : ''}${e.profile === 'iss' && e.halts !== false ? ' and runs to its halt' : ''}`, () => {
    let text = readFileSync(join(DIR, e.file), 'utf8');
    if (e.lang === 'c') {
      const r = compile(text, { profile: e.profile });
      assert.deepEqual(r.errors, []);
      text = r.asm;
    } else if (e.gcc) text = importGcc(text).text;
    const s = new Session();
    s.profile = e.profile;
    s.subset = e.subset ?? null;
    s.files = [{ name: e.file, text }];
    const p = s.assemble();
    assert.deepEqual(p.errors.map((x) => `${x.line}: ${x.message}`), []);
    assert.deepEqual(p.profileErrors, []);
    if (e.profile !== 'iss') return;
    let r;
    do r = s.run(); while (r === STOP.CHUNK);
    if (e.halts === false) assert.equal(r, STOP.ERROR); // kept for its listing (author decision 2026-10-27)
    else assert.equal(r, STOP.HALT, s.error ?? '');
  });
}

test('WS-F-123: content/examples equals a fresh export from the book repository', { skip: skipBook }, () => {
  const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'export_examples.py'), '--book', BOOK, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
