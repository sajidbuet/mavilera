// armv7-templates.test.mjs -- the ARMv7 templates (content/armv7/templates, roadmap ARM-A1): each one listed exists,
// carries the copyright line, assembles for the instruction-level profile, runs to its B . without an error, and ends
// as its comment says (the expected values are the hand calculation of the comments).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, STACK_TOP } from '../src/arch/armv7/language.js';
import { create } from '../src/arch/armv7/engine.js';

const DIR = new URL('../content/armv7/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));

const END = {
  'fig-7-60': ({ word, stores }) => { assert.deepEqual(stores, [[96, 7], [100, 7]]); assert.equal(word(100), 7); },
  'base-sum': ({ r, word }) => { assert.equal(r.r0, 55); assert.equal(word(100), 55); },
  'base-sum-multi': ({ r, word }) => { assert.equal(r.r0, 55); assert.equal(word(100), 55); }, // the same file, for the Multicycle view (A3-Q7)
  'base-sum-pipe': ({ r, word }) => { assert.equal(r.r0, 55); assert.equal(word(100), 55); }, // and for the Pipelined view (ARM-A4)
  gcd: ({ r }) => { assert.equal(r.r0, 6); assert.equal(r.r1, 6); },
  flags: ({ r }) => assert.deepEqual([r.r0, r.N, r.Z, r.C, r.V], [0x80000000, 1, 0, 1, 0]), // after SUBS 5 - 5: C = 1, V = 0; ANDS keeps them
  factorial: ({ r }) => { assert.equal(r.r4, 120); assert.equal(r.r13, STACK_TOP); },
  strlen: ({ r }) => assert.equal(r.r0, 5),
  'block-copy': ({ r, word }) => { assert.deepEqual([r.r0, r.r1], [0x10010, 0x10020]); assert.deepEqual([0, 4, 8, 12].map((k) => word(0x10010 + k)), [10, 20, 30, 40]); },
};

test('the index lists each template once, with a group it defines, and every template has an end-state check', () => {
  assert.match(index._copyright, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury/);
  assert.equal(new Set(index.templates.map((t) => t.id)).size, index.templates.length);
  for (const t of index.templates) {
    assert.ok(t.group in index.groups, t.id);
    // a base-set template opens in the single-cycle view (W-D35) or, as further entries, in the multicycle view (A3-Q7) and
    // the pipelined view (ARM-A4)
    assert.ok(t.view === 'isa' || (t.view === 'single' && t.profile === 'arm-single') || (t.view === 'multi' && t.profile === 'arm-multi')
      || (t.view === 'pipe' && t.profile === 'arm-pipe'), t.id);
    assert.ok(END[t.id], `a check for ${t.id}`);
  }
});

test('the in-app help (content/armv7/help/help.json): known block kinds, a first page with the logo, references and notice', () => {
  const help = JSON.parse(readFileSync(new URL('../content/armv7/help/help.json', import.meta.url), 'utf8'));
  assert.match(help._copyright, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury/);
  const ids = help.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of help.sections) {
    assert.ok(s.title && s.blocks.length, s.id);
    for (const b of s.blocks) assert.equal(Object.keys(b).filter((k) => ['p', 'ul', 'ol', 'dl', 'brand', 'refs', 'notice'].includes(k)).length, 1, s.id);
  }
  const first = help.sections[0].blocks;
  assert.ok(first[0].brand && first.some((b) => b.refs) && first.some((b) => b.notice));
  assert.ok(first.find((b) => b.refs).refs.some(([, , d]) => d.includes('ISBN 978-0-12-800056-4')), 'the textbook, as its copyright page gives it');
});

for (const t of index.templates) {
  test(`template ${t.id}: assembles, runs to B . and ends as its comment says`, () => {
    const text = readFileSync(new URL(t.file, DIR), 'utf8');
    assert.match(text.split('\n')[1], /^; Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./);
    const p = assemble([{ name: t.file, text }], { profile: t.profile ?? 'arm-iss' });
    assert.ok(p.ok, JSON.stringify(p.diagnostics));
    const e = create(p);
    const stores = [];
    let rec;
    for (let i = 0; i < 100_000 && (rec = e.step()); i++) { for (const m of rec.memory) stores.push([m.address, m.value]); if (rec.halt) break; }
    const s = e.state();
    assert.equal(s.error, null);
    assert.equal(s.halted, true);
    const word = (a) => { const b = e.peek(a, 4); return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; };
    END[t.id]({ r: s.registers, word, stores: stores.filter(([a]) => a < 0x80000) });
  });
}
