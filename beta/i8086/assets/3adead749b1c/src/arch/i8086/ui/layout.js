// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const VIEW = Object.freeze({ w: 1330, h: 720 });
export const FRAMES = Object.freeze({
 BIU: Object.freeze({ x: 244, y: 10, w: 1076, h: 286 }),
 EU: Object.freeze({ x: 10, y: 306, w: 1310, h: 404 }),
});
export const BUS = Object.freeze({ x: 260, y: 500, w: 790, h: 22 });
export const SPINE = Object.freeze({ x: 260, y: 40, w: 22, h: BUS.y - 40 });
export const ROW = 26;
const box = (id, x, y, w, h, cls, rows = null) => [id, Object.freeze({ id, x, y, w, h, cls, ...(rows ? { rows: Object.freeze(rows) } : {}) })];
export const UNITS = Object.freeze(Object.fromEntries([
 box('SEG', 310, 30, 270, 34 + 5 * ROW, 'intel', ['CS', 'DS', 'SS', 'ES', 'IP']),
 box('ICR', 310, 202, 270, 34 + 2 * ROW, 'intel', ['IND', 'OPR']),
 box('ADDER', 610, 40, 160, 104, 'intel'),
 box('BUSCTL', 810, 30, 190, 256, 'intel'),
 box('QUEUE', 1030, 196, 270, 84, 'intel'),
 box('DATA', 310, 330, 170, 34 + 4 * ROW, 'intel', ['AX', 'BX', 'CX', 'DX']),
 box('PTR', 510, 330, 170, 34 + 4 * ROW, 'intel', ['SP', 'BP', 'SI', 'DI']),
 box('TEMPS', 710, 330, 190, 34 + 3 * ROW, 'intel', ['tmpA', 'tmpB', 'tmpC']),
 box('ALU', 330, 560, 180, 110, 'intel'),
 box('SIGMA', 550, 560, 140, 76, 're'),
 box('FLAGS', 730, 560, 310, 76, 'intel'),
 box('CTRL', 1080, 316, 230, 388, 'intel'),
].map(([id, u]) => [id, u])));
export const DECODER = Object.freeze({ x: 1092, y: 354, w: 206, h: 54, cls: 'edu' });
export const CELL = Object.freeze({ w: 38, h: 34, gap: 4 });
export const CELLS = Object.freeze(Array.from({ length: 6 }, (_, i) => {
 const q = UNITS.QUEUE;
 const x0 = q.x + q.w - 12 - 6 * CELL.w - 5 * CELL.gap;
 return Object.freeze({ index: 6 - i, x: x0 + i * (CELL.w + CELL.gap), y: q.y + 38, w: CELL.w, h: CELL.h });
}));
export const HEAD = CELLS[5];
export const FLAG_CELLS = Object.freeze(['OF', 'DF', 'IF', 'TF', 'SF', 'ZF', 'AF', 'PF', 'CF']);
export function rowBox(unitId, name) {
 const u = UNITS[unitId];
 const i = u.rows.indexOf(name);
 return { x: u.x + 8, y: u.y + 26 + i * ROW, w: u.w - 16, h: ROW - 4 };
}
const vstub = (id, dir, dx) => {
 const u = UNITS[id];
 const x = u.x + dx;
 const top = u.y < BUS.y;
 const [ue, be] = top ? [u.y + u.h, BUS.y] : [u.y, BUS.y + BUS.h];
 return Object.freeze({ unit: id, dir, width: 16, points: dir === 'in' ? [[x, be], [x, ue]] : [[x, ue], [x, be]] });
};
const hstub = (id, dir, y) => {
 const u = UNITS[id];
 const sx = SPINE.x + SPINE.w;
 return Object.freeze({ unit: id, dir, width: 16, points: dir === 'in' ? [[sx, u.y + y], [u.x, u.y + y]] : [[u.x, u.y + y], [sx, u.y + y]] });
};
export const STUBS = Object.freeze([
 hstub('SEG', 'in', 70), hstub('SEG', 'out', 110), hstub('ICR', 'in', 32), hstub('ICR', 'out', 60),
 vstub('DATA', 'in', 50), vstub('DATA', 'out', 120), vstub('PTR', 'in', 50), vstub('PTR', 'out', 120),
 vstub('TEMPS', 'in', 55), vstub('TEMPS', 'out', 135),
 vstub('ALU', 'in', 40), vstub('ALU', 'in', 140), vstub('SIGMA', 'out', 70), vstub('FLAGS', 'in', 60), vstub('FLAGS', 'out', 120),
]);
export const ALU_INPUTS = Object.freeze({ a: STUBS[10], b: STUBS[11] });
const A = UNITS.ADDER; const BC = UNITS.BUSCTL; const Q = UNITS.QUEUE; const C = UNITS.CTRL; const F = UNITS.FLAGS;
const I = UNITS.ICR; const SG = UNITS.SEG; const AL = UNITS.ALU; const SI = UNITS.SIGMA;
const L = (id, width, cls, points) => Object.freeze({ id, width, cls, points: Object.freeze(points.map((p) => Object.freeze(p))) });
const GAP_Y = (SG.y + SG.h + I.y) / 2;
export const LINKS = Object.freeze([
 L('segment', 16, 'intel', [[SG.x + SG.w, SG.y + 60], [A.x, SG.y + 60]]),
 L('ind', 16, 'intel', [[I.x + I.w, I.y + 39], [A.x + 96, I.y + 39], [A.x + 96, A.y + A.h]]),
 L('offset', 16, 'edu', [[SPINE.x + SPINE.w, GAP_Y], [A.x + 40, GAP_Y], [A.x + 40, A.y + A.h]]),
 L('address', 20, 'intel', [[A.x + A.w, A.y + 52], [BC.x, A.y + 52]]),
 L('opr-out', 16, 'intel', [[I.x + I.w, I.y + 60], [BC.x, I.y + 60]]),
 L('opr-in', 16, 'intel', [[BC.x, I.y + 76], [I.x + I.w, I.y + 76]]),
 L('external', 20, 'intel', [[BC.x + BC.w, BC.y + 40], [FRAMES.BIU.x + FRAMES.BIU.w - 4, BC.y + 40]]),
 L('prefetch', 16, 'intel', [[BC.x + BC.w, Q.y + 55], [Q.x, Q.y + 55]]),
 L('qbus', 8, 'intel', [[HEAD.x + HEAD.w / 2, Q.y + Q.h], [HEAD.x + HEAD.w / 2, C.y]]),
 L('qdata', 8, 'intel', [[HEAD.x + HEAD.w / 2, Q.y + Q.h + 10], [BUS.x + BUS.w + 14, Q.y + Q.h + 10], [BUS.x + BUS.w + 14, BUS.y + 6], [BUS.x + BUS.w, BUS.y + 6]]),
 L('constant', 16, 'edu', [[C.x, BUS.y + 16], [BUS.x + BUS.w, BUS.y + 16]]),
 L('result', 16, 'intel', [[AL.x + AL.w, SI.y + 38], [SI.x, SI.y + 38]]),
 L('flags', 9, 'intel', [[AL.x + 90, AL.y + AL.h], [AL.x + 90, AL.y + AL.h + 22], [F.x + 155, AL.y + AL.h + 22], [F.x + 155, F.y + F.h]]),
 L('condition', 9, 'intel', [[F.x + F.w, F.y + 38], [C.x, F.y + 38]]),
]);
export const linkOf = (id) => LINKS.find((l) => l.id === id);
export const PLACE_UNIT = Object.freeze({
 AX: 'DATA', BX: 'DATA', CX: 'DATA', DX: 'DATA', AL: 'DATA', BL: 'DATA', CL: 'DATA', DL: 'DATA', AH: 'DATA', BH: 'DATA', CH: 'DATA', DH: 'DATA',
 SP: 'PTR', BP: 'PTR', SI: 'PTR', DI: 'PTR',
 CS: 'SEG', DS: 'SEG', SS: 'SEG', ES: 'SEG', IP: 'SEG',
 IND: 'ICR', OPR: 'ICR', tmpA: 'TEMPS', tmpB: 'TEMPS', tmpC: 'TEMPS', 'Σ': 'SIGMA', FLAGS: 'FLAGS', Q: 'QUEUE', decode: 'CTRL',
});
export const PLACE_ROW = Object.freeze({ AL: 'AX', AH: 'AX', BL: 'BX', BH: 'BX', CL: 'CX', CH: 'CX', DL: 'DX', DH: 'DX' });
