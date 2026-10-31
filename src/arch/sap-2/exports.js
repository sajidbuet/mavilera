// sap-2/exports.js -- the SAP-2 trace exports (contract Exports, capability exportTrace; plan step 4 of
// docs/architecture/sap-2-plan.md): one record per instruction, from a fresh engine with the session's inputs replayed
// (contract v8, `inputs`), as JSON lines (the registers and memory bytes each instruction wrote) or as CSV (A,
// B, C, the flags and the output ports after each instruction). The format is the simulator's own, as SAP-1's; no
// reference tool writes SAP-2 traces to compare with. Records are flat (the registers after the instruction and its
// memory writes), since a program without HLT fills the shell's cap. No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { create } from './engine.js';
import { bytesOf, disassemble } from './language.js';

// the registers only instructions change (an input changes IN1 and IN2 between steps; what IN reads shows in A)
const REGS = ['A', 'B', 'C', 'S', 'Z', 'OUT3', 'OUT4'];
const h = (v, digits) => `0x${v.toString(16).padStart(digits, '0')}`;

/**
 * Up to `cap` records {pc, word, size, writes, memory, A, B, C, S, Z, OUT3, OUT4} (after the instruction) of the
 * program's run, with `inputs` (the engine's input log) replayed; `error` if it stopped on one.
 */
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

/** One JSON object per line: the instruction's address, bytes and text, the registers it wrote, its memory writes. */
export function traceJsonLines(records) {
  return records.map((r) => `${JSON.stringify({ pc: r.pc, bytes: bytesOf(r.word), asm: disassemble(r.word),
    writes: r.writes, ...(r.memory.length ? { memory: r.memory } : {}),
    ...(r.halt ? { halt: true } : {}) })}\n`).join('');
}

/**
 * The golden dump (capability exportGolden) of the bus view's export model after its run (author, 2026-10-30): every
 * write to ports 3 and 4 in order, one per line as `o port value`, then each RAM byte the program stored, by address,
 * as `m address value` with its last value; hexadecimal, lower case, as SAP-1's dump. Returns {text, count}.
 */
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
