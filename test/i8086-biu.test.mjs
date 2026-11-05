// The 8086's BIU and instruction queue, clock by clock (src/arch/i8086/biu-model.js; milestone 8086-B5, L2; design
// docs/architecture/i8086-biu.md): the invariants of Intel's documented rules over the templates (with and without a
// wait state); the committed state still follows the instruction-level engine; step back by clocks returns exactly;
// hand cases (odd target, odd word operand, the EU's request after a fetch in progress, a full queue, an empty queue,
// prefixes); planted faults caught by the checks; and 25 SingleStepTests/8086 v1 cases of each normal file ([TEST];
// MIT; a CMOS P80C86A-2; skipped with a message when the suite is absent; the full run is `node
// tools/i8086/biu-check.mjs`). The comparisons with [TEST] count events and compare addresses and widths, never
// clocks: L2 makes no claim about clock counts. Agreement of the simulator's own models is not evidence about the 8086.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CPU_REGS, phys } from '../src/arch/i8086/cpu.js';
import { undefinedFlags } from '../src/arch/i8086/microops.js';
import { create } from '../src/arch/i8086/engine.js';
import { descriptor } from '../src/arch/i8086/index.js';
import { BiuCore, ClockModel, instructionDriver, runClocked, busCycles, QUEUE_SIZE } from '../src/arch/i8086/biu-model.js';
import { invariantProblems, biuFile } from '../tools/i8086/biu-check.mjs';
import { available, files, load, SST_DIR } from '../tools/i8086/sst.mjs';

const skipSST = available() ? false : `SingleStepTests/8086 not found at ${SST_DIR}`;
const dir = new URL('../content/i8086/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const asm = (text, profile = 'flat') => {
  const p = descriptor.language.assemble([{ name: 'p.asm', text }], { profile });
  assert.ok(p.ok, JSON.stringify(p.errors ?? p.diagnostics ?? ''));
  return p;
};
const programs = index.templates.flatMap((t) => (t.id === 'segments' ? ['flat', 'segmented'] : ['flat'])
  .map((profile) => [`${t.id}/${profile}`, asm(readFileSync(new URL(t.file, dir), 'utf8'), profile)]));
programs.push(['default', asm(descriptor.language.defaultSource)]);
const recsOf = (m) => m.journal.map((j) => j.rec);

/** One instruction from a small state: code bytes at CS:IP = 1000:0100, the queue empty. */
function one(code, { regs = {}, queue = 0, waitStates = 0, tail = 12, mem: extra = [] } = {}) {
  const r = { AX: 0, BX: 0, CX: 0, DX: 0, SP: 0x100, BP: 0, SI: 0, DI: 0, CS: 0x1000, DS: 0x2000, ES: 0x3000, SS: 0x4000, IP: 0x100, FLAGS: 0xf002, ...regs };
  const mem = new Map(extra);
  code.forEach((b, i) => mem.set(phys(r.CS, r.IP + i), b));
  const q = code.slice(0, queue).map((v, i) => ({ a: phys(r.CS, r.IP + i), v }));
  const drv = instructionDriver(r, mem);
  const core = new BiuCore({ read: (a) => mem.get(a) ?? 0x90, ip: r.IP, queue: q, waitStates });
  const recs = runClocked(core, drv, { tail });
  return { recs, drv, r };
}

for (const waitStates of [0, 1]) {
  test(`i8086 B5: the templates clock by clock (${waitStates} wait states): invariants hold, no stale byte, commits follow the L1 engine`, () => {
    for (const [name, p] of programs) {
      const m = new ClockModel(p, { waitStates });
      const e = create(p);
      let n = 0;
      while (!m.halted && m.clocks < 2_000_000) {
        const res = m.mm.cur.res;
        const r = m.stepInstruction();
        e.step();
        const ref = e.state().registers;
        const mask = ~undefinedFlags(res.d) & 0xffff;
        for (const k of CPU_REGS) assert.equal((m.mm.c[k] ^ ref[k]) & (k === 'FLAGS' ? mask : 0xffff), 0, `${name}: ${k} after ${n}`);
        n += 1;
        if (r !== 'step') break;
      }
      assert.ok(m.halted && !m.error, `${name}: runs to HLT`);
      const recs = recsOf(m);
      assert.deepEqual(invariantProblems(recs, { waitStates }), [], name);
      assert.ok(!recs.some((r) => r.took?.stale), `${name}: a stale byte`);
      assert.equal(recs.filter((r) => r.finished).length, n, `${name}: instructions`);
      assert.deepEqual(m.mm.mem, Uint8Array.from(e.peek(0, 0x100000)), `${name}: memory at the end`);
      assert.equal(m.mm.output, e.state().output, `${name}: console`);
      // every clock is T1-T4, Tw or Ti; the EU either performs a step or waits for a byte or for the bus
      assert.ok(recs.every((r) => ['T1', 'T2', 'T3', 'Tw', 'T4', 'Ti'].includes(r.t) && ['step', 'queue-wait', 'bus-wait'].includes(r.eu)), name);
    }
  });
}

