// assist.test.mjs -- completion and hover help of the editor (WS-U-021):
// the context (mnemonic or register) from the text before the cursor, the
// candidates with their operand syntax, and help for every mnemonic of the
// table and every pseudo-instruction, so none is left without text.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { completionContext, completions, helpFor, wordAt } from '../src/ui/assist.js';
import { INSTRUCTIONS } from '../src/isa/encoding.js';
import { PSEUDOS } from '../src/asm/assembler.js';

test('WS-U-021: completion context', () => {
  assert.deepEqual(completionContext('        ad'), { kind: 'mnemonic', prefix: 'ad', from: 8 });
  assert.deepEqual(completionContext('loop:   be'), { kind: 'mnemonic', prefix: 'be', from: 8 });
  assert.deepEqual(completionContext('        add  t0, s'), { kind: 'register', prefix: 's', from: 17 });
  assert.deepEqual(completionContext('        lw   a0, 8(s'), { kind: 'register', prefix: 's', from: 19 });
  assert.equal(completionContext('        add  t0, t1 # s'), null); // a comment
  assert.equal(completionContext('msg: .asciz "a'), null); // a string
  assert.equal(completionContext('        .word 1, x'), null); // a directive's operands
  assert.equal(completionContext('        add  t0, '), null); // nothing typed yet
});

test('WS-U-021: candidates carry their operand syntax or register number', () => {
  const m = completions({ kind: 'mnemonic', prefix: 'bg' });
  assert.ok(m.some((c) => c.label === 'bge' && c.detail === 'bge rs1, rs2, label'));
  assert.ok(m.some((c) => c.label === 'bgez' && c.detail === 'bgez rs, label')); // pseudo-instructions too
  assert.ok(m.length <= 8);
  const r = completions({ kind: 'register', prefix: 'a' });
  assert.deepEqual(r.slice(0, 2).map((c) => c.label), ['a0', 'a1']);
  assert.match(r[0].detail, /^x10, argument or result$/);
  assert.equal(completions({ kind: 'register', prefix: 'g' })[0].detail, 'x3, global pointer');
  assert.deepEqual(completions(null), []);
});

test('WS-U-021: hover help for every instruction, pseudo-instruction and register', () => {
  for (const mn of Object.keys(INSTRUCTIONS)) {
    const h = helpFor(`        ${mn} x1, x2, x3`, 9);
    assert.equal(h.kind, 'instr', mn);
    assert.ok(h.usage && h.format && h.operation, `${mn}: ${JSON.stringify(h)}`);
  }
  for (const mn of PSEUDOS) {
    const h = helpFor(`        ${mn} a0`, 8);
    assert.equal(h.kind, 'pseudo', mn);
    assert.ok(h.operation, mn);
  }
  assert.equal(helpFor('        addi sp, sp, -16', 14).text, 'sp = x2: stack pointer');
  assert.equal(helpFor('        mv   x8, a0', 14).text, 'x8 = s0: saved (callee-saved)');
  assert.equal(helpFor('        nop  # add', 16), null); // in a comment
  assert.equal(helpFor('        nop', 2), null); // white space
  assert.deepEqual(wordAt('loop: beqz t0, done', 7), { word: 'beqz', from: 6, to: 10 });
});
