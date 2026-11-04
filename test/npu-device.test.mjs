// npu-device.test.mjs -- the NPU as a memory-mapped device (NPU-1, tests N8-N16 of
// docs/research/gpu-npu/verification/GOLDEN_TESTS.md, following the checks of the book's tb_npu): reset values,
// read-back, the busy interval of 2N + 1 cycles, accumulation, writes ignored while busy, clear, read-only RESULT,
// independence of the call order within an edge, back-step; also the decisions G5 (whole words only; RESULT read
// while busy) and a run on the single-cycle host through the bus. Time as docs/architecture/npu-device.md §2.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Npu, NPU_BASE, NPU_REG, npuEdge, npuReset, ctrlStep } from '../src/mem/npu.js';
import { Journal, Platform } from '../src/mem/platform.js';
import { Session, STOP } from '../src/core/session.js';
import { MemorySystem } from '../src/mem/system.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { buildMemsys, defaultConfig } from '../src/mem/config.js';
import { ch07 } from './ch07-content.mjs';
import { assemble } from '../src/asm/assembler.js';
import { ROOT, matvec, macVectors } from './npu-fixtures.mjs';

const { CTRL, STATUS, WEIGHT, ACT, RESULT } = NPU_REG;

/**
 * A host that drives the device as the processor models do: one bus transaction per cycle; in cycle t the device
 * is told the time (tick t), a load reads at t, a store arrives stamped t + 1. `order` changes when the store is
 * delivered: 'tick-first' (as the models), 'write-first' (before the tick of its cycle), 'late' (after the tick
 * of the next cycle).
 */
function host(npu, order = 'tick-first') {
  let t = 0;
  let late = null;
  const h = {
    get t() { return t; },
    cycle(op = null) {
      if (order === 'write-first' && op?.w !== undefined) npu.write(op.w, 4, op.v, { cycle: t + 1 });
      const sampled = op?.r !== undefined ? npu.peek(op.r) : null; // the single-cycle host samples before the tick
      npu.tick(t);
      if (late) { npu.write(late.w, 4, late.v, { cycle: t }); late = null; }
      let v = null;
      if (op?.r !== undefined) {
        v = npu.read(op.r, 4, { cycle: t });
        if (order !== 'late' && t > 0) assert.equal(sampled, v, `cycle ${t}: the value sampled before the tick equals the read`);
      }
      if (op?.w !== undefined && order === 'tick-first') npu.write(op.w, 4, op.v, { cycle: t + 1 });
      if (op?.w !== undefined && order === 'late') late = op;
      t += 1;
      return v;
    },
    write(off, v) { return h.cycle({ w: off, v }); },
    read(off) { return h.cycle({ r: off }); },
    idle(k) { for (let i = 0; i < k; i++) h.cycle(); },
    flush() { h.cycle(); }, // delivers a late store
  };
  return h;
}

const pack = (b) => b.reduce((w, v, j) => (w | ((v & 0xff) << (8 * j))) >>> 0, 0);
// the matrices and vectors of tb_npu
const W1 = [[-128, 127, 3, -4], [5, -6, 7, -8], [9, 10, -11, 12], [-13, 14, 15, 127]];
const X1 = [-128, 127, -1, 2];
const W2 = [[1, 2, 3, 4], [-1, -2, -3, -4], [127, 127, 127, 127], [-128, -128, -128, -128]];
const X2 = [-128, -128, -128, -128];
const u32 = (a) => a.map((v) => v >>> 0);

function loadW(h, W) { W.forEach((row, i) => h.write(WEIGHT + 4 * i, pack(row))); }

test('N8 reset values: STATUS 0, RESULT 0, CTRL reads 0, an unused offset reads 0', () => {
  const h = host(new Npu());
  h.idle(2);
  assert.equal(h.read(STATUS), 0);
  for (let i = 0; i < 4; i++) assert.equal(h.read(RESULT + 4 * i), 0);
  assert.equal(h.read(CTRL), 0);
  assert.equal(h.read(0x40), 0);
  assert.equal(h.read(0xffc), 0);
});

test('N9 read-back: WEIGHT returns the word written; ACT keeps bits 7..0 and reads them sign-extended', () => {
  const h = host(new Npu());
  loadW(h, W1);
  for (let i = 0; i < 4; i++) assert.equal(h.read(WEIGHT + 4 * i), pack(W1[i]));
  [0xabcdef80, 0x7f, 0x123456ff, 2].forEach((v, j) => h.write(ACT + 4 * j, v));
  assert.deepEqual([0, 1, 2, 3].map((j) => h.read(ACT + 4 * j)), [0xffffff80, 0x7f, 0xffffffff, 2]);
});

