// The C subset on the Pico 2 (P1-C2; design docs/architecture/pico2-p1c2-c-subset.md §5). Exit criterion: C-subset programs
// without module-specific I/O give the same results on pico2 as in the RISC-V module (exit code; putchar output), for the
// generated programs of programs-c.mjs and, when the book is present (MES_BOOK or ../book-MES), programs.c 1-5, in both
// translation modes; the example (UART text and the LED's pin events); the start-up's register state; <rp2350.h>
// (addresses checked against pico-sdk 2.3.1 hardware/regs, RP-020, for three registers, and against the SVD table for all);
// the helpers; the subset's messages on pico2.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/cc/compiler.js';
import { assemble as rvAssemble } from '../src/asm/assembler.js';
import { Hart, run } from '../src/core/iss.js';
import { assemble } from '../src/arch/pico2/language.js';
import { create } from '../src/arch/pico2/engine.js';
import { pico2Target, headerText, reg } from '../src/arch/pico2/c/target.js';
import { clockConfig, DEFAULT_CLOCK } from '../src/arch/pico2/clock.js';
import { descriptor } from '../src/arch/pico2/index.js';
import { PICO2_STRINGS as S } from '../src/arch/pico2/strings.js';
import { STOP, validateDescriptor } from '../src/arch/contract.js';
import { cProgram } from './programs-c.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const CORPUS = join(BOOK, 'code', 'sim', 'tests', 'c', 'programs.c');
const TARGET = pico2Target();

/** The RISC-V module: compile for the ISS profile, assemble, run: {exit, output}. */
function onRiscv(src, { mode = 'plain', defines = {} } = {}) {
  const c = compile(src, { mode, defines });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const p = rvAssemble([{ name: 'out.s', text: c.asm }], { profile: 'iss' });
  assert.deepEqual(p.errors, []);
  const h = new Hart(p, {});
  run(h, 50_000_000);
  return { exit: h.exitCode >>> 0, output: String.fromCharCode(...h.output) }; // the ISS keeps output as bytes
}

/** pico2: compile with the pico2 target, assemble, run to the ebreak: {exit (a0), output (UART0), engine, asm}. */
function onPico2(src, { mode = 'plain', defines = {}, limit = 20_000_000, clock } = {}) {
  const c = compile(src, { name: 'main.c', profile: 'hazard3', mode, defines, target: clock ? pico2Target({ clock }) : TARGET });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const p = assemble([{ name: 'main.s', text: c.asm }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics.slice(0, 3)));
  const e = create(p, { runLimit: limit });
  let st;
  do st = e.run({ chunk: 1_000_000, resumed: true }); while (st === STOP.CHUNK);
  const s = e.state();
  assert.equal(st, STOP.HALT, s.error ?? 'did not halt');
  return { exit: s.registers.x10 >>> 0, output: s.output, engine: e, asm: c.asm };
}

test('the descriptor opens cLanguage with the C extra language; it validates', () => {
  assert.equal(descriptor.capabilities.cLanguage, true);
  assert.equal(descriptor.language.extraLanguages[0].id, 'c');
  assert.deepEqual(validateDescriptor(descriptor), []);
});

test('exit criterion: 32 generated subset programs give the same exit code on pico2 as in the RISC-V module, both modes', () => {
  let n = 0;
  for (let k = 1; k <= 32; k++) {
    const text = cProgram(k);
    for (const mode of ['plain', 'register']) {
      const a = onRiscv(text, { mode }), b = onPico2(text, { mode });
      assert.equal(b.exit, a.exit, `generated ${k} ${mode}: pico2 ${b.exit.toString(16)} vs RISC-V ${a.exit.toString(16)}`);
      n++;
    }
  }
  assert.equal(n, 64);
});

test('exit criterion: programs.c 1-5 of the book give the same exit code and output on pico2, both modes', { skip: existsSync(CORPUS) ? false : 'book repository not found (set MES_BOOK)' }, () => {
  const text = readFileSync(CORPUS, 'utf8');
  for (let prog = 1; prog <= 5; prog++) {
    for (const mode of ['plain', 'register']) {
      const defines = { PROG: String(prog) };
      const a = onRiscv(text, { mode, defines }), b = onPico2(text, { mode, defines });
      assert.equal(b.exit, a.exit, `PROG=${prog} ${mode}`);
      assert.equal(b.output, a.output, `PROG=${prog} ${mode}: output`);
    }
  }
});

test('putchar output: the same text on pico2 (UART0) as on the RISC-V module (console)', () => {
  const src = `void num(unsigned v) { if (v >= 10) num(v / 10); putchar('0' + v % 10); }
int main(void) { for (int i = 1; i <= 12; i++) { num(i * i * i); putchar(i % 4 ? ' ' : '\\n'); } return 3; }`;
  for (const mode of ['plain', 'register']) {
    const a = onRiscv(src, { mode }), b = onPico2(src, { mode });
    assert.equal(b.output, a.output);
    assert.equal(b.exit, 3);
  }
});

