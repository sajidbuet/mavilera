// The pico2 machine of P1-M2 (research repository design pico2-p1m2-platform.md): the rational tick counter, the bus (ROM, flash,
// faults, atomic aliases, narrow writes), RESETS, the clock blocks, TIMER0, UART0, GPIO with IO_BANK0/PADS, SIO, Xh3power
// h3.block with the scheduler's sleep skip, the ROM's high-level calls, UF2 and IMAGE_DEF reading, and step back by replay.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateCounter } from '../src/arch/pico2/soc/counter.js';
import { Machine } from '../src/arch/pico2/soc/machine.js';
import { readImage, parseUf2 } from '../src/arch/pico2/boot/image.js';
import { assemble } from '../src/arch/pico2/language.js';
import { create } from '../src/arch/pico2/engine.js';
import { STOP } from '../src/arch/contract.js';
import { IRQ } from '../src/arch/pico2/core/hart.js';

const APB = { RESETS: 0x40020000, CLOCKS: 0x40010000, XOSC: 0x40048000, PLL_SYS: 0x40050000, TICKS: 0x40108000, TIMER0: 0x400b0000,
  UART0: 0x40070000, IO_BANK0: 0x40028000, PADS_BANK0: 0x40038000, WATCHDOG: 0x400d8000 };
const XOR = 0x1000, SET = 0x2000, CLR = 0x3000;
const reg = (m, block, name) => APB[block] + m[{ RESETS: 'resets', CLOCKS: 'clocks', XOSC: 'xosc', PLL_SYS: 'pllSys', TICKS: 'ticks' }[block]].r.off(name);
const engine = (text) => { const p = assemble([{ name: 't.s', text }]); assert.ok(p.ok, JSON.stringify(p.diagnostics)); return create(p); };
const runAll = (e) => { let s; do s = e.run({ chunk: 100_000 }); while (s === STOP.CHUNK); return s; };
/** Bring the clocks up as the SDK's runtime_init_clocks does: XOSC, PLL_SYS 150 MHz, clk_ref = XOSC, clk_sys = PLL, ticks 1 us. */
function clocksUp(m) {
  const b = m.bus, w = (a, v) => b.write32(a >>> 0, v >>> 0);
  w(APB.RESETS + CLR, (1 << 14) | (1 << 23) | (1 << 26) | (1 << 6) | (1 << 9)); // PLL_SYS, TIMER0, UART0, IO_BANK0, PADS_BANK0
  w(APB.XOSC + 0x00, 0xaa0); w(APB.XOSC + SET + 0x00, 0xfab << 12);
  assert.ok(b.read32(APB.XOSC + 0x04) & 0x80000000, 'XOSC STABLE');
  w(APB.PLL_SYS + 0x0, 1); w(APB.PLL_SYS + 0x8, 125); w(APB.PLL_SYS + 0xc, (5 << 16) | (2 << 12)); w(APB.PLL_SYS + 0x4, 0); // REFDIV 1, FBDIV 125, 5 x 2, power up
  assert.ok(b.read32(APB.PLL_SYS) & 0x80000000, 'PLL LOCK');
  w(reg(m, 'CLOCKS', 'CLK_REF_CTRL'), 2); // XOSC
  assert.equal(b.read32(reg(m, 'CLOCKS', 'CLK_REF_SELECTED')), 1 << 2);
  w(reg(m, 'CLOCKS', 'CLK_SYS_CTRL'), 1); w(reg(m, 'CLOCKS', 'CLK_SYS_DIV'), 1 << 16); // aux = pll_sys
  w(reg(m, 'CLOCKS', 'CLK_PERI_CTRL'), 1 << 11);   // clk_sys, enabled
  w(reg(m, 'TICKS', 'TIMER0_CYCLES'), 12); w(reg(m, 'TICKS', 'TIMER0_CTRL'), 1);
}

test('rate counter: exact counts at 1/150 per cycle, its inverse, and a re-based long run', () => {
  const c = new RateCounter(); c.setRate(0, 12_000_000, 150_000_000 * 12);
  assert.equal(c.value(149), 0); assert.equal(c.value(150), 1); assert.equal(c.value(150 * 1e6), 1e6);
  for (const v of [1, 7, 1000, 123456789]) { const k = c.cycleFor(0, v); assert.equal(c.value(k), v); assert.equal(c.value(k - 1), v - 1); }
  const far = 150 * 2 ** 40; assert.equal(c.value(far), 2 ** 40);
  c.setRate(far, 0, 1); assert.equal(c.value(far + 1e9), 2 ** 40, 'stopped');
});

