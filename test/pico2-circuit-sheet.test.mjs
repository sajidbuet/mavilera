// P1-B2 stage B2-3 (design docs/architecture/pico2-p1b2-user-circuits.md §2.8-§2.9): the schematic editor's geometry
// (ui/circuit-sheet.js: grid, pins turned and mirrored, wire paths, hit-testing, reading order) and its edits as pure functions
// (circuit/edit.js: place, turn, mirror, move, wires, junctions on wires, bends, labels, removal, copy and paste, the undo stack).
// Every edit gives a validated, canonical circuit; the nets follow the wires drawn.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, snap, turn, partPins, PIN_POS, padPoint, wirePath, orthogonal, hitTest, readingOrder, inRect, wireDrawings, PAD_POINTS } from '../src/arch/pico2/ui/circuit-sheet.js';
import { addPartAt, rotatePart, mirrorPart, moveRefs, addWire, splitWire, addBend, moveBend, removeBend, addLabel, renameLabel, removeRefs,
  copyRefs, pasteClip, addNode, PLACE } from '../src/arch/pico2/circuit/edit.js';
import { validateCircuit, emptyCircuit } from '../src/arch/pico2/circuit/format.js';
import { compile } from '../src/arch/pico2/circuit/netlist.js';
import { PART_TYPES } from '../src/arch/pico2/circuit/library.js';
import { UndoStack } from '../src/arch/pico2/ui/circuit-undo.js';
import { demoCircuit } from '../src/arch/pico2/circuit/netlist.js';
import { withDemo, missingDemo } from '../src/arch/pico2/circuit/demo.js';
import { setAttr } from '../src/arch/pico2/circuit/edit.js';

const canon = (c) => assert.deepEqual(validateCircuit(JSON.stringify(c)), c, 'a valid, canonical circuit');

test('the grid: 1.27 mm, coordinates kept to 0.1 unit; every library pin on the grid', () => {
  assert.equal(GRID, 12.7);
  assert.deepEqual([snap(0), snap(6.3), snap(6.4), snap(-6.4), snap(838)], [0, 0, 12.7, -12.7, 838.2]);
  assert.ok(Number.isInteger(Math.round(PLACE.x0 / GRID)) && Math.abs(snap(PLACE.x0) - PLACE.x0) < 1e-9 && Math.abs(snap(PLACE.y0) - PLACE.y0) < 1e-9, 'the list\'s places on the grid');
  for (const [t, pins] of Object.entries(PIN_POS)) {
    assert.deepEqual(Object.keys(pins).sort(), [...PART_TYPES[t].pins].sort(), t);
    for (const [dx, dy] of Object.values(pins)) assert.ok(Math.abs(snap(dx) - dx) < 1e-9 && Math.abs(snap(dy) - dy) < 1e-9, `${t} pin on the grid`);
  }
});

test('pins turned clockwise and mirrored as the SVG transform draws them', () => {
  assert.deepEqual(turn(10, 0, 90), [0, 10]);   // right → down
  assert.deepEqual(turn(10, 0, 180), [-10, 0]);
  assert.deepEqual(turn(10, 0, 270), [0, -10]);
  assert.deepEqual(turn(10, 3, 0, true), [-10, 3]);
  assert.deepEqual(turn(10, 3, 90, true), [-3, -10]); // mirrored first, then turned
  const r = { id: 'R1', type: 'resistor', x: 127, y: 254, rot: 90 };
  assert.deepEqual(partPins(r).map((p) => [p.pin, p.x, p.y, ...p.out]), [['1', 127, 190.5, 0, -1], ['2', 127, 317.5, 0, 1]]);
  const q = { id: 'Q1', type: 'npn', x: 0, y: 0, flip: true };
  assert.deepEqual(partPins(q).find((p) => p.pin === 'B').x, 63.5);
});

