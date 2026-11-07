// language.js -- the pico2 module's assembly language (P1-M1): a two-pass assembler for the RP2350's Hazard3 instruction set
// (RV32IMAC, Zba, Zbb, Zbs, Zbkb, Zcb, Zcmp, Zicsr, Zifencei, Xh3bextm, mret, wfi), the disassembler and the editor's lists.
// Own code, written from the RISC-V specifications' encodings; it shares nothing with the RISC-V module's assembler
// (docs/ADDING-SIMULATORS.md). Every instruction it emits is decoded again with core/decode.js and must give back the same
// operation and operands, so an operand out of range is reported rather than silently truncated. Compressed instructions
// are written explicitly (`c.addi`, `cm.push`); the assembler does not compress. The 16-bit encodings are found in an index of
// every halfword the decoder accepts (built on first use), so the assembler and the decoder cannot disagree about them.
// Syntax: GNU-style; `#` starts a comment; labels end with ':'; ABI or xN register names. Directives: .text .data .rodata .bss
// .section .globl .global .align .balign .p2align .word .half .short .byte .ascii .asciz .string .space .zero .equ .set.
// Pseudo-instructions: nop li la mv not neg seqz snez sltz sgtz beqz bnez blez bgez bltz bgtz bgt ble bgtu bleu j jal(1) jr
// jalr(1) ret call tail csrr csrw csrs csrc csrwi csrsi csrci rdcycle rdinstret zext.b c.nop. Expressions: numbers, labels,
// .equ symbols, + and -, %hi() and %lo(). Memory map of P1-M1 (before the SVD address map of P1-M2): .text at 0x20000000, .data
// at 0x20040000, both in the 520 KiB of SRAM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ABI, OP, decode, zcmpSReg } from './core/decode.js';
import { disassemble as dis, CSR_NAMES } from './core/disasm.js';
import { PICO2_STRINGS as S } from './strings.js';

export const RAM_BASE = 0x20000000;
export const RAM_SIZE = 0x82000; // 520 KiB (RP-001 §2.2)
export const TEXT_BASE = 0x20000000;
export const DATA_BASE = 0x20040000;
export const STACK_TOP = RAM_BASE + RAM_SIZE;

const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
const hex = (v) => '0x' + (v >>> 0).toString(16);

// ---- registers and CSRs ----
const REG = new Map();
ABI.forEach((n, i) => { REG.set(n, i); REG.set(`x${i}`, i); });
REG.set('fp', 8);
const CSR_BY_NAME = new Map(Object.entries(CSR_NAMES).map(([a, n]) => [n, Number(a)]));

// ---- operand keys: one value per operand of a decoder format, so that a parsed instruction and a decoded one compare ----
function keyOf(d) {
  if (!d.fmt) return '';
  return d.fmt.split(',').map((t) => {
    switch (t) {
      case 'rd': return d.rd; case 'rs1': return d.rs1; case 'rs2': return d.rs2; case 'sp': return 'sp';
      case 'imm': case 'shamt': case 'target': case 'csr': case 'size': case 'fence': return d.imm;
      case 'hi': return (d.imm >>> 12) & 0xfffff;
      case 'uimm': return d.rs1; case 'shamt5': return d.rs2; case 'rlist': return d.rs1;
      case 'imm(rs1)': return `${d.imm}(${d.rs1})`; case 'imm(sp)': return d.imm; case '(rs1)': return d.rs1;
      case 'sa': return zcmpSReg(d.rs1); case 'sb': return zcmpSReg(d.rs2);
      default: throw new Error(`keyOf: ${t}`);
    }
  }).join(',');
}

// ---- the 16-bit index: mnemonic -> {fmt, key -> halfword} ----
let C16 = null;
function c16() {
  if (C16) return C16;
  C16 = new Map();
  for (let h = 0; h < 0x10000; h++) {
    if ((h & 3) === 3) continue;
    const d = decode(h);
    if (d.op === OP.ILLEGAL) continue;
    let e = C16.get(d.mn);
    if (!e) C16.set(d.mn, (e = { fmt: d.fmt, map: new Map() }));
    const k = keyOf(d);
    if (!e.map.has(k)) e.map.set(k, h);
  }
  return C16;
}