test('bus: the ROM fixed locations, ignored ROM writes, flash and its mirror, bus faults', () => {
  const m = new Machine(), b = m.bus;
  assert.deepEqual([b.read8(0x10), b.read8(0x11), b.read8(0x12), b.read8(0x13)], [0x4d, 0x75, 0x02, 4]); // 'M' 'u' 2, A4 (RP-001 Table 464)
  assert.notEqual(b.read16(0x7dfa), 0, 'lookup_entry pointer');
  b.write32(0x10, 0); assert.equal(b.fault, false); assert.equal(b.read8(0x10), 0x4d);
  b.fbytes.set([1, 2, 3, 4], 0x100);
  assert.equal(b.read32(0x10000100), 0x04030201); assert.equal(b.read32(0x14000100), 0x04030201);
  for (const a of [0x30000000, 0xe0000000, 0x400f0000 + 0x8000 * 30]) { b.fault = false; b.read32(a >>> 0); assert.equal(b.fault, true, a.toString(16)); }
});

test('atomic aliases XOR/SET/CLR and narrow writes (replicated, or one lane at +0x4000) on a peripheral register', () => {
  const m = new Machine(), b = m.bus, s0 = APB.WATCHDOG + m.blocks.find((d) => d.name === 'WATCHDOG').r.off('SCRATCH0');
  b.write32(s0, 0x0000ff00); b.write32(s0 + SET, 0x0f); b.write32(s0 + CLR, 0xf00); b.write32(s0 + XOR, 0x1001);
  assert.equal(b.read32(s0) >>> 0, 0x0000f00f ^ 0x1001);
  b.write8(s0 + 1, 0xab); assert.equal(b.read32(s0) >>> 0, 0xabababab, 'an 8-bit write is replicated across the bus');
  b.write16(s0 + 2, 0x1234); assert.equal(b.read32(s0) >>> 0, 0x12341234);
  b.write8(s0 + 0x4000 + 2, 0x5a); assert.equal(b.read32(s0) >>> 0, 0x005a0000, 'at +0x4000 the other lanes are zero');
  assert.equal(b.read8(s0 + 2), 0x5a);
});

test('RESETS: RESET_DONE is the inverse of RESET; a block held in reset ignores writes and is reported', () => {
  const m = new Machine(), b = m.bus;
  const done = APB.RESETS + m.resets.r.off('RESET_DONE');
  assert.equal(b.read32(done) & (1 << 26), 0, 'UART0 starts in reset');
  b.write32(APB.UART0 + 0x24, 5); assert.equal(b.read32(APB.UART0 + 0x24), 0, 'ignored while held');
  assert.ok([...m.diags.values()].some((d) => d.kind === 'heldInReset'));
  b.write32(APB.RESETS + CLR, 1 << 26);
  assert.ok(b.read32(done) & (1 << 26));
  b.write32(APB.UART0 + 0x24, 5); assert.equal(b.read32(APB.UART0 + 0x24), 5);
});

test('clocks: XOSC stable, PLL lock, glitchless SELECTED; the frequencies follow the registers (150 MHz as the SDK sets up)', () => {
  const m = new Machine();
  assert.equal(m.freq.sys, 11_000_000, 'clk_sys from ROSC at reset');
  clocksUp(m);
  assert.deepEqual([m.freq.ref, m.freq.sys, m.freq.peri], [12_000_000, 150_000_000, 150_000_000]);
  assert.equal(m.bus.read32(reg(m, 'TICKS', 'TIMER0_CTRL')), 3, 'ENABLE and RUNNING');
});

test('TIMER0: a microsecond count from the ticks; an alarm fires at its time, raises IRQ 0, and the CLR alias acknowledges it', () => {
  const m = new Machine(), b = m.bus, h = m.hart;
  clocksUp(m);
  h.ticks += 150 * 1000; assert.equal(b.read32(APB.TIMER0 + 0x28), 1000, 'TIMERAWL after 1 ms');
  b.write32(APB.TIMER0 + 0x40, 1);                 // INTE alarm 0
  b.write32(APB.TIMER0 + 0x10, 1010);              // ALARM0 = now + 10 us
  assert.equal(b.read32(APB.TIMER0 + 0x20), 1, 'ARMED');
  assert.equal(m.deadline, 150 * 1010);
  h.ticks = m.deadline; m.service();
  assert.equal(b.read32(APB.TIMER0 + 0x3c), 1, 'INTR'); assert.equal(b.read32(APB.TIMER0 + 0x20), 0, 'disarmed');
  assert.equal(h.irqc.irq[0], 1);
  b.write32(APB.TIMER0 + 0x3c + CLR, 1);           // hw_clear_bits(&timer_hw->intr, 1), as timer_lowlevel does
  assert.equal(b.read32(APB.TIMER0 + 0x3c), 0); assert.equal(h.irqc.irq[0], 0);
});

