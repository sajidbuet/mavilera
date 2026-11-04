// GPU module, the micro-ISA language (GPU-1; test G4 of docs/research/gpu-npu/verification/GOLDEN_TESTS.md): the
// encoding against the laboratory's simt_tests.hex, every 16-bit word through the disassembler and back, the fields,
// LDI sign extension, the reserved op 7, the dialect's errors (MAVILERA's, decision G7), images and the scratch line.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, disassemble, fields, describe, image, loadImage, scratch, encode, decode, programImage, sext8 } from '../src/arch/gpu/language.js';
import { simtTests } from './gpu-fixtures.mjs';

const asm = (text, profile) => assemble([{ name: 't.simt', text }], { profile });
const words = (p) => p.listing.map((r) => r.word);
const errors = (p) => p.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

// the three programs of simt_tests.hex as the specification decodes them (GPU_ARCHITECTURE.md §2.4)
const DECODED = [
  ['LDI r3, 0', 'IFLT r1, r3', 'SUB r2, r3, r1', 'ELSE', 'ADD r2, r1, r3', 'ENDIF', 'HALT'],
  ['LDI r3, 2', 'IFLT r0, r3', 'LDI r2, 10', 'LDI r3, 1', 'IFLT r0, r3', 'ADD r2, r2, r1', 'ENDIF', 'ELSE', 'LDI r2, 20', 'ENDIF', 'ADD r2, r2, r0', 'HALT'],
  ['ADD r2, r1, r1', 'ADD r2, r2, r0', 'HALT'],
];

test('G4: the programs of simt_tests.hex disassemble to the specification\'s table and assemble back to the same words', () => {
  const tests = simtTests();
  assert.equal(tests.length, 3);
  tests.forEach((t, k) => {
    const prog = t.program.slice(0, t.length);
    assert.deepEqual(prog.map((w) => disassemble(w)), DECODED[k], `test ${k}`);
    assert.ok(t.program.slice(t.length).every((w) => w === 0), 'padded with HALT');
    const p = asm(DECODED[k].join('\n'));
    assert.ok(p.ok, JSON.stringify(p.diagnostics));
    assert.deepEqual(words(p), prog);
    assert.deepEqual([...programImage(p)], t.program);
  });
});

test('G4: every 16-bit word disassembles, and assembles back to the word without the bits its operation ignores', () => {
  const USED = [0xe000, 0xf8ff, 0xff80, 0xff80, 0xe780, 0xe000, 0xe000, 0xffff]; // per op: the bits that matter
  for (let w = 0; w <= 0xffff; w++) {
    const text = disassemble(w);
    const p = asm(text);
    assert.ok(p.ok, `${w.toString(16)}: ${text}`);
    assert.equal(words(p)[0], w & USED[w >>> 13], `${w.toString(16)}: ${text}`);
  }
});

test('G4: the fields cover bits 15 to 0 once; rt [8:7] and imm [7:0] share bit 7, so LDI shows imm and no rt', () => {
  for (const w of [0x0000, 0x3800, 0x8380, 0x7680, 0xa000, 0x5380, 0xc000, 0xe123, 0x38ff]) {
    const f = fields(w);
    const bits = new Set();
    for (const x of f) {
      const [hi, lo = hi] = x.bits.split(':').map(Number);
      for (let b = lo; b <= hi; b++) { assert.ok(!bits.has(b), `${w.toString(16)}: bit ${b} twice`); bits.add(b); }
      assert.equal(x.value, (w >>> lo) & (2 ** (hi - lo + 1) - 1), `${w.toString(16)} ${x.name}`);
    }
    assert.equal(bits.size, 16);
  }
  assert.deepEqual(fields(0x38ff).map((x) => x.name), ['op', 'rd', 'unused', 'imm']);
  assert.deepEqual(fields(0x8380).map((x) => [x.name, x.short]), [['op', 'op'], ['rd', '—'], ['rs', 'rs'], ['rt', 'rt'], ['unused', '—']]);
  assert.deepEqual(decode(0x7680), { op: 3, rd: 2, rs: 3, rt: 1, imm: 0x80 });
});

test('G4: LDI sign-extends its eight bits; -128 to 255 are accepted; op 7 is reserved, shown as .word', () => {
  assert.equal(disassemble(encode('LDI', { rd: 1, imm: 0xff })), 'LDI r1, -1');
  assert.equal(disassemble(encode('LDI', { rd: 1, imm: 0x80 })), 'LDI r1, -128');
  assert.equal(disassemble(encode('LDI', { rd: 1, imm: 0x7f })), 'LDI r1, 127');
  assert.deepEqual(words(asm('LDI r1, 255\nLDI r1, -1\nLDI r1, 0xff\nLDI r2, -128')), [0x28ff, 0x28ff, 0x28ff, 0x3080]);
  assert.equal(sext8(0xff), -1);
  assert.equal(describe(0x28ff).immediate, -1);
  assert.equal(disassemble(0xe000), '.word 0xE000');
  assert.equal(disassemble(0xffff), '.word 0xFFFF');
  assert.deepEqual(words(asm('.word 0xE000\n.word 57344')), [0xe000, 0xe000]);
  assert.equal(describe(0xe000).immediate, undefined);
});

