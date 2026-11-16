// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, store } from './dom.js';
import { STRINGS } from './strings.js';
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k);
 return n;
};
const CW_MIN = 34;
const CW_MAX = 76;
const RH = 22;
const AXIS = 18;
const MAX_SHOWN = 400;
const hex = (v, width) => `${(v >>> 0).toString(16).padStart(Math.ceil(width / 4), '0')}`;
export class WaveformPanel {
 constructor({ id, signals, defaults, format = null, base = 0, onGoTo }) {
 Object.assign(this, { id, format, base, onGoTo });
 const W = STRINGS.wave;
 const key = `pips.wave.${id}`;
 let saved = null;
 try { saved = JSON.parse(store.get(key) ?? 'null'); } catch { }
 this.key = key;
 this.chosen = (Array.isArray(saved) ? saved : defaults).filter((n) => typeof n === 'string');
 this.frames = [];
 this.current = 0;
 this.picks = el('div.wave-picks');
 this.picker = el('details.wave-picker', {}, el('summary', { text: W.signals }), this.picks);
 this.setSignals(signals);
 this.labels = el('div.wave-labels', { 'aria-hidden': 'true' });
 this.plot = el('div.wave-plot', { tabindex: '0', 'aria-label': W.plotLabel });
 this.cycles = el('div.wave-cycles', { role: 'toolbar', 'aria-label': W.cyclesLabel });
 this.table = el('table');
 this.root = el('div.wave', {},
 el('div.panel-tools.wave-tools', {}, this.picker, el('span.note', { text: W.note, title: W.note })),
 el('div.wave-body', {}, this.labels, this.plot),
 this.cycles, el('div.sr-only', {}, this.table));
 this.first = 0;
 this.cw = CW_MIN;
 this.plot.addEventListener('click', (e) => {
 const r = this.plot.querySelector('svg')?.getBoundingClientRect();
 if (!r) return;
 const k = this.first + Math.floor((e.clientX - r.left) / this.cw);
 if (k >= 0 && k < this.frames.length) this.onGoTo(k);
 });
 }
 setSignals(signals) {
 const W = STRINGS.wave;
 const same = this.signals?.length === signals.length && this.signals.every((s, i) => s.name === signals[i].name);
 this.signals = signals;
 if (same) return;
 const order = (names) => signals.map((x) => x.name).filter((n) => names.includes(n));
 const pick = (s) => el('label.wave-pick', {}, el('input', { type: 'checkbox', checked: this.chosen.includes(s.name), onchange: (e) => {
 const others = this.chosen.filter((n) => n !== s.name);
 const known = new Set(signals.map((x) => x.name));
 this.chosen = [...order(e.target.checked ? [...others, s.name] : others), ...others.filter((n) => !known.has(n))];
 store.set(this.key, JSON.stringify(this.chosen));
 this.render();
 } }), ` ${s.label ?? s.name}`);
 const OWN = ['control', 'npu', 'gpu'];
 const group = (kind, title) => {
 const list = signals.filter((s) => (kind === 'data' ? !OWN.includes(s.kind) : s.kind === kind));
 return list.length ? el('fieldset.wave-group', {}, el('legend', { text: title }), list.map(pick)) : null;
 };
 this.picks.replaceChildren(...[group('control', W.control), group('data', W.data), group('npu', W.npu), group('gpu', W.gpu)].filter(Boolean));
 }
 update(frames, current) {
 this.frames = frames;
 this.current = current;
 this.render();
 }
 text(s, v) {
 const f = this.format?.(s.name, v);
 if (f !== null && f !== undefined) return f;
 if (s.kind === 'control') return (v >>> 0).toString(2).padStart(s.width, '0');
 return s.width >= 8 ? hex(v, s.width) : String(v >>> 0);
 }
 render() {
 const W = STRINGS.wave;
 const b = this.base;
 const sigs = this.chosen.map((n) => this.signals.find((s) => s.name === n)).filter(Boolean);
 const n = this.frames.length;
 const first = Math.max(0, n - MAX_SHOWN);
 this.first = first;
 const shown = this.frames.slice(first);
 if (!n || !sigs.length) {
 this.labels.replaceChildren();
 this.plot.replaceChildren(el('p.note', { text: !n ? W.empty : W.none }));
 this.cycles.replaceChildren();
 this.table.replaceChildren();
 return;
 }
 const CW = Math.max(CW_MIN, Math.min(CW_MAX, Math.floor((this.plot.clientWidth || 600) / shown.length)));
 this.cw = CW;
 const width = shown.length * CW;
 const height = AXIS + sigs.length * RH;
 const g = svg('svg', { class: 'wave-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
 'aria-label': W.summary(sigs.length, first + b, n - 1 + b) });
 shown.forEach((_, i) => {
 const k = first + i;
 const x = i * CW;
 g.append(svg('rect', { class: `wave-col${k === this.current ? ' now' : ''}`, x, y: 0, width: CW, height, 'data-cycle': k }));
 if ((k + b) % (shown.length > 60 ? 5 : 1) === 0) g.append(svg('text', { class: 'wave-num', x: x + CW / 2, y: 12 }, String(k + b)));
 });
 sigs.forEach((s, r) => {
 const top = AXIS + r * RH;
 const hi = top + 4;
 const lo = top + RH - 4;
 g.append(svg('line', { class: 'wave-sep', x1: 0, x2: width, y1: top + RH, y2: top + RH }));
 if (s.width === 1) {
 let d = '';
 shown.forEach((f, i) => {
 const y = (f[s.name] ?? 0) ? hi : lo;
 d += `${i ? 'L' : 'M'}${i * CW},${y}L${(i + 1) * CW},${y}`;
 });
 g.append(svg('path', { class: 'wave-bit', d }));
 return;
 }
 let i = 0;
 while (i < shown.length) {
 const v = shown[i][s.name] ?? 0;
 let j = i + 1;
 while (j < shown.length && (shown[j][s.name] ?? 0) === v) j++;
 const x0 = i * CW + 1;
 const x1 = j * CW - 1;
 const m = (hi + lo) / 2;
 const label = this.text(s, v);
 g.append(svg('path', { class: 'wave-bus', d: `M${x0},${m}L${x0 + 3},${hi}L${x1 - 3},${hi}L${x1},${m}L${x1 - 3},${lo}L${x0 + 3},${lo}Z` },
 svg('title', {}, `${s.name} = ${label} (${W.cycleRange(first + i + b, first + j - 1 + b)})`)));
 if (label.length * 6.4 < x1 - x0 - 6) g.append(svg('text', { class: 'wave-val', x: (x0 + x1) / 2, y: m + 3.5 }, label));
 i = j;
 }
 });
 this.plot.replaceChildren(g);
 this.labels.replaceChildren(el('div.wave-label.axis', { text: W.cycle }), ...sigs.map((s) => el('div.wave-label.mono', { text: s.name, title: s.name })));
 const x = (this.current - first) * this.cw;
 if (x < this.plot.scrollLeft || x + this.cw > this.plot.scrollLeft + this.plot.clientWidth) this.plot.scrollLeft = Math.max(0, x - this.plot.clientWidth / 2);
 this.cycles.replaceChildren(
 el('button', { type: 'button', text: W.earlier, disabled: this.current <= 0, onclick: () => this.onGoTo(this.current - 1) }),
 el('span.note', { text: W.at(this.current + b, n - 1 + b) }),
 el('button', { type: 'button', text: W.later, disabled: this.current >= n - 1, onclick: () => this.onGoTo(this.current + 1) }));
 const last = this.frames.slice(Math.max(0, n - 16));
 const from = n - last.length;
 this.table.replaceChildren(el('caption', { text: W.tableCaption(from + b, n - 1 + b) }),
 el('thead', {}, el('tr', {}, el('th', { text: W.signal }), last.map((_, i) => el('th', { text: String(from + i + b) })))),
 el('tbody', {}, sigs.map((s) => el('tr', {}, el('th', { text: s.name }), last.map((f) => el('td', { text: this.text(s, f[s.name] ?? 0) }))))));
 }
}
