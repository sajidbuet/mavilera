// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { ABI_NAMES } from '../../../isa/encoding.js';
import { threadId } from './engine.js';
import { RVSIMT_STRINGS } from './strings.js';
const P = RVSIMT_STRINGS.threads;
const hex = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
export function threadTables(registers, { all = false } = {}) {
 const L = registers.lanes; const W = registers.warps;
 return Array.from({ length: W }, (_, w) => {
 const mask = registers[`w${w}_mask`];
 const lanes = Array.from({ length: L }, (__, l) => ({ lane: l, active: registers[`w${w}_state`] !== 0 && ((mask >>> l) & 1) === 1 }));
 const rows = [];
 for (let k = 1; k < 32; k++) {
 const vals = lanes.map(({ lane }) => registers[threadId(w, lane, k)] >>> 0);
 if (!all && vals.every((v) => v === 0)) continue;
 rows.push({ k, name: ABI_NAMES[k], cells: vals.map((v, l) => ({ id: threadId(w, l, k), value: v, text: String(v | 0), title: `${P.thread(w, l)} ${ABI_NAMES[k]} (x${k}) = ${v | 0} (${hex(v)})` })) });
 }
 return { warp: w, state: registers[`w${w}_state`], lanes, rows };
 });
}
export class ThreadsPanel {
 constructor(ctx) {
 this.ctx = ctx;
 this.prev = null;
 this.all = false;
 this.status = el('p.note');
 this.allBox = el('input', { type: 'checkbox', onchange: (e) => { this.all = e.target.checked; this.update(this.state, { running: false }); } });
 this.tables = el('div');
 this.root = el('div.gpu-lanes.scroll', { tabindex: 0, role: 'region', 'aria-label': P.tab }, this.status,
 el('label.note', {}, this.allBox, ` ${P.all}`), this.tables, el('p.note', { text: P.note }));
 this.update(null, { accepts: false, running: false });
 }
 update(state, { running }) {
 this.state = state;
 const r = state?.registers;
 this.status.textContent = r ? '' : P.noProgram;
 this.status.hidden = Boolean(r);
 if (!r) { this.tables.replaceChildren(); this.prev = null; return; }
 const oneStep = this.prev && !running && state.steps === this.prevSteps + 1;
 const before = oneStep ? this.prev : null;
 this.prev = r;
 this.prevSteps = state.steps;
 const S = RVSIMT_STRINGS.warpState;
 this.tables.replaceChildren(...threadTables(r, { all: this.all }).map((t) => {
 const head = el('tr', {}, el('th', { scope: 'col', text: '' }),
 t.lanes.map((c) => el('th.mono', { scope: 'col', text: `${P.lane(c.lane)} · ${c.active ? P.on : P.off}` })));
 const body = t.rows.map((row) => el('tr', {}, el('th.mono', { scope: 'row', text: `${row.name} (x${row.k})` }), row.cells.map((x, l) => {
 const changed = before && (before[x.id] >>> 0) !== x.value;
 return el(`td.mono${changed ? '.changed' : ''}${t.lanes[l].active ? '' : '.lane-off'}`, { title: changed ? `${x.title} · ${P.changed}` : x.title },
 changed ? '◆ ' : '', x.text);
 })));
 return el('table.listing.gpu-lanes-table', {}, el('caption', { text: P.caption(t.warp, S[t.state], t.rows.length) }),
 el('thead', {}, head), el('tbody', {}, body.length ? body : [el('tr', {}, el('td', { colspan: t.lanes.length + 1, text: P.allZero }))]));
 }));
 }
}
