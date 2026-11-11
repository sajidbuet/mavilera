// The PWM block of the pico2 machine (P1-M5, research decision D39; RP-001 §12.5): periods from TOP, PH_CORRECT and the
// fractional divider, edges at their exact cycles on the pins, double-buffered TOP/CC, 0 % and 100 %, inversion, the global
// EN alias, the two wrap IRQs, the B-input modes (gated, rising, falling edges), PH_ADV/PH_RET and the CTR register.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../src/arch/pico2/soc/machine.js';

const PWM = 0x400a8000, RESETS = 0x40020000, IO = 0x40028000, PADS = 0x40038000, SET = 0x2000, CLR = 0x3000;
const CSR = 0, DIV = 4, CTR = 8, CC = 0xc, TOP = 0x10, EN = 0xf0, INTR = 0xf4, INTE0 = 0xf8, INTS0 = 0x100, INTE1 = 0x104, INTS1 = 0x10c;
const sl = (i, r) => PWM + 0x14 * i + r;

/** A machine with PWM, IO_BANK0 and PADS out of reset, at cycle 0 of an idle hart (time moves by `to`). */
function machine() {
  const m = new Machine(), b = m.bus;
  b.write32(RESETS + CLR, (1 << 16) | (1 << 6) | (1 << 9) | (1 << 2));
  return m;
}
const w = (m, a, v) => m.bus.write32(a >>> 0, v >>> 0);
const r = (m, a) => m.bus.read32(a >>> 0) >>> 0;
/** Move the machine's time to cycle c, running the events due on the way (each at its own cycle). */
function to(m, c) { m.hart.ticks = c; if (c >= m.deadline) m.serviceDue(); }
/** GPIO n to function f with its pad out of isolation and the input on. */
function pin(m, n, f = 4) { w(m, PADS + 4 + 4 * n, 0x40 | 0x10); w(m, IO + 8 * n + 4, f); }
/** The logged edges of pin n as [cycle, level] from cycle `from`. */
function edges(m, n, from = 0) {
  const l = m.pins.log, out = [];
  for (let i = 0; i < l.cycles.length; i++) if (l.pins[i] === n && l.cycles[i] >= from && l.states[i] <= 1) out.push([l.cycles[i], l.states[i]]);
  return out;
}

test('hello_pwm: TOP 3, A = 1, B = 3 at divider 1: A high 1 cycle in 4, B 3 in 4, rising edges aligned (RP-001 Fig. 117)', () => {
  const m = machine();
  pin(m, 0); pin(m, 1);
  w(m, sl(0, TOP), 3); w(m, sl(0, CC), (3 << 16) | 1); w(m, sl(0, CSR), 1);
  const t0 = m.hart.ticks;
  to(m, t0 + 40);
  const a = edges(m, 0, t0 + 1), bb = edges(m, 1, t0 + 1);
  assert.deepEqual(a.slice(0, 4), [[t0 + 1, 0], [t0 + 4, 1], [t0 + 5, 0], [t0 + 8, 1]]);
  assert.deepEqual(bb.slice(0, 4), [[t0 + 3, 0], [t0 + 4, 1], [t0 + 7, 0], [t0 + 8, 1]]);
});

test('period = (TOP + 1) x (PH_CORRECT + 1) x (DIV_INT + DIV_FRAC/16): divider 1, 2.5 and 256 (DIV_INT 0)', () => {
  for (const [div, d] of [[0x10, 1], [0x28, 2.5], [0x00, 256]]) {
    const m = machine();
    pin(m, 2);
    w(m, sl(1, TOP), 9); w(m, sl(1, CC), 5); w(m, sl(1, DIV), div); w(m, sl(1, CSR), 1);
    const t0 = m.hart.ticks, period = 10 * d;
    to(m, t0 + 20 * period + 1);
    const rises = edges(m, 2, t0 + 1).filter((e) => e[1] === 1).map((e) => e[0]);
    assert.ok(rises.length >= 18, `div ${d}`);
    for (let k = 1; k < rises.length; k++) assert.ok(Math.abs(rises[k] - rises[k - 1] - period) <= 1, `div ${d}: ${rises[k] - rises[k - 1]}`);
    assert.equal(rises[rises.length - 1] - rises[0], period * (rises.length - 1), `div ${d}: the fractional divider averages exactly`);
  }
});

