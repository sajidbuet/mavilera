// trace-cache.js -- trace-driven cache counters for the instruction-level (ISA) view
// (docs/architecture/memory-hierarchy.md §7). The program runs from reset on a fresh engine of the architecture
// (contract v5: each step record gives the fetch, `pc` and `size`, its data reads, `reads`, and its writes,
// `memory`); every fetch goes through the L1I and every load and store through the L1D of the memory setting, on the
// same Cache engine as the processor views. The instruction-level view has no clock, so only counts are produced: no
// cycles, no stalls. The caches only count: the program's own stores keep the memory right, so the lines are filled
// from the engine's memory as it is (read without side effects), and nothing is written back into it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Cache, RamLevel, DEFAULT_CACHE } from './cache.js';

const littleWord = (bytes) => (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;

/** The engine's memory as a store for RamLevel: read through peek; a write-back changes nothing (the memory is right). */
function peekStore(engine) {
  return { read: (a, size) => { const b = engine.peek(a >>> 0, size); let v = 0; for (let i = size - 1; i >= 0; i--) v = v * 256 + b[i]; return v >>> 0; }, write: () => {} };
}

/** The program's executable segments as a store: the instruction memory of a Harvard profile, which peek does not read. */
function codeStore(program) {
  const code = program.segments.filter((s) => s.executable);
  const byte = (a) => { for (const s of code) if (a >= s.address && a < s.address + s.bytes.length) return s.bytes[a - s.address]; return 0; };
  return { read: (a, size) => (size === 4 ? littleWord([0, 1, 2, 3].map((i) => byte((a + i) >>> 0))) : byte(a >>> 0)), write: () => {} };
}

/**
 * Run a program and count the cache accesses of its instruction trace.
 * @param {{create: () => object, program: object, harvard: boolean, devices?: {base: number, size: number}[]}} run  a
 *   fresh engine of the program; whether its instructions are in a memory of their own (the profile's `memory`); the
 *   device regions of the address map, which the caches do not hold when the engine has devices (Engine.platform)
 * @param {{l1i: object, l1d: object}} cfg the setting's caches ({on, size, block, ways, repl, write, alloc, hit, seed})
 * @param {number} limit instructions
 * @returns {{caches: {I: Cache|null, D: Cache|null}, instructions: number, stop: 'halt'|'limit'|'error', error: string|null}}
 */
export function traceCacheRun(run, cfg, limit = 1_000_000) {
  return new TraceCache(run, cfg).advanceTo(limit);
}

/**
 * The same run, kept so that it can go forward by instructions: the instruction-level view shows the
 * caches at its current position (`advanceTo(n)`); going back means a new TraceCache replayed to n.
 */
export class TraceCache {
  constructor({ create, program, harvard = false, devices = [] }, cfg) {
    this.program = program;
    this.cfg = cfg;
    this.engine = create();
    const dev = this.engine.platform?.() ? devices : [];
    this.cached = (a) => !dev.some((r) => a >= r.base && a < r.base + r.size);
    const data = new RamLevel(peekStore(this.engine));
    const make = (c, level, name) => (c.on ? new Cache({ ...DEFAULT_CACHE, size: c.size, block: c.block, ways: c.ways, repl: c.repl, write: c.write, alloc: c.alloc ?? null,
      hit: c.hit, seed: c.seed }, level, name) : null);
    this.caches = { I: make(cfg.l1i, harvard ? new RamLevel(codeStore(program)) : data, 'L1I'), D: make(cfg.l1d, data, 'L1D') };
    this.instructions = 0;
    this.stop = 'limit';
    this.error = null;
  }

  /** Instructions retired so far. */
  get retired() { return this.engine.state().retired; }

  /** Run on until `n` instructions in all have retired (or the program halts or fails); returns this. */
  advanceTo(n) {
    const { engine, caches, cached } = this;
    if (this.error) return this;
    let retired = engine.state().retired; // counted from the records (a trap retires nothing): state() is costly per step
    while (retired < n) {
      const rec = engine.step();
      if (!rec) {
        const s = engine.state();
        if (s.error) { this.stop = 'error'; this.error = s.error; } else this.stop = 'halt';
        break;
      }
      if (!rec.trap) caches.I?.access('read', rec.pc >>> 0, rec.size); // the fetch (a trap taken fetches nothing here)
      for (const r of rec.reads ?? []) if (cached(r.address)) caches.D?.access('read', r.address >>> 0, r.size);
      for (const w of rec.memory) if (cached(w.address)) caches.D?.access('write', w.address >>> 0, w.size, w.value >>> 0);
      if (rec.halt) { this.stop = 'halt'; break; }
      if (!rec.trap) retired += 1;
    }
    this.instructions = engine.state().retired; // the halt word is fetched, not executed; an exit call is both
    return this;
  }
}
