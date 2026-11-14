// pico2/ui/board-model.js -- the Board view's rules as pure functions (P1-B1; design docs/architecture/pico2-p1b1-board-view.md
// §2.4-§2.7, research D47, D48): the Pico 2's 40 edge pins after RP-002 (§1 Figure 2 pin allocation, §3.1 Figure 4 numbering),
// the look of a pin from the GPIO model's state code and its change count, the LED's and the speaker's states, and the inputs a
// drawn button gives (the Pins panel's objects). No DOM, so that test/pico2-board.test.mjs runs them in Node.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/**
 * The 40 edge pins of the Pico 2 by physical number [RP-002 §1 Figure 2, §3.1]: pins 1-20 down the left edge, 21-40 up the
 * right edge, the USB connector at the top. `gpio`: the RP2350 GPIO number, or -1 for a power, ground or control pin.
 */
export const PICO2_PINS = Object.freeze([
  'GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15',
  'GP16', 'GP17', 'GND', 'GP18', 'GP19', 'GP20', 'GP21', 'GND', 'GP22', 'RUN', 'GP26', 'GP27', 'AGND', 'GP28', 'ADC_VREF', '3V3(OUT)', '3V3_EN', 'GND', 'VSYS', 'VBUS',
].map((name, i) => Object.freeze({ pin: i + 1, name, gpio: /^GP(\d+)$/.test(name) ? Number(name.slice(2)) : -1 })));

/** The GPIOs the board uses itself and does not bring to the edge [RP-002 §3.1]: GP23 SMPS power save, GP24 VBUS sense, GP25 LED, GP29 VSYS/3. */
export const INTERNAL_GPIO = Object.freeze({ 23: 'smps', 24: 'vbus', 25: 'led', 29: 'vsys' });
export const LED_GPIO = 25;
/** The physical pin of a GPIO on the edge, or 0 if it is not on the edge. */
export const pinOfGpio = (g) => PICO2_PINS.find((p) => p.gpio === g)?.pin ?? 0;

/** The GPIO model's state codes (soc/gpio.js PIN_STATES): 0 driven low, 1 driven high, 2 not driven, 3 pulled up, 4 pulled down. */
export const STATE = Object.freeze({ LOW: 0, HIGH: 1, Z: 2, PU: 3, PD: 4 });

/**
 * The look of a GPIO (research D47): `busy` >= 2 (more than one change since the last redraw) is purple whatever the state;
 * else driven high red, driven low blue, not driven grey, with a pull mark 'up' or 'down'. `letter` is the text that goes with
 * the colour (colour is never the only cue): H, L, Z, Z↑, Z↓, or ~ for a busy pin.
 */
export function pinLook(state, busy = 0, ext = -1) {
  const pull = state === STATE.PU ? 'up' : state === STATE.PD ? 'down' : null;
  // a pin the chip does not drive but the outside does (a drawn button, the Pins panel's High/Low) shows that drive: the
  // GPIO model's state code is the chip's side only (soc/gpio.js), its level is the external drive (P1-B1 review)
  const level = state === STATE.HIGH || state === STATE.LOW ? state : ext === 0 || ext === 1 ? ext : -1;
  const base = level === 1 ? 'high' : level === 0 ? 'low' : 'z';
  const letter = level === 1 ? 'H' : level === 0 ? 'L' : pull === 'up' ? 'Z↑' : pull === 'down' ? 'Z↓' : 'Z';
  const outside = level >= 0 && state !== STATE.HIGH && state !== STATE.LOW;
  return busy >= 2 ? { look: 'busy', pull, letter: '~', settled: letter, outside } : { look: base, pull, letter, settled: letter, outside };
}

/** The LED on GP25 (D48 Q11 A): lit when the chip drives GP25 high, half-lit when the pin is busy, else off. */
export const ledState = (state, busy = 0) => (busy >= 2 ? 'half' : state === STATE.HIGH ? 'on' : 'off');

/** The speaker (D48 Q11 A): sounding while its pin changes more than once between redraws, whatever the Sound button. */
export const speakerState = (busy = 0) => (busy >= 2 ? 'sounding' : 'quiet');

/** The speaker's GPIO from the Language option `speaker` ('none' | 'gpN'), or -1. */
export const speakerGpio = (opt) => { const k = /^gp(\d+)$/.exec(String(opt ?? '')); return k ? Number(k[1]) : -1; };

/**
 * The input of a drawn push button to ground (D47, D48 Q5 A): pressed drives the pin low, released lets go of it, exactly the
 * objects the Pins panel gives for Low and Released (ui/pins-panel.js drive(n, 0 | -1)), so that the input log and replay are
 * the same.
 */
export const buttonInput = (gpio, pressed) => ({ kind: 'pin', pin: gpio, level: pressed ? 0 : -1 });

