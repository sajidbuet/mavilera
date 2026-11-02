// armv7/language.js -- the ARMv7 (A32) assembly language on the contract (Language, spec W-D29; roadmap ARM-A1):
// the instruction table, the decoder, the assembler, the disassembler, the encoding fields and the editor data. One
// table (INSTRUCTIONS) names every instruction with its class and fixed bits; decode() is the single description of
// what a word means, used by the disassembler, the inspector, the engine and the assembler's own check of every word
// it writes. Encodings, tiers and rules: reference sheet docs/architecture/armv7-reference.md (§§2-9; spec W-D32,
// W-D33), from ARM DDI 0406C.d and Harris and Harris's ARM edition. The simulator's own code (C4). No DOM.
//
// Tiers (sheet §1): H, the Harris base processor; E, the Chapter 7 exercise extensions; I, the instruction-level
// profile only. The profile `arm-iss` accepts all three; a hardware profile (ARM-A2 to A4) accepts H, or H and E with
// the subset 'extended'. A word outside every tier, or UNPREDICTABLE, is refused by the assembler and stops the engine.
//
// Source (UAL, as Harris writes it): `[label[:]] mnemonic operands [; comment]`, case-insensitive; a label without a
// colon must start in the first column. Comments start with ; or // (not GNU's @). Mnemonics take {S}{cond} in either order
// (ADDSEQ or ADDEQS). Constants take #. Directives: .text, .data, .word, .byte, .ascii, .asciz, .space, .align,
// .balign, .equ, .set, .global. Numbers: decimal, 0x…, 0b… or 'c'; an expression is a sum of numbers, symbols and `.`
// (the instruction's address). A branch target or ADR operand that is a number is an address. Two pseudo-instructions
// (author, A1-Q5b): NOP is MOV R0, R0; LDR Rd, =value is MOV or MVN when the value is a modified immediate, otherwise
// a PC-relative LDR of a word in the literal pool, which follows the last item of .text (one word per distinct value).
// Decisions A1-Q1 to A1-Q6: docs/architecture/armv7-a1-verification.md §5.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ARMV7_STRINGS as S } from './strings.js';
import { applyLoads } from '../../shell/data-io.js';

/** Where .text and .data start and the initial SP (the RISC-V `iss` layout, core/profiles.js; A1-Q4). */
export const TEXT_BASE = 0x0000_0000;
export const DATA_BASE = 0x0001_0000;
export const STACK_TOP = 0x0010_0000;
/** B . with condition AL: the program ends (as RISC-V's `jal x0, 0`; A1-Q1, W-D34). */
export const HALT_WORD = 0xeafffffe;

export const CONDS = Object.freeze(['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL']);
const COND_CODE = Object.freeze({ ...Object.fromEntries(CONDS.map((c, i) => [c, i])), HS: 2, LO: 3 });
/** The cmd field of data-processing (sheet §4.2). */
export const DP_NAMES = Object.freeze(['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC', 'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN']);
export const SHIFT_NAMES = Object.freeze(['LSL', 'LSR', 'ASR', 'ROR']);
const TESTS = new Set([8, 9, 10, 11]);
const ONE_OPERAND = new Set([13, 15]); // MOV, MVN: no Rn
const ARITH = new Set([2, 3, 4, 5, 6, 7, 10, 11]);
const H_CMDS = new Set([0, 2, 4, 12]); // AND, SUB, ADD, ORR (sheet §1)
const I_CMDS = new Set([7, 15]); // RSC, MVN
export const REG_NAMES = Object.freeze([...Array.from({ length: 13 }, (_, i) => `R${i}`), 'SP', 'LR', 'PC']);
const TIER_RANK = { H: 0, E: 1, I: 2 };

/**
 * The instruction table: mnemonic → class and fixed bits. `s`: takes the S suffix. Aliases name the same rows
 * (sheet §7); the other block-transfer modes are refused by name.
 */
export const INSTRUCTIONS = Object.freeze({
  ...Object.fromEntries(DP_NAMES.map((m, cmd) => [m, { cls: 'dp', cmd, s: !TESTS.has(cmd) }])),
  ...Object.fromEntries(SHIFT_NAMES.map((m, sh) => [m, { cls: 'shift', cmd: 13, sh, s: true }])),
  RRX: { cls: 'rrx', cmd: 13, sh: 3, s: true },
  ADR: { cls: 'adr' },
  LDR: { cls: 'mem', L: 1, B: 0 }, STR: { cls: 'mem', L: 0, B: 0 }, LDRB: { cls: 'mem', L: 1, B: 1 }, STRB: { cls: 'mem', L: 0, B: 1 },
  B: { cls: 'branch', L: 0 }, BL: { cls: 'branch', L: 1 },
  LDM: { cls: 'block', L: 1, P: 0, U: 1 }, STM: { cls: 'block', L: 0, P: 0, U: 1 }, STMDB: { cls: 'block', L: 0, P: 1, U: 0 },
  PUSH: { cls: 'push' }, POP: { cls: 'pop' },
  NOP: { cls: 'nop' }, // pseudo-instruction: MOV R0, R0 (HH Table B.1 note; A1-Q5b)
});
const ALIASES = Object.freeze({ LDMIA: 'LDM', LDMFD: 'LDM', STMIA: 'STM', STMEA: 'STM', STMFD: 'STMDB' });
const REFUSED_BLOCK = ['LDMDA', 'LDMDB', 'LDMIB', 'LDMEA', 'LDMED', 'LDMFA', 'STMDA', 'STMIB', 'STMED', 'STMFA'];

/** Every accepted spelling: UAL (ADDSEQ) first, then the older order (ADDEQS, LDREQB, LDMEQIA). */
const SPELLINGS = new Map();
const REFUSED = new Map();
{
  const conds = ['', ...CONDS, 'HS', 'LO'];
  const add = (map, text, v) => { if (!map.has(text)) map.set(text, v); };
  const spell = (map, name, base, s) => {
    for (const c of conds) {
      const v = { name: base, as: name, s: Boolean(s), cond: c ? COND_CODE[c] : 14 };
      add(map, `${name}${s ? 'S' : ''}${c}`, v);
      if (s) add(map, `${name}${c}S`, v);
      if (/^(LDR|STR)B$/.test(name)) add(map, `${name.slice(0, 3)}${c}B`, v);
      if (/^(LDM|STM)..$/.test(name)) add(map, `${name.slice(0, 3)}${c}${name.slice(3)}`, v);
    }
  };
  for (const [name, row] of Object.entries(INSTRUCTIONS)) for (const s of row.s ? [false, true] : [false]) spell(SPELLINGS, name, name, s);
  for (const [name, base] of Object.entries(ALIASES)) spell(SPELLINGS, name, base, false);
  for (const name of REFUSED_BLOCK) spell(REFUSED, name, name, false);
}
/** The instruction a spelling names: {name, as, s, cond}, or null. */
export const spelling = (t) => SPELLINGS.get(t.toUpperCase()) ?? null;

