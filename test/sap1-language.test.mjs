// SAP-1 assembly language (src/arch/sap-1/language.js; arch-contract.md phase 5): encodings, number notations,
// placement, the data listing, every error, and disassembly of every byte.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, disassemble, fields, describe, editor, parseNumber, OPCODES } from '../src/arch/sap-1/language.js';

const asm = (text) => assemble([{ name: 'main.asm', text }]);
const image = (p) => { const m = new Uint8Array(16); for (const s of p.segments) m.set(s.bytes, s.address); return m; };
const errors = (text) => asm(text).diagnostics.map((d) => [d.line, d.message]);

test('the five instructions encode as opcode and address', () => {
  const p = asm('LDA 9\nADD 0AH\nsub 0xb\nOUT\nHLT\n');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual([...image(p).slice(0, 5)], [0x09, 0x1a, 0x2b, 0xe0, 0xf0]);
  assert.deepEqual(p.listing.map((r) => [r.address, r.size, r.word, r.line, r.part]), [[0, 1, 0x09, 1, 0], [1, 1, 0x1a, 2, 0], [2, 1, 0x2b, 3, 0],
    [3, 1, 0xe0, 4, 0], [4, 1, 0xf0, 5, 0]]);
  assert.equal(p.entry, 0);
  assert.deepEqual(p.segments.map((s) => [s.address, s.bytes.length, s.executable]), [[0, 5, true]]);
});

test('labels, ORG and DB: data in the data listing, symbols as a record', () => {
  const p = asm('start: LDA x ; first\n ADD y\n OUT\n HLT\n ORG 14\nx: DB 7\ny: DB -1\n');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(p.symbols, { start: 0, x: 14, y: 15 });
  assert.deepEqual([...image(p)], [0x0e, 0x1f, 0xe0, 0xf0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0xff]);
  assert.deepEqual(p.data.map((d) => [d.address, [...d.bytes], d.line]), [[14, [7], 6], [15, [0xff], 7]]);
  assert.equal(p.listing.length, 4);
  assert.deepEqual(p.segments.map((s) => [s.address, s.bytes.length, s.executable]), [[0, 4, true], [14, 2, false]]);
  assert.equal(p.listing[0].text, 'start: LDA x');
  assert.deepEqual(p.symbolTable.map((s) => [s.name, s.address, s.line]), [['start', 0, 1], ['x', 14, 6], ['y', 15, 7]]);
});

test('DB with several values and a label as value; a forward reference', () => {
  const p = asm('LDA t\nHLT\nt: DB 1, 0x2, 0b11, 4H, t\n');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual([...image(p).slice(0, 7)], [0x02, 0xf0, 1, 2, 3, 4, 2]);
});

test('number notations', () => {
  for (const [t, v] of [['12', 12], ['-3', -3], ['0x1F', 31], ['0b101', 5], ['0FH', 15], ['10h', 16], ['FH', null], ['x', null], ['1.5', null]]) {
    assert.equal(parseNumber(t), v, t);
  }
});

test('errors: each with line, column and length', () => {
  const cases = [
    ['JMP 3', /'JMP' is not an SAP-1 instruction/],
    ['LDA', /LDA needs a memory address/],
    ['OUT 3', /OUT takes no operand/],
    ['LDA 16', /address 16 is outside/],
    ['LDA nowhere', /label 'nowhere' is not defined/],
    ['LDA 1+2', /'1\+2' is not a number/],
    ['DB 256', /256 does not fit in a byte/],
    ['DB', /DB needs a value/],
    ['ORG 20', /address 20 is outside/],
    ['a: HLT\na: HLT', /'a' is defined twice/],
    ['add: HLT', /cannot be a label/],
    ['ORG 15\nDB 1, 2', /sixteen bytes/],
    ['HLT\nORG 0\nOUT', /already used/],
  ];
  for (const [text, re] of cases) {
    const p = asm(text);
    assert.equal(p.ok, false, text);
    assert.equal(p.diagnostics.length, 1, `${text}: ${JSON.stringify(p.diagnostics)}`);
    const d = p.diagnostics[0];
    assert.match(d.message, re, text);
    assert.ok(Number.isInteger(d.line) && Number.isInteger(d.column) && d.column >= 1 && Number.isInteger(d.length), JSON.stringify(d));
  }
  assert.deepEqual(errors('  LDA 99 ; far'), [[1, 'The address 99 is outside the memory (0 to 15).']]);
  assert.equal(asm('  LDA 99').diagnostics[0].column, 7);
  assert.ok(asm('JMP 3').diagnostics[0].note.includes('LDA, ADD, SUB, OUT and HLT'));
});

