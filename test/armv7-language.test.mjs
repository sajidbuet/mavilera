// armv7-language.test.mjs -- the ARMv7 assembler, decoder and disassembler (roadmap ARM-A1; reference sheet
// docs/architecture/armv7-reference.md): the worked machine codes of sheet §8 and Fig 7.60, round trips of every row of
// the instruction table and of decoded words, the assembler's rejections (sheet §§1-9), the tiers of the hardware
// profiles, and the contract hooks (fields, scratch, images). Encodings are compared with the sheet, which checked them
// against DDI 0406C.d and Harris; no GNU tool has been run (oracle O2: not installed).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, disassemble, decode, fields, describe, scratch, image, loadImage, editor, encodeImmediate, HALT_WORD, tierOf, CONDS, INSTRUCTIONS }
  from '../src/arch/armv7/language.js';

/** The words of a source assembled at `at` (code placed with .space before it). */
const words = (src, options = {}, at = 0) => {
  const p = assemble([{ name: 't.s', text: `${at ? `\t.space ${at}\n` : ''}${src}\n` }], options);
  return { p, w: p.listing.map((r) => r.word) };
};
const one = (src, at = 0) => {
  const { p, w } = words(`\t${src}`, {}, at);
  assert.ok(p.ok, `${src}: ${JSON.stringify(p.diagnostics)}`);
  return w[0];
};
const errorOf = (src, options = {}) => {
  const { p } = words(`\t${src}`, options);
  assert.equal(p.ok, false, `${src} should not assemble`);
  return p.diagnostics[0];
};

test('the worked machine codes of reference sheet §8 (Harris Figs 6.18-6.26, re-encoded from DDI)', () => {
  const rows = [
    ['ADD R5, R6, R7', 0xE0865007], ['SUB R8, R9, R10', 0xE049800A], ['ADD R0, R1, #42', 0xE281002A],
    ['SUB R2, R3, #0xFF0', 0xE2432EFF], ['LSL R0, R9, #7', 0xE1A00389], ['ROR R3, R5, #21', 0xE1A03AE5],
    ['LSR R4, R8, R6', 0xE1A04638], ['ASR R5, R1, R12', 0xE1A05C51], ['STR R11, [R5], #-26', 0xE405B01A],
    ['MOV R0, R0', 0xE1A00000],
  ];
  for (const [src, want] of rows) assert.equal(one(src), want, src);
  assert.equal(one('BLT 0x80B4', 0x80A0), 0xBA000003, 'BLT at 0x80A0');
  assert.equal(one('BL 0x8040', 0x8050), 0xEBFFFFFA, 'BL at 0x8050');
  assert.equal(disassemble(0xBA000003, 0x80A0), 'BLT 0x80B4');
  assert.equal(disassemble(0xEBFFFFFA, 0x8050), 'BL 0x8040');
});

/** Harris Fig 7.60 (p. 453) as the template writes it (Harris's labels without colons), with B . added at the end. */
const FIG_7_60 = readFileSync(new URL('../content/armv7/templates/fig-7-60.s', import.meta.url), 'utf8');

