// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { create } from './engine.js';
import { disassemble, hex8 } from './language.js';
export function trace(program, { cap = 10_000 } = {}) {
 const e = create(program, { historyLimit: 1 });
 const records = [];
 while (records.length < cap) {
 const r = e.step();
 if (!r) break;
 records.push({ pc: r.pc, word: r.word, executed: r.executed, writes: Object.fromEntries(r.registers.map((w) => [w.id, w.value])),
 memory: r.memory.map(({ address, size, value }) => ({ address, size, value })), ...(r.halt ? { halt: true } : {}) });
 if (r.halt) break;
 }
 return { records, error: e.state().error };
}
export function traceJsonLines(records) {
 return records.map((r) => `${JSON.stringify({ pc: r.pc, word: r.word, asm: disassemble(r.word, r.pc), ...r })}\n`).join('');
}
export function traceCsv(records) {
 const rows = ['step,pc,word,instruction,executed,writes,memory'];
 const h = (v) => `0x${hex8(v)}`;
 records.forEach((r, i) => rows.push([i + 1, h(r.pc), h(r.word), `"${disassemble(r.word, r.pc)}"`, r.executed ? 1 : 0,
 `"${Object.entries(r.writes).map(([k, v]) => `${k}=${h(v)}`).join(' ')}"`,
 `"${r.memory.map((m) => `[${h(m.address)}]${m.size === 1 ? 'b' : ''}=${h(m.value)}`).join(' ')}"`].join(',')));
 return `${rows.join('\n')}\n`;
}
