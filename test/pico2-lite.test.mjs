// Pico Lite (pico2 P1-L1, research D34; design docs/architecture/pico2-p1l1-lite.md §4.1): the editions in the contract
// (v10 draft: shape, withEdition, the descriptor of each edition valid), the state-aware primary button, and the C source
// view's record for MAVILERA C programs built from the compiler's line map (debug/cc-lines.js): every instruction with a C
// line is found at that line, code without one has no row, breakpoint addresses are the starts of the line's runs, and
// stepping by line follows the example program.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptor } from '../src/arch/pico2/index.js';
import { validateDescriptor, withEdition, editionOf, activeEdition } from '../src/arch/contract.js';
import { primaryAction } from '../src/ui/primary-action.js';
import { SourceSession } from '../src/arch/pico2/debug/source-session.js';
import { ccPath } from '../src/arch/pico2/debug/cc-lines.js';
import { STOP } from '../src/arch/contract.js';
import { cProgram } from './programs-c.mjs';

const C = descriptor.language.extraLanguages.find((x) => x.id === 'c');
const cc = await C.load();

/** Compile and assemble a MAVILERA C program with its source record, as the shell does. */
function build(text, name = 'main.c') {
  const r = cc.compile(text, { name, profile: 'hazard3' });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  const p = descriptor.language.assemble([{ name: 'main.s', text: r.text }], { profile: 'hazard3', source: { file: name, text, lines: r.lines } });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return { p, map: r.lines };
}

test('editions: pico2 declares Lite (default) and Full; each edition\'s descriptor is valid', () => {
  assert.deepEqual(validateDescriptor(descriptor), []);
  assert.deepEqual(descriptor.editions.map((e) => e.id), ['lite', 'full']);
  assert.equal(editionOf(descriptor, null), 'lite');
  assert.equal(editionOf(descriptor, 'nonsense'), 'lite');
  assert.equal(editionOf(descriptor, 'full'), 'full');
  const lite = withEdition(descriptor, 'lite');
  assert.equal(lite.activeEdition, 'lite');
  assert.equal(activeEdition(lite).primary, true);
  assert.equal(lite.capabilities.projects.enabled, false);
  assert.equal(lite.capabilities.imageImport.enabled, false);
  assert.deepEqual(lite.language.extraLanguages.map((x) => x.id), ['c']); // no Pico SDK C, no download
  const full = withEdition(descriptor, 'full');
  assert.equal(full.capabilities.projects, true);
  assert.equal(full.capabilities.imageImport, true);
  assert.equal(activeEdition(full).compiler, 'sdk-c');
  assert.equal(activeEdition(full).primary, undefined);
  for (const d of [lite, full]) assert.deepEqual(validateDescriptor({ ...d, editions: undefined, activeEdition: undefined }), []);
});

test('editions: a module without editions is unchanged; bad edition shapes are refused', () => {
  const plain = { ...descriptor, editions: undefined };
  assert.equal(editionOf(plain, 'full'), null);
  assert.equal(withEdition(plain, 'full').activeEdition, null);
  assert.equal(withEdition(plain, 'full').capabilities, plain.capabilities);
  const bad = (editions) => validateDescriptor({ ...descriptor, editions });
  assert.ok(bad([descriptor.editions[0]]).some((m) => m.startsWith('editions: a list of at least two')));
  assert.ok(bad([descriptor.editions[0], { ...descriptor.editions[1], id: 'lite' }]).some((m) => m.includes('no repeats')));
  assert.ok(bad([{ ...descriptor.editions[0], languages: ['fortran'] }, descriptor.editions[1]]).some((m) => m.includes('languages')));
  assert.ok(bad([descriptor.editions[0], { ...descriptor.editions[1], compiler: 'pascal' }]).some((m) => m.includes('compiler')));
  assert.ok(bad([{ ...descriptor.editions[0], capabilities: { flying: true } }, descriptor.editions[1]]).some((m) => m.includes('flying')));
  // an edition that keeps the image language but turns projects off makes an invalid descriptor
  assert.ok(bad([{ ...descriptor.editions[0], languages: ['c', 'sdk-c'] }, descriptor.editions[1]]).some((m) => m.startsWith('edition lite: extra language sdk-c')));
});

test('primary button: Build from a changed or unbuilt text, then Run, Pause while running, Run again after the end', () => {
  const s = (o) => primaryAction({ running: false, changed: false, runnable: true, ended: false, ...o });
  assert.equal(s({ changed: true }), 'build');
  assert.equal(s({ runnable: false }), 'build');           // errors, or nothing built: Build again
  assert.equal(s({}), 'run');
  assert.equal(s({ running: true }), 'pause');
  assert.equal(s({ running: true, changed: true }), 'pause'); // a run going on is paused first
  assert.equal(s({ ended: true }), 'again');
  assert.equal(s({ ended: true, changed: true }), 'build');  // two clicks from a changed text (D34 Q5)
});

