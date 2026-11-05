// The in-app help of the GPU module (GPU-4; content/gpu/help/help.json): known block kinds, a first page with the
// logo, references linked over https and a notice; the views it describes are the module's; it names no book,
// chapter, figure or exercise (W-D16) and no product's GPU as the core's model.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/gpu/index.js';
import { RVSIMT_STRINGS } from '../src/arch/gpu/rvsimt/strings.js';

const help = JSON.parse(readFileSync(new URL('../content/gpu/help/help.json', import.meta.url), 'utf8'));
const KINDS = ['p', 'ul', 'ol', 'dl', 'brand', 'refs', 'notice'];

test('the GPU help: sections of known block kinds, the first page with the logo, references and notice', () => {
  assert.equal(descriptor.content.help, 'content/gpu/help/help.json');
  const ids = help.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of help.sections) {
    assert.ok(s.title && s.blocks.length, s.id);
    for (const b of s.blocks) assert.equal(Object.keys(b).filter((k) => KINDS.includes(k)).length, 1, s.id);
  }
  const first = help.sections[0].blocks;
  assert.ok(first[0].brand && first.some((b) => b.refs) && first.some((b) => b.notice));
  for (const [t, url] of first.filter((b) => b.refs).flatMap((b) => b.refs)) assert.ok(t && (url === null || /^https:\/\//.test(url)), t);
});

test('the GPU help describes the module\'s views and the Models tabs by their names', () => {
  const views = help.sections.find((s) => s.id === 'views').blocks[0].dl.map(([k]) => k);
  for (const v of descriptor.views) assert.ok(views.includes(v.label), v.label);
  const models = help.sections.find((s) => s.id === 'models').blocks[0].dl.map(([k]) => k);
  assert.deepEqual(models, Object.values(RVSIMT_STRINGS.models.tabs));
});

test('W-D16: the GPU help names no book, chapter, figure or exercise number', () => {
  const text = JSON.stringify(help.sections);
  assert.doesNotMatch(text, /chapter|textbook|\bbook\b|figure \d|FIG-\d|PRB-\d|exercise \d|worked example|nvidia/i);
});
