// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
import { infoButton } from './info-button.js';
import { STRINGS } from './strings.js';
import { amdahl, roofline, ridge, intensity, fcLayer, conv3x3, accumulator, quantParams, quantise } from '../core/analytic.js';
const S = () => STRINGS.analytic;
const NS = 'http://www.w3.org/2000/svg';
const MINUS = '−';
const NUMERIC = /^[−\d.\s%∞×—]+$/;
export function num(v, d = 0, { sig = false } = {}) {
 if (v === null || v === undefined || Number.isNaN(v)) return '—';
 if (v === Infinity) return '∞';
 let t;
 if (sig) t = Number(v.toPrecision(d)).toString();
 else t = v.toFixed(d);
 const [i, f] = t.replace('-', '').split('.');
 const grouped = i.length > 4 ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : i;
 return `${v < 0 && Number(t) !== 0 ? MINUS : ''}${grouped}${f ? `.${f}` : ''}`;
}
function svg(tag, attrs = {}, ...kids) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
 return n;
}
const W = 560, H = 330, L = 62, R = 96, T = 18, B = 46;
const decades = (lo, hi) => { const a = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) a.push(10 ** e); return a; };
const tick = (v) => (v >= 1 ? num(v) : String(v));
export function logPlot(spec) {
 const [x0, x1] = spec.x.map(Math.log10), [y0, y1] = spec.y.map(Math.log10);
 const px = (x) => L + ((Math.log10(x) - x0) / (x1 - x0)) * (W - L - R);
 const py = (y) => H - B - ((Math.log10(y) - y0) / (y1 - y0)) * (H - T - B);
 const clampY = (y) => Math.min(spec.y[1], Math.max(spec.y[0], y));
 const g = [];
 for (const v of decades(...spec.x)) if (v >= spec.x[0] && v <= spec.x[1]) {
 g.push(svg('line', { class: 'an-grid', x1: px(v), x2: px(v), y1: T, y2: H - B }));
 g.push(svg('text', { class: 'an-tick', x: px(v), y: H - B + 15, 'text-anchor': 'middle' }, tick(v)));
 }
 for (const v of decades(...spec.y)) if (v >= spec.y[0] && v <= spec.y[1]) {
 g.push(svg('line', { class: 'an-grid', x1: L, x2: W - R, y1: py(v), y2: py(v) }));
 g.push(svg('text', { class: 'an-tick', x: L - 6, y: py(v) + 4, 'text-anchor': 'end' }, tick(v)));
 }
 g.push(svg('path', { class: 'an-axis', d: `M${L} ${T}V${H - B}H${W - R}` }));
 g.push(svg('text', { class: 'an-label', x: (L + W - R) / 2, y: H - 8, 'text-anchor': 'middle' }, spec.xLabel));
 g.push(svg('text', { class: 'an-label', transform: `translate(14 ${(T + H - B) / 2}) rotate(-90)`, 'text-anchor': 'middle' }, spec.yLabel));
 for (const h of spec.hlines ?? []) {
 g.push(svg('line', { class: 'an-ref', x1: L, x2: W - R, y1: py(h.y), y2: py(h.y) }));
 g.push(svg('text', { class: 'an-note', x: L + 4, y: py(h.y) - 3 }, h.label));
 }
 for (const v of spec.vlines ?? []) {
 g.push(svg('line', { class: `an-kernel${v.accent ? ' an-accent' : ''}`, x1: px(v.x), x2: px(v.x), y1: T, y2: H - B }, svg('title', {}, v.tip ?? v.label)));
 g.push(svg('text', { class: 'an-note', x: px(v.x) + 3, y: T + 10 + (v.row ?? 0) * 12 }, v.label));
 }
 const ends = [];
 for (const ln of spec.lines) {
 const d = ln.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)} ${py(clampY(y)).toFixed(1)}`).join('');
 g.push(svg('path', { class: `an-line an-${ln.style ?? 'solid'}`, d }, svg('title', {}, ln.tip ?? ln.label)));
 const [ex, ey] = ln.pts[ln.pts.length - 1];
 ends.push({ y: py(clampY(ey)), x: px(ex), label: ln.label, accent: ln.style === 'accent' });
 }
 ends.sort((a, b) => a.y - b.y);
 for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
 for (const e of ends) g.push(svg('text', { class: `an-direct${e.accent ? ' an-accent-text' : ''}`, x: e.x + 4, y: e.y + 4 }, e.label));
 for (const m of spec.marks ?? []) {
 g.push(svg('circle', { class: 'an-mark', cx: px(m.x), cy: py(clampY(m.y)), r: 5 }, svg('title', {}, m.tip ?? m.label)));
 g.push(svg('text', { class: 'an-note an-accent-text', x: px(m.x) + 8, y: py(clampY(m.y)) - 6 }, m.label));
 }
 return svg('svg', { class: 'an-plot', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': spec.title }, g);
}
export function field(label, value, onchange, { min, max, step = 'any', title } = {}) {
 const input = el('input.an-in', { type: 'number', value: String(value), min, max, step, title, oninput: () => onchange(input.valueAsNumber) });
 return { node: el('label.an-field', {}, el('span', { text: label }), input), input };
}
export function table(caption, rows, head = null) {
 return el('table.listing.an-table', {},
 el('caption', { text: caption }),
 head ? el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))) : null,
 el('tbody', {}, rows.map((r) => el('tr', {}, el('th', { scope: 'row', text: r[0] }), r.slice(1).map((v) => el(NUMERIC.test(v) ? 'td.mono.num' : 'td', { text: v }))))));
}
export function panelHead(title, info, level = 'h3') {
 return el('div.an-head', {}, el(level, { text: title }), info?.length ? infoButton(info, S().about(title)) : null);
}
export function panel(id, title, info, fields, draw) {
 const out = el('div.an-out', { 'aria-live': 'polite' });
 const run = () => {
 try { out.replaceChildren(...[draw()].flat().filter(Boolean)); } catch (e) { out.replaceChildren(el('p.note.an-error', { text: e.message })); }
 };
 const root = el(`section.an-panel.an-${id}`, { 'aria-label': title },
 panelHead(title, info), el('div.an-form', {}, fields), out);
 return { root, run };
}
export function amdahlPanel({ fractions = [0.9, 0.95, 0.99] } = {}) {
 const X = S().amdahl;
 const st = { f: 0.95, n: 64 };
 const fF = field(X.f, st.f, (v) => { st.f = v; p.run(); }, { min: 0, max: 1, step: 0.01, title: X.fTitle });
 const fN = field(X.n, st.n, (v) => { st.n = v; p.run(); }, { min: 1, step: 1, title: X.nTitle });
 const p = panel('amdahl', X.title, X.info, [fF.node, fN.node], () => {
 const r = amdahl(st.f, st.n);
 const at = [4, 64, 1024, st.n].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
 const nMax = Math.max(1024, 2 ** Math.ceil(Math.log2(Math.max(st.n, 1))));
 const curve = (f) => Array.from({ length: 41 }, (_, i) => { const n = nMax ** (i / 40); return [n, amdahl(f, n).S]; });
 const styles = ['solid', 'dashed', 'dotted'];
 const lines = fractions.map((f, i) => ({ label: X.curve(num(f, 2)), pts: curve(f), style: styles[i % 3], tip: X.curveTip(num(f, 2), num(1 / (1 - f), 0)) }));
 if (!fractions.includes(st.f)) lines.push({ label: X.curve(num(st.f, 3, { sig: true })), pts: curve(st.f), style: 'accent' });
 const yMax = 10 ** Math.ceil(Math.log10(Math.max(100, Math.min(r.ceiling, 1e4))));
 return [
 table(X.tableCaption(num(st.f, 3, { sig: true })), at.map((n) => { const a = amdahl(st.f, n); return [X.lanes(num(n)), num(a.S, 3, { sig: true }), num(a.efficiency, 3, { sig: true })]; }),
 [X.colLanes, X.colS, X.colEff]),
 el('p.note', { text: X.ceiling(r.ceiling === Infinity ? '∞' : num(r.ceiling, 3, { sig: true })) }),
 logPlot({ title: X.plotTitle, x: [1, nMax], y: [1, yMax], xLabel: X.xLabel, yLabel: X.yLabel, lines,
 hlines: fractions.map((f) => ({ y: 1 / (1 - f), label: X.ceilingTag(num(1 / (1 - f), 0)) })),
 marks: [{ x: st.n, y: r.S, label: num(r.S, 3, { sig: true }), tip: X.markTip(num(st.n), num(r.S, 3, { sig: true })) }] }),
 ];
 });
 p.run();
 return p;
}
const LINE_STYLES = ['solid', 'dashed', 'accent'];
export function rooflinePlot({ machines, kernels = [], marks = [], xLabel, yLabel, title, styles = LINE_STYLES, accentKernel = null }) {
 const Is = [...kernels.map((k) => k.intensity), ...machines.map(ridge), ...marks.map((m) => m.x)];
 const x = [10 ** Math.floor(Math.log10(Math.min(...Is) / 2)), 10 ** Math.ceil(Math.log10(Math.max(...Is) * 2))];
 const lo = Math.min(...machines.map((m) => m.bandwidth * x[0]), ...marks.map((m) => m.y));
 const y = [10 ** Math.floor(Math.log10(lo)), 10 ** Math.ceil(Math.log10(Math.max(...machines.map((m) => m.peak)) * 1.5))];
 const lines = machines.map((m, i) => {
 const r = ridge(m);
 return { label: m.name, style: styles[i % styles.length], pts: [[x[0], m.bandwidth * x[0]], [r, m.peak], [x[1], m.peak]], tip: S().roofline.machineTip(m.name, num(m.peak, 3, { sig: true }), num(m.bandwidth, 3, { sig: true }), num(r, 3, { sig: true })) };
 });
 const vlines = kernels.map((k, i) => ({ x: k.intensity, label: k.name, row: i % 3, accent: k === accentKernel }));
 return logPlot({ title, x, y, xLabel, yLabel, lines, vlines, marks });
}
export function rooflinePanel({ machines, kernels }, extra = null) {
 const X = S().roofline;
 const st = { ops: 131072, bytes: 66816, ms: machines.map((m) => ({ ...m })) };
 const fOps = field(X.ops, st.ops, (v) => { st.ops = v; p.run(); }, { min: 1, step: 1 });
 const fBytes = field(X.bytes, st.bytes, (v) => { st.bytes = v; p.run(); }, { min: 1, step: 1 });
 const mFields = st.ms.flatMap((m) => [
 field(X.peak(m.name), m.peak, (v) => { m.peak = v; p.run(); }, { min: 0, title: X.peakTitle }).node,
 field(X.bandwidth(m.name), m.bandwidth, (v) => { m.bandwidth = v; p.run(); }, { min: 0, title: X.bandwidthTitle }).node]);
 const reset = el('button.btn', { type: 'button', text: X.reset, onclick: () => {
 st.ms.forEach((m, i) => Object.assign(m, machines[i]));
 p.root.querySelectorAll('.an-machines input').forEach((inp, i) => { inp.value = String(i % 2 ? machines[i >> 1].bandwidth : machines[i >> 1].peak); });
 p.run();
 } });
 const p = panel('roofline', X.title, X.info, [fOps.node, fBytes.node, el('div.an-machines', {}, mFields, reset)], () => {
 const I = intensity(st.ops, st.bytes);
 const mine = { name: X.yourKernel, intensity: I };
 const ks = [...kernels, mine];
 return [
 table(X.tableCaption(num(I, 3, { sig: true })), st.ms.map((m) => { const r = roofline(m, I); return [m.name, num(r.ridge, 3, { sig: true }), num(r.P, 3, { sig: true }), X.bound[r.bound], `${num(100 * r.fraction, 1)} %`]; }),
 [X.colMachine, X.colRidge, X.colP, X.colBound, X.colFraction]),
 table(X.kernelsCaption, kernels.map((k) => [k.name, num(k.intensity, 3, { sig: true }), ...st.ms.map((m) => num(roofline(m, k.intensity).P, 3, { sig: true }))]),
 [X.colKernel, X.colI, ...st.ms.map((m) => X.colOn(m.name))]),
 rooflinePlot({ machines: st.ms, kernels: ks, accentKernel: mine, title: X.plotTitle, xLabel: X.xLabel, yLabel: X.yLabel }),
 extra ? extra() : null,
 ];
 });
 p.run();
 return p;
}
export function layerPanel() {
 const X = S().layer;
 const st = { m: 64, n: 10, C: 3, K: 8, P: 1024 };
 const f = (k, label, title) => field(label, st[k], (v) => { st[k] = v; p.run(); }, { min: 1, step: 1, title }).node;
 const p = panel('layer', X.title, X.info, [f('m', X.m), f('n', X.n), f('C', X.C), f('K', X.K), f('P', X.P, X.PTitle)], () => {
 const a = fcLayer(st.m, st.n), c = conv3x3(st.C, st.K, st.P);
 return [
 table(X.fcCaption(num(st.m), num(st.n)), [[X.macs, num(a.macs)], [X.ops, num(a.ops)], [X.weights, num(a.weights)]]),
 table(X.convCaption(num(st.C), num(st.K), num(st.P)), [[X.matrix, `${num(c.rows)} × ${num(c.cols)}`], [X.weights, num(c.weights)], [X.macs, num(c.macs)], [X.ops, num(c.ops)]]),
 ];
 });
 p.run();
 return p;
}
export function accumulatorPanel() {
 const X = S().accumulator;
 const st = { terms: 64, b: 8, acc: 32 };
 const f = (k, label, o) => field(label, st[k], (v) => { st[k] = v; p.run(); }, { step: 1, ...o }).node;
 const p = panel('accumulator', X.title, X.info, [f('terms', X.terms, { min: 1 }), f('b', X.bits, { min: 2, max: 16 }), f('acc', X.accBits, { min: 2, max: 64 })], () => {
 const a = accumulator(st.terms, st.b, st.acc);
 return [
 table(X.caption(num(st.terms), st.b), [
 [X.productBits, String(a.productBits)], [X.maxProduct, num(a.maxProduct)], [X.minProduct, num(a.minProduct)],
 [X.maxSum, num(a.maxSum)], [X.minSum, num(a.minSum)], [X.width, String(a.width)],
 [X.capacity(st.acc), num(a.capacity)]]),
 el('p.note', { text: a.fits ? X.fits(st.acc) : X.overflows(st.acc, a.width) }),
 ];
 });
 p.run();
 return p;
}
export function quantPanel() {
 const X = S().quant;
 const st = { rmin: -1, rmax: 3, r: 1, unsigned: false };
 const f = (k, label) => field(label, st[k], (v) => { st[k] = v; p.run(); }, { step: 'any' }).node;
 const kind = el('select.an-in', { 'aria-label': X.kind, onchange: (e) => { st.unsigned = e.target.value === 'u'; p.run(); } },
 el('option', { value: 's', text: X.signed }), el('option', { value: 'u', text: X.unsigned }));
 const p = panel('quant', X.title, X.info, [f('rmin', X.rmin), f('rmax', X.rmax), el('label.an-field', {}, el('span', { text: X.kind }), kind), f('r', X.r)], () => {
 const q = quantParams(st.rmin, st.rmax, st.unsigned ? 0 : -128, st.unsigned ? 255 : 127);
 const v = quantise(q, st.r);
 return [
 table(X.caption, [
 [X.S, num(q.S, 5, { sig: false })], [X.zReal, num(q.zReal, 3)], [X.Z, num(q.Z)],
 [X.exact, num(v.exact, 3)], [X.q, num(v.q)], [X.back, num(v.back, 4)], [X.error, num(v.error, 4)], [X.halfS, num(q.S / 2, 4)]]),
 q.zeroExact ? null : el('p.note.an-error', { text: X.zeroOutside }),
 v.clamped ? el('p.note.an-error', { text: X.clamped }) : null,
 ];
 });
 p.run();
 return p;
}
