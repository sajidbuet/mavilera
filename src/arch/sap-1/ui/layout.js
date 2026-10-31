// sap-1/ui/layout.js -- the geometry of the SAP-1 architecture drawing (bus view): units, ports, wires and text slots,
// computed from a few constants, no DOM, so that the tests can check the topology (test/sap1-layout.test.mjs). The
// connections are those of Malvino and Brown's Fig. 10-1 and Figs. 10-12 to 10-15; the arrangement is the simulator's
// own (C4): a horizontal W bus, the fetch units above it, the arithmetic units below, the controller-sequencer at the
// left end with its control word as two rows of six cells, one wire per control signal routed above (or below) the row
// of units, never across the bus. The order of the units is chosen so that the control wires nest without crossing:
// the first signal of CON in each row goes to the farthest port. The clock generator sits above the controller; its
// lines run outside the control wires and cross them (drawn with a gap), never the bus.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { SIGNALS, CLOCK_LINES } from '../bus-model.js';

export const VIEW = Object.freeze({ w: 1050, h: 646 });
export const BUS = Object.freeze({ x: 266, y: 308, w: 764, h: 22 });
const ROW_H = 96;
const TOP_Y = 140;
const BOT_Y = 404;
const PITCH = 28; // between the ports on a unit's edge
const TRACK = 10; // between the control wires
const CELL = 20; // a cell of the control word in the controller

/** The units: box and row. The controller and the clock generator have no bus connection. */
const unit = (id, x, w, row) => ({ id, x, y: row === 'top' ? TOP_Y : BOT_Y, w, h: ROW_H, row });
export const UNITS = Object.freeze(Object.fromEntries([
  { id: 'CLKG', x: 28, y: 6, w: 72, h: 114, row: 'clock' },
  { id: 'CTRL', x: 28, y: TOP_Y, w: 208, h: BOT_Y + ROW_H - TOP_Y, row: 'control' },
  unit('IR', 266, 150, 'top'), unit('RAM', 458, 218, 'top'), unit('MAR', 718, 120, 'top'), unit('PC', 880, 150, 'top'),
  unit('DISP', 266, 122, 'bottom'), unit('OUT', 416, 130, 'bottom'), unit('B', 574, 120, 'bottom'), unit('ALU', 722, 150, 'bottom'),
  unit('A', 900, 130, 'bottom'),
].map((u) => [u.id, Object.freeze(u)])));

/**
 * The input ports on each unit's outer edge, left to right: control inputs first, then clock inputs. `edge`: 'pos' for
 * a positive-edge clock input, 'neg' for a negative-edge one (drawn with a bubble).
 */
const PORT_ORDER = {
  IR: ['Ei', 'Li', 'CLR', 'CLK'], RAM: ['CE'], MAR: ['Lm', 'CLK'], PC: ['Ep', 'Cp', 'nCLR', 'nCLK'],
  OUT: ['Lo', 'CLK'], B: ['Lb', 'CLK'], ALU: ['Eu', 'Su'], A: ['Ea', 'La', 'CLK'],
};
const EDGE = { CLK: 'pos', nCLK: 'neg' };

export const PORTS = Object.freeze(Object.entries(PORT_ORDER).flatMap(([id, names]) => {
  const u = UNITS[id];
  return names.map((name, i) => Object.freeze({
    unit: id, name, kind: SIGNALS.some((s) => s.name === name) ? 'control' : 'clock', edge: EDGE[name] ?? null,
    x: u.x + 20 + PITCH * i, y: u.row === 'top' ? u.y : u.y + u.h, side: u.row === 'top' ? 'top' : 'bottom',
  }));
}));
export const portOf = (unitId, name) => PORTS.find((p) => p.unit === unitId && p.name === name);

/** The controller's control-word cells: the first six signals of CON on its top edge, the last six on its bottom edge. */
const C = UNITS.CTRL;
export const CELLS = Object.freeze(Object.fromEntries(SIGNALS.map((s, i) => {
  const top = i < 6;
  const x = C.x + 84 + CELL * (i % 6);
  return [s.name, Object.freeze({ x, y: top ? C.y : C.y + C.h - 32, w: CELL, h: 32, cx: x + CELL / 2, side: top ? 'top' : 'bottom' })];
})));

/** The controller's clock and halt pins on its top edge, under the clock generator. */
export const CTRL_PINS = Object.freeze({ CLK: { x: 40, edge: 'neg' }, nCLR: { x: 61 }, nHLT: { x: 84, out: true } });

// the y of the k-th control track above the top row (k = 0 outermost) and below the bottom row (k = 0 outermost)
const topTrack = (k) => TOP_Y - 18 - TRACK * (5 - k);
const botTrack = (k) => BOT_Y + ROW_H + 66 - TRACK * k;
// the clock tracks: above the control tracks, and one below
const CLOCK_TOP = { nCLK: 18, nCLR: 30, CLK: 42, CLR: 54 };
const CLOCK_BOTTOM = botTrack(0) + 20;
const CLOCK_LEFT = 14; // the riser of the bottom clock line, left of the controller

/**
 * The wires. Control: from the cell in the controller to the port, three segments (out of the cell, along its track,
 * into the port). Clock: from the clock generator along a track above (or below) every control track, into each port
 * of its line, with taps (`dots`). Data: the stubs between the units and the bus, and the side links between units.
 */
