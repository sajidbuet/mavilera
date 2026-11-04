// gpu/language.js -- the SIMT micro-ISA on the contract (Language, spec W-D29; GPU-1 of docs/research/gpu-npu/roadmaps/
// GPU_DEVELOPMENT_ROADMAP.md): assembler, disassembler, encoding fields, images and editor data. The instruction set
// and its encoding are those of the Chapter 11 laboratory's SIMT core interface (16-bit words, [15:13] op, [12:11] rd,
// [10:9] rs, [8:7] rt, [7:0] imm for LDI only; sixteen words of program memory). The textbook gives mnemonics but no
// assembly dialect, so the dialect below is MAVILERA's (decision G7). The simulator's own code (C4). No DOM.
//
// Source: one instruction per line, case-insensitive, `;` or `//` starts a comment. Registers r0 to r3. Numbers in
// decimal, 0x… or 0b…, with a sign. LDI takes -128 to 255 (eight bits, sign-extended when it runs). Directives:
// `.din v0, v1, …` the lane inputs (32 bits each; one per lane at most, missing ones 0) and `.word v` one 16-bit word
// placed as it is. There are no branches, so there are no labels. Unused program words are 0, which is HALT.
// Addresses are word addresses (0 to 15); a listing row is one word, two bytes.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { GPU_STRINGS as S } from './strings.js';

export const PROGRAM_WORDS = 16;
export const MAX_LANES = 8;
/** The operations by op code (bits 15:13); op 7 is reserved and runs as no operation. */
export const OPS = Object.freeze({ HALT: 0, LDI: 1, ADD: 2, SUB: 3, IFLT: 4, ELSE: 5, ENDIF: 6 });
export const MNEMONIC_OF = Object.freeze(Object.fromEntries(Object.entries(OPS).map(([m, op]) => [op, m])));
/** The operands of each mnemonic, in source order. */
const OPERANDS = Object.freeze({ HALT: [], LDI: ['rd', 'imm'], ADD: ['rd', 'rs', 'rt'], SUB: ['rd', 'rs', 'rt'], IFLT: ['rs', 'rt'], ELSE: [], ENDIF: [] });
export const DIRECTIVES = Object.freeze(['.din', '.word']);
/** Lanes per engine profile (contract Profile ids). */
export const LANES_OF = Object.freeze({ simt4: 4, simt8: 8 });

/** The fields of a word. */
export const decode = (w) => ({ op: (w >>> 13) & 7, rd: (w >>> 11) & 3, rs: (w >>> 9) & 3, rt: (w >>> 7) & 3, imm: w & 0xff });
/** The word of an operation and its fields (unused fields 0). */
export function encode(m, { rd = 0, rs = 0, rt = 0, imm = 0 } = {}) {
  const op = OPS[m];
  if (m === 'LDI') return (op << 13) | (rd << 11) | (imm & 0xff);
  return (op << 13) | (rd << 11) | (rs << 9) | (rt << 7);
}
/** The sign-extended LDI immediate. */
export const sext8 = (v) => ((v & 0xff) << 24) >> 24;

/** A number in one of the accepted notations, or null. */
export function parseNumber(t) {
  const s = t.trim();
  let m;
  if ((m = /^([-+]?)(\d+)$/.exec(s))) return Number(m[1] + m[2]);
  if ((m = /^([-+]?)0x([0-9a-f]+)$/i.exec(s))) return Number(`${m[1]}${parseInt(m[2], 16)}`);
  if ((m = /^([-+]?)0b([01]+)$/i.exec(s))) return Number(`${m[1]}${parseInt(m[2], 2)}`);
  return null;
}

const regOf = (t) => { const m = /^r([0-3])$/i.exec(t.trim()); return m ? Number(m[1]) : null; };
const stripComment = (line) => line.replace(/(;|\/\/).*$/, '');

/** The lanes of an assembly profile (default: 4, the laboratory core). */
export const lanesOf = (profile) => LANES_OF[profile] ?? 4;

/**
 * Assemble one micro-ISA source file (the contract's Program). The Program also carries `lanes` (from the profile)
 * and `din` (the lane inputs, unsigned 32-bit), which the engine reads.
 */
