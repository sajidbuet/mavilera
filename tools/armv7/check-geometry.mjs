// check-geometry.mjs -- prints the schematic checks of the ARM drawings (junctions, wires without a width, unplaced
// width markers, text collisions), for work on tools/armv7/make-*-geometry.mjs. The same checks run in
// test/armv7-*-drawing.test.mjs. Development only.
//   node tools/armv7/check-geometry.mjs [file.json ...]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync } from 'node:fs';
import { checkJunctions, wireWidth, placeMarkers, collisions } from '../../src/ui/schematic.js';
import { SIGNAL_INFO, SIGNAL_INFO_EXT, MULTI_INFO, MULTI_EXT_INFO, PIPE_INFO, PIPE_EXT_INFO } from '../../src/arch/armv7/uarch/signals.js';

const only = process.argv.slice(2);
for (const [name, info] of [['single.json', SIGNAL_INFO], ['single-extended.json', SIGNAL_INFO_EXT], ['multi.json', MULTI_INFO],
  ['multi-extended.json', MULTI_EXT_INFO], ['pipe.json', PIPE_INFO], ['pipe-extended.json', PIPE_EXT_INFO]]) {
  if (only.length && !only.includes(name)) continue;
  const g = JSON.parse(readFileSync(new URL(`../../content/armv7/geometry/${name}`, import.meta.url), 'utf8'));
  console.log(`== ${name}`);
  console.log('junctions', JSON.stringify(checkJunctions(g.wires, g.junctions, g.control)));
  console.log('no width', g.wires.filter((w) => wireWidth(w.signal, w.style, info) === null).map((w) => `${w.id}:${w.signal}`).join(' '));
  console.log('stubs without a signal', g.control.filter((c) => wireWidth(c.signal, 'ctrl', info) === null).map((c) => c.signal).join(' '));
  const r = placeMarkers(g, (w) => wireWidth(w.signal, w.style, info), { stubs: g.control, stubWidth: (c) => info[c.signal]?.width ?? null });
  console.log('unplaced', JSON.stringify(r.unplaced));
  console.log('collisions', JSON.stringify(collisions(g)));
}
