// i8086/language.js -- the 8086 assembly language on the contract (Language; roadmap 8086-B1): an assembler in the
// style of Intel's ASM-86 (author's choice, 2026-11-05: Intel mnemonics, BYTE PTR / WORD PTR / DWORD PTR, ES: overrides,
// typed variables of DB and DW, OFFSET, SHORT, FAR PTR, ORG, EQU, DUP, $, END), the disassembler, the encoding fields
// and the editor's data. Encodings come from the one table of isa.js [INTEL]; the assembler picks the shortest encoding
// that fits, the first form of the table on a tie (MOV AX,BX is 89 D8). The simulator's own code (C4). No DOM.
//
// Placement (author, 2026-11-05: one segment by default): the program is assembled into the code segment 1000H, so an
// offset o is at physical address 10000H + o; ORG sets the offset. Listing addresses, breakpoints and the engine's pc
// are physical (20 bits). The contract's listing word is a number (contract v8, up to 32 bits documented; 8086
// instructions reach 6 bytes and more with prefixes): a row's word is its bytes in memory order, first byte highest,
// up to 6 bytes, and the bytes of each row are remembered by address and word for the disassembler and the fields, so
// that an instruction beginning with 00H is not mistaken for a shorter one. An instruction longer than 6 bytes gives
// its leading prefixes rows of their own. (Contract extension 1 of the roadmap §6 would carry bytes instead.)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { FORMS, REG8, REG16, SREG, SEG_PREFIX, SEG_PREFIX_BYTE, ALIASES, JCC, decodeBytes, format } from './isa.js';
import { I8086_STRINGS as S } from './strings.js';

export const CODE_SEG = 0x1000;
export const CODE_BASE = CODE_SEG << 4;
export const MEMORY_BYTES = 0x100000;
const MAX_WORD_BYTES = 6;

// ---------------------------------------------------------------- the bytes of a listing word
const MEMO = new Map();
/** The word of an instruction's bytes (first byte highest, at most 6 bytes); remembers the bytes at `address`. */
export function remember(address, bytes) {
  const word = wordOf(bytes.slice(0, MAX_WORD_BYTES));
  if (MEMO.size > 200_000) MEMO.clear();
  MEMO.set(`${address}:${word}`, bytes.slice());
  return word;
}
export const wordOf = (bytes) => bytes.reduce((w, b) => w * 256 + b, 0);
const unpack = (word, n) => Array.from({ length: n }, (_, k) => Math.floor(word / 256 ** (n - 1 - k)) % 256);
/** The bytes of a word: remembered for the address, else the shortest reading that decodes to its own length. */
export function bytesOf(word, address) {
  const known = MEMO.get(`${address}:${word}`);
  if (known) return known;
  const n0 = Math.max(1, Math.ceil(Math.log2(word + 1) / 8));
  for (let n = n0; n <= MAX_WORD_BYTES; n++) {
    const b = unpack(word, n);
    if (b.length === 1 && SEG_PREFIX[b[0]] !== undefined) return b;
    if (decodeBytes(b).length === n) return b;
  }
  return unpack(word, n0);
}
const PREFIX_NAME = { 0x26: 'ES:', 0x2e: 'CS:', 0x36: 'SS:', 0x3e: 'DS:', 0xf0: 'LOCK', 0xf1: 'LOCK', 0xf2: 'REPNE', 0xf3: 'REP' };

/** The ASM-86 text of the instruction at a physical address (contract Language.disassemble). */
export function disassemble(word, address = CODE_BASE) {
  const b = bytesOf(word, address);
  if (b.length === 1 && PREFIX_NAME[b[0]]) return PREFIX_NAME[b[0]];
  return format(decodeBytes(b), (address - CODE_BASE) & 0xffff);
}

// ---------------------------------------------------------------- operands
const REGS8 = Object.fromEntries(REG8.map((r, n) => [r, n]));
const REGS16 = Object.fromEntries(REG16.map((r, n) => [r, n]));
const SREGS = Object.fromEntries(SREG.map((r, n) => [r, n]));
/** The r/m field of a base and index pair (IFUM Table 4-10). */
const RM_OF = { 'BX+SI': 0, 'BX+DI': 1, 'BP+SI': 2, 'BP+DI': 3, SI: 4, DI: 5, BP: 6, BX: 7 };
export const DIRECTIVES = Object.freeze(['ORG', 'DB', 'DW', 'EQU', 'DUP', 'END', 'OFFSET', 'PTR', 'BYTE', 'WORD', 'DWORD', 'SHORT', 'NEAR', 'FAR', 'ASSUME']);
const PREFIX_WORDS = { LOCK: 0xf0, REP: 0xf3, REPE: 0xf3, REPZ: 0xf3, REPNE: 0xf2, REPNZ: 0xf2 };
const MNEMONIC_SET = new Set(FORMS.filter((f) => f.asm).map((f) => f.mnem));
for (const k of ['AAM', 'AAD', 'RET', 'RETF']) MNEMONIC_SET.add(k);
export const MNEMONICS = Object.freeze([...MNEMONIC_SET, ...Object.keys(ALIASES), 'LOCK', 'REP', 'REPE', 'REPNE'].filter((m, i, a) => a.indexOf(m) === i).sort());
const LABEL = /^[A-Za-z_?@][A-Za-z0-9_?@$]*$/;
const reserved = (n) => { const u = n.toUpperCase(); return u in REGS8 || u in REGS16 || u in SREGS || MNEMONIC_SET.has(u) || u in ALIASES || u in PREFIX_WORDS || DIRECTIVES.includes(u) || u === 'MOD'; };

/** A number in one of the accepted notations (12, 0CH, 0x0C, 1100B, 0b1100, 'A'), or null. */
export function parseNumber(t) {
  const s = t.trim();
  let m;
  if ((m = /^(\d+)d?$/i.exec(s))) return Number(m[1]);
  if ((m = /^0x([0-9a-f]+)$/i.exec(s))) return parseInt(m[1], 16);
  if ((m = /^(\d[0-9a-f]*)h$/i.exec(s))) return parseInt(m[1], 16);
  if ((m = /^0b([01]+)$/i.exec(s))) return parseInt(m[1], 2);
  if ((m = /^([01]+)b$/i.exec(s))) return parseInt(m[1], 2);
  if ((m = /^'(.)'$/.exec(s)) || (m = /^"(.)"$/.exec(s))) return m[1].charCodeAt(0);
  return null;
}

