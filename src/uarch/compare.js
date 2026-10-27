// compare.js -- one program on the three processors of Chapters 6-8 (spec
// §8.4, WS-F-060): N, cycles, CPI, the clock period of each organisation from
// the chapters' illustrative delays, execution time t_exec = N x CPI x T_c
// and the speed-up over the single-cycle processor, as tab:mc-compare and
// tab:pipe-compare set them out. The program is assembled for each profile
// (their data addresses differ, WS-F-002) and run to its halt on the
// signal-level models. T_c: Chapter 6 from the critical path of every class
// (timing.js, tab:sc-paths); Chapter 7 the longest step (tab:mc-steps);
// Chapter 8 the slowest stage plus the register overhead (wex:pipe-tc). The
// pipeline is the book's reference processor: complete hazard unit, branches
// resolved in EX, with the chosen predictor.
//
// Each run's final state is checked against the single-cycle run, since the
// three processors must compute the same results: registers and data memory
// for Chapter 8 (same memory map); for Chapter 7, whose data start at 0x200 of
// its one memory, registers and the data words there (a register that holds a
// data address differs legitimately, so a difference is reported, not
// treated as an error). A program that writes below 0x200 by absolute address
// overwrites its own code on Chapter 7. Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { assemble } from '../asm/assembler.js';
import { SingleCycle } from './single.js';
import { Multicycle } from './multi.js';
import { Pipeline } from './pipe.js';
import { classTable, delayMap } from './timing.js';

export const ORGANISATIONS = Object.freeze(['ch06', 'ch07', 'ch08']);

/** Clock periods in ps of the three processors, from the exported chapter data. */
export function clockPeriods({ t6, delays6, t7, timing8 }) {
  return { ch06: classTable(delayMap(delays6), t6).tc, ch07: t7.timing.tc, ch08: timing8.tc };
}

/**
 * Run the sources on each processor.
 * @param {Array<{name: string, text: string}>} files
 * @param {{t6, delays6, t7, timing8}} data content/data files
 * @param {{jalr?: boolean, predictor?: string, entries?: number, limit?: number}} options
 *   jalr: the multicycle JALR state (the answer of exercise PRB-0129, off by default)
 * @returns {{rows: Array<object>, tc: object}} one row per organisation:
 *   {profile, ok, error?, detail?, n, cycles, cpi, tc, timePs, speedup, agrees}
 *   agrees: final registers and data equal those of the single-cycle run (null for that run or without it)
 */
export function compare(files, data, { jalr = false, predictor = 'none', entries = 8, limit = 1_000_000 } = {}) {
  const tc = clockPeriods(data);
  const finals = {};
  const rows = ORGANISATIONS.map((profile) => {
    const p = assemble(files, { profile });
    if (!p.ok) return { profile, ok: false, error: 'assembly', detail: p.errors[0]?.message ?? '' };
    if (p.profileErrors.length) return { profile, ok: false, error: 'profile', detail: p.profileErrors[0].mnemonic };
    const m = profile === 'ch06' ? new SingleCycle(data.t6, { historyLimit: 0 })
      : profile === 'ch07' ? new Multicycle(data.t6, data.t7, { jalr, historyLimit: 0 })
        : new Pipeline(data.t6, { hazard: 'full', predictor, entries, historyLimit: 0 });
    m.load(p);
    let stop;
    try {
      stop = m.run(limit);
    } catch {
      return { profile, ok: false, error: 'limit', detail: String(limit) };
    }
    if (stop !== 'halt') return { profile, ok: false, error: 'stopped', detail: m.error ?? '' };
    const n = profile === 'ch06' ? m.cycle : profile === 'ch07' ? m.retired : m.stats.retired;
    const cycles = m.cycle;
    const mem = m.dmem ?? m.mem;
    const dataBase = profile === 'ch07' ? 0x200 / 4 : 0;
    finals[profile] = { x: Array.from(m.x), data: Array.from(mem.words.slice(dataBase, dataBase + 64)) };
    return { profile, ok: true, n, cycles, cpi: n ? cycles / n : null, tc: tc[profile], timePs: cycles * tc[profile] };
  });
  const base = rows[0].ok ? rows[0].timePs : null;
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (const r of rows) {
    r.speedup = r.ok && base && r.timePs ? base / r.timePs : null;
    r.agrees = r.ok && r.profile !== 'ch06' && finals.ch06
      ? same(finals[r.profile].x, finals.ch06.x) && same(finals[r.profile].data, finals.ch06.data) : null;
  }
  return { rows, tc };
}
