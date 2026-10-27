// exports.test.mjs -- the file exports (spec §13) and the comparison view
// (WS-F-060): golden dumps byte-identical to the chapters' golden.hex
// (WS-F-124), the JSON-lines trace equal to rvsim.py --trace-json (WS-F-126),
// the VCD read back to the model's signal values (WS-F-125), and the
// comparison's clock periods and cycle counts against the chapters' values
// and golden dumps. Tests that need the book repository or Python are
// skipped, saying so, without them.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { assemble } from '../src/asm/assembler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { ch07 } from './ch07-content.mjs';
import { Pipeline } from '../src/uarch/pipe.js';
import { SINGLE_SIGNALS, MULTI_SIGNALS, PIPE_SIGNALS, PIPE_EXT_SIGNALS } from '../src/uarch/signals.js';
import { goldenText, traceRecords, traceJsonLines, traceCsv, recordFrames, vcd } from '../src/core/exports.js';
import { compare, clockPeriods } from '../src/uarch/compare.js';
import { programsCh07 } from './programs-ch07.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const CODE = join(BOOK, 'code');
const skip = existsSync(join(CODE, 'chapter06', 'programs')) ? false : 'book repository not found beside this one';
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const skipPy = skip || (spawnSync(PYTHON, ['--version']).status !== 0 ? 'Python 3 not found' : false);
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const DATA = {
  t6: json('content/data/ch06-tables.json'), delays6: json('content/data/ch06-delays.json'),
  t7: ch07().t7, timing8: json('content/data/ch08-timing.json'),
};
const programs = (ch) => (skip ? [] : readdirSync(join(CODE, ch, 'programs')).filter((p) => existsSync(join(CODE, ch, 'programs', p, 'golden.hex'))));
const read = (...p) => readFileSync(join(CODE, ...p), 'utf8');
const src = (ch, name) => [{ name: `${ch}/${name}/prog.s`, text: read(ch, 'programs', name, 'prog.s') }];
const words = (text) => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseInt(l, 16) >>> 0);
const image = (ws) => ({ segments: [{ address: 0, executable: true, bytes: new Uint8Array(new Uint32Array(ws).buffer) }] });

// --- WS-F-124 ---------------------------------------------------------------------------
for (const name of programs('chapter06')) {
  test(`WS-F-124: golden-dump export of chapter06/${name} is byte-identical to golden.hex`, { skip }, () => {
    const m = new SingleCycle(DATA.t6, { ext: name === 'ext' });
    m.load(assemble(src('chapter06', name), { profile: 'ch06', subset: name === 'ext' ? 'ext' : undefined }));
    assert.equal(m.run(), 'halt');
    assert.equal(goldenText(m.golden()), read('chapter06', 'programs', name, 'golden.hex'));
  });
}
for (const p of programsCh07(BOOK)) {
  test(`WS-F-124: golden-dump export of chapter07/${p.name} is byte-identical to golden.hex`, { skip }, () => {
    const m = new Multicycle(DATA.t6, DATA.t7, { jalr: true });
    m.load(assemble([{ name: p.src, text: readFileSync(p.src, 'utf8') }], { profile: 'ch07' }));
    assert.equal(m.run(), 'halt');
    assert.equal(goldenText(m.golden()), readFileSync(join(p.dir, 'golden.hex'), 'utf8'));
  });
}
for (const name of programs('chapter08')) {
  test(`WS-F-124: golden-dump export of chapter08/${name} is byte-identical to golden.hex`, { skip }, () => {
    const m = new Pipeline(DATA.t6, { predictor: name.endsWith('_bp') ? '2bit' : 'none', entries: 8 });
    m.load(image(words(read('chapter08', 'programs', name, 'prog.hex'))));
    assert.equal(m.run(), 'halt');
    assert.equal(goldenText(m.golden()), read('chapter08', 'programs', name, 'golden.hex'));
  });
}

// --- WS-F-126 ---------------------------------------------------------------------------
for (const file of ['fact.s', 'arraysum.s', 'bytes.s']) {
  test(`WS-F-126: trace export of sim/tests/asm/${file} equals rvsim.py's JSON-lines trace`, { skip: skipPy }, () => {
    const path = join(CODE, 'sim', 'tests', 'asm', file);
    const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'ref_trace.py'), join(CODE, 'sim'), path], { encoding: 'utf8', maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr);
    const ref = JSON.parse(r.stdout);
    const prog = assemble([{ name: path, text: readFileSync(path, 'utf8') }]);
    const { records, error } = traceRecords(prog, 'iss', Infinity);
    assert.equal(error, ref.sim_error ?? null);
    const lines = traceJsonLines(records).split('\n');
    assert.equal(lines.pop(), '');
    assert.deepEqual(lines.map((l) => JSON.parse(l)), ref.trace);
    const csv = traceCsv(records).trimEnd().split('\n');
    assert.equal(csv.length, records.length + 1);
    assert.equal(csv[0], 'step,pc,word,instruction,rd,rd_value,mem_addr,mem_size,mem_value');
    // a prefix: the first k instructions only
    assert.deepEqual(traceRecords(prog, 'iss', 5).records.map((x) => x.pc), records.slice(0, 5).map((x) => x.pc));
  });
}

