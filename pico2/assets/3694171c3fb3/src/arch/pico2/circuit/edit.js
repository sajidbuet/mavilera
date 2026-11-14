// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { validateCircuit, emptyCircuit, parseEnd, GPIO_PADS, RAIL_PADS } from './format.js';
import { PART_TYPES } from './library.js';
import { partPins } from '../ui/circuit-sheet.js';
export const PREFIX = Object.freeze({ capacitor: 'C', resistor: 'R', potentiometer: 'RV', button: 'SW', switch: 'S', led: 'D', diode: 'D', npn: 'Q', ground: 'GND', power: 'PWR' });
export const PLACE = Object.freeze({ x0: -444.5, y0: 838.2, dx: 304.8, dy: 190.5, cols: 5 });
const copy = (c) => JSON.parse(JSON.stringify(c ?? emptyCircuit()));
const endsOn = (w, pin) => w.a === pin || w.b === pin;
export function freeId(c, type) {
 const p = PREFIX[type] ?? 'U', used = new Set((c?.parts ?? []).map((x) => x.id));
 for (let i = 1; ; i++) if (!used.has(`${p}${i}`)) return `${p}${i}`;
}
export function freePlace(c) {
 const taken = new Set((c?.parts ?? []).map((p) => `${p.x},${p.y}`));
 for (let k = 0; ; k++) { const x = PLACE.x0 + (k % PLACE.cols) * PLACE.dx, y = PLACE.y0 + Math.floor(k / PLACE.cols) * PLACE.dy; if (!taken.has(`${x},${y}`)) return { x, y }; }
}
export function addPart(c, type) {
 if (!PART_TYPES[type] && !(c?.defs ?? []).some((d) => d.type === type)) throw new Error(`unknown part type ${type}`);
 const out = copy(c), id = freeId(out, type);
 out.parts.push({ id, type, ...freePlace(out) });
 return { circuit: validateCircuit(out), id };
}
export function removePart(c, id) {
 const out = copy(c), pre = `${id}.`;
 out.parts = out.parts.filter((p) => p.id !== id);
 out.wires = out.wires.filter((w) => !w.a.startsWith(pre) && !w.b.startsWith(pre));
 out.labels = out.labels.filter((l) => !l.at.startsWith(pre));
 return validateCircuit(out);
}
export function setAttr(c, id, key, value) {
 const out = copy(c), p = out.parts.find((x) => x.id === id);
 if (!p) throw new Error(`no part ${id}`);
 if (value === null || value === undefined || value === '') delete p[key]; else p[key] = value;
 return validateCircuit(out);
}
export function connectPin(c, pin, to) {
 const out = copy(c);
 const e = parseEnd(pin);
 if (e?.kind !== 'pin') throw new Error(`not a part's pin: ${pin}`);
 out.wires = out.wires.filter((w) => !endsOn(w, pin));
 out.labels = out.labels.filter((l) => l.at !== pin);
 if (to) {
 const part = out.parts.find((p) => p.id === e.part);
 const q = partPins(part, out.defs).find((x) => x.pin === e.pin) ?? { x: part.x, y: part.y, out: [1, 0] };
 if (GPIO_PADS.includes(to) || RAIL_PADS.includes(to)) out.wires.push({ a: pin, b: to });
 else out.labels.push({ net: to, at: pin, x: Math.round((q.x + q.out[0] * 8) * 10) / 10 + 0, y: Math.round((q.y + q.out[1] * 14) * 10) / 10 + 0 });
 }
 return validateCircuit(out);
}
export function freeNet(c) {
 const used = new Set((c?.labels ?? []).map((l) => l.net));
 for (let i = 1; ; i++) if (!used.has(`N${i}`)) return `N${i}`;
}
export function pinTarget(c, pin) {
 const w = (c?.wires ?? []).find((x) => endsOn(x, pin) && parseEnd(x.a === pin ? x.b : x.a)?.kind === 'pad');
 if (w) return w.a === pin ? w.b : w.a;
 return (c?.labels ?? []).find((l) => l.at === pin)?.net ?? '';
}
const refKind = (r) => r.slice(0, r.indexOf(':'));
const refKey = (r) => r.slice(r.indexOf(':') + 1);
function tidy(p) { if (!p.rot) delete p.rot; if (!p.flip) delete p.flip; return p; }
export function addPartAt(c, type, x, y, { rot = 0, flip = false } = {}) {
 if (!PART_TYPES[type]) throw new Error(`unknown part type ${type}`);
 const out = copy(c), id = freeId(out, type);
 out.parts.push(tidy({ id, type, x, y, rot, flip }));
 return { circuit: validateCircuit(out), id };
}
export function rotatePart(c, id) {
 const out = copy(c), p = out.parts.find((x) => x.id === id);
 if (!p) throw new Error(`no part ${id}`);
 p.rot = ((p.rot ?? 0) + 90) % 360;
 tidy(p);
 return validateCircuit(out);
}
export function mirrorPart(c, id) {
 const out = copy(c), p = out.parts.find((x) => x.id === id);
 if (!p) throw new Error(`no part ${id}`);
 p.flip = !p.flip;
 tidy(p);
 return validateCircuit(out);
}
export function moveRefs(c, refs, dx, dy) {
 const out = copy(c), set = new Set(refs);
 const parts = new Set(refs.filter((r) => refKind(r) === 'part').map(refKey)), nodes = new Set(refs.filter((r) => refKind(r) === 'node').map(refKey));
 const r1 = (v) => Math.round(v * 10) / 10 + 0;
 const moves = (end) => { const e = parseEnd(end); return e?.kind === 'pin' ? parts.has(e.part) : e?.kind === 'node' ? nodes.has(e.id) : false; };
 for (const p of out.parts) if (parts.has(p.id)) { p.x = r1(p.x + dx); p.y = r1(p.y + dy); }
 for (const n of out.nodes) if (nodes.has(n.id)) { n.x = r1(n.x + dx); n.y = r1(n.y + dy); }
 out.labels.forEach((l, i) => { if (set.has(`label:${i}`) || moves(l.at)) { l.x = r1(l.x + dx); l.y = r1(l.y + dy); } });
 out.wires.forEach((w, i) => {
 if (w.via && (set.has(`wire:${i}`) || (moves(w.a) && moves(w.b)))) w.via = w.via.map(([x, y]) => [r1(x + dx), r1(y + dy)]);
 });
 return validateCircuit(out);
}
export function freeNode(c) {
 const used = new Set((c?.nodes ?? []).map((n) => n.id));
 for (let i = 1; ; i++) if (!used.has(`J${i}`)) return `J${i}`;
}
export function addNode(c, x, y) {
 const out = copy(c), id = freeNode(out);
 out.nodes.push({ id, x, y });
 return { circuit: validateCircuit(out), id };
}
export function addWire(c, a, b, via = []) {
 if (a === b) throw new Error('a wire from a point to itself');
 if ((c?.wires ?? []).some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) throw new Error(`${a} and ${b} are already wired`);
 const out = copy(c);
 out.wires.push(via.length ? { a, b, via: via.map(([x, y]) => [x, y]) } : { a, b });
 return validateCircuit(out);
}
export function splitWire(c, wi, x, y, path) {
 const w = c.wires[wi];
 if (!w || !path || path.length < 2) throw new Error(`no wire ${wi}`);
 let seg = 0;
 for (let i = 1; i < path.length; i++) {
 const [x1, y1] = path[i - 1], [x2, y2] = path[i];
 if (x >= Math.min(x1, x2) - 0.05 && x <= Math.max(x1, x2) + 0.05 && y >= Math.min(y1, y2) - 0.05 && y <= Math.max(y1, y2) + 0.05) { seg = i; break; }
 }
 if (!seg) throw new Error('the point is not on the wire');
 const out = copy(c), id = freeNode(out);
 out.nodes.push({ id, x, y });
 const before = path.slice(1, seg).filter(([px, py]) => px !== x || py !== y), after = path.slice(seg, -1).filter(([px, py]) => px !== x || py !== y);
 out.wires.splice(wi, 1);
 out.wires.push(before.length ? { a: w.a, b: id, via: before } : { a: w.a, b: id }, after.length ? { a: id, b: w.b, via: after } : { a: id, b: w.b });
 return { circuit: validateCircuit(out), id };
}
export function moveBend(c, wi, bi, x, y) {
 const out = copy(c), w = out.wires[wi];
 if (!w?.via?.[bi]) throw new Error(`no bend ${bi} on wire ${wi}`);
 w.via[bi] = [x, y];
 return validateCircuit(out);
}
export function addBend(c, wi, x, y, path) {
 const out = copy(c), w = out.wires[wi];
 if (!w || !path) throw new Error(`no wire ${wi}`);
 const inner = path.slice(1, -1);
 let at = inner.length;
 for (let i = 1; i < path.length; i++) {
 const [x1, y1] = path[i - 1], [x2, y2] = path[i];
 if (x >= Math.min(x1, x2) - 0.05 && x <= Math.max(x1, x2) + 0.05 && y >= Math.min(y1, y2) - 0.05 && y <= Math.max(y1, y2) + 0.05) { at = i - 1; break; }
 }
 const via = [...inner.slice(0, at), [x, y], ...inner.slice(at)];
 if (via.length > 32) throw new Error('at most 32 bends on a wire');
 w.via = via;
 return validateCircuit(out);
}
export function removeBend(c, wi, bi) {
 const out = copy(c), w = out.wires[wi];
 if (!w?.via?.[bi]) throw new Error(`no bend ${bi} on wire ${wi}`);
 w.via.splice(bi, 1);
 if (!w.via.length) delete w.via;
 return validateCircuit(out);
}
export function addLabel(c, net, at, x, y) {
 const out = copy(c);
 out.labels.push({ net, at, x, y });
 const v = validateCircuit(out);
 return { circuit: v, index: v.labels.findIndex((l) => l.net === net && l.at === at && l.x === x && l.y === y) };
}
export function renameLabel(c, i, net) {
 const out = copy(c);
 if (!out.labels[i]) throw new Error(`no label ${i}`);
 out.labels[i].net = net;
 return validateCircuit(out);
}
export function removeRefs(c, refs) {
 const out = copy(c), set = new Set(refs);
 const parts = new Set(refs.filter((r) => refKind(r) === 'part').map(refKey)), nodes = new Set(refs.filter((r) => refKind(r) === 'node').map(refKey));
 const gone = (end) => { const e = parseEnd(end); return e?.kind === 'pin' ? parts.has(e.part) : e?.kind === 'node' ? nodes.has(e.id) : false; };
 out.parts = out.parts.filter((p) => !parts.has(p.id));
 out.nodes = out.nodes.filter((n) => !nodes.has(n.id));
 out.wires = out.wires.filter((w, i) => !set.has(`wire:${i}`) && !gone(w.a) && !gone(w.b));
 out.labels = out.labels.filter((l, i) => !set.has(`label:${i}`) && !gone(l.at));
 return validateCircuit(out);
}
export function copyRefs(c, refs) {
 const parts = new Set(refs.filter((r) => refKind(r) === 'part').map(refKey)), nodes = new Set(refs.filter((r) => refKind(r) === 'node').map(refKey));
 const inside = (end) => { const e = parseEnd(end); return e?.kind === 'pin' ? parts.has(e.part) : e?.kind === 'node' ? nodes.has(e.id) : e?.kind === 'pad'; };
 const ends = (w) => inside(w.a) && inside(w.b) && !(parseEnd(w.a).kind === 'pad' && parseEnd(w.b).kind === 'pad');
 return JSON.parse(JSON.stringify({
 parts: c.parts.filter((p) => parts.has(p.id)), nodes: c.nodes.filter((n) => nodes.has(n.id)),
 wires: c.wires.filter((w) => ends(w)), labels: c.labels.filter((l) => { const e = parseEnd(l.at); return e?.kind === 'pin' ? parts.has(e.part) : e?.kind === 'node' && nodes.has(e.id); }),
 }));
}
export function pasteClip(c, clip, dx, dy) {
 const out = copy(c), names = new Map();
 const r1 = (v) => Math.round(v * 10) / 10 + 0;
 for (const p of clip.parts) { const id = freeId(out, p.type); names.set(p.id, id); out.parts.push({ ...p, id, x: r1(p.x + dx), y: r1(p.y + dy) }); }
 for (const n of clip.nodes) { const id = freeNode(out); names.set(n.id, id); out.nodes.push({ id, x: r1(n.x + dx), y: r1(n.y + dy) }); }
 const ren = (end) => { const e = parseEnd(end); return e?.kind === 'pin' ? `${names.get(e.part)}.${e.pin}` : e?.kind === 'node' ? names.get(e.id) : end; };
 for (const w of clip.wires) out.wires.push({ a: ren(w.a), b: ren(w.b), ...(w.via ? { via: w.via.map(([x, y]) => [r1(x + dx), r1(y + dy)]) } : {}) });
 for (const l of clip.labels) out.labels.push({ ...l, at: ren(l.at), x: r1(l.x + dx), y: r1(l.y + dy) });
 const v = validateCircuit(out);
 return { circuit: v, refs: [...[...names.entries()].filter(([k]) => clip.parts.some((p) => p.id === k)).map(([, id]) => `part:${id}`), ...[...names.entries()].filter(([k]) => clip.nodes.some((n) => n.id === k)).map(([, id]) => `node:${id}`)] };
}
