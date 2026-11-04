// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8 } from './dom.js';
import { STRINGS } from './strings.js';
import { DatapathView, flowControl } from './datapath.js';
import { PanZoom } from './pan-zoom.js';
import { infoButton } from './info-button.js';
import { NPU_SIGNALS, NPU_BASE, npuSignals, npuRegister, npuPeek, arrayInputs, product, runArray } from '../mem/npu.js';
const S = () => STRINGS.npu;
const NS = 'http://www.w3.org/2000/svg';
const SCALE = 40;
const PT = SCALE * 0.03515;
const LEVELS = ['subsystem', 'array', 'pe', 'system'];
const BUS_SHOWN = 16;
const PAN = { pan: false };
const MIN_HEIGHT = 160;
function paneHeight(box) {
 const pane = box.closest('.npu-main');
 if (!pane) return Infinity;
 const top = box.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
 const pad = parseFloat(getComputedStyle(pane).paddingBottom) || 0;
 return Math.max(MIN_HEIGHT, Math.floor(pane.clientHeight - top - pad - 2));
}
function zoomable(dp, name, maxWidth = Infinity) {
 const pz = new PanZoom(dp.svg, { name, shared: PAN });
 const box = dp.root;
 box.classList.add('npu-zoom');
 pz.bar.remove();
 let watched = null;
 let seen = '';
 const ro = typeof ResizeObserver === 'function'
 ? new ResizeObserver(() => { const k = `${box.clientWidth} ${watched?.clientHeight ?? 0}`; if (k !== seen) { seen = k; sync(); } }) : null;
 const sync = () => {
 const vb = dp.svg.viewBox?.baseVal;
 if (!vb?.width || !box.clientWidth) return;
 const pane = box.closest('.npu-main');
 if (ro && pane && pane !== watched) { if (watched) ro.unobserve(watched); watched = pane; ro.observe(pane); }
 const natural = (Math.min(box.clientWidth, maxWidth) * vb.height) / vb.width;
 box.style.height = `${Math.round(Math.min(natural, paneHeight(box)))}px`;
 pz.fit();
 };
 ro?.observe(box);
 return { sync, bar: pz.bar };
}
const sx = (x) => +(x * SCALE).toFixed(2);
const sy = (y) => +(-y * SCALE).toFixed(2);
function svg(tag, attrs = {}, ...kids) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
 return n;
}
const s8 = (v) => (v << 24) >> 24;
const int8s = (word) => [0, 1, 2, 3].map((j) => s8(word >>> (8 * j)));
const signed = (v) => String(v | 0).replace('-', '−');
const list = (a) => a.map(signed).join(' ');
export function recentBus(view) {
 return view.bus && view.bus.cycle === view.cycle - 1 ? view.bus : null;
}
export function signalTexts(values) {
 const out = new Map();
 for (const [name, v] of Object.entries(values)) {
 let text;
 if (Array.isArray(v)) text = name === 'w_flat' ? v.map((w) => hex8(w)).join(' ') : list(v);
 else if (name.startsWith('d_')) text = hex8(v);
 else text = signed(v);
 out.set(name, { text, tip: S().tip(name, text) });
 }
 return out;
}
function wireMid(geom, id) {
 const w = geom.wires.find((x) => x.id === id);
 if (!w) return null;
 let best = null;
 for (let i = 1; i < w.points.length; i++) {
 const [a, b] = [w.points[i - 1], w.points[i]];
 const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
 if (!best || len > best.len) best = { len, at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
 }
 return best.at;
}
function edgeOf(geom, id, edge = 'bottom', fx = 0.5) {
 const e = geom.elements.find((x) => x.id === id);
 return [e.at[0] - e.size[0] / 2 + fx * e.size[0], e.at[1] + (edge === 'top' ? 1 : -1) * (e.size[1] / 2)];
}
export function npuAccess(S, acc) {
 if (!acc || acc.addr < NPU_BASE || acc.addr >= NPU_BASE + 0x1000) return null;
 const offset = acc.addr - NPU_BASE;
 const register = npuRegister(offset);
 const busy = S.ctrl.state !== 'IDLE';
 if (acc.write) return { kind: 'write', offset, register, value: acc.value >>> 0, ignored: busy, diagnostic: null };
 return { kind: 'read', offset, register, value: npuPeek(S, offset), ignored: false, diagnostic: busy && register.startsWith('RESULT') ? 'result-busy' : null };
}
export function subsystemTransfers(S, bus, geom, n = 4, next = null) {
 const T = STRINGS.npu.flow;
 const flow = [];
 const wires = new Set();
 const nextWires = new Set();
 const elements = new Set();
 const tags = [];
 const lines = [];
 const go = (id, at, reverse = false, coming = false) => {
 flow.push({ id, at, reverse });
 if (coming) { if (!wires.has(id)) nextWires.add(id); } else { wires.add(id); nextWires.delete(id); }
 wires.add(id);
 };
 const tag = (t) => {
 const at = [...t.at];
 while (tags.some((o) => Math.abs(o.at[0] - at[0]) < 0.6 && Math.abs(o.at[1] - at[1]) < 0.25)) at[1] -= 0.32;
 tags.push({ ...t, at });
 };
 const access = (a, when) => {
 const coming = when === 'now';
 const t0 = coming ? 0.4 : 0;
 const t1 = coming ? 0.7 : 0.3;
 const mark = (text) => (coming ? T.tagNext(text) : text);
 const say = (text) => lines.push({ when, text: coming && a.kind === 'write' && !a.ignored ? `${text.replace(/\.$/, '')}, ${T.atEdge}.` : text });
 const reg = a.register;
 elements.add('rif');
 if (a.kind === 'write' && a.ignored) {
 go('d_bus', t0, false, coming);
 say(T.ignored(reg || hex8(NPU_BASE + a.offset), hex8(a.value)));
 } else if (a.kind === 'write') {
 go('d_bus', t0, false, coming);
 const i = Number(reg.slice(-1));
 if (reg.startsWith('WEIGHT')) {
 go('rif_wbuf', t1, false, coming); elements.add('wbuf');
 tag({ at: edgeOf(geom, 'wbuf'), text: mark(T.tagWeight(i, hex8(a.value))) });
 say(T.weight(i, hex8(a.value), list(int8s(a.value))));
 } else if (reg.startsWith('ACT')) {
 go('rif_abuf', t1, false, coming); elements.add('abuf');
 tag({ at: edgeOf(geom, 'abuf'), text: mark(T.tagAct(i, signed(s8(a.value)))) });
 say(T.act(i, hex8(a.value), signed(s8(a.value))));
 } else if (reg === 'CTRL') {
 go('ctrl_in', t1, false, coming); elements.add('ctrl');
 const what = T.ctrlBits((a.value & 1) !== 0, (a.value & 2) !== 0);
 tag({ at: edgeOf(geom, 'ctrl', 'top', 0.5), text: mark(T.tagCtrl(what)) });
 say(T.ctrl(hex8(a.value), what));
 } else {
 say(T.unused(hex8(NPU_BASE + a.offset), hex8(a.value)));
 }
 } else {
 const value = hex8(a.value);
 if (reg === 'STATUS') {
 go('status', t0, false, coming); elements.add('ctrl');
 tag({ at: edgeOf(geom, 'rif', 'top'), text: mark(T.tagStatus(value)) });
 say(T.status(value, a.value & 1, (a.value >> 1) & 1));
 } else if (reg.startsWith('RESULT')) {
 const i = Number(reg.slice(-1));
 go('rbuf_rif', t0, false, coming); elements.add('rbuf');
 tag({ at: edgeOf(geom, 'rbuf'), text: mark(T.tagResultRead(i, signed(a.value))) });
 say(T.result(i, value, signed(a.value), Boolean(a.diagnostic)));
 } else {
 say(T.readOther(reg || hex8(NPU_BASE + a.offset), value));
 }
 go('d_bus', t1, true, coming);
 }
 };
 if (bus) access(bus, 'done');
 const { state, step } = S.ctrl;
 const now = (text) => lines.push({ when: 'now', text });
 if (state === 'LOADW') {
 go('w_load', 0.3); go('weights', 0.45);
 elements.add('ctrl').add('wbuf').add('arr');
 for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) elements.add(`p${r}${c}`);
 tag({ at: wireMid(geom, 'weights'), text: T.tagLoadw });
 now(T.loadw(n));
 } else if (state === 'RUN') {
 go('run_step', 0.3);
 elements.add('ctrl').add('arr');
 if (step < n) {
 const x = s8(S.act[step]);
 go('abuf_skew', 0.4); go(`skew_r${step}`, 0.55);
 elements.add('abuf').add('skew');
 tag({ at: wireMid(geom, `skew_r${step}`), anchor: 'south', text: T.tagSkew(step, signed(x)) });
 now(T.skew(step, signed(x)));
 }
 const macs = [];
 for (let r = 0; r < n; r++) {
 for (let c = 0; c < n; c++) {
 if (r + c === step) { macs.push(`(${r}, ${c})`); elements.add(`p${r}${c}`); }
 if (r + c + 1 === step) {
 if (c < n - 1) { go(`a${r}${c}`, 0.55); elements.add(`p${r}${c + 1}`); }
 if (r < n - 1) { go(`p${r}${c}_${r + 1}${c}`, 0.55); elements.add(`p${r + 1}${c}`); }
 }
 }
 }
 if (macs.length) now(T.macs(macs.join(', ')));
 if (step >= n) {
 const c = step - n;
 const y = S.arr.p[n - 1][c];
 const before = S.result[c];
 go(`sum${c}`, 0.55); go('sums_rbuf', 0.75);
 elements.add(`p${n - 1}${c}`).add('rbuf');
 tag({ at: edgeOf(geom, 'rbuf', 'top'), text: T.tagSum(c, signed(y)) });
 now(T.sum(c, signed(y), signed(before), signed((before + y) | 0)));
 }
 }
 const coming = npuAccess(S, next);
 if (coming) access(coming, 'now');
 else if (next) now(T.elsewhere(next.write, hex8(next.addr)));
 return { flow, wires, next: nextWires, elements, tags, lines };
}
function movesList(lines) {
 if (!lines.length) return [];
 return [el('ul.npu-moves', {}, lines.map((l) => el(`li.npu-${l.when}`, {}, el('strong', { text: `${S().flow.when[l.when]}: ` }), l.text)))];
}
export const REGIONS = Object.freeze({
 whole: null,
 iface: ['rif', 'wbuf', 'abuf', 'rbuf'],
 ctrl: ['ctrl', 'p00', 'p03'],
 array: ['skew', 'arr'],
 sums: ['p30', 'p33'],
});
const DOWN = { sums: ['rbuf'] };
const REGION_MARGIN = 0.6;
export function regionBox(geom, region) {
 const els = geom.elements.filter((e) => e.size);
 const box = (list, m) => ({
 x0: Math.min(...list.map((e) => e.at[0] - e.size[0] / 2)) - m, y0: Math.min(...list.map((e) => e.at[1] - e.size[1] / 2)) - m,
 x1: Math.max(...list.map((e) => e.at[0] + e.size[0] / 2)) + m, y1: Math.max(...list.map((e) => e.at[1] + e.size[1] / 2)) + m,
 });
 const ids = REGIONS[region];
 if (!ids) return null;
 const all = box(els, REGION_MARGIN);
 const b = box(els.filter((e) => ids.includes(e.id)), REGION_MARGIN);
 const down = els.filter((e) => DOWN[region]?.includes(e.id));
 if (down.length) b.y0 = Math.min(b.y0, box(down, REGION_MARGIN).y0);
 return { x0: Math.max(b.x0, all.x0), y0: Math.max(b.y0, all.y0), x1: Math.min(b.x1, all.x1), y1: Math.min(b.y1, all.y1) };
}
const viewBoxOf = (b) => `${sx(b.x0)} ${sy(b.y1)} ${+((b.x1 - b.x0) * SCALE).toFixed(2)} ${+((b.y1 - b.y0) * SCALE).toFixed(2)}`;
class MiniMap {
 constructor(geom, onPick) {
 const els = geom.elements.filter((e) => e.size && e.type !== 'boundary');
 const all = { x0: Math.min(...els.map((e) => e.at[0] - e.size[0] / 2)) - 0.3, y0: Math.min(...els.map((e) => e.at[1] - e.size[1] / 2)) - 0.3,
 x1: Math.max(...els.map((e) => e.at[0] + e.size[0] / 2)) + 0.3, y1: Math.max(...els.map((e) => e.at[1] + e.size[1] / 2)) + 0.3 };
 this.frame = svg('rect', { class: 'npu-mm-frame' });
 this.svg = svg('svg', { class: 'npu-minimap', viewBox: viewBoxOf(all), 'aria-hidden': 'true' },
 els.map((e) => svg('rect', { class: `npu-mm-el npu-mm-${e.type}`, x: sx(e.at[0] - e.size[0] / 2), y: sy(e.at[1] + e.size[1] / 2),
 width: +(e.size[0] * SCALE).toFixed(2), height: +(e.size[1] * SCALE).toFixed(2) })), this.frame);
 this.boxes = Object.keys(REGIONS).filter((r) => REGIONS[r]).map((r) => [r, regionBox(geom, r)]);
 this.svg.addEventListener('click', (ev) => {
 const pt = this.svg.createSVGPoint?.();
 const m = this.svg.getScreenCTM?.();
 if (!pt || !m) return;
 pt.x = ev.clientX; pt.y = ev.clientY;
 const p = pt.matrixTransform(m.inverse());
 const x = p.x / SCALE;
 const y = -p.y / SCALE;
 const hit = this.boxes.filter(([, b]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1)
 .sort((a, b) => (a[1].x1 - a[1].x0) * (a[1].y1 - a[1].y0) - (b[1].x1 - b[1].x0) * (b[1].y1 - b[1].y0))[0];
 if (hit) onPick(hit[0]);
 });
 }
 show(b) {
 for (const [k, v] of Object.entries({ x: sx(b.x0), y: sy(b.y1), width: +((b.x1 - b.x0) * SCALE).toFixed(2), height: +((b.y1 - b.y0) * SCALE).toFixed(2) })) this.frame.setAttribute(k, v);
 }
}
const DATA_WIDTHS = Object.fromEntries(Object.entries(NPU_SIGNALS).filter(([k]) => !['start', 'clear', 'busy', 'done', 'w_load', 'run', 'step', 'sel_acc'].includes(k)));
class Subsystem {
 constructor(geom, onPe) {
 const g = { ...geom.subsystem, pics: geom.pics ?? {} };
 this.dp = new DatapathView(g, { title: S().subsystemTitle, description: S().subsystemDesc(''), ids: 'npu-sub', info: DATA_WIDTHS, textSize: 9.84,
 valueAt: { act: { at: [3.5, 2.08], anchor: 'north' }, result: { at: [3.5, -0.12], anchor: 'north' },
 ...Object.fromEntries([0, 1, 2, 3].flatMap((k) => [[`a_left[${k}]`, { at: [7.06, 4.1 - 0.9 * k - 0.06], anchor: 'north' }],
 [`psum_bottom[${k}]`, { at: [7.9 + 0.9 * k - 0.06, 0.72], anchor: 'east' }]])) } });
 const targets = Object.fromEntries(g.elements.filter((e) => e.type === 'pe').map((e) => [e.id, true]));
 this.dp.setLinks(targets, (id) => onPe(Number(id[1]), Number(id[2])), Object.fromEntries(Object.keys(targets).map((id) => [id, S().peCell(id[1], id[2])])));
 this.line = el('div.note.npu-cycle', { 'aria-live': 'polite' });
 this.flowCycle = -1;
 const box = el('input', { type: 'checkbox', onchange: (e) => this.dp.setShowAll(e.target.checked) });
 this.values = el('label.toggle', { title: S().showValuesTitle }, box, ` ${S().showValues}`);
 this.wholeBox = this.dp.svg.getAttribute('viewBox');
 const zoom = zoomable(this.dp, S().subsystemTitle);
 this.zoomSync = zoom.sync;
 this.head = [zoom.bar];
 this.region = el('select', { onchange: (e) => this.focus(e.target.value) },
 Object.keys(REGIONS).map((r) => el('option', { value: r, text: S().regions[r] })));
 this.mini = new MiniMap(g, (r) => this.focus(r));
 this.miniBox = el('div.npu-mm', { hidden: true }, this.mini.svg);
 this.regs = el('div');
 this.ctrl = el('dl.pf-cpudl');
 this.bus = el('div');
 this.root = el('section.npu-level.npu-sub', {},
 el('div.npu-tools', {}, this.values, el('label', { title: S().regionTitle }, `${S().region} `, this.region), this.miniBox), this.dp.root, this.line,
 el('h4', { text: S().regsHeading }), this.regs, el('h4', { text: S().ctrlHeading }), this.ctrl,
 el('h4', { text: S().busHeading }), this.bus);
 }
 focus(region) {
 const b = regionBox(this.dp.geom, region);
 this.region.value = b ? region : 'whole';
 this.dp.svg.setAttribute('viewBox', b ? viewBoxOf(b) : this.wholeBox);
 this.miniBox.hidden = !b;
 if (b) this.mini.show(b);
 this.zoomSync();
 }
 update(npu, ms = 0, next = null) {
 const v = npu.view();
 const bus = recentBus(v);
 const { values, active } = npuSignals(npu.visible, bus, npu.n);
 const tr = subsystemTransfers(npu.visible, bus, this.dp.geom, npu.n, next);
 const wires = new Set([...active, ...tr.wires]);
 this.dp.setPath(wires.size ? { wires, elements: tr.elements } : null, null);
 this.dp.setNext(tr.next);
 const texts = signalTexts(values);
 this.dp.setValues(texts, texts);
 this.dp.setAnnotations([]);
 const ctrl = this.dp.geom.elements.find((e) => e.id === 'ctrl');
 this.dp.setStateTags([{ at: [this.dp.geom.wires.find((w) => w.id === 'w_load').points[0][0] - 0.1, ctrl.at[1] - ctrl.size[1] / 2 - 0.12], anchor: 'north east', text: S().badge(v.ctrl.state, v.ctrl.step) },
 ...tr.tags.map((t) => ({ anchor: 'center', ...t }))]);
 this.dp.setMarks(bus?.ignored ? [{ id: 'rif', kind: 'hold', text: S().ignoredMark }] : []);
 if (v.cycle !== this.flowCycle) {
 this.flowCycle = v.cycle;
 this.dp.animate(ms ? tr.flow : [], ms);
 }
 const line = S().cycleLine(v.cycle, v.ctrl.state, v.ctrl.step);
 this.line.replaceChildren(el('span', { text: line }), ...movesList(tr.lines));
 this.dp.setDescription(S().subsystemDesc([line, ...tr.lines.map((l) => `${S().flow.when[l.when]}: ${l.text}`)].join(' ')));
 this.drawRegisters(v);
 this.drawController(v);
 this.drawBus(npu);
 }
 drawRegisters(v) {
 const T = S();
 const busy = v.ctrl.busy ? 1 : 0;
 const done = v.ctrl.done ? 1 : 0;
 const rows = [
 ['STATUS', hex8(busy | (done << 1)), T.statusMeaning(busy, done)],
 ...v.regs.weight.map((w, i) => [`WEIGHT[${i}]`, hex8(w), `${T.weightRow(i)}: ${list(int8s(w))}`]),
 ...v.regs.act.map((a, j) => [`ACT[${j}]`, hex8(a), `${T.actMeaning(j)} = ${signed(a)}`]),
 ...v.regs.result.map((r, i) => [`RESULT[${i}]`, hex8(r), `${T.resultMeaning(i)} = ${signed(r)}`]),
 ];
 this.regs.replaceChildren(el('table.listing.mem-table', {}, el('tbody', {},
 el('tr', {}, [T.colRegister, T.colValue, T.colMeaning].map((t) => el('th', { text: t }))),
 ...rows.map((r) => el('tr', {}, el('td.mono', { text: r[0] }), el('td.mono', { text: r[1] }), el('td', { text: r[2] }))))));
 }
 drawController(v) {
 const R = S().ctrlRows;
 const o = v.ctrl;
 this.ctrl.replaceChildren(...[[R.state, o.state], [R.step, o.step], [R.busy, o.busy ? 1 : 0], [R.done, o.done ? 1 : 0],
 [R.wLoad, o.w_load ? 1 : 0], [R.run, o.run ? 1 : 0]].flatMap(([k, x]) => [el('dt', { text: k }), el('dd.mono', { text: String(x) })]));
 }
 drawBus(npu) {
 const T = S();
 const C = T.busCols;
 const log = npu.log;
 if (!log.length) { this.bus.replaceChildren(el('p.note', { text: T.busNone })); return; }
 const shown = log.slice(-BUS_SHOWN);
 const note = (e) => (e.ignored ? T.busIgnored : e.diagnostic ? T.busPartial : '');
 this.bus.replaceChildren(
 ...(log.length > shown.length ? [el('p.note', { text: T.busMore(log.length - shown.length) })] : []),
 el('table.listing.mem-table', {}, el('tbody', {},
 el('tr', {}, [C.cycle, C.kind, C.register, C.value, C.note].map((t) => el('th', { text: t }))),
 ...shown.map((e) => el(`tr${e.ignored || e.diagnostic ? '.npu-warn' : ''}`, {}, el('td.mono', { text: String(e.cycle) }), el('td', { text: T.busKinds[e.kind] }),
 el('td.mono', { text: e.register || hex8(NPU_BASE + e.offset) }), el('td.mono', { text: hex8(e.value) }), el('td', { text: note(e) }))))),
 ...(npu.logDropped ? [el('p.note', { text: T.busDropped(npu.logDropped) })] : []));
 }
}
export function parseRows(text, n, rows = n) {
 const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
 if (rows !== null && lines.length !== rows) return null;
 if (!lines.length) return null;
 const out = lines.map((l) => l.split(/[\s,;]+/).filter(Boolean).map((t) => Number(t.replace('−', '-'))));
 return out.every((r) => r.length === n && r.every((x) => Number.isInteger(x) && x >= -128 && x <= 127)) ? out : null;
}
export function figureExample(geom) {
 const pe = geom.array_figure.weights;
 return { W: pe[0].map((_, c) => pe.map((row) => row[c])), X: [[5, -2]] };
}
class ArrayExplorer {
 constructor(geom, getNpu) {
 this.geom = geom;
 this.getNpu = getNpu;
 this.n = 2;
 this.step = 0;
 this.all = false;
 const T = S();
 this.size = el('select', { 'aria-label': T.size, onchange: (e) => { this.setN(Number(e.target.value)); } },
 [2, 3, 4].map((n) => el('option', { value: n, text: String(n) })));
 this.wIn = el('textarea.npu-text', { rows: 2, spellcheck: 'false', 'aria-label': T.weights, title: T.weightsTitle, oninput: () => this.recompute() });
 this.xIn = el('textarea.npu-text', { rows: 2, spellcheck: 'false', 'aria-label': T.vectors, title: T.vectorsTitle, oninput: () => this.recompute() });
 this.slider = el('input', { type: 'range', min: 0, max: 0, value: 0, 'aria-label': T.step, oninput: (e) => { this.step = Number(e.target.value); this.draw(); } });
 this.stepText = el('span.mono.npu-steptext');
 this.allBox = el('input', { type: 'checkbox', onchange: (e) => { this.all = e.target.checked; this.draw(); } });
 this.bounds = false;
 this.boundsBox = el('input', { type: 'checkbox', onchange: (e) => { this.bounds = e.target.checked; this.draw(); } });
 this.err = el('p.note.npu-err', { role: 'status' });
 this.panels = el('div.npu-panels');
 this.out = el('ul.npu-out');
 const btn = (text, title, fn) => el('button', { type: 'button', text, title, onclick: fn });
 this.head = [infoButton([T.arrayIntro, T.legend, T.boundsNote], T.about(T.levelNames.array))];
 this.root = el('section.npu-level', {},
 el('div.npu-tools', {}, el('label', {}, `${T.size} `, this.size), btn(T.figureDefault, T.figureDefaultTitle, () => this.example()),
 btn(T.fromNpu, T.fromNpuTitle, () => this.fromNpu())),
 el('div.npu-inputs', {}, el('label', {}, el('span', { text: T.weights }), this.wIn), el('label', {}, el('span', { text: T.vectors }), this.xIn)),
 this.err,
 el('div.npu-tools', {}, btn('◀', T.prevStep, () => this.move(-1)), this.slider, btn('▶', T.nextStep, () => this.move(1)), this.stepText,
 el('label.toggle', { title: T.allStepsTitle }, this.allBox, ` ${T.allSteps}`),
 el('label.toggle', { title: T.boundsTitle }, this.boundsBox, ` ${T.bounds}`)),
 this.panels, this.out);
 this.example();
 }
 setN(n) {
 this.n = n;
 this.size.value = String(n);
 this.wIn.rows = n;
 }
 example() {
 const { W, X } = figureExample(this.geom);
 this.setN(W.length);
 this.wIn.value = W.map((r) => r.join(' ')).join('\n');
 this.xIn.value = X.map((r) => r.join(' ')).join('\n');
 this.step = 0;
 this.recompute();
 }
 fromNpu() {
 const npu = this.getNpu();
 if (!npu) return;
 const v = npu.view();
 this.setN(npu.n);
 this.wIn.value = v.regs.weight.map((w) => int8s(w).join(' ')).join('\n');
 this.xIn.value = v.regs.act.map((a) => s8(a)).join(' ');
 this.step = 0;
 this.recompute();
 }
 move(d) {
 if (!this.run) return;
 this.step = Math.max(0, Math.min(this.run.steps.length - 1, this.step + d));
 this.draw();
 }
 recompute() {
 const W = parseRows(this.wIn.value, this.n);
 const X = parseRows(this.xIn.value, this.n, null);
 const bad = !W ? S().weights : !X ? S().vectors : null;
 this.err.textContent = bad ? S().inputError(bad) : '';
 this.run = bad ? null : runArray(W, X);
 if (this.run) this.step = Math.min(this.step, this.run.steps.length - 1);
 this.draw();
 }
 draw() {
 const run = this.run;
 if (!run) { this.panels.replaceChildren(); this.out.replaceChildren(); this.stepText.textContent = ''; return; }
 const total = run.steps.length;
 this.slider.max = String(total - 1);
 this.slider.value = String(this.step);
 this.slider.disabled = this.all;
 this.stepText.textContent = S().stepOf(this.step, total);
 const which = this.all ? run.steps.map((_, s) => s) : [this.step];
 this.panels.replaceChildren(...which.map((s) => panel(this.geom.array[String(run.n)], run, s, { bounds: this.bounds })));
 this.out.replaceChildren(el('li', { text: S().stepsTotal(run.B, run.n, total) }),
 ...run.y.map((y, b) => el('li.mono', { text: S().outputs(run.B > 1 ? b : null, y.map(signed), run.outSteps[b]) })));
 }
}
export function panelModel(run, s) {
 const st = run.steps[s];
 const { n, B } = run;
 const pes = [];
 for (let r = 0; r < n; r++) {
 for (let c = 0; c < n; c++) {
 const b = s - r - c;
 pes.push({ id: `pe${r}${c}`, r, c, w: st.w[r][c], a: b >= 0 && b < B ? st.aIn[r][c] : null, p: st.p[r][c] });
 }
 }
 const inputs = st.aLeft.map((a, r) => (s - r >= 0 && s - r < B ? a : null));
 const outputs = new Array(n).fill(null);
 for (const o of st.out) outputs[o.c] = { b: o.b, y: o.y };
 return { pes, inputs, outputs };
}
export function registerBoundaries(g) {
 const pes = g.elements.filter((e) => /^pe\d\d$/.test(e.id));
 const n = Math.round(Math.sqrt(pes.length));
 const at = (r, c) => pes.find((e) => e.id === `pe${r}${c}`);
 const left = (e) => e.at[0] - e.size[0] / 2;
 const right = (e) => e.at[0] + e.size[0] / 2;
 const top = (e) => e.at[1] + e.size[1] / 2;
 const bot = (e) => e.at[1] - e.size[1] / 2;
 const pad = 0.12;
 const x0 = left(at(0, 0)) - pad;
 const x1 = right(at(0, n - 1)) + pad;
 const y1 = top(at(0, 0)) + pad;
 const out = g.wires.filter((w) => /^out\d$/.test(w.id));
 const yOut = out.length ? (out[0].points[0][1] + out[0].points[out[0].points.length - 1][1]) / 2 : bot(at(n - 1, 0)) - 0.15;
 const lines = [];
 for (let c = 0; c < n - 1; c++) {
 const x = (right(at(0, c)) + left(at(0, c + 1))) / 2;
 lines.push({ kind: 'a', x1: x, y1, x2: x, y2: yOut });
 }
 for (let r = 0; r < n - 1; r++) {
 const y = (bot(at(r, 0)) + top(at(r + 1, 0))) / 2;
 lines.push({ kind: 'psum', x1: x0, y1: y, x2: x1, y2: y });
 }
 lines.push({ kind: 'out', x1: x0, y1: yOut, x2: x1, y2: yOut });
 return lines;
}
let panelIds = 0;
function panel(g, run, s, { bounds = false } = {}) {
 const T = S();
 const tip = `npu-tip-${panelIds += 1}`;
 const m = panelModel(run, s);
 const xs = g.elements.flatMap((e) => [e.at[0] - e.size[0] / 2, e.at[0] + e.size[0] / 2]);
 const ys = g.elements.flatMap((e) => [e.at[1] - e.size[1] / 2, e.at[1] + e.size[1] / 2]);
 const x0 = -0.15;
 const x1 = Math.max(...xs) + 0.3;
 const y1 = g.title.at[1] + 0.35;
 const y0 = Math.min(...ys) - 0.95;
 const label = [T.arrayDesc(s, run.n), ...(bounds ? [T.boundsDesc] : []), ...m.pes.map((p) => `PE (${p.r}, ${p.c}): w ${p.w}${p.a === null ? '' : `, a ${p.a}`}, p ${p.p}`),
 ...m.outputs.flatMap((o, c) => (o ? [`y${c} = ${o.y}`] : []))].join('; ');
 const root = svg('svg', { viewBox: `${sx(x0)} ${sy(y1)} ${(x1 - x0) * SCALE} ${(y1 - y0) * SCALE}`, class: 'dp npu-panel', role: 'img', 'aria-label': label });
 root.append(svg('text', { x: sx(g.title.at[0]), y: sy(g.title.at[1]), 'dominant-baseline': 'central', class: 'dp-figtitle' }, T.stepTitle(s)));
 for (const w of g.wires) {
 const p = w.points;
 root.append(svg('polyline', { points: p.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' '), class: 'npu-link', 'marker-end': `url(#${tip})` }));
 }
 root.prepend(svg('defs', {}, svg('marker', { id: tip, class: 'dp-arrow dp-arrow-normal', markerUnits: 'userSpaceOnUse', markerWidth: 10, markerHeight: 10,
 viewBox: '-8 -4 9 8', refX: 0, refY: 0, orient: 'auto' }, svg('path', { d: 'M0,0 L-7,-2.8 L-5.2,0 L-7,2.8 Z' }))));
 for (const e of g.elements) {
 const p = m.pes.find((q) => q.id === e.id);
 const [w, h] = e.size;
 const grp = svg('g', { class: `npu-pe${p.a !== null ? ' npu-act' : ''}` },
 svg('rect', { x: sx(e.at[0] - w / 2), y: sy(e.at[1] + h / 2), width: w * SCALE, height: h * SCALE, class: 'dp-shape' }));
 const lines = [`${T.peText.w} = ${signed(p.w)}`, p.a === null ? '' : `${T.peText.a} = ${signed(p.a)}`, `${T.peText.p} = ${signed(p.p)}`];
 lines.forEach((t, i) => grp.append(svg('text', { x: sx(e.at[0]), y: sy(e.at[1]) + (i - 1) * 11.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'npu-petext' }, t)));
 root.append(grp);
 }
 if (bounds) {
 root.append(svg('g', { class: 'npu-bounds', 'aria-hidden': 'true' }, registerBoundaries(g).map((b) =>
 svg('line', { x1: sx(b.x1), y1: sy(b.y1), x2: sx(b.x2), y2: sy(b.y2), class: `npu-bound npu-bound-${b.kind}` }))));
 }
 for (const w of g.wires) {
 if (!w.value_at) continue;
 const k = Number(w.id.slice(-1));
 const text = w.id.startsWith('in') ? (m.inputs[k] === null ? '' : signed(m.inputs[k]))
 : m.outputs[k] ? `y${k}${run.B > 1 ? `[${m.outputs[k].b}]` : ''} = ${signed(m.outputs[k].y)}` : '';
 if (!text) continue;
 const south = w.value_at.anchor.includes('south');
 root.append(svg('text', { x: sx(w.value_at.at[0]) + (w.value_at.anchor.includes('west') ? 0.5 * PT : 0), y: sy(w.value_at.at[1]) + (south ? -0.5 * PT : 2 * PT),
 'text-anchor': w.value_at.anchor.includes('west') ? 'start' : 'middle', 'dominant-baseline': south ? 'text-after-edge' : 'text-before-edge', class: 'dp-figlabel' }, text));
 }
 return root;
}
export function peGeometry() {
 const P = S().peParts;
 return {
 pics: {},
 elements: [
 { id: 'pe', type: 'boundary', at: [4.05, 3.4], size: [7.1, 5.8] },
 { id: 'wreg', type: 'reg', at: [1.4, 2.0], size: [1.0, 0.8], text: 'w' },
 { id: 'mul', type: 'comb', at: [1.4, 3.6], size: [0.9, 0.8], text: P.mul },
 { id: 'sext', type: 'comb', at: [3.0, 3.6], size: [1.4, 0.8], text: 'sext' },
 { id: 'add', type: 'comb', at: [4.6, 3.6], size: [0.8, 0.8], text: P.add },
 { id: 'preg', type: 'reg', at: [4.6, 2.0], size: [1.2, 0.8], text: 'psum' },
 { id: 'areg', type: 'reg', at: [6.6, 5.4], size: [1.0, 0.8], text: 'a' },
 ],
 labels: [{ type: 'label', style: 'small', at: [0.6, 6.25], anchor: 'north west', text: 'pe' }],
 wires: [
 { id: 'a_in', style: 'wire', arrow: true, points: [[-0.4, 5.4], [6.1, 5.4]], signal: 'a_in', labels: [{ text: 'a_in', at: [-0.4, 5.4], place: 'above' }] },
 { id: 'a_mul', style: 'wire', arrow: true, points: [[1.4, 5.4], [1.4, 4.0]], signal: 'a_in', labels: [] },
 { id: 'a_out', style: 'wire', arrow: true, points: [[7.1, 5.4], [8.4, 5.4]], signal: 'a_out', labels: [{ text: 'a_out', at: [8.4, 5.4], place: 'above' }] },
 { id: 'w_in', style: 'wire', arrow: true, points: [[-0.4, 2.0], [0.9, 2.0]], signal: 'w_in', labels: [{ text: 'w_in', at: [-0.4, 2.0], place: 'above' }] },
 { id: 'w_mul', style: 'wire', arrow: true, points: [[1.4, 2.4], [1.4, 3.2]], signal: 'w', labels: [] },
 { id: 'prod', style: 'bus', arrow: true, points: [[1.85, 3.6], [2.3, 3.6]], signal: 'prod', labels: [] },
 { id: 'ext', style: 'bus', arrow: true, points: [[3.7, 3.6], [4.2, 3.6]], signal: 'ext', labels: [] },
 { id: 'psum_in', style: 'bus', arrow: true, points: [[4.6, 7.2], [4.6, 4.0]], signal: 'psum_in', labels: [{ text: 'psum_in', at: [4.6, 7.2], place: 'right' }] },
 { id: 'sum', style: 'bus', arrow: true, points: [[4.6, 3.2], [4.6, 2.4]], signal: 'sum', labels: [] },
 { id: 'psum_out', style: 'bus', arrow: true, points: [[4.6, 1.6], [4.6, -0.2]], signal: 'psum_out', labels: [{ text: 'psum_out', at: [4.6, -0.2], place: 'right' }] },
 ],
 junctions: [[1.4, 5.4]],
 control: [{ signal: 'w_load', points: [[1.4, 0.3], [1.4, 1.6]], text: 'w_load', place: 'right' }],
 };
}
const PE_INFO = { a_in: { width: 8 }, a_out: { width: 8 }, w_in: { width: 8 }, w: { width: 8 }, prod: { width: 16 }, ext: { width: 32 },
 psum_in: { width: 32 }, sum: { width: 32 }, psum_out: { width: 32 }, w_load: { width: 1 } };
