// wire-colours.test.mjs -- colours of highlighted connections that run close
// together (src/ui/wire-colours.js): what counts as close, one colour per
// net, the book's colour where it is free, and on the Chapter 8 drawing no
// two close nets of different signals share a colour.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { runClose, colourWires, WIRE_COLOURS } from '../src/ui/wire-colours.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const wire = (id, signal, points) => ({ id, signal, points });

test('runClose: parallel within the gap over a long enough stretch; crossings and far lines are not close', () => {
  const a = [[0, 0], [4, 0]];
  assert.equal(runClose(a, [[1, 0.2], [3, 0.2]]), true);
  assert.equal(runClose(a, [[1, 0.9], [3, 0.9]]), false, 'farther than the gap');
  assert.equal(runClose(a, [[3.9, 0.1], [6, 0.1]]), false, 'overlap too short');
  assert.equal(runClose(a, [[2, -1], [2, 1]]), false, 'a crossing');
  assert.equal(runClose([[0, 0], [0, 3]], [[0.25, 1], [0.25, 2.5]]), true, 'vertical neighbours');
});

test('colourWires: a lone wire keeps colour 0; neighbours differ; one net shares a colour', () => {
  const c = colourWires([
    wire('a', 's1', [[0, 0], [4, 0]]),
    wire('b', 's2', [[0, 0.2], [4, 0.2]]),
    wire('b2', 's2', [[5, 5], [5, 9]]), // another piece of net s2
    wire('c', 's3', [[0, 0.4], [4, 0.4]]), // close to b, and (0.4 cm) to a
    wire('lone', 's4', [[10, 10], [14, 10]]),
  ]);
  assert.equal(c.get('lone'), 0);
  assert.notEqual(c.get('a'), c.get('b'));
  assert.notEqual(c.get('b'), c.get('c'));
  assert.equal(c.get('b'), c.get('b2'));
  for (const v of c.values()) assert.ok(v >= 0 && v < WIRE_COLOURS);
});

test('colourWires on the Chapter 8 drawing: close nets of different signals never share a colour', () => {
  const g = JSON.parse(readFileSync(join(ROOT, 'content', 'geometry', 'ch08.json'), 'utf8'));
  const wires = g.wires.filter((w) => w.style !== 'ctrl');
  const c = colourWires(wires);
  let pairs = 0;
  for (let i = 0; i < wires.length; i++) {
    for (let j = i + 1; j < wires.length; j++) {
      if (wires[i].signal === wires[j].signal || !runClose(wires[i].points, wires[j].points)) continue;
      pairs++;
      assert.notEqual(c.get(wires[i].id), c.get(wires[j].id), `${wires[i].id} and ${wires[j].id}`);
    }
  }
  assert.ok(pairs > 0, 'the drawing has close connections');
});