test('wire paths: horizontal and vertical segments, leaving a pin along it; rails at their nearest pad', () => {
  assert.deepEqual(orthogonal([[0, 0], [10, 20]]), [[0, 0], [10, 0], [10, 20]]);
  assert.deepEqual(orthogonal([[0, 0], [10, 20]], [0, 1]), [[0, 0], [0, 20], [10, 20]]);
  assert.deepEqual(orthogonal([[0, 0], [0, 0]]), [[0, 0], [0, 0]]);
  // GND has eight pads: the one nearest the wire's next point
  const low = padPoint('GND', { x: 0, y: 500 }), high = padPoint('GND', { x: 0, y: 0 });
  assert.ok(low.y > high.y);
  assert.ok(!PAD_POINTS.some((p) => p.name === 'RUN' || p.name === '3V3_EN'), 'RUN and 3V3_EN take no wire');
  assert.ok(PAD_POINTS.some((p) => p.name === '3V3'));
  let { circuit: c } = addPartAt(null, 'resistor', -254, 76.2);
  c = addWire(c, 'R1.1', 'GP15', [[-381, 76.2]]);
  const p = wirePath(c, c.wires[0]); // the canonical order puts GP15 first
  assert.deepEqual([p[0], p[p.length - 1]].sort(), [[-317.5, 76.2], [0, padPoint('GP15').y]].sort(), 'from R1 pin 1 to the left edge of GP15\'s pad');
  assert.ok(p.some(([x, y]) => x === -381 && y === 76.2), 'through its bend');
  assert.ok(p.every((q, i) => i === 0 || q[0] === p[i - 1][0] || q[1] === p[i - 1][1]), 'orthogonal');
  assert.equal(wireDrawings(c).length, 1);
});

test('hit-testing on the model: pins and pads first, then nodes, bends, labels, wires, part bodies', () => {
  let { circuit: c } = addPartAt(null, 'led', 127, 762);
  c = addWire(c, 'D1.K', 'GND', [[254, 762]]);
  ({ circuit: c } = addNode(c, 254, 889));
  ({ circuit: c } = addLabel(c, 'SIG', 'D1.A', 50.8, 750));
  assert.deepEqual(hitTest(c, 63.5, 762), { kind: 'pin', end: 'D1.A', x: 63.5, y: 762 });
  assert.equal(hitTest(c, padPoint('GP16').x - 1, padPoint('GP16').y + 2).end, 'GP16');
  assert.equal(hitTest(c, 1, padPoint('GP15').y + 2).end, 'GP15');
  assert.equal(hitTest(c, 254, 889).kind, 'node');
  assert.equal(hitTest(c, 254, 762).kind, 'bend');
  assert.equal(hitTest(c, 50.8, 750).kind, 'label');
  const w = hitTest(c, 230, 763);
  assert.equal(w.kind, 'wire'); assert.equal(w.y, 762);
  assert.equal(hitTest(c, 127, 770).kind, 'part');
  assert.equal(hitTest(c, 600, 600), null);
  assert.equal(hitTest(c, 63.5, 762, 6, { skip: 'D1.A' })?.end, undefined, 'the wire\'s own start is skipped');
  const order = readingOrder(c);
  assert.deepEqual([...order].sort(), ['label:0', 'node:J1', 'part:D1', 'wire:0']);
  assert.ok(order.indexOf('label:0') < order.indexOf('part:D1') && order.indexOf('part:D1') < order.indexOf('node:J1'), 'top to bottom');
  assert.deepEqual(inRect(c, 100, 700, 300, 900).sort(), ['node:J1', 'part:D1']);
});

test('the editor\'s edits: place, turn, mirror, move with its labels, wires and junctions; the nets follow', () => {
  let { circuit: c, id } = addPartAt(null, 'resistor', -254, 889, { rot: 0 });
  assert.equal(id, 'R1'); assert.equal(c.parts[0].rot, undefined, 'rot 0 left out');
  ({ circuit: c } = addPartAt(c, 'led', 0, 889));
  c = rotatePart(c, 'R1'); assert.equal(c.parts.find((p) => p.id === 'R1').rot, 90);
  c = rotatePart(rotatePart(rotatePart(c, 'R1'), 'R1'), 'R1'); assert.equal(c.parts.find((p) => p.id === 'R1').rot, undefined, 'four turns: back to 0');
  c = mirrorPart(c, 'D1'); assert.equal(c.parts.find((p) => p.id === 'D1').flip, true);
  c = mirrorPart(c, 'D1'); assert.equal(c.parts.find((p) => p.id === 'D1').flip, undefined);
  c = addWire(c, 'GP16', 'R1.1');
  assert.throws(() => addWire(c, 'R1.1', 'GP16'), /already wired/);
  assert.throws(() => addWire(c, 'R1.1', 'R1.1'));
  c = addWire(c, 'R1.2', 'D1.A', [[-127, 889]]);
  c = addWire(c, 'D1.K', 'GND');
  ({ circuit: c } = addLabel(c, 'MID', 'R1.2', -190.5, 875));
  canon(c);
  let k = compile(c);
  assert.equal(k.pins.get('R1.2').island, k.pins.get('D1.A').island);
  assert.ok((k.mask >>> 16) & 1);
  // move R1 with its label; a wire with both ends moved keeps its shape, the others are redrawn
  const m = moveRefs(c, ['part:R1'], 12.7, -25.4);
  assert.deepEqual([m.parts[1].x, m.parts[1].y], [-241.3, 863.6]);
  assert.deepEqual([m.labels[0].x, m.labels[0].y], [-177.8, 849.6]);
  assert.deepEqual(m.wires.find((w) => w.a === 'D1.A').via, [[-127, 889]], 'only one end moved: bends kept');
  // a wire ending on another makes a junction node; the net then holds the three
  const R1_2 = c.wires.findIndex((w) => w.a === 'D1.A');
  const path = wirePath(c, c.wires[R1_2]);
  let node;
  ({ circuit: c, id: node } = splitWire(c, R1_2, -127, 889, path));
  assert.equal(node, 'J1');
  assert.equal(c.wires.filter((w) => w.a === 'J1' || w.b === 'J1').length, 2);
  ({ circuit: c } = addPartAt(c, 'capacitor', -127, 1016, { rot: 90 }));
  c = addWire(c, 'C1.1', node);
  c = addWire(c, 'C1.2', 'GND');
  k = compile(c);
  assert.equal(k.pins.get('C1.1').island, k.pins.get('D1.A').island);
  assert.equal(k.pins.get('C1.1').node, k.pins.get('R1.2').node, 'C1 pin 1 on the same net as R1 pin 2');
  canon(c);
});

