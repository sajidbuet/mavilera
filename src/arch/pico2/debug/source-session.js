// source-session.js -- the model of the pico2 C source view (P1-C1, design docs/architecture/pico2-p1c1-image-import.md §4): an
// engine for an imported program, the program's DWARF line table (debug/dwarf-line.js) and functions, and what the view does
// with them: where the next instruction's C line is, a step of one C line (into functions that have lines, through those
// without), back to the previous C line, breakpoints on lines, and the matching of the line table's file paths to the
// source files the student opened. Stepping by line follows the rule of GDB's `step` (Inference from its documented
// behaviour, not its code): leave the address range of the present row; stop at the start of a statement row of another line,
// or of the same line reached by a backward jump (a loop); in the middle of a row, keep stepping to the next start. No DOM.
// The simulator's own code (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP } from '../../contract.js';
import { create } from '../engine.js';

export const LINE_STEP_MAX = 2_000_000; // instructions one "step line" may run before it gives up

const norm = (p) => p.replace(/\\/g, '/').replace(/\/+/g, '/');
const parts = (p) => norm(p).toLowerCase().split('/').filter((x) => x && x !== '.');

/**
 * The best loaded file for each line-table file: the loaded path sharing the longest run of trailing path components
 * (at least the file name), compared without case. Returns Map fileIndex -> loaded key.
 * @param {string[]} tableFiles   the line table's full paths
 * @param {Iterable<string>} loaded   the opened files' paths (relative paths or names)
 */
export function matchFiles(tableFiles, loaded) {
  const cands = [...loaded].map((k) => ({ k, p: parts(k) }));
  const out = new Map();
  tableFiles.forEach((f, i) => {
    const fp = parts(f);
    let best = null, score = 0;
    for (const c of cands) {
      let s = 0;
      while (s < fp.length && s < c.p.length && fp[fp.length - 1 - s] === c.p[c.p.length - 1 - s]) s++;
      if (s > score) { score = s; best = c.k; }
    }
    if (best !== null) out.set(i, best);
  });
  return out;
}

export class SourceSession {
  /**
   * @param {object} program  a Program from firmware/import.js (its `debug` holds the line table and functions)
   * @param {object} [engine]  an engine of `program` to step instead of a new one (the shell's Step line on the editor,
   *   research D38): it is not reset; sync() takes its position before each line step
   */
  constructor(program, engineOptions = {}, engine = null) {
    this.program = program;
    this.engine = engine ?? create(program, engineOptions);
    this.hart = this.engine.machine.hart;
    this.lt = program.debug?.lineTable ?? null;
    this.functions = program.debug?.functions ?? [];
    this.fnStart = Uint32Array.from(this.functions.map((f) => f.address >>> 0));
    this.breaks = new Map(); // "fileIndex:line" -> statement addresses
    this.breakAddrs = new Set();
    if (engine) { this.lines = 0; this.message = null; this.marks = []; this.sync(); } else this.reset();
  }

  /** The engine's position now (it was stepped, run or stepped back by others): the step count and the end; the marks of
   *  earlier line steps are kept (back line drops those made stale). */
  sync() {
    const s = this.engine.state();
    this.n = s.steps;
    this.stop = s.halted ? (s.error ? STOP.ERROR : STOP.HALT) : null;
  }

  reset() {
    this.engine.reset();
    this.n = 0;          // steps from reset (the view's cycle)
    this.stop = null;    // the STOP that ended the program, if any
    this.lines = 0;      // C lines stepped
    this.message = null; // why the last step line gave up
    this.marks = [];     // the step counts at which each step line started (for back line)
  }

  get pc() { return this.hart.pc >>> 0; }

  /** After the engine was restored from a real-time run (P1-M4): the step count and the end from the engine. */
  resync() {
    const s = this.engine.state();
    this.n = s.steps;
    this.stop = s.halted ? (s.error ? STOP.ERROR : STOP.HALT) : null;
    this.marks = [];
  }