test('N10 busy interval: after CTRL = 3, STATUS reads 0x1 for 1..9 cycles, 0x2 at 10; RESULT = W x', () => {
  const h = host(new Npu());
  loadW(h, W1);
  X1.forEach((x, j) => h.write(ACT + 4 * j, x >>> 0));
  h.write(CTRL, 3);
  const st = Array.from({ length: 10 }, () => h.read(STATUS));
  assert.deepEqual(st, [1, 1, 1, 1, 1, 1, 1, 1, 1, 2]);
  assert.deepEqual([0, 1, 2, 3].map((i) => h.read(RESULT + 4 * i)), u32(matvec(W1, X1)));
});

test('N11 + N12: a second start without clear accumulates (2y); WEIGHT, ACT and CTRL writes while busy are ignored', () => {
  const npu = new Npu();
  const h = host(npu);
  loadW(h, W1);
  X1.forEach((x, j) => h.write(ACT + 4 * j, x >>> 0));
  h.write(CTRL, 3);
  h.idle(10);
  h.write(CTRL, 1);
  h.write(WEIGHT, 0x01010101);
  h.write(ACT, 1);
  h.write(CTRL, 2); // a clear while busy: ignored too
  h.idle(8);
  assert.equal(h.read(STATUS), 2);
  assert.deepEqual([0, 1, 2, 3].map((i) => h.read(RESULT + 4 * i)), u32(matvec(W1, X1).map((y) => 2 * y)));
  assert.equal(h.read(WEIGHT), pack(W1[0]), 'WEIGHT[0] unchanged');
  assert.equal(h.read(ACT), 0xffffff80, 'ACT[0] unchanged');
  assert.equal(npu.counters.ignoredWrites, 3);
  assert.equal(npu.counters.runs, 2);
});

test('N13 + N14: CTRL = 2 alone clears RESULT and done; RESULT is read-only; the second tb_npu case polled', () => {
  const npu = new Npu();
  const h = host(npu);
  loadW(h, W1);
  X1.forEach((x, j) => h.write(ACT + 4 * j, x >>> 0));
  h.write(CTRL, 3);
  h.idle(10);
  assert.equal(h.read(STATUS), 2);
  h.write(CTRL, 2);
  assert.equal(h.read(STATUS), 0);
  for (let i = 0; i < 4; i++) assert.equal(h.read(RESULT + 4 * i), 0);
  loadW(h, W2);
  X2.forEach((x, j) => h.write(ACT + 4 * j, x >>> 0));
  h.write(CTRL, 3);
  let polls = 0;
  const before = npu.counters.statusReads;
  let v;
  do { v = h.read(STATUS); polls++; } while (v !== 2 && polls < 50);
  assert.equal(v, 2);
  assert.equal(polls, 10, 'the tenth poll sees done');
  assert.equal(npu.counters.statusReads - before, 10);
  const y = u32(matvec(W2, X2));
  assert.deepEqual([0, 1, 2, 3].map((i) => h.read(RESULT + 4 * i)), y);
  h.write(RESULT, 0x7b);
  assert.equal(h.read(RESULT), y[0], 'RESULT[0] is read-only');
});

test('the device against mac_vectors.hex: clear and start for every case gives RESULT = y', () => {
  const h = host(new Npu());
  for (const [k, c] of macVectors().entries()) {
    c.weight.forEach((w, i) => h.write(WEIGHT + 4 * i, w));
    c.x.forEach((x, j) => h.write(ACT + 4 * j, x >>> 0));
    h.write(CTRL, 3);
    h.idle(9);
    assert.equal(h.read(STATUS), 2, `case ${k}`);
    assert.deepEqual([0, 1, 2, 3].map((i) => h.read(RESULT + 4 * i)), u32(c.y), `case ${k}`);
  }
});