/**
 * Evaluate an expression: numbers, symbols, $, + - * / MOD, parentheses, unary minus. `sym(name)` gives
 * {value, known} or null. Returns {value, known, error?}.
 */
function evaluate(text, sym, here) {
  const toks = text.match(/'[^']*'|"[^"]*"|\$|[A-Za-z_?@][A-Za-z0-9_?@$]*|\d[0-9A-Za-z]*|[-+*/()]|\S/g) ?? [];
  let i = 0; let known = true; let error = null;
  const peek = () => toks[i];
  const primary = () => {
    const t = toks[i++];
    if (t === undefined) { error ??= S.asm.badExpression(text); return 0; }
    if (t === '(') { const v = sum(); if (toks[i++] !== ')') error ??= S.asm.badExpression(text); return v; }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (t === '$') return here;
    const n = parseNumber(t);
    if (n !== null) return n;
    if (LABEL.test(t)) {
      const s = sym(t);
      if (!s) { error ??= S.asm.undefinedLabel(t); return 0; }
      if (!s.known) known = false;
      return s.value;
    }
    error ??= S.asm.badExpression(text);
    return 0;
  };
  const product = () => {
    let v = primary();
    while (peek() === '*' || peek() === '/' || peek()?.toUpperCase() === 'MOD') {
      const op = toks[i++].toUpperCase(); const w = primary();
      if ((op === '/' || op === 'MOD') && w === 0) { error ??= S.asm.divideByZero; return 0; }
      v = op === '*' ? v * w : op === '/' ? Math.trunc(v / w) : v % w;
    }
    return v;
  };
  function sum() {
    let v = product();
    while (peek() === '+' || peek() === '-') { const op = toks[i++]; const w = product(); v = op === '+' ? v + w : v - w; }
    return v;
  }
  const value = sum();
  if (i < toks.length) error ??= S.asm.badExpression(text);
  return { value, known, error };
}

/** Split on commas outside quotes, brackets and parentheses. */
function splitOperands(s) {
  const out = []; let depth = 0; let q = null; let cur = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '\'' || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '[' || ch === '(') depth += 1;
    if (ch === ']' || ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * Parse one operand. `ctx.sym(name)` gives a symbol {value, known, kind: 'code'|'byte'|'word'|'const'} or null.
 * Returns {k: 'reg'|'sreg'|'mem'|'imm'|'far', ...} or {error}.
 */
function parseOperand(text, ctx) {
  let t = text.trim();
  const up = t.toUpperCase();
  if (up in REGS8) return { k: 'reg', size: 8, n: REGS8[up] };
  if (up in REGS16) return { k: 'reg', size: 16, n: REGS16[up] };
  if (up in SREGS) return { k: 'sreg', n: SREGS[up] };
  let size = null; let jump = null;
  let m;
  if ((m = /^(BYTE|WORD|DWORD)\s+PTR\s+(.*)$/i.exec(t))) { size = { BYTE: 8, WORD: 16, DWORD: 32 }[m[1].toUpperCase()]; t = m[2]; }
  else if ((m = /^SHORT\s+(.*)$/i.exec(t))) { jump = 'short'; t = m[1]; }
  else if ((m = /^NEAR\s+PTR\s+(.*)$/i.exec(t))) { jump = 'near'; t = m[1]; }
  else if ((m = /^FAR\s+PTR\s+(.*)$/i.exec(t))) { jump = 'far'; t = m[1]; }
  if ((m = /^OFFSET\s+(.*)$/i.exec(t))) {
    const v = evaluate(m[1], ctx.sym, ctx.here);
    return v.error ? { error: v.error } : { k: 'imm', value: v.value, known: v.known };
  }
  // segment override: ES:[BX], ES:var
  let seg = null;
  if ((m = /^(ES|CS|SS|DS)\s*:\s*(.*)$/i.exec(t)) && !/^\s*$/.test(m[2])) { seg = m[1].toUpperCase(); t = m[2]; }
  // direct far address: 1000H:0200H
  if (!seg && (m = /^([^:[\]]+):([^:[\]]+)$/.exec(t))) {
    const a = evaluate(m[1], ctx.sym, ctx.here); const b = evaluate(m[2], ctx.sym, ctx.here);
    if (a.error || b.error) return { error: a.error ?? b.error };
    return { k: 'far', seg: a.value & 0xffff, off: b.value & 0xffff, known: a.known && b.known };
  }
  const brackets = [...t.matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]);
  const outside = t.replace(/\[[^\]]*\]/g, ' ').trim();
  if (!brackets.length) {
    // a variable of DB or DW, alone or plus or minus a value, is a memory operand of its type (ASM-86), as is
    // anything after a segment override; a code label, a constant or a number is a value
    const first = /^[A-Za-z_?@][\w?@$]*/.exec(outside)?.[0];
    if (seg || (first && ['byte', 'word'].includes(ctx.sym(first)?.kind))) return memOperand([], outside, size, seg, ctx);
    const v = evaluate(outside, ctx.sym, ctx.here);
    if (v.error) return { error: v.error };
    if (jump === 'far') return { k: 'far', seg: CODE_SEG, off: v.value & 0xffff, known: v.known };
    return { k: 'imm', value: v.value, known: v.known, jump, size };
  }
  return memOperand(brackets, outside, size, seg, ctx);
}

