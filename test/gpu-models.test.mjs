// The analytical models of the GPU module's Models view (GPU-4, gate K; tests A2-A4 of docs/research/gpu-npu/
// verification/GOLDEN_TESTS.md): src/arch/gpu/models.js against the worked examples and the figures of the GPU
// chapter (student-facing values only; exercise answers are instructor material and are not used here).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fourMachines, allowedVl, strips, vlmaxOf, launch, locate, assignBlocks, warpsNeeded, schedule, occupancy, coalesce, bankAccess }
  from '../src/arch/gpu/models.js';

test('one loop, four machines: 8, 2, 1 and 1 instructions for eight elements', () => {
  const m = fourMachines(8, 4, 8, 8);
  assert.deepEqual([m.scalar.instructions, m.packed.instructions, m.vector.instructions, m.simt.instructions], [8, 2, 1, 1]);
  assert.equal(m.simt.lastMask, '11111111');
  const r = fourMachines(10, 4, 8, 8); // a remainder: two packed, two scalar; two strips; two warps, the second 2 of 8
  assert.deepEqual(r.packed.frames.map((f) => f.kind), ['packed', 'packed', 'scalar', 'scalar']);
  assert.equal(r.packed.remainder, 2);
  assert.deepEqual([r.vector.instructions, r.simt.warps, r.simt.lastMask], [2, 2, '11000000']);
});

test('A2 strips: n = 19, VLMAX = 8 gives (19, 8) (11, 8) (3, 3); the permitted range at AVL 11 is 6 to 8', () => {
  assert.deepEqual(strips(19, 8).map((s) => [s.avl, s.vl]), [[19, 8], [11, 8], [3, 3]]);
  assert.deepEqual(allowedVl(11, 8), { lo: 6, hi: 8 });
  assert.deepEqual(allowedVl(3, 8), { lo: 3, hi: 3 });
  assert.deepEqual(allowedVl(16, 8), { lo: 8, hi: 8 });
  // the smallest permitted vl: 6 in strip 2, then a strip of 5; still exactly 19 elements
  const s = strips(19, 8, 'min');
  assert.deepEqual(s.map((x) => x.vl), [8, 6, 5]);
  assert.equal(s.reduce((a, x) => a + x.vl, 0), 19);
  assert.equal(vlmaxOf(256, 32), 8);
  for (let n = 1; n <= 80; n++) for (const v of [1, 3, 8, 16]) for (const p of ['max', 'min']) {
    const t = strips(n, v, p);
    assert.equal(t.reduce((a, x) => a + x.vl, 0), n);
    for (const x of t) assert.ok(x.vl >= x.lo && x.vl <= x.hi && x.vl >= 1);
  }
});

test('the tail of a launch: n = 1000, blocks of 256, warps of 32', () => {
  const l = launch(1000, 256, 32);
  assert.deepEqual([l.blocks, l.threads, l.warps, l.warpsPerBlock, l.idle], [4, 1024, 32, 8, 24]);
  assert.equal(l.partial.length, 1);
  assert.deepEqual([l.partial[0].block, l.partial[0].warp, l.partial[0].from, l.partial[0].active], [3, 7, 992, 8]);
  assert.equal(l.partial[0].mask, '1'.repeat(8) + '0'.repeat(24));
});

test('thread indexing figure: n = 21, blocks of 8, warps of 4; block 2, thread 5 is i = 21', () => {
  const l = launch(21, 8, 4);
  assert.deepEqual([l.blocks, l.threads, l.idle], [3, 24, 3]);
  assert.deepEqual(l.partial.map((p) => [p.block, p.warp, p.mask]), [[2, 1, '1000']]);
  assert.deepEqual(locate(21, 8, 4), { block: 2, thread: 5, warp: 1, lane: 1 });
  // a block size that is not a multiple of the warp: the last warp of every block is short
  assert.deepEqual(launch(12, 6, 4).partial.map((p) => p.mask), ['1100', '1100']);
});

