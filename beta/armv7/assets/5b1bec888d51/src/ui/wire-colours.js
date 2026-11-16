// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const WIRE_COLOURS = 6;
function segments(points) {
 const out = [];
 for (let i = 1; i < points.length; i++) {
 const [x0, y0] = points[i - 1];
 const [x1, y1] = points[i];
 if (Math.abs(y1 - y0) < 1e-6 && Math.abs(x1 - x0) > 1e-6) out.push({ h: true, at: y0, lo: Math.min(x0, x1), hi: Math.max(x0, x1) });
 else if (Math.abs(x1 - x0) < 1e-6 && Math.abs(y1 - y0) > 1e-6) out.push({ h: false, at: x0, lo: Math.min(y0, y1), hi: Math.max(y0, y1) });
 }
 return out;
}
export function runClose(a, b, { gap = 0.65, overlap = 0.25 } = {}) {
 for (const s of segments(a)) {
 for (const t of segments(b)) {
 if (s.h !== t.h || Math.abs(s.at - t.at) > gap) continue;
 if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) >= overlap) return true;
 }
 }
 return false;
}
export function colourWires(wires, opts = {}) {
 const nets = new Map();
 for (const w of wires) {
 const key = w.signal || w.id;
 if (!nets.has(key)) nets.set(key, { ids: [], lines: [] });
 nets.get(key).ids.push(w.id);
 nets.get(key).lines.push(w.points);
 }
 const keys = [...nets.keys()];
 const near = new Map(keys.map((k) => [k, new Set()]));
 for (let i = 0; i < keys.length; i++) {
 for (let j = i + 1; j < keys.length; j++) {
 const a = nets.get(keys[i]).lines;
 const b = nets.get(keys[j]).lines;
 if (a.some((p) => b.some((q) => runClose(p, q, opts)))) {
 near.get(keys[i]).add(keys[j]);
 near.get(keys[j]).add(keys[i]);
 }
 }
 }
 const order = keys.slice().sort((x, y) => near.get(y).size - near.get(x).size || (x < y ? -1 : 1));
 const colour = new Map();
 for (const k of order) {
 const taken = new Set([...near.get(k)].map((n) => colour.get(n)).filter((c) => c !== undefined));
 let c = 0;
 while (taken.has(c) && c < WIRE_COLOURS - 1) c++;
 colour.set(k, c);
 }
 const out = new Map();
 for (const [k, n] of nets) for (const id of n.ids) out.set(id, colour.get(k));
 return out;
}
