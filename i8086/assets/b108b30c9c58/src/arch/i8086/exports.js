// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { create, REGISTER_IDS } from './engine.js';
import { bytesOf, disassemble } from './language.js';
const h = (v, digits) => `0x${v.toString(16).padStart(digits, '0')}`;
export function trace(program, { cap = 10_000, inputs = [] } = {}) {
 const e = create(program, { historyLimit: 1, inputs });
 const records = [];
 while (records.length < cap) {
 const r = e.step();
 if (!r) break;
 const regs = e.state().registers;
 records.push({ pc: r.pc, word: r.word, size: r.size, bytes: bytesOf(r.word, r.pc).slice(), asm: disassemble(r.word, r.pc),
 writes: Object.fromEntries(r.registers.filter((w) => w.id !== 'IP').map((w) => [w.id, w.value])),
 memory: r.memory.flatMap((m) => Array.from({ length: m.size }, (_, k) => ({ address: (m.address + k) & 0xfffff, value: (m.value >> (8 * k)) & 0xff }))),
 ...Object.fromEntries(REGISTER_IDS.map((id) => [id, regs[id]])), ...(r.halt ? { halt: true } : {}),
 ...(r.executed === false && r.trap ? { interrupt: r.trap.label } : {}) });
 if (r.halt) break;
 }
 return { records, error: e.state().error };
}
export function traceJsonLines(records) {
 return records.map((r) => `${JSON.stringify({ pc: r.pc, bytes: r.bytes, asm: r.asm, writes: r.writes,
 ...(r.memory.length ? { memory: r.memory } : {}), ...(r.halt ? { halt: true } : {}), ...(r.interrupt ? { interrupt: r.interrupt } : {}) })}\n`).join('');
}
export function traceCsv(records) {
 const rows = [`step,pc,bytes,instruction,${REGISTER_IDS.join(',')}`];
 records.forEach((r, i) => rows.push([i + 1, h(r.pc, 5), r.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' '),
 `"${(r.interrupt ? `${r.interrupt}: ` : '') + r.asm.replace(/"/g, '""')}"`, ...REGISTER_IDS.map((id) => h(r[id], 4))].join(',')));
 return `${rows.join('\n')}\n`;
}