test('phase-correct: 0..TOP..0 with two counts at TOP and at 0; the pulse is centred on the wrap; period doubles', () => {
  const m = machine();
  pin(m, 4);
  w(m, sl(2, TOP), 3); w(m, sl(2, CC), 1); w(m, sl(2, CSR), 1 | 2);
  const t0 = m.hart.ticks;
  to(m, t0 + 40);
  // counts 0 1 2 3 3 2 1 0 | 0 ...: high while the count is below 1, i.e. at the 0 0 pair around each wrap
  const e = edges(m, 4, t0 + 1);
  assert.deepEqual(e.slice(0, 4), [[t0 + 1, 0], [t0 + 7, 1], [t0 + 9, 0], [t0 + 15, 1]]);
});

test('double buffering: a CC write mid-period applies from the next wrap; 0 % and 100 % have no edges; A_INV inverts', () => {
  const m = machine();
  pin(m, 6);
  w(m, sl(3, TOP), 99); w(m, sl(3, CC), 50); w(m, sl(3, CSR), 1);
  const t0 = m.hart.ticks;
  to(m, t0 + 10); w(m, sl(3, CC), 20);
  to(m, t0 + 250);
  const e = edges(m, 6, t0 + 1);
  assert.deepEqual(e.slice(0, 4), [[t0 + 50, 0], [t0 + 100, 1], [t0 + 120, 0], [t0 + 200, 1]]);
  for (const [cc, level] of [[0, 0], [100, 1], [5000, 1]]) {
    w(m, sl(3, CC), cc); const t1 = m.hart.ticks; to(m, t1 + 400);
    const after = edges(m, 6, t1 + 200);
    assert.equal(after.length, 0, `CC ${cc}: no toggling`); assert.equal(m.pins.level[6], level, `CC ${cc}`);
  }
  w(m, sl(3, CC), 0); w(m, sl(3, CSR), 1 | 4); to(m, m.hart.ticks + 300);
  assert.equal(m.pins.level[6], 1, 'A_INV of 0 %');
});

test('EN at 0x0f0 aliases every CSR.EN; a disabled slice holds its count; CTR reads and writes the count', () => {
  const m = machine();
  w(m, sl(4, TOP), 999); w(m, sl(5, TOP), 999);
  w(m, PWM + EN, (1 << 4) | (1 << 5));
  assert.equal(r(m, sl(4, CSR)) & 1, 1); assert.equal(r(m, PWM + EN), 0x30);
  const t0 = m.hart.ticks;
  to(m, t0 + 123);
  assert.equal(r(m, sl(4, CTR)), 123); assert.equal(r(m, sl(5, CTR)), 123, 'started together: lockstep');
  w(m, PWM + EN + CLR, 1 << 4); to(m, t0 + 500);
  assert.equal(r(m, sl(4, CTR)), 123, 'held while disabled'); assert.equal(r(m, sl(5, CTR)), 500);
  w(m, sl(5, CTR), 10); to(m, t0 + 510); assert.equal(r(m, sl(5, CTR)), 20);
});

