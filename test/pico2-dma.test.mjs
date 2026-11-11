// The DMA of the pico2 machine (P1-M5, research decision D39 Q1-Q2; RP-001 §12.6): one transfer per cycle, the register aliases
// and triggers, null triggers, CHAIN_TO, rings, increments, BSWAP, MODE (TRIGGER_SELF, ENDLESS), the pacing timers, PWM and UART
// DREQs, round robin and HIGH_PRIORITY, the sniffer against reference CRCs, bus errors, CHAN_ABORT (RP2350-E5) and the
// zero-length CHAIN_TO of RP2350-E8, the interrupts.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../src/arch/pico2/soc/machine.js';

const DMA = 0x50000000, RESETS = 0x40020000, PWM = 0x400a8000, UART0 = 0x40070000, SET = 0x2000, CLR = 0x3000;
const SRAM = 0x20000000;
const READ = 0, WRITE = 4, COUNT = 8, CTRL_TRIG = 0xc, AL1_CTRL = 0x10, AL1_COUNT_TRIG = 0x1c, AL3_READ_TRIG = 0x3c;
const INTR = 0x400, INTE0 = 0x404, INTS0 = 0x40c, TIMER0 = 0x440, MULTI = 0x450, SNIFF_CTRL = 0x454, SNIFF_DATA = 0x458, ABORT = 0x464;
const ch = (i, r) => DMA + 0x40 * i + r;
const EN = 1, HIGH = 2, SIZE8 = 0 << 2, SIZE16 = 1 << 2, SIZE32 = 2 << 2, INCR_R = 1 << 4, REV_R = 1 << 5, INCR_W = 1 << 6, REV_W = 1 << 7;
const ringW = (n) => (n << 8) | (1 << 12), chain = (n) => n << 13, treq = (n) => n << 17, QUIET = 1 << 23, BSWAP = 1 << 24, SNIFF = 1 << 25, BUSY = 1 << 26;
const ctl = (i, bits) => bits | chain(i) | (bits & (0x3f << 17) ? 0 : treq(63)); // CHAIN_TO = itself (no chain), unpaced unless given

function machine() { const m = new Machine(); m.bus.write32(RESETS + CLR, (1 << 2) | (1 << 16) | (1 << 26) | (1 << 6) | (1 << 9)); return m; }
const w = (m, a, v) => m.bus.write32(a >>> 0, v >>> 0);
const r = (m, a) => m.bus.read32(a >>> 0) >>> 0;
function to(m, c) { m.hart.ticks = c; if (c >= m.deadline) m.serviceDue(); }
const words = (m, a, n) => Array.from({ length: n }, (_, i) => r(m, a + 4 * i));
const fill = (m, a, list) => list.forEach((v, i) => w(m, a + 4 * i, v));

