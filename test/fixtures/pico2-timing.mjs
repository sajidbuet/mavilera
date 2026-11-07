// pico2-timing.mjs -- the E-TIMING-1 program for the pico2 assembler and its testbench (fixture of test/pico2-timing.test.mjs and
// test/pico2-stages.test.mjs): research repository experiments/e-timing-1/sw/timing.S written again without macros (the macros
// are JS functions, local labels get unique names, GNU's `unimp` is its word 0xc0001073), and a bus with the RTL testbench's
// MMIO (id, value, exit, software interrupt, irq[0]). An interrupt line is raised at the cycle the RTL recognised it: the
// store's X cycle + 3 + N for the software interrupt, + 2 + N for irq[0] (read off the RTL's squashed-instruction index;
// a test input, the model has no pin latency).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Hart } from '../../src/arch/pico2/core/hart.js';
import { assemble, RAM_BASE, RAM_SIZE } from '../../src/arch/pico2/language.js';

// ---- timing.S as a generator ---------------------------------------------------------------------------------------
export const MMIO = 0x80000000, ID = 0, VAL = 4, EXIT = 8, SOFT = 12, IRQ0 = 16;

export function timingSource() {
  const L = [];
  let n = 0;
  const lab = (s = 'l') => `${s}_${++n}`;
  // GNU as pads `.balign 4` in code with a c.nop when the position is 2 mod 4; the pico2 assembler pads with zero bytes, so
  // the generator tracks the position mod 4 (every instruction it writes is 4 or 8 bytes except c.* and cm.*) and adds the c.nop
  let odd = false, code = true;
  const o = (...lines) => {
    for (const line of lines) {
      const body = line.replace(/^\s*[A-Za-z_.$][A-Za-z0-9_.$]*:\s*/, '').trim();
      if (body === '.data') code = false;
      if (code && body === '.balign 4' && odd) { L.push('c.nop'); odd = false; }
      L.push(line);
      if (code && /^(c|cm)\./.test(body)) odd = !odd;
    }
  };
  const T = (id) => o(`li t6, ${id}`, `sw t6, ${ID}(gp)`, 'csrr t3, mcycle');
  const REPORT = () => o('sub t4, t4, t3', `sw t4, ${VAL}(gp)`);
  const E = () => { o('csrr t4, mcycle'); REPORT(); };
  const NOPS = (k) => { for (let i = 0; i < k; i++) o('nop'); };
  const rept = (k, line) => { for (let i = 0; i < k; i++) o(line); };
  const notTaken = (setup) => { const ok = lab(), bad = lab(); setup(bad); E(); o(`j ${ok}`, `${bad}: j fail`, `${ok}:`); };

  o('.text', '.globl _start', '_start:', `li gp, ${MMIO}`, `li sp, ${RAM_BASE + RAM_SIZE}`, 'la t0, trap', 'csrw mtvec, t0', 'csrw mcountinhibit, zero');
  NOPS(4);
  // calibration
  o('.balign 4'); T(1); E();
  // RV32I ALU
  o('.balign 4'); T(10); rept(10, 'add a0, a1, a2'); E();
  o('.balign 4'); T(11); rept(10, 'addi a0, a0, 1'); E();
  o('.balign 4'); T(12); o('lui a0, 0x12345', 'auipc a1, 0'); E();
  // loads and stores
  o('la a1, wdata', 'la a2, ptr');
  o('.balign 4'); T(20); o('lw t0, 0(a1)', 'addi t1, a0, 1'); E();
  o('.balign 4'); T(21); o('lw t0, 0(a1)', 'addi t1, t0, 1'); E();
  o('.balign 4'); T(22); o('lw t0, 0(a1)', 'sw t0, 4(a1)'); E();
  o('.balign 4'); T(23); o('lw t0, 0(a2)', 'lw t1, 0(t0)'); E();
  o('.balign 4'); T(24); notTaken((bad) => o('lw t0, 0(a1)', `beqz t0, ${bad}`));
  o('.balign 4'); T(25); o('lw t0, 0(a1)', 'nop', 'addi t1, t0, 1'); E();
  o('.balign 4'); T(26); o('lw t0, 0(a1)', 'add t1, a0, t0'); E();
  o('.balign 4'); T(27); for (const l of ['lb', 'lh', 'lhu', 'lbu']) o(`${l} t0, 0(a1)`, 'addi t1, t0, 1'); E();
  o('.balign 4'); T(28); o('sw a0, 8(a1)', 'sh a0, 8(a1)', 'sb a0, 8(a1)'); E();
  o('.balign 4'); T(29); o('lw t0, 0(a2)', 'sw a0, 0(t0)'); E();
  { const t = lab(); o('.balign 4'); T(66); o(`la t1, ${t}`, 'sw t1, 12(a1)', 'lw t0, 12(a1)', 'jalr x0, 0(t0)', `${t}:`); E(); }
  // M
  o('li a3, 1000', 'li a4, 7', 'li a5, -1000', 'li a6, -7');
  o('.balign 4'); T(30); o('mul t0, a3, a4', 'mulh t0, a3, a4', 'mulhsu t0, a3, a4', 'mulhu t0, a3, a4'); E();
  o('.balign 4'); T(31); o('mul t0, a3, a4', 'addi t1, t0, 1'); E();
  const DIVT = (id, op, x, y) => { o('.balign 4'); T(id); o(`${op} t0, ${x}, ${y}`); E(); };
  DIVT(32, 'div', 'a3', 'a4'); DIVT(33, 'div', 'a5', 'a4'); DIVT(34, 'div', 'a3', 'a6'); DIVT(35, 'div', 'a5', 'a6');
  DIVT(36, 'divu', 'a3', 'a4'); DIVT(37, 'rem', 'a3', 'a4'); DIVT(38, 'rem', 'a5', 'a4'); DIVT(39, 'rem', 'a3', 'a6');
  DIVT(40, 'rem', 'a5', 'a6'); DIVT(41, 'remu', 'a3', 'a4'); DIVT(42, 'div', 'a3', 'zero');
  o('li a7, 0x80000000'); DIVT(43, 'div', 'a7', 'a6');
  o('li s2, -1'); DIVT(44, 'div', 'a7', 's2'); DIVT(45, 'rem', 'a7', 's2'); DIVT(46, 'divu', 'a5', 'a4');
  DIVT(47, 'div', 'a4', 'a3'); DIVT(48, 'rem', 'a6', 'a3');
  o('.balign 4'); T(49); o('div t0, a3, a4', 'addi t1, t0, 1'); E();
  // A
  o('la a1, wdata');
  o('.balign 4'); T(50); o('lr.w t0, (a1)', 'addi t1, a0, 1'); E();
  o('.balign 4'); T(51); o('lr.w t0, (a1)', 'sc.w t1, a0, (a1)'); E();
  o('.balign 4'); T(52); notTaken((bad) => o('lr.w t0, (a1)', 'addi t2, a0, 0', 'sc.w t1, a0, (a1)', `bnez t1, ${bad}`));
  o('.balign 4'); T(53); o('amoadd.w t0, a0, (a1)'); E();
  o('.balign 4'); T(54); o('amoswap.w t0, a0, (a1)'); E();
  o('.balign 4'); T(55); o('lr.w t0, (a1)', 'amoor.w t1, a0, (a1)'); E();
  o('.balign 4'); T(56); o('amoand.w t0, a0, (a1)', 'addi t1, t0, 1'); E();
  o('.balign 4'); T(57); for (const a of ['amoxor.w', 'amomin.w', 'amomax.w', 'amominu.w', 'amomaxu.w']) o(`${a} t0, a0, (a1)`); E();
  o('.balign 4'); T(58); o('sc.w t1, a0, (a1)', 'sc.w t2, a0, (a1)'); E();
  // jumps
  { const t = lab(); o('.balign 4'); T(60); o(`jal x0, ${t}`, 'nop', `${t}:`); E(); }
  { const t = lab(); o('.balign 4'); T(61); o(`jal x0, ${t}`, 'c.nop', `${t}:`); E(); }
  { const t = lab(); o('.balign 4'); T(62); o(`jal x0, ${t}`, 'c.nop', `${t}: c.nop`, 'c.nop'); E(); }
  { const t = lab(); o('.balign 4'); T(63); o(`la t0, ${t}`, 'jalr x0, 0(t0)', 'nop', `${t}:`); E(); }
  { const t = lab(); o('.balign 4'); T(64); o(`la t0, ${t}`, 'jalr x0, 0(t0)', 'c.nop', `${t}:`); E(); }
  { const t = lab(); o('.balign 4'); T(65); o(`jal ra, ${t}`, `${t}: addi t1, ra, 1`); E(); }
  // branches
  o('li a0, 1');
  o('.balign 4'); T(70); notTaken((bad) => o(`beqz a0, ${bad}`));
  { const t = lab(); o('.balign 4'); T(71); o(`bnez a0, ${t}`, 'nop', `${t}:`); E(); }
  { const t = lab(); o('.balign 4'); T(72); o(`bnez a0, ${t}`, 'c.nop', `${t}:`); E(); }
  const LOOP = (id, k, pre, body) => { const t = lab(); o(`li a0, ${k}`, '.balign 4'); T(id); if (pre) o('c.nop'); o(`${t}: ${body}`, `bgez a0, ${t}`); E(); };
  LOOP(73, 9, false, 'addi a0, a0, -1'); LOOP(74, 19, false, 'addi a0, a0, -1');
  LOOP(75, 9, false, 'c.addi a0, -1'); LOOP(76, 19, false, 'c.addi a0, -1');
  LOOP(77, 9, true, 'addi a0, a0, -1'); LOOP(78, 19, true, 'addi a0, a0, -1');
  LOOP(79, 9, true, 'c.addi a0, -1'); LOOP(80, 19, true, 'c.addi a0, -1');
  // RP-001 §3.8.7.10 copy routine, 10 bytes
  { const t = lab(); o('la a1, src', 'la a0, dst', 'li a2, 10', 'add a2, a2, a1', '.balign 4'); T(81);
    o(`${t}: lbu a3, (a1)`, 'sb a3, (a0)', 'addi a0, a0, 1', 'addi a1, a1, 1', `bltu a1, a2, ${t}`); E(); }
  { const t = lab(), z = lab(); o('la a1, src', 'la a0, dst', 'li a2, 10', '.balign 4'); T(82);
    o(`beqz a2, ${z}`, 'add a2, a2, a1', `${t}: lbu a3, (a1)`, 'sb a3, (a0)', 'addi a0, a0, 1', 'addi a1, a1, 1', `bltu a1, a2, ${t}`, `${z}:`); E(); }
  // CSR, fences, Xh3power
  o('.balign 4'); T(90); o('csrrw t0, mscratch, a0', 'csrrs t0, mscratch, a0', 'csrrc t0, mscratch, a0', 'csrrwi t0, mscratch, 5', 'csrrsi t0, mscratch, 5', 'csrrci t0, mscratch, 5'); E();
  o('.balign 4'); T(91); o('csrr t0, mscratch', 'addi t1, t0, 1'); E();
  o('.balign 4'); T(92); o('fence'); E();
  o('.balign 4'); T(93); o('fence.i'); E();
  o('.balign 4'); T(94); o('.word 0x00102033'); E();                // h3.unblock (the test loops unblock out to in)
  o('.balign 4'); NOPS(4); T(95); o('.word 0x00002033'); E();      // h3.block after an unblock: falls through
  o('li t0, 8', 'csrs mie, t0', 'li t0, 1', `sw t0, ${SOFT}(gp)`); NOPS(6);
  o('.balign 4'); T(96); o('wfi'); E();
  o(`sw zero, ${SOFT}(gp)`, 'li t0, 8', 'csrc mie, t0'); NOPS(4);
  // traps
  const TRAP = (id, mretid, body, unalignedRet = false) => {
    const h = lab('h'), r = lab('r');
    o(`la t5, ${h}`, '.balign 4'); T(id); o(...body, 'j fail', `${h}:`);
    REPORT(); o(`la t0, ${r}`, 'csrw mepc, t0', '.balign 4'); T(mretid); o('mret', 'j fail');
    if (unalignedRet) o('c.nop');
    o(`${r}:`); E();
  };
  TRAP(100, 101, ['ecall']);
  TRAP(102, 103, ['ebreak'], true);                                   // mret to an unaligned 32-bit target
  TRAP(104, 105, ['.word 0xc0001073']);                               // unimp: csrrw x0, cycle, x0 (illegal)
  o('la a1, wdata');
  TRAP(106, 107, ['lw t0, 1(a1)']);
  TRAP(108, 109, ['sw t0, 2(a1)']);
  TRAP(110, 111, ['lw t0, 0(a1)', 'ecall']);
  // interrupt entry
  o('li t0, 8', 'csrs mie, t0', 'li t0, 0x800', 'csrs mie, t0', 'li t0, 0x00010000', 'csrw 0xbe0, t0');
  const IRQT = (id, reg, k, div = false) => {
    const s = lab('s'), h = lab('h');
    o(`la t5, ${h}`, `li t1, ${k}`, 'csrsi mstatus, 8', '.balign 4', `li t6, ${id}`, `sw t6, ${ID}(gp)`, 'csrr t3, mcycle', `sw t1, ${reg}(gp)`, `${s}:`);
    if (div) o('div t0, a3, a4');
    NOPS(40); o('j fail', `${h}: csrr t2, mepc`, `sw zero, ${reg}(gp)`);
    if (!div) o('csrw 0xbe5, zero');
    REPORT(); o(`la t0, ${s}`, 'sub t2, t2, t0', `sw t2, ${VAL}(gp)`); NOPS(4);
  };
  for (let k = 1; k <= 6; k++) IRQT(119 + k, SOFT, k);
  for (let k = 1; k <= 6; k++) IRQT(129 + k, IRQ0, k);
  IRQT(136, SOFT, 4, true); IRQT(137, SOFT, 10, true);
  o('csrci mstatus, 8', 'csrw mie, zero');
  // Zcmp
  const lists = [['{ra}', 16], ['{ra, s0}', 16], ['{ra, s0-s1}', 16], ['{ra, s0-s2}', 16], ['{ra, s0-s3}', 32], ['{ra, s0-s4}', 32],
    ['{ra, s0-s5}', 32], ['{ra, s0-s6}', 32], ['{ra, s0-s7}', 48], ['{ra, s0-s8}', 48], ['{ra, s0-s9}', 48], ['{ra, s0-s11}', 64]];
  lists.forEach(([rl, adj], i) => { o('.balign 4'); T(200 + 2 * i); o(`cm.push ${rl}, -${adj}`); E(); o('.balign 4'); T(201 + 2 * i); o(`cm.pop ${rl}, ${adj}`); E(); });
  const POPRET = (id, op, rl, adj, unaligned = false) => {
    const t = lab();
    o(`la ra, ${t}`, `cm.push ${rl}, -${adj}`, '.balign 4'); T(id); o(`${op} ${rl}, ${adj}`, 'j fail', '.balign 4');
    if (unaligned) o('c.nop');
    o(`${t}:`); E();
  };
  POPRET(230, 'cm.popret', '{ra}', 16); POPRET(231, 'cm.popret', '{ra, s0}', 16); POPRET(232, 'cm.popret', '{ra, s0-s1}', 16);
  POPRET(233, 'cm.popret', '{ra, s0-s4}', 32); POPRET(234, 'cm.popret', '{ra, s0-s11}', 64);
  POPRET(240, 'cm.popretz', '{ra}', 16); POPRET(241, 'cm.popretz', '{ra, s0}', 16); POPRET(242, 'cm.popretz', '{ra, s0-s1}', 16);
  POPRET(243, 'cm.popretz', '{ra, s0-s4}', 32); POPRET(244, 'cm.popretz', '{ra, s0-s11}', 64);
  POPRET(235, 'cm.popret', '{ra, s0}', 16, true);
  o('.balign 4'); T(250); o('cm.mva01s s0, s1'); E();
  o('.balign 4'); T(251); o('cm.mvsa01 s0, s1'); E();
  o('la a1, wdata');
  o('.balign 4'); T(252); o('c.lbu a2, 0(a1)', 'c.lhu a3, 0(a1)', 'c.lh a4, 0(a1)', 'c.sb a2, 1(a1)', 'c.sh a3, 2(a1)', 'c.zext.b a2', 'c.sext.b a2',
    'c.zext.h a2', 'c.sext.h a2', 'c.not a2', 'c.mul a2, a3'); E();
  o('.balign 4'); T(253); o('c.lw a2, 0(a1)', 'c.add a3, a2'); E();
  // bit manipulation
  o('.balign 4'); T(260);
  o('sh1add t0, a3, a4', 'sh2add t0, a3, a4', 'sh3add t0, a3, a4', 'andn t0, a3, a4', 'clz t0, a3', 'cpop t0, a3', 'ctz t0, a3', 'max t0, a3, a4',
    'maxu t0, a3, a4', 'min t0, a3, a4', 'minu t0, a3, a4', 'orc.b t0, a3', 'orn t0, a3, a4', 'rev8 t0, a3', 'rol t0, a3, a4', 'ror t0, a3, a4',
    'rori t0, a3, 3', 'sext.b t0, a3', 'sext.h t0, a3', 'xnor t0, a3, a4', 'zext.h t0, a3', 'bclr t0, a3, a4', 'bclri t0, a3, 3', 'bext t0, a3, a4',
    'bexti t0, a3, 3', 'binv t0, a3, a4', 'binvi t0, a3, 3', 'bset t0, a3, a4', 'bseti t0, a3, 3', 'pack t0, a3, a4', 'packh t0, a3, a4',
    'brev8 t0, a3', 'zip t0, a3', 'unzip t0, a3');
  E();
  // end
  { const t = lab(); o('li t0, 0', `sw t0, ${EXIT}(gp)`, `${t}: j ${t}`); }
  { const t = lab(); o('fail: li t0, 1', `sw t0, ${EXIT}(gp)`, `${t}: j ${t}`); }
  o('.balign 4', 'trap: csrr t4, mcycle', 'jr t5');
  o('.data', '.balign 4', 'wdata: .word 0x8081fe7f, 0, 0, 0, 0', 'ptr: .word wdata', 'src: .byte 1, 2, 3, 4, 5, 6, 7, 8, 9, 10', '.balign 4', 'dst: .space 16');
  return L.join('\n') + '\n';
}