export const DIRECTIVES = Object.freeze(['.text', '.data', '.word', '.byte', '.ascii', '.asciz', '.space', '.skip', '.align', '.balign',
  '.equ', '.set', '.global', '.globl']);

// ---------------------------------------------------------------------------------------------------------------
// Bits

export const ror = (v, n) => { const k = n & 31; return (k ? (v >>> k) | (v << (32 - k)) : v) >>> 0; };
const rol = (v, n) => ror(v, 32 - (n & 31));
const popcount = (x) => { let n = 0; for (let v = x; v; v &= v - 1) n += 1; return n; };
const lowest = (x) => 31 - Math.clz32(x & -x);
export const hex8 = (v) => (v >>> 0).toString(16).toUpperCase().padStart(8, '0');
const hexAddr = (v) => `0x${(v >>> 0).toString(16).toUpperCase()}`;

/** The modified immediate of a 32-bit value with the lowest rotation (A5-198), or null. */
export function encodeImmediate(value) {
  const v = value >>> 0;
  for (let rot = 0; rot < 16; rot++) {
    const x = rol(v, 2 * rot);
    if (x <= 0xff) return { rot, imm8: x };
  }
  return null;
}

/** DecodeImmShift (A8-290): the shift type (0 LSL, 1 LSR, 2 ASR, 3 ROR, 4 RRX) and amount of a constant shift. */
export function immShift(sh, imm5) {
  if (sh === 0) return [0, imm5];
  if (sh === 1 || sh === 2) return [sh, imm5 || 32];
  return imm5 ? [3, imm5] : [4, 1];
}

/** The mnemonic of MOV with a register operand (sheet §4.3). */
const shiftName = (sh, shamt) => (sh === 0 && shamt === 0 ? 'MOV' : sh === 3 && shamt === 0 ? 'RRX' : SHIFT_NAMES[sh]);

// ---------------------------------------------------------------------------------------------------------------
// The decoder

/**
 * What a word means: {word, cond, op, cls, name, tier, ...its fields}, with `bad` (an out-of-scope key of
 * S.outOfScope; nothing else is set) or `unpredictable` (a key of S.unpredictable). `halt` for HALT_WORD.
 */
export function decode(word) {
  const w = word >>> 0;
  const cond = w >>> 28;
  const op = (w >>> 26) & 3;
  const base = { word: w, cond, op };
  const bit = (n) => (w >>> n) & 1;
  const Rn = (w >>> 16) & 15;
  const Rd = (w >>> 12) & 15;
  if (cond === 15) return { ...base, bad: 'uncond' };
  if (op === 0) {
    const I = bit(25);
    const cmd = (w >>> 21) & 15;
    const Sb = bit(20);
    if (!I && bit(4) && bit(7)) return { ...base, bad: 'multiply' };
    if (TESTS.has(cmd) && !Sb) return { ...base, bad: 'misc' };
    if (Rd === 15 && Sb && !TESTS.has(cmd)) return { ...base, bad: 'pcFlags' };
    const d = { ...base, cls: 'dp', I, cmd, S: Sb, Rn, Rd, name: DP_NAMES[cmd] };
    if (I) {
      d.form = 'imm';
      d.rot = (w >>> 8) & 15;
      d.imm8 = w & 0xff;
      d.imm32 = ror(d.imm8, 2 * d.rot);
    } else {
      d.form = bit(4) ? 'rsr' : 'reg';
      d.sh = (w >>> 5) & 3;
      d.Rm = w & 15;
      if (d.form === 'rsr') d.Rs = (w >>> 8) & 15; else d.shamt = (w >>> 7) & 31;
      if (cmd === 13) d.name = d.form === 'rsr' ? SHIFT_NAMES[d.sh] : shiftName(d.sh, d.shamt);
    }
    if ((TESTS.has(cmd) && Rd !== 0) || (ONE_OPERAND.has(cmd) && Rn !== 0)) d.unpredictable = 'sbz';
    else if (d.form === 'rsr' && [d.Rm, d.Rs, ...(TESTS.has(cmd) ? [] : [Rd]), ...(ONE_OPERAND.has(cmd) ? [] : [Rn])].includes(15)) d.unpredictable = 'pcRsr';
    let tier = H_CMDS.has(cmd) ? 'H' : I_CMDS.has(cmd) ? 'I' : 'E';
    if ((d.form === 'imm' && d.rot) || d.form === 'rsr' || d.name === 'RRX') tier = 'I';
    else if (d.form === 'reg' && (d.shamt || d.sh) && tier === 'H') tier = 'E';
    d.tier = tier;
    return d;
  }
  if (op === 1) {
    const Ibar = bit(25);
    const [P, U, B, W, L] = [bit(24), bit(23), bit(22), bit(21), bit(20)];
    if (Ibar && bit(4)) return { ...base, bad: 'media' };
    if (!P && W) return { ...base, bad: 'unpriv' };
    const d = { ...base, cls: 'mem', Ibar, P, U, B, W, L, Rn, Rd, name: `${L ? 'LDR' : 'STR'}${B ? 'B' : ''}`, wback: !P || W === 1 };
    if (Ibar) { d.shamt = (w >>> 7) & 31; d.sh = (w >>> 5) & 3; d.Rm = w & 15; } else d.imm12 = w & 0xfff;
    d.literal = Boolean(L && Rn === 15 && !Ibar);
    if (d.literal && P === W) d.unpredictable = 'literal';
    else if (Ibar && d.Rm === 15) d.unpredictable = 'pcOffset';
    else if (B && Rd === 15) d.unpredictable = 'pcByte';
    else if (d.wback && (Rn === Rd || Rn === 15)) d.unpredictable = 'wback';
    d.tier = Ibar || d.wback || d.literal || (B && !L) ? 'I' : B || !U ? 'E' : 'H';
    return d;
  }
  if (op === 2 && bit(25)) {
    const L = bit(24);
    const imm24 = w & 0xffffff;
    return { ...base, cls: 'branch', L, imm24, offset: ((imm24 << 8) >> 6), name: L ? 'BL' : 'B', tier: L ? 'E' : 'H', ...(w === HALT_WORD ? { halt: true } : {}) };
  }
  if (op === 2) {
    const [P, U, S22, W, L] = [bit(24), bit(23), bit(22), bit(21), bit(20)];
    if (S22) return { ...base, bad: 'userRegs' };
    const name = !P && U ? (L ? 'LDM' : 'STM') : P && !U && !L ? 'STMDB' : null;
    if (!name) return { ...base, bad: 'blockMode' };
    const list = w & 0xffff;
    const d = { ...base, cls: 'block', P, U, W, L, Rn, list, name, tier: 'I' };
    if (Rn === 15) d.unpredictable = 'pcBase';
    else if (!list) d.unpredictable = 'emptyList';
    else if (L && W && (list >> Rn) & 1) d.unpredictable = 'wbackList';
    else if (!L && W && (list >> Rn) & 1 && lowest(list) !== Rn) d.unpredictable = 'storeBase';
    return d;
  }
  return { ...base, bad: 'coproc' };
}

