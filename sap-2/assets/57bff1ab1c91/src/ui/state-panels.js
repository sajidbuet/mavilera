// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8, hex2, hexAddr, formatValue } from './dom.js';
import { STRINGS } from './strings.js';
export class RegistersPanel {
 constructor({ registers, pcBits = 32, onWatch }) {
 this.onWatch = onWatch;
 this.pcBits = pcBits;
 this.format = 'hex';
 this.picked = null;
 this.select = el('select', { 'aria-label': STRINGS.registers, onchange: (e) => { this.format = e.target.value; this.update(this.last); } },
 ['hex', 'signed', 'unsigned', 'binary'].map((f) => el('option', { value: f,
 text: STRINGS[`format${f[0].toUpperCase()}${f.slice(1)}`] })));
 this.list = registers.groups.flatMap((g) => g.registers).filter((r) => !r.hidden);
 this.cells = {};
 this.decs = {};
 this.rowEls = {};
 this.watches = {};
 const first = this.list.find((r) => !r.zero)?.id;
 const hasAlias = this.list.some((r) => r.aliases?.length);
 const rows = this.list.map((r) => {
 const val = el('td.mono.reg-val');
 const dec = el('td.mono.reg-dec');
 const watch = el('input', { type: 'checkbox', 'aria-label': `${STRINGS.watch}: ${r.name}`, disabled: Boolean(r.zero), tabindex: -1,
 onchange: (e) => this.onWatch?.(r.id, e.target.checked) });
 this.cells[r.id] = val;
 this.decs[r.id] = dec;
 this.watches[r.id] = watch;
 const alias = r.aliases?.[0] ?? '';
 const tr = el(`tr${r.zero ? '.reg-zero' : ''}`, { tabindex: r.id === first ? 0 : -1, 'aria-label': `${r.name} ${alias}`.trim(),
 title: r.zero ? STRINGS.tools.zero : null, onclick: () => this.pick(r.id), onfocus: () => this.pick(r.id),
 onkeydown: (e) => {
 const row = e.currentTarget;
 const move = (to) => { if (to) { e.preventDefault(); row.tabIndex = -1; to.tabIndex = 0; to.focus(); } };
 if (e.key === 'ArrowDown') move(row.nextElementSibling);
 else if (e.key === 'ArrowUp') move(row.previousElementSibling);
 else if ((e.key === 'w' || e.key === 'W' || e.key === ' ') && !r.zero) {
 e.preventDefault();
 watch.checked = !watch.checked;
 this.onWatch?.(r.id, watch.checked);
 }
 } },
 el('td.mono.reg-x', { text: r.name }), hasAlias ? el('td.mono.reg-abi', { text: alias }) : null, val, dec, el('td.reg-watch', {}, watch));
 this.rowEls[r.id] = tr;
 return tr;
 });
 const pcReg = this.list.find((r) => r.id === registers.pc);
 this.pcVal = el('span.mono.pc-val');
 this.detail = el('p.reg-detail.mono.reg-hint', { 'aria-live': 'polite', text: STRINGS.tools.regPick, title: STRINGS.tools.regPick });
 this.root = el('div.regs', {},
 el('div.panel-tools', {}, el('span.pc-box', { title: STRINGS.tools.pc }, el('span.pc-name', { text: pcReg ? pcReg.aliases?.[0] ?? pcReg.name : 'pc' }), this.pcVal), this.select),
 el('div.scroll', {}, el('table.listing.reg-table', {},
 el('thead', {}, el('tr', {}, el('th', { text: STRINGS.tools.colReg }), hasAlias ? el('th', { text: STRINGS.tools.colAlias }) : null,
 el('th', { text: STRINGS.colValue }), el('th.reg-dec', { text: STRINGS.tools.colDec }), el('th', { title: STRINGS.watch, text: '👁' }))),
 el('tbody', {}, rows))),
 this.detail);
 }
 label(id) {
 const r = this.list.find((x) => x.id === id);
 if (!r) return id;
 return r.aliases?.length ? `${r.name} (${r.aliases[0]})` : r.name;
 }
 setWatch(id, on) {
 if (this.watches[id]) this.watches[id].checked = on;
 }
 pick(id) {
 this.picked = id;
 for (const [k, r] of Object.entries(this.rowEls)) r.classList.toggle('sel', k === id);
 this.showDetail();
 }
 showDetail() {
 const id = this.picked;
 this.detail.classList.toggle('reg-hint', id === null || !this.last);
 if (id === null || !this.last) { this.detail.textContent = STRINGS.tools.regPick; return; }
 const r = this.list.find((x) => x.id === id);
 const v = this.last.registers[id] ?? 0;
 this.detail.textContent = STRINGS.tools.regDetail(r.name, r.aliases?.[0] ?? '', formatValue(v, 'hex', r.width), formatValue(v, 'signed', r.width),
 formatValue(v, 'unsigned', r.width), `0b${formatValue(v, 'binary', r.width).replace(/ /g, '_')}`);
 }
 update(state) {
 this.last = state;
 if (!state) {
 for (const c of Object.values(this.cells)) c.textContent = '';
 for (const c of Object.values(this.decs)) c.textContent = '';
 this.pcVal.textContent = '—';
 this.showDetail();
 return;
 }
 const { registers, pc, changed = [] } = state;
 for (const r of this.list) {
 const v = registers[r.id] ?? 0;
 const c = this.cells[r.id];
 const mark = changed.includes(r.id);
 c.textContent = `${mark ? '◆ ' : ''}${formatValue(v, this.format, r.width)}`;
 this.decs[r.id].textContent = formatValue(v, 'signed', r.width);
 const row = this.rowEls[r.id];
 row.classList.toggle('changed', mark);
 row.classList.remove('flash-change');
 if (mark && this.lastPc !== pc) {
 void row.offsetWidth;
 row.classList.add('flash-change');
 }
 c.title = mark ? STRINGS.changed : '';
 }
 this.lastPc = pc;
 this.pcVal.textContent = formatValue(pc, 'hex', this.pcBits);
 this.showDetail();
 }
}
const spName = (list, id) => { const r = list.find((x) => x.id === id); return r?.aliases?.[0] ?? r?.name ?? id; };
export class MemoryPanel {
 constructor({ registers, addressSpace, onWatch }) {
 this.onWatch = onWatch;
 this.roles = registers.roles ?? {};
 this.wordBytes = addressSpace.wordBytes;
 this.unit = addressSpace.unitBits / 8;
 this.unitBits = addressSpace.unitBits;
 this.addrDigits = Math.ceil(addressSpace.addressBits / 4);
 this.list = registers.groups.flatMap((g) => g.registers).filter((r) => !r.hidden);
 this.base = 0;
 this.mode = 'word';
 this.span = 2 ** addressSpace.addressBits * (addressSpace.unitBits / 8);
 this.rowBytes = 16;
 this.layoutRows();
 this.goto = el('input.mono', { type: 'text', size: 14, 'aria-label': STRINGS.goTo, placeholder: STRINGS.goTo,
 onkeydown: (e) => { if (e.key === 'Enter') this.goTo(e.target.value); } });
 this.modeSel = el('select', { 'aria-label': STRINGS.memory, onchange: (e) => { this.mode = e.target.value; this.render(); } },
 el('option', { value: 'word', text: STRINGS.byWord }), el('option', { value: 'byte', text: STRINGS.byByte }));
 this.regions = el('span.note');
 this.body = el('tbody');
 this.view = 'seen';
 this.viewSel = el('select', { 'aria-label': STRINGS.mem.viewLabel, hidden: true, onchange: (e) => { this.view = e.target.value; this.render(); } },
 el('option', { value: 'seen', text: STRINGS.mem.seenBy }), el('option', { value: 'ram', text: STRINGS.mem.ramView }));
 this.regSel = el('select.mem-reg', { 'aria-label': STRINGS.memGoReg, title: STRINGS.memGoRegTitle, onchange: (e) => {
 const v = e.target.value;
 e.target.value = '';
 if (v !== '' && this.regs) this.goToAddress(this.regs[v]);
 } }, el('option', { value: '', text: STRINGS.memGoReg }),
 this.list.map((r) => el('option', { value: r.id, text: r.aliases?.length ? `${r.name} (${r.aliases[0]})` : r.name })));
 this.root = el('div.memory', {},
 el('div.panel-tools', {}, this.goto,
 el('button', { type: 'button', text: STRINGS.watchButton, title: STRINGS.watchButtonTitle, onclick: () => {
 const a = this.resolve(this.goto.value);
 if (a !== null) this.onWatch?.(this.wordOf(a));
 } }),
 this.roles.sp ? el('button.mem-sp', { type: 'button', text: spName(this.list, this.roles.sp), title: STRINGS.memGoSp,
 onclick: () => { if (this.regs) this.goToAddress(this.regs[this.roles.sp]); } }) : null,
 this.regSel,
 this.wordBytes > this.unit ? this.modeSel : null, this.viewSel,
 this.paged ? el('button', { type: 'button', text: '▲', 'aria-label': STRINGS.previous, onclick: () => { this.base -= this.rowUnits() * this.rows; this.render(); } }) : null,
 this.paged ? el('button', { type: 'button', text: '▼', 'aria-label': STRINGS.next, onclick: () => { this.base += this.rowUnits() * this.rows; this.render(); } }) : null,
 this.regions),
 el('div.scroll', {}, el('table.listing.memtable', {}, this.body)));
 }
 setContext({ mem, program, registers, written, profile, watched, ram = null, dirty = null, accessed = null }) {
 Object.assign(this, { mem, program, regs: registers, written, profile, watched, ram, dirty, accessed });
 this.viewSel.hidden = !ram;
 if (!ram) this.view = 'seen';
 this.viewSel.value = this.view;
 this.render();
 }
 rowUnits() { return this.rowBytes / this.unit; }
 layoutRows() {
 this.rows = Math.min(16, Math.ceil(this.span / this.rowBytes));
 this.paged = this.span > this.rowBytes * this.rows;
 }
 setRowBytes(n) {
 if (n === this.rowBytes || n % this.wordBytes !== 0) return;
 this.rowBytes = n;
 this.layoutRows();
 this.base = (this.base - (this.base % this.rowUnits())) >>> 0;
 this.render();
 }
 wordOf(a) {
 return (a - (a % (this.wordBytes / this.unit))) >>> 0;
 }
 resolve(text) {
 const t = text.trim();
 const syms = this.program?.symbols ?? {};
 const sym = Object.hasOwn(syms, t) ? syms[t] : undefined;
 const reg = this.list.find((r) => r.aliases?.[0] === t.toLowerCase());
 const a = sym ?? (reg && this.regs ? this.regs[reg.id] : (/^(0x)?[0-9a-f]+$/i.test(t) ? parseInt(t.replace(/^0x/i, ''), 16) : null));
 return a === null || a === undefined || Number.isNaN(a) ? null : a >>> 0;
 }
 goTo(text) {
 const a = this.resolve(text);
 if (a === null) return;
 this.goToAddress(a);
 }
 goToAddress(a) {
 this.base = this.paged ? (a - (a % this.rowUnits())) >>> 0 : 0;
 this.goto.value = this.hex(a);
 this.render();
 }
 hex(a) {
 return `0x${(a >>> 0).toString(16).padStart(this.addrDigits, '0')}`;
 }
 region(a) {
 const segs = this.program?.segments ?? [];
 const harvard = this.profile?.memory === 'harvard';
 for (const s of segs) {
 if (harvard && s.executable) continue;
 if (a >= s.address && a < s.address + Math.max(s.bytes.length / this.unit, 1)) return s.executable ? STRINGS.regionText : STRINGS.regionData;
 }
 const top = this.profile?.stackTop;
 const sp = this.roles.sp ? this.regs?.[this.roles.sp] : undefined;
 if (top && sp !== undefined && a >= (sp & ~15) && a < top && a >= top - 0x10000) return STRINGS.regionStack;
 return '';
 }
 render() {
 this.base = this.paged ? this.base >>> 0 : 0;
 if (!this.mem) { this.body.replaceChildren(); return; }
 const labels = new Map();
 const harvard = this.profile?.memory === 'harvard';
 for (const s of this.program?.symbolTable ?? []) {
 if (s.section !== 'abs' && !(harvard && s.section === 'text')) labels.set(s.address, s.name);
 }
 const stack = this.profile?.stackTop != null;
 const sp = stack && this.roles.sp ? this.regs?.[this.roles.sp] : undefined;
 const fp = stack && this.roles.fp ? this.regs?.[this.roles.fp] : undefined;
 const W = this.wordBytes;
 const rows = [];
 for (let r = 0; r < this.rows; r++) {
 const a = (this.base + this.rowUnits() * r) >>> 0;
 const cells = [];
 for (let k = 0; k < this.rowBytes; k += this.mode === 'word' ? W : 1) {
 const addr = (a + k / this.unit) >>> 0;
 const size = this.mode === 'word' ? W : 1;
 const n = Math.max(1, size / this.unit);
 const v = (this.view === 'ram' && this.ram ? this.ram : this.mem).read(addr, size);
 const hit = this.written && addr < this.written.addr + this.written.size / this.unit && addr + n > this.written.addr;
 const acc = this.accessed && addr < this.accessed.addr + this.accessed.size / this.unit && addr + n > this.accessed.addr;
 const stale = this.view === 'ram' && this.dirty?.(addr);
 const watched = this.watched?.has(this.wordOf(addr));
 const marks = [addr === sp ? 'sp' : '', addr === fp ? 'fp' : ''].filter(Boolean).join(',');
 const lbl = labels.get(addr);
 cells.push(el(`td.mono${hit ? '.changed' : ''}${acc ? '.accessed' : ''}${stale ? '.dirty' : ''}${watched ? '.watched' : ''}`, {
 title: [this.hex(addr), lbl, marks, hit ? STRINGS.mem.writtenMark : '', acc ? STRINGS.mem.accessedMark : '', stale ? STRINGS.mem.dirtyMark : '',
 watched ? STRINGS.watchedMark : ''].filter(Boolean).join(' · '),
 ondblclick: size === W ? () => this.onWatch?.(addr) : null,
 }, watched && (size === W || addr % (W / this.unit) === 0) ? '👁' : '', hit ? '◆' : '', acc && !hit ? '◇' : '', stale ? '✎' : '', marks ? `‹${marks}›` : '',
 size === 1 ? hex2(v) : (v >>> 0).toString(16).padStart(2 * size, '0')));
 }
 const lbl = [];
 for (let k = 0; k < this.rowUnits(); k++) if (labels.has((a + k) >>> 0)) lbl.push(labels.get((a + k) >>> 0));
 rows.push(el('tr', {}, el('td.mono.addr', { text: this.hex(a) }), cells,
 el('td.note', { text: [this.region(a), lbl.join(' ')].filter(Boolean).join(' · ') })));
 }
 const step = this.mode === 'word' ? W : 1;
 const head = el('tr', {}, el('th', { text: STRINGS.colAddress }),
 Array.from({ length: this.rowBytes / step }, (_, i) => el('th.mono', { text: `+${((i * step) / this.unit).toString(16)}` })), el('th'));
 this.body.replaceChildren(head, ...rows);
 this.regions.textContent = W === 1 ? STRINGS.memByteWordsNote : this.unit > 1 ? STRINGS.memUnitWordsNote(this.unitBits) : this.mode === 'word' ? STRINGS.memWordsNote : STRINGS.memBytesNote;
 }
}
export class CallStackPanel {
 constructor({ onGoTo, unavailable = null, addressBits = 32 }) {
 this.onGoTo = onGoTo;
 this.unavailable = unavailable;
 this.hexA = (a) => hexAddr(a, addressBits);
 this.root = el('div.callstack.scroll');
 }
 update(frames) {
 const T = STRINGS.calls;
 if (this.unavailable) { this.root.replaceChildren(el('p.note', { text: this.unavailable })); return; }
 if (!frames) { this.root.replaceChildren(el('p.note', { text: T.none })); return; }
 if (!frames.length) { this.root.replaceChildren(el('p.note', { text: T.empty })); return; }
 const sig = (v) => String(v | 0);
 this.root.replaceChildren(el('ol.cs-list', { 'aria-label': STRINGS.calls.title }, frames.map((f, i) => el('li.cs-frame', {},
 el('button.cs-head', { type: 'button', title: T.goTo, onclick: () => this.onGoTo?.(f.call) },
 el('span.cs-depth.mono', { text: `#${f.depth}` }), ' ',
 el('b.mono', { text: f.name ?? this.hexA(f.target) }), i === 0 ? el('span.cs-top', { text: ` ${T.innermost}` }) : null),
 el('div.cs-site.mono', { text: T.site(f.site ?? this.hexA(f.call), this.hexA(f.call), this.hexA(f.ret), f.sp === null ? '' : this.hexA(f.sp)) }),
 !f.args.length ? null : el('table.cs-args.mono', { 'aria-label': T.argsLabel(f.depth) }, el('caption', { text: T.args }),
 el('tbody', {}, f.args.filter((_, k) => k % 4 === 0).map((_, r) => el('tr', {}, f.args.slice(4 * r, 4 * r + 4).map((a) =>
 el('td', { title: `${a.name} = ${hex8(a.value)} = ${sig(a.value)}` }, el('span.cs-reg', { text: a.name }), ` ${sig(a.value)}`))))))))),
 el('p.note', { text: T.note }));
 }
}
const cards = (items) => el('dl.counter-cards', {}, items.map(([k, v], i) => el(`div.counter-card${i === 0 ? '.lead' : ''}`, { title: k },
 el('dd.mono', { text: typeof v === 'number' ? v.toLocaleString('en-GB') : String(v) }), el('dt', { text: k }))));
