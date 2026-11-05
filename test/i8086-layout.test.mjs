// The geometry of the 8086 BIU/EU drawing (src/arch/i8086/ui/layout.js; milestone 8086-B4): every unit inside its
// frame (Intel's partition, IFUM Fig 4-3) and apart from the others and from the ALU data bus; every place of the
// teaching model drawn in a unit; stubs that reach the bus or its riser; links that run between units without
// crossing one; every element with a source class, a name and a tooltip (roadmap §9).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEW, FRAMES, BUS, SPINE, UNITS, DECODER, CELLS, STUBS, LINKS, PLACE_UNIT, PLACE_ROW, rowBox } from '../src/arch/i8086/ui/layout.js';
import { PLACES } from '../src/arch/i8086/microops.js';
import { I8086_STRINGS } from '../src/arch/i8086/strings.js';

const D = I8086_STRINGS.datapath;
const U = Object.values(UNITS);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const BIU_UNITS = ['SEG', 'ICR', 'ADDER', 'BUSCTL', 'QUEUE'];

test('i8086 B4 layout: the units lie in their frames, apart from each other and from the ALU data bus', () => {
  for (const f of Object.values(FRAMES)) assert.ok(inside(f, { x: 0, y: 0, w: VIEW.w, h: VIEW.h }));
  assert.ok(!overlap(FRAMES.BIU, FRAMES.EU));
  for (const u of U) {
    assert.ok(inside(u, BIU_UNITS.includes(u.id) ? FRAMES.BIU : FRAMES.EU), `${u.id} in its frame`);
    assert.ok(!overlap(u, BUS) && !overlap(u, SPINE), `${u.id} and the bus`);
  }
  for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) assert.ok(!overlap(U[i], U[j]), `${U[i].id} and ${U[j].id}`);
  assert.ok(inside(DECODER, UNITS.CTRL));
  for (const c of CELLS) assert.ok(inside(c, UNITS.QUEUE), `cell ${c.index}`);
  assert.deepEqual(CELLS.map((c) => c.index), [6, 5, 4, 3, 2, 1]);
  // the spine joins the bus at its left end and rises into the BIU
  assert.equal(SPINE.x, BUS.x);
  assert.equal(SPINE.y + SPINE.h, BUS.y);
  assert.ok(SPINE.y > FRAMES.BIU.y && SPINE.y < FRAMES.BIU.y + FRAMES.BIU.h);
});

test('i8086 B4 layout: every place of the teaching model is drawn, in a row of its unit', () => {
  assert.deepEqual(Object.keys(PLACE_UNIT).sort(), Object.keys(PLACES).sort());
  for (const [p, id] of Object.entries(PLACE_UNIT)) {
    const u = UNITS[id];
    if (['Q', 'decode', 'Σ', 'FLAGS'].includes(p)) continue;
    const row = PLACE_ROW[p] ?? p;
    assert.ok(u.rows?.includes(row), `${p} in ${id}`);
    assert.ok(inside(rowBox(id, row), u), `${p}'s row inside ${id}`);
  }
});

test('i8086 B4 layout: stubs reach the bus or its riser from their unit; links do not cross a unit', () => {
  for (const st of STUBS) {
    const u = UNITS[st.unit];
    const pts = st.points;
    if (BIU_UNITS.includes(st.unit)) {
      assert.ok(pts.some(([x]) => x === SPINE.x + SPINE.w) && pts.some(([x]) => x === u.x), `${st.unit}.${st.dir}`);
    } else {
      assert.ok(pts.some(([, y]) => y === BUS.y || y === BUS.y + BUS.h), `${st.unit}.${st.dir} at the bus`);
      assert.ok(pts.some(([, y]) => y === u.y || y === u.y + u.h), `${st.unit}.${st.dir} at its unit`);
      assert.ok(pts[0][0] > u.x && pts[0][0] < u.x + u.w && pts[0][0] > BUS.x && pts[0][0] < BUS.x + BUS.w);
    }
  }
  const crosses = (seg, u) => {
    const [[x1, y1], [x2, y2]] = seg;
    const [lx, hx, ly, hy] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
    return lx < u.x + u.w - 0.5 && hx > u.x + 0.5 && ly < u.y + u.h - 0.5 && hy > u.y + 0.5;
  };
  for (const l of LINKS) {
    assert.ok(l.points.every(([x, y]) => x >= 0 && x <= VIEW.w && y >= 0 && y <= VIEW.h), l.id);
    for (let i = 0; i + 1 < l.points.length; i++) {
      const seg = [l.points[i], l.points[i + 1]];
      assert.ok(seg[0][0] === seg[1][0] || seg[0][1] === seg[1][1], `${l.id}: horizontal or vertical`);
      for (const u of U) assert.ok(!crosses(seg, u), `${l.id} crosses ${u.id}`);
    }
  }
});

test('i8086 B4 layout: every element has a name, a source class and a tooltip; abstractions are marked', () => {
  for (const u of U) {
    assert.ok(D.units[u.id], u.id);
    assert.equal(D.sources[u.id], u.cls, `${u.id}: layout and strings agree`);
    assert.ok(D.unitHelp[u.id], u.id);
  }
  assert.equal(D.sources.DECODER, 'edu');
  assert.equal(DECODER.cls, 'edu');
  for (const l of LINKS) {
    assert.ok(D.links[l.id], l.id);
    assert.ok(['intel', 're', 'edu'].includes(l.cls), l.id);
  }
  // the simulator's own elements, nothing else (design §2)
  assert.deepEqual(LINKS.filter((l) => l.cls === 'edu').map((l) => l.id).sort(), ['constant', 'offset']);
  assert.deepEqual(U.filter((u) => u.cls === 're').map((u) => u.id), ['SIGMA']);
});
