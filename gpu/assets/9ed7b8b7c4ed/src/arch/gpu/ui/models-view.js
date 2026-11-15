// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { num, panel, field, table, amdahlPanel } from '../../../ui/analytic-panels.js';
import { RVSIMT_STRINGS } from '../rvsimt/strings.js';
import { fourMachines, strips, vlmaxOf, launch, locate, assignBlocks, schedule, occupancy, coalesce, bankAccess } from '../models.js';
const M = () => RVSIMT_STRINGS.models;
export const TABS = ['machines', 'amdahl', 'strips', 'index', 'hierarchy', 'latency', 'coalesce', 'banks'];
const MAX_CELLS = 128;
const MAX_CYCLES = 96;
const MAX_ROWS = 32;
const intField = (st, k, label, run, o = {}) => field(label, st[k], (v) => { st[k] = v; run(); }, { step: 1, min: 0, ...o }).node;
function choice(label, options, value, onchange) {
 const s = el('select.an-in', { 'aria-label': label, onchange: (e) => onchange(e.target.value) },
 Object.entries(options).map(([v, t]) => el('option', { value: v, text: t, selected: v === value })));
 return el('label.an-field', {}, el('span', { text: label }), s);
}
function frameRow(label, frames, { tags = false } = {}) {
 return el('div.gm-row', {},
 label ? el('div.gm-rowlabel', { text: label }) : null,
 el('div.gm-frames', {}, frames.map((f) => el(`div.gm-frame${f.kind ? `.gm-${f.kind}` : ''}`, { title: f.tip ?? null },
 tags && f.tag !== undefined ? el('div.gm-tag', { text: f.tag }) : null,
 el('div.gm-cells', {}, f.cells.map((c) => el(`span.gm-cell${c.idle ? '.gm-idle' : ''}${c.hot ? '.gm-hot' : ''}`,
 { title: c.tip ?? null, 'aria-label': c.idle ? `${c.text} ${M().idleCell}` : null, text: c.text })))))));
}
const drawing = (title, ...rows) => el('div.gm-drawing', { role: 'group', 'aria-label': title, tabindex: '0' }, el('p.gm-title', { text: title }), rows);
const tableOf = (caption, head, rows) => el('table.listing.an-table', {}, el('caption', { text: caption }),
 head ? el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h })))) : null,
 el('tbody', {}, rows.map((r) => el('tr', {}, el('th', { scope: 'row', text: String(r[0]) }),
 r.slice(1).map((v) => el(/^[−\d.\s%–]+$/.test(String(v)) ? 'td.mono.num' : 'td', { text: String(v) }))))));
