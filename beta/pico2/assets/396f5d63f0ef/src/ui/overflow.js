// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export function overflowBar({ bar, more, sections, steps }) {
 const moves = steps.filter((s) => s.node);
 const home = new Map(moves.map((s) => { const c = document.createComment(''); s.node.before(c); return [s.node, c]; }));
 const order = new Map(moves.map((s) => s.node).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
 .map((n, i) => [n, i]));
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
 if (paused) return;
 const focus = document.activeElement;
 restore();
 for (const s of steps) {
 if (fits()) break;
 if (s.cls) bar.classList.add(s.cls);
 else if (!s.node.hidden) { more.hidden = false; toMenu(s); }
 }
 for (const body of Object.values(sections)) body.parentElement.hidden = ![...body.children].some((n) => !n.hidden);
 if (more.hidden) more.open = false;
 if (focus && focus !== document.activeElement && focus.isConnected) focus.focus({ preventScroll: true });
 }
 let pending = false;
 function fit() {
 if (pending) return;
 pending = true;
 requestAnimationFrame(() => { pending = false; fitNow(); });
 }
 function restore(close = false) {
 for (const s of steps) {
 if (s.cls) bar.classList.remove(s.cls);
 else home.get(s.node).after(s.node);
 }
 more.hidden = true;
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