test('the dialect: comments, case, spacing; .din per lane, missing inputs 0; the lanes from the profile', () => {
  const p = asm('  ldi R3 , 0 // comment\n; whole-line comment\n.din 5, -3\nhalt ; done');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(words(p), [0x3800, 0x0000]);
  assert.deepEqual(p.din, [5, 0xfffffffd, 0, 0]);
  assert.equal(p.lanes, 4);
  const q = asm('.din 1,2,3,4,5,6,7,8\nHALT', 'simt8');
  assert.ok(q.ok);
  assert.equal(q.lanes, 8);
  assert.deepEqual(q.din, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(q.listing[0], { address: 0, size: 2, word: 0, text: 'HALT', file: 't.simt', line: 2, part: 0 });
  assert.deepEqual(asm('.din 0xFFFFFFFF, -2147483648').din.slice(0, 2), [0xffffffff, 0x80000000]);
});

test('the dialect\'s errors, each marked at its token', () => {
  const one = (text, profile) => { const p = asm(text, profile); assert.equal(p.ok, false, text); return p.diagnostics[0]; };
  assert.match(one('loop: HALT').message, /no branches/);
  assert.match(one('JMP 3').message, /not a micro-ISA instruction/);
  assert.match(one('ADD r2, r4, r1').message, /not a lane register/);
  assert.deepEqual([one('ADD r2, r4, r1').column, one('ADD r2, r4, r1').length], [9, 2]);
  assert.match(one('ADD r2, r1').message, /ADD takes 3 operands: ADD rd, rs, rt/);
  assert.match(one('HALT r1').message, /HALT takes no operand/);
  assert.match(one('IFLT r1').message, /IFLT takes 2 operands/);
  assert.match(one('LDI r1, 256').message, /does not fit in eight bits/);
  assert.match(one('LDI r1, -129').message, /does not fit in eight bits/);
  assert.match(one('LDI r1, x').message, /'x' is not a number/);
  assert.match(one('.din 1,2,3,4,5').message, /5 inputs, but the core has 4 lanes/);
  assert.match(one('.din 1\n.din 2').message, /given twice/);
  assert.match(one('.din 4294967296').message, /does not fit in 32 bits/);
  assert.match(one('.word 0x10000').message, /sixteen bits/);
  assert.match(one('.din').message, /needs a value/);
  const full = asm(Array(17).fill('HALT').join('\n'));
  assert.deepEqual(errors(full), ['The program memory has sixteen words (0 to 15); this instruction would go past the end.']);
  assert.equal(full.diagnostics[0].line, 17);
  assert.equal(asm(Array(16).fill('HALT').join('\n')).ok, true);
});

test('images: .hex of sixteen four-digit words and .bin of 32 bytes load back; the fixture\'s eight-digit words are read', () => {
  const p = asm('LDI r3, 0\nIFLT r1, r3\nHALT');
  const { hex, bin } = image(p);
  assert.equal(hex.split('\n').length, 17);
  assert.equal(hex.split('\n')[1], '8380');
  assert.equal(bin.length, 32);
  assert.deepEqual([bin[2], bin[3]], [0x80, 0x83]);
  for (const back of [loadImage(hex, 'hex', 'p.hex'), loadImage(bin, 'bin', 'p.bin')]) {
    assert.deepEqual(words(back).slice(0, 3), words(p));
    assert.equal(back.listing.length, 16);
    assert.equal(back.listing[0].size, 2);
  }
  const eight = loadImage('00003800\n00008380 // IFLT\n# comment\n0000', 'hex', 'x.hex', { profile: 'simt8' });
  assert.deepEqual(words(eight), [0x3800, 0x8380, 0]);
  assert.equal(eight.lanes, 8);
  assert.deepEqual(eight.din, Array(8).fill(0));
  assert.throws(() => loadImage('00010000', 'hex', 'x.hex'), /16-bit word/);
  assert.throws(() => loadImage(Array(17).fill('0').join('\n'), 'hex', 'x.hex'), /17 words/);
  assert.throws(() => loadImage(new Uint8Array(3), 'bin', 'x.bin'), /3 bytes/);
});

test('the scratch line decodes a word and encodes one instruction', () => {
  assert.equal(scratch('').kind, 'empty');
  assert.deepEqual([scratch('0x5380').kind, scratch('0x5380').text], ['decode', 'ADD r2, r1, r3']);
  assert.equal(scratch('0b0101001110000000').text, 'ADD r2, r1, r3');
  const e = scratch('IFLT r1, r3');
  assert.ok(e.ok);
  assert.equal(e.rows[0].word, 0x8380);
  assert.equal(scratch('.din 1').ok, false);
  assert.equal(scratch('0x10000').ok, false);
  assert.equal(scratch('FOO').ok, false);
});
