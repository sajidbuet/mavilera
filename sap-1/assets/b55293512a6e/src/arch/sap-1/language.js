// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { SAP1_STRINGS as S } from './strings.js';
import { applyLoads } from '../../shell/data-io.js';
export const MEMORY_BYTES = 16;
export const OPCODES = Object.freeze({ LDA: 0b0000, ADD: 0b0001, SUB: 0b0010, OUT: 0b1110, HLT: 0b1111 });
export const MNEMONIC_OF = Object.freeze(Object.fromEntries(Object.entries(OPCODES).map(([m, op]) => [op, m])));
const WITH_ADDRESS = new Set(['LDA', 'ADD', 'SUB']);
export const DIRECTIVES = Object.freeze(['DB', 'ORG']);
const hexH = (v) => `${/^[A-F]/.test(v.toString(16).toUpperCase()) ? '0' : ''}${v.toString(16).toUpperCase()}H`;
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
 if (!LABEL.test(name) || parseNumber(name) !== null || name.toUpperCase() in OPCODES || DIRECTIVES.includes(name.toUpperCase())) {
 err(line, c, name.length, S.asm.badLabel(name));
 } else if (name in symbols) err(line, c, name.length, S.asm.duplicateLabel(name));
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
 else if (v === null) err(line, argCol, arg.length, S.asm.badNumber(arg));
 else if (v < 0 || v >= MEMORY_BYTES) err(line, argCol, arg.length, S.asm.addressRange(v));
 else at = v;
 return;
 }
 if (op === 'DB') {
 if (!arg) { err(line, opCol, opLen, S.asm.needsValue('DB')); return; }
 const values = arg.split(',').map((x) => x.trim());
 items.push({ kind: 'data', at, values, line, text, opCol, opLen, argCol });
 at += values.length;
 return;
 }
 if (!(op in OPCODES)) { err(line, opCol, opLen, S.asm.unknown(m[2]), S.asm.unknownNote); return; }
 if (WITH_ADDRESS.has(op) && !arg) { err(line, opCol, opLen, S.asm.needsAddress(op)); return; }
 if (!WITH_ADDRESS.has(op) && arg) { err(line, argCol, arg.length, S.asm.noOperand(op)); return; }
 items.push({ kind: 'code', at, op, arg, line, text, opCol, opLen, argCol });
 at += 1;
 });
 const bytes = new Uint8Array(MEMORY_BYTES);
 const used = new Map();
 const listing = [];
 const data = [];
 const place = (item, a, v) => {
 if (a >= MEMORY_BYTES) { err(item.line, item.opCol, item.opLen, S.asm.full); return false; }
 if (used.has(a)) { err(item.line, item.opCol, item.opLen, S.asm.overlap(a)); return false; }
 used.set(a, item.line);
 bytes[a] = v;
 return true;
 };
 const value = (t, item) => {
 const n = parseNumber(t);
 if (n !== null) return n;
 if (t in symbols) return symbols[t];
 err(item.line, item.argCol, t.length, LABEL.test(t) ? S.asm.undefinedLabel(t) : S.asm.badNumber(t));
 return null;
 };
 for (const it of items) {
 if (it.kind === 'code') {
 let addr = 0;
 if (WITH_ADDRESS.has(it.op)) {
 const v = value(it.arg, it);
 if (v === null) continue;
 if (v < 0 || v >= MEMORY_BYTES) { err(it.line, it.argCol, it.arg.length, S.asm.addressRange(v)); continue; }
 addr = v;
 }
 const word = (OPCODES[it.op] << 4) | addr;
 if (place(it, it.at, word)) listing.push({ address: it.at, size: 1, word, text: it.text, file: file.name, line: it.line, part: 0 });
 } else {
 const out = [];
 for (const [k, t] of it.values.entries()) {
 const v = value(t, it);
 if (v === null) break;
 if (v < -128 || v > 255) { err(it.line, it.argCol, it.values.join(', ').length, S.asm.byteRange(v)); break; }
 if (!place(it, it.at + k, v & 0xff)) break;
 out.push(v & 0xff);
 }
 if (out.length) data.push({ address: it.at, bytes: Uint8Array.from(out), file: file.name, line: it.line, text: it.text });
 }
 }
 listing.sort((a, b) => a.address - b.address);
 for (const s of symbolTable) if (data.some((d) => d.address === s.address)) s.section = 'data';
 const code = new Set(listing.map((r) => r.address));
 const segments = [];
 for (let a = 0; a < MEMORY_BYTES; a++) {
 if (!used.has(a)) continue;
 const last = segments[segments.length - 1];
 if (last && last.address + last.length === a && last.executable === code.has(a)) last.length += 1;
 else segments.push({ address: a, length: 1, executable: code.has(a) });
 }
 const ok = diagnostics.length === 0;
 return { ok, diagnostics, segments: segments.map((s) => ({ address: s.address, bytes: bytes.slice(s.address, s.address + s.length), executable: s.executable })),
 entry: 0, listing, data, symbols, symbolTable };
}
export function assembleWithData(files, { data = [] } = {}) {
 const p = assemble(files);
 if (!data.length) return p;
 p.loadReport = applyLoads(p, data);
 const image = memoryImage(p);
 for (const d of p.data) d.bytes = image.slice(d.address, d.address + d.bytes.length);
 return p;
}
export function scratch(text) {
 const t = text.trim();
 if (!t) return { kind: 'empty', ok: true };
 const n = parseNumber(t);
 const row = (word, src) => ({ address: 0, size: 1, word, text: src, part: 0 });
 if (n !== null) {
 if (n < 0 || n > 255) return { kind: 'encode', ok: false, error: { message: S.asm.byteRange(n) } };
 const ok = MNEMONIC_OF[n >> 4] !== undefined;
 return { kind: 'decode', ok, text: disassemble(n), rows: [row(n, disassemble(n))] };
 }
 if (/:|^\s*(DB|ORG)\b/i.test(t)) return { kind: 'encode', ok: false, error: { message: S.scratchOne } };
 const p = assemble([{ name: 'scratch.asm', text: t }]);
 const e = p.diagnostics[0];
 if (e) return { kind: 'encode', ok: false, error: { message: e.message, ...(e.note ? { note: e.note } : {}) } };
 return { kind: 'encode', ok: true, rows: p.listing.map((l) => row(l.word, l.text)) };
}
export function memoryImage(program) {
 const m = new Uint8Array(MEMORY_BYTES);
 for (const s of program.segments) m.set(s.bytes.slice(0, MEMORY_BYTES - s.address), s.address);
 return m;
}
export function image(program) {
 const m = memoryImage(program);
 return { hex: `${Array.from(m, (b) => b.toString(16).padStart(2, '0')).join('\n')}\n`, bin: m };
}
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
 return {
 ok: true, imported: true, diagnostics: [], entry: 0, symbols: {}, symbolTable: [], data: [],
 segments: [{ address: 0, bytes, executable: true }],
 listing: Array.from(bytes, (word, address) => ({ address, size: 1, word, text: '', file: name, line: address + 1, part: -1 })),
 };
}
export function disassemble(word) {
 const m = MNEMONIC_OF[word >> 4];
 if (m === undefined) return `DB ${hexH(word)}`;
 return WITH_ADDRESS.has(m) ? `${m} ${hexH(word & 0xf)}` : m;
}
export function fields(word) {
 const m = MNEMONIC_OF[word >> 4];
 const addr = m === undefined || WITH_ADDRESS.has(m);
 return [
 { name: 'opcode', bits: '7:4', value: word >> 4, short: 'op', meaning: S.fieldMeaning.opcode(m) },
 { name: addr ? 'address' : 'unused', bits: '3:0', value: word & 0xf, short: addr ? 'addr' : '—', meaning: addr ? S.fieldMeaning.address : S.fieldMeaning.unused },
 ];
}
export function describe(word) {
 const m = MNEMONIC_OF[word >> 4];
 return m === undefined ? null : { kind: S.format, ...(WITH_ADDRESS.has(m) ? { immediate: word & 0xf } : {}) };
}
export const editor = {
 mnemonics: Object.keys(OPCODES).map((m) => m.toLowerCase()).sort(),
 registers: [],
 directives: DIRECTIVES.map((d) => d.toLowerCase()),
 detail: (word) => S.editorHelp[word.toUpperCase()]?.usage ?? '',
 help: (word) => {
 const h = S.editorHelp[word.toUpperCase()];
 return h ? { kind: 'instruction', usage: h.usage, format: S.format, operation: h.operation } : null;
 },
};
