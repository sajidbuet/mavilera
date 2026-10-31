// cache.js -- the cache engine (docs/architecture/memory-hierarchy.md §5, phase 3). A set-associative
// cache with real line data, independent of any user interface and of any processor model. plan()
// says what an access would do and changes nothing; commit() applies it. The counts follow the rules
// of the book's rvcache.py (hits, misses and their three kinds, fills, evictions, write-backs,
// write-throughs, traffic), so they can be checked against it; timing is not here (the controller
// of phase 4 charges it). The lower level is any object with readBlock(), writeBlock() and write():
// a RamLevel over the memory store, or another Cache (an L2).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const isPow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

export const REPLACEMENT = Object.freeze(['lru', 'fifo', 'random']);

export const DEFAULT_CACHE = Object.freeze({ size: 1024, block: 16, ways: 1, repl: 'lru', write: 'wb', alloc: null, hit: 1, seed: 1 });

/** Messages describing what is wrong with a cache configuration (an empty list: valid). */
export function validateCache(cfg) {
  const c = { ...DEFAULT_CACHE, ...cfg };
  const out = [];
  for (const k of ['size', 'block', 'ways']) if (!isPow2(c[k])) out.push(`${k} must be a power of two`);
  if (isPow2(c.block) && c.block < 4) out.push('block must be at least 4 bytes');
  if (isPow2(c.block) && isPow2(c.ways) && isPow2(c.size) && c.block * c.ways > c.size) out.push('block x ways must not exceed size');
  if (!REPLACEMENT.includes(c.repl)) out.push(`repl must be one of ${REPLACEMENT.join(', ')}`);
  if (c.write !== 'wb' && c.write !== 'wt') out.push('write must be wb or wt');
  if (c.alloc !== null && c.alloc !== 'wa' && c.alloc !== 'nwa') out.push('alloc must be wa or nwa');
  if (!Number.isInteger(c.hit) || c.hit < 1) out.push('hit must be a whole number of cycles, 1 or more');
  return out;
}

/** The lowest level: a memory store (Memory or WordMemory) addressed by whole blocks. */
export class RamLevel {
  constructor(store) { this.store = store; }

  readBlock(addr, n) {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i += 4) {
      const w = this.store.read(addr + i, 4) >>> 0;
      b[i] = w; b[i + 1] = w >>> 8; b[i + 2] = w >>> 16; b[i + 3] = w >>> 24;
    }
    return b;
  }

  writeBlock(addr, bytes) {
    for (let i = 0; i < bytes.length; i += 4) {
      this.store.write(addr + i, 4, (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0);
    }
  }

  write(addr, size, value) { this.store.write(addr, size, value >>> 0); }
}

export const newCacheStats = () => ({
  accesses: 0, reads: 0, writes: 0, hits: 0, misses: 0, compulsory: 0, capacity: 0, conflict: 0,
  fills: 0, evictions: 0, writebacks: 0, writeThroughs: 0, bytesFromNext: 0, bytesToNext: 0,
});

export class Cache {
  /** @param {object} cfg see DEFAULT_CACHE; @param {object} lower RamLevel or Cache; @param {string} name */
  constructor(cfg, lower, name = 'C') {
    const bad = validateCache(cfg);
    if (bad.length) throw new Error(`cache ${name}: ${bad.join('; ')}`);
    const c = { ...DEFAULT_CACHE, ...cfg };
    c.alloc = c.alloc ?? (c.write === 'wb' ? 'wa' : 'nwa');
    this.cfg = c;
    this.name = name;
    this.lower = lower;
    this.nSets = c.size / (c.block * c.ways);
    this.offBits = Math.log2(c.block);
    this.idxBits = Math.log2(this.nSets);
    this.reset();
  }

  reset() {
    const { block, ways } = this.cfg;
    this.sets = Array.from({ length: this.nSets }, () => ({
      lines: Array.from({ length: ways }, () => ({ valid: false, dirty: false, tag: 0, data: new Uint8Array(block) })),
      order: [], // valid ways, the next victim of LRU / FIFO first
    }));
    this.shadow = new Map(); // fully associative LRU of the same block count: block -> true (capacity / conflict)
    this.seen = new Set();
    this.rng = (this.cfg.seed >>> 0) || 1;
    this.stats = newCacheStats();
    this.last = null;
  }

  split(addr) {
    const blk = (addr >>> 0) >>> this.offBits;
    return { blk, set: blk & (this.nSets - 1), tag: blk >>> this.idxBits };
  }

  blockAddr(tag, set) { return ((tag * this.nSets + set) * this.cfg.block) >>> 0; }

  nextRng() { // xorshift32; deterministic per cache and seed
    let x = this.rng;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x;
  }

