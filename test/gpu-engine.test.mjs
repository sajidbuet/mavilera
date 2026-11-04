// GPU module, the SIMT core engine (GPU-1; tests G1 to G3 and G5 to G8 of docs/research/gpu-npu/verification/
// GOLDEN_TESTS.md): the laboratory's three test programs through the core's ports as tb_simt_core drives them and
// through the contract engine; initial registers; the two-deep mask stack and its errors (decision G7); a cycle with no
// lane active; the PC wrap and the busy refusals; 16-bit counters; step back, the history ring and the snapshot.
// A per-lane reference interpreter written here (booleans and lists, not the engine's bit masks) is compared with the
// engine on random programs: a check of the engine against a second reading of the specification, not against the
// book's model (G10, a fuzz against the instructor model simt_run, is not run: instructor material stays out).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, loadImage, encode, OPS } from '../src/arch/gpu/language.js';
import { create, SimtCore, laneId, initialState } from '../src/arch/gpu/engine.js';
import { STOP } from '../src/arch/contract.js';
import { simtTests } from './gpu-fixtures.mjs';

const asm = (text, profile) => {
  const p = assemble([{ name: 't.simt', text }], { profile });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};
const runToEnd = (e) => { let s; do s = e.run({ chunk: 1_000_000 }); while (s === STOP.CHUNK); return s; };
const dout = (r, lanes = 4) => Array.from({ length: lanes }, (_, l) => r[laneId(l, 2)] | 0);

test('G1-G3: simt_tests.hex through the core\'s ports, driven as tb_simt_core drives it', () => {
  const core = new SimtCore({ lanes: 4 });
  for (const [k, t] of simtTests().entries()) {
    for (let a = 0; a < 16; a++) assert.equal(core.pmWrite(a, t.program[a]), null);
    core.setDin(t.din);
    assert.equal(core.start(), null);
    let waited = 0;
    while (!core.done && waited < 200) { core.clock(); waited += 1; }
    assert.equal(core.done, true, `test ${k}: done`);
    assert.equal(core.busy, false);
    assert.deepEqual(core.dout, t.dout, `test ${k}: dout`);
    assert.equal(core.cycles, t.cycles, `test ${k}: cycles`);
    assert.equal(core.idleSlots, t.idle, `test ${k}: idle lane-slots`);
    assert.equal(core.activeMask, 0xf, `test ${k}: final mask`);
    assert.equal(waited, t.cycles, 'one instruction per clock');
  }
});

test('G1-G3: the same programs on the contract engine (image loaded, inputs given), with the specification\'s values', () => {
  const want = [[[5, 3, 0, 7], 7, 4], [[110, 11, 22, 23], 12, 9], [[2, -3, 8, -5], 3, 0]];
  for (const [k, t] of simtTests().entries()) {
    const p = { ...loadImage(t.program.map((w) => w.toString(16)).join('\n'), 'hex', 'p.hex'), din: t.din };
    const e = create(p);
    assert.equal(runToEnd(e), STOP.HALT);
    const s = e.state();
    assert.deepEqual([dout(s.registers), s.registers.cycles, s.registers.idle_slots], want[k], `test ${k}`);
    assert.deepEqual([s.registers.active_mask, s.registers.busy, s.registers.done, s.registers.depth], [0xf, 0, 1, 0]);
    assert.equal(s.retired, t.cycles);
    assert.match(s.output, new RegExp(`dout \\(r2 of each lane\\) = ${want[k][0].join(', ')}`));
  }
});

test('G5: at start r0 = lane index, r1 = din, r2 = r3 = 0; mask and stack all ones; busy', () => {
  for (const [profile, lanes] of [['simt4', 4], ['simt8', 8]]) {
    const r = create(asm('.din -1, 7, 0x80000000\nHALT', profile)).state().registers;
    for (let l = 0; l < 8; l++) {
      const exp = l < lanes ? [l, [0xffffffff, 7, 0x80000000][l] ?? 0, 0, 0] : [0, 0, 0, 0];
      assert.deepEqual([0, 1, 2, 3].map((k) => r[laneId(l, k)]), exp, `${profile} lane ${l}`);
    }
    assert.deepEqual([r.active_mask, r.stack0, r.stack1, r.busy, r.done, r.cycles, r.idle_slots, r.lanes, r.pc], [2 ** lanes - 1, 2 ** lanes - 1, 2 ** lanes - 1, 1, 0, 0, 0, lanes, 0]);
  }
});

