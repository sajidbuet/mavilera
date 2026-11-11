// The real-time runner's engine hooks (pico2 P1-M4, docs/architecture/pico2-p1m4-realtime.md §2, research D35 (5), D36):
// Engine.advance runs the clk_sys cycles it is given and ends where run() ends; a sleeping core idles to the end of a slice
// without a step and wakes when an input arrives; inputs are stamped by cycle and logged, a replay from reset with the log
// meets the same steps and the same machine-state hash; stepping back past an input withdraws it; the log travels in the
// snapshot.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/pico2/index.js';
import { create } from '../src/arch/pico2/engine.js';
import { STOP } from '../src/arch/contract.js';
import { assemble } from '../src/arch/pico2/language.js';

const tpl = (f) => readFileSync(new URL(`../content/pico2/templates/${f}`, import.meta.url), 'utf8');
const asm = (text, name = 'main.s') => {
  const p = descriptor.language.assemble([{ name, text }], { profile: 'hazard3' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics.slice(0, 3)));
  return p;
};
const c = async (text) => {
  const cc = await descriptor.language.extraLanguages.find((x) => x.id === 'c').load();
  const r = cc.compile(text, { name: 'main.c', profile: 'hazard3' });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  return asm(r.text);
};
/** run() to the end: the STOP. */
const runOut = (e) => { let s; do s = e.run({ chunk: 1_000_000, resumed: true }); while (s === STOP.CHUNK); return s; };
/** advance() in slices of `n` cycles to the end: {stop, slices}; `each(e, k)` between slices. */
const advanceOut = (e, n, each = null, max = 1e6) => {
  let r, k = 0;
  do { r = e.advance({ cycles: n }); each?.(e, k); k++; } while (r.stop === STOP.CHUNK && k < max);
  return { stop: r.stop, slices: k };
};

// GP2 as an input with its pull-up; a falling edge interrupts through IO_IRQ_BANK0 (line 21, Xh3irq window 1); the core
// sleeps (wfi) until two edges have been counted, then ends. No clock set-up: the ring oscillator.
const PIN_PROGRAM = `        .text
_start: li      t0, 0x40023000          # RESETS, clear alias: IO_BANK0 and PADS_BANK0 out of reset
        li      t1, 0x240
        sw      t1, 0(t0)
        li      t0, 0x40020000
done:   lw      t2, 8(t0)
        and     t2, t2, t1
        bne     t2, t1, done
        li      t0, 0x40028014          # GPIO2_CTRL: SIO
        li      t1, 5
        sw      t1, 0(t0)
        li      t0, 0x4003b00c          # PADS GPIO2, clear alias: ISO, PDE
        li      t1, 0x104
        sw      t1, 0(t0)
        li      t0, 0x4003a00c          # PADS GPIO2, set alias: IE, PUE
        li      t1, 0x48
        sw      t1, 0(t0)
        li      t0, 0x40028248          # PROC0_INTE0: GPIO2 EDGE_LOW
        li      t1, 0x400
        sw      t1, 0(t0)
        la      t0, isr
        csrw    mtvec, t0
        li      t0, 0x200001            # meiea window 1: line 21
        csrs    meiea, t0
        li      t0, 0x800
        csrs    mie, t0
        csrsi   mstatus, 8
        li      s1, 0
sleep:  wfi
        li      t0, 2
        blt     s1, t0, sleep
        csrci   mstatus, 8
        csrw    mtvec, zero
        ebreak
        .align  2
isr:    li      t0, 0x40028230          # INTR0: clear GPIO2's edge
        li      t1, 0x400
        sw      t1, 0(t0)
        addi    s1, s1, 1
        mret
`;

// UART0 echo in MAVILERA C: every byte received is sent back; a '.' ends the program
const ECHO_C = `#include <rp2350.h>
int main(void) {
    int c = 0;
    while (c != 46) {
        while (UART0_UARTFR & UART_FR_RXFE_BIT) { }
        c = UART0_UARTDR & 255;
        putchar(c);
    }
    return 0;
}
`;

test('advance: slices of any size end where run() ends (same steps, same state hash)', () => {
  const p = asm(tpl('timer-irq.s'));
  const a = create(p); assert.equal(runOut(a), STOP.HALT);
  for (const n of [997, 50_000, 1_000_000]) {
    const b = create(p);
    const r = advanceOut(b, n);
    assert.equal(r.stop, STOP.HALT, `slices of ${n}`);
    assert.equal(b.state().steps, a.state().steps, `steps, slices of ${n}`);
    assert.equal(b.stateHash(), a.stateHash(), `state, slices of ${n}`);
  }
});

