// dock.js -- where the execution controls stand (the toolbar the shell builds for every architecture, main.js): a row
// on top of the workspace (the default, as before) or a narrow column at its left or right, so that a tall drawing
// gets the height of the row. It is the same toolbar in every place: the same nodes, with their handlers, states,
// shortcuts and capabilities, only laid out otherwise (theme.css, .app-main[data-dock]); nothing is rebuilt, so the
// simulation, the program, the drawing and its zoom are untouched by a change of place. In a column the controls that
// do not fit as an icon (the speed, the Architecture) move into small menus that open beside the column, and the
// row's overflow (overflow.js) is paused: the column scrolls instead. A narrow screen keeps the row on top (its own
// layout, ui/workspaces.js) without forgetting the place chosen, which returns when the screen is wide again.
// The choice is the platform's (one for every architecture): storage key pips.toolbarDock.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { store } from './dom.js';

export const DOCK_KEY = 'pips.toolbarDock';
export const DOCKS = Object.freeze(['top', 'left', 'right']);
export const DEFAULT_DOCK = 'top';

/** A saved place, or the default for a missing or unknown value. */
export const parseDock = (v) => (DOCKS.includes(v) ? v : DEFAULT_DOCK);

/**
 * The place shown: the chosen one, except on a narrow screen, which keeps the row on top, and in the compact layout
 * of Focus and Full screen (view-mode.js), which needs a column: Top shows at the left there (the choice stays Top).
 */
export function effectiveDock(chosen, { narrow = false, compact = false } = {}) {
  if (narrow) return 'top';
  const p = parseDock(chosen);
  return compact && p === 'top' ? 'left' : p;
}

/**
 * Where a menu opened from a docked column stands (fixed, client pixels): beside its button, on the side away from
 * the dock's edge (toward the drawing), its top level with the button, and inside the window, `gap` from each edge.
 * @param {{left: number, top: number, right: number}} anchor  the button
 * @param {{w: number, h: number}} menu  the menu's size
 * @param {{w: number, h: number}} view  the window
 * @param {'left'|'right'} side  the dock's side
 * @returns {{left: number, top: number, maxHeight: number}}
 */
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
  /**
   * @param {object} o
   * @param {HTMLElement} o.main     the element that holds the toolbar and the workspace; it carries data-dock
   * @param {HTMLElement} o.toolbar  the toolbar (role toolbar)
   * @param {{pause: (on: boolean) => void}} o.fit  the toolbar's overflow, paused while the toolbar is a column
   * @param {Array<{menu: HTMLDetailsElement, body: HTMLElement, nodes: HTMLElement[]}>} o.flyouts  menus of the
   *   column (hidden in the row), and the controls that move into each one's `body` while the toolbar is a column
   * @param {MediaQueryList} o.narrow  matches where the screen is too narrow for a column
   * @param {(place: string, chosen: string) => void} [o.onChange]  after every change of the place shown or chosen
   */
  constructor({ main, toolbar, fit, flyouts, narrow, onChange = null }) {
    Object.assign(this, { main, toolbar, fitter: fit, flyouts, narrow, onChange });
    this.chosen = parseDock(store.get(DOCK_KEY));
    this.compact = false; // the compact layout of Focus and Full screen (setCompact)
    this.place = null;
    // a placeholder at each moving control's place in the row (the row whole while they are made: none in its More menu)
    fit.pause(true);
    this.home = new Map(flyouts.flatMap((f) => f.nodes).map((n) => { const c = document.createComment(''); n.before(c); return [n, c]; }));
    fit.pause(false);
    // a menu opened from the column stands beside it, in the window (the column scrolls, so it cannot hang from it)
    toolbar.addEventListener('toggle', (e) => { if (e.target.open && this.side) this.placeMenu(e.target, true); }, true);
    // a list filled after it opened (Templates loads its index) is placed again at its new size
    // (on the next frame, when the list has its size, and not inside the observer's callback)
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

  /** Docked at a side (a column)? */
  get side() { return this.place === 'left' || this.place === 'right'; }

  /** Choose a place (kept in storage) and show it, or the row where the screen is narrow. */
  choose(place, save = true) {
    this.chosen = parseDock(place);
    if (save) store.set(DOCK_KEY, this.chosen);
    this.apply(true);
  }

  /** The compact layout on or off (view-mode.js): Top shows as a column while it is on; the choice is not changed. */
  setCompact(on) {
    this.compact = on;
    this.apply(true);
  }

  /** Lay the toolbar out for the place to show now. */
  apply(notify = false) {
    const place = effectiveDock(this.chosen, { narrow: this.narrow.matches, compact: this.compact });
    if (place === this.place) { if (notify) this.onChange?.(this.place, this.chosen); return; }
    const focus = document.activeElement;
    this.closeMenus();
    const side = place !== 'top';
    this.place = place;
    if (side) {
      this.fitter.pause(true); // every control back in the row (none in its More menu), then the column's menus
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

  /** A menu of the column shows while the toolbar is a column and something in it is offered (not hidden) in this view. */
  sync() {
    for (const f of this.flyouts) {
      f.menu.hidden = !this.side || f.nodes.every((n) => n.hidden);
      if (f.menu.hidden) f.menu.open = false;
    }
  }

  /** Close the toolbar's open menus, and let their lists hang from their buttons again. */
  closeMenus() {
    for (const d of this.toolbar.querySelectorAll('details[open]')) d.open = false;
    for (const l of this.toolbar.querySelectorAll('.menu-list[style]')) l.removeAttribute('style');
  }

  /** Put the list of the menu `d` beside the column, toward the drawing, inside the window (`opened`: just opened). */
  placeMenu(d, opened = false) {
    const list = d.querySelector(':scope > .menu-list');
    const anchor = d.querySelector(':scope > summary');
    if (!list || !anchor) return;
    Object.assign(list.style, { position: 'fixed', left: '0px', top: '0px', right: 'auto', maxHeight: '', overflowY: 'auto' });
    const r = list.getBoundingClientRect();
    const p = flyoutPlace(anchor.getBoundingClientRect(), { w: r.width, h: r.height }, { w: innerWidth, h: innerHeight }, this.place);
    // its own maximum height (theme.css) stays, unless the window is lower
    Object.assign(list.style, { left: `${p.left}px`, top: `${p.top}px`, maxHeight: r.height > p.maxHeight ? `${p.maxHeight}px` : '' });
    this.lists?.observe(list);
    if (opened && d.classList.contains('dock-fly')) {
      const first = [...list.querySelectorAll('select, input, button')].find((n) => !n.disabled && n.getClientRects().length > 0);
      first?.focus({ preventScroll: true });
    }
  }
}
