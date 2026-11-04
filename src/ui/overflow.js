// overflow.js -- the header's and the toolbar's overflow (WS-U-011): a bar keeps one line. When it does not fit,
// its steps apply in order until it does, each either a class that compacts the bar or a control that moves into
// the bar's More menu. A moved control is the same node, so its handler, label, state and capability go with it;
// it returns to its place when there is room again. The More menu shows only while it holds something.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/**
 * @param {object} o
 * @param {HTMLElement} o.bar      a flex row that does not wrap; its children must not shrink
 * @param {HTMLDetailsElement} o.more  the More menu, a child of the bar
 * @param {Object<string, HTMLElement>} o.sections  where each group's controls go in the menu (each in a section
 *   that is hidden while empty: the body's parent)
 * @param {Array<{cls?: string, node?: Element, group?: string}>} o.steps  lowest priority first
 * @returns {{fit: () => void, fitNow: () => void, pause: (on: boolean) => void}} fit: on the next frame; fitNow: at
 *   once; pause: while paused (a bar docked as a column, ui/dock.js) every control stays in its place and the More
 *   menu is hidden
 */
export function overflowBar({ bar, more, sections, steps }) {
  const moves = steps.filter((s) => s.node);
  // a placeholder at each control's place, and the controls' document order, kept in the menu too
  const home = new Map(moves.map((s) => { const c = document.createComment(''); s.node.before(c); return [s.node, c]; }));
  const order = new Map(moves.map((s) => s.node).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    .map((n, i) => [n, i]));

  /** Every child of the bar ends before the bar's padding (an open drop-down floats and does not count). */
  function fits() {
    const r = bar.getBoundingClientRect();
    const end = r.right - parseFloat(getComputedStyle(bar).paddingRight) + 0.5;
    for (const c of bar.children) if (!c.hidden && c.getBoundingClientRect().right > end) return false;
    return true;
  }
  function toMenu(s) {
    const body = sections[s.group];
    const next = [...body.children].find((n) => order.get(n) > order.get(s.node)) ?? null;
    body.insertBefore(s.node, next);
  }

  function fitNow() {
    if (paused) return; // a paused bar was put back whole once (pause); its controls may be elsewhere now (dock.js)
    const focus = document.activeElement;
    restore();
    for (const s of steps) {
      if (fits()) break;
      if (s.cls) bar.classList.add(s.cls);
      else if (!s.node.hidden) { more.hidden = false; toMenu(s); } // a hidden control (not offered in this view) stays
    }
    for (const body of Object.values(sections)) body.parentElement.hidden = ![...body.children].some((n) => !n.hidden);
    if (more.hidden) more.open = false;
    if (focus && focus !== document.activeElement && focus.isConnected) focus.focus({ preventScroll: true }); // a move drops the focus
  }

  let pending = false;
  function fit() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fitNow(); });
  }
  /** Every control back in its place, no compact class, the More menu hidden (`close`: and closed). */
  function restore(close = false) {
    for (const s of steps) {
      if (s.cls) bar.classList.remove(s.cls);
      else home.get(s.node).after(s.node);
    }
    more.hidden = true; // shown, and its room taken, only once a control has to leave
    if (close) more.open = false;
  }
  let paused = false;
  function pause(on) {
    paused = false;
    if (on) {
      const focus = document.activeElement;
      restore(true);
      if (focus && focus !== document.activeElement && focus.isConnected) focus.focus({ preventScroll: true });
    } else fitNow();
    paused = on;
  }
  new ResizeObserver(fit).observe(bar);
  return { fit, fitNow, pause };
}