test('bends: add, move, remove; labels renamed; removal takes the wires and labels at removed parts and nodes', () => {
  let { circuit: c } = addPartAt(null, 'resistor', -254, 889);
  c = addWire(c, 'R1.1', 'GP16');
  assert.equal(wirePath(c, c.wires[0]), null, 'a pad wire without bends that cannot run straight is not drawn (the list\'s)');
  c = removeRefs(c, ['wire:0']);
  c = addWire(c, 'R1.1', 'GP16', [[-381, 889], [-381, 600]]);
  const wi = 0, p = wirePath(c, c.wires[wi]);
  const mid = [p[0][0] - 25.4, p[0][1]];
  c = addBend(c, wi, mid[0], mid[1], p);
  assert.ok(c.wires[0].via.some(([x, y]) => x === mid[0] && y === mid[1]));
  const bi = c.wires[0].via.findIndex(([x, y]) => x === mid[0] && y === mid[1]);
  c = moveBend(c, 0, bi, mid[0], mid[1] - 12.7);
  assert.deepEqual(c.wires[0].via[bi], [mid[0], mid[1] - 12.7]);
  const n = c.wires[0].via.length;
  c = removeBend(c, 0, bi);
  assert.equal((c.wires[0].via ?? []).length, n - 1);
  ({ circuit: c } = addLabel(c, 'A', 'R1.2', -170, 875));
  c = renameLabel(c, 0, 'GND');
  assert.equal(compile(c).pins.get('R1.2').rail, 'GND', 'a label GND is the rail');
  c = renameLabel(c, 0, '3V3');
  assert.equal(compile(c).pins.get('R1.2').rail, '3V3', 'a label 3V3 (the power symbol) is the rail');
  assert.throws(() => renameLabel(c, 0, '3V4'), /labels\[0\]\.net/);
  c = renameLabel(c, 0, 'GND');
  ({ circuit: c } = addNode(c, 0, 1000));
  c = addWire(c, 'J1', 'R1.2');
  c = removeRefs(c, ['node:J1']);
  assert.equal(c.nodes.length, 0); assert.equal(c.wires.length, 1);
  c = removeRefs(c, ['part:R1']);
  assert.deepEqual([c.parts.length, c.wires.length, c.labels.length], [0, 0, 0]);
  canon(c);
});

test('copy and paste within one circuit: new names, the wires between the copied parts and to the board\'s pads', () => {
  let { circuit: c } = addPartAt(null, 'resistor', -254, 889);
  ({ circuit: c } = addPartAt(c, 'led', 0, 889));
  c = addWire(c, 'GP16', 'R1.1'); c = addWire(c, 'R1.2', 'D1.A'); c = addWire(c, 'D1.K', 'GND');
  ({ circuit: c } = addLabel(c, 'X', 'R1.2', -190, 875));
  const clip = copyRefs(c, ['part:R1', 'part:D1']);
  assert.equal(clip.wires.length, 3); assert.equal(clip.labels.length, 1);
  const r = pasteClip(c, clip, 0, 190.5);
  assert.deepEqual(r.refs.sort(), ['part:D2', 'part:R2']);
  assert.equal(r.circuit.parts.length, 4); assert.equal(r.circuit.wires.length, 6);
  assert.ok(r.circuit.wires.some((w) => (w.a === 'D2.A' && w.b === 'R2.2') || (w.a === 'R2.2' && w.b === 'D2.A')));
  canon(r.circuit);
  // only R1: the wire to D1 is not copied, the one to GP16 is
  assert.deepEqual(copyRefs(c, ['part:R1']).wires.map((w) => [w.a, w.b]), [['GP16', 'R1.1']]);
});