test('UART0: bytes logged at the FIFO write; BUSY for one character time from the baud divisor', () => {
  const m = new Machine(), b = m.bus, h = m.hart, u = APB.UART0;
  clocksUp(m);
  b.write32(u + 0x24, 81); b.write32(u + 0x28, 24); b.write32(u + 0x2c, 0x70); b.write32(u + 0x30, 0x301); // 115200 8N1, FIFO, enabled
  b.write32(u, 0x41); b.write32(u, 0x42);
  assert.equal(m.uart[0].text(), 'AB');
  assert.ok(b.read32(u + 0x18) & 0x8, 'BUSY');
  const cyc = Math.ceil(10 * 16 * (81 + 24 / 64)); // 10 bits x 16 x divisor, clk_peri = clk_sys
  assert.equal(m.deadline, cyc);
  h.ticks = cyc; m.service(); assert.ok(b.read32(u + 0x18) & 0x8, 'second byte sending');
  h.ticks = 2 * cyc; m.service();
  assert.equal(b.read32(u + 0x18) & 0x88, 0x80, 'TXFE, not BUSY');
});

test('GPIO 25 driven by SIO: pads isolated at reset, gpio_set_function, OE and OUT through the SET registers; the state log', () => {
  const m = new Machine(), b = m.bus;
  clocksUp(m);
  const pad = APB.PADS_BANK0 + 4 + 4 * 25, ctrl = APB.IO_BANK0 + 8 * 25 + 4;
  assert.ok(b.read32(pad) & 0x100, 'ISO at reset');
  b.write32(pad + XOR, (b.read32(pad) ^ 0x40) & 0xc0); b.write32(ctrl, 5); b.write32(pad + CLR, 0x100); // as gpio_set_function(25, SIO)
  b.write32(0xd0000038, 1 << 25);                  // GPIO_OE_SET
  b.write32(0xd0000018, 1 << 25);                  // GPIO_OUT_SET
  assert.deepEqual(m.pins.log.states.map((s) => ['0', '1', 'in', 'pu', 'pd'][s]), ['0', '1']);
  assert.ok(b.read32(0xd0000004) & (1 << 25), 'GPIO_IN sees the pin');
  assert.equal((b.read32(APB.IO_BANK0 + 8 * 25) >>> 9) & 1, 1, 'STATUS OUTTOPAD');
});

test('GPIO edge interrupt: an external drive latches EDGE_HIGH, PROC0_INTS raises IRQ 21, a write of 1 to INTR clears it', () => {
  const m = new Machine(), b = m.bus;
  clocksUp(m);
  const pad = APB.PADS_BANK0 + 4 + 8, ctrl = APB.IO_BANK0 + 8 * 2 + 4;
  b.write32(pad, 0x46); b.write32(ctrl, 5);        // IE, pull-down; SIO; ISO cleared by the write
  const intr = APB.IO_BANK0 + m.io.r.off('INTR0'), inte = APB.IO_BANK0 + m.io.r.off('PROC0_INTE0'), ints = APB.IO_BANK0 + m.io.r.off('PROC0_INTS0');
  b.write32(intr, 0xf << 8); b.write32(inte + SET, 0xc << 8);
  assert.equal(m.hart.irqc.irq[21], 0);
  m.pins.drive(2, 1);
  assert.equal((b.read32(ints) >>> 8) & 0xf, 0x8); assert.equal(m.hart.irqc.irq[21], 1);
  b.write32(intr, 0x8 << 8);
  assert.equal(m.hart.irqc.irq[21], 0);
});

test('SIO: CPUID 0, spinlocks claim on read and release on write, MTIMECMP drives mip.mtip and IRQ 29', () => {
  const m = new Machine(), b = m.bus, h = m.hart;
  assert.equal(b.read32(0xd0000000), 0);
  assert.equal(b.read32(0xd0000100 + 4 * 3) >>> 0, 1 << 3); assert.equal(b.read32(0xd0000100 + 4 * 3), 0, 'already held');
  assert.equal(b.read32(0xd000005c) >>> 0, 1 << 3);
  b.write32(0xd0000100 + 4 * 3, 0); assert.equal(b.read32(0xd000005c), 0);
  b.write32(0xd00001a4, 3);                         // MTIME_CTRL: EN, FULLSPEED (clk_sys cycles)
  b.write32(0xd00001bc, 0); b.write32(0xd00001b8, 500);
  assert.equal(h.mip & (1 << IRQ.MTI), 0);
  h.ticks = m.deadline; assert.equal(h.ticks, 500); m.service();
  assert.ok(h.mip & (1 << IRQ.MTI)); assert.equal(h.irqc.irq[29], 1);
});

