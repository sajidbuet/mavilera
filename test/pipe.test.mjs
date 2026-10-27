// pipe.test.mjs -- the Chapter 8 pipelined model (spec §8.3): golden dumps of
// the chapter's programs (WS-V-020), cycle counts against the chapter's
// cycle model (code/chapter08/ref/pipe_model.py, run locally through
// tools/ref_cycles_ch08.py) on generated programs with every predictor,
// architectural results against the ISA engine, and back-stepping. Tests
// that need the book repository or Python are skipped, saying so, without it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { assemble, hexImage } from '../src/asm/assembler.js';
import { Hart, run } from '../src/core/iss.js';
import { Pipeline, Predictor, HAZARD_MODES } from '../src/uarch/pipe.js';
import { PIPE_SIGNALS } from '../src/uarch/signals.js';
import { program } from './programs-ch08.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const PROGS = join(BOOK, 'code', 'chapter08', 'programs');
const CH06 = join(BOOK, 'code', 'chapter06', 'programs');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const skip = existsSync(PROGS) ? false : 'book repository not found beside this one';
const skipPy = skip || (spawnSync(PYTHON, ['--version']).status !== 0 ? 'Python 3 not found' : false);
const TABLES = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const NAMES = skip ? [] : readdirSync(PROGS).filter((p) => existsSync(join(PROGS, p, 'golden.hex')));

const words = (text) => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseInt(l, 16) >>> 0);
const image = (ws) => ({ segments: [{ address: 0, executable: true, bytes: new Uint8Array(new Uint32Array(ws).buffer) }] });

/** Source of a chapter program: chapter08/<name>/prog.s, or the Chapter 6 program a c6* name stands for. */
function source(name) {
  const base = name.replace(/_bp$/, '');
  return base.startsWith('c6') ? join(CH06, base.slice(2), 'prog.s') : join(PROGS, base, 'prog.s');
}

for (const name of NAMES) {
  test(`WS-V-020: chapter08/${name} gives golden.hex`, { skip }, () => {
    const hex = readFileSync(join(PROGS, name, 'prog.hex'), 'utf8');
    const m = new Pipeline(TABLES, { predictor: name.endsWith('_bp') ? '2bit' : 'none', entries: 8 });
    m.load(image(words(hex)));
    assert.equal(m.run(), 'halt');
    assert.deepEqual(m.golden(), words(readFileSync(join(PROGS, name, 'golden.hex'), 'utf8')));
    const src = source(name);
    if (existsSync(src)) { // the assembler gives the same image
      const prog = assemble([{ name: src, text: readFileSync(src, 'utf8') }], { profile: 'ch08' });
      assert.deepEqual(prog.errors, []);
      assert.deepEqual(prog.profileErrors, []);
      assert.equal(hexImage(prog, 256), hex, 'prog.hex');
    }
  });
}

function build(src) {
  const prog = assemble(src, { profile: 'ch08' });
  assert.deepEqual(prog.errors, []);
  assert.deepEqual(prog.profileErrors, []);
  return prog;
}

const CONFIGS = [['none', 8], ['1bit', 8], ['1bit', 2], ['2bit', 8], ['2bit', 2], ['2bit', 16]];

