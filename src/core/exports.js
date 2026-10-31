// exports.js -- file exports of a simulation (spec §13): the golden dump of a
// datapath processor (WS-F-124), the trace of retired instructions as JSON
// lines in the format of WS-V-010 and as CSV (WS-F-126), and (from src/shell/vcd.js)
// a VCD waveform of the microarchitecture signals under the RTL's names (WS-F-125). Each
// export replays the program from reset on a fresh hart or model, so it does
// not disturb the session and does not depend on its history. Pure
// JavaScript, no DOM: the page and the headless runner (tools/risc-vista-run.mjs,
// WS-F-127) use the same functions.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Hart, SimError, traceRecord } from './iss.js';
import { disassemble } from '../asm/disassembler.js';
import { recordFrames as shellRecordFrames, vcd as shellVcd } from '../shell/vcd.js';

const hex = (v) => (v >>> 0).toString(16).padStart(8, '0');
const h8 = (v) => `0x${hex(v)}`;

/** A golden dump as the chapters' reference models write it: one 8-digit hex word per line. */
export function goldenText(words) {
  return words.map((w) => `${hex(w)}\n`).join('');
}

/**
 * Change records of the first `count` retired instructions of `program` on
 * the instruction-level simulator (iss.js Hart.step()), from reset. Returns
 * {records, error}: error is the SimError message if the program stopped on
 * one before `count` instructions.
 */
export function traceRecords(program, profile, count, options = {}) {
  const hart = new Hart(program, { profile, ...options }); // iss-priv: options.platformConfig is the stimulus script
  const records = [];
  let error = null;
  try {
    while (records.length < count && !hart.halted) {
      const rec = hart.step();
      if (rec && rec.cls) records.push(rec);
    }
  } catch (e) {
    if (!(e instanceof SimError)) throw e;
    error = e.message;
  }
  return { records, error };
}

/** JSON-lines trace of WS-V-010, one line per retired instruction (as rvsim.py --trace-json). */
export function traceJsonLines(records) {
  return records.map((r) => `${JSON.stringify(traceRecord(r))}\n`).join(''); // a trap is {pc, trap, next_pc} (iss-priv)
}

/** The same trace as CSV, with hexadecimal values and the disassembly (rvdis.py style). */
export function traceCsv(records) {
  const rows = ['step,pc,word,instruction,rd,rd_value,mem_addr,mem_size,mem_value'];
  records.forEach((r, i) => {
    rows.push([
      i + 1, h8(r.pc), h8(r.word), `"${disassemble(r.word, r.pc).replace(/"/g, '""')}"`,
      r.reg ? `x${r.reg.rd}` : '', r.reg ? h8(r.reg.value) : '',
      r.mem ? h8(r.mem.addr) : '', r.mem ? r.mem.size : '', r.mem ? h8(r.mem.value) : '',
    ].join(','));
  });
  return `${rows.join('\n')}\n`;
}

// The waveform recording and the VCD writer are the shell's (src/shell/vcd.js, architecture contract v4); the
// headless runner and the tests read them here as before.
export const recordFrames = shellRecordFrames;
export const vcd = shellVcd;
