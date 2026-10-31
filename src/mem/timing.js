// timing.js -- main-memory timing (docs/architecture/memory-hierarchy.md §6, phase 2).
// All times are CPU cycles. A transaction of `bytes` costs overhead + latency + ceil(bytes / busWidth).
// The presets are illustrative teaching values, not figures of any real memory device.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const MAIN_PRESETS = Object.freeze([
  { id: 'fast', name: 'Fast (SRAM-like)', overhead: 0, readLatency: 1, writeLatency: 1, busWidth: 4,
    note: 'Illustrative: one cycle of latency and one bus beat per word, so a word access takes 2 cycles.' },
  { id: 'moderate', name: 'Moderate', overhead: 1, readLatency: 4, writeLatency: 4, busWidth: 4,
    note: 'Illustrative: a word access takes 6 cycles.' },
  { id: 'slow', name: 'Slow (DRAM-like)', overhead: 2, readLatency: 12, writeLatency: 10, busWidth: 4,
    note: 'Illustrative: a word read takes 15 cycles, a word write 13.' },
]);

export const DEFAULT_MAIN = Object.freeze({ overhead: 0, readLatency: 0, writeLatency: 0, busWidth: 4 });

const nonNegInt = (v) => Number.isInteger(v) && v >= 0;

/** Messages describing what is wrong with a main-memory configuration (an empty list: valid). */
export function validateMain(cfg) {
  const out = [];
  for (const k of ['overhead', 'readLatency', 'writeLatency']) {
    if (!nonNegInt(cfg[k])) out.push(`${k} must be a whole number of cycles, 0 or more`);
  }
  if (!Number.isInteger(cfg.busWidth) || cfg.busWidth < 1 || (cfg.busWidth & (cfg.busWidth - 1))) {
    out.push('busWidth must be a power of two of at least 1 byte');
  }
  return out;
}

export class MainMemory {
  /** @param {{overhead: number, readLatency: number, writeLatency: number, busWidth: number}} cfg */
  constructor(cfg = DEFAULT_MAIN) {
    const bad = validateMain(cfg);
    if (bad.length) throw new Error(`main memory: ${bad.join('; ')}`);
    const { overhead, readLatency, writeLatency, busWidth } = cfg;
    Object.assign(this, { overhead, readLatency, writeLatency, busWidth });
  }

  /** Cycles of one transaction of `bytes` bytes. */
  transaction(bytes, op) {
    return this.overhead + (op === 'read' ? this.readLatency : this.writeLatency) + Math.ceil(bytes / this.busWidth);
  }
}
