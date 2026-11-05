// mem-cache.test.mjs -- phase 3 of the memory hierarchy (docs/architecture/memory-hierarchy.md §5, WS-F-112):
// the cache engine. Hand-computed behaviour of each policy; data kept coherent with memory under every
// policy; and, against the book's rvcache.py (when the book repository and Python 3 are present), the
// same per-access hit/miss, miss kind and victim and the same counts on seeded random traces.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { Memory } from '../src/core/memory.js';
import { Cache, RamLevel, validateCache } from '../src/mem/cache.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIM = process.env.MES_BOOK_SIM ?? join(ROOT, '..', 'book-MES', 'code', 'sim');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const skipRef = !existsSync(join(SIM, 'rvcache.py')) ? 'book repository not found beside this one'
  : !existsSync(join(ROOT, 'tools', 'ref_cache.py')) ? 'tools/ref_cache.py is in the private repository only'
  : spawnSync(PYTHON, ['--version']).status !== 0 ? 'Python 3 not found' : false;

const make = (cfg, mem = new Memory()) => ({ mem, c: new Cache(cfg, new RamLevel(mem), 'D') });

// ---- configuration -----------------------------------------------------------------------------

test('validateCache: powers of two, block >= 4, block x ways <= size, known policies', () => {
  assert.deepEqual(validateCache({ size: 1024, block: 16, ways: 2 }), []);
  assert.equal(validateCache({ size: 1000 }).length, 1);
  assert.equal(validateCache({ block: 2 }).length, 1);
  assert.equal(validateCache({ size: 64, block: 32, ways: 4 }).length, 1);
  assert.equal(validateCache({ repl: 'plru', write: 'wx', alloc: 'x', hit: 0 }).length, 4);
  assert.throws(() => new Cache({ size: 100 }, null), /power of two/);
});

test('geometry: sets, index and offset bits; default alloc follows the write policy', () => {
  const { c } = make({ size: 1024, block: 16, ways: 2 });
  assert.equal(c.nSets, 32);
  assert.equal(c.offBits, 4);
  assert.equal(c.idxBits, 5);
  assert.equal(c.cfg.alloc, 'wa');
  assert.equal(make({ write: 'wt' }).c.cfg.alloc, 'nwa');
});

// ---- hand-computed behaviour ---------------------------------------------------------------------

test('direct-mapped: a compulsory miss, then hits inside the same block', () => {
  const { c } = make({ size: 64, block: 16, ways: 1 }); // 4 sets
  const r = (a) => c.access('read', a, 4).rec;
  const first = r(0);
  assert.deepEqual([first.hit, first.kind], [false, 'compulsory']);
  assert.equal(r(4).hit, true);
  assert.equal(r(12).hit, true);
  assert.equal(c.stats.hits, 2);
  assert.equal(c.stats.compulsory, 1);
});

test('direct-mapped: block 4 (set 0) is evicted by block 64; returning gives a conflict miss', () => {
  const { c } = make({ size: 64, block: 16, ways: 1 });
  c.access('read', 0, 4);
  const b = c.access('read', 64, 4).rec;
  assert.deepEqual([b.hit, b.kind, b.evicted], [false, 'compulsory', 0]);
  const a = c.access('read', 0, 4).rec;
  assert.deepEqual([a.hit, a.kind, a.evicted], [false, 'conflict', 64]); // a 4-block fully associative cache would hold it
  assert.equal(c.stats.evictions, 2);
});

test('LRU and FIFO choose different victims; LRU keeps the block just used', () => {
  const run = (repl) => {
    const { c } = make({ size: 32, block: 16, ways: 2, repl }); // one set, two ways
    c.access('read', 0x00, 4);
    c.access('read', 0x10, 4);
    c.access('read', 0x00, 4); // hit: refreshes block 0 under LRU only
    return c.access('read', 0x20, 4).rec.evicted;
  };
  assert.equal(run('lru'), 0x10);
  assert.equal(run('fifo'), 0x00);
});

