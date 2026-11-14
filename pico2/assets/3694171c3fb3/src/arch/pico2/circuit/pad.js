// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const VDD = 3.3;
export const R_OUT_HIGH = Object.freeze([70, 45, 30, 25]);
export const R_OUT_LOW = Object.freeze([45, 30, 20, 16]);
export const DRIVE_MA = Object.freeze([2, 4, 8, 12]);
export const R_PU = 52e3;
export const R_PD = 64e3;
export const R_EXT = 1;
export const V_RISE = 1.75;
export const V_FALL = 1.55;
export const V_MID = 1.65;
export const V_IL = 0.8;
export const V_IH = 2.0;
export const V_MAX_FT = 5.5;
export const V_MAX_STD = VDD + 0.3;
export const I_BANK_MAX = 0.1;
const PAD_SCHMITT = 0x2, PAD_PDE = 0x4, PAD_PUE = 0x8;
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
export function stampPad(code, j, n, G, rhs) {
 for (const [v, r] of padSources(code)) { const g = 1 / r; G[j * n + j] += g; rhs[j] += g * v; }
}
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
export const padAnchors = (code) => (code & 3) !== 0 || ((code >>> 4) & 3) !== 0 || ((code >>> 7) & 3) !== 0;
export function inputLevel(v, prev, schmitt = true) {
 if (!schmitt) return v >= V_MID ? 1 : 0;
 if (v >= V_RISE) return 1;
 if (v <= V_FALL) return 0;
 return prev === 0 || prev === 1 ? prev : v >= V_MID ? 1 : 0;
}
