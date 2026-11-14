// split.js -- the resizable workspace (spec §11.1, WS-U-010): a split lays
// out panes in a row or a column with a draggable divider between each two
// neighbours. Dividers follow the pointer with pointer capture (mouse, touch
// and pen), move with the arrow keys (Shift: further), and return to their
// default on a double click or Enter; each pane keeps a minimum size, and a
// pane marked collapsible folds to its heading with a button there, and every
// divider carries a fold button for the pane beside it (D6). Sizes
// are fractions of the split (flex-grow), so the proportions hold when the
// window changes size. Each split's layout is saved in the browser under a
// versioned key per view; Split.resetAll() restores every default. The
// arithmetic is in split-math.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, store, scoped } from './dom.js';
import { STRINGS } from './strings.js';
import { icon } from './icons.js';
import { normalise, dragPair, resetPair, readLayout, writeLayout, LAYOUT_PREFIX } from './split-math.js';

const KEY_STEP = 16; // px per arrow key; ×4 with Shift
const live = new Set();

export class Split {
  /** @param {'row'|'column'} dir row: panes side by side; @param {string} name for styling and tests */
  constructor(dir, name) {
    this.dir = dir;
    this.name = name;
    this.root = el(`div.split.split-${dir}`, { 'data-split': name });
    this.panes = [];
    this.dividers = [];
    this.onApply = null; // called after every change of sizes or folds (the panes' own controls follow it)
    // a column whose panes may each fill it, the others hidden with their headings (the author, 2026-11-13); set by the shell
    this.fillable = false;
    this.filled = -1;
    live.add(this);
  }

  /**
   * Lay out `panes`, restoring the layout saved under `key`.
   * Each pane: {node, id, min (px), size (default fraction), collapsible?, foldable?, collapsed? (default), header?, title?}
   * `header` is where the collapse button goes (default: the node's h2).
   */
  configure(panes, key) {
    this.panes = panes;
    this.key = key;
    this.defaults = normalise(panes.map((p) => p.size ?? 1));
    this.defaultCollapsed = panes.map((p) => Boolean(p.collapsed));
    const saved = readLayout(store.get(LAYOUT_PREFIX + key), panes.length);
    this.fracs = saved?.sizes ?? this.defaults.slice();
    this.collapsed = saved?.collapsed ?? this.defaultCollapsed.slice();
    this.dividers = [];
    this.folds = [];
    this.filled = -1;
    const children = [];
    panes.forEach((p, i) => {
      if (i > 0) children.push(this.divider(i - 1), this.foldButton(i - 1));
      p.node.classList.add('pane');
      p.node.dataset.pane = p.id;
      p.node._split = this;
      p.node._index = i;
      if (p.collapsible) this.toggleButton(p);
      else p.node._toggle?.remove();
      if (this.fillable && panes.length > 1) this.fillButton(p); else p.node._fill?.remove();
      children.push(p.node);
      if (p.foldable && !p.collapsible) children.push(this.strip(p));
    });
    this.root.replaceChildren(...children);
    this.apply();
  }

  divider(i) {
    const vertical = this.dir === 'row';
    const d = el('div.split-divider', { role: 'separator', tabindex: 0, 'aria-orientation': vertical ? 'vertical' : 'horizontal',
      'aria-valuemin': 0, 'aria-valuemax': 100, title: STRINGS.layout.divider, 'aria-label': STRINGS.layout.divider,
      'data-a': this.panes[i].id, 'data-b': this.panes[i + 1].id });
    d.addEventListener('pointerdown', (e) => this.drag(e, i, d));
    d.addEventListener('dblclick', () => this.resetDivider(i));
    d.addEventListener('keydown', (e) => {
      const back = vertical ? 'ArrowLeft' : 'ArrowUp';
      const fwd = vertical ? 'ArrowRight' : 'ArrowDown';
      if (e.key === back || e.key === fwd) {
        e.preventDefault();
        this.nudge(i, (e.key === fwd ? 1 : -1) * KEY_STEP * (e.shiftKey ? 4 : 1));
      } else if (e.key === 'Enter') { e.preventDefault(); this.resetDivider(i); }
    });
    this.dividers.push(d);
    return d;
  }

