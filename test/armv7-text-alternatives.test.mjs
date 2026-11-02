// armv7-text-alternatives.test.mjs -- roadmap ARM-A6 "a text alternative for each drawing" (WS-U-031): every ARMv7
// drawing carries a description of its parts in words, the views hand it to the renderer as the drawing's description,
// and the state diagram and the per-cycle descriptions name the state or the instruction in each stage.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARMV7_STRINGS as S } from '../src/arch/armv7/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GEO = join(ROOT, 'content/armv7/geometry');

test('every ARMv7 drawing has a text alternative that names its main parts', () => {
  const files = readdirSync(GEO).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, ['multi-extended.json', 'multi.json', 'pipe-extended.json', 'pipe.json', 'single-extended.json', 'single.json']);
  for (const f of files) {
    const g = JSON.parse(readFileSync(join(GEO, f), 'utf8'));
    assert.equal(typeof g.alt, 'string', f);
    assert.ok(g.alt.length >= 600, `${f}: ${g.alt.length} characters`);
    for (const part of ['register file', 'ALU', 'memory']) assert.ok(g.alt.toLowerCase().includes(part.toLowerCase()), `${f} names ${part}`);
    if (f.startsWith('pipe')) assert.match(g.alt, /Hazard Unit/, f);
    if (f.includes('extended')) assert.match(g.alt, /shifter|Shift/i, f);
  }
});

test('each view passes the text alternative to the drawing, and describes the cycle', () => {
  for (const v of ['single', 'multi', 'pipe']) {
    const src = readFileSync(join(ROOT, `src/arch/armv7/ui/${v}-view.js`), 'utf8');
    assert.match(src, /description: g\.alt/, `${v}: the drawing's description`);
    assert.match(src, /\.setDescription\(/, `${v}: a description of each cycle`);
  }
  assert.match(S.multiView.fsmDesc('S2 MemAdr', 'S1 Decode'), /Current state: S2 MemAdr, entered from S1 Decode/);
  assert.match(S.multiView.ext.fsmDesc('S10 Link', 'S1 Decode'), /twelve states/);
});
