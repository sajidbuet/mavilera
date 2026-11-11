// workspaces.test.mjs -- the model of the narrow screen's workspaces (src/ui/workspaces.js): which tabs an architecture's
// panes give, the tab keys, and that every workspace has its name. The behaviour in a browser is tools/mobile-smoke.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, availableWorkspaces, resolveWorkspace, tabKeyTarget } from '../src/ui/workspaces.js';
import { STRINGS } from '../src/ui/strings.js';

const ids = (ctx, panes) => availableWorkspaces(ctx, (p) => panes.includes(p)).map((w) => w.id);
// the pane ids main.js gives each layout (configureLayout)
const ISA = ['work', 'editor', 'mid', 'listing', 'inspector', 'right', 'registers', 'calls', 'counters', 'dock', 'memory'];
const DP = ['work', 'editor', 'mid', 'datapath', 'info', 'right', 'registers', 'counters', 'dock', 'memory'];
const CMP = ['work', 'editor', 'mid', 'compare', 'right', 'registers', 'calls', 'counters', 'dock', 'memory'];
const PROJECTS = ['explorer']; // a module with projects (pico2 P1-F1) adds the Files pane before the editor

test('the instruction view offers Code, Listing, CPU and Memory; no Datapath without a datapath pane', () => {
  assert.deepEqual(ids({ dp: false }, ISA), ['code', 'listing', 'cpu', 'memory']);
});

test('a datapath view adds Datapath, and its Listing is the details pane', () => {
  assert.deepEqual(ids({ dp: true }, DP), ['code', 'listing', 'datapath', 'cpu', 'memory']);
  assert.deepEqual(WORKSPACES.find((w) => w.id === 'listing').panes({ dp: true }), ['info']);
  assert.deepEqual(WORKSPACES.find((w) => w.id === 'listing').panes({ dp: false }), ['listing', 'inspector']);
});

test('the comparison view has Compare in place of Listing', () => {
  assert.deepEqual(ids({ dp: false }, CMP), ['code', 'compare', 'cpu', 'memory']);
});

test('an architecture with fewer panes gets fewer tabs: nothing is offered for a pane that does not exist', () => {
  assert.deepEqual(ids({ dp: false }, ['editor', 'memory']), ['code', 'memory']);
  assert.deepEqual(ids({ dp: false }, []), []);
});

test('resolveWorkspace keeps a workspace that is on offer and falls back to the first', () => {
  const list = availableWorkspaces({ dp: false }, (p) => ISA.includes(p));
  assert.equal(resolveWorkspace(list, 'cpu').id, 'cpu');
  assert.equal(resolveWorkspace(list, 'datapath').id, 'code'); // kept from a datapath view, not on offer here
  assert.equal(resolveWorkspace(list, null).id, 'code');
  assert.equal(resolveWorkspace([], 'cpu'), null);
});

test('tabKeyTarget: arrows wrap, Home and End jump, other keys are left alone', () => {
  assert.equal(tabKeyTarget('ArrowRight', 3, 4), 0);
  assert.equal(tabKeyTarget('ArrowRight', 0, 4), 1);
  assert.equal(tabKeyTarget('ArrowLeft', 0, 4), 3);
  assert.equal(tabKeyTarget('Home', 2, 4), 0);
  assert.equal(tabKeyTarget('End', 0, 4), 3);
  for (const k of ['Enter', ' ', 'ArrowDown', 'Tab', 'a']) assert.equal(tabKeyTarget(k, 1, 4), null);
});

test('every workspace has a name, an icon and a layout; the ids are unique', () => {
  assert.equal(new Set(WORKSPACES.map((w) => w.id)).size, WORKSPACES.length);
  for (const w of WORKSPACES) {
    assert.ok(STRINGS.ws.names[w.id], `${w.id}: no name in STRINGS.ws.names`);
    assert.ok(w.icon && ['fill', 'stack'].includes(w.layout), `${w.id}: icon or layout`);
    assert.ok(w.panes({ dp: false }).length + w.panes({ dp: true }).length > 0, `${w.id}: no panes`);
  }
});

test('every pane a workspace names is a pane main.js lays out', () => {
  const known = new Set([...ISA, ...DP, ...CMP, ...PROJECTS]);
  for (const w of WORKSPACES) for (const dp of [false, true]) for (const p of w.panes({ dp })) assert.ok(known.has(p), `${w.id}: unknown pane ${p}`);
});

test('the status and unread strings read well', () => {
  assert.equal(STRINGS.ws.status('0x0010', 'Paused'), 'PC 0x0010 · Paused');
  assert.equal(STRINGS.ws.status(null, 'No program'), 'No program');
  assert.equal(STRINGS.ws.unread(1, 0), '1 error in the console');
  assert.equal(STRINGS.ws.unread(2, 3), '2 errors, 3 warnings in the console');
});