test('advance: the cycles returned are the clk_sys cycles run; machine time follows the clock', () => {
  const e = create(asm(tpl('blink.s')));
  let total = 0;
  for (let i = 0; i < 20; i++) { const r = e.advance({ cycles: 120_000 }); assert.equal(r.stop, STOP.CHUNK); assert.ok(r.cycles >= 120_000 && r.cycles < 120_010, `${r.cycles}`); total += r.cycles; }
  const s = e.state();
  assert.equal(s.cycle, total);
  assert.equal(s.clkSys, 4_000_000); // the template's start-up at the default clock (D36 Q2)
  assert.ok(s.timeNs > 500e6 && s.timeNs < 700e6, `${s.timeNs} ns`); // 2.4 M cycles, mostly at 4 MHz after the start-up
});

test('a snapshot carries the UART output, the pin log and the checkpoints: an engine restored after a run elsewhere shows the text and steps back', () => {
  const p = asm(tpl('hello-uart.s'));
  const page = create(p), worker = create(p);
  worker.restore(page.snapshot());
  let st; do st = worker.advance({ cycles: 50_000 }).stop; while (st === STOP.CHUNK);
  assert.equal(st, STOP.HALT);
  page.restore(worker.snapshot());
  assert.equal(page.state().output, 'Hello from Hazard3 on the Pico 2!\n');
  assert.ok(page.machine.pins.log.cycles.length > 0);
  const n = page.state().steps;
  assert.ok(page.back(), 'back from the halt'); assert.ok(page.back(), 'one step back by checkpoint + replay');
  assert.equal(page.state().steps, n - 1);
});

test('the clock option (D36 Q2): the assembler predefines its symbols; a program\'s own .equ wins; the device templates run at 1, 4 and 12 MHz', () => {
  const sym = (clock, text) => assemble([{ name: 'a.s', text }], { options: { clock } });
  const p = sym('12', '_start: li a0, CLK_SYS_HZ\n li a1, CLK_SYS_DIV\n li a2, UART_IBRD\n li a3, UART_FBRD\n li a4, TICK_CYCLES\n ebreak');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  assert.equal(p.symbolTable.some((s) => s.name === 'CLK_SYS_HZ'), false, 'not in the symbol table');
  const own = sym('4', '.equ CLK_SYS_HZ, 7\n_start: li a0, CLK_SYS_HZ\n ebreak');
  const r = create(own); r.run({ chunk: 100 });
  assert.equal(r.state().registers.x10, 7);
  for (const clock of ['1', '4', '12']) {
    for (const name of ['blink.s', 'hello-uart.s', 'timer-irq.s']) {
      const e = create(sym(clock, tpl(name)));
      let st; do st = e.run({ chunk: 1_000_000, resumed: true }); while (st === STOP.CHUNK);
      assert.equal(st, STOP.HALT, `${name} at ${clock} MHz: ${e.state().error}`);
      assert.equal(e.state().clkSys, Number(clock) * 1e6, `${name} at ${clock} MHz`);
      if (name === 'hello-uart.s') assert.equal(e.state().output, 'Hello from Hazard3 on the Pico 2!\n');
      if (name === 'blink.s') assert.ok(Math.abs(e.state().timeNs / 1e6 - 1000) < 5, `${name} at ${clock} MHz: ${e.state().timeNs / 1e6} ms`);
    }
  }
});

test('advance: a sleeping core idles to the slice end without a step; an input wakes it at the cycle given', () => {
  const e = create(asm(PIN_PROGRAM));
  for (let i = 0; i < 5; i++) assert.equal(e.advance({ cycles: 10_000 }).stop, STOP.CHUNK);
  const s1 = e.state();
  assert.equal(s1.sleeping, true);
  const r = e.advance({ cycles: 10_000 });
  assert.equal(r.cycles, 10_000); // idled the whole slice
  const s2 = e.state();
  assert.equal(s2.steps, s1.steps, 'no step while idle');
  assert.equal(s2.cycle, s1.cycle + 10_000);
  e.input({ kind: 'pin', pin: 2, level: 0 });
  assert.equal(e.inputs()[0].cycle, s2.cycle, 'stamped at the idle cycle');
  e.advance({ cycles: 10_000 });
  assert.equal(e.state().registers.x9, 1, 'the interrupt counted one edge');
  e.input({ kind: 'pin', pin: 2, level: -1 }); // released: the pull-up
  e.advance({ cycles: 10_000 });
  e.input({ kind: 'pin', pin: 2, level: 0 });
  assert.equal(advanceOut(e, 10_000).stop, STOP.HALT);
  assert.equal(e.state().registers.x9, 2);
});

