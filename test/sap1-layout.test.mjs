// SAP-1 architecture drawing (src/arch/sap-1/ui/layout.js): the topology against Malvino and Brown's Fig. 10-1 and
// Figs. 10-12 to 10-15 -- every control signal of CON one wire from the controller-sequencer to its unit, never to or
// across the W bus, no two control wires crossing; the clock, clear and halt lines with their polarity and edges; the
// data paths with their widths and directions; ports, units and labels without overlap.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNALS, CLOCK_LINES } from '../src/arch/sap-1/bus-model.js';
import { VIEW, BUS, UNITS, PORTS, CELLS, CTRL_PINS, WIRES, STUBS, LINKS, DOTS, symbolBox, portOf } from '../src/arch/sap-1/ui/layout.js';
import { SAP1_STRINGS as S } from '../src/arch/sap-1/strings.js';

const segs = (w) => w.points.slice(1).map((p, i) => [w.points[i], p]);
const orthogonal = ([a, b]) => a[0] === b[0] || a[1] === b[1];
const span = (a, b) => [Math.min(a, b), Math.max(a, b)];
/** Whether two axis-parallel segments share a point. */
function meets([a, b], [c, d]) {
  const [x1, x2] = span(a[0], b[0]); const [y1, y2] = span(a[1], b[1]);
  const [x3, x4] = span(c[0], d[0]); const [y3, y4] = span(c[1], d[1]);
  return x1 <= x4 && x3 <= x2 && y1 <= y4 && y3 <= y2;
}
/** Whether a segment enters a rectangle (touching its edge from outside is allowed: that is a port). */
function enters([a, b], r) {
  const [x1, x2] = span(a[0], b[0]); const [y1, y2] = span(a[1], b[1]);
  return x1 < r.x + r.w && x2 > r.x && y1 < r.y + r.h && y2 > r.y;
}
const onEdge = ([x, y], r) => (x >= r.x && x <= r.x + r.w && (y === r.y || y === r.y + r.h)) || (y >= r.y && y <= r.y + r.h && (x === r.x || x === r.x + r.w));
const BUS_RECT = { x: BUS.x, y: BUS.y, w: BUS.w, h: BUS.h };
const control = WIRES.filter((w) => w.kind === 'control');
const clock = WIRES.filter((w) => w.kind === 'clock');
const data = WIRES.filter((w) => w.kind === 'data' || w.kind === 'link');

test('the control word: twelve signals in textbook order, polarity and destination', () => {
  assert.deepEqual(SIGNALS.map((s) => s.name), ['Cp', 'Ep', 'Lm', 'CE', 'Li', 'Ei', 'La', 'Ea', 'Su', 'Eu', 'Lb', 'Lo']);
  assert.deepEqual(SIGNALS.filter((s) => s.low).map((s) => s.name), ['Lm', 'CE', 'Li', 'Ei', 'La', 'Lb', 'Lo']);
  assert.deepEqual(Object.fromEntries(SIGNALS.map((s) => [s.name, s.unit])), {
    Cp: 'PC', Ep: 'PC', Lm: 'MAR', CE: 'RAM', Li: 'IR', Ei: 'IR', La: 'A', Ea: 'A', Su: 'ALU', Eu: 'ALU', Lb: 'B', Lo: 'OUT' });
  // the displayed symbols: letter and subscript as the textbook writes them
  assert.deepEqual(SIGNALS.map((s) => S.bus.symbols[s.name].join('_')), ['C_P', 'E_P', 'L_M', 'CE_', 'L_I', 'E_I', 'L_A', 'E_A', 'S_U', 'E_U', 'L_B', 'L_O']);
});

