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
    const children = [];
    panes.forEach((p, i) => {
      if (i > 0) children.push(this.divider(i - 1), this.foldButton(i - 1));
      p.node.classList.add('pane');
      p.node.dataset.pane = p.id;
      p.node._split = this;
      p.node._index = i;
      if (p.collapsible) this.toggleButton(p);
      else p.node._toggle?.remove();
      children.push(p.node);
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
   * The fold button of divider i (D6): it folds the pane after the divider, or else the one before it, whichever
   * can fold (`collapsible`, or `foldable` for a pane without a heading, which then folds out of sight and
   * returns from this button). It is a sibling of the divider, a zero-size box at its end, because a separator
   * may not contain a control.
   */
  foldButton(i) {
    const at = [i + 1, i].find((j) => this.panes[j].collapsible || this.panes[j].foldable);
    const b = at === undefined ? null : el('button.divider-fold', { type: 'button', onclick: () => this.toggle(at) });
    this.folds.push(b && { at, b });
    return el(`div.divider-fold-box.${this.dir === 'row' ? 'fold-v' : 'fold-h'}`, { 'data-fold': this.panes[i].id }, b ?? []);
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
  }

  /** Sizes and states onto the panes and dividers. */
  apply() {
    const vertical = this.dir === 'row';
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
        // the arrow points the way the pane goes when it folds (a pane after another folds down or right), and back when it opens
        const after = i > 0;
        const toward = vertical ? (after ? 'chevronRight' : 'chevronLeft') : (after ? 'chevronDown' : 'chevronUp');
        const back = vertical ? (after ? 'chevronLeft' : 'chevronRight') : (after ? 'chevronUp' : 'chevronDown');
        n._toggle.replaceChildren(icon(c ? back : toward));
        n._toggle.setAttribute('aria-expanded', String(!c));
        n._toggle.setAttribute('aria-label', label);
        n._toggle.title = label;
      }
    });
    this.folds.forEach((f, i) => {
      if (!f) return;
      const c = this.collapsed[f.at];
      const p = this.panes[f.at];
      const after = f.at === i + 1;
      const label = (c ? STRINGS.layout.expand : STRINGS.layout.collapse)(p.title ?? p.id);
      // the arrow points the way the pane goes when it folds, and back when it opens
      const toward = vertical ? (after ? 'chevronRight' : 'chevronLeft') : (after ? 'chevronDown' : 'chevronUp');
      const back = vertical ? (after ? 'chevronLeft' : 'chevronRight') : (after ? 'chevronUp' : 'chevronDown');
      f.b.replaceChildren(icon(c ? back : toward));
      f.b.setAttribute('aria-expanded', String(!c));
      f.b.setAttribute('aria-label', label);
      f.b.title = label;
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
