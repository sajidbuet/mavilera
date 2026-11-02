// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { INSTRUCTIONS } from '../isa/encoding.js';
const RV32I = Object.keys(INSTRUCTIONS).filter((mn) =>
 !['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu',
 'wfi', 'mret', 'csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci'].includes(mn));
const M_EXT = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'];
const PRIV_EXT = ['wfi', 'mret', 'csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci'];
const CH06 = ['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
 'addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai',
 'lw', 'sw', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal', 'jalr', 'lui', 'auipc'];
export const PROFILES = Object.freeze({
 iss: Object.freeze({
 id: 'iss', chapter: null, isa: new Set([...RV32I, ...M_EXT]),
 textBase: 0x00000000, dataBase: 0x00010000, stackTop: 0x00100000, memory: 'sparse',
 }),
 'iss-priv': Object.freeze({
 id: 'iss-priv', chapter: null, isa: new Set([...RV32I, ...M_EXT, ...PRIV_EXT]), priv: true,
 textBase: 0x00000000, dataBase: 0x00010000, stackTop: 0x00100000, memory: 'sparse',
 }),
 ch06: Object.freeze({
 id: 'ch06', chapter: 6, processor: 'single-cycle processor', isa: new Set(CH06),
 subsets: Object.freeze({
 lab: new Set(['add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
 'addi', 'andi', 'ori', 'slti', 'lw', 'sw', 'beq', 'bne', 'lui', 'jal']),
 ext: new Set([...CH06, 'lbu']),
 }),
 textBase: 0x00000000, dataBase: 0x00000000, stackTop: null, memory: 'harvard', words: 256,
 }),
 ch07: Object.freeze({
 id: 'ch07', chapter: 7, processor: 'multicycle processor', isa: new Set(CH06),
 textBase: 0x00000000, dataBase: 0x00000200, stackTop: null, memory: 'unified', words: 256,
 }),
 ch08: Object.freeze({
 id: 'ch08', chapter: 8, processor: 'pipelined processor', isa: new Set(CH06),
 textBase: 0x00000000, dataBase: 0x00000000, stackTop: null, memory: 'harvard', words: 256,
 }),
});
