// strings-merge.test.mjs -- the shell's strings and an architecture's (W-D29, docs/architecture/arch-contract.md
// phase 4): the architecture's are merged over the shell's, group by group, and the result is frozen.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, mergeStrings } from '../src/ui/strings.js';
import { RISCV_STRINGS } from '../src/arch/riscv/strings.js';
import { descriptor } from '../src/arch/riscv/index.js';

test('the RISC-V descriptor gives its strings; a key both have is a group in both or in neither', () => {
  assert.equal(descriptor.strings, RISCV_STRINGS);
  for (const [k, v] of Object.entries(RISCV_STRINGS)) {
    if (!(k in STRINGS)) continue;
    const group = (x) => x !== null && typeof x === 'object';
    assert.equal(group(STRINGS[k]), group(v), k);
  }
});

test('mergeStrings joins groups key by key, the architecture winning, and freezes the result', () => {
  const shellView = STRINGS.view;
  mergeStrings({ view: { panel: 'Bus', extra: 'x' }, onlyArch: { a: 1 } });
  assert.equal(STRINGS.view.panel, 'Bus');
  assert.equal(STRINGS.view.extra, 'x');
  assert.equal(STRINGS.view.cycles, shellView.cycles, 'the shell keys of a joined group stay');
  assert.deepEqual(STRINGS.onlyArch, { a: 1 });
  assert.ok(Object.isFrozen(STRINGS) && Object.isFrozen(STRINGS.view));
  assert.throws(() => { 'use strict'; STRINGS.appName = 'x'; }, TypeError);
});

test('every architecture of the registry: a key it shares with the shell has the shell type (group, text or function)', async () => {
  const { ARCHITECTURES } = await import('../src/arch/registry.js');
  const kind = (v) => (v && typeof v === 'object' ? 'group' : typeof v);
  for (const [id, load] of Object.entries(ARCHITECTURES)) {
    const { strings } = (await load()).descriptor;
    for (const [k, v] of Object.entries(strings)) if (k in STRINGS) assert.equal(kind(v), kind(STRINGS[k]), `${id}: ${k}`);
  }
});
