// schematic.js -- the conventions shared by the processor drawings (docs/ui/datapath-schematics.md),
// computed once from a geometry file, never per cycle: the width of each connection from the
// model's signal dictionary (src/uarch/signals.js, the one source of widths), where the bus-width
// markers go, the input ports of the multiplexers, the junctions that connectivity implies, and
// estimated text boxes for the collision checks. Pure functions of the geometry, in its units
// (cm, y up), so that test/schematic.test.mjs runs them without a browser. The drawing itself is
// the book's (content/geometry/*.json): nothing here moves an element, a wire or a label.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** 1 pt of the book's drawings in cm (config/tikz-styles.tex). */
export const PT_CM = 0.03515;
const EPS = 1e-6;

// Text of the drawing: size (px at 40 px/cm, as datapath.js and theme.css) and the average
// advance of a character in em, for estimated boxes (no layout pass, so no browser).
const PX = 40;
export const TEXT = Object.freeze({
  sig: { size: 11.25, advance: 0.6 }, // signal and port names, code face
  figlabel: { size: 11.25, advance: 0.55 }, // names beside elements
  figtitle: { size: 12.65, advance: 0.62 }, // stage headings, bold
  eltext: { size: 12.65, advance: 0.55 }, // names inside elements
  pin: { size: 9.84, advance: 0.55 }, // multiplexer input numbers
  width: { size: 9.84, advance: 0.55 }, // bus-width numbers (the book's \scriptsize sans)
});

/**
 * Width in bits of the connection carrying `signal` (null: unknown or a constant). A list
 * "a,b,c" is a bundle of separate signals and its width is their sum (zero, lt, ltu: 3;
 * the pipeline's control bundles) -- except on a bus whose names all have one width: one value
 * under several names (Chapter 7: result reaches the PC as pc_next, bit 0 cleared).
 */
export function wireWidth(signal, style, info) {
  const names = signal.split(',').map((s) => s.trim());
  const widths = names.map((n) => info[n]?.width ?? null);
  if (widths.some((w) => w === null)) return null;
  if (names.length > 1 && style === 'bus' && widths.every((w) => w === widths[0])) return widths[0];
  return widths.reduce((a, b) => a + b, 0);
}

const same = (p, q) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;

/** Is point p on segment a-b (ends included)? */
function onSegment(p, a, b) {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > EPS) return false;
  return p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS
    && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

const segments = (points) => points.slice(1).map((b, i) => [points[i], b]);
export const onPolyline = (p, points) => segments(points).some(([a, b]) => onSegment(p, a, b));

/**
 * The nets of a drawing: connections with the same signal that touch (an end of one lies on
 * another). Each net lists its wires from the source on: the wire whose start lies on no other.
 */
export function nets(wires) {
  const groups = new Map();
  for (const w of wires) {
    if (!groups.has(w.signal)) groups.set(w.signal, []);
    groups.get(w.signal).push(w);
  }
  const out = [];
  for (const list of groups.values()) {
    const touches = (a, b) => [a.points[0], a.points.at(-1)].some((p) => onPolyline(p, b.points))
      || [b.points[0], b.points.at(-1)].some((p) => onPolyline(p, a.points));
    const seen = new Set();
    for (const start of list) {
      if (seen.has(start)) continue;
      const net = [];
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const w = queue.shift();
        net.push(w);
        for (const o of list) if (!seen.has(o) && touches(w, o)) { seen.add(o); queue.push(o); }
      }
      // source first: a wire whose start is not on another wire of the net; then in drawing order
      const isSource = (w) => !net.some((o) => o !== w && onPolyline(w.points[0], o.points));
      net.sort((a, b) => (isSource(b) - isSource(a)) || (list.indexOf(a) - list.indexOf(b)));
      out.push(net);
    }
  }
  return out;
}

// --- boxes ----------------------------------------------------------------------------------
// A box is [xa, ya, xb, yb] in cm, y up.
const PLACE = { above: 'south', below: 'north', left: 'east', right: 'west' };

