// diagnostics.test.mjs -- WS-V-014: a corpus of wrong programs, each with the
// expected diagnostic (line, column, message, hint code); messages are also
// compared with rvasm.py's where rvasm.py reports the same fault. Covers the
// kinds of WS-F-012 and the profile reports of WS-F-001/WS-F-003.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { assemble } from '../src/asm/assembler.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIM = process.env.MES_BOOK_SIM ?? join(ROOT, '..', 'book-MES', 'code', 'sim');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
// the reference scripts (tools/*.py) stay in the private repository (tools/site-files.mjs PRIVATE_ONLY): a public clone skips
const haveRef = existsSync(join(SIM, 'rvasm.py')) && existsSync(join(ROOT, 'tools', 'ref_trace.py')) && spawnSync(PYTHON, ['--version']).status === 0;

// [name, source, line, column, message, hint, compare with rvasm.py]
const CASES = [
  ['unknown mnemonic', 'nop\n  addx a0, a1, a2\n', 2, 3, "unknown mnemonic 'addx'", 'mnemonic', true],
  ['bad register', 'add a0, a1, x32\n', 1, 13, "bad register 'x32'", 'register', true],
  ['wrong operand count', 'add a0, a1\n', 1, 1, 'add expects 3 operands, got 2', 'operands', true],
  ['pseudo operand count', 'mv a0\n', 1, 1, 'mv expects 2 operand(s)', 'operands', true],
  ['I-immediate range', 'addi a0, a0, 5000\n', 1, 14, 'I-immediate 5000 outside the 12-bit signed range', 'range', true],
  ['S-immediate range', 'sw a0, -2049(sp)\n', 1, 8, 'S-immediate -2049 outside the 12-bit signed range', 'range', true],
  ['shift amount', 'slli a0, a0, 32\n', 1, 14, 'shift amount 32 outside 0..31', 'shamt', true],
  ['U-immediate', 'lui a0, 0x100000\n', 1, 9, 'U-immediate 0x100000 outside 0..0xFFFFF', 'uimm', true],
  ['odd branch offset', 'beq a0, a1, 3\n', 1, 13, 'branch offset must be even', 'align', true],
  ['branch out of range', 'beq a0, a1, far\n' + 'nop\n'.repeat(1100) + 'far: nop\n', 1, 13,
    'branch offset 4404 outside the 13-bit signed range', 'range', true],
  ['undefined label', 'j nowhere\n', 1, 3, 'undefined symbol nowhere', 'undefined', true],
  ['duplicate label', 'a: nop\na: nop\n', 2, 1, 'duplicate symbol a', 'duplicate', true],
  ['bad memory operand', 'lw a0, a1\n', 1, 8, "bad memory operand 'a1'", 'memory', true],
  ['unknown directive', '.data\n.quad 1\n', 2, 1, 'unknown directive .quad', 'directive', true],
  ['instruction in .data', '.data\nnop\n', 2, 1, 'instruction outside .text', 'section', true],
  ['.equ forward reference', '.equ N, M\n.equ M, 1\n', 1, 9, 'symbol M must be defined before use here', 'forward', true],
  ['value does not fit', '.data\n.byte 300\n', 2, 7, 'value 300 does not fit .byte', 'range', true],
  ['bad escape', '.data\n.ascii "a\\q"\n', 2, 1, 'unknown escape \\q', 'escape', true],
];

test('WS-V-014: diagnostics corpus', () => {
  for (const [name, src, line, column, message, hint] of CASES) {
    const p = assemble(src);
    assert.ok(p.errors.length >= 1, `${name}: no error`);
    const e = p.errors[0];
    assert.deepEqual({ line: e.line, column: e.column, message: e.message, hint: e.hint },
      { line, column, message, hint }, name);
  }
});

