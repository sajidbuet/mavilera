// sap-2/language.js -- the SAP-2 assembly language on the contract (Language, spec W-D29; plan step 2 of
// docs/architecture/sap-2-plan.md): assembler, disassembler, encoding fields, editor data and the scratch line. The
// 43 instructions of Malvino and Brown's Tables 11-1 and 11-3 (reference sheet §2, decision 1): 8085 mnemonics and op
// codes, one to three bytes, an address or a two-byte value stored low byte first; 64K of memory. The simulator's own
// code (C4). No DOM.
//
// Source: one item per line, `[label:] [mnemonic [operand[,operand]]] [; comment]`, case-insensitive except labels.
// `DB v[, v …]` places bytes (-128 to 255), `DW v[, v …]` two-byte values low byte first (-32768 to 65535), `ORG a`
// moves to address a. Numbers: decimal, 0x… or 0b…, or hexadecimal with a trailing H that starts with a digit (0FFH).
// IN takes port 1 or 2 and OUT port 3 or 4, anything else is an error (decision 5). A program with a CALL that places
// bytes at FFFEH or FFFFH, where CALL keeps its return address, gets a warning (author, 2026-10-29).
//
// A listing word holds the instruction's bytes in memory order, the op code in its high byte (CALL 2000H is
// 0xCD0020, shown CD0020 as in the book's hand-assembled listings); its size follows from its value, because no op code
// of two or three bytes is 00.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { SAP2_STRINGS as S } from './strings.js';
import { applyLoads } from '../../shell/data-io.js';

export const MEMORY_BYTES = 0x10000;
/** Where CALL keeps the return address, low byte first (reference sheet §6, decision 3). */
export const RETURN_ADDRESS = 0xfffe;
/** The ports IN and OUT may name (reference sheet §7). */
export const PORTS = Object.freeze({ IN: Object.freeze([1, 2]), OUT: Object.freeze([3, 4]) });

// form, op code, bytes, T states (a conditional jump: taken, not taken), sets S and Z; reference sheet §2, in its order
const TABLE = [
  ['ADD B', 0x80, 1, 4, 0, true], ['ADD C', 0x81, 1, 4, 0, true], ['ANA B', 0xa0, 1, 4, 0, true], ['ANA C', 0xa1, 1, 4, 0, true],
  ['ANI byte', 0xe6, 2, 7, 0, true], ['CALL address', 0xcd, 3, 18, 0, false], ['CMA', 0x2f, 1, 4, 0, false],
  ['DCR A', 0x3d, 1, 4, 0, true], ['DCR B', 0x05, 1, 4, 0, true], ['DCR C', 0x0d, 1, 4, 0, true], ['HLT', 0x76, 1, 5, 0, false],
  ['IN byte', 0xdb, 2, 10, 0, false], ['INR A', 0x3c, 1, 4, 0, true], ['INR B', 0x04, 1, 4, 0, true], ['INR C', 0x0c, 1, 4, 0, true],
  ['JM address', 0xfa, 3, 10, 7, false], ['JMP address', 0xc3, 3, 10, 0, false], ['JNZ address', 0xc2, 3, 10, 7, false],
  ['JZ address', 0xca, 3, 10, 7, false], ['LDA address', 0x3a, 3, 13, 0, false],
  ['MOV A,B', 0x78, 1, 4, 0, false], ['MOV A,C', 0x79, 1, 4, 0, false], ['MOV B,A', 0x47, 1, 4, 0, false], ['MOV B,C', 0x41, 1, 4, 0, false],
  ['MOV C,A', 0x4f, 1, 4, 0, false], ['MOV C,B', 0x48, 1, 4, 0, false],
  ['MVI A,byte', 0x3e, 2, 7, 0, false], ['MVI B,byte', 0x06, 2, 7, 0, false], ['MVI C,byte', 0x0e, 2, 7, 0, false],
  ['NOP', 0x00, 1, 4, 0, false], ['ORA B', 0xb0, 1, 4, 0, true], ['ORA C', 0xb1, 1, 4, 0, true], ['ORI byte', 0xf6, 2, 7, 0, true],
  ['OUT byte', 0xd3, 2, 10, 0, false], ['RAL', 0x17, 1, 4, 0, false], ['RAR', 0x1f, 1, 4, 0, false], ['RET', 0xc9, 1, 10, 0, false],
  ['STA address', 0x32, 3, 13, 0, false], ['SUB B', 0x90, 1, 4, 0, true], ['SUB C', 0x91, 1, 4, 0, true],
  ['XRA B', 0xa8, 1, 4, 0, true], ['XRA C', 0xa9, 1, 4, 0, true], ['XRI byte', 0xee, 2, 7, 0, true],
];