  /**
   * The arrows of divider i (D6; author, 2026-11-10: "they should expand in the direction of the arrow"): up to two,
   * back (left or up) and forward (right or down). A click moves the divider the way its arrow points as far as it
   * goes: the pane the arrow points at folds, or, if the pane behind the arrow is folded, that pane opens toward
   * the arrow. An arrow that could do neither is hidden (apply). A pane folds when it is `collapsible` (to its
   * heading) or `foldable` (no heading: to a strip with its name, see strip). The arrows sit in a sibling of the
   * divider, a zero-size box at its middle, because a separator may not contain a control.
   */
  foldButton(i) {
    const mk = (dir) => el(`button.divider-fold.fold-${dir}`, { type: 'button', 'data-dir': dir, onclick: (e) => { e.stopPropagation(); this.foldAction(i, dir)?.(); } });
    const f = { back: mk('back'), fwd: mk('fwd') };
    this.folds.push(f);
    return el(`div.divider-fold-box.${this.dir === 'row' ? 'fold-v' : 'fold-h'}`, { 'data-fold': this.panes[i].id },
      el('div.divider-folds', {}, f.back, f.fwd));
  }

  /** What the arrow `dir` of divider i does now: {act, label} or null (nothing it can do). */
  foldPlan(i, dir) {
    const [a, b] = [i, i + 1];
    const can = (j) => (this.panes[j].collapsible || this.panes[j].foldable) && !this.collapsed[j] && this.collapsed.filter((c) => !c).length > 1;
    const name = (j) => this.panes[j].title ?? this.panes[j].id;
    // back: the pane after opens backward, or the pane before folds; forward: the pane before opens forward, or the pane after folds
    const [behind, ahead] = dir === 'back' ? [b, a] : [a, b];
    if (this.collapsed[behind]) return { pane: behind, label: STRINGS.layout.expand(name(behind)) };
    if (can(ahead)) return { pane: ahead, label: STRINGS.layout.collapse(name(ahead)) };
    return null;
  }

  foldAction(i, dir) {
    const p = this.foldPlan(i, dir);
    return p && (() => this.toggle(p.pane));
  }

  /** The strip of a `foldable` pane: while it is folded, a narrow bar with its name that opens it (author, 2026-11-10). */
  strip(p) {
    if (!p.node._strip) {
      p.node._strip = el('button.pane-strip', { type: 'button', onclick: () => p.node._split?.toggle(p.node._index) },
        icon('unfold', { size: 16 }), el('span.pane-strip-title'));
    }
    p.node._strip.dataset.strip = p.id;
    p.node._strip.querySelector('.pane-strip-title').textContent = p.title ?? p.id;
    p.node._strip.hidden = true;
    return p.node._strip;
  }

  toggleButton(p) {
    if (!p.node._toggle) {
      p.node._toggle = el('button.pane-toggle', { type: 'button', onclick: (e) => {
        e.stopPropagation();
        p.node._split?.toggle(p.node._index);
      } });
    }
    const head = p.header ?? p.node.querySelector(':scope > h2');
    head?.append(p.node._toggle);
    // a folded pane opens from a click anywhere on its heading, as the named strip of a pane without one does (GUI
    // walkthrough, 2026-11-11: only the small plus opened Files); the heading's own controls keep their clicks
    if (head && !head._foldClick) {
      head._foldClick = true;
      head.addEventListener('click', (e) => {
        const n = p.node;
        if (!n.classList.contains('collapsed') || n.classList.contains('ws-force') || e.target.closest('button, a, input, select, summary, [role="tab"]')) return;
        n._split?.toggle(n._index);
      });
    }
  }

