// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const KEYWORDS = new Set(['program', 'nop', 'jmp', 'wait', 'in', 'out', 'push', 'pull', 'mov', 'irq', 'set', 'side', 'pin', 'gpio', 'osre', 'pins', 'null',
 'pindirs', 'block', 'noblock', 'ifempty', 'iffull', 'nowait', 'clear', 'rel', 'x', 'y', 'exec', 'pc', 'isr', 'osr', 'status', 'public', 'prev',
 'next', 'jmppin', 'rxfifo', 'txfifo', 'left', 'right', 'auto', 'manual', 'txrx', 'tx', 'rx', 'txput', 'txget', 'putget', 'rp2040', 'rp2350', 'opt']);
class AsmError extends Error { constructor(line, col, message) { super(message); this.line = line; this.col = col; } }
function lex(text) {
 const lines = text.replace(/\r\n?/g, '\n').split('\n');
 const out = [];
 let inComment = false, code = null;
 for (let ln = 0; ln < lines.length; ln++) {
 const src = lines[ln];
 if (code) {
 const end = src.indexOf('%}');
 if (end >= 0) { code.text.push(src.slice(0, end)); out.push({ line: code.line, code: { lang: code.lang, text: code.text.join('\n') } }); code = null; }
 else code.text.push(src);
 continue;
 }
 const start = /^\s*%\s*([\w-]*)\s*\{\s*$/.exec(src);
 if (start && !inComment) { code = { line: ln + 1, lang: start[1] || 'c-sdk', text: [] }; continue; }
 const toks = [];
 let i = 0;
 while (i < src.length) {
 if (inComment) { const e = src.indexOf('*/', i); if (e < 0) { i = src.length; break; } inComment = false; i = e + 2; continue; }
 const ch = src[i];
 if (ch === ' ' || ch === '\t') { i++; continue; }
 if (ch === ';' || (ch === '/' && src[i + 1] === '/')) break;
 if (ch === '/' && src[i + 1] === '*') { inComment = true; i += 2; continue; }
 const col = i + 1;
 const two = src.slice(i, i + 2);
 if (['<<', '>>', '::', '--', '!=', '++'].includes(two)) { toks.push({ t: two, col }); i += 2; continue; }
 if ('[](),:+-*/!~&|^<=.'.includes(ch) && !(ch === '.' && /[A-Za-z_]/.test(src[i + 1] ?? ''))) {
 if (ch === '.' && /\d/.test(src[i + 1] ?? '')) { } else { toks.push({ t: ch, col }); i++; continue; }
 }
 let m;
 if ((m = /^\.[A-Za-z_][\w]*/.exec(src.slice(i)))) { toks.push({ t: 'dir', v: m[0].toLowerCase(), col }); i += m[0].length; continue; }
 if ((m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+\.\d*|\.\d+|\d+)/.exec(src.slice(i)))) {
 const s = m[0];
 const v = /^0[xX]/.test(s) ? parseInt(s.slice(2), 16) : /^0[bB]/.test(s) ? parseInt(s.slice(2), 2) : s.includes('.') ? parseFloat(s) : parseInt(s, 10);
 toks.push({ t: s.includes('.') && !/^0[xXbB]/.test(s) ? 'float' : 'int', v, col }); i += s.length; continue;
 }
 if ((m = /^[A-Za-z_][\w]*/.exec(src.slice(i)))) {
 const w = m[0], lw = w.toLowerCase();
 toks.push(KEYWORDS.has(lw) ? { t: 'kw', v: lw, col, raw: w } : { t: 'id', v: w, col }); i += w.length; continue;
 }
 if (ch === '"') { const e = src.indexOf('"', i + 1); const s = e < 0 ? src.slice(i + 1) : src.slice(i + 1, e); toks.push({ t: 'str', v: s, col }); i = e < 0 ? src.length : e + 1; continue; }
 throw new AsmError(ln + 1, col, `unexpected character '${ch}'`);
 }
 if (toks.length) out.push({ line: ln + 1, tokens: toks });
 }
 if (code) throw new AsmError(code.line, 1, 'a code block (%{ … %}) is not closed');
 return out;
}
const BIN = { '|': 5, '&': 5, '^': 5, '*': 4, '/': 4, '+': 3, '-': 3, '<<': 2, '>>': 2 };
const rev32 = (v) => { let r = 0; for (let i = 0; i < 32; i++) r = (r << 1) | ((v >>> i) & 1); return r >>> 0; };
class Cursor {
 constructor(line, toks) { this.line = line; this.toks = toks; this.i = 0; }
 peek(k = 0) { return this.toks[this.i + k]; }
 next() { return this.toks[this.i++]; }
 done() { return this.i >= this.toks.length; }
 err(msg, tok = this.peek()) { return new AsmError(this.line, tok ? tok.col : (this.toks.at(-1)?.col ?? 1), msg); }
 isKw(v, k = 0) { const t = this.peek(k); return t && t.t === 'kw' && t.v === v; }
 take(t, v) { const x = this.peek(); if (x && x.t === t && (v === undefined || x.v === v)) { this.i++; return x; } return null; }
 kw(v) { return this.take('kw', v); }
 comma() { this.take(','); }
 expect(t, v, what) { const x = this.take(t, v); if (!x) throw this.err(`expected ${what ?? v ?? t}`); return x; }
}
function parseValue(c) {
 const t = c.peek();
 if (!t) throw c.err('expected a value');
 if (t.t === 'int') { c.next(); return () => t.v; }
 if (t.t === 'id' || (t.t === 'kw' && !['x', 'y', 'pins', 'pindirs', 'side', 'rel'].includes(t.v))) {
 c.next();
 const name = t.t === 'id' ? t.v : t.raw;
 return (p) => { const v = p.lookup(name); if (v === undefined) throw new AsmError(c.line, t.col, `unknown symbol '${name}'`); return v; };
 }
 if (t.t === '(') { c.next(); const e = parseExpr(c, 0); c.expect(')', undefined, "')'"); return e; }
 throw c.err('expected a value');
}
function parseUnary(c) {
 if (c.take('-')) { const e = parseUnary(c); return (p) => -e(p); }
 if (c.take('::')) { const e = parseUnary(c); return (p) => rev32(e(p)) | 0; }
 return parseValue(c);
}
function parseExpr(c, minPrec) {
 let left = parseUnary(c);
 for (;;) {
 const t = c.peek();
 const prec = t ? BIN[t.t] : undefined;
 if (prec === undefined || prec <= minPrec) return left;
 c.next();
 const right = parseExpr(c, prec);
 const l = left, op = t.t;
 left = (p) => {
 const a = l(p), b = right(p);
 switch (op) {
 case '+': return a + b; case '-': return a - b; case '*': return a * b;
 case '/': if (b === 0) throw new AsmError(c.line, t.col, 'division by zero'); return Math.trunc(a / b);
 case '&': return a & b; case '|': return a | b; case '^': return a ^ b; case '<<': return a << b; default: return a >> b;
 }
 };
 }
}
class Program {
 constructor(name, line, version, globals) {
 this.name = name; this.line = line; this.version = version; this.globals = globals;
 this.instr = [];
 this.labels = new Map(); this.defines = new Map(); this.publics = [];
 this.origin = -1; this.side = null; this.wrapTarget = null; this.wrap = null; this.langOpts = []; this.code = [];
 this.clockDiv = null; this.fifo = 'txrx'; this.movStatus = null; this.in = null; this.out = null; this.set = null;
 this.versionSet = false; this.v1 = [];
 }
 lookup(name) {
 if (this.labels.has(name)) return this.labels.get(name);
 if (this.defines.has(name)) return this.defines.get(name)(this);
 if (this.globals.has(name)) return this.globals.get(name)(this);
 return undefined;
 }
}
export function assemblePio(text, { defaultVersion = 0 } = {}) {
 const diagnostics = [];
 const globals = new Map(), globalPublics = [];
 const programs = [];
 let cur = null, version = defaultVersion;
 let lines;
 try { lines = lex(text); } catch (e) { return { ok: false, programs: [], globals: [], diagnostics: [{ severity: 'error', line: e.line ?? 1, column: e.col ?? 1, message: e.message }] }; }
 const need = (c, what) => { if (!cur) throw c.err(`${what} outside a program (start one with .program <name>)`); return cur; };
 const needV1 = (c, tok, feature) => { const v = cur ? cur.version : version; if (v < 1) throw c.err(`PIO version 1 (RP2350) is needed for '${feature}': add .pio_version 1`, tok); };
 for (const L of lines) {
 try {
 if (L.code) { (cur ? cur.code : []).push(L.code); if (!cur) diagnostics.push({ severity: 'warning', line: L.line, column: 1, message: 'a code block outside a program is ignored' }); continue; }
 const c = new Cursor(L.line, L.tokens);
 let pub = false;
 if ((c.isKw('public') && c.peek(1)?.t === 'id' && c.peek(2)?.t === ':') || (c.peek()?.t === '*' && c.peek(1)?.t === 'id' && c.peek(2)?.t === ':')) { c.next(); pub = true; }
 if ((c.peek()?.t === 'id' || c.peek()?.t === 'kw') && c.peek(1)?.t === ':' && c.peek(2)?.t !== ':') {
 const t = c.next(); c.next();
 const p = need(c, 'a label'), name = t.t === 'id' ? t.v : t.raw;
 if (p.labels.has(name) || p.defines.has(name)) throw c.err(`'${name}' is already defined`, t);
 p.labels.set(name, p.instr.length);
 if (pub) p.publics.push({ name, label: true });
 if (c.done()) continue;
 } else if (pub) throw c.err('expected a label after PUBLIC');
 const t = c.peek();
 if (t.t === 'dir') { c.next(); directive(c, t); }
 else if (t.t === 'kw' || t.t === 'id') instruction(c);
 else throw c.err('expected an instruction, a label or a directive');
 if (!c.done()) throw c.err(`unexpected '${c.peek().v ?? c.peek().t}'`);
 } catch (e) {
 if (!(e instanceof AsmError)) throw e;
 diagnostics.push({ severity: 'error', line: e.line, column: e.col, message: e.message });
 }
 }
 function directive(c, t) {
 const d = t.v;
 switch (d) {
 case '.program': {
 const n = c.next();
 if (!n || (n.t !== 'id' && n.t !== 'kw')) throw c.err('expected a program name');
 const name = n.t === 'id' ? n.v : n.raw;
 if (programs.some((p) => p.name === name)) throw c.err(`program '${name}' already exists`, n);
 cur = new Program(name, c.line, version, globals);
 programs.push(cur);
 return;
 }
 case '.define': {
 let pub = false;
 if (c.kw('public') || c.take('*')) pub = true;
 const n = c.next();
 if (!n || (n.t !== 'id' && n.t !== 'kw')) throw c.err('expected a symbol name');
 const name = n.t === 'id' ? n.v : n.raw, e = parseExpr(c, 0);
 if (cur) { if (cur.defines.has(name) || cur.labels.has(name)) throw c.err(`'${name}' is already defined`, n); cur.defines.set(name, e); if (pub) cur.publics.push({ name, label: false }); }
 else { globals.set(name, e); if (pub) globalPublics.push(name); }
 return;
 }
 case '.pio_version': {
 const v = c.next();
 let n;
 if (v?.t === 'int') n = v.v; else if (v?.t === 'kw' && v.v === 'rp2040') n = 0; else if (v?.t === 'kw' && v.v === 'rp2350') n = 1;
 if (n !== 0 && n !== 1) throw c.err('only PIO versions 0 (RP2040) and 1 (RP2350) exist', v);
 if (cur) { if (cur.instr.length) throw c.err('.pio_version must come before the first instruction'); cur.version = n; cur.versionSet = true; } else version = n;
 return;
 }
 default: break;
 }
 const p = need(c, `the directive ${d}`);
 const before = () => { if (p.instr.length) throw c.err(`${d} must come before the first instruction`, t); };
 switch (d) {
 case '.origin': p.origin = parseValue(c)(p); if (p.origin < 0 || p.origin > 31) throw c.err('the origin must be 0-31'); return;
 case '.side_set': {
 before();
 const n = parseValue(c)(p);
 let opt = false, pindirs = false;
 for (;;) { if (c.kw('opt')) opt = true; else if (c.kw('pindirs')) pindirs = true; else break; }
 if (n < 0 || n + (opt ? 1 : 0) > 5) throw c.err('side-set needs at most 5 bits, the opt bit included');
 p.side = { bits: n, opt, pindirs };
 return;
 }
 case '.wrap_target': if (p.wrapTarget !== null) throw c.err('.wrap_target appears twice in this program', t); p.wrapTarget = p.instr.length; return;
 case '.wrap': if (p.wrap !== null) throw c.err('.wrap appears twice in this program', t); if (!p.instr.length) throw c.err('.wrap must follow an instruction', t); p.wrap = p.instr.length - 1; return;
 case '.word': { const e = parseValue(c); const line = c.line, col = t.col; p.instr.push({ line, col, build: (q) => { const v = e(q); if (v < 0 || v > 0xffff) throw new AsmError(line, col, '.word needs a 16-bit value'); return v; } }); return; }
 case '.lang_opt': {
 const lang = c.next(), name = c.next();
 if (!lang || !name) throw c.err('expected .lang_opt <language> <name> = <value>');
 c.expect('=', undefined, "'='");
 const v = c.next();
 if (!v) throw c.err('expected a value');
 p.langOpts.push({ lang: lang.v ?? lang.raw, name: name.raw ?? name.v, value: String(v.v ?? v.t) });
 while (!c.done()) c.next();
 return;
 }
 case '.clock_div': {
 const v = c.next();
 if (!v || (v.t !== 'int' && v.t !== 'float')) throw c.err('.clock_div needs a number (no expressions)');
 if (v.v < 1 || v.v > 65536) throw c.err('the clock divider must be 1-65536');
 p.clockDiv = v.v;
 return;
 }
 case '.fifo': {
 before();
 const v = c.next();
 const ok = ['txrx', 'tx', 'rx', 'txput', 'txget', 'putget'];
 if (!v || v.t !== 'kw' || !ok.includes(v.v)) throw c.err('expected txrx, tx, rx, txput, txget or putget');
 if (['txput', 'txget', 'putget'].includes(v.v)) needV1(c, v, v.v);
 p.fifo = v.v;
 return;
 }
 case '.mov_status': {
 before();
 if (c.kw('txfifo') || c.isKw('rxfifo')) {
 const rx = c.kw('rxfifo') ? 1 : 0;
 c.expect('<', undefined, "'<'");
 p.movStatus = { type: rx, n: parseValue(c)(p) };
 } else if (c.kw('irq')) {
 needV1(c, t, '.mov_status irq');
 const rel = c.kw('next') ? 2 : c.kw('prev') ? 1 : 0;
 c.expect('kw', 'set', "'set'");
 p.movStatus = { type: 2, n: parseValue(c)(p), param: rel };
 } else throw c.err("expected 'txfifo < N', 'rxfifo < N' or 'irq set N'");
 return;
 }
 case '.in': case '.out': {
 before();
 const n = parseValue(c)(p);
 let right = true, auto = false, threshold = 32;
 if (c.kw('left')) right = false; else c.kw('right');
 if (c.kw('auto')) auto = true; else c.kw('manual');
 if (!c.done()) threshold = parseValue(c)(p);
 const max = d === '.in' ? 32 : 32;
 if (n < 0 || n > max) throw c.err(`the ${d.slice(1)} pin count must be 0-32`);
 if (d === '.in' && n !== 32) needV1(c, t, '.in with fewer than 32 pins');
 if (threshold < 1 || threshold > 32) throw c.err('the threshold must be 1-32');
 p[d.slice(1)] = { count: n, right, auto, threshold };
 return;
 }
 case '.set': { before(); const n = parseValue(c)(p); if (n < 0 || n > 5) throw c.err('the set pin count must be 0-5'); p.set = n; return; }
 default: throw c.err(`unknown directive ${d}`, t);
 }
 }
 function instruction(c) {
 const p = need(c, 'an instruction');
 const t = c.next();
 const line = c.line, col = t.col;
 const m = t.t === 'kw' ? t.v : t.v.toLowerCase();
 let enc;
 const v1 = (tok, f) => needV1(c, tok, f);
 switch (m) {
 case 'nop': enc = () => 0xa042; break;
 case 'jmp': {
 let cond = 0;
 if (c.take('!')) { if (c.kw('x')) cond = 1; else if (c.kw('y')) cond = 3; else if (c.kw('osre')) cond = 7; else throw c.err('expected !x, !y or !osre'); }
 else if (c.isKw('x') && c.peek(1)?.t === '--') { c.next(); c.next(); cond = 2; }
 else if (c.isKw('y') && c.peek(1)?.t === '--') { c.next(); c.next(); cond = 4; }
 else if (c.isKw('x') && c.peek(1)?.t === '!=') { c.next(); c.next(); c.expect('kw', 'y', "'y'"); cond = 5; }
 else if (c.kw('pin')) cond = 6;
 c.comma();
 const e = parseExpr(c, 0);
 enc = (q) => { const a = e(q); if (a < 0 || a > 31) throw new AsmError(line, col, `jump target ${a} is outside 0-31`); return (cond << 5) | a; };
 break;
 }
 case 'wait': {
 let pol = () => 1;
 if (!(c.peek()?.t === 'kw' && ['irq', 'gpio', 'pin', 'jmppin'].includes(c.peek().v))) pol = parseValue(c);
 const s = c.next();
 if (!s || s.t !== 'kw') throw c.err('expected irq, gpio, pin or jmppin');
 let src, idx;
 if (s.v === 'irq') {
 let mode = 0;
 if (c.kw('prev')) { v1(s, 'irq prev'); mode = 1; } else if (c.kw('next')) { v1(s, 'irq next'); mode = 3; }
 c.comma();
 const e = parseValue(c);
 if (c.kw('rel')) { if (mode) throw c.err("'rel' cannot be used with prev or next"); mode = 2; }
 src = 2; idx = (q) => { const k = e(q); if (k < 0 || k > 7) throw new AsmError(line, col, 'an IRQ number must be 0-7'); return (mode << 3) | k; };
 } else if (s.v === 'gpio') { c.comma(); const e = parseValue(c); src = 0; idx = (q) => { const k = e(q); if (k < 0 || k > (q.version ? 47 : 31)) throw new AsmError(line, col, 'the GPIO number is out of range'); if (k > 31) throw new AsmError(line, col, 'GPIO numbers above 31 (RP2350B) are not supported by this assembler'); return k; }; }
 else if (s.v === 'pin') { c.comma(); const e = parseValue(c); src = 1; idx = (q) => { const k = e(q); if (k < 0 || k > 31) throw new AsmError(line, col, 'the pin number must be 0-31'); return k; }; }
 else if (s.v === 'jmppin') { v1(s, 'wait jmppin'); src = 3; let e = () => 0; if (c.take('+')) e = parseValue(c); idx = (q) => { const k = e(q); if (k < 0 || k > 3) throw new AsmError(line, col, 'the jmppin offset must be 0-3'); return k; }; }
 else throw c.err('expected irq, gpio, pin or jmppin', s);
 enc = (q) => { const pv = pol(q); if (pv !== 0 && pv !== 1) throw new AsmError(line, col, "'wait' polarity must be 0 or 1"); return 0x2000 | (pv << 7) | (src << 5) | idx(q); };
 break;
 }
 case 'in': case 'out': {
 const s = c.next();
 const SRC = { pins: 0, x: 1, y: 2, null: 3, isr: 6, osr: 7 }, DST = { pins: 0, x: 1, y: 2, null: 3, pindirs: 4, pc: 5, isr: 6, exec: 7 };
 const tab = m === 'in' ? SRC : DST;
 if (!s || s.t !== 'kw' || tab[s.v] === undefined) throw c.err(m === 'in' ? 'expected pins, x, y, null, isr or osr' : 'expected pins, x, y, null, pindirs, pc, isr or exec', s);
 c.comma();
 const e = parseValue(c);
 enc = (q) => { const n = e(q); if (n < 1 || n > 32) throw new AsmError(line, col, 'the bit count must be 1-32'); return (m === 'in' ? 0x4000 : 0x6000) | (tab[s.v] << 5) | (n & 31); };
 break;
 }
 case 'push': case 'pull': {
 let iff = false, blk = true;
 if (c.kw(m === 'push' ? 'iffull' : 'ifempty')) iff = true;
 if (c.kw('noblock')) blk = false; else c.kw('block');
 enc = () => 0x8000 | (m === 'pull' ? 0x80 : 0) | (iff ? 0x40 : 0) | (blk ? 0x20 : 0);
 break;
 }
 case 'mov': {
 const DST = { pins: 0, x: 1, y: 2, pindirs: 3, exec: 4, pc: 5, isr: 6, osr: 7 }, SRC = { pins: 0, x: 1, y: 2, null: 3, status: 5, isr: 6, osr: 7 };
 const fifoIdx = () => {
 c.expect('[', undefined, "'['");
 let r;
 if (c.kw('y')) r = () => [0, 0]; else { const e = parseValue(c); r = (q) => { const k = e(q); if (k < 0 || k > 3) throw new AsmError(line, col, 'an RX FIFO index must be 0-3'); return [1, k]; }; }
 c.expect(']', undefined, "']'");
 return r;
 };
 const d = c.next();
 if (d?.t === 'kw' && d.v === 'rxfifo') {
 v1(d, 'mov rxfifo[]'); const ix = fifoIdx(); c.comma(); c.expect('kw', 'isr', "'isr'");
 enc = (q) => { const [ii, k] = ix(q); return 0x8010 | (ii << 3) | k; };
 break;
 }
 if (!d || d.t !== 'kw' || DST[d.v] === undefined) throw c.err('expected pins, x, y, pindirs, exec, pc, isr, osr or rxfifo[]', d);
 if (d.v === 'pindirs') v1(d, 'mov pindirs');
 c.comma();
 let op = 0;
 if (c.take('!') || c.take('~')) op = 1; else if (c.take('::')) op = 2;
 const s = c.next();
 if (s?.t === 'kw' && s.v === 'rxfifo') {
 v1(s, 'mov rxfifo[]');
 if (d.v !== 'osr' || op) throw c.err('rxfifo[] can only be moved to osr, without an operation', s);
 const ix = fifoIdx();
 enc = (q) => { const [ii, k] = ix(q); return 0x8090 | (ii << 3) | k; };
 break;
 }
 if (!s || s.t !== 'kw' || SRC[s.v] === undefined) throw c.err('expected pins, x, y, null, status, isr or osr', s);
 enc = () => 0xa000 | (DST[d.v] << 5) | (op << 3) | SRC[s.v];
 break;
 }
 case 'irq': {
 let mode = 0, kind = 0;
 if (c.kw('prev')) { v1(t, 'irq prev'); mode = 1; } else if (c.kw('next')) { v1(t, 'irq next'); mode = 3; }
 if (c.kw('clear')) kind = 2; else if (c.kw('wait')) kind = 1; else if (!c.kw('nowait')) c.kw('set');
 const e = parseValue(c);
 if (c.kw('rel')) { if (mode) throw c.err("'rel' cannot be used with prev or next"); mode = 2; }
 enc = (q) => { const k = e(q); if (k < 0 || k > 7) throw new AsmError(line, col, 'an IRQ number must be 0-7'); return 0xc000 | (kind === 2 ? 0x40 : 0) | (kind === 1 ? 0x20 : 0) | (mode << 3) | k; };
 break;
 }
 case 'set': {
 const DST = { pins: 0, x: 1, y: 2, pindirs: 4 };
 const d = c.next();
 if (!d || d.t !== 'kw' || DST[d.v] === undefined) throw c.err('expected pins, x, y or pindirs', d);
 c.comma();
 const e = parseValue(c);
 enc = (q) => { const v = e(q); if (v < 0 || v > 31) throw new AsmError(line, col, 'the value of set must be 0-31'); return 0xe000 | (DST[d.v] << 5) | v; };
 break;
 }
 default: throw c.err(`unknown instruction '${t.v ?? t.raw}'`, t);
 }
 let side = null, delay = null;
 for (let k = 0; k < 2 && !c.done(); k++) {
 if (c.kw('side')) { if (side) throw c.err('side appears twice'); side = parseValue(c); }
 else if (c.take('[')) { if (delay) throw c.err('a delay appears twice'); delay = parseExpr(c, 0); c.expect(']', undefined, "']'"); }
 }
 p.instr.push({ line, col, build: (q) => {
 const base = enc(q);
 const ss = q.side, bits = ss ? ss.bits + (ss.opt ? 1 : 0) : 0, delayBits = 5 - bits;
 const dv = delay ? delay(q) : 0;
 if (dv < 0 || dv >= 1 << delayBits) throw new AsmError(line, col, delayBits < 5 ? `the delay must be 0-${(1 << delayBits) - 1} (side-set uses ${bits} of the 5 bits)` : 'the delay must be 0-31');
 let field = dv;
 if (side) {
 if (!ss) throw new AsmError(line, col, 'side is used but the program has no .side_set');
 const sv = side(q);
 if (sv < 0 || sv >= 1 << ss.bits) throw new AsmError(line, col, `the side-set value must fit in ${ss.bits} bit${ss.bits === 1 ? '' : 's'}`);
 field |= ((ss.opt ? (1 << ss.bits) | sv : sv) << delayBits);
 } else if (ss && !ss.opt && ss.bits) throw new AsmError(line, col, 'this program\'s side-set is not optional: the instruction needs side <value>');
 return (base & ~0x1f00) | (field << 8);
 } });
 }
 const out = [];
 for (const p of programs) {
 try {
 if (!p.instr.length) throw new AsmError(p.line, 1, `program '${p.name}' has no instructions`);
 if (p.instr.length > 32) throw new AsmError(p.line, 1, `program '${p.name}' has ${p.instr.length} instructions; the instruction memory holds 32`);
 const words = [];
 for (const ins of p.instr) { try { words.push(ins.build(p) & 0xffff); } catch (e) { if (!(e instanceof AsmError)) throw e; diagnostics.push({ severity: 'error', line: e.line, column: e.col, message: e.message }); words.push(0); } }
 const publics = p.publics.map(({ name, label }) => ({ name, value: label ? p.labels.get(name) : p.lookup(name), label }));
 const wrapTarget = p.wrapTarget ?? 0, wrap = p.wrap ?? p.instr.length - 1;
 out.push({ name: p.name, line: p.line, words, origin: p.origin, wrapTarget, wrap, version: p.version, sideset: p.side ? { bits: p.side.bits, opt: p.side.opt, pindirs: p.side.pindirs } : null,
 publics, clockDiv: p.clockDiv, fifo: p.fifo, movStatus: p.movStatus, in: p.in, out: p.out, set: p.set, code: p.code, langOpts: p.langOpts, lines: p.instr.map((i) => i.line) });
 } catch (e) { if (!(e instanceof AsmError)) throw e; diagnostics.push({ severity: 'error', line: e.line, column: e.col, message: e.message }); }
 }
 const gl = [];
 for (const name of globalPublics) { try { gl.push({ name, value: globals.get(name)({ lookup: (n) => (globals.has(n) ? globals.get(n)({ lookup: () => undefined }) : undefined) }) }); } catch (e) { diagnostics.push({ severity: 'error', line: 1, column: 1, message: e.message }); } }
 if (!programs.length && !diagnostics.length) diagnostics.push({ severity: 'error', line: 1, column: 1, message: 'no program: start one with .program <name>' });
 return { ok: !diagnostics.some((d) => d.severity === 'error'), programs: out, globals: gl, diagnostics };
}
export function disassemblePio(w, bits = 0, opt = false) {
 const major = w >>> 13, a1 = (w >>> 5) & 7, a2 = w & 0x1f;
 const pad = (s, n) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
 let mnem = '', guts = '', bad = false;
 switch (major) {
 case 0: mnem = 'jmp'; guts = ['', '!x, ', 'x--, ', '!y, ', 'y--, ', 'x != y, ', 'pin, ', '!osre, '][a1] + a2; break;
 case 1: {
 const src = a1 & 3;
 if (src === 0) guts = `gpio, ${a2}`;
 else if (src === 1) guts = `pin, ${a2}`;
 else if (src === 2) { guts = `irq${a2 & 8 ? (a2 & 0x10 ? ' next' : ' prev') : ''}, ${a2 & 7}${(a2 & 0x18) === 0x10 ? ' rel' : ''}`; }
 else if (a2 & 0x1c) bad = true; else guts = a2 ? `jmppin + ${a2 & 3}` : 'jmppin';
 mnem = 'wait'; guts = `${a1 & 4 ? '1' : '0'} ${guts}`;
 break;
 }
 case 2: { const s = ['pins', 'x', 'y', 'null', '', 'status', 'isr', 'osr'][a1]; if (!s) bad = true; mnem = 'in'; guts = `${s}, ${a2 || 32}`; break; }
 case 3: mnem = 'out'; guts = `${['pins', 'x', 'y', 'null', 'pindirs', 'pc', 'isr', 'exec'][a1]}, ${a2 || 32}`; break;
 case 4:
 if (a2) {
 if ((a1 & 3) || !(a2 & 0x10)) bad = true;
 else { const ix = a2 & 8 ? String(a2 & 3) : 'y'; mnem = 'mov'; guts = a1 & 4 ? `osr, rxfifo[${ix}]` : `rxfifo[${ix}], isr`; }
 } else { mnem = a1 & 4 ? 'pull' : 'push'; guts = (a1 & 2 ? (a1 & 4 ? 'ifempty ' : 'iffull ') : '') + (a1 & 1 ? 'block' : 'noblock'); }
 break;
 case 5: {
 const d = ['pins', 'x', 'y', 'pindirs', 'exec', 'pc', 'isr', 'osr'][a1], s = ['pins', 'x', 'y', 'null', '', 'status', 'isr', 'osr'][a2 & 7], opn = a2 >>> 3;
 if (!s || opn === 3) bad = true;
 if (d === s && !opn && (a1 === 1 || a2 === 2)) { mnem = 'nop'; guts = ''; }
 else { mnem = 'mov'; guts = `${d}, ${opn === 1 ? '~' : opn === 2 ? '::' : ''}${s}`; }
 break;
 }
 case 6: {
 if (a1 & 4) { bad = true; break; }
 mnem = 'irq';
 guts = `${a1 & 2 ? 'clear ' : a1 & 1 ? 'wait ' : 'nowait '}${a2 & 7}`;
 if ((a2 & 0x18) === 0x10) guts += ' rel'; else if ((a2 & 0x18) === 0x08) guts = `prev ${guts}`; else if ((a2 & 0x18) === 0x18) guts = `next ${guts}`;
 break;
 }
 default: { const d = ['pins', 'x', 'y', '', 'pindirs', '', '', ''][a1]; if (!d) bad = true; mnem = 'set'; guts = `${d}, ${a2}`; }
 }
 if (bad) return 'reserved';
 let field = (w >>> 8) & 0x1f;
 let s = pad(mnem, 7) + pad(guts, 16);
 s += pad(bits && (!opt || (field & 0x10)) ? `side ${(field & (opt ? 0xf : 0x1f)) >>> (5 - bits)}` : '', 7);
 field &= (1 << (5 - bits)) - 1;
 s += pad(field ? `[${field}]` : '', 4);
 return s.replace(/ +$/, '');
}
export function pioHeader(result, { tool = 'the Pico 2 Laboratory\'s PIO assembler' } = {}) {
 const L = [];
 const banner = (s) => { const d = '-'.repeat(s.length); L.push(`// ${d} //`, `// ${s} //`, `// ${d} //`, ''); };
 banner(`This file is autogenerated by ${tool}; do not edit!`);
 L.push('#pragma once', '', '#if !PICO_NO_HARDWARE', '#include "hardware/pio.h"', '#endif', '', '#ifdef __cpp_constexpr', '#define __pio_const constexpr', '#else', '#define __pio_const const', '#endif', '');
 if (result.globals.length) { for (const g of result.globals) L.push(`#define ${g.name} ${g.value}`); L.push(''); }
 for (const p of result.programs) {
 banner(p.name);
 const pre = `${p.name}_`;
 L.push(`#define ${pre}wrap_target ${p.wrapTarget}`, `#define ${pre}wrap ${p.wrap}`, `#define ${pre}pio_version ${p.version}`, '');
 const defs = p.publics.filter((s) => !s.label), labs = p.publics.filter((s) => s.label);
 if (defs.length) { for (const s of defs) L.push(`#define ${pre}${s.name} ${s.value}`); L.push(''); }
 if (labs.length) { for (const s of labs) L.push(`#define ${pre}offset_${s.name} ${s.value}u`); L.push(''); }
 const bits = p.sideset ? p.sideset.bits + (p.sideset.opt ? 1 : 0) : 0;
 L.push(`static __pio_const uint16_t ${pre}program_instructions[] = {`);
 p.words.forEach((w, i) => {
 if (i === p.wrapTarget) L.push('            //     .wrap_target');
 L.push(`    0x${w.toString(16).padStart(4, '0')}, // ${String(i).padStart(2)}: ${disassemblePio(w, bits, p.sideset?.opt ?? false)}`);
 if (i === p.wrap) L.push('            //     .wrap');
 });
 L.push('};', '', '#if !PICO_NO_HARDWARE', `static __pio_const struct pio_program ${pre}program = {`, `    .instructions = ${pre}program_instructions,`,
 `    .length = ${p.words.length},`, `    .origin = ${p.origin},`, `    .pio_version = ${pre}pio_version,`, '#if PICO_PIO_VERSION > 0', '    .used_gpio_ranges = 0x0', '#endif', '};', '',
 `static inline pio_sm_config ${pre}program_get_default_config(uint offset) {`, '    pio_sm_config c = pio_get_default_sm_config();',
 `    sm_config_set_wrap(&c, offset + ${pre}wrap_target, offset + ${pre}wrap);`);
 if (p.in) L.push(`    sm_config_set_in_pin_count(&c, ${p.in.count});`, `    sm_config_set_in_shift(&c, ${+p.in.right}, ${+p.in.auto}, ${p.in.threshold});`);
 if (p.out) L.push(`    sm_config_set_out_pin_count(&c, ${p.out.count});`, `    sm_config_set_out_shift(&c, ${+p.out.right}, ${+p.out.auto}, ${p.out.threshold});`);
 if (p.set !== null) L.push(`    sm_config_set_set_pin_count(&c, ${p.set});`);
 if (p.sideset) L.push(`    sm_config_set_sideset(&c, ${bits}, ${p.sideset.opt}, ${p.sideset.pindirs});`);
 if (p.movStatus) L.push(`    sm_config_set_mov_status(&c, ${['STATUS_TX_LESSTHAN', 'STATUS_RX_LESSTHAN', 'STATUS_IRQ_SET'][p.movStatus.type]}, ${p.movStatus.n});`);
 if (p.fifo !== 'txrx') L.push(`    sm_config_set_fifo_join(&c, PIO_FIFO_JOIN_${p.fifo.toUpperCase()});`);
 if (p.clockDiv !== null && p.clockDiv !== 1) { const i = Math.floor(p.clockDiv), f = Math.round((p.clockDiv - i) * 256); L.push(`    sm_config_set_clkdiv_int_frac(&c, ${i}, ${f});`); }
 L.push('    return c;', '}');
 for (const cb of p.code) if (cb.lang === 'c-sdk') L.push('', cb.text);
 L.push('#endif', '');
 }
 return L.join('\n');
}
export function pioCHeader(result, fileName) {
 const L = [`/* ${fileName}.h -- generated from ${fileName} by the Pico 2 Laboratory's PIO assembler at each build; do not edit. */`, ''];
 for (const g of result.globals) L.push(`#define ${g.name} ${g.value}`);
 if (result.globals.length) L.push('');
 for (const p of result.programs) {
 const pre = `${p.name}_`, bits = p.sideset ? p.sideset.bits + (p.sideset.opt ? 1 : 0) : 0;
 L.push(`/* .program ${p.name} */`, `#define ${pre}length ${p.words.length}`, `#define ${pre}wrap_target ${p.wrapTarget}`, `#define ${pre}wrap ${p.wrap}`,
 `#define ${pre}sideset_bits ${bits}`, `#define ${pre}sideset_opt ${p.sideset?.opt ? 1 : 0}`, `#define ${pre}sideset_pindirs ${p.sideset?.pindirs ? 1 : 0}`);
 for (const x of p.publics) L.push(`#define ${pre}${x.label ? 'offset_' : ''}${x.name} ${x.value}`);
 L.push(`uint16_t ${pre}program[${p.words.length}] = {`);
 p.words.forEach((w, i) => L.push(`    0x${w.toString(16).padStart(4, '0')}${i < p.words.length - 1 ? ',' : ' '} /* ${String(i).padStart(2)}: ${disassemblePio(w, bits, p.sideset?.opt ?? false).replace(/\*\//g, '* /')} */`));
 L.push('};', '');
 }
 return L.join('\n');
}
export function withPioHeaders(files) {
 const pio = files.filter((x) => /\.pio$/i.test(x.name));
 if (!pio.length) return { ok: true, files, diagnostics: [] };
 const diagnostics = [], headers = [];
 for (const pf of pio) {
 const r = assemblePio(pf.text);
 for (const d of r.diagnostics) diagnostics.push({ severity: d.severity, message: d.message, file: pf.name, line: d.line, column: d.column ?? 1 });
 if (r.ok) headers.push({ name: `${pf.name}.h`, text: pioHeader(r) });
 }
 const ok = !diagnostics.some((d) => d.severity === 'error');
 return { ok, diagnostics, files: [...files.filter((x) => !/\.pio$/i.test(x.name) && !headers.some((h) => h.name === x.name)), ...headers] };
}
