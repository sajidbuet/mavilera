// The 8086's calibrated clock timing (src/arch/i8086/timing.js; milestone 8086-B7, L3; design
// docs/architecture/i8086-timing.md): CalibratedCore against the per-clock records of SingleStepTests/8086 v1 ([TEST];
// MIT; a CMOS P80C86A-2, not an NMOS 8086; skipped with a message when the suite is absent; the full run is `node
// tools/i8086/timing-check.mjs --model l3`), the forms calibrated so far exact clock by clock; Table 2-20 as entered;
// the teaching model (L2) still differs (the checker is not trivially satisfied). Work in progress: no claim follows
// until the verification record exists (CLAUDE.md rule 7).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eaClocks, timingOf, CalibratedCore, CalibratedClockModel, EU_TIMING } from '../src/arch/i8086/timing.js';
import { descriptor } from '../src/arch/i8086/index.js';
import { ClockModel } from '../src/arch/i8086/biu-model.js';
import { timingFile, MODELS } from '../tools/i8086/timing-check.mjs';
import { available, files, load, SST_DIR } from '../tools/i8086/sst.mjs';

const skip = available() ? false : `SingleStepTests/8086 not found at ${SST_DIR}`;
const file = (name) => files().find((f) => f.name === name);

test('i8086 B7: Table 2-20 effective-address clocks as entered (IFUM p. 2-51, PDF 74)', () => {
  // mod 0: BX+SI 7, BX+DI 8, BP+SI 8, BP+DI 7, SI 5, DI 5, displacement only 6, BX 5
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((rm) => eaClocks(0, rm)), [7, 8, 8, 7, 5, 5, 6, 5]);
  // with a displacement: base + index 11 or 12; base or index 9
  for (const mod of [1, 2]) assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((rm) => eaClocks(mod, rm)), [11, 12, 12, 11, 9, 9, 9, 9]);
});

test('i8086 B7: calibrated rows only for the forms fitted so far; wait states refused', () => {
  const d = (bytes, prefixes = []) => ({ bytes, prefixes });
  assert.ok(timingOf(d([0x90])));
  assert.ok(timingOf(d([0x2e, 0x05, 1, 2], [0x2e])));
  assert.equal(timingOf(d([0xf3, 0x90], [0xf3])), null, 'REP: not calibrated');
  assert.ok(timingOf(d([0xeb, 0x00])), 'JMP short');
  assert.equal(timingOf(d([0x75, 0x00])), null, 'JNZ: only JZ is calibrated');
  assert.equal(timingOf(d([0xe9, 0, 0])), null, 'JMP near: not yet');
  assert.throws(() => new CalibratedCore({ read: () => 0, ip: 0, waitStates: 1 }));
});

for (const [name, n] of [['90', 300], ['05', 300], ['50', 300], ['EB', 300], ['74', 300], ['E8', 300], ['D3.4', 300], ['B8', 300],
  ['03', 300], ['81.0', 300]]) {
  test(`i8086 B7: [TEST] ${name}, first ${n} cases exact clock by clock (bus, queue status, length); L2 not`, { skip }, () => {
    const tests = load(name).slice(0, n);
    const l3 = timingFile(file(name), { tests, makeCore: MODELS.l3, calibratedOnly: true });
    assert.equal(l3.exact, n, JSON.stringify(l3.failures));
    const l2 = timingFile(file(name), { tests, makeCore: MODELS.l2 });
    assert.equal(l2.exact, 0, 'the teaching model makes no clock claim and should not match');
  });
}

test('i8086 B7: [TEST] 8B, register and memory forms, first 600 cases exact clock by clock', { skip }, () => {
  const tests = load('8B').slice(0, 600);
  const r = timingFile(file('8B'), { tests, makeCore: MODELS.l3, calibratedOnly: true });
  assert.equal(r.exact, tests.length, JSON.stringify(r.failures));
});

