// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { PICO2_PINS, KIT_I2C, KIT_SPI, BUTTON_GPIO, KNOB_GPIO, pinOfGpio } from './board-model.js';
export const MM = 10;
export const BOARD = Object.freeze({ w: 21 * MM, h: 51 * MM, rowGap: 17.78 * MM, pitch: 2.54 * MM, span: 48.26 * MM,
 holes: [[4.8, 2], [16.2, 2], [4.8, 49], [16.2, 49]].map(([x, y]) => [x * MM, y * MM]), holeR: 1.05 * MM,
 usb: { x: 6.5 * MM, y: -1.3 * MM, w: 8 * MM, h: 5.6 * MM },
 padHoleR: 0.5 * MM,
 padW: 3.2 * MM, padH: 1.7 * MM });
const x0 = (BOARD.w - BOARD.rowGap) / 2;
const y0 = (BOARD.h - BOARD.span) / 2;
export function padCentre(p) {
 if (p <= 20) return { x: x0, y: y0 + (p - 1) * BOARD.pitch, side: 'left' };
 return { x: x0 + BOARD.rowGap, y: y0 + (40 - p) * BOARD.pitch, side: 'right' };
}
export const PADS = Object.freeze(PICO2_PINS.map((p) => Object.freeze({ ...p, ...padCentre(p.pin) })));
export const SWD = Object.freeze(['SWCLK', 'GND', 'SWDIO'].map((name, i) => Object.freeze({ name, x: BOARD.w / 2 + (i - 1) * BOARD.pitch, y: BOARD.h - 1.6 * MM })));
export const CHIPS = Object.freeze([
 { id: 'led', label: 'LED', sub: 'GP25', x: 7.0 * MM, y: 4.7 * MM, w: 1.6 * MM, h: 1.0 * MM, kind: 'led' },
 { id: 'bootsel', label: 'BOOTSEL', x: 4.6 * MM, y: 10.5 * MM, w: 4.6 * MM, h: 4.6 * MM, kind: 'button' },
 { id: 'smps', label: 'SMPS', x: 12.6 * MM, y: 11 * MM, w: 4.2 * MM, h: 4.2 * MM, kind: 'chip' },
 { id: 'flash', label: 'Flash', sub: '4 MB', x: 12.4 * MM, y: 18.5 * MM, w: 4.6 * MM, h: 4.0 * MM, kind: 'chip' },
 { id: 'rp2350', label: 'RP2350', x: 6.5 * MM, y: 25 * MM, w: 8 * MM, h: 8 * MM, kind: 'chip' },
 { id: 'xtal', label: 'Crystal', x: 7.6 * MM, y: 35.2 * MM, w: 5.8 * MM, h: 2.4 * MM, kind: 'chip' },
]);
export const NAME = Object.freeze({ text: 'Pico2', x: BOARD.w / 2, y: 43.2 * MM, size: 3.0 * MM });
const at = (g) => PADS[pinOfGpio(g) - 1];
export const SHEET = Object.freeze({ x: -530, y: -95, w: 1290, h: 855 });
export const I2C_COLS = Object.freeze({ sda: -160, scl: -200 });
export const PULLUP = Object.freeze({ top: -8, rail: -52 });
export const I2C_PART_BOX = Object.freeze({ x: -515, w: 270, h: 46, gap: 12, top: 12, lcdH: 96, pinDy: 8 });
export const LCD_WIN = Object.freeze({ dx: 12, dy: 26, cols: 16, rows: 2, cell: 12.5, rowH: 24, pad: 6 });
export const BUTTON = Object.freeze({ gpio: BUTTON_GPIO, x: -330, y: at(BUTTON_GPIO).y, gnd: -420 });
export const KNOB = Object.freeze({ gpio: KNOB_GPIO, x: 420, y: at(KNOB_GPIO).y, body: 45, lead: 30, jog: 360 });
export const BME = Object.freeze({ x: 440, w: 180, top: at(KIT_SPI.mosi).y - 30, bottom: at(KIT_SPI.miso).y + 30 });
export const SPEAKER = Object.freeze({ x: BOARD.w / 2, y: 660, colLeft: -95, colRight: BOARD.w + 95, run: 600 });
export const PIN_OF = Object.freeze({ sda: at(KIT_I2C.sda), scl: at(KIT_I2C.scl), miso: at(KIT_SPI.miso), cs: at(KIT_SPI.cs), sck: at(KIT_SPI.sck), mosi: at(KIT_SPI.mosi),
 button: at(BUTTON_GPIO), knob: at(KNOB_GPIO) });
export const edgeX = (pad) => (pad.side === 'left' ? 0 : BOARD.w);