  /**
   * The heading's "fill the column" button (the author, 2026-11-13): the pane takes the whole column and the column's other panes
   * are hidden, their headings too; the same button (or Esc in the pane) shows them again. Not saved: a reload shows the column.
   */
  fillButton(p) {
    if (!p.node._fill) {
      p.node._fill = el('button.pane-fill', { type: 'button', onclick: (e) => { e.stopPropagation(); const s = p.node._split; s?.fill(s.filled === p.node._index ? -1 : p.node._index); } });
      p.node.addEventListener('keydown', (e) => {
        const s = p.node._split;
        if (e.key === 'Escape' && s?.filled === p.node._index) { e.stopPropagation(); s.fill(-1); p.node._fill.focus(); }
      });
    }
    const head = p.header ?? p.node.querySelector(':scope > h2');
    if (head) head.insertBefore(p.node._fill, p.node._toggle?.parentNode === head ? p.node._toggle : null);
  }

  /** Let pane i fill the column (-1: every pane back); a folded pane opens first. */
  fill(i) {
    if (i >= 0 && this.collapsed[i]) { this.collapsed[i] = false; this.save(); }
    this.filled = i;
    this.apply();
  }

  /** Sizes and states onto the panes and dividers. */
  apply() {
    const vertical = this.dir === 'row';
    this.root.classList.toggle('split-filled', this.filled >= 0);
    this.panes.forEach((p, i) => {
      p.node.classList.toggle('pane-filled', i === this.filled);
      const b = p.node._fill;
      if (!b || p.node._split !== this) return;
      const on = i === this.filled, name = p.title ?? p.id;
      const label = on ? STRINGS.layout.unfillColumn(name) : STRINGS.layout.fillColumn(name);
      b.replaceChildren(icon(on ? 'unfillColumn' : 'fillColumn', { size: 16 }));
      b.setAttribute('aria-label', label); b.title = on ? `${label} (Esc)` : label;
      b.setAttribute('aria-pressed', String(on));
    });
    // Grow factors of the open panes sum to 1, so that they share all the room a folded pane leaves.
    const open = this.fracs.reduce((s, f, i) => s + (this.collapsed[i] ? 0 : f), 0) || 1;
    this.panes.forEach((p, i) => {
      const c = this.collapsed[i];
      const n = p.node;
      n.classList.toggle('collapsed', c);
      n.classList.toggle('pane-away', c && !p.collapsible); // no heading to fold to: out of sight
      n.style.flex = c ? '0 0 auto' : `${(this.fracs[i] / open).toFixed(5)} 1 0px`;
      n.style[vertical ? 'minWidth' : 'minHeight'] = c ? '' : `${p.min ?? 60}px`;
      n.style[vertical ? 'minHeight' : 'minWidth'] = '';
      if (n._toggle && n._split === this) {
        const label = c ? STRINGS.layout.expand(p.title ?? p.id) : STRINGS.layout.collapse(p.title ?? p.id);
        // the heading's button (author, 2026-11-10): minus folds the pane, plus opens it, wherever the pane stands; only the
        // dividers' buttons carry arrows (below), so that an arrow always means the same thing
        n._toggle.replaceChildren(icon(c ? 'unfold' : 'fold'));
        n._toggle.setAttribute('aria-expanded', String(!c));
        n._toggle.setAttribute('aria-label', label);
        n._toggle.title = label;
      }
    });
    this.panes.forEach((p, i) => { if (p.node._strip && p.node._split === this) p.node._strip.hidden = !this.collapsed[i]; });
    // the arrows point the way the divider moves on a click, and so the way the pane behind them grows
    const ICON = { back: vertical ? 'chevronLeft' : 'chevronUp', fwd: vertical ? 'chevronRight' : 'chevronDown' };
    this.folds.forEach((f, i) => {
      for (const dir of ['back', 'fwd']) {
        const b = f[dir];
        const plan = this.foldPlan(i, dir);
        b.hidden = !plan;
        if (!plan) continue;
        if (!b.firstChild) b.append(icon(ICON[dir]));
        b.setAttribute('aria-label', plan.label);
        b.title = plan.label;
      }
    });
    this.dividers.forEach((d, i) => {
      const off = this.collapsed[i] || this.collapsed[i + 1];
      d.classList.toggle('split-off', off);
      d.setAttribute('aria-disabled', String(off));
      const pair = this.fracs[i] + this.fracs[i + 1];
      d.setAttribute('aria-valuenow', String(Math.round((100 * this.fracs[i]) / pair)));
    });
    this.onApply?.();
  }

