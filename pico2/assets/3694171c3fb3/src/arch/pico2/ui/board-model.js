// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PICO2_PINS = Object.freeze([
 'GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15',
 'GP16', 'GP17', 'GND', 'GP18', 'GP19', 'GP20', 'GP21', 'GND', 'GP22', 'RUN', 'GP26', 'GP27', 'AGND', 'GP28', 'ADC_VREF', '3V3(OUT)', '3V3_EN', 'GND', 'VSYS', 'VBUS',
].map((name, i) => Object.freeze({ pin: i + 1, name, gpio: /^GP(\d+)$/.test(name) ? Number(name.slice(2)) : -1 })));
export const INTERNAL_GPIO = Object.freeze({ 23: 'smps', 24: 'vbus', 25: 'led', 29: 'vsys' });
export const LED_GPIO = 25;
export const pinOfGpio = (g) => PICO2_PINS.find((p) => p.gpio === g)?.pin ?? 0;
export const STATE = Object.freeze({ LOW: 0, HIGH: 1, Z: 2, PU: 3, PD: 4 });
export function pinLook(state, busy = 0, ext = -1) {
 const pull = state === STATE.PU ? 'up' : state === STATE.PD ? 'down' : null;
 const level = state === STATE.HIGH || state === STATE.LOW ? state : ext === 0 || ext === 1 ? ext : -1;
 const base = level === 1 ? 'high' : level === 0 ? 'low' : 'z';
 const letter = level === 1 ? 'H' : level === 0 ? 'L' : pull === 'up' ? 'Z↑' : pull === 'down' ? 'Z↓' : 'Z';
 const outside = level >= 0 && state !== STATE.HIGH && state !== STATE.LOW;
 return busy >= 2 ? { look: 'busy', pull, letter: '~', settled: letter, outside } : { look: base, pull, letter, settled: letter, outside };
}
export const ledState = (state, busy = 0) => (busy >= 2 ? 'half' : state === STATE.HIGH ? 'on' : 'off');
export const speakerState = (busy = 0) => (busy >= 2 ? 'sounding' : 'quiet');
export const speakerGpio = (opt) => { const k = /^gp(\d+)$/.exec(String(opt ?? '')); return k ? Number(k[1]) : -1; };
export const buttonInput = (gpio, pressed) => ({ kind: 'pin', pin: gpio, level: pressed ? 0 : -1 });
export const KNOB_MAX = 3.3;
export const knobVolts = (v) => Math.min(KNOB_MAX, Math.max(0, Math.round(Number(v) * 100) / 100 || 0));
export const knobInput = (volts) => ({ kind: 'adc', channel: 0, volts: knobVolts(volts) });
export const BUTTON_GPIO = 15;
export const KNOB_GPIO = 26;
export const KIT_I2C = Object.freeze({ sda: 4, scl: 5 });
export const KIT_SPI = Object.freeze({ miso: 16, cs: 17, sck: 18, mosi: 19 });
export const KIT_PARTS = Object.freeze([
 { id: 'bmp280', bus: 'i2c', address: 0x76, name: 'BMP280' },
 { id: 'mpu6050', bus: 'i2c', address: 0x68, name: 'MPU-6050' },
 { id: 'mcp9808', bus: 'i2c', address: 0x18, name: 'MCP9808' },
 { id: 'lcd', bus: 'i2c', address: 0x27, name: 'LCD 16×2' },
 { id: 'eeprom', bus: 'i2c', address: 0x50, name: '24C02' },
 { id: 'bme280', bus: 'spi', address: null, name: 'BME280' },
]);
export const BOARD_PALETTE = Object.freeze({
 light: { sheet: '#ffffff', high: '#c62828', low: '#1565c0', z: '#6b6b6b', busy: '#8e24aa', undef: '#8a5a00' },
 sepia: { sheet: '#faf4e8', high: '#b71c1c', low: '#0d47a1', z: '#6b6b6b', busy: '#7b1fa2', undef: '#7f5300' },
 'hc-light': { sheet: '#ffffff', high: '#a00000', low: '#0034a0', z: '#444444', busy: '#6c1f96', undef: '#6b4400' },
 dark: { sheet: '#101a2b', high: '#ff6b6b', low: '#64b5f6', z: '#a6a6a6', busy: '#d39ae6', undef: '#f2c14e' },
 dim: { sheet: '#262d37', high: '#ff7b7b', low: '#74bdf7', z: '#a6a6a6', busy: '#d6a2e8', undef: '#f2c14e' },
 black: { sheet: '#000000', high: '#ff6b6b', low: '#64b5f6', z: '#a6a6a6', busy: '#d39ae6', undef: '#f2c14e' },
 'hc-dark': { sheet: '#000000', high: '#ff8a8a', low: '#80c8ff', z: '#d4d4d4', busy: '#e0b0f0', undef: '#ffd866' },
});
export const BOARD_LOOK = Object.freeze({ board: '#2f8f46', boardEdge: '#1d6b31', copper: '#d8b04a', hole: '#1b1b1b', print: '#f5f5f5', chip: '#232323', chipText: '#f0f0f0', usb: '#b8bcc2' });
export function contrast(a, b) {
 const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
 const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
 return (x + 0.05) / (y + 0.05);
}
export function busyFromLog(log, from, to, n = 30) {
 const busy = new Uint8Array(n);
 for (let i = Math.max(from, log.base); i < to; i++) { const g = log.pins[i - log.base]; if (g < n && busy[g] < 2) busy[g]++; }
 return busy;
}
export function mergeBusy(into, from) {
 if (!into || !from || into.length !== from.length) return into;
 for (let i = 0; i < into.length; i++) into[i] = Math.min(2, into[i] + from[i]);
 return into;
}
