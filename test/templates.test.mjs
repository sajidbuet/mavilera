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
import { compare, compareMemory } from '../src/uarch/compare.js';
import { traceCacheRun } from '../src/mem/trace-cache.js';
import { descriptor as riscvTrace } from '../src/arch/riscv/index.js';
/** A run of the trace-driven caches: a fresh RISC-V engine of the program, without history (contract v5). */
const traceOf = (p, profile) => ({ program: p, harvard: riscvTrace.engine.profiles.find((x) => x.id === profile).memory === 'harvard',
  create: () => riscvTrace.engine.create({ ...p, profile }, { historyLimit: 1 }) });
import { readConfig, validateConfig } from '../src/mem/config.js';
import { parseStimulus } from '../src/mem/platform.js';
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
  // the cache templates: the counts and cycles their headers state (cache-*.s, memory setting in the index)
  'cache-spatial': () => {
    const r = cacheRun('cache-spatial'); const d = r.caches.D.report();
    assert.equal(exitOf(r.h), 528);
    assert.deepEqual([d.accesses, d.misses, d.hits, d.compulsory], [32, 8, 24, 8]);
  },
  'cache-stride': () => {
    const r = cacheRun('cache-stride'); const d = r.caches.D.report();
    assert.equal(exitOf(r.h), 16);
    assert.deepEqual([d.accesses, d.misses, d.compulsory], [16, 16, 16]);
    const s4 = cacheRun('cache-stride', { text: src('cache-stride.s').replace('li   s1, 16 ', 'li   s1, 4  ') });
    assert.equal(exitOf(s4.h), 64, 'the change the header suggests');
    assert.deepEqual([s4.caches.D.report().accesses, s4.caches.D.report().misses], [64, 16]);
  },
  'cache-conflict': () => {
    const r = cacheRun('cache-conflict'); const d = r.caches.D.report();
    assert.equal(exitOf(r.h), 396);
    assert.deepEqual([d.accesses, d.misses, d.compulsory, d.conflict], [16, 16, 4, 12]);
    const two = cacheRun('cache-conflict', { d: { ways: 2 } }).caches.D.report();
    assert.deepEqual([two.misses, two.compulsory, two.conflict], [4, 4, 0], 'with a second way only the compulsory misses remain');
  },
  'cache-writeback': () => {
    const r = cacheRun('cache-writeback'); const d = r.caches.D.report();
    assert.equal(exitOf(r.h), 36);
    assert.deepEqual([d.writes, d.misses, d.writebacks, d.writeThroughs], [8, 4, 2, 0]);
    const wt = cacheRun('cache-writeback', { d: { write: 'wt' } }).caches.D.report();
    assert.deepEqual([wt.writeThroughs, wt.writebacks], [8, 0], 'write-through: no dirty lines');
  },
  'cache-replacement': () => {
    const lru = cacheRun('cache-replacement'); const fifo = cacheRun('cache-replacement', { d: { repl: 'fifo' } });
    assert.equal(exitOf(lru.h), 42);
    assert.deepEqual([lru.caches.D.report().accesses, lru.caches.D.report().misses, fifo.caches.D.report().misses], [24, 13, 18]);
  },
  'cache-pipe': () => {
    const rows = memoryRows('cache-pipe.s', 'cache-pipe').rows.filter((x) => x.profile === 'ch08');
    const [a, b, c] = ['A', 'B', 'C'].map((s) => rows.find((x) => x.scenario === s));
    assert.ok(rows.every((x) => x.ok && x.sameResult !== false), JSON.stringify(rows));
    assert.ok(a.cycles < c.cycles && c.cycles < b.cycles, `A ${a.cycles} < C ${c.cycles} < B ${b.cycles}`);
    assert.ok(b.cycles > 3 * c.cycles, `without a cache: ${b.cycles} against ${c.cycles}`);
  },
  'cache-speedup': () => {
    const { rows, ratios } = memoryRows('cache-speedup.s', 'cache-speedup');
    assert.ok(rows.every((x) => x.ok && x.sameResult !== false), JSON.stringify(rows));
    for (const p of ['ch06', 'ch07', 'ch08']) assert.ok(ratios.perProcessor[p].cOverB < 0.5 && ratios.perProcessor[p].cOverA > 1, `${p}: ${JSON.stringify(ratios.perProcessor[p])}`);
  },
  // the device templates (profile iss-priv): what their headers say happens, with the template's own stimulus
  'gpio-leds': () => {
    const r = priv('gpio-leds');
    assert.equal(r.h.platform.gpio.out, 0xf5);
    assert.equal(r.h.traps, 0);
  },
  'gpio-switches': () => {
    const r = priv('gpio-switches');
    assert.equal(r.h.platform.gpio.out, 0xa, 'the switches at the button press: 1010');
    assert.ok(r.h.cycle > 300 && r.h.cycle < 400, `ends soon after the button at cycle 300 (${r.h.cycle})`);
    const none = priv('gpio-switches', { stimulus: '' }, 5000);
    assert.equal(none.h.halted, false, 'without the button the program polls for ever');
  },
  'button-interrupt': () => {
    const r = priv('button-interrupt');
    assert.equal(r.x(9), 3);
    assert.equal(r.h.platform.gpio.out, 3);
    assert.deepEqual(r.h.report().priv.traps, { '0x8000000b': 3 });
    const ev = r.h.report().priv.interrupts.button;
    assert.deepEqual([ev.events, ev.taken, ev.acked], [3, 3, 3]);
    assert.ok(ev.to_handler.max <= 10, `a short latency to the handler: ${JSON.stringify(ev.to_handler)}`);
    assert.ok(r.h.idleCycles > 500, 'most of the time is spent in wfi');
  },
  'timer-poll': () => {
    const r = priv('timer-poll');
    assert.equal(r.x(18), 6);
    assert.equal(r.h.platform.gpio.out, 0, 'six flips of LED 0');
    assert.ok(r.h.cycle >= 300, `six delays of 50: ${r.h.cycle} cycles`);
    assert.equal(r.h.idleCycles, 0, 'polling is busy, not idle');
  },
  'timer-interrupt': () => {
    const r = priv('timer-interrupt');
    assert.equal(r.x(9), 5);
    assert.equal(r.h.platform.gpio.out, 1, 'five flips of LED 0');
    assert.deepEqual(r.h.report().priv.traps, { '0x80000007': 5 });
    assert.equal(r.h.report().priv.interrupts.timer.events, 5);
    assert.ok(r.h.idleCycles > 300);
    assert.ok(r.h.cycle >= 500 && r.h.cycle < 600, `five ticks of 100 cycles: ${r.h.cycle}`);
  },
  'ecall-trap': () => {
    const r = priv('ecall-trap');
    assert.equal(r.x(9), 42);
    assert.equal(r.x(18), -1);
    assert.equal(String.fromCharCode(...r.h.platform.uart.tx), 'Hi');
    assert.deepEqual(r.h.report().priv.traps, { '0x0000000b': 4 }, 'four ecalls, all from M mode');
  },
  'uart-hello': () => {
    const r = priv('uart-hello');
    assert.equal(String.fromCharCode(...r.h.platform.uart.tx), 'Hello, UART!\nok');
    assert.equal(r.h.platform.uart.flags, 0, 'no byte was lost: the program waits for TX ready');
    const rude = priv('uart-hello', { txCycles: 20, text: src('uart-hello.s').replace('txwait: lw   t1, 8(s0)          # STATUS\n        andi t1, t1, 1          # TX ready?\n        beqz t1, txwait\n', 'txwait:\n') });
    assert.ok(rude.h.platform.uart.flags & 4, 'without waiting, bytes are lost (TXOVR)');
    assert.ok(rude.h.platform.uart.tx.length < 13 + 2, 'and the text is cut short');
  },
};

