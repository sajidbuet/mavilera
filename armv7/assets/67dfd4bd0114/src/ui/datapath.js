// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, store } from './dom.js';
import { STRINGS } from './strings.js';
import { colourWires, WIRE_COLOURS } from './wire-colours.js';
import { wireWidth, placeMarkers, muxPorts, selectedInputs } from './schematic.js';
const NS = 'http://www.w3.org/2000/svg';
const SCALE = 40;
const PT = SCALE * 0.03515;
const SEP = 2 * PT;
function svg(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
export function groupRole(node, titleId, descId) {
 node.setAttribute('role', 'group');
 node.setAttribute('aria-labelledby', titleId);
 node.setAttribute('aria-describedby', descId);
}
const X = (x) => +(x * SCALE).toFixed(2);
const Y = (y) => +(-y * SCALE).toFixed(2);
const pts = (list) => list.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
const PLACE = { above: 'south', below: 'north', left: 'east', right: 'west' };
function textAt(x, y, anchor, sep) {
 const h = anchor.includes('west') ? 'start' : anchor.includes('east') ? 'end' : 'middle';
 const v = anchor.includes('north') ? 'text-before-edge' : anchor.includes('south') ? 'text-after-edge' : 'central';
 const dx = h === 'start' ? sep : h === 'end' ? -sep : 0;
 const dy = v === 'text-before-edge' ? sep : v === 'text-after-edge' ? -sep : 0;
 return { x: X(x) + dx, y: Y(y) + dy, 'text-anchor': h, 'dominant-baseline': v };
}
function multiline(text, attrs) {
 const lines = text.split('\n');
 const t = svg('text', attrs);
 if (lines.length === 1) { t.textContent = text; return t; }
 const first = -(lines.length - 1) * 0.6;
 lines.forEach((l, i) => t.append(svg('tspan', { x: attrs.x, dy: `${i === 0 ? first : 1.2}em` }, l)));
 return t;
}
function longest(points) {
 let best = null;
 for (let i = 1; i < points.length; i++) {
 const [x0, y0] = points[i - 1];
 const [x1, y1] = points[i];
 const len = Math.hypot(x1 - x0, y1 - y0);
 if (!best || len > best.len) best = { len, x: (x0 + x1) / 2, y: (y0 + y1) / 2, horizontal: Math.abs(y1 - y0) < 1e-6 };
 }
 return best;
}
export const FLOW_SPEEDS = Object.freeze({ off: 0, slow: 900, normal: 450, fast: 220 });
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export function flowControl() {
 const saved = store.get('pips.flow');
 let speed = reducedMotion() ? 'off' : (saved in FLOW_SPEEDS ? saved : 'off');
 const sel = el('select', { 'aria-label': STRINGS.flow, disabled: reducedMotion(), onchange: (e) => { speed = e.target.value; store.set('pips.flow', speed); } },
 Object.entries(STRINGS.flowSpeeds).map(([k, t]) => el('option', { value: k, text: t, selected: k === speed })));
 const label = el('label.toggle', { title: reducedMotion() ? STRINGS.flowReduced : STRINGS.flowTitle }, `${STRINGS.flow} `, sel);
 return { root: label, get: () => (reducedMotion() ? 0 : FLOW_SPEEDS[speed]) };
}
export function flowOrder(geom, stages, early = new Set()) {
 const defs = new Map([...geom.wires, ...Object.values(geom.variants ?? {}).flatMap((v) => v.wires)].map((w) => [w.id, w]));
 const out = [];
 for (const { wires, x0, x1 } of stages) {
 for (const id of wires) {
 const w = defs.get(id);
 if (!w) continue;
 out.push({ id, at: early.has(id) ? 0 : (w.points[0][0] - x0) / Math.max(0.1, x1 - x0) });
 }
 }
 return out;
}
export class DatapathView {
 constructor(geom, { title, description, valueAt = {}, labelBounds = false, nearColours = false, info = null, bands = [] }) {
 this.geom = geom;
 this.valueAt = valueAt;
 this.info = info;
 this.wires = new Map();
 this.elements = new Map();
 this.stubs = new Map();
 this.tags = new Map();
 this.muxIndex = new Map();
 this.ports = muxPorts(geom);
 this.values = { signals: new Map(), controls: new Map() };
 this.showAll = false;
 this.markers = this.widthMarkers();
 const points = (g) => [...g.wires.flatMap((w) => w.points), ...g.control.flatMap((c) => c.points),
 ...g.elements.flatMap((e) => (e.size ? [[e.at[0] - e.size[0] / 2, e.at[1] - e.size[1] / 2], [e.at[0] + e.size[0] / 2, e.at[1] + e.size[1] / 2]]
 : geom.pics[e.type].outline.map(([a, b]) => [e.at[0] + a, e.at[1] + b]))),
 ...(labelBounds ? g.labels.map((l) => l.at) : [])];
 const box = (all) => {
 const xs = all.map((p) => p[0]);
 const ys = all.map((p) => p[1]);
 const mx = 0.55;
 const my = 0.4;
 return [X(Math.min(...xs) - mx), Y(Math.max(...ys) + my), (Math.max(...xs) - Math.min(...xs) + 2 * mx) * SCALE,
 (Math.max(...ys) - Math.min(...ys) + 2 * my) * SCALE].join(' ');
 };
 const base = points(geom);
 const vb = box(base);
 this.variants = new Map();
 this.viewBoxes = { '': vb };
 for (const [name, v] of Object.entries(geom.variants ?? {})) this.viewBoxes[name] = box([...base, ...points(v)]);
 this.titleNode = svg('title', { id: 'dp-title' }, title);
 this.descNode = svg('desc', { id: 'dp-desc' }, description);
 const kinds = ['normal', 'active', 'ctrl', 'crit', ...Array.from({ length: WIRE_COLOURS }, (_, k) => `wc${k}`)];
 const defs = svg('defs', {}, kinds.map((k) => svg('marker', {
 id: `dp-arrow-${k}`, class: `dp-arrow dp-arrow-${k}`, markerUnits: 'userSpaceOnUse', markerWidth: 10, markerHeight: 10,
 viewBox: '-8 -4 9 8', refX: 0, refY: 0, orient: 'auto',
 }, svg('path', { d: 'M0,0 L-7,-2.8 L-5.2,0 L-7,2.8 Z' }))));
 this.svg = svg('svg', { viewBox: vb, class: 'dp', role: 'img', 'aria-labelledby': 'dp-title dp-desc' },
 this.titleNode, this.descNode, defs);
 const boxes = Object.values(this.viewBoxes).map((b) => b.split(' ').map(Number));
 const top = Math.min(...boxes.map((b) => b[1]));
 const bottom = Math.max(...boxes.map((b) => b[1] + b[3]));
 const gBand = svg('g', { class: 'dp-bands', 'aria-hidden': 'true' },
 bands.map((b) => svg('rect', { x: X(b.left), y: top, width: (b.right - b.left) * SCALE, height: bottom - top, class: 'dp-band' })));
 const gEl = svg('g', { class: 'dp-elements' });
 for (const e of geom.elements) gEl.append(this.drawElement(e));
 const gLab = svg('g', { class: 'dp-labels', 'aria-hidden': 'true' });
 for (const l of geom.labels) gLab.append(this.drawLabel(l));
 const gWire = svg('g', { class: 'dp-wires' });
 for (const w of geom.wires) gWire.append(this.drawWire(w));
 const gJ = svg('g', { class: 'dp-junctions' }, geom.junctions.map(([x, y]) => svg('circle', { cx: X(x), cy: Y(y), r: 1.6 * PT })));
 const gCtl = svg('g', { class: 'dp-control' });
 for (const c of geom.control) gCtl.append(this.drawStub(c));
 this.gDir = svg('g', { class: 'dp-dir', 'aria-hidden': 'true' });
 this.march = !reducedMotion() && store.get('pips.march') !== '0';
 this.marchToggle = el('label.toggle', { title: reducedMotion() ? STRINGS.flowReduced : STRINGS.marchTitle },
 el('input', { type: 'checkbox', checked: this.march, disabled: reducedMotion(), onchange: (ev) => {
 this.march = ev.target.checked;
 store.set('pips.march', this.march ? '1' : '0');
 this.drawDirections();
 } }), ` ${STRINGS.march}`);
 this.dirWires = new Set();
 this.wireColour = new Map();
 this.colourNear = nearColours && store.get('pips.wirecolours') !== '0';
 this.colourToggle = nearColours ? el('label.toggle', { title: STRINGS.wireColoursTitle },
 el('input', { type: 'checkbox', checked: this.colourNear, onchange: (ev) => {
 this.colourNear = ev.target.checked;
 store.set('pips.wirecolours', this.colourNear ? '1' : '0');
 this.setPath(this.lastPath?.active ?? null, this.lastPath?.critical ?? null);
 } }), ` ${STRINGS.wireColours}`) : null;
 this.gAnn = svg('g', { class: 'dp-annotations' });
 this.gTags = svg('g', { class: 'dp-tags' });
 this.gMarks = svg('g', { class: 'dp-marks' });
 this.gFlow = svg('g', { class: 'dp-flow', 'aria-hidden': 'true' });
 for (const [name, v] of Object.entries(geom.variants ?? {})) {
 const parts = [svg('g', { class: 'dp-elements' }, v.elements.map((e) => this.drawElement(e))),
 svg('g', { class: 'dp-wires' }, v.wires.map((w) => this.drawWire(w))),
 svg('g', { class: 'dp-junctions' }, v.junctions.map(([x, y]) => svg('circle', { cx: X(x), cy: Y(y), r: 1.6 * PT }))),
 svg('g', { class: 'dp-control' }, v.control.map((c) => this.drawStub(c))),
 svg('g', { class: 'dp-labels' }, v.labels.map((l) => this.drawLabel(l)))];
 const g = svg('g', { class: 'dp-variant', 'data-variant': name, display: 'none' }, parts);
 this.variants.set(name, { g, hide: v.hide ?? [], on: false });
 }
 this.gBadge = svg('g', { class: 'dp-badges' });
 this.svg.append(gBand, gEl, gWire, gJ, gCtl, gLab, ...[...this.variants.values()].map((v) => v.g), this.gDir, this.gFlow, this.gAnn, this.gBadge, this.gMarks, this.gTags);
 this.tip = document.createElement('div');
 this.tip.className = 'tip';
 this.tip.hidden = true;
 this.root = document.createElement('div');
 this.root.className = 'dp-wrap';
 this.root.append(this.svg, this.tip);
 }
 drawElement(e) {
 const g = svg('g', { class: `dp-el dp-${e.type}`, 'data-id': e.id });
 if (e.size) {
 const [w, h] = e.size;
 const x = X(e.at[0] - w / 2);
 const y = Y(e.at[1] + h / 2);
 g.append(svg('rect', { x, y, width: w * SCALE, height: h * SCALE, rx: e.type === 'comb' ? 4 * PT : null, class: 'dp-shape' }));
 if (e.type === 'reg') {
 const yb = Y(e.at[1] - h / 2);
 g.append(svg('polyline', { points: `${X(e.at[0]) - 3.5 * PT},${yb} ${X(e.at[0])},${yb - 5 * PT} ${X(e.at[0]) + 3.5 * PT},${yb}`, class: 'dp-clock' }));
 }
 if (e.text) {
 const chars = Math.max(...e.text.split('\n').map((l) => l.length));
 const fit = (w * SCALE - 4 * PT) / (chars * 0.55);
 g.append(multiline(e.text, { x: X(e.at[0]), y: Y(e.at[1]), 'text-anchor': 'middle', 'dominant-baseline': 'central',
 class: e.mono ? 'dp-eltext dp-elmono' : 'dp-eltext',
 style: fit < 12.65 ? `font-size:${fit.toFixed(2)}px` : null }));
 }
 } else {
 const pic = this.geom.pics[e.type];
 g.append(svg('polygon', { points: pts(pic.outline.map(([a, b]) => [e.at[0] + a, e.at[1] + b])), class: 'dp-shape' }));
 const index = new Map();
 for (const l of pic.labels) {
 const mux = this.ports.has(e.id);
 const t = svg('text', { ...textAt(e.at[0] + l.at[0], e.at[1] + l.at[1], l.anchor, PT), class: e.type === 'alu' ? 'dp-alutext' : mux ? 'dp-pintext dp-muxidx' : 'dp-pintext' }, l.text);
 g.append(t);
 if (mux) index.set(Number(l.text), t);
 }
 if (index.size) this.muxIndex.set(e.id, index);
 }
 this.elements.set(e.id, g);
 return g;
 }
 drawLabel(l) {
 const anchor = l.anchor ?? PLACE[l.place] ?? 'center';
 if (l.rotate) {
 const t = svg('text', { x: X(l.at[0]), y: Y(l.at[1]), transform: `rotate(-${l.rotate} ${X(l.at[0])} ${Y(l.at[1])})`,
 dx: SEP, dy: -SEP, 'text-anchor': 'start', 'dominant-baseline': 'text-after-edge', class: `dp-${l.style}` }, l.text);
 return t;
 }
 return multiline(l.text, { ...textAt(l.at[0], l.at[1], anchor, l.style === 'sig' ? SEP : PT), class: `dp-${l.style}` });
 }
 drawWire(w) {
 const p = w.points.map((q) => [...q]);
 if (w.arrow) {
 const [x1, y1] = p[p.length - 1];
 const [x0, y0] = p[p.length - 2];
 const len = Math.hypot(x1 - x0, y1 - y0) || 1;
 const back = (2 * PT) / SCALE;
 p[p.length - 1] = [x1 - ((x1 - x0) / len) * back, y1 - ((y1 - y0) / len) * back];
 p.tip = [x1, y1];
 }
 const g = svg('g', { class: `dp-wire dp-${w.style}`, 'data-id': w.id, 'data-signal': w.signal });
 const d = pts(p) + (p.tip ? ` ${X(p.tip[0])},${Y(p.tip[1])}` : '');
 const line = svg('polyline', { points: d, class: 'dp-line', 'marker-end': w.arrow ? `url(#dp-arrow-${w.style === 'ctrl' ? 'ctrl' : 'normal'})` : null });
 const hit = svg('polyline', { points: d, class: 'dp-hit' });
 for (const lab of w.labels) g.append(this.drawLabel({ ...lab, style: 'sig' }));
 g.append(line, hit);
 const m = this.markers.get(w.id);
 if (m) g.append(this.drawMarker(m, 'dp-bw'));
 hit.addEventListener('pointerenter', (ev) => this.hover(ev, w.signal));
 hit.addEventListener('pointermove', (ev) => this.place(ev));
 hit.addEventListener('pointerleave', () => { this.tip.hidden = true; });
 this.wires.set(w.id, { g, line, arrow: w.arrow, def: w });
 return g;
 }
 drawStub(c) {
 const [a, b] = c.points;
 const text = c.text ?? c.signal;
 const p = c.label_at === 'end' ? b : a;
 const anchor = c.anchor ?? PLACE[c.place] ?? 'center';
 const attrs = { ...textAt(p[0], p[1], anchor, SEP), class: 'dp-sig dp-ctrltext' };
 if (c.rotate) {
 const t = textAt(0, 0, anchor, SEP);
 Object.assign(attrs, { x: X(p[0]) + t.x, y: Y(p[1]) + t.y, transform: `rotate(-${c.rotate} ${X(p[0])} ${Y(p[1])})` });
 }
 const name = svg('text', attrs, text);
 const line = svg('polyline', { points: pts([a, b]), class: 'dp-ctrl', 'marker-end': c.arrow === false ? null : 'url(#dp-arrow-ctrl)' });
 const hit = svg('polyline', { points: pts([a, b]), class: 'dp-hit' });
 const m = this.markers.get(c);
 const g = svg('g', { class: 'dp-stub', 'data-signal': c.signal }, line, hit, m ? this.drawMarker(m, 'dp-bw dp-bw-ctrl') : null, name);
 hit.addEventListener('pointerenter', (ev) => this.hover(ev, c.signal, true));
 hit.addEventListener('pointermove', (ev) => this.place(ev));
 hit.addEventListener('pointerleave', () => { this.tip.hidden = true; });
 name.addEventListener('pointerenter', (ev) => this.hover(ev, c.signal, true));
 name.addEventListener('pointerleave', () => { this.tip.hidden = true; });
 if (!this.stubs.has(c.signal)) this.stubs.set(c.signal, []);
 this.stubs.get(c.signal).push({ g, name, text });
 return g;
 }
 widthMarkers() {
 const out = new Map();
 const info = this.info;
 if (!info) return out;
 const widthOf = (w) => wireWidth(w.signal, w.style, info);
 const stubWidth = (c) => info[c.signal]?.width ?? null;
 const g = this.geom;
 const base = placeMarkers(g, widthOf, { stubs: g.control, stubWidth });
 this.unplaced = base.unplaced;
 for (const m of base.markers) out.set(m.wire ?? m.stub, m);
 const reserved = base.markers.flatMap((m) => [{ box: m.slash, line: m.line, width: m.width }, { box: m.number.box }]);
 for (const v of Object.values(g.variants ?? {})) {
 const mine = new Set(v.wires);
 const merged = { ...g, elements: [...g.elements, ...v.elements], labels: [...g.labels, ...v.labels],
 wires: [...g.wires.filter((w) => !(v.hide ?? []).includes(w.id)), ...v.wires], junctions: [...g.junctions, ...v.junctions],
 control: [...g.control, ...v.control] };
 const r = placeMarkers(merged, (w) => (mine.has(w) ? widthOf(w) : null), { stubs: v.control, stubWidth, reserved });
 for (const m of r.markers) out.set(m.wire ?? m.stub, m);
 }
 return out;
 }
 drawMarker(m, cls) {
 const [sx, sy] = [m.at[0] - (m.slash[2] - m.slash[0]) / 2, m.at[1] - (m.slash[3] - m.slash[1]) / 2];
 const [ex, ey] = [m.at[0] + (m.slash[2] - m.slash[0]) / 2, m.at[1] + (m.slash[3] - m.slash[1]) / 2];
 return svg('g', { class: cls, 'aria-hidden': 'true' },
 svg('line', { x1: X(sx), y1: Y(sy), x2: X(ex), y2: Y(ey), class: 'dp-bwslash' }),
 svg('text', { ...textAt(m.number.at[0], m.number.at[1], m.number.anchor, 0), class: 'dp-bwtext' }, String(m.width)));
 }
 hover(ev, signal, control = false) {
 const lines = signal.split(',').map((s) => (control ? this.values.controls : this.values.signals).get(s)?.tip).filter(Boolean);
 if (!lines.length) return;
 this.tip.replaceChildren(...lines.map((t) => Object.assign(document.createElement('div'), { textContent: t })));
 this.tip.hidden = false;
 this.place(ev);
 }
 place(ev) {
 const pad = 14;
 const r = this.tip.getBoundingClientRect();
 this.tip.style.left = `${Math.min(ev.clientX + pad, window.innerWidth - r.width - 8)}px`;
 this.tip.style.top = `${Math.min(ev.clientY + pad, window.innerHeight - r.height - 8)}px`;
 }
 setPath(active, critical = null) {
 this.lastPath = { active, critical };
 this.dirWires = new Set();
 const hlOf = (id) => (critical ? critical.has(id) : Boolean(active && active.wires.has(id)));
 this.wireColour = this.colourNear && active && !critical
 ? colourWires([...this.wires].filter(([id, w]) => hlOf(id) && w.def.style !== 'ctrl' && !this.hidden(w)).map(([, w]) => w.def))
 : new Map();
 for (const [id, w] of this.wires) {
 const on = !active || active.wires.has(id);
 const hl = hlOf(id);
 const k = hl ? this.wireColour.get(id) : undefined;
 w.g.classList.toggle('dp-muted', !on);
 w.g.classList.toggle('dp-active', hl);
 w.g.classList.toggle('dp-wc', k !== undefined);
 if (k !== undefined) w.g.style.setProperty('--wc', `var(--wc-${k})`); else w.g.style.removeProperty('--wc');
 const plain = w.def.style === 'ctrl' ? 'ctrl' : 'normal';
 if (w.arrow) w.line.setAttribute('marker-end', `url(#dp-arrow-${k !== undefined ? `wc${k}` : hl ? (critical ? 'crit' : 'active') : plain})`);
 if (hl) this.dirWires.add(id);
 }
 for (const [id, g] of this.elements) g.classList.toggle('dp-muted', Boolean(active) && !active.elements.has(id));
 const shown = [...this.wires.values()].filter((w) => !this.hidden(w)).map((w) => w.def);
 const selected = active ? selectedInputs(this.ports, shown, critical ?? active.wires) : new Map();
 for (const [id, index] of this.muxIndex) {
 for (const [k, t] of index) t.classList.toggle('dp-selidx', selected.get(id) === k);
 }
 this.drawDirections();
 }
 hidden(w) {
 return w.g.getAttribute('display') === 'none' || Boolean(w.g.closest('[display="none"]'));
 }
 colourStyle(id) {
 const k = this.wireColour.get(id);
 return k === undefined ? null : `--wc: var(--wc-${k})`;
 }
 drawDirections() {
 this.gDir.replaceChildren();
 for (const id of this.dirWires) {
 const w = this.wires.get(id);
 if (!w || this.hidden(w)) continue;
 const p = w.def.points;
 if (this.march && !reducedMotion()) {
 this.gDir.append(svg('polyline', { points: pts(p), class: `dp-march${w.def.style === 'ctrl' ? ' dp-march-ctrl' : ''}` }));
 }
 let best = null;
 for (let i = 1; i < p.length; i++) {
 const len = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
 if (!best || len > best.len) best = { len, a: p[i - 1], b: p[i] };
 }
 if (!best || best.len < 0.7) continue;
 const mx = X((best.a[0] + best.b[0]) / 2);
 const my = Y((best.a[1] + best.b[1]) / 2);
 const ang = (Math.atan2(Y(best.b[1]) - Y(best.a[1]), X(best.b[0]) - X(best.a[0])) * 180) / Math.PI;
 const style = this.colourStyle(id);
 this.gDir.append(svg('path', { d: 'M6.5,0 L-5,-5.6 L-2.4,0 L-5,5.6 Z', class: `dp-dirarrow${style ? ' dp-wcol' : ''}`, style,
 transform: `translate(${mx} ${my}) rotate(${ang.toFixed(1)})` }));
 }
 }
 setLinks(targets, onOpen, names = {}) {
 groupRole(this.svg, 'dp-title', 'dp-desc');
 for (const [id, g] of this.elements) {
 if (!targets[id] || g.classList.contains('dp-link')) continue;
 const def = [...this.geom.elements, ...Object.values(this.geom.variants ?? {}).flatMap((v) => v.elements)].find((e) => e.id === id);
 const name = def?.text ? def.text.replace(/\n/g, ' ') : names[id] ?? STRINGS.elementKinds[def?.type] ?? id;
 g.classList.add('dp-link');
 g.setAttribute('tabindex', '0');
 g.setAttribute('role', 'button');
 g.setAttribute('aria-label', STRINGS.openFor(name));
 g.append(svg('title', {}, STRINGS.openFor(name)));
 const go = () => { this.flash(id); onOpen(id); };
 g.addEventListener('click', go);
 g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
 }
 }
 flash(id) {
 const g = this.elements.get(id);
 if (!g) return;
 g.classList.remove('dp-flash');
 g.getBBox?.();
 g.classList.add('dp-flash');
 setTimeout(() => g.classList.remove('dp-flash'), 1300);
 }
 animate(list, ms) {
 this.gFlow.replaceChildren();
 if (!ms || !list.length) return;
 const span = 1.5 * ms;
 for (const { id, at } of list) {
 const w = this.wires.get(id);
 if (!w || w.g.getAttribute('display') === 'none') continue;
 const p = w.def.points;
 let len = 0;
 for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) * SCALE;
 const style = this.colourStyle(id);
 const line = svg('polyline', { points: pts(p), class: `dp-flowline${w.def.style === 'ctrl' ? ' dp-flowctrl' : ''}${style ? ' dp-wcol' : ''}`,
 style, 'stroke-dasharray': `${len} ${len}`, 'stroke-dashoffset': len });
 this.gFlow.append(line);
 if (typeof line.animate !== 'function') { line.remove(); continue; }
 const delay = Math.max(0, Math.min(1, at)) * span;
 line.animate([{ strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, opacity: 1 }], { duration: ms, delay, fill: 'forwards', easing: 'linear' });
 line.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: span + ms + 150, fill: 'forwards' });
 }
 }
 setVariant(name, on) {
 const v = this.variants.get(name);
 if (!v || v.on === on) return;
 v.on = on;
 v.g.setAttribute('display', on ? 'inline' : 'none');
 for (const id of v.hide) this.wires.get(id)?.g.setAttribute('display', on ? 'none' : 'inline');
 this.drawDirections();
 const shown = [...this.variants.entries()].find(([, x]) => x.on);
 this.svg.setAttribute('viewBox', this.viewBoxes[shown ? shown[0] : '']);
 }
 setMarks(marks) {
 for (const g of this.elements.values()) g.classList.remove('dp-hold', 'dp-clear');
 this.gMarks.replaceChildren();
 const above = new Map();
 for (const m of marks) {
 const e = this.geom.elements.find((x) => x.id === m.id);
 const g = this.elements.get(m.id);
 if (!e || !g) continue;
 g.classList.add(`dp-${m.kind}`);
 const n = above.get(m.id) ?? 0;
 above.set(m.id, n + 1);
 let top = e.at[1] + (e.size ? e.size[1] / 2 : 0.8);
 for (const l of this.geom.labels) {
 if (Math.abs(l.at[0] - e.at[0]) < 0.3 && l.at[1] >= top && l.at[1] < top + 0.5) top = l.at[1] + 0.12;
 }
 this.gMarks.append(svg('text', { ...textAt(e.at[0], top + 0.05 + 0.32 * n, 'south', PT), class: `dp-mark dp-mark-${m.kind}` }, m.text));
 }
 }
 setValues(signals, controls) {
 this.values = { signals, controls };
 for (const [name, list] of this.stubs) {
 const v = controls.get(name);
 const one = this.info?.[name]?.width === 1 && v ? v.text : null;
 for (const s of list) {
 s.g.classList.toggle('dp-on', one === '1');
 s.g.classList.toggle('dp-off', one === '0');
 }
 }
 this.renderTags();
 }
 setBadge(id, text) {
 this.gBadge.replaceChildren();
 const e = this.geom.elements.find((x) => x.id === id);
 if (!e?.size || !text) return;
 const fs = 7.5 * PT;
 const w = text.length * 0.6 * fs + 6 * PT;
 const h = fs + 4 * PT;
 const right = X(e.at[0] + e.size[0] / 2) - 3 * PT;
 const cy = Y(e.at[1]);
 this.gBadge.append(svg('g', { class: 'dp-badge', 'aria-hidden': 'true' },
 svg('rect', { x: right - w, y: cy - h / 2, width: w, height: h, rx: 2 }),
 svg('text', { x: right - w / 2, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, text)));
 }
 setShowAll(on) {
 this.showAll = on;
 this.renderTags();
 }
 renderTags() {
 this.gTags.replaceChildren();
 for (const [name, list] of this.stubs) {
 const v = this.values.controls.get(name);
 for (const s of list) s.name.textContent = this.showAll && v && s.text ? `${s.text}=${v.text}` : s.text;
 }
 if (!this.showAll) return;
 for (const [signal, place] of Object.entries(this.valueAt)) {
 const v = this.values.signals.get(signal);
 if (!v) continue;
 let x;
 let y;
 let anchor = place.anchor;
 if (place.at) [x, y] = place.at;
 else {
 const w = this.wires.get(place.wire);
 if (!w) continue;
 const seg = longest(w.def.points);
 ({ x, y } = seg);
 anchor = seg.horizontal ? 'south' : 'west';
 }
 const text = v.tag ?? v.text;
 const fs = 7 * PT;
 const w = text.length * 0.6 * fs + 3;
 const h = fs + 2;
 const a = textAt(x, y, anchor, 0.6 * PT);
 const left = a['text-anchor'] === 'start' ? a.x - 1.5 : a['text-anchor'] === 'end' ? a.x - w + 1.5 : a.x - w / 2;
 const top = a['dominant-baseline'] === 'text-before-edge' ? a.y : a['dominant-baseline'] === 'text-after-edge' ? a.y - h : a.y - h / 2;
 this.gTags.append(svg('g', { class: 'dp-tagbox' },
 svg('rect', { x: left, y: top, width: w, height: h, rx: 1.5, class: 'dp-tagbg' }),
 svg('text', { x: left + w / 2, y: top + h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'dp-tag' }, text)));
 }
 }
 setAnnotations(list) {
 this.gAnn.replaceChildren(...list.map((a) => svg('text', { ...textAt(a.at[0], a.at[1], a.anchor, 3 * PT), class: 'dp-annotation' }, a.text)));
 }
 setStateTags(list) {
 const fs = 7.5 * PT;
 this.gAnn.append(...list.map((t) => {
 const w = t.text.length * 0.6 * fs + 4 * PT;
 const h = fs + 3 * PT;
 const a = textAt(t.at[0], t.at[1], t.anchor ?? 'center', 0);
 const left = a['text-anchor'] === 'start' ? a.x : a['text-anchor'] === 'end' ? a.x - w : a.x - w / 2;
 const top = a['dominant-baseline'] === 'text-before-edge' ? a.y : a['dominant-baseline'] === 'text-after-edge' ? a.y - h : a.y - h / 2;
 return svg('g', { class: 'dp-statetag' }, svg('rect', { x: left, y: top, width: w, height: h, rx: 1 }),
 svg('text', { x: left + w / 2, y: top + h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, t.text));
 }));
 }
 setDescription(text) {
 this.descNode.textContent = text;
 }
 exportSvg(caption) {
 const clone = this.svg.cloneNode(true);
 const src = [this.svg, ...this.svg.querySelectorAll('*')];
 const dst = [clone, ...clone.querySelectorAll('*')];
 const props = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linejoin', 'paint-order', 'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'display', 'visibility'];
 src.forEach((n, i) => {
 const cs = getComputedStyle(n);
 dst[i].setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
 if (n.classList?.contains('dp-hit') || n.classList?.contains('dp-march')) dst[i].setAttribute('data-hit', '');
 dst[i].removeAttribute('class');
 });
 for (const h of clone.querySelectorAll('[data-hit]')) h.remove();
 const [x, y, w, h] = clone.getAttribute('viewBox').split(' ').map(Number);
 clone.setAttribute('viewBox', `${x} ${y} ${w} ${h + 22}`);
 clone.setAttribute('xmlns', NS);
 clone.setAttribute('width', w * 2);
 clone.setAttribute('height', (h + 22) * 2);
 const bg = getComputedStyle(document.body).backgroundColor;
 clone.insertBefore(svg('rect', { x, y, width: w, height: h + 22, style: `fill:${bg}` }), clone.firstChild.nextSibling);
 const fg = getComputedStyle(document.body).color;
 clone.append(svg('text', { x: x + 6, y: y + h + 14, style: `fill:${fg};font-family:sans-serif;font-size:11px` }, caption));
 return new XMLSerializer().serializeToString(clone);
 }
}
