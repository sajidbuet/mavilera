// compare-memory.test.mjs -- the three processors under the memory models A (ideal), B (main memory) and C
// (main memory with caches), docs/architecture/memory-hierarchy.md D9, phase 6. The numbers of a tiny program
// are worked out by hand from the cycle rules of the processors and the controller; larger programs are
// checked by invariants (the memory model never changes what a program computes; counts add up).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compare, compareMemory, memoryCsv, memoryRatios, scenarioConfigs, SCENARIOS, ORGANISATIONS } from '../src/uarch/compare.js';
import { defaultConfig } from '../src/mem/config.js';
import { ch07 } from './ch07-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const DATA = { t6: json('content/data/ch06-tables.json'), delays6: json('content/data/ch06-delays.json'), t7: ch07().t7, timing8: json('content/data/ch08-timing.json') };

const files = (text) => [{ name: 't.s', text }];
const TINY = 'addi t0, zero, 512\nsw t0, 0(t0)\nlw t1, 0(t0)\nhalt\n'; // 3 instructions: a store and a load
const LOOP = `        addi t0, zero, 512
        addi t1, zero, 32
        addi a0, zero, 0
loop:   sw   a0, 0(t0)
        lw   t2, 0(t0)
        add  a0, a0, t2
        addi a0, a0, 1
        addi t0, t0, 4
        addi t1, t1, -1
        bne  t1, zero, loop
        halt
`;
// moderate main memory: overhead 1 + latency 4 + one bus beat = a word access takes 6 cycles
const cfg = (ports) => ({ ...defaultConfig(), words: 1024, ports });
const row = (rows, profile, scenario) => rows.find((r) => r.profile === profile && r.scenario === scenario);

test('scenario A is the existing comparison: same cycles, same instructions', () => {
  const old = compare(files(LOOP), DATA, { jalr: true }).rows;
  const { rows } = compareMemory(files(LOOP), DATA, cfg(1), { jalr: true });
  for (const [i, p] of ORGANISATIONS.entries()) {
    const a = row(rows, p, 'A');
    assert.ok(a.ok, `${p}: ${a.error}`);
    assert.equal(a.cycles, old[i].cycles, p);
    assert.equal(a.n, old[i].n, p);
    assert.deepEqual(a.stalls, { data: 0, fetch: 0, arbitration: 0, total: 0 });
    assert.equal(a.hit.I, null);
    assert.equal(a.sameResult, null);
  }
});

test('single-cycle, B, two ports (worked by hand): every edge fetches, 6 cycles an edge', () => {
  // 3 edges, each fetch takes 6 cycles; the store and the load overlap their access with the fetch (2 ports)
  // waits: addi 5 (fetch), sw 5 (data), lw 5 (data) = 15; cycles 3 + 15 = 18; CPI 6; IPC 1/6
  const b = row(compareMemory(files(TINY), DATA, cfg(2), { jalr: true }).rows, 'ch06', 'B');
  assert.equal(b.n, 3);
  assert.equal(b.cycles, 18);
  assert.deepEqual(b.stalls, { data: 10, fetch: 5, arbitration: 0, total: 15 });
  assert.equal(b.cpi, 6);
  assert.ok(Math.abs(b.ipc - 1 / 6) < 1e-12);
  assert.equal(b.transactions, 5, 'three fetches, one store, one load');
});

test('single-cycle, B, one port (worked by hand): data first, the fetch waits for the bus', () => {
  // addi: fetch 5 waits. sw and lw: data 5 + fetch 5 + 1 arbitration = 11 waits each. waits 27, cycles 30.
  const b = row(compareMemory(files(TINY), DATA, cfg(1), { jalr: true }).rows, 'ch06', 'B');
  assert.equal(b.cycles, 30);
  assert.deepEqual(b.stalls, { data: 10, fetch: 15, arbitration: 2, total: 27 });
  assert.equal(b.cpi, 10);
});

test('multicycle, B (worked by hand): a wait in FETCH, MEMWR and MEMRD', () => {
  // ideal cycles: addi 4, sw 4, lw 5 = 13. waits: 3 fetches x 5, store 5, load 5 = 25 (each state is alone on the bus)
  const rows = compareMemory(files(TINY), DATA, cfg(1), { jalr: true }).rows;
  assert.equal(row(rows, 'ch07', 'A').cycles, 13);
  const b = row(rows, 'ch07', 'B');
  assert.equal(b.cycles, 38);
  assert.deepEqual(b.stalls, { data: 10, fetch: 15, arbitration: 0, total: 25 });
  assert.equal(b.n, 3);
});

