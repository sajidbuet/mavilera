// pan-zoom.js -- pan and zoom for a processor drawing (contract v7 ViewInstance.diagrams; arch-contract.md
// §20). The shell attaches one controller per drawing. The drawing keeps its viewBox (the view owns it: variants,
// export); the controller sets a CSS transform on the svg, translate(x, y) scale(k) from its top left corner, so
// that pointer hit-testing, clicks and tooltips follow. k = 1 with no translation is the drawing fitted and centred
// in its box (preserveAspectRatio meet). The wheel zooms around the pointer, a right drag pans, and so does a left
// drag while Pan is on (WS-U-030); keys +, -, 0 and the arrows on the focused drawing (WS-U-034). Besides the whole
// drawing, the drawing can be fitted to the pane's width or height; a fit holds while the pane changes size.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { icon } from './icons.js';
import { STRINGS } from './strings.js';

/** The zoom range, in screen pixels per unit of the drawing (1: the drawing's own size, "100 %"). */
export const LIMITS = Object.freeze({ min: 0.25, max: 8 });
export const STEP = 1.25; // a button or key zooms by this factor
export const PAN_STEP = 40; // pixels an arrow key pans (Shift: four times)
export const MARGIN = 48; // pixels of the drawing that stay in view, at least
export const DRAG = 4; // pixels a pointer moves before a press becomes a drag (no click then)
export const FIT = Object.freeze({ k: 1, x: 0, y: 0 });

// --- the arithmetic (pure; test/pan-zoom.test.mjs) -----------------------------------------------------------------

/** Screen pixels per drawing unit when the drawing `box` {w, h} is fitted in the `pane` {w, h}. */
export const fitScale = (pane, box) => (box.w > 0 && box.h > 0 ? Math.min(pane.w / box.w, pane.h / box.h) : 1);

/** Where the fitted drawing stands in its pane, {x, y, w, h} in pixels (centred). */
export function drawnRect(pane, box) {
  const f = fitScale(pane, box);
  const w = box.w * f;
  const h = box.h * f;
  return { x: (pane.w - w) / 2, y: (pane.h - h) / 2, w, h };
}

/** The zoom in pixels per drawing unit of a transform `t`, the drawing fitted at `f`. */
export const zoomOf = (t, f) => t.k * f;

/** `k` within the limits; the fitted size is always allowed, however small or large the pane. */
export function clampK(k, f, limits = LIMITS) {
  const lo = Math.min(limits.min, f) / f;
  const hi = Math.max(limits.max, f) / f;
  return Math.min(hi, Math.max(lo, k));
}

/** `t` moved so that at least `margin` pixels of the drawing (fewer if it is smaller) stay in the pane. */
export function clampPan(t, pane, drawn, margin = MARGIN) {
  const axis = (pos, size, at, len) => {
    const m = Math.min(margin, (t.k * len) / 2, size / 2);
    const lo = m - t.k * (at + len); // the far edge stays m inside the near side
    const hi = size - m - t.k * at; // the near edge stays m inside the far side
    return Math.min(hi, Math.max(lo, pos));
  };
  return { k: t.k, x: axis(t.x, pane.w, drawn.x, drawn.w), y: axis(t.y, pane.h, drawn.y, drawn.h) };
}

/** `t` zoomed by `factor` around the pane point `p` {x, y}: the point under it stays where it is (unless k is clamped). */
export function zoomAt(t, factor, p, f, limits = LIMITS) {
  const k = clampK(t.k * factor, f, limits);
  const r = k / t.k;
  return { k, x: p.x - (p.x - t.x) * r, y: p.y - (p.y - t.y) * r };
}

/** `t` zoomed to `zoom` pixels per drawing unit around the pane's centre (the "100 %" button: zoom 1). */
export const zoomTo = (t, zoom, pane, f, limits = LIMITS) => zoomAt(t, zoom / f / t.k, { x: pane.w / 2, y: pane.h / 2 }, f, limits);

/**
 * The transform that fits the drawing's width (`axis` 'w') or height ('h') to the pane, centred on both axes: the
 * other axis may then be larger than the pane (it pans) or smaller (it is centred). Proportions are kept: one scale.
 */
export function fitAxis(axis, pane, box, limits = LIMITS) {
  const f = fitScale(pane, box);
  const d = drawnRect(pane, box);
  const want = axis === 'w' ? pane.w / box.w : pane.h / box.h;
  const k = clampK(want / f, f, limits);
  const snap = (v) => (Math.abs(v) < 1e-6 ? 0 : v); // the axis that already fits gives exactly the fitted transform
  return { k: Math.abs(k - 1) < 1e-9 ? 1 : k, x: snap(pane.w / 2 - k * (d.x + d.w / 2)), y: snap(pane.h / 2 - k * (d.y + d.h / 2)) };
}

/**
 * `t` carried over a change of the pane's size (`before` and `after`: {pane, box}): the zoom in pixels per drawing
 * unit stays, and so does the drawing point at the centre of the pane (a zoomed or panned view is kept as it was).
 */
