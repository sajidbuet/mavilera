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
  overlap: (s) => assert.equal(s.registers.DI, 609),
  'interrupt-inputs': (s) => assert.equal(s.output, '>'), // halted, waiting for the panel's inputs (8086-B8)
  'single-step': (s) => assert.equal(s.registers.BX, 12),
};

test('i8086: the interrupt-inputs template does what its comment says with the panel\'s inputs (8086-B8)', () => {
  const text = readFileSync(new URL('interrupt-inputs.asm', dir), 'utf8');
  const p = descriptor.language.assemble([{ name: 'interrupt-inputs.asm', text }], { profile: 'flat' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const run = (e) => { let s; do s = e.run({ chunk: 1_000_000 }); while (s === STOP.CHUNK); return s; };
  // NMI with a delay of 14 at the reset: after the second repetition of REP MOVSB, which resumes at its REP prefix
  const e = descriptor.engine.create(p);
  e.input({ nmi: true, delay: 14 });
  let rec;
  do rec = e.step(); while (!rec.trap);
  assert.equal(rec.trap.cause, 2);
  assert.equal(e.state().registers.CX, 3, 'cut with CX = 3');
  assert.equal(run(e), STOP.HALT);
  assert.equal(e.state().output, 'N>');
  assert.equal(String.fromCharCode(...e.peek(p.symbols.copy, 5)), 'HELLO');
  // halted: NMI wakes it; INTR on prints I again and again until it is turned off
  e.input({ nmi: true });
  assert.equal(run(e), STOP.HALT);
  assert.equal(e.state().output, 'N>N');
  assert.equal(e.peek(p.symbols.nmis, 1)[0], 2);
  e.input({ intr: true, type: 0x20 });
  for (let i = 0; i < 40; i++) e.step();
  e.input({ intr: false });
  assert.equal(run(e), STOP.HALT);
  assert.match(e.state().output, /^N>NI{3,}$/);
});

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