/**
 * The 43 instructions: `form` as in the book ('MVI A,byte'), `mnemonic`, `regs` (the register operands), `operand`
 * ('byte', 'address', 'port' or null), `opcode`, `bytes`, `states` (T states; a conditional jump when taken),
 * `notTaken` (a conditional jump's T states when not taken, else null), `flags` (sets S and Z).
 */
export const INSTRUCTIONS = Object.freeze(TABLE.map(([form, opcode, bytes, states, notTaken, flags]) => {
  const [mnemonic, ops = ''] = form.split(' ');
  const parts = ops ? ops.split(',') : [];
  const last = parts[parts.length - 1];
  const operand = last === 'byte' ? (mnemonic === 'IN' || mnemonic === 'OUT' ? 'port' : 'byte') : last === 'address' ? 'address' : null;
  return Object.freeze({ form, mnemonic, regs: Object.freeze(operand ? parts.slice(0, -1) : parts), operand, opcode, bytes, states,
    notTaken: notTaken || null, flags });
}));
/** The instruction of each op code. */
export const BY_OPCODE = Object.freeze(Object.fromEntries(INSTRUCTIONS.map((i) => [i.opcode, i])));
const FORMS = {}; // mnemonic -> its instructions
for (const i of INSTRUCTIONS) (FORMS[i.mnemonic] ??= []).push(i);
export const MNEMONICS = Object.freeze(Object.keys(FORMS).sort());
export const REGISTERS = Object.freeze(['A', 'B', 'C']);
export const DIRECTIVES = Object.freeze(['DB', 'DW', 'ORG']);

/** Hexadecimal with a trailing H and a leading 0 before a letter (05H, 0FFH, 2000H, 0FFFEH): the assembler reads it back. */
export const hexH = (v, digits) => {
  const s = v.toString(16).toUpperCase().padStart(digits, '0');
  return `${/^[A-F]/.test(s) ? '0' : ''}${s}H`;
};

/** A number in one of the accepted notations, or null. */
export function parseNumber(t) {
  const s = t.trim();
  let m;
  if ((m = /^([-+]?)(\d+)$/.exec(s))) return Number(m[1] + m[2]);
  if ((m = /^([-+]?)0x([0-9a-f]+)$/i.exec(s))) return Number(`${m[1]}${parseInt(m[2], 16)}`);
  if ((m = /^([-+]?)0b([01]+)$/i.exec(s))) return Number(`${m[1]}${parseInt(m[2], 2)}`);
  if ((m = /^([-+]?)(\d[0-9a-f]*)h$/i.exec(s))) return Number(`${m[1]}${parseInt(m[2], 16)}`);
  return null;
}

const LABEL = /^[A-Za-z_.][\w.]*$/;
const reserved = (name) => {
  const u = name.toUpperCase();
  return u in FORMS || DIRECTIVES.includes(u) || REGISTERS.includes(u);
};

/** The comma-separated operands of `arg`, each with its column (`col` is the column of `arg`). */
function operandsOf(arg, col) {
  if (!arg) return [];
  const out = [];
  let at = 0;
  for (const part of arg.split(',')) {
    const lead = part.length - part.trimStart().length;
    out.push({ t: part.trim(), col: col + at + lead });
    at += part.length + 1;
  }
  return out;
}