test('random replacement repeats for the same seed and differs between seeds', () => {
  const victims = (seed) => {
    const { c } = make({ size: 64, block: 16, ways: 4, repl: 'random', seed }); // one set, four ways
    const out = [];
    for (let i = 0; i < 40; i++) out.push(c.access('read', i * 16, 4).rec.evicted);
    return out;
  };
  assert.deepEqual(victims(7), victims(7));
  assert.notDeepEqual(victims(7), victims(8));
});

test('plan() changes nothing, and commit() does what plan() said', () => {
  const { c } = make({ size: 32, block: 16, ways: 2 });
  c.access('read', 0, 4); c.access('read', 0x10, 4);
  const before = JSON.stringify([c.stats, [...c.shadow.keys()], c.sets.map((s) => s.order), c.rng]);
  const p = c.plan('read', 0x20, 4);
  assert.equal(JSON.stringify([c.stats, [...c.shadow.keys()], c.sets.map((s) => s.order), c.rng]), before);
  assert.equal(p.hit, false);
  assert.equal(p.fill, true);
  assert.equal(p.victim.addr, 0);
  assert.equal(c.commit(p).rec.evicted, 0);
});

test('write-back + write-allocate: a store marks the line dirty; memory changes only at eviction', () => {
  const { c, mem } = make({ size: 32, block: 16, ways: 1, write: 'wb' }); // 2 sets
  mem.write(0, 4, 0x11111111);
  c.access('write', 0, 4, 0xdeadbeef);
  assert.equal(mem.read(0, 4), 0x11111111, 'memory not written yet');
  assert.equal(c.debugRead(0, 4), 0xdeadbeef, 'the processor sees the line');
  assert.equal(c.dirtyBlocks(), 1);
  assert.equal(c.stats.fills, 1);
  c.access('read', 32, 4); // same set: evicts the dirty block
  assert.equal(mem.read(0, 4), 0xdeadbeef);
  assert.equal(c.stats.writebacks, 1);
  assert.equal(c.stats.bytesToNext, 16);
  assert.equal(c.dirtyBlocks(), 0);
});

test('write-through + no-write-allocate: store miss writes memory only; store hit updates both', () => {
  const { c, mem } = make({ size: 32, block: 16, ways: 1, write: 'wt' });
  c.access('write', 0, 4, 5);
  assert.equal(mem.read(0, 4), 5);
  assert.equal(c.find(0), null, 'no allocation on a store miss');
  assert.equal(c.stats.fills, 0);
  c.access('read', 0, 4);
  c.access('write', 0, 4, 9);
  assert.equal(mem.read(0, 4), 9);
  assert.equal(c.access('read', 0, 4).value, 9);
  assert.equal(c.stats.writeThroughs, 2);
  assert.equal(c.dirtyBlocks(), 0);
});

test('write-back + no-write-allocate: a store miss goes to memory, a store hit makes the line dirty', () => {
  const { c, mem } = make({ size: 32, block: 16, ways: 1, write: 'wb', alloc: 'nwa' });
  c.access('write', 0, 4, 1);
  assert.equal(mem.read(0, 4), 1);
  assert.equal(c.stats.writeThroughs, 1);
  c.access('read', 0, 4);
  c.access('write', 4, 4, 2);
  assert.equal(mem.read(4, 4), 0);
  assert.equal(c.dirtyBlocks(), 1);
});

test('byte and half-word accesses read and write the right bytes of the line', () => {
  const { c, mem } = make({ size: 64, block: 16, ways: 1 });
  mem.write(0, 4, 0x44332211);
  assert.equal(c.access('read', 1, 1).value, 0x22);
  assert.equal(c.access('read', 2, 2).value, 0x4433);
  c.access('write', 2, 1, 0xaa);
  c.access('write', 4, 2, 0xbbcc);
  assert.equal(c.debugRead(0, 4), 0x44aa2211);
  assert.equal(c.debugRead(4, 4), 0xbbcc);
  c.flush();
  assert.equal(mem.read(0, 4), 0x44aa2211);
});

