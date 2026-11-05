// The GPU Laboratory's documentation (GPU-5, decision G31: full documentation before publishing;
// content/gpu/help/docs/index.html) and the CPU + GPU section of the RISC-V documentation: every view, Models tab,
// template, exercise and profile it names exists; the register map equals the device's; the numbers it quotes equal
// the simulator's runs; every contents link has its section; it names no book (W-D16).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor, DEFAULT_SOURCE } from '../src/arch/gpu/index.js';
import { withVariant } from '../src/arch/contract.js';
import { RVSIMT_STRINGS } from '../src/arch/gpu/rvsimt/strings.js';
import { GPU_STRINGS } from '../src/arch/gpu/strings.js';
import { assemble } from '../src/arch/gpu/rvsimt/language.js';
import { runCore } from '../src/arch/gpu/rvsimt/engine.js';
import { GPU_REG } from '../src/mem/gpu.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const DOC = read('content/gpu/help/docs/index.html');
const RVDOC = read('content/help/docs/index.html');
const text = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const BODY = text(DOC);

test('the documentation is the module\'s docs content; every contents link has its section', () => {
  assert.equal(descriptor.content.docs, 'content/gpu/help/docs/index.html');
  for (const doc of [DOC, RVDOC]) {
    const ids = new Set([...doc.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    for (const [, id] of doc.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), `#${id}`);
  }
});

test('it names the views, Models tabs, profiles, templates and exercises as the interface does', async () => {
  const micro = await withVariant(descriptor, 'microisa');
  for (const v of [...descriptor.views, ...micro.views]) assert.ok(BODY.includes(v.label), v.label);
  for (const t of Object.values(RVSIMT_STRINGS.models.tabs)) assert.ok(BODY.includes(t), t);
  for (const p of [...Object.values(RVSIMT_STRINGS.profileNames), ...Object.values(GPU_STRINGS.profileNames)]) assert.ok(BODY.includes(p), p);
  const templates = JSON.parse(read('content/gpu/rvsimt/templates/index.json')).templates.map((t) => t.title);
  const named = [...DOC.matchAll(/(?:template|Open) <em>([^<]+)<\/em>/g)].map((m) => m[1]);
  assert.ok(named.length >= 3, named.join());
  for (const t of named) assert.ok(templates.includes(t), t);
  for (const name of ['An if/else with split and join', 'No divergence: every thread takes the same path', 'Reverse an array through a barrier', 'Fault: a divergent branch']) {
    assert.ok(templates.includes(name) && BODY.includes(name), name);
  }
  for (const e of JSON.parse(read('content/gpu/rvsimt/exercises/index.json')).exercises) assert.ok(BODY.includes(e.title), e.title);
});

test('the register map in both documents is the device\'s', () => {
  const offsets = { CTRL: '0x000', STATUS: '0x004', ARGS: '0x008', BLOCK: '0x00C', CYCLES: '0x010', IMEM: '0x400', DMEM: '0x800' };
  for (const [name, o] of Object.entries(offsets)) {
    assert.equal(GPU_REG[name], Number(o), name);
    assert.ok(BODY.includes(o) && text(RVDOC).includes(o), `${name} ${o}`);
  }
  assert.ok(BODY.includes('0x5000_1000') && text(RVDOC).includes('0x5000_1000'));
});

test('the numbers it quotes are the simulator\'s', () => {
  const run = (src) => runCore(assemble([{ name: 'k.s', text: src }], { profile: 'lab' })).core;
  const c = run(DEFAULT_SOURCE);
  assert.match(BODY, new RegExp(`ends after ${c.cycles} cycles`));
  assert.ok(BODY.includes(`${c.active} active lane-slots of ${c.issued * 4}`));
  assert.ok(BODY.includes(`${(100 * c.active / (c.issued * 4)).toFixed(1)} %`));
  const bar = run(read('content/gpu/rvsimt/templates/reverse_bar.s'));
  assert.ok(BODY.includes(`${bar.cycles} cycles with ${bar.active} active lane-slots`));
  assert.ok(BODY.includes(`${(100 * bar.active / (bar.issued * 4)).toFixed(1)} %`));
  assert.ok(BODY.includes(`copies the ${read('content/templates/cpu-gpu-abs.s').match(/\.equ N,\s+(\d+)/)[1]} kernel words`));
});

test('W-D16: neither document names a book, chapter, figure or exercise number', () => {
  for (const t of [BODY, text(RVDOC)]) assert.doesNotMatch(t, /chapter|textbook|\bbook\b|FIG-\d|PRB-\d|worked example/i);
});
