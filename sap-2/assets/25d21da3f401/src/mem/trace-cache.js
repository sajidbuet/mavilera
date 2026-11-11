// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Cache, RamLevel, DEFAULT_CACHE } from './cache.js';
const littleWord = (bytes) => (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
function peekStore(engine) {
 return { read: (a, size) => { const b = engine.peek(a >>> 0, size); let v = 0; for (let i = size - 1; i >= 0; i--) v = v * 256 + b[i]; return v >>> 0; }, write: () => {} };
}
function codeStore(program) {
 const code = program.segments.filter((s) => s.executable);
 const byte = (a) => { for (const s of code) if (a >= s.address && a < s.address + s.bytes.length) return s.bytes[a - s.address]; return 0; };
 return { read: (a, size) => (size === 4 ? littleWord([0, 1, 2, 3].map((i) => byte((a + i) >>> 0))) : byte(a >>> 0)), write: () => {} };
}
export function traceCacheRun(run, cfg, limit = 1_000_000) {
 return new TraceCache(run, cfg).advanceTo(limit);
}
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
 get retired() { return this.engine.state().retired; }
 advanceTo(n) {
 const { engine, caches, cached } = this;
 if (this.error) return this;
 let retired = engine.state().retired;
 while (retired < n) {
 const rec = engine.step();
 if (!rec) {
 const s = engine.state();
 if (s.error) { this.stop = 'error'; this.error = s.error; } else this.stop = 'halt';
 break;
 }
 if (!rec.trap) caches.I?.access('read', rec.pc >>> 0, rec.size);
 for (const r of rec.reads ?? []) if (cached(r.address)) caches.D?.access('read', r.address >>> 0, r.size);
 for (const w of rec.memory) if (cached(w.address)) caches.D?.access('write', w.address >>> 0, w.size, w.value >>> 0);
 if (rec.halt) { this.stop = 'halt'; break; }
 if (!rec.trap) retired += 1;
 }
 this.instructions = engine.state().retired;
 return this;
 }
}
