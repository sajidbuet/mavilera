// The second core of the pico2 machine (P1-M6, docs/architecture/pico2-p1m6-second-core.md; RP-001 §3.1, §3.2, §5.3): core 1's
// launch through the FIFO handshake (an assembly program doing what the SDK's multicore_launch_core1_raw does), CPUID per core, the
// two FIFOs and their flags and IRQ 25, doorbells and IRQ 26, a per-core MTIMECMP, RISCV_SOFTIRQ, h3.block/h3.unblock across the
// cores, PSM's reset of core 1, the interleaving by cycles, LR reservations, and save/load with two cores running.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/arch/pico2/language.js';
import { create } from '../src/arch/pico2/engine.js';
import { Machine } from '../src/arch/pico2/soc/machine.js';

const SIO = 0xd0000000, ST = 0x50, WR = 0x54, RD = 0x58, PSM = 0x40018000;

/** core 0 launches `core1` with the SDK's handshake, then waits for one word from core 1 and ends (ebreak) with it in a0. */
const LAUNCH = (core1) => `
        .text
_start: li      s0, 0xd0000000
        la      s2, seq
        li      s1, 0
send:   slli    t0, s1, 2
        add     t0, s2, t0
        lw      t1, 0(t0)
        bnez    t1, push
drain:  lw      t2, ${ST}(s0)
        andi    t2, t2, 1
        beqz    t2, sev
        lw      t2, ${RD}(s0)
        j       drain
sev:    slt     x0, x0, x1
push:   lw      t2, ${ST}(s0)
        andi    t2, t2, 2
        beqz    t2, push
        sw      t1, ${WR}(s0)
echo:   lw      t2, ${ST}(s0)
        andi    t2, t2, 1
        beqz    t2, echo
        lw      t2, ${RD}(s0)
        li      s1, 0
        bne     t2, t1, send
        srli    t0, t0, 0
        sub     t0, t0, s2
        srli    s1, t0, 2
        addi    s1, s1, 1
        li      t3, 6
        blt     s1, t3, send
answer: lw      t2, ${ST}(s0)
        andi    t2, t2, 1
        beqz    t2, answer
        lw      a0, ${RD}(s0)
        ebreak
${core1}
        .data
seq:    .word   0, 0, 1, 0, 0x20040000, core1
`;
// core 1: CPUID + 42 to core 0, then back to the bootrom
const ANSWER = `
core1:  li      s0, 0xd0000000
        lw      a0, 0(s0)
        addi    a0, a0, 42
c1wait: lw      t2, ${ST}(s0)
        andi    t2, t2, 2
        beqz    t2, c1wait
        sw      a0, ${WR}(s0)
        ret`;

function build(text) { const p = assemble([{ name: 't.s', text }]); assert.ok(p.ok, JSON.stringify(p.diagnostics.slice(0, 3))); return p; }
/** Run the machine (the engine's loops) to its stop. */
function runTo(e, max = 5_000_000) {
  const m = e.machine;
  let n = 0;
  while (n < max) { n += m.run(100_000); if (m.stop) break; }
  return m.stop;
}

test('launch: core 0 sends 0, 0, 1, mtvec, sp, entry with echoes; core 1 runs there, answers through the FIFO and parks on return', () => {
  const e = create(build(LAUNCH(ANSWER)));
  const m = e.machine;
  assert.equal(m.core1.parked, true);
  assert.equal(runTo(e), 'trap', 'the ebreak');
  assert.equal(m.harts[0].x[10], 43, 'CPUID 1 + 42 from core 1');
  assert.equal(m.core1.launches, 1);
  assert.equal(m.core1.parked, true, 'core 1 returned to the bootrom');
  assert.equal(m.harts[1].x[2] >>> 0, 0x20040000, 'its stack pointer as sent');
  assert.equal(m.core1On, false);
});

test('a word out of sequence restarts the handshake (each word echoed)', () => {
  const m = new Machine();
  const echoes = [];
  for (const w of [0, 7, 0, 0, 1, 0x100, 0x20040000, 0x20000000]) { m.sio.onWrite(m.sio.o.fifoWr, w, 0, w); echoes.push(m.sio.fifos[1].shift()); }
  assert.deepEqual(echoes, [0, 7, 0, 0, 1, 0x100, 0x20040000, 0x20000000]);
  assert.equal(m.core1.parked, false); assert.equal(m.harts[1].pc >>> 0, 0x20000000); assert.equal(m.harts[1].mtvec, 0x100);
});