test('h3.block sleeps until the timer interrupt; the engine skips the sleeping cycles in one step', () => {
  const e = engine(`li t0, 0xd0000000
      li t1, 3
      sw t1, 0x1a4(t0)        # MTIME_CTRL: EN | FULLSPEED
      sw zero, 0x1bc(t0)
      li t1, 100000
      sw t1, 0x1b8(t0)        # MTIMECMP = 100000 cycles
      li t1, 0x80
      csrw mie, t1            # MTIE (mstatus.MIE stays 0: wake without a trap)
      slt x0, x0, x0          # h3.block
      li a0, 7
      ebreak\n`);
  assert.equal(runAll(e), STOP.HALT);
  const s = e.state();
  assert.equal(s.registers.x10, 7);
  assert.ok(e.machine.hart.ticks >= 100000 && s.steps < 20, `${s.steps} steps, ${e.machine.hart.ticks} cycles`);
});

test('ROM: rom_table_lookup_entry finds BOOTROM_STATE_RESET, which returns; an unmodelled ROM function stops with a message', () => {
  const e = engine(`li t1, 0x7dfa
      lhu t0, 0(t1)           # the RISC-V lookup helper (RP-001 Table 465)
      li a0, 0x5253           # 'S' | 'R' << 8: BOOTROM_STATE_RESET
      li a1, 1                # RT_FLAG_FUNC_RISCV
      jalr t0
      mv s0, a0
      li a0, 4
      jalr s0                 # state_reset(global): returns
      li t1, 0x7dfa
      lhu t0, 0(t1)
      li a0, 0x4252           # 'R' | 'B' << 8: reboot
      li a1, 1
      jalr t0
      jalr a0\n`);
  assert.equal(runAll(e), STOP.ERROR);
  assert.match(e.state().error, /ROM function reboot \('RB'/);
  assert.notEqual(e.state().registers.x8, 0);
});

test('UF2 and IMAGE_DEF: the rp2350-riscv blocks are the image (the E10 absolute block is left out); ENTRY_POINT gives pc and sp', () => {
  const block = (addr, payload, fam, n, total, flags = 0x2000) => {
    const b = new Uint8Array(512), d = new DataView(b.buffer);
    d.setUint32(0, 0x0a324655, true); d.setUint32(4, 0x9e5d5157, true); d.setUint32(8, flags, true); d.setUint32(12, addr, true);
    d.setUint32(16, 256, true); d.setUint32(20, n, true); d.setUint32(24, total, true); d.setUint32(28, fam, true); d.setUint32(508, 0x0ab16f30, true);
    b.set(payload, 32); return b;
  };
  const p = new Uint8Array(256), dv = new DataView(p.buffer);
  [0xffffded3, 0x10210142 >>> 0, 0x00000344, 0x10000036, 0x20082000, 0x000003ff, 0, 0xab123579].forEach((w, i) => dv.setUint32(0x20 + 4 * i, w >>> 0, true));
  const file = new Uint8Array(1024);
  file.set(block(0x10ffff00, new Uint8Array(256), 0xe48bff57, 0, 2, 0xa000), 0);
  file.set(block(0x10000000, p, 0xe48bff5a, 0, 1), 512);
  const img = readImage(file);
  assert.equal(img.chunks.length, 1);
  assert.deepEqual(img.entry, { pc: 0x10000036, sp: 0x20082000 });
  assert.throws(() => parseUf2(new Uint8Array(100)), /not a UF2 file/);
});

test('step back over device accesses replays from a checkpoint: SIO, the pin log and the registers return exactly', () => {
  const e = engine(`li t0, 0xd0000000
      li t1, 1
      sw t1, 0x38(t0)         # GPIO_OE_SET bit 0
      sw t1, 0x18(t0)         # GPIO_OUT_SET bit 0
      sw t1, 0x28(t0)         # GPIO_OUT_XOR bit 0
      li a0, 5
      ebreak\n`, );
  const m = e.machine;
  for (let i = 0; i < 4; i++) e.step();
  const before = { out: m.sio.gpioOut, log: m.pins.log.states.length, regs: e.state().registers };
  e.step(); e.step();
  assert.equal(m.sio.gpioOut, 0, 'after the XOR');
  assert.ok(e.back()); assert.ok(e.back());
  assert.equal(m.sio.gpioOut, before.out); assert.equal(m.pins.log.states.length, before.log);
  assert.deepEqual(e.state().registers, before.regs);
  assert.equal(e.state().steps, 4);
  assert.equal(runAll(e), STOP.HALT);
  assert.equal(e.state().registers.x10, 5);
});