/** Whether tier `t` is inside the limit (H < E < I). */
export const withinTier = (t, limit) => TIER_RANK[t] <= TIER_RANK[limit];
const HARDWARE = new Set(['arm-single', 'arm-multi', 'arm-pipe']);
/** The highest tier a profile runs (W-D32 Q1, Q2, Q11). */
export const tierOf = (profile = 'arm-iss', subset = null) => (HARDWARE.has(profile) ? (subset === 'extended' ? 'E' : 'H') : 'I');

// ---------------------------------------------------------------------------------------------------------------
// The disassembler

const reg = (n) => REG_NAMES[n];
const condText = (c) => (c === 14 ? '' : CONDS[c]);
const immText = (v) => (v <= 0xffff ? String(v) : hexAddr(v));
const regList = (list) => `{${Array.from({ length: 16 }, (_, i) => i).filter((i) => (list >> i) & 1).map(reg).join(', ')}}`;

/** The constant shift of a register operand, as text (', LSL #3'; '' for none). */
function shiftText(sh, shamt) {
  const [t, n] = immShift(sh, shamt);
  if (t === 0 && n === 0) return '';
  return t === 4 ? ', RRX' : `, ${SHIFT_NAMES[t]} #${n}`;
}

/** Src2 of a data-processing word, as text. */
function src2Text(d) {
  if (d.form === 'imm') {
    const low = encodeImmediate(d.imm32);
    return low.rot === d.rot ? `#${immText(d.imm32)}` : `#${d.imm8}, #${2 * d.rot}`; // A0-Q2: the pair only when needed
  }
  if (d.form === 'rsr') return `${reg(d.Rm)}, ${SHIFT_NAMES[d.sh]} ${reg(d.Rs)}`;
  return `${reg(d.Rm)}${shiftText(d.sh, d.shamt)}`;
}

