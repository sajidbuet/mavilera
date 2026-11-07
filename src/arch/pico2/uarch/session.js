// session.js -- the model behind the pico2 pipeline view (P1-M3): the module's engine (engine.js) on a program, the stage model
// (stages.js) fed by it, and a cursor on the stage model's records, so that the view steps one clock cycle at a time: a step
// moves the cursor to the next record and runs the engine's next instruction when the cursor leaves the newest one's cycles; a
// step back moves the cursor back and undoes the instruction when it leaves that instruction's first cycle. The engine always
// stands at the end of the instruction whose cycle is shown. A record that stands for several sleeping cycles the engine skipped
// is one step of the cursor ("n cycles"). Also the export model of the waveforms and the VCD export (contract View.exportModel):
// a fresh session, one frame per record. No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP } from '../../contract.js';
import { create } from '../engine.js';
import { StageModel, SIGNALS } from './stages.js';

export class PipelineSession {
  /** @param {object} program an assembled program or {image} @param {{records?: number, steps?: number}} [o] ring sizes */
  constructor(program, { records = 8192, steps = 4096 } = {}) {
    this.program = program;
    this.engine = create(program);
    this.model = new StageModel(records, steps);
    this.engine.attachStages(this.model);
    this.cursor = -1;   // absolute record number shown, -1 before the first
    this.stop = null;   // STOP.HALT / STOP.ERROR once the engine ended
    this.first();
  }

  /** The first cycle: the first instruction runs, its first record is shown. */
  first() {
    this.stop = null;
    this.cursor = -1;
    this.forward();
  }

  reset() { this.engine.reset(); this.model.reset(); this.first(); }

  get hart() { return this.engine.machine.hart; }
  /** The step number of the newest instruction recorded, and its first record. */
  get newestStep() { return this.model.ns - 1; }
  newestFirst() { return this.model.ns > this.model.slo ? this.model.sRec[this.model.stepAt(this.model.ns - 1)] : this.model.n; }

  /** One clock cycle forward: STOP.NONE, or HALT / ERROR when the program has ended (the cursor stays). */
  forward() {
    if (this.cursor + 1 < this.model.n) { this.cursor++; return STOP.NONE; }
    if (this.stop) return this.stop;
    const r = this.engine.step();
    if (r === null || r.halt) {
      this.stop = r?.halt ? STOP.HALT : STOP.ERROR;
      if (this.cursor < 0 && this.model.n > 0) this.cursor = this.model.n - 1;
      return this.stop;
    }
    if (this.cursor + 1 < this.model.n) this.cursor++;
    return STOP.NONE;
  }

  /** One clock cycle back; false at the first. */
  back() {
    if (this.stop) { this.stop = null; this.engine.back(); } // the halting step changed nothing; the engine forgets it
    if (this.cursor > this.newestFirst()) { this.cursor--; return true; }
    if (this.model.ns - this.model.slo <= 1) return false; // the first instruction stays (it is shown from cycle 0)
    if (!this.engine.back()) return false;
    this.cursor = this.model.n - 1;
    return true;
  }

  /** One instruction forward: to the first cycle of the next instruction. */
  forwardInstruction() {
    const s0 = this.stepOf(this.cursor);
    let r = STOP.NONE;
    do r = this.forward(); while (r === STOP.NONE && this.stepOf(this.cursor) === s0);
    return r;
  }
  /** One instruction back: to the first cycle of the instruction before. */
  backInstruction() {
    const target = this.stepOf(this.cursor) - 1;
    if (target < this.model.slo) return false;
    while (this.stepOf(this.cursor) > target || this.cursor > this.firstRecordOf(target)) if (!this.back()) break;
    return true;
  }

  /** The step whose cycles contain record r. */
  stepOf(r) {
    const m = this.model;
    for (let s = m.ns - 1; s >= m.slo; s--) if (m.sRec[m.stepAt(s)] <= r) return s;
    return m.slo;
  }
  firstRecordOf(s) { return this.model.sRec[this.model.stepAt(s)]; }

  /** The clock cycle shown (records from the start; a skipped sleep counts as one). */
  get cycle() { return Math.max(0, this.cursor); }
  /** Simulated clock cycles up to and including the record shown. */
  get cycles() { const m = this.model; if (this.cursor < m.lo) return 0; const i = m.at(this.cursor); return m.cyc[i] + m.rep[i]; }
}

/** The waveform signals (contract: name, width, kind); values from StageModel.signal. */
export const WAVE_SIGNALS = Object.freeze(SIGNALS.map((s) => Object.freeze({ name: s.name, width: s.width, kind: s.width === 1 ? 'control' : 'data' })));
export const WAVE_DEFAULTS = Object.freeze(['d_pc', 'x_stall', 'x_stall_on_raw', 'x_jump_req', 'x_branch_was_predicted', 'xm_rd', 'm_reg_wen', 'mw_rd']);

/** The signals of record r as a frame. */
export function frameOf(model, r) {
  const f = {};
  if (r < model.lo || r >= model.n) { for (const s of SIGNALS) f[s.name] = 0; return f; }
  for (const s of SIGNALS) f[s.name] = model.signal(s.name, r);
  return f;
}

/**
 * The shell's export protocol on a fresh session of `program`: evaluate() gives the signals of the frame at the cursor, step()
 * moves one record on ('step', or 'halt' / 'error' at the end), run(limit).
 */
export function exportModel(program) {
  const s = new PipelineSession(program, { records: 1 << 16, steps: 1 << 15 });
  const words = { [STOP.NONE]: 'step', [STOP.HALT]: 'halt', [STOP.ERROR]: 'error' };
  return {
    evaluate: () => ({ signals: frameOf(s.model, s.cursor) }),
    step: () => words[s.forward()] ?? 'error',
    run(limit) { for (let i = 0; i < limit; i++) { const r = this.step(); if (r !== 'step') return r; } return 'budget'; },
    get error() { return s.engine.state().error; },
  };
}
