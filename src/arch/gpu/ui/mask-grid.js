// gpu/ui/mask-grid.js -- the mask grid of the GPU module's views (GPU-3; decisions G21, G23), shared by the RISC-V SIMT
// core views and the micro-ISA's mask views: one row per issue so far, a cell per lane with its mask bit (1 active,
// 0 idle and shaded, so the bit is never told by colour alone), the active count; with "Masks-only count" only the
// issues that do work under a mask, and a line saying how many of each kind are hidden. The rows come from the model
// of each instruction set ({n, w, code, mask lane 0 first, count, kind, fault}); the strings from its string table.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';

export const GRID_ROWS = 400; // the latest rows only: a long loop would make a table of thousands

/**
 * The grid's nodes. `rows`/`hidden` as the model's filter gives them, `total` the issues so far, `warps` > 1 adds a warp
 * column, `onToggle(on)` is called by the "Masks-only count" box; `T` the strings (see core.* of rvsimt/strings.js).
 */
export function maskGrid({ rows, hidden, total, lanes, warps = 1, masksOnly, onToggle, T }) {
  const box = el('input', { type: 'checkbox', checked: masksOnly, onchange: (e) => onToggle(e.target.checked) });
  const tools = el('div.npu-tools', {}, el('label.toggle', { title: T.masksOnlyTitle }, box, ` ${T.masksOnly}`));
  if (!total) return [tools, el('p.note', { text: T.noIssues })];
  const cut = Math.max(0, rows.length - GRID_ROWS);
  const G = T.gridCols;
  const head = el('tr', {}, el('th', { scope: 'col', text: G.n }), warps > 1 ? el('th', { scope: 'col', text: G.warp }) : null,
    el('th', { scope: 'col', text: G.code }), Array.from({ length: lanes }, (_, l) => el('th.gpu-lane', { scope: 'col', text: G.lane(l) })),
    el('th', { scope: 'col', text: G.count }));
  const body = rows.slice(cut).map((r, i, all) => el(`tr${i === all.length - 1 ? '.gpu-last' : ''}${r.kind && !masksOnly ? '.gpu-quiet' : ''}`, {},
    el('td.mono', { text: String(r.n) }), warps > 1 ? el('td.mono', { text: String(r.w) }) : null,
    el('td.mono.gpu-code', { text: r.fault ? `${r.code} (${T.fault} ${r.fault})` : r.code }),
    [...r.mask].map((b, l) => el(`td.gpu-bit.${b === '1' ? 'on' : 'off'}`, { title: T.laneCell(l, b), text: b })),
    el('td.mono', { text: String(r.count) })));
  return [tools,
    el('table.listing.gpu-grid', {}, el('caption', { text: T.masksCaption(total, rows.length) }), el('thead', {}, head), el('tbody', {}, body)),
    cut ? el('p.note', { text: T.gridCut(cut) }) : null,
    masksOnly ? el('p.note', { text: T.hiddenLine(hidden) }) : null,
    el('p.note', { text: T.gridNote }), masksOnly ? el('p.note', { text: T.setupNote }) : null].filter(Boolean);
}

/** Bring the grid's latest row into view (inside its own scroll box). */
export const showLast = (box) => box.querySelector('tr.gpu-last')?.scrollIntoView?.({ block: 'nearest' });