/** The bytes of a word in memory order, with its size (see the header). */
export function bytesOf(word) {
  const size = word > 0xffff ? 3 : word > 0xff ? 2 : 1;
  return Array.from({ length: size }, (_, k) => (word >>> (8 * (size - 1 - k))) & 0xff);
}

/** A word from bytes in memory order. */
export const wordOf = (bytes) => bytes.reduce((w, b) => w * 256 + b, 0);

/** The instruction of a word and its operand value (a byte, a port or an address), or `ins: null`. */
export function decode(word) {
  const b = bytesOf(word);
  const ins = BY_OPCODE[b[0]];
  if (!ins || ins.bytes !== b.length) return { ins: null, bytes: b };
  return { ins, bytes: b, operand: b.length === 3 ? b[1] | (b[2] << 8) : b.length === 2 ? b[1] : null };
}

/**
 * Assemble one SAP-2 source file (the contract's Program). Two passes: the first places every item and its labels,
 * the second resolves the operands. Instructions go to `listing`, DB and DW items to `data`; the program starts at
 * 0000H (decision 4).
 */
export function assemble(files) {
  const file = files[0] ?? { name: 'main.asm', text: '' };
  const diagnostics = [];
  const err = (line, column, length, message, note) => diagnostics.push({ severity: 'error', file: file.name, line, column, length,
    message, ...(note ? { note } : {}) });
  const symbols = {};
  const symbolTable = [];
  const items = [];
  let at = 0;
  file.text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const code = raw.replace(/;.*/, '');
    let rest = code;
    let col = 1;
    const lm = /^\s*([^\s:]+)\s*:/.exec(rest);
    if (lm) {
      const name = lm[1];
      const c = rest.indexOf(name) + 1;
      if (!LABEL.test(name) || parseNumber(name) !== null || reserved(name)) err(line, c, name.length, S.asm.badLabel(name));
      else if (name in symbols) err(line, c, name.length, S.asm.duplicateLabel(name));
      else { symbols[name] = at; symbolTable.push({ name, address: at, section: 'mem', file: file.name, line }); }
      col += lm[0].length;
      rest = rest.slice(lm[0].length);
    }
    const m = /^(\s*)(\S+)(\s*)(.*?)\s*$/.exec(rest);
    if (!m) return;
    const op = m[2].toUpperCase();
    const opCol = col + m[1].length;
    const opLen = m[2].length;
    const arg = m[4];
    const argCol = opCol + opLen + m[3].length;
    const text = code.trim();
    if (op === 'ORG') {
      const v = parseNumber(arg);
      if (!arg) err(line, opCol, opLen, S.asm.needsValue('ORG'));
      else if (v === null) err(line, argCol, arg.length, S.asm.notNumber(arg));
      else if (v < 0 || v >= MEMORY_BYTES) err(line, argCol, arg.length, S.asm.addressRange(v));
      else at = v;
      return;
    }
    if (op === 'DB' || op === 'DW') {
      if (!arg) { err(line, opCol, opLen, S.asm.needsValue(op)); return; }
      const values = operandsOf(arg, argCol);
      const size = op === 'DB' ? 1 : 2;
      items.push({ kind: 'data', at, size, values, line, text, opCol, opLen });
      at += size * values.length;
      return;
    }
    const forms = FORMS[op];
    if (!forms) { err(line, opCol, opLen, S.asm.unknown(m[2]), S.asm.unknownNote); return; }
    const ops = operandsOf(arg, argCol);
    const ins = forms.find((f) => f.regs.length + (f.operand ? 1 : 0) === ops.length
      && f.regs.every((r, k) => ops[k].t.toUpperCase() === r));
    if (!ins) {
      if (forms.every((f) => !f.operand && !f.regs.length)) err(line, argCol, arg.length, S.asm.noOperand(op));
      else err(line, arg ? argCol : opCol, arg ? arg.length : opLen, S.asm.operands(op, forms.map((f) => f.form)));
      return;
    }
    items.push({ kind: 'code', at, ins, value: ins.operand ? ops[ops.length - 1] : null, line, text, opCol, opLen });
    at += ins.bytes;
  });

  const bytes = new Uint8Array(MEMORY_BYTES);
  const used = new Map();
  const code = new Set();
  const listing = [];
  const data = [];
  const place = (item, a, vs) => {
    for (let k = 0; k < vs.length; k++) {
      if (a + k >= MEMORY_BYTES) { err(item.line, item.opCol, item.opLen, S.asm.full); return false; }
      if (used.has(a + k)) { err(item.line, item.opCol, item.opLen, S.asm.overlap(a + k)); return false; }
    }
    vs.forEach((v, k) => { used.set(a + k, item); bytes[a + k] = v; });
    return true;
  };
  const value = (o, item) => {
    const n = parseNumber(o.t);
    if (n !== null) return n;
    if (o.t in symbols) return symbols[o.t];
    err(item.line, o.col, o.t.length, LABEL.test(o.t) ? S.asm.undefinedLabel(o.t) : S.asm.badNumber(o.t));
    return null;
  };
  for (const it of items) {
    if (it.kind === 'code') {
      const { ins, value: o } = it;
      let operand = [];
      if (ins.operand === 'port') {
        const v = parseNumber(o.t);
        if (v === null) { err(it.line, o.col, o.t.length, S.asm.notNumber(o.t)); continue; }
        if (!PORTS[ins.mnemonic].includes(v)) { err(it.line, o.col, o.t.length, S.asm.port(ins.mnemonic, v)); continue; }
        operand = [v];
      } else if (ins.operand === 'byte') {
        const v = value(o, it);
        if (v === null) continue;
        if (v < -128 || v > 255) { err(it.line, o.col, o.t.length, S.asm.byteRange(v)); continue; }
        operand = [v & 0xff];
      } else if (ins.operand === 'address') {
        const v = value(o, it);
        if (v === null) continue;
        if (v < 0 || v >= MEMORY_BYTES) { err(it.line, o.col, o.t.length, S.asm.addressRange(v)); continue; }
        operand = [v & 0xff, v >> 8];
      }
      const vs = [ins.opcode, ...operand];
      if (!place(it, it.at, vs)) continue;
      vs.forEach((_, k) => code.add(it.at + k));
      listing.push({ address: it.at, size: ins.bytes, word: wordOf(vs), text: it.text, file: file.name, line: it.line, part: 0 });
    } else {
      const out = [];
      for (const o of it.values) {
        const v = value(o, it);
        if (v === null) break;
        if (it.size === 1 && (v < -128 || v > 255)) { err(it.line, o.col, o.t.length, S.asm.byteRange(v)); break; }
        if (it.size === 2 && (v < -32768 || v > 65535)) { err(it.line, o.col, o.t.length, S.asm.wordRange(v)); break; }
        const vs = it.size === 1 ? [v & 0xff] : [v & 0xff, (v >> 8) & 0xff];
        if (!place(it, it.at + out.length, vs)) break;
        out.push(...vs);
      }
      if (out.length) data.push({ address: it.at, bytes: Uint8Array.from(out), file: file.name, line: it.line, text: it.text });
    }
  }
  listing.sort((a, b) => a.address - b.address);
  // a CALL writes its return address to FFFEH and FFFFH (reference sheet §6): a warning for each item placed there
  const call = listing.find((r) => r.size === 3 && r.word >>> 16 === 0xcd);
  if (call) {
    for (const it of new Set([RETURN_ADDRESS, RETURN_ADDRESS + 1].map((a) => used.get(a)).filter(Boolean))) {
      diagnostics.push({ severity: 'warning', file: file.name, line: it.line, column: it.opCol, length: it.opLen,
        message: S.asm.returnOverwritten(call.address) });
    }
  }
  // a label of a DB or DW item is a data label
  for (const s of symbolTable) if (data.some((d) => d.address === s.address)) s.section = 'data';
  // segments: each run of instruction bytes (executable) or of data bytes; unused bytes are in none and start as zero
  const segments = [];
  for (const a of [...used.keys()].sort((x, y) => x - y)) {
    const last = segments[segments.length - 1];
    if (last && last.address + last.length === a && last.executable === code.has(a)) last.length += 1;
    else segments.push({ address: a, length: 1, executable: code.has(a) });
  }
  const ok = !diagnostics.some((d) => d.severity === 'error');
  return { ok, diagnostics, segments: segments.map((s) => ({ address: s.address, bytes: bytes.slice(s.address, s.address + s.length), executable: s.executable })),
    entry: 0, listing, data, symbols, symbolTable };
}

