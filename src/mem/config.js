// config.js -- the memory setting of the interface (docs/architecture/memory-hierarchy.md §10, D2, D5,
// D8): the three levels (ideal, main memory, cache + main memory), the main-memory presets, the cache
// presets, validation, reading a saved setting defensively, and building the MemorySystem. No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { MemorySystem, MAX_WORDS } from './system.js';
import { MAIN_PRESETS, validateMain } from './timing.js';
import { validateCache } from './cache.js';

export const CONFIG_KEY = 'pips.mem.v1';
export const DEFAULT_WORDS = 256;
export const WORD_SIZES = Object.freeze([256, 512, 1024, 2048, 4096, 8192, MAX_WORDS]);

/** Illustrative cache designs for teaching; no claim that they match any real processor. */
export const CACHE_PRESETS = Object.freeze([
  { id: 'dm-small', name: 'Direct-mapped, 256 B, 16 B blocks', size: 256, block: 16, ways: 1, repl: 'lru', write: 'wb', hit: 1 },
  { id: 'dm-1k', name: 'Direct-mapped, 1 KiB, 16 B blocks', size: 1024, block: 16, ways: 1, repl: 'lru', write: 'wb', hit: 1 },
  { id: '2way-1k', name: '2-way, 1 KiB, 16 B blocks, LRU', size: 1024, block: 16, ways: 2, repl: 'lru', write: 'wb', hit: 1 },
  { id: '4way-2k', name: '4-way, 2 KiB, 32 B blocks, LRU', size: 2048, block: 32, ways: 4, repl: 'lru', write: 'wb', hit: 1 },
  { id: 'fifo-2way', name: '2-way, 1 KiB, FIFO', size: 1024, block: 16, ways: 2, repl: 'fifo', write: 'wb', hit: 1 },
  { id: 'random-4way', name: '4-way, 1 KiB, random (seeded)', size: 1024, block: 16, ways: 4, repl: 'random', write: 'wb', hit: 1, seed: 1 },
  { id: 'wt-dm', name: 'Direct-mapped, 1 KiB, write-through', size: 1024, block: 16, ways: 1, repl: 'lru', write: 'wt', hit: 1 },
  { id: 'full-256', name: 'Fully associative, 256 B, 16 B blocks', size: 256, block: 16, ways: 16, repl: 'lru', write: 'wb', hit: 1 },
]);

const cacheOf = (p) => ({ size: p.size, block: p.block, ways: p.ways, repl: p.repl, write: p.write, alloc: p.alloc ?? null, hit: p.hit, seed: p.seed ?? 1 });

/** The setting of a new session: ideal memory, 256 words, nothing else on. */
export function defaultConfig() {
  const m = MAIN_PRESETS[1];
  return {
    mode: 'ideal', words: DEFAULT_WORDS, ports: 1, writeBuffer: 'none', devices: false,
    main: { preset: m.id, overhead: m.overhead, readLatency: m.readLatency, writeLatency: m.writeLatency, busWidth: m.busWidth },
    l1i: { on: true, ...cacheOf(CACHE_PRESETS[1]) },
    l1d: { on: true, ...cacheOf(CACHE_PRESETS[2]) },
  };
}

/** `ways` of a fully associative cache of this size and block. */
export const fullWays = (size, block) => size / block;

/** Messages describing what is wrong with the setting (empty: it can be activated). */
export function validateConfig(cfg) {
  const out = [];
  if (!WORD_SIZES.includes(cfg.words)) out.push(`memory size must be one of ${WORD_SIZES.join(', ')} words`);
  if (cfg.mode !== 'ideal') out.push(...validateMain(cfg.main));
  if (cfg.mode === 'cache') {
    if (!cfg.l1i.on && !cfg.l1d.on) out.push('switch on the instruction cache, the data cache, or both');
    for (const [k, c] of [['L1I', cfg.l1i], ['L1D', cfg.l1d]]) if (c.on) out.push(...validateCache(c).map((m) => `${k}: ${m}`));
  }
  return out;
}