test('every control signal is one wire from its cell in the controller to its port, and nothing else is', () => {
  assert.equal(control.length, 12);
  for (const s of SIGNALS) {
    const ws = control.filter((w) => w.signal === s.name);
    assert.equal(ws.length, 1, s.name);
    const [w] = ws;
    const c = CELLS[s.name];
    const p = portOf(s.unit, s.name);
    assert.ok(p, `${s.unit} has a port ${s.name}`);
    assert.equal(p.kind, 'control');
    assert.deepEqual(w.points[0], [c.cx, c.side === 'top' ? c.y : c.y + c.h], `${s.name} leaves its cell`);
    assert.deepEqual(w.points.at(-1), [p.x, p.y], `${s.name} ends at its port`);
    assert.ok(onEdge(w.points[0], UNITS.CTRL) && onEdge(w.points.at(-1), UNITS[s.unit]));
    assert.ok(segs(w).every(orthogonal), `${s.name} is orthogonal`);
  }
  // no other unit has a port named after a control signal, and the display has none
  for (const p of PORTS.filter((x) => x.kind === 'control')) assert.equal(SIGNALS.find((s) => s.name === p.name).unit, p.unit);
  assert.ok(!PORTS.some((p) => p.unit === 'DISP'));
});

test('no control or clock wire touches the W bus, a data path or a unit it does not end at', () => {
  for (const w of [...control, ...clock]) {
    for (const sg of segs(w)) {
      assert.ok(!meets(sg, [[BUS.x, BUS.y], [BUS.x + BUS.w, BUS.y + BUS.h]]) && !enters(sg, BUS_RECT), `${w.id} meets the bus`);
      for (const d of data) for (const ds of segs(d)) assert.ok(!meets(sg, ds), `${w.id} meets ${d.id}`);
      for (const u of Object.values(UNITS)) assert.ok(!enters(sg, u), `${w.id} enters ${u.id}`);
    }
  }
});

test('the control wires do not cross one another; clock lines cross only control wires', () => {
  for (const [i, a] of control.entries()) {
    for (const b of control.slice(i + 1)) {
      for (const sa of segs(a)) for (const sb of segs(b)) assert.ok(!meets(sa, sb), `${a.signal} crosses ${b.signal}`);
    }
  }
  // clock lines of different names never meet; a line meets itself only at its taps
  for (const [i, a] of clock.entries()) {
    for (const b of clock.slice(i + 1)) {
      if (a.signal === b.signal) continue;
      for (const sa of segs(a)) for (const sb of segs(b)) assert.ok(!meets(sa, sb), `${a.id} meets ${b.id}`);
    }
  }
  for (const d of DOTS) assert.ok(clock.some((w) => !w.tap && segs(w).some((sg) => meets(sg, [d, d]))), `tap ${d} is on a track`);
});

test('clock, clear and halt: polarity, edges and destinations as in Figs. 10-1 and 10-14', () => {
  const line = Object.fromEntries(CLOCK_LINES.map((l) => [l.name, l]));
  assert.deepEqual(line.CLK.to, ['MAR', 'IR', 'A', 'B', 'OUT', 'CTRL']);
  assert.deepEqual(line.nCLK.to, ['PC']);
  assert.deepEqual(line.nCLR.to, ['PC', 'CTRL']);
  assert.deepEqual(line.CLR.to, ['IR']);
  assert.deepEqual([line.nHLT.from, line.nHLT.to], ['CTRL', ['CLKG']]);
  // the ports: registers load at the positive edge of CLK; the program counter counts at the negative edge of CLK bar
  for (const id of ['MAR', 'IR', 'A', 'B', 'OUT']) assert.equal(portOf(id, 'CLK').edge, 'pos', id);
  assert.equal(portOf('PC', 'nCLK').edge, 'neg');
  assert.equal(portOf('PC', 'CLK'), undefined);
  assert.equal(CTRL_PINS.CLK.edge, 'neg'); // the ring counter advances at the negative edge
  // every destination of every line is reached by a wire of that line, and the clock is never in CON
  for (const l of CLOCK_LINES) {
    for (const to of l.to) assert.ok(clock.some((w) => w.signal === l.name && w.to.unit === to && w.from.unit === l.from), `${l.name} to ${to}`);
    assert.ok(!SIGNALS.some((s) => s.name === l.name));
  }
  for (const p of PORTS.filter((x) => x.kind === 'clock')) {
    const w = clock.find((x) => x.signal === p.name && x.to.unit === p.unit);
    assert.deepEqual(w?.points.at(-1), [p.x, p.y], `${p.name} reaches ${p.unit}`);
  }
});

