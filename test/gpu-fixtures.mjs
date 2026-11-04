// gpu-fixtures.mjs -- the reader of the Chapter 11 laboratory's simt_tests.hex (test/fixtures/gpu/, hash checked
// against its README), for the GPU tests G1 to G4.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FILE = new URL('./fixtures/gpu/simt_tests.hex', import.meta.url);
const SHA256 = 'af47e1e69c2c458f2371e6f9daffa2bbdecb4b0632afa4eb8aaca59a445d454a';
const PER_TEST = 27;

/**
 * The tests of simt_tests.hex as tb_simt_core reads them: word 0 the count; per test the program length, sixteen
 * program words, four lane inputs, four expected r2 values, expected cycles and idle lane-slots.
 */
export function simtTests() {
  const buf = readFileSync(FILE);
  assert.equal(createHash('sha256').update(buf).digest('hex'), SHA256, 'fixture as copied (test/fixtures/gpu/README.md)');
  const w = buf.toString('utf8').split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16) >>> 0);
  assert.equal(w.length, 1 + PER_TEST * w[0]);
  return Array.from({ length: w[0] }, (_, k) => {
    const t = w.slice(1 + PER_TEST * k, 1 + PER_TEST * (k + 1));
    return { length: t[0], program: t.slice(1, 17), din: t.slice(17, 21), dout: t.slice(21, 25).map((v) => v | 0), cycles: t[25], idle: t[26] };
  });
}