test('blocks go whole to SMs, in waves', () => {
  const a = assignBlocks(6, 3);
  assert.deepEqual(a.sms, [[0, 3], [1, 4], [2, 5]]);
  assert.equal(a.waves, 2);
  assert.equal(assignBlocks(6, 3, 2).waves, 1);
});

test('A3 scheduler: W = 4, k = 3, L = 9 issues every cycle; W = 3 idles', () => {
  const s = schedule(4, 3, 9);
  for (let w = 0; w < 4; w++) assert.deepEqual(s.perWarp[w], [3 * w, 3 * w + 1, 3 * w + 2, 3 * w + 12, 3 * w + 13, 3 * w + 14]);
  assert.deepEqual(s.idle, []);
  assert.equal(s.cycles, 24);
  assert.equal(s.needed, 4);
  assert.equal(s.issues.filter((x) => x.load).map((x) => x.cycle).join(), '2,5,8,11,14,17,20,23');
  const t = schedule(3, 3, 9);
  assert.deepEqual(t.idle, [9, 10]);
  assert.equal(t.fraction, 9 / 11);
  assert.equal(warpsNeeded(3, 9).warps, 4);
});

test('occupancy: registers against latency', () => {
  const n = warpsNeeded(20, 200);
  assert.equal(n.bound.toFixed(2), '10.95');
  assert.equal(n.warps, 11);
  const a = occupancy({ regFile: 16384, warp: 32, regs: 40, k: 20, L: 200 });
  assert.deepEqual([a.perWarp, a.resident, a.hidden, a.fraction], [1280, 12, true, 1]);
  const b = occupancy({ regFile: 16384, warp: 32, regs: 48, k: 20, L: 200 });
  assert.deepEqual([b.perWarp, b.resident, b.hidden], [1536, 10, false]);
  assert.equal(Math.round(100 * b.fraction), 91);
  assert.equal(occupancy({ regFile: 16384, warp: 32, regs: 40, k: 20, L: 200, maxWarps: 8 }).resident, 8);
});

test('A4 coalescing: 2, 8 and 32 transactions', () => {
  const a = coalesce({ stride: 1 });
  assert.deepEqual([a.transactions, a.delivered, a.used], [2, 128, 128]);
  const b = coalesce({ stride: 4 });
  assert.deepEqual([b.transactions, b.delivered, b.used, b.efficiency], [8, 512, 128, 0.25]);
  assert.equal(coalesce({ stride: 16 }).transactions, 32);
  assert.equal(coalesce({ stride: 1, base: 12 }).transactions, 3); // an offset start touches one block more
  assert.equal(coalesce({ stride: 2 }).transactions, 4);
  assert.deepEqual(coalesce({ lanes: 2, stride: 1, base: 62 }).laneBlocks, [[0, 1], [1]]); // a straddling word
  assert.equal(coalesce({ stride: 0 }).used, 4);
});

test('banks: strides 1, 2, 3, 8 and one word on 8 banks', () => {
  const cyc = (s) => bankAccess({ stride: s }).cycles;
  assert.deepEqual([1, 2, 3, 8, 0, 9].map(cyc), [1, 2, 1, 8, 1, 1]);
  const b = bankAccess({ stride: 2 });
  assert.deepEqual(b.perBank.map((p) => p.lanes), [[0, 4], [], [1, 5], [], [2, 6], [], [3, 7], []]);
  assert.deepEqual(bankAccess({ stride: 8 }).perBank[0].lanes, [0, 1, 2, 3, 4, 5, 6, 7]);
  const one = bankAccess({ stride: 0, base: 3 });
  assert.deepEqual([one.cycles, one.perBank[3].lanes.length, one.perBank[3].words], [1, 8, [3]]);
});

test('the models refuse what they cannot compute', () => {
  assert.throws(() => strips(0, 8), RangeError);
  assert.throws(() => launch(10, 0, 4), RangeError);
  assert.throws(() => vlmaxOf(100, 32), RangeError);
  assert.throws(() => strips(5, 8, 'other'), RangeError);
});
