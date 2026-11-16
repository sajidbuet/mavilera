// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { PART_TYPES, LED_COLOURS, BOARD_LED, DIODES, NPN, withDefaults, rxValue } from './library.js';
import { ENV_DEFAULTS } from '../parts/kit.js';
import { parseEnd, parseValue, canonicalText, RAIL_PADS, validateCircuit } from './format.js';
import { demoCircuit as demoRaw, DEMO_KNOB } from './demo.js';
let demoCanon = null;
export function demoCircuit() { demoCanon ??= validateCircuit(demoRaw()); return JSON.parse(JSON.stringify(demoCanon)); }
export const RAILS = Object.freeze(['GND', '3V3', 'VSYS', 'VBUS', 'ADC_VREF']);
export const RAIL_V = Object.freeze([0, 3.3, 5, 5, 3.3]);
const railIndex = (name) => (name === 'AGND' ? 0 : RAILS.indexOf(name));
export const ADC_PADS = Object.freeze({ 26: 0, 27: 1, 28: 2 });
export const FIXED = Object.freeze({ ledR: 470, ledColour: 'green', knob: 10000, kitPullUp: 4700, led: 25, knobGpio: 26, sda: 4, scl: 5 });
class UnionFind {
 constructor() { this.p = new Map(); }
 find(k) { if (!this.p.has(k)) this.p.set(k, k); let r = k; while (this.p.get(r) !== r) r = this.p.get(r); while (this.p.get(k) !== r) { const n = this.p.get(k); this.p.set(k, r); k = n; } return r; }
 union(a, b) { const x = this.find(a), y = this.find(b); if (x !== y) this.p.set(x < y ? y : x, x < y ? x : y); }
}
export function hashText(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(16).padStart(8, '0'); }
export class NetlistError extends Error { constructor(message) { super(message); this.field = 'circuit'; } }
export const endKey = (s) => {
 const e = parseEnd(s);
 if (e.kind === 'pad') return RAIL_PADS.includes(e.name) ? `r:${RAILS[railIndex(e.name)]}` : `p:${e.name.slice(2)}`;
 if (e.kind === 'node') return `j:${e.id}`;
 return `t:${e.part}.${e.pin}`;
};
function fixedPrims() {
 return [
 { kind: 'R', a: `p:${FIXED.led}`, b: 'i:led25', r: FIXED.ledR, part: 'GP25 resistor', fixed: true },
 { kind: 'D', a: 'i:led25', k: 'r:GND', ...BOARD_LED, led: true, color: FIXED.ledColour, part: 'GP25 LED', fixed: true },
 ];
}
function userPrims(part, defs) {
 const type = PART_TYPES[part.type] ?? defs.get(part.type);
 const p = withDefaults(part, type, parseValue);
 const raw = type.custom ? type.primitives.map((q) => ({ ...q, r: q.r !== undefined ? parseValue(q.r) : undefined, c: q.c !== undefined ? parseValue(q.c) : undefined,
 ...(q.kind === 'D' && !q.color ? DIODES[q.diode ?? 'silicon'] : {}), ...(q.kind === 'Q' ? { ...NPN, beta: q.beta !== undefined ? parseValue(q.beta) : NPN.beta } : {}) })) : type.prims(p);
 const T = (pin) => `t:${part.id}.${pin}`;
 return raw.map((q, i) => {
 const out = { ...q, part: part.id, fixed: false };
 for (const t of ['a', 'b', 'k', 'w', 'c', 'e']) if (typeof q[t] === 'string') out[t] = T(q[t]);
 if (q.kind === 'D' && q.color && !q.vf) Object.assign(out, LED_COLOURS[q.color] ?? LED_COLOURS.red, { led: true });
 if ((q.kind === 'SW' || q.kind === 'POT') && type.custom) out.control = `${part.id}.${i}`;
 return out;
 });
}
const TERMINALS = { R: ['a', 'b'], SW: ['a', 'b'], POT: ['a', 'w', 'b'], D: ['a', 'k'], Q: ['b', 'c', 'e'], C: ['a', 'b'], RX: ['a', 'b'] };
export function compile(circuit, { kit = false } = {}) {
 const c = circuit ?? demoCircuit();
 const defs = new Map((c.defs ?? []).map((d) => [d.type, { ...d, pins: d.pins.map((x) => x.name ?? x), custom: true }]));
 const uf = new UnionFind();
 void kit;
 const prims = [...fixedPrims(), ...c.parts.flatMap((p) => userPrims(p, defs))];
 for (const q of prims) for (const t of TERMINALS[q.kind]) uf.find(q[t]);
 for (const w of c.wires) uf.union(endKey(w.a), endKey(w.b));
 for (const p of c.parts) { const t = PART_TYPES[p.type]; if (t?.rail) uf.union(`t:${p.id}.${t.pins[0]}`, `r:${RAILS[railIndex(t.rail(p))]}`); }
 for (const l of c.labels) {
 const k = RAIL_PADS.includes(l.net) ? `r:${RAILS[railIndex(l.net)]}` : /^GP\d+$/.test(l.net) ? `p:${l.net.slice(2)}` : `l:${l.net}`;
 uf.union(k, endKey(l.at));
 }
 const railOf = new Map();
 for (const [i, name] of RAILS.entries()) {
 const k = `r:${name}`; if (!uf.p.has(k)) continue;
 const root = uf.find(k);
 if (railOf.has(root) && railOf.get(root) !== i) throw new NetlistError(`a short: ${RAILS[railOf.get(root)]} and ${name} are connected`);
 railOf.set(root, i);
 }
 const padRail = new Int8Array(30).fill(-1);
 for (let g = 0; g < 30; g++) { const k = `p:${g}`; if (uf.p.has(k) && railOf.has(uf.find(k))) padRail[g] = railOf.get(uf.find(k)); }
 const netOf = new Map(), nets = [];
 const term = (key) => { const r = uf.find(key); if (railOf.has(r)) return -(railOf.get(r) + 1); if (!netOf.has(r)) { netOf.set(r, nets.length); nets.push({ root: r, members: [] }); } return netOf.get(r); };
 for (const k of [...uf.p.keys()]) { const t = term(k); if (t >= 0) nets[t].members.push(k); }
 const iu = new UnionFind();
 const used = new Set();
 for (const q of prims) {
 const ts = TERMINALS[q.kind].map((t) => term(q[t])).filter((t) => t >= 0);
 for (const t of ts) { iu.find(t); used.add(t); }
 for (let i = 1; i < ts.length; i++) iu.union(ts[0], ts[i]);
 }
 const padNet = new Int32Array(30).fill(-1);
 for (let g = 0; g < 30; g++) if (uf.p.has(`p:${g}`)) padNet[g] = term(`p:${g}`);
 const padsOnNet = new Map();
 for (let g = 0; g < 30; g++) if (padNet[g] >= 0) padsOnNet.set(padNet[g], (padsOnNet.get(padNet[g]) ?? 0) + 1);
 for (const [t, k] of padsOnNet) if (k >= 2 && !used.has(t)) { iu.find(t); used.add(t); }
 const islandOf = new Map(), islands = [];
 for (const t of [...used].sort((a, b) => a - b)) {
 const r = iu.find(t);
 if (!islandOf.has(r)) { islandOf.set(r, islands.length); islands.push({ nets: [], prims: [], pads: [], controls: [], leds: [], caps: [] }); }
 const isl = islands[islandOf.get(r)];
 isl.local ??= new Map();
 isl.local.set(t, isl.nets.length); isl.nets.push(t);
 }
 const controls = new Map(), leds = [];
 for (const q of prims) {
 const ts = TERMINALS[q.kind].map((t) => term(q[t]));
 const first = ts.find((t) => t >= 0);
 if (first === undefined) {
 continue;
 }
 const ii = islandOf.get(iu.find(first)), isl = islands[ii];
 const loc = (t) => (t >= 0 ? isl.local.get(t) : t);
 const p = { ...q }; for (const [j, t] of TERMINALS[q.kind].entries()) p[t] = loc(ts[j]);
 if (p.control !== undefined) {
 if (!controls.has(p.control)) controls.set(p.control, p.kind === 'RX' ? { island: ii, kind: 'env', default: rxValue(p, ENV_DEFAULTS), prim: p }
 : { island: ii, kind: p.kind === 'POT' ? 'position' : 'switch', default: p.kind === 'POT' ? (p.control === DEMO_KNOB ? 0 : 0.5) : 0 });
 isl.controls.includes(p.control) || isl.controls.push(p.control);
 }
 if (p.kind === 'D' || p.kind === 'Q') p.pwl = true;
 if (p.kind === 'C') isl.caps.push(isl.prims.length);
 if (p.led) { leds.push({ island: ii, prim: isl.prims.length, part: p.part, sub: p.sub, color: p.color, fixed: p.fixed }); isl.leds.push(isl.prims.length); }
 isl.prims.push(p);
 }
 const padIsland = new Int16Array(30).fill(-1), padNode = new Int16Array(30).fill(-1);
 let mask = 0;
 for (let g = 0; g < 30; g++) {
 if (padRail[g] >= 0) { mask |= 1 << g; continue; }
 if (padNet[g] < 0) continue;
 const t = padNet[g], r = islandOf.get(iu.find(t));
 if (r === undefined || !used.has(t)) continue;
 padIsland[g] = r; padNode[g] = islands[r].local.get(t);
 islands[r].pads.push(g);
 (islands[r].padNodeOf ??= {})[g] = padNode[g];
 mask |= 1 << g;
 }
 const netNames = nets.map((n) => netName(n.members));
 const where = (key) => {
 const t = term(key);
 if (t < 0) return { rail: RAILS[-t - 1], name: RAILS[-t - 1] };
 const r = islandOf.get(iu.find(t));
 return r === undefined || !used.has(t) ? { net: t, name: netNames[t] } : { net: t, name: netNames[t], island: r, node: islands[r].local.get(t) };
 };
 const pins = new Map();
 for (const k of uf.p.keys()) if (k.startsWith('t:')) pins.set(k.slice(2), where(k));
 const ends = new Map([...uf.p.keys()].filter((k) => /^[tpjr]:/.test(k)).map((k) => [k, where(k)]));
 for (const isl of islands) { isl.padNodeOf ??= {}; isl.n = isl.nets.length; isl.netNames = isl.nets.map((t) => netNames[t]); delete isl.local; }
 const netPads = new Map();
 for (let g = 0; g < 30; g++) if (padNet[g] >= 0) (netPads.get(padNet[g]) ?? netPads.set(padNet[g], []).get(padNet[g])).push(g);
 const v33 = -(RAILS.indexOf('3V3') + 1);
 const pulled = (t) => prims.some((q) => q.kind === 'R' && ((term(q.a) === t && term(q.b) === v33) || (term(q.b) === t && term(q.a) === v33)));
 const pinInfo = (id, pin) => {
 if (!uf.p.has(`t:${id}.${pin}`)) return { rail: null, pads: [], pullUp: false };
 const t = term(`t:${id}.${pin}`);
 return t < 0 ? { rail: RAILS[-t - 1], pads: [], pullUp: false } : { rail: null, pads: netPads.get(t) ?? [], pullUp: pulled(t), net: t };
 };
 const modules = [], sounders = [];
 for (const part of c.parts) {
 const type = PART_TYPES[part.type];
 if (type?.module) {
 const pinsOf = Object.fromEntries(type.pins.map((n) => [n, pinInfo(part.id, n)]));
 const addr = part.address ?? type.attrs.address?.default;
 modules.push({ id: part.id, type: part.type, ...type.module, address: addr ? parseInt(addr, 16) : null, pins: pinsOf,
 powered: ['3V3', 'VSYS', 'VBUS'].includes(pinsOf.VCC.rail) && pinsOf.GND.rail === 'GND' });
 }
 if (type?.sounds) sounders.push({ id: part.id, type: part.type, pads: pinInfo(part.id, '+').pads });
 }
 const tap = sounders.find((x) => x.pads.length)?.pads[0] ?? -1;
 const text = canonicalText(c);
 return { islands, padIsland, padNode, padRail, mask: mask >>> 0, controls, leds, hash: hashText(text), user: c.parts.length > 0, kit,
 modules, sounders, tap,
 pins, ends, nets: nets.map((n, i) => ({ name: netNames[i], members: n.members.filter((k) => /^[tpl]:/.test(k)).map((k) => (k.startsWith('p:') ? `GP${k.slice(2)}` : k.slice(2))) })) };
}
function netName(members) {
 const pad = members.find((k) => k.startsWith('p:'));
 if (pad) return `GP${pad.slice(2)}`;
 const l = members.find((k) => k.startsWith('l:'));
 if (l) return l.slice(2);
 const t = members.filter((k) => k.startsWith('t:') || k.startsWith('j:') || k.startsWith('i:')).sort()[0];
 return t ? t.slice(2) : '?';
}
