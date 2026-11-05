// The 8086 templates (content/i8086/templates): each assembles, runs to HLT in the default profile, and shows what its
// comment says (the console output and the registers it names).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/i8086/index.js';
import { STOP } from '../src/arch/contract.js';

const dir = new URL('../content/i8086/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const runFile = (file, profile) => {
  const p = descriptor.language.assemble([{ name: file, text: readFileSync(new URL(file, dir), 'utf8') }], { profile });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const e = descriptor.engine.create(p);
  let s; do s = e.run({ chunk: 1_000_000 }); while (s === STOP.CHUNK);
  assert.equal(s, STOP.HALT, e.state().error ?? s);
  return e.state();
};

const EXPECT = {
  'sum-table': (s) => assert.equal(s.output, 'Sum OK\r\n'),
  flags: (s) => assert.equal(s.registers.AX & 0xff, 0x83),
  strings: (s) => assert.equal(s.output, 'The copy is the same.\r\n'),
  segments: (s) => assert.equal(s.output, 'A'),
  decimal: (s) => assert.equal(s.output, '51966\r\n'),
  interrupts: (s) => assert.equal(s.output, 'HE!'),
};

test('i8086: every template is listed, has the copyright line, and shows what it says', () => {
  assert.deepEqual(index.templates.map((t) => t.id).sort(), Object.keys(EXPECT).sort());
  for (const t of index.templates) {
    assert.match(readFileSync(new URL(t.file, dir), 'utf8'), /Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./);
    EXPECT[t.id](runFile(t.file));
  }
  EXPECT.segments(runFile('segments.asm', 'segmented'));
});

test('i8086: the default program is the first template', () => {
  assert.equal(descriptor.language.defaultSource.split('\n').slice(-12).join('\n'), readFileSync(new URL('sum-table.asm', dir), 'utf8').split('\n').slice(-12).join('\n'));
});