function memOperand(brackets, outside, size, seg, ctx) {
  const terms = [];
  const regs = [];
  let typeSize = null;
  const pieces = [outside, ...brackets].filter((x) => x.trim());
  for (const p of pieces) {
    // split into signed terms; registers are taken out, the rest is the displacement
    const parts = p.replace(/\s+/g, '').match(/[-+]?[^-+]+/g) ?? [];
    for (const part of parts) {
      const body = part.replace(/^[-+]/, '');
      const u = body.toUpperCase();
      if (['BX', 'BP', 'SI', 'DI'].includes(u)) {
        if (part.startsWith('-')) return { error: S.asm.badAddress(p) };
        regs.push(u);
      } else if (u in REGS8 || u in REGS16 || u in SREGS) return { error: S.asm.badBase(body) };
      else {
        terms.push(part);
        if (LABEL.test(body)) { const s = ctx.sym(body); if (s && (s.kind === 'byte' || s.kind === 'word')) typeSize ??= s.kind === 'byte' ? 8 : 16; }
      }
    }
  }
  const base = regs.filter((r) => r === 'BX' || r === 'BP');
  const index = regs.filter((r) => r === 'SI' || r === 'DI');
  if (base.length > 1 || index.length > 1) return { error: S.asm.badBase(regs.join('+')) };
  const key = [...base, ...index].join('+');
  if (key && RM_OF[key] === undefined) return { error: S.asm.badBase(key) };
  let disp = { value: 0, known: true };
  if (terms.length) {
    const v = evaluate(terms.join('').replace(/^\+/, ''), ctx.sym, ctx.here);
    if (v.error) return { error: v.error };
    disp = v;
  }
  return { k: 'mem', size: size ?? typeSize, seg, rm: key ? RM_OF[key] : null, disp: disp.value, known: disp.known };
}

// ---------------------------------------------------------------- encoding
const fitsByte = (v) => v >= -128 && v <= 255;
const fitsWord = (v) => v >= -32768 && v <= 65535;
const fitsSigned8 = (v) => { const w = v & 0xffff; return w <= 0x7f || w >= 0xff80; };
const JUMPS = new Set(['JMP', 'CALL', 'LOOP', 'LOOPE', 'LOOPNE', 'JCXZ', ...JCC]);
const SIZE_SPECS = new Set(['Gb', 'Gw', 'AL', 'AX', 'Zb', 'Zw', 'Sw', 'Ob', 'Ow']);
const WORD_ONLY = new Set(['JMP', 'CALL', 'PUSH', 'POP']);

// forms the table writes one way and the assembler also accepts the other way round, and AAM/AAD without a base
const EXTRA = [
  { mnem: 'XCHG', ops: ['Gb', 'Eb'], op: 0x86 }, { mnem: 'XCHG', ops: ['Gw', 'Ew'], op: 0x87 },
  { mnem: 'TEST', ops: ['Gb', 'Eb'], op: 0x84 }, { mnem: 'TEST', ops: ['Gw', 'Ew'], op: 0x85 },
  ...[1, 2, 3, 4, 5, 6, 7].map((r) => ({ mnem: 'XCHG', ops: ['Zw', 'AX'], op: 0x90 + r, zreg: r })),
  { mnem: 'AAM', ops: [], op: 0xd4, fixed: [0x0a] }, { mnem: 'AAD', ops: [], op: 0xd5, fixed: [0x0a] },
].map((f) => ({ reg: null, status: 'normal', asm: true, ...f, swap: f.mnem !== 'AAM' && f.mnem !== 'AAD' }));
const BY_MNEM = {};
for (const f of [...FORMS.filter((x) => x.asm), ...EXTRA]) (BY_MNEM[f.mnem] ??= []).push(f);

/** Does operand o fit spec s (alone; sizes of memory operands are checked with the whole form)? */
function fits(s, o, form, ops) {
  switch (s) {
    case 'Eb': return (o.k === 'reg' && o.size === 8) || (o.k === 'mem' && (o.size === 8 || o.size === null));
    case 'Ew': return (o.k === 'reg' && o.size === 16) || (o.k === 'mem' && (o.size === 16 || o.size === null));
    case 'Gb': return o.k === 'reg' && o.size === 8;
    case 'Gw': return o.k === 'reg' && o.size === 16;
    case 'Sw': return o.k === 'sreg';
    case 'M': return o.k === 'mem';
    // a far pointer: LDS and LES take any memory operand; JMP and CALL need DWORD PTR (without it they are near)
    case 'Mp': return o.k === 'mem' && (o.size === 32 || (o.size === null && (form.mnem === 'LDS' || form.mnem === 'LES')));
    case 'Ib': return o.k === 'imm' && !o.jump && (!o.known || fitsByte(o.value));
    case 'Iw': return o.k === 'imm' && !o.jump && (!o.known || fitsWord(o.value));
    case 'Is': return o.k === 'imm' && !o.jump && o.known && fitsSigned8(o.value) && fitsWord(o.value);
    case 'Jb': return o.k === 'imm' && o.jump !== 'near' && o.jump !== 'far';
    case 'Jw': return o.k === 'imm' && o.jump !== 'short' && o.jump !== 'far';
    case 'Ap': return o.k === 'far';
    case 'Ob': case 'Ow': return o.k === 'mem' && o.rm === null && (o.size === null || o.size === (s === 'Ob' ? 8 : 16));
    case 'AL': return o.k === 'reg' && o.size === 8 && o.n === 0;
    case 'AX': return o.k === 'reg' && o.size === 16 && o.n === 0;
    case 'CL': return o.k === 'reg' && o.size === 8 && o.n === 1;
    case 'DX': return o.k === 'reg' && o.size === 16 && o.n === 2;
    case 'Zb': return o.k === 'reg' && o.size === 8 && (form.zreg === undefined ? o.n === (form.op & 7) : o.n === form.zreg);
    case 'Zw': return o.k === 'reg' && o.size === 16 && (form.zreg === undefined ? o.n === (form.op & 7) : o.n === form.zreg);
    case 'ES': case 'CS': case 'SS': case 'DS': return o.k === 'sreg' && SREG[o.n] === s;
    case '1': return o.k === 'imm' && o.known && o.value === 1 && !o.jump;
    case '3': return o.k === 'imm' && o.known && o.value === 3 && !o.jump;
    default: return false && ops;
  }
}

/** ModR/M and displacement bytes of a memory operand (with `long`, a 16-bit displacement even if 8 bits would do). */
function modrmMem(o, reg, long) {
  if (o.rm === null) return [(reg << 3) | 6, o.disp & 0xff, (o.disp >> 8) & 0xff];
  const d = o.disp;
  if (d === 0 && o.rm !== 6 && o.known && !long) return [(reg << 3) | o.rm];
  if (o.known && !long && d >= -128 && d <= 127) return [0x40 | (reg << 3) | o.rm, d & 0xff];
  return [0x80 | (reg << 3) | o.rm, d & 0xff, (d >> 8) & 0xff];
}

