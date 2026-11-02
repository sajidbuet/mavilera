// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
import { icon } from './icons.js';
import { STRINGS } from './strings.js';
export const LIMITS = Object.freeze({ min: 0.25, max: 8 });
export const STEP = 1.25;
export const PAN_STEP = 40;
export const MARGIN = 48;
export const DRAG = 4;
export const FIT = Object.freeze({ k: 1, x: 0, y: 0 });
export const fitScale = (pane, box) => (box.w > 0 && box.h > 0 ? Math.min(pane.w / box.w, pane.h / box.h) : 1);
export function drawnRect(pane, box) {
 const f = fitScale(pane, box);
 const w = box.w * f;
 const h = box.h * f;
 return { x: (pane.w - w) / 2, y: (pane.h - h) / 2, w, h };
}
export const zoomOf = (t, f) => t.k * f;
export function clampK(k, f, limits = LIMITS) {
 const lo = Math.min(limits.min, f) / f;
 const hi = Math.max(limits.max, f) / f;
 return Math.min(hi, Math.max(lo, k));
}
export function clampPan(t, pane, drawn, margin = MARGIN) {
 const axis = (pos, size, at, len) => {
 const m = Math.min(margin, (t.k * len) / 2, size / 2);
 const lo = m - t.k * (at + len);
 const hi = size - m - t.k * at;
 return Math.min(hi, Math.max(lo, pos));
 };
 return { k: t.k, x: axis(t.x, pane.w, drawn.x, drawn.w), y: axis(t.y, pane.h, drawn.y, drawn.h) };
}
export function zoomAt(t, factor, p, f, limits = LIMITS) {
 const k = clampK(t.k * factor, f, limits);
 const r = k / t.k;
 return { k, x: p.x - (p.x - t.x) * r, y: p.y - (p.y - t.y) * r };
}
export const zoomTo = (t, zoom, pane, f, limits = LIMITS) => zoomAt(t, zoom / f / t.k, { x: pane.w / 2, y: pane.h / 2 }, f, limits);
export function wheelFactor({ deltaY, deltaMode = 0, ctrlKey = false }, pageHeight = 800) {
 const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * pageHeight : deltaY;
 return Math.exp(-Math.max(-200, Math.min(200, px)) * (ctrlKey ? 0.01 : 0.0015));
}
export function keyAction({ key, ctrlKey = false, altKey = false, metaKey = false, shiftKey = false }) {
 if (ctrlKey || altKey || metaKey) return null;
 if (key === '+' || key === '=') return { zoom: 1 };
 if (key === '-' || key === '_') return { zoom: -1 };
 if (key === '0') return { fit: true };
 const d = PAN_STEP * (shiftKey ? 4 : 1);
 const pan = { ArrowLeft: [d, 0], ArrowRight: [-d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[key];
 return pan ? { pan } : null;
}
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const Z = () => STRINGS.panZoom;
export class PanZoom {
 constructor(svg, { name = '', shared = { pan: false } } = {}) {
 this.svg = svg;
 this.shared = shared;
 (shared.all ??= new Set()).add(this);
 this.t = { ...FIT };
 this.drag = null;
 this.touches = new Map();
 this.noClick = false;
 const view = svg.parentElement;
 this.view = view;
 view.classList.add('pz-view');
 svg.classList.add('pz-svg');
 view.setAttribute('tabindex', '0');
 view.setAttribute('role', 'group');
 view.setAttribute('aria-label', Z().viewport(name));
 view.setAttribute('aria-keyshortcuts', '+ - 0 ArrowLeft ArrowRight ArrowUp ArrowDown');
 const button = (glyph, label, onclick, attrs = {}) => el('button.pz-btn', { type: 'button', title: label, 'aria-label': label, onclick, ...attrs }, glyph);
 this.level = el('button.pz-btn.pz-level.mono', { type: 'button', title: Z().actual, 'aria-label': Z().actual, onclick: () => this.actual() });
 this.panBtn = button(icon('pan', { size: 16 }), Z().pan, () => this.setPan(!this.shared.pan), { 'aria-pressed': 'false' });
 this.bar = el('div.pz-bar', { role: 'toolbar', 'aria-label': Z().toolbar },
 button(icon('zoomOut', { size: 16 }), Z().zoomOut, () => this.step(-1)),
 this.level,
 button(icon('zoomIn', { size: 16 }), Z().zoomIn, () => this.step(1)),
 button(icon('fitView', { size: 16 }), Z().fit, () => this.fit(true)),
 this.panBtn);
 view.append(this.bar);
 view.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
 view.addEventListener('contextmenu', (e) => { if (!this.bar.contains(e.target)) e.preventDefault(); });
 view.addEventListener('pointerdown', (e) => this.down(e));
 view.addEventListener('pointermove', (e) => this.move(e));
 for (const type of ['pointerup', 'pointercancel']) view.addEventListener(type, (e) => this.up(e));
 view.addEventListener('click', (e) => { if (this.noClick) { e.preventDefault(); e.stopPropagation(); this.noClick = false; } }, true);
 view.addEventListener('keydown', (e) => this.key(e));
 if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.apply()).observe(view);
 this.syncPan();
 this.apply();
 }
 geometry() {
 const r = this.svg.getBoundingClientRect();
 const vb = this.svg.viewBox?.baseVal;
 const pane = { w: r.width / this.t.k, h: r.height / this.t.k };
 const box = vb && vb.width > 0 ? { w: vb.width, h: vb.height } : pane;
 return { left: r.left - this.t.x, top: r.top - this.t.y, pane, box, f: fitScale(pane, box) };
 }
 apply(t = this.t, animate = false) {
 const g = this.geometry();
 if (!(g.pane.w > 0 && g.pane.h > 0)) return;
 this.t = clampPan({ ...t, k: clampK(t.k, g.f) }, g.pane, drawnRect(g.pane, g.box));
 this.view.classList.toggle('pz-anim', animate && !reducedMotion());
 const { k, x, y } = this.t;
 this.svg.style.transform = k === 1 && x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px) scale(${k})`;
 const n = Math.round(zoomOf(this.t, g.f) * 100);
 this.level.textContent = Z().percent(n);
 this.level.setAttribute('aria-label', Z().level(n));
 }
 step(dir) {
 const g = this.geometry();
 this.apply(zoomAt(this.t, dir > 0 ? STEP : 1 / STEP, { x: g.pane.w / 2, y: g.pane.h / 2 }, g.f), true);
 }
 actual() {
 const g = this.geometry();
 this.apply(zoomTo(this.t, 1, g.pane, g.f), true);
 }
 fit(animate = false) { this.apply({ ...FIT }, animate); }
 setPan(on) {
 this.shared.pan = on;
 for (const c of this.shared.all) c.syncPan();
 }
 syncPan() {
 this.panBtn.setAttribute('aria-pressed', String(this.shared.pan));
 this.view.classList.toggle('pz-panning', this.shared.pan);
 }
 wheel(e) {
 if (this.bar.contains(e.target)) return;
 e.preventDefault();
 const g = this.geometry();
 this.apply(zoomAt(this.t, wheelFactor(e, innerHeight), { x: e.clientX - g.left, y: e.clientY - g.top }, g.f));
 }
 down(e) {
 if (this.bar.contains(e.target)) return;
 if (e.pointerType === 'touch') {
 if (!this.shared.pan) return;
 this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
 if (this.touches.size === 2) { this.drag = null; this.pinch = { t: this.t, ...this.spread() }; return; }
 }
 const pans = e.button === 2 || (e.button === 0 && this.shared.pan);
 if (!pans || this.touches.size > 1) return;
 this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, t: this.t, moved: false };
 }
 spread() {
 const [a, b] = [...this.touches.values()];
 const g = this.geometry();
 return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, p: { x: (a.x + b.x) / 2 - g.left, y: (a.y + b.y) / 2 - g.top } };
 }
 move(e) {
 if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
 if (this.pinch && this.touches.size === 2) {
 const now = this.spread();
 const t = zoomAt(this.pinch.t, now.d / this.pinch.d, this.pinch.p, this.geometry().f);
 this.apply({ k: t.k, x: t.x + now.p.x - this.pinch.p.x, y: t.y + now.p.y - this.pinch.p.y });
 return;
 }
 const d = this.drag;
 if (!d || d.id !== e.pointerId) return;
 const dx = e.clientX - d.sx;
 const dy = e.clientY - d.sy;
 if (!d.moved && Math.hypot(dx, dy) < DRAG) return;
 if (!d.moved) {
 d.moved = true;
 this.view.setPointerCapture?.(e.pointerId);
 this.view.classList.add('pz-dragging');
 }
 this.apply({ k: d.t.k, x: d.t.x + dx, y: d.t.y + dy });
 }
 up(e) {
 this.touches.delete(e.pointerId);
 if (this.touches.size < 2) this.pinch = null;
 const d = this.drag;
 if (!d || d.id !== e.pointerId) return;
 this.drag = null;
 this.view.classList.remove('pz-dragging');
 if (d.moved) {
 this.noClick = true;
 setTimeout(() => { this.noClick = false; }, 0);
 }
 }
 key(e) {
 if (e.defaultPrevented || (this.bar.contains(e.target) && e.key.startsWith('Arrow'))) return;
 if (e.target.closest?.('input, select, textarea')) return;
 const a = keyAction(e);
 if (!a) return;
 e.preventDefault();
 if (a.zoom) this.step(a.zoom);
 else if (a.fit) this.fit(true);
 else this.apply({ k: this.t.k, x: this.t.x + a.pan[0], y: this.t.y + a.pan[1] });
 }
}