// ---- the test machine: RAM where the assembler puts code and data, and the testbench's MMIO ----------------------------
export class TestBus {
  constructor() { this.bytes = new Uint8Array(RAM_SIZE); this.fault = false; this.results = new Map(); this.id = 0; this.exit = null; this.hart = null; this.raise = []; }
  ram(a, n) { const o = (a - RAM_BASE) >>> 0; if (o + n > RAM_SIZE) { this.fault = true; return -1; } return o; }
  peek(a, size) { const o = this.ram(a, size); this.fault = false; if (o < 0) return undefined; return size === 4 ? this.read32(a) : size === 2 ? this.read16(a) : this.bytes[o]; }
  read8(a) { const o = this.ram(a, 1); return o < 0 ? 0 : this.bytes[o]; }
  read16(a) { const o = this.ram(a, 2); return o < 0 ? 0 : this.bytes[o] | (this.bytes[o + 1] << 8); }
  read32(a) { const o = this.ram(a, 4); const b = this.bytes; return o < 0 ? 0 : (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0; }
  write8(a, v) { const o = this.ram(a, 1); if (o >= 0) this.bytes[o] = v; }
  write16(a, v) { const o = this.ram(a, 2); if (o >= 0) { this.bytes[o] = v; this.bytes[o + 1] = v >>> 8; } }
  write32(a, v) {
    if (a >>> 0 >= MMIO) { this.fault = false; this.mmio((a - MMIO) >>> 0, v | 0); return; }
    const o = this.ram(a, 4); if (o < 0) return;
    const b = this.bytes; b[o] = v; b[o + 1] = v >>> 8; b[o + 2] = v >>> 16; b[o + 3] = v >>> 24;
  }
  mmio(off, v) {
    const h = this.hart;
    if (off === ID) this.id = v;
    else if (off === VAL) { if (!this.results.has(this.id)) this.results.set(this.id, []); this.results.get(this.id).push(v); }
    else if (off === EXIT) this.exit = v;
    else if (off === SOFT || off === IRQ0) {
      const line = off === SOFT ? 'soft' : 'irq0';
      this.raise = this.raise.filter((r) => r.line !== line);
      if (v === 0) this.set(line, 0);
      else this.raise.push({ line, at: h.ticks + (line === 'soft' ? 3 : 2) + v }); // the RTL's recognition cycle (see the header)
      this.deadline = this.raise.reduce((m, r) => Math.min(m, r.at), Infinity);
    }
  }
  set(line, level) { if (line === 'soft') this.hart.setIrq(level ? 1 << 3 : 0); else this.hart.setExternalIrqs(level ? 1 : 0); }
  // the scheduler interface of the hart (deadline, serviceDue)
  serviceDue() {
    const now = this.hart.ticks;
    for (const r of this.raise.filter((x) => x.at <= now)) this.set(r.line, 1);
    this.raise = this.raise.filter((x) => x.at > now);
    this.deadline = this.raise.reduce((m, r) => Math.min(m, r.at), Infinity);
  }
}

export function runTiming({ history = null, onStep = null, afterStep = null, detail = false } = {}) {
  const p = assemble([{ name: 'timing.s', text: timingSource() }]);
  if (!p.ok) throw new Error(JSON.stringify(p.diagnostics.slice(0, 5)));
  const bus = new TestBus(); bus.deadline = Infinity;
  for (const s of p.segments) bus.bytes.set(s.bytes, s.address - RAM_BASE);
  const h = new Hart(bus, { resetPc: p.entry });
  bus.hart = h; h.sched = bus; h.detail = detail; // detail: lastPre/lastCost/lastCause for a stage model (full step)
  h.onUnblock = () => { h.unblockIn = true; }; // the testbench loops unblock_out to unblock_in
  if (history) h.attachHistory(history);
  for (let i = 0; i < 200_000 && bus.exit === null; i++) {
    if (h.ticks >= bus.deadline) bus.serviceDue();
    if (onStep) onStep(h);
    const pc = h.pc, t0 = h.ticks, c0 = h.cycles;
    h.step();
    if (afterStep) afterStep(h, pc, t0, c0);
  }
  return { bus, h, p };
}

