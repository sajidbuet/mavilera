// pico2/ui/board-geometry.js -- the Board view's drawing as data (P1-B1; design docs/architecture/pico2-p1b1-board-view.md §2.2,
// §2.3, research D47, D48 Q4 A): a board shaped like the Pico 2 from the dimensions of RP-002 §3 Figure 3, vertical with the
// micro-USB at the top, in units of 0.1 mm (1 mm = 10), and the fixed circuit around it. The board is drawn here for MAVILERA:
// outline, pad grid and holes from the published dimensions; the chips are labelled boxes placed freehand after the figures'
// arrangement (not traced from Raspberry Pi's design files or photographs; no logo or wordmark; "Pico2" where the board has
// its logo and name, D47). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { PICO2_PINS, KIT_I2C, KIT_SPI, BUTTON_GPIO, KNOB_GPIO, pinOfGpio } from './board-model.js';

export const MM = 10; // units per millimetre
/** The board [RP-002 §3, Figure 3]: 21 × 51 mm; pin rows 17.78 mm apart; 2.54 mm pitch; pin 1 to pin 20 48.26 mm. */
export const BOARD = Object.freeze({ w: 21 * MM, h: 51 * MM, rowGap: 17.78 * MM, pitch: 2.54 * MM, span: 48.26 * MM,
  // mounting holes Ø 2.1 mm, 11.4 mm apart across (4.8 mm from the long edges), 2 mm from the short edges (Figure 3)
  holes: [[4.8, 2], [16.2, 2], [4.8, 49], [16.2, 49]].map(([x, y]) => [x * MM, y * MM]), holeR: 1.05 * MM,
  // the micro-USB overhangs the top edge by 1.3 mm (typ.); 8 mm wide (Figure 3), its depth on the board an estimate
  usb: { x: 6.5 * MM, y: -1.3 * MM, w: 8 * MM, h: 5.6 * MM },
  padHoleR: 0.5 * MM, // 1 mm holes [RP-002 §3]
  padW: 3.2 * MM, padH: 1.7 * MM });

const x0 = (BOARD.w - BOARD.rowGap) / 2; // 1.61 mm from each long edge
const y0 = (BOARD.h - BOARD.span) / 2;   // first and last pin equally far from the short edges (inference from Figure 3)

/** Centre of physical pin p (1-40): 1-20 down the left edge, 21-40 up the right edge (RP-002 §3.1 Figure 4). */
export function padCentre(p) {
  if (p <= 20) return { x: x0, y: y0 + (p - 1) * BOARD.pitch, side: 'left' };
  return { x: x0 + BOARD.rowGap, y: y0 + (40 - p) * BOARD.pitch, side: 'right' };
}
export const PADS = Object.freeze(PICO2_PINS.map((p) => Object.freeze({ ...p, ...padCentre(p.pin) })));

/** The SWD pads on the bottom edge, left to right [RP-002 §1 Figure 2]: SWCLK, GND, SWDIO, 2.54 mm apart (estimate of the spacing). */
export const SWD = Object.freeze(['SWCLK', 'GND', 'SWDIO'].map((name, i) => Object.freeze({ name, x: BOARD.w / 2 + (i - 1) * BOARD.pitch, y: BOARD.h - 1.6 * MM })));

/** The chips and parts on the board, as labelled boxes (freehand positions after the figures' arrangement). */
export const CHIPS = Object.freeze([
  { id: 'led', label: 'LED', sub: 'GP25', x: 7.0 * MM, y: 4.7 * MM, w: 1.6 * MM, h: 1.0 * MM, kind: 'led' },
  { id: 'bootsel', label: 'BOOTSEL', x: 4.6 * MM, y: 10.5 * MM, w: 4.6 * MM, h: 4.6 * MM, kind: 'button' },
  { id: 'smps', label: 'SMPS', x: 12.6 * MM, y: 11 * MM, w: 4.2 * MM, h: 4.2 * MM, kind: 'chip' },
  { id: 'flash', label: 'Flash', sub: '4 MB', x: 12.4 * MM, y: 18.5 * MM, w: 4.6 * MM, h: 4.0 * MM, kind: 'chip' },
  { id: 'rp2350', label: 'RP2350', x: 6.5 * MM, y: 25 * MM, w: 8 * MM, h: 8 * MM, kind: 'chip' },
  { id: 'xtal', label: 'Crystal', x: 7.6 * MM, y: 35.2 * MM, w: 5.8 * MM, h: 2.4 * MM, kind: 'chip' },
]);
/** Where "Pico2" is written (D47: where the board carries the logo and the name). */
export const NAME = Object.freeze({ text: 'Pico2', x: BOARD.w / 2, y: 43.2 * MM, size: 3.0 * MM });

/** The y of a GPIO's pad, and its side. */
const at = (g) => PADS[pinOfGpio(g) - 1];

// --- the circuit around the board (D48 Q4-Q6): columns left and right of the board, the speaker below it --------------------
export const SHEET = Object.freeze({ x: -530, y: -95, w: 1290, h: 855 });
/**
 * The I2C bus left of the board: two vertical lines (SDA nearer the board, SCL nearer the parts), each from its pull-up at the
 * top to the last part it reaches; GP4 and GP5 join them from the board. Where a wire crosses a line it does not join, it hops
 * over it (a small arc); a dot marks every joint where three wires meet.
 */
export const I2C_COLS = Object.freeze({ sda: -160, scl: -200 });
/** The pull-ups: from the top of each bus line (y top) up to a 3V3 rail shared by both (y rail). */
export const PULLUP = Object.freeze({ top: -8, rail: -52 });
/** The kit's five I2C parts: boxes in a column left of the bus (top y of each); pins SDA and SCL on the right edge. */
export const I2C_PART_BOX = Object.freeze({ x: -515, w: 270, h: 46, gap: 12, top: 12, lcdH: 96, pinDy: 8 });
/** The LCD module: the character window inside the module (2 rows of 16 cells), from the module's top-left corner. */
export const LCD_WIN = Object.freeze({ dx: 12, dy: 26, cols: 16, rows: 2, cell: 12.5, rowH: 24, pad: 6 });
export const BUTTON = Object.freeze({ gpio: BUTTON_GPIO, x: -330, y: at(BUTTON_GPIO).y, gnd: -420 });
/**
 * The knob: a potentiometer whose resistor runs from 3V3 (top) to ground (bottom) at x; the wiper (an arrow) touches it at the
 * height of its voltage, `body` above and below the pad's y; GP26's wire leaves the pad, steps at `jog` to the wiper's height.
 */
export const KNOB = Object.freeze({ gpio: KNOB_GPIO, x: 420, y: at(KNOB_GPIO).y, body: 45, lead: 30, jog: 360 });
export const BME = Object.freeze({ x: 440, w: 180, top: at(KIT_SPI.mosi).y - 30, bottom: at(KIT_SPI.miso).y + 30 });
/** The speaker below the board; its wire leaves the pad sideways to this column, then runs down and across. */
export const SPEAKER = Object.freeze({ x: BOARD.w / 2, y: 660, colLeft: -95, colRight: BOARD.w + 95, run: 600 });
export const PIN_OF = Object.freeze({ sda: at(KIT_I2C.sda), scl: at(KIT_I2C.scl), miso: at(KIT_SPI.miso), cs: at(KIT_SPI.cs), sck: at(KIT_SPI.sck), mosi: at(KIT_SPI.mosi),
  button: at(BUTTON_GPIO), knob: at(KNOB_GPIO) });
/** The pad's outer edge, where wires start. */
export const edgeX = (pad) => (pad.side === 'left' ? 0 : BOARD.w);