test('debugWrite updates memory and a present line without counting; flush and invalidate', () => {
  const { c, mem } = make({ size: 64, block: 16, ways: 1 });
  c.access('read', 0, 4);
  const n = c.stats.accesses;
  c.debugWrite(0, 4, 0x1234);
  assert.equal(c.stats.accesses, n);
  assert.equal(mem.read(0, 4), 0x1234);
  assert.equal(c.debugRead(0, 4), 0x1234);
  c.debugWrite(0x100, 4, 7); // not cached
  assert.equal(c.debugRead(0x100, 4), 7);
  c.invalidate();
  assert.equal(c.find(0), null);
});

test('L2: an L1 fill is one L2 read, a dirty eviction one L2 write; data reach memory through both', () => {
  const mem = new Memory();
  const l2 = new Cache({ size: 256, block: 32, ways: 2 }, new RamLevel(mem), 'L2');
  const l1 = new Cache({ size: 32, block: 16, ways: 1 }, l2, 'L1');
  l1.access('write', 0, 4, 0xcafe);
  assert.deepEqual([l2.stats.reads, l2.stats.writes], [1, 0]);
  l1.access('read', 32, 4); // evicts the dirty block into L2
  assert.deepEqual([l2.stats.reads, l2.stats.writes], [2, 1]);
  assert.equal(l1.debugRead(0, 4), 0xcafe);
  assert.equal(mem.read(0, 4), 0, 'dirty in L2, not yet in memory');
  l2.flush();
  assert.equal(mem.read(0, 4), 0xcafe);
});

// ---- data stay coherent under every policy ---------------------------------------------------------

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

const POLICIES = [];
for (const repl of ['lru', 'fifo', 'random']) {
  for (const write of ['wb', 'wt']) for (const alloc of ['wa', 'nwa']) POLICIES.push({ repl, write, alloc });
}

for (const pol of POLICIES) {
  for (const [size, block, ways] of [[256, 16, 1], [256, 16, 4], [256, 64, 2]]) {
    test(`data coherence: ${pol.repl} ${pol.write}+${pol.alloc}, ${size} B, ${block} B blocks, ${ways}-way`, () => {
      const { c, mem } = make({ size, block, ways, ...pol, seed: 3 });
      const flat = new Memory(); // what memory must hold: every store applied directly
      const r = rng(11);
      for (let i = 0; i < 3000; i++) {
        const size_ = [1, 2, 4][r() % 3];
        const addr = ((r() % 2048) & ~(size_ - 1)) >>> 0;
        if (r() % 2) {
          const v = r() >>> 0;
          c.access('write', addr, size_, v);
          flat.write(addr, size_, v);
        } else {
          assert.equal(c.access('read', addr, size_).value, flat.read(addr, size_), `read ${addr} after ${i} accesses`);
        }
      }
      for (let a = 0; a < 2048; a += 4) assert.equal(c.debugRead(a, 4), flat.read(a, 4));
      c.flush();
      for (let a = 0; a < 2048; a += 4) assert.equal(mem.read(a, 4), flat.read(a, 4), `memory ${a} after flush`);
      assert.equal(c.dirtyBlocks(), 0);
      const s = c.stats;
      assert.equal(s.hits + s.misses, s.accesses);
      assert.equal(s.compulsory + s.capacity + s.conflict, s.misses);
    });
  }
}

// ---- against rvcache.py -------------------------------------------------------------------------

function trace(seed, n) {
  const r = rng(seed);
  const out = [];
  let pc = 0;
  for (let i = 0; i < n; i++) {
    const k = r() % 10;
    if (k < 4) { // instruction stream: mostly sequential, with jumps
      pc = r() % 12 === 0 ? (r() % 512) * 4 : (pc + 4) % 2048;
      out.push(['F', pc, 4]);
    } else {
      const size = [1, 2, 4, 4][r() % 4];
      const base = k < 8 ? 0x1000 + (r() % 64) * 4 : 0x1000 + (r() % 1024) * 4; // a hot region and a wide one
      out.push([k === 9 ? 'W' : k === 8 ? 'R' : r() % 3 ? 'R' : 'W', (base + (r() % 4)) & ~(size - 1), size]);
    }
  }
  return out;
}