test('FIFOs: 4 deep each way, VLD/RDY, WOF on a full write, ROE on an empty read, IRQ 25 on each core', () => {
  const m = new Machine(), s = m.sio, w = (c, off, v) => { m.hart = m.harts[c]; s.onWrite(off, v, 0, v); m.hart = m.harts[0]; };
  const r = (c, off) => { m.hart = m.harts[c]; const v = s.read(off); m.hart = m.harts[0]; return v; };
  m.core1.parked = false; // as if launched: core 0's words go to the FIFO
  for (let i = 0; i < 5; i++) w(0, s.o.fifoWr, 10 + i);
  assert.equal(r(0, s.o.fifoSt) & 0x6, 0x4, 'core 0: WOF, not RDY');
  assert.equal(r(1, s.o.fifoSt) & 1, 1, 'core 1: VLD');
  assert.equal(m.harts[1].irqc.irq[25], 1); assert.equal(m.harts[0].irqc.irq[25], 1, 'core 0: its WOF');
  assert.deepEqual([r(1, s.o.fifoRd), r(1, s.o.fifoRd), r(1, s.o.fifoRd), r(1, s.o.fifoRd)], [10, 11, 12, 13]);
  assert.equal(m.harts[1].irqc.irq[25], 0);
  assert.equal(r(1, s.o.fifoRd), 0); assert.equal(r(1, s.o.fifoSt) & 0x8, 0x8, 'ROE'); assert.equal(m.harts[1].irqc.irq[25], 1);
  w(1, s.o.fifoSt, 0); assert.equal(m.harts[1].irqc.irq[25], 0, 'cleared by a write');
});

test('doorbells: OUT on one core sets IN of the other (IRQ 26 there); CPUID per core; MTIMECMP per core; RISCV_SOFTIRQ per core', () => {
  const m = new Machine(), s = m.sio, as = (c, f) => { m.hart = m.harts[c]; const v = f(); m.hart = m.harts[0]; return v; };
  as(0, () => s.onWrite(s.o.outSetBell, 0x05, 0, 0x05));
  assert.equal(as(1, () => s.readReg(s.o.inSetBell)), 5); assert.equal(m.harts[1].irqc.irq[26], 1); assert.equal(m.harts[0].irqc.irq[26], 0);
  as(1, () => s.onWrite(s.o.inClrBell, 0x05, 0, 0x05)); assert.equal(m.harts[1].irqc.irq[26], 0);
  assert.deepEqual([as(0, () => s.readReg(s.o.cpuid)), as(1, () => s.readReg(s.o.cpuid))], [0, 1]);
  as(1, () => { s.onWrite(s.o.cmph, 0, 0, 0); s.onWrite(s.o.cmp, 0, 0, 0); });
  assert.equal(m.harts[1].mip & 0x80, 0x80, 'core 1 MTIP'); assert.equal(m.harts[0].mip & 0x80, 0, 'core 0 not');
  assert.equal(m.harts[1].irqc.irq[29], 1); assert.equal(m.harts[0].irqc.irq[29], 0);
  as(0, () => s.onWrite(s.o.softirq, 0x2, 0, 0x2)); assert.equal(m.harts[1].mip & 0x8, 0x8); assert.equal(m.harts[0].mip & 0x8, 0);
  as(0, () => s.onWrite(s.o.softirq, 0x202, 0, 0x202)); assert.equal(m.harts[1].mip & 0x8, 0x8, 'a set wins over a clear');
  as(0, () => s.onWrite(s.o.softirq, 0x200, 0, 0x200)); assert.equal(m.harts[1].mip & 0x8, 0);
});

test('h3.block on core 1 sleeps until core 0 executes h3.unblock; the sleeping core idles along; cycles stay within an instruction', () => {
  const CORE1 = `
core1:  li      s0, 0xd0000000
        slt     x0, x0, x0
        li      a0, 77
c1w:    lw      t2, ${ST}(s0)
        andi    t2, t2, 2
        beqz    t2, c1w
        sw      a0, ${WR}(s0)
c1end:  j       c1end`;
  // core 0: after the launch, spin 200 times, then unblock core 1 and wait for its word
  const text = LAUNCH(CORE1).replace('answer: lw      t2, ', `        li      t4, 200
spin:   addi    t4, t4, -1
        bnez    t4, spin
        slt     x0, x0, x1
answer: lw      t2, `);
  const e = create(build(text));
  const m = e.machine;
  let saw = false;
  for (let k = 0; k < 2000 && !m.stop; k++) { m.run(1); if (m.core1On && m.harts[1].sleeping) saw = true; }
  assert.ok(saw, 'core 1 slept in h3.block');
  assert.equal(m.harts[0].x[10], 77);
  assert.ok(Math.abs(m.harts[0].ticks - m.harts[1].ticks) < 40, `${m.harts[0].ticks} vs ${m.harts[1].ticks}`);
});