  /**
   * What an access would do; nothing changes. op: 'read' | 'write'; the access lies inside one block.
   * @returns {{op, addr, size, set, tag, hit, way, victim, fill, writeThrough, rng}}
   */
  plan(op, addr, size) {
    const { set, tag } = this.split(addr);
    const S = this.sets[set];
    const p = { op, addr: addr >>> 0, size, set, tag, hit: false, way: -1, victim: null, fill: false,
      writeThrough: op === 'write' && this.cfg.write === 'wt', rng: this.rng };
    const way = S.lines.findIndex((l) => l.valid && l.tag === tag);
    if (way >= 0) return { ...p, hit: true, way };
    if (op === 'write' && this.cfg.alloc === 'nwa') return { ...p, writeThrough: true }; // memory only, no fill
    p.fill = true;
    p.way = S.lines.findIndex((l) => !l.valid);
    if (p.way < 0) {
      if (this.cfg.repl === 'random') { p.rng = this.nextRng(); p.way = p.rng % this.cfg.ways; }
      else p.way = S.order[0];
      const v = S.lines[p.way];
      p.victim = { way: p.way, tag: v.tag, dirty: v.dirty, addr: this.blockAddr(v.tag, set) };
    }
    return p;
  }

  /**
   * Apply a plan. `data` is the store's value (a number of `size` bytes, or a Uint8Array).
   * @returns {{value: number, rec: object}} the value read (reads) and the per-access record
   */
  commit(p, data = 0) {
    const { block } = this.cfg;
    const S = this.sets[p.set];
    const blk = ((p.tag * this.nSets + p.set));
    const allocate = p.op === 'read' || this.cfg.alloc === 'wa';
    const u = this.onUndo ? this.beginUndo(p, blk) : null; // per-access undo record (back-step), before anything changes
    const s = this.stats;
    s.accesses += 1;
    s[p.op === 'write' ? 'writes' : 'reads'] += 1;
    const shadowHit = this.shadowAccess(blk, allocate, u);
    const rec = { cache: this.name, op: p.op, addr: p.addr, size: p.size, tag: p.tag, set: p.set, hit: p.hit, kind: '', evicted: null, evictedDirty: false,
      filled: false, way: p.way, writeThrough: p.writeThrough, block: this.blockAddr(p.tag, p.set) };
    let way = p.way;
    if (p.hit) {
      s.hits += 1;
      if (this.cfg.repl === 'lru') this.touch(S, way);
    } else {
      s.misses += 1;
      const kind = !this.seen.has(blk) ? 'compulsory' : shadowHit ? 'conflict' : 'capacity';
      s[kind] += 1;
      rec.kind = kind;
      if (p.fill) {
        const line = S.lines[way];
        if (p.victim) {
          s.evictions += 1;
          rec.evicted = p.victim.addr;
          rec.evictedDirty = p.victim.dirty;
          S.order.splice(S.order.indexOf(way), 1);
          if (p.victim.dirty) {
            s.writebacks += 1;
            s.bytesToNext += block;
            if (u) u.ram.push([p.victim.addr, this.lower.readBlock(p.victim.addr, block)]);
            this.lower.writeBlock(p.victim.addr, line.data);
          }
        }
        this.rng = p.rng;
        line.valid = true; line.dirty = false; line.tag = p.tag;
        line.data = this.lower.readBlock(this.blockAddr(p.tag, p.set), block);
        S.order.push(way);
        s.fills += 1;
        rec.filled = true;
        s.bytesFromNext += block;
      }
    }
    this.seen.add(blk);
    const off = p.addr & (block - 1);
    const line = way >= 0 ? S.lines[way] : null;
    let value = 0;
    if (p.op === 'read') {
      if (line) for (let i = Math.min(p.size, 4) - 1; i >= 0; i--) value = ((value << 8) | line.data[off + i]) >>> 0;
    } else {
      if (line) {
        if (typeof data === 'number') for (let i = 0; i < p.size; i++) line.data[off + i] = (data >>> (8 * i)) & 0xff;
        else line.data.set(data, off);
      }
      if (p.writeThrough) {
        s.writeThroughs += 1;
        s.bytesToNext += 4; // rvcache.py counts a word, whatever the size of the store
        if (u) { const a = p.addr & ~3; u.ram.push([a, this.lower.readBlock(a, 4)]); }
        if (typeof data === 'number') this.lower.write(p.addr, p.size, data);
        else this.lower.writeBlock(p.addr, data);
      } else if (line) {
        line.dirty = true;
      }
    }
    this.last = rec; // what the viewer shows as the last access (restored by a back-step)
    return { value, rec };
  }

  /** plan() then commit(): one access. */
  access(op, addr, size, data = 0) { return this.commit(this.plan(op, addr, size), data); }

  shadowAccess(blk, allocate, u = null) {
    if (this.shadow.has(blk)) {
      if (u) u.shadow = { moved: blk, index: [...this.shadow.keys()].indexOf(blk) };
      this.shadow.delete(blk);
      this.shadow.set(blk, true);
      return true;
    }
    if (allocate) {
      let dropped = null;
      if (this.shadow.size >= this.cfg.size / this.cfg.block) {
        dropped = this.shadow.keys().next().value;
        this.shadow.delete(dropped);
      }
      this.shadow.set(blk, true);
      if (u) u.shadow = { added: blk, dropped };
    }
    return false;
  }

