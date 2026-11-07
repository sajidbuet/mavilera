// summary.js -- reading the pico2 stage model (stages.js) for the pipeline view (P1-M3): cycles by cause and CPI, the pipeline
// diagram (instruction x cycle) of a window of steps, and one cycle's contents. Plain functions over the typed-array rings; the
// objects they return are for display only (built when the view draws, not per simulated cycle).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { XS, WHY, FS, MS, SK } from './stages.js';

/** Cycle categories of the CPI breakdown, in display order (labels in strings.js). */
export const CATEGORIES = Object.freeze(['base', 'loadUse', 'exclusive', 'fetch', 'jump', 'mispredict', 'multi', 'trap', 'irq', 'sleep']);

const CAT_OF_WHY = {
  [WHY.RAW]: 'loadUse', [WHY.EXCL]: 'exclusive', [WHY.FETCH]: 'fetch', [WHY.JUMP]: 'jump', [WHY.MISPREDICT]: 'mispredict',
  [WHY.MULDIV]: 'multi', [WHY.AMO]: 'multi', [WHY.UOP]: 'multi', [WHY.WFI]: 'multi', [WHY.BLOCK]: 'multi', [WHY.CANCEL]: 'irq',
  [WHY.TRAP]: 'trap', [WHY.IRQ]: 'irq', [WHY.SLEEP]: 'sleep', [WHY.ROM]: 'base',
};

/**
 * Cycles by category over the records kept (or over the steps from `fromStep`): every cycle is counted once, by what X did
 * in it. `instructions` counts the instructions that completed X (an exception's instruction too). CPI = cycles / instructions.
 */
export function cpiByCause(model, fromStep = model.slo, toRecord = model.n) {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  let cycles = 0, instructions = 0;
  const s0 = Math.max(fromStep, model.slo);
  const r0 = s0 < model.ns ? Math.max(model.lo, model.sRec[model.stepAt(s0)]) : model.n;
  for (let r = r0; r < Math.min(toRecord, model.n); r++) {
    const i = model.at(r), n = model.rep[i];
    cycles += n;
    const xs = model.xState[i];
    if (xs === XS.EXEC) {
      if (model.why[i] !== WHY.ROM) instructions++;
      out.base += n;
    } else if (xs === XS.SQUASH) out.irq += n;
    else if (xs === XS.SLEEP) out.sleep += n;
    else out[CAT_OF_WHY[model.why[i]] ?? 'multi'] += n;
  }
  return { cycles, instructions, byCause: out, cpi: instructions ? cycles / instructions : 0 };
}

/** Counts of hazard events (not cycles) over the steps kept: load-use stalls, exclusive bubbles, jumps, mispredicts ... */
export function hazardCounts(model) {
  const c = { loadUse: 0, exclusive: 0, fetch: 0, jump: 0, mispredict: 0, predicted: 0, trap: 0, irq: 0, divCancelled: 0 };
  for (let r = model.lo; r < model.n; r++) {
    const i = model.at(r), w = model.why[i];
    if (w === WHY.RAW) c.loadUse++;
    else if (w === WHY.EXCL) c.exclusive++;
    else if (w === WHY.FETCH) c.fetch++;
    else if (w === WHY.JUMP) c.jump++;
    else if (w === WHY.MISPREDICT) c.mispredict++;
    if (model.sig[i] & 64) c.predicted++; // x_branch_was_predicted
    if (model.mState[i] === MS.TRAP) c.trap++;
  }
  for (let s = model.slo; s < model.ns; s++) {
    const k = model.sKind[model.stepAt(s)];
    if (k === SK.IRQ) c.irq++;
    else if (k === SK.CANCEL) c.divCancelled++;
  }
  return c;
}

/** Cell codes of the diagram. */
export const CELL = Object.freeze({ NONE: 0, F: 1, X: 2, M: 3, STALL: 4, SQUASH: 5, WRONG: 6, UOP: 7, FETCH2: 8, SLEEP: 9 });

/**
 * The pipeline diagram of the newest `rows` steps (instruction x cycle): for each step, the cycles in which it was in F, X or M.
 * Returns {firstRecord, records, cycles: [{record, cycle, rep}], rows: [{step, pc, word, len, kind, cells: Uint8Array}]}, where
 * cells[k] is the CELL code of the step in column k (one column per record; a record with rep > 1 is one column).
 */
export function diagram(model, rows = 12, endStep = model.ns) {
  const sEnd = Math.min(endStep, model.ns), sStart = Math.max(model.slo, sEnd - rows);
  if (sStart >= sEnd) return { firstRecord: model.n, records: 0, cycles: [], rows: [] };
  // columns: from one record before the first step's first cycle (its F) to two records after the last step's (its M)
  let rFirst = Math.max(model.lo, model.sRec[model.stepAt(sStart)] - 1);
  const lastNext = sEnd < model.ns ? model.sRec[model.stepAt(sEnd)] : model.n;
  const rEnd = Math.min(model.n, lastNext + 2);
  const width = rEnd - rFirst;
  const cycles = [];
  for (let r = rFirst; r < rEnd; r++) { const i = model.at(r); cycles.push({ record: r, cycle: model.cyc[i], rep: model.rep[i] }); }
  const out = [];
  const index = new Map();
  for (let s = sStart; s < sEnd; s++) {
    const si = model.stepAt(s);
    const row = { step: s, pc: model.sPc[si] >>> 0, word: model.sWord[si], len: model.sLen[si], kind: model.sKind[si], cost: model.sCost[si], cells: new Uint8Array(width) };
    index.set(s, row); out.push(row);
  }
  for (let r = rFirst; r < rEnd; r++) {
    const i = model.at(r), k = r - rFirst;
    const fx = index.get(model.fStep[i]);
    if (fx && model.fState[i] !== FS.WRONG) fx.cells[k] = CELL.F;
    const x = index.get(model.xStep[i]);
    if (x) {
      const xs = model.xState[i];
      x.cells[k] = xs === XS.EXEC ? CELL.X : xs === XS.STALL ? CELL.STALL : xs === XS.SQUASH ? CELL.SQUASH : xs === XS.UOP ? CELL.UOP : CELL.X;
    } else if (model.xState[i] === XS.EMPTY && model.why[i] === WHY.FETCH) {
      const f = index.get(model.fStep[i]); if (f) f.cells[k] = CELL.FETCH2;
    }
    const mm = index.get(model.mStep[i]);
    if (mm && model.mState[i] !== MS.EMPTY) mm.cells[k] = CELL.M;
  }
  return { firstRecord: rFirst, records: width, cycles, rows: out };
}

/** One record's contents for the stage table: what each stage holds and why (codes; the view words them). */
export function cycleInfo(model, r) {
  const i = model.at(r);
  return {
    record: r, cycle: model.cyc[i], rep: model.rep[i],
    f: { state: model.fState[i], step: model.fStep[i], pc: model.fPc[i] >>> 0 },
    x: { state: model.xState[i], why: model.why[i], step: model.xStep[i], pc: model.xPc[i] >>> 0, uop: model.uop[i] },
    m: { state: model.mState[i], step: model.mStep[i], pc: model.mPc[i] >>> 0, rd: model.xmRd[i], value: model.mResult[i] >>> 0 },
    w: { rd: model.mwRd[i], value: model.mwResult[i] >>> 0 },
    btb: model.btb[i], sig: model.sig[i], byp1: model.byp1[i], byp2: model.byp2[i], rs1: model.dRs1[i], rs2: model.dRs2[i], rd: model.dRd[i],
  };
}
