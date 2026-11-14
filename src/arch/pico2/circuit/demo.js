// pico2/circuit/demo.js -- the demo circuit around the board as ordinary parts of the circuit file (P1-B2 stage B2-3; the author,
// 2026-11-13, research D52): the push button on GP15 to ground and the 10 kΩ knob between 3V3 and ground with its wiper on GP26,
// with free-standing ground and power symbols, at the places where the P1-B1 Board view drew them. "No circuit file" means this
// circuit, so links, templates and exercises without a circuit behave as before; a file holds what the student kept of it, and
// the demo parts can be restored. The knob stays the Pins panel's ADC input 0 (soc/circuit.js adcInput), the button's pin keeps the
// Pins panel's outside drive (pad.js), so old input logs replay the same. The board's own LED on GP25 (soldered on the board), the
// speaker and the lab kit stay in the fixed circuit (netlist.js) until stage B2-4 brings the buzzer and kit modules on any pins.
// No imports: format.js uses it to upgrade version-1 files.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** The knob's part name: its control is turned by the Pins panel's ADC input 0. */
export const DEMO_KNOB = 'KNOB';
/** The button's part name. */
export const DEMO_BUTTON = 'BTN';

// pad rows (board-geometry.js): GP15 is pin 20 (left edge, y 496.3), GP26 pin 31 (right edge, y 242.3)
const PARTS = [
  { id: 'BTN', type: 'button', x: -330.2, y: 496.3 },
  { id: 'GND1', type: 'ground', x: -393.7, y: 547.1 },
  { id: 'KNOB', type: 'potentiometer', x: 419.1, y: 242.3, rot: 90 },
  { id: 'PWR1', type: 'power', x: 419.1, y: 140.7 },
  { id: 'GND2', type: 'ground', x: 419.1, y: 356.6 },
];
const WIRES = [
  { a: 'BTN.2', b: 'GP15' }, { a: 'BTN.1', b: 'GND1.1' },
  { a: 'GP26', b: 'KNOB.W' }, { a: 'KNOB.1', b: 'PWR1.1' }, { a: 'GND2.1', b: 'KNOB.2' },
];

/** The demo circuit (a new copy each time; version 2 of the file format, not yet canonical). */
export function demoCircuit() {
  return { format: 'mavilera-pico2-circuit', version: 2, parts: PARTS.map((p) => ({ ...p })), nodes: [], wires: WIRES.map((w) => ({ ...w })), labels: [], defs: [] };
}

/**
 * The circuit `c` with the demo parts it lacks added back (those whose names are free) and the demo wires whose ends all exist
 * and that are not there yet. Returns a new object (not validated).
 */
export function withDemo(c) {
  const out = JSON.parse(JSON.stringify(c));
  const ids = new Set(out.parts.map((p) => p.id));
  const name = new Map(); // demo name -> the name it gets (a ground or power symbol whose name the student has used gets a free one)
  for (const p of PARTS) {
    let id = p.id;
    if (ids.has(id)) {
      if (p.type !== 'ground' && p.type !== 'power') continue; // the button and the knob keep their names, or stay as they are
      const pre = id.replace(/\d+$/, '');
      for (let i = 1; ids.has(id); i++) id = `${pre}${i}`;
    }
    ids.add(id); name.set(p.id, id);
    out.parts.push({ ...p, id });
  }
  const ren = (end) => { const k = end.indexOf('.'); return k < 0 ? end : `${name.get(end.slice(0, k)) ?? end.slice(0, k)}${end.slice(k)}`; };
  const part = (end) => (end.includes('.') ? end.slice(0, end.indexOf('.')) : null);
  const has = (w) => out.wires.some((x) => (x.a === w.a && x.b === w.b) || (x.a === w.b && x.b === w.a));
  for (const w0 of WIRES) {
    // a demo wire comes back when one of its parts came back (the student's own wiring of kept parts is left alone); a wire
    // between a kept and a returned part only where the kept one is itself a demo part the student kept (BTN, KNOB)
    const pa = part(w0.a), pb = part(w0.b);
    const back = (q) => q !== null && name.has(q);
    if (!back(pa) && !back(pb)) continue;
    if ((pa && !back(pa) && !['BTN', 'KNOB'].includes(pa)) || (pb && !back(pb) && !['BTN', 'KNOB'].includes(pb))) continue;
    if ((pa && !ids.has(name.get(pa) ?? pa)) || (pb && !ids.has(name.get(pb) ?? pb))) continue;
    const w = { a: ren(w0.a), b: ren(w0.b) };
    if (!has(w)) out.wires.push(w);
  }
  return out;
}

/** The demo parts missing from `c` (names). */
export const missingDemo = (c) => PARTS.map((p) => p.id).filter((id) => !c.parts.some((p) => p.id === id));
