// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { store } from './dom.js';
export const DOCK_KEY = 'pips.toolbarDock';
export const DOCKS = Object.freeze(['top', 'left', 'right']);
export const DEFAULT_DOCK = 'top';
export const parseDock = (v) => (DOCKS.includes(v) ? v : DEFAULT_DOCK);
export function effectiveDock(chosen, { narrow = false, compact = false } = {}) {
 if (narrow) return 'top';
 const p = parseDock(chosen);
 return compact && p === 'top' ? 'left' : p;
}
export function flyoutPlace(anchor, menu, view, side, gap = 6) {
 const maxHeight = Math.max(0, view.h - 2 * gap);
 const h = Math.min(menu.h, maxHeight);
 const left = side === 'left' ? anchor.right + gap : anchor.left - gap - menu.w;
 return {
 left: Math.max(gap, Math.min(left, view.w - gap - menu.w)),
 top: Math.max(gap, Math.min(anchor.top, view.h - gap - h)),
 maxHeight,
 };
}
export class ToolbarDock {
 constructor({ main, toolbar, fit, flyouts, narrow, onChange = null }) {
 Object.assign(this, { main, toolbar, fitter: fit, flyouts, narrow, onChange });
 this.chosen = parseDock(store.get(DOCK_KEY));
 this.compact = false;
 this.place = null;
 fit.pause(true);
 this.home = new Map(flyouts.flatMap((f) => f.nodes).map((n) => { const c = document.createComment(''); n.before(c); return [n, c]; }));
 fit.pause(false);
 toolbar.addEventListener('toggle', (e) => { if (e.target.open && this.side) this.placeMenu(e.target, true); }, true);
 this.lists = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => {
 for (const { target } of es) {
 if (target.dataset.placing) continue;
 target.dataset.placing = '1';
 requestAnimationFrame(() => {
 delete target.dataset.placing;
 if (this.side && target.parentElement?.open) this.placeMenu(target.parentElement);
 });
 }
 }) : null;
 const closeAll = () => { if (this.side) this.closeMenus(); };
 toolbar.addEventListener('scroll', closeAll, { passive: true });
 window.addEventListener('resize', closeAll);
 narrow.addEventListener('change', () => this.apply(true));
 }
 get side() { return this.place === 'left' || this.place === 'right'; }
 choose(place, save = true) {
 this.chosen = parseDock(place);
 if (save) store.set(DOCK_KEY, this.chosen);
 this.apply(true);
 }
 setCompact(on) {
 this.compact = on;
 this.apply(true);
 }
 apply(notify = false) {
 const place = effectiveDock(this.chosen, { narrow: this.narrow.matches, compact: this.compact });
 if (place === this.place) { if (notify) this.onChange?.(this.place, this.chosen); return; }
 const focus = document.activeElement;
 this.closeMenus();
 const side = place !== 'top';
 this.place = place;
 if (side) {
 this.fitter.pause(true);
 for (const f of this.flyouts) f.body.append(...f.nodes);
 this.main.dataset.dock = place;
 } else {
 for (const f of this.flyouts) for (const n of f.nodes) this.home.get(n).after(n);
 delete this.main.dataset.dock;
 this.fitter.pause(false);
 }
 this.sync();
 this.toolbar.setAttribute('aria-orientation', side ? 'vertical' : 'horizontal');
 if (focus && focus !== document.activeElement && focus.isConnected && !focus.closest('[hidden]')) focus.focus({ preventScroll: true });
 this.onChange?.(this.place, this.chosen);
 }
 sync() {
 for (const f of this.flyouts) {
 f.menu.hidden = !this.side || f.nodes.every((n) => n.hidden);
 if (f.menu.hidden) f.menu.open = false;
 }
 }
 closeMenus() {
 for (const d of this.toolbar.querySelectorAll('details[open]')) d.open = false;
 for (const l of this.toolbar.querySelectorAll('.menu-list[style]')) l.removeAttribute('style');
 }
 placeMenu(d, opened = false) {
 const list = d.querySelector(':scope > .menu-list');
 const anchor = d.querySelector(':scope > summary');
 if (!list || !anchor) return;
 Object.assign(list.style, { position: 'fixed', left: '0px', top: '0px', right: 'auto', maxHeight: '', overflowY: 'auto' });
 const r = list.getBoundingClientRect();
 const p = flyoutPlace(anchor.getBoundingClientRect(), { w: r.width, h: r.height }, { w: innerWidth, h: innerHeight }, this.place);
 Object.assign(list.style, { left: `${p.left}px`, top: `${p.top}px`, maxHeight: r.height > p.maxHeight ? `${p.maxHeight}px` : '' });
 this.lists?.observe(list);
 if (opened && d.classList.contains('dock-fly')) {
 const first = [...list.querySelectorAll('select, input, button')].find((n) => !n.disabled && n.getClientRects().length > 0);
 first?.focus({ preventScroll: true });
 }
 }
}
