// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { CError, tokenize } from './lexer.js';
import { Parser } from './parser.js';
function stripComments(src) {
 let out = '';
 let i = 0;
 while (i < src.length) {
 const c = src[i];
 if (c === '"' || c === "'") {
 let j = i + 1;
 while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
 out += src.slice(i, j + 1);
 i = j + 1;
 } else if (src.startsWith('//', i)) {
 while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
 } else if (src.startsWith('/*', i)) {
 const end = src.indexOf('*/', i + 2);
 if (end < 0) {
 const line = src.slice(0, i).split('\n').length;
 throw new CError('comment opened with /* is never closed with */', { line, col: i - src.lastIndexOf('\n', i - 1) });
 }
 for (let j = i; j < end + 2; j++) out += src[j] === '\n' ? '\n' : ' ';
 i = end + 2;
 } else { out += c; i++; }
 }
 return out;
}
function evalIf(e) {
 const v = (x) => evalIf(x);
 switch (e.kind) {
 case 'num': return BigInt(e.value);
 case 'id': return 0n;
 case 'unary':
 switch (e.op) {
 case '-': return -v(e.e);
 case '+': return v(e.e);
 case '!': return v(e.e) ? 0n : 1n;
 case '~': return ~v(e.e);
 default: break;
 }
 break;
 case 'binary': {
 if (e.op === '&&') return v(e.l) && v(e.r) ? 1n : 0n;
 if (e.op === '||') return v(e.l) || v(e.r) ? 1n : 0n;
 const a = v(e.l);
 const b = v(e.r);
 switch (e.op) {
 case '+': return a + b;
 case '-': return a - b;
 case '*': return a * b;
 case '/': case '%':
 if (b === 0n) throw new CError('division by zero in #if', e.loc);
 return e.op === '/' ? a / b : a % b;
 case '<<': return a << b;
 case '>>': return a >> b;
 case '<': return a < b ? 1n : 0n;
 case '>': return a > b ? 1n : 0n;
 case '<=': return a <= b ? 1n : 0n;
 case '>=': return a >= b ? 1n : 0n;
 case '==': return a === b ? 1n : 0n;
 case '!=': return a !== b ? 1n : 0n;
 case '&': return a & b;
 case '^': return a ^ b;
 case '|': return a | b;
 default: break;
 }
 break;
 }
 case 'cond': return v(e.c) ? v(e.a) : v(e.b);
 default: break;
 }
 throw new CError('#if needs an integer constant expression', e.loc);
}
export function preprocess(source, { defines = {} } = {}) {
 const macros = new Map();
 for (const [name, value] of Object.entries(defines)) macros.set(name, tokenize(String(value ?? '1'), 0));
 const includes = new Set();
 const tokens = [];
 const conds = [];
 const active = () => conds.every((c) => c.active);
 const expand = (list, hidden = new Set(), at = null) => {
 const out = [];
 for (const t of list) {
 if (t.k === 'id' && macros.has(t.v) && !hidden.has(t.v)) {
 const where = at ?? { line: t.line, col: t.col };
 out.push(...expand(macros.get(t.v), new Set([...hidden, t.v]), where));
 } else out.push(at ? { ...t, line: at.line, col: at.col } : t);
 }
 return out;
 };
 const lines = stripComments(source).split('\n');
 for (let n = 0; n < lines.length; n++) {
 let text = lines[n];
 const lineNo = n + 1;
 while (text.endsWith('\\') && n + 1 < lines.length) { text = text.slice(0, -1) + lines[++n]; }
 const dm = /^\s*#\s*(\w*)\s*(.*)$/.exec(text);
 if (!dm) {
 if (active()) tokens.push(...expand(tokenize(text, lineNo)));
 continue;
 }
 const [, name, rest] = dm;
 const loc = { line: lineNo, col: text.indexOf('#') + 1 };
 const condition = () => {
 const raw = tokenize(rest, lineNo);
 const pre = [];
 for (let i = 0; i < raw.length; i++) {
 if (raw[i].k === 'id' && raw[i].v === 'defined') {
 const paren = raw[i + 1]?.v === '(';
 const id = raw[i + (paren ? 2 : 1)];
 if (id?.k !== 'id' && id?.k !== 'kw') throw new CError('defined needs a name', loc);
 pre.push({ k: 'num', v: macros.has(id.v) ? 1 : 0, unsigned: false, line: id.line, col: id.col });
 i += paren ? 3 : 1;
 } else pre.push(raw[i]);
 }
 const list = expand(pre);
 if (!list.length) throw new CError(`#${name} needs an expression`, loc);
 const p = new Parser(list, { preprocessor: true });
 const e = p.conditional();
 p.expectEnd(`#${name}`);
 return evalIf(e) !== 0n;
 };
 switch (name) {
 case 'if': case 'ifdef': case 'ifndef': {
 const outer = active();
 let on = false;
 if (outer) {
 if (name === 'if') on = condition();
 else {
 const id = /^(\w+)\s*$/.exec(rest);
 if (!id) throw new CError(`#${name} needs one name`, loc);
 on = macros.has(id[1]) === (name === 'ifdef');
 }
 }
 conds.push({ active: on, taken: on, sawElse: false, loc, outer });
 break;
 }
 case 'elif': {
 const c = conds[conds.length - 1];
 if (!c || c.sawElse) throw new CError('#elif without a matching #if', loc);
 c.active = c.outer && !c.taken && condition();
 c.taken = c.taken || c.active;
 break;
 }
 case 'else': {
 const c = conds[conds.length - 1];
 if (!c || c.sawElse) throw new CError('#else without a matching #if', loc);
 c.sawElse = true;
 c.active = c.outer && !c.taken;
 c.taken = true;
 break;
 }
 case 'endif':
 if (!conds.length) throw new CError('#endif without a matching #if', loc);
 conds.pop();
 break;
 default:
 if (!active()) break;
 if (name === 'include') {
 const inc = /^<\s*([\w./]+)\s*>\s*$|^"([\w./]+)"\s*$/.exec(rest);
 const file = inc && (inc[1] ?? inc[2]);
 if (file !== 'stdint.h') {
 throw new CError(`#include ${rest.trim()}: the simulator's C subset has only #include <stdint.h>; putchar and exit are built in`, loc, { subset: true });
 }
 includes.add(file);
 } else if (name === 'define') {
 const d = /^([A-Za-z_]\w*)(\(?)(.*)$/.exec(rest);
 if (!d) throw new CError('#define needs a name', loc);
 if (d[2]) throw new CError(`#define ${d[1]}(…): macros with parameters are not in the simulator's C subset`, loc, { subset: true });
 macros.set(d[1], tokenize(d[3], lineNo));
 } else if (name === 'undef') {
 macros.delete(rest.trim());
 } else if (name === 'error') {
 throw new CError(`#error ${rest.trim()}`, loc);
 } else if (name === '') {
 } else {
 throw new CError(`#${name} is not in the simulator's C subset (only #include <stdint.h>, #define, #undef, #if, #ifdef, #ifndef, #elif, #else, #endif, #error)`, loc, { subset: true });
 }
 }
 }
 if (conds.length) throw new CError('#if without a matching #endif', conds[conds.length - 1].loc);
 return { tokens, includes };
}