/** Estimated box of a text set as datapath.js sets it (textAt): `anchor` a TikZ anchor. */
export function textBox(text, at, anchor, kind, sep) {
  const t = TEXT[kind];
  const lines = String(text).split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * t.advance * t.size / PX;
  const h = lines.length * 1.15 * t.size / PX * 0.85;
  let xa = at[0] - w / 2;
  if (anchor.includes('west')) xa = at[0] + sep;
  else if (anchor.includes('east')) xa = at[0] - sep - w;
  if (kind === 'width') { // digits: from the baseline to the cap height, where the em box puts them
    const s = t.size / PX;
    const [lo, hi] = anchor.includes('north') ? [-0.93, -0.21] : anchor.includes('south') ? [0.21, 0.93] : [-0.36, 0.36];
    return [xa, at[1] + lo * s, xa + w, at[1] + hi * s];
  }
  let ya = at[1] - h / 2;
  if (anchor.includes('north')) ya = at[1] - sep - h;
  else if (anchor.includes('south')) ya = at[1] + sep;
  return [xa, ya, xa + w, ya + h];
}

/** Box of a text turned 90° counter-clockwise at `at`, as datapath.js draws rotated labels. */
function rotatedBox(text, at, kind, sep) {
  const t = TEXT[kind];
  const len = String(text).length * t.advance * t.size / PX;
  const h = t.size / PX * 0.85;
  return [at[0] - sep - h, at[1] + sep, at[0] - sep, at[1] + sep + len];
}

const SIG_SEP = 2 * PT_CM;

/** Every text of the drawing with its estimated box: {kind, text, box, owner}. */
export function texts(geom) {
  const out = [];
  for (const l of geom.labels) {
    const kind = l.style === 'sig' ? 'sig' : l.style === 'figtitle' ? 'figtitle' : 'figlabel';
    const sep = l.style === 'sig' ? SIG_SEP : PT_CM;
    const box = l.rotate ? rotatedBox(l.text, l.at, kind, sep) : textBox(l.text, l.at, l.anchor ?? PLACE[l.place] ?? 'center', kind, sep);
    out.push({ kind: 'label', text: l.text, box, owner: null });
  }
  for (const w of geom.wires) {
    for (const l of w.labels) out.push({ kind: 'label', text: l.text, box: textBox(l.text, l.at, l.anchor ?? PLACE[l.place] ?? 'center', 'sig', SIG_SEP), owner: w.id });
  }
  for (const c of geom.control) {
    const text = c.text ?? c.signal;
    if (!text) continue;
    const p = c.label_at === 'end' ? c.points[1] : c.points[0];
    const anchor = c.anchor ?? PLACE[c.place] ?? 'center';
    out.push({ kind: 'control', text, box: c.rotate ? rotatedBox(text, p, 'sig', SIG_SEP) : textBox(text, p, anchor, 'sig', SIG_SEP), owner: `ctl:${c.signal}` });
  }
  return out;
}