test('i8086 B5: one clock at a time; step back returns to every earlier clock exactly', () => {
  const [, p] = programs.find(([n]) => n === 'default');
  const m = new ClockModel(p);
  const snap = () => JSON.stringify({ s: m.core.s, k: m.mm.k, regs: m.mm.regs, retired: m.mm.retired, out: m.mm.output, count: m.mm.count });
  const seen = [];
  for (let i = 0; i < 600 && !m.halted; i++) { seen.push(snap()); m.clock(); }
  assert.ok(m.mm.retired > 20);
  for (let i = seen.length - 1; i >= 0; i--) { assert.ok(m.back()); assert.equal(snap(), seen[i], `back to clock ${i}`); }
  assert.equal(m.back(), false);
  // and forward again to the same records
  const again = new ClockModel(p);
  for (let i = 0; i < 300; i++) { m.clock(); again.clock(); }
  assert.deepEqual(recsOf(m), recsOf(again));
});

test('i8086 B5 view: peek gives the next clock\'s record and changes nothing; instruction starts and back by instructions', () => {
  for (const [name, p] of programs) {
    const m = new ClockModel(p, { waitStates: 1 });
    const snap = () => JSON.stringify({ s: m.core.s, k: m.mm.k, regs: m.mm.regs, retired: m.mm.retired, out: m.mm.output, count: m.mm.count, mem: m.mm.mem.slice(0x10000, 0x10400) });
    const starts = [0]; // the clocks at which an instruction starts
    let peeks = 0;
    while (!m.halted && m.clocks < 3000) {
      const before = snap();
      const want = m.peek();
      assert.equal(snap(), before, `${name}: peek at clock ${m.clocks} changed the model`);
      if (m.atStart) peeks += 1;
      m.clock();
      assert.deepEqual(m.last, want, `${name}: clock ${m.last.n} differs from its peek`);
      if (m.last.finished && !m.halted) starts.push(m.clocks);
    }
    assert.equal(m.peek(), null, `${name}: no clock after the end`);
    // atStart holds on exactly one clock per instruction started
    if (m.halted) assert.equal(peeks, m.mm.retired, `${name}: instruction starts`);
    // back by instructions lands on each start in turn, then at clock 0, then refuses
    if (!m.halted) continue;
    m.back(); // into the last instruction
    for (let i = starts.length - 1; i >= 0; i--) {
      assert.ok(m.backInstruction(), `${name}: back to start ${i}`);
      assert.equal(m.clocks, starts[i], `${name}: start ${i}`);
      assert.ok(m.atStart, `${name}: atStart at ${starts[i]}`);
    }
    assert.equal(m.backInstruction(), false);
  }
});

test('i8086 B5: the queue fills to six bytes and the BIU idles; fast instructions empty it and the EU waits', () => {
  // a long instruction (DIV by a loop of steps) lets the BIU fill the queue
  const slow = new ClockModel(asm('MOV AX, 1234H\nMOV DX, 0\nMOV BX, 7\nDIV BX\nNOP\nNOP\nNOP\nNOP\nNOP\nNOP\nHLT\n'));
  while (!slow.halted) slow.clock();
  assert.ok(!slow.error, slow.error);
  const sr = recsOf(slow);
  // words arrive in pairs, so the queue stops at five or six bytes: with one byte free no fetch starts
  assert.ok(sr.some((r) => r.q >= QUEUE_SIZE - 1 && r.t === 'Ti'), 'full queue, idle bus');
  assert.ok(sr.every((r) => !(r.t === 'Ti' && r.q < QUEUE_SIZE - 1 && r.eu !== 'bus-wait')), 'the BIU idles only with the queue full');
  assert.ok(sr.every((r) => r.q <= QUEUE_SIZE));
  // three-byte immediates taken one per clock: the queue runs dry
  const fast = new ClockModel(asm(`${'MOV AX, 1234H\n'.repeat(12)}HLT\n`));
  while (!fast.halted) fast.clock();
  const fr = recsOf(fast);
  assert.ok(fr.filter((r) => r.eu === 'queue-wait').length > 12, 'the EU waits for bytes');
  assert.deepEqual(invariantProblems(fr), []);
});

