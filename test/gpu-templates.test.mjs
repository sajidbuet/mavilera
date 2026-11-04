// GPU module templates (content/gpu/templates/; GPU-1) and the Lanes panel's matrix: the index lists every file, each
// opens in a view and a profile of the descriptor, each program ends as its last comment says; the three laboratory
// programs assemble to the words of simt_tests.hex; the matrix shows the lanes of the profile.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { descriptor as d } from '../src/arch/gpu/index.js';
import { laneId } from '../src/arch/gpu/engine.js';
import { laneMatrix } from '../src/arch/gpu/ui/lanes-panel.js';
import { STOP } from '../src/arch/contract.js';
import { simtTests } from './gpu-fixtures.mjs';

const DIR = new URL('../content/gpu/templates/', import.meta.url);
const ix = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));
const source = (f) => readFileSync(new URL(f, DIR), 'utf8');

// dout, cycles, idle lane-slots (hand-computed for clamp8; the laboratory's values for the others)
const EXPECT = {
  abs: [[5, 3, 0, 7], 7, 4, 0],
  nested: [[110, 11, 22, 23], 12, 9, 1],
  straight: [[2, -3, 8, -5], 3, 0, 2],
  clamp8: [[0, 0, 0, 3, 5, 8, 9, 9], 13, 22, null],
};

test('the index lists every template once, in a group, a view and a profile of the descriptor', () => {
  assert.deepEqual(ix.templates.map((t) => t.file).sort(), readdirSync(DIR).filter((f) => f.endsWith('.simt')).sort());
  const profiles = d.engine.profiles.map((p) => p.id);
  for (const t of ix.templates) {
    assert.ok(ix.groups[t.group], t.id);
    assert.ok(d.views.some((v) => v.id === t.view), t.id);
    assert.ok(profiles.includes(t.profile), t.id);
    assert.ok(t.id in EXPECT, t.id);
    assert.match(source(t.file), /^; .+\n; Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\.\n; Rights class: content/);
  }
});

test('each template runs to HALT with the outputs, cycles and idle lane-slots its comment gives', () => {
  const lab = simtTests();
  for (const t of ix.templates) {
    const p = d.language.assemble([{ name: t.file, text: source(t.file) }], { profile: t.profile });
    assert.ok(p.ok, `${t.id}: ${JSON.stringify(p.diagnostics)}`);
    const [dout, cycles, idle, k] = EXPECT[t.id];
    if (k !== null) assert.deepEqual(p.listing.map((r) => r.word), lab[k].program.slice(0, lab[k].length), `${t.id}: the laboratory's words`);
    const e = d.engine.create(p);
    let s; do s = e.run({ chunk: 1000 }); while (s === STOP.CHUNK);
    assert.equal(s, STOP.HALT, t.id);
    const r = e.state().registers;
    assert.deepEqual(dout.map((_, l) => r[laneId(l, 2)] | 0), dout, t.id);
    assert.deepEqual([r.cycles, r.idle_slots, r.active_mask], [cycles, idle, 2 ** dout.length - 1], t.id);
    assert.match(source(t.file), new RegExp(`dout.*= ${dout.join(', ')} after ${cycles} cycles, ${idle} idle lane-slots`), `${t.id}: its comment`);
  }
  assert.equal(d.language.defaultSource.split('\n').filter((l) => /^\s+[A-Z.]/.test(l)).join('\n'),
    source('abs.simt').split('\n').filter((l) => /^\s+[A-Z.]/.test(l)).join('\n'), 'the default program is the abs template');
});

test('the Lanes panel\'s matrix: one column per lane of the profile, registers signed, mask and stack bits', () => {
  const p = d.language.assemble([{ name: 'a', text: source('clamp8.simt') }], { profile: 'simt8' });
  const e = d.engine.create(p);
  for (let i = 0; i < 3; i++) e.step(); // LDI r3, 0; IFLT r1, r3; LDI r2, 0
  const m = laneMatrix(e.state().registers);
  assert.equal(m.length, 8);
  assert.deepEqual(m.map((c) => c.active), [true, true, false, false, false, false, false, false]);
  assert.deepEqual(m[0].cells.map((c) => c.row), ['r0', 'r1', 'r2', 'r3', 'active', 'stack0', 'stack1']);
  assert.deepEqual(m[0].cells.map((c) => c.text), ['0', '-9', '0', '0', '1', '1', '1']);
  assert.match(m[1].cells[1].title, /Lane 1 r1 = -2 \(0xFFFFFFFE\)/);
  assert.equal(laneMatrix(d.engine.create(d.language.assemble([{ name: 'b', text: 'HALT' }])).state().registers).length, 4);
});
