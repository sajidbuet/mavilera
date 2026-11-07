// Zcmp on the pico2 hart (P1-M1). riscv-arch-test cannot check Zcmp (Sail 0.16 has no switch for it), so every encoding
// of cm.push, cm.pop, cm.popret, cm.popretz (rlist 4 to 15, spimm 0 to 3), cm.mva01s and cm.mvsa01 (every register pair)
// is checked here against a reference written from the Hazard3 RTL's micro-op expansion (hazard3_instr_decompress.v lines
// 127-167 of the pinned hazard3-rp2350 tree): n registers in the order ra, s0, s1, s2...; register k at
// sp - (n - k) * 4 for a push (before sp moves), at sp + adj - (n - k) * 4 for a pop; adj = base + spimm * 16 with base 16,
// 32, 48 or 64 by rlist. rp2350js-c1570 (cpu.ts xreg_list) gives the same layout. Plus faults part-way and step-back.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hart, FlatMemory, CAUSE } from '../src/arch/pico2/core/hart.js';
import { HistoryRing } from '../src/arch/pico2/core/history.js';

const KIND = { push: 0x18, pop: 0x1a, popretz: 0x1c, popret: 0x1e };
const enc = (kind, rlist, spimm) => (0b101 << 13) | (KIND[kind] << 8) | (rlist << 4) | (spimm << 2) | 0b10;
const encMv = (mva01s, r1, r2) => (0b101011 << 10) | (r1 << 7) | ((mva01s ? 0b11 : 0b01) << 5) | (r2 << 2) | 0b10;

// the reference, from the RTL's wires
const nRegs = (rlist) => (rlist === 15 ? 13 : rlist - 3);
const lsReg = (k) => (k === 0 ? 1 : k === 1 ? 8 : k === 2 ? 9 : 15 + k); // zcmp_ls_reg
const adjOf = (rlist, spimm) => (rlist === 15 ? 64 : rlist >= 12 ? 48 : rlist >= 8 ? 32 : 16) + spimm * 16;
const sReg = (r) => (r < 2 ? 8 + r : 16 + r); // zcmp_sa01_r1s: {|r[2:1], ~|r[2:1], r[2:0]}

const SP = 0x800;
function machine(half) {
  const mem = new FlatMemory(0x1000);
  const dv = new DataView(mem.bytes.buffer);
  dv.setUint16(0, half, true);
  const h = new Hart(mem);
  for (let i = 1; i < 32; i++) h.x[i] = 0x1000 * i + 7;
  h.x[2] = SP;
  return { h, mem, dv };
}

test('cm.push: every rlist and spimm stores the registers where the RTL does and moves sp', () => {
  for (let rlist = 4; rlist <= 15; rlist++) {
    for (let spimm = 0; spimm < 4; spimm++) {
      const { h, dv } = machine(enc('push', rlist, spimm));
      const regs = { ...h.x };
      h.step();
      assert.equal(h.trapped, false);
      const n = nRegs(rlist), adj = adjOf(rlist, spimm);
      for (let k = 0; k < n; k++) assert.equal(dv.getInt32(SP - (n - k) * 4, true), regs[lsReg(k)], `rlist ${rlist}: x${lsReg(k)}`);
      assert.equal(h.x[2], SP - adj, `rlist ${rlist} spimm ${spimm}: sp`);
      assert.equal(h.pc, 2);
    }
  }
});

test('cm.pop, cm.popret, cm.popretz: every rlist and spimm loads from the RTL\'s slots; popretz zeroes a0; popret(z) return to ra', () => {
  for (const kind of ['pop', 'popret', 'popretz']) {
    for (let rlist = 4; rlist <= 15; rlist++) {
      for (let spimm = 0; spimm < 4; spimm++) {
        const { h, dv } = machine(enc(kind, rlist, spimm));
        const n = nRegs(rlist), adj = adjOf(rlist, spimm);
        for (let k = 0; k < n; k++) dv.setInt32(SP + adj - (n - k) * 4, k === 0 ? 0x101 : 0x5000 + k, true); // ra = 0x101 (bit 0 cleared on return)
        const a0 = h.x[10];
        h.step();
        assert.equal(h.trapped, false);
        for (let k = 0; k < n; k++) assert.equal(h.x[lsReg(k)], k === 0 ? 0x101 : 0x5000 + k, `${kind} rlist ${rlist}: x${lsReg(k)}`);
        assert.equal(h.x[2], SP + adj, `${kind}: sp`);
        assert.equal(h.x[10], kind === 'popretz' ? 0 : a0, `${kind}: a0`);
        assert.equal(h.pc, kind === 'pop' ? 2 : 0x100, `${kind}: pc`);
      }
    }
  }
});

test('cm.mva01s and cm.mvsa01: every pair of s registers (cm.mvsa01 with equal registers too, as the RTL decodes it)', () => {
  for (let r1 = 0; r1 < 8; r1++) {
    for (let r2 = 0; r2 < 8; r2++) {
      const a = machine(encMv(true, r1, r2)).h;
      const v1 = a.x[sReg(r1)], v2 = a.x[sReg(r2)];
      a.step();
      assert.equal(a.x[10], v1); assert.equal(a.x[11], v2);
      const b = machine(encMv(false, r1, r2)).h;
      const a0 = b.x[10], a1 = b.x[11];
      b.step();
      assert.equal(b.trapped, false);
      if (r1 !== r2) assert.equal(b.x[sReg(r1)], a0);
      assert.equal(b.x[sReg(r2)], a1, 'the second write wins when the registers are equal');
    }
  }
});

test('rlist 0 to 3 is reserved: illegal instruction', () => {
  for (const kind of Object.keys(KIND)) for (let rlist = 0; rlist < 4; rlist++) {
    const { h } = machine(enc(kind, rlist, 0));
    h.step();
    assert.equal(h.mcause, CAUSE.ILLEGAL, `${kind} rlist ${rlist}`);
  }
});

test('a push that faults part-way: the stores before the fault stay, sp does not move, mepc is the push', () => {
  const { h, dv } = machine(enc('push', 15, 0)); // 13 registers in 52 bytes below sp, stored ra first (lowest address)
  h.x[2] = 0x1014; // slots 0xfe0 to 0x1010: the memory ends at 0x1000, so the ninth store faults
  h.step();
  assert.equal(h.mcause, CAUSE.STORE_FAULT);
  assert.equal(h.x[2], 0x1014);
  assert.equal(h.mepc, 0);
  for (let k = 0; k < 8; k++) assert.equal(dv.getInt32(0xfe0 + 4 * k, true), h.x[lsReg(k)], `slot ${k} written before the fault`);
});

test('push and pop step back exactly (registers, memory, sp, pc)', () => {
  for (const kind of ['push', 'popretz']) {
    const { h, mem } = machine(enc(kind, 15, 3));
    h.attachHistory(new HistoryRing(1 << 12));
    const x = [...h.x], m = mem.bytes.slice();
    h.step();
    assert.ok(h.stepBack());
    assert.deepEqual([...h.x], x, kind);
    assert.deepEqual(mem.bytes, m, kind);
    assert.equal(h.pc, 0);
  }
});
