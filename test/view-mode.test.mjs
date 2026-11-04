// The workspace's presentation (src/ui/view-mode.js): Normal view, Datapath focus and Full screen as one state (a base
// mode and the browser's full screen), its transitions with a stand-in for the Fullscreen API (granted, refused,
// left by the browser, rapid requests), and the column of controls the compact layout needs (src/ui/dock.js).
// The layout itself is checked in a browser (tools/view-mode-smoke.mjs).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, presentation, isCompact, plan, exitTarget, ViewModes } from '../src/ui/view-mode.js';
import { effectiveDock } from '../src/ui/dock.js';

test('three modes; full screen is shown over either base mode, and both it and focus are compact', () => {
  assert.deepEqual([...MODES], ['normal', 'focus', 'fullscreen']);
  assert.equal(presentation({ base: 'normal', fullscreen: false }), 'normal');
  assert.equal(presentation({ base: 'focus', fullscreen: false }), 'focus');
  assert.equal(presentation({ base: 'normal', fullscreen: true }), 'fullscreen');
  assert.equal(presentation({ base: 'focus', fullscreen: true }), 'fullscreen');
  assert.equal(isCompact({ base: 'normal', fullscreen: false }), false);
  assert.equal(isCompact({ base: 'focus', fullscreen: false }), true);
  assert.equal(isCompact({ base: 'normal', fullscreen: true }), true);
});

test('a choice keeps the base mode for full screen and leaves full screen for Normal or Focus', () => {
  assert.deepEqual(plan('focus', { base: 'normal', fullscreen: false }), { base: 'focus', fs: null });
  assert.deepEqual(plan('normal', { base: 'focus', fullscreen: false }), { base: 'normal', fs: null });
  assert.deepEqual(plan('fullscreen', { base: 'normal', fullscreen: false }), { base: 'normal', fs: 'enter' });
  assert.deepEqual(plan('fullscreen', { base: 'focus', fullscreen: false }), { base: 'focus', fs: 'enter' });
  assert.deepEqual(plan('fullscreen', { base: 'focus', fullscreen: true }), { base: 'focus', fs: null });
  assert.deepEqual(plan('normal', { base: 'focus', fullscreen: true }), { base: 'normal', fs: 'exit' });
  assert.deepEqual(plan('focus', { base: 'normal', fullscreen: true }), { base: 'focus', fs: 'exit' });
  // Exit: out of full screen to the mode it came from; out of focus to Normal
  assert.equal(exitTarget({ base: 'focus', fullscreen: true }), 'focus');
  assert.equal(exitTarget({ base: 'normal', fullscreen: true }), 'normal');
  assert.equal(exitTarget({ base: 'focus', fullscreen: false }), 'normal');
});

test('the compact layout shows a column: a chosen Top at the left, Left and Right as chosen; a narrow screen the row', () => {
  assert.equal(effectiveDock('top', { compact: true }), 'left');
  assert.equal(effectiveDock('left', { compact: true }), 'left');
  assert.equal(effectiveDock('right', { compact: true }), 'right');
  assert.equal(effectiveDock('top', { compact: false }), 'top');
  for (const p of ['top', 'left', 'right']) assert.equal(effectiveDock(p, { compact: true, narrow: true }), 'top');
});

/** A stand-in for the Fullscreen API: grants or refuses; `leave()` is the browser leaving full screen (Esc). */
function fakeDoc({ allow = true, enabled = true } = {}) {
  const listeners = {};
  const doc = {
    fullscreenElement: null, fullscreenEnabled: enabled,
    addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
    fire: (t) => { for (const f of listeners[t] ?? []) f(); },
    async exitFullscreen() { await null; doc.fullscreenElement = null; doc.fire('fullscreenchange'); },
    leave() { doc.fullscreenElement = null; doc.fire('fullscreenchange'); },
  };
  const root = {
    async requestFullscreen() {
      await null;
      if (!allow) { doc.fire('fullscreenerror'); throw new TypeError('Permissions check failed'); }
      doc.fullscreenElement = root; doc.fire('fullscreenchange');
    },
  };
  return { doc, root };
}
function make(opts) {
  const { doc, root } = fakeDoc(opts);
  const seen = [];
  const errors = [];
  const vm = new ViewModes({ doc, root, onChange: (s) => seen.push(s.mode), onError: (e) => errors.push(e.message) });
  return { vm, doc, seen, errors };
}

