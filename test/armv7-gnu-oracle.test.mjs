// armv7-gnu-oracle.test.mjs -- ARM-A5 oracle against GNU binutils and QEMU user mode (tools/armv7/gnu-oracle.mjs;
// A5-Q1). The text conversion and the exception list always run. The WSL part runs only with ARMV7_GNU_ORACLE=1 and
// the tools installed (binutils-arm-linux-gnueabihf, qemu-user), since it calls outside Node.js; otherwise it is skipped
// with the reason. The recorded run is docs/architecture/armv7-a5-gnu-qemu.json.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemble } from '../src/arch/armv7/language.js';
import { gnuText, randomWords, GNU_ONLY_REFUSALS, probe, encodingCheck, executionCheck } from '../tools/armv7/gnu-oracle.mjs';
import { generate } from '../tools/armv7/equivalence.mjs';

test('GNU text: branch, BL and ADR targets become offsets from the instruction; other text is the disassembly', () => {
  assert.equal(gnuText(0x1afffffb, 0x80), 'BNE .-12');
  assert.equal(gnuText(0xeb00001e, 0xa4), 'BL .+128');
  assert.equal(gnuText(0xe28f9008, 0x84), 'ADR R9, .+16');
  assert.equal(gnuText(0xe2811001, 0x100), 'ADD R1, R1, #1');
});

test('GNU-only refusals: the STR PC, [PC, #imm] rule matches an unaligned offset only (DDI A8.8.205)', () => {
  const rule = GNU_ONLY_REFUSALS.find((r) => r.id === 'str-pc-pc-unaligned');
  const msg = 'ldr to register 15 must be 4-byte aligned';
  assert.ok(rule.test(0x358ff3be, msg), 'STRCC PC, [PC, #958]');
  assert.ok(!rule.test(0x358ff3bc, msg), 'offset 956 is aligned');
  assert.ok(!rule.test(0x359ff3be, msg), 'LDR is not covered');
  assert.ok(!rule.test(0x358ff3be, 'another error'), 'another message');
});

test('random words: 2 000 words the decoder accepts, almost all distinct', () => {
  const ws = randomWords(2000, 1);
  assert.equal(ws.length, 2000);
  assert.equal(new Set(ws).size > 1900, true);
});

const enabled = process.env.ARMV7_GNU_ORACLE === '1';
const tools = enabled ? probe() : null;
const skip = !enabled ? 'set ARMV7_GNU_ORACLE=1 (needs WSL with binutils-arm-linux-gnueabihf and qemu-user)'
  : !tools ? 'GNU binutils or qemu-arm not found in WSL' : false;

test('GNU as and qemu-arm (WSL): encodings and 20 programs agree; planted faults are caught', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'mavilera-gnu-test-'));
  const ws = randomWords(500, 7);
  const items = ws.map((w, i) => ({ index: i, word: w, address: 0x8000, source: 'random', text: gnuText(w, 0x8000) }));
  const enc = encodingCheck(items, { dir });
  assert.ok(enc.assembled);
  assert.deepEqual(enc.mismatches, []);
  assert.ok(enc.refused.every((r) => GNU_ONLY_REFUSALS.some((x) => x.test(parseInt(r.word, 16), r.error))), JSON.stringify(enc.refused));
  // a planted encoding fault: the text of one word, the expectation of another
  const bad = encodingCheck([{ index: 0, word: 0xe2811002, address: 0, source: 'x', text: 'ADD R1, R1, #1' }], { dir });
  assert.equal(bad.mismatches.length, 1);
  const progs = Array.from({ length: 20 }, (_, k) => ({ tier: k % 2 ? 'E' : 'H', program: assemble([{ name: 't.s', text: generate(31 + k, k % 2 ? 'E' : 'H') }]) }));
  const exe = executionCheck(progs, { dir });
  assert.deepEqual([exe.agreed, exe.failures], [20, []]);
  // a planted execution fault: QEMU runs a program whose data base (R11) set-up differs
  const p = progs[0].program;
  const q = assemble([{ name: 't.s', text: generate(31, 'H') }]);
  q.segments.find((s) => s.executable).bytes[4] ^= 4;
  assert.equal(executionCheck([{ tier: 'H', program: p, qemuProgram: q }], { dir }).failures.length, 1);
});
