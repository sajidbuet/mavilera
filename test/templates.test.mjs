// templates.test.mjs -- the teaching templates of content/templates/ (approved by the author,
// 2026-10-27): every template in the index exists, assembles or compiles in its view, runs to its
// halt, and shows what its header says it shows (results, stalls, mispredictions, the calling-
// convention report, the critical path, agreement of the three processors).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { Hart } from '../src/core/iss.js';
import { compile } from '../src/cc/compiler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { compare } from '../src/uarch/compare.js';
import { classTable, delayMap } from '../src/uarch/timing.js';
import { ch07 } from './ch07-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'content/templates');
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const INDEX = json('content/templates/index.json');
const T6 = json('content/data/ch06-tables.json');
const T7 = ch07({ jalr: false }).t7; // as a release has it
const src = (f) => readFileSync(join(DIR, f), 'utf8');
const VIEW_PROFILE = { isa: 'iss', single: 'ch06', multi: 'ch07', pipe: 'ch08' };

/** The ISA view: run to the exit; registers, exit code, output, calling-convention reports. */
function iss(name, text) {
  const p = assemble([{ name, text }], { profile: 'iss' });
  assert.ok(p.ok, `${name}: ${p.errors.map((e) => e.message).join('; ')}`);
  const h = new Hart(p, { profile: 'iss', abiCheck: true });
  while (!h.halted && h.instret < 1_000_000) h.stepFast();
  assert.ok(h.halted, `${name} halts`);
  return { h, x: (r) => h.x[r] | 0, out: String.fromCharCode(...(h.output ?? [])) };
}
const exitOf = (h) => h.exit_code ?? h.exitCode;

/** A processor view: run its model to the halt. */
function model(f, view, opts = {}) {
  const profile = VIEW_PROFILE[view];
  const p = assemble([{ name: f, text: src(f) }], { profile });
  assert.ok(p.ok && !p.profileErrors.length, `${f}: ${[...p.errors, ...p.profileErrors].map((e) => e.message).join('; ')}`);
  const m = view === 'pipe' ? new Pipeline(T6, opts) : view === 'multi' ? new Multicycle(T6, T7, opts) : new SingleCycle(T6, opts);
  m.load(p);
  let r;
  do r = m.step(); while (r === 'step' && m.cycle < 100_000);
  assert.equal(r, 'halt', `${f} halts (${m.error ?? r})`);
  return { m, x: (r) => m.x[r] | 0, s: m.stats };
}
const pipe = (f, o = {}) => model(f, 'pipe', o);

