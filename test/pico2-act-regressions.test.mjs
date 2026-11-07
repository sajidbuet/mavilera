// Regression tests for the defects riscv-arch-test (ACT4, run by tools/pico2-act-run.mjs) found in the hart, and for the options the
// runner needs to match the framework's reference (Sail 0.16): the standard pmpcfg layout, the specification's pmpaddr read-back, the
// LR/SC reservation granule and Hazard3 without Xh3irq. Each expectation is the ACT test's, not a second model.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hart, FlatMemory, CAUSE, IRQ, PRIV_U, PRIV_M } from '../src/arch/pico2/core/hart.js';
import { Pmp } from '../src/arch/pico2/core/pmp.js';

const I = (op, f3, rd, rs1, imm) => (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const Rr = (f7, f3, rd, rs1, rs2, op = 0x33) => ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const MRET = 0x30200073, ECALL = 0x73;
const lr = (rd, rs1) => Rr(8, 2, rd, rs1, 0, 0x2f), sc = (rd, rs1, rs2) => Rr(12, 2, rd, rs1, rs2, 0x2f);
const csrrs = (rd, csr, rs1) => I(0x73, 2, rd, rs1, csr);
const MPRV = 1 << 17, MPP_M = 3 << 11, MPIE = 1 << 7;

function machine(words, opts = {}) {
  const mem = new FlatMemory(0x10000);
  const dv = new DataView(mem.bytes.buffer);
  words.forEach((w, i) => dv.setUint32(4 * i, w >>> 0, true));
  return { mem, h: new Hart(mem, opts) };
}

test('mret keeps MPRV when it returns to M mode and clears it only when it returns to U mode (hazard3_csr.v; ACT Sm_xret)', () => {
  const a = machine([MRET]);
  a.h.mstatus = MPRV | MPP_M | MPIE;
  a.h.step();
  assert.equal(a.h.priv, PRIV_M);
  assert.ok(a.h.mstatus & MPRV, 'MPRV kept');
  const b = machine([MRET]);
  b.h.mstatus = MPRV | MPIE; // MPP = U
  b.h.step();
  assert.equal(b.h.priv, PRIV_U);
  assert.equal(b.h.mstatus & MPRV, 0, 'MPRV cleared on the return to U mode');
});

test('mstatus.MPP stores only bit 12 of the written value (hazard3_csr.v)', () => {
  const h = new Hart(new FlatMemory(0x100));
  h.csrWrite(0x300, 1 << 11);
  assert.equal((h.csrRead(0x300) >>> 11) & 3, 0, 'bit 11 alone: U');
  h.csrWrite(0x300, 1 << 12);
  assert.equal((h.csrRead(0x300) >>> 11) & 3, 3, 'bit 12: M, and bit 11 mirrors it');
});

test('sc.w with no reservation still takes the PMP store fault, and leaves rd alone (ACT PMP_Zalrsc_cfg_wr)', () => {
  const m = machine([sc(5, 1, 2)], { pmp: { specCfgBits: true } });
  const h = m.h;
  h.x[1] = 0x2000; h.x[2] = 77; h.x[5] = 0x1234;
  h.csrWrite(0x3b0, (0x2000 >>> 2) | 0x1f);   // 256-byte NAPOT region
  h.csrWrite(0x3a0, 0x99);                    // locked, NAPOT, read only (standard layout)
  h.step();
  assert.equal(h.mcause, CAUSE.STORE_FAULT);
  assert.equal(h.x[5], 0x1234);
  assert.equal(m.mem.read32(0x2000), 0);
});

test('a trap after a meinext access works (the interrupt controller kept its snapshot in a field that shadowed a method)', () => {
  const m = machine([csrrs(5, 0xbe4, 0), ECALL]);
  m.h.step();
  m.h.step();
  assert.equal(m.h.mcause, CAUSE.ECALL_M);
  assert.equal(m.h.x[5] >>> 0, 0x80000000, 'meinext: noirq');
});

test('Hazard3 without Xh3irq: no controller CSRs, and mip.MEIP is the OR of the lines', () => {
  const h = new Hart(new FlatMemory(0x100), { xh3irq: false });
  assert.equal(h.csrRead(0xbe0), undefined);
  assert.equal(h.csrWrite(0xbe0, 1), false);
  assert.equal(h.mip & (1 << IRQ.MEI), 0);
  h.setExternalIrqs(1 << 9);
  assert.ok(h.mip & (1 << IRQ.MEI), 'any line is MEIP, with no enable or priority');
  h.setExternalIrqs(0);
  assert.equal(h.mip & (1 << IRQ.MEI), 0);
});

test('LR/SC reservation granule: exact word by default; reservationShift 6 covers a 64-byte block', () => {
  const run = (opts, scAddr) => {
    const m = machine([lr(3, 1), sc(4, 2, 5)], opts);
    m.h.x[1] = 0x1000; m.h.x[2] = scAddr; m.h.x[5] = 9;
    m.h.step(); m.h.step();
    return m.h.x[4];
  };
  assert.equal(run({}, 0x1000), 0);
  assert.equal(run({}, 0x1008), 1, 'a different word fails');
  assert.equal(run({ reservationShift: 6 }, 0x1038), 0, 'same 64-byte block');
  assert.equal(run({ reservationShift: 6 }, 0x1040), 1, 'next block');
});

test('Pmp options: the standard pmpcfg layout, write-only clearing and the specification\'s pmpaddr read-back', () => {
  const rtl = new Pmp(), std = new Pmp({ specCfgBits: true });
  rtl.csrWrite(0x3a0, 0x1c);  // A = NAPOT, bit 2 set: R in the RTL's transposed layout
  std.csrWrite(0x3a0, 0x1c);  // bit 2 set: X in the standard layout
  assert.deepEqual([rtl.r[0], rtl.x[0]], [1, 0]);
  assert.deepEqual([std.r[0], std.x[0]], [0, 1]);
  assert.equal(rtl.csrRead(0x3a0) & 0xff, 0x1c);
  assert.equal(std.csrRead(0x3a0) & 0xff, 0x1c);
  const wo = new Pmp({ specCfgBits: true, clearWriteOnly: true });
  wo.csrWrite(0x3a0, 0x1a);   // W only (R = 0, W = 1)
  assert.equal(wo.csrRead(0x3a0) & 7, 0, 'R=0 W=1 clears the permissions');
  const keep = new Pmp({ specCfgBits: true });
  keep.csrWrite(0x3a0, 0x1a);
  assert.equal(keep.csrRead(0x3a0) & 7, 2, 'the RTL keeps it');
  const spec = new Pmp({ specCfgBits: true, specReadback: true });
  spec.csrWrite(0x3b0, 0xffffffff);
  assert.equal(spec.csrRead(0x3b0) >>> 0, 0xfffffff8, 'OFF: the G = 3 low bits read zero');
  spec.csrWrite(0x3a0, 0x18); // NAPOT
  assert.equal(spec.csrRead(0x3b0) >>> 0, 0xffffffff, 'NAPOT: the G - 1 low bits read one');
  const quirk = new Pmp({ specCfgBits: true });
  quirk.csrWrite(0x3b0, 0xffffffff);
  assert.equal(quirk.csrRead(0x3b0) >>> 0, 0xffffffff, 'RTL, OFF: as stored');
  quirk.csrWrite(0x3a0, 0x18);
  assert.equal(quirk.csrRead(0x3b0) >>> 0, 0xfffffffc, 'RTL, NAPOT: the G - 1 low bits cleared');
});