// ---- 32-bit encoders: mnemonic -> [format (as decode.js writes it), encode(values) -> word] ----
const R = (f7, f3, op = 0x33) => ['rd,rs1,rs2', ([rd, rs1, rs2]) => (f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op];
const IA = (f3) => ['rd,rs1,imm', ([rd, rs1, imm]) => ((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x13];
const SH = (f3, f7) => ['rd,rs1,shamt', ([rd, rs1, s]) => (f7 << 25) | ((s & 0x1f) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x13];
const UN = (f3, imm12) => ['rd,rs1', ([rd, rs1]) => (imm12 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x13];
const LD = (f3, op = 0x03) => ['rd,imm(rs1)', ([rd, [imm, rs1]]) => ((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op];
const ST = (f3) => ['rs2,imm(rs1)', ([rs2, [imm, rs1]]) => (((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((imm & 0x1f) << 7) | 0x23];
const BR = (f3) => ['rs1,rs2,target', ([rs1, rs2, o]) => (((o >> 12) & 1) << 31) | (((o >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (((o >> 1) & 0xf) << 8) | (((o >> 11) & 1) << 7) | 0x63];
const CS = (f3) => ['rd,csr,rs1', ([rd, csr, rs1]) => ((csr & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x73];
const CSI = (f3) => ['rd,csr,uimm', ([rd, csr, u]) => ((csr & 0xfff) << 20) | ((u & 0x1f) << 15) | (f3 << 12) | (rd << 7) | 0x73];
const AMO = (f5) => ['rd,rs2,(rs1)', ([rd, rs2, rs1], aqrl) => (f5 << 27) | (aqrl << 25) | (rs2 << 20) | (rs1 << 15) | (2 << 12) | (rd << 7) | 0x2f];
const FIX = (w) => ['', () => w];

const ENC32 = {
  lui: ['rd,hi', ([rd, hi]) => ((hi & 0xfffff) << 12) | (rd << 7) | 0x37],
  auipc: ['rd,hi', ([rd, hi]) => ((hi & 0xfffff) << 12) | (rd << 7) | 0x17],
  jal: ['rd,target', ([rd, o]) => (((o >> 20) & 1) << 31) | (((o >> 1) & 0x3ff) << 21) | (((o >> 11) & 1) << 20) | (((o >> 12) & 0xff) << 12) | (rd << 7) | 0x6f],
  jalr: LD(0, 0x67),
  beq: BR(0), bne: BR(1), blt: BR(4), bge: BR(5), bltu: BR(6), bgeu: BR(7),
  lb: LD(0), lh: LD(1), lw: LD(2), lbu: LD(4), lhu: LD(5), sb: ST(0), sh: ST(1), sw: ST(2),
  addi: IA(0), slti: IA(2), sltiu: IA(3), xori: IA(4), ori: IA(6), andi: IA(7),
  slli: SH(1, 0x00), srli: SH(5, 0x00), srai: SH(5, 0x20), bclri: SH(1, 0x24), bseti: SH(1, 0x14), binvi: SH(1, 0x34), bexti: SH(5, 0x24), rori: SH(5, 0x30),
  clz: UN(1, 0x600), ctz: UN(1, 0x601), cpop: UN(1, 0x602), 'sext.b': UN(1, 0x604), 'sext.h': UN(1, 0x605), zip: UN(1, 0x08f), unzip: UN(5, 0x08f),
  'orc.b': UN(5, 0x287), rev8: UN(5, 0x698), brev8: UN(5, 0x687),
  add: R(0, 0), sll: R(0, 1), slt: R(0, 2), sltu: R(0, 3), xor: R(0, 4), srl: R(0, 5), or: R(0, 6), and: R(0, 7),
  mul: R(1, 0), mulh: R(1, 1), mulhsu: R(1, 2), mulhu: R(1, 3), div: R(1, 4), divu: R(1, 5), rem: R(1, 6), remu: R(1, 7),
  sub: R(0x20, 0), sra: R(0x20, 5), andn: R(0x20, 7), orn: R(0x20, 6), xnor: R(0x20, 4),
  sh1add: R(0x10, 2), sh2add: R(0x10, 4), sh3add: R(0x10, 6), min: R(0x05, 4), minu: R(0x05, 5), max: R(0x05, 6), maxu: R(0x05, 7),
  rol: R(0x30, 1), ror: R(0x30, 5), bclr: R(0x24, 1), bext: R(0x24, 5), bset: R(0x14, 1), binv: R(0x34, 1), pack: R(0x04, 4), packh: R(0x04, 7),
  'zext.h': ['rd,rs1', ([rd, rs1]) => (0x04 << 25) | (rs1 << 15) | (4 << 12) | (rd << 7) | 0x33],
  csrrw: CS(1), csrrs: CS(2), csrrc: CS(3), csrrwi: CSI(5), csrrsi: CSI(6), csrrci: CSI(7),
  'lr.w': ['rd,(rs1)', ([rd, rs1], aqrl) => (2 << 27) | (aqrl << 25) | (rs1 << 15) | (2 << 12) | (rd << 7) | 0x2f],
  'sc.w': AMO(3), 'amoswap.w': AMO(1), 'amoadd.w': AMO(0), 'amoxor.w': AMO(4), 'amoand.w': AMO(0x0c), 'amoor.w': AMO(0x08),
  'amomin.w': AMO(0x10), 'amomax.w': AMO(0x14), 'amominu.w': AMO(0x18), 'amomaxu.w': AMO(0x1c),
  ecall: FIX(0x00000073), ebreak: FIX(0x00100073), mret: FIX(0x30200073), wfi: FIX(0x10500073), 'fence.i': FIX(0x0000100f), 'fence.tso': FIX(0x8330000f),
  fence: ['fence', ([ps]) => (ps << 20) | 0x0f],
  'h3.bextm': ['rd,rs1,rs2,size', ([rd, rs1, rs2, size]) => (((size - 1) & 7) << 26) | (rs2 << 20) | (rs1 << 15) | (rd << 7) | 0x0b],
  'h3.bextmi': ['rd,rs1,shamt5,size', ([rd, rs1, s, size]) => (((size - 1) & 7) << 26) | ((s & 0x1f) << 20) | (rs1 << 15) | (4 << 12) | (rd << 7) | 0x0b],
};

const PSEUDO = ['nop', 'li', 'la', 'mv', 'not', 'neg', 'seqz', 'snez', 'sltz', 'sgtz', 'beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz', 'bgt', 'ble',
  'bgtu', 'bleu', 'j', 'jr', 'ret', 'call', 'tail', 'csrr', 'csrw', 'csrs', 'csrc', 'csrwi', 'csrsi', 'csrci', 'rdcycle', 'rdinstret', 'zext.b', 'c.nop'];
const DIRECTIVES = ['.text', '.data', '.rodata', '.bss', '.section', '.globl', '.global', '.align', '.balign', '.p2align', '.word', '.half', '.short',
  '.byte', '.ascii', '.asciz', '.string', '.space', '.zero', '.equ', '.set'];
const AMO_BASE = new Set(['lr.w', 'sc.w', 'amoswap.w', 'amoadd.w', 'amoxor.w', 'amoand.w', 'amoor.w', 'amomin.w', 'amomax.w', 'amominu.w', 'amomaxu.w']);

/** Every mnemonic the assembler takes: the 32-bit ones, the compressed ones of the decoder, and the pseudo-instructions. */
export function mnemonics() {
  return [...new Set([...Object.keys(ENC32), ...c16().keys(), ...PSEUDO])].sort();
}

// ---- lexing ----
class AsmError extends Error {
  constructor(message, note) { super(message); this.note = note; }
}
const fail = (m, note) => { throw new AsmError(m, note); };

/** Split operands at top-level commas (not inside parentheses or braces); strings stay whole. */
function splitOperands(s) {
  const out = []; let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q && !cur.endsWith('\\' + q)) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '{') depth++;
    if (ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() !== '' || out.length) out.push(cur.trim());
  return out;
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' || (c === '/' && line[i + 1] === '/')) return line.slice(0, i);
  }
  return line;
}

function reg(tok) {
  const r = REG.get(tok.trim().toLowerCase());
  if (r === undefined) fail(S.asm.badRegister(tok.trim()));
  return r;
}

// ---- expressions: terms joined by + and -; a term is a number, a character, a symbol, %hi(e) or %lo(e) ----
function evaluate(text, ctx) {
  const s = text.replace(/\s+/g, '');
  if (s === '') fail(S.asm.needsValue);
  let i = 0, total = 0, sign = 1, any = false;
  while (i < s.length) {
    if (s[i] === '+') { i++; continue; }
    if (s[i] === '-') { sign = -sign; i++; continue; }
    let v, m;
    const rest = s.slice(i);
    if ((m = /^%(hi|lo)\(/.exec(rest))) {
      let depth = 1, j = m[0].length;
      while (j < rest.length && depth) { if (rest[j] === '(') depth++; if (rest[j] === ')') depth--; j++; }
      if (depth) fail(S.asm.badExpression(text));
      const inner = evaluate(rest.slice(m[0].length, j - 1), ctx);
      v = m[1] === 'hi' ? ((inner + 0x800) >>> 12) & 0xfffff : sext(inner & 0xfff, 12);
      i += j;
    } else if ((m = /^(0x[0-9a-f]+|0b[01]+|[0-9]+)/i.exec(rest))) {
      const t = m[1].toLowerCase();
      v = t.startsWith('0b') ? parseInt(t.slice(2), 2) : t.startsWith('0x') ? parseInt(t.slice(2), 16) : parseInt(t, 10);
      if (/^[0-9a-z_]/i.test(rest.slice(m[1].length))) fail(S.asm.badNumber(text));
      i += m[1].length;
    } else if ((m = /^'(\\?.)'/.exec(rest))) {
      v = m[1].length === 2 ? { n: 10, t: 9, r: 13, 0: 0, '\\': 92, "'": 39 }[m[1][1]] ?? m[1].charCodeAt(1) : m[1].charCodeAt(0);
      i += m[0].length;
    } else if ((m = /^[A-Za-z_.$][A-Za-z0-9_.$]*/.exec(rest))) {
      const name = m[0];
      if (name === '.') v = ctx.pc;
      else if (Object.hasOwn(ctx.symbols, name)) v = ctx.symbols[name];
      else if (ctx.final) fail(S.asm.undefinedSymbol(name));
      else { ctx.unresolved = true; v = 0; }
      i += name.length;
    } else fail(S.asm.badExpression(text));
    total += sign * v; sign = 1; any = true;
  }
  if (!any) fail(S.asm.badExpression(text));
  return total | 0;
}

// ---- one operand of an instruction format, parsed into its key value ----
function operand(kind, tok, ctx, pc) {
  switch (kind) {
    case 'rd': case 'rs1': case 'rs2': case 'sa': case 'sb': return reg(tok);
    case 'sp': if (reg(tok) !== 2) fail(S.asm.needsSp); return 'sp';
    case 'imm': case 'shamt': case 'size': case 'uimm': case 'shamt5': case 'hi': return evaluate(tok, ctx);
    case 'target': return (evaluate(tok, ctx) - pc) | 0;
    case 'csr': { const n = CSR_BY_NAME.get(tok.trim().toLowerCase()); return n ?? evaluate(tok, ctx); }
    case 'imm(rs1)': case 'imm(sp)': case '(rs1)': {
      const m = /^(.*)\(\s*([^()]+)\s*\)\s*$/.exec(tok);
      if (!m) fail(S.asm.needsMemory(tok));
      const base = reg(m[2]);
      if (kind === '(rs1)') { if (m[1].trim() !== '' && evaluate(m[1], ctx) !== 0) fail(S.asm.needsMemory(tok)); return base; }
      const off = m[1].trim() === '' ? 0 : evaluate(m[1], ctx);
      if (kind === 'imm(sp)') { if (base !== 2) fail(S.asm.needsSp); return off; }
      return [off, base];
    }
    case 'rlist': return rlistOf(tok);
    default: throw new Error(`operand kind ${kind}`);
  }
}

/** {ra}, {ra, s0}, {ra, s0-sN} (N from 1 to 9 or 11) -> the rlist field, 4 to 15. */
function rlistOf(tok) {
  const m = /^\{\s*(ra|x1)\s*(?:,\s*(s0|x8|fp)\s*(?:-\s*(s\d+|x\d+)\s*)?)?\}$/i.exec(tok.trim());
  if (!m) fail(S.asm.badRlist(tok));
  if (!m[2]) return 4;
  if (!m[3]) return 5;
  const last = reg(m[3]);
  const n = last === 9 ? 2 : last >= 18 && last <= 27 ? last - 18 + 3 : -1; // s registers in the list
  if (n < 2 || n === 11) fail(S.asm.badRlist(tok));
  return n === 12 ? 15 : n + 4;
}

const keyText = (vals) => vals.map((v) => (Array.isArray(v) ? `${v[0]}(${v[1]})` : v)).join(',');

/** Encode one real instruction (no pseudo) at `pc`: {word, size}. */
function encodeOne(mn, ops, ctx, pc) {
  let m = mn.toLowerCase();
  let aqrl = 0;
  const amo = /^(.*\.w)\.(aqrl|aq|rl)$/.exec(m);
  if (amo && AMO_BASE.has(amo[1])) { m = amo[1]; aqrl = { aq: 2, rl: 1, aqrl: 3 }[amo[2]]; }
  if (m === 'fence' && ops.length === 0) ops = ['iorw', 'iorw'];
  const enc = ENC32[m];
  if (enc) {
    const [fmt, build] = enc;
    let vals;
    if (fmt === 'fence') {
      if (ops.length !== 2) fail(S.asm.operandCount(m, 2));
      const set = (t) => { const x = t.trim().toLowerCase(); if (!/^[iorw]+$/.test(x) && x !== '0') fail(S.asm.badFence(t)); return (x.includes('i') ? 8 : 0) | (x.includes('o') ? 4 : 0) | (x.includes('r') ? 2 : 0) | (x.includes('w') ? 1 : 0); };
      vals = [(set(ops[0]) << 4) | set(ops[1])];
    } else {
      const kinds = fmt === '' ? [] : fmt.split(',');
      if (ops.length !== kinds.length) fail(S.asm.operandCount(m, kinds.length));
      vals = kinds.map((k, i) => operand(k, ops[i], ctx, pc));
    }
    const word = build(vals, aqrl) | 0;
    if (ctx.final && fmt !== '') check(word, m, keyText(vals), aqrl); // a fixed word (ecall, fence.tso) has nothing to range-check
    return { word, size: 4 };
  }
  const e = c16().get(m);
  if (e) {
    const kinds = e.fmt === '' ? [] : e.fmt.split(',');
    if (ops.length !== kinds.length) fail(S.asm.operandCount(m, kinds.length));
    const vals = kinds.map((k, i) => operand(k, ops[i], ctx, pc));
    const h = e.map.get(keyText(vals));
    if (h === undefined) {
      if (!ctx.final) return { word: 0, size: 2 }; // a label not yet known: checked in the second pass
      fail(S.asm.notEncodable(m), S.asm.notEncodableNote);
    }
    return { word: h, size: 2 };
  }
  fail(S.asm.unknown(mn), S.asm.unknownNote);
}

/** The emitted word must decode to the same operation and operands (catches immediates out of range). */
function check(word, m, key, aqrl) {
  const d = decode(word);
  if (d.mn !== m || keyOf(d) !== key || (d.aqrl ?? 0) !== aqrl) fail(S.asm.outOfRange(m), S.asm.outOfRangeNote(m));
}

// ---- pseudo-instructions: their expansion, given the pass's knowledge; `size` decided in the first pass ----
function expand(mn, ops, ctx, pc, decided) {
  const m = mn.toLowerCase();
  const need = (n) => { if (ops.length !== n) fail(S.asm.operandCount(m, n)); };
  const r = (i) => ABI[reg(ops[i])];
  switch (m) {
    case 'nop': need(0); return [['addi', ['zero', 'zero', '0']]];
    case 'c.nop': need(0); return [['c.addi', ['zero', '0']]];
    case 'mv': need(2); return [['addi', [r(0), r(1), '0']]];
    case 'not': need(2); return [['xori', [r(0), r(1), '-1']]];
    case 'neg': need(2); return [['sub', [r(0), 'zero', r(1)]]];
    case 'seqz': need(2); return [['sltiu', [r(0), r(1), '1']]];
    case 'snez': need(2); return [['sltu', [r(0), 'zero', r(1)]]];
    case 'sltz': need(2); return [['slt', [r(0), r(1), 'zero']]];
    case 'sgtz': need(2); return [['slt', [r(0), 'zero', r(1)]]];
    case 'zext.b': need(2); return [['andi', [r(0), r(1), '255']]];
    case 'beqz': need(2); return [['beq', [r(0), 'zero', ops[1]]]];
    case 'bnez': need(2); return [['bne', [r(0), 'zero', ops[1]]]];
    case 'blez': need(2); return [['bge', ['zero', r(0), ops[1]]]];
    case 'bgez': need(2); return [['bge', [r(0), 'zero', ops[1]]]];
    case 'bltz': need(2); return [['blt', [r(0), 'zero', ops[1]]]];
    case 'bgtz': need(2); return [['blt', ['zero', r(0), ops[1]]]];
    case 'bgt': need(3); return [['blt', [r(1), r(0), ops[2]]]];
    case 'ble': need(3); return [['bge', [r(1), r(0), ops[2]]]];
    case 'bgtu': need(3); return [['bltu', [r(1), r(0), ops[2]]]];
    case 'bleu': need(3); return [['bgeu', [r(1), r(0), ops[2]]]];
    case 'j': need(1); return [['jal', ['zero', ops[0]]]];
    case 'jal': return ops.length === 1 ? [['jal', ['ra', ops[0]]]] : null; // jal rd, target is the real instruction
    case 'jr': need(1); return [['jalr', ['zero', `0(${r(0)})`]]];
    case 'jalr': return ops.length === 1 ? [['jalr', ['ra', `0(${r(0)})`]]] : null;
    case 'ret': need(0); return [['jalr', ['zero', '0(ra)']]];
    case 'csrr': need(2); return [['csrrs', [r(0), ops[1], 'zero']]];
    case 'csrw': need(2); return [['csrrw', ['zero', ops[0], r(1)]]];
    case 'csrs': need(2); return [['csrrs', ['zero', ops[0], r(1)]]];
    case 'csrc': need(2); return [['csrrc', ['zero', ops[0], r(1)]]];
    case 'csrwi': need(2); return [['csrrwi', ['zero', ops[0], ops[1]]]];
    case 'csrsi': need(2); return [['csrrsi', ['zero', ops[0], ops[1]]]];
    case 'csrci': need(2); return [['csrrci', ['zero', ops[0], ops[1]]]];
    case 'rdcycle': need(1); return [['csrrs', [r(0), 'cycle', 'zero']]];
    case 'rdinstret': need(1); return [['csrrs', [r(0), 'instret', 'zero']]];
    case 'li': {
      need(2);
      const sub = { ...ctx, unresolved: false };
      const v = evaluate(ops[1], sub);
      const small = decided ? decided.small : !sub.unresolved && v >= -2048 && v <= 2047;
      if (small) {
        if (ctx.final && (v < -2048 || v > 2047)) fail(S.asm.liChanged);
        return { small, list: [['addi', [r(0), 'zero', String(v)]]] };
      }
      const hi = ((v + 0x800) >>> 12) & 0xfffff, lo = sext(v & 0xfff, 12);
      return { small, list: [['lui', [r(0), hex(hi)]], ['addi', [r(0), r(0), String(lo)]]] };
    }
    case 'la': case 'call': case 'tail': {
      need(m === 'la' ? 2 : 1);
      const target = evaluate(m === 'la' ? ops[1] : ops[0], { ...ctx });
      const off = (target - pc) | 0;
      const hi = ((off + 0x800) >>> 12) & 0xfffff, lo = sext(off & 0xfff, 12);
      const rd = m === 'la' ? r(0) : m === 'call' ? 'ra' : 't1';
      return [['auipc', [rd, hex(hi)]], m === 'la' ? ['addi', [rd, rd, String(lo)]] : ['jalr', [m === 'call' ? 'ra' : 'zero', `${lo}(${rd})`]]];
    }
    default: return null;
  }
}

// ---- data directives ----
function stringBytes(tok) {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(tok.trim());
  if (!m) fail(S.asm.badString(tok));
  const out = [];
  for (let i = 0; i < m[1].length; i++) {
    let c = m[1][i];
    if (c === '\\') { const n = m[1][++i]; c = { n: '\n', t: '\t', r: '\r', 0: '\0', '\\': '\\', '"': '"', "'": "'" }[n] ?? n; }
    const code = c.charCodeAt(0);
    if (code > 255) fail(S.asm.badString(tok));
    out.push(code);
  }
  return out;
}

/**
 * Assemble source files (the contract's Language.assemble). One program: the files in order, sharing their symbols.
 * @returns {import('../contract.js').Program}
 */
export function assemble(files) {
  const diagnostics = [];
  const statements = [];
  // parse once: labels, mnemonic or directive, operands
  for (const f of files) {
    f.text.split(/\r?\n/).forEach((raw, i) => {
      let text = stripComment(raw);
      const labels = [];
      let m;
      while ((m = /^\s*([A-Za-z_.$][A-Za-z0-9_.$]*)\s*:/.exec(text))) { labels.push(m[1]); text = text.slice(m[0].length); }
      const body = text.trim();
      const sm = /^(\S+)\s*(.*)$/.exec(body);
      statements.push({ file: f.name, line: i + 1, raw: raw.trim(), labels, op: sm ? sm[1] : null, args: sm ? sm[2] : '', column: raw.indexOf(sm ? sm[1] : '') + 1 });
    });
  }
  const run = (final, symbols, decisions) => {
    const pcs = { text: TEXT_BASE, data: DATA_BASE };
    let sec = 'text';
    const out = { text: [], data: [], listing: [], dataRows: [], symbols };
    for (const s of statements) {
      for (const l of s.labels) { // defined in the first pass; a second definition is reported once and ignored
        if (final) continue;
        if (Object.hasOwn(symbols, l)) diagnostics.push({ severity: 'error', file: s.file, line: s.line, column: 1, length: l.length, message: S.asm.duplicateLabel(l) });
        else symbols[l] = pcs[sec];
      }
      try {
        if (!s.op) continue;
        const op = s.op.toLowerCase();
        const ctx = { symbols, final, pc: pcs[sec], unresolved: false };
        const ops = s.args === '' ? [] : splitOperands(s.args);
        if (op.startsWith('.')) { directive(op, ops, s, ctx); continue; }
        if (sec !== 'text') fail(S.asm.codeInData);
        if (pcs.text & 1) fail(S.asm.misalignedCode);
        const ex = expand(op, ops, ctx, pcs.text, decisions.get(s));
        const list = ex === null ? [[s.op, ops]] : Array.isArray(ex) ? ex : ex.list;
        if (ex && !Array.isArray(ex) && !final) decisions.set(s, { small: ex.small });
        list.forEach(([mn, o], part) => {
          const pc = pcs.text;
          const { word, size } = encodeOne(mn, o, { ...ctx, pc }, pc);
          out.text.push({ address: pc, word, size });
          if (final) out.listing.push({ address: pc, size, word: size === 2 ? word & 0xffff : word, text: dis(word, pc), file: s.file, line: s.line, part, ...(ex !== null ? { source: s.raw } : {}) });
          pcs.text += size;
        });
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        if (final) diagnostics.push({ severity: 'error', file: s.file, line: s.line, column: s.column, length: s.op ? s.op.length : 1, message: e.message, ...(e.note ? { note: e.note } : {}) });
      }
    }
    if (pcs.text > DATA_BASE) diagnostics.push({ severity: 'error', message: S.asm.textTooLong });
    if (pcs.data > RAM_BASE + RAM_SIZE) diagnostics.push({ severity: 'error', message: S.asm.dataTooLong });
    return out;

    function directive(op, ops, s, ctx) {
      const emit = (bytes, what) => {
        const a = pcs[sec];
        if (sec === 'text') out.text.push({ address: a, bytes });
        else out.data.push({ address: a, bytes });
        if (final) out.dataRows.push({ address: a, bytes: Uint8Array.from(bytes), file: s.file, line: s.line, text: what });
        pcs[sec] += bytes.length;
      };
      const align = (n) => { const a = pcs[sec]; const pad = (n - (a % n)) % n; if (pad) emit(new Array(pad).fill(0), '.align'); };
      switch (op) {
        case '.text': sec = 'text'; return;
        case '.data': case '.rodata': case '.bss': sec = 'data'; return;
        case '.section': sec = /^\.?text/.test(ops[0] ?? '') ? 'text' : 'data'; return;
        case '.globl': case '.global': return;
        case '.equ': case '.set': {
          if (ops.length !== 2) fail(S.asm.operandCount(op, 2));
          if (!/^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(ops[0])) fail(S.asm.badSymbol(ops[0]));
          symbols[ops[0]] = evaluate(ops[1], ctx); // again in the second pass, where an undefined symbol is reported
          return;
        }
        case '.align': case '.p2align': { const n = evaluate(ops[0] ?? '', ctx); if (n < 0 || n > 16) fail(S.asm.badAlign(n)); align(1 << n); return; }
        case '.balign': { const n = evaluate(ops[0] ?? '', ctx); if (n < 1 || (n & (n - 1))) fail(S.asm.badAlign(n)); align(n); return; }
        case '.space': case '.zero': { const n = evaluate(ops[0] ?? '', ctx); if (n < 0 || n > RAM_SIZE) fail(S.asm.badSpace(n)); emit(new Array(n).fill(0), s.raw); return; }
        case '.word': case '.half': case '.short': case '.byte': {
          const w = op === '.word' ? 4 : op === '.byte' ? 1 : 2;
          if (!ops.length) fail(S.asm.needsValue);
          const bytes = [];
          for (const t of ops) {
            const v = evaluate(t, { ...ctx });
            if (w < 4 && (v < -(1 << (8 * w - 1)) || v >= (1 << (8 * w)))) fail(S.asm.dataRange(v, w));
            for (let k = 0; k < w; k++) bytes.push((v >>> (8 * k)) & 0xff);
          }
          emit(bytes, s.raw); return;
        }
        case '.ascii': case '.asciz': case '.string': {
          if (!ops.length) fail(S.asm.needsValue);
          const bytes = ops.flatMap((t) => [...stringBytes(t), ...(op === '.ascii' ? [] : [0])]);
          emit(bytes, s.raw); return;
        }
        default: fail(S.asm.unknown(op), S.asm.unknownNote);
      }
    }
  };
  const symbols = {};
  const decisions = new Map();
  run(false, symbols, decisions); // addresses and symbols; its only messages are duplicate labels
  const out = run(true, symbols, decisions);
  const ok = !diagnostics.some((d) => d.severity === 'error');
  const segments = [];
  for (const [items, executable] of [[out.text, true], [out.data, false]]) {
    if (!items.length) continue;
    const lo = items[0].address, hi = items.reduce((a, it) => Math.max(a, it.address + (it.bytes ? it.bytes.length : it.size)), lo);
    const bytes = new Uint8Array(hi - lo);
    for (const it of items) {
      if (it.bytes) bytes.set(it.bytes, it.address - lo);
      else for (let k = 0; k < it.size; k++) bytes[it.address - lo + k] = (it.word >>> (8 * k)) & 0xff;
    }
    segments.push({ address: lo, bytes, executable });
  }
  const entry = Object.hasOwn(symbols, '_start') ? symbols._start >>> 0 : TEXT_BASE;
  return {
    ok, diagnostics, segments, entry, listing: out.listing,
    symbols: { ...symbols }, data: out.dataRows,
    symbolTable: Object.entries(symbols).map(([name, address]) => ({ name, address: address >>> 0 })),
  };
}

/** Disassemble a fetch word at `address` (the contract's Language.disassemble). */
export const disassemble = (word, address = 0) => dis(word | 0, address | 0);

/** The editor's completion lists (WS-F-140). */
export const editor = Object.freeze({
  get mnemonics() { return mnemonics(); },
  registers: [...ABI, ...ABI.map((_, i) => `x${i}`), 'fp'],
  directives: DIRECTIVES,
});

