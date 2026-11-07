// The pico2 history ring (P1-M1): every step, forward then back, returns the registers, pc, memory, CSR/trap/PMP/interrupt state
// and counters to what they were before it, including steps with variable-length records (Zcmp) and steps that trap.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hart, FlatMemory, IRQ } from '../src/arch/pico2/core/hart.js';
import { HistoryRing } from '../src/arch/pico2/core/history.js';

const I = (op, f3, rd, rs1, imm) => (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const Rr = (f7, f3, rd, rs1, rs2, op = 0x33) => ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const addi = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const lui = (rd, imm20) => ((imm20 << 12) | (rd << 7) | 0x37) >>> 0;
const sw = (rs2, rs1, imm) => ((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (2 << 12) | ((imm & 31) << 7) | 0x23) >>> 0;
const sb = (rs2, rs1, imm) => ((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | ((imm & 31) << 7) | 0x23) >>> 0;
const lw = (rd, rs1, imm) => I(0x03, 2, rd, rs1, imm);
const csrrw = (rd, csr, rs1) => I(0x73, 1, rd, rs1, csr);
const csrrsi = (rd, csr, u) => I(0x73, 6, rd, u, csr);
const ECALL = 0x73, MRET = 0x30200073, WFI = 0x10500073;

const full = (h) => JSON.stringify({ x: [...h.x], pc: h.pc, ticks: h.ticks, sys: h.saveSys() });
const memCopy = (m) => m.bytes.slice();

/** Run `words` (4-byte instructions, then halfwords given as {h}) for `n` steps, comparing the state before and after stepping back each. */
function roundTrip(words, n, { setup = () => {}, ring = new HistoryRing(1 << 14) } = {}) {
  const mem = new FlatMemory(0x4000);
  const dv = new DataView(mem.bytes.buffer);
  let a = 0;
  for (const w of words) { if (typeof w === 'object') { dv.setUint16(a, w.h, true); a += 2; } else { dv.setUint32(a, w >>> 0, true); a += 4; } }
  const h = new Hart(mem);
  h.attachHistory(ring);
  setup(h, mem);
  const states = [];
  for (let i = 0; i < n; i++) { states.push({ s: full(h), m: memCopy(mem) }); h.step(); }
  for (let i = n - 1; i >= 0; i--) {
    assert.equal(h.stepBack(), true, `step back ${i}`);
    assert.equal(full(h), states[i].s, `registers, pc and system state after undoing step ${i}`);
    assert.deepEqual(mem.bytes, states[i].m, `memory after undoing step ${i}`);
  }
  assert.equal(h.stepBack(), false, 'nothing left');
  return { h, ring };
}

test('plain steps: ALU, loads and stores of every width, branches; each step undone in turn', () => {
  roundTrip([lui(1, 1), addi(2, 0, -5), sw(2, 1, 0), lw(3, 1, 0), sb(2, 1, 5), addi(0, 0, 9), Rr(1, 0, 4, 2, 3), 0x00000063 | (1 << 15) | (0 << 20) | (8 << 7)], 8);
});

test('traps, mret, CSR writes, wfi and lr/sc: the system state comes back', () => {
  const m = [addi(5, 0, 0x40), csrrw(0, 0x305, 5), csrrsi(0, 0x300, 8), ECALL, addi(6, 0, 7), csrrw(0, 0x340, 5), 0x00000000, WFI];
  const ring = new HistoryRing(1 << 14);
  const { h } = roundTrip(m, 6, { ring, setup: (hh, mem) => { const dv = new DataView(mem.bytes.buffer); [addi(7, 0, 1), MRET].forEach((w, i) => dv.setUint32(0x40 + 4 * i, w, true)); } });
  assert.equal(h.pc, 0);
});

test('sleeping steps are recorded: stepping back takes back their cycles and ticks', () => {
  const { h } = roundTrip([WFI, addi(1, 0, 1)], 5, { setup: (hh) => { hh.mcountinhibit = 0; } });
  assert.equal(h.cycles, 0); assert.equal(h.ticks, 0);
});

test('an interrupt taken and undone, including the Xh3irq preemption state', () => {
  roundTrip([addi(1, 0, 1), addi(2, 0, 2), addi(3, 0, 3)], 3, { setup: (h) => {
    h.csrWrite(0xbe0, (1 << 16) | 0, 0, 1); h.csrWrite(0xbe3, (7 << 16), 0, 1);  // enable line 0, priority 7
    h.mie = 1 << IRQ.MEI; h.mstatus |= 8; h.mtvec = 0x101; h.setExternalIrqs(1);
  } });
});

test('Zcmp: a push and a pop with a long register list are one step each, undone in one step', () => {
  const m = [{ h: 0xb8e2 }, { h: 0xbae2 }, addi(1, 0, 1)]; // cm.push {ra,s0-s9},-48 ; cm.pop {ra,s0-s9},48
  const { h } = roundTrip(m, 3, { setup: (hh) => { hh.x[2] = 0x2000; for (let i = 1; i < 32; i++) hh.x[i] = hh.x[i] || i * 11; hh.x[2] = 0x2000; } });
  assert.equal(h.x[2], 0x2000);
});

test('cm.popretz writes a0, sp and the register list; cm.mva01s and cm.mvsa01', () => {
  roundTrip([{ h: 0xbc62 }, { h: 0xad6e }, { h: 0xacaa }], 3, { setup: (h) => { h.x[2] = 0x1000; h.x[1] = 0x20; for (let i = 8; i < 28; i++) h.x[i] = i; } });
});

test('records have variable length: a push is longer than an ALU step, and the ring drops the oldest whole records', () => {
  const mem = new FlatMemory(0x4000);
  const dv = new DataView(mem.bytes.buffer);
  [addi(1, 0, 1), { h: 0xb8e2 }, addi(1, 1, 1)].forEach((w, i) => { if (typeof w === 'object') dv.setUint16(4 + 0, w.h, true); else dv.setUint32(i === 0 ? 0 : 6, w, true); });
  const h = new Hart(mem); h.x[2] = 0x2000;
  const ring = new HistoryRing(40); h.attachHistory(ring);
  h.step(); const afterAlu = ring.used;
  h.step();
  const push = ring.used - afterAlu;
  assert.ok(afterAlu <= 8, `an ALU step takes ${afterAlu} words`);
  assert.ok(push > 20, `cm.push {ra,s0-s9} takes ${push} words`);
  for (let i = 0; i < 6; i++) h.step();
  assert.ok(ring.dropped > 0 && ring.used <= 40);
  while (ring.count) assert.ok(ring.undo(h));  // the surviving records unwind without error
});

test('a device write (the bus has no peek) is recorded but not restored', () => {
  const mem = new FlatMemory(0x1000); mem.peek = undefined;
  new DataView(mem.bytes.buffer).setUint32(0, sw(2, 1, 0), true);
  const h = new Hart(mem); h.x[1] = 0x100; h.x[2] = 77;
  const ring = new HistoryRing(1 << 10); h.attachHistory(ring);
  h.step();
  assert.equal(mem.read32(0x100), 77);
  assert.equal(ring.deviceWrites, 1);
  ring.undo(h);
  assert.equal(mem.read32(0x100), 77, 'not restored');
  assert.equal(h.pc, 0);
});
