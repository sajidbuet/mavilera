// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { laneId, LANE_REGISTERS } from '../engine.js';
import { GPU_STRINGS } from '../strings.js';
const P = GPU_STRINGS.lanes;
export function laneMatrix(registers) {
 const lanes = registers.lanes;
 const bit = (id, l) => (registers[id] >>> l) & 1;
 return Array.from({ length: lanes }, (_, l) => {
 const cells = [];
 for (let k = 0; k < LANE_REGISTERS; k++) {
 const v = registers[laneId(l, k)];
 cells.push({ row: `r${k}`, id: laneId(l, k), value: v, text: String(v | 0), title: `${P.lane(l)} r${k} = ${P.value(v)}` });
 }
 for (const [row, id, name] of [['active', 'active_mask', P.rowMask], ['stack0', 'stack0', P.rowStack0], ['stack1', 'stack1', P.rowStack1]]) {
 const b = bit(id, l);
 cells.push({ row, id: `${id}:${l}`, value: b, text: String(b), title: `${P.lane(l)} ${name} = ${b}` });
 }
 return { lane: l, active: bit('active_mask', l) === 1, cells };
 });
}
export class LanesPanel {
 constructor(ctx) {
 this.ctx = ctx;
 this.prev = null;
 this.status = el('p.note');
 this.table = el('table.listing.gpu-lanes-table');
 this.root = el('div.gpu-lanes.scroll', { tabindex: 0, role: 'region', 'aria-label': P.tab }, this.status, this.table, el('p.note', { text: P.note }));
 this.update(null, { accepts: false, running: false });
 }
 update(state, { running }) {
 const r = state?.registers;
 this.status.textContent = r ? '' : P.noProgram;
 this.status.hidden = Boolean(r);
 if (!r) { this.table.replaceChildren(); this.prev = null; return; }
 const cols = laneMatrix(r);
 const oneStep = this.prev && !running && state.steps === this.prevSteps + 1;
 const before = oneStep ? new Map(laneMatrix(this.prev).flatMap((c) => c.cells.map((x) => [x.id, x.value]))) : null;
 this.prev = r;
 this.prevSteps = state.steps;
 const rows = [['r0', 'r0'], ['r1', 'r1'], ['r2', 'r2'], ['r3', 'r3'], ['active', P.rowMask], ['stack0', P.rowStack0], ['stack1', P.rowStack1]];
 const head = el('tr', {}, el('th', { scope: 'col', text: '' }),
 cols.map((c) => el('th.mono', { scope: 'col', text: `${P.lane(c.lane)} · ${c.active ? P.on : P.off}` })));
 const body = rows.map(([key, label]) => el('tr', {}, el('th.mono', { scope: 'row', text: label }), cols.map((c) => {
 const x = c.cells.find((y) => y.row === key);
 const changed = before && before.get(x.id) !== x.value;
 return el(`td.mono${changed ? '.changed' : ''}${c.active ? '' : '.lane-off'}`, { title: changed ? `${x.title} · ${P.changed}` : x.title },
 changed ? '◆ ' : '', x.text);
 })));
 this.table.replaceChildren(el('caption', { text: P.caption(cols.length) }), el('thead', {}, head), el('tbody', {}, body));
 }
}