test('the example: its UART text, ten LED edges 100 ms apart on GPIO 25, exit code 0', () => {
  const r = onPico2(S.cc.example, { limit: 50_000_000 });
  assert.equal(r.output, 'Hello from C on the Pico 2!\n');
  assert.equal(r.exit, 0);
  const m = r.engine.machine, log = m.pins.log;
  const edges = [];
  for (let i = 0; i < log.pins.length; i++) if (log.pins[i] === 25) edges.push(m.nsAt(log.cycles[i]) / 1e6);
  // the first event is the pin leaving its reset state (output enabled, low); then 1, 0, 1, 0, ...
  const toggles = edges.slice(2);
  assert.equal(toggles.length, 9, `edges ${edges.map((x) => x.toFixed(3)).join(', ')}`);
  for (let i = 1; i < toggles.length; i++) assert.ok(Math.abs(toggles[i] - toggles[i - 1] - 100) < 0.1, `interval ${i}: ${(toggles[i] - toggles[i - 1]).toFixed(4)} ms`);
});

test('the start-up (P1-M4 D36 Q2): clk_ref 12 MHz from the crystal, clk_sys = clk_peri = the chosen 1, 4 or 12 MHz (default 4); the four blocks out of reset; UART0 divisor; TIMER0 in microseconds', () => {
  // UART: divisor clk_peri / (16 x baud) (RP-001 §12.1); 115200 baud, 57600 at 1 MHz (16 x 115200 > 1 MHz, §12.1.3.1)
  const want = { 1: { sys: 1e6, ibrd: 1, fbrd: 5, baud: 57600 }, 4: { sys: 4e6, ibrd: 2, fbrd: 11, baud: 115200 }, 12: { sys: 12e6, ibrd: 6, fbrd: 33, baud: 115200 } };
  for (const clock of [undefined, '1', '4', '12']) {
    const w = want[clock ?? DEFAULT_CLOCK];
    assert.deepEqual(clockConfig(clock).baud, w.baud);
    const r = onPico2('int main(void) { return 0; }', { clock });
    const m = r.engine.machine;
    const get = (dev, name) => dev.r.get(dev.r.off(name)) >>> 0; // the devices' register state (engine.peek does not read devices)
    assert.deepEqual({ ref: m.freq.ref, sys: m.freq.sys, peri: m.freq.peri }, { ref: 12e6, sys: w.sys, peri: w.sys }, `clock ${clock}`);
    const held = get(m.resets, 'RESET');
    for (const bit of [6, 9, 23, 26]) assert.equal(held & (1 << bit), 0, `RESET bit ${bit} released`);
    assert.equal(get(m.uart[0], 'UARTIBRD'), w.ibrd); assert.equal(get(m.uart[0], 'UARTFBRD'), w.fbrd);
    assert.equal(get(m.uart[0], 'UARTCR') & 0x301, 0x301);
    assert.equal(get(m.ticks, 'TIMER0_CYCLES'), 12);
    assert.deepEqual(r.engine.diagnostics(), [], 'nothing unmodelled or held in reset was touched');
    assert.match(headerText(clockConfig(clock)), new RegExp(`#define CLK_SYS_HZ ${w.sys}\\b`));
  }
});

test('the example at each clock: the same UART text and 100 ms LED period (TIMER0 counts microseconds from clk_ref)', () => {
  for (const clock of ['1', '12']) {
    const r = onPico2(S.cc.example, { limit: 50_000_000, clock });
    assert.equal(r.output, 'Hello from C on the Pico 2!\n');
    const m = r.engine.machine, log = m.pins.log;
    const edges = [];
    for (let i = 0; i < log.pins.length; i++) if (log.pins[i] === 25) edges.push(m.nsAt(log.cycles[i]) / 1e6);
    const toggles = edges.slice(2);
    for (let i = 1; i < toggles.length; i++) assert.ok(Math.abs(toggles[i] - toggles[i - 1] - 100) < 0.1, `${clock} MHz interval ${i}`);
  }
});

