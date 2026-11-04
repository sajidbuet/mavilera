// npu-curriculum.test.mjs -- NPU-4 (gate K of docs/research/gpu-npu/roadmaps/NPU_DEVELOPMENT_ROADMAP.md): the
// analytical models of Chapter 11 against the chapter's worked examples (WE 11.1, 11.5, 11.8, the quantisation
// example), the book's tables as exported (content/data/ch11-tables.json), the CPU/NPU comparison (Table 11.5) from
// MAVILERA's own runs of the templates, and the offload breakdown of WE 11.9 from the instruction classification.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { amdahl, ridge, roofline, intensity, fcLayer, conv3x3, accumulator, quantParams, quantise, roundHalfAway } from '../src/core/analytic.js';
import { classify, breakdown, operands, noArrayTime, OFFLOAD_CLASSES } from '../src/arch/riscv/offload.js';
import { labComparison, labDataBytes, measureLab, perVector } from '../src/arch/riscv/lab-compare.js';
import { parseHexWords } from '../src/shell/data-io.js';
import { assemble } from '../src/asm/assembler.js';
import { parseExercise, runExercise } from '../src/core/exercise.js';
import { ROOT } from './npu-fixtures.mjs';

const T = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch11-tables.json'), 'utf8'));
const template = (f) => readFileSync(join(ROOT, 'content', 'templates', f), 'utf8');
const SOURCES = { shiftAdd: template('sw-mv.s'), mul: template('sw-mv-m.s'), npu: template('npu-mv.s') };
const round = (v, d) => Number(v.toFixed(d));
const machine = (name) => T.machines.find((m) => m.name === name);

test('ch11-tables.json is what tools/npu/ch11-tables.mjs writes (data sets rebuilt from the fixtures)', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'npu', 'ch11-tables.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('the exported book values: Table 11.3, FIG-0115 kernels, FIG-0106 fractions, Table 11.5', () => {
  assert.deepEqual(T.machines.map((m) => [m.name, m.peak, m.bandwidth, ridge(m)]), [['CPU', 100, 50, 2], ['GPU', 2000, 500, 4], ['NPU', 4000, 100, 40]]);
  assert.deepEqual(T.kernels.map((k) => k.intensity), [0.0833, 1.96, 85.3]);
  assert.deepEqual(T.amdahl_fractions, [0.9, 0.95, 0.99]);
  assert.deepEqual(T.lab_cycles.map((c) => [c.vectors, c.shiftAdd, c.mul, c.npu]), [[1, 821, 209, 51], [4, 3718, 818, 153], [16, 15646, 3254, 561]]);
});

test('the data sets v1, v4, v16 rebuilt from the table equal the book\'s data.hex', () => {
  for (const n of [1, 4, 16]) {
    const want = parseHexWords(readFileSync(join(ROOT, 'test', 'fixtures', 'npu', 'ch11', 'data', `v${n}`, 'data.hex'), 'utf8'));
    assert.deepEqual(Array.from(labDataBytes(T, n)), Array.from(want), `v${n}`);
  }
});

test('WE 11.1 and FIG-0106: parallel Amdahl, f = 0.95 on 4, 64, 1024 lanes; the curves at 1024 lanes', () => {
  const at = (n) => amdahl(0.95, n);
  assert.equal(round(at(4).S, 2), 3.48); assert.equal(round(at(4).efficiency, 2), 0.87);
  assert.equal(round(at(64).S, 1), 15.4); assert.equal(round(at(64).efficiency, 2), 0.24);
  assert.equal(round(at(1024).S, 1), 19.6); assert.equal(round(at(1024).efficiency, 3), 0.019);
  assert.equal(round(at(4).ceiling, 6), 20);
  assert.equal(round(at(1024).S / at(64).S - 1, 2), 0.27, 'sixteen times the lanes gain 27 %');
  assert.deepEqual(T.amdahl_fractions.map((f) => round(amdahl(f, 1024).S, 1)), [9.9, 19.6, 91.2], 'FIG-0106 alt text');
  assert.equal(amdahl(1, 8).ceiling, Infinity);
  assert.throws(() => amdahl(1.2, 4), RangeError);
});

