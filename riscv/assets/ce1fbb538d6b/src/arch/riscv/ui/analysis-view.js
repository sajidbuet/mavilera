// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { STRINGS } from '../../../ui/strings.js';
import { num, panelHead, amdahlPanel, rooflinePanel, rooflinePlot, layerPanel, accumulatorPanel, quantPanel } from '../../../ui/analytic-panels.js';
import { OFFLOAD_CLASSES, noArrayTime } from '../offload.js';
import { labComparison, measureProgram, perVector } from '../lab-compare.js';
import { NPU_N } from '../../../mem/npu.js';
const TABS = ['offload', 'compare', 'roofline', 'amdahl', 'layer', 'accumulator', 'quant'];
const TEMPLATES = { shiftAdd: 'sw-mv.s', mul: 'sw-mv-m.s', npu: 'npu-mv.s' };
export async function loadAnalysisContent(base) {
 const get = async (p, json) => {
 const r = await fetch(new URL(p, base));
 if (!r.ok) throw new Error(`${p}: ${r.status}`);
 return json ? r.json() : r.text();
 };
 const [tables, ...texts] = await Promise.all([get('content/data/ch11-tables.json', true),
 ...Object.values(TEMPLATES).map((f) => get(`content/templates/${f}`, false))]);
 return { tables, sources: Object.fromEntries(Object.keys(TEMPLATES).map((k, i) => [k, texts[i]])) };
}
export class AnalysisView {
 constructor({ tables, sources }) {
 this.tables = tables;
 this.sources = sources;
 this.program = null;
 this.set = null;
 this.measured = null;
 this.runs = null;
 const X = STRINGS.analysis;
 this.setSel = el('select', { 'aria-label': X.dataSet, onchange: (e) => { this.set = e.target.value === 'own' ? null : Number(e.target.value); this.measure(); this.update(); } },
 el('option', { value: 'own', text: X.ownData }), tables.lab_data.sets.map((n) => el('option', { value: String(n), text: X.bookSet(n) })));
 this.tabs = new Map();
 this.boxes = new Map();
 const list = el('div.an-tabs', { role: 'tablist', 'aria-label': X.tabsLabel });
 for (const id of TABS) {
 const b = el('button.an-tab', { type: 'button', role: 'tab', id: `an-tab-${id}`, 'aria-controls': `an-box-${id}`, text: X.tabs[id],
 onclick: () => this.show(id), onkeydown: (e) => this.key(e, id) });
 this.tabs.set(id, b);
 list.append(b);
 this.boxes.set(id, el('div.an-box', { role: 'tabpanel', id: `an-box-${id}`, 'aria-labelledby': `an-tab-${id}`, hidden: true }));
 }
 this.shared = {};
 this.root = el('div.col.an-view', {},
 el('div.panel-tools', {}, el('label.toggle', { title: X.dataSetTitle }, `${X.dataSet} `, this.setSel)),
 list, el('div.scroll.an-body', {}, [...this.boxes.values()]));
 this.show('offload');
 }
 key(e, id) {
 const i = TABS.indexOf(id);
 const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
 if (to === undefined) return;
 e.preventDefault();
 const next = TABS[(to + TABS.length) % TABS.length];
 this.show(next);
 this.tabs.get(next).focus();
 }
 show(id) {
 this.current = id;
 for (const [k, b] of this.tabs) { b.setAttribute('aria-selected', String(k === id)); b.tabIndex = k === id ? 0 : -1; }
 for (const [k, box] of this.boxes) box.hidden = k !== id;
 this.update();
 }
 load(p) {
 this.program = p;
 this.measure();
 this.update();
 }
 measure() {
 if (!this.program) { this.measured = null; return; }
 try { this.measured = { ok: true, m: measureProgram(this.program, this.tables, this.set) }; } catch (e) { this.measured = { ok: false, error: e.message }; }
 }
 update() {
 const id = this.current;
 const box = this.boxes.get(id);
 if (id === 'offload') box.replaceChildren(...this.offload());
 else if (id === 'compare') box.replaceChildren(...this.compare());
 else if (id === 'roofline') {
 this.shared.roofline ??= rooflinePanel({ machines: this.tables.machines, kernels: this.tables.kernels }, () => this.busRoof());
 this.shared.roofline.run();
 box.replaceChildren(this.shared.roofline.root);
 } else {
 const make = { amdahl: () => amdahlPanel({ fractions: this.tables.amdahl_fractions }), layer: layerPanel, accumulator: accumulatorPanel, quant: quantPanel }[id];
 this.shared[id] ??= make();
 if (!box.firstChild) box.append(this.shared[id].root);
 }
 }
 missing() {
 const X = STRINGS.analysis;
 if (!this.measured) return el('p.note', { text: X.empty });
 if (!this.measured.ok) return el('p.note.an-error', { text: X.runFailed(this.measured.error) });
 return null;
 }
 offload() {
 const X = STRINGS.analysis.offload;
 const head = [panelHead(X.title, X.info)];
 const miss = this.missing();
 if (miss) return [...head, miss];
 const { m } = this.measured;
 const b = m.breakdown;
 const cols = [{ label: X.colRun, counts: b.all, total: b.total },
 ...b.spans.map((s) => ({ label: X.colSpan(s.from, s.to), counts: s.counts, total: s.cycles })),
 ...(b.perVector ? [{ label: X.colVector, counts: b.perVector.counts, total: b.perVector.cycles }] : [])];
 const rows = OFFLOAD_CLASSES.map((c) => el('tr', {}, el('th', { scope: 'row', text: X.classes[c] }), cols.map((k) => el('td.mono.num', { text: num(k.counts[c]) }))));
 const npu = m.npu;
 const out = [...head,
 el('table.listing.an-table', {},
 el('caption', { text: X.caption }),
 el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: X.colClass }), cols.map((k) => el('th', { scope: 'col', text: k.label })))),
 el('tbody', {}, rows, el('tr.an-total', {}, el('th', { scope: 'row', text: X.total }), cols.map((k) => el('td.mono.num', { text: num(k.total) }))))),
 ];
 if (npu && npu.accesses) {
 const facts = [[X.starts, num(b.starts)], [X.accesses, num(npu.accesses)], [X.statusReads, num(npu.statusReads)]];
 if (b.perVector) facts.push([X.vecAccesses, num(b.perVector.npu)], [X.vecPolls, num(b.perVector.polls)], [X.busy, num(2 * NPU_N + 1)]);
 const ideal = noArrayTime(b.perVector);
 if (ideal) facts.push([X.ideal, num(ideal.cycles, Number.isInteger(ideal.cycles) ? 0 : 1)], [X.idealRatio, num(ideal.ratio, 2)]);
 out.push(el('table.listing.an-table', {}, el('caption', { text: X.factsCaption }),
 el('tbody', {}, facts.map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td.mono.num', { text: v }))))));
 if (!b.perVector) out.push(el('p.note', { text: b.vectors.length ? X.unequal : X.oneVector }));
 } else out.push(el('p.note', { text: X.noNpu }));
 return out;
 }
 compare() {
 const X = STRINGS.analysis.compare;
 if (!this.runs) {
 try { this.runs = { ok: true, rows: labComparison(this.sources, this.tables) }; } catch (e) { this.runs = { ok: false, error: e.message }; }
 }
 const head = [panelHead(X.title, X.info)];
 if (!this.runs.ok) return [...head, el('p.note.an-error', { text: STRINGS.analysis.runFailed(this.runs.error) })];
 const own = new Map();
 if (this.program) for (const n of this.tables.lab_data.sets) {
 try { own.set(n, measureProgram(this.program, this.tables, n).cycles); } catch { own.set(n, null); }
 }
 const rows = this.runs.rows.map((r) => r.mavilera);
 const sets = this.runs.rows.map((r) => r.vectors);
 const at = (n) => this.runs.rows.find((r) => r.vectors === n).mavilera;
 const fmt = (v) => (v === null || v === undefined ? '—' : num(v, Number.isInteger(v) ? 0 : 1));
 const per = (f) => { const a = f(at(4)), b = f(at(16)); return a == null || b == null ? null : perVector(a, 4, b, 16); };
 const line = (label, f, d = 0, perCol = true) => el('tr', {}, el('th', { scope: 'row', text: label }),
 rows.map((r) => el('td.mono.num', { text: f(r) === null ? '—' : num(f(r), d) })),
 el('td.mono.num', { text: perCol ? fmt(per(f)) : '' }));
 const ownF = (r) => own.get(sets[rows.indexOf(r)]) ?? null;
 return [...head, el('table.listing.an-table', {},
 el('caption', { text: X.perCaption }),
 el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: X.colProgram }), sets.map((n) => el('th', { scope: 'col', text: X.caption(n) })),
 el('th', { scope: 'col', text: X.colPer }))),
 el('tbody', {},
 line(X.shiftAdd, (r) => r.shiftAdd), line(X.mul, (r) => r.mul), line(X.npu, (r) => r.npu),
 line(X.speedupShiftAdd, (r) => r.speedupShiftAdd, 1, false), line(X.speedupMul, (r) => r.speedupMul, 1, false),
 own.size ? line(X.yours, ownF) : null))];
 }
 busRoof() {
 const X = STRINGS.analysis.bus;
 const roof = { name: X.roofName, peak: 2 * NPU_N * NPU_N, bandwidth: 4 };
 const parts = [panelHead(X.title, X.info(roof.peak, roof.bandwidth), 'h4')];
 const miss = this.missing();
 const m = this.measured?.ok ? this.measured.m : null;
 const starts = m?.breakdown.starts ?? 0;
 if (miss || !m.npu?.accesses || !starts) {
 parts.push(miss ?? el('p.note', { text: X.noRun }));
 parts.push(rooflinePlot({ machines: [roof], styles: ['accent'], title: X.plotTitle, xLabel: X.xLabel, yLabel: X.yLabel }));
 return el('div.an-bus', {}, parts);
 }
 const ops = 2 * NPU_N * NPU_N * starts, bytes = 4 * m.npu.accesses;
 const cycles = m.cycles ?? m.steps;
 const I = ops / bytes, P = ops / cycles;
 parts.push(el('table.listing.an-table', {}, el('caption', { text: X.caption }),
 el('tbody', {}, [[X.ops, num(ops)], [X.bytes, num(bytes)], [m.cycles === null ? X.cyclesRun : X.cycles, num(cycles)], [X.I, num(I, 3, { sig: true })], [X.P, num(P, 3, { sig: true })]]
 .map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td.mono.num', { text: v }))))));
 parts.push(rooflinePlot({ machines: [roof], styles: ['accent'], marks: [{ x: I, y: P, label: X.point, tip: X.pointTip(num(I, 3, { sig: true }), num(P, 3, { sig: true })) }],
 title: X.plotTitle, xLabel: X.xLabel, yLabel: X.yLabel }));
 return el('div.an-bus', {}, parts);
 }
}
