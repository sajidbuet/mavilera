// split.test.mjs -- the arithmetic of the resizable workspace (src/ui/split-math.js):
// dragging a divider within the panes' minimum sizes, restoring a divider's
// default, and reading saved layouts defensively (versioned keys, wrong
// structure, damaged text), plus the workspace's static rules: every
// divider and pane is styled, and the layout strings exist.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { normalise, dragPair, resetPair, readLayout, writeLayout, LAYOUT_PREFIX, LAYOUT_VERSION } from '../src/ui/split-math.js';
import { STRINGS } from '../src/ui/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

test('normalise: fractions sum to 1; unusable input gives equal shares', () => {
  assert.ok(close(normalise([2, 1, 1]), [0.5, 0.25, 0.25]));
  assert.ok(close(normalise([0, 1]), [0.5, 0.5]));
  assert.ok(close(normalise([NaN, 3, 1]), [1 / 3, 1 / 3, 1 / 3]));
});

test('dragPair: only the two neighbours change, their sum is kept, minimum sizes hold', () => {
  const px = [300, 500, 200];
  const mins = [220, 300, 230];
  assert.deepEqual(dragPair(px, 0, 50, mins), [350, 450, 200]);
  assert.deepEqual(dragPair(px, 0, -500, mins), [220, 580, 200]); // the left pane stops at its minimum
  assert.deepEqual(dragPair(px, 0, 500, mins), [500, 300, 200]); // the right pane stops at its minimum
  assert.deepEqual(dragPair(px, 1, -100, mins), [300, 400, 300]);
  const r = dragPair([100, 100], 0, 80, [150, 150]); // too small for both minimums: neither collapses to zero
  assert.equal(r[0] + r[1], 200);
  assert.ok(r[0] >= 100 && r[1] >= 100);
});

test('resetPair: a double click restores the default proportion within the share the pair has now', () => {
  const r = resetPair([0.5, 0.2, 0.3], [0.3, 0.45, 0.25], 0);
  assert.ok(Math.abs(r[0] + r[1] - 0.7) < 1e-12);
  assert.ok(Math.abs(r[0] / r[1] - 0.3 / 0.45) < 1e-12);
  assert.equal(r[2], 0.3);
});

test('readLayout: versioned, checked against the structure, robust to damage', () => {
  const ok = writeLayout([0.25, 0.75], [false, true]);
  assert.deepEqual(readLayout(ok, 2), { sizes: [0.25, 0.75], collapsed: [false, true] });
  assert.equal(readLayout(ok, 3), null, 'another pane structure');
  assert.equal(readLayout(JSON.stringify({ v: LAYOUT_VERSION + 1, sizes: [0.5, 0.5] }), 2), null, 'another version');
  assert.equal(readLayout('{not json', 2), null);
  assert.equal(readLayout(null, 2), null);
  assert.equal(readLayout(JSON.stringify({ v: LAYOUT_VERSION, sizes: [0.5, -1] }), 2), null);
  // every pane folded is not allowed: the first opens again
  assert.deepEqual(readLayout(writeLayout([0.5, 0.5], [true, true]), 2).collapsed, [false, true]);
  // sizes are normalised; a missing folded list means none folded
  assert.deepEqual(readLayout(JSON.stringify({ v: LAYOUT_VERSION, sizes: [1, 3] }), 2), { sizes: [0.25, 0.75], collapsed: [false, false] });
  assert.ok(LAYOUT_PREFIX.startsWith('pips.layout.v'));
});

test('the workspace stylesheet styles dividers, folded panes and both themes; the layout strings exist', () => {
  const css = readFileSync(join(ROOT, 'src', 'ui', 'theme.css'), 'utf8');
  for (const sel of ['.split-row > .split-divider', '.split-column > .split-divider', '.pane.collapsed', '.split-divider:focus-visible',
    ':root[data-theme="dark"]', '@media (prefers-reduced-motion: reduce)', '@media (hover: none)']) {
    assert.ok(css.includes(sel), `theme.css lacks ${sel}`);
  }
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/, 'no external fonts or stylesheets');
  for (const sel of ['.divider-fold', '.fold-v', '.fold-h', '.pane.pane-away']) assert.ok(css.includes(sel), `theme.css lacks ${sel} (D6)`);
  assert.equal(typeof STRINGS.layout.panes.right, 'string');
  for (const k of ['divider', 'reset', 'view', 'show']) assert.equal(typeof STRINGS.layout[k], 'string');
  assert.equal(typeof STRINGS.layout.collapse('x'), 'string');
});