/**
 * Assemble with the data files of the data dialog (contract v2 `options.data`, capability dataIO; plan §5, decision 6):
 * each load's bytes replace the bytes at its data label, as far as the label's room goes (shell/data-io.js
 * applyLoads); the listing's DB and DW rows show the loaded values.
 */
export function assembleWithData(files, { data = [] } = {}) {
  const p = assemble(files);
  if (!data.length) return p;
  p.loadReport = applyLoads(p, data);
  const image = memoryImage(p);
  for (const d of p.data) d.bytes = image.slice(d.address, d.address + d.bytes.length);
  return p;
}

/**
 * The scratch line (contract v4 Language.scratch): one to three numbers from 0 to 255, separated by spaces or commas,
 * are the bytes of an instruction to decode; anything else is one instruction to encode. Nothing is assembled into the
 * program, so an operand is a number, not a label.
 */
export function scratch(text) {
  const t = text.trim();
  if (!t) return { kind: 'empty', ok: true };
  const row = (word, size, src) => ({ address: 0, size, word, text: src, part: 0 });
  const tokens = t.split(/[\s,]+/);
  const nums = tokens.map(parseNumber);
  if (nums.every((n) => n !== null)) {
    const bad = nums.findIndex((n) => n < 0 || n > 255);
    if (bad >= 0) return { kind: 'encode', ok: false, error: { message: S.scratchByte(tokens[bad]) } };
    const ins = BY_OPCODE[nums[0]];
    if (!ins) return { kind: 'decode', ok: false };
    if (nums.length !== ins.bytes) return { kind: 'encode', ok: false, error: { message: S.scratchBytes(ins.form, ins.bytes) } };
    const word = wordOf(nums);
    return { kind: 'decode', ok: true, text: disassemble(word), rows: [row(word, ins.bytes, disassemble(word))] };
  }
  if (/:|^\s*(DB|DW|ORG)\b/i.test(t)) return { kind: 'encode', ok: false, error: { message: S.scratchOne } };
  const p = assemble([{ name: 'scratch.asm', text: t }]);
  const e = p.diagnostics.find((d) => d.severity === 'error');
  if (e) return { kind: 'encode', ok: false, error: { message: e.message, ...(e.note ? { note: e.note } : {}) } };
  return { kind: 'encode', ok: true, rows: p.listing.map((l) => row(l.word, l.size, l.text)) };
}