test('data paths: widths and directions; B and OUT never drive the bus, the display only reads OUT', () => {
  const stub = Object.fromEntries(STUBS.map((d) => [`${d.unit}.${d.dir}`, d.width]));
  assert.deepEqual(stub, { 'IR.in': 8, 'IR.out': 4, 'RAM.out': 8, 'MAR.in': 4, 'PC.out': 4, 'OUT.in': 8, 'B.in': 8, 'ALU.out': 8, 'A.in': 8, 'A.out': 8 });
  const link = Object.fromEntries(LINKS.map((l) => [`${l.from}>${l.to}`, l.width]));
  assert.deepEqual(link, { 'MAR>RAM': 4, 'IR>CTRL': 4, 'A>ALU': 8, 'B>ALU': 8, 'OUT>DISP': 8 });
  for (const d of STUBS) {
    const [a, b] = d.points;
    const u = UNITS[d.unit];
    const [unitEnd, busEnd] = d.dir === 'in' ? [b, a] : [a, b];
    assert.ok(onEdge(unitEnd, u), `${d.unit}.${d.dir} at its unit`);
    assert.ok(busEnd[1] === BUS.y || busEnd[1] === BUS.y + BUS.h, `${d.unit}.${d.dir} at the bus`);
    assert.ok(busEnd[0] > BUS.x && busEnd[0] < BUS.x + BUS.w);
  }
  for (const l of LINKS) {
    assert.ok(onEdge(l.points[0], UNITS[l.from]) && onEdge(l.points[1], UNITS[l.to]), `${l.from} to ${l.to}`);
    for (const u of Object.values(UNITS)) assert.ok(!enters(segs({ points: l.points })[0], u), `${l.from}>${l.to} enters ${u.id}`);
  }
});

test('units, ports and port labels do not overlap; everything is inside the drawing', () => {
  const units = Object.values(UNITS);
  for (const [i, a] of units.entries()) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= VIEW.w && a.y + a.h <= VIEW.h, a.id);
    for (const b of units.slice(i + 1)) assert.ok(!enters([[a.x, a.y], [a.x + a.w, a.y + a.h]], b), `${a.id} overlaps ${b.id}`);
    assert.ok(!enters([[a.x, a.y], [a.x + a.w, a.y + a.h]], BUS_RECT), `${a.id} overlaps the bus`);
  }
  // each port's label (9.5 px symbol) inside its unit and clear of its neighbours
  for (const p of PORTS) {
    const [m, sub] = S.bus.symbols[p.name];
    const { w } = symbolBox(m, sub, 9.5);
    const u = UNITS[p.unit];
    assert.ok(p.x - w / 2 > u.x && p.x + w / 2 < u.x + u.w, `${p.unit}.${p.name} label inside`);
    for (const q of PORTS.filter((x) => x.unit === p.unit && x.x > p.x)) {
      const wq = symbolBox(...S.bus.symbols[q.name], 9.5).w;
      assert.ok(p.x + w / 2 + 2 < q.x - wq / 2, `${p.name} and ${q.name} labels apart`);
    }
  }
  // the control-word cells hold their symbols (10 px)
  for (const s of SIGNALS) assert.ok(symbolBox(...S.bus.symbols[s.name], 10).w < CELLS[s.name].w - 2, s.name);
  for (const w of WIRES) for (const [x, y] of w.points) assert.ok(x >= 0 && x <= VIEW.w && y >= 0 && y <= VIEW.h, w.id);
});
