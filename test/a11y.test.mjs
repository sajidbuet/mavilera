// a11y.test.mjs -- accessibility rules that hold without a browser (WS-U-030
// to WS-U-034); the browser checks are in tools/browser-smoke.mjs (WS-V-031).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS } from '../src/ui/strings.js';

const geometry = (p) => JSON.parse(readFileSync(new URL(`../content/geometry/${p}.json`, import.meta.url), 'utf8'));

test('every part drawn without text has an accessible name (WS-U-031)', () => {
  for (const p of ['ch06', 'ch07', 'ch08']) {
    const g = geometry(p);
    const parts = [...g.elements, ...Object.values(g.variants ?? {}).flatMap((v) => v.elements)];
    const missing = parts.filter((e) => e.id && !e.text && !STRINGS.elementNames[p]?.[e.id]).map((e) => e.id);
    assert.deepEqual(missing, [], p);
  }
});

test('projector mode enlarges type and the drawing\'s lines (WS-U-012)', () => {
  const css = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8');
  const root = /:root\[data-projector\] \{ font-size: (\d+)px; \}/.exec(css);
  assert.ok(root && Number(root[1]) > 16, 'root type larger than the browser default');
  for (const sel of ['.dp-shape', '.dp-wire .dp-line', '.dp-bus .dp-line', '.dp-active .dp-line']) {
    assert.ok(css.includes(`:root[data-projector] ${sel}`), sel);
  }
});
