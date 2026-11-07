// The pico2 module's decoder and disassembler (P1-M1): a sample checked against GNU objdump, and hand-checked records.
// test/fixtures/pico2-decode-golden.jsonl holds up to 12 encodings per mnemonic with the text objdump 2.46 gave them
// (made by tools/pico2-decode-oracle.mjs, which compares every 16-bit encoding and 4 million 32-bit ones; run it
// against a toolchain for the full check). Not a test of execution.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decode, OP, OP_NAMES, zcmpRegisters } from '../src/arch/pico2/core/decode.js';
import { disassemble, rlistText, CSR_NAMES } from '../src/arch/pico2/core/disasm.js';

const golden = readFileSync(new URL('./fixtures/pico2-decode-golden.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const norm = (s) => s.replace(/\s+/g, ' ').trim();

test('the golden sample: the disassembly equals objdump\'s for every word', () => {
  assert.ok(golden.length > 1000, `${golden.length} samples`);
  const bad = golden.filter((g) => norm(disassemble(g.w, g.pc)) !== g.text).slice(0, 10)
    .map((g) => `${g.w.toString(16)}: ${norm(disassemble(g.w, g.pc))} != ${g.text}`);
  assert.deepEqual(bad, []);
});

test('the golden sample covers every extension of the RP2350 configuration', () => {
  const seen = new Set(golden.map((g) => g.text.split(' ')[0]));
  for (const mn of ['addi', 'mul', 'div', 'lr.w', 'amoadd.w', 'c.addi', 'c.lw', 'sh1add', 'clz', 'bset', 'pack', 'zip', 'c.mul', 'c.lbu', 'cm.push', 'cm.popretz',
    'cm.mva01s', 'mret', 'wfi', 'fence', 'fence.i']) assert.ok(seen.has(mn), mn);
});

/** A CSR instruction word: csr number, rs1 (or uimm), funct3 (1 to 3, 5 to 7), rd. */
const csrWord = (csr, rs1, f3, rd) => ((csr << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x73) >>> 0;

test('CSR instructions (not in the golden sample: objdump names the CSRs): all six forms', () => {
  const want = { 1: OP.CSRRW, 2: OP.CSRRS, 3: OP.CSRRC, 5: OP.CSRRWI, 6: OP.CSRRSI, 7: OP.CSRRCI };
  for (const [f3, op] of Object.entries(want)) {
    const d = decode(csrWord(0x305, 5, Number(f3), 1));
    assert.deepEqual([d.op, d.rd, d.rs1, d.imm], [op, 1, 5, 0x305], f3);
  }
  assert.equal(decode(csrWord(0x305, 5, 4, 1)).op, OP.ILLEGAL, 'funct3 100 is reserved');
  assert.equal(norm(disassemble(csrWord(0xbe0, 3, 5, 0))), 'csrrwi zero,meiea,3');
  assert.equal(norm(disassemble(csrWord(0xfff, 3, 5, 0))), 'csrrwi zero,0xfff,3');
});

/** An Xh3bextm word (custom-0): funct3 0 (register shift amount) or 4 (immediate), rd, rs1, rs2 or shamt, size - 1 */
const h3Word = (f3, rd, rs1, rs2, size1) => ((size1 << 26) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x0b) >>> 0;

test('Xh3bextm: h3.bextm and h3.bextmi fields, text and the reserved bits (the oracle checks the RTL patterns)', () => {
  const a = decode(h3Word(0, 10, 11, 12, 3));
  assert.deepEqual([a.op, a.rd, a.rs1, a.rs2, a.imm, a.mn], [OP.H3_BEXTM, 10, 11, 12, 4, 'h3.bextm']);
  assert.equal(norm(disassemble(h3Word(0, 10, 11, 12, 3))), 'h3.bextm a0,a1,a2,4');
  const b = decode(h3Word(4, 10, 11, 5, 7));
  assert.deepEqual([b.op, b.rs2, b.imm], [OP.H3_BEXTMI, 5, 8]);
  assert.equal(norm(disassemble(h3Word(4, 10, 11, 5, 7))), 'h3.bextmi a0,a1,5,8');
  assert.equal(decode((h3Word(0, 1, 2, 3, 0) | (1 << 25)) >>> 0).op, OP.ILLEGAL, 'bit 25 set');
  assert.equal(decode((h3Word(0, 1, 2, 3, 0) | (1 << 29)) >>> 0).op, OP.ILLEGAL, 'bits 31:29 set');
  assert.equal(decode(h3Word(1, 1, 2, 3, 0)).op, OP.ILLEGAL, 'funct3 1');
});

test('every operation id has a name and decodes from one encoding', () => {
  assert.equal(OP_NAMES.length, Object.keys(OP).length);
  const decodedOps = new Set([...golden.map((g) => decode(g.w).op), ...[1, 2, 3, 5, 6, 7].map((f3) => decode(csrWord(0x300, 1, f3, 1)).op), decode(h3Word(0, 1, 2, 3, 0)).op, decode(h3Word(4, 1, 2, 3, 0)).op]);
  const missing = OP_NAMES.filter((n) => n !== 'ILLEGAL' && !decodedOps.has(OP[n]));
  assert.deepEqual(missing, []);
});

test('fields: a few records checked by hand', () => {
  assert.deepEqual(decode(0x00450513), { op: OP.ADDI, rd: 10, rs1: 10, rs2: 0, imm: 4, len: 4, mn: 'addi', fmt: 'rd,rs1,imm' });
  const lui = decode(0x123425b7);
  assert.equal(lui.op, OP.LUI);
  assert.equal(lui.imm, 0x12342000);
  assert.equal(decode(0xfffff0b7).imm, -4096); // lui ra,0xfffff
  const beq = decode(0xfe0508e3); // beq a0,zero,-16
  assert.deepEqual([beq.op, beq.rs1, beq.rs2, beq.imm], [OP.BEQ, 10, 0, -16]);
  const jal = decode(0xffdff0ef); // jal ra,-4
  assert.deepEqual([jal.op, jal.rd, jal.imm], [OP.JAL, 1, -4]);
  assert.equal(decode(0x30200073).op, OP.MRET);
  assert.equal(decode(0x10500073).op, OP.WFI);
});

test('a compressed instruction decodes to its 32-bit operation and keeps its mnemonic and length', () => {
  const d = decode(0x0511); // c.addi a0,4
  assert.deepEqual([d.op, d.rd, d.rs1, d.imm, d.len, d.mn], [OP.ADDI, 10, 10, 4, 2, 'c.addi']);
  assert.equal(decode(0x9d59).op, OP.MUL); // c.mul a0,a4
  assert.equal(decode(0x8082).op, OP.JALR); // c.jr ra (ret)
  assert.equal(decode(0x8082).rs1, 1);
  assert.equal(decode(0x9002).op, OP.EBREAK);
  assert.equal(decode(0x4501).mn, 'c.li');
  // the high halfword of a fetch word is ignored for a compressed instruction
  assert.deepEqual(decode(0xdead0511), decode(0x0511));
});

test('Zcmp: register lists, stack adjustment and the s-register moves', () => {
  assert.deepEqual(zcmpRegisters(4), [1]);
  assert.deepEqual(zcmpRegisters(6), [1, 8, 9]);
  assert.deepEqual(zcmpRegisters(7), [1, 8, 9, 18]);
  assert.equal(zcmpRegisters(14).length, 11);
  assert.deepEqual(zcmpRegisters(15), [1, 8, 9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]); // ra, s0-s11
  assert.equal(rlistText(4), '{ra}');
  assert.equal(rlistText(5), '{ra,s0}');
  assert.equal(rlistText(15), '{ra,s0-s11}');
  const push = decode(0xb8e2); // cm.push {ra,s0-s9},-48
  assert.deepEqual([push.op, push.rs1, push.imm], [OP.CM_PUSH, 14, -48]);
  assert.equal(decode(0xbafe).imm, 64 + 3 * 16 > 0 ? decode(0xbafe).imm : 0); // cm.pop with rlist 15 and spimm 3 decodes
  assert.equal(decode(0xba02).op, OP.ILLEGAL, 'rlist below 4 is reserved');
});

test('Hazard3-specific legality (checked against the RP2350 revision\'s RTL patterns)', () => {
  assert.equal(decode(0x0000).op, OP.ILLEGAL, 'the all-zero halfword');
  assert.equal(decode(0x0004).op, OP.ADDI, 'c.addi4spn with imm 0: Hazard3 flags only the all-zero halfword');
  assert.equal(decode(0x0013 | (1 << 7) | (1 << 15)).op, OP.ADDI);
  assert.equal(decode(0x0000008f).op, OP.ILLEGAL, 'fence with rd != 0');
  assert.equal(decode(0x0000808f).op, OP.ILLEGAL, 'fence with rs1 != 0');
  assert.equal(decode(0x0ff0000f).op, OP.FENCE);
  assert.equal(decode(0x5310000f).op, OP.FENCE, 'fm is ignored');
  assert.equal(decode(0x0010100f).op, OP.ILLEGAL, 'fence.i is one exact word');
  assert.equal(decode(0x0000100f).op, OP.FENCE_I);
  assert.equal(decode(0x00a59593).op, OP.SLLI, 'slli a1,a1,10');
  assert.equal(decode(0x02a59593).op, OP.ILLEGAL, 'a shift amount of 32 or more (instr[25] set)');
  assert.equal(decode(0x10200073).op, OP.ILLEGAL, 'sret: no S-mode');
  assert.equal(decode(0x12000073).op, OP.ILLEGAL, 'sfence.vma: no S-mode');
});

test('the disassembler: branch targets use the address, shifts print in hexadecimal, CSRs by name', () => {
  assert.equal(norm(disassemble(0xffdff0ef, 0x100)), 'jal ra,0xfc');
  assert.equal(norm(disassemble(0x00b59513, 0)), 'slli a0,a1,0xb');
  assert.equal(norm(disassemble(0x30529073, 0)), 'csrrw zero,mtvec,t0');
  assert.equal(norm(disassemble(0x34051073, 0)), 'csrrw zero,mscratch,a0');
  assert.equal(CSR_NAMES[0x305], 'mtvec');
  assert.equal(norm(disassemble(0x00000013)), 'addi zero,zero,0');
  assert.equal(disassemble(0x0000), 'illegal');
});