test('<rp2350.h>: every register macro is the SVD address; three checked against pico-sdk hardware/regs; the helpers declared', () => {
  const text = headerText();
  const defs = [...text.matchAll(/^#define (\w+)_(\w+) \(\*\(volatile uint32_t \*\)0x([0-9a-f]{8})\)$/gm)];
  assert.ok(defs.length > 400, `${defs.length} register macros`);
  assert.match(text, /#define SIO_GPIO_OUT_SET \(\*\(volatile uint32_t \*\)0xd0000018\)/);    // SIO_BASE + SIO_GPIO_OUT_SET_OFFSET
  assert.match(text, /#define UART0_UARTDR \(\*\(volatile uint32_t \*\)0x40070000\)/);         // UART0_BASE + 0
  assert.match(text, /#define TIMER0_TIMERAWL \(\*\(volatile uint32_t \*\)0x400b0028\)/);      // TIMER0_BASE + TIMER_TIMERAWL_OFFSET
  // P1-M5 (research D39 Q9): PWM and DMA too (pico-sdk hardware/regs: PWM_BASE 0x400a8000 + CH0_CC 0x0c, DMA_BASE 0x50000000 + CH0_CTRL_TRIG 0x0c)
  assert.match(text, /#define PWM_CH0_CC \(\*\(volatile uint32_t \*\)0x400a800c\)/);
  assert.match(text, /#define DMA_CH0_CTRL_TRIG \(\*\(volatile uint32_t \*\)0x5000000c\)/);
  // P1-M7 (design Q5): ADC, SPI0, I2C0 (pico-sdk hardware/regs: ADC_BASE 0x400a0000, SPI0_BASE 0x40080000 + SSPDR 0x08, I2C0_BASE 0x40090000 + IC_DATA_CMD 0x10)
  assert.match(text, /#define ADC_RESULT \(\*\(volatile uint32_t \*\)0x400a0004\)/);
  assert.match(text, /#define SPI0_SSPDR \(\*\(volatile uint32_t \*\)0x40080008\)/);
  assert.match(text, /#define I2C0_IC_DATA_CMD \(\*\(volatile uint32_t \*\)0x40090010\)/);
  const blocks = ['RESETS', 'CLOCKS', 'XOSC', 'TICKS', 'IO_BANK0', 'PADS_BANK0', 'SIO', 'UART0', 'UART1', 'TIMER0', 'TIMER1', 'PWM', 'DMA', 'ADC', 'SPI0', 'I2C0', 'PIO0'];
  for (const m of text.matchAll(/^#define (\w+) \(\*\(volatile uint32_t \*\)0x([0-9a-f]{8})\)$/gm)) {
    const b = blocks.find((x) => m[1].startsWith(`${x}_`));
    assert.ok(b, m[1]);
    assert.equal(parseInt(m[2], 16), reg(b, m[1].slice(b.length + 1)), m[1]);
  }
  const r = onPico2(`#include <rp2350.h>
int main(void) { SIO_GPIO_OE_SET = 1 << 3; SIO_GPIO_OUT_SET = 1 << 3; uint32_t t = time_us(); delay_us(250); return time_us() - t; }`);
  assert.ok(r.exit >= 250 && r.exit < 260, `delay_us(250) took ${r.exit} us`);
});

test('helpers: pin_input and pin_read follow an external drive; pin_write drives the pad; a helper without the header is undeclared', () => {
  const src = `#include <rp2350.h>
int main(void) { pin_input(7); pin_output(8); int a = pin_read(7); delay_us(1000); int b = pin_read(7); pin_write(8, 1); return a * 10 + b; }`;
  const c = compile(src, { name: 'm.c', profile: 'hazard3', target: TARGET });
  assert.ok(c.ok, JSON.stringify(c.errors));
  const p = assemble([{ name: 'm.s', text: c.asm }]);
  const e = create(p, { runLimit: 5_000_000 });
  // run to main, then drive GPIO 7 low 0.5 ms later (2000 cycles at the default 4 MHz), while delay_us(1000) runs
  assert.equal(e.run({ chunk: 1_000_000, breakpoints: new Set([p.symbols.main]) }), STOP.BREAK);
  e.machine.at(e.machine.hart.ticks + 2000, 'pin', 7, 0);
  let st; do st = e.run({ chunk: 100_000, resumed: true }); while (st === STOP.CHUNK);
  const s = e.state();
  assert.equal(st, STOP.HALT, s.error);
  assert.equal(s.registers.x10, 10, 'pin 7: 1 through its pull-up before the drive, 0 after');
  assert.ok(e.machine.pins.log.pins.some((pin, i) => pin === 8 && e.machine.pins.log.states[i] === 1), 'pin 8 driven high');
  const bad = compile('int main(void) { pin_write(3, 1); return 0; }', { profile: 'hazard3', target: TARGET });
  assert.equal(bad.ok, false);
  const inc = compile('#include <stdio.h>\nint main(void) { return 0; }', { profile: 'hazard3', target: TARGET });
  assert.match(inc.errors[0].message, /<rp2350\.h>/);
  const clash = compile('#include <rp2350.h>\nint delay_ms(int x) { return x; }\nint main(void) { return 0; }', { profile: 'hazard3', target: TARGET });
  assert.match(clash.errors[0].message, /delay_ms is built in/);
});

test('the RISC-V module\'s compiler is unchanged for its own targets: no <rp2350.h>, putchar still ecall 64', () => {
  const inc = compile('#include <rp2350.h>\nint main(void) { return 0; }', {});
  assert.equal(inc.ok, false);
  assert.match(inc.errors[0].message, /only #include <stdint\.h>/);
  const c = compile('int main(void) { putchar(65); return 0; }', {});
  assert.match(c.asm, /li\s+a7, 64/);
});