test('replay: an engine created with the input log meets the same steps and the same state (pins, idle)', () => {
  const p = asm(PIN_PROGRAM);
  const live = create(p);
  const plan = { 7: [{ kind: 'pin', pin: 2, level: 0 }], 9: [{ kind: 'pin', pin: 2, level: -1 }], 15: [{ kind: 'pin', pin: 2, level: 0 }] };
  assert.equal(advanceOut(live, 3_000, (e, k) => { for (const x of plan[k] ?? []) e.input(x); }).stop, STOP.HALT);
  const replay = create(p, { inputs: live.inputs() });
  assert.equal(runOut(replay), STOP.HALT);
  assert.equal(replay.state().steps, live.state().steps);
  assert.equal(replay.stateHash(), live.stateHash());
  assert.deepEqual(replay.inputs(), live.inputs());
  // and again in slices of another size
  const again = create(p, { inputs: structuredClone(live.inputs()) });
  assert.equal(advanceOut(again, 12_345).stop, STOP.HALT);
  assert.equal(again.stateHash(), live.stateHash());
});

test('replay: UART bytes typed during a run give the same echo and state on replay', async () => {
  const p = await c(ECHO_C);
  const live = create(p);
  const typed = { 40: 'Hi', 90: '!', 120: '.' };
  assert.equal(advanceOut(live, 20_000, (e, k) => { if (typed[k]) e.input({ kind: 'uart', uart: 0, bytes: [...typed[k]].map((ch) => ch.charCodeAt(0)) }); }).stop, STOP.HALT);
  assert.equal(live.state().output, 'Hi!.');
  const replay = create(p, { inputs: live.inputs() });
  assert.equal(runOut(replay), STOP.HALT);
  assert.equal(replay.state().output, 'Hi!.');
  assert.equal(replay.stateHash(), live.stateHash());
  assert.equal(replay.state().steps, live.state().steps);
});

test('reset returns to the inputs the engine was created with; stepping back past an input withdraws it', async () => {
  const p = await c(ECHO_C);
  const e = create(p);
  e.advance({ cycles: 400_000 });
  const before = e.stateHash(), steps = e.state().steps;
  e.input({ kind: 'uart', uart: 0, bytes: [65] });
  for (let i = 0; i < 200; i++) e.step();
  assert.match(e.state().output, /A$/);
  while (e.state().steps > steps) assert.ok(e.back());
  assert.equal(e.inputs().length, 1, 'still given: the state is the one right after it');
  assert.ok(e.back());
  assert.deepEqual(e.inputs(), [], 'withdrawn');
  for (let i = 0; i < 2000; i++) e.step();
  assert.equal(e.state().output, '', 'no echo without the input');
  e.reset();
  assert.deepEqual(e.inputs(), []);
  // an engine created with a log keeps it across reset
  const f = create(p, { inputs: [{ cycle: 500_000, step: 0, kind: 'uart', uart: 0, bytes: [66, 46] }] });
  assert.equal(runOut(f), STOP.HALT);
  assert.equal(f.state().output, 'B.');
  f.reset();
  assert.equal(f.inputs().length, 1);
  assert.equal(runOut(f), STOP.HALT);
  assert.equal(f.state().output, 'B.');
  assert.ok(before);
});

test('snapshot and restore carry the input log and the idle cycle (the Worker hand-over)', () => {
  const p = asm(PIN_PROGRAM);
  const a = create(p);
  for (let i = 0; i < 10; i++) a.advance({ cycles: 5_000 });
  a.input({ kind: 'pin', pin: 2, level: 0 });
  const snap = structuredClone(a.snapshot());
  const b = create(p);
  b.restore(snap);
  assert.deepEqual(b.inputs(), a.inputs());
  assert.equal(b.state().cycle, a.state().cycle);
  assert.equal(b.stateHash(), a.stateHash());
  b.input({ kind: 'pin', pin: 2, level: -1 });
  b.advance({ cycles: 5_000 });
  b.input({ kind: 'pin', pin: 2, level: 0 });
  assert.equal(advanceOut(b, 5_000).stop, STOP.HALT);
});

test('inputs are checked; breakpoints stop a slice before the instruction', () => {
  const e = create(asm(PIN_PROGRAM));
  assert.throws(() => e.input({ kind: 'pin', pin: 99, level: 0 }));
  assert.throws(() => e.input({ kind: 'uart', uart: 0, bytes: [300] }));
  assert.throws(() => e.input({ kind: 'key' }));
  const p = asm(PIN_PROGRAM);
  const wfi = p.listing.find((r) => /^wfi/.test(r.text)).address;
  const g = create(p);
  const r = g.advance({ cycles: 1_000_000, breakpoints: new Set([wfi]) });
  assert.equal(r.stop, STOP.BREAK);
  assert.equal(g.state().pc, wfi);
  assert.equal(g.advance({ cycles: 10, breakpoints: new Set([wfi]), resumed: false }).stop, STOP.CHUNK); // continues from it
});
