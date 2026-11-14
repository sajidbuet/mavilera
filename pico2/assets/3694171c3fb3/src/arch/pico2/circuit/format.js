// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { PART_TYPES, PRIM_KINDS } from './library.js';
import { withDemo } from './demo.js';
export const FORMAT = 'mavilera-pico2-circuit';
export const VERSION = 2;
export const LIMITS = Object.freeze({ parts: 64, wires: 256, nodes: 128, labels: 32, defs: 16, bytes: 64 * 1024, via: 32 });
export const RAIL_PADS = Object.freeze(['GND', 'AGND', '3V3', 'VSYS', 'VBUS', 'ADC_VREF']);
export const GPIO_PADS = Object.freeze([...Array(23).keys(), 26, 27, 28].map((n) => `GP${n}`));
export const NOT_CONNECTABLE = Object.freeze(['RUN', '3V3_EN']);
const ID = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const NET_NAME = /^[A-Za-z][A-Za-z0-9_+\-]{0,15}$/;
export class CircuitError extends Error {
 constructor(field, message) { super(`${field}: ${message}`); this.field = field; }
}
const MULT = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, m: 1e-3, R: 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
export function parseValue(v) {
 if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
 if (typeof v !== 'string') return NaN;
 const s = v.trim().replace(/(ohms?|Ω|F|V|A|Hz)$/i, '');
 let k = /^(\d+(?:\.\d+)?)([pnuµmRkKMG])?$/.exec(s);
 if (k) return Number(k[1]) * (k[2] ? MULT[k[2]] : 1);
 k = /^(\d+)([pnuµmRkKMG])(\d+)$/.exec(s);
 if (k) return Number(`${k[1]}.${k[3]}`) * MULT[k[2]];
 return NaN;
}
export function formatValue(x, unit = '') {
 if (!Number.isFinite(x)) return '?';
 const steps = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p']];
 for (const [f, p] of steps) if (Math.abs(x) >= f || f === 1e-12) return `${+(x / f).toPrecision(3)} ${p}${unit}`.replace(/ $/, '');
 return String(x);
}
export function parseEnd(s) {
 if (typeof s !== 'string') return null;
 if (GPIO_PADS.includes(s) || RAIL_PADS.includes(s)) return { kind: 'pad', name: s };
 if (/^J\d{1,4}$/.test(s)) return { kind: 'node', id: s };
 const k = /^([A-Za-z][A-Za-z0-9_]{0,15})\.([A-Za-z0-9+\-]{1,8})$/.exec(s);
 return k ? { kind: 'pin', part: k[1], pin: k[2] } : null;
}
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const coord = (x) => isNum(x) && Math.abs(x) <= 1e5;
const only = (o, keys, field) => { for (const k of Object.keys(o)) if (!keys.includes(k)) throw new CircuitError(field, `unknown field "${k}"`); };
function typeOf(type, defs) { return PART_TYPES[type] ?? defs.get(type) ?? null; }
function checkDef(d, i, PRIM_KINDS) {
 const f = `defs[${i}]`;
 if (!d || typeof d !== 'object') throw new CircuitError(f, 'not an object');
 only(d, ['type', 'label', 'pins', 'symbol', 'primitives'], f);
 if (typeof d.type !== 'string' || !ID.test(d.type) || PART_TYPES[d.type]) throw new CircuitError(`${f}.type`, 'a new type name is needed');
 if (!Array.isArray(d.pins) || d.pins.length < 1 || d.pins.length > 16) throw new CircuitError(`${f}.pins`, '1 to 16 pins');
 const pins = new Set();
 for (const p of d.pins) {
 if (!p || typeof p.name !== 'string' || !/^[A-Za-z0-9+\-]{1,8}$/.test(p.name) || !coord(p.x) || !coord(p.y)) throw new CircuitError(`${f}.pins`, 'each pin needs a name, x and y');
 pins.add(p.name);
 }
 if (!Array.isArray(d.primitives) || d.primitives.length < 1 || d.primitives.length > 32) throw new CircuitError(`${f}.primitives`, '1 to 32 primitives');
 for (const [j, p] of d.primitives.entries()) {
 const spec = PRIM_KINDS[p?.kind], g = `${f}.primitives[${j}]`;
 if (!spec || p.kind === 'RX') throw new CircuitError(g, `unknown kind ${JSON.stringify(p?.kind)} (R, SW, POT, D, Q or C)`);
 for (const t of spec.terminals) if (!pins.has(p[t])) throw new CircuitError(`${g}.${t}`, 'not one of the part\'s pins');
 const allowed = { R: ['r'], POT: ['r'], C: ['c'], D: ['color', 'diode'], SW: ['nc'], Q: ['beta'] }[p.kind] ?? [];
 only(p, ['kind', ...spec.terminals, ...allowed], g);
 const val = (k, min, max, unit) => { const x = parseValue(p[k]); if (!(x >= min && x <= max)) throw new CircuitError(`${g}.${k}`, `a value from ${formatValue(min, unit)} to ${formatValue(max, unit)}`); };
 if (p.kind === 'R' || p.kind === 'POT') val('r', 1, 1e7, 'Ω');
 if (p.kind === 'C') val('c', 1e-12, 1, 'F');
 if (p.kind === 'Q' && p.beta !== undefined) val('beta', 10, 1000, '');
 if (p.kind === 'D' && p.color !== undefined && !PART_TYPES.led.attrs.color.values.includes(p.color)) throw new CircuitError(`${g}.color`, `one of ${PART_TYPES.led.attrs.color.values.join(', ')}`);
 if (p.kind === 'D' && p.diode !== undefined && !PART_TYPES.diode.attrs.kind.values.includes(p.diode)) throw new CircuitError(`${g}.diode`, 'silicon or schottky');
 if (p.kind === 'SW' && p.nc !== undefined && typeof p.nc !== 'boolean') throw new CircuitError(`${g}.nc`, 'true or false');
 }
 if (d.symbol !== undefined && (!Array.isArray(d.symbol) || d.symbol.some((x) => typeof x !== 'string' || x.length > 2000))) throw new CircuitError(`${f}.symbol`, 'a list of path strings');
 return { ...d, pins: d.pins.map((p) => p.name), pinPos: d.pins, custom: true };
}
export function validateCircuit(input) {
 let c = input;
 if (typeof input === 'string') {
 if (new TextEncoder().encode(input).length > LIMITS.bytes) throw new CircuitError('file', 'larger than 64 KiB');
 try { c = JSON.parse(input); } catch (e) { throw new CircuitError('file', `not JSON (${e.message})`); }
 }
 if (!c || typeof c !== 'object' || Array.isArray(c)) throw new CircuitError('file', 'not an object');
 only(c, ['_copyright', 'format', 'version', 'parts', 'nodes', 'wires', 'labels', 'defs'], 'file');
 if (c._copyright !== undefined && (typeof c._copyright !== 'string' || c._copyright.length > 500)) throw new CircuitError('_copyright', 'a line of text');
 if (c.format !== FORMAT) throw new CircuitError('format', `expected "${FORMAT}"`);
 if (c.version !== VERSION && c.version !== 1) throw new CircuitError('version', `expected ${VERSION}`);
 if (c.version === 1) {
 for (const k of ['parts', 'wires']) if (c[k] !== undefined && !Array.isArray(c[k])) throw new CircuitError(k, 'not a list');
 c = { ...withDemo({ ...c, parts: c.parts ?? [], wires: c.wires ?? [] }), version: VERSION };
 }
 const list = (k, max) => { const v = c[k] ?? []; if (!Array.isArray(v)) throw new CircuitError(k, 'not a list'); if (v.length > max) throw new CircuitError(k, `more than ${max}`); return v; };
 const defsIn = list('defs', LIMITS.defs), partsIn = list('parts', LIMITS.parts), nodesIn = list('nodes', LIMITS.nodes);
 const wiresIn = list('wires', LIMITS.wires), labelsIn = list('labels', LIMITS.labels);
 const defs = new Map();
 defsIn.forEach((d, i) => { const t = checkDef(d, i, PRIM_KINDS); if (defs.has(t.type)) throw new CircuitError(`defs[${i}].type`, 'defined twice'); defs.set(t.type, t); });
 const ids = new Set(), parts = [];
 partsIn.forEach((p, i) => {
 const f = `parts[${i}]`;
 if (!p || typeof p !== 'object') throw new CircuitError(f, 'not an object');
 if (typeof p.id !== 'string' || !ID.test(p.id) || /^J\d+$/.test(p.id)) throw new CircuitError(`${f}.id`, 'a name of letters and digits, starting with a letter (not J and a number)');
 if (ids.has(p.id)) throw new CircuitError(`${f}.id`, `"${p.id}" used twice`);
 ids.add(p.id);
 const t = typeOf(p.type, defs);
 if (!t) throw new CircuitError(`${f}.type`, `unknown part type ${JSON.stringify(p.type)}`);
 only(p, ['id', 'type', 'x', 'y', 'rot', 'flip', ...Object.keys(t.attrs ?? {})], f);
 if (!coord(p.x) || !coord(p.y)) throw new CircuitError(`${f}.x`, 'x and y are numbers');
 if (p.rot !== undefined && ![0, 90, 180, 270].includes(p.rot)) throw new CircuitError(`${f}.rot`, '0, 90, 180 or 270');
 if (p.flip !== undefined && typeof p.flip !== 'boolean') throw new CircuitError(`${f}.flip`, 'true or false');
 for (const [k, a] of Object.entries(t.attrs ?? {})) {
 if (p[k] === undefined) continue;
 if (a.kind === 'choice') { if (!a.values.includes(p[k])) throw new CircuitError(`${f}.${k}`, `one of ${a.values.join(', ')}`); continue; }
 const x = parseValue(p[k]);
 if (!(x >= a.min && x <= a.max)) throw new CircuitError(`${f}.${k}`, `a value from ${formatValue(a.min, a.unit)} to ${formatValue(a.max, a.unit)}`);
 }
 parts.push({ ...p });
 });
 const pinsOf = new Map(parts.map((p) => [p.id, typeOf(p.type, defs).pins]));
 const nodeIds = new Set(), nodes = [];
 nodesIn.forEach((n, i) => {
 const f = `nodes[${i}]`;
 if (!n || typeof n.id !== 'string' || !/^J\d{1,4}$/.test(n.id) || !coord(n.x) || !coord(n.y)) throw new CircuitError(f, 'a node needs an id J<n>, x and y');
 only(n, ['id', 'x', 'y'], f);
 if (nodeIds.has(n.id)) throw new CircuitError(`${f}.id`, 'used twice');
 nodeIds.add(n.id); nodes.push({ id: n.id, x: n.x, y: n.y });
 });
 const checkEnd = (s, f) => {
 const e = parseEnd(s);
 if (!e) throw new CircuitError(f, NOT_CONNECTABLE.includes(s) ? `${s} cannot be connected (not modelled)` : `not a pin, pad or node: ${JSON.stringify(s)}`);
 if (e.kind === 'node' && !nodeIds.has(e.id)) throw new CircuitError(f, `no node ${e.id}`);
 if (e.kind === 'pin') {
 const pins = pinsOf.get(e.part);
 if (!pins) throw new CircuitError(f, `no part ${e.part}`);
 if (!pins.includes(e.pin)) throw new CircuitError(f, `${e.part} has no pin ${e.pin} (pins: ${pins.join(', ')})`);
 }
 return s;
 };
 const wires = wiresIn.map((w, i) => {
 const f = `wires[${i}]`;
 if (!w || typeof w !== 'object') throw new CircuitError(f, 'not an object');
 only(w, ['a', 'b', 'via'], f);
 let a = checkEnd(w.a, `${f}.a`), b = checkEnd(w.b, `${f}.b`);
 if (a === b) throw new CircuitError(f, 'a wire from a point to itself');
 let via = w.via ?? [];
 if (!Array.isArray(via) || via.length > LIMITS.via || via.some((p) => !Array.isArray(p) || p.length !== 2 || !coord(p[0]) || !coord(p[1]))) throw new CircuitError(`${f}.via`, 'a list of [x, y] points');
 via = via.map((p) => [p[0], p[1]]);
 if (b < a) { [a, b] = [b, a]; via = via.reverse(); }
 return via.length ? { a, b, via } : { a, b };
 });
 const labels = labelsIn.map((l, i) => {
 const f = `labels[${i}]`;
 if (!l || typeof l !== 'object') throw new CircuitError(f, 'not an object');
 only(l, ['net', 'at', 'x', 'y'], f);
 if (typeof l.net !== 'string' || (!NET_NAME.test(l.net) && !RAIL_PADS.includes(l.net)) || NOT_CONNECTABLE.includes(l.net)) throw new CircuitError(`${f}.net`, 'a name of letters and digits');
 if (/^GP\d+$/.test(l.net) && !GPIO_PADS.includes(l.net)) throw new CircuitError(`${f}.net`, `${l.net} is not on the board's edge`);
 checkEnd(l.at, `${f}.at`);
 if (!coord(l.x) || !coord(l.y)) throw new CircuitError(f, 'x and y are numbers');
 return { net: l.net, at: l.at, x: l.x, y: l.y };
 });
 const byStr = (k) => (p, q) => (p[k] < q[k] ? -1 : p[k] > q[k] ? 1 : 0);
 parts.sort(byStr('id')); nodes.sort(byStr('id'));
 wires.sort((p, q) => (p.a + ' ' + p.b < q.a + ' ' + q.b ? -1 : p.a + ' ' + p.b > q.a + ' ' + q.b ? 1 : 0));
 labels.sort((p, q) => (p.net + p.at < q.net + q.at ? -1 : p.net + p.at > q.net + q.at ? 1 : 0));
 const out = { ...(c._copyright !== undefined ? { _copyright: c._copyright } : {}), format: FORMAT, version: VERSION, parts, nodes, wires, labels, defs: defsIn.map((d) => JSON.parse(JSON.stringify(d))).sort(byStr('type')) };
 return out;
}
export const canonicalText = (c) => JSON.stringify(c);
export const emptyCircuit = () => ({ format: FORMAT, version: VERSION, parts: [], nodes: [], wires: [], labels: [], defs: [] });