test('i8086 B5: a transfer to an odd address fetches one byte there, then words; the fetch in progress is discarded', () => {
  // JMP short +1 at 1000:0100: target 0103 (odd); four bytes queued, so a fetch is under way when the jump flushes
  const { recs } = one([0xeb, 0x01, 0x90, 0x90, 0x90, 0x90], { queue: 2 });
  const e = recs.findIndex((r) => r.qs === 'E');
  assert.ok(e > 0);
  assert.equal(recs[e].q, 0, 'the flush empties the queue');
  const code = recs.slice(e).filter((r) => r.start && r.cycle.kind === 'code').map((r) => r.cycle);
  assert.deepEqual(code[0], { kind: 'code', address: 0x10103, size: 8 });
  const more = one([0xeb, 0x01, 0x90, 0x90, 0x90, 0x90], { queue: 2, tail: 20 }).recs;
  const all = more.filter((r) => r.start && r.cycle.kind === 'code' && r.n >= e).map((r) => r.cycle);
  assert.ok(all.length >= 1);
  // a discarded cycle never puts its bytes into the queue
  const disc = recs.filter((r) => r.cycle?.discard);
  for (const r of disc) if (r.t === 'T4') assert.equal(r.q, 0);
  // even target: words from the start
  const even = one([0xeb, 0x02, 0x90, 0x90, 0x90, 0x90], { queue: 2 }).recs;
  const ev = even.findIndex((r) => r.qs === 'E');
  assert.deepEqual(even.slice(ev).find((r) => r.start && r.cycle.kind === 'code').cycle, { kind: 'code', address: 0x10104, size: 16 });
});

test('i8086 B5: a word operand at an odd address takes two byte cycles; at an even address one word cycle', () => {
  assert.deepEqual(busCycles({ op: 'read', address: 0x20201, address2: 0x20202, size: 16 }), [{ kind: 'read', address: 0x20201, size: 8 }, { kind: 'read', address: 0x20202, size: 8 }]);
  assert.deepEqual(busCycles({ op: 'write', address: 0x20200, address2: 0x20201, size: 16 }), [{ kind: 'write', address: 0x20200, size: 16 }]);
  assert.deepEqual(busCycles({ op: 'out', port: 0x41, size: 16 }), [{ kind: 'out', address: 0x41, size: 8 }, { kind: 'out', address: 0x42, size: 8 }]);
  // MOV AX, [0201H]: A1 01 02 -- two read cycles, the EU waits through both
  const { recs } = one([0xa1, 0x01, 0x02], { queue: 3 });
  const data = recs.filter((r) => r.start && r.cycle.kind !== 'code').map((r) => r.cycle);
  assert.deepEqual(data, [{ kind: 'read', address: 0x20201, size: 8 }, { kind: 'read', address: 0x20202, size: 8 }]);
  const even = one([0xa1, 0x00, 0x02], { queue: 3 }).recs.filter((r) => r.start && r.cycle.kind !== 'code');
  assert.equal(even.length, 1);
  assert.equal(even[0].cycle.size, 16);
});