test('i8086 B7: planted faults, R3 (hold) and R4 (pre-emption at T0) each needed for 8B (design §6 item 4)', { skip }, () => {
  const tests = load('8B').slice(0, 600);
  const exact = (rules) => timingFile(file('8B'), { tests, makeCore: (o) => new CalibratedCore({ ...o, rules }), calibratedOnly: true }).exact;
  for (const rules of [{ hold: false }, { preempt: false }, { preempt: 'late' }]) {
    assert.ok(exact(rules) < tests.length, `switching ${JSON.stringify(rules)} should lower the match`);
  }
});

test('i8086 B7: planted faults in the transfer rows (the IP correction one clock early or late, the flush, the push request)', { skip }, () => {
  const check = (key, name, ops) => {
    const tests = load(name).slice(0, 300);
    const row = EU_TIMING[key].ops;
    const old = row.slice();
    row.splice(0, Infinity, ...ops); // the rows are frozen objects with mutable lists: restored below
    try {
      const r = timingFile(file(name), { tests, makeCore: MODELS.l3, calibratedOnly: true });
      assert.ok(r.exact < tests.length, `${key} ${ops.join('')} should lower the match`);
    } finally { row.splice(0, Infinity, ...old); }
  };
  check('jmpShort', 'EB', ['q', 'c', 'q', 'K', 'c', 'c', 'c', 'E']);
  check('jmpShort', 'EB', ['q', 'c', 'q', 'c', 'c', 'K', 'c', 'c', 'c', 'E']);
  check('jmpShort', 'EB', ['q', 'c', 'q', 'c', 'K', 'c', 'c', 'E']);
  check('jccShort', '74', ['q', 'c', 'q', 'x', 'K', 'c', 'c', 'c', 'E']);
  check('callNear', 'E8', ['q', 'c', 'q', 'q', 'K', 'c', 'c', 'c', 'E', 'c', 'r', 'w']);
  check('callNear', 'E8', ['q', 'c', 'q', 'q', 'c', 'K', 'c', 'c', 'c', 'E', 'c', 'c', 'r', 'w']);
});

// IFUM 9800722-03 Fig 4-21 (p. 4-37, PDF 276): Intel's machine code, at an even address (cited; used here only)
const FIG_4_21 = 'top: DB 0B8H,02H,0F8H,50H,8BH,0CBH,8BH,0D1H,03H,04H,81H,0C6H,86H,80H,0EBH,0F0H\n';
const fig421 = () => {
  const p = descriptor.language.assemble([{ name: 'p.asm', text: FIG_4_21 }], { profile: 'flat' });
  assert.ok(p.ok);
  return p;
};
/** The flush clocks of a run of the Fig 4-21 loop and its records. */
function loopRun(opts, clocks = 400) {
  const m = new CalibratedClockModel(fig421(), opts);
  const recs = [];
  for (let i = 0; i < clocks; i++) { assert.equal(m.clock(), 'step'); recs.push(m.last); }
  return { recs, flushes: recs.map((r, i) => (r.qs === 'E' ? i : -1)).filter((i) => i >= 0) };
}

test('i8086 B7: IFUM Fig 4-22 (NMOS 8086) clock by clock: bus and queue-status lanes, 55-clock loop (clocks 27-29 inferred, not compared)', () => {
  // the reconstruction of research notes §9A Q4 from the page images (PDF 277-278): T1 clocks of the bus cycles and
  // the queue-status reports (QS at clock c reports the queue operation of clock c-1, Table 4-4, PDF 253)
  const bus = {};
  for (let c = 1; c <= 55; c++) bus[c] = 'Ti';
  const cyc = (t1, kind) => { for (let i = 0; i < 4; i++) bus[t1 + i] = `T${i + 1}:${kind}`; };
  for (const t1 of [3, 7, 11, 15, 25, 29, 33, 41, 48]) cyc(t1, 'code');
  cyc(21, 'write');
  cyc(37, 'read');
  const qs = { 1: 'E', 8: 'F', 10: 'S', 12: 'S', 13: 'F', 24: 'F', 25: 'S', 26: 'F', 27: 'S', 30: 'F', 31: 'S', 44: 'F', 45: 'S', 46: 'S', 47: 'S', 48: 'F', 50: 'S' };
  const { recs, flushes } = loopRun();
  assert.ok(flushes.length >= 4);
  for (let i = 1; i < flushes.length; i++) assert.equal(flushes[i] - flushes[i - 1], 55, 'the loop takes 55 clocks');
  for (const e of flushes.slice(1, 3)) {
    // the flush at model clock e is Fig 4-22's QS report at clock 1; the bus of fig clock c is the model's clock c+e
    for (let c = 1; c <= 55; c++) {
      if (c >= 27 && c <= 29) continue;
      const r = recs[c + e];
      assert.equal(r.t === 'Ti' ? 'Ti' : `${r.t}:${r.cycle.kind}`, bus[c], `bus at clock ${c}`);
      assert.equal(recs[c + e - 1].qs ?? null, qs[c] ?? null, `queue status at clock ${c}`);
    }
  }
});

