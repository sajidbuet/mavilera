// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { SIGNALS } from '../bus-model.js';
export const VIEW = Object.freeze({ w: 1330, h: 690 });
export const BUS = Object.freeze({ x: 250, y: 338, w: 1060, h: 24 });
const ROW_H = 118;
const TOP_Y = 160;
const BOT_Y = 422;
export const PITCH = 23;
export const BUNDLE = Object.freeze({ top: TOP_Y - 40, bottom: BOT_Y + ROW_H + 40 });
export const FLAG_TRACK = BOT_Y + ROW_H + 16;
const unit = (id, x, w, row) => ({ id, x, y: row === 'top' ? TOP_Y : BOT_Y, w, h: ROW_H, row });
export const UNITS = Object.freeze(Object.fromEntries([
 { id: 'CTRL', x: 18, y: BUNDLE.top - 22, w: 212, h: BUNDLE.bottom - BUNDLE.top + 44, row: 'control' },
 unit('IR', 250, 104, 'top'), unit('PC', 368, 160, 'top'), unit('MAR', 542, 120, 'top'), unit('MEM', 676, 272, 'top'),
 unit('MDR', 962, 112, 'top'), unit('IN', 1088, 170, 'top'),
 unit('FLAGS', 250, 96, 'bottom'), unit('A', 360, 112, 'bottom'), unit('ALU', 486, 136, 'bottom'), unit('TMP', 636, 98, 'bottom'),
 unit('TMP2', 748, 98, 'bottom'), unit('B', 860, 98, 'bottom'), unit('C', 972, 98, 'bottom'), unit('OUT', 1084, 226, 'bottom'),
].map((u) => [u.id, Object.freeze(u)])));
const PIN_ORDER = {
 IR: ['Li'], PC: ['Cp', 'Ep', 'Epl', 'Eph', 'Lpl', 'Lph'], MAR: ['Lm', 'Lml', 'Lmh'], MEM: ['CE', 'WE'], MDR: ['Lmd'], IN: ['Ein'],
 FLAGS: ['Lf'], A: ['La', 'Ea'], ALU: ['Eu'], TMP: ['Lt', 'Et'], TMP2: ['Lt2', 'Et2'], B: ['Lb', 'Eb'], C: ['Lc', 'Ec'], OUT: ['Lout'],
};
const PIN_X0 = { ALU: 40 };
export const PINS = Object.freeze(Object.entries(PIN_ORDER).flatMap(([id, names]) => {
 const u = UNITS[id];
 const top = u.row === 'top';
 return names.map((name, i) => Object.freeze({ unit: id, name, x: u.x + (PIN_X0[id] ?? 18) + PITCH * i, y: top ? u.y : u.y + u.h, side: top ? 'top' : 'bottom' }));
}));
export const pinOf = (name) => PINS.find((p) => p.name === name);
const C = UNITS.CTRL;
const lastX = (side) => Math.max(...PINS.filter((p) => p.side === side).map((p) => p.x));
export const BUNDLES = Object.freeze({
 top: Object.freeze({ y: BUNDLE.top, points: [[C.x + C.w, BUNDLE.top], [lastX('top'), BUNDLE.top]] }),
 bottom: Object.freeze({ y: BUNDLE.bottom, points: [[C.x + C.w, BUNDLE.bottom], [lastX('bottom'), BUNDLE.bottom]] }),
});
export const TAPS = Object.freeze(PINS.map((p) => Object.freeze({ signal: p.name, unit: p.unit,
 points: [[p.x, p.side === 'top' ? BUNDLE.top : BUNDLE.bottom], [p.x, p.y]] })));
const stub = (id, dir, width, dx) => {
 const u = UNITS[id];
 const x = u.x + (dx ?? u.w / 2);
 const [ue, be] = u.row === 'top' ? [u.y + u.h, BUS.y] : [u.y, BUS.y + BUS.h];
 return Object.freeze({ unit: id, dir, width, x, points: dir === 'in' ? [[x, be], [x, ue]] : [[x, ue], [x, be]] });
};
export const STUBS = Object.freeze([
 stub('IR', 'in', 8), stub('PC', 'in', 8, 46), stub('PC', 'out', 16, 116), stub('MAR', 'in', 16), stub('MDR', 'in', 8, 34), stub('MDR', 'out', 8, 78),
 stub('IN', 'out', 8), stub('A', 'in', 8, 34), stub('A', 'out', 8, 78), stub('ALU', 'out', 8, 96), stub('TMP', 'in', 8, 30), stub('TMP', 'out', 8, 68),
 stub('TMP2', 'in', 8, 30), stub('TMP2', 'out', 8, 68), stub('B', 'in', 8, 30), stub('B', 'out', 8, 68), stub('C', 'in', 8, 30), stub('C', 'out', 8, 68),
 stub('OUT', 'in', 8, 48),
 Object.freeze({ unit: 'CTRL', dir: 'out', width: 16, x: C.x + C.w, points: [[C.x + C.w, BUS.y + BUS.h / 2], [BUS.x, BUS.y + BUS.h / 2]] }),
]);
const link = (from, to, width, dy) => {
 const a = UNITS[from];
 const b = UNITS[to];
 const y = a.y + dy;
 const [x1, x2] = a.x < b.x ? [a.x + a.w, b.x] : [a.x, b.x + b.w];
 return Object.freeze({ from, to, width, points: [[x1, y], [x2, y]] });
};
export const LINKS = Object.freeze([
 link('MAR', 'MEM', 16, 58), link('MEM', 'MDR', 8, 40), link('MDR', 'MEM', 8, 80), link('IR', 'CTRL', 8, 58),
 link('A', 'ALU', 8, 58), link('TMP', 'ALU', 8, 58), link('FLAGS', 'CTRL', 2, 58),
 Object.freeze({ from: 'ALU', to: 'FLAGS', width: 8, points: [[UNITS.ALU.x + 18, BOT_Y + ROW_H], [UNITS.ALU.x + 18, FLAG_TRACK],
 [UNITS.FLAGS.x + 70, FLAG_TRACK], [UNITS.FLAGS.x + 70, BOT_Y + ROW_H]] }),
]);
export const INSIDE_CTRL = Object.freeze(SIGNALS.filter((s) => s.unit === 'CTRL').map((s) => s.name));
export const charW = (size) => 0.6 * size;
export function symbolBox(main, sub, size) {
 const mainW = main.length * charW(size);
 const subW = sub.length * charW(size * 0.72);
 return { mainW, subW, w: mainW + subW };
}