/**
 * Encode one instruction at offset `at` with `prefixes` (bytes). Returns {bytes} or {error}. `long`: a 16-bit
 * displacement and the long jump where both fit (used once an item has grown, so that the passes end).
 */
function encode(mnem, ops, at, prefixes, long) {
  const forms = BY_MNEM[mnem];
  if (!forms) return { error: S.asm.unknown(mnem) };
  const cands = [];
  for (const f of forms) {
    if (f.ops.length !== ops.length || f.ops.includes('Jb') || f.ops.includes('Jw')) continue; // targets: encodeJump
    if (!f.ops.every((s, k) => fits(s, ops[k], f, ops))) continue;
    // a memory operand of unknown size takes it from a register operand of the form, else only a word instruction
    const memAt = ops.findIndex((o) => o.k === 'mem');
    if (memAt >= 0 && ops[memAt].size === null && ['Eb', 'Ew'].includes(f.ops[memAt])) {
      const sized = f.ops.some((s, k) => k !== memAt && SIZE_SPECS.has(s));
      if (!sized && !(WORD_ONLY.has(mnem) && f.ops[memAt] === 'Ew')) continue;
    }
    if (mnem === 'MOV' && f.ops[0] === 'Sw' && ops[0].n === 1) continue; // CS is not a destination (IFUM p. 2-31)
    if (mnem === 'POP' && ops[0]?.k === 'sreg' && ops[0].n === 1) continue;
    const b = [...prefixes];
    const segOf = ops.find((o) => o.k === 'mem' && o.seg);
    if (segOf) b.push(SEG_PREFIX_BYTE[segOf.seg]);
    b.push(f.op);
    if (f.reg !== null || f.ops.some((s) => ['Eb', 'Ew', 'Gb', 'Gw', 'Sw', 'M', 'Mp'].includes(s))) {
      const ei = f.ops.findIndex((s) => ['Eb', 'Ew', 'M', 'Mp'].includes(s));
      const gi = f.ops.findIndex((s) => ['Gb', 'Gw', 'Sw'].includes(s));
      const reg = f.reg ?? (gi >= 0 ? ops[gi].n : 0);
      const e = ops[ei];
      if (e.k === 'reg') b.push(0xc0 | (reg << 3) | e.n);
      else b.push(...modrmMem(e, reg, long));
    }
    f.ops.forEach((s, k) => {
      const o = ops[k];
      switch (s) {
        case 'Ib': b.push(o.value & 0xff); break;
        case 'Is': b.push(o.value & 0xff); break;
        case 'Iw': b.push(o.value & 0xff, (o.value >> 8) & 0xff); break;
        case 'Ob': case 'Ow': b.push(o.disp & 0xff, (o.disp >> 8) & 0xff); break;
        case 'Ap': b.push(o.off & 0xff, o.off >> 8, o.seg & 0xff, o.seg >> 8); break;
        default: break;
      }
    });
    if (f.fixed) b.push(...f.fixed);
    cands.push(b);
  }
  if (cands.length) return { bytes: cands.reduce((a, c) => (c.length < a.length ? c : a)) };
  return { error: operandError(mnem, ops) };
}

function operandError(mnem, ops) {
  const mem = ops.find((o) => o.k === 'mem');
  if (mem && mem.size === null && !ops.some((o) => o.k === 'reg')) return S.asm.sizeUnknown(mnem);
  if (ops.some((o) => o.k === 'imm' && o.known && !fitsWord(o.value))) return S.asm.wordRange(ops.find((o) => o.k === 'imm' && !fitsWord(o.value)).value);
  const regs = ops.filter((o) => o.k === 'reg');
  if (regs.length === 2 && regs[0].size !== regs[1].size) return S.asm.sizeMismatch(mnem);
  if (mem && regs.length === 1 && mem.size && regs[0].size !== mem.size && mem.size !== 32) return S.asm.sizeMismatch(mnem);
  return S.asm.operands(mnem, S.editorHelp[mnem]?.usage ?? mnem);
}

// ---------------------------------------------------------------- the assembler
/**
 * Assemble one source file (contract Program). The first scan collects the names and kinds of the labels; then the
 * passes place the items until no size changes (forward jumps start long and shrink). Options: `profile` ('flat' or
 * 'segmented'), kept in the program for the engine.
 */
