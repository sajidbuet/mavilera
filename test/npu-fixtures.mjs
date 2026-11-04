// npu-fixtures.mjs -- helpers of the NPU tests: the integer oracle y = W x and the reader of the book's
// mac_vectors.hex (test/fixtures/npu/, hash checked against its README).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
export const i32 = (v) => Number(BigInt.asIntN(32, BigInt(v)));
export const s8 = (v) => (v << 24) >> 24;

/** y = W x in exact integers, wrapped to 32 bits: the oracle, independent of the array. */
export const matvec = (W, x) => W.map((row) => i32(row.reduce((s, w, j) => s + BigInt(w) * BigInt(x[j]), 0n)));

const VECTORS = join(ROOT, 'test', 'fixtures', 'npu', 'mac_vectors.hex');
const SHA256 = '86221ccaee9f11473754c5489c9f36d86de495834da2c792010281e653c4d3ed';

/** The cases of mac_vectors.hex: {weight: [u32 x4], act: packed x, W, x, y}. */
export function macVectors() {
  const buf = readFileSync(VECTORS);
  assert.equal(createHash('sha256').update(buf).digest('hex'), SHA256, 'fixture as copied (test/fixtures/npu/README.md)');
  const words = buf.toString('utf8').split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16) >>> 0);
  const count = words[0];
  assert.equal(words.length, 1 + 9 * count);
  const bytes = (v) => [0, 1, 2, 3].map((j) => s8(v >>> (8 * j)));
  return Array.from({ length: count }, (_, k) => {
    const c = words.slice(1 + 9 * k, 10 + 9 * k);
    return { weight: c.slice(0, 4), act: c[4], W: c.slice(0, 4).map(bytes), x: bytes(c[4]), y: c.slice(5, 9).map((v) => v | 0) };
  });
}
