// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import {
 INSTRUCTIONS, OPCODE, ABI_NAMES, CSR_NUMBERS,
 packR, packI, packS, packB, packU, packJ,
} from '../isa/encoding.js';
import { PROFILES } from '../core/profiles.js';
export class AsmError extends Error {
 constructor(message, hint = null, token = null, data = null) {
 super(message);
 this.hint = hint;
 this.token = token;
 this.data = data ?? {};
 }
}
class Unresolved extends Error {
 constructor(symbol) { super(symbol); this.symbol = symbol; }
}
export const PSEUDOS = Object.freeze(['nop', 'li', 'la', 'mv', 'not', 'neg', 'seqz', 'snez', 'sltz',
 'sgtz', 'beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz', 'bgt', 'ble', 'bgtu', 'bleu', 'j', 'jr',
 'ret', 'call', 'tail', 'halt', 'csrr', 'csrw', 'csrs', 'csrc', 'csrwi', 'csrsi', 'csrci']);
const SYNTAX_USAGE = {
 'rd,rs1,rs2': 'rd, rs1, rs2', 'rd,rs1,imm': 'rd, rs1, imm', 'rd,rs1,shamt': 'rd, rs1, shamt',
 'rd,mem': 'rd, offset(rs1)', 'rs2,mem': 'rs2, offset(rs1)', 'rs1,rs2,target': 'rs1, rs2, label',
 'rd,imm20': 'rd, imm20', 'rd,target': 'rd, label', jalr: 'rd, offset(rs1)', fence: 'pred, succ',
 csr: 'rd, csr, rs1', csri: 'rd, csr, uimm5', '': '',
};
const PSEUDO_USAGE = {
 nop: '', li: 'rd, value', la: 'rd, label', mv: 'rd, rs', not: 'rd, rs', neg: 'rd, rs', seqz: 'rd, rs',
 snez: 'rd, rs', sltz: 'rd, rs', sgtz: 'rd, rs', beqz: 'rs, label', bnez: 'rs, label', blez: 'rs, label',
 bgez: 'rs, label', bltz: 'rs, label', bgtz: 'rs, label', bgt: 'rs1, rs2, label', ble: 'rs1, rs2, label',
 bgtu: 'rs1, rs2, label', bleu: 'rs1, rs2, label', j: 'label', jr: 'rs', ret: '', call: 'label', tail: 'label',
 halt: '', csrr: 'rd, csr', csrw: 'csr, rs', csrs: 'csr, rs', csrc: 'csr, rs', csrwi: 'csr, uimm5',
 csrsi: 'csr, uimm5', csrci: 'csr, uimm5',
};
export function usage(mn) {
 const u = mn in PSEUDO_USAGE ? PSEUDO_USAGE[mn] : INSTRUCTIONS[mn] ? SYNTAX_USAGE[INSTRUCTIONS[mn].syntax] : null;
 if (u === null || u === undefined) return null;
 return u ? `${mn} ${u}` : mn;
}
function editDistance(a, b) {
 const d = Array.from({ length: b.length + 1 }, (_, j) => j);
 for (let i = 1; i <= a.length; i++) {
 let prev = d[0];
 d[0] = i;
 for (let j = 1; j <= b.length; j++) {
 const t = d[j];
 d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
 prev = t;
 }
 }
 return d[b.length];
}
export function closest(word, candidates, rank = () => 0) {
 const w = word.toLowerCase();
 const max = w.length <= 3 ? 1 : 2;
 return [...new Set(candidates)].map((c) => [c, editDistance(w, c.toLowerCase()), rank(c)])
 .filter(([, d]) => d <= max).sort((p, q) => p[1] - q[1] || p[2] - q[2] || p[0].localeCompare(q[0]))
 .slice(0, 3).map(([c]) => c);
}
const MNEMONICS = () => [...Object.keys(INSTRUCTIONS), ...PSEUDOS];
const FOREIGN = { jmp: 'j', b: 'j', br: 'j', mov: 'mv', move: 'mv', ld: 'lw', ldr: 'lw', st: 'sw', str: 'sw',
 bl: 'call', jsr: 'call', rts: 'ret', inc: 'addi', dec: 'addi', cmp: 'sub', hlt: 'halt' };