function wires() {
  const out = [];
  SIGNALS.forEach((s, i) => {
    const c = CELLS[s.name];
    const p = portOf(s.unit, s.name);
    const k = i % 6;
    const y = c.side === 'top' ? topTrack(k) : botTrack(k);
    const y0 = c.side === 'top' ? c.y : c.y + c.h;
    out.push({ id: `ctl.${s.name}`, kind: 'control', signal: s.name, from: { unit: 'CTRL', cell: s.name }, to: { unit: s.unit, port: s.name },
      points: [[c.cx, y0], [c.cx, y], [p.x, y], [p.x, p.y]] });
  });
  const G = UNITS.CLKG;
  for (const [name, y] of Object.entries(CLOCK_TOP)) {
    const ports = PORTS.filter((p) => p.name === name && p.side === 'top').sort((a, b) => a.x - b.x);
    const last = ports.at(-1);
    out.push({ id: `clk.${name}.top`, kind: 'clock', signal: name, from: { unit: 'CLKG' }, to: { unit: last.unit, port: name },
      points: [[G.x + G.w, y], [last.x, y], [last.x, last.y]] });
    for (const p of ports.slice(0, -1)) {
      out.push({ id: `clk.${name}.${p.unit}`, kind: 'clock', signal: name, tap: true, from: { unit: 'CLKG' }, to: { unit: p.unit, port: name },
        points: [[p.x, y], [p.x, p.y]] });
    }
  }
  const bottom = PORTS.filter((p) => p.name === 'CLK' && p.side === 'bottom').sort((a, b) => a.x - b.x);
  const yOut = G.y + G.h - 16;
  const last = bottom.at(-1);
  out.push({ id: 'clk.CLK.bottom', kind: 'clock', signal: 'CLK', from: { unit: 'CLKG' }, to: { unit: last.unit, port: 'CLK' },
    points: [[G.x, yOut], [CLOCK_LEFT, yOut], [CLOCK_LEFT, CLOCK_BOTTOM], [last.x, CLOCK_BOTTOM], [last.x, last.y]] });
  for (const p of bottom.slice(0, -1)) {
    out.push({ id: `clk.CLK.${p.unit}`, kind: 'clock', signal: 'CLK', tap: true, from: { unit: 'CLKG' }, to: { unit: p.unit, port: 'CLK' },
      points: [[p.x, CLOCK_BOTTOM], [p.x, p.y]] });
  }
  for (const [name, pin] of Object.entries(CTRL_PINS)) { // between the clock generator and the controller
    const pts = [[pin.x, G.y + G.h], [pin.x, C.y]];
    out.push({ id: `clk.${name}.CTRL`, kind: 'clock', signal: name, from: { unit: pin.out ? 'CTRL' : 'CLKG' }, to: { unit: pin.out ? 'CLKG' : 'CTRL', port: name },
      points: pin.out ? pts.reverse() : pts });
  }
  for (const d of STUBS) out.push({ id: `data.${d.unit}.${d.dir}`, kind: 'data', unit: d.unit, dir: d.dir, width: d.width, points: d.points });
  for (const l of LINKS) out.push({ id: `link.${l.from}.${l.to}`, kind: 'link', from: { unit: l.from }, to: { unit: l.to }, width: l.width, points: l.points });
  return out;
}

/** The data stubs between a unit and the bus: 'in' loads from the bus, 'out' drives it; the width in bits. */
const stub = (id, dir, width, dx) => {
  const u = UNITS[id];
  const x = u.x + (dx ?? u.w / 2);
  const [ue, be] = u.row === 'top' ? [u.y + u.h, BUS.y] : [u.y, BUS.y + BUS.h];
  return Object.freeze({ unit: id, dir, width, x, points: dir === 'in' ? [[x, be], [x, ue]] : [[x, ue], [x, be]] });
};
export const STUBS = Object.freeze([
  stub('IR', 'in', 8, 34), stub('IR', 'out', 4, 118), stub('RAM', 'out', 8), stub('MAR', 'in', 4), stub('PC', 'out', 4),
  stub('OUT', 'in', 8), stub('B', 'in', 8), stub('ALU', 'out', 8), stub('A', 'in', 8, 30), stub('A', 'out', 8, 100),
]);

/** The connections that do not use the bus: MAR to RAM (address), IR to the controller (opcode), A and B to the
 * adder-subtracter, OUT to the display. Horizontal, from one unit's side to its neighbour's. */
const link = (from, to, width, dy) => {
  const a = UNITS[from];
  const b = UNITS[to];
  const y = a.y + dy;
  const [x1, x2] = a.x < b.x ? [a.x + a.w, b.x] : [a.x, b.x + b.w];
  return Object.freeze({ from, to, width, points: [[x1, y], [x2, y]] });
};
export const LINKS = Object.freeze([
  link('MAR', 'RAM', 4, 50), link('IR', 'CTRL', 4, 64), link('A', 'ALU', 8, 48), link('B', 'ALU', 8, 48), link('OUT', 'DISP', 8, 48),
]);

export const WIRES = Object.freeze(wires().map((w) => Object.freeze(w)));

/** The junction dots: where a tap leaves a clock track. */
export const DOTS = Object.freeze(WIRES.filter((w) => w.tap).map((w) => w.points[0]));

/** Character width of a font size, for the text slots and symbols (the symbols are drawn with this exact width). */
export const charW = (size) => 0.6 * size;

/**
 * A signal symbol (main letters, subscript, overbar): its parts' widths at a font size. The subscript is 0.72 of it.
 * The drawing sets textLength to these widths, so the overbar, drawn as a line, always spans the symbol exactly.
 */
export function symbolBox(main, sub, size) {
  const mainW = main.length * charW(size);
  const subW = sub.length * charW(size * 0.72);
  return { mainW, subW, w: mainW + subW };
}
