// wire-colours.js -- colours for highlighted connections that run close
// together (the pipelined drawing): two connections are neighbours when
// stretches of them run parallel within `gap` of each other over at least
// `overlap` (lengths in cm of the drawing). Connections that carry the same
// signal are one net and share a colour. The nets are coloured greedily, the
// most crowded first, with colour 0 (the book's highlight colour) wherever it
// is free, so a connection without close neighbours keeps the book's look.
// Pure JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const WIRE_COLOURS = 6;

/** Axis-parallel segments of a polyline: {h: horizontal?, at: the fixed coordinate, lo, hi}. */
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

/** Do two polylines run parallel within `gap` over at least `overlap`? */
export function runClose(a, b, { gap = 0.65, overlap = 0.25 } = {}) {
  for (const s of segments(a)) {
    for (const t of segments(b)) {
      if (s.h !== t.h || Math.abs(s.at - t.at) > gap) continue;
      if (Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) >= overlap) return true;
    }
  }
  return false;
}

/**
 * Colour index (0 .. WIRE_COLOURS - 1) of each connection.
 * @param {Array<{id: string, signal: string, points: number[][]}>} wires the highlighted connections
 * @returns {Map<string, number>}
 */
export function colourWires(wires, opts = {}) {
  const nets = new Map(); // signal -> {ids, points: [polylines]}
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