/** A device template on the instruction-level machine with traps: its own stimulus unless given; run to the halt (or `limit` steps). */
function priv(id, { text = null, stimulus = null, txCycles = 4 } = {}, limit = 200_000) {
  const t = INDEX.templates.find((x) => x.id === id);
  assert.equal(t.profile, 'iss-priv', `${id} names its profile`);
  const p = assemble([{ name: t.file, text: text ?? src(t.file) }], { profile: 'iss-priv' });
  assert.ok(p.ok && !p.profileErrors.length, `${id}: ${[...p.errors, ...p.profileErrors].map((e) => e.message).join('; ')}`);
  const platformConfig = { stimulus: parseStimulus(stimulus ?? t.stimulus ?? ''), rx: (t.rx ?? []).map((e) => ({ ...e })), mtimeDiv: 1, uart: true, txCycles };
  const h = new Hart(p, { profile: 'iss-priv', platformConfig });
  while (!h.halted && h.instret + h.traps < limit) h.stepFast();
  if (limit === 200_000) assert.ok(h.halted, `${id} halts`);
  return { h, x: (r) => h.x[r] | 0 };
}

/** An instruction-level run under the cache setting of the template; `d` or `i` change the cache's fields. */
function cacheRun(id, { text = null, d = {}, i = {} } = {}) {
  const t = INDEX.templates.find((x) => x.id === id);
  const cfg = readConfig(t.mem);
  Object.assign(cfg.l1d, d);
  Object.assign(cfg.l1i, i);
  assert.deepEqual(validateConfig(cfg), [], `${id}: its memory setting is valid`);
  const p = assemble([{ name: t.file, text: text ?? src(t.file) }], { profile: 'iss' });
  assert.ok(p.ok, `${id}: ${p.errors.map((e) => e.message).join('; ')}`);
  const r = traceCacheRun(traceOf(p, 'iss'), cfg);
  assert.equal(r.stop, 'halt', `${id} halts`);
  const h = new Hart(p, { profile: 'iss' });
  while (!h.halted && h.instret < 100_000) h.stepFast();
  return { ...r, h };
}

/** The three processors under memory models A, B and C, with the template's setting. */
function memoryRows(file, id) {
  const cfg = readConfig(INDEX.templates.find((x) => x.id === id).mem);
  assert.deepEqual(validateConfig(cfg), [], `${id}: its memory setting is valid`);
  return compareMemory([{ name: file, text: src(file) }], { t6: T6, delays6: json('content/data/ch06-delays.json'), t7: T7, timing8: json('content/data/ch08-timing.json') }, cfg, { jalr: true });
}

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

test('the templates are numbered by their place in the index: the device templates are 22 to 28, the cache templates 29 to 35', () => {
  const at = (id) => INDEX.templates.findIndex((t) => t.id === id) + 1;
  assert.deepEqual(['gpio-leds', 'gpio-switches', 'button-interrupt', 'timer-poll', 'timer-interrupt', 'ecall-trap', 'uart-hello'].map(at), [22, 23, 24, 25, 26, 27, 28]);
  assert.deepEqual(['cache-spatial', 'cache-speedup'].map(at), [29, 35]);
  assert.equal(INDEX.templates.length, 35);
});

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