/**
 * A MemorySystem for the setting, or null when ideal memory of the default size is wanted (the models
 * then run without one, exactly as before). {memsys, messages}: an invalid setting gives no system.
 */
export function buildMemsys(cfg, { platform = null } = {}) {
  const messages = validateConfig(cfg);
  if (messages.length) return { memsys: null, messages };
  if (cfg.mode === 'ideal' && cfg.words === DEFAULT_WORDS && !(cfg.devices && platform)) return { memsys: null, messages };
  const memsys = new MemorySystem();
  const r = memsys.configure({
    mode: cfg.mode, words: cfg.words, ports: cfg.ports, writeBuffer: cfg.writeBuffer,
    main: cfg.mode === 'ideal' ? null : { overhead: cfg.main.overhead, readLatency: cfg.main.readLatency, writeLatency: cfg.main.writeLatency, busWidth: cfg.main.busWidth },
    l1i: cfg.mode === 'cache' && cfg.l1i.on ? cacheOf(cfg.l1i) : null,
    l1d: cfg.mode === 'cache' && cfg.l1d.on ? cacheOf(cfg.l1d) : null,
  });
  if (r.ok && cfg.devices && platform) memsys.setPlatform(platform); // GPIO, timer and UART on the bus of the processor models
  return r.ok ? { memsys, messages: [] } : { memsys: null, messages: r.messages };
}

const int = (v, d) => (Number.isInteger(v) ? v : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);

/** A setting from saved or shared text; anything unusable gives the default. Values are kept as they are
 *  when they are the right type, so that an invalid setting is shown and reported, not silently changed. */
export function readConfig(text) {
  const d = defaultConfig();
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch { return d; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return d;
  const cache = (c, base) => {
    if (!c || typeof c !== 'object') return base;
    return { on: c.on !== false, size: int(c.size, base.size), block: int(c.block, base.block), ways: int(c.ways, base.ways),
      repl: typeof c.repl === 'string' ? c.repl : base.repl, write: typeof c.write === 'string' ? c.write : base.write,
      alloc: c.alloc === 'wa' || c.alloc === 'nwa' ? c.alloc : null, hit: int(c.hit, base.hit), seed: int(c.seed, 1) };
  };
  const m = o.main && typeof o.main === 'object' ? o.main : d.main;
  return {
    mode: pick(o.mode, ['ideal', 'main', 'cache'], d.mode), words: int(o.words, d.words), ports: pick(o.ports, [1, 2], d.ports),
    writeBuffer: pick(o.writeBuffer, ['none', 'ideal'], d.writeBuffer), devices: o.devices === true,
    main: { preset: typeof m.preset === 'string' ? m.preset : 'custom', overhead: int(m.overhead, d.main.overhead), readLatency: int(m.readLatency, d.main.readLatency),
      writeLatency: int(m.writeLatency, d.main.writeLatency), busWidth: int(m.busWidth, d.main.busWidth) },
    l1i: cache(o.l1i, d.l1i), l1d: cache(o.l1d, d.l1d),
  };
}

export const writeConfig = (cfg) => JSON.stringify(cfg);

/** One line saying what the setting is, for the toolbar and the compare mode. */
export function describe(cfg) {
  const dev = cfg.devices ? ' + platform devices' : '';
  if (cfg.mode === 'ideal') return cfg.words === DEFAULT_WORDS ? `Ideal memory: one cycle per access${dev}` : `Ideal memory, ${cfg.words} words${dev}`;
  const m = cfg.main;
  const main = `main memory ${m.overhead}+${m.readLatency}/${m.writeLatency} cycles, ${m.busWidth}-byte bus`;
  if (cfg.mode === 'main') return `Without cache: ${main}`;
  const c = (x, n) => (x.on ? `${n} ${x.size >= 1024 ? `${x.size / 1024} KiB` : `${x.size} B`} ${x.ways === 1 ? 'direct-mapped' : x.ways === x.size / x.block ? 'fully associative' : `${x.ways}-way`}` : null);
  return `With cache: ${[c(cfg.l1i, 'L1I'), c(cfg.l1d, 'L1D')].filter(Boolean).join(', ')}; ${main}`;
}

