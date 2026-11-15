// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { PADS, BOARD, edgeX } from './board-geometry.js';
import { PART_TYPES } from '../circuit/library.js';
import { parseEnd } from '../circuit/format.js';
export const GRID = 12.7;
const r1 = (v) => Math.round(v * 10) / 10 + 0;
export const snap = (v) => r1(Math.round(v / GRID) * GRID);
export const gridIndex = (v) => Math.round(v / GRID);
const LEAD = 5 * GRID;
export const PIN_POS = Object.freeze({
 resistor: { 1: [-LEAD, 0], 2: [LEAD, 0] }, capacitor: { 1: [-LEAD, 0], 2: [LEAD, 0] },
 potentiometer: { 1: [-LEAD, 0], 2: [LEAD, 0], W: [0, 4 * GRID] },
 button: { 1: [-LEAD, 0], 2: [LEAD, 0] }, switch: { 1: [-LEAD, 0], 2: [LEAD, 0] },
 led: { A: [-LEAD, 0], K: [LEAD, 0] }, diode: { A: [-LEAD, 0], K: [LEAD, 0] },
 npn: { B: [-LEAD, 0], C: [2 * GRID, -LEAD], E: [2 * GRID, LEAD] },
 ground: { 1: [0, -2 * GRID] }, power: { 1: [0, 2 * GRID] },
 ldr: { 1: [-LEAD, 0], 2: [LEAD, 0] }, ntc: { 1: [-LEAD, 0], 2: [LEAD, 0] },
 rgb: { R: [-LEAD, -2 * GRID], G: [-LEAD, 0], B: [-LEAD, 2 * GRID], COM: [LEAD, 0] },
 sevenseg: { ...Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'DP'].map((s, i) => [s, [-7 * GRID, (2 * i - 7) * GRID]])), COM: [7 * GRID, 0] },
 speaker: { '+': [-LEAD, -GRID], '-': [-LEAD, GRID] }, buzzer: { '+': [-LEAD, 0], '-': [LEAD, 0] },
 ...Object.fromEntries(['bmp280', 'mpu6050', 'mcp9808', 'eeprom24c02'].map((t) => [t, { VCC: [-10 * GRID, -GRID], GND: [-10 * GRID, GRID], SDA: [10 * GRID, -GRID], SCL: [10 * GRID, GRID] }])),
 lcd1602: { VCC: [-14 * GRID, -GRID], GND: [-14 * GRID, GRID], SDA: [14 * GRID, -GRID], SCL: [14 * GRID, GRID] },
 bme280: { SDI: [-10 * GRID, -4 * GRID], SCK: [-10 * GRID, -2 * GRID], CSB: [-10 * GRID, 2 * GRID], SDO: [-10 * GRID, 4 * GRID], VCC: [10 * GRID, -GRID], GND: [10 * GRID, GRID] },
});
const MOD = [-8 * GRID, -2.5 * GRID, 8 * GRID, 2.5 * GRID];
const BODY = Object.freeze({ npn: [-42, -42, 42, 42], potentiometer: [-45, -26, 45, 40], ground: [-15, -20, 15, 20], power: [-15, -24, 15, 20],
 ldr: [-45, -44, 45, 26], rgb: [-40, -40, 40, 40], sevenseg: [-5 * GRID, -7 * GRID, 5 * GRID, 7 * GRID], speaker: [-50, -40, 40, 40],
 bmp280: MOD, mpu6050: MOD, mcp9808: MOD, eeprom24c02: MOD, lcd1602: [-12 * GRID, -5 * GRID, 12 * GRID, 5 * GRID], bme280: [-8 * GRID, -6 * GRID, 8 * GRID, 6 * GRID],
 default: [-45, -26, 45, 26] });
export function turn(dx, dy, rot = 0, flip = false) {
 const x = flip ? -dx : dx;
 switch (rot) {
 case 90: return [-dy + 0, x + 0];
 case 180: return [-x + 0, -dy + 0];
 case 270: return [dy + 0, -x + 0];
 default: return [x + 0, dy + 0];
 }
}
export const partTransform = (p) => `translate(${p.x} ${p.y})${p.rot ? ` rotate(${p.rot})` : ''}${p.flip ? ' scale(-1 1)' : ''}`;
export function pinTable(type, defs = []) {
 if (PIN_POS[type]) return PIN_POS[type];
 const d = defs.find((x) => x.type === type);
 return d ? Object.fromEntries(d.pins.map((p) => [p.name, [p.x, p.y]])) : {};
}
export function partPins(part, defs = []) {
 return Object.entries(pinTable(part.type, defs)).map(([pin, [dx, dy]]) => {
 const [x, y] = turn(dx, dy, part.rot, part.flip);
 const out = Math.abs(x) >= Math.abs(y) ? [Math.sign(x), 0] : [0, Math.sign(y)];
 return { pin, x: r1(part.x + x), y: r1(part.y + y), out };
 });
}
export function partBox(part) {
 const [a, b, c, d] = BODY[part.type] ?? BODY.default;
 const p1 = turn(a, b, part.rot, part.flip), p2 = turn(c, d, part.rot, part.flip);
 return { x0: part.x + Math.min(p1[0], p2[0]), y0: part.y + Math.min(p1[1], p2[1]), x1: part.x + Math.max(p1[0], p2[0]), y1: part.y + Math.max(p1[1], p2[1]) };
}
export const PAD_POINTS = Object.freeze(PADS.filter((p) => !['RUN', '3V3_EN'].includes(p.name)).map((p) => Object.freeze({
 name: p.name === '3V3(OUT)' ? '3V3' : p.name, x: r1(edgeX(p)), y: r1(p.y), side: p.side, pin: p.pin })));
