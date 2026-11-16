// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { create } from './engine.js';
import { disassemble } from './language.js';
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
export function trace(program, { cap = 10_000 } = {}) {
 const e = create(program, { historyWords: 1 << 12 });
 const hart = e.machine.hart;
 const records = [];
 while (records.length < cap) {
 const t0 = hart.ticks;
 const r = e.step();
 if (!r) break;
 records.push({ pc: r.pc, word: r.word, cycles: hart.ticks - t0, writes: Object.fromEntries(r.registers.map((w) => [w.id, w.value])),
 memory: r.memory.map(({ address, size, value }) => ({ address, size, value })), ...(r.trap ? { trap: r.trap.label } : {}), ...(r.halt ? { halt: true } : {}) });
 if (r.halt) break;
 }
 return { records, error: e.state().error };
}
export function traceJsonLines(records) {
 return records.map((r) => `${JSON.stringify({ pc: r.pc, word: r.word, asm: disassemble(r.word, r.pc), ...r })}\n`).join('');
}
export function traceCsv(records) {
 const rows = ['step,pc,word,instruction,cycles,writes,memory,trap'];
 records.forEach((r, i) => rows.push([i + 1, h8(r.pc), h8(r.word), `"${disassemble(r.word, r.pc)}"`, r.cycles,
 `"${Object.entries(r.writes).map(([k, v]) => `${k}=${h8(v)}`).join(' ')}"`,
 `"${r.memory.map((m) => `[${h8(m.address)}]${m.size === 1 ? 'b' : m.size === 2 ? 'h' : ''}=${h8(m.value)}`).join(' ')}"`, `"${r.trap ?? ''}"`].join(',')));
 return `${rows.join('\n')}\n`;
}