const CHECKS = {
  hello: () => assert.equal(iss('hello.s', src('hello.s')).out, 'Hello, RISC-V!\n'),
  'sum-loop': () => assert.equal(exitOf(iss('sum-loop.s', src('sum-loop.s')).h), 60),
  procedures: () => { const r = iss('procedures.s', src('procedures.s')); assert.equal(exitOf(r.h), 25); assert.deepEqual(r.h.abiViolations, []); },
  recursion: () => { const r = iss('recursion.s', src('recursion.s')); assert.equal(exitOf(r.h), 120); assert.deepEqual(r.h.abiViolations, []); },
  'abi-fault': () => {
    const r = iss('abi-fault.s', src('abi-fault.s'));
    assert.equal(exitOf(r.h), 28);
    assert.ok(r.h.abiViolations.some((v) => /s0 changed/.test(v)), r.h.abiViolations.join('; '));
    const fixed = iss('fixed.s', src('abi-fault.s').replace('add  s0, a0, a0', 'add  t0, a0, a0').replace('mv   a0, s0', 'mv   a0, t0'));
    assert.equal(exitOf(fixed.h), 114, 'the repair the header suggests');
    assert.deepEqual(fixed.h.abiViolations, []);
  },
  'bit-fields': () => { const r = iss('bit-fields.s', src('bit-fields.s')); assert.deepEqual([r.x(10), r.x(9), r.x(18), r.x(19)], [0x355b, 10, 26, 27]); },
  endianness: () => {
    const r = iss('endianness.s', src('endianness.s'));
    assert.deepEqual([11, 12, 13, 14, 15].map((k) => r.x(k) >>> 0), [0x44, 0x11, 0x3344, 0x1122ab44, 0xffffffab]);
  },
  overflow: () => {
    const r = iss('overflow.s', src('overflow.s'));
    assert.deepEqual([11, 12, 13, 14, 15, 16].map((k) => r.x(k) >>> 0), [1, 0, 0x80000000, 0xffffffff, 1, 0x80000000]);
  },
  'watch-overrun': () => {
    assert.equal(exitOf(iss('watch-overrun.s', src('watch-overrun.s')).h), 4);
    assert.equal(exitOf(iss('fixed.s', src('watch-overrun.s').replace('ble  t1, t3, fill', 'blt  t1, t3, fill')).h), 1000, 'the fix the header names');
  },
  'plain-vs-register': () => cPair('plain-vs-register.c', 70),
  pointers: () => cPair('pointers.c', 1414),
  'class-tour': () => {
    const r = model('class-tour.s', 'single');
    assert.deepEqual([r.x(7), r.x(8), r.x(9)], [67, 67, 0], 'the branch is taken over the addi');
    assert.deepEqual(classTable(delayMap(json('content/data/ch06-delays.json')), T6).setBy, ['lw'], 'lw sets the clock period');
  },
  'cpi-mix': () => {
    const r = model('cpi-mix.s', 'multi');
    const alu = 3 * 4 + 3; // three ALU instructions and a branch per iteration
    const load = 2 * 5 + 2 * 4 + 3; // two loads, two ALU instructions and a branch
    assert.ok(load / 5 > alu / 4, 'the load loop has the higher CPI');
    assert.equal(r.m.cycle, 2 * 4 + 1 * 4 + 10 * alu + 10 * load, 'cycles as the per-class counts give them (ALU 4, lw 5, branch 3)');
  },
  forwarding: () => {
    const full = pipe('forwarding.s');
    assert.deepEqual([1, 2, 3, 4, 5, 6].map(full.x), [5, 10, 5, 15, 5, 20]);
    assert.equal(full.s.stale, 0);
    const none = pipe('forwarding.s', { hazard: 'none' });
    assert.ok(none.s.stale > 0 && none.x(6) !== 20, 'without forwarding the results are wrong');
  },
  'load-use': () => {
    const r = pipe('load-use.s');
    assert.equal(r.s.loadUse, 2, 'two stalls, both in the first block');
    assert.deepEqual([r.x(3), r.x(6), r.x(13), r.x(16)], [7, 11, 7, 11]);
  },
  'hazard-unit-steps': () => {
    const x6 = Object.fromEntries(['none', 'mem', 'memwb', 'stall', 'full'].map((h) => [h, pipe('hazard-unit-steps.s', { hazard: h }).x(6)]));
    assert.deepEqual(x6, { none: 0, mem: 0, memwb: 128, stall: 8, full: 8 });
  },
  'branch-loop': () => {
    const none = pipe('branch-loop.s');
    const two = pipe('branch-loop.s', { predictor: '2bit' });
    assert.equal(none.s.mispredicts, 9, 'every taken branch with no predictor');
    assert.equal(two.s.mispredicts, 2, 'the first iteration and the exit');
    assert.ok(two.m.cycle < none.m.cycle);
  },
  'mispredict-pattern': () => {
    const one = pipe('mispredict-pattern.s', { predictor: '1bit' });
    const two = pipe('mispredict-pattern.s', { predictor: '2bit' });
    assert.equal(one.s.mispredicts, 14, '1-bit: two per round of the inner loop, two for the outer');
    assert.equal(two.s.mispredicts, 9, '2-bit: one per round once trained, one to train, two for the outer');
  },
  'predictor-aliasing': () => {
    const two = pipe('predictor-aliasing.s', { predictor: '2bit', entries: 2 });
    const eight = pipe('predictor-aliasing.s', { predictor: '2bit', entries: 8 });
    assert.ok(two.s.mispredicts > eight.s.mispredicts, `${two.s.mispredicts} > ${eight.s.mispredicts}`);
    const p = assemble([{ name: 'a.s', text: src('predictor-aliasing.s') }], { profile: 'ch08' });
    const branches = p.listing.filter((l) => (l.word & 0x7f) === 0b1100011).map((l) => l.address);
    assert.deepEqual(branches, [0x4, 0xc, 0x14], 'the addresses the header names');
  },
  jumps: () => {
    const ex = pipe('jumps.s');
    const id = pipe('jumps.s', { early: true });
    assert.equal(ex.s.jumps, 6);
    assert.equal(ex.x(10), 3);
    assert.ok(id.m.cycle < ex.m.cycle);
  },
  speedup: () => {
    const r = compare([{ name: 'speedup.s', text: src('speedup.s') }], { t6: T6, delays6: json('content/data/ch06-delays.json'), t7: T7, timing8: json('content/data/ch08-timing.json') });
    assert.ok(r.rows.every((x) => x.ok), JSON.stringify(r.rows));
    assert.ok(r.rows.filter((x) => x.agrees !== null).every((x) => x.agrees), 'the three processors agree at the halt');
    assert.ok(r.rows.find((x) => x.profile === 'ch08').speedup > 1, 'the pipeline is the fastest');
  },
};

/** A C template: both translations give the exit code; the register one runs fewer instructions. */
function cPair(f, exit) {
  const n = {};
  for (const mode of ['plain', 'register']) {
    const c = compile(src(f), { mode });
    assert.ok(c.ok, `${f} (${mode}): ${JSON.stringify(c.errors)}`);
    const r = iss(f, c.asm);
    assert.equal(exitOf(r.h), exit, mode);
    assert.deepEqual(r.h.abiViolations, [], mode);
    n[mode] = r.h.instret;
  }
  assert.ok(n.register < n.plain, `register ${n.register} < plain ${n.plain}`);
}

test('every template file is in the index, every entry has a file, a group, a view and a check', () => {
  const files = readdirSync(DIR).filter((f) => f !== 'index.json').sort();
  assert.deepEqual(INDEX.templates.map((t) => t.file).sort(), files);
  for (const t of INDEX.templates) {
    assert.ok(INDEX.groups[t.group] && ['isa', 'single', 'multi', 'pipe', 'compare'].includes(t.view) && t.title, t.id);
    assert.ok(CHECKS[t.id], `no check for ${t.id}`);
    assert.match(src(t.file), /Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\.[\s\S]*Rights class: content/, t.file);
  }
});

for (const t of INDEX.templates) test(`template ${t.id}: ${t.title}`, () => CHECKS[t.id]());