export function padPoint(name, near = null) {
 const all = PAD_POINTS.filter((p) => p.name === name);
 if (!all.length) return null;
 if (!near || all.length === 1) return all[0];
 return all.reduce((b, p) => (Math.hypot(p.x - near.x, p.y - near.y) < Math.hypot(b.x - near.x, b.y - near.y) ? p : b));
}
export function endPoint(c, end, near = null) {
 const e = parseEnd(end);
 if (!e) return null;
 if (e.kind === 'pad') { const p = padPoint(e.name, near); return p ? { x: p.x, y: p.y, out: [p.side === 'left' ? -1 : 1, 0] } : null; }
 if (e.kind === 'node') { const n = c.nodes.find((x) => x.id === e.id); return n ? { x: n.x, y: n.y, out: null } : null; }
 const part = c.parts.find((x) => x.id === e.part);
 const p = part && partPins(part, c.defs).find((x) => x.pin === e.pin);
 return p ? { x: p.x, y: p.y, out: p.out } : null;
}
export function orthogonal(pts, startOut = null, endOut = null) {
 const out = [pts[0]];
 for (let i = 1; i < pts.length; i++) {
 const [x0, y0] = out[out.length - 1], [x1, y1] = pts[i];
 if (x0 !== x1 && y0 !== y1) {
 const s = i === 1 ? startOut : null, e = i === pts.length - 1 ? endOut : null;
 const vFirst = s ? s[1] !== 0 : e ? e[0] !== 0 : false;
 out.push(vFirst ? [x0, y1] : [x1, y0]);
 }
 if (x0 !== x1 || y0 !== y1) out.push([x1, y1]);
 }
 return out.length > 1 ? out : [pts[0], pts[0]];
}
export function wirePath(c, w) {
 const via = w.via ?? [];
 const isPad = (s) => parseEnd(s)?.kind === 'pad';
 let a = isPad(w.a) ? null : endPoint(c, w.a), b = isPad(w.b) ? null : endPoint(c, w.b);
 if (!a && !isPad(w.a)) return null;
 if (!b && !isPad(w.b)) return null;
 const first = via.length ? { x: via[0][0], y: via[0][1] } : null, last = via.length ? { x: via[via.length - 1][0], y: via[via.length - 1][1] } : null;
 if (!a) a = endPoint(c, w.a, first ?? b);
 if (!b) b = endPoint(c, w.b, last ?? a);
 if (!a || !b) return null;
 if (!via.length && (isPad(w.a) || isPad(w.b))) {
 const [p, q] = isPad(w.a) ? [a, b] : [b, a];
 if (p.y !== q.y || (q.x - p.x) * p.out[0] <= 0) return null;
 }
 return orthogonal([[a.x, a.y], ...via, [b.x, b.y]], a.out, b.out);
}
export function segments(paths) {
 const out = [];
 paths.forEach((pts, w) => { if (pts) for (let i = 1; i < pts.length; i++) out.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], w }); });
 return out;
}
const HOP = 6;
export function routeD(pts, obst = {}) {
 let d = `M${pts[0][0]} ${pts[0][1]}`;
 const inside = (c, a, b) => (c - a) * Math.sign(b - a) > HOP && (b - c) * Math.sign(b - a) > HOP;
 const between = (c, a, b) => c > Math.min(a, b) && c < Math.max(a, b);
 for (let i = 1; i < pts.length; i++) {
 const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
 if (y1 === y2 && x1 !== x2) {
 const dir = Math.sign(x2 - x1);
 const cs = (obst.v ?? []).filter((o) => inside(o.x, x1, x2) && between(y1, o.y1, o.y2)).map((o) => o.x).sort((a, b) => (a - b) * dir);
 for (const c of cs) d += ` L${c - dir * HOP} ${y1} A${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${c + dir * HOP} ${y1}`;
 } else if (x1 === x2 && y1 !== y2) {
 const dir = Math.sign(y2 - y1);
 const cs = (obst.h ?? []).filter((o) => inside(o.y, y1, y2) && between(x1, o.x1, o.x2)).map((o) => o.y).sort((a, b) => (a - b) * dir);
 for (const c of cs) d += ` L${x1} ${c - dir * HOP} A${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${x1} ${c + dir * HOP}`;
 }
 d += ` L${x2} ${y2}`;
 }
 return d;
}
export function wireDrawings(c) {
 const paths = c.wires.map((w) => wirePath(c, w));
 const segs = segments(paths);
 return paths.map((pts, i) => (pts ? routeD(pts, { v: segs.filter((s) => s.w !== i && s.x1 === s.x2).map((s) => ({ x: s.x1, y1: s.y1, y2: s.y2 })) }) : null));
}
export function nearestOnSegment(s, x, y) {
 const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy;
 const t = L2 ? Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / L2)) : 0;
 const px = s.x1 + t * dx, py = s.y1 + t * dy;
 return { x: px, y: py, d: Math.hypot(px - x, py - y) };
}
export function endTargets(c) {
 const out = [];
 for (const p of c.parts) for (const q of partPins(p, c.defs)) out.push({ end: `${p.id}.${q.pin}`, x: q.x, y: q.y });
 for (const p of PAD_POINTS) out.push({ end: p.name, x: p.x, y: p.y, pad: true });
 return out;
}
export function hitTest(c, x, y, tol = 6, { skip = null } = {}) {
 const near = (px, py, t = tol) => Math.hypot(px - x, py - y) <= t;
 let best = null, bd = Infinity;
 for (const t of endTargets(c)) {
 if (skip && t.end === skip) continue;
 const d = Math.hypot(t.x - x, t.y - y);
 if (d <= tol && d < bd) { bd = d; best = { kind: t.pad ? 'pad' : 'pin', end: t.end, x: t.x, y: t.y }; }
 }
 if (best) return best;
 for (const n of c.nodes) if (near(n.x, n.y)) return { kind: 'node', id: n.id, x: n.x, y: n.y };
 for (const [i, w] of c.wires.entries()) for (const [j, v] of (w.via ?? []).entries()) if (near(v[0], v[1])) return { kind: 'bend', wire: i, index: j, x: v[0], y: v[1] };
 for (const [i, l] of c.labels.entries()) if (Math.abs(l.x - x) <= Math.max(tol, 4 * l.net.length + 4) && Math.abs(l.y - y) <= Math.max(tol, 9)) return { kind: 'label', index: i, x: l.x, y: l.y };
 const segs = segments(c.wires.map((w) => wirePath(c, w)));
 for (const s of segs) { const q = nearestOnSegment(s, x, y); if (q.d <= tol && q.d < bd) { bd = q.d; best = { kind: 'wire', wire: s.w, seg: s, x: q.x, y: q.y }; } }
 if (best) return best;
 for (const p of c.parts) { const b = partBox(p); if (x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol) return { kind: 'part', id: p.id, x: p.x, y: p.y }; }
 return null;
}
export function readingOrder(c) {
 const items = [...c.parts.map((p) => ({ ref: `part:${p.id}`, x: p.x, y: p.y })), ...c.nodes.map((n) => ({ ref: `node:${n.id}`, x: n.x, y: n.y })),
 ...c.labels.map((l, i) => ({ ref: `label:${i}`, x: l.x, y: l.y })),
 ...c.wires.map((w, i) => { const p = wirePath(c, w); const m = p ? p[Math.floor(p.length / 2)] : [0, 0]; return { ref: `wire:${i}`, x: m[0], y: m[1] }; })];
 return items.sort((a, b) => a.y - b.y || a.x - b.x || (a.ref < b.ref ? -1 : 1)).map((i) => i.ref);
}
export function refPoint(c, ref) {
 const [kind, key] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
 if (kind === 'part') { const p = c.parts.find((x) => x.id === key); return p ? { x: p.x, y: p.y } : null; }
 if (kind === 'node') { const n = c.nodes.find((x) => x.id === key); return n ? { x: n.x, y: n.y } : null; }
 if (kind === 'label') { const l = c.labels[Number(key)]; return l ? { x: l.x, y: l.y } : null; }
 if (kind === 'wire') { const w = c.wires[Number(key)]; const p = w && wirePath(c, w); if (!p) return null; const m = p[Math.floor(p.length / 2)]; return { x: m[0], y: m[1] }; }
 return null;
}
export function inRect(c, x0, y0, x1, y1) {
 const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
 const ins = (x, y) => x >= ax && x <= bx && y >= ay && y <= by;
 const out = [];
 for (const p of c.parts) if (ins(p.x, p.y)) out.push(`part:${p.id}`);
 for (const n of c.nodes) if (ins(n.x, n.y)) out.push(`node:${n.id}`);
 c.labels.forEach((l, i) => { if (ins(l.x, l.y)) out.push(`label:${i}`); });
 c.wires.forEach((w, i) => { const p = wirePath(c, w); if (p && p.every(([x, y]) => ins(x, y))) out.push(`wire:${i}`); });
 return out;
}
export const BOARD_BOX = Object.freeze({ x0: 0, y0: BOARD.usb.y, x1: BOARD.w, y1: BOARD.h });
