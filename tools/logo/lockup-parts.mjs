// lockup-parts.mjs -- the MAVILERA lockup (content/branding/mavilera/mavilera-lockup.svg) split into the parts the
// landing page's logo animation moves (docs/branding/logo-animation.md): each of the file's three compound paths
// (classes mv-n, mv-l, mv-p) is cut into its subpaths, written in absolute commands, and each subpath is given to a
// part by where it lies, in the generator's coordinates (tools/logo/make_logo.py: the instruction cards, the
// circuit traces, the M, the pipeline stages, the letters). A part keeps its subpaths in their order and colour, so
// that a hole stays with the outline around it and the parts together paint what the file paints (checked in a
// browser by test/hero-logo.test.mjs). Pure functions; no file is written here.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** The commands of an SVG path `d` as [{cmd, args}] (implicit repeats split; numbers as written). */
export function tokens(d) {
  const counts = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const out = [];
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i += 1; };
  // a number as SVG writes it: "-1.5", ".5", "1e-3"; "1.2.3" is 1.2 then .3
  const number = () => {
    skip();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error(`path: a number expected at ${i}: ${d.slice(i, i + 12)}`);
    i += m[0].length;
    return Number(m[0]);
  };
  // an arc flag: one digit, with or without a separator after it
  const flag = () => { skip(); const c = d[i]; if (c !== '0' && c !== '1') throw new Error(`path: an arc flag expected at ${i}`); i += 1; return Number(c); };
  let cmd = null;
  for (;;) {
    skip();
    if (i >= d.length) break;
    if (/[MmZzLlHhVvCcSsQqTtAa]/.test(d[i])) { cmd = d[i]; i += 1; } else if (!cmd) throw new Error('path: no command');
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l'; // further pairs after a move are lines
    const n = counts[cmd.toUpperCase()];
    if (n === 0) { out.push({ cmd, args: [] }); continue; }
    const args = [];
    for (let k = 0; k < n; k++) args.push(cmd.toUpperCase() === 'A' && (k === 3 || k === 4) ? flag() : number());
    out.push({ cmd, args });
  }
  return out;
}

const fmt = (v) => String(+v.toFixed(4)); // relative steps summed: keep what the file's 2 decimals give

/**
 * The subpaths of `d`, each in absolute commands: [{d, box: {x0, y0, x1, y1}}]. The box takes every end point and
 * control point (enough to place a subpath; arcs add their end points only).
 */
export function subpaths(d) {
  const list = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl = null; // the last cubic control point, for S
  let lastQ = null; // the last quadratic control point, for T (reset by any other command)
  const add = (px, py) => {
    const b = cur.box;
    b.x0 = Math.min(b.x0, px); b.y0 = Math.min(b.y0, py); b.x1 = Math.max(b.x1, px); b.y1 = Math.max(b.y1, py);
  };
  for (const { cmd, args } of tokens(d)) {
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
    const C = cmd.toUpperCase();
    if (C === 'M') {
      x = rel ? x + args[0] : args[0];
      y = rel ? y + args[1] : args[1];
      sx = x; sy = y;
      cur = { parts: [`M${fmt(x)} ${fmt(y)}`], box: { x0: x, y0: y, x1: x, y1: y } };
      list.push(cur);
      lastCtrl = null; lastQ = null;
      continue;
    }
    if (C === 'Z') { cur.parts.push('Z'); x = sx; y = sy; lastCtrl = null; lastQ = null; continue; }
    if (C === 'L') {
      x = rel ? x + args[0] : args[0]; y = rel ? y + args[1] : args[1];
      cur.parts.push(`L${fmt(x)} ${fmt(y)}`); add(x, y); lastCtrl = null;
    } else if (C === 'T') { // a quadratic whose control point mirrors the last one (the point itself after no Q/T)
      const q = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
      x = rel ? x + args[0] : args[0]; y = rel ? y + args[1] : args[1];
      cur.parts.push(`Q${[...q, x, y].map(fmt).join(' ')}`); add(...q); add(x, y); lastQ = q; lastCtrl = null;
      continue;
    } else if (C === 'H') {
      x = rel ? x + args[0] : args[0]; cur.parts.push(`L${fmt(x)} ${fmt(y)}`); add(x, y); lastCtrl = null;
    } else if (C === 'V') {
      y = rel ? y + args[0] : args[0]; cur.parts.push(`L${fmt(x)} ${fmt(y)}`); add(x, y); lastCtrl = null;
    } else if (C === 'C') {
      const p = args.map((v, i) => (rel ? v + (i % 2 ? y : x) : v));
      cur.parts.push(`C${p.map(fmt).join(' ')}`);
      add(p[0], p[1]); add(p[2], p[3]); add(p[4], p[5]);
      lastCtrl = [p[2], p[3]]; x = p[4]; y = p[5];
    } else if (C === 'S') {
      const p = args.map((v, i) => (rel ? v + (i % 2 ? y : x) : v));
      const c1 = lastCtrl ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
      cur.parts.push(`C${[...c1, ...p].map(fmt).join(' ')}`);
      add(...c1); add(p[0], p[1]); add(p[2], p[3]);
      lastCtrl = [p[0], p[1]]; x = p[2]; y = p[3];
    } else if (C === 'Q') {
      const p = args.map((v, i) => (rel ? v + (i % 2 ? y : x) : v));
      cur.parts.push(`Q${p.map(fmt).join(' ')}`); add(p[0], p[1]); add(p[2], p[3]); x = p[2]; y = p[3]; lastCtrl = null;
      lastQ = [p[0], p[1]];
      continue;
    } else if (C === 'A') {
      const [rx, ry, rot, large, sweep, ax, ay] = args;
      x = rel ? x + ax : ax; y = rel ? y + ay : ay;
      cur.parts.push(`A${fmt(rx)} ${fmt(ry)} ${fmt(rot)} ${large} ${sweep} ${fmt(x)} ${fmt(y)}`); add(x, y); lastCtrl = null;
    }
    lastQ = null; // every command but Q and T (which continue above) ends a run of quadratics
  }
  return list.map((s) => ({ d: s.parts.join(''), box: s.box }));
}

