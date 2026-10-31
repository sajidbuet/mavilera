// mem-timing.test.mjs -- phase 2 of the memory hierarchy (docs/architecture/memory-hierarchy.md §6, §7):
// main-memory timing, the controller, and wait edges in the three processor models. Cycle counts are
// checked against formulas computed by hand from an ideal run of the same program; the architectural
// results must not depend on the memory timing; a request is counted once however long it waits.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { Memory } from '../src/core/memory.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { Device } from '../src/mem/device.js';
import { Controller } from '../src/mem/controller.js';
import { MainMemory, MAIN_PRESETS, validateMain } from '../src/mem/timing.js';
import { MemorySystem } from '../src/mem/system.js';
import { ch07 } from './ch07-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const T7 = ch07().t7;

const MODERATE = { overhead: 1, readLatency: 4, writeLatency: 4, busWidth: 4 }; // a word access takes 6 cycles
const WORD = 6;

// ---- MainMemory and the controller ------------------------------------------------------------

test('MainMemory: transaction = overhead + latency + ceil(bytes / busWidth)', () => {
  const m = new MainMemory({ overhead: 2, readLatency: 12, writeLatency: 10, busWidth: 4 });
  assert.equal(m.transaction(4, 'read'), 15);
  assert.equal(m.transaction(4, 'write'), 13);
  assert.equal(m.transaction(1, 'read'), 15);
  assert.equal(m.transaction(16, 'read'), 18);
  assert.equal(new MainMemory({ overhead: 0, readLatency: 0, writeLatency: 0, busWidth: 8 }).transaction(4, 'read'), 1);
});

test('validateMain / configure: invalid values give messages and are not activated', () => {
  assert.deepEqual(validateMain(MODERATE), []);
  assert.equal(validateMain({ ...MODERATE, busWidth: 3 }).length, 1);
  assert.equal(validateMain({ ...MODERATE, readLatency: -1, overhead: 1.5 }).length, 2);
  for (const p of MAIN_PRESETS) assert.deepEqual(validateMain(p), [], p.id);
  const sys = new MemorySystem();
  const bad = sys.configure({ mode: 'main', main: { ...MODERATE, busWidth: 0 } });
  assert.equal(bad.ok, false);
  assert.equal(sys.timed, false, 'the previous (ideal) configuration stays');
  assert.equal(sys.configure({ mode: 'main', main: MODERATE, ports: 3 }).ok, false);
  assert.equal(sys.configure({ mode: 'cache' }).ok, false);
  assert.equal(sys.configure({ mode: 'main', main: MODERATE }).ok, true);
  assert.equal(sys.timed, true);
});

test('Controller.plan: one request; two ports overlap; one port serialises, data first, wait charged to arbitration', () => {
  const c2 = new Controller(2);
  const c1 = new Controller(1);
  assert.deepEqual(c2.plan({}), []);
  assert.deepEqual(c2.plan({ I: 1 }), []);
  assert.deepEqual(c2.plan({ D: 3 }), ['data', 'data']);
  assert.deepEqual(c2.plan({ I: 3 }), ['fetch', 'fetch']);
  assert.deepEqual(c2.plan({ I: 4, D: 2 }), ['data', 'fetch', 'fetch']); // 4 - 1 = 3 waits in all
  assert.deepEqual(c2.plan({ I: 2, D: 4 }), ['data', 'data', 'data']);
  assert.deepEqual(c1.plan({ I: 1, D: 1 }), ['arbitration']); // 1 + 1 - 1
  assert.deepEqual(c1.plan({ I: 3, D: 2 }), ['data', 'fetch', 'fetch', 'arbitration']); // 3 + 2 - 1
});

test('accessCycles: RAM costs a transaction, a device its own latency, ideal memory and a fault 1', () => {
  class Slow extends Device {
    constructor() { super({ name: 'slow', size: 0x100, latency: { read: 4, write: 2 } }); }
  }
  const sys = new MemorySystem();
  sys.addDevice(0x40000000, new Slow());
  sys.attach(new Memory(), new Memory());
  assert.equal(sys.accessCycles('D', 'read', 0x100, 4), 1, 'ideal');
  assert.equal(sys.configure({ mode: 'main', main: MODERATE }).ok, true);
  sys.attach(new Memory(), new Memory());
  assert.equal(sys.accessCycles('D', 'read', 0x100, 4), WORD);
  assert.equal(sys.accessCycles('D', 'read', 0x40000000, 4), 4);
  assert.equal(sys.accessCycles('D', 'write', 0x40000000, 4), 2);
  assert.equal(sys.accessCycles('D', 'read', 0xffffffff, 1), WORD);
});