export function assemble(files, { profile = 'flat' } = {}) {
  const file = files[0] ?? { name: 'main.asm', text: '' };
  const diagnostics = [];
  const err = (line, column, length, message, note) => diagnostics.push({ severity: 'error', file: file.name, line, column, length, message, ...(note ? { note } : {}) });
  const warn = (line, column, length, message) => diagnostics.push({ severity: 'warning', file: file.name, line, column, length, message });
  const lines = file.text.split(/\r?\n/);

  // parse every line into {line, label, prefixes, op, arg, cols}
  const items = [];
  const kinds = {}; // name -> 'code' | 'byte' | 'word' | 'const'
  let endLabel = null;
  lines.forEach((raw, i) => {
    const line = i + 1;
    const code = stripComment(raw);
    if (!code.trim()) return;
    let rest = code; let col = 1;
    const it = { line, text: code.trim(), prefixes: [] };
    let m = /^\s*([A-Za-z_?@][\w?@$]*)\s*:(?!\s*\[)/.exec(rest);
    if (m && !(m[1].toUpperCase() in SREGS)) {
      it.label = m[1]; it.labelCol = rest.indexOf(m[1]) + 1; it.labelKind = 'code';
      col += m[0].length; rest = rest.slice(m[0].length);
    }
    // name DB/DW/EQU
    m = /^\s*([A-Za-z_?@][\w?@$]*)\s+(DB|DW|EQU)\b\s*(.*)$/i.exec(rest);
    if (m && !it.label && !reserved(m[1])) {
      it.label = m[1]; it.labelCol = rest.indexOf(m[1]) + 1;
      const d = m[2].toUpperCase();
      it.labelKind = d === 'DB' ? 'byte' : d === 'DW' ? 'word' : 'const';
      rest = rest.slice(rest.toUpperCase().indexOf(d, it.labelCol - 1 + m[1].length));
      col = code.length - rest.length + 1;
    }
    for (;;) {
      const pm = /^(\s*)(LOCK|REPNE|REPNZ|REPE|REPZ|REP|ES:|CS:|SS:|DS:)(\s+|$)/i.exec(rest);
      if (!pm) break;
      const w = pm[2].toUpperCase();
      it.prefixes.push(w.endsWith(':') ? SEG_PREFIX_BYTE[w.slice(0, 2)] : PREFIX_WORDS[w]);
      it.prefixWord = w;
      col += pm[0].length; rest = rest.slice(pm[0].length);
    }
    m = /^(\s*)(\S+)(\s*)(.*?)\s*$/.exec(rest);
    if (m) {
      it.op = m[2].toUpperCase(); it.opCol = col + m[1].length; it.opLen = m[2].length;
      it.arg = m[4]; it.argCol = it.opCol + it.opLen + m[3].length;
    } else if (it.prefixes.length) { it.op = ''; it.opCol = col; it.opLen = 0; it.arg = ''; it.argCol = col; }
    if (it.label) {
      if (!LABEL.test(it.label) || reserved(it.label)) { err(line, it.labelCol, it.label.length, S.asm.badLabel(it.label)); it.label = null; }
      else if (it.label in kinds) { err(line, it.labelCol, it.label.length, S.asm.duplicateLabel(it.label)); it.label = null; }
      else kinds[it.label] = it.labelKind;
    }
    if (it.op === 'END') { if (it.arg) endLabel = { name: it.arg.trim(), line, col: it.argCol }; return; }
    if (it.op === 'ASSUME') { warn(line, it.opCol, it.opLen, S.asm.assumeIgnored); return; }
    if (it.op === 'SEGMENT' || it.op === 'ENDS' || /^\S+\s+(SEGMENT|ENDS)\b/i.test(code.trim())) { err(line, it.opCol ?? 1, it.opLen ?? 1, S.asm.noSegments, S.asm.noSegmentsNote); return; }
    items.push(it);
  });

  // passes: place every item; symbols from the previous pass (unknown ones start at 0, not known)
  let values = {};
  let prevSizes = null;
  let result;
  for (let pass = 0; pass < 12; pass++) {
    const final = pass === 11;
    const passDiag = [];
    const perr = (line, column, length, message, note) => passDiag.push({ severity: 'error', file: file.name, line, column, length, message, ...(note ? { note } : {}) });
    const newValues = {};
    let at = 0;
    const sizes = [];
    const out = [];
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      const sym = (name) => {
        const key = Object.keys(kinds).find((n) => n.toUpperCase() === name.toUpperCase()) ?? name;
        if (!(key in kinds)) return null;
        if (key in newValues) return { value: newValues[key], known: true, kind: kinds[key] };
        if (key in values) return { value: values[key], known: pass > 0, kind: kinds[key] };
        return { value: 0, known: false, kind: kinds[key] };
      };
      if (it.label && it.labelKind !== 'const') newValues[it.label] = at;
      const ctx = { sym, here: at };
      const op = it.op;
      if (op === undefined) { sizes.push(0); continue; } // a label alone on its line
      if (op === 'EQU') {
        const v = evaluate(it.arg, sym, at);
        if (v.error) perr(it.line, it.argCol, it.arg.length, v.error);
        else if (it.label) newValues[it.label] = v.value;
        sizes.push(0); continue;
      }
      if (op === 'ORG') {
        const v = evaluate(it.arg, sym, at);
        if (!it.arg) perr(it.line, it.opCol, it.opLen, S.asm.needsValue('ORG'));
        else if (v.error) perr(it.line, it.argCol, it.arg.length, v.error);
        else if (v.value < 0 || v.value > 0xffff) perr(it.line, it.argCol, it.arg.length, S.asm.orgRange(v.value));
        else at = v.value;
        if (it.label) newValues[it.label] = at;
        sizes.push(0); continue;
      }
      if (op === 'DB' || op === 'DW') {
        const bytes = dataBytes(it, op === 'DB' ? 1 : 2, ctx, perr);
        out.push({ kind: 'data', it, at, bytes });
        sizes.push(bytes.length); at += bytes.length;
        continue;
      }
      if (op === '' && it.prefixes.length) {
        out.push({ kind: 'code', it, at, bytes: it.prefixes.slice() });
        sizes.push(it.prefixes.length); at += it.prefixes.length; continue;
      }
      const mnem = ALIASES[op] ?? op;
      if (!BY_MNEM[mnem]) {
        perr(it.line, it.opCol, it.opLen, MNEMONIC_SET.has(mnem) ? S.asm.operands(mnem, S.editorHelp[mnem]?.usage ?? mnem) : S.asm.unknown(it.op), S.asm.unknownNote);
        sizes.push(0); continue;
      }
      const texts = it.arg ? splitOperands(it.arg) : [];
      const ops = [];
      let failed = false;
      let c = it.argCol;
      for (const t of texts) {
        const o = parseOperand(t, ctx);
        if (o.error) { perr(it.line, c, t.length, o.error); failed = true; break; }
        ops.push(o); c += t.length + 1;
      }
      if (failed) { sizes.push(0); continue; }
      const long = Boolean(prevSizes && it._grew);
      // a jump or call to a value is relative (a label, a number or $); to a register or memory, indirect
      const r = JUMPS.has(mnem) && ops.length === 1 && ops[0].k === 'imm' ? encodeJump(mnem, ops, at, it.prefixes, long)
        : encode(mnem, ops, at, it.prefixes, long);
      if (r.error) { perr(it.line, it.arg ? it.argCol : it.opCol, it.arg ? it.arg.length : it.opLen, r.error); sizes.push(0); continue; }
      let bytes = r.bytes;
      if (prevSizes && prevSizes[k] > bytes.length && pass >= 8) bytes = [...bytes, ...new Array(prevSizes[k] - bytes.length).fill(0x90)];
      out.push({ kind: 'code', it, at, bytes });
      sizes.push(bytes.length); at += bytes.length;
      if (at > 0x10000) { perr(it.line, it.opCol, it.opLen, S.asm.full); break; }
    }
    const stable = prevSizes && sizes.length === prevSizes.length && sizes.every((s, k) => s === prevSizes[k])
      && Object.keys(newValues).every((n) => newValues[n] === values[n]);
    if (prevSizes) items.forEach((it, k) => { if (sizes[k] > prevSizes[k]) it._grew = true; });
    values = newValues; prevSizes = sizes;
    result = { out, passDiag, values };
    if (stable || final) break;
  }
  diagnostics.push(...result.passDiag);

  // the image, listing and data
  const used = new Map(); const bytesAt = new Map(); const codeAddr = new Set();
  const listing = []; const data = [];
  for (const x of result.out) {
    for (let k = 0; k < x.bytes.length; k++) {
      const off = x.at + k;
      if (off > 0xffff) { err(x.it.line, x.it.opCol, x.it.opLen, S.asm.full); break; }
      if (used.has(off)) { err(x.it.line, x.it.opCol, x.it.opLen, S.asm.overlap(off)); break; }
      used.set(off, x.it); bytesAt.set(off, x.bytes[k]);
      if (x.kind === 'code') codeAddr.add(off);
    }
    const address = CODE_BASE + x.at;
    if (x.kind === 'data') {
      if (x.bytes.length) data.push({ address, bytes: Uint8Array.from(x.bytes), file: file.name, line: x.it.line, text: x.it.text });
      continue;
    }
    let b = x.bytes; let a = address; let part = 0;
    while (b.length > MAX_WORD_BYTES && PREFIX_NAME[b[0]]) { // a long instruction: its leading prefixes on rows of their own
      listing.push({ address: a, size: 1, word: remember(a, [b[0]]), text: x.it.text, file: file.name, line: x.it.line, part });
      a += 1; b = b.slice(1); part = 1;
    }
    listing.push({ address: a, size: b.length, word: remember(a, b), text: x.it.text, file: file.name, line: x.it.line, part,
      ...(part ? { source: x.it.text } : {}) });
  }
  listing.sort((p, q) => p.address - q.address);
  const symbols = {}; const symbolTable = [];
  for (const it of items) {
    if (!it.label || !(it.label in result.values)) continue;
    const kind = kinds[it.label];
    if (kind === 'const') continue;
    const address = CODE_BASE + result.values[it.label];
    symbols[it.label] = address;
    symbolTable.push({ name: it.label, address, section: kind === 'code' ? 'code' : 'data', file: file.name, line: it.line });
  }
  // segments: runs of code bytes and of data bytes
  const segments = [];
  for (const off of [...used.keys()].sort((p, q) => p - q)) {
    const last = segments[segments.length - 1];
    if (last && last.off + last.bytes.length === off && last.executable === codeAddr.has(off)) last.bytes.push(bytesAt.get(off));
    else segments.push({ off, bytes: [bytesAt.get(off)], executable: codeAddr.has(off) });
  }
  let entry = listing.length ? Math.min(...result.out.filter((x) => x.kind === 'code').map((x) => CODE_BASE + x.at)) : CODE_BASE;
  const firstCode = result.out.find((x) => x.kind === 'code');
  if (firstCode) entry = CODE_BASE + firstCode.at;
  if (endLabel) {
    const v = result.values[Object.keys(result.values).find((n) => n.toUpperCase() === endLabel.name.toUpperCase())];
    if (v === undefined) err(endLabel.line, endLabel.col, endLabel.name.length, S.asm.undefinedLabel(endLabel.name));
    else entry = CODE_BASE + v;
  }
  const ok = !diagnostics.some((x) => x.severity === 'error');
  return { ok, diagnostics, segments: segments.map((s) => ({ address: CODE_BASE + s.off, bytes: Uint8Array.from(s.bytes), executable: s.executable })),
    entry, listing, data, symbols, symbolTable, i8086: { profile } };
}

