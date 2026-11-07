// The pico2 hart (P1-M1): instruction semantics, traps, interrupts, CSRs and the decode cache, on small hand-encoded programs.
// Not the architecture test: riscv-arch-test is the exit criterion and is run separately.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hart, FlatMemory, CAUSE, IRQ, PRIV_U, PRIV_M } from '../src/arch/pico2/core/hart.js';

// ---- a tiny encoder: just enough to write the programs ----
const I = (op, f3, rd, rs1, imm) => (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const R = (f7, f3, rd, rs1, rs2, op = 0x33) => ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const addi = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const lui = (rd, imm20) => ((imm20 << 12) | (rd << 7) | 0x37) >>> 0;
const B = (f3, rs1, rs2, off) => ((((off >> 12) & 1) << 31) | (((off >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (((off >> 1) & 0xf) << 8) | (((off >> 11) & 1) << 7) | 0x63) >>> 0;
const sw = (rs2, rs1, imm) => ((((imm >> 5) & 0x7f) << 25) | (rs2 << 20) | (rs1 << 15) | (2 << 12) | ((imm & 31) << 7) | 0x23) >>> 0;
const lw = (rd, rs1, imm) => I(0x03, 2, rd, rs1, imm);
const csrrw = (rd, csr, rs1) => I(0x73, 1, rd, rs1, csr);
const csrrs = (rd, csr, rs1) => I(0x73, 2, rd, rs1, csr);
const csrrsi = (rd, csr, u) => I(0x73, 6, rd, u, csr);
const ECALL = 0x00000073, EBREAK = 0x00100073, MRET = 0x30200073, WFI = 0x10500073, FENCE_I = 0x0000100f;

function machine(words, { size = 0x10000, ...opts } = {}) {
  const mem = new FlatMemory(size);
  const dv = new DataView(mem.bytes.buffer);
  let a = 0;
  for (const w of words) { if (typeof w === 'object') { dv.setUint16(a, w.h, true); a += 2; } else { dv.setUint32(a, w >>> 0, true); a += 4; } }
  return { mem, hart: new Hart(mem, opts) };
}
const half = (h) => ({ h });
const runN = (m, n) => { for (let i = 0; i < n; i++) m.hart.step(); return m.hart; };

test('a loop: the sum of 1 to 10, with a backward branch', () => {
  const m = machine([addi(5, 0, 10), addi(6, 0, 0), R(0, 0, 6, 6, 5), addi(5, 5, -1), B(1, 5, 0, -8), EBREAK]);
  const h = runN(m, 3 + 10 * 3 - 3 + 1); // 2 setup + 10 * 3 loop - the last iteration's branch is taken 9 times
  while (h.mcause !== CAUSE.BREAKPOINT && h.instret < 100) h.step();
  assert.equal(h.x[6], 55);
  assert.equal(h.mcause, CAUSE.BREAKPOINT);
  assert.equal(h.mepc, 20);
});

test('x0 stays zero, loads and stores of every width, sign and zero extension', () => {
  const m = machine([addi(0, 0, 5), lui(1, 1), addi(2, 0, -2), sw(2, 1, 0), lw(3, 1, 0),
    I(0x03, 0, 4, 1, 0), I(0x03, 4, 5, 1, 0), I(0x03, 1, 6, 1, 0), I(0x03, 5, 7, 1, 0)]);
  const h = runN(m, 9);
  assert.equal(h.x[0], 0);
  assert.deepEqual([h.x[3], h.x[4], h.x[5], h.x[6], h.x[7]], [-2, -2, 0xfe, -2, 0xfffe]);
});

test('M extension: the corner cases of division and the high products', () => {
  const m = machine([R(1, 4, 3, 1, 2), R(1, 5, 4, 1, 2), R(1, 6, 5, 1, 2), R(1, 7, 6, 1, 2), R(1, 1, 7, 1, 2), R(1, 3, 8, 1, 2), R(1, 2, 9, 1, 2)]);
  const h = m.hart;
  h.x[1] = -2147483648; h.x[2] = -1;
  runN(m, 7);
  assert.deepEqual([h.x[3], h.x[4], h.x[5], h.x[6]], [-2147483648, 0, 0, -2147483648], 'div overflow: INT_MIN; divu 0x80000000/0xffffffff = 0; rem 0; remu = the dividend');
});

test('M extension: division by zero and mulh, mulhsu, mulhu', () => {
  const m = machine([R(1, 4, 3, 1, 2), R(1, 5, 4, 1, 2), R(1, 6, 5, 1, 2), R(1, 7, 6, 1, 2), R(1, 1, 7, 1, 8), R(1, 2, 9, 1, 8), R(1, 3, 10, 1, 8)]);
  const h = m.hart;
  h.x[1] = 7; h.x[2] = 0; h.x[8] = 0xffffffff | 0;
  runN(m, 7);
  assert.deepEqual([h.x[3], h.x[4], h.x[5], h.x[6]], [-1, -1, 7, 7], 'x/0: div and divu give all ones, rem and remu the dividend');
  const n = machine([R(1, 1, 3, 1, 2), R(1, 2, 4, 1, 2), R(1, 3, 5, 1, 2)]);
  n.hart.x[1] = -3; n.hart.x[2] = 0x7fffffff;
  runN(n, 3);
  assert.deepEqual([n.hart.x[3], n.hart.x[4], n.hart.x[5]], [-2, -2, 0x7ffffffd], 'mulh -3 * 0x7fffffff = -0x17ffffffd -> high -2; mulhu(0xfffffffd, 0x7fffffff) = 0x7ffffffd');
});

test('Zb* and Zbkb operations', () => {
  const m = machine([
    R(0x10, 2, 3, 1, 2), R(0x10, 4, 4, 1, 2), R(0x10, 6, 5, 1, 2), // sh1add sh2add sh3add
    I(0x13, 1, 6, 1, 0x600), I(0x13, 1, 7, 1, 0x601), I(0x13, 1, 8, 1, 0x602), // clz ctz cpop
    I(0x13, 5, 9, 1, 0x698), I(0x13, 5, 10, 1, 0x287), // rev8 orc.b
    R(0x04, 4, 11, 1, 2), R(0x04, 7, 12, 1, 2), // pack packh
    I(0x13, 1, 13, 1, 0x08f), I(0x13, 5, 14, 13, 0x08f), // zip unzip
    R(0x30, 1, 15, 1, 2), R(0x30, 5, 16, 1, 2), // rol ror
    R(0x24, 5, 17, 1, 2), R(0x14, 1, 18, 1, 2), // bext bset
  ]);
  const h = m.hart;
  h.x[1] = 0x00f0f001; h.x[2] = 3;
  runN(m, 18);
  assert.equal(h.x[3], (0x00f0f001 * 2 + 3) | 0);
  assert.equal(h.x[4], (0x00f0f001 * 4 + 3) | 0);
  assert.equal(h.x[5], (0x00f0f001 * 8 + 3) | 0);
  assert.equal(h.x[6], 8, 'clz');
  assert.equal(h.x[7], 0, 'ctz');
  assert.equal(h.x[8], 9, 'cpop');
  assert.equal(h.x[9], 0x01f0f000 | 0, 'rev8');
  assert.equal(h.x[10], 0x00ffffff, 'orc.b');
  assert.equal(h.x[11], (3 << 16) | 0xf001, 'pack');
  assert.equal(h.x[12], 0x0301, 'packh');
  assert.equal(h.x[14], 0x00f0f001, 'unzip(zip(x)) = x');
  assert.equal(h.x[15], (0x00f0f001 << 3) | (0x00f0f001 >>> 29), 'rol');
  assert.equal(h.x[16], ((0x00f0f001 >>> 3) | (0x00f0f001 << 29)) | 0, 'ror');
  assert.equal(h.x[17], 0, 'bext of bit 3');
  assert.equal(h.x[18], 0x00f0f001 | 8, 'bset 3');
});

test('ecall traps to mtvec with mepc, mcause and the mstatus stack; mret returns', () => {
  const m = machine([addi(5, 0, 0x40), csrrw(0, 0x305, 5), ECALL, addi(6, 0, 7), EBREAK]);
  const h = m.hart;
  // handler at 0x40: mepc += 4, mret
  const dv = new DataView(m.mem.bytes.buffer);
  [csrrs(7, 0x341, 0), addi(7, 7, 4), csrrw(0, 0x341, 7), MRET].forEach((w, i) => dv.setUint32(0x40 + 4 * i, w, true));
  h.mstatus = 1 << 3; // MIE
  runN(m, 3);
  assert.equal(h.pc, 0x40);
  assert.equal(h.mcause, CAUSE.ECALL_M);
  assert.equal(h.mepc, 8);
  assert.equal(h.mstatus & (1 << 3), 0, 'MIE cleared');
  assert.ok(h.mstatus & (1 << 7), 'MPIE set from MIE');
  runN(m, 4);
  assert.equal(h.pc, 12);
  assert.ok(h.mstatus & (1 << 3), 'MIE restored by mret');
  runN(m, 2);
  assert.equal(h.x[6], 7);
  assert.equal(h.mcause, CAUSE.BREAKPOINT);
});

test('illegal instruction: mcause 2, mtval 0 (hardwired in Hazard3)', () => {
  const m = machine([0x00000000]);
  runN(m, 1);
  assert.equal(m.hart.mcause, CAUSE.ILLEGAL);
  assert.equal(m.hart.csrRead(0x343), 0);
});

test('U mode: CSR and mret are illegal, ecall is cause 8, mret to U via MPP', () => {
  const m = machine([addi(5, 0, 0x100), csrrw(0, 0x341, 5), MRET, csrrs(1, 0x300, 0), ECALL]);
  const h = m.hart;
  h.mstatus = 0; // MPP = U
  runN(m, 3);
  assert.equal(h.priv, PRIV_U);
  assert.equal(h.pc, 0x100);
  h.pc = 12; h.mtvec = 0x80;
  runN(m, 1); // csrrs mstatus in U mode
  assert.equal(h.mcause, CAUSE.ILLEGAL);
  assert.equal(h.priv, PRIV_M);
  assert.equal((h.mstatus >>> 11) & 3, 0, 'MPP records U');
  h.priv = PRIV_U; h.pc = 16;
  runN(m, 1);
  assert.equal(h.mcause, CAUSE.ECALL_U);
});

test('misaligned and faulting accesses trap with the right causes and mepc', () => {
  const m = machine([lui(1, 0x80), lw(2, 1, 1), sw(2, 1, 2), addi(3, 0, -1), lw(4, 3, 0), sw(4, 3, 0)], { size: 0x10000 });
  const h = m.hart;
  h.x[1] = 0x1001; h.pc = 4; runN(m, 1);
  assert.deepEqual([h.mcause, h.mepc], [CAUSE.LOAD_MISALIGNED, 4]);
  h.x[1] = 1; h.pc = 8; runN(m, 1);
  assert.equal(h.mcause, CAUSE.STORE_MISALIGNED);
  h.x[3] = 0x20000; h.pc = 16; runN(m, 1);
  assert.equal(h.mcause, CAUSE.LOAD_FAULT);
  h.pc = 20; runN(m, 1);
  assert.equal(h.mcause, CAUSE.STORE_FAULT);
  h.pc = 0x40000; runN(m, 1);
  assert.equal(h.mcause, CAUSE.FETCH_FAULT);
});

test('interrupts: enabled and pending, taken only with MIE, vectored mtvec, wfi sleeps and wakes', () => {
  const m = machine([addi(1, 0, 1), WFI, addi(2, 0, 2), addi(3, 0, 3)]);
  const h = m.hart;
  h.mtvec = 0x101;                       // vectored
  h.mie = 1 << IRQ.MTI;
  h.setIrq(1 << IRQ.MTI);
  runN(m, 1);
  assert.equal(h.x[1], 1, 'pending but MIE is off: the instruction runs');
  assert.equal(h.pc, 4);
  runN(m, 1);                            // wfi: an enabled interrupt is already pending, it still executes as wfi then wakes
  h.setIrq(0);
  assert.equal(h.sleeping, true);
  runN(m, 3);
  assert.equal(h.pc, 8, 'sleeping: nothing retires');
  h.setIrq(1 << IRQ.MTI);
  h.mstatus |= 1 << 3;
  runN(m, 1);
  assert.equal(h.mcause >>> 0, (0x80000000 | IRQ.MTI) >>> 0);
  assert.equal(h.pc, 0x100 + 4 * IRQ.MTI, 'vectored: base + 4 * cause');
  assert.equal(h.mepc, 8, 'mepc is the instruction after the wfi');
});

test('CSR semantics: csrrs with x0 does not write, mie mask, mtvec WARL, mcause mask, counters and mcountinhibit', () => {
  const m = machine([csrrs(1, 0xf13, 0), csrrw(0, 0x304, 5), csrrs(2, 0x304, 0), csrrw(0, 0x305, 6), csrrs(3, 0x305, 0),
    csrrsi(0, 0x320, 4), addi(0, 0, 0), addi(0, 0, 0), csrrs(4, 0xb02, 0)]);
  const h = m.hart;
  h.x[5] = -1; h.x[6] = 0x203;
  assert.equal(h.mcountinhibit, 5, 'the counters are inhibited at reset');
  h.mcountinhibit = 0;
  runN(m, 9);
  assert.equal(h.x[1] >>> 0, 0x86fc4e3f, 'mimpid read through csrrs x0: no write to a read-only CSR');
  assert.equal(h.x[2], 0x888, 'mie keeps meie, mtie, msie');
  assert.equal(h.x[3], 0x201, 'mtvec: bit 1 reads zero');
  assert.equal(h.x[4], 5, 'minstret stopped counting once mcountinhibit.IR was set: 6 retired before the read, the csrrsi counts, then two addi do not');
});

test('mcountinhibit.CY stops mcycle for every kind of step (sleep, interrupt entry, fetch fault); ticks always advance', () => {
  const m = machine([WFI, addi(1, 0, 1)], { size: 0x200 });
  const h = m.hart;
  h.mtvec = 0x100;                                 // the handler is never executed in this test
  assert.equal(h.mcountinhibit & 1, 1);
  runN(m, 4);                                      // wfi, then three sleeping steps
  h.mie = 1 << IRQ.MTI; h.mstatus |= 1 << 3; h.setIrq(1 << IRQ.MTI);
  runN(m, 1);                                      // interrupt entry
  h.pc = 0x300;                                    // outside the 0x200-byte memory: fetch fault
  runN(m, 1);
  assert.equal(h.cycles, 0, 'inhibited: no step counted');
  // P1-M3 cost model (core/timing.js): wfi 2, a sleeping cycle 1, interrupt entry 2, exception entry 3 (was one per step)
  assert.equal(h.ticks, 2 + 3 + 2 + 3, 'ticks: every step\'s cycles');
  h.reset(); h.mcountinhibit = 0;
  runN(m, 4);
  assert.equal(h.cycles, 2 + 3, 'not inhibited: the wfi (2) and three sleeping cycles count');
});

test('the decode cache: hits on a loop, and a changed instruction is decoded again', () => {
  const m = machine([addi(5, 0, 100), addi(5, 5, -1), B(1, 5, 0, -4), EBREAK]);
  const h = m.hart;
  runN(m, 1 + 2 * 100);
  assert.ok(h.cacheHits > 190, `${h.cacheHits} hits`);
  assert.equal(h.cacheMisses, 3);
  // self-modifying code: the cache is keyed by the fetched word, so the new instruction runs even without fence.i
  h.pc = 0; h.x[5] = 0;
  new DataView(m.mem.bytes.buffer).setUint32(0, addi(5, 0, 9), true);
  runN(m, 1);
  assert.equal(h.x[5], 9);
});

test('compressed instructions execute with a 2-byte step; link addresses use the length', () => {
  const m = machine([half(0x0511), half(0x4585), half(0x9582), EBREAK]); // c.addi a0,4; c.li a1,1; c.jalr a1 (jump to 1: then odd)
  const h = m.hart;
  runN(m, 2);
  assert.deepEqual([h.x[10], h.x[11], h.pc], [4, 1, 4]);
  runN(m, 1);
  assert.equal(h.x[1], 6, 'c.jalr: ra = pc + 2');
  assert.equal(h.pc, 0, 'target 1 with bit 0 cleared');
});

test('Zcmp: cm.push stores in the specified order and cm.popret restores and returns', () => {
  const m = machine([half(0xb8e2), half(0xbee2)]); // cm.push {ra,s0-s9},-48 ; cm.popret {ra,s0-s9},48
  const h = m.hart;
  h.x[2] = 0x1000; h.x[1] = 0x1234; h.x[8] = 0xa8; h.x[9] = 0xa9; h.x[18] = 0xb2; h.x[25] = 77;
  runN(m, 1);
  assert.equal(h.x[2], 0x1000 - 48);
  const dv = new DataView(m.mem.bytes.buffer);
  // {ra, s0-s9} is 11 registers: ra at the lowest address (sp-44), s9 at sp-4 (hazard3_instr_decompress.v zcmp_stack_sw_offset;
  // rp2350js-c1570 xreg_list agrees)
  assert.equal(dv.getInt32(0x1000 - 44, true), 0x1234, 'ra at sp-44');
  assert.equal(dv.getInt32(0x1000 - 40, true), 0xa8, 's0 at sp-40');
  assert.equal(dv.getInt32(0x1000 - 36, true), 0xa9, 's1 at sp-36');
  assert.equal(dv.getInt32(0x1000 - 32, true), 0xb2, 's2 at sp-32');
  assert.equal(dv.getInt32(0x1000 - 4, true), 77, 's9 (x25) at sp-4');
  h.x[1] = 0; h.x[8] = 0; h.x[18] = 0;
  h.pc = 2;
  runN(m, 1);
  assert.equal(h.x[2], 0x1000, 'sp restored');
  assert.equal(h.x[8], 0xa8, 's0 restored from its slot');
  assert.equal(h.x[18], 0xb2, 's2 restored from its slot');
  assert.equal(h.pc, 0x1234 & ~1, 'popret returns to the restored ra');
});

test('lr.w / sc.w and the amo operations', () => {
  const m = machine([R(8, 2, 3, 1, 0, 0x2f), R(12, 2, 4, 1, 2, 0x2f), R(12, 2, 5, 1, 2, 0x2f), R(0, 2, 6, 1, 2, 0x2f)]);
  const h = m.hart;
  h.x[1] = 0x100; h.x[2] = 5;
  new DataView(m.mem.bytes.buffer).setInt32(0x100, 40, true);
  runN(m, 3);
  assert.equal(h.x[3], 40, 'lr.w');
  assert.equal(h.x[4], 0, 'sc.w succeeds after lr.w');
  assert.equal(new DataView(m.mem.bytes.buffer).getInt32(0x100, true), 5);
  assert.equal(h.x[5], 1, 'a second sc.w fails: the reservation is gone');
  runN(m, 1);
  assert.equal(h.x[6], 5, 'amoadd.w returns the old value');
  assert.equal(new DataView(m.mem.bytes.buffer).getInt32(0x100, true), 10);
});

test('PMP in the hart: U mode is denied outside the hardwired regions (fetch, load, AMO as a store fault); MPRV applies MPP to data accesses', () => {
  const m = machine([lw(2, 1, 0), R(0, 2, 3, 1, 2, 0x2f), lw(2, 1, 0)], { size: 0x10000 });
  const h = m.hart;
  h.priv = PRIV_U; h.x[1] = 0x20000000;
  runN(m, 1);
  assert.deepEqual([h.priv, h.mcause, h.mepc], [PRIV_M, CAUSE.LOAD_FAULT, 0]);
  h.priv = PRIV_U; h.pc = 4; runN(m, 1);
  assert.equal(h.mcause, CAUSE.STORE_FAULT, 'amoadd.w: the load half needs W and faults as a store');
  h.priv = PRIV_U; h.pc = 0x20000000; runN(m, 1);
  assert.equal(h.mcause, CAUSE.FETCH_FAULT);
  // M mode with MPRV and MPP = U: the data access is checked as U mode
  h.pc = 8; h.priv = PRIV_M; h.mstatus = (1 << 17); runN(m, 1);
  assert.equal(h.mcause, CAUSE.LOAD_FAULT);
  h.pc = 8; h.priv = PRIV_M; h.mstatus = (1 << 17) | (3 << 11); h.x[1] = 0x100; runN(m, 1);
  assert.equal(h.pc, 12, 'MPP = M: allowed');
});

test('Xh3bextm: extract 1 to 8 bits at a register or immediate position', () => {
  const h3 = (f3, rd, rs1, rs2, size1) => ((size1 << 26) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | 0x0b) >>> 0;
  const m = machine([h3(0, 3, 1, 2, 3), h3(4, 4, 1, 8, 7), h3(0, 5, 1, 2, 0), h3(0, 6, 1, 2, 7)]);
  const h = m.hart;
  h.x[1] = 0xdeadbeef | 0; h.x[2] = 36;     // the shift amount is rs2[4:0] = 4
  runN(m, 4);
  assert.equal(h.x[3], 0xe, '4 bits at bit 4 of 0xdeadbeef: 0xe');
  assert.equal(h.x[4], 0xbe, '8 bits at bit 8: 0xbe');
  assert.equal(h.x[5], 0, 'one bit at bit 4: 0xef has bit 4 clear');
  assert.equal(h.x[6], 0xee, '8 bits at bit 4: 0xee');
});