/** Bounding box of an element: its rectangle, or the outline of its shape. */
export function elementBox(geom, e) {
  if (e.size) return [e.at[0] - e.size[0] / 2, e.at[1] - e.size[1] / 2, e.at[0] + e.size[0] / 2, e.at[1] + e.size[1] / 2];
  const o = geom.pics[e.type].outline;
  const xs = o.map((p) => e.at[0] + p[0]);
  const ys = o.map((p) => e.at[1] + p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Outline of an element as a polygon: its rectangle, or its shape. */
export function elementOutline(geom, e) {
  if (e.size) {
    const [xa, ya, xb, yb] = elementBox(geom, e);
    return [[xa, ya], [xb, ya], [xb, yb], [xa, yb]];
  }
  return geom.pics[e.type].outline.map(([a, b]) => [e.at[0] + a, e.at[1] + b]);
}

function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does the segment p-q (any direction) touch box `b`? */
function segmentTouchesBox(p, q, b) {
  const inBox = ([x, y]) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
  if (inBox(p) || inBox(q)) return true;
  const c = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  return c.some((a, i) => segmentsCross(p, q, a, c[(i + 1) % 4]));
}

/** Does box `b` touch the polygon (an edge crosses it, or one contains a corner of the other)? */
export function boxHitsPolygon(b, poly) {
  const corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
  if (corners.some((c) => pointInPolygon(c, poly)) || poly.some((p) => pointInPolygon(p, corners))) return true;
  const edges = corners.map((c, i) => [c, corners[(i + 1) % 4]]);
  return poly.some((p, i) => edges.some(([a, c]) => segmentsCross(p, poly[(i + 1) % poly.length], a, c)));
}

const grow = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const meet = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
export const overlap = (a, b) => area(meet(a, b));
const inside = (a, b) => a[0] >= b[0] - EPS && a[1] >= b[1] - EPS && a[2] <= b[2] + EPS && a[3] <= b[3] + EPS;

/** Does segment a-b (horizontal or vertical) pass through box `bx` (shrunk by `m`)? */
function segmentHits(a, b, bx, m = 0) {
  const xa = Math.min(a[0], b[0]);
  const xb = Math.max(a[0], b[0]);
  const ya = Math.min(a[1], b[1]);
  const yb = Math.max(a[1], b[1]);
  return xb > bx[0] + m && xa < bx[2] - m && yb > bx[1] + m && ya < bx[3] - m;
}

// --- multiplexers ---------------------------------------------------------------------------
/** Input ports of every multiplexer: id -> [{index, at}], from the shape's input numbers. */
export function muxPorts(geom) {
  const out = new Map();
  for (const e of [...geom.elements, ...Object.values(geom.variants ?? {}).flatMap((v) => v.elements)]) {
    if (!/^mux\d$/.test(e.type)) continue;
    const pic = geom.pics[e.type];
    out.set(e.id, pic.labels.map((l) => ({ index: Number(l.text), at: [e.at[0], e.at[1] + l.at[1]] })));
  }
  return out;
}

/** The input each multiplexer takes on the active path: id -> index, from the active wires that end on a port. */
export function selectedInputs(ports, wires, active) {
  const out = new Map();
  for (const [id, list] of ports) {
    for (const p of list) {
      if (wires.some((w) => active.has(w.id) && same(w.points.at(-1), p.at))) out.set(id, p.index);
    }
  }
  return out;
}

// --- junctions ------------------------------------------------------------------------------
/**
 * Check the junction dots against connectivity: a dot must join two connections or more, one
 * at least ending there (a field taken from the instruction bus has a name of its own; a control
 * stub that branches is a connection too); and a wire of a net ending on the inside of another
 * of the same net is a branch that wants a dot. Returns {wrong: [[x, y], ...], missing: [[x, y], ...]}.
 */
export function checkJunctions(wires, junctions, control = []) {
  const all = [...wires, ...control.map((c) => ({ signal: c.signal, points: c.points }))];
  const wrong = [];
  for (const j of junctions) {
    const touching = all.filter((w) => onPolyline(j, w.points));
    const ends = touching.filter((w) => same(w.points[0], j) || same(w.points.at(-1), j));
    if (touching.length < 2 || !ends.length) wrong.push(j);
  }
  const missing = [];
  for (const net of nets(all)) {
    for (const w of net) {
      for (const p of [w.points[0], w.points.at(-1)]) {
        const into = net.some((o) => o !== w && onPolyline(p, o.points) && !same(p, o.points[0]) && !same(p, o.points.at(-1)));
        if (into && !junctions.some((j) => same(j, p)) && !missing.some((m) => same(m, p))) missing.push(p);
      }
    }
  }
  return { wrong, missing };
}

// --- bus-width markers ----------------------------------------------------------------------
// The book's marker (pics/buswidth): a slash 4.4 pt wide and 8 pt high across the bus, the width
// beside it (the book: 3.5 pt plus the node's inner sep; here 2.5 pt, so that the field buses of the
// register file, 0.5 cm apart, each keep theirs); above a horizontal bus, to the right of a vertical
// one, else on the other side.
const SLASH = [2.2 * PT_CM, 4 * PT_CM];
const GAP = 2.5 * PT_CM;
const CLEAR_END = 0.3; // cm kept free at each end of a segment (ports, arrow heads, junctions)
const STEP = 0.05;

/** The marker's parts at point p on a segment: the slash's box and the number's box, for each side. */
function markerAt(p, horizontal, width, side) {
  const slash = [p[0] - SLASH[0], p[1] - SLASH[1], p[0] + SLASH[0], p[1] + SLASH[1]];
  const at = horizontal ? [p[0], p[1] + side * GAP] : [p[0] + side * (SLASH[0] + GAP), p[1]];
  const anchor = horizontal ? (side > 0 ? 'south' : 'north') : (side > 0 ? 'west' : 'east');
  const box = textBox(String(width), at, anchor, 'width', 0);
  const line = [[p[0] - SLASH[0], p[1] - SLASH[1]], [p[0] + SLASH[0], p[1] + SLASH[1]]];
  return { slash, line, width, number: { at, anchor, box } };
}

/**
 * Where each bus-width marker goes: one per net of known width above 1 bit, on the first place
 * from the source that touches no text, element, junction, other connection or other marker.
 * `widthOf(wire)` gives a wire's width (null: none). Control bundles (style ctrl) get one too.
 * `stubs` are control stubs; `stubWidth(stub)` gives theirs (multi-bit selects and codes).
 * `reserved` [{box, line?, width?}] are kept free (the markers of the drawing a variant is added to).
 * Returns {markers: [{wire (id) | stub (the stub itself), at, horizontal, width, slash, number}], unplaced: [signal, ...]}.
 */
export function placeMarkers(geom, widthOf, { stubs = [], stubWidth = () => null, reserved = [] } = {}) {
  const textList = texts(geom);
  const elements = geom.elements.map((e) => elementOutline(geom, e));
  const allWires = geom.wires;
  const stubSegs = geom.control.map((c) => c.points);
  const taken = reserved.map((r) => ({ ...r }));
  const markers = [];
  const unplaced = [];

  let near = 0.2; // cm from a junction dot to the slash's centre
  const free = (m, own) => {
    const parts = [m.slash, m.number.box];
    // texts: the number's box, and the slash as drawn, its diagonal (a text box is an estimate: 0.01 cm of tolerance)
    if (textList.some((t) => overlap(m.number.box, t.box) > 0 || segmentTouchesBox(m.line[0], m.line[1], grow(t.box, -0.01)))) return false;
    if (parts.some((b) => elements.some((e) => boxHitsPolygon(b, e)))) return false;
    // apart from the other markers, and no number near the slash of another width, where it would be read as that one's
    // (a slash is its diagonal, not its box)
    const hits = (b, t) => (t.line ? segmentTouchesBox(t.line[0], t.line[1], b) : overlap(b, t.box) > 0);
    if (parts.some((b) => taken.some((t) => hits(grow(b, 0.015), t)))) return false;
    if (taken.some((t) => t.line && t.width !== m.width && hits(grow(m.number.box, 0.12), t))) return false;
    if (geom.junctions.some((j) => Math.abs(j[0] - (m.slash[0] + m.slash[2]) / 2) < near && Math.abs(j[1] - (m.slash[1] + m.slash[3]) / 2) < near)) return false;
    // no other connection under the number or through the slash (its own segment passes the slash)
    for (const w of allWires) {
      for (const [a, b] of segments(w.points)) {
        if (segmentHits(a, b, grow(m.number.box, 0.04))) return false;
        if (!(own && own(a, b)) && segmentHits(a, b, m.slash)) return false;
      }
    }
    for (const pts of stubSegs) {
      if (segmentHits(pts[0], pts[1], grow(m.number.box, 0.04))) return false;
      if (!(own && own(pts[0], pts[1])) && segmentHits(pts[0], pts[1], m.slash)) return false;
    }
    return true;
  };

  /** Candidates along a segment, from its start: the points STEP apart, CLEAR_END from each end. */
  const along = (a, b, clear, clearEnd = clear) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const out = [];
    for (let d = clear; d <= len - clearEnd + EPS; d += STEP) out.push([a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len]);
    if (!out.length && len >= 2 * SLASH[1] + 0.1) out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); // a short stub: its middle
    return out;
  };

  // the preferred side (above, right) anywhere on the net before the other side
  const tryPlace = (list, width, own) => {
    for (const side of [1, -1]) for (const { a, b, ref, clear, clearEnd } of list) {
      const horizontal = Math.abs(a[1] - b[1]) < EPS;
      if (!horizontal && Math.abs(a[0] - b[0]) > EPS) continue; // orthogonal segments only
      for (const p of along(a, b, clear, clearEnd)) {
        const m = markerAt(p, horizontal, width, side);
        if (!free(m, (s0, s1) => same(s0, a) && same(s1, b) && own)) continue;
        taken.push({ box: m.slash, line: m.line, width }, { box: m.number.box });
        markers.push({ ...ref, at: p, horizontal, width, slash: m.slash, line: m.line, number: m.number });
        return true;
      }
    }
    return false;
  };

  // First the stretches well clear of the ends; then, where the drawing is dense or the connection
  // short, closer to them, but never on an arrow head (7 px, 0.175 cm long) or a junction dot.
  const passes = [[CLEAR_END, CLEAR_END, 0.2], [0.16, CLEAR_END, 0.2], [0.1, 0.2, 0.15]];
  for (const net of nets(allWires)) {
    const width = widthOf(net[0]);
    if (!width || width < 2) continue;
    const placed = passes.some(([clear, arrowEnd, j]) => (near = j) && tryPlace(net.flatMap((w) => segments(w.points).map(([a, b], i, all) => ({ a, b, clear, clearEnd: w.arrow && i === all.length - 1 ? arrowEnd : clear, ref: { wire: w.id } }))), width, true));
    if (!placed) unplaced.push(net[0].signal);
  }
  for (const c of stubs) {
    const width = stubWidth(c);
    if (!width || width < 2) continue;
    const clearEnd = c.arrow === false ? 0.12 : 0.2; // off the arrow head at the port
    if (!tryPlace([{ a: c.points[0], b: c.points[1], clear: 0.12, clearEnd, ref: { stub: c } }], width, true)) unplaced.push(c.signal);
  }
  return { markers, unplaced };
}