// --- WS-F-125 ---------------------------------------------------------------------------
/** Values of every variable at every time of a VCD, keyed by its scope path. */
function readVcd(text) {
  const ids = new Map();
  const scope = [];
  const vals = new Map();
  const at = [];
  let defs = true;
  let cur = null;
  for (const line of text.split('\n')) {
    if (defs) {
      let m;
      if ((m = /^\$scope module (\S+) \$end$/.exec(line))) scope.push(m[1]);
      else if (line === '$upscope $end') scope.pop();
      else if ((m = /^\$var wire (\d+) (\S+) (\S+)(?: \[\d+:0\])? \$end$/.exec(line))) ids.set(m[2], [...scope, m[3]].join('.'));
      else if (line === '$enddefinitions $end') defs = false;
      continue;
    }
    let m;
    if ((m = /^#(\d+)$/.exec(line))) { cur = Number(m[1]); continue; }
    if (!line || line.startsWith('$')) continue;
    if ((m = /^b([01]+) (\S+)$/.exec(line))) vals.set(ids.get(m[2]), parseInt(m[1], 2) >>> 0);
    else vals.set(ids.get(line.slice(1)), Number(line[0]));
    if (cur % 10 === 0 && vals.get(`${[...ids.values()][0]}`) === 1) at[cur / 10] = new Map(vals);
  }
  return { names: [...ids.values()], at };
}

const VCD_CASES = [
  ['chapter06', 'full', () => new SingleCycle(DATA.t6), 'ch06', SINGLE_SIGNALS, 'rv32i_single'],
  ['chapter07', 'full', () => new Multicycle(DATA.t6, DATA.t7, { jalr: true }), 'ch07', MULTI_SIGNALS, 'rv32i_multi'],
  ['chapter06', 'branch', () => new Pipeline(DATA.t6, { predictor: '2bit' }), 'ch08', [...PIPE_SIGNALS, ...PIPE_EXT_SIGNALS], 'rv32i_pipe'],
];
for (const [ch, name, make, profile, sigs, module] of VCD_CASES) {
  test(`WS-F-125: VCD of ${ch}/${name} on ${module} reads back to the model's signal values`, { skip }, () => {
    const m = make();
    m.load(assemble(src(ch, name), { profile }));
    const { frames, stop } = recordFrames(m, Infinity);
    assert.equal(stop, 'halt');
    const text = vcd(frames, sigs, { module, comment: 'test' });
    const { names, at } = readVcd(text);
    assert.equal(at.length, frames.length);
    for (const s of sigs) {
      const path = `${module}.${s.rtl ?? `model.${s.name}`}`;
      assert.ok(names.includes(path), `${path} declared`);
      frames.forEach((f, k) => assert.equal(at[k].get(path), (f[s.name] ?? 0) >>> 0, `cycle ${k}: ${path}`));
    }
    // a prefix of the run: `cycles` edges, then the current cycle
    const m2 = make();
    m2.load(assemble(src(ch, name), { profile }));
    const part = recordFrames(m2, 5);
    assert.equal(part.frames.length, 6);
    assert.deepEqual(part.frames, frames.slice(0, 6));
  });
}

// --- WS-F-060 ---------------------------------------------------------------------------
test('WS-F-060: clock periods are the chapters\' 900 ps, 410 ps and 370 ps (tab:mc-compare, tab:pipe-compare)', () => {
  assert.deepEqual(clockPeriods(DATA), { ch06: 900, ch07: 410, ch08: 370 });
});

for (const name of skip ? [] : ['branch', 'mem', 'rtype', 'full']) {
  test(`WS-F-060: comparison of chapter06/${name}: cycle counts equal the chapters' golden dumps`, { skip }, () => {
    const { rows } = compare(src('chapter06', name), DATA, { jalr: true });
    const [sc, mc, pp] = rows;
    // chapter06/mem stores to absolute addresses below 0x200: on the unified memory of
    // Chapter 7 it overwrites its own code and stops (Chapter 7 has its own mem program).
    const ok = name === 'mem' ? [sc, pp] : rows;
    for (const r of ok) assert.ok(r.ok, `${r.profile}: ${r.error} ${r.detail}`);
    if (name === 'mem') assert.equal(mc.error, 'stopped');
    assert.equal(sc.cycles, words(read('chapter06', 'programs', name, 'golden.hex'))[33]);
    if (existsSync(join(CODE, 'chapter08', 'programs', `c6${name}`, 'golden.hex'))) {
      assert.equal(pp.cycles, words(read('chapter08', 'programs', `c6${name}`, 'golden.hex'))[33]);
    }
    assert.equal(pp.agrees, true);
    if (mc.ok) assert.equal(mc.n, sc.n);
    assert.equal(pp.n, sc.n);
    assert.equal(sc.cpi, 1);
    assert.equal(sc.agrees, null);
    for (const r of ok) {
      assert.equal(r.timePs, r.cycles * r.tc);
      assert.equal(r.speedup, sc.timePs / r.timePs);
    }
    const bp = compare(src('chapter06', name), DATA, { jalr: true, predictor: '2bit' }).rows[2];
    if (existsSync(join(CODE, 'chapter08', 'programs', `c6${name}_bp`, 'golden.hex'))) {
      assert.equal(bp.cycles, words(read('chapter08', 'programs', `c6${name}_bp`, 'golden.hex'))[33]);
    }
  });
}

test('WS-F-060: without the JALR option the multicycle column reports the stop; profile errors are named', { skip }, () => {
  const { rows } = compare(src('chapter06', 'full'), DATA);
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].error, 'stopped');
  assert.equal(rows[1].speedup, null);
  const lb = compare([{ name: 'a.s', text: 'lb x1, 0(x0)\nhalt\n' }], DATA).rows;
  assert.deepEqual(lb.map((r) => [r.error, r.detail]), [['profile', 'lb'], ['profile', 'lb'], ['profile', 'lb']]);
});