test('every row: the memory model does not change what the program computes; stall cycles add up', () => {
  const { rows } = compareMemory(files(LOOP), DATA, cfg(1), { jalr: true });
  assert.equal(rows.length, 9);
  for (const r of rows) {
    assert.ok(r.ok, `${r.profile}/${r.scenario}: ${r.error} ${r.detail}`);
    if (r.scenario !== 'A') assert.equal(r.sameResult, true, `${r.profile}/${r.scenario}`);
    assert.equal(r.stalls.total, r.stalls.data + r.stalls.fetch + r.stalls.arbitration);
    assert.ok(Math.abs(r.cpi * r.ipc - 1) < 1e-12);
  }
  for (const p of ORGANISATIONS) {
    const [a, b, c] = SCENARIOS.map((s) => row(rows, p, s));
    assert.equal(a.n, b.n, `${p}: the same instructions complete`);
    assert.equal(a.n, c.n);
    assert.ok(b.cycles > a.cycles, `${p}: main memory costs cycles`);
    assert.ok(c.cycles < b.cycles, `${p}: a cache over a loop pays back (${c.cycles} < ${b.cycles})`);
    assert.ok(c.hit.I > 0.8 && c.hit.I <= 1, `${p}: the loop fits the instruction cache`);
    assert.ok(c.hit.D >= 0 && c.hit.D <= 1);
    assert.equal(a.stalls.total, 0);
  }
});

test('ratios: C over A, C over B, B over A per processor; CPI against the single-cycle processor', () => {
  const { rows, ratios } = compareMemory(files(LOOP), DATA, cfg(1), { jalr: true });
  for (const p of ORGANISATIONS) {
    const [a, b, c] = SCENARIOS.map((s) => row(rows, p, s));
    assert.equal(ratios.perProcessor[p].cOverA, c.cycles / a.cycles);
    assert.equal(ratios.perProcessor[p].cOverB, c.cycles / b.cycles);
    assert.equal(ratios.perProcessor[p].bOverA, b.cycles / a.cycles);
    assert.ok(ratios.perProcessor[p].cOverB < 1);
  }
  assert.equal(ratios.cpiVsSingle.A.ch06, 1);
  assert.equal(ratios.cpiVsSingle.B.ch08, row(rows, 'ch08', 'B').cpi / row(rows, 'ch06', 'B').cpi);
  // a missing run gives null, never a made-up number
  const r = memoryRatios([{ profile: 'ch06', scenario: 'A', ok: true, cycles: 4, cpi: 1 }]);
  assert.equal(r.perProcessor.ch06.cOverA, null);
  assert.equal(r.cpiVsSingle.B.ch07, null);
});

test('a scenario that cannot be built says why, and the others still run', () => {
  const d = defaultConfig();
  const bad = { ...d, words: 1024, l1i: { ...d.l1i, on: false }, l1d: { ...d.l1d, on: false } };
  const sc = scenarioConfigs(bad);
  assert.equal(sc.C, null);
  assert.match(sc.problems.C[0], /instruction cache, the data cache, or both/);
  const { rows } = compareMemory(files(TINY), DATA, bad, { jalr: true });
  assert.equal(row(rows, 'ch06', 'C').error, 'config');
  assert.ok(row(rows, 'ch06', 'A').ok && row(rows, 'ch06', 'B').ok);
});

test('errors of the program are reported per row: profile errors, a run that does not halt', () => {
  const lb = compareMemory(files('lb x1, 0(x0)\nhalt\n'), DATA, cfg(1)).rows;
  assert.ok(lb.every((r) => !r.ok && r.error === 'profile' && r.detail === 'lb'));
  const spin = compareMemory(files('loop: addi t0, t0, 1\nj loop\n'), DATA, cfg(1), { limit: 200 }).rows;
  assert.ok(spin.every((r) => !r.ok && r.error === 'limit'));
});

test('the write buffer switch changes only the cost: ideal absorbs dirty evictions', () => {
  const small = { ...cfg(1), l1d: { ...defaultConfig().l1d, size: 64, block: 16, ways: 1, write: 'wb' } };
  const charged = compareMemory(files(LOOP), DATA, small, { jalr: true }).rows;
  const absorbed = compareMemory(files(LOOP), DATA, { ...small, writeBuffer: 'ideal' }, { jalr: true }).rows;
  for (const p of ORGANISATIONS) {
    assert.ok(row(absorbed, p, 'C').cycles < row(charged, p, 'C').cycles, p);
    assert.equal(row(absorbed, p, 'C').hit.D, row(charged, p, 'C').hit.D, `${p}: the counts do not depend on the cost`);
    assert.equal(row(absorbed, p, 'B').cycles, row(charged, p, 'B').cycles, 'no cache: nothing to absorb in B');
  }
});

test('CSV: a header and one line per row, numbers as numbers, empty where a value does not exist', () => {
  const result = compareMemory(files(TINY), DATA, cfg(2), { jalr: true });
  const lines = memoryCsv(result).trimEnd().split('\n');
  assert.equal(lines.length, 10);
  const head = lines[0].split(',');
  assert.equal(head[0], 'processor');
  for (const l of lines.slice(1)) assert.equal(l.split(',').length, head.length);
  const b = lines.find((l) => l.startsWith('ch06,B,')).split(',');
  assert.equal(b[head.indexOf('cycles')], '18');
  assert.equal(b[head.indexOf('cpi')], '6');
  assert.equal(b[head.indexOf('hit_rate_L1I')], '', 'no cache in B');
  const err = memoryCsv(compareMemory(files('lb x1, 0(x0)\nhalt\n'), DATA, cfg(1))).split('\n')[1].split(',');
  assert.equal(err.at(-1), 'profile');
});
