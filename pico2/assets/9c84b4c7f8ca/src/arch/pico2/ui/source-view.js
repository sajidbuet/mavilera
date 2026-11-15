// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../../contract.js';
import { el } from '../../../ui/dom.js';
import { disassemble } from '../language.js';
import { PICO2_STRINGS } from '../strings.js';
import { SourceSession, matchFiles, LINE_STEP_MAX } from '../debug/source-session.js';
const T = PICO2_STRINGS.source;
const hx = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const SOURCE_EXT = /\.(c|h|s|cc|cpp|cxx|hpp|hh|inc|inl)$/i;
const base = (p) => p.replace(/\\/g, '/').split('/').pop();
const OPENED = new Map();
let openedRev = 0;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
const MAP = Object.freeze({ w: 900, h: 36, top: 9, bar: 20 });
const STYLE = `
.sv-view { flex: 1 1 0; min-height: 10rem; display: flex; flex-direction: column; overflow: hidden; }
.sv-mapbox { flex: 0 0 auto; height: 5rem; position: relative; overflow: hidden; border-bottom: 1px solid var(--border); }
.sv-map { width: 100%; height: 100%; font-family: var(--font-code); }
.sv-fn { fill: var(--surface-2); stroke: var(--border-strong); stroke-width: 0.6; }
.sv-fn.sv-on { fill: var(--changed-bg); stroke: var(--primary); stroke-width: 1.6; }
.sv-fn-t { font-size: 12px; fill: var(--text); pointer-events: none; }
.sv-pc { fill: var(--primary); } .sv-bp { stroke: var(--danger, #c62828); stroke-width: 2; }
.sv-bar { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: center; padding: 0.3em 0.5em; border-bottom: 1px solid var(--border); }
.sv-bar button { font: inherit; }
.sv-where { margin: 0; padding: 0.3em 0.5em; font-family: var(--font-code); font-size: 0.8rem; font-weight: 600; }
.sv-note { margin: 0.4em 0.5em; color: var(--muted); max-width: 70em; font-size: 0.84rem; }
.sv-note:empty { display: none; }
.sv-code { flex: 1 1 0; overflow: auto; font-family: var(--font-code); font-size: 0.8rem; line-height: 1.5; outline-offset: -2px; } /* as the editor */
.sv-line { display: flex; white-space: pre; }
.sv-gut { flex: 0 0 1.4em; text-align: center; color: var(--danger, #c62828); cursor: default; user-select: none; }
.sv-num { flex: 0 0 4em; text-align: right; padding-right: 0.8em; color: var(--muted); user-select: none; }
.sv-code-l .sv-gut, .sv-code-l .sv-num { cursor: pointer; }
.sv-code-l .sv-num { color: var(--text); }
.sv-txt { flex: 1 1 auto; }
.sv-now { background: var(--changed-bg); }
.sv-now .sv-num::before { content: '▶ '; color: var(--primary); }
.sv-cursor { outline: 1px dashed var(--primary); outline-offset: -1px; }
.sv-tab table { border-collapse: collapse; } .sv-tab td, .sv-tab th { padding: 2px 8px; text-align: left; vertical-align: top; }
.sv-tab caption { text-align: left; font-weight: 600; padding: 0.4em 0 0.2em; }
.sv-tab p { margin: 0.4em 0; max-width: 70em; } .sv-tab h3 { font-size: 1em; margin: 0.8em 0 0.2em; }
.sv-mono { font-family: var(--font-code); font-size: 0.8rem; }
.sv-tab { font-size: 0.84rem; } /* the shell's panel text size */
.sv-loaded { font-family: var(--font-ui); font-size: 0.9em; color: var(--muted); }
`;
export class SourceView {
 constructor(ctx = {}) {
 this.ctx = ctx;
 this.session = null;
 this.program = null;
 this.shown = -1;
 this.shownRev = -1;
 this.lineEls = [];
 this.cursor = 1;
 this.lastPc = -1;
 this.match = new Map();
 this.matchRev = -1;
 this.status = el('span.dp-status.mono');
 const pick = (folder) => el('input', { type: 'file', hidden: true, multiple: true, webkitdirectory: folder, accept: folder ? null : '.c,.h,.S,.s,.cpp,.hpp',
 onchange: (e) => { this.addFiles(e.target.files); e.target.value = ''; } });
 this.folderInput = pick(true); this.filesInput = pick(false);
 this.fileSel = el('select', { 'aria-label': T.fileCol, onchange: () => { this.shown = Number(this.fileSel.value); this.drawFile(); } });
 this.loadedNote = el('span.sv-loaded');
 this.where = el('p.sv-where');
 this.note = el('p.sv-note');
 this.code = el('div.sv-code', { tabindex: 0, role: 'listbox', onkeydown: (e) => this.key(e) });
 this.svg = s('svg', { class: 'sv-map', viewBox: `0 0 ${MAP.w} ${MAP.h}`, role: 'img', 'aria-label': T.mapLabel(null, 0) });
 this.mapLayer = s('g'); this.markLayer = s('g');
 this.svg.append(s('title', {}, T.mapTitle), s('rect', { x: 0, y: 0, width: MAP.w, height: MAP.h, fill: 'var(--surface)' }), this.mapLayer, this.markLayer);
 this.mapBox = el('div.sv-mapbox', {}, this.svg);
 this.root = el('div.sv-view', {}, el('style', { text: STYLE }), this.mapBox,
 el('div.sv-bar', {},
 ...(this.openBtns = [
 el('button', { type: 'button', text: T.openFolder, title: T.openFolderTitle, onclick: () => this.folderInput.click() }),
 el('button', { type: 'button', text: T.openFiles, title: T.openFilesTitle, onclick: () => this.filesInput.click() })]),
 this.folderInput, this.filesInput, this.fileSel, this.loadedNote),
 this.where, this.note, this.code);
 this.boxes = { lines: el('div.sv-tab.scroll'), files: el('div.sv-tab.scroll'), help: el('div.sv-tab.scroll') };
 this.boxes.help.replaceChildren(...T.help.flatMap(([h, t]) => [el('h3', { text: h }), el('p', { text: t })]));
 }
 load(program) {
 this.program = program ?? null;
 this.session = null; this.loadError = null;
 if (program?.debug?.lineTable !== undefined) {
 try { this.session = new SourceSession(program); } catch (e) { this.loadError = String(e.message ?? e); }
 }
 if (program?.debug?.sources?.size) { for (const [k, v] of program.debug.sources) OPENED.set(k, v); openedRev++; }
 for (const b of this.openBtns) b.hidden = Boolean(program?.debug?.sources?.size);
 this.shown = -1; this.lastPc = -1; this.matchRev = -1;
 this.drawMap();
 this.render();
 }
 drawMap() {
 const fns = [];
 let end = 0;
 for (const f of this.session?.functions ?? []) if (f.address >= end) { fns.push(f); end = f.address + f.size; }
 const total = fns.reduce((n, f) => n + Math.max(f.size, 16), 0) || 1;
 let x = 0;
 this.mapFns = fns.map((f) => { const w = (Math.max(f.size, 16) / total) * MAP.w; const r = { f, x, w }; x += w; return r; });
 this.mapLayer.replaceChildren(...this.mapFns.map((r) => s('g', {},
 s('title', {}, `${r.f.name} ${hx(r.f.address)}, ${r.f.size} bytes`),
 s('rect', { class: 'sv-fn', x: r.x.toFixed(2), y: MAP.top, width: Math.max(0.5, r.w).toFixed(2), height: MAP.bar }),
 r.w > 7.5 * Math.min(r.f.name.length, 14) + 6 ? s('text', { class: 'sv-fn-t', x: (r.x + 3).toFixed(2), y: MAP.top + MAP.bar / 2 + 4 }, r.f.name.slice(0, 14)) : null)));
 this.mapRects = [...this.mapLayer.querySelectorAll('rect')];
 }
 markMap(pc) {
 const at = (a) => {
 for (let i = 0; i < (this.mapFns?.length ?? 0); i++) { const r = this.mapFns[i]; if (a >= r.f.address && a < r.f.address + r.f.size) return [i, r.x + ((a - r.f.address) / r.f.size) * r.w]; }
 return [-1, null];
 };
 const [k, x] = at(pc);
 this.mapRects?.forEach((rect, i) => rect.classList.toggle('sv-on', i === k));
 const marks = [];
 if (x !== null) marks.push(s('path', { class: 'sv-pc', d: `M${x.toFixed(2)} ${MAP.top - 1} l-5 -8 h10 z` }));
 for (const a of this.session?.breakAddrs ?? []) { const [, bx] = at(a); if (bx !== null) marks.push(s('line', { class: 'sv-bp', x1: bx.toFixed(2), x2: bx.toFixed(2), y1: MAP.top + MAP.bar, y2: MAP.h })); }
 this.markLayer.replaceChildren(...marks);
 this.svg.setAttribute('aria-label', T.mapLabel(k >= 0 ? this.mapFns[k].f.name : null, this.mapFns?.length ?? 0));
 }
 reset() { this.session?.reset(); this.lastPc = -1; this.render(); }
 addFiles(list) {
 let n = 0;
 for (const f of list) if (SOURCE_EXT.test(f.name)) { OPENED.set(f.webkitRelativePath || f.name, f); n++; }
 if (n) { openedRev++; this.render(); }
 }
 matched() {
 const lt = this.session?.lt;
 if (!lt) return this.match;
 if (this.matchRev !== openedRev) { this.match = matchFiles(lt.files, OPENED.keys()); this.matchRev = openedRev; }
 return this.match;
 }
 textOf(fileIndex) {
 const key = this.matched().get(fileIndex);
 if (key === undefined) return null;
 const v = OPENED.get(key);
 if (typeof v === 'string') return v;
 if (v && !v.pending) {
 v.pending = true;
 v.text().then((t) => { OPENED.set(key, t); openedRev++; this.matchRev = openedRev; this.render(); }, () => { v.pending = false; });
 }
 return undefined;
 }
 render() {
 const ss = this.session;
 this.code.hidden = true;
 if (!this.program) { this.where.textContent = ''; this.note.textContent = T.noProgram; this.status.textContent = ''; this.renderTabs(); return; }
 if (!ss || !ss.lt) {
 this.where.textContent = '';
 this.note.textContent = this.loadError ?? (this.program.debug ? T.noLineTable : T.notImported);
 this.status.textContent = ''; this.fileSel.replaceChildren(); this.renderTabs(); return;
 }
 const pc = ss.pc, w = ss.where(pc);
 this.status.textContent = hx(pc);
 this.markMap(pc);
 const m = this.matched();
 this.loadedNote.textContent = OPENED.size ? T.loadedFiles(OPENED.size, m.size) : '';
 if (pc !== this.lastPc && w.fileIndex >= 0) this.shown = w.fileIndex;
 if (this.shown < 0 && this.program.debug?.sources?.size) {
 for (const [i, key] of m) if (this.program.debug.sources.has(key)) { this.shown = i; break; }
 }
 const moved = pc !== this.lastPc;
 this.lastPc = pc;
 this.where.textContent = w.file ? T.at(w.fn, base(w.file), w.line) : (w.fn ?? hx(pc));
 this.fillFileSelect(w.fileIndex);
 this.drawFile(w, moved);
 this.renderTabs();
 }
 fillFileSelect(current) {
 const lt = this.session.lt, m = this.matched();
 const idx = new Set([...m.keys()]);
 if (current >= 0) idx.add(current);
 if (this.shown >= 0) idx.add(this.shown);
 const list = [...idx].sort((a, b) => base(lt.files[a]).localeCompare(base(lt.files[b])));
 const sig = list.join(',') + '|' + this.shown;
 if (this.fileSel.dataset.sig !== sig) {
 this.fileSel.replaceChildren(...list.map((i) => el('option', { value: String(i), text: base(lt.files[i]) + (m.has(i) ? '' : ` (${T.notLoaded})`) })));
 this.fileSel.dataset.sig = sig;
 }
 if (this.shown >= 0) this.fileSel.value = String(this.shown);
 }
 drawFile(w = this.session?.where(), moved = false) {
 const ss = this.session;
 if (!ss) return;
 const lt = ss.lt, f = this.shown;
 if (f < 0) { this.note.textContent = T.noSourceHere(w?.fn); this.code.hidden = true; return; }
 const text = this.textOf(f);
 if (text === null || text === undefined) {
 this.note.textContent = text === null ? T.fileMissing(lt.files[f]) : '…';
 this.code.hidden = true; return;
 }
 this.note.textContent = w && w.fileIndex < 0 ? T.noSourceHere(w.fn) : '';
 this.code.hidden = false;
 if (this.drawnFile !== f || this.shownRev !== openedRev) {
 const withCode = new Set(lt.linesOf(f));
 this.code.classList.toggle('sv-code-l', withCode.size > 0);
 this.code.setAttribute('aria-label', T.codeLabel(base(lt.files[f])));
 this.lineEls = [null];
 const rows = text.split(/\r?\n/).map((t, i) => {
 const n = i + 1, code = withCode.has(n);
 const toggle = code ? () => { ss.toggleBreak(f, n); this.cursor = n; this.markLines(); } : null;
 const row = el(`div.sv-line${code ? '.sv-has' : ''}`, { id: `sv-l${n}`, role: 'option', 'aria-selected': 'false' },
 el('span.sv-gut', { onclick: toggle, 'aria-hidden': 'true' }), el('span.sv-num', { text: String(n), onclick: toggle, title: code ? T.breakpointOn(n) : null }),
 el('span.sv-txt', { text: t || ' ' }), el('span.sr-only'));
 this.lineEls.push(row);
 return row;
 });
 this.code.replaceChildren(...rows);
 this.drawnFile = f; this.shownRev = openedRev;
 if (this.cursor >= this.lineEls.length) this.cursor = 1;
 }
 if (moved && w && w.fileIndex === f && w.line > 0) this.cursor = w.line;
 this.markLines(w);
 if (moved && w && w.fileIndex === f && this.lineEls[w.line]) this.lineEls[w.line].scrollIntoView({ block: 'nearest' });
 }
 markLines(w = this.session?.where()) {
 const ss = this.session, f = this.shown;
 for (let n = 1; n < this.lineEls.length; n++) {
 const row = this.lineEls[n];
 const now = w && w.fileIndex === f && w.line === n;
 const bp = ss.hasBreak(f, n);
 row.classList.toggle('sv-now', now);
 const sel = n === this.cursor;
 row.classList.toggle('sv-cursor', sel);
 if (row.getAttribute('aria-selected') !== String(sel)) row.setAttribute('aria-selected', String(sel));
 row.firstChild.textContent = bp ? '●' : '';
 const extra = [now ? T.current : null, bp ? T.breakpointOn(n) : null].filter(Boolean).join(', ');
 const sr = row.lastChild, want = extra ? `, ${extra}` : '';
 if (sr.textContent !== want) sr.textContent = want;
 }
 if (this.lineEls[this.cursor]) this.code.setAttribute('aria-activedescendant', `sv-l${this.cursor}`);
 if (ss) this.markMap(ss.pc);
 }
 key(e) {
 const n = this.lineEls.length - 1;
 if (n < 1) return;
 const go = (k) => { e.preventDefault(); this.cursor = Math.max(1, Math.min(n, k)); this.markLines(); this.lineEls[this.cursor].scrollIntoView({ block: 'nearest' }); };
 if (e.key === 'ArrowDown') go(this.cursor + 1);
 else if (e.key === 'ArrowUp') go(this.cursor - 1);
 else if (e.key === 'PageDown') go(this.cursor + 20);
 else if (e.key === 'PageUp') go(this.cursor - 20);
 else if (e.key === 'Home') go(1);
 else if (e.key === 'End') go(n);
 else if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey) {
 e.preventDefault();
 this.session?.toggleBreak(this.shown, this.cursor);
 this.markLines();
 }
 }
 renderTabs() {
 const ss = this.session;
 if (!ss || !ss.lt) { for (const b of [this.boxes.lines, this.boxes.files]) b.replaceChildren(el('p', { text: this.note.textContent })); return; }
 const lt = ss.lt, w = ss.where();
 const rows = [];
 if (w.fileIndex >= 0) {
 for (let i = 0; i < lt.address.length && rows.length < 64; i++) {
 if (lt.file[i] !== w.fileIndex || lt.line[i] !== w.line) continue;
 const [lo, hi] = lt.rowRange(i);
 for (let a = lo; a < hi && rows.length < 64;) {
 const b = ss.engine.peek(a, 4), half = b[0] | (b[1] << 8);
 const word = (half & 3) === 3 ? (half | (b[2] << 16) | (b[3] << 24)) >>> 0 : half;
 rows.push([a, disassemble(word, a)]);
 a += (half & 3) === 3 ? 4 : 2;
 }
 }
 }
 this.boxes.lines.replaceChildren(el('p', { text: this.where.textContent }),
 el('table', {}, el('caption', { text: T.lineAddresses }),
 el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: T.addrCol }), el('th', { scope: 'col', text: T.instrCol }))),
 el('tbody', {}, ...rows.map(([a, t]) => el(`tr${a === ss.pc ? '.sv-now' : ''}`, {}, el('td.sv-mono', { text: hx(a) }), el('td.sv-mono', { text: t }))))));
 const m = this.matched();
 if (this.boxes.files.dataset.rev !== `${openedRev}|${lt.files.length}`) {
 this.boxes.files.dataset.rev = `${openedRev}|${lt.files.length}`;
 this.boxes.files.replaceChildren(el('table', {},
 el('thead', {}, el('tr', {}, ...[T.fileCol, T.loadedCol, T.linesCol].map((t) => el('th', { scope: 'col', text: t })))),
 el('tbody', {}, ...lt.files.map((f, i) => el('tr', {}, el('td.sv-mono', { text: f }), el('td.sv-mono', { text: m.get(i) ?? T.notLoaded }),
 el('td', { text: String(lt.linesOf(i).length) }))))));
 }
 }
}
export function sourceInstance(v, ctx) {
 v.ctx = ctx;
 const ss = () => v.session;
 const headerTools = el('span.sb-tools', {},
 el('button', { type: 'button', text: T.backLine, title: T.backLineTitle, onclick: () => ctx.command?.('backUnit') }),
 el('button', { type: 'button', text: T.stepLine, title: T.stepLineTitle, onclick: () => ctx.command?.('stepUnit') }));
 return {
 root: v.root, title: T.title, infoTitle: T.infoTitle, status: v.status, headerTools,
 diagrams: [v.svg],
 tabs: [[T.tabLines, v.boxes.lines], [T.tabFiles, v.boxes.files], [T.tabHelp, v.boxes.help]],
 load: (p) => v.load(p),
 reset: () => v.reset(),
 step: () => (ss() ? ss().step() : STOP.ERROR),
 back: () => ss()?.back() ?? false,
 realtime: { engine: () => ss()?.engine ?? null, breakpoints: () => [...(ss()?.breakAddrs ?? [])], sync: () => { ss()?.resync(); v.render(); } },
 input: (x) => ss()?.engine.input(x),
 render: () => v.render(),
 state: () => {
 const x = ss();
 if (!x) return null;
 let st = null;
 const full = () => (st ??= x.engine.state());
 return {
 pc: x.pc, cycle: x.n, halted: x.stop === STOP.HALT,
 get retired() { return full().retired; }, get error() { return x.stop === STOP.ERROR ? full().error : null; },
 get registers() { return full().registers; },
 get output() { return full().output; },
 };
 },
 stopMessage: (r) => (r === STOP.HALT && ss() ? T.haltedAt(hx(ss().pc), ss().engine.state().retired) : null),
 counters: () => {
 const x = ss();
 if (!x) return [];
 return [[T.counters.cycles, x.hart.ticks], [T.counters.line, x.lines]];
 },
 breakAt: () => (ss() ? ss().pc : null),
 event: () => {
 const x = ss();
 if (!x || !x.breakAddrs.has(x.pc)) return null;
 const w = x.where();
 return T.lineBreak(base(w.file ?? ''), w.line);
 },
 unit: {
 label: T.stepLine,
 step: () => {
 const x = ss();
 if (!x) return STOP.ERROR;
 const r = x.stepLine();
 if (r === 'limit') { ctx.message?.(T.noLineReached(LINE_STEP_MAX), 'warn'); return STOP.NONE; }
 return r;
 },
 back: () => ss()?.backLine() ?? false,
 },
 memoryPort: () => (ss() ? { read: (address, size) => { const b = ss().engine.peek(address >>> 0, size); let x = 0; for (let i = size - 1; i >= 0; i--) x = x * 256 + b[i]; return x; } } : null),
 };
}