test('timeline of one run (NPU_ARCHITECTURE §4): LOADW, RUN steps 0..7, RESULT[c] added at the end of step 4 + c', () => {
  const npu = new Npu();
  const h = host(npu);
  loadW(h, W1);
  X1.forEach((x, j) => h.write(ACT + 4 * j, x >>> 0));
  h.write(CTRL, 3);
  const y = matvec(W1, X1);
  const seen = [];
  for (let k = 1; k <= 10; k++) {
    const { ctrl, regs, cycle } = npu.view(); // between steps: the state of cycle t + k
    assert.equal(cycle, h.t);
    seen.push([ctrl.state, ctrl.step, ctrl.w_load, ctrl.run, regs.result.filter((v, c) => v === y[c] && v !== 0).length]);
    h.idle(1);
  }
  assert.deepEqual(seen.map((s) => s[0]), ['LOADW', 'RUN', 'RUN', 'RUN', 'RUN', 'RUN', 'RUN', 'RUN', 'RUN', 'IDLE']);
  assert.deepEqual(seen.slice(1, 9).map((s) => s[1]), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(seen.map((s) => s[2]), [true, false, false, false, false, false, false, false, false, false]);
  assert.deepEqual(seen.map((s) => s[4]), [0, 0, 0, 0, 0, 0, 1, 2, 3, 4], 'columns complete at t+7 .. t+10 (end of steps 4..7)');
  assert.deepEqual(ctrlStep({ state: 'IDLE', step: 0, done: true }, { clear: true }), { state: 'IDLE', step: 0, done: false });
});

/** A program of bus operations that touches every rule: loads, a run, writes and a clear while busy, polls. */
function script() {
  const ops = [];
  W1.forEach((row, i) => ops.push({ w: WEIGHT + 4 * i, v: pack(row) }));
  X1.forEach((x, j) => ops.push({ w: ACT + 4 * j, v: x >>> 0 }));
  ops.push({ w: CTRL, v: 3 }, { r: STATUS }, { w: WEIGHT, v: 0x01010101 }, { r: RESULT }, null, { w: CTRL, v: 2 });
  for (let k = 0; k < 6; k++) ops.push({ r: STATUS });
  ops.push({ r: RESULT + 4 }, { w: CTRL, v: 1 }, null, null, { w: ACT, v: 9 }, null, null, null, null, null, null, { r: RESULT + 12 });
  ops.push({ w: CTRL, v: 2 }, { r: STATUS }, { w: CTRL, v: 3 }, null, null, null, null, null, null, null, null, null, null, { r: RESULT });
  return ops;
}

function trace(order) {
  const npu = new Npu();
  const h = host(npu, order);
  const out = [];
  for (const op of script()) {
    const v = h.cycle(op);
    out.push({ v, s: JSON.stringify(npu.visible) }); // the state of the next cycle, as the bus sees it between steps
  }
  h.flush();
  out.push({ counters: JSON.stringify(npu.counters), result: [0, 1, 2, 3].map((i) => npu.peek(RESULT + 4 * i)) });
  return out;
}

test('N15 call-order independence: a store delivered before the tick, after it, or after the next tick gives identical traces', () => {
  const a = trace('tick-first');
  assert.deepEqual(trace('write-first'), a);
  // 'late': the state after cycle t is the same once the store is delivered, so compare from one cycle later
  const npu = new Npu();
  const h = host(npu, 'late');
  const late = [];
  for (const op of script()) {
    const v = h.cycle(op);
    late.push(v);
  }
  h.flush();
  assert.deepEqual(late, a.slice(0, -1).map((e) => e.v), 'every load returns the same value');
  assert.deepEqual([0, 1, 2, 3].map((i) => npu.peek(RESULT + 4 * i)), a.at(-1).result);
  assert.equal(JSON.stringify(npu.counters), a.at(-1).counters);
});

test('N15 out-of-order deliveries the device refuses: an old stamp, two writes in one cycle (also when one comes late)', () => {
  // two writes in one cycle
  let npu = new Npu();
  npu.tick(100);
  npu.write(WEIGHT, 4, 1, { cycle: 101 });
  assert.throws(() => npu.write(ACT, 4, 1, { cycle: 101 }), /two bus writes in cycle 100/);
  // the second write of a cycle delivered after the next tick: neither replayed nor taken at an earlier time
  npu = new Npu();
  npu.tick(100);
  npu.write(WEIGHT, 4, 1, { cycle: 101 });
  npu.tick(101);
  assert.throws(() => npu.write(ACT, 4, 1, { cycle: 101 }), /a write of cycle 100 reached the device at cycle 101/);
  // a stamp from before a run, after the run: refused (the idle state is not that of the earlier time)
  npu = new Npu();
  npu.tick(0);
  npu.write(CTRL, 4, 1, { cycle: 1 });
  npu.tick(20);
  assert.equal(npu.peek(STATUS), 2);
  assert.throws(() => npu.write(WEIGHT, 4, 5, { cycle: 6 }), /a write of cycle 5 reached the device at cycle 20/);
  assert.throws(() => npu.read(STATUS, 4, { cycle: 6 }), /a read of cycle 6 reached the device at cycle 20/);
  assert.equal(npu.counters.ignoredWrites, 0, 'nothing was counted');
  // back over idle time in which nothing changed: accepted (a step back over steps that did not touch the device)
  npu.write(WEIGHT, 4, 5, { cycle: 15 });
  npu.tick(15);
  assert.equal(npu.peek(WEIGHT), 5);
  // busy: an older read or write is refused
  npu = new Npu();
  npu.write(CTRL, 4, 1, { cycle: 1 });
  npu.tick(5);
  assert.throws(() => npu.read(STATUS, 4, { cycle: 3 }), /a read of cycle 3/);
  assert.throws(() => npu.write(ACT, 4, 1, { cycle: 3 }), /a write of cycle 2/);
});

test('N12 a start while busy is ignored: the run ends at its own time, no second run is counted', () => {
  const npu = new Npu();
  const h = host(npu);
  h.write(CTRL, 1); // cycle 0
  h.write(CTRL, 1); // cycle 1: busy (LOADW)
  h.idle(3);
  h.write(CTRL, 3); // cycle 5: busy (RUN), the clear is ignored too
  const st = [];
  while (h.t <= 11) st.push(h.read(STATUS));
  assert.deepEqual(st, [1, 1, 1, 1, 2, 2], 'cycles 6..11: done from cycle 10, 10 cycles after the first start');
  assert.equal(npu.counters.runs, 1);
  assert.equal(npu.counters.ignoredWrites, 2);
});

test('N15 the edge is a function of the state before it and the request: no call-order state hidden in the device', () => {
  const s0 = npuReset();
  const s1 = npuEdge(s0, { offset: WEIGHT, value: 0x01020304 });
  assert.equal(s0.weight[0], 0, 'the state before the edge is not changed');
  assert.equal(s1.weight[0], 0x01020304);
  assert.deepEqual(npuEdge(s0, null), s0);
  // the edge itself filters a write while busy (wr = sel & we & !busy), for every user of npuEdge
  let s = npuEdge(s0, { offset: CTRL, value: 1 });
  for (let k = 0; k < 6; k++) s = npuEdge(s, null); // into RUN
  const t = npuEdge(s, { offset: CTRL, value: 2 });
  assert.deepEqual(npuEdge(s, { offset: WEIGHT, value: 7 }).weight, s.weight);
  assert.deepEqual(t.result, npuEdge(s, null).result, 'a clear in RUN changes nothing');
  assert.equal(t.ctrl.state, 'RUN');
});

test('N16 back-step: run 20 cycles across a start, step back to before the start, the state is identical; the rerun too', () => {
  const npu = new Npu();
  const j = new Journal(() => npu.snapshot());
  npu.journal = j;
  const h = host(npu);
  const prog = [...script().slice(0, 8), null, null]; // weights and activations, two idle cycles
  const rest = script().slice(8, 28); // the start and 19 more cycles
  for (const op of prog) h.cycle(op);
  npu.tick(h.t);
  const mark = { t: h.t, s: JSON.stringify(npu.s), counters: JSON.stringify(npu.counters), regs: Array.from({ length: 16 }, (_, k) => npu.peek(4 * k)) };
  const saves = [];
  const vals = [];
  for (const op of rest) {
    j.reset();
    vals.push(h.cycle(op));
    saves.push(j.saved);
  }
  assert.ok(saves.some((s) => s !== null));
  for (const s of saves.reverse()) if (s) npu.restore(s);
  assert.equal(JSON.stringify(npu.s), mark.s);
  assert.equal(JSON.stringify(npu.counters), mark.counters);
  assert.deepEqual(Array.from({ length: 16 }, (_, k) => npu.peek(4 * k)), mark.regs);
  // run again from the same cycle: the same values
  const h2 = host(npu);
  for (let k = 0; k < mark.t; k++) h2.cycle(); // h2 only counts up; the device is quiescent, so time may restart
  const again = rest.map((op) => h2.cycle(op));
  assert.deepEqual(again, vals);
});

test('G5: a RESULT read while busy returns the partial value with a non-fatal diagnostic; the optional stop is a flag', () => {
  for (const stop of [false, true]) {
    const npu = new Npu({ stopOnBusyResult: stop });
    const h = host(npu);
    loadW(h, W1);
    X1.forEach((x, j) => h.write(ACT + 4 * j, x >>> 0));
    h.write(CTRL, 3);
    h.idle(6);
    const y = matvec(W1, X1);
    assert.equal(h.read(RESULT) | 0, y[0], 'RESULT[0] is complete after the end of step 4 (7 cycles after the start)');
    assert.equal(h.read(RESULT + 12), 0, 'RESULT[3] still partial (0)');
    assert.equal(npu.diagnostics.length, 2);
    assert.equal(npu.diagnostics[1].code, 'result-busy');
    assert.equal(npu.stopRequested, stop);
    assert.equal(npu.last.diagnostic, npu.diagnostics[1]);
  }
});

const ramStore = () => ({ words: new Uint32Array(64), read: () => 0, write: () => 0, copyPages() {} });

test('G5 on the bus: the NPU at 0x5000_0000 takes whole words; a byte or half-word access is a bus fault; no fetch', () => {
  const ms = new MemorySystem();
  const npu = new Npu();
  ms.addDevice(NPU_BASE, npu);
  const { I, D } = ms.attach(ramStore(), ramStore(), { caches: false });
  assert.equal(D.map.resolve(NPU_BASE + 0x10).region.name, 'NPU');
  assert.equal(D.map.resolve(NPU_BASE + 0xfff).region.name, 'NPU');
  assert.notEqual(D.map.resolve(NPU_BASE + 0x1000).region?.name, 'NPU');
  assert.throws(() => D.write(NPU_BASE + 0x10, 1, 5), /the NPU takes whole words/);
  assert.throws(() => D.sample(NPU_BASE + 0x10, 2), /the NPU takes whole words/);
  assert.throws(() => I.sample(NPU_BASE, 4), /instruction fetch from the device NPU/);
  assert.equal(D.sample(NPU_BASE + STATUS, 4), 0);
});

const PROGRAM = [
    '        lui  s1, 0x50000',
    '        li   t0, 1',          // identity W: WEIGHT[i] = 1 << 8i
    '        sw   t0, 16(s1)',
    '        slli t0, t0, 8',
    '        sw   t0, 20(s1)',
    '        slli t0, t0, 8',
    '        sw   t0, 24(s1)',
    '        slli t0, t0, 8',
    '        sw   t0, 28(s1)',
    '        li   t0, 5',
    '        sw   t0, 32(s1)',
    '        li   t0, -6',
    '        sw   t0, 36(s1)',
    '        li   t0, 7',
    '        sw   t0, 40(s1)',
    '        li   t0, -8',
    '        sw   t0, 44(s1)',
    '        li   t0, 3',
    '        sw   t0, 0(s1)',      // start, cycle t
    ...['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3'].map((r) => `        lw   ${r}, 4(s1)`), // t+1 .. t+10
    '        lw   t3, 48(s1)',
    '        lw   t4, 52(s1)',
    '        lw   t5, 56(s1)',
    '        lw   t6, 60(s1)',
    '        halt',
].join('\n') + '\n';

/** The registers the program reads: ten STATUS values and four results. */
const PROGRAM_EXPECT = { status: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2], result: [5, -6, 7, -8] };

