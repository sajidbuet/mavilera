// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { groupRole } from '../../../ui/datapath.js';
const NS = 'http://www.w3.org/2000/svg';
const SCALE = 40;
const X = (x) => +(x * SCALE).toFixed(2);
const Y = (y) => +(-y * SCALE).toFixed(2);
function svg(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
const ANCHOR = (a) => ({
 'text-anchor': a.includes('west') ? 'start' : a.includes('east') ? 'end' : 'middle',
 'dominant-baseline': a.includes('north') ? 'text-before-edge' : a.includes('south') ? 'text-after-edge' : 'central',
});
const PAD = 3;
function pathD(a) {
 const p = a.points;
 if (a.curve) {
 const [c1, c2] = a.curve;
 return `M${X(p[0][0])},${Y(p[0][1])} C${X(c1[0])},${Y(c1[1])} ${X(c2[0])},${Y(c2[1])} ${X(p[1][0])},${Y(p[1][1])}`;
 }
 return `M${p.map(([x, y]) => `${X(x)},${Y(y)}`).join(' L')}`;
}
export class FsmView {
 constructor(fsm, { title, jalr = false }) {
 this.fsm = fsm;
 this.titleNode = svg('title', { id: 'fsm-title' }, title);
 this.descNode = svg('desc', { id: 'fsm-desc' }, '');
 const defs = svg('defs', {}, ['normal', 'active'].map((k) => svg('marker', {
 id: `fsm-arrow-${k}`, class: `dp-arrow dp-arrow-${k}`, markerUnits: 'userSpaceOnUse', markerWidth: 10, markerHeight: 10,
 viewBox: '-8 -4 9 8', refX: 0, refY: 0, orient: 'auto',
 }, svg('path', { d: 'M0,0 L-7,-2.8 L-5.2,0 L-7,2.8 Z' }))));
 this.svg = svg('svg', { class: 'fsm', role: 'img', 'aria-labelledby': 'fsm-title fsm-desc' }, this.titleNode, this.descNode, defs);
 this.gArcs = svg('g', { class: 'fsm-arcs' });
 this.gOver = svg('g', { class: 'fsm-over' });
 this.gStates = svg('g', { class: 'fsm-states' });
 this.gLabels = svg('g', { class: 'fsm-labels' });
 const arrow = (a) => !a.return || a.selfstudy || a.from === 'LOADWB';
 this.arcs = fsm.arcs.map((a) => {
 const g = svg('g', { class: 'fsm-arc' }, svg('path', { d: pathD(a), class: 'fsm-line', 'marker-end': arrow(a) ? 'url(#fsm-arrow-normal)' : null }));
 this.gArcs.append(g);
 let label = null;
 if (a.label) {
 label = svg('text', { x: X(a.label.at[0]), y: Y(a.label.at[1]), ...ANCHOR(a.label.anchor), class: 'fsm-arclabel',
 dx: a.label.anchor.includes('west') ? PAD : a.label.anchor.includes('east') ? -PAD : 0,
 dy: a.label.anchor.includes('south') ? -PAD : a.label.anchor.includes('north') ? PAD : 0 }, a.label.text);
 this.gLabels.append(label);
 }
 return { def: a, g, label };
 });
 this.states = new Map();
 for (const s of fsm.states) {
 const g = svg('g', { class: `fsm-state${s.selfstudy ? ' fsm-selfstudy' : ''}`, 'data-state': s.id },
 svg('circle', { cx: X(s.at[0]), cy: Y(s.at[1]), r: fsm.r * SCALE }),
 svg('text', { x: X(s.at[0]), y: Y(s.at[1]), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, s.id));
 this.gStates.append(g);
 this.states.set(s.id, { def: s, g });
 if (s.initial === 'above') {
 this.gArcs.append(svg('path', { d: `M${X(s.at[0])},${Y(s.at[1] + 2 * fsm.r)} L${X(s.at[0])},${Y(s.at[1] + fsm.r)}`, class: 'fsm-line', 'marker-end': 'url(#fsm-arrow-normal)' }));
 }
 }
 for (const l of fsm.labels) {
 this.gLabels.append(svg('text', { x: X(l.at[0]), y: Y(l.at[1]), ...ANCHOR(l.anchor), dy: l.anchor === 'south' ? -PAD : 0, class: 'fsm-figlabel' }, l.text));
 }
 this.gJ = svg('g', { class: 'dp-junctions' }, fsm.junctions.map(([x, y]) => svg('circle', { cx: X(x), cy: Y(y), r: 2.25 })));
 this.gJalrJ = svg('g', { class: 'dp-junctions' }, (fsm.junctions_jalr ?? []).map(([x, y]) => svg('circle', { cx: X(x), cy: Y(y), r: 2.25 })));
 this.svg.append(this.gArcs, this.gJ, this.gJalrJ, this.gOver, this.gStates, this.gLabels);
 this.root = document.createElement('div');
 this.root.className = 'fsm-wrap';
 this.root.append(this.svg);
 this.setJalr(jalr);
 }
 setLink(onOpen, label) {
 groupRole(this.svg, 'fsm-title', 'fsm-desc');
 for (const s of this.states.values()) {
 s.g.classList.add('dp-link');
 s.g.setAttribute('tabindex', '0');
 s.g.setAttribute('role', 'button');
 s.g.setAttribute('aria-label', label(s.def.id));
 s.g.append(svg('title', {}, label(s.def.id)));
 s.g.addEventListener('click', onOpen);
 s.g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(); } });
 }
 }
 setJalr(on) {
 this.jalr = on;
 const hidden = (a) => !on && (a.from === 'JALR' || a.to === 'JALR' || (a.from === 'JAL' && a.to === 'FETCH'));
 for (const a of this.arcs) {
 const d = hidden(a.def) ? 'none' : null;
 a.g.style.display = d;
 if (a.label) a.label.style.display = d;
 }
 const j = this.states.get('JALR');
 if (j) j.g.style.display = on ? null : 'none';
 this.gJalrJ.style.display = on ? null : 'none';
 const pts = [];
 for (const s of this.states.values()) if (s.g.style.display !== 'none') pts.push([s.def.at[0] - this.fsm.r, s.def.at[1] - this.fsm.r], [s.def.at[0] + this.fsm.r, s.def.at[1] + this.fsm.r]);
 for (const a of this.arcs) if (a.g.style.display !== 'none') pts.push(...a.def.points, ...(a.def.label ? [a.def.label.at] : []));
 for (const l of this.fsm.labels) pts.push(l.at);
 const xs = pts.map((p) => p[0]);
 const ys = pts.map((p) => p[1]);
 const m = 0.45;
 this.svg.setAttribute('viewBox', [X(Math.min(...xs) - m), Y(Math.max(...ys) + m), (Math.max(...xs) - Math.min(...xs) + 2 * m) * SCALE,
 (Math.max(...ys) - Math.min(...ys) + 2 * m) * SCALE].join(' '));
 }
 show(state, prev, next, description) {
 for (const [id, s] of this.states) s.g.classList.toggle('fsm-cur', id === state);
 this.gOver.replaceChildren();
 const find = (a, b) => this.arcs.find((x) => x.def.from === a && x.def.to === b && x.g.style.display !== 'none');
 const taken = prev ? find(prev, state) : null;
 const ahead = next ? find(state, next) : null;
 for (const [arc, cls] of [[ahead, 'fsm-next'], [taken, 'fsm-taken']]) {
 if (!arc) continue;
 this.gOver.append(svg('path', { d: pathD(arc.def), class: `fsm-line ${cls}`, 'marker-end': 'url(#fsm-arrow-active)' }));
 }
 for (const a of this.arcs) a.label?.classList.toggle('fsm-label-on', a === taken || a === ahead);
 this.descNode.textContent = description;
 }
}