export function keepView(t, before, after) {
  const f0 = fitScale(before.pane, before.box);
  const f1 = fitScale(after.pane, after.box);
  const d0 = drawnRect(before.pane, before.box);
  const d1 = drawnRect(after.pane, after.box);
  const z = t.k * f0;
  const ux = ((before.pane.w / 2 - t.x) / t.k - d0.x) / f0; // the drawing point (drawing units) at the old centre
  const uy = ((before.pane.h / 2 - t.y) / t.k - d0.y) / f0;
  const k = z / f1;
  return { k, x: after.pane.w / 2 - k * d1.x - z * ux, y: after.pane.h / 2 - k * d1.y - z * uy };
}

/** The zoom factor of a wheel event: a pinch on a touchpad arrives as Ctrl + wheel with small deltas. */
export function wheelFactor({ deltaY, deltaMode = 0, ctrlKey = false }, pageHeight = 800) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * pageHeight : deltaY;
  return Math.exp(-Math.max(-200, Math.min(200, px)) * (ctrlKey ? 0.01 : 0.0015));
}

/**
 * What a key does on the focused drawing: {zoom: 1 | -1}, {fit: true}, {pan: [dx, dy]} (pixels the drawing moves),
 * or null. With Ctrl, Alt or Meta nothing (the browser's own zoom and shortcuts).
 */
