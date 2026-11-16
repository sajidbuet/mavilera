// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { icon } from '../../../ui/icons.js';
import { PICO2_STRINGS } from '../strings.js';
import { PART_TYPES } from '../circuit/library.js';
import { emptyCircuit, parseEnd } from '../circuit/format.js';
import { addPartAt, rotatePart, mirrorPart, moveRefs, addWire, splitWire, addBend, moveBend, removeBend, addLabel, removeRefs, copyRefs,
 pasteClip, freeNet, PLACE } from '../circuit/edit.js';
import { GRID, snap, gridIndex, hitTest, wirePath, partBox, partPins, readingOrder, refPoint, inRect, endPoint, orthogonal } from './circuit-sheet.js';
import { UndoStack } from './circuit-undo.js';
import { CircuitUI, symbolBody } from './circuit-ui.js';
const B = PICO2_STRINGS.board, E = B.editor;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : String(v));
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
const pathOf = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const SYMBOLS = Object.freeze({ label: null });
const PLACEABLE = () => [...Object.entries(PART_TYPES).map(([t, d]) => [t, d.label]), ['label', E.label]];
const TOOLS = Object.freeze(['select', 'wire', 'deletePart', 'deleteWire']);
const placeName = (t) => PLACEABLE().find(([k]) => k === t)?.[1] ?? t;
function trayIcon(type) {
 const box = type === 'ground' || type === 'power' ? '-30 -30 60 60' : '-66 -66 132 132';
 const svg = s('svg', { viewBox: box, 'aria-hidden': 'true', focusable: 'false' });
 if (type === 'label') svg.append(s('path', { class: 'bv-sym', d: 'M-66 0 H-40 M-40 -20 H20 L44 0 L20 20 H-40 Z M-26 -6 H10 M-26 6 H2' }));
 else svg.append(...symbolBody(type).nodes.filter((n) => !n.classList?.contains('bv-uglow')));
 for (const t of [...svg.querySelectorAll('text')]) if (!(PART_TYPES[type]?.module && t.classList.contains('bv-part-t'))) t.remove();
 return svg;
}
const kindOf = (r) => r.slice(0, r.indexOf(':'));
const keyOf = (r) => r.slice(r.indexOf(':') + 1);
export const EDITOR_STYLE = `
.bv-editing .bv-boardg, .bv-editing .bv-circuit > :not(.bv-user) { opacity: 0.45; }
.bv-editing .bv-boardg, .bv-editing .bv-circuit { pointer-events: none; }
.bv-editing .bv-svg { cursor: crosshair; }
.bv-ed { pointer-events: none; }
.bv-ed-grid { fill: url(#bv-grid-dots); }
.bv-grid-dot { fill: var(--muted, #888); opacity: 0.55; }
.bv-ed-cur { stroke: var(--primary, #1565c0); stroke-width: 1.6; fill: none; }
.bv-ed-cur.bv-ed-on { stroke-width: 2.6; }
.bv-ed-sel { fill: none; stroke: var(--primary, #1565c0); stroke-width: 2.4; stroke-dasharray: 6 4; }
.bv-ed-selw { fill: none; stroke: var(--primary, #1565c0); stroke-width: 7; opacity: 0.35; stroke-linejoin: round; }
.bv-ed-ghost { opacity: 0.55; }
.bv-ed-wire { fill: none; stroke: var(--primary, #1565c0); stroke-width: 2.4; stroke-dasharray: 8 4; }
.bv-ed-band { fill: var(--primary, #1565c0); fill-opacity: 0.08; stroke: var(--primary, #1565c0); stroke-width: 1.2; stroke-dasharray: 4 3; }
.bv-editing .bv-user { pointer-events: none; } /* while editing, the editor hit-tests the model; controls do not take clicks */
.bv-ed-tools { position: absolute; left: 6px; top: 6px; z-index: 2; display: flex; gap: 2px; padding: 3px; align-items: center;
  background: var(--surface, #fff); border: 1px solid var(--border, #bbb); border-radius: 4px; }
.bv-ed-ib { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; min-height: 0;
  border: 1px solid transparent; border-radius: 3px; background: transparent; color: var(--text); }
.bv-ed-ib:hover { border-color: var(--border, #bbb); }
.bv-ed-ib[aria-pressed="true"] { background: var(--primary); color: var(--primary-on); border-color: var(--primary); }
.bv-ed-sep { width: 1px; align-self: stretch; margin: 2px 3px; background: var(--border, #bbb); }
.bv-ed-tray { position: absolute; left: 6px; top: 48px; z-index: 2; display: grid; grid-template-columns: repeat(2, 42px); gap: 3px; padding: 4px;
  background: var(--surface, #fff); border: 1px solid var(--border, #bbb); border-radius: 4px; max-height: calc(100% - 100px); overflow: auto; }
.bv-ed-tray button { width: 42px; height: 42px; min-height: 0; padding: 3px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--text); background: var(--surface, #fff); border: 1px solid var(--border, #bbb); border-radius: 4px; }
.bv-ed-tray button:hover { border-color: var(--primary, #1565c0); }
.bv-ed-tray button[aria-pressed="true"] { outline: 2px solid var(--primary, #1565c0); outline-offset: 1px; }
.bv-ed-tray svg { width: 100%; height: 100%; overflow: visible; }
.bv-ed-tray .bv-sym { fill: none; stroke: currentColor; stroke-width: 1.6px; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
.bv-ed-tray .bv-symf { fill: currentColor; }
.bv-ed-tray .bv-tray-t { fill: currentColor; font: 600 34px var(--font-code, monospace); dominant-baseline: middle; text-anchor: middle; }
.bv-ed-bar { position: absolute; left: 400px; right: 6px; top: 6px; z-index: 2; font-size: 0.78rem; padding: 3px 8px; pointer-events: none;
  background: var(--surface, #fff); border: 1px solid var(--border, #bbb); border-radius: 4px; opacity: 0.92; }
.bv-ed-pop { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 3; padding: 8px 10px; max-width: min(36rem, calc(100% - 24px));
  background: var(--surface, #fff); border: 1px solid var(--border, #bbb); border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,0.25); font-size: 0.82rem; }
.bv-ed-pop select { font: inherit; width: 100%; margin-top: 4px; }
.bv-ed-pop table { border-collapse: collapse; } .bv-ed-pop td, .bv-ed-pop th { padding: 1px 8px 1px 0; text-align: left; vertical-align: top; }
.bv-ed-pop h3 { font-size: 0.9rem; margin: 0 0 4px; }
.bv-edit-toggle { font: inherit; font-size: 0.8rem; min-height: 24px; margin-left: 0.6em; }
.bv-edit-toggle[aria-pressed="true"] { background: var(--primary); color: var(--primary-on); border-color: var(--primary); }
`;
export class CircuitEditor {
 constructor(view) {
 this.view = view; this.cui = view.cui;
 this.on = false;
 this.cur = { x: snap(PLACE.x0), y: snap(PLACE.y0 - 4 * GRID) };
 this.sel = [];
 this.mode = null;
 this.undo = new UndoStack(200);
 this.clip = null;
 this.toldChanged = false;
 this.toggle = el('button.bv-edit-toggle', { type: 'button', text: E.toggle, title: E.toggleTitle, 'aria-pressed': 'false', onclick: () => this.setOn(!this.on) });
 this.layer = s('g', { class: 'bv-ed', visibility: 'hidden', 'aria-hidden': 'true' });
 const defs = s('defs', {}, s('pattern', { id: 'bv-grid-dots', width: GRID, height: GRID, patternUnits: 'userSpaceOnUse' }, s('circle', { class: 'bv-grid-dot', cx: 0, cy: 0, r: 1.1 })));
 this.gridRect = s('rect', { class: 'bv-ed-grid', x: -800 * GRID, y: -800 * GRID, width: 1600 * GRID, height: 1600 * GRID });
 this.selG = s('g'); this.ghostG = s('g', { class: 'bv-ed-ghost' });
 this.wireP = s('path', { class: 'bv-ed-wire', d: '' }); this.bandR = s('rect', { class: 'bv-ed-band', visibility: 'hidden' });
 this.curP = s('path', { class: 'bv-ed-cur', d: '' });
 this.layer.append(defs, this.gridRect, this.selG, this.ghostG, this.wireP, this.bandR, this.curP);
 this.trayBtns = new Map();
 this.tray = el('div.bv-ed-tray', { role: 'toolbar', 'aria-label': E.tray, 'aria-orientation': 'vertical', hidden: true },
 ...PLACEABLE().map(([t, label]) => {
 const b = el('button', { type: 'button', title: label, 'aria-label': label, 'aria-pressed': 'false', 'data-type': t }, trayIcon(t));
 b.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.preventDefault(); this.startPlace(t, true); });
 b.addEventListener('click', () => { if (this.mode?.kind !== 'place' || this.mode.type !== t) this.startPlace(t, false); this.view.root.focus({ preventScroll: true }); });
 this.trayBtns.set(t, b);
 return b;
 }));
 this.chooseSel = el('select', { size: String(PLACEABLE().length), 'aria-label': E.chooser },
 ...PLACEABLE().map(([t, label]) => el('option', { value: t, text: label })));
 this.chooser = el('div.bv-ed-pop', { hidden: true }, el('label', {}, E.chooser, this.chooseSel));
 this.chooseSel.addEventListener('keydown', (e) => {
 if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const t = this.chooseSel.value; this.closeChooser(); if (t) this.startPlace(t, false); }
 else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeChooser(); }
 });
 this.chooseSel.addEventListener('dblclick', () => { const t = this.chooseSel.value; this.closeChooser(); if (t) this.startPlace(t, false); });
 this.keysBox = el('div.bv-ed-pop', { hidden: true, role: 'region', 'aria-label': E.keysTitle },
 el('h3', { text: E.keysTitle }), el('table', {}, el('tbody', {}, ...E.keys.map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td', { text: v }))))));
 this.bar = el('div.bv-ed-bar', { hidden: true, 'aria-hidden': 'true' });
 this.live = el('div.sr-only', { role: 'status', 'aria-live': 'polite' });
 this.tool = 'select';
 const ib = (name, label, onclick, attrs = {}) => {
 const b = el('button.bv-ed-ib', { type: 'button', 'aria-label': label, title: label, onclick: () => { onclick(); this.draw(); }, ...attrs }, icon(name, { size: 18 }));
 b.addEventListener('pointerdown', (e) => e.stopPropagation());
 return b;
 };
 this.toolBtns = new Map(TOOLS.map((t) => [t, ib(t, E.toolNames[t], () => this.pickTool(t), { 'aria-pressed': String(t === 'select') })]));
 this.panBtn = ib('pan', E.toolNames.pan, () => this.shellPan()?.click(), { 'aria-pressed': 'false' });
 this.tools = el('div.bv-ed-tools', { role: 'toolbar', 'aria-label': E.toolsLabel, hidden: true },
 ...this.toolBtns.values(), this.panBtn, el('span.bv-ed-sep', { 'aria-hidden': 'true' }),
 ib('rotate', E.toolNames.rotate, () => this.turn(false)), ib('mirror', E.toolNames.mirror, () => this.turn(true)),
 ib('undo', E.toolNames.undo, () => this.doUndo()), ib('redo', E.toolNames.redo, () => this.doRedo()),
 el('span.bv-ed-sep', { 'aria-hidden': 'true' }), ib('keyboard', E.toolNames.keys, () => { this.keysBox.hidden = !this.keysBox.hidden; }));
 this.overlays = [this.tools, this.tray, this.chooser, this.keysBox, this.bar, this.live];
 }
 attach() {
 const svg = this.view.svg, root = this.view.root;
 svg.insertBefore(this.layer, this.view.selRect);
 root.append(...this.overlays);
 root.addEventListener('keydown', (e) => this.key(e));
 svg.addEventListener('pointerdown', (e) => this.down(e));
 svg.addEventListener('pointermove', (e) => this.move(e));
 for (const t of ['pointerup', 'pointercancel']) svg.addEventListener(t, (e) => this.up(e));
 svg.addEventListener('dblclick', (e) => this.dbl(e));
 if (globalThis.__mavileraTest) globalThis.__mavileraTest.circuitEditor = this;
 }
 get c() { return this.cui.fileC ?? emptyCircuit(); }
 setOn(on) {
 if (on === this.on) return;
 this.cancelMode(true);
 this.on = on;
 this.toggle.setAttribute('aria-pressed', String(on));
 this.view.root.classList.toggle('bv-editing', on);
 this.layer.setAttribute('visibility', on ? 'visible' : 'hidden');
 this.tray.hidden = !on; this.bar.hidden = !on; this.tools.hidden = !on;
 this.tool = 'select';
 if (!on) { this.chooser.hidden = true; this.keysBox.hidden = true; }
 this.view.ctx.holdRun?.(on ? E.holdRun : null);
 this.view.fitSheet();
 if (on) { if ((this.cui.text ?? null) !== this.undo.now) this.undo.reset(this.cui.text ?? null); this.toldChanged = false; this.view.root.focus({ preventScroll: true }); }
 this.sel = [];
 this.focusables();
 this.draw();
 this.say(on ? E.on : E.off);
 }
 focusables() {
 for (const n of this.view.svg.querySelectorAll('.bv-btn, .bv-knob, .bv-uctl')) n.setAttribute('tabindex', this.on ? '-1' : '0');
 }
 commit(c, label) {
 const text = this.cui.textOf(c);
 if (text === (this.cui.text ?? null)) { this.cui.preview(null); this.draw(); if (label) this.say(label); return; }
 this.cui.commit(c, { quiet: true, label });
 this.view.afterEdit();
 }
 noted(text, label) {
 if (!this.on) return false;
 if (this.restoring) return true;
 this.undo.push(text, label);
 if (!this.toldChanged) { this.view.ctx.message?.(E.changed, 'ok'); this.toldChanged = true; }
 this.say(label);
 return true;
 }
 attempt(fn, label) {
 let c;
 try { c = fn(); } catch (e) { this.say(E.refused(e.message)); return false; }
 this.commit(c, typeof label === 'function' ? label(c) : label);
 return true;
 }
 restore(text) {
 this.restoring = true;
 try { this.cui.commit(text ? JSON.parse(text) : null, { quiet: true }); } finally { this.restoring = false; }
 this.view.afterEdit();
 }
 say(text) {
 this.live.textContent = '';
 setTimeout(() => { this.live.textContent = text; }, 30);
 this.lastSaid = text;
 }
 endName(end) {
 const e = parseEnd(end);
 if (!e) return end;
 if (e.kind === 'pin') return E.pinOf(e.part, e.pin);
 if (e.kind === 'node') return E.junction(e.id);
 return end;
 }
 refName(ref) {
 const c = this.c, k = kindOf(ref), key = keyOf(ref);
 if (k === 'part') { const p = c.parts.find((x) => x.id === key); return p ? `${p.id} (${PART_TYPES[p.type]?.label ?? p.type})` : key; }
 if (k === 'node') return E.junction(key);
 if (k === 'wire') { const w = c.wires[Number(key)]; return w ? E.wireName(this.endName(w.a), this.endName(w.b)) : ref; }
 if (k === 'label') { const l = c.labels[Number(key)]; return l ? E.labelName(l.net) : ref; }
 return ref;
 }
 hitName(h) {
 if (!h) return null;
 if (h.kind === 'pin' || h.kind === 'pad') return this.endName(h.end);
 if (h.kind === 'node') return E.junction(h.id);
 if (h.kind === 'part') return this.refName(`part:${h.id}`);
 if (h.kind === 'wire' || h.kind === 'bend') return this.refName(`wire:${h.wire}`);
 if (h.kind === 'label') return this.refName(`label:${h.index}`);
 return null;
 }
 atText(x, y) { return E.at(gridIndex(y), gridIndex(x)); }
 draw() {
 if (this.on && (this.cui.text ?? null) !== this.undo.now && !this.mode) this.undo.reset(this.cui.text ?? null);
 if (!this.on) { this.updateTray(); return; }
 this.focusables();
 const c = this.mode?.preview ?? this.c;
 const sel = [];
 for (const r of this.sel) {
 const k = kindOf(r), key = keyOf(r);
 if (k === 'part') { const p = c.parts.find((x) => x.id === key); if (p) { const b = partBox(p); sel.push(s('rect', { class: 'bv-ed-sel', x: b.x0 - 6, y: b.y0 - 6, width: b.x1 - b.x0 + 12, height: b.y1 - b.y0 + 12 })); } }
 else if (k === 'node') { const n = c.nodes.find((x) => x.id === key); if (n) sel.push(s('circle', { class: 'bv-ed-sel', cx: n.x, cy: n.y, r: 9 })); }
 else if (k === 'wire') { const w = c.wires[Number(key)]; const p = w && wirePath(c, w); if (p) sel.push(s('path', { class: 'bv-ed-selw', d: pathOf(p) })); }
 else if (k === 'label') { const l = c.labels[Number(key)]; if (l) sel.push(s('rect', { class: 'bv-ed-sel', x: l.x - 6 * l.net.length - 6, y: l.y - 10, width: 12 * l.net.length + 12, height: 20 })); }
 }
 this.selG.replaceChildren(...sel);
 this.ghostG.replaceChildren();
 if (this.mode?.kind === 'place' && SYMBOLS[this.mode.type] === undefined) {
 const fake = { id: '·', type: this.mode.type, x: this.cur.x, y: this.cur.y, rot: this.mode.rot || undefined, flip: this.mode.flip || undefined };
 this.ghostG.append(this.cui.symbol(fake)); this.cui.drawn.delete(fake.id);
 }
 this.wireP.setAttribute('d', this.mode?.kind === 'wire' ? pathOf(this.wirePoints()) : '');
 const m = this.mode;
 if (m?.kind === 'band') {
 Object.entries({ x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0) }).forEach(([k, v]) => this.bandR.setAttribute(k, v));
 this.bandR.setAttribute('visibility', 'visible');
 } else this.bandR.setAttribute('visibility', 'hidden');
 const { x, y } = this.cur, on = Boolean(this.hitAtCursor());
 this.curP.setAttribute('d', `M${x - 9} ${y} H${x + 9} M${x} ${y - 9} V${y + 9}${on ? ` M${x + 6} ${y} A6 6 0 1 1 ${x + 6} ${y - 0.01}` : ''}`);
 this.curP.setAttribute('class', on ? 'bv-ed-cur bv-ed-on' : 'bv-ed-cur');
 this.updateTray();
 this.syncTools();
 this.bar.textContent = this.hint();
 }
 updateTray() { for (const [t, b] of this.trayBtns) b.setAttribute('aria-pressed', String(this.mode?.kind === 'place' && this.mode.type === t)); }
 hint() {
 const m = this.mode;
 if (m?.kind === 'place') return SYMBOLS[m.type] !== undefined ? E.hint.placeOn(placeName(m.type)) : E.hint.place(placeName(m.type));
 if (m?.kind === 'wire') return E.hint.wire(this.endName(m.from));
 if (this.tool !== 'select') return E.hint.tools[this.tool];
 if (this.sel.length) return E.hint.grab(this.sel.length === 1 ? this.refName(this.sel[0]) : E.selectedN(this.sel.length));
 return E.hint.idle;
 }
 scale() { const m = this.view.svg.getScreenCTM?.(); return m && m.a ? m.a : 1; }
 tol() { return Math.max(5, 6 / this.scale()); }
 hitAtCursor(opts) { return hitTest(this.mode?.preview ?? this.c, this.cur.x, this.cur.y, GRID * 0.6, opts); }
 setCursor(x, y) { this.cur = { x: snap(x), y: snap(y) }; }
 reveal() {
 const m = this.view.svg.getScreenCTM?.(), r = this.view.root.getBoundingClientRect?.();
 if (!m || !r || !r.width) return;
 const px = m.a * this.cur.x + m.e, py = m.d * this.cur.y + m.f, pad = 40;
 const press = (key, n) => { for (let i = 0; i < Math.min(n, 40); i++) this.view.root.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); };
 if (px < r.left + pad) press('ArrowLeft', Math.ceil((r.left + pad - px) / 40));
 else if (px > r.right - pad) press('ArrowRight', Math.ceil((px - r.right + pad) / 40));
 if (py < r.top + pad) press('ArrowUp', Math.ceil((r.top + pad - py) / 40));
 else if (py > r.bottom - pad) press('ArrowDown', Math.ceil((py - r.bottom + pad) / 40));
 }
 pt(e) {
 const m = this.view.svg.getScreenCTM?.();
 if (!m) return { x: 0, y: 0 };
 const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
 return { x: p.x, y: p.y };
 }
 pickTool(t) {
 this.cancelMode(true);
 if (t === 'deletePart' || t === 'deleteWire') {
 const kinds = t === 'deletePart' ? ['part', 'node', 'label'] : ['wire'];
 const refs = this.sel.filter((r) => kinds.includes(kindOf(r)));
 if (refs.length) { this.sel = refs; this.remove(); this.tool = 'select'; this.syncTools(); return; }
 }
 this.tool = t;
 this.syncTools();
 this.say(E.toolOn(E.toolNames[t]));
 }
 syncTools() {
 for (const [t, b] of this.toolBtns) b.setAttribute('aria-pressed', String(t === this.tool));
 this.panBtn.setAttribute('aria-pressed', String(this.view.root.classList.contains('pz-panning')));
 this.view.root.dataset.edTool = this.tool;
 }
 shellPan() { return [...this.view.root.querySelectorAll('.pz-bar .pz-btn')].pop() ?? null; }
 cancelMode(quiet = false) {
 const m = this.mode;
 if (!m) return false;
 this.mode = null;
 if (m.preview) this.cui.preview(null);
 if (!quiet) this.say(m.kind === 'wire' ? E.wireAbandoned : E.cancelled);
 this.draw();
 return true;
 }
 startPlace(type, byDrag) {
 if (!this.on) return;
 this.cancelMode(true);
 this.sel = [];
 this.mode = { kind: 'place', type, rot: 0, flip: false, byDrag };
 this.draw();
 this.say(E.hint.place(placeName(type)));
 }
 place() {
 const m = this.mode;
 if (m?.kind !== 'place') return;
 const { x, y } = this.cur;
 if (SYMBOLS[m.type] !== undefined) {
 const h = this.hitAtCursor();
 const at = h?.kind === 'pin' ? h.end : h?.kind === 'node' ? h.id : null;
 if (!at) { this.say(m.type === 'label' ? E.labelHere : E.symbolHere(placeName(m.type))); return; }
 this.mode = null;
 this.putLabel(at, h, SYMBOLS[m.type]);
 return;
 }
 this.mode = null;
 let id = null;
 this.attempt(() => { const r = addPartAt(this.c, m.type, x, y, { rot: m.rot, flip: m.flip }); id = r.id; return r.circuit; }, () => E.placed(id, this.atText(x, y)));
 if (id) this.select([`part:${id}`], { grab: false, announce: false }); else this.draw();
 }
 putLabel(at, h, net = null) {
 const c = this.c, name = net || freeNet(c), sym = net === 'GND' || net === '3V3';
 const p = endPoint(c, at), q = parseEnd(at)?.kind === 'pin' ? partPins(c.parts.find((x) => x.id === parseEnd(at).part), c.defs).find((x) => x.pin === parseEnd(at).pin) : null;
 const out = q?.out ?? (net === 'GND' ? [0, 1] : net === '3V3' ? [0, -1] : [1, 0]);
 const px = p?.x ?? h.x, py = p?.y ?? h.y;
 const lx = sym ? Math.round((px + out[0] * 2 * GRID) * 10) / 10 : snap(px + out[0] * GRID);
 const ly = sym ? py + out[1] * 2 * GRID : py + (out[1] ? out[1] * GRID * 1.2 : -10);
 let idx = -1;
 this.attempt(() => { const r = addLabel(c, name, at, lx, Math.round(ly * 10) / 10 + 0); idx = r.index; return r.circuit; },
 sym ? E.symbolAdded(placeName(net === 'GND' ? 'ground' : 'power'), this.endName(at)) : E.labelAdded(name, this.endName(at)));
 if (idx >= 0) this.sel = [`label:${idx}`];
 this.draw();
 }
 select(refs, { grab = true, announce = true } = {}) {
 this.sel = refs;
 if (refs.length === 1 && ['part', 'node', 'label'].includes(kindOf(refs[0])) && grab) this.mode = { kind: 'grab', refs, dx: 0, dy: 0, preview: null };
 if (refs.length === 1 && kindOf(refs[0]) === 'part') this.view.select(`upart:${keyOf(refs[0])}`, false);
 if (announce) this.say(refs.length === 0 ? E.none : refs.length === 1 ? E.selected(this.refName(refs[0])) : E.selectedN(refs.length));
 this.draw();
 }
 nudge(dx, dy) {
 const m = this.mode;
 m.dx = Math.round((m.dx + dx) * 10) / 10; m.dy = Math.round((m.dy + dy) * 10) / 10;
 try { m.preview = moveRefs(this.c, m.refs, m.dx, m.dy); } catch { return; }
 this.cui.preview(m.preview);
 const p = refPoint(m.preview, m.refs[0]);
 if (p) this.setCursor(p.x, p.y);
 this.draw();
 }
 endGrab() {
 const m = this.mode;
 if (m?.kind !== 'grab' && m?.kind !== 'drag') return;
 this.mode = null;
 if (m.dx || m.dy) {
 const p = refPoint(m.preview, m.refs[0]);
 this.commit(m.preview, E.moved(m.refs.length === 1 ? this.refName(m.refs[0]) : E.selectedN(m.refs.length), p ? this.atText(p.x, p.y) : ''));
 } else this.draw();
 }
 startWire(from, pt) {
 this.cancelMode(true);
 this.sel = [];
 const p = endPoint(this.c, from, pt) ?? pt;
 this.mode = { kind: 'wire', from, fromPt: [p.x, p.y], fromOut: p.out ?? null, pts: [], dir: null, vFirst: false };
 this.cur = { x: p.x, y: p.y };
 this.say(E.wireStart(this.endName(from)));
 this.draw();
 }
 wirePoints() {
 const m = this.mode, last = m.pts.length ? m.pts[m.pts.length - 1] : m.fromPt, { x, y } = this.cur;
 const tail = last[0] !== x && last[1] !== y ? [m.vFirst ? [last[0], y] : [x, last[1]]] : [];
 return [m.fromPt, ...m.pts, ...tail, [x, y]];
 }
 addWireBend() {
 const pts = this.wirePoints().slice(1);
 for (const p of pts) { const l = this.mode.pts[this.mode.pts.length - 1] ?? this.mode.fromPt; if (p[0] !== l[0] || p[1] !== l[1]) this.mode.pts.push(p); }
 this.say(E.wireBend(this.mode.pts.length));
 this.draw();
 }
 endWire(h) {
 const m = this.mode;
 if (!h || !['pin', 'pad', 'node', 'wire', 'bend'].includes(h.kind)) { this.say(E.wireNoEnd); return; }
 let c = this.c, to;
 try {
 if (h.kind === 'wire' || h.kind === 'bend') {
 const wi = h.wire, path = wirePath(c, c.wires[wi]);
 const q = h.kind === 'bend' ? { x: h.x, y: h.y } : h;
 const r = splitWire(c, wi, Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10, path);
 c = r.circuit; to = r.id;
 } else to = h.kind === 'node' ? h.id : h.end;
 if (to === m.from) { this.say(E.refused(E.wireNoEnd)); return; }
 const end = endPoint(c, to, { x: this.cur.x, y: this.cur.y }) ?? { x: h.x, y: h.y, out: null };
 const pts = [m.fromPt, ...m.pts.map((p) => [...p])];
 let last = pts[pts.length - 1];
 if (pts.length > 1) {
 const prev = pts[pts.length - 2];
 if (Math.abs(last[1] - end.y) < GRID * 0.6 && last[0] === prev[0]) last[1] = end.y;
 else if (Math.abs(last[0] - end.x) < GRID * 0.6 && last[1] === prev[1]) last[0] = end.x;
 }
 last = pts[pts.length - 1];
 if (last[0] !== end.x && last[1] !== end.y) pts.push(m.vFirst ? [last[0], end.y] : [end.x, last[1]]);
 pts.push([end.x, end.y]);
 const full = orthogonal(pts, m.fromOut, end.out);
 const via = full.slice(1, -1).map(([x, y]) => [Math.round(x * 10) / 10 + 0, Math.round(y * 10) / 10 + 0]);
 c = addWire(c, m.from, to, via);
 } catch (e) { this.say(E.refused(e.message)); return; }
 this.mode = null;
 this.commit(c, E.wired(this.endName(m.from), this.endName(to)));
 }
 key(e) {
 if (!this.on || !e.isTrusted || e.defaultPrevented) return;
 if (e.target.closest?.('input, select, textarea, button, .bv-ed-pop')) return;
 const k = e.key, ctrl = e.ctrlKey || e.metaKey, step = GRID * (e.shiftKey ? 10 : 1);
 const done = () => { e.preventDefault(); e.stopImmediatePropagation(); };
 const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
 const m = this.mode;
 if (arrow && ctrl) {
 done();
 this.view.root.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
 return;
 }
 if (arrow) {
 done();
 const [dx, dy] = arrow;
 if (m?.kind === 'grab') { this.nudge(dx * step, dy * step); this.reveal(); return; }
 if (m?.kind === 'wire') {
 const dir = dx ? 'h' : 'v';
 if (m.dir && dir !== m.dir) { const l = m.pts[m.pts.length - 1] ?? m.fromPt; if (l[0] !== this.cur.x || l[1] !== this.cur.y) { m.pts.push([this.cur.x, this.cur.y]); } }
 m.dir = dir;
 m.vFirst = dir === 'v';
 }
 if (m?.kind === 'wire') this.cur = { x: Math.round((this.cur.x + dx * step) * 10) / 10 + 0, y: Math.round((this.cur.y + dy * step) * 10) / 10 + 0 };
 else this.setCursor(this.cur.x + dx * step, this.cur.y + dy * step);
 this.draw(); this.reveal();
 if (!m || m.kind === 'wire') { const h = this.hitAtCursor(m?.kind === 'wire' ? { skip: m.from } : undefined); if (h) this.say(E.here(this.hitName(h))); }
 return;
 }
 if (ctrl) {
 const kk = k.toLowerCase();
 if (kk === 'z' && !e.shiftKey) { done(); this.doUndo(); }
 else if (kk === 'y' || (kk === 'z' && e.shiftKey)) { done(); this.doRedo(); }
 else if (kk === 'c') { done(); this.copy(); }
 else if (kk === 'x') { done(); if (this.copy()) this.remove(); }
 else if (kk === 'v') { done(); this.paste(); }
 else if (kk === 'a') { done(); this.cancelMode(true); this.select(readingOrder(this.c), { grab: false }); }
 return;
 }
 switch (k) {
 case 'Enter': done(); this.enter(); return;
 case 'Escape': done(); this.escape(); return;
 case 'a': case 'A': case 'Insert': done(); this.openChooser(); return;
 case 'w': case 'W': {
 done();
 const h = this.hitAtCursor();
 if (m?.kind === 'wire') { this.endWire(this.hitAtCursor({ skip: m.from })); return; }
 if (h && (h.kind === 'pin' || h.kind === 'pad')) this.startWire(h.end, { x: h.x, y: h.y });
 else if (h?.kind === 'node') this.startWire(h.id, { x: h.x, y: h.y });
 else this.say(E.wireHere);
 return;
 }
 case 'l': case 'L': {
 done();
 if (m) this.endGrab();
 const h = this.hitAtCursor();
 if (h?.kind === 'pin' || h?.kind === 'node') this.putLabel(h.kind === 'pin' ? h.end : h.id, h); else this.say(E.labelHere);
 return;
 }
 case 'r': case 'R': done(); this.turn(false); return;
 case 'm': case 'M': done(); this.turn(true); return;
 case ' ': if (m?.kind === 'wire') { done(); m.vFirst = !m.vFirst; this.draw(); } return;
 case 'Delete': done(); this.remove(); return;
 case 'Backspace':
 done();
 if (m?.kind === 'wire') { if (m.pts.length) { const p = m.pts.pop(); this.setCursor(p[0], p[1]); this.say(E.wireBack(m.pts.length)); this.draw(); } else this.say(E.wireBack(0)); }
 else this.remove();
 return;
 case 'n': case 'N': case ']': done(); this.cycle(1); return;
 case 'p': case 'P': case '[': done(); this.cycle(-1); return;
 case 'F2': done(); this.rename(); return;
 case '?': done(); this.keysBox.hidden = !this.keysBox.hidden; return;
 default:
 }
 }
 enter() {
 const m = this.mode;
 if (m?.kind === 'place') { this.place(); return; }
 if (m?.kind === 'grab') { this.endGrab(); return; }
 if (m?.kind === 'wire') { this.endWire(this.hitAtCursor({ skip: m.from })); return; }
 const h = this.hitAtCursor();
 if (!h) { this.sel = []; this.say(E.nothingHere); this.draw(); return; }
 if (h.kind === 'part') this.select([`part:${h.id}`]);
 else if (h.kind === 'pin') { const id = parseEnd(h.end).part; this.select([`part:${id}`], { grab: false, announce: false }); this.say(E.here(this.endName(h.end))); }
 else if (h.kind === 'pad') this.say(E.here(h.end));
 else if (h.kind === 'node') this.select([`node:${h.id}`]);
 else if (h.kind === 'wire' || h.kind === 'bend') this.select([`wire:${h.wire}`], { grab: false });
 else if (h.kind === 'label') this.select([`label:${h.index}`]);
 }
 escape() {
 if (!this.keysBox.hidden) { this.keysBox.hidden = true; return; }
 const m = this.mode;
 if (m?.kind === 'grab' && !m.dx && !m.dy) this.mode = null;
 else if (m?.kind === 'grab') { const p = refPoint(this.c, m.refs[0]); if (p) this.setCursor(p.x, p.y); }
 if (this.cancelMode()) return;
 if (this.tool !== 'select') { this.tool = 'select'; this.say(E.toolOn(E.toolNames.select)); this.draw(); return; }
 if (this.sel.length) { this.sel = []; this.say(E.none); this.draw(); }
 }
 turn(mirror) {
 const m = this.mode;
 if (m?.kind === 'place') { if (mirror) m.flip = !m.flip; else m.rot = (m.rot + 90) % 360; this.draw(); return; }
 const parts = this.sel.filter((r) => kindOf(r) === 'part');
 if (parts.length !== 1) return;
 if (m?.kind === 'grab') this.endGrab();
 const id = keyOf(parts[0]);
 this.attempt(() => (mirror ? mirrorPart(this.c, id) : rotatePart(this.c, id)), (c) => (mirror ? E.mirrored(id) : E.turned(id, c.parts.find((p) => p.id === id)?.rot ?? 0)));
 this.sel = [`part:${id}`];
 this.mode = { kind: 'grab', refs: this.sel, dx: 0, dy: 0, preview: null };
 this.draw();
 }
 remove() {
 if (!this.sel.length) { this.say(E.none); return; }
 const what = this.sel.length === 1 ? this.refName(this.sel[0]) : E.objects(this.sel.length);
 const refs = this.sel;
 this.cancelMode(true);
 this.sel = [];
 this.attempt(() => removeRefs(this.c, refs), E.removed(what));
 this.draw();
 }
 cycle(dir) {
 if (this.mode?.kind === 'grab') this.endGrab(); else this.cancelMode(true);
 const order = readingOrder(this.c);
 if (!order.length) { this.say(E.noObjects); return; }
 const at = this.sel.length === 1 ? order.indexOf(this.sel[0]) : -1;
 const next = order[(at + dir + order.length) % order.length] ?? order[0];
 const p = refPoint(this.c, next);
 if (p) this.setCursor(p.x, p.y);
 this.select([next]);
 this.reveal();
 }
 rename() {
 const r = this.sel[0];
 if (!r) { this.say(E.none); return; }
 const k = kindOf(r);
 if (this.mode?.kind === 'grab') this.endGrab();
 if (k === 'part') this.view.select(`upart:${keyOf(r)}`, true);
 else if (k === 'label') this.view.select(`ulabel:${keyOf(r)}`, true);
 else { this.say(this.refName(r)); return; }
 setTimeout(() => this.view.focusInspectField(), 0);
 }
 copy() {
 const refs = this.sel.filter((r) => kindOf(r) === 'part' || kindOf(r) === 'node');
 if (!refs.length) { this.say(E.none); return false; }
 this.clip = copyRefs(this.c, refs);
 this.say(E.copied(refs.length));
 return true;
 }
 paste() {
 if (!this.clip) return;
 this.cancelMode(true);
 const first = this.clip.parts[0] ?? this.clip.nodes[0];
 let dx = first ? snap(this.cur.x - first.x) : 4 * GRID, dy = first ? snap(this.cur.y - first.y) : 4 * GRID;
 if (!dx && !dy) { dx = 4 * GRID; dy = 4 * GRID; }
 let refs = [];
 this.attempt(() => { const r = pasteClip(this.c, this.clip, dx, dy); refs = r.refs; return r.circuit; }, () => E.pasted(refs.length));
 this.sel = refs;
 this.draw();
 }
 doUndo() {
 this.cancelMode(true);
 const t = this.undo.undo();
 if (t === undefined) { this.say(E.nothingUndo); return; }
 this.sel = [];
 this.restore(t);
 this.say(E.undone(this.undo.label));
 }
 doRedo() {
 this.cancelMode(true);
 const t = this.undo.redo();
 if (t === undefined) { this.say(E.nothingRedo); return; }
 this.sel = [];
 this.restore(t);
 this.say(E.redone(this.undo.label));
 }
 openChooser() {
 this.cancelMode(true);
 this.chooser.hidden = false;
 this.chooseSel.value = this.chooseSel.value || Object.keys(PART_TYPES)[0];
 this.chooseSel.focus();
 }
 closeChooser() { this.chooser.hidden = true; this.view.root.focus({ preventScroll: true }); }
 down(e) {
 if (!this.on || e.button !== 0 || this.view.root.classList.contains('pz-panning')) return;
 e.preventDefault();
 this.view.root.focus({ preventScroll: true });
 const p = this.pt(e), tol = this.tol();
 this.setCursor(p.x, p.y);
 const m = this.mode;
 if (m?.kind === 'place') { if (!m.byDrag) this.place(); return; }
 if (m?.kind === 'wire') {
 const h = hitTest(this.c, p.x, p.y, tol, { skip: m.from });
 if (h && ['pin', 'pad', 'node', 'wire', 'bend'].includes(h.kind)) {
 if (h.kind === 'pin' || h.kind === 'pad' || h.kind === 'node') this.setCursor(h.x, h.y);
 this.endWire(h);
 } else this.addWireBend();
 return;
 }
 if (m?.kind === 'grab') this.endGrab();
 const h = hitTest(this.c, p.x, p.y, tol);
 if (this.tool === 'deletePart') {
 const ref = h?.kind === 'part' || h?.kind === 'pin' ? `part:${h.id ?? parseEnd(h.end)?.part}` : h?.kind === 'node' ? `node:${h.id}` : h?.kind === 'label' ? `label:${h.index}` : null;
 if (ref && kindOf(ref) === 'part' && !this.c.parts.some((x) => x.id === keyOf(ref))) { this.say(E.nothingHere); return; }
 if (ref) { this.sel = [ref]; this.remove(); } else this.say(E.nothingHere);
 return;
 }
 if (this.tool === 'deleteWire') {
 if (h?.kind === 'wire' || h?.kind === 'bend') { this.sel = [`wire:${h.wire}`]; this.remove(); } else this.say(E.nothingHere);
 return;
 }
 if (this.tool === 'wire') {
 if (h?.kind === 'pin' || h?.kind === 'pad') this.startWire(h.end, { x: h.x, y: h.y });
 else if (h?.kind === 'node') this.startWire(h.id, { x: h.x, y: h.y });
 else if (h?.kind === 'wire' || h?.kind === 'bend') {
 const q = h.kind === 'bend' ? h : { x: h.seg.y1 === h.seg.y2 ? snap(h.x) : h.x, y: h.seg.y1 === h.seg.y2 ? h.y : snap(h.y) };
 let id = null;
 if (this.attempt(() => { const r = splitWire(this.c, h.wire, Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10, wirePath(this.c, this.c.wires[h.wire])); id = r.id; return r.circuit; }, () => E.junctionMade(id)) && id) {
 const n = this.c.nodes.find((x) => x.id === id);
 if (n) this.startWire(id, { x: n.x, y: n.y });
 }
 } else this.say(E.wireHere);
 return;
 }
 try { this.view.svg.setPointerCapture?.(e.pointerId); } catch { }
 if (h?.kind === 'pin' || h?.kind === 'pad') { this.startWire(h.end, { x: h.x, y: h.y }); return; }
 if (h?.kind === 'bend') { this.sel = [`wire:${h.wire}`]; this.mode = { kind: 'bend', wire: h.wire, index: h.index, x0: p.x, y0: p.y, moved: false, preview: null }; this.draw(); return; }
 const ref = h?.kind === 'part' ? `part:${h.id}` : h?.kind === 'node' ? `node:${h.id}` : h?.kind === 'label' ? `label:${h.index}` : h?.kind === 'wire' ? `wire:${h.wire}` : null;
 if (!ref) { if (!e.shiftKey) this.sel = []; this.mode = { kind: 'band', x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey }; this.draw(); return; }
 if (e.shiftKey) { this.sel = this.sel.includes(ref) ? this.sel.filter((r) => r !== ref) : [...this.sel, ref]; this.draw(); return; }
 if (!this.sel.includes(ref)) this.sel = [ref];
 const movable = this.sel.filter((r) => kindOf(r) !== 'wire');
 this.mode = movable.length ? { kind: 'drag', refs: movable, x0: p.x, y0: p.y, dx: 0, dy: 0, preview: null, moved: false, ref } : null;
 this.draw();
 }
 move(e) {
 if (!this.on) return;
 const p = this.pt(e), m = this.mode;
 if (!m) return;
 if (m.kind === 'place' || m.kind === 'wire') { this.setCursor(p.x, p.y); this.draw(); return; }
 if (m.kind === 'band') { m.x1 = p.x; m.y1 = p.y; this.draw(); return; }
 if (m.kind === 'drag') {
 const dx = snap(p.x - m.x0), dy = snap(p.y - m.y0);
 if (!m.moved && Math.hypot(p.x - m.x0, p.y - m.y0) * this.scale() < 4) return;
 m.moved = true;
 if (dx === m.dx && dy === m.dy) return;
 m.dx = dx; m.dy = dy;
 try { m.preview = moveRefs(this.c, m.refs, dx, dy); } catch { return; }
 this.cui.preview(m.preview); this.draw();
 return;
 }
 if (m.kind === 'bend') {
 const x = snap(p.x), y = snap(p.y);
 if (!m.moved && Math.hypot(p.x - m.x0, p.y - m.y0) * this.scale() < 4) return;
 m.moved = true;
 try { m.preview = moveBend(this.c, m.wire, m.index, x, y); } catch { return; }
 this.cui.preview(m.preview); this.draw();
 }
 }
 up(e) {
 if (!this.on) return;
 const m = this.mode;
 try { this.view.svg.releasePointerCapture?.(e.pointerId); } catch { }
 if (!m) return;
 if (m.kind === 'place' && m.byDrag) {
 const over = e.target?.closest?.('svg') === this.view.svg;
 if (over && e.type === 'pointerup') { const p = this.pt(e); this.setCursor(p.x, p.y); this.place(); } else m.byDrag = false;
 return;
 }
 if (m.kind === 'band') {
 this.mode = null;
 const got = inRect(this.c, m.x0, m.y0, m.x1, m.y1);
 this.select(m.add ? [...new Set([...this.sel, ...got])] : got, { grab: false });
 return;
 }
 if (m.kind === 'drag') {
 if (!m.moved) { this.mode = null; this.select(this.sel.length > 1 ? this.sel : [m.ref], { grab: kindOf(m.ref) !== 'wire' }); return; }
 this.endGrab();
 return;
 }
 if (m.kind === 'bend') {
 this.mode = null;
 if (m.moved && m.preview) this.commit(m.preview, E.bendMoved); else this.draw();
 }
 }
 dbl(e) {
 if (!this.on || this.mode) return;
 const p = this.pt(e), h = hitTest(this.c, p.x, p.y, this.tol());
 if (h?.kind === 'bend') { this.attempt(() => removeBend(this.c, h.wire, h.index), E.wireBack((this.c.wires[h.wire]?.via?.length ?? 1) - 1)); return; }
 if (h?.kind !== 'wire') return;
 const horiz = h.seg.y1 === h.seg.y2;
 const x = horiz ? snap(h.x) : h.x, y = horiz ? h.y : snap(h.y);
 const path = wirePath(this.c, this.c.wires[h.wire]);
 this.attempt(() => addBend(this.c, h.wire, Math.round(x * 10) / 10, Math.round(y * 10) / 10, path), E.bendAdded);
 }
}
