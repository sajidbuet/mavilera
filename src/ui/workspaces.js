// workspaces.js -- the workspaces of a narrow screen. On a desktop the panes of the resizable workspace (split.js)
// are side by side; below the breakpoint one workspace shows at a time (Code, Listing, Datapath, CPU, Memory), chosen
// from a tab row under the toolbar, and the console is a sheet that opens over the bottom of the page.
//
// This is a presentation of the same panes, not another set of them: every pane stays in the page, with its state
// (the editor's text, cursor, selection and undo history; the tables' scroll; the drawing's pan and zoom), and a
// workspace only shows some of them (display: none through the class ws-off, theme.css). The simulator does not know
// about workspaces. A workspace is available when the panes it shows exist in the current layout, so that what an
// architecture offers decides the tabs (no datapath pane, no Datapath tab) and nothing here names an architecture.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, store } from './dom.js';
import { icon } from './icons.js';

export const MOBILE_QUERY = '(max-width: 899px)'; // the width at which theme.css stacks the panes (since M6)
const KEY = 'pips.workspace.tab';

/**
 * The workspaces, in tab order. `panes(ctx)` are the pane ids (`data-pane`, set by Split) the workspace shows;
 * `needs(ctx)` is the pane that must exist for it to be offered. ctx: {dp: a datapath view is open}.
 * `layout`: 'fill' (the panes share the height, as on the desktop, with a divider between two) or 'stack' (the panes
 * follow one another at their own height and the workspace scrolls).
 * To give a future pane a place: add its id to the `panes` of the workspace it belongs to.
 */
export const WORKSPACES = Object.freeze([
  { id: 'code', icon: 'code', layout: 'fill', panes: () => ['editor'], needs: () => 'editor' },
  // in a datapath view the listing is a tab of the Details pane (the pane the shell gives it there)
  { id: 'listing', icon: 'list', layout: 'fill', panes: (c) => (c.dp ? ['info'] : ['listing', 'inspector']), needs: (c) => (c.dp ? 'info' : 'listing') },
  { id: 'compare', icon: 'compare', layout: 'fill', panes: () => ['compare'], needs: () => 'compare' },
  { id: 'datapath', icon: 'pipeline', layout: 'fill', panes: () => ['datapath', 'info'], needs: () => 'datapath' },
  { id: 'cpu', icon: 'chip', layout: 'stack', panes: () => ['registers', 'calls', 'counters'], needs: () => 'registers' },
  { id: 'memory', icon: 'memory', layout: 'fill', panes: () => ['memory'], needs: () => 'memory' },
]);

/** The workspaces on offer; `has(id)` says whether a pane exists in the layout now. */
export function availableWorkspaces(ctx, has) {
  return WORKSPACES.filter((w) => has(w.needs(ctx)));
}

/** The workspace to show: the wanted one if on offer, else the first. */
export function resolveWorkspace(list, wanted) {
  return list.find((w) => w.id === wanted) ?? list[0] ?? null;
}

