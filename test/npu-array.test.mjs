// npu-array.test.mjs -- the NPU's processing element, systolic array and array explorer (NPU-1, tests N1-N7 of
// docs/research/gpu-npu/verification/GOLDEN_TESTS.md): PE arithmetic, sign extension, registered partial sums,
// Worked Example 11.6 against Table 11.2 and the PSUM header of FIG-0113, the book's mac_vectors.hex, the input
// skew, the weight mapping, and the streaming property (B vectors in B + 2N - 1 steps).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { pe, product, runArray, arrayStep, newArray, peWeights, skewInput } from '../src/mem/npu.js';
import { ROOT, i32, s8, matvec, macVectors } from './npu-fixtures.mjs';
import { join } from 'node:path';

const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');

test('N1 PE arithmetic, exhaustive: every INT8 weight and activation, partial sums at 0 and the 32-bit edges', () => {
  const sums = [0, 1, -1, 0x7fffffff, -0x80000000, 0x7fffc000, -0x7fffc000];
  let checks = 0;
  for (let w = -128; w < 128; w++) {
    for (let a = -128; a < 128; a++) {
      for (const pIn of sums) {
        const q = pe({ w, a: 0, p: 0 }, { aIn: a, pIn });
        const want = i32(BigInt(pIn) + BigInt(a) * BigInt(w));
        if (q.p !== want || q.a !== a || q.w !== w) assert.fail(`w=${w} a=${a} psum_in=${pIn}: got ${q.p}, ${q.a}, ${q.w}; expected ${want}`);
        checks++;
      }
    }
  }
  assert.equal(checks, 256 * 256 * sums.length);
  assert.equal(pe({ w: 3 }, { wLoad: true, wIn: -7, aIn: 2, pIn: 10 }).w, -7, 'w_load stores w_in');
  assert.equal(pe({ w: 3 }, { wLoad: true, wIn: -7, aIn: 2, pIn: 10 }).p, 16, 'the product uses the weight registered before the edge');
  assert.equal(product(-128, -128), 16384, '(-128)(-128) fits the 16-bit product');
});

test('N2 sign extension: negative products extend with ones (PRB-0201)', () => {
  assert.equal(pe({ w: -1 }, { aIn: 1, pIn: 0 }).p >>> 0, 0xffffffff);
  assert.equal(pe({ w: -128 }, { aIn: 127, pIn: 0 }).p, -16256);
  assert.equal(pe({ w: -128 }, { aIn: 127, pIn: 0 }).p >>> 0, 0xffffc080);
  assert.equal(pe({ w: 0x80 }, { aIn: 0x7f, pIn: 0 }).p, -16256, 'byte patterns are read as INT8');
});

test('N3 registered partial sums: all -128, N = 4, gives y0 = 0x10000 in step 4 (PRB-0200)', () => {
  const W = Array.from({ length: 4 }, () => [-128, -128, -128, -128]);
  const r = runArray(W, [-128, -128, -128, -128]);
  assert.deepEqual(r.y[0], [0x10000, 0x10000, 0x10000, 0x10000]);
  assert.deepEqual(r.outSteps[0], [4, 5, 6, 7], 'y_c leaves column c in step N + c');
  assert.notEqual(r.y[0][0], 0x4000, 'a combinational psum chain would give one product only');
});

test('N4 Worked Example 11.6: the 2 x 2 trace equals Table 11.2 and the PSUM header of FIG-0113', () => {
  const r = runArray([[2, -1], [3, 4]], [5, -2]);
  const rows = r.steps.map((s) => [s.p[0][0], s.p[0][1], s.p[1][0], s.p[1][1]]);
  const want = [[10, 0, 0, 0], [0, 15, 12, 0], [0, 0, 0, 7], [0, 0, 0, 0]];
  assert.deepEqual(rows, want, 'partial sums registered at the end of each step (PE00, PE01, PE10, PE11)');
  assert.deepEqual(r.steps.map((s) => s.aLeft), [[5, 0], [0, -2], [0, 0], [0, 0]], 'row inputs (0: nothing enters)');
  assert.deepEqual(r.steps[0].w, [[2, 3], [-1, 4]], 'PE(0,0)=2, PE(0,1)=3, PE(1,0)=-1, PE(1,1)=4');
  assert.deepEqual(r.y[0], [12, 7]);
  assert.deepEqual(r.outSteps[0], [2, 3], 'y0 in step 2, y1 in step 3');
  assert.deepEqual(r.steps.map((s) => s.out.map((o) => o.y)), [[], [], [12], [7]]);
  const fig = join(BOOK, 'figures', 'FIG-0113.tex');
  if (existsSync(fig)) {
    const hdr = /%% PSUM\s*:\s*(.*)/.exec(readFileSync(fig, 'utf8'))[1].split('|').map((g) => g.trim().split(/\s+/).map(Number));
    assert.deepEqual(rows, hdr, 'the PSUM header of FIG-0113 (book repository)');
  }
  const tex = join(BOOK, 'chapters', 'chapter11', 'chapter11.tex');
  if (existsSync(tex)) {
    const body = /\\label\{tab:acc-systolic\}.*?\\midrule(.*?)\\bottomrule/s.exec(readFileSync(tex, 'utf8'))[1];
    const tab = body.split('\\\\').map((l) => l.split('&').map((c) => c.trim())).filter((c) => c.length === 8)
      .map((c) => c.slice(3, 7).map((v) => Number(v.replace(/\\\(|\\\)/g, ''))));
    assert.deepEqual(rows, tab, 'Table 11.2 (book repository)');
  }
});