test('WE 11.8: vector addition and the 256 x 256 INT8 matrix-vector product on the CPU and the NPU of Table 11.3', () => {
  const cpu = machine('CPU'), npu = machine('NPU');
  const Ia = intensity(1, 12);
  assert.equal(round(Ia, 3), 0.083);
  assert.equal(round(roofline(cpu, Ia).P, 1), 4.2);
  assert.equal(round(roofline(npu, Ia).P, 1), 8.3);
  assert.equal(roofline(cpu, Ia).bound, 'memory'); assert.equal(roofline(npu, Ia).bound, 'memory');
  const ops = 2 * 256 ** 2, bytes = 256 ** 2 + 256 + 4 * 256;
  assert.deepEqual([ops, bytes], [131072, 66816]);
  const Ib = intensity(ops, bytes);
  assert.equal(round(Ib, 2), 1.96);
  assert.equal(Math.round(roofline(cpu, Ib).P), 98);
  assert.equal(Math.round(roofline(npu, Ib).P), 196);
  assert.equal(Math.round(100 * roofline(npu, Ib).fraction), 5, '5 % of the NPU\'s peak');
  // FIG-0115 alt text: vector addition memory-bound on all three; the matrix product compute-bound on all three
  for (const m of T.machines) {
    assert.equal(roofline(m, T.kernels[0].intensity).bound, 'memory', m.name);
    assert.equal(roofline(m, T.kernels[2].intensity).bound, 'compute', m.name);
  }
});

test('FIG-0112 and WE 11.5: MACs of a layer, accumulator width of INT8 products', () => {
  assert.deepEqual(fcLayer(64, 10), { macs: 640, ops: 1280, weights: 640, inputs: 64, outputs: 10 });
  const a = accumulator(64);
  assert.equal(a.productBits, 16);
  assert.equal(a.maxProduct, 2 ** 14);
  assert.equal(a.maxSum, 2 ** 20);
  assert.equal(a.minSum, -1040384);
  assert.equal(a.width, 22);
  assert.equal(a.capacity, 131071);
  assert.ok(a.fits);
  assert.equal(accumulator(1).width, 16, 'one product needs 16 bits');
  const c = conv3x3(3, 8, 100);
  assert.deepEqual([c.rows, c.cols, c.weights, c.macs], [8, 27, 216, 21600]);
  assert.throws(() => fcLayer(0, 10), RangeError);
});

test('the quantisation example: S = 4/255, Z = -64, 1.0 stored as 0, representing 1.004', () => {
  const p = quantParams(-1, 3);
  assert.equal(round(p.S, 5), 0.01569);
  assert.equal(round(p.zReal, 2), -64.25);
  assert.equal(p.Z, -64);
  assert.ok(p.zeroExact);
  const q = quantise(p, 1);
  assert.equal(q.q, 0);
  assert.equal(round(q.back, 3), 1.004);
  assert.ok(Math.abs(q.error) < p.S / 2, 'the rounding error is below S/2');
  assert.equal(quantise(p, 10).q, 127); assert.ok(quantise(p, 10).clamped);
  assert.deepEqual([roundHalfAway(2.5), roundHalfAway(-2.5), roundHalfAway(-0.25)], [3, -3, 0]);
});

/** The instruction words of a source (profile iss). */
function code(text) {
  const p = assemble([{ name: 'a.s', text }], { profile: 'iss' });
  assert.ok(p.ok, p.errors.map((e) => e.message).join('; '));
  const b = p.segments.find((s) => s.executable).bytes;
  return Array.from({ length: b.length / 4 }, (_, i) => new DataView(b.buffer, b.byteOffset).getUint32(4 * i, true));
}

test('operand use: data versus address registers', () => {
  const [sw, lw, beq] = code(['a: sw t1, 4(s4)', 'lw t1, 4(s1)', 'beq t1, zero, a'].join('\n'));
  assert.deepEqual(operands(sw), { rd: 0, data: [6], addr: [20], kind: 'store' });
  assert.deepEqual(operands(lw), { rd: 6, data: [], addr: [9], kind: 'load' });
  assert.deepEqual(operands(beq).data, [6]);
});

test('Table 11.5 and FIG-0116 from MAVILERA\'s runs of the three templates: every cycle count and speed-up equal', () => {
  const rows = labComparison(SOURCES, T);
  for (const r of rows) {
    for (const k of ['shiftAdd', 'mul', 'npu']) assert.equal(r.mavilera[k], r.book[k], `v${r.vectors} ${k}`);
    assert.equal(round(r.mavilera.speedupShiftAdd, 1), r.book.speedupShiftAdd, `v${r.vectors}`);
    assert.equal(round(r.mavilera.speedupMul, 1), r.book.speedupMul, `v${r.vectors}`);
  }
  // WE 11.9 (a): cycles per vector between 4 and 16 vectors
  const c = (n, k) => rows.find((r) => r.vectors === n).mavilera[k];
  assert.deepEqual(['shiftAdd', 'mul', 'npu'].map((k) => perVector(c(4, k), 4, c(16, k), 16)), [994, 203, 34]);
});

