// The pico2 PMP (P1-M1): 11 regions with 3 hardwired, NAPOT only, 32-byte granule, pmpcfgm0, lock bit, fetch straddling.
// Expectations come from hazard3_pmp.v of the pinned RTL tree and RP-001 §3.8.8.1, not from a second model.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pmp } from '../src/arch/pico2/core/pmp.js';
import { Hart, FlatMemory, CAUSE, PRIV_U } from '../src/arch/pico2/core/hart.js';

const napot = (base, size) => ((base >>> 2) | ((size >>> 3) - 1)) | 0; // pmpaddr for a power-of-two region of >= 8 bytes
const R = 4, W = 2, X = 1, NAPOT = 3 << 3, L = 0x80;

test('reset state: hardwired regions 8 to 10, others off with the granule bits of pmpaddr set', () => {
  const p = new Pmp();
  assert.equal(p.csrRead(0x3a2) & 0xff, 0x1f, 'region 8: NAPOT, RWX');
  assert.equal((p.csrRead(0x3a2) >>> 8) & 0xff, 0x1f);
  assert.equal((p.csrRead(0x3a2) >>> 16) & 0xff, 0x1f);
  assert.equal(p.csrRead(0x3b8), 0x01ffffff);
  assert.equal(p.csrRead(0x3b9), 0x13ffffff);
  assert.equal(p.csrRead(0x3ba), 0x35ffffff);
  assert.equal(p.csrRead(0x3b0), 3, 'a region that is OFF reads its low granule bits as stored');
  assert.equal(p.csrRead(0x3bb), 0, 'pmpaddr11 to 15 exist and read zero');
  assert.equal(p.csrRead(0x3a3), 0);
});

test('hardwired regions: ROM, peripherals and SIO are open to U mode; SRAM, XIP and everything else are not', () => {
  const p = new Pmp();
  for (const a of [0x0, 0x0ffffffc, 0x40000000, 0x5ffffffc, 0xd0000000, 0xdffffffc]) assert.equal(p.deniesData(a, true, false), false, a.toString(16));
  for (const a of [0x10000000, 0x20000000, 0x60000000, 0xe0000000, 0x30000000]) assert.equal(p.deniesData(a | 0, false, false), true, a.toString(16));
  assert.equal(p.deniesData(0x20000000, true, true), false, 'M mode ignores unlocked regions and no match');
  assert.equal(p.deniesFetch(0x20000000, true, false), true);
  assert.equal(p.deniesFetch(0x00000100, true, false), false);
});

test('hardwired registers ignore writes; pmpcfgm0 cannot select them', () => {
  const p = new Pmp();
  p.csrWrite(0x3a2, 0); p.csrWrite(0x3b8, 0x1234);
  assert.equal(p.csrRead(0x3a2) & 0xff, 0x1f);
  assert.equal(p.csrRead(0x3b8), 0x01ffffff);
  p.csrWrite(0xbd0, 0xffffffff);
  assert.equal(p.csrRead(0xbd0), 0xff, 'regions 0 to 7 only');
});

test('a NAPOT region for U mode: read only, then write-protected store and AMO fault; lowest region wins', () => {
  const p = new Pmp();
  p.csrWrite(0x3b0, napot(0x20000000, 0x1000)); p.csrWrite(0x3a0, NAPOT | R);
  assert.equal(p.deniesData(0x20000ffc, false, false), false);
  assert.equal(p.deniesData(0x20000ffc, true, false), true);
  assert.equal(p.deniesData(0x20001000, false, false), true, 'outside the region');
  assert.equal(p.deniesFetch(0x20000000, false, false), true, 'no X');
  // region 1 overlaps with more permission, but region 0 is lower-numbered
  p.csrWrite(0x3b1, napot(0x20000000, 0x1000)); p.csrWrite(0x3a0, (NAPOT | R) | ((NAPOT | R | W | X) << 8));
  assert.equal(p.deniesData(0x20000000, true, false), true);
  // M mode: unlocked region does not apply, pmpcfgm0 makes it apply
  assert.equal(p.deniesData(0x20000000, true, true), false);
  p.csrWrite(0xbd0, 1);
  assert.equal(p.deniesData(0x20000000, true, true), true);
  assert.equal(p.deniesData(0x20000000, false, true), false);
});

test('lock: applies to M mode and freezes the region', () => {
  const p = new Pmp();
  p.csrWrite(0x3b2, napot(0x30000000, 0x100)); p.csrWrite(0x3a0, (NAPOT | R | L) << 16);
  assert.equal(p.deniesData(0x30000000, true, true), true, 'locked, no W: M mode is denied');
  p.csrWrite(0x3a0, (NAPOT | R | W) << 16); p.csrWrite(0x3b2, 0);
  assert.equal(p.deniesData(0x30000000, true, true), true, 'writes to a locked region are ignored');
  assert.equal(p.csrRead(0x3a0) >>> 16 & 0xff, NAPOT | R | L);
});