test('N5 the array against mac_vectors.hex: every case, y_c in step N + c', () => {
  const cases = macVectors();
  assert.equal(cases.length, 40);
  for (const [k, { W, x, y }] of cases.entries()) {
    assert.deepEqual(matvec(W, x), y, `case ${k}: the file's y equals W x (the format is as read)`);
    const r = runArray(W, x);
    assert.deepEqual(r.y[0], y, `case ${k}`);
    assert.deepEqual(r.outSteps[0], [4, 5, 6, 7], `case ${k}`);
  }
});

test('N6 skew: x_r enters row r in step r and in no other step', () => {
  const x = [11, -22, 33, -44];
  const r = runArray([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], x);
  assert.equal(r.steps.length, 8, 'one vector: 2N steps');
  for (const s of r.steps) for (let row = 0; row < 4; row++) assert.equal(s.aLeft[row], s.step === row ? x[row] : 0, `step ${s.step} row ${row}`);
  assert.deepEqual(skewInput(3, [[1, 2, 3, 4]], 4), [0, 0, 0, 4]);
});

test('N7 weight mapping: identity W gives y = x; a non-symmetric W detects a transposed mapping', () => {
  const I = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  assert.deepEqual(runArray(I, [5, -6, 7, -8]).y[0], [5, -6, 7, -8]);
  const W = [[1, 2, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  assert.deepEqual(runArray(W, [1, 1, 1, 1]).y[0], [3, 1, 1, 1], 'y = W x, not W^T x ([1, 3, 1, 1])');
  assert.deepEqual(peWeights(W)[1][0], 2, 'PE (r, c) holds W[c][r]');
});

test('array explorer: N = 2, 3, 4 against W x; after a run every activation and partial-sum register is 0 again', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return s8(seed >>> 16); };
  for (const n of [2, 3, 4]) {
    for (let k = 0; k < 50; k++) {
      const W = Array.from({ length: n }, () => Array.from({ length: n }, rnd));
      const x = Array.from({ length: n }, rnd);
      const r = runArray(W, x);
      assert.deepEqual(r.y[0], matvec(W, x), `N=${n} case ${k}`);
      assert.deepEqual(r.outSteps[0], Array.from({ length: n }, (_, c) => n + c));
      const last = r.steps.at(-1);
      assert.ok(last.a.flat().every((v) => v === 0) && last.p.flat().every((v) => v === 0), 'array registers zero after 2N steps');
    }
  }
});

test('streaming: B skewed vectors finish in B + 2N - 1 steps; vector b leaves column c in step b + N + c', () => {
  const W = [[1, -2, 3, -4], [5, 6, -7, 8], [-9, 10, 11, -12], [13, -14, 15, 16]];
  const X = [[1, 2, 3, 4], [-5, 6, -7, 8], [127, -128, 0, 1]];
  const r = runArray(W, X);
  assert.equal(r.steps.length, X.length + 2 * 4 - 1);
  X.forEach((x, b) => {
    assert.deepEqual(r.y[b], matvec(W, x), `vector ${b}`);
    assert.deepEqual(r.outSteps[b], [0, 1, 2, 3].map((c) => b + 4 + c));
  });
  const outsPerStep = r.steps.map((s) => s.out.length);
  assert.deepEqual(outsPerStep, [0, 0, 0, 0, 1, 2, 3, 3, 2, 1], 'after the first output, outputs leave in every step');
});

test('the array update is two-phase: a step never sees a value registered in the same step', () => {
  let arr = arrayStep(newArray(2), [0, 0], true, peWeights([[1, 1], [1, 1]]));
  arr = arrayStep(arr, [3, 4]); // both rows at once (no skew): row 1 adds to the old p of row 0, which is 0
  assert.deepEqual(arr.p, [[3, 0], [4, 0]]);
  assert.deepEqual(arr.a, [[3, 0], [4, 0]]);
});