test('on the single-cycle host: a program writes the buffers, starts, reads STATUS ten times and the results', () => {
  const T6 = JSON.parse(readFileSync(join(ROOT, 'content/data/ch06-tables.json'), 'utf8'));
  const src = PROGRAM;
  const ms = new MemorySystem();
  const npu = new Npu();
  ms.addDevice(NPU_BASE, npu);
  const m = new SingleCycle(T6, { memsys: ms });
  const p = assemble([{ name: 'npu.s', text: src }], { profile: 'ch06' });
  assert.ok(p.ok, p.errors.map((e) => e.message).join());
  m.load(p);
  let r;
  do r = m.step(); while (r === 'step' && m.cycle < 1000);
  assert.equal(r, 'halt');
  const reg = (n) => m.x[n] | 0;
  assert.deepEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(reg), PROGRAM_EXPECT.status, 'busy 9 cycles, then done');
  assert.deepEqual([28, 29, 30, 31].map(reg), PROGRAM_EXPECT.result, 'y = x for the identity');
  assert.equal(npu.counters.statusReads, 10);
  assert.equal(npu.counters.accesses, 9 + 10 + 4);
});

test('on the ISS (iss-priv, platform with the NPU): the same values as the single-cycle host; step back over every step', () => {
  assert.ok(new Platform().npu, 'the NPU joins the platform devices (decision G1, NPU-2)');
  assert.equal(new Platform({ npu: false }).npu, null);
  const s = new Session();
  s.profile = 'iss-priv';
  s.files = [{ name: 'npu.s', text: PROGRAM }];
  s.platformConfig = { stimulus: [], rx: [], mtimeDiv: 1, uart: true, txCycles: 4, npu: true };
  s.assemble();
  assert.ok(s.program.ok, s.program.errors.map((e) => e.message).join());
  const npu = s.hart.platform.npu;
  assert.ok(npu instanceof Npu);
  const print = () => JSON.stringify({ x: Array.from(s.hart.x), pc: s.hart.pc, npu: { ...npu.snapshot(), prev: null, now: null }, regs: Array.from({ length: 16 }, (_, k) => npu.peek(4 * k)) });
  const prints = [print()];
  let n = 0;
  while (s.step() === STOP.NONE && n < 1000) { prints.push(print()); n++; }
  assert.equal(s.hart.halted, true, s.error);
  const reg = (k) => s.hart.x[k] | 0;
  assert.deepEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(reg), PROGRAM_EXPECT.status);
  assert.deepEqual([28, 29, 30, 31].map(reg), PROGRAM_EXPECT.result);
  for (let i = prints.length - 1; i >= 0; i--) {
    assert.equal(print(), prints[i], `at step ${i}`);
    if (i > 0) assert.ok(s.back(), `back from ${i}`);
  }
  for (let i = 0; i < n; i++) s.step();
  assert.deepEqual([28, 29, 30, 31].map(reg), PROGRAM_EXPECT.result, 'forward again');
});