  // ---- undo (back-step): with `onUndo` set, each commit() hands over a function that restores the
  // state it changed: the touched way and the replacement order of its set, the counters, the
  // random-number state, the shadow cache, the `seen` set, and the memory blocks it wrote below.
  // Only a RamLevel below is supported (an L2 would need its own journal).

  beginUndo(p, blk) {
    const S = this.sets[p.set];
    const l = p.way >= 0 ? S.lines[p.way] : null;
    const u = {
      set: p.set, way: p.way, order: S.order.slice(), rng: this.rng, stats: { ...this.stats }, seen: this.seen.has(blk), blk,
      last: this.last, line: l && { valid: l.valid, dirty: l.dirty, tag: l.tag, data: l.data }, copy: l && l.data.slice(), shadow: null, ram: [],
    };
    this.onUndo(() => this.applyUndo(u));
    return u;
  }

  applyUndo(u) {
    for (let i = u.ram.length - 1; i >= 0; i--) this.lower.writeBlock(u.ram[i][0], u.ram[i][1]);
    const S = this.sets[u.set];
    if (u.line) { const l = S.lines[u.way]; l.valid = u.line.valid; l.dirty = u.line.dirty; l.tag = u.line.tag; l.data = u.copy; }
    S.order = u.order;
    this.rng = u.rng;
    this.last = u.last;
    this.stats = u.stats;
    if (!u.seen) this.seen.delete(u.blk);
    const sh = u.shadow;
    if (sh?.moved !== undefined) {
      const keys = [...this.shadow.keys()].filter((k) => k !== sh.moved);
      keys.splice(sh.index, 0, sh.moved);
      this.shadow = new Map(keys.map((k) => [k, true]));
    } else if (sh) {
      this.shadow.delete(sh.added);
      if (sh.dropped !== null) this.shadow = new Map([[sh.dropped, true], ...this.shadow]);
    }
  }

  touch(S, way) { S.order.splice(S.order.indexOf(way), 1); S.order.push(way); }

  // ---- the Level interface of an upper cache: one counted access per block or word moved

  readBlock(addr, n) {
    this.access('read', addr, n);
    const { line } = this.find(addr); // present: a read always allocates
    const off = addr & (this.cfg.block - 1);
    return line.data.slice(off, off + n);
  }

  writeBlock(addr, bytes) { this.access('write', addr, bytes.length, bytes); }

  write(addr, size, value) { this.access('write', addr, size, value >>> 0); }

  // ---- inspection and maintenance: no access is counted

  /** The line holding `addr`, or null. */
  find(addr) {
    const { set, tag } = this.split(addr);
    const way = this.sets[set].lines.findIndex((l) => l.valid && l.tag === tag);
    return way < 0 ? null : { set, way, line: this.sets[set].lines[way] };
  }

  /** Value the processor would see: the cache line if present, else memory. */
  debugRead(addr, size) {
    const f = this.find(addr);
    let bytes;
    let off;
    if (f) { bytes = f.line.data; off = addr & (this.cfg.block - 1); }
    else if (this.lower instanceof Cache) return this.lower.debugRead(addr, size);
    else { bytes = this.lower.readBlock(addr & ~3, 4); off = addr & 3; }
    let v = 0;
    for (let i = size - 1; i >= 0; i--) v = ((v << 8) | bytes[off + i]) >>> 0;
    return v;
  }

  /** Write memory and a matching line without counting an access (the memory pane). */
  debugWrite(addr, size, value) {
    const f = this.find(addr);
    if (f) {
      const off = addr & (this.cfg.block - 1);
      for (let i = 0; i < size; i++) f.line.data[off + i] = (value >>> (8 * i)) & 0xff;
    }
    if (this.lower instanceof Cache) this.lower.debugWrite(addr, size, value);
    else this.lower.write(addr, size, value);
  }

  dirtyBlocks() { return this.sets.reduce((n, S) => n + S.lines.filter((l) => l.valid && l.dirty).length, 0); }

  /** Write every dirty line back and clear its flag (FENCE.I for the data cache); not counted as an access. */
  flush() {
    for (let set = 0; set < this.nSets; set++) {
      for (const l of this.sets[set].lines) {
        if (l.valid && l.dirty) { this.lower.writeBlock(this.blockAddr(l.tag, set), l.data); l.dirty = false; }
      }
    }
  }

  invalidate() {
    for (const S of this.sets) { for (const l of S.lines) { l.valid = false; l.dirty = false; } S.order = []; }
  }

  report() {
    const s = { ...this.stats };
    s.hitRate = s.accesses ? s.hits / s.accesses : 0;
    s.missRate = s.accesses ? s.misses / s.accesses : 0;
    s.dirtyAtHalt = this.dirtyBlocks();
    return s;
  }
}