test('interrupts: a wrap sets INTR; INTE0/INTE1 drive IRQ 8 and 9; writing 1 to INTR clears it', () => {
  const m = machine(), irq = (n) => m.hart.irqc.irq[n];
  w(m, sl(6, TOP), 49); w(m, PWM + INTE0, 1 << 6); w(m, PWM + INTE1, 1 << 6); w(m, sl(6, CSR), 1);
  const t0 = m.hart.ticks;
  to(m, t0 + 49); assert.equal(irq(8), 0); assert.equal(r(m, PWM + INTR), 0);
  to(m, t0 + 50); assert.equal(irq(8), 1); assert.equal(irq(9), 1);
  assert.equal(r(m, PWM + INTS0), 1 << 6); assert.equal(r(m, PWM + INTS1), 1 << 6);
  w(m, PWM + INTR, 1 << 6); assert.equal(irq(8), 0); assert.equal(r(m, PWM + INTR), 0);
  to(m, t0 + 100); assert.equal(irq(8), 1, 'the next wrap');
  // a slice nobody watches: its wraps are caught up when INTR is read
  w(m, sl(7, TOP), 9); w(m, sl(7, CSR), 1); to(m, m.hart.ticks + 1000);
  assert.ok(r(m, PWM + INTR) & (1 << 7));
});

test('DIVMODE: gated by B high, counting B rising edges, falling edges (the B pin is an input; CC_B ignored)', () => {
  for (const [mode, expect] of [[1, 300], [2, 3], [3, 3]]) {
    const m = machine();
    pin(m, 15); // slice 7 B
    w(m, sl(7, CSR), 1 | (mode << 4));
    const t0 = m.hart.ticks;
    // B: high 100 cycles, low 50, three times, then a fourth rise after the checked cycle
    let t = t0;
    for (let k = 0; k < 3; k++) {
      m.at(t + 10, 'pin', 15, 1); m.at(t + 110, 'pin', 15, 0); t += 150;
    }
    m.at(t + 10, 'pin', 15, 1); // a fourth rise: rising mode counts it, gated mode counts only up to here
    to(m, t + 5);
    assert.equal(r(m, sl(7, CTR)), expect, `mode ${mode} before the 4th rise`);
    assert.equal(m.pins.padOe[15], 0, 'B is an input');
  }
});

test('PH_ADV inserts a count, PH_RET deletes one (divider 2); the bits read 1 until done', () => {
  const m = machine();
  w(m, sl(8, TOP), 0xffff); w(m, sl(8, DIV), 0x20); w(m, sl(8, CSR), 1);
  const t0 = m.hart.ticks;
  to(m, t0 + 100); assert.equal(r(m, sl(8, CTR)), 50);
  w(m, sl(8, CSR) + SET, 0x80); assert.ok(r(m, sl(8, CSR)) & 0x80, 'PH_ADV pending');
  to(m, t0 + 104); assert.equal(r(m, sl(8, CSR)) & 0x80, 0); assert.equal(r(m, sl(8, CTR)), 53);
  w(m, sl(8, CSR) + SET, 0x40);
  to(m, t0 + 110); assert.equal(r(m, sl(8, CSR)) & 0x40, 0); assert.equal(r(m, sl(8, CTR)), 55);
  // at full speed there is no gap: PH_ADV stays pending (RP-001 §12.5.2.8)
  w(m, sl(9, CSR), 1); w(m, sl(9, CSR) + SET, 0x80); to(m, m.hart.ticks + 50); assert.ok(r(m, sl(9, CSR)) & 0x80);
});

test('a slice reset by RESETS returns to its reset values and drops its IRQ', () => {
  const m = machine(), irq = (n) => m.hart.irqc.irq[n];
  w(m, sl(0, TOP), 9); w(m, PWM + INTE0, 1); w(m, sl(0, CSR), 1); to(m, m.hart.ticks + 20);
  assert.equal(irq(8), 1);
  w(m, RESETS + SET, 1 << 16); w(m, RESETS + CLR, 1 << 16);
  assert.equal(irq(8), 0); assert.equal(r(m, sl(0, TOP)), 0xffff); assert.equal(r(m, sl(0, CSR)), 0); assert.equal(r(m, sl(0, DIV)), 0x10);
});
