// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
export const GRID_ROWS = 400;
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
export const showLast = (box) => box.querySelector('tr.gpu-last')?.scrollIntoView?.({ block: 'nearest' });
