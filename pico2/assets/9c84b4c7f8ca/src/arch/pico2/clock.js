// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const XOSC_HZ = 12_000_000;
export const CLOCK_CHOICES = Object.freeze(['1', '4', '12']);
export const DEFAULT_CLOCK = '4';
export const TICK_CYCLES = 12;
export function clockConfig(id) {
 const mhz = Number(CLOCK_CHOICES.includes(String(id)) ? id : DEFAULT_CLOCK);
 const hz = mhz * 1_000_000, div = XOSC_HZ / hz;
 const baud = hz >= 16 * 115_200 ? 115_200 : 57_600;
 const d = hz / (16 * baud);
 const ibrd = Math.floor(d), fbrd = Math.round((d - ibrd) * 64);
 return Object.freeze({ id: String(mhz), hz, div, divReg: (div << 16) >>> 0, baud, ibrd, fbrd, tickCycles: TICK_CYCLES });
}
export function clockSymbols(id) {
 const c = clockConfig(id);
 return Object.freeze({ CLK_SYS_HZ: c.hz, CLK_SYS_DIV: c.divReg, UART_BAUD: c.baud, UART_IBRD: c.ibrd, UART_FBRD: c.fbrd, TICK_CYCLES: c.tickCycles, XOSC_HZ });
}
