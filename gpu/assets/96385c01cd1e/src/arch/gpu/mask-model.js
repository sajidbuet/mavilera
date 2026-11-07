// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { initialState, execute, doutOf } from './engine.js';
import { programImage, decode, disassemble, MNEMONIC_OF, OPS, MAX_LANES } from './language.js';
const popcount = (m) => { let n = 0; for (let x = m; x; x &= x - 1) n += 1; return n; };
const lanes0 = (m, n) => Array.from({ length: n }, (_, l) => ((m >>> l) & 1 ? '1' : '0')).join('');
const copy = (st) => ({ ...st, regs: st.regs.slice() });
const CONTROL = new Set([OPS.ELSE, OPS.ENDIF, OPS.HALT]);
export function microSignals(lanes) {
 return Object.freeze([{ name: 'pc', width: 4 }, { name: 'instr', width: 16 }, { name: 'active_mask', width: lanes },
 { name: 'stack0', width: lanes }, { name: 'stack1', width: lanes }, { name: 'depth', width: 2 },
 { name: 'cycles', width: 16 }, { name: 'idle_slots', width: 16 }, { name: 'busy', width: 1, kind: 'control' }, { name: 'done', width: 1, kind: 'control' },
 ...Array.from({ length: lanes }, (_, l) => ({ name: `dout${l}`, width: 32 }))]);
}
export class MicroModel {
 constructor(program, { journal = 1_000_000 } = {}) {
 this.program = program;
 this.pm = programImage(program);
 this.lanes = Math.min(program.lanes ?? 4, MAX_LANES);
 this.din = program.din ?? [];
 this.keep = journal;
 this.reset();
 }
 reset() {
 this.st = initialState(this.lanes, this.din);
 this.journal = [];
 this.issues = [];
 this.n = 0;
 this.dropped = 0;
 this.error = null;
 }
 get cycle() { return this.n; }
 get halted() { return this.st.done === 1; }
 step() {
 if (this.st.done) return 'halt';
 if (this.error) return 'error';
 const before = copy(this.st);
 const word = this.pm[this.st.pc];
 const r = execute(this.st, word);
 if (r.error) { this.error = r.error; return 'error'; }
 this.n += 1;
 this.journal.push(before);
 if (this.journal.length > this.keep) { this.journal.shift(); this.dropped += 1; }
 this.issues.push({ n: this.n, cycle: this.n, w: 0, pc: before.pc, word, op: decode(word).op, maskIn: before.active, maskOut: this.st.active });
 return 'step';
 }
 back() {
 this.error = null;
 const s = this.journal.pop();
 if (!s) return false;
 this.st = s;
 this.n -= 1;
 this.issues.pop();
 return true;
 }
 evaluate() {
 const st = this.st;
 const signals = { pc: st.pc, instr: this.pm[st.pc] ?? 0, active_mask: st.active, stack0: st.s0, stack1: st.s1, depth: st.depth,
 cycles: st.cycles, idle_slots: st.idle, busy: st.busy, done: st.done };
 doutOf(st).forEach((v, l) => { signals[`dout${l}`] = v >>> 0; });
 return { signals };
 }
 run(limit) {
 for (let i = 0; i < limit; i++) {
 const s = this.step();
 this.journal.length = 0;
 this.issues.length = 0;
 if (s !== 'step') return s;
 }
 return 'budget';
 }
 golden() {
 const words = [...doutOf(this.st), this.st.cycles, this.st.idle, this.st.active];
 return { text: words.map((v) => `${(v >>> 0).toString(16).padStart(8, '0')}\n`).join(''), count: words.length };
 }
}
export function microCode(program, pc, word) {
 const row = program?.listing?.find((r) => r.address === pc);
 return row?.text ? row.text.replace(/\s+/g, ' ').replace(/ ,/g, ',').trim() : disassemble(word);
}
export function microMaskRows(issues, { program, lanes, masksOnly = false }) {
 const pm = programImage(program);
 let first = -1;
 for (let a = 0; a < pm.length && decode(pm[a]).op !== OPS.HALT; a++) if (decode(pm[a]).op === OPS.IFLT) { first = a; break; }
 const hidden = { control: 0, branch: 0, setup: 0 };
 const rows = [];
 issues.forEach((r, i) => {
 const kind = first >= 0 && i < first ? 'setup' : CONTROL.has(r.op) ? 'control' : null;
 if (masksOnly && kind) { hidden[kind] += 1; return; }
 rows.push({ n: r.n, w: 0, pc: r.pc, code: microCode(program, r.pc, r.word), mask: lanes0(r.maskIn, lanes), count: popcount(r.maskIn), kind, op: MNEMONIC_OF[r.op] });
 });
 return { rows, hidden };
}
export function microExportModel(program, label) {
 const model = new MicroModel(program, { journal: 0 });
 return { model, signals: microSignals(model.lanes), module: 'simt_core', label };
}
