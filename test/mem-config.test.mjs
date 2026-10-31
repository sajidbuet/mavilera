// mem-config.test.mjs -- the memory setting of the interface (docs/architecture/memory-hierarchy.md D2, D5,
// D8, phase 5c): defaults, validation, defensive reading, building the MemorySystem, the memory-size and
// write-buffer switches, the share format's optional `mem`, and the view-model helpers of the memory panel.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { Cache, RamLevel } from '../src/mem/cache.js';
import { WordMemory } from '../src/core/memory.js';
import { defaultConfig, validateConfig, buildMemsys, readConfig, writeConfig, describe, CACHE_PRESETS, WORD_SIZES, fullWays } from '../src/mem/config.js';
import { createShare } from '../src/shell/share.js';
import { shareSchema } from '../src/shell/share-schema.js';
import { descriptor as riscvShare } from '../src/arch/riscv/index.js';
const { normalise, settingsFile, readSettingsFile } = createShare(shareSchema(riscvShare)); // the format with the RISC-V schema (contract v5)
import { dataAccessOf, isDirty } from '../src/ui/mem-viewmodel.js';
import { validateCache } from '../src/mem/cache.js';
import { traceCacheRun, TraceCache } from '../src/mem/trace-cache.js';
import { descriptor as riscvTrace } from '../src/arch/riscv/index.js';
/** A run of the trace-driven caches: a fresh RISC-V engine of the program, without history (contract v5). */
const traceOf = (p, profile) => ({ program: p, harvard: riscvTrace.engine.profiles.find((x) => x.id === profile).memory === 'harvard',
  create: () => riscvTrace.engine.create({ ...p, profile }, { historyLimit: 1 }) });
import { STRINGS } from '../src/ui/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));

const SRC = `        addi t0, zero, 512
        addi t1, zero, 32
        addi a0, zero, 0
loop:   sw   a0, 0(t0)
        lw   t2, 0(t0)
        add  a0, a0, t2
        addi a0, a0, 1
        addi t0, t0, 4
        addi t1, t1, -1
        bne  t1, zero, loop
        halt
`;
const program = (profile = 'ch06') => {
  const p = assemble([{ name: 't.s', text: SRC }], { profile });
  assert.deepEqual(p.errors, []);
  return p;
};

test('the default setting is ideal memory of 256 words and needs no memory system', () => {
  const d = defaultConfig();
  assert.equal(d.mode, 'ideal');
  assert.equal(d.words, 256);
  assert.deepEqual(validateConfig(d), []);
  assert.deepEqual(buildMemsys(d), { memsys: null, messages: [] }, 'the models then run exactly as before');
});

test('every cache preset and every memory size is a valid setting', () => {
  for (const p of CACHE_PRESETS) assert.deepEqual(validateCache(p), [], p.id);
  for (const w of WORD_SIZES) assert.deepEqual(validateConfig({ ...defaultConfig(), words: w }), [], String(w));
  assert.equal(WORD_SIZES.at(-1) * 4, 65536, 'up to 64 KiB (D2)');
});

test('an invalid setting cannot be activated and says why', () => {
  const d = defaultConfig();
  const noCache = { ...d, mode: 'cache', l1i: { ...d.l1i, on: false }, l1d: { ...d.l1d, on: false } };
  assert.match(validateConfig(noCache).join(' '), /instruction cache, the data cache, or both/);
  assert.equal(buildMemsys(noCache).memsys, null);
  const badWays = { ...d, mode: 'cache', l1d: { ...d.l1d, ways: 3 } };
  assert.match(validateConfig(badWays).join(' '), /L1D: ways must be a power of two/);
  const tooBig = { ...d, mode: 'cache', l1i: { ...d.l1i, size: 64, block: 64, ways: 2 } };
  assert.match(validateConfig(tooBig).join(' '), /L1I: block x ways must not exceed size/);
  assert.match(validateConfig({ ...d, mode: 'main', main: { ...d.main, busWidth: 3 } }).join(' '), /busWidth/);
  assert.match(validateConfig({ ...d, words: 300 }).join(' '), /memory size/);
});

test('readConfig: damaged or foreign text gives the default; a round trip keeps the setting', () => {
  const d = defaultConfig();
  assert.deepEqual(readConfig(null), d);
  assert.deepEqual(readConfig('{not json'), d);
  assert.deepEqual(readConfig('[]'), d);
  const c = { ...d, mode: 'cache', words: 2048, ports: 2, writeBuffer: 'ideal', l1d: { ...d.l1d, write: 'wt', alloc: 'nwa', seed: 7 } };
  assert.deepEqual(readConfig(writeConfig(c)), c);
  assert.equal(readConfig(JSON.stringify({ mode: 'turbo' })).mode, 'ideal');
  assert.equal(readConfig(JSON.stringify({ l1i: { size: 'big' } })).l1i.size, d.l1i.size);
});