export function peValues(state, r, c) {
 const { arr, ctrl, act } = state;
 const n = arr.n;
 const { aIn, pIn } = arrayInputs(arr, Array.from({ length: n }, (_, k) => (ctrl.state === 'RUN' && ctrl.step === k ? act[k] : 0)));
 const a = aIn[r][c];
 const w = arr.w[r][c];
 const prod = product(a, w);
 return { a_in: a, w, w_in: 0, prod, ext: prod, psum_in: pIn[r][c], sum: (pIn[r][c] + prod) | 0, a_out: arr.a[r][c], psum_out: arr.p[r][c], w_load: ctrl.state === 'LOADW' ? 1 : 0 };
}
export function peTransfers(state, r, c) {
 const T = STRINGS.npu.flow;
 const { ctrl } = state;
 const flow = [];
 const elements = new Set(['pe']);
 const lines = [];
 const go = (id, at) => flow.push({ id, at });
 if (ctrl.state === 'LOADW') {
 go('w_in', 0);
 elements.add('wreg');
 lines.push({ when: 'now', text: T.peLoad(r, c, signed(s8(state.weight[c] >>> (8 * r)))) });
 } else if (ctrl.state === 'RUN' && ctrl.step === r + c) {
 const v = peValues(state, r, c);
 go('a_in', 0); go('psum_in', 0); go('w_mul', 0.1); go('a_mul', 0.25); go('prod', 0.4); go('ext', 0.55); go('sum', 0.7);
 for (const id of ['wreg', 'mul', 'sext', 'add', 'preg', 'areg']) elements.add(id);
 lines.push({ when: 'now', text: T.peMac(r, c, signed(v.a_in), signed(v.w), signed(v.prod), signed(v.psum_in), signed(v.sum)) });
 } else if (ctrl.state === 'RUN' && ctrl.step === r + c + 1) {
 const v = peValues(state, r, c);
 go('a_out', 0); go('psum_out', 0);
 elements.add('areg').add('preg');
 lines.push({ when: 'now', text: T.peOut(r, c, signed(v.a_out), signed(v.psum_out), state.arr.n) });
 }
 if (!flow.length) elements.clear();
 return { flow, wires: new Set(flow.map((f) => f.id)), elements, lines };
}
class PeLevel {
 constructor() {
 this.r = 0;
 this.c = 0;
 const g = peGeometry();
 this.dp = new DatapathView(g, { title: S().levelNames.pe, description: S().peDesc(0, 0), ids: 'npu-pe', info: PE_INFO,
 valueAt: { a_in: { at: [-0.2, 5.4], anchor: 'north west' }, w: { at: [1.4, 2.9], anchor: 'east' }, prod: { at: [2.05, 4.0], anchor: 'south' },
 ext: { at: [3.95, 3.15], anchor: 'north' }, psum_in: { at: [4.6, 6.2], anchor: 'west' }, sum: { at: [4.65, 2.8], anchor: 'west' },
 a_out: { at: [7.7, 5.4], anchor: 'north' }, psum_out: { at: [4.65, 0.6], anchor: 'west' } } });
 this.dp.setShowAll(true);
 this.head = [infoButton([S().peIntro, S().peDrawn], S().about(S().levelNames.pe)), zoomable(this.dp, S().levelNames.pe, 480).bar];
 this.pick = el('select', { 'aria-label': S().peChoose, onchange: (e) => { const [r, c] = e.target.value.split(',').map(Number); this.choose(r, c); } });
 this.table = el('dl.pf-cpudl');
 this.line = el('div.note.npu-cycle', { 'aria-live': 'polite' });
 this.flowKey = '';
 this.root = el('section.npu-level', {}, el('div.npu-tools', {}, el('label', {}, `${S().peChoose} `, this.pick)), this.dp.root, this.line, this.table);
 }
 choose(r, c) {
 this.r = r;
 this.c = c;
 this.onChange?.();
 }
 update(npu, ms = 0) {
 const tr = peTransfers(npu.visible, this.r, this.c);
 this.dp.setPath(tr.flow.length ? { wires: tr.wires, elements: tr.elements } : null, null);
 const key = `${npu.view().cycle} ${this.r} ${this.c}`;
 if (key !== this.flowKey) { this.flowKey = key; this.dp.animate(ms ? tr.flow : [], ms); }
 this.line.replaceChildren(...(tr.lines.length ? movesList(tr.lines) : [el('span', { text: S().flow.peQuiet(this.r, this.c) })]));
 const n = npu.n;
 if (this.pick.options.length !== n * n) {
 this.pick.replaceChildren(...Array.from({ length: n * n }, (_, k) => el('option', { value: `${Math.floor(k / n)},${k % n}`, text: S().peCell(Math.floor(k / n), k % n) })));
 }
 this.pick.value = `${this.r},${this.c}`;
 const v = peValues(npu.visible, this.r, this.c);
 const texts = new Map(Object.entries(v).map(([k, x]) => [k, { text: signed(x), tip: S().tip(k, signed(x)) }]));
 this.dp.setValues(texts, texts);
 this.dp.setDescription([S().peDesc(this.r, this.c), ...tr.lines.map((l) => l.text)].join(' '));
 const V = S().peValues;
 this.table.replaceChildren(...[['aIn', v.a_in], ['w', v.w], ['prod', v.prod], ['sext', v.ext], ['pIn', v.psum_in], ['sum', v.sum], ['aOut', v.a_out], ['pOut', v.psum_out]]
 .flatMap(([k, x]) => [el('dt', { text: V[k] }), el('dd.mono', { text: signed(x) })]));
 }
}
const SYSTEM_DEVICES = ['ram', 'gpio', 'timer', 'uart', 'npu'];
export function systemGeometry(names) {
 const P = S().systemParts;
 const x = (k) => 1.2 + 2.3 * k;
 return {
 pics: {},
 elements: [{ id: 'cpu', type: 'block', at: [x(0) + 3.45, 3.4], size: [3.0, 0.9], text: P.cpu },
 ...names.map((id, k) => ({ id, type: id === 'ram' ? 'mem' : 'block', at: [x(k), 0.6], size: [1.9, 0.8], text: P[id] }))],
 labels: [{ type: 'label', style: 'small', at: [x(names.length - 1) + 0.95, 2.05], anchor: 'south east', text: P.bus }],
 wires: [{ id: 'cpu_bus', style: 'bus', arrow: false, points: [[x(0) + 3.45, 2.95], [x(0) + 3.45, 2.0]], signal: 'bus', labels: [] },
 ...names.slice(1).map((id, k) => ({ id: `bus_${k}`, style: 'bus', arrow: false, bidir: true, points: [[x(k), 2.0], [x(k + 1), 2.0]], signal: 'bus', labels: [] })),
 ...names.map((id, k) => ({ id: `to_${id}`, style: 'bus', arrow: true, start: true, bidir: true, points: [[x(k), 2.0], [x(k), 1.0]], signal: 'bus', labels: [] }))],
 junctions: [[x(0) + 3.45, 2.0]],
 control: [],
 };
}
class SystemLevel {
 constructor() {
 this.names = null;
 this.info = infoButton([S().systemIntro, S().systemDrawn], S().about(S().levelNames.system));
 this.head = [this.info];
 this.line = el('div.note.npu-cycle', { 'aria-live': 'polite' });
 this.host = el('div');
 this.root = el('section.npu-level', {}, this.host, this.line);
 }
 targetOf(platform, acc) {
 if (!acc) return null;
 const hit = platform.devices().find(({ base, device }) => device !== platform.window && acc.addr >= base && acc.addr < base + (device.size ?? 0));
 return hit ? SYSTEM_DEVICES.find((id) => platform[id] === hit.device) ?? null : 'ram';
 }
 update(platform, accessed, ms = 0, cycle = 0, completed = null) {
 const names = ['ram', ...SYSTEM_DEVICES.slice(1).filter((id) => platform[id])];
 if (!this.dp || names.join() !== this.names) {
 this.names = names.join();
 this.dp = new DatapathView(systemGeometry(names), { title: S().levelNames.system, description: S().systemDesc(''), ids: 'npu-sys' });
 this.host.replaceChildren(this.dp.root);
 this.head = [this.info, zoomable(this.dp, S().levelNames.system, 480).bar];
 }
 const P = S().systemParts;
 const tap = 1.5;
 const route = (acc, window) => {
 const target = this.targetOf(platform, acc);
 const k = names.indexOf(target);
 if (k < 0) return null;
 const pieces = Array.from({ length: names.length - 1 }, (_, i) => i).filter((i) => (k > tap ? i >= 1 && i < k : i >= k && i <= 1)).map((i) => `bus_${i}`);
 return { target, wires: ['cpu_bus', ...pieces, `to_${target}`], flow: systemFlow(pieces, target, k > tap, Boolean(acc.write), window) };
 };
 const done = route(completed, [0, 0.3]);
 const now = route(accessed, [0.4, 0.8]);
 const wires = new Set([...(done?.wires ?? []), ...(now?.wires ?? [])]);
 this.dp.setPath(wires.size ? { wires, elements: new Set(['cpu', done?.target, now?.target].filter(Boolean)) } : null);
 this.dp.setNext(new Set((now?.wires ?? []).filter((id) => !done?.wires.includes(id))));
 const key = `${cycle} ${accessed?.addr ?? ''} ${completed?.addr ?? ''}`;
 if (key !== this.flowKey) {
 this.flowKey = key;
 this.dp.animate(ms ? [...(done?.flow ?? []), ...(now?.flow ?? [])] : [], ms);
 }
 const lines = [...(done ? [{ when: 'done', text: S().accessTo(P[done.target], hex8(completed.addr), completed.write, hex8(completed.value)) }] : []),
 ...(now ? [{ when: 'now', text: S().accessTo(P[now.target], hex8(accessed.addr), accessed.write, accessed.value === undefined ? null : hex8(accessed.value)) }] : [])];
 this.dp.setDescription([S().systemDesc(now ? P[now.target] : ''), ...lines.map((l) => `${S().flow.when[l.when]}: ${l.text}`)].join(' '));
 this.line.replaceChildren(...(lines.length ? movesList(lines) : [el('span', { text: S().accessNone })]));
 }
}
export function systemFlow(pieces, target, right, write, window = [0, 0.7]) {
 const order = right ? pieces : [...pieces].reverse();
 const out = [{ id: 'cpu_bus', reverse: false }, ...order.map((id) => ({ id, reverse: !right })), { id: `to_${target}`, reverse: false }];
 const path = write ? out : out.reverse().map((f) => ({ ...f, reverse: !f.reverse }));
 const [t0, t1] = window;
 return path.map((f, i) => ({ ...f, at: t0 + (path.length > 1 ? ((t1 - t0) * i) / (path.length - 1) : 0) }));
}
export class NpuView {
 constructor(geom) {
 this.level = 'subsystem';
 this.ctx = null;
 const T = S();
 this.buttons = LEVELS.map((id) => el('button', { type: 'button', text: T.levelNames[id], 'aria-pressed': String(id === this.level), onclick: () => this.show(id) }));
 this.sub = new Subsystem(geom, (r, c) => { this.pe.choose(r, c); this.show('pe'); });
 this.array = new ArrayExplorer(geom, () => this.ctx?.platform?.npu ?? null);
 this.pe = new PeLevel();
 this.pe.onChange = () => this.redraw();
 this.system = new SystemLevel();
 this.none = el('p.note', { text: T.none });
 this.body = el('div');
 this.slot = el('div.npu-slot');
 this.root = el('div.npu-view', {}, el('div.npu-head', {}, el('div.npu-levels', { role: 'group', 'aria-label': T.levels }, this.buttons), this.slot), this.body);
 this.flow = flowControl('normal');
 this.show(this.level);
 }
 setHead(part) {
 const kids = part?.head ?? [];
 if (kids.length !== this.slot.children.length || kids.some((k, i) => this.slot.children[i] !== k)) this.slot.replaceChildren(...kids);
 }
 show(id) {
 this.level = id;
 this.buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(LEVELS[k] === id)));
 this.redraw();
 }
 update(ctx) {
 this.ctx = { platform: ctx.dev?.platform ?? null, accessed: ctx.accessed ?? null, completed: ctx.completed ?? null };
 this.redraw();
 }
 redraw() {
 const pl = this.ctx?.platform ?? null;
 const npu = pl?.npu ?? null;
 if (this.level === 'array') { this.setHead(this.array); this.body.replaceChildren(this.array.root); return; }
 if (!npu) { this.setHead(null); this.body.replaceChildren(this.none); return; }
 const part = { subsystem: this.sub, pe: this.pe, system: this.system }[this.level];
 const ms = this.flow.get();
 if (this.level === 'system') part.update(pl, this.ctx.accessed, ms, npu.view().cycle, this.ctx.completed);
 else if (this.level === 'subsystem') part.update(npu, ms, this.ctx.accessed);
 else part.update(npu, ms);
 this.setHead(part);
 if (this.body.firstChild !== part.root) this.body.replaceChildren(part.root);
 }
}