/** The instruction a word stands for, in UAL with Harris's register names; a word outside the subset as `.word`. */
export function disassemble(word, address = 0) {
  const d = decode(word);
  const c = condText(d.cond);
  switch (d.cls) {
    case 'dp': {
      const S_ = d.S && !TESTS.has(d.cmd) ? 'S' : '';
      if (d.form === 'imm' && d.Rn === 15 && !d.S && (d.cmd === 4 || d.cmd === 2)) { // ADR (sheet §4.6, A0-Q2), when it reads back
        const t = address + 8 + (d.cmd === 4 ? d.imm32 : -d.imm32);
        if (t >= 0 && t <= 0xffffffff && encodeImmediate(d.imm32).rot === d.rot && (d.cmd === 4 || d.imm32)) return `ADR${c} ${reg(d.Rd)}, ${hexAddr(t)}`;
      }
      if (TESTS.has(d.cmd)) return `${d.name}${c} ${reg(d.Rn)}, ${src2Text(d)}`;
      if (d.cmd === 13 && d.form !== 'imm' && d.name !== 'MOV') {
        if (d.name === 'RRX') return `RRX${S_}${c} ${reg(d.Rd)}, ${reg(d.Rm)}`;
        const amount = d.form === 'rsr' ? reg(d.Rs) : `#${immShift(d.sh, d.shamt)[1]}`;
        return `${d.name}${S_}${c} ${reg(d.Rd)}, ${reg(d.Rm)}, ${amount}`;
      }
      if (ONE_OPERAND.has(d.cmd)) return `${d.name}${S_}${c} ${reg(d.Rd)}, ${src2Text(d)}`;
      return `${d.name}${S_}${c} ${reg(d.Rd)}, ${reg(d.Rn)}, ${src2Text(d)}`;
    }
    case 'mem': {
      if (!d.Ibar && d.Rn === 13 && d.imm12 === 4 && !d.B) { // PUSH and POP of one register (sheet §7)
        if (!d.L && d.P && !d.U && d.W) return `PUSH${c} {${reg(d.Rd)}}`;
        if (d.L && !d.P && d.U && !d.W) return `POP${c} {${reg(d.Rd)}}`;
      }
      const sign = d.U ? '' : '-';
      const off = d.Ibar ? `${sign}${reg(d.Rm)}${shiftText(d.sh, d.shamt)}` : `#${sign}${d.imm12}`;
      const at = !d.P ? `[${reg(d.Rn)}], ${off}`
        : !d.Ibar && d.imm12 === 0 && d.U && !d.W ? `[${reg(d.Rn)}]` : `[${reg(d.Rn)}, ${off}]${d.W ? '!' : ''}`;
      return `${d.name}${c} ${reg(d.Rd)}, ${at}`;
    }
    case 'branch': return `${d.name}${c} ${hexAddr(address + 8 + d.offset)}`;
    case 'block': {
      if (d.Rn === 13 && d.W && popcount(d.list) >= 2 && d.name !== 'STM') return `${d.name === 'LDM' ? 'POP' : 'PUSH'}${c} ${regList(d.list)}`;
      return `${d.name}${c} ${reg(d.Rn)}${d.W ? '!' : ''}, ${regList(d.list)}`;
    }
    default: return `.word 0x${hex8(word)}`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Fields, for the inspector and the listing's binary column (Harris's names, W-D32 Q4)

const F = S.fieldMeaning;

/** The encoding fields of a word: {name, bits, value, short, meaning}. */
export function fields(word, address = 0) {
  const w = word >>> 0;
  const d = decode(w);
  const f = (name, hi, lo, meaning = '', short = name) => {
    const value = Math.floor(w / 2 ** lo) % 2 ** (hi - lo + 1);
    return { name, bits: hi === lo ? `${hi}` : `${hi}:${lo}`, value, short, meaning: typeof meaning === 'function' ? meaning(value) : meaning };
  };
  const cond = f('cond', 31, 28, (v) => (v === 15 ? '1111' : F.cond(CONDS[v], S.conditions[CONDS[v]])));
  const op = f('op', 27, 26, F.op);
  const regf = (name, hi, lo) => f(name, hi, lo, (v) => F.reg(reg(v)));
  const shiftF = () => [f('shamt5', 11, 7, F.shamt5), f('sh', 6, 5, F.sh), f('4', 4, 4, F.fixed, '·'), regf('Rm', 3, 0)];
  switch (d.cls) {
    case 'dp': return [cond, op, f('I', 25, 25, F.I), f('cmd', 24, 21, () => F.cmd(d.name)), f('S', 20, 20, F.S), regf('Rn', 19, 16), regf('Rd', 15, 12),
      ...(d.form === 'imm' ? [f('rot', 11, 8, (v) => F.rot(v, d.imm32)), f('imm8', 7, 0, F.imm8)]
        : d.form === 'rsr' ? [regf('Rs', 11, 8), f('7', 7, 7, F.fixed, '·'), f('sh', 6, 5, F.sh), f('4', 4, 4, F.fixed, '·'), regf('Rm', 3, 0)]
          : shiftF())];
    case 'mem': return [cond, op, f('Ī', 25, 25, F.Ibar, 'I'), f('P', 24, 24, F.P), f('U', 23, 23, F.U), f('B', 22, 22, F.B), f('W', 21, 21, F.W),
      f('L', 20, 20, F.L), regf('Rn', 19, 16), regf('Rd', 15, 12), ...(d.Ibar ? shiftF() : [f('imm12', 11, 0, F.imm12)])];
    case 'branch': return [cond, op, f('funct', 25, 24, () => F.funct(d.L)), f('imm24', 23, 0, () => F.imm24(address + 8 + d.offset))];
    case 'block': return [cond, op, f('25', 25, 25, F.fixed, '·'), f('P', 24, 24, F.P), f('U', 23, 23, F.U), f('S', 22, 22, F.S22), f('W', 21, 21, F.W),
      f('L', 20, 20, F.L), regf('Rn', 19, 16), f('list', 15, 0, () => F.list(regList(d.list)))];
    default: return [cond, op, f('—', 25, 0, S.outOfScope[d.bad] ?? '', '—')];
  }
}

/** The word tooltip of the listing: the format name and the immediate. */
export function describe(word) {
  const d = decode(word);
  const K = S.format;
  switch (d.cls) {
    case 'dp': return d.form === 'imm' ? { kind: K.dpImm, immediate: d.imm32 } : { kind: d.form === 'rsr' ? K.dpShift : K.dpReg };
    case 'mem': return d.Ibar ? { kind: K.memReg } : { kind: K.memImm, immediate: d.U ? d.imm12 : -d.imm12 };
    case 'branch': return { kind: K.branch, immediate: d.offset };
    case 'block': return { kind: K.block };
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The assembler

class AsmError extends Error {
  constructor(message, token = null, note = null) { super(message); this.token = token; this.note = note; }
}

/** A register number, or null. */
export function registerOf(t) {
  const m = /^(?:R(\d{1,2})|(SP)|(LR)|(PC))$/i.exec(t.trim());
  if (!m) return null;
  if (m[1] !== undefined) { const n = Number(m[1]); return n <= 15 && String(n) === m[1] ? n : null; }
  return m[2] ? 13 : m[3] ? 14 : 15;
}
const needReg = (t) => {
  const r = registerOf(t);
  if (r === null) throw new AsmError(S.asm.badRegister(t.trim()), t.trim());
  return r;
};

/** A number in one of the accepted notations, or null. */
export function parseNumber(t) {
  const s = t.trim();
  let m;
  if ((m = /^([-+]?)(\d+)$/.exec(s))) return Number(m[1] + m[2]);
  if ((m = /^([-+]?)0x([0-9a-f]+)$/i.exec(s))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 16);
  if ((m = /^([-+]?)0b([01]+)$/i.exec(s))) return (m[1] === '-' ? -1 : 1) * parseInt(m[2], 2);
  if ((m = /^'(\\?.)'$/.exec(s))) return m[1] === '\\n' ? 10 : m[1] === '\\t' ? 9 : m[1] === '\\0' ? 0 : m[1].slice(-1).charCodeAt(0);
  return null;
}

const SYMBOL = /^[A-Za-z_.$][\w.$]*$/;

/** A sum of numbers, symbols and `.`; `symbols` a Map; throws AsmError. */
function evaluate(text, symbols, here) {
  const s = text.trim();
  if (!s) throw new AsmError(S.asm.badExpression(text), text);
  let total = 0;
  let sign = 1;
  let want = true; // a term is expected
  for (const [tok] of s.matchAll(/'(?:\\.|[^'])'|[+-]|[^+\-\s]+|\s+/g)) {
    if (/^\s+$/.test(tok)) continue;
    if (tok === '+' || tok === '-') { if (tok === '-') sign = -sign; if (!want && tok) want = true; continue; }
    if (!want) throw new AsmError(S.asm.badExpression(s), s);
    let v = parseNumber(tok);
    if (v === null && tok === '.') v = here;
    if (v === null) {
      if (!SYMBOL.test(tok)) throw new AsmError(S.asm.badExpression(s), s);
      if (!symbols.has(tok)) throw new AsmError(S.asm.undefinedSymbol(tok), tok);
      v = symbols.get(tok);
    }
    total += sign * v;
    sign = 1;
    want = false;
  }
  if (want) throw new AsmError(S.asm.badExpression(s), s);
  return total;
}

/** Operands split at the commas outside [], {} and quotes. */
function splitOperands(text) {
  const out = [];
  let depth = 0;
  let q = null;
  let cur = '';
  for (const ch of text) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** The source line without its comment (; or //, outside quotes). */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\') i += 1; else if (c === q) q = null; continue; }
    if (c === '"' || (c === "'" && /'(?:\\.|[^'])'/.test(line.slice(i, i + 4)))) { q = c; continue; }
    if (c === ';' || (c === '/' && line[i + 1] === '/')) return line.slice(0, i);
  }
  return line;
}

const word = (cond, rest) => ((cond << 28) | rest) >>> 0;
const usageOf = (name) => S.editorHelp[name]?.usage ?? name;

/** A constant shift from text ('LSL #3', 'RRX'): {sh, shamt}; `allowReg` also accepts 'LSR R6': {sh, Rs}. */
function parseShift(t, ctx, allowReg) {
  const s = t.trim();
  if (/^RRX$/i.test(s)) return { sh: 3, shamt: 0 };
  const m = /^(LSL|LSR|ASR|ROR)\s+(.+)$/i.exec(s);
  if (!m) throw new AsmError(S.asm.badShift(s), s);
  const op = m[1].toUpperCase();
  const sh = SHIFT_NAMES.indexOf(op);
  const arg = m[2].trim();
  if (!arg.startsWith('#')) {
    const r = registerOf(arg);
    if (r === null || !allowReg) throw new AsmError(S.asm.badShift(s), s);
    return { sh, Rs: r };
  }
  return { sh, shamt: shiftAmount(op, evaluate(arg.slice(1), ctx.symbols, ctx.at), arg) };
}

/** The shamt5 of a constant shift (sheet §4.3, A0-Q2): LSL 0-31, LSR and ASR 1-32 (32 written 0), ROR 1-31. */
function shiftAmount(op, n, token) {
  if (n === 0 && op !== 'LSL') throw new AsmError(S.asm.shiftZero(op), token);
  const [lo, hi] = op === 'LSL' ? [0, 31] : op === 'ROR' ? [1, 31] : [1, 32];
  if (!Number.isInteger(n) || n < lo || n > hi) throw new AsmError(S.asm.shiftRange(op, lo, hi), token);
  return n & 31;
}

/** Src2 of a data-processing instruction from operands ops[k…]: the bits 25 and 11:0. */
function src2(ops, k, name, ctx) {
  const rest = ops.slice(k);
  if (!rest.length || rest.some((x) => !x)) throw new AsmError(S.asm.operands(name, usageOf(name)), ops.join(', '));
  const first = rest[0];
  if (first.startsWith('#')) {
    if (rest.length === 2 && rest[1].startsWith('#')) { // #byte, #rotation (A5-198)
      const b = evaluate(first.slice(1), ctx.symbols, ctx.at);
      const r = evaluate(rest[1].slice(1), ctx.symbols, ctx.at);
      if (b < 0 || b > 255 || r < 0 || r > 30 || r % 2) throw new AsmError(S.asm.rotatePair, `${first}, ${rest[1]}`);
      return (1 << 25) | ((r / 2) << 8) | b;
    }
    if (rest.length !== 1) throw new AsmError(S.asm.operands(name, usageOf(name)), rest.join(', '));
    const v = evaluate(first.slice(1), ctx.symbols, ctx.at);
    const e = v >= -0x80000000 && v <= 0xffffffff ? encodeImmediate(v >>> 0) : null;
    if (!e) throw new AsmError(S.asm.immediate(v), first, S.asm.immediateNote);
    return (1 << 25) | (e.rot << 8) | e.imm8;
  }
  const Rm = registerOf(first);
  if (Rm === null) throw new AsmError(parseNumber(first) !== null ? S.asm.needsHash(first) : S.asm.badRegister(first), first);
  if (rest.length === 1) return Rm;
  if (rest.length !== 2) throw new AsmError(S.asm.operands(name, usageOf(name)), rest.join(', '));
  const s = parseShift(rest[1], ctx, true);
  return s.Rs !== undefined ? (s.Rs << 8) | (s.sh << 5) | 0x10 | Rm : (s.shamt << 7) | (s.sh << 5) | Rm;
}

/** An offset of a memory instruction ('#-4', '-R2, LSL #2'): {Ibar, U, bits 11:0}. */
function memOffset(t, ctx) {
  const s = t.trim();
  if (s.startsWith('#')) {
    const v = evaluate(s.slice(1), ctx.symbols, ctx.at);
    if (v < -4095 || v > 4095) throw new AsmError(S.asm.offsetRange(v), s);
    return { Ibar: 0, U: v > 0 || (v === 0 && !/^#\s*-/.test(s)) ? 1 : 0, bits: Math.abs(v) };
  }
  const m = /^([+-]?)\s*([A-Za-z]\w*)\s*(?:,(.+))?$/.exec(s);
  if (!m) throw new AsmError(S.asm.badAddress(s), s);
  const Rm = needReg(m[2]);
  const sh = m[3] ? parseShift(m[3], ctx, false) : { sh: 0, shamt: 0 };
  return { Ibar: 1, U: m[1] === '-' ? 0 : 1, bits: (sh.shamt << 7) | (sh.sh << 5) | Rm };
}

/** A register list '{R0, R2-R4, LR}': the 16-bit mask. */
function parseList(t) {
  const m = /^\{(.*)\}$/.exec(t.trim());
  if (!m) throw new AsmError(S.asm.badList(t.trim()), t.trim());
  if (!m[1].trim()) throw new AsmError(S.asm.emptyList, t.trim());
  let list = 0;
  for (const item of m[1].split(',')) {
    const r = /^\s*(\w+)\s*(?:-\s*(\w+)\s*)?$/.exec(item);
    if (!r) throw new AsmError(S.asm.badList(t.trim()), t.trim());
    const a = needReg(r[1]);
    const b = r[2] ? needReg(r[2]) : a;
    if (b < a) throw new AsmError(S.asm.badList(item.trim()), item.trim());
    for (let i = a; i <= b; i++) {
      if ((list >> i) & 1) throw new AsmError(S.asm.listTwice(i), item.trim());
      list |= 1 << i;
    }
  }
  return list;
}

/** The word of one instruction at `ctx.at`: `sp` from spelling(), `ops` the operand text. Throws AsmError. */
function encode(sp, opsText, ctx) {
  const row = INSTRUCTIONS[sp.name];
  const { cond } = sp;
  const ops = splitOperands(opsText);
  const name = sp.as;
  const arity = (n) => { if (ops.length < n || ops.slice(0, n).some((x) => !x)) throw new AsmError(S.asm.operands(name, usageOf(sp.name)), opsText || name); };
  const S_ = sp.s ? 1 : 0;
  switch (row.cls) {
    case 'dp': {
      if (TESTS.has(row.cmd)) { arity(2); return word(cond, (row.cmd << 21) | (1 << 20) | (needReg(ops[0]) << 16) | src2(ops, 1, name, ctx)); }
      if (ONE_OPERAND.has(row.cmd)) { arity(2); return word(cond, (row.cmd << 21) | (S_ << 20) | (needReg(ops[0]) << 12) | src2(ops, 1, name, ctx)); }
      arity(3);
      return word(cond, (row.cmd << 21) | (S_ << 20) | (needReg(ops[1]) << 16) | (needReg(ops[0]) << 12) | src2(ops, 2, name, ctx));
    }
    case 'shift': {
      arity(3);
      if (ops.length !== 3) throw new AsmError(S.asm.operands(name, usageOf(sp.name)), opsText);
      const Rd = needReg(ops[0]);
      const Rm = needReg(ops[1]);
      let bits;
      if (ops[2].startsWith('#')) {
        const n = evaluate(ops[2].slice(1), ctx.symbols, ctx.at);
        if (n === 0 && sp.name === 'LSL') bits = Rm; // LSL #0 is MOV (A0-Q2)
        else bits = (shiftAmount(sp.name, n, ops[2]) << 7) | (row.sh << 5) | Rm;
      } else bits = (needReg(ops[2]) << 8) | (row.sh << 5) | 0x10 | Rm;
      return word(cond, (13 << 21) | (S_ << 20) | (Rd << 12) | bits);
    }
    case 'rrx': {
      arity(2);
      if (ops.length !== 2) throw new AsmError(S.asm.operands(name, usageOf(sp.name)), opsText);
      return word(cond, (13 << 21) | (S_ << 20) | (needReg(ops[0]) << 12) | (3 << 5) | needReg(ops[1]));
    }
    case 'adr': {
      arity(2);
      const Rd = needReg(ops[0]);
      const off = evaluate(ops[1], ctx.symbols, ctx.at) - (ctx.at + 8);
      const e = encodeImmediate(Math.abs(off));
      if (!e || Math.abs(off) > 0xffffffff) throw new AsmError(S.asm.adrRange(off), ops[1]);
      return word(cond, (1 << 25) | ((off >= 0 ? 4 : 2) << 21) | (15 << 16) | (Rd << 12) | (e.rot << 8) | e.imm8);
    }
    case 'mem': {
      arity(2);
      const Rt = needReg(ops[0]);
      const t = opsText.slice(opsText.indexOf(',') + 1).trim();
      let Rn, P, W, off;
      let m;
      if (t.startsWith('=')) { // LDR Rd, =value (A1-Q5b)
        if (!row.L || row.B) throw new AsmError(S.asm.literalLdr, t);
        const v = evaluate(t.slice(1), ctx.symbols, ctx.at);
        if (v < -0x80000000 || v > 0xffffffff) throw new AsmError(S.asm.valueRange('=', v), t);
        const u = v >>> 0;
        const e = encodeImmediate(u);
        const n = encodeImmediate(~u >>> 0);
        if (e || n) return word(cond, (1 << 25) | ((e ? 13 : 15) << 21) | (Rt << 12) | (e ? (e.rot << 8) | e.imm8 : (n.rot << 8) | n.imm8));
        const p = ctx.pool;
        if (!p.at.has(u)) { p.at.set(u, p.base + 4 * p.words.length); p.words.push({ value: u, item: ctx.item }); }
        const d = p.at.get(u) - (ctx.at + 8);
        if (d < -4095 || d > 4095) throw new AsmError(S.asm.poolRange(d), t);
        return word(cond, (1 << 26) | (1 << 24) | ((d >= 0 ? 1 : 0) << 23) | (1 << 20) | (15 << 16) | (Rt << 12) | Math.abs(d));
      }
      if ((m = /^\[([^\],]+)\]\s*(!?)$/.exec(t))) { Rn = needReg(m[1]); P = 1; W = m[2] ? 1 : 0; off = { Ibar: 0, U: 1, bits: 0 }; }
      else if ((m = /^\[([^\],]+),(.+)\]\s*(!?)$/.exec(t))) { Rn = needReg(m[1]); P = 1; W = m[3] ? 1 : 0; off = memOffset(m[2], ctx); }
      else if ((m = /^\[([^\],]+)\]\s*,(.+)$/.exec(t))) { Rn = needReg(m[1]); P = 0; W = 0; off = memOffset(m[2], ctx); }
      else if (row.L && !/^[[#{]/.test(t)) { // a label: PC-relative (literal), sheet §5.3
        const v = evaluate(t, ctx.symbols, ctx.at) - (ctx.at + 8);
        if (v < -4095 || v > 4095) throw new AsmError(S.asm.offsetRange(v), t);
        Rn = 15; P = 1; W = 0; off = { Ibar: 0, U: v >= 0 ? 1 : 0, bits: Math.abs(v) };
      } else throw new AsmError(S.asm.badAddress(t), t);
      return word(cond, (1 << 26) | (off.Ibar << 25) | (P << 24) | (off.U << 23) | (row.B << 22) | (W << 21) | (row.L << 20) | (Rn << 16) | (Rt << 12) | off.bits);
    }
    case 'branch': {
      arity(1);
      if (ops.length !== 1) throw new AsmError(S.asm.operands(name, usageOf(sp.name)), opsText);
      const off = evaluate(ops[0], ctx.symbols, ctx.at) - (ctx.at + 8);
      if (off % 4) throw new AsmError(S.asm.branchAlign, ops[0]);
      if (off < -33554432 || off > 33554428) throw new AsmError(S.asm.branchRange(off), ops[0]);
      return word(cond, (5 << 25) | (row.L << 24) | ((off >> 2) & 0xffffff));
    }
    case 'block': {
      arity(2);
      const m = /^(\w+)\s*(!?)$/.exec(ops[0]);
      if (!m) throw new AsmError(S.asm.badRegister(ops[0]), ops[0]);
      const Rn = needReg(m[1]);
      const list = parseList(opsText.slice(opsText.indexOf(',') + 1));
      return word(cond, (4 << 25) | (row.P << 24) | (row.U << 23) | ((m[2] ? 1 : 0) << 21) | (row.L << 20) | (Rn << 16) | list);
    }
    case 'push': case 'pop': {
      arity(1);
      const list = parseList(opsText);
      const push = row.cls === 'push';
      if (popcount(list) === 1) return word(cond, (push ? 0x052d0004 : 0x049d0004) | (lowest(list) << 12)); // STR Rt, [SP, #-4]! / LDR Rt, [SP], #4
      return word(cond, (push ? 0x092d0000 : 0x08bd0000) | list);
    }
    case 'nop': {
      if (opsText.trim()) throw new AsmError(S.asm.operands(name, usageOf(sp.name)), opsText);
      return word(cond, 0x01a00000); // MOV R0, R0
    }
    default: throw new AsmError(S.asm.unknown(name), name);
  }
}

/**
 * Assemble ARM source files (the contract's Program), in order as one program with one symbol table. Two passes: the
 * first places every item and defines the labels and .equ symbols, the second encodes. Every word is checked by
 * decode(): an out-of-scope or UNPREDICTABLE form is an error, a form above the profile's tier a profile error.
 */
export function assemble(files, { profile = 'arm-iss', subset = null } = {}) {
  const limit = tierOf(profile, subset);
  const diagnostics = [];
  const symbols = new Map();
  const symbolTable = [];
  const items = [];
  const counter = { text: TEXT_BASE, data: DATA_BASE };
  const report = (file, line, raw, e, kind) => {
    const col = e.token ? raw.indexOf(e.token) : -1;
    diagnostics.push({ severity: 'error', file, line, column: col >= 0 ? col + 1 : 1, length: col >= 0 ? e.token.length : raw.trimEnd().length,
      message: e.message, ...(e.note ? { note: e.note } : {}), ...(kind ? { kind } : {}) });
  };

  for (const file of files) {
    let section = 'text';
    file.text.split(/\r?\n/).forEach((raw, i) => {
      const line = i + 1;
      try {
        let code = stripComment(raw);
        let m = /^\s*([A-Za-z_.$][\w.$]*)\s*:/.exec(code);
        let label = null;
        if (m) { label = m[1]; code = code.slice(m[0].length); }
        else if ((m = /^([A-Za-z_][\w$]*)(?=\s|$)/.exec(code)) && !spelling(m[1]) && !REFUSED.has(m[1].toUpperCase())) {
          const next = /^\s*(\S+)/.exec(code.slice(m[0].length));
          if (next && !next[1].startsWith('.') && !spelling(next[1]) && !REFUSED.has(next[1].toUpperCase())) throw new AsmError(S.asm.unknown(m[1]), m[1], S.asm.unknownNote);
          label = m[1]; code = code.slice(m[0].length);
        }
        const h = /^\s*(\S+)\s*(.*?)\s*$/.exec(code);
        const head = h ? h[1] : null;
        if (head?.toLowerCase() === '.equ' || head?.toLowerCase() === '.set') {
          const [nm, ex] = splitOperands(h[2]);
          if (!nm || !SYMBOL.test(nm) || ex === undefined) throw new AsmError(S.asm.needsValue(head), h[2] || head);
          symbols.set(nm, evaluate(ex, symbols, counter[section]));
        }
        if (head && head.startsWith('.') && ['.text', '.data'].includes(head.toLowerCase())) section = head.toLowerCase().slice(1);
        if (head && !head.startsWith('.') && section === 'text') counter.text = (counter.text + 3) & ~3; // instructions are word-aligned
        if (head?.toLowerCase() === '.align' || head?.toLowerCase() === '.balign') {
          const n = evaluate(h[2] || '2', symbols, counter[section]);
          const bytes = head.toLowerCase() === '.align' ? (n < 0 || n > 12 ? NaN : 2 ** n) : n;
          if (!Number.isInteger(bytes) || bytes < 1 || (bytes & (bytes - 1))) throw new AsmError(S.asm.alignRange, h[2]);
          const to = Math.ceil(counter[section] / bytes) * bytes;
          if (to > counter[section]) items.push({ kind: 'data', section, at: counter[section], file: file.name, line, raw, text: '', fill: to - counter[section] });
          counter[section] = to;
        }
        if (label) {
          if (parseNumber(label) !== null || registerOf(label) !== null) throw new AsmError(S.asm.badLabel(label), label);
          if (symbols.has(label)) throw new AsmError(S.asm.duplicateLabel(label), label);
          symbols.set(label, counter[section]);
          symbolTable.push({ name: label, address: counter[section], section, file: file.name, line });
        }
        if (!head) return;
        const at = counter[section];
        const text = stripComment(raw).trim();
        if (head.startsWith('.')) {
          const d = head.toLowerCase();
          if (['.text', '.data', '.global', '.globl', '.equ', '.set', '.align', '.balign'].includes(d)) return;
          let size;
          if (d === '.word' || d === '.byte') size = splitOperands(h[2]).length * (d === '.word' ? 4 : 1);
          else if (d === '.ascii' || d === '.asciz') size = stringBytes(h[2], d === '.asciz').length;
          else if (d === '.space' || d === '.skip') {
            size = evaluate(h[2], symbols, at);
            if (!Number.isInteger(size) || size < 0 || size > 0x100000) throw new AsmError(S.asm.valueRange(d, size), h[2]);
          } else throw new AsmError(S.asm.unknownDirective(head), head, S.asm.directiveNote);
          if (!h[2]) throw new AsmError(S.asm.needsValue(head), head);
          items.push({ kind: 'data', section, at, directive: d, args: h[2], file: file.name, line, raw, text, size });
          counter[section] += size;
          return;
        }
        if (REFUSED.has(head.toUpperCase())) throw new AsmError(S.asm.blockMode(head.toUpperCase()), head);
        const sp = spelling(head);
        if (!sp) throw new AsmError(S.asm.unknown(head), head, S.asm.unknownNote);
        if (section !== 'text') throw new AsmError(S.asm.outside, head);
        items.push({ kind: 'code', section, at, sp, ops: h[2], file: file.name, line, raw, text });
        counter.text += 4;
      } catch (e) {
        if (!(e instanceof AsmError)) throw e;
        report(file.name, line, raw, e);
      }
    });
  }

  const listing = [];
  const data = [];
  const bytes = { text: new Map(), data: new Map() };
  const place = (it, address, b) => {
    for (let k = 0; k < b.length; k++) {
      if (bytes[it.section].has(address + k)) throw new AsmError(S.asm.overlap(address + k));
      bytes[it.section].set(address + k, b[k]);
    }
  };
  let profileErrors = 0;
  // the literal pool of LDR Rd, =value: after the last item of .text
  const pool = { base: (counter.text + 3) & ~3, at: new Map(), words: [] };
  for (const it of items) {
    try {
      if (it.kind === 'code') {
        const w = encode(it.sp, it.ops, { symbols, at: it.at, pool, item: it });
        const d = decode(w);
        if (d.bad) throw new AsmError(S.asm.notInSubset(it.sp.as, S.outOfScope[d.bad]), null);
        if (d.unpredictable) throw new AsmError(S.asm.unpredictable(S.unpredictable[d.unpredictable]), null);
        place(it, it.at, [w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, w >>> 24]);
        const pseudo = it.sp.name === 'NOP' || (it.sp.name === 'LDR' && /,\s*=/.test(it.ops));
        listing.push({ address: it.at, size: 4, word: w, text: it.text, file: it.file, line: it.line, part: 0, ...(pseudo ? { source: it.sp.name } : {}) });
        if (!withinTier(d.tier, limit)) { profileErrors += 1; report(it.file, it.line, it.raw, new AsmError(S.asm.profile(it.sp.as, d.tier), null, S.asm.profileNote), 'profile'); }
      } else {
        const b = it.fill ? new Array(it.fill).fill(0) : dataBytes(it, symbols);
        place(it, it.at, b);
        if (!it.fill) data.push({ address: it.at, bytes: Uint8Array.from(b), file: it.file, line: it.line, text: it.text });
      }
    } catch (e) {
      if (!(e instanceof AsmError)) throw e;
      report(it.file, it.line, it.raw, e);
    }
  }
  pool.words.forEach(({ value, item }, k) => {
    const a = pool.base + 4 * k;
    const b = [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24];
    try { place(item, a, b); } catch (e) { if (!(e instanceof AsmError)) throw e; report(item.file, item.line, item.raw, e); return; }
    data.push({ address: a, bytes: Uint8Array.from(b), file: item.file, line: item.line, text: S.asm.poolWord(value) });
  });
  listing.sort((a, b) => a.address - b.address);
  const segments = [];
  for (const section of ['text', 'data']) {
    const m = bytes[section];
    if (!m.size) continue;
    const lo = section === 'text' ? TEXT_BASE : DATA_BASE;
    const hi = Math.max(...m.keys()) + 1;
    const b = new Uint8Array(hi - lo);
    for (const [a, v] of m) b[a - lo] = v;
    segments.push({ address: lo, bytes: b, executable: section === 'text' });
  }
  const errors = diagnostics.length - profileErrors;
  return {
    ok: diagnostics.length === 0, assembled: errors === 0, diagnostics, segments, entry: TEXT_BASE, listing, data,
    symbols: Object.fromEntries([...symbols].filter(([k]) => symbolTable.some((s) => s.name === k))), symbolTable, profile, subset,
  };
}

/** The bytes of a string directive's operand (C escapes \n \t \0 \\ \"). */
function stringBytes(t, zero) {
  const m = /^"((?:\\.|[^"\\])*)"$/.exec(t.trim());
  if (!m) throw new AsmError(S.asm.badString(t.trim()), t.trim());
  const ESC = { n: 10, t: 9, 0: 0, '\\': 92, '"': 34, "'": 39, r: 13 };
  const out = [];
  for (let i = 0; i < m[1].length; i++) {
    const c = m[1][i];
    if (c === '\\') { i += 1; out.push(ESC[m[1][i]] ?? m[1].charCodeAt(i)); } else out.push(c.charCodeAt(0) & 0xff);
  }
  if (zero) out.push(0);
  return out;
}