const note = (text, error = false) => el(`p.note${error ? '.an-error' : ''}`, { text });
function machinesPanel() {
 const X = M().machines;
 const st = { n: 8, simd: 4, vlmax: 8, warp: 8 };
 const p = panel('gm-machines', X.title, X.info, [
 intField(st, 'n', X.n, () => p.run(), { min: 1 }), intField(st, 'simd', X.simd, () => p.run(), { min: 1 }),
 intField(st, 'vlmax', X.vlmax, () => p.run(), { min: 1 }), intField(st, 'warp', X.warp, () => p.run(), { min: 1 })], () => {
 const m = fourMachines(st.n, st.simd, st.vlmax, st.warp);
 const cells = (f, n) => Array.from({ length: f.to - f.from + 1 }, (_, j) => { const i = f.from + j; return { text: String(i), idle: i >= n }; });
 const rowOf = (key) => m[key].frames.map((f) => ({ cells: cells(f, st.n), kind: f.kind === 'scalar' && key === 'packed' ? 'rem' : null, tip: X.frameTip(f.from, Math.min(f.to, st.n - 1)) }));
 const big = st.n + st.warp > MAX_CELLS;
 return [
 tableOf(X.caption(st.n), X.cols, [
 [X.rows.scalar, X.what.scalar, num(m.scalar.instructions)],
 [X.rows.packed, `${X.what.packed(st.simd)}${m.packed.remainder ? `; ${X.remainder(m.packed.remainder)}` : ''}`, num(m.packed.instructions)],
 [X.rows.vector, X.what.vector(st.vlmax), num(m.vector.instructions)],
 [X.rows.simt, `${X.what.simt(st.warp)}; ${X.lastMask(m.simt.lastMask)}`, num(m.simt.instructions)]]),
 big ? note(M().tooBig(st.n, MAX_CELLS)) : drawing(X.drawingTitle, ...['scalar', 'packed', 'vector', 'simt'].map((k) => frameRow(X.rows[k], rowOf(k)))),
 ];
 });
 return p;
}
function stripsPanel() {
 const X = M().strips;
 const st = { n: 19, vlen: 256, sew: 32, policy: 'max' };
 const p = panel('gm-strips', X.title, X.info, [
 intField(st, 'n', X.n, () => p.run(), { min: 1 }), intField(st, 'vlen', X.vlen, () => p.run(), { min: 8 }),
 intField(st, 'sew', X.sew, () => p.run(), { min: 8 }),
 choice(X.policy, X.policies, st.policy, (v) => { st.policy = v; p.run(); })], () => {
 const vlmax = vlmaxOf(st.vlen, st.sew);
 const s = strips(st.n, vlmax, st.policy);
 const rows = s.map((x, i) => [i + 1, num(x.avl), X.range(x.lo, x.hi), num(x.vl), X.range(x.from, x.to), num(x.avl - x.vl)]);
 return [
 note(X.vlmax(vlmax)),
 tableOf(X.caption(st.n, vlmax), X.cols, rows.slice(0, MAX_ROWS)),
 s.length > MAX_ROWS ? note(M().index.partialMore(s.length - MAX_ROWS)) : null,
 note(X.total(s.length, st.n)),
 st.n > MAX_CELLS ? note(M().tooBig(st.n, MAX_CELLS))
 : drawing(X.drawingTitle, frameRow('', s.map((x, i) => ({ tag: X.stripTag(i + 1), cells: Array.from({ length: x.vl }, (_, j) => ({ text: String(x.from + j) })) })), { tags: true })),
 ];
 });
 return p;
}
function indexPanel() {
 const X = M().index;
 const st = { n: 21, block: 8, warp: 4, find: 21 };
 const p = panel('gm-index', X.title, X.info, [
 intField(st, 'n', X.n, () => p.run(), { min: 1 }), intField(st, 'block', X.block, () => p.run(), { min: 1 }),
 intField(st, 'warp', X.warp, () => p.run(), { min: 1 }), intField(st, 'find', X.find, () => p.run())], () => {
 const l = launch(st.n, st.block, st.warp);
 const out = [tableOf(X.caption, null, [[X.rows.blocks, num(l.blocks)], [X.rows.threads, num(l.threads)],
 [X.rows.warpsPerBlock, num(l.warpsPerBlock)], [X.rows.warps, num(l.warps)], [X.rows.idle, num(l.idle)]])];
 if (Number.isSafeInteger(st.find) && st.find >= 0) {
 if (st.find >= l.threads) out.push(note(X.notLaunched(st.find)));
 else {
 const f = locate(st.find, st.block, st.warp);
 out.push(note(X.found(st.find, f.block, st.block, f.thread, f.warp, f.lane)));
 if (st.find >= st.n) out.push(note(X.outside(st.find, st.n)));
 }
 }
 out.push(l.partial.length
 ? tableOf(X.partialCaption, X.partialCols, l.partial.slice(0, MAX_ROWS).map((w) => [w.block, num(w.warp), num(w.from), w.mask, num(w.active)]))
 : note(X.partialNone));
 if (l.partial.length > MAX_ROWS) out.push(note(X.partialMore(l.partial.length - MAX_ROWS)));
 if (l.threads > MAX_CELLS) out.push(note(M().tooBig(l.threads, MAX_CELLS)));
 else {
 const blocks = Array.from({ length: l.blocks }, (_, b) => ({ tag: X.blockTag(b), kind: 'block',
 cells: [], warps: Array.from({ length: l.warpsPerBlock }, (_, w) => ({ tag: X.warpTag(w),
 cells: Array.from({ length: Math.min(st.warp, st.block - w * st.warp) }, (_, j) => {
 const t = w * st.warp + j, i = b * st.block + t;
 return { text: String(i), sub: String(t), idle: i >= st.n, hot: i === st.find, tip: `i = ${i}, thread_index ${t}` };
 }) })) }));
 const cellOf = (c) => el(`span.gm-cell.gm-two${c.idle ? '.gm-idle' : ''}${c.hot ? '.gm-hot' : ''}`,
 { title: c.tip, 'aria-label': c.idle ? `${c.tip} ${M().idleCell}` : c.tip }, el('span', { text: c.text }), el('small', { text: c.sub }));
 const warpOf = (w) => el('div.gm-frame', {}, el('div.gm-tag', { text: w.tag }), el('div.gm-cells', {}, w.cells.map(cellOf)));
 const blockOf = (b) => el('div.gm-frame.gm-block', {}, el('div.gm-tag', { text: b.tag }), el('div.gm-frames', {}, b.warps.map(warpOf)));
 out.push(el('div.gm-drawing', { role: 'group', 'aria-label': X.drawingTitle, tabindex: '0' }, el('p.gm-title', { text: X.drawingTitle }),
 el('div.gm-frames', {}, blocks.map(blockOf))));
 }
 return out;
 });
 return p;
}
function hierarchyPanel() {
 const X = M().hierarchy;
 const st = { blocks: 6, block: 96, warp: 32, sms: 3, perSm: 1, show: 1 };
 const p = panel('gm-hierarchy', X.title, X.info, [
 intField(st, 'blocks', X.blocks, () => p.run(), { min: 1 }), intField(st, 'block', X.block, () => p.run(), { min: 1 }),
 intField(st, 'warp', X.warp, () => p.run(), { min: 1 }), intField(st, 'sms', X.sms, () => p.run(), { min: 1 }),
 intField(st, 'perSm', X.perSm, () => p.run(), { min: 1 }), intField(st, 'show', X.show, () => p.run())], () => {
 const a = assignBlocks(st.blocks, st.sms, st.perSm);
 const shown = Math.min(Math.max(0, st.show), st.blocks - 1);
 const wpb = Math.ceil(st.block / st.warp);
 const warps = Array.from({ length: wpb }, (_, w) => { const lo = w * st.warp, hi = Math.min(st.block, lo + st.warp) - 1; return [num(w), X.threads(lo, hi), `${hi - lo + 1} / ${st.warp}`]; });
 return [
 tableOf(X.smCaption, X.smCols, a.sms.slice(0, MAX_ROWS).map((bs, s) => [`SM ${s}`, bs.map((b) => X.wave(b, a.wave[b])).join(', ') || '—'])),
 note(X.waves(a.waves)),
 a.sms.length <= 16 && st.blocks <= MAX_CELLS ? drawing(X.smCaption, ...a.sms.map((bs, s) => frameRow(`SM ${s}`,
 Array.from({ length: a.waves }, (_, w) => ({ tag: `${w + 1}`, cells: bs.filter((b) => a.wave[b] === w).map((b) => ({ text: String(b), hot: b === shown })) })).filter((f) => f.cells.length), { tags: true }))) : null,
 tableOf(X.warpCaption(shown), X.warpCols, warps.slice(0, MAX_ROWS)),
 ];
 });
 return p;
}
function latencyPanel() {
 const X = M().latency;
 const st = { W: 4, k: 3, L: 9, rounds: 2 };
 const sched = panel('gm-latency', X.title, X.info, [
 intField(st, 'W', X.W, () => sched.run(), { min: 1 }), intField(st, 'k', X.k, () => sched.run(), { min: 1 }),
 intField(st, 'L', X.L, () => sched.run(), { min: 1 }), intField(st, 'rounds', X.rounds, () => sched.run(), { min: 1 })], () => {
 const s = schedule(st.W, st.k, st.L, st.rounds);
 const cols = Math.min(s.cycles, MAX_CYCLES);
 const grid = Array.from({ length: st.W }, () => new Array(cols).fill(''));
 for (const x of s.issues) if (x.cycle < cols) grid[x.warp][x.cycle] = x.load ? 'L' : 'I';
 for (const x of s.issues) if (x.load) for (let c = x.cycle + 1; c < Math.min(cols, x.cycle + st.L); c++) if (!grid[x.warp][c] && x.round < st.rounds - 1) grid[x.warp][c] = '·';
 const issueRow = Array.from({ length: cols }, (_, c) => (s.idle.includes(c) ? '–' : 'I'));
 const cell = (v) => el(`td.gm-t${v === 'I' ? '.gm-iss' : v === 'L' ? '.gm-ld' : v === '–' ? '.gm-gap' : ''}`, { text: v });
 return [
 tableOf(X.caption, null, [[X.rows.needed, `${num(s.bound, 2)} → ${num(s.needed)}`], [X.rows.cycles, num(s.cycles)], [X.rows.idle, num(s.idle.length)],
 [X.rows.fraction, `${num(100 * s.fraction, 1)} %`]]),
 note(s.idle.length ? X.notHidden(s.idle.length) : X.hidden, s.idle.length > 0),
 s.cycles > MAX_CYCLES ? note(M().tooBig(s.cycles, MAX_CYCLES)) : null,
 el('div.gm-scroll', { role: 'group', 'aria-label': X.timelineCaption, tabindex: '0' }, el('table.listing.gm-timeline', {}, el('caption', { text: X.timelineCaption }),
 el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: X.cycle }), Array.from({ length: cols }, (_, c) => el('th', { scope: 'col', text: String(c) })))),
 el('tbody', {}, grid.map((r, w) => el('tr', {}, el('th', { scope: 'row', text: X.warpRow(w) }), r.map(cell))),
 el('tr.gm-issue', {}, el('th', { scope: 'row', text: X.issueRow }), issueRow.map(cell))))),
 ];
 });
 const ost = { regFile: 16384, warp: 32, regs: 40, k: 20, L: 200 };
 const occ = panel('gm-occupancy', X.occTitle, X.occInfo, [
 intField(ost, 'regFile', X.regFile, () => occ.run(), { min: 1 }), intField(ost, 'warp', X.occWarp, () => occ.run(), { min: 1 }),
 intField(ost, 'regs', X.regs, () => occ.run(), { min: 1 }), intField(ost, 'k', X.occK, () => occ.run(), { min: 1 }),
 intField(ost, 'L', X.occL, () => occ.run(), { min: 1 })], () => {
 const o = occupancy(ost);
 const t = tableOf(X.occCaption, null, [[X.occRows.perWarp, num(o.perWarp)], [X.occRows.resident, num(o.resident)],
 [X.occRows.needed, `${num(o.bound, 2)} → ${num(o.needed)}`], [X.occRows.fraction, `${num(100 * o.fraction, 1)} %`]]);
 return [t, note(o.hidden ? X.occHidden : X.occNot, !o.hidden)];
 });
 occ.root.querySelector('h3')?.replaceWith(el('h4', { text: X.occTitle }));
 const root = el('div', {}, sched.root, occ.root);
 return { root, run: () => { sched.run(); occ.run(); } };
}
function coalescePanel() {
 const X = M().coalesce;
 const st = { lanes: 32, word: 4, stride: 1, base: 0, blockBytes: 64 };
 const p = panel('gm-coalesce', X.title, X.info, [
 intField(st, 'lanes', X.lanes, () => p.run(), { min: 1 }), intField(st, 'word', X.word, () => p.run(), { min: 1 }),
 intField(st, 'stride', X.stride, () => p.run()), intField(st, 'base', X.base, () => p.run()),
 intField(st, 'blockBytes', X.blockBytes, () => p.run(), { min: 1 })], () => {
 const c = coalesce(st);
 const lanesOf = (b) => c.laneBlocks.map((bs, l) => (bs.includes(b) ? l : -1)).filter((l) => l >= 0);
 const range = (ls) => (ls.length > 4 && ls[ls.length - 1] - ls[0] === ls.length - 1 ? `${ls[0]}–${ls[ls.length - 1]}` : ls.join(', '));
 const t = tableOf(X.caption, null, [[X.rows.transactions, num(c.transactions)], [X.rows.delivered, num(c.delivered)],
 [X.rows.used, num(c.used)], [X.rows.share, `${num(100 * c.efficiency, 1)} %`]]);
 return [t,
 tableOf(X.blocksCaption, X.blocksCols, c.blocks.slice(0, MAX_ROWS).map((b) => [num(b), X.bytes(b * st.blockBytes, (b + 1) * st.blockBytes - 1), range(lanesOf(b))])),
 c.blocks.length > MAX_ROWS ? note(M().index.partialMore(c.blocks.length - MAX_ROWS)) : null,
 c.blocks.length <= 32 ? drawing(X.drawingTitle, frameRow('', c.blocks.map((b) => ({ tag: M().index.blockTag(b), cells: lanesOf(b).map((l) => ({ text: String(l), tip: X.laneTip(l, c.addresses[l], b) })) })), { tags: true })) : null,
 ];
 });
 return p;
}
function banksPanel() {
 const X = M().banks;
 const st = { lanes: 8, banks: 8, stride: 1, base: 0 };
 const p = panel('gm-banks', X.title, X.info, [
 intField(st, 'lanes', X.lanes, () => p.run(), { min: 1 }), intField(st, 'banks', X.banks, () => p.run(), { min: 1 }),
 intField(st, 'stride', X.stride, () => p.run()), intField(st, 'base', X.base, () => p.run())], () => {
 const b = bankAccess(st);
 const lanesText = (q) => (q.lanes.length ? q.lanes.join(', ') : '—');
 return [
 tableOf(X.caption(b.cycles), X.cols, b.perBank.map((q, i) => [num(i), lanesText(q), q.words.length > 1 || !q.lanes.length ? num(q.words.length) : q.lanes.length > 1 ? `1 (${X.broadcast})` : '1'])),
 st.banks <= 32 ? drawing(X.drawingTitle, frameRow('', b.perBank.map((q, i) => ({ tag: X.bankTag(i), kind: q.words.length > 1 ? 'conflict' : null,
 cells: [{ text: q.lanes.length ? lanesText(q) : ' ', idle: !q.lanes.length }] })), { tags: true })) : null,
 ];
 });
 return p;
}
export class ModelsView {
 constructor() {
 const X = M();
 this.tabs = new Map();
 this.boxes = new Map();
 this.panels = {};
 const list = el('div.an-tabs', { role: 'tablist', 'aria-label': X.tabsLabel });
 for (const id of TABS) {
 const b = el('button.an-tab', { type: 'button', role: 'tab', id: `gm-tab-${id}`, 'aria-controls': `gm-box-${id}`, text: X.tabs[id],
 onclick: () => this.show(id), onkeydown: (e) => this.key(e, id) });
 this.tabs.set(id, b);
 list.append(b);
 this.boxes.set(id, el('div.an-box', { role: 'tabpanel', id: `gm-box-${id}`, 'aria-labelledby': `gm-tab-${id}`, hidden: true }));
 }
 this.root = el('div.col.an-view.gm-view', {}, el('p.note.gm-intro', { text: X.intro }), list, el('div.scroll.an-body', {}, [...this.boxes.values()]));
 this.show('machines');
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
 if (!this.panels[id]) {
 const make = { machines: machinesPanel, amdahl: () => amdahlPanel({ fractions: [0.9, 0.95, 0.99] }), strips: stripsPanel, index: indexPanel,
 hierarchy: hierarchyPanel, latency: latencyPanel, coalesce: coalescePanel, banks: banksPanel }[id];
 this.panels[id] = make();
 this.panels[id].run();
 this.boxes.get(id).append(this.panels[id].root);
 }
 }
}
export function modelsInstance(v, STOP) {
 const none = () => STOP.NONE;
 return {
 root: v.root, title: M().panel, infoTitle: '', tabs: [],
 load: () => {}, step: none, back: () => false, state: () => null, render: () => {},
 };
}
