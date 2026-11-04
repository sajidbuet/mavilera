// gpu/exports.js -- the GPU module's trace exports (contract Exports, capability exportTrace): one record per
// instruction (one clock cycle) of a fresh engine, as JSON lines or CSV: the active mask the instruction issued under
// and after it, the lane registers it wrote, and the two counters. The format is the simulator's own; no reference tool
// writes traces of the laboratory's SIMT core to compare with. No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { create } from './engine.js';
import { disassemble } from './language.js';

const h = (v, d) => `0x${(v >>> 0).toString(16).padStart(d, '0')}`;

/** Up to `cap` records {pc, word, issued, active, cycles, idle, writes: {laneId: value}} of the program's run; `error` if it stopped on one. */
export function trace(program, { cap = 10_000 } = {}) {
  const e = create(program, { historyLimit: 1 });
  const records = [];
  let active = e.state().registers.active_mask;
  let cycles = 0;
  let idle = 0;
  while (records.length < cap) {
    const issued = active;
    const r = e.step();
    if (!r) break;
    const writes = {};
    for (const w of r.registers) {
      if (w.id === 'active_mask') active = w.value;
      else if (w.id === 'cycles') cycles = w.value;
      else if (w.id === 'idle_slots') idle = w.value;
      else if (/^l\dr\d$/.test(w.id)) writes[w.id] = w.value;
    }
    records.push({ pc: r.pc, word: r.word, issued, active, cycles, idle, writes, ...(r.halt ? { halt: true } : {}) });
    if (r.halt) break;
  }
  return { records, error: e.state().error };
}

export function traceJsonLines(records) {
  return records.map((r) => `${JSON.stringify({ pc: r.pc, word: r.word, asm: disassemble(r.word), issued: r.issued, active: r.active,
    cycles: r.cycles, idle_slots: r.idle, writes: r.writes, ...(r.halt ? { halt: true } : {}) })}\n`).join('');
}

export function traceCsv(records) {
  const rows = ['step,pc,word,instruction,issued_mask,active_mask,cycles,idle_slots,writes'];
  records.forEach((r, i) => rows.push([i + 1, h(r.pc, 1), h(r.word, 4), `"${disassemble(r.word)}"`, h(r.issued, 2), h(r.active, 2), r.cycles, r.idle,
    `"${Object.entries(r.writes).map(([k, v]) => `${k}=${v | 0}`).join(' ')}"`].join(',')));
  return `${rows.join('\n')}\n`;
}
