// scratch.test.mjs -- the encode/decode scratchpad (WS-F-024): an
// instruction gives the words the assembler gives, a word gives its
// instruction, the two directions are inverse on every encoding of the
// table, and errors carry the assembler's diagnosis.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scratch, parseWord } from '../src/asm/scratch.js';
import { INSTRUCTIONS } from '../src/isa/encoding.js';

test('WS-F-024: an instruction encodes to its word', () => {
  const r = scratch('addi a0, a0, -1');
  assert.equal(r.kind, 'encode');
  assert.equal(r.ok, true);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].word, 0xfff50513);
  assert.equal(scratch('beq x1, x2, 8').lines[0].word, 0x00208463); // numeric byte offset
  const li = scratch('li t0, 0x12345678'); // a pseudo-instruction gives every word
  assert.equal(li.lines.length, 2);
  assert.deepEqual(li.lines.map((l) => l.mnemonic), ['lui', 'addi']);
});

test('WS-F-024: a word decodes to its instruction', () => {
  for (const t of ['0xfff50513', 'fff50513', '0b11111111111101010000010100010011', '0xFFF5_0513']) {
    const r = scratch(t);
    assert.equal(r.kind, 'decode', t);
    assert.equal(r.ok, true);
    assert.equal(r.word, 0xfff50513);
    assert.equal(r.lines[0].mnemonic, 'addi');
    assert.match(r.text, /^addi\s+a0,\s*a0,\s*-1$/);
  }
  const bad = scratch('0x00000000');
  assert.equal(bad.kind, 'decode');
  assert.equal(bad.ok, false);
  assert.equal(parseWord('add'), null); // a mnemonic, not hex
  assert.equal(parseWord('0x123456789'), null);
});

test('WS-F-024: decode then encode gives the word back for every instruction of the table', () => {
  let n = 0;
  for (const [mn, d] of Object.entries(INSTRUCTIONS)) {
    if (!/^[a-z.]+$/.test(mn) || d.fmt === undefined) continue;
    const ops = { 'rd,rs1,rs2': 'a0, a1, a2', 'rd,rs1,imm': 'a0, a1, -8', 'rd,rs1,shamt': 'a0, a1, 7', 'rd,mem': 'a0, 8(a1)', 'rs2,mem': 'a2, 8(a1)',
      'rs1,rs2,target': 'a1, a2, -16', 'rd,imm20': 'a0, 0x12345', 'rd,target': 'ra, 2048', jalr: 'ra, 4(a1)', '': '' }[d.syntax];
    if (ops === undefined) continue; // fence and CSR forms
    const enc = scratch(`${mn} ${ops}`);
    assert.equal(enc.ok, true, mn);
    const dec = scratch(`0x${enc.lines[0].word.toString(16)}`);
    assert.equal(dec.ok, true, mn);
    const again = scratch(dec.text);
    assert.equal(again.lines[0].word, enc.lines[0].word, `${mn}: ${dec.text}`);
    n += 1;
  }
  assert.ok(n >= 40, `checked ${n}`);
});

test('WS-F-024: errors and refusals', () => {
  const e = scratch('addi a0, a0');
  assert.equal(e.ok, false);
  assert.match(e.error.message, /operand/);
  assert.equal(scratch('loop: nop').ok, false);
  assert.equal(scratch('.word 5').ok, false);
  assert.equal(scratch('   ').kind, 'empty');
});
