// dom.js -- small DOM helpers and number formatting shared by the panels.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ARCH_ID } from '../shell/arch-id.js';

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
/** An address with the digits of the architecture's address width (32 bits: as hex8). */
export const hexAddr = (v, bits = 32) => `0x${(v >>> 0).toString(16).padStart(Math.ceil(bits / 4), '0')}`;
export const hex2 = (v) => (v & 0xff).toString(16).padStart(2, '0');
export const bin32 = (v) => (v >>> 0).toString(2).padStart(32, '0');

/** A register value in a format; `bits` is the register's width (W-D29: ceil(bits / 4) hexadecimal digits). */
export function formatValue(v, fmt, bits = 32) {
  if (bits < 32) {
    const u = (v >>> 0) % 2 ** bits;
    switch (fmt) {
      // a one-bit register (a flag, done, fault) reads 0 or 1, not -1 (decision G28, author 2026-11-05)
      case 'signed': return String(bits > 1 && u >= 2 ** (bits - 1) ? u - 2 ** bits : u);
      case 'unsigned': return String(u);
      case 'binary': return u.toString(2).padStart(bits, '0').replace(/(?=(.{8})+$)(?!^)/g, ' ');
      default: return `0x${u.toString(16).padStart(Math.ceil(bits / 4), '0')}`;
    }
  }
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

// Each architecture keeps its own settings and workspace (W-D29: the applications share an origin); RISC-V keeps the
// historical keys. The theme, the projector mode and the place of the execution controls are the platform's.
const SHARED_KEYS = new Set(['pips.theme', 'pips.projector', 'pips.toolbarDock']);
// Contract v9 (arch-contract.md §26): in a variant other than the descriptor's own, the program text, the kept
// workspace, the view, the subset, the language and the exercise are the variant's (the key gets `@<variant>`); the
// profile, which chooses the variant, and the layout stay the architecture's. The descriptor's own variant keeps the
// keys it always had.
const VARIANT_SCOPED = /^pips\.(source|workspace|view|subset|lang|exercise)(\.|$)/;
let VARIANT = null;
/** The variant this page runs (main.js, before anything is read from storage). */
export function setStorageVariant(v) { VARIANT = v ?? null; }
/**
 * Contract v9: once per architecture, move what was stored before variants existed (the keys that are now kept per
 * variant) to `variant`, the variant that holds the module's former profiles (GPU: the micro-ISA, published as a
 * preview in 1.2.0). Returns whether anything was moved. RISC-V, whose keys carry no architecture prefix, never has
 * variants.
 */
export function moveToVariant(variant) {
  if (ARCH_ID === 'riscv') return false;
  let moved = false;
  try {
    const prefix = `pips.${ARCH_ID}.`;
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(prefix) || k.includes('@') || !VARIANT_SCOPED.test(`pips.${k.slice(prefix.length)}`)) continue;
      const to = `${k}@${variant}`;
      if (localStorage.getItem(to) === null) localStorage.setItem(to, localStorage.getItem(k));
      localStorage.removeItem(k);
      moved = true;
    }
  } catch { /* storage unavailable */ }
  return moved;
}
/** The storage key of a setting for this page's architecture (and variant). */
export const scoped = (key) => {
  const k = ARCH_ID === 'riscv' || SHARED_KEYS.has(key) ? key : key.replace(/^pips\./, `pips.${ARCH_ID}.`);
  return VARIANT && VARIANT_SCOPED.test(key) ? `${k}@${VARIANT}` : k;
};

/** Read storage without failing where it is blocked (WS-U-010). */
export const store = {
  get(key) { try { return localStorage.getItem(scoped(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(scoped(key), value); } catch { /* storage unavailable */ } },
};