// --- collision report -----------------------------------------------------------------------
/**
 * Overlaps in a drawing as drawn, for review: texts on texts, texts across an element's edge
 * (a text wholly inside an element is its name or a port's), and connections through texts
 * other than their own. Each entry is a short description; the list is sorted.
 */
export function collisions(geom) {
  const list = texts(geom);
  const out = [];
  const name = (t) => `"${t.text.replace(/\n/g, ' ')}"`;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (overlap(a.box, b.box) > 0.002) out.push(`text ${name(a)} on text ${name(b)}`);
    }
  }
  for (const t of list) {
    for (const e of geom.elements) {
      const poly = elementOutline(geom, e);
      const corners = [[t.box[0], t.box[1]], [t.box[2], t.box[1]], [t.box[2], t.box[3]], [t.box[0], t.box[3]]];
      if (boxHitsPolygon(t.box, poly) && !corners.every((c) => pointInPolygon(c, poly))) out.push(`text ${name(t)} across element ${e.id}`);
    }
    const m = 0.02; // a line grazing the edge of an estimated box is not counted
    for (const w of geom.wires) {
      if (w.id === t.owner) continue;
      if (segments(w.points).some(([a, b]) => segmentHits(a, b, t.box, m))) out.push(`wire ${w.id} through text ${name(t)}`);
    }
    for (const c of geom.control) {
      if (`ctl:${c.signal}` === t.owner) continue;
      if (segmentHits(c.points[0], c.points[1], t.box, m)) out.push(`control ${c.signal} through text ${name(t)}`);
    }
  }
  return [...new Set(out)].sort();
}
