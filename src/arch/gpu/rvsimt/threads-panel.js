// rvsimt/threads-panel.js -- the threads' registers of the RISC-V SIMT core (GPU-2; contract v8 Descriptor.panels): a
// tab of the shared memory pane with one table per warp, a column per lane (thread) and a row per register that some
// thread of the warp holds as non-zero (or every register, with the option), and the lane's bit of the active mask.
// Values in signed decimal, hexadecimal in the tooltip; an inactive lane is marked "off" in words, not by colour alone;
// a cell the last step wrote is marked ◆. The thread registers are hidden in the shell's register panel (up to 512),
// so this panel is where they are read. The layout is the simulator's own (C4), as the micro-ISA's Lanes panel.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { ABI_NAMES } from '../../../isa/encoding.js';
import { threadId } from './engine.js';
import { RVSIMT_STRINGS } from './strings.js';

const P = RVSIMT_STRINGS.threads;
const hex = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;

/**
 * The tables as data (no DOM): one per warp of the profile, {warp, state, lanes: [{lane, active}], rows: [{k, name,
 * cells: [{id, value, text, title}]}]}; rows x1 to x31 that are non-zero in some lane (all with `all`).
 */
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
  /** @param {import('../../contract.js').PanelContext} ctx */
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
