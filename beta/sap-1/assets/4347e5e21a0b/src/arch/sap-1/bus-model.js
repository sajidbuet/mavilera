// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { OPCODES, MNEMONIC_OF, MEMORY_BYTES } from './language.js';
import { SAP1_STRINGS as S } from './strings.js';
import { OUTPUT_KEEP } from '../contract.js';
const JOURNAL_KEEP = 1_000_000;
export const SIGNALS = Object.freeze([
 ['Cp', false, 'PC'], ['Ep', false, 'PC'], ['Lm', true, 'MAR'], ['CE', true, 'RAM'], ['Li', true, 'IR'], ['Ei', true, 'IR'],
 ['La', true, 'A'], ['Ea', false, 'A'], ['Su', false, 'ALU'], ['Eu', false, 'ALU'], ['Lb', true, 'B'], ['Lo', true, 'OUT'],
].map(([name, low, unit]) => Object.freeze({ name, low, unit })));
export const CLOCK_LINES = Object.freeze([
 { name: 'nCLK', bar: true, low: false, from: 'CLKG', to: ['PC'] },
 { name: 'nCLR', bar: true, low: true, from: 'CLKG', to: ['PC', 'CTRL'] },
 { name: 'CLK', bar: false, low: false, from: 'CLKG', to: ['MAR', 'IR', 'A', 'B', 'OUT', 'CTRL'] },
 { name: 'CLR', bar: false, low: false, from: 'CLKG', to: ['IR'] },
 { name: 'nHLT', bar: true, low: true, from: 'CTRL', to: ['CLKG'] },
].map((x) => Object.freeze({ ...x, to: Object.freeze(x.to) })));
export const haltLine = (ir) => ir >> 4 === OPCODES.HLT;
const FETCH = [['Ep', 'Lm'], ['Cp'], ['CE', 'Li']];
const EXECUTE = {
 [OPCODES.LDA]: [['Ei', 'Lm'], ['CE', 'La'], []],
 [OPCODES.ADD]: [['Ei', 'Lm'], ['CE', 'Lb'], ['Eu', 'La']],
 [OPCODES.SUB]: [['Ei', 'Lm'], ['CE', 'Lb'], ['Su', 'Eu', 'La']],
 [OPCODES.OUT]: [['Ea', 'Lo'], [], []],
 [OPCODES.HLT]: [[], [], []],
};
export function controlSignals(t, ir) {
 if (t <= 3) return FETCH[t - 1];
 return EXECUTE[ir >> 4]?.[t - 4] ?? [];
}
export function controlWord(active) {
 return SIGNALS.reduce((w, s) => (w << 1) | (active.includes(s.name) !== s.low ? 1 : 0), 0);
}
const add = (a, b) => (a + b) & 0xff;
const sub = (a, b) => (a - b) & 0xff;
export class BusModel {
 constructor(program) {
 this.image = new Uint8Array(MEMORY_BYTES);
 for (const seg of program?.segments ?? []) this.image.set(seg.bytes.slice(0, MEMORY_BYTES - seg.address), seg.address);
 this.entry = (program?.entry ?? 0) & 0xf;
 this.reset();
 }
 reset() {
 this.mem = this.image.slice();
 this.regs = { A: 0, B: 0, OUT: 0, PC: this.entry, IR: 0, MAR: 0 };
 this.t = 1;
 this.cycle = 0;
 this.retired = 0;
 this.halted = false;
 this.error = null;
 this.instrPc = this.entry;
 this.last = null;
 this.output = '';
 this.outBase = 0;
 this.journal = [];
 }
 evaluate() {
 const { regs, mem } = this;
 const signals = controlSignals(this.t, regs.IR);
 const on = (n) => signals.includes(n);
 let bus = null;
 let driver = null;
 if (on('Ep')) { bus = regs.PC; driver = 'PC'; }
 else if (on('CE')) { bus = mem[regs.MAR]; driver = 'RAM'; }
 else if (on('Ei')) { bus = regs.IR & 0xf; driver = 'IR'; }
 else if (on('Ea')) { bus = regs.A; driver = 'A'; }
 else if (on('Eu')) { bus = on('Su') ? sub(regs.A, regs.B) : add(regs.A, regs.B); driver = 'ALU'; }
 const loads = [];
 if (on('Lm')) loads.push(['MAR', bus & 0xf]);
 if (on('Li')) loads.push(['IR', bus]);
 if (on('La')) loads.push(['A', bus]);
 if (on('Lb')) loads.push(['B', bus]);
 if (on('Lo')) loads.push(['OUT', bus]);
 if (on('Cp')) loads.push(['PC', (regs.PC + 1) & 0xf]);
 return { t: this.t, signals, bus, driver, loads, word: controlWord(signals) };
 }
 step() {
 if (this.halted) return this.error ? 'error' : 'halt';
 const op = this.regs.IR >> 4;
 if (this.t === 4 && MNEMONIC_OF[op] === undefined) {
 this.error = S.engine.badOpcode(op, this.instrPc);
 this.halted = true;
 return 'error';
 }
 this.journal.push({ regs: { ...this.regs }, t: this.t, cycle: this.cycle, retired: this.retired, instrPc: this.instrPc,
 last: this.last, output: this.outBase + this.output.length });
 if (this.journal.length > 2 * JOURNAL_KEEP) this.journal.splice(0, JOURNAL_KEEP);
 const e = this.evaluate();
 for (const [id, v] of e.loads) this.regs[id] = v;
 this.cycle += 1;
 this.last = e;
 if (e.loads.some(([id]) => id === 'OUT')) {
 this.output += S.engine.out(this.regs.OUT);
 if (this.output.length > 2 * OUTPUT_KEEP) { const drop = this.output.length - OUTPUT_KEEP; this.output = this.output.slice(drop); this.outBase += drop; }
 }
 if (this.t === 4 && op === OPCODES.HLT) {
 this.halted = true;
 this.retired += 1;
 return 'halt';
 }
 if (this.t === 6) { this.retired += 1; this.t = 1; this.instrPc = this.regs.PC; } else this.t += 1;
 return 'step';
 }
 back() {
 if (this.error) { this.error = null; this.halted = false; return true; }
 const j = this.journal.pop();
 if (!j) return false;
 Object.assign(this, { regs: j.regs, t: j.t, cycle: j.cycle, retired: j.retired, instrPc: j.instrPc, last: j.last });
 if (j.output >= this.outBase) this.output = this.output.slice(0, j.output - this.outBase);
 else { this.output = ''; this.outBase = j.output; }
 this.halted = false;
 return true;
 }
 stepInstruction() {
 let r = this.step();
 while (r === 'step' && this.t !== 1) r = this.step();
 return r;
 }
 backInstruction() {
 if (!this.back()) return false;
 while (this.t !== 1 && this.back());
 return true;
 }
}
