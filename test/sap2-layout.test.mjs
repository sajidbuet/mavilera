// sap2-layout.test.mjs -- the geometry of the SAP-2 bus view (src/arch/sap-2/ui/layout.js; plan step 5): units apart,
// inside the drawing, one pin per control signal on its unit's outer edge, taps from the bundles, stubs that reach the
// bus, links between neighbours; the flag link crosses only control taps (drawn with a gap), never a unit or the bus.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEW, BUS, UNITS, PINS, TAPS, STUBS, LINKS, BUNDLES, INSIDE_CTRL, PITCH, FLAG_TRACK } from '../src/arch/sap-2/ui/layout.js';
import { SIGNALS } from '../src/arch/sap-2/bus-model.js';

const U = Object.values(UNITS);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('the units lie inside the drawing, apart from each other and from the bus', () => {
  for (const u of U) {
    assert.ok(u.x >= 0 && u.y >= 0 && u.x + u.w <= VIEW.w && u.y + u.h <= VIEW.h, u.id);
    if (u.id !== 'CTRL') assert.ok(!overlap(u, BUS), `${u.id} and the bus`);
  }
  for (let i = 0; i < U.length; i++) for (let j = i + 1; j < U.length; j++) assert.ok(!overlap(U[i], U[j]), `${U[i].id} and ${U[j].id}`);
  assert.ok(BUS.x + BUS.w <= VIEW.w && Math.max(...U.filter((u) => u.id !== 'CTRL').map((u) => u.x + u.w)) <= BUS.x + BUS.w);
});

test('one pin per control signal, on its unit\'s outer edge, apart; the controller keeps its own', () => {
  assert.deepEqual(PINS.map((p) => p.name).sort(), SIGNALS.filter((s) => !INSIDE_CTRL.includes(s.name)).map((s) => s.name).sort());
  assert.deepEqual(INSIDE_CTRL, ['Ek', 'HLT']);
  for (const p of PINS) {
    const u = UNITS[p.unit];
    assert.equal(SIGNALS.find((s) => s.name === p.name).unit, p.unit, p.name);
    assert.ok(p.x > u.x + 8 && p.x < u.x + u.w - 8, `${p.name} inside ${p.unit}'s edge`);
    assert.equal(p.y, u.row === 'top' ? u.y : u.y + u.h, p.name);
  }
  for (const a of PINS) for (const b of PINS) if (a !== b && a.unit === b.unit) assert.ok(Math.abs(a.x - b.x) >= PITCH, `${a.name}, ${b.name}`);
});

test('taps run from the bundles to the pins; the bundles leave the controller', () => {
  for (const t of TAPS) {
    const p = PINS.find((x) => x.name === t.signal);
    assert.deepEqual(t.points[1], [p.x, p.y]);
    assert.equal(t.points[0][1], p.side === 'top' ? BUNDLES.top.y : BUNDLES.bottom.y);
    const b = p.side === 'top' ? BUNDLES.top : BUNDLES.bottom;
    assert.ok(t.points[0][0] >= b.points[0][0] && t.points[0][0] <= b.points[1][0], t.signal);
  }
  for (const b of Object.values(BUNDLES)) {
    assert.equal(b.points[0][0], UNITS.CTRL.x + UNITS.CTRL.w);
    assert.ok(b.y > UNITS.CTRL.y && b.y < UNITS.CTRL.y + UNITS.CTRL.h);
  }
  assert.ok(BUNDLES.top.y < Math.min(...U.filter((u) => u.row === 'top').map((u) => u.y)));
  assert.ok(BUNDLES.bottom.y > FLAG_TRACK);
});

test('stubs reach the bus from their unit; links join neighbours\' facing sides', () => {
  for (const s of STUBS) {
    const ys = s.points.map((p) => p[1]);
    if (s.unit === 'CTRL') { assert.equal(s.points[1][0], BUS.x); continue; }
    assert.ok(ys.includes(BUS.y) || ys.includes(BUS.y + BUS.h), `${s.unit}.${s.dir}`);
    const u = UNITS[s.unit];
    assert.ok(s.x > u.x && s.x < u.x + u.w, `${s.unit}.${s.dir}`);
  }
  for (const l of LINKS.filter((x) => x.points.length === 2)) {
    const [[x1], [x2]] = l.points;
    const a = UNITS[l.from];
    const b = UNITS[l.to];
    assert.ok([a.x, a.x + a.w].includes(x1) && [b.x, b.x + b.w].includes(x2), `${l.from} → ${l.to}`);
    for (const u of U) if (u !== a && u !== b) assert.ok(!(Math.min(x1, x2) < u.x + u.w && Math.max(x1, x2) > u.x && l.points[0][1] > u.y && l.points[0][1] < u.y + u.h), `${l.from} → ${l.to} crosses ${u.id}`);
  }
  // the flag link crosses A's two taps only
  const f = LINKS.find((x) => x.from === 'ALU' && x.to === 'FLAGS');
  const [lo, hi] = [f.points[2][0], f.points[1][0]];
  assert.deepEqual(TAPS.filter((t) => t.points[0][1] === BUNDLES.bottom.y && t.points[0][0] > lo && t.points[0][0] < hi).map((t) => t.signal), ['La', 'Ea']);
});