/** The knob's range and step: the Pins panel's GP26 field and slider (ui/pins-panel.js: 0 to 3.3 V, 0.01 V steps). */
export const KNOB_MAX = 3.3;
export const knobVolts = (v) => Math.min(KNOB_MAX, Math.max(0, Math.round(Number(v) * 100) / 100 || 0));
/** The input of the drawn knob: the Pins panel's object for ADC input 0 ({kind: 'adc', channel, volts}), so that replay is the same. */
export const knobInput = (volts) => ({ kind: 'adc', channel: 0, volts: knobVolts(volts) });

/** The fixed circuit of the board view (D48 Q5, Q6): parts and the GPIOs they connect to. */
export const BUTTON_GPIO = 15;
export const KNOB_GPIO = 26;
export const KIT_I2C = Object.freeze({ sda: 4, scl: 5 });
export const KIT_SPI = Object.freeze({ miso: 16, cs: 17, sck: 18, mosi: 19 });
/** The lab kit's parts (parts/kit.js), as drawn: id, bus, address (I2C) and name. */
export const KIT_PARTS = Object.freeze([
  { id: 'bmp280', bus: 'i2c', address: 0x76, name: 'BMP280' },
  { id: 'mpu6050', bus: 'i2c', address: 0x68, name: 'MPU-6050' },
  { id: 'mcp9808', bus: 'i2c', address: 0x18, name: 'MCP9808' },
  { id: 'lcd', bus: 'i2c', address: 0x27, name: 'LCD 16×2' },
  { id: 'eeprom', bus: 'i2c', address: 0x50, name: '24C02' },
  { id: 'bme280', bus: 'spi', address: null, name: 'BME280' },
]);

/**
 * The state colours per theme (D48 Q8 A): `sheet` is the circuit sheet (the theme's panel surface, src/ui/theme.css --surface), on
 * which wires and marks are drawn; each state colour has a contrast of at least 3:1 against it (WCAG 1.4.11; tested). The board
 * itself keeps one look in every theme (BOARD_LOOK). Keys: the themes' data-theme values; 'light' is the default.
 */
export const BOARD_PALETTE = Object.freeze({
  // undef (P1-B2, research D51 Q6 A): a net between V_IL and V_IH, where the level read is not defined
  light: { sheet: '#ffffff', high: '#c62828', low: '#1565c0', z: '#6b6b6b', busy: '#8e24aa', undef: '#8a5a00' },
  sepia: { sheet: '#faf4e8', high: '#b71c1c', low: '#0d47a1', z: '#6b6b6b', busy: '#7b1fa2', undef: '#7f5300' },
  'hc-light': { sheet: '#ffffff', high: '#a00000', low: '#0034a0', z: '#444444', busy: '#6c1f96', undef: '#6b4400' },
  dark: { sheet: '#101a2b', high: '#ff6b6b', low: '#64b5f6', z: '#a6a6a6', busy: '#d39ae6', undef: '#f2c14e' },
  dim: { sheet: '#262d37', high: '#ff7b7b', low: '#74bdf7', z: '#a6a6a6', busy: '#d6a2e8', undef: '#f2c14e' },
  black: { sheet: '#000000', high: '#ff6b6b', low: '#64b5f6', z: '#a6a6a6', busy: '#d39ae6', undef: '#f2c14e' },
  'hc-dark': { sheet: '#000000', high: '#ff8a8a', low: '#80c8ff', z: '#d4d4d4', busy: '#e0b0f0', undef: '#ffd866' },
});
/** The board's own colours, the same in every theme (D48 Q8 A): green board, gold pads, white print, dark chips. */
export const BOARD_LOOK = Object.freeze({ board: '#2f8f46', boardEdge: '#1d6b31', copper: '#d8b04a', hole: '#1b1b1b', print: '#f5f5f5', chip: '#232323', chipText: '#f0f0f0', usb: '#b8bcc2' });

/** WCAG relative luminance and contrast ratio of two #rrggbb colours. */
export function contrast(a, b) {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Change counts of the pins between two log positions (the engine's pin log {base, pins}), counted up to 2, as Engine.live's
 * `busy`: the independent check the tests use.
 */
export function busyFromLog(log, from, to, n = 30) {
  const busy = new Uint8Array(n);
  for (let i = Math.max(from, log.base); i < to; i++) { const g = log.pins[i - log.base]; if (g < n && busy[g] < 2) busy[g]++; }
  return busy;
}

/** Add the change counts of a live state the page did not draw into the next one (research D48 Q12), saturating at 2. */
export function mergeBusy(into, from) {
  if (!into || !from || into.length !== from.length) return into;
  for (let i = 0; i < into.length; i++) into[i] = Math.min(2, into[i] + from[i]);
  return into;
}
