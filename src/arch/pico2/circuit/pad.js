// pico2/circuit/pad.js -- a GPIO pad as an element of a user circuit (P1-B2; design docs/architecture/pico2-p1b2-user-circuits.md
// §2.3, research D51 Q4 A, Q5 A). IOVDD 3.3 V. Values:
//  - output resistance per DRIVE setting (2, 4, 8, 12 mA), high and low side: typical, read by eye from RP-001 §14.9.4 Figure 154
//    (about ±20 %; linear, so the 2 mA driver's collapse above about 12 mA is not modelled);
//  - pull-up 52 kΩ, pull-down 64 kΩ: the geometric means of Table 1683's ranges 32-86 kΩ and 36-113 kΩ (calculated; the table
//    gives no typical value); both set = the bus keeper (RP-001 §9.6.1), a weak hold of the last level through the same values
//    (an inference: the datasheet gives no keeper strength);
//  - input switching points with SCHMITT set 1.75 V rising, 1.55 V falling (IOVDD/2 ± half the minimum hysteresis 0.2 V of
//    Table 1683, a choice within V_IL 0.8 V and V_IH 2.0 V), 1.65 V without SCHMITT; 0.8-2.0 V is the undefined region;
//  - the Pins panel's drive of a pin (and the fixed button on GP15) as an outside source of 0 or 3.3 V through 1 Ω (chosen);
//  - input leakage (≤ 1 µA) and the ADC's input (R_IN ≥ 100 kΩ, no typical) not modelled: ideal inputs.
// A pin's element is coded as one small integer (its key part), from the GPIO model's values at the moment.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const VDD = 3.3;
export const R_OUT_HIGH = Object.freeze([70, 45, 30, 25]); // Ω, DRIVE 0-3 (2, 4, 8, 12 mA), Figure 154 (by eye)
export const R_OUT_LOW = Object.freeze([45, 30, 20, 16]);
export const DRIVE_MA = Object.freeze([2, 4, 8, 12]);
export const R_PU = 52e3;
export const R_PD = 64e3;
export const R_EXT = 1;
// one name per export (the offline build reads exports one declaration at a time, WS-N-002)
export const V_RISE = 1.75;
export const V_FALL = 1.55;
export const V_MID = 1.65;
export const V_IL = 0.8;
export const V_IH = 2.0;
export const V_MAX_FT = 5.5;       // GPIO0-25 (FT), IOVDD at 3.3 V [RP-001 Tables 1673, 1674, 1683]
export const V_MAX_STD = VDD + 0.3; // GPIO26-29 (standard)
export const I_BANK_MAX = 0.1;     // A, sourced and sunk by all GPIOs [Table 1683]

const PAD_SCHMITT = 0x2, PAD_PDE = 0x4, PAD_PUE = 0x8;

/**
 * The code of pin n's element: bits 0-1 the chip's drive (0 none, 1 low, 2 high), 2-3 DRIVE, 4-5 the pull (0 none, 1 up, 2 down,
 * 3 keeper), 6 the keeper's level, 7-8 the outside drive (0 none, 1 low, 2 high).
 */
export function padCode(pins, n) {
  const pad = pins.pad[n];
  const chip = pins.padOe[n] ? (pins.padOut[n] ? 2 : 1) : 0;
  const pu = (pad & PAD_PUE) !== 0, pd = (pad & PAD_PDE) !== 0;
  const pull = pu && pd ? 3 : pu ? 1 : pd ? 2 : 0;
  const keep = pull === 3 ? pins.level[n] & 1 : 0;
  const d = pins.drv[n], out = d === 0 ? 1 : d === 1 ? 2 : 0;
  return chip | (((pad >>> 4) & 3) << 2) | (pull << 4) | (keep << 6) | (out << 7);
}
export const schmittOf = (pins, n) => (pins.pad[n] & PAD_SCHMITT) !== 0;

/**
 * Stamp the element of `code` on node j: the conductances and currents of its sources (Norton form) into G (n × n, row-major)
 * and rhs. Returns nothing; the sources' parameters for currents are given by padSources.
 */
export function stampPad(code, j, n, G, rhs) {
  for (const [v, r] of padSources(code)) { const g = 1 / r; G[j * n + j] += g; rhs[j] += g * v; }
}
/** The sources of a pad's element: [[volts, ohms, role]], role 'chip' | 'pull' | 'outside'. */
export function padSources(code) {
  const out = [];
  const chip = code & 3, drive = (code >>> 2) & 3, pull = (code >>> 4) & 3, keep = (code >>> 6) & 1, ext = (code >>> 7) & 3;
  if (chip === 2) out.push([VDD, R_OUT_HIGH[drive], 'chip']);
  else if (chip === 1) out.push([0, R_OUT_LOW[drive], 'chip']);
  if (pull === 1) out.push([VDD, R_PU, 'pull']);
  else if (pull === 2) out.push([0, R_PD, 'pull']);
  else if (pull === 3) out.push(keep ? [VDD, R_PU, 'pull'] : [0, R_PD, 'pull']);
  if (ext === 2) out.push([VDD, R_EXT, 'outside']);
  else if (ext === 1) out.push([0, R_EXT, 'outside']);
  return out;
}
/** Whether the element anchors its node (any source at all). */
export const padAnchors = (code) => (code & 3) !== 0 || ((code >>> 4) & 3) !== 0 || ((code >>> 7) & 3) !== 0;

/** The level the input reads at `v` volts: 1, 0, or `prev` between the switching points (−1 prev: by the midpoint). */
export function inputLevel(v, prev, schmitt = true) {
  if (!schmitt) return v >= V_MID ? 1 : 0;
  if (v >= V_RISE) return 1;
  if (v <= V_FALL) return 0;
  return prev === 0 || prev === 1 ? prev : v >= V_MID ? 1 : 0;
}
