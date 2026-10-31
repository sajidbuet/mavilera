// immediate.js -- the immediate of a RISC-V instruction word rebuilt from its fields, step by step (WS-F-022), for
// the inspector and the listing's word tooltip. Pure JavaScript, no DOM (moved from ui/listing.js in phase 3 of
// docs/architecture/arch-contract.md).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STRINGS } from '../../ui/strings.js';
import { bits, sext } from '../../isa/encoding.js';

/** Steps that rebuild the immediate of a word from its fields (WS-F-022): [steps, value], or null (R-type). */
export function immediateSteps(word, fmt) {
  const b = (hi, lo) => bits(word, hi, lo).toString(2).padStart(hi - lo + 1, '0');
  switch (fmt) {
    case 'I': return [[`imm[11:0] = ${b(31, 20)}`], sext(bits(word, 31, 20), 12)];
    case 'S': return [[`imm[11:5] = ${b(31, 25)}`, `imm[4:0] = ${b(11, 7)}`,
      `${STRINGS.immGather}: ${b(31, 25)}${b(11, 7)}`], sext((bits(word, 31, 25) << 5) | bits(word, 11, 7), 12)];
    case 'B': {
      const g = `${b(31, 31)}${b(7, 7)}${b(30, 25)}${b(11, 8)}0`;
      return [[`imm[12] = bit 31 = ${b(31, 31)}`, `imm[11] = bit 7 = ${b(7, 7)}`, `imm[10:5] = bits 30:25 = ${b(30, 25)}`,
        `imm[4:1] = bits 11:8 = ${b(11, 8)}`, 'imm[0] = 0', `${STRINGS.immGather}: ${g}`], sext(parseInt(g, 2), 13)];
    }
    case 'J': {
      const g = `${b(31, 31)}${b(19, 12)}${b(20, 20)}${b(30, 21)}0`;
      return [[`imm[20] = bit 31 = ${b(31, 31)}`, `imm[19:12] = bits 19:12 = ${b(19, 12)}`, `imm[11] = bit 20 = ${b(20, 20)}`,
        `imm[10:1] = bits 30:21 = ${b(30, 21)}`, 'imm[0] = 0', `${STRINGS.immGather}: ${g}`], sext(parseInt(g, 2), 21)];
    }
    case 'U': return [[`imm[31:12] = ${b(31, 12)}`, 'imm[11:0] = 0'], (word & 0xfffff000) | 0];
    default: return null;
  }
}