export class CountersPanel {
 constructor() {
 this.root = el('div.counters');
 }
 updateCycles({ cycles, instructions, extra = [] }) {
 const cpi = instructions ? (cycles / instructions).toFixed(2) : '–';
 this.root.replaceChildren(cards([[STRINGS.view.cycles, cycles], [STRINGS.view.instructions, instructions], [STRINGS.view.cpi, cpi], ...extra]));
 }
 show(list) {
 if (!list) { this.root.replaceChildren(); return; }
 this.root.replaceChildren(cards(list));
 }
}
export const OUTPUT_LIMIT = 64 * 1024;
export class ConsolePanel {
 constructor({ onGoTo }) {
 this.onGoTo = onGoTo;
 this.out = el('pre.console-out', { 'aria-live': 'polite', 'aria-label': STRINGS.console });
 this.msgs = el('ul.messages', { 'aria-live': 'polite', 'aria-label': STRINGS.messages });
 this.onNote = null;
 this.root = el('div.console', {}, this.out, this.msgs);
 }
 setOutput(bytes, dropped = 0) {
 const text = new TextDecoder().decode(Uint8Array.from(bytes));
 this.out.textContent = dropped > 0 ? `${STRINGS.outputCut(dropped)}\n${text}` : text;
 }
 clearMessages() { this.msgs.replaceChildren(); this.onNote?.(null); }
 message(text, kind = 'info', loc = null, detail = null) {
 const icon = { error: '✖', warn: '▲', info: 'ℹ', ok: '✔' }[kind] ?? '';
 const link = loc ? el('button.link.msg-loc', { type: 'button', onclick: () => this.onGoTo?.(loc) },
 `${loc.file}:${loc.line}${loc.column ? `:${loc.column}` : ''}`) : null;
 this.msgs.append(el(`li.msg-${kind}`, {}, el('div', {}, `${icon} `, link, link ? ' ' : '', el('span.msg-text', { text })),
 detail ? el('div.msg-hint', { text: detail }) : null));
 this.msgs.scrollTop = this.msgs.scrollHeight;
 this.onNote?.(kind);
 }
}
