// split-math.js -- the arithmetic of the resizable workspace (split.js):
// pane sizes as fractions of a split, dragging the divider between two
// neighbours within their minimum sizes, restoring a divider's default, and
// reading a saved layout defensively. Pure JavaScript, no DOM, so that the
// rules are tested under Node.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** Version of the saved layouts; a change of the pane structure raises it, and old layouts are ignored. */
export const LAYOUT_VERSION = 1;
export const LAYOUT_PREFIX = `pips.layout.v${LAYOUT_VERSION}.`;

/** Fractions that sum to 1 (equal shares if the input is unusable). */
export function normalise(sizes) {
  const ok = sizes.every((s) => Number.isFinite(s) && s > 0);
  const sum = ok ? sizes.reduce((a, b) => a + b, 0) : 0;
  return sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
}

/**
 * Move the divider after pane i by `delta` pixels. `px` are the panes' current
 * sizes in pixels, `mins` their minimum sizes; only panes i and i + 1 change,
 * and their sum is kept. Returns the new sizes in pixels.
 */
export function dragPair(px, i, delta, mins) {
  const out = px.slice();
  const total = px[i] + px[i + 1];
  const lo = Math.min(mins[i], total / 2);
  const hi = total - Math.min(mins[i + 1], total / 2);
  out[i] = Math.min(hi, Math.max(lo, px[i] + delta));
  out[i + 1] = total - out[i];
  return out;
}

/**
 * Restore the default proportion of panes i and i + 1 within the share they
 * have now (a double click on their divider); the other panes keep theirs.
 */
export function resetPair(fracs, defaults, i) {
  const out = fracs.slice();
  const share = fracs[i] + fracs[i + 1];
  const d = defaults[i] + defaults[i + 1];
  out[i] = share * (defaults[i] / d);
  out[i + 1] = share - out[i];
  return out;
}

/**
 * A saved layout for a split of n panes, or null if it is missing, of another
 * version or structure, or damaged: {sizes: fractions, collapsed: booleans}.
 */
export function readLayout(text, n) {
  if (!text) return null;
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || o.v !== LAYOUT_VERSION || !Array.isArray(o.sizes) || o.sizes.length !== n) return null;
  if (!o.sizes.every((s) => Number.isFinite(s) && s > 0)) return null;
  const collapsed = Array.isArray(o.collapsed) && o.collapsed.length === n ? o.collapsed.map(Boolean) : new Array(n).fill(false);
  if (collapsed.every(Boolean)) collapsed[0] = false; // one pane always stays open
  return { sizes: normalise(o.sizes), collapsed };
}

export const writeLayout = (sizes, collapsed) => JSON.stringify({ v: LAYOUT_VERSION, sizes: sizes.map((s) => Math.round(s * 1e4) / 1e4), collapsed });