test('Fig 7.60: every word as Harris\'s hex column (D8: the hex, not the binary), all tier H', () => {
  const want = [0xE04F000F, 0xE2802005, 0xE280300C, 0xE2437009, 0xE1874002, 0xE0035004, 0xE0855004, 0xE0558007, 0x0A00000C,
    0xE0538004, 0xAA000000, 0xE2805000, 0xE0578002, 0xB2857001, 0xE0477002, 0xE5837054, 0xE5902060, 0xE08FF000, 0xE280200E,
    0xEA000001, 0xE280200D, 0xE280200A, 0xE5802064, HALT_WORD];
  const { p, w } = words(FIG_7_60, { profile: 'arm-single' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(w, want);
  for (const x of want) assert.equal(decode(x).tier, 'H', disassemble(x));
});

/** One source per row and form of the instruction table (sheet §§4-7), every one of which must round-trip. */
const ROWS = [
  ...['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC', 'ORR', 'BIC'].flatMap((m) => [
    `${m} R1, R2, #255`, `${m}S R1, R2, R3`, `${m}EQ R1, R2, R3, LSL #1`, `${m} R1, R2, R3, LSR #32`, `${m} R1, R2, R3, ASR #5`,
    `${m} R1, R2, R3, ROR #31`, `${m} R1, R2, R3, RRX`, `${m}SNE R1, R2, R3, LSL R4`, `${m} R1, R2, #0xFF000000`, `${m} R1, R2, #4, #2`]),
  ...['TST', 'TEQ', 'CMP', 'CMN'].flatMap((m) => [`${m} R2, #1`, `${m}GT R2, R3`, `${m} R2, R3, ASR #2`, `${m} R2, R3, ROR R5`]),
  ...['MOV', 'MVN'].flatMap((m) => [`${m} R1, #7`, `${m}S R1, R3`, `${m} R1, #0x3FC`]),
  'MVN R1, R2, LSL #4', 'LSL R1, R2, #31', 'LSR R1, R2, #32', 'ASRS R1, R2, #1', 'ROR R1, R2, #1', 'RRX R1, R2', 'RRXS R1, R2',
  'LSL R1, R2, R3', 'LSRS R1, R2, R3', 'ASR R1, R2, R3', 'RORMI R1, R2, R3',
  'LDR R1, [R2]', 'LDR R1, [R2, #4095]', 'LDR R1, [R2, #-4095]', 'LDR R1, [R2, #-0]', 'LDR R1, [R2, #8]!', 'LDR R1, [R2], #-8',
  'LDR R1, [R2, R3]', 'LDR R1, [R2, -R3, LSL #2]', 'LDR R1, [R2, R3, ASR #32]!', 'LDR R1, [R2], -R3, RRX', 'LDR PC, [R2, #4]',
  'STR R1, [R2]', 'STR R1, [R2, #-4]', 'STR R1, [R2, #4]!', 'STR R1, [R2], #4', 'STR R1, [R2, R3, LSL #3]', 'STR PC, [R2]',
  'LDRB R1, [R2, #1]', 'LDRB R1, [R2, #-1]', 'LDRB R1, [R2], #1', 'LDRB R1, [R2, -R3]', 'STRB R1, [R2, #3]', 'STRB R1, [R2, #-3]!',
  'LDR R1, [PC, #-12]', 'LDRB R1, [PC, #12]', 'STR R1, [PC, #12]',
  'B 0x100', 'BNE 0x0', 'BL 0x2000', 'BLLE 0x8',
  'LDM R1, {R2, R3}', 'LDM R1!, {R0, R4-R6, PC}', 'STM R1, {R1, R2}', 'STM R1!, {R1, R2}', 'STMDB R1!, {R2-R12, LR}', 'STMDB SP, {R0}',
  'PUSH {R4-R7, LR}', 'POP {R4-R7, PC}', 'PUSH {R0}', 'POP {LR}', 'STMDB SP!, {R3}', 'LDM SP!, {R3}',
  'ADR R0, 0x40', 'ADR R0, 0x0', 'NOP', 'NOPEQ',
];

test('every row of the instruction table: assemble, disassemble, assemble again gives the same word', () => {
  const at = 0x100;
  for (const src of ROWS) {
    const w = one(src, at);
    const text = disassemble(w, at);
    assert.equal(one(text, at), w, `${src} -> ${text}`);
  }
  for (const name of Object.keys(INSTRUCTIONS)) assert.ok(ROWS.some((r) => r.startsWith(name)), `a row for ${name}`);
});

test('decoded words round-trip: 30 000 pseudo-random words in the subset disassemble and reassemble to themselves', () => {
  let seed = 12345;
  const rand = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed; };
  let n = 0;
  for (let k = 0; n < 30_000 && k < 400_000; k++) {
    const w = ((rand() & 0xf3ffffff) | ((k % 3) << 26)) >>> 0; // op 00, 01 and 10 alike
    const d = decode(w);
    if (d.bad || d.unpredictable) continue;
    n += 1;
    const at = 0x1000;
    const text = disassemble(w, at);
    if (d.cls === 'branch' && (at + 8 + d.offset) < 0) continue; // a target below address 0 has no address to write
    const back = words(`\t${text}`, {}, at);
    assert.ok(back.p.ok, `${w.toString(16)} ${text}: ${JSON.stringify(back.p.diagnostics)}`);
    assert.equal(back.w[0], w, `${w.toString(16)} -> ${text} -> ${back.w[0]?.toString(16)}`);
  }
  assert.ok(n >= 30_000, `${n} words`);
});

test('the decoder: out-of-scope classes and the UNPREDICTABLE forms of sheet §9', () => {
  const bad = { 0xF0000000: 'uncond', 0xE0010392: 'multiply', 0xE1D010B0: 'multiply', 0xE12FFF1E: 'misc', 0xE3001234: 'misc',
    0xE1B0F00E: 'pcFlags', 0xE6100010: 'media', 0xE4B01004: 'unpriv', 0xE8D00003: 'userRegs', 0xE9100003: 'blockMode',
    0xE8300003: 'blockMode', 0xEF000000: 'coproc', 0xEE000000: 'coproc' };
  for (const [w, why] of Object.entries(bad)) assert.equal(decode(Number(w)).bad, why, `${Number(w).toString(16)}`);
  const up = { 0xE1311002: 'sbz', 0xE1A1000F: 'sbz', 0xE0810F12: 'pcRsr', 0xE4900004: 'wback', 0xE5F0F000: 'pcByte',
    0xE790100F: 'pcOffset', 0xE5BF1004: 'literal', 0xE49F1004: 'literal', 0xE89F0003: 'pcBase', 0xE8900000: 'emptyList',
    0xE8B00003: 'wbackList', 0xE8A10003: 'storeBase', 0xE5AF1004: 'wback' };
  for (const [w, why] of Object.entries(up)) assert.equal(decode(Number(w)).unpredictable, why, `${Number(w).toString(16)}`);
  assert.equal(decode(0xE8A10006).unpredictable, undefined, 'STM R1!, {R1, R2}: R1 is the lowest');
  assert.equal(disassemble(0xEF000000), '.word 0xEF000000');
  assert.ok(decode(HALT_WORD).halt);
});

test('the assembler refuses out-of-scope and UNPREDICTABLE forms with a message naming the rule', () => {
  for (const src of ['MUL R0, R1, R2', 'LDRH R0, [R1]', 'SVC #0', 'BX LR', 'MOVW R0, #1', 'LDRT R0, [R1]', 'YIELD']) {
    assert.match(errorOf(src).message, /not an instruction/, src);
  }
  for (const m of ['LDMDB', 'LDMIB', 'STMIB', 'LDMDA', 'STMDA', 'LDMEA', 'STMFA']) assert.match(errorOf(`${m} R0, {R1}`).message, /not supported/, m);
  for (const [src, re] of [['LDR R0, [R0], #4', /Rn = Rt/], ['STR R1, [R1, #4]!', /Rn = Rt/], ['STR R1, [PC, #4]!', /Rn = R15/],
    ['LDRB PC, [R1]', /Rt = R15/], ['STRB PC, [R1]', /Rt = R15/], ['LDR R0, [R1, PC]', /register offset of R15/], ['LDM R0!, {R0, R1}', /writeback/],
    ['STM R1!, {R0, R1}', /UNKNOWN/], ['LDM PC, {R0}', /base register R15/], ['ADD R0, R1, R2, LSL PC', /R15/], ['POP {R0, SP}', /writeback/],
    ['PUSH {SP}', /Rn = Rt/]]) {
    assert.match(errorOf(src).message, re, src);
  }
  assert.match(errorOf('MOV R0, #0x101').message, /cannot be encoded/);
  assert.match(errorOf('MOV R0, #0x101').note, /ORR/);
  assert.match(errorOf('MOV R0, 5').message, /needs a #/);
  assert.match(errorOf('LSR R0, R1, #0').message, /not a standard shift/);
  assert.match(errorOf('ROR R0, R1, #32').message, /1 to 31/);
  assert.match(errorOf('LSL R0, R1, #32').message, /0 to 31/);
  assert.match(errorOf('ADD R0, R1, R2, LSR #0').message, /not a standard shift/);
  assert.match(errorOf('LDR R0, [R1, #4096]').message, /4095/);
  assert.match(errorOf('LDR R0, [R1, R2, LSL R3]').message, /not a shift/);
  assert.match(errorOf('STR R0, somewhere').message, /not an address operand|not defined/);
  assert.match(errorOf('B 0x2').message, /multiple of 4/);
  assert.match(errorOf('PUSH {}').message, /empty/);
  assert.match(errorOf('PUSH {R1, R1}').message, /twice/);
  assert.match(errorOf('ADD R0, R16, R1').message, /not a register/);
  assert.match(errorOf('ADD R0, R1').message, /takes the operands/);
  assert.match(errorOf('CMPS R0, R1').message, /not an instruction/, 'TST, TEQ, CMP, CMN take no S');
  assert.match(errorOf('ADD R0, R1, #x').message, /not defined/);
});

test('branch range: the edges of the 26-bit offset, both directions (sheet §6)', () => {
  // at address 0; a target below 0 is written as a negative number, so that the backward edge needs no 32 MB of code
  assert.equal(one(`B ${8 + 33554428}`), 0xEA7FFFFF);
  assert.equal(one(`B ${8 - 33554432}`), 0xEA800000);
  assert.match(words(`\tB ${8 + 33554432}`).p.diagnostics[0].message, /reach/);
  assert.match(words(`\tB ${8 - 33554436}`).p.diagnostics[0].message, /reach/);
  assert.equal(disassemble(0xEA800000, 0x0200_0000), 'B 0x8');
  assert.equal(one('B .', 0x40), HALT_WORD);
  assert.equal(one('BL .+8', 0x40), 0xEB000000);
  assert.equal(one('B .-4', 0x40), 0xEAFFFFFD);
});

test('modified immediates: the lowest rotation (A5-198), the #byte, #rot form only when needed (A0-Q2)', () => {
  assert.deepEqual(encodeImmediate(3), { rot: 0, imm8: 3 });
  assert.deepEqual(encodeImmediate(0xFF0), { rot: 14, imm8: 0xFF });
  assert.deepEqual(encodeImmediate(0xC0000034), { rot: 1, imm8: 0xD3 });
  assert.equal(encodeImmediate(0x102), null, 'bits 8 and 1: an odd rotation');
  assert.equal(encodeImmediate(0x101), null, 'nine bits');
  assert.equal(one('MOV R0, #-1 + 1'), 0xE3A00000);
  assert.equal(one('MVN R0, #0'), 0xE3E00000);
  assert.equal(one('MOV R0, #-16777216'), 0xE3A004FF, '0xFF000000 written as a negative number');
  // #4, #2 is 1 rotated: the lowest rotation of 1 is 0, so the disassembler writes the pair
  assert.equal(one('MOV R0, #4, #2'), 0xE3A00104);
  assert.equal(disassemble(0xE3A00104), 'MOV R0, #4, #2');
  assert.equal(disassemble(0xE3A00101), 'MOV R0, #0x40000000');
});

test('LSL #0 is MOV; LSR and ASR #32 are shamt5 0 (A0-Q2); ADD and SUB from PC disassemble as ADR (sheet §4.6)', () => {
  assert.equal(one('LSL R1, R2, #0'), one('MOV R1, R2'));
  assert.equal(one('LSR R1, R2, #32'), 0xE1A01022);
  assert.equal(one('ASR R1, R2, #32'), 0xE1A01042);
  assert.equal(disassemble(0xE28F0008, 0x10), 'ADR R0, 0x20');
  assert.equal(disassemble(0xE24F0008, 0x10), 'ADR R0, 0x10');
  assert.equal(disassemble(0xE08F0001, 0x10), 'ADD R0, PC, R1', 'a register operand stays ADD');
  const { p, w } = words('\tADR R0, msg\n\tB .\nmsg: .word 5');
  assert.ok(p.ok);
  assert.equal(w[0], 0xE28F0000);
});

test('pseudo-instructions (A1-Q5b): NOP is MOV R0, R0; LDR =value is MOV, MVN or a literal-pool load after .text', () => {
  assert.equal(one('NOP'), 0xE1A00000);
  assert.equal(one('NOPEQ'), 0x01A00000);
  assert.match(errorOf('NOP R0').message, /takes the operands/);
  assert.equal(one('LDR R0, =42'), 0xE3A0002A, 'MOV R0, #42');
  assert.equal(one('LDR R0, =0x10000'), 0xE3A00801, 'MOV R0, #0x10000');
  assert.equal(one('LDR R0, =-1'), 0xE3E00000, 'MVN R0, #0');
  assert.equal(one('LDRNE R0, =0xFFFFFF00'), 0x13E000FF, 'MVNNE R0, #255');
  const p = assemble([{ name: 'p.s', text: '\tLDR R0, =0x12345678\n\tLDR R1, =0x12345678\n\tLDR R2, =lab + 4\n\tB .\n\t.data\nlab: .word 0' }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(p.listing.map((r) => r.word), [0xE59F0008, 0xE59F1004, 0xE59F2004, HALT_WORD], 'one pool word per value, at 16 and 20');
  assert.deepEqual(p.listing.map((r) => r.source ?? null), ['LDR', 'LDR', 'LDR', null]);
  const text = p.segments.find((s) => s.executable).bytes;
  assert.deepEqual([...text.slice(16, 24)], [0x78, 0x56, 0x34, 0x12, 0x04, 0x00, 0x01, 0x00]);
  assert.deepEqual(p.data.filter((d) => d.address < 0x10000).map((d) => [d.address, d.text]),
    [[16, '.word 0x12345678 ; literal pool'], [20, '.word 0x00010004 ; literal pool']]);
  assert.equal(decode(p.listing[0].word).tier, 'I');
  assert.match(errorOf('LDRB R0, =1').message, /Only LDR/);
  assert.match(errorOf('STR R0, =1').message, /Only LDR/);
  assert.match(words('\tLDR R0, =0x12345678\n\t.space 4096\n\tB .').p.diagnostics[0].message, /literal pool is 4096 bytes/);
});

test('PUSH and POP of one register are STR and LDR (A2 forms); of more, STMDB and LDM (sheet §7)', () => {
  assert.equal(one('PUSH {R4}'), 0xE52D4004);
  assert.equal(one('POP {R4}'), 0xE49D4004);
  assert.equal(one('PUSH {R4, LR}'), 0xE92D4010);
  assert.equal(one('POP {R4, PC}'), 0xE8BD8010);
  assert.equal(one('STMFD SP!, {R4, LR}'), one('PUSH {R4, LR}'));
  assert.equal(one('LDMFD SP!, {R4, PC}'), one('POP {R4, PC}'));
  assert.equal(one('STMEA R0, {R1}'), one('STMIA R0, {R1}'));
  assert.equal(disassemble(0xE52D4004), 'PUSH {R4}');
  assert.equal(disassemble(0xE49D4004), 'POP {R4}');
  assert.equal(disassemble(0xE92D0008), 'STMDB SP!, {R3}', 'one register in the block form stays STMDB');
});

test('mnemonic spellings: UAL and the older order, conditions HS and LO, Harris labels without colons', () => {
  assert.equal(one('ADDSEQ R0, R0, R1'), one('ADDEQS R0, R0, R1'));
  assert.equal(one('LDRBNE R0, [R1]'), one('LDRNEB R0, [R1]'));
  assert.equal(one('LDMIAEQ R0, {R1}'), one('LDMEQIA R0, {R1}'));
  assert.equal(one('BHS 0x0'), one('BCS 0x0'));
  assert.equal(one('BLO 0x0'), one('BCC 0x0'));
  assert.equal(decode(one('BLS 0x0')).cond, 9, 'BLS is B with LS');
  assert.equal(decode(one('BLE 0x0')).L, 0, 'BLE is B with LE');
  assert.equal(one('add r0, r1, r2'), one('ADD R0, R1, R2'));
  assert.equal(one('ADD R0, SP, LR'), 0xE08D000E);
  const { p, w } = words('START   MOV R0, #1\nLOOP\n        SUBS R0, R0, #1\n        BNE LOOP\nEND     B END');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.deepEqual(p.symbols, { START: 0, LOOP: 4, END: 12 });
  assert.equal(w[2], 0x1AFFFFFD);
  assert.match(assemble([{ name: 't.s', text: 'FOO BAR R0' }]).diagnostics[0].message, /'FOO' is not/);
  for (const c of CONDS) assert.ok(editor.mnemonics.includes(`b${c === 'AL' ? 'al' : c.toLowerCase()}`) || c === 'AL', c);
});

test('directives, sections and data: .word .byte .ascii .asciz .space .align .equ; data at 0x10000', () => {
  const src = `\t.equ N, 3\n\t.text\n\tMOV R0, #N\n\tB .\n\t.data\ntab: .word 1, -1, tab\nstr: .asciz "a\\n"\n\t.align 2\nb: .byte 255, -128\n\t.space 2\nend:`;
  const p = assemble([{ name: 'd.s', text: src }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.equal(p.listing[0].word, 0xE3A00003);
  assert.deepEqual(p.symbols, { tab: 0x10000, str: 0x1000C, b: 0x10010, end: 0x10014 });
  const data = p.segments.find((s) => !s.executable);
  assert.equal(data.address, 0x10000);
  assert.deepEqual([...data.bytes], [1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 1, 0, 0x61, 0x0a, 0, 0, 0xff, 0x80, 0, 0]);
  assert.ok(p.symbolTable.every((s) => s.section === (s.name === 'tab' || s.name === 'str' || s.name === 'b' || s.name === 'end' ? 'data' : 'text')));
  assert.match(assemble([{ name: 'd.s', text: '\t.data\n\tADD R0, R0, R0' }]).diagnostics[0].message, /outside .text/);
  assert.match(assemble([{ name: 'd.s', text: '\t.byte 256' }]).diagnostics[0].message, /does not fit/);
  assert.match(assemble([{ name: 'd.s', text: '\t.quad 1' }]).diagnostics[0].message, /not a directive/);
  assert.match(assemble([{ name: 'd.s', text: 'x: B .\nx: B .' }]).diagnostics[0].message, /defined twice/);
});

test('LDR from a label is PC-relative (sheet §5.3, tier I); an instruction after .byte is word-aligned', () => {
  const p = assemble([{ name: 'l.s', text: '\tLDR R0, value\n\tB .\nvalue: .word 42\n\t.byte 1\n\tMOV R0, R0' }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.equal(p.listing[0].word, 0xE59F0000); // value is at 8 = 0 + 8 + 0
  assert.equal(p.listing[2].address, 16);
  assert.equal(decode(p.listing[0].word).tier, 'I');
});

test('tiers: the base hardware profile takes tier H only, the Extended datapath H and E, the ISS all (W-D32, W-D33)', () => {
  assert.equal(tierOf('arm-iss'), 'I');
  assert.equal(tierOf('arm-single'), 'H');
  assert.equal(tierOf('arm-pipe', 'extended'), 'E');
  const tierOfSrc = (src) => decode(one(src)).tier;
  for (const s of ['ADD R0, R1, #255', 'SUBS R0, R1, R2', 'AND R0, R1, R2', 'ORR R0, R1, R2', 'LDR R0, [R1, #4]', 'STR R0, [R1]', 'B .', 'ADD PC, PC, R0']) {
    assert.equal(tierOfSrc(s), 'H', s);
  }
  for (const s of ['CMP R0, #1', 'MOV R0, R1', 'TST R0, R1', 'EOR R0, R1, R2', 'ADD R0, R1, R2, LSL #2', 'LSL R0, R1, #3', 'BL .', 'LDRB R0, [R1]',
    'LDR R0, [R1, #-4]', 'STR R0, [R1, #-4]', 'BIC R0, R1, R2', 'ADC R0, R1, R2', 'SBC R0, R1, R2', 'RSB R0, R1, R2', 'CMN R0, R1', 'TEQ R0, R1']) {
    assert.equal(tierOfSrc(s), 'E', s);
  }
  for (const s of ['MOV R0, #256', 'RSC R0, R1, R2', 'MVN R0, R1', 'RRX R0, R1', 'ADD R0, R1, R2, LSL R3', 'STRB R0, [R1]', 'LDR R0, [R1, #4]!',
    'LDR R0, [R1], #4', 'LDR R0, [R1, R2]', 'LDR R0, [PC, #4]', 'PUSH {R0, R1}', 'LDM R0, {R1}']) {
    assert.equal(tierOfSrc(s), 'I', s);
  }
  const base = words('\tCMP R0, #1\n\tPUSH {R0, R1}\n\tADD R0, R0, #1', { profile: 'arm-single' }).p;
  assert.equal(base.ok, false);
  assert.equal(base.assembled, true);
  assert.deepEqual(base.diagnostics.map((d) => [d.line, d.kind]), [[1, 'profile'], [2, 'profile']]);
  const ext = words('\tCMP R0, #1\n\tPUSH {R0, R1}\n\tMOV R0, #0x100', { profile: 'arm-multi', subset: 'extended' }).p;
  assert.deepEqual(ext.diagnostics.map((d) => d.line), [2, 3]);
});

test('fields name Harris\'s bits; describe gives the format and immediate', () => {
  const f = fields(0xE2432EFF);
  assert.deepEqual(f.map((x) => [x.name, x.bits, x.value]), [['cond', '31:28', 14], ['op', '27:26', 0], ['I', '25', 1], ['cmd', '24:21', 2],
    ['S', '20', 0], ['Rn', '19:16', 3], ['Rd', '15:12', 2], ['rot', '11:8', 14], ['imm8', '7:0', 255]]);
  assert.match(f[7].meaning, /4080/);
  assert.deepEqual(fields(0xE405B01A).map((x) => x.name), ['cond', 'op', 'Ī', 'P', 'U', 'B', 'W', 'L', 'Rn', 'Rd', 'imm12']);
  assert.deepEqual(fields(0xE1A04638).map((x) => x.name), ['cond', 'op', 'I', 'cmd', 'S', 'Rn', 'Rd', 'Rs', '7', 'sh', '4', 'Rm']);
  assert.deepEqual(fields(0xEBFFFFFA, 0x8050).map((x) => [x.name, x.value]), [['cond', 14], ['op', 2], ['funct', 3], ['imm24', 0xFFFFFA]]);
  assert.match(fields(0xEBFFFFFA, 0x8050)[3].meaning, /00008040/);
  assert.deepEqual(fields(0xE92D4010).map((x) => x.name), ['cond', 'op', '25', 'P', 'U', 'S', 'W', 'L', 'Rn', 'list']);
  for (const w of [0xE0865007, 0xE405B01A, 0xEF000000]) for (const x of fields(w)) assert.ok(/^\d+(:\d+)?$/.test(x.bits) && Number.isInteger(x.value));
  assert.deepEqual(describe(0xE2432EFF), { kind: 'Data-processing, immediate', immediate: 0xFF0 });
  assert.deepEqual(describe(0xE405B01A), { kind: 'Memory, immediate offset', immediate: -26 });
  assert.equal(describe(0xEF000000), null);
});

test('scratch: a word decodes, an instruction encodes, a label or directive is refused', () => {
  assert.deepEqual(scratch('0xE281002A').rows.map((r) => r.text), ['ADD R0, R1, #42']);
  assert.equal(scratch('0xEF000000').ok, false);
  assert.equal(scratch('ADD R0, R1, #42').rows[0].word, 0xE281002A);
  assert.equal(scratch('MOV R0, #0x101').ok, false);
  assert.equal(scratch('x: B .').ok, false);
  assert.equal(scratch('.word 1').ok, false);
  assert.equal(scratch('').kind, 'empty');
});

test('images: .hex is one word per line; .bin the text segment\'s bytes; both load back', () => {
  const { p } = words('\tADD R0, R1, #42\n\tB .\n\t.data\n\t.word 7');
  const img = image(p);
  assert.equal(img.hex, 'e281002a\neafffffe\n');
  assert.deepEqual([...img.bin], [0x2a, 0x00, 0x81, 0xe2, 0xfe, 0xff, 0xff, 0xea]);
  assert.deepEqual(loadImage(img.hex, 'hex', 'x.hex').listing.map((r) => r.word), [0xE281002A, HALT_WORD]);
  assert.deepEqual(loadImage(img.bin, 'bin', 'x.bin').listing.map((r) => r.word), [0xE281002A, HALT_WORD]);
  assert.throws(() => loadImage('xyz', 'hex', 'x.hex'), /not a word/);
  assert.throws(() => loadImage(new Uint8Array(3), 'bin', 'x.bin'), /whole number/);
});

test('editor: help and detail for every mnemonic it lists, a condition named in the help', () => {
  for (const m of editor.mnemonics) {
    assert.equal(editor.help(m)?.kind, 'instruction', m);
    assert.ok(editor.detail(m).length > 0, m);
  }
  assert.match(editor.help('addeq').operation, /condition EQ/);
  assert.match(editor.help('ldmfd').operation, /same instruction as LDM/);
  assert.equal(editor.help('mul'), null);
});