/** A jump or call to a target (an offset in the code segment): the forms with Jb, Jw (or Ap with FAR PTR). */
function encodeJump(mnem, ops, at, prefixes, long) {
  const o = ops[0];
  const forms = BY_MNEM[mnem].filter((f) => f.ops.length === 1 && (f.ops[0] === 'Jb' || f.ops[0] === 'Jw'));
  let best = null; let error = null;
  for (const f of forms) {
    if (f.ops[0] === 'Jb' && (o.jump === 'near' || (long && forms.some((x) => x.ops[0] === 'Jw') && o.jump !== 'short'))) continue;
    if (f.ops[0] === 'Jw' && o.jump === 'short') continue;
    const b = [...prefixes, f.op, 0];
    if (f.ops[0] === 'Jw') b.push(0);
    const d = o.known ? (((o.value - (at + b.length)) & 0xffff) ^ 0x8000) - 0x8000 : 0; // IP wraps at 64K
    if (f.ops[0] === 'Jb' && (d < -128 || d > 127)) {
      if (o.known) { error ??= S.asm.jumpRange(mnem, d); continue; }
      if (forms.some((x) => x.ops[0] === 'Jw') && o.jump !== 'short') continue;
    }
    if (f.ops[0] === 'Jb') b[b.length - 1] = d & 0xff;
    else { b[b.length - 2] = d & 0xff; b[b.length - 1] = (d >> 8) & 0xff; }
    if (!best || b.length < best.length) best = b;
  }
  return best ? { bytes: best } : { error: error ?? S.asm.operands(mnem, S.editorHelp[mnem]?.usage ?? mnem) };
}

function stripComment(raw) {
  let q = null;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '\'' || ch === '"') q = ch;
    else if (ch === ';') return raw.slice(0, i);
  }
  return raw;
}