test('waitEdge: a held request counts one transaction however long it waits; ideal mode never waits', () => {
  const sys = new MemorySystem();
  sys.attach(new Memory(), new Memory());
  assert.equal(sys.waitEdge({ D: { op: 'read', addr: 0, size: 4 } }), null);
  assert.equal(sys.stats.transactions, 0, 'ideal mode counts nothing');
  sys.configure({ mode: 'main', main: MODERATE });
  sys.attach(new Memory(), new Memory());
  const r = { D: { op: 'read', addr: 0, size: 4 } };
  const causes = [];
  for (let c; (c = sys.waitEdge(r)) !== null;) causes.push(c);
  assert.deepEqual(causes, Array(WORD - 1).fill('data'));
  assert.equal(sys.stats.transactions, 1);
  assert.equal(sys.stats.bytes, 4);
  assert.equal(sys.stats.waitCycles, WORD - 1);
  assert.equal(sys.hold, null);
});

// ---- the processor models ---------------------------------------------------------------------

const SRC = `
        .text
_start: li    t0, 0x11223344
        sw    t0, 0x200(zero)
        lw    t1, 0x200(zero)
        addi  t1, t1, 1
        sw    t1, 0x204(zero)
        li    t2, 5
loop:   addi  t2, t2, -1
        sw    t2, 0x208(zero)
        lw    t3, 0x208(zero)
        bne   t2, zero, loop
        lw    t4, 0x204(zero)
        add   t5, t4, t3
        sw    t5, 0x20c(zero)
done:   jal   zero, done
`;

const image = (profile) => {
  const p = assemble([{ name: 't.s', text: SRC }], { profile });
  assert.deepEqual(p.errors, []);
  return p;
};

const MAKE = {
  ch06: (memsys) => new SingleCycle(T6, { memsys }),
  ch07: (memsys) => new Multicycle(T6, T7, { jalr: true, memsys }),
  ch08: (memsys) => new Pipeline(T6, { memsys }),
};

const timedSys = (main = MODERATE, ports = 2) => {
  const sys = new MemorySystem();
  assert.equal(sys.configure({ mode: 'main', main, ports }).ok, true);
  return sys;
};

/**
 * Run an ideal model to the halt and count, over its real edges, what a timed run must add:
 * `fetch` edges that need an instruction fetch, `data` edges that need a data access, `both` edges that need both.
 */
function profileEdges(profile) {
  const m = MAKE[profile](null);
  m.load(image(profile));
  const n = { edges: 0, fetch: 0, data: 0, both: 0, any: 0, fetchStates: 0, memStates: 0 };
  for (;;) {
    const c = m.evaluate();
    const s = c.signals;
    let f = false;
    let d = false;
    if (profile === 'ch06') { f = true; d = !!s.MemWrite || s.ResultSel === 1; }
    else if (profile === 'ch07') { f = c.state === 'FETCH'; d = c.state === 'MEMRD' || !!s.MemWrite; }
    else { f = !s.stall_if; d = !!s.MemWrite_mem || !!s.MemRead_mem; }
    if (m.step() !== 'step') break;
    n.edges += 1;
    if (f) n.fetch += 1;
    if (d) n.data += 1;
    if (f && d) n.both += 1;
    if (f || d) n.any += 1;
  }
  n.cycles = m.cycle;
  return n;
}

function timed(profile, main = MODERATE, ports = 2) {
  const sys = timedSys(main, ports);
  const m = MAKE[profile](sys);
  m.load(image(profile));
  assert.equal(m.run(), 'halt');
  return { m, sys };
}

function ideal(profile) {
  const m = MAKE[profile](null);
  m.load(image(profile));
  assert.equal(m.run(), 'halt');
  return m;
}

test('single-cycle with wait states: two ports, each edge takes the longer of its accesses', () => {
  const n = profileEdges('ch06');
  const { m, sys } = timed('ch06');
  assert.equal(n.cycles, n.edges);
  assert.equal(m.cycle, n.edges * WORD, 'every edge fetches: 6 cycles each');
  assert.equal(sys.stats.waitCycles, m.cycle - n.edges);
  assert.equal(sys.stats.transactions, n.edges + n.data);
});

