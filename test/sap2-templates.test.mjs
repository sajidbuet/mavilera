// SAP-2 templates (content/sap-2/templates/; plan steps 4 and 5 of docs/architecture/sap-2-plan.md): the index lists
// every file, each opens in a view of the descriptor, and each program does what its comment says on the engine (the bus
// model agrees with it on each, test/sap2-bus-model.test.mjs). Expected
// values by hand from the reference sheet (docs/architecture/sap-2-reference.md §2); no reference simulator exists.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { descriptor as d } from '../src/arch/sap-2/index.js';
import { STOP } from '../src/arch/contract.js';

const DIR = new URL('../content/sap-2/templates/', import.meta.url);
const ix = JSON.parse(readFileSync(new URL('index.json', DIR), 'utf8'));
const source = (f) => readFileSync(new URL(f, DIR), 'utf8');

// what each template shows: the values written to port 3, how it ends, and what else its comment states
const EXPECT = {
  'count-down': { out: [5, 4, 3, 2, 1], stop: STOP.HALT },
  // 3 MVI (7 T each) + 10 passes of ADD, DCR (4 each) and JNZ (10 taken, 7 the last time) + OUT (10) + HLT (5)
  multiply: { out: [120], stop: STOP.HALT, retired: 35, states: 3 * 7 + 9 * 18 + 15 + 10 + 5 },
  larger: { out: [60], stop: STOP.HALT },
  subroutine: { out: [14, 28], stop: STOP.HALT, memory: { 0xfffe: [0x0a, 0x00] } },
  'rom-write': { out: [42], stop: STOP.ERROR, memory: { 0x2000: [42], 0x0010: [0] } },
  keyboard: { out: [5 + 10 + 3], stop: STOP.HALT, inputs: [{ at: 0, key: 5 }, { at: 100, key: 10 }, { at: 200, key: 3 }] },
  'serial-out': { out: [0xb4], stop: STOP.HALT, port4: [0, 0, 1, 0, 1, 1, 0, 1] },
  // the bus view's templates (plan step 5): MVI 7, ADD B 4, MOV 4, OUT 10, HLT 5; MVI 7, CALL 18, OUT 10, RET 10, HLT 5
  'alu-next-fetch': { out: [0x34], stop: STOP.HALT, states: 7 + 7 + 4 + 4 + 10 + 5 },
  'call-states': { out: [9], stop: STOP.HALT, states: 7 + 18 + 10 + 10 + 5 },
};

const run = (p, opts = {}) => {
  const e = d.engine.create(p, opts);
  let stop;
  do stop = e.run({}); while (stop === STOP.CHUNK);
  return { e, stop };
};
const outs = (e) => [...e.state().output.matchAll(/Port 3 = [0-9A-F]+H = (\d+)/g)].map((m) => Number(m[1]));

test('the index lists every template file once, in a group and a view of the descriptor', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.asm')).sort();
  assert.deepEqual(ix.templates.map((t) => t.file).sort(), files);
  for (const t of ix.templates) {
    assert.ok(t.group in ix.groups, t.id);
    assert.ok(d.views.some((v) => v.id === t.view), t.id);
    assert.ok(t.id in EXPECT, `${t.id}: no expectation`);
  }
});

test('each template runs as its comment says', () => {
  for (const t of ix.templates) {
    const p = d.language.assemble([{ name: t.file, text: source(t.file) }]);
    assert.ok(p.ok, `${t.id}: ${JSON.stringify(p.diagnostics)}`);
    assert.deepEqual(p.diagnostics, [], t.id);
    const want = EXPECT[t.id];
    const { e, stop } = run(p, want.inputs ? { inputs: want.inputs } : {});
    assert.equal(stop, want.stop, t.id);
    assert.deepEqual(outs(e), want.out, t.id);
    if (want.retired) assert.equal(e.state().retired, want.retired, t.id);
    if (want.states) assert.deepEqual(e.counters()[1], ['T states', want.states], t.id);
    for (const [a, bytes] of Object.entries(want.memory ?? {})) assert.deepEqual([...e.peek(Number(a), bytes.length)], bytes, `${t.id} at ${a}`);
    if (want.port4) {
      const e2 = d.engine.create(p);
      const seen = [];
      for (let r = e2.step(); r; r = e2.step()) {
        const w = r.registers.find((x) => x.id === 'OUT4');
        if (w) seen.push(w.value);
        if (r.halt) break;
      }
      assert.deepEqual(seen, want.port4, t.id);
    }
  }
});

test('keyboard: without keys the program waits for READY until the run budget', () => {
  const p = d.language.assemble([{ name: 'k.asm', text: source('keyboard.asm') }]);
  const { e, stop } = run(p, { runLimit: 5000 });
  assert.equal(stop, STOP.BUDGET);
  assert.deepEqual(outs(e), []);
  assert.deepEqual(e.loopRange(), { from: 0x04, to: 0x08 }, 'the wait loop: IN 02H at 0004H to JZ at 0008H');
});