export function keyAction({ key, ctrlKey = false, altKey = false, metaKey = false, shiftKey = false }) {
  if (ctrlKey || altKey || metaKey) return null;
  if (key === '+' || key === '=') return { zoom: 1 };
  if (key === '-' || key === '_') return { zoom: -1 };
  if (key === '0') return { fit: true };
  const d = PAN_STEP * (shiftKey ? 4 : 1);
  const pan = { ArrowLeft: [d, 0], ArrowRight: [-d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[key];
  return pan ? { pan } : null;
}

// --- the controller (in the browser) --------------------------------------------------------------------------------

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const Z = () => STRINGS.panZoom;

export class PanZoom {
  /**
   * Pan and zoom for `svg`, whose parent becomes the viewport (contract v7). `name` is the drawing's name for the
   * viewport's accessible name. `shared` {pan: boolean} holds the Pan toggle, the same for every drawing of the page.
   */
  constructor(svg, { name = '', shared = { pan: false } } = {}) {
    this.svg = svg;
    this.shared = shared;
    (shared.all ??= new Set()).add(this);
    this.t = { ...FIT };
    // 'fit' (the whole drawing), 'width' or 'height' (fitted on one axis): kept when the pane changes size;
    // 'manual' (zoomed or panned): the zoom and the point at the centre are kept instead (keepView)
    this.mode = 'fit';
    this.last = null; // the pane and drawing sizes of the last transform set, {pane, box}
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
    // the fit buttons show which fit holds (pressed); a zoom or a pan releases it, and a press restores it
    this.fitBtns = {
      fit: button(icon('fitView', { size: 16 }), Z().fit, () => this.fit(true), { 'aria-pressed': 'true' }),
      width: button(icon('fitWidth', { size: 16 }), Z().fitWidth, () => this.fitTo('width', true), { 'aria-pressed': 'false' }),
      height: button(icon('fitHeight', { size: 16 }), Z().fitHeight, () => this.fitTo('height', true), { 'aria-pressed': 'false' }),
    };
    this.bar = el('div.pz-bar', { role: 'toolbar', 'aria-label': Z().toolbar },
      button(icon('zoomOut', { size: 16 }), Z().zoomOut, () => this.step(-1)),
      this.level,
      button(icon('zoomIn', { size: 16 }), Z().zoomIn, () => this.step(1)),
      this.fitBtns.fit, this.fitBtns.width, this.fitBtns.height,
      this.panBtn);
    view.append(this.bar);

    view.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    view.addEventListener('contextmenu', (e) => { if (!this.bar.contains(e.target)) e.preventDefault(); });
    view.addEventListener('pointerdown', (e) => this.down(e));
    view.addEventListener('pointermove', (e) => this.move(e));
    for (const type of ['pointerup', 'pointercancel']) view.addEventListener(type, (e) => this.up(e));
    view.addEventListener('click', (e) => { if (this.noClick) { e.preventDefault(); e.stopPropagation(); this.noClick = false; } }, true);
    view.addEventListener('keydown', (e) => this.key(e));
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.resized()).observe(view);
    this.syncPan();
    this.apply();
  }

  /** The drawing's box as laid out (untransformed), {left, top, w, h} in client pixels, and its viewBox {w, h}. */
  geometry() {
    const r = this.svg.getBoundingClientRect(); // transformed: undo translate(x, y) scale(k)
    const vb = this.svg.viewBox?.baseVal;
    const pane = { w: r.width / this.t.k, h: r.height / this.t.k };
    const box = vb && vb.width > 0 ? { w: vb.width, h: vb.height } : pane;
    return { left: r.left - this.t.x, top: r.top - this.t.y, pane, box, f: fitScale(pane, box) };
  }

  /** Set the transform (kept in view), and the zoom shown on the toolbar. */
  apply(t = this.t, animate = false) {
    const g = this.geometry();
    if (!(g.pane.w > 0 && g.pane.h > 0)) return; // hidden: keep t as it is
    this.t = clampPan({ ...t, k: clampK(t.k, g.f) }, g.pane, drawnRect(g.pane, g.box));
    this.last = { pane: g.pane, box: g.box };
    this.view.classList.toggle('pz-anim', animate && !reducedMotion());
    const { k, x, y } = this.t;
    this.svg.style.transform = k === 1 && x === 0 && y === 0 ? '' : `translate(${x}px, ${y}px) scale(${k})`;
    const n = Math.round(zoomOf(this.t, g.f) * 100);
    this.level.textContent = Z().percent(n);
    this.level.setAttribute('aria-label', Z().level(n));
  }

  /**
   * The pane changed size (a split moved, the execution controls docked elsewhere, the window resized): a fit is
   * computed again for the new size; a manual view keeps its zoom and centre. An unchanged size changes nothing.
   */
  resized() {
    const g = this.geometry();
    if (!(g.pane.w > 0 && g.pane.h > 0)) return;
    const same = this.last && Math.abs(this.last.pane.w - g.pane.w) < 0.5 && Math.abs(this.last.pane.h - g.pane.h) < 0.5
      && this.last.box.w === g.box.w && this.last.box.h === g.box.h;
    if (this.mode === 'fit') this.apply({ ...FIT });
    else if (this.mode !== 'manual') this.apply(fitAxis(this.mode === 'width' ? 'w' : 'h', g.pane, g.box));
    else this.apply(same || !this.last ? this.t : keepView(this.t, this.last, g));
  }

  /** The fit in force ('fit', 'width', 'height') or 'manual'; the fit buttons show it. */
  setMode(m) {
    this.mode = m;
    for (const [id, b] of Object.entries(this.fitBtns)) b.setAttribute('aria-pressed', String(id === m));
  }

  step(dir) {
    const g = this.geometry();
    this.setMode('manual');
    this.apply(zoomAt(this.t, dir > 0 ? STEP : 1 / STEP, { x: g.pane.w / 2, y: g.pane.h / 2 }, g.f), true);
  }

  actual() {
    const g = this.geometry();
    this.setMode('manual');
    this.apply(zoomTo(this.t, 1, g.pane, g.f), true);
  }

  fit(animate = false) { this.setMode('fit'); this.apply({ ...FIT }, animate); }

  /** Fit the drawing's width or height (`axis` 'width' or 'height') to the pane; it stays so through a resize. */
  fitTo(axis, animate = false) {
    const g = this.geometry();
    this.setMode(axis);
    if (g.pane.w > 0 && g.pane.h > 0) this.apply(fitAxis(axis === 'width' ? 'w' : 'h', g.pane, g.box), animate);
  }

  setPan(on) {
    this.shared.pan = on;
    for (const c of this.shared.all) c.syncPan();
  }

  /** The Pan button and the cursor follow the shared toggle. */
  syncPan() {
    this.panBtn.setAttribute('aria-pressed', String(this.shared.pan));
    this.view.classList.toggle('pz-panning', this.shared.pan);
  }

  wheel(e) {
    if (this.bar.contains(e.target)) return;
    e.preventDefault(); // over the drawing the wheel zooms; outside it the page scrolls as before
    const g = this.geometry();
    this.setMode('manual');
    this.apply(zoomAt(this.t, wheelFactor(e, innerHeight), { x: e.clientX - g.left, y: e.clientY - g.top }, g.f));
  }

  down(e) {
    if (this.bar.contains(e.target)) return;
    if (e.pointerType === 'touch') {
      if (!this.shared.pan) return; // touch-action lets the page scroll and zoom while Pan is off
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) { this.drag = null; this.pinch = { t: this.t, ...this.spread() }; return; }
    }
    const pans = e.button === 2 || (e.button === 0 && this.shared.pan);
    if (!pans || this.touches.size > 1) return;
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, t: this.t, moved: false };
  }

  /** The two touches' distance and midpoint (pane coordinates). */
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
      this.setMode('manual');
      this.apply({ k: t.k, x: t.x + now.p.x - this.pinch.p.x, y: t.y + now.p.y - this.pinch.p.y });
      return;
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG) return;
    if (!d.moved) { // capture only now: a press that does not move stays a click on the element under it
      d.moved = true;
      this.view.setPointerCapture?.(e.pointerId);
      this.view.classList.add('pz-dragging');
      this.setMode('manual');
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
    if (d.moved) { // a drag never clicks: the click that follows it is swallowed
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
    else { this.setMode('manual'); this.apply({ k: this.t.k, x: this.t.x + a.pan[0], y: this.t.y + a.pan[1] }); }
  }
}