const REGISTER_NAMES = [...ABI_NAMES, 'fp', ...Array.from({ length: 32 }, (_, i) => `x${i}`)];
const IGNORED = new Set(['.globl', '.global', '.type', '.size', '.file', '.option', '.ident', '.attribute']);
const DATA_SECTIONS = new Set(['.data', '.rodata', '.bss', '.sdata', '.sbss']);
const DATA_DIRECTIVES = new Set(['.word', '.half', '.short', '.byte', '.ascii', '.asciz', '.string',
 '.space', '.zero', '.skip']);
export const DIRECTIVES = Object.freeze(['.text', '.section', ...DATA_SECTIONS, ...DATA_DIRECTIVES,
 '.align', '.balign', '.p2align', '.equ', '.set', ...IGNORED].sort());
function stripComment(line) {
 let quote = null;
 for (let i = 0; i < line.length; i++) {
 const ch = line[i];
 if (quote) {
 if (ch === quote && line[i - 1] !== '\\') quote = null;
 } else if (ch === '"' || ch === "'") {
 quote = ch;
 } else if (ch === '#') {
 return line.slice(0, i);
 }
 }
 return line;
}
function splitOperands(text, offset) {
 const ops = [];
 let depth = 0;
 let quote = null;
 let start = 0;
 const push = (end) => {
 const raw = text.slice(start, end);
 const lead = raw.length - raw.trimStart().length;
 if (raw.trim() || end < text.length) ops.push({ text: raw.trim(), col: offset + start + lead });
 };
 for (let i = 0; i < text.length; i++) {
 const ch = text[i];
 if (quote) {
 if (ch === quote && text[i - 1] !== '\\') quote = null;
 continue;
 }
 if (ch === '"' || ch === "'") quote = ch;
 else if (ch === '(') depth++;
 else if (ch === ')') depth--;
 else if (ch === ',' && depth === 0) {
 push(i);
 start = i + 1;
 }
 }
 if (text.slice(start).trim()) push(text.length);
 return ops;
}
const ESCAPES = { n: 10, t: 9, r: 13, 0: 0, '\\': 92, '"': 34, "'": 39 };
const UTF8 = new TextEncoder();
function unescape(s) {
 const out = [];
 for (let i = 0; i < s.length;) {
 if (s[i] === '\\' && i + 1 < s.length) {
 if (!(s[i + 1] in ESCAPES)) throw new AsmError(`unknown escape \\${s[i + 1]}`, 'escape');
 out.push(ESCAPES[s[i + 1]]);
 i += 2;
 } else {
 const cp = s.codePointAt(i);
 const ch = String.fromCodePoint(cp);
 out.push(...UTF8.encode(ch));
 i += ch.length;
 }
 }
 return out;
}
export function regNumber(tok) {
 const t = tok.trim().toLowerCase();
 const m = /^x([0-9]|[12][0-9]|3[01])$/.exec(t);
 if (m) return Number(m[1]);
 if (t === 'fp') return 8;
 const i = ABI_NAMES.indexOf(t);
 if (i >= 0) return i;
 throw new AsmError(`bad register '${tok}'`, 'register', tok,
 { suggest: closest(t, REGISTER_NAMES), number: /^[-+]?(\d|0x)/i.test(t), xRange: /^x\d+$/.test(t) });
}
const hi20 = (v) => Math.floor((v + 0x800) / 4096) & 0xfffff;
const lo12 = (v) => { const x = v & 0xfff; return x & 0x800 ? x - 0x1000 : x; };
const sext32 = (v) => { const x = v & 0xffffffff; return x | 0; };
const TOKEN = /\s*(%hi|%lo|0[xX][0-9a-fA-F]+|0[bB][01]+|\d+|'(?:\\.|[^'])'|[A-Za-z_.$][\w.$]*|[()+\-])/y;
function parseNumber(t) {
 if (/^0[xX]/.test(t)) return parseInt(t.slice(2), 16);
 if (/^0[bB]/.test(t)) return parseInt(t.slice(2), 2);
 if (/^0\d*[1-9]/.test(t)) throw new AsmError(`bad number ${t}`, 'number', t);
 return parseInt(t, 10);
}
export function evaluate(expr, symbols) {
 const toks = [];
 const e = expr.trim();
 TOKEN.lastIndex = 0;
 while (TOKEN.lastIndex < e.length) {
 const m = TOKEN.exec(e);
 if (!m) throw new AsmError(`bad expression '${e}'`, 'expression', e);
 toks.push(m[1]);
 }
 toks.push(null);
 let i = 0;
 const peek = () => toks[i];
 const take = () => toks[i++];
 function atom() {
 const t = take();
 if (t === '-') return -atom();
 if (t === '+') return atom();
 if (t === '%hi' || t === '%lo') {
 if (take() !== '(') throw new AsmError(`${t} needs parentheses`, 'expression', e);
 const v = sum();
 if (take() !== ')') throw new AsmError('missing )', 'expression', e);
 return t === '%hi' ? hi20(v) : lo12(v);
 }
 if (t === '(') {
 const v = sum();
 if (take() !== ')') throw new AsmError('missing )', 'expression', e);
 return v;
 }
 if (t === null) throw new AsmError(`incomplete expression '${e}'`, 'expression', e);
 if (/^\d/.test(t)) return parseNumber(t);
 if (t[0] === "'") {
 const b = unescape(t.slice(1, -1));
 if (b.length !== 1) throw new AsmError(`bad character literal ${t}`, 'expression', t);
 return b[0];
 }
 if (symbols.has(t)) return symbols.get(t);
 throw new Unresolved(t);
 }
 function sum() {
 let v = atom();
 while (peek() === '+' || peek() === '-') v = take() === '+' ? v + atom() : v - atom();
 return v;
 }
 const v = sum();
 if (peek() !== null) throw new AsmError(`bad expression '${e}'`, 'expression', e);
 return v;
}
function memOperand(tok) {
 const m = /^\s*(.*?)\s*\(\s*(\w+)\s*\)\s*$/.exec(tok);
 if (!m) throw new AsmError(`bad memory operand '${tok}'`, 'memory', tok);
 return [m[1] || '0', m[2]];
}
function checkSigned(v, n, what, token) {
 const lo = -(2 ** (n - 1));
 const hi = 2 ** (n - 1) - 1;
 if (!(v >= lo && v <= hi)) {
 throw new AsmError(`${what} ${v} outside the ${n}-bit signed range`, 'range', token, { lo, hi, value: v, what });
 }
}
function fenceBits(s) {
 const t = s.trim().toLowerCase();
 if (t === '0') return 0;
 if (!t || [...t].some((c) => !'iorw'.includes(c))) throw new AsmError(`bad fence set '${s}'`, 'fence', s);
 return (t.includes('i') ? 8 : 0) | (t.includes('o') ? 4 : 0) | (t.includes('r') ? 2 : 0) | (t.includes('w') ? 1 : 0);
}
function liParts(value, rd) {
 const v = sext32(value);
 if (v >= -2048 && v <= 2047) return [['addi', [rd, 'zero', String(v)]]];
 const hi = hi20(v);
 const lo = lo12(v);
 const out = [['lui', [rd, `0x${hi.toString(16)}`]]];
 if (lo) out.push(['addi', [rd, rd, String(lo)]]);
 return out;
}
const SWAP_BRANCH = { bgt: 'blt', ble: 'bge', bgtu: 'bltu', bleu: 'bgeu' };
function expand(mn, ops, symbols) {
 const n = (k) => {
 if (ops.length !== k) throw new AsmError(`${mn} expects ${k} operand(s)`, 'operands', null, { usage: usage(mn), got: ops.length });
 };
 switch (mn) {
 case 'nop': n(0); return [['addi', ['zero', 'zero', '0']]];
 case 'mv': n(2); return [['addi', [ops[0], ops[1], '0']]];
 case 'not': n(2); return [['xori', [ops[0], ops[1], '-1']]];
 case 'neg': n(2); return [['sub', [ops[0], 'zero', ops[1]]]];
 case 'seqz': n(2); return [['sltiu', [ops[0], ops[1], '1']]];
 case 'snez': n(2); return [['sltu', [ops[0], 'zero', ops[1]]]];
 case 'sltz': n(2); return [['slt', [ops[0], ops[1], 'zero']]];
 case 'sgtz': n(2); return [['slt', [ops[0], 'zero', ops[1]]]];
 case 'beqz': case 'bnez': case 'bltz': case 'bgez':
 n(2); return [[{ beqz: 'beq', bnez: 'bne', bltz: 'blt', bgez: 'bge' }[mn], [ops[0], 'zero', ops[1]]]];
 case 'blez': case 'bgtz':
 n(2); return [[{ blez: 'bge', bgtz: 'blt' }[mn], ['zero', ops[0], ops[1]]]];
 case 'bgt': case 'ble': case 'bgtu': case 'bleu':
 n(3); return [[SWAP_BRANCH[mn], [ops[1], ops[0], ops[2]]]];
 case 'j': case 'tail': n(1); return [['jal', ['zero', ops[0]]]];
 case 'call': n(1); return [['jal', ['ra', ops[0]]]];
 case 'jr': n(1); return [['jalr', ['zero', `0(${ops[0]})`]]];
 case 'ret': n(0); return [['jalr', ['zero', '0(ra)']]];
 case 'halt': n(0); return [['jal', ['zero', '0']]];
 case 'csrr': n(2); return [['csrrs', [ops[0], ops[1], 'zero']]];
 case 'csrw': case 'csrs': case 'csrc': n(2); return [[`csrr${mn[3]}`, ['zero', ops[0], ops[1]]]];
 case 'csrwi': case 'csrsi': case 'csrci': n(2); return [[`csrr${mn[3]}i`, ['zero', ops[0], ops[1]]]];
 case 'la':
 n(2); return [['lui', [ops[0], `%hi(${ops[1]})`]], ['addi', [ops[0], ops[0], `%lo(${ops[1]})`]]];
 case 'li': {
 n(2);
 let value;
 try {
 value = evaluate(ops[1], symbols);
 } catch (e) {
 if (!(e instanceof Unresolved)) throw e;
 return [['lui', [ops[0], `%hi(${ops[1]})`]], ['addi', [ops[0], ops[0], `%lo(${ops[1]})`]]];
 }
 return liParts(value, ops[0]);
 }
 default:
 if (mn === 'jal' && ops.length === 1) return [['jal', ['ra', ops[0]]]];
 if (mn === 'jalr' && ops.length === 1) return [['jalr', ['ra', `0(${ops[0]})`]]];
 return [[mn, ops]];
 }
}
const LITERAL_OFFSET = /^(-?\d+|0[xX][0-9a-fA-F]+)$/;
function encode(mn, ops, here, symbols) {
 const ev = (e) => evaluate(e, symbols);
 const d = INSTRUCTIONS[mn];
 if (!d) throw new AsmError(`unknown mnemonic '${mn}'`, 'mnemonic', mn);
 const need = (k) => {
 if (ops.length !== k) throw new AsmError(`${mn} expects ${k} operands, got ${ops.length}`, 'operands', null, { usage: usage(mn), got: ops.length });
 };
 const target = (tok) => {
 const t = tok.trim();
 return LITERAL_OFFSET.test(t) ? parseNumber(t.replace(/^-/, '')) * (t[0] === '-' ? -1 : 1) : ev(t) - here;
 };
 const r = regNumber;
 switch (d.syntax) {
 case 'rd,rs1,rs2':
 need(3);
 return packR(d.op, d.f3, d.f7, r(ops[0]), r(ops[1]), r(ops[2]));
 case 'rd,rs1,imm': {
 need(3);
 const imm = ev(ops[2]);
 checkSigned(imm, 12, 'I-immediate', ops[2]);
 return packI(d.op, d.f3, r(ops[0]), r(ops[1]), imm);
 }
 case 'rd,rs1,shamt': {
 need(3);
 const sh = ev(ops[2]);
 if (!(sh >= 0 && sh <= 31)) throw new AsmError(`shift amount ${sh} outside 0..31`, 'shamt', ops[2], { lo: 0, hi: 31, value: sh });
 return packR(d.op, d.f3, d.f7, r(ops[0]), r(ops[1]), sh);
 }
 case 'rd,mem': {
 need(2);
 const [off, base] = memOperand(ops[1]);
 const imm = ev(off);
 checkSigned(imm, 12, 'I-immediate', off);
 return packI(d.op, d.f3, r(ops[0]), r(base), imm);
 }
 case 'rs2,mem': {
 need(2);
 const [off, base] = memOperand(ops[1]);
 const imm = ev(off);
 checkSigned(imm, 12, 'S-immediate', off);
 return packS(d.op, d.f3, r(base), r(ops[0]), imm);
 }
 case 'rs1,rs2,target': {
 need(3);
 const rs1 = r(ops[0]);
 const rs2 = r(ops[1]);
 const off = target(ops[2]);
 checkSigned(off, 13, 'branch offset', ops[2]);
 if (off % 2) throw new AsmError('branch offset must be even', 'align', ops[2]);
 return packB(d.op, d.f3, rs1, rs2, off);
 }
 case 'rd,imm20': {
 need(2);
 const rd = r(ops[0]);
 const v = ev(ops[1]);
 if (!(v >= 0 && v <= 0xfffff)) {
 throw new AsmError(`U-immediate ${v < 0 ? '-' : ''}0x${Math.abs(v).toString(16)} outside 0..0xFFFFF`, 'uimm', ops[1], { lo: 0, hi: 0xfffff, value: v });
 }
 return packU(d.op, rd, v);
 }
 case 'rd,target': {
 need(2);
 const rd = r(ops[0]);
 const off = target(ops[1]);
 checkSigned(off, 21, 'jump offset', ops[1]);
 if (off % 2) throw new AsmError('jump offset must be even', 'align', ops[1]);
 return packJ(d.op, rd, off);
 }
 case 'jalr': {
 let off;
 let base;
 if (ops.length === 2) [off, base] = memOperand(ops[1]);
 else if (ops.length === 3) [off, base] = [ops[2], ops[1]];
 else throw new AsmError('jalr expects rd, off(rs1) or rd, rs1, off', 'operands', null, { usage: usage('jalr'), got: ops.length });
 const imm = ev(off);
 checkSigned(imm, 12, 'I-immediate', off);
 return packI(d.op, 0, r(ops[0]), r(base), imm);
 }
 case 'fence': {
 if (ops.length !== 0 && ops.length !== 2) throw new AsmError('fence expects pred, succ', 'operands', null, { usage: usage('fence'), got: ops.length });
 const [pred, succ] = ops.length ? [fenceBits(ops[0]), fenceBits(ops[1])] : [15, 15];
 return ((pred << 24) | (succ << 20) | OPCODE.MISC_MEM) >>> 0;
 }
 case 'csr': case 'csri': {
 need(3);
 const name = ops[1].trim().toLowerCase();
 const num = name in CSR_NUMBERS ? CSR_NUMBERS[name] : ev(ops[1]);
 if (!(num >= 0 && num <= 0xfff)) throw new AsmError(`CSR number 0x${num.toString(16)} outside 0..0xfff`, 'csr', ops[1]);
 let src;
 if (d.syntax === 'csri') {
 src = ev(ops[2]);
 if (!(src >= 0 && src <= 31)) throw new AsmError(`CSR immediate ${src} outside 0..31`, 'uimm5', ops[2]);
 } else {
 src = r(ops[2]);
 }
 return ((num << 20) | (src << 15) | (d.f3 << 12) | (r(ops[0]) << 7) | d.op) >>> 0;
 }
 default:
 need(0);
 return ((d.f7 << 20) | (d.f3 << 12) | d.op) >>> 0;
 }
}
const WIDTH = { '.word': 4, '.half': 2, '.short': 2, '.byte': 1 };
function stringBytes(o) {
 const s = o.trim();
 if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') throw new AsmError(`bad string ${s}`, 'string', s);
 return unescape(s.slice(1, -1));
}
function dataSize(mn, ops, symbols) {
 if (mn in WIDTH) return WIDTH[mn] * ops.length;
 if (mn === '.ascii' || mn === '.asciz' || mn === '.string') {
 return ops.reduce((n, o) => n + stringBytes(o).length + (mn !== '.ascii' ? 1 : 0), 0);
 }
 if (mn === '.space' || mn === '.zero' || mn === '.skip') {
 const n = evaluate(ops[0] ?? '', symbols);
 if (!(n >= 0)) throw new AsmError(`${mn} size ${n} is negative`, 'range');
 return n;
 }
 throw new AsmError(`unknown directive ${mn}`, 'directive', mn);
}
function dataBytes(it, symbols) {
 const { mn, ops } = it;
 if (mn === '.pad') return new Array(it.size).fill(0);
 if (mn in WIDTH) {
 const width = WIDTH[mn];
 const out = [];
 for (const o of ops) {
 const v = evaluate(o, symbols);
 if (!(v >= -(2 ** (8 * width - 1)) && v < 2 ** (8 * width))) {
 throw new AsmError(`value ${v} does not fit ${mn}`, 'range', o, { lo: -(2 ** (8 * width - 1)), hi: 2 ** (8 * width) - 1, value: v });
 }
 for (let b = 0; b < width; b++) out.push(Math.floor(v / 2 ** (8 * b)) & 0xff);
 }
 return out;
 }
 if (mn === '.ascii' || mn === '.asciz' || mn === '.string') {
 const out = [];
 for (const o of ops) {
 out.push(...stringBytes(o));
 if (mn !== '.ascii') out.push(0);
 }
 return out;
 }
 return new Array(it.size).fill(0);
}
export function assemble(sources, options = {}) {
 const files = typeof sources === 'string' ? [{ name: '<input>', text: sources }] : sources;
 const profile = PROFILES[options.profile ?? 'iss'];
 const isa = (options.subset && profile.subsets?.[options.subset]) || profile.isa;
 const textBase = options.textBase ?? profile.textBase;
 const dataBase = options.dataBase ?? profile.dataBase;
 const symbols = new Map();
 const symbolInfo = [];
 const lc = { text: textBase, data: dataBase };
 const items = [];
 const errors = [];
 const errorLines = new Set();
 const report = (file, line, raw, e, stmt) => {
 const key = `${file}:${line}`;
 if (errorLines.has(key)) return;
 errorLines.add(key);
 let message;
 let hint = null;
 let token = null;
 let data = {};
 if (e instanceof Unresolved) {
 message = e.where === 'pass2' ? `undefined symbol ${e.symbol}` : `symbol ${e.symbol} must be defined before use here`;
 hint = e.where === 'pass2' ? 'undefined' : 'forward';
 token = e.symbol;
 data = { suggest: closest(e.symbol, [...symbols.keys()]) };
 } else if (e instanceof AsmError) {
 ({ message, hint, token, data } = e);
 } else {
 throw e;
 }
 const ops = stmt.operands ?? [];
 const op = token ? ops.find((o) => o.text === token) ?? ops.find((o) => o.text.includes(token)) : null;
 let at = token ? raw.indexOf(token, op ? op.col : stmt.col) : -1;
 if (token && at < 0) at = raw.indexOf(token);
 const code = stripComment(raw);
 const column = at >= 0 ? at : stmt.col;
 const length = at >= 0 ? token.length : Math.max(1, code.trimEnd().length - stmt.col);
 errors.push({ file, line, column: column + 1, length, message, hint, token, mnemonic: stmt.mnemonic ?? null,
 operands: ops.map((o) => o.text),
 data: data ?? {}, range: data && 'lo' in data ? { lo: data.lo, hi: data.hi } : null });
 };
 for (const { name: file, text } of files) {
 let section = 'text';
 const lines = text.split(/\r\n|\r|\n/);
 lines.forEach((raw, idx) => {
 const lineNo = idx + 1;
 let line = stripComment(raw);
 let col = 0;
 const stmt = { col: 0, mnemonic: null, operands: [] };
 try {
 for (;;) {
 const lead = line.length - line.trimStart().length;
 const m = /^([A-Za-z_.$][\w.$]*):\s*/.exec(line.slice(lead));
 if (!m) break;
 if (symbols.has(m[1])) {
 const first = symbolInfo.find((s) => s.name === m[1]);
 throw new AsmError(`duplicate symbol ${m[1]}`, 'duplicate', m[1], { first: first && first.file === file ? first.line : null });
 }
 symbols.set(m[1], lc[section]);
 symbolInfo.push({ name: m[1], section, address: lc[section], file, line: lineNo });
 line = line.slice(lead + m[0].length);
 col += lead + m[0].length;
 }
 const lead = line.length - line.trimStart().length;
 line = line.trim();
 col += lead;
 if (!line) return;
 const head = /^(\S+)\s*/.exec(line);
 const mn = head[1].toLowerCase();
 const operands = splitOperands(line.slice(head[0].length), col + head[0].length);
 const ops = operands.map((o) => o.text);
 Object.assign(stmt, { col, mnemonic: mn, operands });
 const base = { file, line: lineNo, column: col + 1, text: raw, operands };
 if (mn.startsWith('.')) {
 if (IGNORED.has(mn)) return;
 if (mn === '.text') { section = 'text'; return; }
 if (DATA_SECTIONS.has(mn)) { section = 'data'; return; }
 if (mn === '.section') { section = (ops[0] ?? '').startsWith('.text') ? 'text' : 'data'; return; }
 if (mn === '.equ' || mn === '.set') {
 if (ops.length !== 2) throw new AsmError(`${mn} expects a name and a value`, 'operands');
 symbols.set(ops[0], evaluate(ops[1], symbols));
 symbolInfo.push({ name: ops[0], section: 'abs', address: symbols.get(ops[0]), file, line: lineNo });
 return;
 }
 if (mn === '.align' || mn === '.p2align' || mn === '.balign') {
 const k = evaluate(ops[0] ?? '', symbols);
 const align = mn === '.balign' ? k : 2 ** k;
 if (!(align >= 1)) throw new AsmError(`bad alignment ${k}`, 'align');
 const pad = (((-lc[section]) % align) + align) % align;
 if (pad) {
 if (section === 'text' && pad % 4) {
 throw new AsmError('text alignment must keep 4-byte instructions aligned', 'align');
 }
 items.push({ ...base, section, addr: lc[section], kind: 'data', mn: '.pad', ops: [], size: pad });
 lc[section] += pad;
 }
 return;
 }
 if (!DATA_DIRECTIVES.has(mn)) {
 throw new AsmError(`unknown directive ${mn}`, 'directive', head[1], { suggest: closest(mn, [...DATA_DIRECTIVES, ...DATA_SECTIONS, '.text', '.align', '.balign', '.equ', '.set', '.globl']) });
 }
 const size = dataSize(mn, ops, symbols);
 items.push({ ...base, section, addr: lc[section], kind: 'data', mn, ops, size });
 lc[section] += size;
 return;
 }
 if (section !== 'text') throw new AsmError('instruction outside .text', 'section', head[1]);
 if (!(mn in INSTRUCTIONS) && !PSEUDOS.includes(mn)) {
 const nextWord = /^([A-Za-z.][\w.]*)/.exec(line.slice(head[0].length))?.[1]?.toLowerCase();
 const missingColon = Boolean(nextWord && (nextWord in INSTRUCTIONS || PSEUDOS.includes(nextWord)
 || DATA_DIRECTIVES.has(nextWord) || DATA_SECTIONS.has(nextWord)));
 const lastNumeric = /^[-+]?(\d|0x)|^%lo|'/i.test(ops[ops.length - 1] ?? '');
 const fit = (c) => {
 const u = usage(c) ?? '';
 const n = u.includes(' ') ? u.split(',').length : 0;
 return (n === ops.length ? 0 : 2) + (lastNumeric === /imm|shamt|value|uimm/.test(u) ? 0 : 1);
 };
 const suggest = missingColon ? [] : FOREIGN[mn] ? [FOREIGN[mn]] : closest(mn, MNEMONICS(), fit);
 throw new AsmError(`unknown mnemonic '${mn}'`, 'mnemonic', head[1], { suggest, missingColon });
 }
 const expanded = expand(mn, ops, symbols);
 expanded.forEach(([emn, eops], k) => {
 items.push({ ...base, section, addr: lc[section], kind: 'insn', source: mn,
 mn: emn, ops: eops, size: 4, part: k, parts: expanded.length });
 lc[section] += 4;
 });
 } catch (e) {
 if (e instanceof Unresolved) e.where = 'pass1';
 if (stmt.mnemonic === null) stmt.col = col;
 report(file, lineNo, raw, e, stmt);
 }
 });
 }
 const text = [];
 const data = [];
 const listing = [];
 const dataListing = [];
 const profileErrors = [];
 for (const it of items) {
 if (errorLines.has(`${it.file}:${it.line}`)) {
 if (it.kind === 'insn') text.push(0, 0, 0, 0);
 else (it.section === 'text' ? text : data).push(...new Array(it.size).fill(0));
 continue;
 }
 try {
 if (it.kind === 'insn') {
 const word = encode(it.mn, it.ops, it.addr, symbols);
 text.push(word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, word >>> 24);
 listing.push({ address: it.addr, word, mnemonic: it.mn, source: it.source, file: it.file,
 line: it.line, text: it.text, part: it.part, parts: it.parts, operands: it.operands });
 if (!isa.has(it.mn)) {
 profileErrors.push({ file: it.file, line: it.line, column: it.column, mnemonic: it.mn,
 profile: profile.id, chapter: profile.chapter });
 }
 } else {
 const bytes = dataBytes(it, symbols);
 (it.section === 'text' ? text : data).push(...bytes);
 dataListing.push({ address: it.addr, section: it.section, bytes, directive: it.mn,
 file: it.file, line: it.line, text: it.text });
 }
 } catch (e) {
 if (e instanceof Unresolved) e.where = 'pass2';
 report(it.file, it.line, it.text, e, { col: it.column - 1, mnemonic: it.source ?? it.mn, operands: it.operands });
 if (it.kind === 'insn') text.push(0, 0, 0, 0);
 }
 }
 if (profile.words) {
 const size = 4 * profile.words;
 const textLimit = profile.memory === 'unified' && data.length ? dataBase : size;
 const where = profile.memory === 'unified' ? 'memory' : 'instruction memory';
 const over = (it, limit, what) => {
 errors.push({ file: it.file, line: it.line, column: 1, length: 0, hint: null, token: null, mnemonic: null, operands: [], data: {}, range: null,
 message: `the program does not fit: ${what} (up to 0x${(limit - 1).toString(16)}); this line is the first outside, at 0x${Math.max(it.addr, limit).toString(16)}` });
 };
 const t = items.find((it) => it.section === 'text' && it.addr + it.size > textLimit);
 if (t) {
 over(t, textLimit, textLimit < size
 ? `the code runs into the data at 0x${dataBase.toString(16)} of the ${profile.processor}'s ${where}`
 : `the ${profile.processor}'s ${where} holds ${profile.words} words`);
 }
 const d = items.find((it) => it.section === 'data' && it.addr + it.size > size);
 if (d) over(d, size, `the ${profile.processor}'s data memory holds ${profile.words} words`);
 }
 const lineOf = new Map(listing.filter((l) => l.part === 0 || l.parts === 1).map((l) => [l.address, l.text.trim()]));
 for (const l of listing) if (!lineOf.has(l.address)) lineOf.set(l.address, l.text.trim());
 const entry = symbols.get('_start') ?? symbols.get('main') ?? textBase;
 errors.sort((a, b) => files.findIndex((f) => f.name === a.file) - files.findIndex((f) => f.name === b.file)
 || a.line - b.line);
 return {
 ok: errors.length === 0,
 errors,
 profileErrors,
 profile: profile.id,
 segments: [
 { address: textBase, bytes: Uint8Array.from(text), executable: true },
 ...(data.length ? [{ address: dataBase, bytes: Uint8Array.from(data), executable: false }] : []),
 ],
 entry: entry >>> 0,
 symbols,
 symbolTable: symbolInfo,
 listing,
 dataListing,
 lines: lineOf,
 };
}
export function textWords(program) {
 const b = program.segments[0].bytes;
 const out = [];
 for (let i = 0; i + 3 < b.length; i += 4) out.push((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0);
 return out;
}
export function hexImage(program, depth = 0) {
 const words = textWords(program);
 while (words.length < depth) words.push(0);
 return words.map((w) => `${w.toString(16).padStart(8, '0')}\n`).join('');
}
