// sample-tabs.test.mjs -- the language tabs of the Sample projects list (the author, 2026-11-15; src/ui/sample-tabs.js): which
// family a sample belongs to, which tabs a module's list needs (none for one language), their order (C, Assembly, then
// MicroPython and any other), and the modules that get tabs today.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { langTabOf, langTabsOf, LANG_TAB_ORDER } from '../src/ui/sample-tabs.js';
import { STRINGS } from '../src/ui/strings.js';

const C_IDS = ['c', 'sdk-c'];
const read = (p) => JSON.parse(readFileSync(new URL(`../content/${p}/index.json`, import.meta.url), 'utf8'));

test('families: no language and asm are Assembly; every C compiler is C; another language is its own', () => {
  assert.equal(langTabOf({}, C_IDS), 'asm');
  assert.equal(langTabOf({ lang: 'asm' }, C_IDS), 'asm');
  assert.equal(langTabOf({ lang: 'c' }, C_IDS), 'c');
  assert.equal(langTabOf({ lang: 'sdk-c' }, C_IDS), 'c');
  assert.equal(langTabOf({ lang: 'micropython' }, C_IDS), 'micropython');
});

test('tabs: none for one family; C, Assembly, MicroPython in that order; others after them', () => {
  assert.deepEqual(langTabsOf([{ lang: 'asm' }, {}], C_IDS), []);
  assert.deepEqual(langTabsOf([{ lang: 'asm' }, { lang: 'c' }], C_IDS), ['c', 'asm']);
  assert.deepEqual(langTabsOf([{ lang: 'micropython' }, { lang: 'asm' }, { lang: 'sdk-c' }], C_IDS), ['c', 'asm', 'micropython']);
  assert.deepEqual(langTabsOf([{ lang: 'rust' }, { lang: 'asm' }], C_IDS), ['asm', 'rust']);
  for (const k of LANG_TAB_ORDER) assert.equal(typeof STRINGS.templates.tabs[k], 'string', `label for ${k}`);
});

test('today: RISC-V and the Pico 2 get C and Assembly tabs; the assembly-only modules get none', () => {
  assert.deepEqual(langTabsOf(read('templates').templates, C_IDS), ['c', 'asm']);
  const pico = read('pico2/templates').templates;
  assert.deepEqual(langTabsOf(pico.filter((t) => t.lang !== 'sdk-c'), C_IDS), ['c', 'asm'], 'Lite');
  assert.deepEqual(langTabsOf(pico.filter((t) => t.lang !== 'c'), C_IDS), ['c', 'asm'], 'Full');
  for (const m of ['armv7', 'i8086', 'sap-1', 'sap-2', 'gpu']) assert.deepEqual(langTabsOf(read(`${m}/templates`).templates, C_IDS), [], m);
});
