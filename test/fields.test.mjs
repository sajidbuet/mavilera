// fields.test.mjs -- WS-F-022: the immediate rebuilt step by step from the
// fields equals the decoder's immediate for every format, on every
// instruction of isa_all.s-like encodings produced by the assembler.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { immediateSteps } from '../src/ui/listing.js';
import { assemble } from '../src/asm/assembler.js';
import { INSTRUCTIONS, immI, immS, immB, immU, immJ } from '../src/isa/encoding.js';

const SRC = `
a: addi a0, a1, -2048
   sw   t0, 2047(sp)
   sh   t1, -1(s0)
   beq  a0, a1, a
   bne  a0, a1, z
   lui  a0, 0xfffff
   jal  ra, a
   jal  ra, z
   .space 0
z: jalr t0, -4(t1)
`;

test('WS-F-022: the step-by-step immediate equals the decoded immediate', () => {
  const p = assemble(SRC);
  assert.deepEqual(p.errors, []);
  const decode = { I: immI, S: immS, B: immB, U: immU, J: immJ };
  for (const l of p.listing) {
    const fmt = INSTRUCTIONS[l.mnemonic].fmt;
    assert.equal(immediateSteps(l.word, fmt)[1], decode[fmt](l.word), l.text.trim());
  }
});