/** The tab a key moves to, in a row of `count` tabs (WAI-ARIA tabs); null for any other key. */
export function tabKeyTarget(key, index, count) {
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.workspace  the .workspace element (the Split tree is inside it)
 * @param {object} o.strings         STRINGS.ws
 * @param {() => {dp: boolean}} o.context
 * @param {() => void} o.relayout    rebuild the desktop layout (configureLayout), which puts every pane back in its split
 * @param {{id: string, node: HTMLElement, label: string, icon: string}} o.sheet  the pane that opens as a sheet (the console)
 * @param {(id: string) => void} [o.onShow]  a workspace has become the visible one
 */
export class MobileWorkspaces {
  constructor({ workspace, strings, context, relayout, sheet, onShow = null }) {
    this.workspace = workspace;
    if (!workspace.id) workspace.id = 'workspace';
    this.S = strings;
    this.context = context;
    this.relayout = relayout;
    this.sheetSpec = sheet;
    this.onShow = onShow;
    this.activeId = store.get(KEY);
    this.scroll = new WeakMap(); // element -> [left, top] of what a hidden pane had scrolled
    this.unread = { error: 0, warn: 0 };

    this.tabs = el('div.ws-tabs', { role: 'tablist', 'aria-label': strings.nav });
    this.state = el('span.ws-state');
    this.badge = el('span.ws-badge', { hidden: true, 'aria-hidden': 'true' });
    this.consoleLive = el('span.sr-only', { role: 'status', 'aria-live': 'polite' });
    this.consoleBtn = el('button.ws-console', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ws-sheet',
      onclick: () => this.toggleSheet(undefined, true) }, icon(sheet.icon, { size: 16 }), el('span', { text: sheet.label }), this.badge);
    this.announce = el('span.sr-only', { role: 'status', 'aria-live': 'polite' });
    this.nav = el('div.ws-nav', { hidden: true }, this.tabs, el('div.ws-strip', {}, this.state, this.consoleBtn), this.announce, this.consoleLive);

    this.closeBtn = el('button.sheet-close', { type: 'button', 'aria-label': strings.closeConsole, title: strings.closeConsole,
      onclick: () => this.toggleSheet(false, true) }, icon('chevronDown', { size: 16 }));
    this.sheet = el('div.ws-sheet', { id: 'ws-sheet', role: 'region', 'aria-label': sheet.label, hidden: true,
      onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.toggleSheet(false, true); } } });

    this.mq = window.matchMedia(MOBILE_QUERY);
    this.mobile = this.mq.matches;
    this.mq.addEventListener('change', () => this.setMobile(this.mq.matches));
    this.trackViewport();
  }

  /**
   * The visible part of the page (VisualViewport): the page takes its height and offset, so that the on-screen keyboard
   * does not hide the lower part of a workspace and a browser that scrolls the page for the keyboard (iOS Safari)
   * does not move the toolbar out of sight. kb-open marks the keyboard (the visible height well under the largest seen).
   */
  trackViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let widest = 0;
    let tall = 0;
    const set = () => {
      if (!this.mobile) { root.style.removeProperty('--vv-h'); root.style.removeProperty('--vv-top'); root.classList.remove('kb-open'); return; }
      if (Math.abs(vv.width - widest) > 1) { widest = vv.width; tall = 0; } // a turn of the screen: measure again
      tall = Math.max(tall, vv.height);
      root.style.setProperty('--vv-h', `${vv.height}px`);
      root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      root.classList.toggle('kb-open', vv.height < tall - 150);
    };
    vv.addEventListener('resize', set);
    vv.addEventListener('scroll', set);
    this.mq.addEventListener('change', set);
    set();
  }

  // --- the workspaces ---------------------------------------------------------------------------
  has(id) { return Boolean(id) && Boolean(this.workspace.querySelector(`[data-pane="${id}"]`)); }

  /** The layout was (re)built, or the view changed: lay the workspaces out again. Call after every configureLayout. */
  afterLayout() {
    const sheetNode = this.sheetSpec.node;
    if (!this.mobile) {
      this.clear();
      this.toggleSheet(false);
      return;
    }
    // the console leaves the split for the sheet (the split puts it back at the next layout)
    const h2 = sheetNode.querySelector(':scope > h2');
    if (h2 && !h2.contains(this.closeBtn)) h2.append(this.closeBtn);
    if (sheetNode.parentNode !== this.sheet) this.sheet.append(sheetNode);
    this.apply();
  }

  /** Narrow or wide: the same panes, presented the other way. Nothing is rebuilt but the split's own layout. */
  setMobile(on) {
    if (on === this.mobile) return;
    this.mobile = on;
    this.relayout(); // wide: the console back into its split; narrow: it stays where it is until afterLayout takes it
    this.afterLayout();
  }

  apply() {
    const ctx = this.context();
    this.workspace.classList.add('ws-mobile');
    document.documentElement.classList.add('ws-mobile');
    this.nav.hidden = false;
    const list = availableWorkspaces(ctx, (id) => this.has(id));
    const active = resolveWorkspace(list, this.activeId);
    this.buildTabs(list, active);
    if (!active) return;
    this.workspace.dataset.ws = active.id;
    this.workspace.dataset.layout = active.layout;
    this.workspace.setAttribute('role', 'tabpanel');
    this.workspace.setAttribute('aria-labelledby', `ws-tab-${active.id}`);
    this.showPanes(new Set(active.panes(ctx)));
  }

  /** Show the panes in `on`, and the splits that hold one of them; a lone pane takes its split, two keep their divider. */
  showPanes(on) {
    const nodes = [...this.workspace.querySelectorAll('[data-pane]')].reverse(); // inner panes first
    const off = new Map();
    for (const n of nodes) {
      const inner = n.querySelectorAll('[data-pane]');
      off.set(n, inner.length ? [...inner].every((c) => off.get(c)) : !on.has(n.dataset.pane));
    }
    // display: none forgets what a box had scrolled: note it before a pane hides, put it back after it shows
    const hiding = nodes.filter((n) => off.get(n) && !n.classList.contains('ws-off'));
    const showing = nodes.filter((n) => !off.get(n) && n.classList.contains('ws-off'));
    for (const n of hiding) for (const e of [n, ...n.querySelectorAll('*')]) if (e.scrollTop || e.scrollLeft) this.scroll.set(e, [e.scrollLeft, e.scrollTop]);
    for (const n of nodes) n.classList.toggle('ws-off', off.get(n));
    for (const n of showing) {
      for (const e of [n, ...n.querySelectorAll('*')]) {
        const p = this.scroll.get(e);
        if (p) { e.scrollLeft = p[0]; e.scrollTop = p[1]; this.scroll.delete(e); }
      }
    }
    for (const s of this.workspace.querySelectorAll('.split')) {
      const open = [...s.children].filter((c) => c.matches('.pane') && !c.classList.contains('ws-off'));
      s.classList.toggle('ws-duo', open.length > 1);
      for (const c of s.children) if (c.matches('.pane')) c.classList.toggle('ws-solo', open.length === 1 && open[0] === c);
    }
    for (const d of this.workspace.querySelectorAll('.split > .split-divider')) { // a divider shows between two panes that show
      const prev = d.previousElementSibling;
      const next = d.nextElementSibling?.nextElementSibling; // the fold button's box lies between
      d.classList.toggle('ws-edge', !prev || !next || prev.classList.contains('ws-off') || next.classList.contains('ws-off'));
    }
    // a pane alone in its split cannot be folded away there: it shows open
    for (const c of this.workspace.querySelectorAll('.pane')) c.classList.toggle('ws-force', c.classList.contains('ws-solo'));
  }
  /** The wide layout: remove every trace of the narrow one. */
  clear() {
    this.workspace.classList.remove('ws-mobile');
    document.documentElement.classList.remove('ws-mobile');
    this.workspace.removeAttribute('data-ws');
    this.workspace.removeAttribute('data-layout');
    this.workspace.removeAttribute('role');
    this.workspace.removeAttribute('aria-labelledby');
    this.nav.hidden = true;
    for (const n of this.workspace.querySelectorAll('.ws-off, .ws-solo, .ws-force, .ws-duo')) n.classList.remove('ws-off', 'ws-solo', 'ws-force', 'ws-duo');
    this.closeBtn.remove();
  }

  buildTabs(list, active) {
    const ids = list.map((w) => w.id).join();
    if (this.tabs.dataset.ids !== ids) {
      this.tabs.dataset.ids = ids;
      this.tabs.style.setProperty('--ws-count', String(list.length));
      this.tabs.replaceChildren(...list.map((w, i) => el('button.ws-tab', { type: 'button', role: 'tab', id: `ws-tab-${w.id}`, 'aria-controls': this.workspace.id || undefined,
        'data-ws': w.id, onclick: () => this.select(w.id, true),
        onkeydown: (e) => {
          const to = tabKeyTarget(e.key, i, list.length);
          if (to === null) return;
          e.preventDefault();
          this.select(list[to].id, true);
        } }, icon(w.icon, { size: 18 }), el('span.ws-tab-label', { text: this.S.names[w.id] }))));
    }
    for (const b of this.tabs.children) {
      const on = b.dataset.ws === active?.id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  /** Show workspace `id` (a tab, or a jump from another pane); `focus` moves the focus to its tab. */
  select(id, focus = false) {
    if (!this.mobile || !availableWorkspaces(this.context(), (p) => this.has(p)).some((w) => w.id === id)) return;
    const was = this.workspace.dataset.ws;
    this.activeId = id;
    this.apply();
    store.set(KEY, id);
    if (focus) this.tabs.querySelector(`[data-ws="${id}"]`)?.focus();
    if (was !== id) {
      this.announce.textContent = this.S.announce(this.S.names[id]);
      this.onShow?.(id);
    }
  }
  /** The workspace that shows pane `paneId`, brought forward (the current one if it shows it). A no-op on a wide screen. */
  revealPane(paneId) {
    if (!this.mobile) return;
    const ctx = this.context();
    const list = availableWorkspaces(ctx, (id) => this.has(id));
    const here = list.find((w) => w.id === this.workspace.dataset.ws);
    const w = here?.panes(ctx).includes(paneId) ? here : list.find((x) => x.panes(ctx).includes(paneId));
    if (w) this.select(w.id);
  }

  /** The workspace id, brought forward (a no-op if it is not on offer here). */
  reveal(id) { this.select(id); }

  get active() { return this.workspace.dataset.ws ?? null; }

  // --- the console sheet ------------------------------------------------------------------------
  toggleSheet(open = this.sheet.hidden, focus = false) {
    if (open && !this.mobile) return;
    this.sheet.hidden = !open;
    this.consoleBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      this.unread = { error: 0, warn: 0 };
      this.showBadge();
      if (focus) this.closeBtn.focus(); // so that Escape, and a screen reader, find the sheet
    } else if (focus) this.consoleBtn.focus();
  }

  get sheetOpen() { return !this.sheet.hidden; }

  /** A console message arrived (kind: 'error', 'warn', 'info', 'ok') or the messages were cleared (null). */
  note(kind) {
    if (kind === null) { this.unread = { error: 0, warn: 0 }; this.showBadge(); return; }
    if (this.sheetOpen || (kind !== 'error' && kind !== 'warn')) return;
    this.unread[kind] += 1;
    this.showBadge();
    this.consoleLive.textContent = ''; // so that a second error is announced again
    setTimeout(() => { this.consoleLive.textContent = this.S.unread(this.unread.error, this.unread.warn); }, 30);
  }

  showBadge() {
    const { error, warn } = this.unread;
    const n = error || warn;
    this.badge.hidden = n === 0;
    this.badge.textContent = n > 9 ? '9+' : String(n);
    this.badge.classList.toggle('is-error', error > 0);
    this.consoleBtn.classList.toggle('has-error', error > 0);
    this.consoleBtn.setAttribute('aria-label', n ? `${this.sheetSpec.label}: ${this.S.unread(error, warn)}` : this.sheetSpec.label);
    this.consoleBtn.title = n ? this.S.unread(error, warn) : this.S.openConsole;
  }

  /** The execution state in the strip under the tabs: `text` ("PC 0x… · Paused"). */
  setStatus(text) {
    if (this.state.textContent !== text) this.state.textContent = text;
  }
}