/** The memory image of a program: all 64K bytes, unused ones zero. */
export function memoryImage(program) {
  const m = new Uint8Array(MEMORY_BYTES);
  for (const s of program.segments) m.set(s.bytes.slice(0, MEMORY_BYTES - s.address), s.address);
  return m;
}

/**
 * The .hex and .bin images (capability exportImage): the memory from 0000H to the program's last byte, one byte per
 * line in hexadecimal, or those bytes. The rest of the 64K is zero, as at a reset.
 */
export function image(program) {
  const end = Math.max(0, ...program.segments.map((s) => s.address + s.bytes.length));
  const m = memoryImage(program).slice(0, end);
  return { hex: Array.from(m, (b) => `${b.toString(16).padStart(2, '0')}\n`).join(''), bin: m };
}

/**
 * A program from a .hex or .bin image (capability imageImport): its bytes from 0000H. The listing is read from 0000H
 * one instruction after another (a byte that is not an op code, or an instruction cut off by the end of the image, is
 * one byte of data), with no source. A .hex file holds one byte per line in hexadecimal; `//` and `#` start a comment.
 */
export function loadImage(content, kind, name) {
  let bytes;
  if (kind === 'hex') {
    const out = [];
    for (const raw of String(content).split(/\r\n|\r|\n/)) {
      const t = raw.split('//', 1)[0].split('#', 1)[0].trim();
      if (!t) continue;
      if (!/^[0-9a-fA-F]{1,2}$/.test(t)) throw new Error(S.asm.badImageByte(t));
      out.push(parseInt(t, 16));
    }
    bytes = Uint8Array.from(out);
  } else bytes = Uint8Array.from(content);
  if (bytes.length > MEMORY_BYTES) throw new Error(S.asm.imageTooLong(bytes.length));
  const listing = [];
  for (let a = 0; a < bytes.length;) {
    const ins = BY_OPCODE[bytes[a]];
    const size = ins && a + ins.bytes <= bytes.length ? ins.bytes : 1;
    listing.push({ address: a, size, word: wordOf(bytes.slice(a, a + size)), text: '', file: name, line: listing.length + 1, part: -1 });
    a += size;
  }
  return { ok: true, imported: true, diagnostics: [], entry: 0, symbols: {}, symbolTable: [], data: [],
    segments: bytes.length ? [{ address: 0, bytes, executable: true }] : [], listing };
}