test('PSM FRCE_OFF.PROC1: core 1 held off and parked; released, it drains its FIFO and sends core 0 a 0', () => {
  const m = new Machine(), b = m.bus;
  b.write32(PSM + 0x2000 + 4, 1 << 24); // FRCE_OFF set alias
  assert.equal(m.core1.off, true); assert.equal(b.read32(PSM + 0xc) & (1 << 24), 0, 'DONE.PROC1 low');
  b.write32(PSM + 0x3000 + 4, 1 << 24);
  assert.equal(m.core1.off, false); assert.deepEqual(m.sio.fifos[1], [0]);
});

test('an LR reservation of one core is lost when the other changes the word; save/load in the middle of a two-core run repeats it exactly', () => {
  const CORE1 = `
core1:  li      s0, 0xd0000000
        la      t0, word
c1loop: lw      t1, 0(t0)
        addi    t1, t1, 1
        sw      t1, 0(t0)
        j       c1loop
        .data
word:   .word   0
        .text`;
  const text = LAUNCH(CORE1).replace('answer: lw      t2, ', `        la      t5, word
retry:  lr.w    t1, (t5)
        addi    t1, t1, 1000
        li      t4, 50
dly:    addi    t4, t4, -1
        bnez    t4, dly
        sc.w    t6, t1, (t5)
        bnez    t6, failed
        j       retry
failed: li      a0, 1
        ebreak
answer: lw      t2, `);
  const e = create(build(text));
  assert.equal(runTo(e), 'trap');
  assert.equal(e.machine.harts[0].x[10], 1, 'core 0 saw its sc.w fail');
  // determinism with two cores: a snapshot taken mid-run and restored reaches the same state
  const e2 = create(build(LAUNCH(CORE1)));
  for (let k = 0; k < 40; k++) e2.machine.run(50);
  assert.equal(e2.machine.core1On, true);
  const snap = e2.machine.save();
  e2.machine.run(5000); const h1 = e2.stateHash();
  e2.machine.load(snap); e2.machine.run(5000);
  assert.equal(e2.stateHash(), h1);
});

test('engine: Step is one instruction of core 0 with core 1 alongside; Back after core 1 has run replays; a breakpoint in core 1\'s code stops Run', async () => {
  const { STOP } = await import('../src/arch/contract.js');
  const CORE1 = `
core1:  li      s0, 0xd0000000
        li      t3, 0
c1loop: addi    t3, t3, 1
        j       c1loop`;
  const text = LAUNCH(CORE1).replace('answer: lw      t2, ', `        li      t4, 0
c0loop: addi    t4, t4, 1
        j       c0loop
answer: lw      t2, `);
  const p = build(text);
  const e = create(p);
  // run until both cores run
  let s; do s = e.run({ chunk: 50, resumed: true }); while (s === STOP.CHUNK && !e.machine.core1On);
  assert.equal(e.machine.core1On, true);
  for (let k = 0; k < 20; k++) e.step();
  const pc0 = e.state().pc, c1 = e.state().registers.c1x28;
  e.step();
  assert.notEqual(e.state().pc, pc0, 'core 0 moved one instruction');
  const regs = e.state().registers;
  assert.ok(regs.c1pc >= 0x20000000, 'core 1 has a pc in SRAM');
  const before = e.stateHash(), x29 = regs.x29;
  e.step(); e.step(); e.back(); e.back();
  assert.equal(e.stateHash(), before, 'two steps back reach the same state (replay)');
  assert.equal(e.state().registers.x29, x29);
  assert.ok(e.state().registers.c1x28 >= c1);
  // a breakpoint at core 1's loop stops a run
  const c1loop = p.symbols?.c1loop ?? p.labels?.c1loop ?? null;
  if (c1loop !== null) {
    const st = e.run({ chunk: 100_000, breakpoints: new Set([c1loop >>> 0]), resumed: true });
    assert.equal(st, STOP.BREAK);
  }
  // Engine.advance with two cores keeps time: about the cycles asked for
  const t0 = e.clock().cycle;
  e.advance({ cycles: 10_000 });
  assert.ok(Math.abs(e.clock().cycle - t0 - 10_000) < 50, `${e.clock().cycle - t0}`);
  const cnt = Object.fromEntries(e.counters());
  assert.equal(cnt['Core 1'], 'running');
});