test('multicycle and pipelined hosts, ideal and timed memory: y = W x, STATUS busy then done, step back over every edge (Ext: no book cycle counts)', () => {
  const T6 = JSON.parse(readFileSync(join(ROOT, 'content/data/ch06-tables.json'), 'utf8'));
  const t7 = ch07({ jalr: false }).t7;
  const timed = { mode: 'main', main: { preset: 'custom', overhead: 0, readLatency: 2, writeLatency: 2, busWidth: 4 }, ports: 1 };
  for (const kind of ['multi', 'pipe']) {
    for (const mem of [{ mode: 'ideal' }, timed]) {
      const platform = new Platform({ uart: false, npu: true });
      const { memsys } = buildMemsys({ ...defaultConfig(), ...mem, devices: true }, { platform });
      const m = kind === 'multi' ? new Multicycle(T6, t7, { memsys }) : new Pipeline(T6, { memsys });
      const p = assemble([{ name: 'npu.s', text: PROGRAM }], { profile: kind === 'multi' ? 'ch07' : 'ch08' });
      assert.ok(p.ok, p.errors.map((e) => e.message).join());
      m.load(p);
      const npu = platform.npu;
      const snap = () => JSON.stringify({ x: Array.from(m.x), c: m.cycle, s: npu.visible, k: npu.counters });
      const states = [];
      let r;
      do { states.push(snap()); r = m.step(); } while (r === 'step' && m.cycle < 5000);
      const what = `${kind}, ${mem.mode}`;
      assert.equal(r, 'halt', what);
      const reg = (k) => m.x[k] | 0;
      assert.deepEqual([28, 29, 30, 31].map(reg), PROGRAM_EXPECT.result, what);
      const st = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(reg);
      assert.ok(st.every((v, i) => v === 1 || v === 2) && st.at(-1) === 2 && st.indexOf(2) === st.lastIndexOf(1) + 1, `${what}: ${st}`);
      assert.equal(npu.counters.statusReads, 10, what);
      assert.ok(m.back(), what);
      for (let i = states.length - 1; i >= 0; i--) {
        assert.equal(snap(), states[i], `${what}: at edge ${i}`);
        if (i > 0) assert.ok(m.back(), `${what}: back from ${i}`);
      }
    }
  }
});