export function assemble(files, { profile } = {}) {
  const file = files[0] ?? { name: 'main.simt', text: '' };
  const lanes = lanesOf(profile);
  const diagnostics = [];
  const err = (line, column, length, message, note) => diagnostics.push({ severity: 'error', file: file.name, line, column, length,
    message, ...(note ? { note } : {}) });
  const listing = [];
  let din = null;
  let full = false;
  file.text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const code = stripComment(raw);
    const lm = /^(\s*)([^\s:,]+)\s*:/.exec(code);
    if (lm) { err(line, lm[1].length + 1, lm[2].length, S.asm.noLabels(lm[2])); return; }
    const m = /^(\s*)(\S+)(\s*)(.*?)\s*$/.exec(code);
    if (!m) return;
    const name = m[2].toUpperCase();
    const opCol = m[1].length + 1;
    const opLen = m[2].length;
    const argText = m[4];
    const argCol = opCol + opLen + m[3].length;
    const args = argText ? argText.split(',').map((t) => t.trim()) : [];
    // column of the k-th operand, for the editor's marks
    const colOf = (k) => { let c = argCol; let rest = argText; for (let j = 0; j < k; j++) { const n = rest.indexOf(',') + 1; c += n; rest = rest.slice(n); } return c + (rest.length - rest.trimStart().length); };
    const text = code.trim();
    if (name === '.DIN') {
      if (!args.length) { err(line, opCol, opLen, S.asm.needsValue('.din')); return; }
      if (din) { err(line, opCol, opLen, S.asm.dinTwice); return; }
      if (args.length > lanes) { err(line, argCol, argText.length, S.asm.dinCount(args.length, lanes)); return; }
      const vals = [];
      for (const [k, t] of args.entries()) {
        const v = parseNumber(t);
        if (v === null) { err(line, colOf(k), t.length, S.asm.badNumber(t)); return; }
        if (v < -(2 ** 31) || v > 2 ** 32 - 1) { err(line, colOf(k), t.length, S.asm.dinRange(v)); return; }
        vals.push(v >>> 0);
      }
      din = vals;
      return;
    }
    let word;
    if (name === '.WORD') {
      if (args.length !== 1) { err(line, opCol, opLen, S.asm.needsValue('.word')); return; }
      const v = parseNumber(args[0]);
      if (v === null) { err(line, argCol, args[0].length, S.asm.badNumber(args[0])); return; }
      if (v < 0 || v > 0xffff) { err(line, argCol, args[0].length, S.asm.wordRange(v)); return; }
      word = v;
    } else {
      if (!(name in OPS)) { err(line, opCol, opLen, S.asm.unknown(m[2]), S.asm.unknownNote); return; }
      const want = OPERANDS[name];
      if (args.length !== want.length || args.some((a) => !a)) {
        err(line, opCol, opLen, S.asm.operands(name, want.length, S.editorHelp[name].usage));
        return;
      }
      const f = {};
      for (const [k, kind] of want.entries()) {
        const t = args[k];
        if (kind === 'imm') {
          const v = parseNumber(t);
          if (v === null) { err(line, colOf(k), t.length, S.asm.badNumber(t)); return; }
          if (v < -128 || v > 255) { err(line, colOf(k), t.length, S.asm.immRange(v)); return; }
          f.imm = v & 0xff;
        } else {
          const r = regOf(t);
          if (r === null) { err(line, colOf(k), t.length, S.asm.badRegister(t)); return; }
          f[kind] = r;
        }
      }
      word = encode(name, f);
    }
    if (listing.length >= PROGRAM_WORDS) { if (!full) err(line, opCol, opLen, S.asm.full); full = true; return; }
    listing.push({ address: listing.length, size: 2, word, text, file: file.name, line, part: 0 });
  });
  const ok = diagnostics.length === 0;
  const lanesIn = Array.from({ length: lanes }, (_, l) => din?.[l] ?? 0);
  return { ok, diagnostics, segments: listing.length ? [{ address: 0, bytes: wordsToBytes(listing.map((r) => r.word)), executable: true }] : [],
    entry: 0, listing, symbols: {}, symbolTable: [], data: [], lanes, din: lanesIn };
}

/** Words as little-endian bytes (the memory panel's and the .bin image's order). */
export function wordsToBytes(words) {
  const b = new Uint8Array(2 * words.length);
  words.forEach((w, i) => { b[2 * i] = w & 0xff; b[2 * i + 1] = (w >>> 8) & 0xff; });
  return b;
}

/** The program memory of a program: all sixteen words, unused ones 0 (HALT). */
export function programImage(program) {
  const m = new Uint16Array(PROGRAM_WORDS);
  for (const r of program.listing) if (r.address < PROGRAM_WORDS) m[r.address] = r.word;
  return m;
}

/**
 * The scratch line (contract v4 Language.scratch): a number from 0 to 0xFFFF is a word to decode; anything else is one
 * instruction to encode. Nothing is assembled into the program.
 */
export function scratch(text) {
  const t = text.trim();
  if (!t) return { kind: 'empty', ok: true };
  const n = parseNumber(t);
  const row = (word, src) => ({ address: 0, size: 2, word, text: src, part: 0 });
  if (n !== null) {
    if (n < 0 || n > 0xffff) return { kind: 'encode', ok: false, error: { message: S.asm.wordRange(n) } };
    return { kind: 'decode', ok: true, text: disassemble(n), rows: [row(n, disassemble(n))] };
  }
  if (/^\s*\./.test(t)) return { kind: 'encode', ok: false, error: { message: S.scratchOne } };
  const p = assemble([{ name: 'scratch.simt', text: t }]);
  const e = p.diagnostics[0];
  if (e) return { kind: 'encode', ok: false, error: { message: e.message, ...(e.note ? { note: e.note } : {}) } };
  return { kind: 'encode', ok: true, rows: p.listing.map((l) => row(l.word, l.text)) };
}

/** The .hex and .bin images (capability exportImage): sixteen words, one per line as four hexadecimal digits (as the
 *  testbench writes pm_wdata), or 32 bytes, each word little-endian. */