/** The bytes of a data item (pass 2: labels are known). */
function dataBytes(it, symbols) {
  const d = it.directive;
  if (d === '.ascii' || d === '.asciz') return stringBytes(it.args, d === '.asciz');
  if (d === '.space' || d === '.skip') return new Array(it.size).fill(0);
  const out = [];
  for (const t of splitOperands(it.args)) {
    const v = evaluate(t, symbols, it.at);
    if (d === '.byte') {
      if (v < -128 || v > 255) throw new AsmError(S.asm.valueRange(d, v), t);
      out.push(v & 0xff);
    } else {
      if (v < -0x80000000 || v > 0xffffffff) throw new AsmError(S.asm.valueRange(d, v), t);
      const u = v >>> 0;
      out.push(u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, u >>> 24);
    }
  }
  return out;
}

/** Assemble with the data files of the data dialog (contract v2 `options.data`, capability dataIO). */
export function assembleWithData(files, { data = [], ...options } = {}) {
  const p = assemble(files, options);
  if (!data.length) return p;
  p.loadReport = applyLoads(p, data);
  for (const d of p.data) {
    const seg = p.segments.find((s) => d.address >= s.address && d.address < s.address + s.bytes.length);
    if (seg) d.bytes = seg.bytes.slice(d.address - seg.address, d.address - seg.address + d.bytes.length);
  }
  return p;
}