test('WS-V-014: messages equal rvasm.py where it reports the same fault', { skip: haveRef ? false : 'reference not available' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'pips-diag-'));
  try {
    for (const [name, src, line, , message, , compare] of CASES) {
      if (!compare) continue;
      const file = join(dir, 'case.s');
      writeFileSync(file, src);
      const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'ref_trace.py'), SIM, file], { encoding: 'utf8' });
      const ref = JSON.parse(r.stdout);
      assert.equal(ref.asm_error, `${file}:${line}: ${message}`, name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WS-F-011: an error in the second file names that file and its line', () => {
  if (!existsSync(join(SIM, 'tests', 'asm', 'multi_bad.s'))) return;
  const read = (n) => ({ name: n, text: readFileSync(join(SIM, 'tests', 'asm', n), 'utf8') });
  const p = assemble([read('multi_lib.s'), read('multi_bad.s')]); // as verify_sim.py S8
  assert.deepEqual(p.errors.map((e) => [e.file, e.line]), [['multi_bad.s', 5]]);
});

test('WS-F-001/WS-F-003: instructions outside the profile are reported, not syntax errors', () => {
  const p = assemble('lb a0, 0(a1)\nmul a0, a0, a1\nlw a0, 0(a1)\necall\n', { profile: 'ch06' });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.profileErrors.map((e) => [e.line, e.mnemonic, e.chapter]),
    [[1, 'lb', 6], [2, 'mul', 6], [4, 'ecall', 6]]);
  assert.deepEqual(assemble('csrr a0, mstatus\n').profileErrors.map((e) => e.mnemonic), ['csrrs']);
  const lab = assemble('xori a0, a0, 1\nlbu a0, 0(a1)\nbeq a0, a0, 0\n', { profile: 'ch06', subset: 'lab' });
  assert.deepEqual(lab.profileErrors.map((e) => e.mnemonic), ['xori', 'lbu']);
  const ext = assemble('lbu a0, 0(a1)\n', { profile: 'ch06', subset: 'ext' });
  assert.deepEqual(ext.profileErrors, []);
  assert.equal(assemble('.data\nx: .word 1\n', { profile: 'ch07' }).segments[1].address, 0x200);
});

test('stated difference from rvasm.py: extra or missing operands of system instructions are errors', () => {
  for (const src of ['ecall a0\n', 'ebreak 1\n', 'fence.i x\n', 'mret a\n', 'wfi a\n']) {
    assert.match(assemble(src).errors[0]?.message ?? '', /expects 0 operands/, src);
  }
  assert.equal(assemble('fence rw\n').errors[0]?.message, 'fence expects pred, succ');
});

test('WS-F-012: diagnostics carry suggestions, the expected form and the faulty token', () => {
  const p = assemble([
    'loop    beqz t0, done', // 1: label without colon
    '        adi  a0, a0, 1', // 2: misspelt mnemonic
    '        add  a0, a1', // 3: operand count
    '        lw   a2, 8(a9)', // 4: register
    '        j    dne', // 5: undefined label, close to "done"
    'done:   halt',
  ].join('\n'));
  const by = Object.fromEntries(p.errors.map((e) => [e.line, e]));
  assert.equal(by[1].data.missingColon, true);
  assert.equal(by[2].data.suggest[0], 'addi'); // the last operand is a number: the I-type form first
  assert.equal(assemble('adi a0, a0, a1\n').errors[0].data.suggest[0], 'add');
  assert.deepEqual(assemble('jmp x\nx: nop\n').errors[0].data.suggest, ['j']); // a name from another ISA
  assert.equal(by[3].data.usage, 'add rd, rs1, rs2');
  assert.equal(by[3].data.got, 2);
  assert.deepEqual([by[4].token, by[4].column, by[4].length], ['a9', 20, 2]);
  assert.ok(by[4].data.suggest.includes('a0'));
  assert.deepEqual(by[5].data.suggest, ['done']);
  assert.deepEqual(by[5].operands, ['dne']);
});

test('WS-F-013: a pseudo-instruction lists the real instructions it became', () => {
  const p = assemble('li a0, 0x12345678\n');
  assert.deepEqual(p.listing.map((l) => [l.line, l.source, l.mnemonic, l.part, l.parts]),
    [[1, 'li', 'lui', 0, 2], [1, 'li', 'addi', 1, 2]]);
});
