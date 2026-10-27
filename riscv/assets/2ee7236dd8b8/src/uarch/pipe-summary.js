// pipe-summary.js -- what a run of the pipelined processor (pipe.js) amounts
// to, from its pipeline-diagram records: the events a run can stop on
// (WS-F-091), the hazard summary by cause with the instructions involved and
// their cycles (WS-F-140), the pipeline diagram with repeated loop iterations
// folded (WS-F-141), and the prediction statistics with the CPI of the
// textbook model by component (WS-F-142). Pure JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { HALT_WORD } from '../isa/encoding.js';

export const STAGES = Object.freeze(['IF', 'ID', 'EX', 'MEM', 'WB']);
export const STOP_EVENTS = Object.freeze(['stall', 'flush', 'mispredict']);

const OP_BRANCH = 0b1100011;
const OP_JAL = 0b1101111;

/**
 * The events of the current cycle a run can stop on (WS-F-091), from evaluate():
 * stall (load-use, or a branch waiting in ID), flush (a redirect clears younger
 * instructions; the load-use bubble is not one), misprediction (a branch redirects).
 */
export function pipeEvents(c) {
  const s = c.signals;
  return {
    stall: Boolean(s.stall_if),
    flush: Boolean(s.flush_id || (s.flush_ex && !s.stall_id)),
    mispredict: Boolean((s.PCSel_ex && s.Branch_ex) || (s.PCSel_id && s.Branch_id)),
  };
}

/**
 * Hazard summary of the cycles run so far (WS-F-140). Each row is one cause at one
 * pair of instructions: {cause, a, b, taken, count, lost, flushed, cycles}, where
 * cause is 'loadUse', 'branchWait', 'mispredict' or 'jump'; a and b are
 * {seq, pc, instr} (b: the instruction that waits, or null for a redirect);
 * taken is a branch's outcome; lost the cycles lost (a redirect without the flush
 * loses none, its wrong-path instructions execute); cycles every cycle of the event.
 * totals[cause] = {events, lost}.
 */
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
    if (redirecting && redirecting.instr !== 0 && redirecting.instr !== HALT_WORD) { // the halt is not counted (as stats)
      const flushed = Boolean(r.flush_id);
      const lost = flushed ? (r.PCSel_ex ? 2 : 1) : 0;
      if (r.jump) add('jump', redirecting, null, k, lost, { flushed });
      else add('mispredict', redirecting, null, k, lost, { taken: Boolean(r.taken), flushed });
    }
  }
  const list = [...rows.values()].sort((x, y) => y.lost - x.lost || y.count - x.count || x.cycles[0] - y.cycles[0]);
  return { rows: list, totals };
}

/** Prediction statistics (WS-F-142): branches resolved, predicted correctly, and the rate (null without branches). */
export function predictionStats(stats) {
  const correct = stats.branches - stats.mispredicts;
  return { branches: stats.branches, correct, mispredicts: stats.mispredicts, rate: stats.branches ? correct / stats.branches : null };
}

/**
 * CPI of the textbook model by component (WS-F-056, WS-F-142): base 1, load-use
 * f_lu, branch waits f_bs (early resolution only), branches f_br·m·p, jumps f_j·p.
 * Returns null before the first instruction retires.
 */
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

/**
 * The pipeline diagram (WS-F-053) of cycles [from, to]: one row per instruction or
 * load-use bubble, in fetch order, {seq, pc, instr, bubble, wrong, cells}, cells
 * [[cycle, code]] with code the stage and '‖' (held), '✕' (flushed) or '○' (bubble).
 */
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

// a loop closes with a branch or a `jal x0` back to an address not after it; calls and returns do not
const closesLoop = (prev, row) => {
  const op = prev.instr & 0x7f;
  const back = row.pc <= prev.pc;
  return back && prev.instr !== HALT_WORD && (op === OP_BRANCH || (op === OP_JAL && ((prev.instr >>> 7) & 31) === 0));
};

/** Rows cut into iterations: a new one starts where a loop-closing branch or jump went back. */
export function iterations(rows) {
  const out = [];
  let cur = [];
  let prev = null; // the last instruction on the right path (not flushed, not executed on the wrong path)
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

/**
 * Folded loops (WS-F-141): consecutive iterations of the same instructions are one
 * group; within it the first and the last iteration are kept, and so is any
 * iteration whose timing differs from either neighbour; the others become fold
 * items {kind: 'fold', count, from, to} (from/to: their first and last cycle).
 * Returns [{kind: 'row', row} | {kind: 'fold', ...}] in fetch order.
 */
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

/**
 * The columns of a folded diagram: every cycle in which a kept row has a cell;
 * a stretch of cycles with none (inside folded iterations) becomes one gap
 * {gap: [first, last]}. Returns [cycle | {gap}] in order.
 */
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