test('single-cycle with wait states: one port serialises fetch and data; the extra cycle is arbitration', () => {
  const n = profileEdges('ch06');
  const { m, sys } = timed('ch06', MODERATE, 1);
  assert.equal(m.cycle, n.edges * WORD + n.data * WORD);
  assert.equal(sys.stats.arbitration, n.data);
  assert.equal(sys.stats.data, n.data * (WORD - 1));
  assert.equal(sys.stats.fetch, n.edges * (WORD - 1));
});

test('multicycle: FETCH and MEM states wait; the other states do not', () => {
  const n = profileEdges('ch07');
  const { m, sys } = timed('ch07');
  assert.equal(m.cycle, n.edges + (WORD - 1) * (n.fetch + n.data));
  assert.equal(sys.stats.fetch, (WORD - 1) * n.fetch);
  assert.equal(sys.stats.data, (WORD - 1) * n.data);
  assert.equal(sys.stats.arbitration, 0);
  assert.equal(m.retired, ideal('ch07').retired);
});

test('pipeline: every memory wait freezes the pipeline; real edges are those of the ideal run', () => {
  const n = profileEdges('ch08');
  const { m, sys } = timed('ch08');
  assert.equal(m.cycle, n.edges + (WORD - 1) * n.any);
  assert.equal(sys.stats.waitCycles, m.cycle - n.edges);
  assert.equal(m.stats.retired, ideal('ch08').stats.retired);
  assert.equal(m.stats.loadUse, ideal('ch08').stats.loadUse, 'hazard counters do not count wait edges');
  const waits = m.trace.filter((r) => r?.wait);
  assert.equal(waits.length, sys.stats.waitCycles);
  assert.ok(waits.every((r) => !r.stall_if && !r.flush_ex && !r.lwStall));
});

for (const profile of Object.keys(MAKE)) {
  test(`${profile}: architectural results do not depend on the memory timing; transactions are counted once`, () => {
    const a = ideal(profile);
    const fast = timed(profile, MAIN_PRESETS[0]);
    const slow = timed(profile, MAIN_PRESETS[2]);
    assert.deepEqual(Array.from(fast.m.x), Array.from(a.x));
    assert.deepEqual(Array.from(slow.m.x), Array.from(a.x));
    const mem = (m) => m.golden().slice(m.golden().length - 64);
    assert.deepEqual(mem(slow.m), mem(a));
    assert.ok(slow.m.cycle > fast.m.cycle && fast.m.cycle > a.cycle);
    assert.equal(slow.sys.stats.transactions, fast.sys.stats.transactions, 'same requests whatever the latency');
    const s = slow.sys.stats;
    assert.equal(s.data + s.fetch + s.arbitration, s.waitCycles, 'each wait cycle has exactly one cause');
    assert.equal(slow.m.cycle - a.cycle, s.waitCycles);
  });

  test(`${profile}: step and back through wait edges restore the state and the ledger`, () => {
    const prog = image(profile);
    const sys = timedSys();
    const m = MAKE[profile](sys);
    m.load(prog);
    const snap = () => JSON.stringify({ g: m.golden(), s: sys.save(), c: m.cycle });
    const states = [snap()];
    for (let i = 0; i < 60; i++) { assert.equal(m.step(), 'step'); states.push(snap()); }
    for (let i = 59; i >= 0; i--) { assert.ok(m.back()); assert.equal(snap(), states[i], `back to edge ${i}`); }
    assert.equal(sys.hold, null);
    assert.equal(sys.stats.waitCycles, 0);
    for (let i = 0; i < 60; i++) { m.step(); assert.equal(snap(), states[i + 1], `forward again, edge ${i + 1}`); }
  });

  test(`${profile}: with ideal memory a memory system adds no cycle and counts nothing`, () => {
    const sys = new MemorySystem();
    const m = MAKE[profile](sys);
    m.load(image(profile));
    m.run();
    assert.equal(m.cycle, ideal(profile).cycle);
    assert.equal(sys.stats.transactions, 0);
  });
}

test('multicycle: stepInstruction and backInstruction treat the FETCH wait as part of the instruction', () => {
  const sys = timedSys();
  const m = MAKE.ch07(sys);
  m.load(image('ch07'));
  m.stepInstruction();
  assert.equal(m.state, 'FETCH');
  assert.equal(m.last.wait, undefined, 'ends on a real edge of the instruction');
  assert.equal(m.retired, 1);
  assert.ok(m.cycle >= WORD + 2, 'the fetch waited and the instruction has its other states');
  assert.ok(m.backInstruction());
  assert.equal(m.cycle, 0);
  assert.equal(m.retired, 0);
  assert.equal(sys.hold, null);
});
