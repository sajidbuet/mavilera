// pico2/clock.js -- the clk_sys the student chooses for Lite's programs (P1-M4, research D36 Q2): 1, 4 or 12 MHz, default 4 MHz,
// from the 12 MHz crystal (the Pico 2's XOSC, RP-002) through the clk_sys divider. The values the start-up code needs follow from
// the choice: the CLK_SYS_DIV register value (INT in bits 31:16, FRAC in 15:0; RP-001 §8.1, CLK_SYS_DIV), the UART divisor with
// clk_peri = clk_sys, and the TIMER0 tick count. Facts used (RP-001, read 2026-11-09):
// - §8.5.1: the tick generators run from clk_ref, so TIMER0 counts microseconds with 12 cycles per tick from a 12 MHz clk_ref
//   whatever clk_sys is ("the system timers ... should continue to count once per microsecond even as the system clock varies");
// - §12.1.3.1: F_UARTCLK >= 16 x baud and F_UARTCLK <= 5/3 x F_PCLK (PCLK = clk_sys). clk_peri from clk_sys therefore; at 1 MHz
//   115200 baud cannot be made (16 x 115200 > 1 MHz) and the UART runs at 57600 baud, the fastest standard rate that can;
// - §12.1 (PL011): divisor = clk_peri / (16 x baud), IBRD its integer part, FBRD round(fraction x 64).
// The assembler predefines the symbols (language.js), MAVILERA C's start-up uses the same values (c/target.js).
// The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const XOSC_HZ = 12_000_000;
/** The choices, in MHz, as the option's value ids. */
export const CLOCK_CHOICES = Object.freeze(['1', '4', '12']);
export const DEFAULT_CLOCK = '4';
export const TICK_CYCLES = 12; // clk_ref cycles per TIMER0 tick: 1 us from the 12 MHz crystal (RP-001 §8.5.1)

/**
 * The values of a clock choice: {hz, div, divReg, baud, ibrd, fbrd, tickCycles}. `id` one of CLOCK_CHOICES (anything else: the
 * default).
 */
export function clockConfig(id) {
  const mhz = Number(CLOCK_CHOICES.includes(String(id)) ? id : DEFAULT_CLOCK);
  const hz = mhz * 1_000_000, div = XOSC_HZ / hz;
  const baud = hz >= 16 * 115_200 ? 115_200 : 57_600;
  const d = hz / (16 * baud);
  const ibrd = Math.floor(d), fbrd = Math.round((d - ibrd) * 64);
  return Object.freeze({ id: String(mhz), hz, div, divReg: (div << 16) >>> 0, baud, ibrd, fbrd, tickCycles: TICK_CYCLES });
}

/** The symbols the assembler predefines for a clock choice (a program's own .equ or label of the same name takes precedence). */
export function clockSymbols(id) {
  const c = clockConfig(id);
  return Object.freeze({ CLK_SYS_HZ: c.hz, CLK_SYS_DIV: c.divReg, UART_BAUD: c.baud, UART_IBRD: c.ibrd, UART_FBRD: c.fbrd, TICK_CYCLES: c.tickCycles, XOSC_HZ });
}