test('G6: one nested IFLT works; a third push, and ELSE or ENDIF with no IFLT, stop with an error and change nothing', () => {
  const nested = create(asm('LDI r3, 2\nIFLT r0, r3\nIFLT r0, r3\nENDIF\nENDIF\nHALT'));
  assert.equal(runToEnd(nested), STOP.HALT);
  for (const [src, pc, re] of [
    ['IFLT r0, r1\nIFLT r0, r1\nIFLT r0, r1\nHALT', 2, /IFLT at 0x2: the mask stack is two deep/],
    ['ELSE\nHALT', 0, /ELSE at 0x0 has no IFLT to match/],
    ['IFLT r0, r1\nENDIF\nENDIF\nHALT', 2, /ENDIF at 0x2 has no IFLT to match/],
  ]) {
    const e = create(asm(src));
    assert.equal(runToEnd(e), STOP.ERROR, src);
    const s = e.state();
    assert.match(s.error, re);
    assert.equal(s.pc, pc);
    assert.equal(s.registers.cycles, pc, 'the failed instruction took no cycle');
    assert.equal(e.step(), null);
    assert.ok(e.back(), 'step back clears the error');
    assert.equal(e.state().error, null);
    assert.equal(e.state().pc, pc);
  }
});

test('G7: an instruction issued with no lane active still takes a cycle; every lane counts as idle', () => {
  const e = create(asm('.din 1, 2, 3, 4\nLDI r3, 0\nIFLT r1, r3\nADD r2, r1, r1\nENDIF\nHALT'));
  assert.equal(runToEnd(e), STOP.HALT);
  const r = e.state().registers;
  assert.deepEqual([r.cycles, r.idle_slots, r.active_mask], [5, 4, 0xf]);
  assert.deepEqual(dout(r), [0, 0, 0, 0], 'no lane wrote r2');
});

test('G8: the PC wraps at sixteen words; a program without HALT runs on to the run limit; the counters are 16-bit', () => {
  const p = asm(Array(16).fill('.word 0xE000').join('\n'));
  const e = create(p, { runLimit: 70_000 });
  for (let i = 0; i < 16; i++) e.step();
  assert.equal(e.state().pc, 0, 'wrapped');
  assert.equal(runToEnd(e), STOP.BUDGET);
  assert.equal(e.state().registers.cycles, 70_000 & 0xffff);
  // per pass of sixteen words: one LDI with no lane active, eight idle slots; 9000 passes
  const r = create(asm(`LDI r3, -9\nIFLT r0, r3\nLDI r1, 1\nENDIF\n${Array(12).fill('.word 0xE000').join('\n')}`, 'simt8'), { runLimit: 16 * 9000 });
  assert.equal(runToEnd(r), STOP.BUDGET);
  assert.equal(r.state().registers.idle_slots, (8 * 9000) & 0xffff, 'idle_slots wraps too');
  assert.equal(r.counters().find(([k]) => /Idle/.test(k))[1], 8 * 9000, 'the counters panel counts on');
});

test('G8: the core refuses program writes and start while busy, with an error, and changes nothing', () => {
  const core = new SimtCore();
  core.pmWrite(0, encode('LDI', { rd: 2, imm: 1 }));
  core.pmWrite(1, 0);
  core.setDin([1, 2, 3, 4]);
  assert.equal(core.start(), null);
  assert.match(core.pmWrite(1, 0xe000), /busy.*only while it is idle/);
  assert.equal(core.pm[1], 0);
  assert.match(core.start(), /busy: start is taken only while it is idle/);
  core.clock();
  assert.equal(core.cycles, 1);
  core.clock();
  assert.equal(core.done, true);
  assert.equal(core.pmWrite(1, 0xe000), null, 'idle again: written');
  assert.equal(core.start(), null);
  assert.equal(core.done, false);
});

// ---------------------------------------------------------------------------------------------------------------
// the reference: each lane a record of booleans and a list as its stack, written from the specification's table

