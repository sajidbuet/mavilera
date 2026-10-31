// mem-cache-models.test.mjs -- phase 4 of the memory hierarchy (docs/architecture/memory-hierarchy.md §7, §8):
// L1I / L1D inside the three processor models. The architectural results (registers, memory as the
// processor sees it) must be those of the ideal run under every cache configuration; the cache counts
// must be consistent; stepping back through hits, misses, evictions and write-backs must restore the
// whole state (registers, visible memory, RAM, lines, counters, controller) exactly.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { MemorySystem } from '../src/mem/system.js';
import { ch07 } from './ch07-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const T7 = ch07().t7;
const MAIN = { overhead: 1, readLatency: 4, writeLatency: 4, busWidth: 4 };

// writes 16 words a stride of 0x20 apart (the profile memory is 1 KiB) (they collide in a small cache), reads them back and sums them
const SRC = `
        .text
_start: li    t0, 0x200
        li    t1, 16
        li    t2, 1
fill:   sw    t2, 0(t0)
        addi  t2, t2, 3
        addi  t0, t0, 0x20
        addi  t1, t1, -1
        bne   t1, zero, fill
        li    t0, 0x200
        li    t1, 16
        li    t4, 0
sum:    lw    t3, 0(t0)
        add   t4, t4, t3
        addi  t0, t0, 0x20
        addi  t1, t1, -1
        bne   t1, zero, sum
        sw    t4, 0x1f0(zero)
done:   jal   zero, done
`;

const MAKE = {
  ch06: (memsys) => new SingleCycle(T6, { memsys }),
  ch07: (memsys) => new Multicycle(T6, T7, { jalr: true, memsys }),
  ch08: (memsys) => new Pipeline(T6, { memsys }),
};

const image = (profile) => {
  const p = assemble([{ name: 't.s', text: SRC }], { profile });
  assert.deepEqual(p.errors, []);
  return p;
};

const CONFIGS = {
  'wb/wa direct 64B/16B': { l1i: { size: 64, block: 16 }, l1d: { size: 64, block: 16 } },
  'wt/nwa 2-way fifo': { l1i: { size: 128, block: 16, ways: 2, repl: 'fifo' }, l1d: { size: 128, block: 16, ways: 2, repl: 'fifo', write: 'wt' } },
  'wt/wa random 4-way': { l1i: { size: 256, block: 32, ways: 4, repl: 'random', seed: 7 }, l1d: { size: 256, block: 16, ways: 4, repl: 'random', write: 'wt', alloc: 'wa', seed: 9 } },
  'data cache only, lru 2-way': { l1i: null, l1d: { size: 64, block: 8, ways: 2, hit: 2 } },
  'instruction cache only': { l1i: { size: 64, block: 16 }, l1d: null },
};

function setup(profile, cfg) {
  const sys = new MemorySystem();
  const r = sys.configure({ mode: 'cache', main: MAIN, ...cfg });
  assert.deepEqual(r.messages, []);
  const m = MAKE[profile](sys);
  m.load(image(profile));
  return { sys, m };
}

const ideal = (profile) => {
  const m = MAKE[profile](null);
  m.load(image(profile));
  assert.equal(m.run(), 'halt');
  return m;
};

for (const profile of Object.keys(MAKE)) {
  for (const [name, cfg] of Object.entries(CONFIGS)) {
    test(`${profile}, ${name}: same architectural results as ideal memory; counts consistent`, () => {
      const a = ideal(profile);
      const { sys, m } = setup(profile, cfg);
      assert.equal(m.run(), 'halt');
      assert.deepEqual(Array.from(m.x), Array.from(a.x));
      assert.deepEqual(m.golden().slice(0, 33), a.golden().slice(0, 33).map((v, i) => (i === 33 ? 0 : v)), 'registers and pc');
      const vis = (q) => Array.from((q.dmem ?? q.mem).words);
      assert.deepEqual(vis(m), vis(a), 'memory as the processor sees it');
      assert.ok(m.cycle > a.cycle, 'misses cost cycles');
      const rep = sys.report();
      for (const c of [rep.I, rep.D]) {
        if (!c) continue;
        assert.equal(c.hits + c.misses, c.accesses);
        assert.equal(c.compulsory + c.capacity + c.conflict, c.misses);
      }
      if (rep.D) assert.ok(rep.D.misses > 0 && rep.D.writes === 16 + 1, `16 stores in the loop and 1 after: ${rep.D.writes}`);
      const L = rep.ledger;
      assert.equal(L.data + L.fetch + L.arbitration, L.waitCycles);
    });

    test(`${profile}, ${name}: back-step restores registers, memory, lines, counters and controller`, () => {
      const { sys, m } = setup(profile, cfg);
      const hash = () => JSON.stringify({
        g: m.golden(), x: Array.from(m.x), c: m.cycle, s: sys.save().stats, hold: sys.hold,
        ram: [sys.ports.I.store, sys.ports.D.store].map((s) => Array.from(s.words)),
        cache: ['I', 'D'].map((k) => sys.caches[k] && {
          st: sys.caches[k].stats, rng: sys.caches[k].rng, shadow: [...sys.caches[k].shadow.keys()], seen: [...sys.caches[k].seen],
          sets: sys.caches[k].sets.map((S) => ({ order: S.order, lines: S.lines.map((l) => [l.valid, l.dirty, l.tag, Array.from(l.data)]) })),
        }),
      });
      const states = [hash()];
      const N = 400;
      for (let i = 0; i < N; i++) { if (m.step() !== 'step') break; states.push(hash()); }
      assert.ok(states.length > 300, 'the program runs long enough to evict');
      if (m.halted) assert.ok(m.back(), 'the halt is not an edge: un-halting'); // a fast configuration reaches the halt
      for (let i = states.length - 2; i >= 0; i--) { assert.ok(m.back()); assert.equal(hash(), states[i], `back to edge ${i}`); }
      for (let i = 0; i < states.length - 1; i++) { m.step(); assert.equal(hash(), states[i + 1], `forward again, edge ${i + 1}`); }
    });
  }
}

test('a dirty line stays out of RAM until it is evicted; the processor still sees it', () => {
  const { sys, m } = setup('ch06', { l1i: null, l1d: { size: 64, block: 16 } });
  for (let i = 0; i < 200 && sys.caches.D.stats.writes < 1; i++) m.step();
  assert.equal(sys.caches.D.stats.writes, 1);
  assert.equal(sys.ports.D.store.words[0x200 >> 2], 0, 'RAM unchanged');
  assert.equal(sys.ports.D.read(0x200, 4), 1, 'visible through the cache');
});

test('invalid cache configurations are not activated', () => {
  const sys = new MemorySystem();
  const r = sys.configure({ mode: 'cache', main: MAIN, l1d: { size: 100 } });
  assert.equal(r.ok, false);
  assert.match(r.messages[0], /^l1d: /);
  assert.equal(sys.configure({ mode: 'cache', main: MAIN }).ok, false);
  assert.equal(sys.mode, 'ideal');
});