test('i8086 B5: the EU\'s request waits for a fetch in progress to complete, then goes before the next fetch', () => {
  // MOV AX, [BX] (8B 07) with only its two bytes queued: a fetch starts at once, the EU's read comes during it
  const { recs } = one([0x8b, 0x07, 0x90, 0x90, 0x90, 0x90], { queue: 2, tail: 0 });
  const req = recs.findIndex((r) => r.eu === 'bus-wait');
  assert.ok(req > 0);
  const busy = recs[req].cycle;
  assert.equal(busy?.kind, 'code', 'a code fetch was on the bus when the EU asked');
  const t4 = recs.findIndex((r, i) => i >= req && r.cycle?.kind === 'code' && r.t === 'T4');
  assert.equal(recs[t4 + 1].t, 'T1');
  assert.equal(recs[t4 + 1].cycle.kind, 'read', 'the EU\'s cycle follows at once, before another fetch');
  // the read's step is performed in the clock of its T4
  const rt4 = recs.findIndex((r) => r.cycle?.kind === 'read' && r.t === 'T4');
  assert.ok(recs[rt4].performed && recs[rt4].step.kind === 'bus');
});

test('i8086 B5: queue events -- each prefix and the op code are first bytes (F), the rest subsequent (S), a flush E', () => {
  // ES: MOV AX, [BX+12H] -- 26 8B 47 12
  const { recs } = one([0x26, 0x8b, 0x47, 0x12], { queue: 4 });
  assert.equal(recs.filter((r) => r.qs).map((r) => r.qs).join(''), 'FFSS');
  const j = one([0xeb, 0x10], { queue: 2 }).recs;
  assert.equal(j.filter((r) => r.qs).map((r) => r.qs).join(''), 'FSE');
});

test('i8086 B5: wait states lengthen every bus cycle by Tw after T3', () => {
  const { recs } = one([0xa1, 0x00, 0x02], { queue: 3, waitStates: 2 });
  const ts = recs.filter((r) => r.cycle?.kind === 'read').map((r) => r.t).join(' ');
  assert.equal(ts, 'T1 T2 T3 Tw Tw T4');
  assert.deepEqual(invariantProblems(recs, { waitStates: 2 }), []);
});

test('i8086 B5: planted faults in clock records are caught by the invariant checks', () => {
  const [, p] = programs.find(([n]) => n === 'default');
  const m = new ClockModel(p);
  for (let i = 0; i < 400; i++) m.clock();
  const base = recsOf(m).map((r) => ({ ...r }));
  assert.deepEqual(invariantProblems(base), []);
  const plant = (f) => { const c = base.map((r) => ({ ...r })); f(c); return invariantProblems(c).length; };
  const fetch = base.findIndex((r) => r.start && r.cycle.kind === 'code');
  assert.ok(plant((c) => { c[fetch].start = { free: 1 }; }), 'a fetch with one byte free');
  assert.ok(plant((c) => { c[10].q = 7; }), 'seven bytes queued');
  const t3 = base.findIndex((r) => r.t === 'T3');
  assert.ok(plant((c) => { c[t3].t = 'T4'; }), 'a cycle without T3');
  assert.ok(plant((c) => { c[t3 + 1].t = 'Ti'; }), 'a cycle cut short');
  const took = base.findIndex((r) => r.took);
  assert.ok(plant((c) => { c[took].took = { ...c[took].took, a: c[took].took.a + 1 }; }), 'a byte from the wrong address');
  const { recs } = one([0xeb, 0x01, 0x90, 0x90], { queue: 2 });
  const e = recs.findIndex((r) => r.qs === 'E');
  const wrong = recs.map((r) => ({ ...r }));
  wrong[e].q = 1;
  assert.ok(invariantProblems(wrong).length, 'a flush that leaves a byte');
  const f = recs.findIndex((r, i) => i > e && r.start && r.cycle.kind === 'code');
  const word = recs.map((r) => ({ ...r }));
  word[f].cycle = { ...word[f].cycle, size: 16 };
  assert.ok(invariantProblems(word).length, 'a word fetch at an odd target');
});

test('i8086 B5 [TEST]: invariants, queue events, data cycles and the first fetch after a flush, 25 tests of each normal SingleStepTests file', { skip: skipSST }, () => {
  let total = 0; let fail = 0;
  const bad = [];
  for (const f of files().filter((x) => x.status === 'normal')) {
    let tests;
    try { tests = load(f.name); } catch { continue; }
    const r = biuFile(f, { limit: 25, keep: 1, tests });
    total += r.pass + r.fail;
    fail += r.fail;
    if (r.fail) bad.push(`${f.name}: ${JSON.stringify(r.failures[0])}`);
  }
  assert.ok(total > 6000, `${total} tests`);
  assert.equal(fail, 0, bad.slice(0, 5).join('\n'));
});
