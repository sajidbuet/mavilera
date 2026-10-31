// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { create } from './engine.js';
import { bytesOf, disassemble } from './language.js';
const REGS = ['A', 'B', 'C', 'S', 'Z', 'OUT3', 'OUT4'];
const h = (v, digits) => `0x${v.toString(16).padStart(digits, '0')}`;
export function trace(program, { cap = 10_000, inputs = [] } = {}) {
 const e = create(program, { historyLimit: 1, inputs });
 const records = [];
 while (records.length < cap) {
 const r = e.step();
 if (!r) break;
 const regs = e.state().registers;
 const after = Object.fromEntries(REGS.map((id) => [id, regs[id]]));
 records.push({ pc: r.pc, word: r.word, size: r.size, writes: Object.fromEntries(r.registers.filter((w) => w.id !== 'IR').map((w) => [w.id, w.value])),
 memory: r.memory.flatMap((m) => Array.from({ length: m.size }, (_, k) => ({ address: (m.address + k) & 0xffff, value: (m.value >> (8 * k)) & 0xff }))),
 ...after, ...(r.halt ? { halt: true } : {}) });
 if (r.halt) break;
 }
 return { records, error: e.state().error };
}
export function traceJsonLines(records) {
 return records.map((r) => `${JSON.stringify({ pc: r.pc, bytes: bytesOf(r.word), asm: disassemble(r.word),
 writes: r.writes, ...(r.memory.length ? { memory: r.memory } : {}),
 ...(r.halt ? { halt: true } : {}) })}\n`).join('');
}
export function golden(model) {
 const lines = [];
 const mem = new Map();
 for (const [kind, where, v] of model.writes) {
 if (kind === 'o') lines.push(`o ${where} ${v.toString(16).padStart(2, '0')}`);
 else mem.set(where, v);
 }
 for (const a of [...mem.keys()].sort((x, y) => x - y)) lines.push(`m ${a.toString(16).padStart(4, '0')} ${mem.get(a).toString(16).padStart(2, '0')}`);
 return { text: lines.map((l) => `${l}\n`).join(''), count: lines.length };
}
export function traceCsv(records) {
 const rows = ['step,pc,bytes,instruction,A,B,C,S,Z,OUT3,OUT4'];
 records.forEach((r, i) => rows.push([i + 1, h(r.pc, 4), bytesOf(r.word).map((b) => b.toString(16).padStart(2, '0')).join(' '),
 `"${disassemble(r.word)}"`, h(r.A, 2), h(r.B, 2), h(r.C, 2), r.S, r.Z, h(r.OUT3, 2), h(r.OUT4, 2)].join(',')));
 return `${rows.join('\n')}\n`;
}