test('MAVILERA C line table: every instruction with a C line maps to it; start-up and helpers have none', () => {
  const programs = [C.example, ...Array.from({ length: 16 }, (_, i) => cProgram(1000 + i))];
  for (const text of programs) {
    const { p, map } = build(text);
    const lt = p.debug.lineTable;
    assert.deepEqual(lt.files, [ccPath('main.c')]);
    assert.equal(p.debug.sources.get(ccPath('main.c')), text);
    const starts = new Map(); // C line -> addresses where a run of it starts
    let prev = null;
    for (const r of p.listing) {
      const c = map[r.line - 1] ?? 0;
      const at = lt.lineAt(r.address);
      if (!c) { assert.equal(at, null, `${r.address.toString(16)} has no C line`); prev = null; continue; }
      assert.equal(at?.line, c, `${r.address.toString(16)}: C line ${c}`);
      if (!prev || prev.c !== c || prev.end !== r.address) { if (!starts.has(c)) starts.set(c, []); starts.get(c).push(r.address); assert.equal(at.stmt, true); }
      prev = { c, end: r.address + r.size };
    }
    for (const [c, addrs] of starts) assert.deepEqual(lt.addressesOf(0, c), addrs, `line ${c}`);
    assert.deepEqual(lt.linesOf(0), [...starts.keys()].sort((a, b) => a - b));
  }
});

test('MAVILERA C functions: the global text labels, each up to the next', () => {
  const { p } = build(C.example);
  const names = p.debug.functions.map((f) => f.name);
  for (const n of ['_start', 'print', 'main', 'putchar', 'pin_output', 'pin_write', 'delay_ms']) assert.ok(names.includes(n), n);
  assert.ok(names.every((n) => !n.startsWith('.')));
  const f = p.debug.functions;
  for (let i = 0; i + 1 < f.length; i++) assert.equal(f[i].address + f[i].size, f[i + 1].address);
  assert.equal(f[0].address, p.listing[0].address);
});

test('MAVILERA C stepping by line follows the example; a line breakpoint has the line\'s addresses', () => {
  const { p } = build(C.example);
  const ss = new SourceSession(p);
  const seq = [];
  for (let i = 0; i < 5; i++) { assert.equal(ss.stepLine(), STOP.NONE); const w = ss.where(); seq.push(`${w.fn}:${w.line}`); }
  // main's entry, the call of print, print's entry, its loop condition and body (example lines 15, 17, 9, 11, 12; the
  // comment gained a line with the clock option, P1-M4)
  assert.deepEqual(seq, ['main:15', 'main:17', 'print:9', 'print:11', 'print:12']);
  assert.deepEqual(ss.toggleBreak(0, 20), p.debug.lineTable.addressesOf(0, 20));
  assert.ok(ss.toggleBreak(0, 20).length === 0 && !ss.hasBreak(0, 20)); // toggled off
  assert.ok(ss.backLine());
  assert.equal(ss.where().line, 11);
});

test('the C source view\'s reset starts the UART output afresh (Run again shows the text once)', () => {
  const { p } = build('int main(void) { putchar(72); putchar(105); return 0; }');
  const ss = new SourceSession(p);
  let st; do st = ss.step(); while (st === STOP.NONE);
  assert.equal(st, STOP.HALT);
  assert.equal(ss.engine.state().output, 'Hi');
  ss.reset();
  assert.equal(ss.engine.state().output, '');
  do st = ss.step(); while (st === STOP.NONE);
  assert.equal(ss.engine.state().output, 'Hi');
  // step back over the second run's output keeps the log consistent
  assert.ok(ss.back());
});

test('an assembly program gets no debug record', () => {
  const p = descriptor.language.assemble([{ name: 'main.s', text: descriptor.language.defaultSource }], { profile: 'hazard3' });
  assert.equal(p.debug, undefined);
});

test('research D38: Step line and Back line on the shell\'s own engine (Language.lineStep), mixed with single steps; the C source view only for opened images', async () => {
  const hello = (await import('node:fs')).readFileSync(new URL('../content/pico2/templates/hello.c', import.meta.url), 'utf8');
  const { p } = build(hello, 'hello.c');
  const engine = descriptor.engine.create(p);
  const ls = (await descriptor.language.lineStep.load()).create(p, engine);
  const lt = p.debug.lineTable;
  const lineAt = () => { const r = lt.lineAt(engine.state().pc); return r ? r.line : 0; };
  const seen = [];
  for (let i = 0; i < 4; i++) { assert.equal(ls.stepLine(), STOP.NONE); seen.push(lineAt()); }
  assert.ok(seen.every((l) => l > 0), `lines ${seen}`);
  const before = engine.state().steps;
  engine.step(); engine.step(); // the shell's Step meanwhile
  assert.equal(ls.stepLine(), STOP.NONE);
  assert.ok(engine.state().steps > before + 2);
  assert.ok(ls.backLine(), 'back line');
  assert.equal(engine.state().steps, before + 2, 'back to where that step line started');
  assert.equal(descriptor.views.find((v) => v.id === 'source').imageOnly, true);
  for (const t of JSON.parse((await import('node:fs')).readFileSync(new URL('../content/pico2/templates/index.json', import.meta.url), 'utf8')).templates) {
    assert.notEqual(t.view, 'source', `${t.id} opens in a view offered for images only`);
  }
});