/** The bytes of a DB or DW line: numbers, strings (DB), ? (zero), n DUP (values). */
function dataBytes(it, size, ctx, perr) {
  const out = [];
  if (!it.arg) { perr(it.line, it.opCol, it.opLen, S.asm.needsValue(it.op)); return out; }
  const one = (t, col) => {
    const s = t.trim();
    let m;
    if (s === '?') { out.push(...new Array(size).fill(0)); return; }
    if ((m = /^(.+?)\s+DUP\s*\((.*)\)$/i.exec(s))) {
      const n = evaluate(m[1], ctx.sym, ctx.here);
      if (n.error || n.value < 0 || n.value > 0x10000) { perr(it.line, col, s.length, n.error ?? S.asm.badCount(m[1])); return; }
      const start = out.length;
      for (const x of splitOperands(m[2])) one(x, col);
      const unit = out.splice(start);
      for (let k = 0; k < n.value; k++) out.push(...unit);
      return;
    }
    if ((m = /^'(.*)'$/.exec(s)) || (m = /^"(.*)"$/.exec(s))) {
      if (size === 1 || m[1].length !== 1) {
        if (size === 2 && m[1].length > 2) { perr(it.line, col, s.length, S.asm.stringWord); return; }
        if (size === 1) { for (const ch of m[1]) out.push(ch.charCodeAt(0) & 0xff); return; }
        const v = m[1].length === 2 ? (m[1].charCodeAt(0) << 8) | m[1].charCodeAt(1) : m[1].charCodeAt(0);
        out.push(v & 0xff, v >> 8); return;
      }
    }
    const v = evaluate(s, ctx.sym, ctx.here);
    if (v.error) { perr(it.line, col, s.length, v.error); return; }
    if (size === 1 && !fitsByte(v.value)) { perr(it.line, col, s.length, S.asm.byteRange(v.value)); return; }
    if (size === 2 && !fitsWord(v.value)) { perr(it.line, col, s.length, S.asm.wordRange(v.value)); return; }
    out.push(v.value & 0xff);
    if (size === 2) out.push((v.value >> 8) & 0xff);
  };
  let col = it.argCol;
  for (const t of splitOperands(it.arg)) { one(t, col); col += t.length + 1; }
  return out;
}

// ---------------------------------------------------------------- fields, description, editor
const FIELD = (name, short, bits, value, meaning) => ({ name, short, bits, value, meaning });
/** The encoding fields of an instruction for the inspector (contract Language.fields): bits counted over its bytes. */
export function fields(word, address = CODE_BASE) {
  const b = bytesOf(word, address);
  const n = b.length;
  const bit = (k, hi, lo) => { const base = 8 * (n - 1 - k); return hi === lo ? `${base + hi}` : `${base + hi}:${base + lo}`; };
  if (n === 1 && PREFIX_NAME[b[0]]) return [FIELD(S.fieldName.prefix, S.fieldShort.prefix, bit(0, 7, 0), b[0], S.fieldMeaning.prefix(PREFIX_NAME[b[0]]))];
  const d = decodeBytes(b);
  const out = [];
  let k = 0;
  for (const p of d.prefixes) out.push(FIELD(S.fieldName.prefix, S.fieldShort.prefix, bit(k++, 7, 0), p, S.fieldMeaning.prefix(PREFIX_NAME[p])));
  out.push(FIELD(S.fieldName.opcode, S.fieldShort.opcode, bit(k, 7, 0), b[k], S.fieldMeaning.opcode(d.status === 'normal' || d.status === 'fpu' ? d.entry.mnem : null)));
  k += 1;
  if (d.modrm !== null) {
    const r = d.modrm;
    out.push(FIELD(S.fieldName.mod, S.fieldShort.mod, bit(k, 7, 6), r >> 6, S.fieldMeaning.mod(r >> 6, r & 7)));
    out.push(FIELD(S.fieldName.reg, S.fieldShort.reg, bit(k, 5, 3), (r >> 3) & 7, S.fieldMeaning.reg(d)));
    out.push(FIELD(S.fieldName.rm, S.fieldShort.rm, bit(k, 2, 0), r & 7, S.fieldMeaning.rm(r >> 6, r & 7, d)));
    k += 1;
  }
  const mem = d.operands.find((o) => o.t === 'mem');
  const disp = mem ? mem.dispSize : 0;
  if (disp === 1) out.push(FIELD(S.fieldName.disp, S.fieldShort.disp, bit(k, 7, 0), b[k++], S.fieldMeaning.disp8));
  if (disp === 2) { out.push(FIELD(S.fieldName.dispLo, S.fieldShort.lo, bit(k, 7, 0), b[k++], S.fieldMeaning.low)); out.push(FIELD(S.fieldName.dispHi, S.fieldShort.hi, bit(k, 7, 0), b[k++], S.fieldMeaning.high)); }
  while (k < n) {
    const left = n - k;
    const what = d.operands.find((o) => o.t === 'rel' || o.t === 'far' || o.t === 'imm');
    const name = what?.t === 'rel' ? S.fieldName.rel : what?.t === 'far' ? S.fieldName.far : S.fieldName.data;
    out.push(FIELD(left > 1 || k > n - left ? `${name} ${S.byteNo(n - left - (n - k - left))}` : name, S.fieldShort.data, bit(k, 7, 0), b[k], S.fieldMeaning.data));
    k += 1;
  }
  // name the data bytes by position: low byte, high byte
  const dataFields = out.filter((f) => f.short === S.fieldShort.data);
  dataFields.forEach((f, i) => { f.name = `${f.name.split(' ')[0]} ${dataFields.length === 1 ? '' : S.byteNo(i)}`.trim(); });
  return out;
}

/** The format of a word and its immediate, for the listing's tooltip (contract Language.describe). */
export function describe(word, address = CODE_BASE) {
  const b = bytesOf(word, address);
  if (b.length === 1 && PREFIX_NAME[b[0]]) return { kind: S.format.prefix };
  const d = decodeBytes(b);
  const parts = [];
  if (d.prefixes.length) parts.push(S.format.prefixes(d.prefixes.length));
  parts.push(S.format.opcode);
  if (d.modrm !== null) parts.push('ModR/M');
  const mem = d.operands.find((o) => o.t === 'mem');
  if (mem?.dispSize) parts.push(S.format.disp(8 * mem.dispSize));
  const imm = d.operands.find((o) => o.t === 'imm');
  if (imm) parts.push(S.format.data(imm.size === 8 || imm.short ? 8 : 16));
  const rel = d.operands.find((o) => o.t === 'rel');
  if (rel) parts.push(S.format.rel(rel.size));
  if (d.operands.some((o) => o.t === 'far')) parts.push(S.format.far);
  return { kind: `${parts.join(' · ')} (${S.format.bytes(b.length)})`, ...(imm ? { immediate: imm.value } : {}) };
}