function reference(specs, tr) {
  const dir = mkdtempSync(join(tmpdir(), 'rvcache-'));
  try {
    const f = join(dir, 'job.json');
    writeFileSync(f, JSON.stringify({ specs, trace: tr }));
    const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'ref_cache.py'), SIM, f], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const spec = (lv, c, extra = '') => `${lv}:size=${c.size},block=${c.block},ways=${c.ways},repl=${c.repl},write=${c.write},alloc=${c.alloc}${extra}`;

const COUNTS = { accesses: 'accesses', reads: 'reads', writes: 'writes', hits: 'hits', misses: 'misses', compulsory: 'compulsory',
  capacity: 'capacity', conflict: 'conflict', fills: 'fills', evictions: 'evictions', writebacks: 'writebacks',
  write_throughs: 'writeThroughs', bytes_from_next: 'bytesFromNext', bytes_to_next: 'bytesToNext' };

const sameCounts = (py, cache, what) => {
  for (const [k, j] of Object.entries(COUNTS)) assert.equal(cache.stats[j], py[k], `${what}: ${k}`);
  assert.equal(cache.dirtyBlocks(), py.dirty_at_halt, `${what}: dirty at halt`);
};

const REF_CONFIGS = [];
for (const repl of ['lru', 'fifo']) {
  for (const [write, alloc] of [['wb', 'wa'], ['wb', 'nwa'], ['wt', 'nwa'], ['wt', 'wa']]) {
    for (const [size, block, ways] of [[512, 16, 1], [512, 16, 2], [1024, 32, 4], [256, 16, 16]]) REF_CONFIGS.push({ size, block, ways, repl, write, alloc });
  }
}

test('rvcache.py: per-access hit/miss, miss kind and victim, and every count, on seeded traces (split I and D)', { skip: skipRef }, () => {
  const tr = trace(5, 6000);
  for (const cfg of REF_CONFIGS) {
    const icfg = { ...cfg, write: 'wt', alloc: 'nwa', size: 256, ways: 2 };
    const py = reference([spec('i', icfg), spec('d', cfg)], tr);
    const mem = new Memory();
    const I = new Cache(icfg, new RamLevel(mem), 'I');
    const D = new Cache(cfg, new RamLevel(mem), 'D');
    const what = JSON.stringify(cfg);
    let n = 0;
    for (const [kind, addr, size] of tr) {
      const rec = (kind === 'F' ? I : D).access(kind === 'W' ? 'write' : 'read', addr, size, 0).rec;
      const ref = py.trace[n++];
      assert.deepEqual([rec.hit, rec.kind, rec.evicted, rec.set, rec.tag], [ref.hit, ref.kind, ref.evicted, ref.set, ref.tag], `${what} access ${n}`);
    }
    assert.equal(py.trace.length, tr.length);
    sameCounts(py.report.d, D, `${what} D`);
    sameCounts(py.report.i, I, `${what} I`);
  }
});

test('rvcache.py: a unified cache and an L2 behind split L1 caches give the same counts at both levels', { skip: skipRef }, () => {
  const tr = trace(9, 5000);
  const l1 = { size: 256, block: 16, ways: 2, repl: 'lru', write: 'wb', alloc: 'wa' };
  const l2 = { size: 2048, block: 32, ways: 4, repl: 'fifo', write: 'wb', alloc: 'wa' };
  const py = reference([spec('i', l1), spec('d', l1), spec('l2', l2)], tr);
  const mem = new Memory();
  const L2 = new Cache(l2, new RamLevel(mem), 'L2');
  const I = new Cache(l1, L2, 'I');
  const D = new Cache(l1, L2, 'D');
  for (const [kind, addr, size] of tr) (kind === 'F' ? I : D).access(kind === 'W' ? 'write' : 'read', addr, size, 0);
  sameCounts(py.report.i, I, 'I');
  sameCounts(py.report.d, D, 'D');
  sameCounts(py.report.l2, L2, 'L2');
  const u = { size: 512, block: 16, ways: 4, repl: 'lru', write: 'wb', alloc: 'wa' };
  const pu = reference([spec('u', u)], tr);
  const U = new Cache(u, new RamLevel(new Memory()), 'U');
  for (const [kind, addr, size] of tr) U.access(kind === 'W' ? 'write' : 'read', addr, size, 0);
  sameCounts(pu.report.u, U, 'U');
});
