// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { create } from './engine.js';
import { disassemble, OPCODES } from './language.js';
const h2 = (v) => `0x${v.toString(16).padStart(2, '0')}`;
const WRITES = {
 [OPCODES.LDA]: ['MAR', 'IR', 'A'], [OPCODES.ADD]: ['MAR', 'IR', 'B', 'A'], [OPCODES.SUB]: ['MAR', 'IR', 'B', 'A'],
 [OPCODES.OUT]: ['MAR', 'IR', 'OUT'], [OPCODES.HLT]: ['MAR', 'IR'],
};
export function trace(program, { cap = 10_000 } = {}) {
 const e = create(program, { historyLimit: 1 });
 const regs = { A: 0, B: 0, OUT: 0, IR: 0, MAR: 0 };
 const records = [];
 while (records.length < cap) {
 const r = e.step();
 if (!r) break;
 for (const w of r.registers) regs[w.id] = w.value;
 records.push({ pc: r.pc, word: r.word, ...regs });
 if (r.halt) break;
 }
 return { records, error: e.state().error };
}
export function traceJsonLines(records) {
 return records.map((r) => {
 const op = r.word >> 4;
 const writes = Object.fromEntries(WRITES[op].map((id) => [id, r[id]]));
 return `${JSON.stringify({ pc: r.pc, word: r.word, asm: disassemble(r.word), writes, ...(op === OPCODES.HLT ? { halt: true } : {}) })}\n`;
 }).join('');
}
export function golden(model) {
 return { text: model.outs.map((v) => `${v.toString(16).padStart(2, '0')}\n`).join(''), count: model.outs.length };
}
export function traceCsv(records) {
 const rows = ['step,pc,word,instruction,A,B,OUT'];
 records.forEach((r, i) => rows.push([i + 1, h2(r.pc), h2(r.word), `"${disassemble(r.word)}"`, h2(r.A), h2(r.B), h2(r.OUT)].join(',')));
 return `${rows.join('\n')}\n`;
}
