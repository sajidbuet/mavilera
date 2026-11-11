// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../../contract.js';
import { create } from '../engine.js';
import { StageModel, SIGNALS } from './stages.js';
export class PipelineSession {
 constructor(program, { records = 8192, steps = 4096 } = {}) {
 this.program = program;
 this.engine = create(program);
 this.model = new StageModel(records, steps);
 this.engine.attachStages(this.model);
 this.cursor = -1;
 this.stop = null;
 this.first();
 }
 first() {
 this.stop = null;
 this.cursor = -1;
 this.forward();
 }
 reset() { this.engine.reset(); this.model.reset(); this.first(); }
 get hart() { return this.engine.machine.hart; }
 get newestStep() { return this.model.ns - 1; }
 newestFirst() { return this.model.ns > this.model.slo ? this.model.sRec[this.model.stepAt(this.model.ns - 1)] : this.model.n; }
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
 back() {
 if (this.stop) { this.stop = null; this.engine.back(); }
 if (this.cursor > this.newestFirst()) { this.cursor--; return true; }
 if (this.model.ns - this.model.slo <= 1) return false;
 if (!this.engine.back()) return false;
 this.cursor = this.model.n - 1;
 return true;
 }
 forwardInstruction() {
 const s0 = this.stepOf(this.cursor);
 let r = STOP.NONE;
 do r = this.forward(); while (r === STOP.NONE && this.stepOf(this.cursor) === s0);
 return r;
 }
 backInstruction() {
 const target = this.stepOf(this.cursor) - 1;
 if (target < this.model.slo) return false;
 while (this.stepOf(this.cursor) > target || this.cursor > this.firstRecordOf(target)) if (!this.back()) break;
 return true;
 }
 stepOf(r) {
 const m = this.model;
 for (let s = m.ns - 1; s >= m.slo; s--) if (m.sRec[m.stepAt(s)] <= r) return s;
 return m.slo;
 }
 firstRecordOf(s) { return this.model.sRec[this.model.stepAt(s)]; }
 get cycle() { return Math.max(0, this.cursor); }
 get cycles() { const m = this.model; if (this.cursor < m.lo) return 0; const i = m.at(this.cursor); return m.cyc[i] + m.rep[i]; }
}
export const WAVE_SIGNALS = Object.freeze(SIGNALS.map((s) => Object.freeze({ name: s.name, width: s.width, kind: s.width === 1 ? 'control' : 'data' })));
export const WAVE_DEFAULTS = Object.freeze(['d_pc', 'x_stall', 'x_stall_on_raw', 'x_jump_req', 'x_branch_was_predicted', 'xm_rd', 'm_reg_wen', 'mw_rd']);
export function frameOf(model, r) {
 const f = {};
 if (r < model.lo || r >= model.n) { for (const s of SIGNALS) f[s.name] = 0; return f; }
 for (const s of SIGNALS) f[s.name] = model.signal(s.name, r);
 return f;
}
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
