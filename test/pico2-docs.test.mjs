// The Pico 2 Laboratory's documentation gate (P1-M9, research D45 Q8-Q9; design docs/architecture/pico2-p1m9-teaching-release.md
// §2.5-§2.6): the guide (content/pico2/help/docs/index.html) and the help (content/pico2/help/help.json) name every template and
// exercise; the guide's "Limits of the model" names exactly the machine's blocks that are not modelled or only store their
// registers, and has a line for every diagnostic that reports a gap; internal links resolve; citations of the RP2350 Datasheet
// use sections that exist in the cited release (the list below was read from its contents, Release 8); a help block that cites
// the datasheet records its source; and no student text still calls the module a development stage.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Machine } from '../src/arch/pico2/soc/machine.js';
import { PICO2_STRINGS } from '../src/arch/pico2/strings.js';
import { descriptor } from '../src/arch/pico2/index.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const guide = read('content/pico2/help/docs/index.html');
const help = JSON.parse(read('content/pico2/help/help.json'));
const templates = JSON.parse(read('content/pico2/templates/index.json'));
const exercises = JSON.parse(read('content/pico2/exercises/index.json'));
const text = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');
const section = (id) => { const m = new RegExp(`<h2 id="${id}">[\\s\\S]*?(?=<h2 id=|<footer)`).exec(guide); assert.ok(m, `section ${id}`); return m[0]; };
const helpText = help.sections.flatMap((s) => s.blocks.flatMap((b) => [b.p, ...(b.ul ?? []), ...(b.ol ?? []), ...(b.dl ?? []).flat(), b.notice].filter(Boolean))).join(' ');

// sections of the RP2350 Datasheet, Release 8 (build 80d627281ed5), as its contents list them: the ones this documentation cites
const SECTIONS = new Set(['2.2', '3.1', '3.8', '3.8.6', '3.8.7', '3.9', '5.3', '7.4', '8.1', '8.5', '11.5.4.2', '12.1', '12.2', '12.3', '12.4', '12.5', '12.6', '12.8']);
const CHAPTERS = new Set(['8', '9', '11']);

test('the descriptor names the guide and the exercises; the guide is a page of its own with the module\'s title', () => {
  assert.equal(descriptor.content.docs, 'content/pico2/help/docs/index.html');
  assert.equal(descriptor.content.exercises, 'content/pico2/exercises/index.json');
  assert.match(guide, /^<!doctype html>/);
  assert.match(guide, /<title>MAVILERA Pico 2 Laboratory documentation<\/title>/);
  assert.match(guide, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./);
});

test('the guide names every template and every exercise', () => {
  const t = text(section('templates')), e = text(section('exercises'));
  for (const x of templates.templates) assert.ok(t.includes(x.title), `template ${x.id}: ${x.title}`);
  for (const x of exercises.exercises) assert.ok(e.includes(x.title), `exercise ${x.id}: ${x.title}`);
});

test('Limits of the model names exactly the blocks the machine does not model, or only stores', () => {
  const m = new Machine();
  const by = (cls) => m.blocks.filter((d) => d.constructor.name === cls).map((d) => d.name).sort();
  const listed = (kind) => text(new RegExp(`<span data-blocks="${kind}">([\\s\\S]*?)</span>`).exec(section('limits'))[1]).split(',').map((s) => s.trim()).filter(Boolean).sort();
  assert.deepEqual(listed('unmodelled'), by('Unmodelled'));
  assert.deepEqual(listed('storage'), by('Storage'));
});

test('every diagnostic that reports a gap of the model has its line in Limits of the model', () => {
  const lim = text(section('limits')).toLowerCase();
  // a diagnostic's kind (src/arch/pico2/strings.js diag) and words its line in the guide must have
  const LINES = {
    notModelled: ['read as zero or as last written'], watchdogEnabled: ['watchdog'], gpioFunction: ['gpio function without a model'],
    sioInterp: ['interpolators'], sioTmds: ['tmds'], dmaDreq: ['dma requests from blocks without a model'], spiSlave: ['spi and i2c as slaves'],
    i2cSlave: ['spi and i2c as slaves'], i2c10bit: ['10-bit'], i2cGeneralCall: ['general calls', 'start bytes'], pioNotModelled: ['inline_out_en', 'out_sticky', 'gpiobase'],
  };
  for (const [k, words] of Object.entries(LINES)) {
    assert.ok(typeof PICO2_STRINGS.diag[k] === 'function', `diag ${k} exists`);
    for (const w of words) assert.ok(lim.includes(w), `${k}: "${w}" in Limits of the model`);
  }
  assert.ok(typeof PICO2_STRINGS.engine.romEntry === 'function' && lim.includes('bootrom'), 'the bootrom');
});

test('internal links of the guide resolve; its contents list every section', () => {
  const ids = new Set([...guide.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of guide.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(id), `#${id}`);
  const toc = [...guide.matchAll(/<nav class="toc"[\s\S]*?<\/nav>/g)][0][0];
  for (const [, id] of guide.matchAll(/<h2 id="([^"]+)"/g)) assert.ok(toc.includes(`href="#${id}"`), `contents: ${id}`);
});

test('citations of the datasheet use sections of the cited release; help blocks that cite it record their source', () => {
  const all = `${text(guide)} ${helpText}`;
  for (const [, s] of all.matchAll(/§(\d+(?:\.\d+)*)/g)) assert.ok(SECTIONS.has(s), `§${s} is not a section this documentation was checked against`);
  for (const [, c] of all.matchAll(/chapters? (\d+)/g)) assert.ok(CHAPTERS.has(c), `chapter ${c}`);
  for (const s of help.sections) for (const b of s.blocks) {
    const t = JSON.stringify(b);
    if (/Datasheet|§/.test(t) && !b.refs) assert.ok(Array.isArray(b.sources) && b.sources.every((x) => /^RP-00[12]\b/.test(x)), `${s.id}: a block citing the datasheet has sources`);
  }
  assert.ok(help.sections.some((s) => s.blocks.some((b) => b.refs?.some(([t, url, d]) => t === 'RP2350 Datasheet' && url && /Release 8/.test(d)))), 'the Sources topic');
  assert.match(text(section('sources')), /Release 8 \(build 80d627281ed5\)/);
});

test('no student text calls the module a development stage; help topic ids are unique', () => {
  const strings = JSON.stringify(PICO2_STRINGS);
  for (const [what, t] of [['strings', strings], ['help', helpText], ['guide', text(guide)]]) assert.doesNotMatch(t, /development stage/i, what);
  const ids = help.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['first-steps', 'about', 'programs', 'limits', 'privacy', 'sources']) assert.ok(ids.includes(id), id);
});

test('the engine\'s warnings have the contract\'s shape, so the shell shows them in the console (P1-M9: they did not before)', () => {
  const p = descriptor.language.assemble([{ name: 'x.s', text: '        .text\n_start: li t0, 0x400f0000\n        lw t1, 0(t0)\n        ebreak\n' }], { profile: 'hazard3' });
  assert.ok(p.ok);
  const e = descriptor.engine.create(p);
  for (let i = 0; i < 4; i++) e.step();
  const d = e.diagnostics();
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'notModelled');
  assert.equal(d[0].message, PICO2_STRINGS.diag.notModelled('TRNG'));
});