/** The instruction a word stands for, in the assembler's syntax; bytes that are not one are shown as data. */
export function disassemble(word) {
  const { ins, bytes, operand } = decode(word);
  if (!ins) return `DB ${bytes.map((b) => hexH(b, 2)).join(', ')}`;
  if (!ins.operand) return ins.form;
  const [m] = ins.form.split(' ');
  return `${m} ${[...ins.regs, hexH(operand, ins.operand === 'address' ? 4 : 2)].join(',')}`;
}

/** The encoding fields for the inspector and the listing's binary column: the op code, then a byte or an address. */
export function fields(word) {
  const { ins, bytes } = decode(word);
  const n = bytes.length;
  const at = (k) => `${8 * (n - k) - 1}:${8 * (n - k - 1)}`;
  const f = (key, k, meaning) => ({ name: S.fieldName[key], bits: at(k), value: bytes[k], short: S.fieldShort[key], meaning });
  const out = [f('opcode', 0, S.fieldMeaning.opcode(ins?.form))];
  if (!ins) return out.concat(bytes.slice(1).map((_, k) => f('byte', k + 1, '')));
  if (ins.operand === 'port') out.push(f('port', 1, S.fieldMeaning.port(bytes[1])));
  else if (ins.operand === 'byte') out.push(f('byte', 1, S.fieldMeaning.byte));
  else if (ins.operand === 'address') out.push(f('low', 1, S.fieldMeaning.low), f('high', 2, S.fieldMeaning.high));
  return out;
}

/** The word tooltip of the listing. */
export function describe(word) {
  const { ins, operand } = decode(word);
  return ins ? { kind: S.format[ins.bytes], ...(ins.operand ? { immediate: operand } : {}) } : null;
}

/** Editor data (v5 Language.editor): the shell compares lower case. */
export const editor = {
  mnemonics: MNEMONICS.map((m) => m.toLowerCase()),
  registers: REGISTERS.map((r) => r.toLowerCase()),
  directives: DIRECTIVES.map((d) => d.toLowerCase()),
  detail: (word, kind) => (kind === 'register' ? S.registerHelp[word.toUpperCase()] : S.editorHelp[word.toUpperCase()]?.usage) ?? '',
  help: (word) => {
    const w = word.toUpperCase();
    if (REGISTERS.includes(w)) return { kind: 'register', text: S.registerHelp[w] };
    const h = S.editorHelp[w];
    if (!h) return null;
    const i = FORMS[w][0];
    return { kind: 'instruction', usage: h.usage, format: `${S.format[i.bytes]}; ${S.timing(i.states, i.notTaken)}`, operation: h.operation };
  },
};
