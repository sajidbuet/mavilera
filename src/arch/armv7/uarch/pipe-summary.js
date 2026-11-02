// armv7/uarch/pipe-summary.js -- what a run of the ARM pipelined processor (uarch/pipe.js) amounts to, from its
// pipeline-diagram records (roadmap ARM-A4): the events a run can stop on, the lost cycles by cause with the
// instructions involved, the pipeline diagram with repeated loop iterations folded, and the CPI by component in the
// form of Example 7.7 (p. 441). ARM's own module (roadmap ARM-A4: the RISC-V one decodes RISC-V branches and halts; a
// shared neutral part may be extracted later, CROSS-ARCHITECTURE-REUSE.md §5.2 step 3). Pure JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { HALT_WORD } from '../language.js';

export const STAGES = Object.freeze(['IF', 'ID', 'EX', 'MEM', 'WB']);
export const STOP_EVENTS = Object.freeze(['stall', 'flush', 'taken']);
export const CAUSES = Object.freeze(['loadUse', 'unneeded', 'branch', 'pcWrite']);

const isBranch = (w) => ((w >>> 25) & 7) === 0b101; // B (and BL, not in the base set)

/**
 * The events of the current cycle a run can stop on: a stall (load-use, or a wait for a write to R15), a flush (an
 * instruction removed; a load-use bubble is not one), a taken branch. `c` is evaluate().
 */
export function pipeEvents(c) {
  const s = c.signals;
  return {
    stall: Boolean(s.StallF),
    flush: Boolean((s.FlushD && !s.StallD && !s.StallF) || (s.FlushE && !s.LDRstall && c.live.ID)),
    taken: Boolean(s.BranchTakenE),
  };
}

/**
 * Lost cycles of the cycles run so far, by cause: loadUse (a load and the instruction that needs its result: 1 cycle),
 * unneeded (a load-use stall no register needed, A4-Q1 and A4-Q3: 1 cycle), branch (a taken branch: the 2 instructions
 * after it are flushed), pcWrite (a write to R15: Fetch waits while it is in ID, EX and MEM, and the instruction fetched
 * in the meantime is flushed when it writes the PC in WB). Rows {cause, a, b, count, lost, cycles}: a and b are
 * {seq, pc, instr} (b: the instruction that waits, or null); cycles every cycle of the event. totals[cause] = {events,
 * lost}. B . (the halt) is not counted.
 */
export function hazardSummary(m) {
  const rows = new Map();
  const totals = Object.fromEntries(CAUSES.map((k) => [k, { events: 0, lost: 0 }]));
  const who = (seq) => {
    const i = m.instance(seq);
    return { seq, pc: i?.pc ?? null, instr: i?.kind === 'instr' ? i.instr : 0 };
  };
  const row = (cause, a, b) => {
    const key = `${cause}:${a.pc}:${b?.pc ?? ''}`;
    let r = rows.get(key);
    if (!r) { r = { cause, a, b, count: 0, lost: 0, cycles: [] }; rows.set(key, r); }
    return r;
  };
  const writes = new Map(); // seq of a write to R15 -> its row this time
  for (let k = 0; k < m.cycle; k++) {
    const r = m.trace[k];
    if (!r) continue;
    if (r.LDRstall) {
      const cause = r.unneeded ? 'unneeded' : 'loadUse';
      const x = row(cause, who(r.EX), who(r.ID));
      x.count += 1; x.lost += 1; x.cycles.push(k);
      totals[cause].events += 1; totals[cause].lost += 1;
    } else if (r.pcWait && r.pcWriter) {
      let x = writes.get(r.pcWriter);
      if (!x) {
        x = row('pcWrite', who(r.pcWriter), null);
        writes.set(r.pcWriter, x);
        x.count += 1; totals.pcWrite.events += 1;
      }
      x.lost += 1; x.cycles.push(k); totals.pcWrite.lost += 1;
    }
    if (r.pcWritten) { // the fetch slot of this cycle is flushed
      let x = writes.get(r.pcWritten);
      if (!x) { x = row('pcWrite', who(r.pcWritten), null); writes.set(r.pcWritten, x); x.count += 1; totals.pcWrite.events += 1; }
      x.lost += 1; x.cycles.push(k); totals.pcWrite.lost += 1;
    }
    if (r.BranchTakenE) {
      const a = who(r.EX);
      if (a.instr === HALT_WORD) continue;
      const x = row('branch', a, null);
      x.count += 1; x.lost += 2; x.cycles.push(k);
      totals.branch.events += 1; totals.branch.lost += 2;
    }
  }
  const list = [...rows.values()].sort((x, y) => y.lost - x.lost || y.count - x.count || x.cycles[0] - y.cycles[0]);
  return { rows: list, totals };
}

/**
 * The CPI by component, as Example 7.7 builds it (p. 441): 1, plus 1 per load-use stall, 2 per taken branch and the
 * cycles of the writes to R15, per instruction. `measured` counts every clock edge, the 4 of filling the pipeline too
 * (fill). Null before the first instruction completes.
 */
export function cpiParts(m) {
  const st = m.stats;
  const n = st.retired;
  if (!n) return null;
  const { totals } = hazardSummary(m);
  const parts = [{ key: 'base', value: 1 }, { key: 'loadUse', value: totals.loadUse.lost / n },
    { key: 'unneeded', value: totals.unneeded.lost / n }, { key: 'branch', value: totals.branch.lost / n },
    { key: 'pcWrite', value: totals.pcWrite.lost / n }];
  return { n, parts, model: parts.reduce((t, x) => t + x.value, 0), measured: m.cycle / n, fill: 4 / n,
    f: { loads: st.loads, loadUse: totals.loadUse.events + totals.unneeded.events, branches: st.branches, taken: st.taken } };
}

/**
 * The pipeline diagram of cycles [from, to]: one row per instruction or load-use bubble, in fetch order, {seq, pc,
 * instr, bubble, loadUse, wrong, flushed, cells}, cells [[cycle, code]] with code the stage and '‖' (held), '✕'
 * (flushed) or '○' (the load-use bubble).
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
          bubble: !i || i.kind === 'bubble' || i.noCode, loadUse: i?.kind === 'bubble', wrong: Boolean(i?.wrongPath), flushed: false, cells: [] };
        rows.set(seq, row);
      }
      let mark = '';
      if (row.loadUse) mark = '○';
      else if (st === 'IF' && r.StallF) mark = '‖';
      else if (st === 'IF' && r.FlushD && !r.StallD) mark = '✕';
      else if (st === 'ID' && r.StallD) mark = '‖';
      else if (st === 'ID' && r.FlushE) mark = '✕';
      row.cells.push([k, `${st}${mark}`]);
      if (mark === '✕') row.flushed = true;
    }
  }
  return [...rows.values()].sort((a, b) => a.seq - b.seq);
}

// a loop closes with a branch back to an address not after it (B . is the halt, not a loop)
const closesLoop = (prev, row) => row.pc <= prev.pc && prev.instr !== HALT_WORD && isBranch(prev.instr);

/** Rows cut into iterations: a new one starts where a loop-closing branch went back. */
export function iterations(rows) {
  const out = [];
  let cur = [];
  let prev = null; // the last instruction on the right path
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
 * Folded loops: consecutive iterations of the same instructions with the same timing are one group; its first and last
 * iterations are kept, the others become one fold item {kind: 'fold', count, from, to}. Returns [{kind: 'row', row} |
 * {kind: 'fold', ...}] in fetch order.
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

/** The columns of a folded diagram: every cycle a kept row has a cell in; a run of other cycles is one gap {gap: [a, b]}. */
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