function reference(words, din, lanes, limit) {
  const L = Array.from({ length: lanes }, (_, l) => ({ r: [l, (din[l] ?? 0) | 0, 0, 0], active: true, stack: [true, true] }));
  let pc = 0; let depth = 0; let cycles = 0; let idle = 0;
  const wrap = (v) => Number(BigInt.asIntN(32, BigInt(v)));
  for (let n = 0; n < limit; n++) {
    const w = words[pc];
    const op = w >> 13; const rd = (w >> 11) & 3; const rs = (w >> 9) & 3; const rt = (w >> 7) & 3; const imm = w & 255;
    if (op === 4 && depth === 2) return { error: true, pc, cycles };
    if ((op === 5 || op === 6) && depth === 0) return { error: true, pc, cycles };
    cycles += 1;
    if (op === 0) return { halt: true, pc, cycles, idle, dout: L.map((x) => x.r[2]), mask: L.map((x) => x.active) };
    if (op >= 1 && op <= 3) {
      for (const x of L) {
        if (!x.active) { idle += 1; continue; }
        x.r[rd] = op === 1 ? (imm >= 128 ? imm - 256 : imm) : op === 2 ? wrap(x.r[rs] + x.r[rt]) : wrap(x.r[rs] - x.r[rt]);
      }
    } else if (op === 4) {
      for (const x of L) { x.stack = [x.active, x.stack[0]]; x.active = x.active && x.r[rs] < x.r[rt]; }
      depth += 1;
    } else if (op === 5) {
      for (const x of L) x.active = x.stack[0] && !x.active;
    } else if (op === 6) {
      for (const x of L) { x.active = x.stack[0]; x.stack = [x.stack[1], x.stack[1]]; }
      depth -= 1;
    }
    pc = (pc + 1) % 16;
  }
  return { budget: true, pc, cycles };
}

/** A random program: mostly lane work and mask operations, HALT sometimes, op 7 rarely. */
function randomProgram(rand) {
  const pick = () => {
    const x = rand();
    if (x < 0.30) return encode('LDI', { rd: Math.floor(rand() * 4), imm: Math.floor(rand() * 256) });
    if (x < 0.55) return encode(rand() < 0.5 ? 'ADD' : 'SUB', { rd: Math.floor(rand() * 4), rs: Math.floor(rand() * 4), rt: Math.floor(rand() * 4) });
    if (x < 0.72) return encode('IFLT', { rs: Math.floor(rand() * 4), rt: Math.floor(rand() * 4) });
    if (x < 0.82) return encode('ELSE');
    if (x < 0.92) return encode('ENDIF');
    if (x < 0.97) return encode('HALT');
    return 0xe000 | Math.floor(rand() * 0x2000);
  };
  return Array.from({ length: 16 }, pick);
}

function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; }; }

test('the engine agrees with the per-lane reference on 3000 random programs, 4 and 8 lanes', () => {
  const rand = lcg(20261103);
  let halts = 0; let errors = 0;
  for (let i = 0; i < 3000; i++) {
    const lanes = i % 2 ? 8 : 4;
    const words = randomProgram(rand);
    const din = Array.from({ length: lanes }, () => Math.floor(rand() * 2 ** 32) - 2 ** 31);
    const p = { ...loadImage(words.map((w) => w.toString(16)).join('\n'), 'hex', 'r.hex', { profile: lanes === 8 ? 'simt8' : 'simt4' }), din: din.map((v) => v >>> 0) };
    const e = create(p, { runLimit: 200 });
    const stop = runToEnd(e);
    const ref = reference(words, din, lanes, 200);
    const s = e.state();
    const r = s.registers;
    assert.equal(s.pc, ref.pc, `program ${i}: pc`);
    assert.equal(r.cycles, ref.cycles & 0xffff, `program ${i}: cycles`);
    if (ref.halt) {
      halts += 1;
      assert.equal(stop, STOP.HALT, `program ${i}`);
      assert.deepEqual(dout(r, lanes), ref.dout, `program ${i}: dout`);
      assert.equal(r.idle_slots, ref.idle, `program ${i}: idle`);
      assert.equal(r.active_mask, ref.mask.reduce((m, a, l) => m | (a ? 1 << l : 0), 0), `program ${i}: mask`);
    } else if (ref.error) { errors += 1; assert.equal(stop, STOP.ERROR, `program ${i}`); } else assert.equal(stop, STOP.BUDGET, `program ${i}`);
  }
  assert.ok(halts > 500 && errors > 500, `both ends covered: ${halts} halts, ${errors} errors`);
});