test('WE 11.9 (b): the classification gives 9 send/start + 12 polling + 8 copy + 5 loop control, 13 NPU transactions, 4 polls', () => {
  for (const n of [4, 16]) {
    const m = measureLab(SOURCES.npu, T, n);
    const v = m.breakdown.perVector;
    assert.ok(v, `v${n}: every vector interval the same`);
    assert.deepEqual(v.counts, { weights: 0, send: 9, poll: 12, copy: 8, marker: 0, control: 5 }, `v${n}`);
    assert.equal(v.cycles, 34); assert.equal(v.npu, 13); assert.equal(v.polls, 4);
    assert.equal(m.breakdown.starts, n);
    // the weight-load span (marker 1 to 2): 8 instructions move the weights, 2 are the markers
    assert.deepEqual(m.breakdown.spans[0].counts, { weights: 8, send: 0, poll: 0, copy: 0, marker: 2, control: 0 });
    assert.equal(m.breakdown.spans[0].cycles, 10);
  }
  const one = measureLab(SOURCES.npu, T, 1);
  assert.equal(one.breakdown.perVector, null, 'one vector: no interval between two starts');
  assert.equal(one.cycles, 51);
});

test('classification rules on a hand-made trace: a value used as an address is control, a value only stored is its store\'s class', () => {
  const NPU = 0x50000000, GPIO = 0x40000000;
  // x5 <- lw RAM; sw x5 -> ACT (send); x6 <- lw STATUS (poll); andi x6 (poll); beq x6 (poll);
  // x7 <- lw RESULT (copy); sw x7 -> RAM (copy); x8 <- addi (used as an address: control); sw x0 -> 0(x8)
  const src = ['a: lw x5, 0(x0)', 'sw x5, 32(x9)', 'lw x6, 4(x9)', 'andi x6, x6, 2', 'beq x6, x0, a', 'lw x7, 48(x9)',
    'sw x7, 4(x0)', 'addi x8, x0, 8', 'sw x0, 0(x8)'].join('\n');
  const words = code(src);
  const access = [[0x0, null], [null, NPU + 0x20], [NPU + 4, null], [null, null], [null, null], [NPU + 0x30, null],
    [null, 4], [null, null], [null, 8]];
  const steps = words.map((word, i) => ({ word, cycle: i, load: access[i][0], store: access[i][1] === null ? null : { addr: access[i][1], value: 1 } }));
  const cls = classify(steps, { npuBase: NPU, gpioBase: GPIO });
  assert.deepEqual(cls, ['send', 'send', 'poll', 'poll', 'poll', 'copy', 'copy', 'control', 'control']);
  const b = breakdown(steps, cls, [], { npuBase: NPU });
  assert.equal(b.total, steps.length);
  assert.deepEqual(Object.keys(b.all), OFFLOAD_CLASSES);
});

test('exercise format: the laboratory profile (ch11) and a cycle budget; unknown profiles and C on ch11 refused', () => {
  const base = { format: 'risc-vista-exercise', version: 1, title: 't', tests: [{ name: 'a', expect: { registers: { t0: 1 }, maxCycles: 4 } }] };
  assert.equal(parseExercise(base).profile, 'iss');
  const ex = parseExercise({ ...base, profile: 'ch11' });
  assert.equal(ex.profile, 'ch11');
  assert.throws(() => parseExercise({ ...base, profile: 'ch06' }), /unknown profile/);
  assert.throws(() => parseExercise({ ...base, profile: 'ch11', lang: 'c' }), /assembly only/);
  // reads STATUS of the NPU (only on the laboratory profile's bus), then halts
  const p = assemble([{ name: 'a.s', text: ['li s1, 0x50000000', 'lw t0, 4(s1)', 'addi t0, t0, 1', 'halt'].join('\n') }], { profile: 'ch11' });
  assert.ok(p.ok);
  const [r] = runExercise(p, ex);
  assert.ok(r.pass, JSON.stringify(r));
  assert.deepEqual(r.checks.map((c) => c.what), ['t0', 'cycles']);
  const [slow] = runExercise(p, parseExercise({ ...base, profile: 'ch11', tests: [{ name: 'b', expect: { maxCycles: 2 } }] }));
  assert.ok(!slow.pass, 'over the budget');
});

test('WE 11.9 (c): an infinitely fast array leaves 25 cycles per vector, a speed-up of only 1.36; NPU accesses 17, 56, 212', () => {
  const m = measureLab(SOURCES.npu, T, 16);
  const r = noArrayTime(m.breakdown.perVector);
  assert.equal(r.pass, 3, 'one pass of the polling loop: lw, andi, beq');
  assert.equal(r.cycles, 25);
  assert.equal(round(r.ratio, 2), 1.36);
  assert.equal(noArrayTime(null), null);
  assert.deepEqual([1, 4, 16].map((n) => measureLab(SOURCES.npu, T, n).npu.accesses), [17, 56, 212]);
  // the laboratory bus roof's point for v4 (Analysis view): 2 x 16 operations per start, 4 bytes per NPU access
  const v4 = measureLab(SOURCES.npu, T, 4);
  assert.deepEqual([2 * 16 * v4.breakdown.starts, 4 * v4.npu.accesses, v4.cycles], [128, 224, 153]);
});
