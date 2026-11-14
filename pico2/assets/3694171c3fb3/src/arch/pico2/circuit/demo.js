// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const DEMO_KNOB = 'KNOB';
export const DEMO_BUTTON = 'BTN';
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
export function demoCircuit() {
 return { format: 'mavilera-pico2-circuit', version: 2, parts: PARTS.map((p) => ({ ...p })), nodes: [], wires: WIRES.map((w) => ({ ...w })), labels: [], defs: [] };
}
export function withDemo(c) {
 const out = JSON.parse(JSON.stringify(c));
 const ids = new Set(out.parts.map((p) => p.id));
 const name = new Map();
 for (const p of PARTS) {
 let id = p.id;
 if (ids.has(id)) {
 if (p.type !== 'ground' && p.type !== 'power') continue;
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
export const missingDemo = (c) => PARTS.map((p) => p.id).filter((id) => !c.parts.some((p) => p.id === id));