export const REGISTERS = Object.freeze([...REG16, ...REG8, ...SREG]);
/** Editor data (contract v5 Language.editor): the shell compares lower case. */
export const editor = {
  mnemonics: MNEMONICS.map((m) => m.toLowerCase()),
  registers: REGISTERS.map((r) => r.toLowerCase()),
  directives: DIRECTIVES.map((d) => d.toLowerCase()),
  detail: (word, kind) => (kind === 'register' ? S.registerHelp[word.toUpperCase()] : helpOf(word)?.usage) ?? '',
  help: (word) => {
    const w = word.toUpperCase();
    if (S.registerHelp[w]) return { kind: 'register', text: S.registerHelp[w] };
    const h = helpOf(w);
    return h ? { kind: 'instruction', usage: h.usage, operation: h.operation, ...(h.format ? { format: h.format } : {}) } : null;
  },
};
function helpOf(word) {
  const w = word.toUpperCase();
  if (S.editorHelp[w]) return S.editorHelp[w];
  const a = ALIASES[w] ?? (w === 'REPE' || w === 'REPNE' ? w : null);
  if (a && S.editorHelp[a]) return { ...S.editorHelp[a], usage: S.aliasUsage(w, a, S.editorHelp[a].usage) };
  return null;
}

// ---------------------------------------------------------------- images and the scratch line
/** The memory image of a program: 1 MiB, unused bytes zero. */
export function memoryImage(program) {
  const m = new Uint8Array(MEMORY_BYTES);
  for (const s of program.segments) m.set(s.bytes.slice(0, MEMORY_BYTES - s.address), s.address);
  return m;
}

/** The .hex and .bin images (capability exportImage): the code segment from offset 0000H to the program's last byte. */
export function image(program) {
  const end = Math.max(CODE_BASE, ...program.segments.map((s) => s.address + s.bytes.length));
  const m = memoryImage(program).slice(CODE_BASE, end);
  return { hex: Array.from(m, (b) => `${b.toString(16).padStart(2, '0')}\n`).join(''), bin: m };
}

/** A program from a .hex (one byte per line) or .bin image, placed at offset 0000H of the code segment. */
export function loadImage(content, kind, name, { profile = 'flat' } = {}) {
  const diagnostics = [];
  let bytes;
  if (kind === 'hex') {
    const out = [];
    String(content).split(/\r\n|\r|\n/).forEach((raw, i) => {
      const t = raw.split('//', 1)[0].split('#', 1)[0].split(';', 1)[0].trim();
      if (!t) return;
      for (const tok of t.split(/\s+/)) {
        if (!/^[0-9a-f]{1,2}$/i.test(tok)) { diagnostics.push({ severity: 'error', file: name, line: i + 1, message: S.asm.badImageByte(tok) }); return; }
        out.push(parseInt(tok, 16));
      }
    });
    bytes = Uint8Array.from(out);
  } else bytes = new Uint8Array(content);
  if (bytes.length > 0x10000) diagnostics.push({ severity: 'error', file: name, message: S.asm.imageTooLong(bytes.length) });
  bytes = bytes.slice(0, 0x10000);
  const listing = [];
  for (let off = 0; off < bytes.length;) {
    const d = decodeBytes(Array.from(bytes.slice(off, off + 16)));
    const n = Math.max(1, Math.min(d.length ?? 1, bytes.length - off));
    const b = Array.from(bytes.slice(off, off + n));
    const parts = b.length > MAX_WORD_BYTES ? [b.slice(0, b.length - MAX_WORD_BYTES), b.slice(b.length - MAX_WORD_BYTES)] : [b];
    let a = CODE_BASE + off;
    for (const p of parts) {
      if (p.length > 1 && parts.length > 1 && p !== parts[parts.length - 1]) {
        for (const x of p) { listing.push({ address: a, size: 1, word: remember(a, [x]), text: '', part: -1 }); a += 1; }
      } else { listing.push({ address: a, size: p.length, word: remember(a, p), text: '', part: -1 }); a += p.length; }
    }
    off += n;
  }
  const ok = !diagnostics.some((x) => x.severity === 'error');
  return { ok, diagnostics, segments: bytes.length ? [{ address: CODE_BASE, bytes, executable: true }] : [], entry: CODE_BASE, listing, data: [], symbols: {}, i8086: { profile } };
}

/**
 * The scratch line (contract v4 Language.scratch): bytes in hexadecimal (8B C3, or 8BH 0C3H) are decoded; anything
 * else is one instruction, encoded at offset 0000H. Nothing is assembled into the program.
 */
export function scratch(text) {
  const t = text.trim();
  if (!t) return { kind: 'empty', ok: true };
  const row = (bytes, src) => ({ address: CODE_BASE, size: bytes.length, word: remember(CODE_BASE, bytes), text: src, part: 0 });
  const toks = t.split(/[\s,]+/);
  const asBytes = toks.map((x) => (/^[0-9a-f]{2}$/i.test(x) ? parseInt(x, 16) : /^[0-9a-f]{1,2}h$/i.test(x) || /^0[0-9a-f]{2}h$/i.test(x) ? parseNumber(x) : null));
  if (asBytes.every((n) => n !== null && n >= 0 && n <= 255)) {
    const d = decodeBytes(asBytes);
    if (d.error || d.status === 'prefix') return { kind: 'decode', ok: false };
    if (d.length !== asBytes.length) return { kind: 'encode', ok: false, error: { message: S.scratchBytes(format(d, 0), d.length) } };
    if (asBytes.length > MAX_WORD_BYTES) return { kind: 'decode', ok: true, text: format(d, 0), rows: [] };
    if (d.status !== 'normal') return { kind: 'decode', ok: false, error: { message: S.scratch.notInstr(d.status) } };
    return { kind: 'decode', ok: true, text: format(d, 0), rows: [row(asBytes, format(d, 0))] };
  }
  if (/^\s*[A-Za-z_?@][\w?@$]*\s*:(?!\s*\[)|^\s*(ORG|DB|DW|EQU|END)\b|\s(DB|DW|EQU)\s/i.test(t)) return { kind: 'encode', ok: false, error: { message: S.scratchOne } };
  const p = assemble([{ name: 'scratch.asm', text: t }]);
  const e = p.diagnostics.find((x) => x.severity === 'error');
  if (e) return { kind: 'encode', ok: false, error: { message: e.message, ...(e.note ? { note: e.note } : {}) } };
  return { kind: 'encode', ok: true, rows: p.listing.map((l) => ({ ...l, part: 0 })) };
}
