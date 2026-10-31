// profiles.js -- machine profiles: ISA subset, memory map and halting rule
// (spec §6, WS-F-001 to WS-F-004). `memory` names the memory organisation:
// 'sparse' (one byte-addressed memory), 'harvard' (instruction and data
// memories of `words` words each) or 'unified' (one memory of `words` words).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { INSTRUCTIONS } from '../isa/encoding.js';

const RV32I = Object.keys(INSTRUCTIONS).filter((mn) =>
  !['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu',
    'wfi', 'mret', 'csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci'].includes(mn));
const M_EXT = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'];
const PRIV_EXT = ['wfi', 'mret', 'csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci'];

// Chapter 6 subset (spec §6): R-type, I-type ALU, lw, sw, six branches, jal, jalr, lui, auipc.
const CH06 = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
  'addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai',
  'lw', 'sw', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal', 'jalr', 'lui', 'auipc'];

export const PROFILES = Object.freeze({
  iss: Object.freeze({
    id: 'iss', chapter: null, isa: new Set([...RV32I, ...M_EXT]),
    textBase: 0x00000000, dataBase: 0x00010000, stackTop: 0x00100000, memory: 'sparse',
  }),
  // The instruction-level machine with traps and the platform devices (WS-F-111): Zicsr, mret and wfi
  // are instructions, ecall and ebreak trap instead of stopping the run, and the GPIO, timer and UART
  // sit at 0x4000_0000, 0x4000_1000 and 0x4000_2000. Semantics follow `rvsim.py --priv`.
  'iss-priv': Object.freeze({
    id: 'iss-priv', chapter: null, isa: new Set([...RV32I, ...M_EXT, ...PRIV_EXT]), priv: true,
    textBase: 0x00000000, dataBase: 0x00010000, stackTop: 0x00100000, memory: 'sparse',
  }),
  ch06: Object.freeze({
    id: 'ch06', chapter: 6, processor: 'single-cycle processor', isa: new Set(CH06),
    // Options of spec §6: the laboratory subset (Ch 6 brief D9) and the extension (lbu).
    subsets: Object.freeze({
      lab: new Set(['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
        'addi', 'andi', 'ori', 'slti', 'lw', 'sw', 'beq', 'bne', 'lui', 'jal']),
      ext: new Set([...CH06, 'lbu']),
    }),
    textBase: 0x00000000, dataBase: 0x00000000, stackTop: null, memory: 'harvard', words: 256,
  }),
  // One unified memory: the chapter's programs keep their data at 0x200, above the code.
  ch07: Object.freeze({
    id: 'ch07', chapter: 7, processor: 'multicycle processor', isa: new Set(CH06),
    textBase: 0x00000000, dataBase: 0x00000200, stackTop: null, memory: 'unified', words: 256,
  }),
  ch08: Object.freeze({
    id: 'ch08', chapter: 8, processor: 'pipelined processor', isa: new Set(CH06),
    textBase: 0x00000000, dataBase: 0x00000000, stackTop: null, memory: 'harvard', words: 256,
  }),
});