test('an empty source assembles to an empty program; comments and blank lines are ignored', () => {
  const p = asm('; nothing\n\n   \n');
  assert.ok(p.ok);
  assert.equal(p.listing.length, 0);
});

test('disassembly of every byte; reassembling an instruction gives the byte again', () => {
  for (let w = 0; w < 256; w++) {
    const t = disassemble(w);
    const op = w >> 4;
    if (Object.values(OPCODES).includes(op)) {
      const p = asm(t);
      assert.ok(p.ok, t);
      const want = op === OPCODES.OUT || op === OPCODES.HLT ? op << 4 : w;
      assert.equal(image(p)[0], want, t);
    } else {
      assert.match(t, /^DB [0-9][0-9A-F]*H$/);
      assert.equal(image(asm(t))[0], w, t);
    }
    const f = fields(w);
    assert.deepEqual(f.map((x) => [x.bits, x.value]), [['7:4', op], ['3:0', w & 0xf]]);
  }
  assert.equal(disassemble(0x1a), 'ADD 0AH');
  assert.equal(disassemble(0x19), 'ADD 9H');
  assert.equal(disassemble(0xe0), 'OUT');
  assert.equal(describe(0x30), null);
  assert.deepEqual(describe(0x2c), { kind: 'opcode (4 bits) · address (4 bits)', immediate: 12 });
});

test('editor data: lower-case words, help and detail for every mnemonic', () => {
  assert.deepEqual(editor.mnemonics, ['add', 'hlt', 'lda', 'out', 'sub']);
  for (const m of editor.mnemonics) {
    assert.equal(editor.help(m).kind, 'instruction');
    assert.match(editor.detail(m, 'mnemonic'), new RegExp(`^${m.toUpperCase()}`));
  }
  assert.equal(editor.help('jmp'), null);
});

test('the .hex and .bin images hold the sixteen bytes; they load back as a program without source', async () => {
  const { image, loadImage } = await import('../src/arch/sap-1/language.js');
  const p = asm('LDA x\nOUT\nHLT\nORG 0FH\nx: DB 0C3H\n');
  const { hex, bin } = image(p);
  assert.equal(hex.split('\n').length, 17);
  assert.deepEqual([...bin], [0x0f, 0xe0, 0xf0, ...Array(12).fill(0), 0xc3]);
  for (const back of [loadImage(hex, 'hex', 'p.hex'), loadImage(bin, 'bin', 'p.bin')]) {
    assert.ok(back.ok && back.imported);
    assert.deepEqual([...image(back).bin], [...bin]);
    assert.deepEqual(back.listing.map((r) => [r.address, r.word, r.part]).slice(0, 2), [[0, 0x0f, -1], [1, 0xe0, -1]]);
  }
  assert.deepEqual([...loadImage('0f # LDA\n// note\ne0\n', 'hex', 'c.hex').segments[0].bytes], [0x0f, 0xe0]);
  assert.throws(() => loadImage('0f\n1ff\n', 'hex', 'b.hex'), /'1ff' is not a byte/);
  assert.throws(() => loadImage(new Uint8Array(17), 'bin', 'b.bin'), /17 bytes/);
});