test('transitions: Normal, Focus and Full screen in every order; leaving full screen returns to the mode before it', async () => {
  const { vm, seen } = make();
  assert.equal(vm.state.mode, 'normal');
  await vm.set('focus'); assert.equal(vm.state.mode, 'focus');
  await vm.set('normal'); assert.equal(vm.state.mode, 'normal');
  await vm.set('fullscreen'); assert.equal(vm.state.mode, 'fullscreen');
  await vm.exit(); assert.equal(vm.state.mode, 'normal'); // Normal -> Full screen -> Exit -> Normal
  await vm.set('focus');
  await vm.set('fullscreen'); assert.equal(vm.state.mode, 'fullscreen');
  await vm.exit(); assert.equal(vm.state.mode, 'focus'); // Focus -> Full screen -> Exit -> Focus
  await vm.set('fullscreen');
  await vm.set('focus'); assert.deepEqual([vm.state.mode, vm.fullscreen], ['focus', false]); // Full screen -> Focus
  await vm.set('fullscreen');
  await vm.set('normal'); assert.deepEqual([vm.state.mode, vm.fullscreen], ['normal', false]); // Full screen -> Normal
  assert.deepEqual(seen, ['focus', 'normal', 'fullscreen', 'normal', 'focus', 'fullscreen', 'focus', 'fullscreen', 'focus', 'fullscreen', 'normal']);
});

test('the browser leaving full screen (Esc, its own controls) returns the page to its base mode', async () => {
  const { vm, doc } = make();
  await vm.set('focus');
  await vm.set('fullscreen');
  doc.leave();
  assert.equal(vm.state.mode, 'focus');
  await vm.set('normal');
  await vm.set('fullscreen');
  doc.leave();
  assert.equal(vm.state.mode, 'normal');
});

test('a refused or unavailable full screen changes nothing and is reported', async () => {
  const { vm, seen, errors } = make({ allow: false });
  await vm.set('focus');
  await vm.set('fullscreen');
  assert.deepEqual([vm.state.mode, vm.fullscreen], ['focus', false]);
  assert.deepEqual(errors, ['Permissions check failed']);
  assert.deepEqual(seen, ['focus', 'focus']); // never shown as full screen; the refusal redraws Focus
  const u = make({ enabled: false });
  assert.equal(u.vm.supported, false);
  await u.vm.set('fullscreen');
  assert.equal(u.vm.state.mode, 'normal');
  assert.deepEqual(u.errors, ['unsupported']);
});

test('rapid requests are taken in order, one at a time; the last one holds', async () => {
  const { vm } = make();
  const all = ['focus', 'fullscreen', 'normal', 'fullscreen', 'focus', 'fullscreen', 'normal', 'focus'].map((m) => vm.set(m));
  await Promise.all(all);
  assert.deepEqual([vm.state.mode, vm.fullscreen], ['focus', false]);
  await Promise.all(['fullscreen', 'focus', 'fullscreen'].map((m) => vm.set(m)));
  assert.deepEqual([vm.state.mode, vm.base], ['fullscreen', 'focus']);
});

test('F toggles the focus, and leaves full screen', async () => {
  const { vm } = make();
  await vm.toggleFocus(); assert.equal(vm.state.mode, 'focus');
  await vm.toggleFocus(); assert.equal(vm.state.mode, 'normal');
  await vm.set('fullscreen');
  await vm.toggleFocus(); assert.deepEqual([vm.state.mode, vm.fullscreen], ['normal', false]);
});
