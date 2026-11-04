// The place of the execution controls (src/ui/dock.js): the saved choice read safely, the narrow screen's row, and
// where a menu opened from the docked column stands. The layout itself is checked in a browser (tools/dock-smoke.mjs).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOCKS, DEFAULT_DOCK, DOCK_KEY, parseDock, effectiveDock, flyoutPlace } from '../src/ui/dock.js';

test('the places: top (the default), left and right; anything else read from storage is the default', () => {
  assert.deepEqual([...DOCKS], ['top', 'left', 'right']);
  assert.equal(DEFAULT_DOCK, 'top');
  for (const p of DOCKS) assert.equal(parseDock(p), p);
  for (const bad of [null, undefined, '', 'Left', 'bottom', 'left ', '1', '{}']) assert.equal(parseDock(bad), 'top');
});

test('a narrow screen shows the row on top whatever was chosen; a wide one shows the choice', () => {
  for (const p of DOCKS) {
    assert.equal(effectiveDock(p, { narrow: true }), 'top');
    assert.equal(effectiveDock(p, { narrow: false }), p);
  }
  assert.equal(effectiveDock('nonsense', { narrow: false }), 'top');
  assert.equal(effectiveDock('left'), 'left');
});

test('the choice is one for every architecture (a shared storage key)', () => {
  assert.equal(DOCK_KEY, 'pips.toolbarDock');
  const dom = readFileSync(new URL('../src/ui/dom.js', import.meta.url), 'utf8');
  assert.match(dom, /SHARED_KEYS = new Set\(\[[^\]]*'pips\.toolbarDock'/);
});

test('a menu of the column opens toward the drawing, level with its button, inside the window', () => {
  const view = { w: 1366, h: 768 };
  const menu = { w: 200, h: 120 };
  // left dock: to the right of the button
  const l = flyoutPlace({ left: 7, right: 47, top: 300 }, menu, view, 'left');
  assert.deepEqual(l, { left: 53, top: 300, maxHeight: 756 });
  // right dock: to the left of the button
  const r = flyoutPlace({ left: 1319, right: 1359, top: 300 }, menu, view, 'right');
  assert.deepEqual(r, { left: 1113, top: 300, maxHeight: 756 });
  // near the bottom: moved up to stay in the window
  const low = flyoutPlace({ left: 7, right: 47, top: 740 }, menu, view, 'left');
  assert.equal(low.top, 768 - 6 - 120);
  // taller than the window: from the top, and no taller than the window
  const tall = flyoutPlace({ left: 7, right: 47, top: 400 }, { w: 200, h: 2000 }, view, 'left');
  assert.equal(tall.top, 6);
  assert.equal(tall.maxHeight, 756);
  // too wide for the room beside the column: moved back into the window
  assert.equal(flyoutPlace({ left: 7, right: 47, top: 10 }, { w: 300, h: 50 }, { w: 320, h: 600 }, 'left').left, 14);
  // wider than the window: from its left edge
  assert.equal(flyoutPlace({ left: 7, right: 47, top: 10 }, { w: 400, h: 50 }, { w: 300, h: 600 }, 'left').left, 6);
});