export function image(program) {
  const m = programImage(program);
  return { hex: `${Array.from(m, (w) => w.toString(16).padStart(4, '0')).join('\n')}\n`, bin: wordsToBytes([...m]) };
}

/**
 * A program from a .hex or .bin image (capability imageImport): up to sixteen words from address 0, every word a
 * listing row without source. A .hex file holds one word per line in hexadecimal (up to eight digits, as $readmemh
 * reads, the value within 16 bits); `//` and `#` start a comment. The lanes come from the profile; the inputs are 0.
 */
export function loadImage(content, kind, name, { profile } = {}) {
  let words;
  if (kind === 'hex') {
    words = [];
    for (const raw of String(content).split(/\r\n|\r|\n/)) {
      const t = raw.split('//', 1)[0].split('#', 1)[0].trim();
      if (!t) continue;
      const v = /^[0-9a-fA-F]{1,8}$/.test(t) ? parseInt(t, 16) : NaN;
      if (!(v >= 0 && v <= 0xffff)) throw new Error(S.asm.badImageWord(t));
      words.push(v);
    }
  } else {
    const b = Uint8Array.from(content);
    if (b.length % 2) throw new Error(S.asm.binOdd(b.length));
    words = Array.from({ length: b.length / 2 }, (_, i) => b[2 * i] | (b[2 * i + 1] << 8));
  }
  if (words.length > PROGRAM_WORDS) throw new Error(S.asm.imageTooLong(words.length));
  const lanes = lanesOf(profile);
  return {
    ok: true, imported: true, diagnostics: [], entry: 0, symbols: {}, symbolTable: [], data: [], lanes, din: Array(lanes).fill(0),
    segments: words.length ? [{ address: 0, bytes: wordsToBytes(words), executable: true }] : [],
    listing: words.map((word, address) => ({ address, size: 2, word, text: '', file: name, line: address + 1, part: -1 })),
  };
}

const hex4 = (w) => `0x${w.toString(16).toUpperCase().padStart(4, '0')}`;

/** The instruction a word stands for; op 7 (reserved) is shown as `.word`. Bits an operation does not use are ignored. */
export function disassemble(word) {
  const { op, rd, rs, rt, imm } = decode(word);
  const m = MNEMONIC_OF[op];
  switch (m) {
    case 'LDI': return `LDI r${rd}, ${sext8(imm)}`;
    case 'ADD': case 'SUB': return `${m} r${rd}, r${rs}, r${rt}`;
    case 'IFLT': return `IFLT r${rs}, r${rt}`;
    case undefined: return `.word ${hex4(word)}`;
    default: return m;
  }
}

/** The encoding fields for the inspector and the listing's binary column. `rt` [8:7] and `imm` [7:0] share bit 7. */
export function fields(word) {
  const { op, rd, rs, rt, imm } = decode(word);
  const m = MNEMONIC_OF[op];
  const uses = new Set(OPERANDS[m] ?? []);
  const f = (name, bits, value, short) => ({ name, bits, value, short: uses.has(name) ? short : '—',
    meaning: uses.has(name) ? S.fieldMeaning[name] : S.fieldMeaning.unused });
  const opField = { name: 'op', bits: '15:13', value: op, short: 'op', meaning: S.fieldMeaning.op(m) };
  if (m === 'LDI') return [opField, f('rd', '12:11', rd, 'rd'), { name: 'unused', bits: '10:8', value: (word >>> 8) & 7, short: '—', meaning: S.fieldMeaning.unused },
    f('imm', '7:0', imm, 'imm')];
  return [opField, f('rd', '12:11', rd, 'rd'), f('rs', '10:9', rs, 'rs'), f('rt', '8:7', rt, 'rt'),
    { name: 'unused', bits: '6:0', value: word & 0x7f, short: '—', meaning: S.fieldMeaning.unused }];
}

/** The word tooltip of the listing. */
export function describe(word) {
  const { op, imm } = decode(word);
  const m = MNEMONIC_OF[op];
  if (m === undefined) return { kind: S.reserved };
  return { kind: S.format, ...(m === 'LDI' ? { immediate: sext8(imm) } : {}) };
}

/** Editor data (v5 Language.editor): the shell compares lower case. */
export const editor = {
  mnemonics: Object.keys(OPS).map((m) => m.toLowerCase()).sort(),
  registers: ['r0', 'r1', 'r2', 'r3'],
  directives: [...DIRECTIVES],
  hover: (token) => S.registerHelp[token.toLowerCase()] ?? S.directiveHelp[token.toLowerCase()] ?? null,
  detail: (word, kind) => (kind === 'register' ? S.registerHelp[word.toLowerCase()] ?? '' : S.editorHelp[word.toUpperCase()]?.usage ?? ''),
  help: (word) => {
    const h = S.editorHelp[word.toUpperCase()];
    if (h) return { kind: 'instruction', usage: h.usage, format: S.format, operation: h.operation };
    const r = S.registerHelp[word.toLowerCase()];
    return r ? { kind: 'register', text: r } : null;
  },
};
