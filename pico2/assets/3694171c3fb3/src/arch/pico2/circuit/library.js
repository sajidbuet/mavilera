// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { exp, log } from './mathx.js';
export const PRIM_KINDS = Object.freeze({
 R: { terminals: ['a', 'b'] },
 SW: { terminals: ['a', 'b'] },
 POT: { terminals: ['a', 'w', 'b'] },
 D: { terminals: ['a', 'k'] },
 Q: { terminals: ['b', 'c', 'e'] },
 C: { terminals: ['a', 'b'] },
 RX: { terminals: ['a', 'b'] },
});
export const LED_COLOURS = Object.freeze({
 red: { vf: 1.65, rs: 25, imax: 0.030, src: 'Kingbright WP7113ID' },
 yellow: { vf: 1.80, rs: 15, imax: 0.030, src: 'Kingbright WP7113YD' },
 green: { vf: 1.8425, rs: 18.75, imax: 0.025, src: 'Kingbright WP7113GD' },
 blue: { vf: 2.5625, rs: 43.75, imax: 0.030, src: 'Kingbright WP7113QBC/D' },
 white: { vf: 2.5625, rs: 43.75, imax: 0.030, src: 'Kingbright WP7113QWC/D' },
});
export const BOARD_LED = Object.freeze({ vf: 2.1, rs: 20, imax: 0.02, src: 'generic, chosen (the board\'s LED part is not named)' });
export const LED_IMAX = 0.02;
export const LED_FULL = 0.01;
export const DIODES = Object.freeze({
 silicon: { vf: 0.5967, rs: 13.33, src: 'Vishay 1N4148' },
 schottky: { vf: 0.158, rs: 2.0, src: 'Vishay/onsemi 1N5819' },
});
export const NPN = Object.freeze({ beta: 290, vbe: 0.62, rbe: 2900, vcesat: 0.0575, rce: 1.25, src: 'onsemi BC547B' });
export const SWITCH_RON = 0.05;
export const LDR = Object.freeze({ r10: 5740, gamma: 0.6, rdark: 1e6, src: 'Advanced Photonix PDV-P8001' });
export const NTC = Object.freeze({ r25: 10000, beta: 3977, src: 'Vishay NTCLE100E3103' });
export const RGB = Object.freeze({
 R: { vf: 1.5, rs: 20, imax: 0.030, color: 'red' },
 G: { vf: 2.578, rs: 36.1, imax: 0.025, color: 'green' },
 B: { vf: 2.578, rs: 36.1, imax: 0.030, color: 'blue' },
 src: 'Kingbright WP154A4SUREQBFZGW',
});
export const SEVEN_SEG = Object.freeze({ vf: 1.6, rs: 20, imax: 0.030 });
export const SEGMENTS = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'DP']);
const I2C_PINS = Object.freeze(['VCC', 'GND', 'SDA', 'SCL']);
export const VALUE_SOURCES = Object.freeze({
 led: 'Kingbright WP7113 5 mm LEDs', diode: 'Vishay 1N4148, 1N5819', npn: 'onsemi BC547B', ldr: LDR.src, ntc: NTC.src, rgb: RGB.src,
 sevenseg: 'Kingbright SC56-11SRWA / SA56-11SRWA', button: 'chosen (contact resistance 0.05 Ω)', switch: 'chosen (contact resistance 0.05 Ω)',
});
export function rxValue(q, env) {
 if (q.model === 'ldr') { const e = Math.max(0.01, Number(env.light) || 0); return Math.min(q.rdark ?? 1e6, q.r10 * exp(-q.gamma * log(e / 10))); }
 const t = Number(env.temp) + 273.15;
 return q.r25 * exp(q.beta * (1 / t - 1 / 298.15));
}
const num = (unit, min, max, dflt) => ({ kind: 'num', unit, min, max, default: dflt });
const choice = (values, dflt) => ({ kind: 'choice', values, default: dflt });
export const PART_TYPES = Object.freeze({
 resistor: { label: 'Resistor', pins: ['1', '2'], attrs: { value: num('Ω', 1, 1e7, 1000), power: num('W', 0.01, 10, 0.25) },
 prims: (p) => [{ kind: 'R', a: '1', b: '2', r: p.value, power: p.power }] },
 potentiometer: { label: 'Potentiometer', pins: ['1', 'W', '2'], attrs: { value: num('Ω', 100, 1e7, 10000) },
 controls: [{ id: '', kind: 'position', default: 0.5 }],
 prims: (p) => [{ kind: 'POT', a: '1', w: 'W', b: '2', r: p.value, control: p.id }] },
 button: { label: 'Push button', pins: ['1', '2'], attrs: { contact: choice(['open', 'closed'], 'open') },
 controls: [{ id: '', kind: 'press', default: 0 }],
 prims: (p) => [{ kind: 'SW', a: '1', b: '2', control: p.id, nc: p.contact === 'closed' }] },
 switch: { label: 'Switch', pins: ['1', '2'], attrs: {},
 controls: [{ id: '', kind: 'toggle', default: 0 }],
 prims: (p) => [{ kind: 'SW', a: '1', b: '2', control: p.id, nc: false }] },
 led: { label: 'LED', pins: ['A', 'K'], attrs: { color: choice(Object.keys(LED_COLOURS), 'red') },
 prims: (p) => [{ kind: 'D', a: 'A', k: 'K', ...LED_COLOURS[p.color], led: true, color: p.color, part: p.id }] },
 diode: { label: 'Diode', pins: ['A', 'K'], attrs: { kind: choice(Object.keys(DIODES), 'silicon') },
 prims: (p) => [{ kind: 'D', a: 'A', k: 'K', ...DIODES[p.kind] }] },
 capacitor: { label: 'Capacitor', pins: ['1', '2'], attrs: { value: num('F', 1e-12, 1, 1e-6) },
 prims: (p) => [{ kind: 'C', a: '1', b: '2', c: p.value }] },
 npn: { label: 'NPN transistor', pins: ['B', 'C', 'E'], attrs: { beta: num('', 10, 1000, NPN.beta) },
 prims: (p) => [{ kind: 'Q', b: 'B', c: 'C', e: 'E', ...NPN, beta: p.beta }] },
 ground: { label: 'Ground', pins: ['1'], attrs: {}, rail: () => 'GND', prims: () => [] },
 power: { label: 'Power', pins: ['1'], attrs: { rail: choice(['3V3', 'VSYS', 'VBUS', 'ADC_VREF'], '3V3') }, rail: (p) => p.rail ?? '3V3', prims: () => [] },
 ldr: { label: 'Light sensor (LDR)', pins: ['1', '2'], attrs: { r10: num('Ω', 100, 1e6, LDR.r10), gamma: num('', 0.3, 1.2, LDR.gamma) },
 prims: (p) => [{ kind: 'RX', a: '1', b: '2', model: 'ldr', r10: p.r10, gamma: p.gamma, rdark: LDR.rdark, control: p.id }] },
 ntc: { label: 'Thermistor (NTC)', pins: ['1', '2'], attrs: { r25: num('Ω', 100, 1e6, NTC.r25), beta: num('K', 1000, 6000, NTC.beta) },
 prims: (p) => [{ kind: 'RX', a: '1', b: '2', model: 'ntc', r25: p.r25, beta: p.beta, control: p.id }] },
 rgb: { label: 'RGB LED', pins: ['R', 'G', 'B', 'COM'], attrs: { common: choice(['cathode', 'anode'], 'cathode') },
 prims: (p) => ['R', 'G', 'B'].map((c) => { const v = RGB[c]; return p.common === 'anode' ? { kind: 'D', a: 'COM', k: c, ...v, led: true, color: v.color, sub: c } : { kind: 'D', a: c, k: 'COM', ...v, led: true, color: v.color, sub: c }; }) },
 sevenseg: { label: '7-segment display', pins: [...SEGMENTS, 'COM'], attrs: { common: choice(['cathode', 'anode'], 'cathode') },
 prims: (p) => SEGMENTS.map((sgm) => (p.common === 'anode' ? { kind: 'D', a: 'COM', k: sgm, ...SEVEN_SEG, led: true, color: 'red', sub: sgm } : { kind: 'D', a: sgm, k: 'COM', ...SEVEN_SEG, led: true, color: 'red', sub: sgm })) },
 speaker: { label: 'Speaker', pins: ['+', '-'], attrs: {}, sounds: true, prims: () => [] },
 buzzer: { label: 'Piezo buzzer', pins: ['+', '-'], attrs: {}, sounds: true, prims: () => [] },
 bmp280: { label: 'BMP280 (I2C)', pins: I2C_PINS, attrs: { address: choice(['0x76', '0x77'], '0x76') }, module: { bus: 'i2c', model: 'bmp280', name: 'BMP280' }, prims: () => [] },
 mpu6050: { label: 'MPU-6050 (I2C)', pins: I2C_PINS, attrs: { address: choice(['0x68', '0x69'], '0x68') }, module: { bus: 'i2c', model: 'mpu6050', name: 'MPU-6050' }, prims: () => [] },
 mcp9808: { label: 'MCP9808 (I2C)', pins: I2C_PINS, attrs: { address: choice(['0x18', '0x19', '0x1a', '0x1b', '0x1c', '0x1d', '0x1e', '0x1f'], '0x18') }, module: { bus: 'i2c', model: 'mcp9808', name: 'MCP9808' }, prims: () => [] },
 lcd1602: { label: 'LCD 16×2 (I2C)', pins: I2C_PINS, attrs: { address: choice(['0x20', '0x21', '0x22', '0x23', '0x24', '0x25', '0x26', '0x27'], '0x27') }, module: { bus: 'i2c', model: 'lcd', name: 'LCD 16×2' }, prims: () => [] },
 eeprom24c02: { label: '24C02 EEPROM (I2C)', pins: I2C_PINS, attrs: { address: choice(['0x50', '0x51', '0x52', '0x53', '0x54', '0x55', '0x56', '0x57'], '0x50') }, module: { bus: 'i2c', model: 'eeprom', name: '24C02' }, prims: () => [] },
 bme280: { label: 'BME280 (SPI)', pins: ['VCC', 'GND', 'SCK', 'SDI', 'SDO', 'CSB'], attrs: {}, module: { bus: 'spi', model: 'bme280', name: 'BME280' }, prims: () => [] },
});
export function withDefaults(part, type, parse) {
 const out = { ...part };
 for (const [k, a] of Object.entries(type.attrs ?? {})) {
 if (out[k] === undefined) out[k] = a.default;
 else if (a.kind === 'num') out[k] = parse(out[k]);
 }
 return out;
}