test('i8086 B7: IFUM Fig 4-22 total with one wait state, 64 clocks (PDF 277, a total only; Tw not calibrated)', () => {
  const { flushes } = loopRun({ testWaitStates: 1 });
  for (let i = 1; i < flushes.length; i++) assert.equal(flushes[i] - flushes[i - 1], 64);
  assert.throws(() => new CalibratedCore({ read: () => 0, ip: 0, waitStates: 1 }), /B7-Q7/);
});

test('i8086 B7: calibrated program model, step back restores every clock (several steps in one clock)', () => {
  const m = new CalibratedClockModel(fig421());
  const seen = [];
  for (let i = 0; i < 130; i++) { seen.push(JSON.stringify([m.mm.registers(), m.mm.k, m.core.s.q, m.core.s.clock])); m.clock(); }
  assert.ok(m.journal.some((j) => (j.rec.steps ?? 0) > 1), 'a clock with more than one teaching step');
  const peeked = m.peek();
  assert.equal(JSON.stringify([m.mm.registers(), m.mm.k, m.core.s.q, m.core.s.clock]), JSON.stringify([m.mm.registers(), m.mm.k, m.core.s.q, 130]));
  assert.equal(peeked.n, 130);
  for (let i = 129; i >= 0; i--) {
    assert.ok(m.back());
    assert.equal(JSON.stringify([m.mm.registers(), m.mm.k, m.core.s.q, m.core.s.clock]), seen[i], `clock ${i}`);
  }
  assert.equal(m.back(), false);
});
test('i8086 B7: every template runs to its end in calibrated mode; uncalibrated instructions marked; the waveform track', async () => {
  const { readFileSync } = await import('node:fs');
  const { clockExportModel } = await import('../src/arch/i8086/waveform.js');
  const dir = new URL('../content/i8086/templates/', import.meta.url);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  const sources = [...index.templates.map((t) => [t.id, readFileSync(new URL(t.file, dir), 'utf8')]), ['default', descriptor.language.defaultSource]];
  let marked = 0; let calibrated = 0;
  for (const [id, text] of sources) {
    const p = descriptor.language.assemble([{ name: 'p.asm', text }], { profile: 'flat' });
    assert.ok(p.ok, id);
    const m = new CalibratedClockModel(p);
    let r = 'step';
    for (let i = 0; i < 200_000 && r === 'step'; i++) r = m.clock();
    assert.notEqual(r, 'step', `${id} ends`);
    assert.equal(m.error, null, `${id}: ${m.error}`);
    for (const j of m.journal) if (j.rec.calibrated) calibrated += 1; else marked += 1;
    // the same registers at the end as the teaching model (L2 clock mode)
    const l2 = new ClockModel(p);
    let r2 = 'step';
    for (let i = 0; i < 200_000 && r2 === 'step'; i++) r2 = l2.clock();
    assert.deepEqual(m.mm.registers(), l2.mm.registers(), `${id}: final registers`);
  }
  assert.ok(marked > 0 && calibrated > 0, 'the templates mix calibrated and uncalibrated instructions');
  const x = clockExportModel(fig421(), { calibrated: true });
  const seen = new Set();
  for (let i = 0; i < 60; i++) { seen.add(x.evaluate().signals.calibrated); x.step(); }
  assert.deepEqual([...seen], [1], 'the Fig 4-21 loop is calibrated throughout');
});