/**
 * The scratch line (contract v4 Language.scratch, capability scratch): a number is a word to decode; anything else is
 * one instruction to encode at address 0. Nothing is assembled into the program, so a target is a number.
 */
export function scratch(text) {
  const t = text.trim();
  if (!t) return { kind: 'empty', ok: true };
  const row = (w, src) => ({ address: 0, size: 4, word: w, text: src, part: 0 });
  const n = parseNumber(t);
  if (n !== null) {
    if (n < -0x80000000 || n > 0xffffffff) return { kind: 'decode', ok: false, error: { message: S.asm.valueRange('.word', n) } };
    const w = n >>> 0;
    const d = decode(w);
    return { kind: 'decode', ok: !d.bad, text: disassemble(w, 0), rows: [row(w, disassemble(w, 0))] };
  }
  if (/^\S+:|^\s*\./.test(t)) return { kind: 'encode', ok: false, error: { message: S.scratchOne } };
  const p = assemble([{ name: 'scratch.s', text: `\t${t}` }]);
  const e = p.diagnostics.find((x) => x.kind !== 'profile');
  if (e) return { kind: 'encode', ok: false, error: { message: e.message, ...(e.note ? { note: e.note } : {}) } };
  if (p.listing.length !== 1) return { kind: 'encode', ok: false, error: { message: S.scratchOne } };
  return { kind: 'encode', ok: true, rows: p.listing.map((l) => row(l.word, l.text)) };
}