test('memory to memory, 32-bit, unpaced: one transfer per cycle from the cycle after the trigger; BUSY; IRQ 10', () => {
  const m = machine(), src = SRAM + 0x1000, dst = SRAM + 0x2000;
  fill(m, src, [1, 2, 3, 4, 5, 6, 7, 8]);
  w(m, DMA + INTE0, 1 << 3);
  w(m, ch(3, READ), src); w(m, ch(3, WRITE), dst); w(m, ch(3, COUNT), 8);
  const t0 = m.hart.ticks;
  w(m, ch(3, CTRL_TRIG), ctl(3, EN | SIZE32 | INCR_R | INCR_W));
  assert.ok(r(m, ch(3, CTRL_TRIG)) & BUSY);
  to(m, t0 + 4); assert.equal(r(m, ch(3, COUNT)), 4, 'four transfers by the 4th cycle'); assert.deepEqual(words(m, dst, 5), [1, 2, 3, 4, 0]);
  to(m, t0 + 8); assert.equal(r(m, ch(3, CTRL_TRIG)) & BUSY, 0); assert.deepEqual(words(m, dst, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(r(m, ch(3, READ)), src + 32); assert.equal(m.hart.irqc.irq[10], 1); assert.equal(r(m, DMA + INTS0), 1 << 3);
  w(m, DMA + INTS0, 1 << 3); assert.equal(m.hart.irqc.irq[10], 0); assert.equal(r(m, DMA + INTR), 0);
  // the reload value is kept: MULTI_CHAN_TRIGGER repeats 8 transfers from where the addresses are now
  fill(m, src + 32, [9, 10, 11, 12, 13, 14, 15, 16]);
  w(m, DMA + MULTI, 1 << 3); to(m, m.hart.ticks + 10);
  assert.deepEqual(words(m, dst + 32, 8), [9, 10, 11, 12, 13, 14, 15, 16]);
});

test('aliases: AL1 TRANS_COUNT_TRIG and AL3 READ_ADDR_TRIG start the channel; a null trigger raises the IRQ only with IRQ_QUIET', () => {
  const m = machine(), src = SRAM + 0x100, dst = SRAM + 0x200;
  fill(m, src, [0xa, 0xb, 0xc, 0xd]);
  w(m, ch(0, READ), src); w(m, ch(0, WRITE), dst);
  w(m, ch(0, AL1_CTRL), ctl(0, EN | SIZE32 | INCR_R | INCR_W)); assert.equal(r(m, ch(0, CTRL_TRIG)) & BUSY, 0, 'AL1_CTRL does not trigger');
  w(m, ch(0, AL1_COUNT_TRIG), 2); to(m, m.hart.ticks + 5); assert.deepEqual(words(m, dst, 3), [0xa, 0xb, 0]);
  w(m, ch(0, AL3_READ_TRIG), src + 8); to(m, m.hart.ticks + 5); assert.deepEqual(words(m, dst, 4), [0xa, 0xb, 0xc, 0xd]);
  w(m, DMA + INTR, 0xffff);
  w(m, ch(0, AL3_READ_TRIG), 0); assert.equal(r(m, DMA + INTR), 0, 'null trigger without IRQ_QUIET');
  w(m, ch(0, AL1_CTRL), ctl(0, EN | SIZE32 | QUIET)); w(m, ch(0, AL3_READ_TRIG), 0); assert.equal(r(m, DMA + INTR), 1, 'null trigger with IRQ_QUIET');
});

test('CHAIN_TO: the chained channel starts the cycle after the last write; a channel ignores triggers while busy or disabled', () => {
  const m = machine(), a = SRAM + 0x400, b = SRAM + 0x500;
  fill(m, a, [1, 2, 3]); fill(m, b, [4, 5, 6]);
  w(m, ch(1, READ), b); w(m, ch(1, WRITE), SRAM + 0x600); w(m, ch(1, COUNT), 3); w(m, ch(1, AL1_CTRL), ctl(1, EN | SIZE32 | INCR_R | INCR_W));
  w(m, ch(0, READ), a); w(m, ch(0, WRITE), SRAM + 0x700); w(m, ch(0, COUNT), 3);
  const t0 = m.hart.ticks;
  w(m, ch(0, CTRL_TRIG), EN | SIZE32 | INCR_R | INCR_W | chain(1) | treq(63));
  to(m, t0 + 3); assert.ok(r(m, ch(1, CTRL_TRIG)) & BUSY, 'chained at the last write'); assert.equal(r(m, ch(1, COUNT)), 3);
  to(m, t0 + 6); assert.deepEqual(words(m, SRAM + 0x600, 3), [4, 5, 6]);
  w(m, ch(2, AL1_CTRL), ctl(2, SIZE32)); w(m, ch(2, AL1_COUNT_TRIG), 5); assert.equal(r(m, ch(2, CTRL_TRIG)) & BUSY, 0, 'disabled: ignored');
});

test('rings, decrement, increment by two, byte and halfword transfers, BSWAP', () => {
  const m = machine(), src = SRAM + 0x800, dst = SRAM + 0x900;
  fill(m, src, [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00]);
  w(m, ch(0, READ), src); w(m, ch(0, WRITE), dst); w(m, ch(0, COUNT), 4);
  w(m, ch(0, CTRL_TRIG), ctl(0, EN | SIZE32 | INCR_R | INCR_W | ringW(3))); to(m, m.hart.ticks + 6);
  assert.deepEqual(words(m, dst, 3), [0x99aabbcc, 0xddeeff00, 0], 'an 8-byte ring on the write address');
  w(m, ch(0, READ), src + 12); w(m, ch(0, WRITE), dst + 0x40); w(m, ch(0, COUNT), 4);
  w(m, ch(0, CTRL_TRIG), ctl(0, EN | SIZE32 | INCR_R | REV_R | INCR_W)); to(m, m.hart.ticks + 6);
  assert.deepEqual(words(m, dst + 0x40, 4), [0xddeeff00, 0x99aabbcc, 0x55667788, 0x11223344], 'read address decrements');
  w(m, ch(0, READ), src); w(m, ch(0, WRITE), dst + 0x80); w(m, ch(0, COUNT), 2);
  w(m, ch(0, CTRL_TRIG), ctl(0, EN | SIZE32 | REV_R | INCR_W)); to(m, m.hart.ticks + 6);
  assert.deepEqual(words(m, dst + 0x80, 2), [0x11223344, 0x99aabbcc], 'REV without INCR: by two transfers');
  w(m, ch(0, READ), src); w(m, ch(0, WRITE), dst + 0xc0); w(m, ch(0, COUNT), 2);
  w(m, ch(0, CTRL_TRIG), ctl(0, EN | SIZE32 | INCR_R | INCR_W | BSWAP)); to(m, m.hart.ticks + 6);
  assert.deepEqual(words(m, dst + 0xc0, 2), [0x44332211, 0x88776655]);
  w(m, ch(0, READ), src); w(m, ch(0, WRITE), dst + 0x100); w(m, ch(0, COUNT), 3);
  w(m, ch(0, CTRL_TRIG), ctl(0, EN | SIZE16 | INCR_R | INCR_W | BSWAP)); to(m, m.hart.ticks + 6);
  assert.deepEqual(words(m, dst + 0x100, 2), [0x22114433, 0x00008877]);
  w(m, ch(0, READ), src); w(m, ch(0, WRITE), dst + 0x140); w(m, ch(0, COUNT), 3);
  w(m, ch(0, CTRL_TRIG), ctl(0, EN | SIZE8 | INCR_R | INCR_W)); to(m, m.hart.ticks + 6);
  assert.equal(r(m, dst + 0x140), 0x00223344);
});

test('MODE: TRIGGER_SELF restarts with the reload count and raises the IRQ each time; ENDLESS never counts down', () => {
  const m = machine(), src = SRAM + 0xa00;
  fill(m, src, [7, 8]);
  w(m, ch(5, READ), src); w(m, ch(5, WRITE), SRAM + 0xb00); w(m, ch(5, COUNT), (1 << 28) | 2);
  w(m, ch(5, CTRL_TRIG), ctl(5, EN | SIZE32 | INCR_R | INCR_W | (3 << 8))); // a read ring of 8 bytes
  to(m, m.hart.ticks + 20);
  assert.ok(r(m, ch(5, CTRL_TRIG)) & BUSY, 'still running'); assert.ok(r(m, DMA + INTR) & (1 << 5));
  assert.deepEqual(words(m, SRAM + 0xb00, 4), [7, 8, 7, 8]);
  w(m, ch(5, CTRL_TRIG) + CLR, EN); w(m, DMA + ABORT, 1 << 5);
  w(m, ch(6, READ), src); w(m, ch(6, WRITE), SRAM + 0xc00); w(m, ch(6, COUNT), (0xf << 28) | 1);
  w(m, ch(6, CTRL_TRIG), ctl(6, EN | SIZE32)); to(m, m.hart.ticks + 50);
  assert.ok(r(m, ch(6, CTRL_TRIG)) & BUSY); assert.equal(r(m, ch(6, COUNT)) & 0x0fffffff, 1);
});

test('pacing timer X/Y = 1/10: one transfer every 10 cycles', () => {
  const m = machine(), src = SRAM + 0xd00;
  fill(m, src, [1, 2, 3, 4, 5]);
  w(m, DMA + TIMER0, (1 << 16) | 10);
  w(m, ch(2, READ), src); w(m, ch(2, WRITE), SRAM + 0xe00); w(m, ch(2, COUNT), 5);
  const t0 = m.hart.ticks;
  w(m, ch(2, CTRL_TRIG), EN | SIZE32 | INCR_R | INCR_W | chain(2) | treq(59));
  to(m, t0 + 25); const left = r(m, ch(2, COUNT));
  assert.ok(left === 3 || left === 2, `two or three transfers in 25 cycles (${left} left)`);
  to(m, t0 + 60); assert.equal(r(m, ch(2, COUNT)), 0); assert.deepEqual(words(m, SRAM + 0xe00, 5), [1, 2, 3, 4, 5]);
});

test('PWM DREQ: a slice wrapping every 100 cycles paces a channel that writes its CC (the double-buffered value each period)', () => {
  const m = machine(), table = SRAM + 0xf00;
  fill(m, table, [10, 20, 30, 40]);
  m.bus.write32(0x40038000 + 4, 0x50); m.bus.write32(0x40028000 + 4, 4); // GPIO0: pad on, function PWM
  w(m, PWM + 0x10, 99); // slice 0 TOP
  w(m, ch(4, READ), table); w(m, ch(4, WRITE), PWM + 0xc); w(m, ch(4, COUNT), 4);
  w(m, ch(4, CTRL_TRIG), EN | SIZE32 | INCR_R | chain(4) | treq(32));
  const t0 = m.hart.ticks;
  w(m, PWM, 1);
  to(m, t0 + 99); assert.equal(r(m, ch(4, COUNT)), 4, 'no wrap yet');
  to(m, t0 + 101); assert.equal(r(m, ch(4, COUNT)), 3); assert.equal(r(m, PWM + 0xc), 10);
  to(m, t0 + 450); assert.equal(r(m, ch(4, COUNT)), 0);
  const l = m.pins.log, falls = [];
  for (let i = 0; i < l.cycles.length; i++) if (l.pins[i] === 0 && l.states[i] === 0 && l.cycles[i] > t0) falls.push(l.cycles[i] - t0);
  assert.deepEqual(falls.slice(0, 3), [210, 320, 430], 'CC 10, 20, 30 from the 2nd, 3rd, 4th periods');
});

test('UART TX DREQ: bytes go to UARTDR only while the TX FIFO has room, in order, without overflow', () => {
  const m = machine(), src = SRAM + 0x1100, text = 'DMA to the UART, paced by DREQ 28.';
  for (let i = 0; i < text.length; i++) m.bus.write8(src + i, text.charCodeAt(i));
  // UART0: clk_peri from clk_sys (the reset ROSC), 115200-ish divisor, FIFOs on, TX enabled, TXDMAE
  m.bus.write32(0x40010000 + m.clocks.r.off('CLK_PERI_CTRL'), 1 << 11);
  w(m, UART0 + 0x24, 6); w(m, UART0 + 0x28, 0); w(m, UART0 + 0x2c, 0x70); w(m, UART0 + 0x30, 0x101); w(m, UART0 + 0x48, 2);
  w(m, ch(7, READ), src); w(m, ch(7, WRITE), UART0); w(m, ch(7, COUNT), text.length);
  w(m, ch(7, CTRL_TRIG), EN | SIZE8 | INCR_R | chain(7) | treq(28));
  to(m, m.hart.ticks + 200); assert.equal(m.uart[0].text().length, 33, 'the FIFO fills (32 and one in the shift register) and the channel waits');
  to(m, m.hart.ticks + 2_000_000); assert.equal(m.uart[0].text(), text); assert.equal([...m.diags.keys()].some((k) => k.startsWith('uartOverflow')), false);
});

test('arbitration: two unpaced channels alternate; a HIGH_PRIORITY pair goes before one low-priority transfer per round', () => {
  const m = machine();
  for (const [i, extra] of [[0, 0], [1, 0]]) { w(m, ch(i, READ), SRAM + 0x1200); w(m, ch(i, WRITE), SRAM + 0x1300 + 0x40 * i); w(m, ch(i, COUNT), 4); w(m, ch(i, AL1_CTRL), ctl(i, EN | SIZE32 | INCR_W | extra)); }
  const t0 = m.hart.ticks;
  w(m, DMA + MULTI, 3); to(m, t0 + 4);
  assert.equal(r(m, ch(0, COUNT)) + r(m, ch(1, COUNT)), 4); assert.equal(r(m, ch(0, COUNT)), 2);
  to(m, t0 + 20);
  const m2 = machine();
  for (const [i, extra] of [[0, HIGH], [1, HIGH], [2, 0]]) { w(m2, ch(i, READ), SRAM); w(m2, ch(i, WRITE), SRAM + 0x1400 + 0x40 * i); w(m2, ch(i, COUNT), 6); w(m2, ch(i, AL1_CTRL), ctl(i, EN | SIZE32 | INCR_W | extra)); }
  const t1 = m2.hart.ticks;
  w(m2, DMA + MULTI, 7); to(m2, t1 + 6);
  assert.deepEqual([0, 1, 2].map((i) => 6 - r(m2, ch(i, COUNT))), [2, 2, 2], 'H H L H H L');
});

test('sniffer: CRC-32 (reversed data, reversed and inverted out) of "123456789" is 0xcbf43926; CRC-32/MPEG-2 0x0376e6e7; CRC-16-CCITT 0x29b1; sum; parity', () => {
  const m = machine(), src = SRAM + 0x1500, s = '123456789';
  for (let i = 0; i < s.length; i++) m.bus.write8(src + i, s.charCodeAt(i));
  const run = (calc, out, seed) => {
    w(m, DMA + SNIFF_DATA, seed); w(m, DMA + SNIFF_CTRL, 1 | (9 << 1) | (calc << 5) | out);
    w(m, ch(9, READ), src); w(m, ch(9, WRITE), SRAM + 0x1600); w(m, ch(9, COUNT), 9);
    w(m, ch(9, CTRL_TRIG), ctl(9, EN | SIZE8 | INCR_R | SNIFF)); to(m, m.hart.ticks + 12);
    return r(m, DMA + SNIFF_DATA);
  };
  assert.equal(run(1, (1 << 10) | (1 << 11), 0xffffffff), 0xcbf43926);
  assert.equal(run(0, 0, 0xffffffff), 0x0376e6e7);
  assert.equal(run(2, 0, 0xffff) & 0xffff, 0x29b1);
  assert.equal(run(15, 0, 0), [...s].reduce((a, ch) => a + ch.charCodeAt(0), 0));
  assert.equal(run(14, 0, 0) & 1, [...s].reduce((a, ch) => a ^ ch.charCodeAt(0), 0).toString(2).split('').filter((b) => b === '1').length & 1);
});

test('bus errors: a read from SIO halts the channel with READ_ERROR, raises its IRQ, does not chain; restarts only after the flag is cleared', () => {
  const m = machine();
  w(m, ch(0, READ), 0xd0000000); w(m, ch(0, WRITE), SRAM); w(m, ch(0, COUNT), 3);
  w(m, ch(0, CTRL_TRIG), EN | SIZE32 | chain(1) | treq(63));
  w(m, ch(1, AL1_CTRL), ctl(1, EN | SIZE32)); w(m, ch(1, COUNT), 1);
  to(m, m.hart.ticks + 5);
  const c = r(m, ch(0, CTRL_TRIG));
  assert.ok(c & (1 << 30)); assert.ok(c & 0x80000000); assert.equal(c & BUSY, 0); assert.ok(r(m, DMA + INTR) & 1); assert.equal(r(m, ch(1, CTRL_TRIG)) & BUSY, 0);
  w(m, DMA + MULTI, 1); assert.equal(r(m, ch(0, CTRL_TRIG)) & BUSY, 0, 'refuses to restart');
  w(m, ch(0, AL1_CTRL), (r(m, ch(0, CTRL_TRIG)) & 0x03ffffff) | (1 << 30)); assert.equal(r(m, ch(0, CTRL_TRIG)) & (1 << 30), 0);
});

test('CHAN_ABORT stops a channel; RP2350-E5: it chains if it wrote last; RP2350-E8: a zero-length sequence chains only if it wrote last', () => {
  const m = machine();
  w(m, DMA + TIMER0, (1 << 16) | 100);
  w(m, ch(0, READ), SRAM); w(m, ch(0, WRITE), SRAM + 0x100); w(m, ch(0, COUNT), 50);
  w(m, ch(0, CTRL_TRIG), EN | SIZE32 | chain(1) | treq(59));
  w(m, ch(1, AL1_CTRL), ctl(1, EN | SIZE32)); w(m, ch(1, READ), SRAM); w(m, ch(1, WRITE), SRAM + 0x200); w(m, ch(1, COUNT), 1);
  to(m, m.hart.ticks + 250);
  w(m, DMA + ABORT, 1); assert.equal(r(m, ch(0, CTRL_TRIG)) & BUSY, 0); assert.equal(r(m, DMA + ABORT), 0);
  to(m, m.hart.ticks + 1);
  assert.ok(r(m, ch(1, CTRL_TRIG)) & BUSY || r(m, ch(1, COUNT)) === 0, 'E5: chained (channel 0 wrote last)');
  to(m, m.hart.ticks + 5);
  // E8: channel 2 with a count of 0 chains to 3 only if 2 was the last channel to write; channel 1 wrote last
  w(m, ch(3, AL1_CTRL), ctl(3, EN | SIZE32)); w(m, ch(3, COUNT), 1); w(m, ch(3, READ), SRAM); w(m, ch(3, WRITE), SRAM + 0x300);
  w(m, ch(2, COUNT), 0); w(m, ch(2, CTRL_TRIG), EN | SIZE32 | chain(3) | treq(63));
  to(m, m.hart.ticks + 5);
  assert.equal(r(m, ch(2, CTRL_TRIG)) & BUSY, 0); assert.ok(r(m, DMA + INTR) & 4, 'completion IRQ'); assert.equal(r(m, DMA + INTR) & 8, 0, 'no chain'); assert.equal(r(m, ch(3, CTRL_TRIG)) & BUSY, 0);
});