test('step back restores every register and the output, exactly, through 300 random programs', () => {
  const rand = lcg(7);
  for (let i = 0; i < 300; i++) {
    const lanes = i % 2 ? 8 : 4;
    const words = randomProgram(rand);
    const p = { ...loadImage(words.map((w) => w.toString(16)).join('\n'), 'hex', 'r.hex', { profile: lanes === 8 ? 'simt8' : 'simt4' }),
      din: Array.from({ length: lanes }, () => Math.floor(rand() * 2 ** 32)) };
    const e = create(p, { runLimit: 60 });
    const seen = [e.state()];
    const recs = [];
    for (let k = 0; k < 60; k++) { const r = e.step(); if (!r) break; recs.push(r); seen.push(e.state()); }
    if (e.state().error) { assert.ok(e.back()); assert.deepEqual(e.state(), seen.at(-1)); }
    for (let k = seen.length - 2; k >= 0; k--) {
      assert.deepEqual(e.last(), Object.fromEntries(Object.entries(recs[k]).filter(([key]) => !['halt', 'output'].includes(key))), `program ${i}: last() at ${k + 1}`);
      assert.ok(e.back());
      assert.deepEqual(e.state(), seen[k], `program ${i}: after back to ${k}`);
    }
    assert.equal(e.back(), false);
    assert.equal(e.last(), null);
  }
});

test('the history ring grows past its first chunk, drops the oldest beyond its limit, and the snapshot carries it', () => {
  const p = asm(`.din 3, 1, 4, 1\nLDI r3, 2\nIFLT r1, r3\nADD r2, r2, r1\nELSE\nSUB r2, r2, r0\nENDIF\n${Array(10).fill('ADD r3, r3, r1').join('\n')}`);
  const e = create(p, { historyLimit: 3000, runLimit: 5000 });
  const states = [e.state()];
  for (let k = 1; k <= 4000; k++) { e.step(); if (k >= 1000) states.push(e.state()); } // states[1]: after 1000 steps
  const snap = structuredClone(e.snapshot());
  const f = create(p, { historyLimit: 3000, runLimit: 5000 });
  f.restore(snap);
  assert.deepEqual(f.state(), e.state());
  for (let k = 0; k < 3000; k++) { assert.ok(e.back()); assert.ok(f.back()); }
  assert.equal(e.back(), false, 'only 3000 steps kept');
  assert.equal(e.state().historyDropped, 1000);
  assert.deepEqual({ ...e.state(), historyDropped: 0 }, states[1]);
  assert.deepEqual({ ...f.state(), historyDropped: 0 }, states[1]);
  for (let k = 0; k < 10; k++) { e.step(); f.step(); }
  assert.deepEqual(f.state(), e.state(), 'the restored engine runs on alike');
});

test('initialState and the record: a step lists the lane writes, then the core registers it changed', () => {
  const st = initialState(4, [9, 8, 7, 6]);
  assert.equal(st.regs[5], 8);
  const e = create(asm('.din 5, -3, 0, -7\nLDI r3, 0\nIFLT r1, r3\nSUB r2, r3, r1\nHALT'));
  e.step();
  const r = e.step();
  assert.deepEqual(r, { pc: 1, word: 0x8380, size: 2, nextPc: 2, registers: [
    { id: 'active_mask', old: 15, value: 10 }, { id: 'depth', old: 0, value: 1 }, { id: 'cycles', old: 1, value: 2 }], memory: [] });
  assert.deepEqual(e.step().registers.map((x) => x.id), ['l1r2', 'l3r2', 'cycles', 'idle_slots']);
  const h = e.step();
  assert.deepEqual([h.halt, h.pc, h.nextPc, e.state().pc], [true, 3, 3, 3], 'the PC stays on HALT');
  assert.equal(e.counters()[5][1], '75 %', 'LDI on four lanes, SUB on two: 6 of 8 lane-slots');
  assert.deepEqual(Object.keys(OPS), ['HALT', 'LDI', 'ADD', 'SUB', 'IFLT', 'ELSE', 'ENDIF']);
});
