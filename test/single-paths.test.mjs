// single-paths.test.mjs -- the active path of WS-F-030 reproduces the
// highlighted connections of FIG-0003 (R-type), FIG-0004 (lw), FIG-0005 (sw)
// and FIG-0006 (taken beq), from the main-decoder columns of the chapter; and
// the geometry check of WS-F-072: every connection names a signal of the
// model's dictionary, every data signal and every control output of the
// control unit appears on the drawing.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activePath } from '../src/uarch/single-paths.js';
import { classControl } from '../src/uarch/timing.js';
import { SINGLE_SIGNALS, SIGNAL_INFO } from '../src/uarch/signals.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const TABLES = read('content/data/ch06-tables.json');
const GEOM = read('content/geometry/ch06.json');
const col = (cls) => classControl(TABLES.main_decoder.columns.find((c) => c.class === cls), TABLES);

for (const [fig, cls] of [['FIG-0003', 'R'], ['FIG-0004', 'lw'], ['FIG-0005', 'sw'], ['FIG-0006', 'branch']]) {
  test(`WS-F-030: the ${cls} path is the highlight of ${fig}`, () => {
    const c = col(cls); // classControl times a branch as taken, the case of FIG-0006
    assert.deepEqual([...activePath(c).wires].sort(), GEOM.figures[fig].highlight);
  });
}

test('WS-F-030: active elements are elements of the drawing; every class keeps the fetch path', () => {
  const ids = new Set(GEOM.elements.map((e) => e.id));
  for (const c of TABLES.main_decoder.columns) {
    const p = activePath(classControl(c, TABLES));
    for (const e of p.elements) assert.ok(ids.has(e), `${e} (${c.class})`);
    for (const wid of p.wires) assert.ok(GEOM.wires.some((x) => x.id === wid), `${wid} (${c.class})`);
  }
});

test('WS-F-072: the drawing and the signal dictionary name the same signals', () => {
  const drawn = new Set();
  for (const w of GEOM.wires) {
    for (const s of w.signal.split(',')) {
      assert.ok(SIGNAL_INFO[s], `${w.id} carries ${s}, not in the dictionary`);
      drawn.add(s);
    }
  }
  for (const c of GEOM.control) {
    assert.ok(SIGNAL_INFO[c.signal]?.kind === 'control', `control stub ${c.signal}`);
    drawn.add(c.signal);
  }
  // Fields that leave the instruction bus by name (op, funct3, funct7b5 to the control unit;
  // rs1, rs2, rd to the register file) are drawn as labels on the bus.
  const labels = GEOM.labels.map((l) => l.text).join(' ');
  for (const s of ['op', 'funct3', 'funct7b5', 'zero', 'lt', 'ltu']) assert.match(labels, new RegExp(`\\b${s}\\b`), s);
  for (const s of ['op', 'funct3', 'funct7b5']) drawn.add(s);
  // Control signals inside the control unit (FIG-0009, not this drawing).
  const internal = new Set(['Branch', 'Jump', 'ALUOp', 'BranchTaken']);
  const missing = SINGLE_SIGNALS.filter((s) => !drawn.has(s.name) && !internal.has(s.name)).map((s) => s.name);
  assert.deepEqual(missing, []);
});