test('describe: one line for each level', () => {
  const d = defaultConfig();
  assert.match(describe(d), /^Ideal memory/);
  assert.match(describe({ ...d, mode: 'main' }), /^Without cache: main memory 1\+4\/4 cycles, 4-byte bus/);
  assert.match(describe({ ...d, mode: 'cache' }), /^With cache: L1I 1 KiB direct-mapped, L1D 1 KiB 2-way; /);
  assert.equal(fullWays(256, 16), 16);
});

test('memory size (D2): a larger memory holds a program that needs it, and ideal timing is unchanged', () => {
  const big = { ...defaultConfig(), words: 4096 };
  const { memsys } = buildMemsys(big);
  assert.equal(memsys.memWords, 4096);
  const m = new SingleCycle(T6, { memsys });
  assert.equal(m.words, 4096);
  m.load(program());
  assert.equal(m.run(), 'halt');
  const plain = new SingleCycle(T6);
  plain.load(program());
  assert.equal(plain.run(), 'halt');
  assert.equal(m.cycle, plain.cycle, 'ideal memory of another size adds no cycles');
  assert.deepEqual(Array.from(m.x), Array.from(plain.x));
  // a store beyond 256 words does not wrap in the larger memory
  const probe = new SingleCycle(T6, { memsys: buildMemsys(big).memsys });
  probe.load({ segments: [] });
  probe.dmem.write(0x2000, 4, 0xabcd);
  assert.equal(probe.dmem.read(0x2000, 4), 0xabcd);
  assert.equal(probe.dmem.read(0x0, 4), 0);
});

test('write buffer (D5): ideal absorbs write costs, never changes the results, and charges less than none', () => {
  const d = defaultConfig();
  const cfg = (wb) => ({ ...d, mode: 'cache', words: 1024, writeBuffer: wb,
    l1i: { ...d.l1i, size: 256 }, l1d: { ...d.l1d, size: 64, block: 16, ways: 1, write: 'wb' } }); // a tiny D cache: dirty evictions
  const run = (wb) => {
    const { memsys, messages } = buildMemsys(cfg(wb));
    assert.deepEqual(messages, []);
    const m = new Pipeline(T6, { memsys });
    m.load(program('ch08'));
    assert.equal(m.run(), 'halt');
    return { m, memsys };
  };
  const none = run('none');
  const ideal = run('ideal');
  assert.deepEqual(Array.from(none.m.x), Array.from(ideal.m.x));
  assert.ok(none.memsys.report().D.writebacks > 0, 'the tiny cache evicts dirty lines');
  assert.ok(ideal.m.cycle < none.m.cycle, `ideal ${ideal.m.cycle} < charged ${none.m.cycle}`);
  assert.equal(none.memsys.report().D.hits, ideal.memsys.report().D.hits, 'the counts are the same: only the cost differs');
  assert.equal(validateConfig({ ...cfg('none'), writeBuffer: 'maybe' }).length, 0, 'the setting object is checked by configure');
  assert.equal(buildMemsys({ ...cfg('none'), writeBuffer: 'maybe' }).memsys, null);
});

test('the memory model is an optional part of the share format; an older file reads as ideal', () => {
  const base = { source: 'nop', view: 'single', profile: 'ch06' };
  assert.equal('mem' in normalise(base), false, 'no memory model, no key (links stay short)');
  const cfg = { ...defaultConfig(), mode: 'main' };
  const back = readSettingsFile(settingsFile({ ...base, mem: cfg }));
  assert.deepEqual(back.mem, cfg);
  const old = readSettingsFile(settingsFile(base));
  assert.equal(old.mem, undefined);
});

test('dataAccessOf: loads and stores of the base ISA give their address and size; other instructions none', () => {
  const p = assemble([{ name: 't.s', text: 'lw t0, 8(a0)\nsb t1, -4(a1)\nlhu t2, 2(a2)\nadd t0, t0, t1\nsw t3, 12(a0)\n' }], { profile: 'iss' });
  assert.deepEqual(p.errors, []);
  const words = p.listing.map((l) => l.word);
  const x = new Uint32Array(32);
  x[10] = 0x1000; x[11] = 0x2000; x[12] = 0x3001;
  assert.deepEqual(dataAccessOf(words[0], x), { addr: 0x1008, size: 4, store: false });
  assert.deepEqual(dataAccessOf(words[1], x), { addr: 0x1ffc, size: 1, store: true });
  assert.deepEqual(dataAccessOf(words[2], x), { addr: 0x3003, size: 2, store: false });
  assert.equal(dataAccessOf(words[3], x), null);
  assert.deepEqual(dataAccessOf(words[4], x), { addr: 0x100c, size: 4, store: true });
});

test('isDirty: a word in a dirty line is stale in RAM; a clean line or no line is not', () => {
  const ram = new WordMemory(1024);
  const c = new Cache({ size: 256, block: 16, ways: 1, write: 'wb' }, new RamLevel(ram), 'L1D');
  c.access('read', 0x40, 4);
  assert.equal(isDirty([c], 0x40), false);
  c.access('write', 0x44, 4, 0x1234);
  assert.equal(isDirty([c], 0x44), true);
  assert.equal(isDirty([c], 0x40), true, 'the whole line is dirty');
  assert.equal(isDirty([c], 0x80), false, 'not held');
  assert.equal(isDirty([null, c], 0x44), true);
  assert.equal(ram.read(0x44, 4), 0, 'write-back: RAM is out of date until the line leaves');
});

