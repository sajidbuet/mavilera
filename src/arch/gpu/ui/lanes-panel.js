// gpu/ui/lanes-panel.js -- the lane-register matrix of the SIMT core (contract v8, Descriptor.panels; GPU-1 contract
// check G-1 of docs/research/gpu-npu/roadmaps/INTEGRATION_ROADMAP.md): a tab of the shared memory pane with one column
// per lane and one row per lane register (r0 to r3), the lane's bit of the active mask and its two mask-stack bits.
// Values in signed decimal, hexadecimal in the tooltip; an inactive lane is marked "off" in words, not by colour alone;
// a cell the last change of state wrote is marked ◆. The lane registers are hidden in the shell's register panel
// (eight lanes would make 32 rows there), so this panel is where they are read. The layout is the simulator's own (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { laneId, LANE_REGISTERS } from '../engine.js';
import { GPU_STRINGS } from '../strings.js';

const P = GPU_STRINGS.lanes;

/**
 * The matrix as data (no DOM): `lanes` columns, each {active, cells: [{row, value, text, title}]} with the rows r0 to
 * r3, active, stack 0, stack 1. `registers` by id (EngineState.registers).
 */
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
  /** @param {import('../../contract.js').PanelContext} ctx */
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
    // marks only after one step forward (not after a reset, a run or a step back)
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