test('cycle counts and golden dumps equal the chapter\'s cycle model (pipe_model.py) on generated programs', { skip: skipPy }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pips-pipe-'));
  try {
    const files = [];
    const progs = [];
    for (let seed = 1; seed <= 12; seed++) {
      const prog = build(program(seed * 2654435761, 12));
      const file = join(dir, `p${seed}.hex`);
      writeFileSync(file, hexImage(prog, 256));
      files.push(file);
      progs.push(prog);
    }
    for (const [bp, entries] of CONFIGS) {
      const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'ref_cycles_ch08.py'), BOOK, ...files, '--bp', bp, '--entries', String(entries)],
        { encoding: 'utf8', maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, r.stderr);
      const ref = JSON.parse(r.stdout);
      progs.forEach((prog, i) => {
        const m = new Pipeline(TABLES, { predictor: bp, entries });
        m.load(prog);
        assert.equal(m.run(), 'halt');
        const what = `program ${i + 1}, predictor ${bp}/${entries}`;
        assert.equal(m.cycle, ref[i].cycles, `${what}: cycles`);
        assert.equal(m.stats.retired, ref[i].instructions, `${what}: instructions`);
        assert.equal(m.stats.loadUse, ref[i].stalls, `${what}: load-use stalls`);
        assert.equal(m.stats.redirects, ref[i].redirects, `${what}: redirects`);
        assert.equal(m.stats.branches, ref[i].branches, `${what}: branches`);
        assert.equal(m.stats.mispredicts, ref[i].mispredicts, `${what}: mispredictions`);
        assert.deepEqual(m.golden(), ref[i].golden, `${what}: golden dump`);
      });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WS-F-057 extension: early branch resolution equals its cycle model (tools/ref_cycles_ch08.py --early) and the ISA engine', { skip: skipPy }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pips-early-'));
  try {
    const progs = [];
    const files = [];
    for (let seed = 1; seed <= 12; seed++) {
      const prog = build(program(seed * 2246822519, 12));
      const file = join(dir, `e${seed}.hex`);
      writeFileSync(file, hexImage(prog, 256));
      files.push(file);
      progs.push(prog);
    }
    for (const name of NAMES.filter((n) => !n.endsWith('_bp'))) files.push(join(PROGS, name, 'prog.hex'));
    const chapter = files.slice(progs.length).map((f) => image(words(readFileSync(f, 'utf8'))));
    let stalls = 0;
    for (const [bp, entries] of CONFIGS) {
      const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'ref_cycles_ch08.py'), BOOK, ...files, '--bp', bp, '--entries', String(entries), '--early'],
        { encoding: 'utf8', maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, r.stderr);
      const ref = JSON.parse(r.stdout);
      [...progs, ...chapter].forEach((prog, i) => {
        const m = new Pipeline(TABLES, { predictor: bp, entries, early: true });
        m.load(prog);
        assert.equal(m.run(), 'halt');
        const what = `${i < progs.length ? `program ${i + 1}` : files[i]}, predictor ${bp}/${entries}`;
        assert.equal(m.cycle, ref[i].cycles, `${what}: cycles`);
        assert.equal(m.stats.retired, ref[i].instructions, `${what}: instructions`);
        assert.equal(m.stats.loadUse + m.stats.branchStall, ref[i].stalls, `${what}: stalls`);
        assert.equal(m.stats.redirects, ref[i].redirects, `${what}: redirects`);
        assert.equal(m.stats.branches, ref[i].branches, `${what}: branches`);
        assert.equal(m.stats.mispredicts, ref[i].mispredicts, `${what}: mispredictions`);
        assert.deepEqual(m.golden(), ref[i].golden, `${what}: golden dump`);
        assert.equal(m.cycle, m.stats.retired + 4 + m.stats.loadUse + m.stats.branchStall + m.stats.redirects);
        stalls += m.stats.branchStall;
        if (i < progs.length) {
          const hart = new Hart(prog, { profile: 'ch08' });
          run(hart, 100_000, () => {});
          assert.deepEqual(Array.from(m.x), Array.from(hart.x), `${what}: registers`);
        }
      });
    }
    assert.ok(stalls > 100, `the programs exercise the branch stalls (${stalls})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WS-F-057: early resolution needs the complete hazard unit', () => {
  assert.throws(() => new Pipeline(TABLES, { hazard: 'memwb', early: true }), /complete hazard unit/);
});

test('complete hazard unit: architectural results equal the ISA engine; no stale operand', () => {
  const seen = { loadUse: 0, mispredicts: 0, jumps: 0, fwdMem: 0, fwdWb: 0 };
  for (let seed = 1; seed <= 20; seed++) {
    const prog = build(program(seed * 40503, 14));
    const hart = new Hart(prog, { profile: 'ch08' });
    run(hart, 100_000, () => {});
    for (const [bp, entries] of CONFIGS) {
      const m = new Pipeline(TABLES, { predictor: bp, entries });
      m.load(prog);
      assert.equal(m.run(), 'halt');
      assert.deepEqual(Array.from(m.x), Array.from(hart.x), `seed ${seed}, ${bp}/${entries}: registers`);
      for (let a = 0; a < 1024; a += 4) assert.equal(m.dmem.read(a, 4), hart.mem.read(a, 4), `seed ${seed}: word ${a}`);
      assert.equal(m.stats.stale, 0);
      assert.equal(m.haltPc, hart.pc);
      assert.equal(m.cycle, m.stats.retired + 4 + m.stats.loadUse + 2 * m.stats.redirects, 'cycles = N + 4 + stalls + 2 x redirects');
      for (const k of ['loadUse', 'mispredicts', 'jumps']) seen[k] += m.stats[k];
      for (const t of m.trace) {
        seen.fwdMem += (t.fwd_sel_a === 2) + (t.fwd_sel_b === 2);
        seen.fwdWb += (t.fwd_sel_a === 1) + (t.fwd_sel_b === 1);
      }
    }
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 100, `the generated programs exercise ${k} (${v})`);
});

test('the laboratory stages: earlier stages read stale values or run the wrong path, and say so', () => {
  const src = (t) => build(t);
  // dep: a value needed from MEM and from WB
  const dep = src('addi x1, x0, 5\naddi x2, x1, 1\nadd x3, x1, x2\nhalt\n');
  const want = { none: true, mem: true, memwb: false, stall: false, full: false };
  for (const mode of HAZARD_MODES) {
    const m = new Pipeline(TABLES, { hazard: mode });
    m.load(dep);
    m.run(200);
    assert.equal(m.stats.stale > 0, want[mode], `${mode}: stale`);
    assert.equal(m.x[3] === 11, !want[mode], `${mode}: x3`);
  }
  // load-use: without the stall the address is forwarded instead of the data
  const lu = src('addi x5, x0, 9\nsw x5, 8(x0)\nlw x6, 8(x0)\nadd x7, x6, x6\nhalt\n');
  for (const [mode, ok] of [['memwb', false], ['stall', true], ['full', true]]) {
    const m = new Pipeline(TABLES, { hazard: mode });
    m.load(lu);
    m.run(200);
    assert.equal(m.x[7] === 18, ok, `${mode}: x7`);
    assert.equal(m.stats.loadUse, ok ? 1 : 0, `${mode}: stalls`);
  }
  // a taken jump: without the flush the next two instructions execute, marked as wrong-path
  const j = src('jal x0, t\naddi x8, x0, 1\naddi x9, x0, 1\nt: addi x10, x0, 1\nhalt\n');
  for (const [mode, ok] of [['stall', false], ['full', true]]) {
    const m = new Pipeline(TABLES, { hazard: mode });
    m.load(j);
    m.run(200);
    assert.equal(m.x[8] === 0 && m.x[9] === 0, ok, `${mode}: wrong path`);
    const marked = [...m.instances.values()].filter((i) => i.wrongPath).length;
    assert.equal(marked > 0, !ok, `${mode}: marked`);
  }
});

for (const early of [false, true]) test(`back-stepping returns every state, and the diagram record survives it${early ? ' (early resolution)' : ''}`, () => {
  const prog = build(program(7, 10));
  const m = new Pipeline(TABLES, { predictor: '2bit', early });
  m.load(prog);
  const states = [];
  const snap = () => JSON.stringify([m.golden(), m.evaluate().signals, m.stats, Array.from(m.bp.table)]);
  for (;;) {
    states.push(snap());
    if (m.step() !== 'step') break;
  }
  const traced = m.trace.length;
  assert.ok(m.back()); // leaves the halt
  assert.equal(snap(), states[states.length - 1]);
  for (let i = states.length - 2; i >= 0; i--) {
    assert.ok(m.back());
    assert.equal(snap(), states[i], `cycle ${i}`);
  }
  assert.equal(m.back(), false);
  assert.equal(m.trace.length, traced);
});

test('predictors: 1-bit and 2-bit tables, reset values and saturation', () => {
  const two = new Predictor('2bit', 4);
  assert.deepEqual(Array.from(two.table), [1, 1, 1, 1]);
  assert.equal(two.predict(0x14), 0);
  assert.equal(two.index(0x14), 1);
  assert.equal(two.next(0x14, true), 2);
  two.table[1] = 3;
  assert.equal(two.next(0x14, true), 3);
  assert.equal(two.predict(0x14), 1);
  const one = new Predictor('1bit', 8);
  assert.equal(one.predict(0x14), 0);
  assert.equal(one.next(0x14, true), 1);
  assert.throws(() => new Predictor('2bit', 6), /power of two/);
  // the worked example of Chapter 8: a loop branch taken 9 times then not, run three times
  const count = (kind) => {
    const p = new Predictor(kind, 8);
    let miss = 0;
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 10; i++) {
        const taken = i < 9 ? 1 : 0;
        if (p.predict(0x10) !== taken) miss += 1;
        p.table[p.index(0x10)] = p.next(0x10, taken);
      }
    }
    return miss;
  };
  assert.equal(count('1bit'), 6);
  assert.equal(count('2bit'), 4);
});

test('the signal dictionary of Chapter 8 has unique names and every signal is evaluated', () => {
  assert.equal(new Set(PIPE_SIGNALS.map((s) => s.name)).size, PIPE_SIGNALS.length);
  const m = new Pipeline(TABLES);
  const s = m.evaluate().signals;
  for (const d of PIPE_SIGNALS) assert.ok(d.name in s, d.name);
});
