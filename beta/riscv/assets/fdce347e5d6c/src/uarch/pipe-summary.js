// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { HALT_WORD } from '../isa/encoding.js';
export const STAGES = Object.freeze(['IF', 'ID', 'EX', 'MEM', 'WB']);
export const STOP_EVENTS = Object.freeze(['stall', 'flush', 'mispredict']);
const OP_BRANCH = 0b1100011;
const OP_JAL = 0b1101111;
export function pipeEvents(c) {
 const s = c.signals;
 return {
 stall: Boolean(s.stall_if),
 flush: Boolean(s.flush_id || (s.flush_ex && !s.stall_id)),
 mispredict: Boolean((s.PCSel_ex && s.Branch_ex) || (s.PCSel_id && s.Branch_id)),
 };
}
export function hazardSummary(m) {
 const rows = new Map();
 const totals = { loadUse: { events: 0, lost: 0 }, branchWait: { events: 0, lost: 0 }, mispredict: { events: 0, lost: 0 }, jump: { events: 0, lost: 0 } };
 const who = (seq) => {
 const i = m.instance(seq);
 return { seq, pc: i?.pc ?? null, instr: i?.kind === 'instr' ? i.instr : 0 };
 };
 const add = (cause, a, b, k, lost, extra = {}) => {
 const key = `${cause}:${a.pc}:${b?.pc ?? ''}:${extra.taken ?? ''}`;
 let r = rows.get(key);
 if (!r) { r = { cause, a, b, taken: null, count: 0, lost: 0, flushed: true, cycles: [], ...extra }; rows.set(key, r); }
 r.count += 1;
 r.lost += lost;
 r.cycles.push(k);
 totals[cause].events += 1;
 totals[cause].lost += lost;
 };
 for (let k = 0; k < m.cycle; k++) {
 const r = m.trace[k];
 if (!r) continue;
 if (r.stall_if && r.lwStall) add('loadUse', who(r.EX), who(r.ID), k, 1);
 else if (r.stall_if && r.brStall) add('branchWait', who(r.waitOn === 'EX' ? r.EX : r.MEM), who(r.ID), k, 1);
 const seq = r.PCSel_ex ? r.EX : r.PCSel_id ? r.ID : 0;
 const redirecting = seq ? who(seq) : null;
 if (redirecting && redirecting.instr !== 0 && redirecting.instr !== HALT_WORD) {
 const flushed = Boolean(r.flush_id);
 const lost = flushed ? (r.PCSel_ex ? 2 : 1) : 0;
 if (r.jump) add('jump', redirecting, null, k, lost, { flushed });
 else add('mispredict', redirecting, null, k, lost, { taken: Boolean(r.taken), flushed });
 }
 }
 const list = [...rows.values()].sort((x, y) => y.lost - x.lost || y.count - x.count || x.cycles[0] - y.cycles[0]);
 return { rows: list, totals };
}
export function predictionStats(stats) {
 const correct = stats.branches - stats.mispredicts;
 return { branches: stats.branches, correct, mispredicts: stats.mispredicts, rate: stats.branches ? correct / stats.branches : null };
}
export function cpiParts(m) {
 const st = m.stats;
 const n = st.retired;
 if (!n) return null;
 const p = m.penalty;
 const f = { f_lu: st.loadUse / n, f_bs: st.branchStall / n, f_br: st.branches / n, f_j: st.jumps / n, m: st.branches ? st.mispredicts / st.branches : 0, p };
 const parts = [{ key: 'base', value: 1 }, { key: 'loadUse', value: f.f_lu }, ...(m.early ? [{ key: 'branchWait', value: f.f_bs }] : []),
 { key: 'branch', value: f.f_br * f.m * p }, { key: 'jump', value: f.f_j * p }];
 return { n, f, parts, model: parts.reduce((t, x) => t + x.value, 0), measured: m.cycle / n };
}
export function diagramRows(m, from, to) {
 const rows = new Map();
 for (let k = from; k <= to; k++) {
 const r = m.recordAt(k);
 if (!r) continue;
 for (const st of STAGES) {
 const seq = r[st];
 if (!seq) continue;
 let row = rows.get(seq);
 if (!row) {
 const i = m.instance(seq);
 row = { seq, pc: i && i.kind === 'instr' ? i.pc : null, instr: i?.kind === 'instr' ? i.instr : 0,
 bubble: !i || i.kind === 'bubble' || i.instr === 0, loadUse: i?.kind === 'bubble', wrong: Boolean(i?.wrongPath), flushed: false, cells: [] };
 rows.set(seq, row);
 }
 let mark = '';
 if (row.loadUse) mark = '○';
 else if (st === 'IF' && r.stall_if) mark = '‖';
 else if (st === 'IF' && r.flush_id) mark = '✕';
 else if (st === 'ID' && r.stall_id && !r.flush_id) mark = '‖';
 else if (st === 'ID' && r.flush_ex) mark = '✕';
 row.cells.push([k, `${st}${mark}`]);
 if (mark === '✕') row.flushed = true;
 }
 }
 return [...rows.values()].sort((a, b) => a.seq - b.seq);
}
const closesLoop = (prev, row) => {
 const op = prev.instr & 0x7f;
 const back = row.pc <= prev.pc;
 return back && prev.instr !== HALT_WORD && (op === OP_BRANCH || (op === OP_JAL && ((prev.instr >>> 7) & 31) === 0));
};
export function iterations(rows) {
 const out = [];
 let cur = [];
 let prev = null;
 for (const row of rows) {
 const real = !row.bubble && !row.wrong && !row.flushed;
 if (real && prev && closesLoop(prev, row) && cur.length) { out.push(cur); cur = []; }
 cur.push(row);
 if (real) prev = row;
 }
 if (cur.length) out.push(cur);
 return out;
}
const start = (it) => Math.min(...it.flatMap((r) => r.cells.map(([k]) => k)));
const end = (it) => Math.max(...it.flatMap((r) => r.cells.map(([k]) => k)));
const body = (it) => it.map((r) => (r.loadUse ? 'b' : r.bubble ? `${r.pc}?` : String(r.pc))).join(',');
const timing = (it) => { const s0 = start(it); return it.map((r) => r.cells.map(([k, c]) => `${k - s0}${c}`).join(' ')).join('|'); };
export function foldRows(rows) {
 const its = iterations(rows);
 const keys = its.map(body);
 const times = its.map(timing);
 const items = [];
 let fold = null;
 const flush = () => { if (fold) { items.push(fold); fold = null; } };
 for (let i = 0; i < its.length; i++) {
 const same = (j) => j >= 0 && j < its.length && keys[j] === keys[i] && times[j] === times[i];
 if (same(i - 1) && same(i + 1)) {
 if (!fold) fold = { kind: 'fold', count: 0, from: start(its[i]), to: end(its[i]) };
 fold.count += 1;
 fold.to = end(its[i]);
 continue;
 }
 flush();
 for (const row of its[i]) items.push({ kind: 'row', row });
 }
 flush();
 return items;
}
export function foldColumns(items, from, to) {
 const shown = new Set();
 for (const it of items) if (it.kind === 'row') for (const [k] of it.row.cells) shown.add(k);
 const cols = [];
 let gap = null;
 for (let k = from; k <= to; k++) {
 if (shown.has(k)) {
 if (gap) { cols.push({ gap }); gap = null; }
 cols.push(k);
 } else if (gap) gap[1] = k;
 else gap = [k, k];
 }
 if (gap) cols.push({ gap });
 return cols;
}