test('the demo circuit (research D52): no file is the demo; version-1 files gain it; ground and power join their rails; restore', () => {
  const d = demoCircuit();
  canon(d);
  assert.deepEqual(d.parts.map((p) => p.id), ['BTN', 'GND1', 'GND2', 'KNOB', 'PWR1']);
  const k = compile(null);
  assert.equal(k.hash, compile(d).hash, 'no file = the demo circuit');
  assert.ok(k.controls.has('KNOB') && k.controls.get('KNOB').default === 0 && k.controls.has('BTN'));
  assert.equal(k.pins.get('BTN.1').rail, 'GND'); assert.equal(k.pins.get('KNOB.1').rail, '3V3'); assert.equal(k.pins.get('KNOB.2').rail, 'GND');
  assert.ok((k.mask >>> 26) & 1 && (k.mask >>> 15) & 1, 'GP15 and GP26 on islands');
  // every demo wire is drawn (the pad wires run straight out of their pads)
  assert.ok(d.wires.every((w) => wirePath(d, w)), 'the demo wires are drawn');
  // a version-1 file (B2-1, B2-2) is read with the demo parts added: the knob and button were the fixed circuit then
  const v1 = validateCircuit({ format: 'mavilera-pico2-circuit', version: 1, parts: [{ id: 'R1', type: 'resistor', x: 0, y: 0 }], wires: [{ a: 'GP16', b: 'R1.1' }] });
  assert.equal(v1.version, 2);
  assert.deepEqual(v1.parts.map((p) => p.id), ['BTN', 'GND1', 'GND2', 'KNOB', 'PWR1', 'R1']);
  // a power symbol on another rail; a short between two rails through symbols is refused
  let c = setAttr(v1, 'PWR1', 'rail', 'VSYS');
  assert.equal(compile(c).pins.get('KNOB.1').rail, 'VSYS');
  assert.throws(() => compile(addWire(c, 'PWR1.1', 'GND1.1')), /short/);
  // deleted, restored; a demo name taken meanwhile by the student's own symbol: the demo's gets a free name and its wire
  c = removeRefs(d, ['part:BTN', 'part:GND1']);
  assert.deepEqual(missingDemo(c), ['BTN', 'GND1']);
  ({ circuit: c } = addPartAt(c, 'ground', 0, 1000));
  assert.equal(c.parts.find((p) => p.x === 0 && p.y === 1000).id, 'GND1');
  const r = validateCircuit(withDemo(c));
  assert.ok(r.parts.some((p) => p.id === 'BTN') && r.parts.some((p) => p.id === 'GND3' && p.x === -393.7));
  assert.ok(r.wires.some((w) => (w.a === 'BTN.1' && w.b === 'GND3.1') || (w.a === 'GND3.1' && w.b === 'BTN.1')), 'BTN to the restored ground, not the student\'s');
  assert.equal(compile(r).pins.get('BTN.1').rail, 'GND');
});

test('the undo stack: whole-file states; undo and redo round trips give equal files; a new edit clears redo', () => {
  const u = new UndoStack(3);
  const t = (n) => JSON.stringify({ ...emptyCircuit(), parts: Array.from({ length: n }, (_, i) => ({ id: `R${i + 1}`, type: 'resistor', x: i * 12.7, y: 0 })) });
  u.reset(null);
  u.push(t(1)); u.push(t(2)); u.push(t(3));
  assert.equal(u.undo(), t(2)); assert.equal(u.undo(), t(1)); assert.equal(u.undo(), null); assert.equal(u.undo(), undefined, 'nothing more');
  assert.equal(u.redo(), t(1)); assert.equal(u.redo(), t(2)); assert.equal(u.redo(), t(3)); assert.equal(u.redo(), undefined);
  u.undo(); u.push(t(4));
  assert.equal(u.redo(), undefined, 'a new edit clears redo');
  const v = new UndoStack(2); v.reset('a'); v.push('b'); v.push('c'); v.push('d');
  assert.equal(v.undo(), 'c'); assert.equal(v.undo(), 'b'); assert.equal(v.undo(), undefined, 'at most `limit` steps back');
});