test('WARL: TOR and NA4 read back as OFF; a non-hardwired NAPOT pmpaddr reads without its granule bits (as hazard3_pmp.v does)', () => {
  const p = new Pmp();
  p.csrWrite(0x3a0, 0x01 << 3 | (2 << 3) << 8);            // TOR in region 0, NA4 in region 1
  assert.equal(p.csrRead(0x3a0), 0);
  p.csrWrite(0x3b3, 0x08000fff); p.csrWrite(0x3a0, NAPOT << 24);
  assert.equal(p.csrRead(0x3b3), 0x08000ffc, 'low two bits cleared while the region is active');
  p.csrWrite(0x3a0, 0);
  assert.equal(p.csrRead(0x3b3), 0x08000fff, 'and read as stored when it is off');
});

test('a 32-bit fetch straddling the end of a region fails; a compressed one at the last halfword passes', () => {
  const p = new Pmp();
  p.csrWrite(0x3b0, napot(0x20000000, 0x100)); p.csrWrite(0x3a0, NAPOT | X | R);
  assert.equal(p.deniesFetch(0x200000fe, true, false), true, 'partial match');
  assert.equal(p.deniesFetch(0x200000fe, false, false), false, 'a 16-bit instruction fits');
  assert.equal(p.deniesFetch(0x200000fc, true, false), false);
  // a partial match is allowed when a lower-numbered region matches fully: region 0 covers both halves
  const q = new Pmp();
  q.csrWrite(0x3b0, napot(0x20000000, 0x200)); q.csrWrite(0x3b1, napot(0x20000000, 0x100));
  q.csrWrite(0x3a0, (NAPOT | X) | ((NAPOT | X) << 8));
  assert.equal(q.deniesFetch(0x200000fe, true, false), false);
  // the lowest-numbered region that matches either halfword decides: region 0 matching only the second half is a partial match
  const r = new Pmp();
  r.csrWrite(0x3b0, napot(0x20000100, 0x100)); r.csrWrite(0x3b1, napot(0x20000000, 0x200));
  r.csrWrite(0x3a0, (NAPOT | X) | ((NAPOT | X) << 8));
  assert.equal(r.deniesFetch(0x200000fe, true, false), true, 'region 0 matches the second halfword only');
});

// The hart's straddling checks, through its fast path (hazard3_pmp.v i_kill: a partial match kills in every mode)
const ADDI = (rd, rs1, imm) => (((imm & 0xfff) << 20) | (rs1 << 15) | (rd << 7) | 0x13) >>> 0;
function hartAt(size, pc, insn) {
  const mem = new FlatMemory(size);
  const dv = new DataView(mem.bytes.buffer);
  if (insn > 0xffff) { dv.setUint16(pc, insn & 0xffff, true); if (pc + 2 < size) dv.setUint16(pc + 2, insn >>> 16, true); } else dv.setUint16(pc, insn, true);
  const h = new Hart(mem, { resetPc: pc });
  h.mtvec = 0x400;
  return h;
}

test('hart: a 32-bit instruction straddling a region boundary faults in M mode too (unlocked region, the fast path)', () => {
  const h = hartAt(0x1000, 30, ADDI(1, 0, 5));
  h.pmp.csrWrite(0x3b0, napot(0, 32)); h.pmp.csrWrite(0x3a0, NAPOT | X | R);
  assert.equal(h.pmp.mFree, true);
  h.step();
  assert.equal(h.mcause, CAUSE.FETCH_FAULT);
  assert.equal(h.x[1], 0);
  // without region 0 only the hardwired region 8 (0 to 0x0fffffff) matches, fully: it executes
  const g = hartAt(0x1000, 30, ADDI(1, 0, 5));
  g.step();
  assert.equal(g.x[1], 5);
  // a compressed instruction (c.li x1, 5) in the last halfword fits
  const c = hartAt(0x1000, 30, 0x4095);
  c.pmp.csrWrite(0x3b0, napot(0, 32)); c.pmp.csrWrite(0x3a0, NAPOT | X | R);
  c.step();
  assert.equal(c.x[1], 5);
});

test('hart: the same straddle in U mode, and with a locked region (the full check)', () => {
  for (const cfg of [NAPOT | X | R, NAPOT | X | R | L]) {
    const h = hartAt(0x1000, 30, ADDI(1, 0, 5));
    h.pmp.csrWrite(0x3b0, napot(0, 32)); h.pmp.csrWrite(0x3b1, napot(0, 64)); h.pmp.csrWrite(0x3a0, cfg | ((NAPOT | X | R) << 8));
    if (cfg & L) assert.equal(h.pmp.mFree, false); else h.priv = PRIV_U;
    h.step();
    assert.equal(h.mcause, CAUSE.FETCH_FAULT, `cfg 0x${cfg.toString(16)}`);
  }
});

test('hart: a 32-bit instruction whose second halfword lies beyond the memory faults; a compressed one at a word-aligned end does not', () => {
  const h = hartAt(0x100, 0xfe, ADDI(1, 0, 5));
  h.step();
  assert.equal(h.mcause, CAUSE.FETCH_FAULT);
  assert.equal(h.mepc, 0xfe);
  const c = hartAt(0x102, 0x100, 0x4095); // the 32-bit read at 0x100 faults; the halfword read succeeds
  c.step();
  assert.equal(c.x[1], 5);
  assert.equal(c.pc, 0x102);
});