/** The .hex and .bin images (capability exportImage) of the text segment: one word per line, or its bytes. */
export function image(program) {
  const seg = program.segments.find((s) => s.executable) ?? { bytes: new Uint8Array(0) };
  const b = seg.bytes;
  const words = [];
  for (let i = 0; i < b.length; i += 4) words.push(hex8((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0).toLowerCase());
  return { hex: words.length ? `${words.join('\n')}\n` : '', bin: b.slice() };
}

/** A program from a .hex (one word per line; // and # start a comment) or .bin image, at address 0 (capability imageImport). */
export function loadImage(content, kind, name, { profile = 'arm-iss' } = {}) {
  let bytes;
  if (kind === 'hex') {
    const out = [];
    for (const raw of String(content).split(/\r\n|\r|\n/)) {
      const t = raw.split('//', 1)[0].split('#', 1)[0].trim().replace(/^0x/i, '');
      if (!t) continue;
      if (!/^[0-9a-fA-F]{1,8}$/.test(t)) throw new Error(S.asm.badImageWord(t));
      const v = parseInt(t, 16);
      out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24);
    }
    bytes = Uint8Array.from(out);
  } else {
    bytes = Uint8Array.from(content);
    if (bytes.length % 4) throw new Error(S.asm.imageLength(bytes.length));
  }
  const listing = [];
  for (let a = 0; a < bytes.length; a += 4) {
    listing.push({ address: a, size: 4, word: (bytes[a] | (bytes[a + 1] << 8) | (bytes[a + 2] << 16) | (bytes[a + 3] << 24)) >>> 0, text: '', file: name, line: a / 4 + 1, part: -1 });
  }
  return { ok: true, imported: true, diagnostics: [], entry: 0, symbols: {}, symbolTable: [], data: [], profile,
    segments: [{ address: 0, bytes, executable: true }], listing };
}

