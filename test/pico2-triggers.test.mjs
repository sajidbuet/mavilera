// The pico2 hart's trigger module and the CSRs Hazard3 does not decode outside debug mode (P1-M1). Expectations from
// hazard3_triggers.v, hazard3_csr.v (TCONTROL, DCSR, DPC, DMDATA0; "MSECCFG ... we don't decode it") and
// hazard3_core.v (a trigger break is the highest-priority exception, EXCEPT_EBREAK) of the pinned hazard3-rp2350 tree.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hart, FlatMemory, CAUSE, PRIV_U } from '../src/arch/pico2/core/hart.js';
import { HistoryRing } from '../src/arch/pico2/core/history.js';

const I = (op, f3, rd, rs1, imm) => (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const addi = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const csrrw = (rd, csr, rs1) => I(0x73, 1, rd, rs1, csr);
const csrrs = (rd, csr, rs1) => I(0x73, 2, rd, rs1, csr);
const MRET = 0x30200073;
const TSELECT = 0x7a0, TDATA1 = 0x7a1, TDATA2 = 0x7a2, TINFO = 0x7a4, TCONTROL = 0x7a5;

function machine(words, opts = {}) {
  const mem = new FlatMemory(0x1000);
  const dv = new DataView(mem.bytes.buffer);
  words.forEach((w, i) => dv.setUint32(4 * i, w >>> 0, true));
  const h = new Hart(mem, opts);
  h.mtvec = 0x800;
  return { mem, h, dv };
}

test('trigger CSRs: tselect is 2 bits, tinfo says type 2 and ignores writes, tdata1 reads as an exact-address mcontrol', () => {
  const { h } = machine([]);
  h.csrWrite(TSELECT, 5); assert.equal(h.csrRead(TSELECT), 1, 'four triggers: tselect keeps 2 bits');
  assert.equal(h.csrRead(TINFO), 4);
  assert.equal(h.csrWrite(TINFO, 0xffffffff), true, 'a write to tinfo does not trap');
  assert.equal(h.csrRead(TINFO), 4);
  assert.equal(h.csrRead(TDATA1) >>> 0, 0x20000000, 'type 2, everything else zero at reset');
  h.csrWrite(TDATA1, 0xffffffff);
  assert.equal(h.csrRead(TDATA1) >>> 0, (0x20000000 | (1 << 12) | (1 << 6) | (1 << 3) | (1 << 2)) >>> 0, 'action, m, u, execute only; dmode stays 0');
  h.csrWrite(TDATA2, 0x1234);
  h.csrWrite(TSELECT, 0);
  assert.equal(h.csrRead(TDATA2), 0, 'tdata2 is per trigger');
  h.csrWrite(TCONTROL, 0xff);
  assert.equal(h.csrRead(TCONTROL), 0x88, 'tcontrol: mpte (bit 7) and mte (bit 3)');
});

/** Arm trigger 0 at `pc` with the given tdata1 bits and tcontrol.mte. */
const arm = (h, pc, bits, mte = 1) => { h.csrWrite(TSELECT, 0); h.csrWrite(TDATA2, pc); h.csrWrite(TDATA1, bits); h.csrWrite(TCONTROL, mte << 3); };
const M = 1 << 6, U = 1 << 3, EXEC = 1 << 2, ACTION_D = 1 << 12;

test('an armed M-mode execute trigger raises a breakpoint before the instruction executes; tcontrol.mte is saved and cleared, mret restores it', () => {
  const { h, dv } = machine([addi(1, 0, 1), addi(2, 0, 2)]);
  dv.setUint32(0x800, MRET, true);
  arm(h, 4, M | EXEC);
  h.step();
  assert.equal(h.x[1], 1);
  h.step();
  assert.equal(h.trapped, true);
  assert.equal(h.mcause, CAUSE.BREAKPOINT);
  assert.equal(h.mepc, 4, 'mepc is the instruction the trigger matched');
  assert.equal(h.x[2], 0, 'the instruction did not execute');
  assert.equal(h.pc, 0x800);
  assert.equal(h.csrRead(TCONTROL), 0x80, 'mpte <- mte, mte <- 0');
  h.mepc = 8; // the handler skips the instruction
  h.step(); // mret
  assert.equal(h.csrRead(TCONTROL), 0x88, 'mte <- mpte, mpte unchanged');
  assert.equal(h.pc, 8);
});

test('a trigger does not fire with tcontrol.mte clear, with action = 1 (debug mode, not modelled), or in a mode it does not select', () => {
  for (const [bits, mte, why] of [[M | EXEC, 0, 'mte clear'], [M | EXEC | ACTION_D, 1, 'action 1'], [U | EXEC, 1, 'u only, hart in M'], [M, 1, 'execute clear']]) {
    const { h } = machine([addi(1, 0, 1)]);
    arm(h, 0, bits, mte);
    h.step();
    assert.equal(h.trapped, false, why);
    assert.equal(h.x[1], 1, why);
  }
});

test('a U-mode trigger fires in U mode, ahead of a fetch fault at the same address', () => {
  const { h } = machine([]);
  arm(h, 0x2000, U | EXEC); // outside the 4 KiB memory: the fetch would fault, but the trigger has priority
  h.priv = PRIV_U; h.pc = 0x2000;
  h.step();
  assert.equal(h.mcause, CAUSE.BREAKPOINT);
});

test('a trigger trap steps back, tcontrol included', () => {
  const { h } = machine([addi(1, 0, 1)]);
  arm(h, 0, M | EXEC);
  h.attachHistory(new HistoryRing(1 << 12));
  const before = JSON.stringify(h.saveSys());
  h.step();
  assert.equal(h.trapped, true);
  assert.ok(h.stepBack());
  assert.equal(JSON.stringify(h.saveSys()), before);
  assert.equal(h.pc, 0);
});

test('dcsr, dpc and dmdata0 (debug mode only), mcontext, mseccfg and mseccfgh (not decoded) are illegal in M mode', () => {
  for (const csr of [0x7b0, 0x7b1, 0xbff, 0x7a8, 0x747, 0x757]) {
    for (const insn of [csrrs(1, csr, 0), csrrw(0, csr, 1)]) {
      const { h } = machine([insn]);
      h.x[1] = 7;
      h.step();
      assert.equal(h.mcause, CAUSE.ILLEGAL, `CSR 0x${csr.toString(16)}`);
      assert.equal(h.x[1], 7);
    }
  }
});

test('trigger CSRs are M-mode only', () => {
  const { h } = machine([csrrs(1, TSELECT, 0)]);
  h.priv = PRIV_U;
  h.step();
  assert.equal(h.mcause, CAUSE.ILLEGAL);
});
