// dom.js -- small DOM helpers and number formatting shared by the panels.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

// Boxes that scroll take the keyboard focus, so that the arrow keys can scroll them (WS-U-030).
const SCROLLERS = new Set(['scroll', 'counters']);

/** el('tag.class', {attr: value, onclick: fn}, ...children) */
export function el(spec, attrs = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (classes.some((c) => SCROLLERS.has(c))) node.tabIndex = 0;
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** A drop-down of settings (details/summary); closes on Escape or a click elsewhere. */
export function menu(title, ...items) {
  const m = el('details.menu.view-menu', {}, el('summary', { text: title }), el('div.menu-list', { role: 'group', 'aria-label': title }, items));
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.open) { m.open = false; m.querySelector('summary').focus(); } });
  document.addEventListener('click', (e) => { if (!m.contains(e.target)) m.open = false; });
  return m;
}

export const hex8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
export const hex2 = (v) => (v & 0xff).toString(16).padStart(2, '0');
export const bin32 = (v) => (v >>> 0).toString(2).padStart(32, '0');

export function formatValue(v, fmt) {
  switch (fmt) {
    case 'signed': return String(v | 0);
    case 'unsigned': return String(v >>> 0);
    case 'binary': return bin32(v).replace(/(.{8})(?!$)/g, '$1 ');
    default: return hex8(v);
  }
}

export function download(name, data, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read storage without failing where it is blocked (WS-U-010). */
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};