// ---------------------------------------------------------------------------------------------------------------
// Editor data (contract v5 Language.editor): every UAL spelling, so that ADDEQ and BNE are highlighted

const helpOf = (w) => {
  const sp = spelling(w);
  if (!sp) return null;
  return { sp, h: S.editorHelp[sp.name] };
};

export const editor = {
  mnemonics: [...SPELLINGS.keys()].filter((k) => { const v = SPELLINGS.get(k); return k === `${v.as}${v.s ? 'S' : ''}${v.cond === 14 ? '' : CONDS[v.cond]}`; })
    .map((k) => k.toLowerCase()).sort(),
  registers: [...Array.from({ length: 16 }, (_, i) => `r${i}`), 'sp', 'lr', 'pc'],
  directives: [...DIRECTIVES],
  detail: (w) => helpOf(w)?.h?.usage ?? '',
  help: (w) => {
    const x = helpOf(w);
    if (!x) return null;
    const { sp, h } = x;
    const notes = [sp.as !== sp.name ? S.aliasOf(sp.as, sp.name) : null, sp.cond !== 14 ? S.conditionOf(CONDS[sp.cond], S.conditions[CONDS[sp.cond]]) : null].filter(Boolean);
    return { kind: 'instruction', usage: h.usage, operation: [h.operation, ...notes].join('; ') };
  },
};
