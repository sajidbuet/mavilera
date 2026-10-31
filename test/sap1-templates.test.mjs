// SAP-1 templates (content/sap-1/templates/; arch-contract.md phase 5): the index lists every file, each opens in a
// view of the descriptor, and each program does what its comment says, on the engine and on the bus model.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { descriptor as d } from '../src/arch/sap-1/index.js';
import { BusModel } from '../src/arch/sap-1/bus-model.js';
import { STOP } from '../src/arch/contract.js';

const DIR = new URL('../content/sap-1/templates/', import.meta.url);
const ix = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));
const source = (f) => readFileSync(new URL(f, DIR), 'utf8');

// what each template shows: the console output and how it ends
const EXPECT = {
  'sum-three': { out: [51], stop: STOP.HALT },
  'wrap-around': { out: [254, 8], stop: STOP.HALT },
  multiply: { out: [28], stop: STOP.HALT, retired: 6 },
  'timing-states': { out: [0xa5], stop: STOP.HALT, cycles: 6 + 6 + 4 },
  'code-is-data': { out: [224], stop: STOP.HALT },
  'missing-hlt': { out: [48], stop: STOP.ERROR },
};

test('the index lists every template file once, in a group and a view of the descriptor', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.asm')).sort();
  assert.deepEqual(ix.templates.map((t) => t.file).sort(), files);
  for (const t of ix.templates) {
    assert.ok(t.group in ix.groups, t.id);
    assert.ok(d.views.some((v) => v.id === t.view), t.id);
    assert.ok(t.id in EXPECT, `${t.id}: no expectation`);
  }
});

test('each template runs as its comment says, on the engine and on the bus model', () => {
  for (const t of ix.templates) {
    const p = d.language.assemble([{ name: t.file, text: source(t.file) }]);
    assert.ok(p.ok, `${t.id}: ${JSON.stringify(p.diagnostics)}`);
    const want = EXPECT[t.id];
    const e = d.engine.create(p);
    let stop;
    do stop = e.run({}); while (stop === STOP.CHUNK);
    assert.equal(stop, want.stop, t.id);
    const outs = [...e.state().output.matchAll(/OUT = (\d+)/g)].map((m) => Number(m[1]));
    assert.deepEqual(outs, want.out, t.id);
    if (want.retired) assert.equal(e.state().retired, want.retired, t.id);
    const m = new BusModel(p);
    let r;
    do r = m.step(); while (r === 'step');
    assert.equal(r, want.stop === STOP.HALT ? 'halt' : 'error', t.id);
    assert.equal(m.output, e.state().output, t.id);
    if (want.cycles) assert.equal(m.cycle, want.cycles, t.id);
  }
});