test('every string the memory interface uses exists', () => {
  const src = ['mem-ui.js', 'cache-view.js'].map((n) => readFileSync(join(ROOT, 'src', 'ui', n), 'utf8')).join('\n');
  const used = [...src.matchAll(/\bM\(\)\.(\w+)/g)].map((m) => m[1]);
  assert.ok(used.length > 40);
  for (const k of new Set(used)) assert.ok(k in STRINGS.mem, `STRINGS.mem.${k}`);
  const cv = [...src.matchAll(/\bV\.(\w+)/g)].map((m) => m[1]);
  assert.ok(cv.length > 25);
  for (const k of new Set(cv)) assert.ok(k in STRINGS.mem.cv, `STRINGS.mem.cv.${k}`);
  for (const k of ['panel', 'tabMemory', 'tabCache', 'tabPeripherals', 'link', 'openPanel', 'buttonTitle', 'applied', 'describeIdeal', 'invalidSaved', 'waitCycles']) {
    assert.ok(k in STRINGS.mem, `STRINGS.mem.${k}`);
  }
});

test('trace-driven cache counts of the instruction-level view equal those of the single-cycle processor (no timing)', () => {
  const d = defaultConfig();
  const cfg = { ...d, mode: 'cache', words: 1024, l1i: { ...d.l1i, size: 256 }, l1d: { ...d.l1d, size: 64, block: 16, ways: 1 } };
  const r = traceCacheRun(traceOf(program('ch06'), 'ch06'), cfg);
  assert.equal(r.stop, 'halt');
  const { memsys } = buildMemsys(cfg);
  const m = new SingleCycle(T6, { memsys });
  m.load(program('ch06'));
  assert.equal(m.run(), 'halt');
  const timed = memsys.report();
  for (const k of ['accesses', 'reads', 'writes', 'hits', 'misses', 'compulsory', 'capacity', 'conflict', 'fills', 'evictions', 'writebacks']) {
    assert.equal(r.caches.D.report()[k], timed.D[k], `L1D ${k}`);
  }
  // the instruction-level simulator also fetches the halt word, which a processor never completes: one more fetch, a hit
  assert.equal(r.caches.I.report().accesses, timed.I.accesses + 1);
  assert.equal(r.caches.I.report().misses, timed.I.misses);
  assert.equal(r.instructions, m.cycle - memsys.stats.waitCycles);
  assert.ok(r.caches.D.report().writebacks > 0, 'the small data cache evicts dirty lines');
  assert.equal(traceCacheRun(traceOf(program('ch06'), 'ch06'), { ...cfg, l1d: { ...cfg.l1d, on: false } }).caches.D, null);
});
test('the instruction-level view follows its position: advancing in pieces equals one run, a replay to the same point equals it too', () => {
  const d = defaultConfig();
  const cfg = { ...d, mode: 'cache', words: 1024, l1i: { ...d.l1i, size: 256 }, l1d: { ...d.l1d, size: 64, block: 16, ways: 1 } };
  const whole = traceCacheRun(traceOf(program('ch06'), 'ch06'), cfg, 10);
  const piece = new TraceCache(traceOf(program('ch06'), 'ch06'), cfg);
  piece.advanceTo(4).advanceTo(7).advanceTo(10);
  const again = new TraceCache(traceOf(program('ch06'), 'ch06'), cfg).advanceTo(10);
  for (const k of ['I', 'D']) {
    assert.deepEqual(piece.caches[k].report(), whole.caches[k].report());
    assert.deepEqual(again.caches[k].report(), whole.caches[k].report());
  }
  assert.equal(piece.retired, 10);
});
test('a cache remembers its last access for the viewer, and a back-step restores it', () => {
  const ram = new WordMemory(1024);
  const c = new Cache({ size: 64, block: 16, ways: 1, write: 'wb' }, new RamLevel(ram), 'L1D');
  const undo = [];
  c.onUndo = (fn) => undo.push(fn);
  assert.equal(c.last, null);
  c.access('write', 0x40, 4, 7);
  assert.deepEqual([c.last.op, c.last.hit, c.last.kind, c.last.filled, c.last.set, c.last.way, c.last.block], ['write', false, 'compulsory', true, 0, 0, 0x40]);
  c.access('read', 0x44, 4);
  assert.deepEqual([c.last.hit, c.last.filled], [true, false]);
  c.access('read', 0x80, 4); // same set, direct-mapped: evicts the dirty block 0x40
  assert.equal(c.last.evicted, 0x40);
  assert.equal(c.last.evictedDirty, true);
  undo.pop()();
  assert.equal(c.last.hit, true, 'the access before is the last again');
  undo.pop()();
  assert.equal(c.last.filled, true);
  undo.pop()();
  assert.equal(c.last, null);
});