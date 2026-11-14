// P1-B2 stage B2-1 (design docs/architecture/pico2-p1b2-user-circuits.md §2.8 "Text list"): the Circuit tab's edits as pure functions
// (circuit/edit.js) and the drawing's rules (ui/circuit-ui.js netLook, ledGlow): every edit gives a validated circuit; the pin of a
// part is in exactly the net chosen; removing a part removes its wires and labels; the engine runs the edited circuit.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPart, removePart, setAttr, connectPin, freeNet, pinTarget, PLACE } from '../src/arch/pico2/circuit/edit.js';
import { compile } from '../src/arch/pico2/circuit/netlist.js';
import { validateCircuit } from '../src/arch/pico2/circuit/format.js';
import { netLook, ledGlow, LED_FULL_MA } from '../src/arch/pico2/ui/circuit-ui.js';
import { PIN_POS } from '../src/arch/pico2/ui/circuit-sheet.js';
import { PART_TYPES } from '../src/arch/pico2/circuit/library.js';

test('the Circuit tab\'s edits: add, set, connect, own nets, remove', () => {
  let { circuit: c, id } = addPart(null, 'resistor');
  assert.equal(id, 'R1');
  assert.deepEqual([c.parts[0].x, c.parts[0].y], [PLACE.x0, PLACE.y0]);
  ({ circuit: c, id } = addPart(c, 'led'));
  assert.equal(id, 'D1');
  assert.notDeepEqual([c.parts[1].x, c.parts[1].y], [c.parts[0].x, c.parts[0].y], 'the next free place');
  c = setAttr(c, 'R1', 'value', '220');
  assert.throws(() => setAttr(c, 'R1', 'value', '0.1'));
  c = connectPin(c, 'R1.1', 'GP16');
  const n = freeNet(c);
  assert.equal(n, 'N1');
  c = connectPin(c, 'R1.2', n); c = connectPin(c, 'D1.A', n); c = connectPin(c, 'D1.K', 'GND');
  assert.deepEqual(['R1.1', 'R1.2', 'D1.A', 'D1.K'].map((p) => pinTarget(c, p)), ['GP16', 'N1', 'N1', 'GND']);
  const k = compile(c);
  assert.equal(k.pins.get('R1.2').name, 'N1');
  assert.equal(k.pins.get('R1.2').island, k.pins.get('D1.A').island);
  assert.equal(k.pins.get('D1.K').rail, 'GND');
  assert.ok((k.mask >>> 16) & 1, 'GP16 on an island');
  // reconnecting a pin moves it: it is in exactly the net chosen
  c = connectPin(c, 'R1.1', 'GP17');
  assert.equal(pinTarget(c, 'R1.1'), 'GP17');
  assert.ok(!((compile(c).mask >>> 16) & 1) && (compile(c).mask >>> 17) & 1);
  c = connectPin(c, 'R1.1', '');
  assert.equal(pinTarget(c, 'R1.1'), '');
  c = removePart(c, 'D1');
  assert.equal(c.parts.length, 1);
  assert.ok(c.labels.every((l) => !l.at.startsWith('D1.')) && c.wires.every((w) => !w.a.startsWith('D1.') && !w.b.startsWith('D1.')));
  assert.deepEqual(validateCircuit(JSON.stringify(c)), c, 'every edit gives a valid, canonical circuit');
  // every library type can be added and has drawing positions for all its pins
  let all = null;
  for (const t of Object.keys(PART_TYPES)) { ({ circuit: all } = addPart(all, t)); assert.deepEqual(Object.keys(PIN_POS[t]).sort(), [...PART_TYPES[t].pins].sort(), t); }
  assert.equal(all.parts.length, Object.keys(PART_TYPES).length);
});

test('the drawing\'s rules: a net\'s look from its voltage, an LED\'s glow from its mean current', () => {
  assert.deepEqual([netLook(3.3), netLook(2.0), netLook(1.99), netLook(0.81), netLook(0.8), netLook(0), netLook(1, true), netLook(NaN)],
    ['high', 'high', 'undef', 'undef', 'low', 'low', 'z', 'z']);
  assert.deepEqual([ledGlow(0), ledGlow(LED_FULL_MA / 2), ledGlow(LED_FULL_MA), ledGlow(20), ledGlow(undefined)], [0, 0.5, 1, 1, 0]);
});