// --- the parts, in the generator's coordinates (tools/logo/make_logo.py) -----------------------------------------

const CARD_Y = (i) => 210.1 + 50.2 * i; // INSTR rows: y .. y + 42.4
const STAGES = [['if', 1209.0, 1283.8], ['id', 1300.0, 1376.8], ['ex', 1392.0, 1468.8], ['mem', 1484.0, 1569.8], ['wb', 1586.0, 1669.8]];
const PY0 = 287.0;
const PY1 = 391.8;
const AY = 339.8; // the arrows between the stages
const WORD_Y0 = 500; // the word MAVILERA: y 506 .. 674

/** The part a subpath belongs to, from its box (generator coordinates) and colour class ('n', 'l', 'p'). */
export function partOf({ x0, y0, x1, y1 }, cls) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (y0 >= WORD_Y0) return cls === 'l' ? `tri-${cx < 900 ? 1 : 2}` : 'word';
  if (x1 <= 320) { // the instruction cards (box, label, the bar's two halves)
    for (let i = 0; i < 5; i++) if (cy >= CARD_Y(i) - 2 && cy <= CARD_Y(i) + 44.4) return `card-${i}`;
  }
  if (x0 >= 1200 && y0 >= PY0 - 1 && y1 <= PY1 + 1) {
    // a stage box (with its label's holes; a blue box carries its outgoing arrow), or an arrow between two stages
    for (const [id, a, b] of STAGES) if (cx >= a - 1 && cx <= b + 1) return `stage-${id}`;
    if (Math.abs(cy - AY) < 12) return 'stage-arrows';
  }
  if (x1 <= 600 && x0 >= 300 && cy > 200) return 'wires-left';
  if (x0 >= 1060 && (cy < PY0 || cy > PY1)) return 'wires-right';
  if (x0 >= 1100 && x1 <= 1210 && Math.abs(cy - AY) < 25) return 'arrow-in';
  // the M: its two arches (the large pieces), and the road between them (the small pieces in the middle)
  const small = (x1 - x0) * (y1 - y0) < 100 * 180;
  if (small && cx > 700 && cx < 1000 && cy > 270) return 'm-road';
  return cx < 790 ? 'm-left' : 'm-right';
}

/** The word's subpaths grouped by letter: a subpath inside another's box (a counter) joins that letter. */
function letters(subs) {
  const sorted = [...subs].sort((a, b) => a.box.x0 - b.box.x0);
  const out = [];
  for (const s of sorted) {
    const host = out.find((l) => s.box.x0 >= l.box.x0 - 0.5 && s.box.x1 <= l.box.x1 + 0.5 && s.box.y0 >= l.box.y0 - 0.5 && s.box.y1 <= l.box.y1 + 0.5);
    if (host) host.ds.push(s.d); else out.push({ box: { ...s.box }, ds: [s.d] });
  }
  return out.map((l) => l.ds.join(''));
}

/**
 * The lockup's parts: {viewBox, transform, style, parts: [{part, cls, d}]} in the file's paint order (navy, light,
 * pale), one entry per part and colour.
 */
export function lockupParts(svgText) {
  const viewBox = /viewBox="([^"]+)"/.exec(svgText)[1];
  const transform = /<g transform="([^"]+)"/.exec(svgText)?.[1] ?? '';
  const style = /<style>([\s\S]*?)<\/style>/.exec(svgText)?.[1] ?? '';
  const parts = [];
  for (const m of svgText.matchAll(/<path class="mv-([nlp])" d="([^"]+)"/g)) {
    const cls = m[1];
    const groups = new Map();
    for (const s of subpaths(m[2])) {
      const key = partOf(s.box, cls);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    for (const [part, subs] of groups) {
      if (part === 'word') letters(subs).forEach((d, k) => parts.push({ part: `letter-${k}`, cls, d }));
      else parts.push({ part, cls, d: subs.map((s) => s.d).join('') });
    }
  }
  return { viewBox, transform, style, parts };
}

/**
 * The lockup as one SVG of parts: each part a <path> with the colour class of the file (mv-n, mv-l, mv-p) and a
 * class `p-<part>`, in the file's paint order, inside one group with the file's transform. `cls` adds classes to
 * the root (the animation's variant), `id` an id prefix-free root marker. Nothing else changes: the parts together
 * paint what the file paints.
 */
export function partsSvg(svgText, { rootClass = 'mvh', title = 'MAVILERA', animated = false } = {}) {
  const { viewBox, transform, parts } = lockupParts(svgText);
  const [, , w, h] = viewBox.split(' ').map(Number);
  // animated: every path's length set to 1 (an outline can be drawn on with one dash), and a scan bar (invisible at
  // rest) that a wave can carry across; neither changes what is painted at rest
  const len = animated ? ' pathLength="1"' : '';
  const body = parts.map((p) => `<path class="mv-${p.cls} p-${p.part}" d="${p.d}"${len}/>`).join('');
  const [tx] = transform.match(/-?[\d.]+/g)?.map(Number) ?? [0];
  const scan = animated ? `<rect class="p-scan" x="${-tx - 60}" y="100" width="44" height="620" rx="22" aria-hidden="true"/>` : '';
  return `<svg class="${rootClass}" xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" role="img" aria-label="${title}">`
    + `<g transform="${transform}">${body}${scan}</g></svg>`;
}