  /** The function holding an address (by symbol), or null. */
  functionAt(a) {
    const s = this.fnStart;
    let lo = 0, hi = s.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m] <= a) { k = m; lo = m + 1; } else hi = m - 1; }
    for (; k >= 0 && s[k] <= a; k--) { const f = this.functions[k]; if (a < f.address + f.size) return f; }
    return null;
  }

  /** Where an address is: {row, file, fileIndex, line, column, stmt, fn} (row -1 and file null without a line). */
  where(a = this.pc) {
    const fn = this.functionAt(a)?.name ?? null;
    const r = this.lt ? this.lt.lineAt(a) : null;
    if (!r || r.line === 0) return { row: -1, file: null, fileIndex: -1, line: 0, column: 0, stmt: false, fn };
    return { row: r.row, file: r.file, fileIndex: r.fileIndex, line: r.line, column: r.column, stmt: r.stmt, fn };
  }

  /** One instruction: a STOP value (NONE after a normal step). */
  step() {
    if (this.stop) return this.stop;
    const r = this.engine.run({ chunk: 1 });
    if (r === STOP.CHUNK) { this.n++; return STOP.NONE; }
    if (r === STOP.HALT || r === STOP.ERROR || r === STOP.BUDGET) this.stop = r;
    return r;
  }

  back() {
    // a halt or an error changed nothing (the engine clears it); at the run limit no step was made
    if (this.stop) { const s = this.stop; this.stop = null; return s === STOP.BUDGET ? true : this.engine.back(); }
    if (!this.engine.back()) return false;
    this.n--;
    return true;
  }

  /** Step to the start of the next C line (see the file header). A STOP value, or 'limit' with `message` set. */
  stepLine(max = LINE_STEP_MAX) {
    this.message = null;
    const lt = this.lt;
    if (!lt) return this.step();
    this.marks.push(this.n);
    if (this.marks.length > 4096) this.marks.splice(0, 1024);
    let r0 = lt.rowAt(this.pc);
    if (r0 >= 0 && lt.line[r0] === 0) r0 = -1;
    let range = r0 >= 0 ? lt.rowRange(r0) : null;
    let key = r0 >= 0 ? lt.file[r0] * 0x100000 + lt.line[r0] : -1;
    for (let i = 0; i < max; i++) {
      const before = this.pc;
      const st = this.step();
      if (st !== STOP.NONE) return st;
      const pc = this.pc;
      if (range && pc >= range[0] && pc < range[1]) continue;
      const r = lt.rowAt(pc);
      if (r < 0 || lt.line[r] === 0) { range = null; continue; } // code without lines: run through it
      const k = lt.file[r] * 0x100000 + lt.line[r];
      if (lt.stmt[r] && pc === lt.address[r] && (k !== key || pc <= before)) { this.lines++; return STOP.NONE; }
      range = lt.rowRange(r); // in the middle of a row, or the same line further on: on to the next start
      key = k;
    }
    this.message = max;
    return 'limit';
  }

  /**
   * Back to where the previous step line started (so that back line undoes step line exactly); after single steps or a run,
   * back to the previous start of a statement row of another line. False if there is nothing to undo.
   */
  backLine(max = LINE_STEP_MAX) {
    const lt = this.lt;
    if (!lt) return this.back();
    while (this.marks.length && this.marks[this.marks.length - 1] >= this.n) this.marks.pop(); // made stale by stepping back
    let moved = false;
    if (this.marks.length) {
      const to = this.marks.pop();
      while (this.n > to) { if (!this.back()) break; moved = true; }
    } else {
      const r0 = lt.rowAt(this.pc);
      const k0 = r0 >= 0 && lt.line[r0] ? lt.file[r0] * 0x100000 + lt.line[r0] : -1;
      for (let i = 0; i < max; i++) {
        if (!this.back()) break;
        moved = true;
        const pc = this.pc, r = lt.rowAt(pc);
        if (r >= 0 && lt.line[r] && lt.stmt[r] && lt.address[r] === pc && lt.file[r] * 0x100000 + lt.line[r] !== k0) break;
      }
    }
    if (moved && this.lines > 0) this.lines--;
    return moved;
  }

  /** Toggle a breakpoint on a line; returns the addresses now set (empty: removed, or the line has no code). */
  toggleBreak(fileIndex, line) {
    const key = `${fileIndex}:${line}`;
    if (this.breaks.has(key)) this.breaks.delete(key);
    else if (this.lt) {
      const a = this.lt.addressesOf(fileIndex, line);
      if (a.length) this.breaks.set(key, a);
    }
    this.breakAddrs = new Set([...this.breaks.values()].flat());
    return this.breaks.get(key) ?? [];
  }

  hasBreak(fileIndex, line) { return this.breaks.has(`${fileIndex}:${line}`); }
}