  save() {
    store.set(LAYOUT_PREFIX + this.key, writeLayout(this.fracs, this.collapsed));
  }

  /** Pixel sizes of the panes now. */
  measure() {
    const prop = this.dir === 'row' ? 'width' : 'height';
    return this.panes.map((p) => p.node.getBoundingClientRect()[prop]);
  }

  /** Fractions from pixel sizes of the open panes; folded panes keep theirs for when they open. */
  fromPixels(px) {
    const open = this.panes.map((_, i) => !this.collapsed[i]);
    const totalPx = px.reduce((s, v, i) => s + (open[i] ? v : 0), 0);
    const share = this.fracs.reduce((s, v, i) => s + (open[i] ? v : 0), 0);
    if (totalPx <= 0) return;
    this.fracs = this.fracs.map((f, i) => (open[i] ? (px[i] / totalPx) * share : f));
  }

  mins() { return this.panes.map((p) => p.min ?? 60); }

  drag(e, i, d) {
    if (this.collapsed[i] || this.collapsed[i + 1] || e.button > 0) return;
    e.preventDefault();
    d.setPointerCapture(e.pointerId);
    d.classList.add('dragging');
    document.body.classList.add(this.dir === 'row' ? 'resizing-col' : 'resizing-row');
    const px0 = this.measure();
    const start = this.dir === 'row' ? e.clientX : e.clientY;
    let frame = 0;
    let last = start;
    const move = (ev) => {
      last = this.dir === 'row' ? ev.clientX : ev.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.fromPixels(dragPair(px0, i, last - start, this.mins()));
        this.apply();
      });
    };
    const end = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0; this.fromPixels(dragPair(px0, i, last - start, this.mins())); this.apply(); }
      d.classList.remove('dragging');
      document.body.classList.remove('resizing-col', 'resizing-row');
      d.removeEventListener('pointermove', move);
      d.removeEventListener('pointerup', end);
      d.removeEventListener('pointercancel', end);
      d.removeEventListener('lostpointercapture', end);
      this.save();
    };
    d.addEventListener('pointermove', move);
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('lostpointercapture', end);
  }

  nudge(i, delta) {
    if (this.collapsed[i] || this.collapsed[i + 1]) return;
    this.fromPixels(dragPair(this.measure(), i, delta, this.mins()));
    this.apply();
    this.save();
  }

  resetDivider(i) {
    this.fracs = resetPair(this.fracs, this.defaults, i);
    this.apply();
    this.save();
  }

  /** Fold or open pane i; the last open pane cannot fold. */
  toggle(i) {
    if (this.filled >= 0) { this.filled = -1; this.apply(); } // a fold shows the column's panes again
    if (!this.collapsed[i] && this.collapsed.filter((c) => !c).length === 1) return;
    this.collapsed[i] = !this.collapsed[i];
    this.apply();
    this.save();
  }

  /** Open or fold the pane with this id (View menu). */
  setCollapsed(id, on) {
    const i = this.panes.findIndex((p) => p.id === id);
    if (i >= 0 && this.collapsed[i] !== on) this.toggle(i);
  }

  isCollapsed(id) {
    const i = this.panes.findIndex((p) => p.id === id);
    return i >= 0 && this.collapsed[i];
  }

  reset() {
    this.fracs = this.defaults.slice();
    this.collapsed = this.defaultCollapsed.slice();
    this.apply();
  }

  /** View ▸ Reset layout: forget every saved layout and restore the defaults. */
  static resetAll() {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(scoped('pips.layout.'))) localStorage.removeItem(k);
    } catch { /* storage unavailable */ }
    for (const s of live) s.reset();
  }
}
