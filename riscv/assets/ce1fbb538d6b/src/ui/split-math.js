// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const LAYOUT_VERSION = 1;
export const LAYOUT_PREFIX = `pips.layout.v${LAYOUT_VERSION}.`;
export function normalise(sizes) {
 const ok = sizes.every((s) => Number.isFinite(s) && s > 0);
 const sum = ok ? sizes.reduce((a, b) => a + b, 0) : 0;
 return sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
}
export function dragPair(px, i, delta, mins) {
 const out = px.slice();
 const total = px[i] + px[i + 1];
 const lo = Math.min(mins[i], total / 2);
 const hi = total - Math.min(mins[i + 1], total / 2);
 out[i] = Math.min(hi, Math.max(lo, px[i] + delta));
 out[i + 1] = total - out[i];
 return out;
}
export function resetPair(fracs, defaults, i) {
 const out = fracs.slice();
 const share = fracs[i] + fracs[i + 1];
 const d = defaults[i] + defaults[i + 1];
 out[i] = share * (defaults[i] / d);
 out[i + 1] = share - out[i];
 return out;
}
export function readLayout(text, n) {
 if (!text) return null;
 let o;
 try { o = JSON.parse(text); } catch { return null; }
 if (!o || o.v !== LAYOUT_VERSION || !Array.isArray(o.sizes) || o.sizes.length !== n) return null;
 if (!o.sizes.every((s) => Number.isFinite(s) && s > 0)) return null;
 const collapsed = Array.isArray(o.collapsed) && o.collapsed.length === n ? o.collapsed.map(Boolean) : new Array(n).fill(false);
 if (collapsed.every(Boolean)) collapsed[0] = false;
 return { sizes: normalise(o.sizes), collapsed };
}
export const writeLayout = (sizes, collapsed) => JSON.stringify({ v: LAYOUT_VERSION, sizes: sizes.map((s) => Math.round(s * 1e4) / 1e4), collapsed });
