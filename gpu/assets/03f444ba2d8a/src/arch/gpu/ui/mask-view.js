// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { STOP } from '../../contract.js';
import { MicroModel, microExportModel, microMaskRows, microCode } from '../mask-model.js';
import { maskGrid, showLast } from './mask-grid.js';
import { GPU_STRINGS } from '../strings.js';
const T = GPU_STRINGS.masks;
const lanes0 = (m, n) => Array.from({ length: n }, (_, l) => ((m >>> l) & 1 ? '1' : '0')).join('');
const hex1 = (v) => `0x${v.toString(16).toUpperCase()}`;
export class MaskView {
 constructor(lanes) {
 this.lanes = lanes;
 this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
 this.line = el('p.note.gpu-coming', { 'aria-live': 'polite' });
 this.grid = el('div.gpu-masks');
 this.stackBox = el('div.scroll.gpu-issue');
 this.masksOnly = false;
 this.root = el('div.col.gpu-core.scroll', {}, this.line, this.grid);
 this.model = null;
 }
 load(program) {
 this.program = program;
 this.model = program ? new MicroModel(program) : null;
 this.render();
 }
 reset() { this.model?.reset(); this.render(); }
 step() {
 const m = this.model;
 if (!m) return STOP.ERROR;
 const r = m.step();
 if (r === 'error') return STOP.ERROR;
 return r === 'halt' || m.halted ? STOP.HALT : STOP.NONE;
 }
 back() { return this.model?.back() ?? false; }
 render() {
 const m = this.model;
 if (!m) {
 this.status.textContent = '';
 this.line.textContent = T.noProgram;
 this.grid.replaceChildren();
 this.stackBox.replaceChildren(el('p.note', { text: T.noProgram }));
 return;
 }
 const st = m.st;
 this.status.textContent = `cycle ${m.cycle}`;
 const word = m.pm[st.pc] ?? 0;
 this.line.textContent = m.error ?? (m.halted ? T.halted(m.cycle) : T.coming(m.cycle, hex1(st.pc), microCode(this.program, st.pc, word), lanes0(st.active, this.lanes)));
 const { rows, hidden } = microMaskRows(m.issues, { program: this.program, lanes: this.lanes, masksOnly: this.masksOnly });
 this.grid.replaceChildren(...maskGrid({ rows, hidden, total: m.issues.length, lanes: this.lanes, masksOnly: this.masksOnly,
 onToggle: (on) => { this.masksOnly = on; this.render(); }, T }));
 showLast(this.grid);
 const R = T.stackRows;
 this.stackBox.replaceChildren(el('h4', { text: T.stackHeading }), el('table.listing.mem-table', {}, el('tbody', {},
 [[R.active, lanes0(st.active, this.lanes)], [R.s0, lanes0(st.s0, this.lanes)], [R.s1, lanes0(st.s1, this.lanes)], [R.depth, String(st.depth)]]
 .map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td.mono', { text: v }))))),
 el('p.note', { text: T.goldenNote }));
 }
}
export function maskInstance(v) {
 const label = T.label(v.lanes);
 return {
 root: v.root, title: T.title(v.lanes), infoTitle: T.infoTitle, status: v.status,
 tabs: [[T.stackHeading, v.stackBox]],
 load: (p) => v.load(p),
 reset: () => v.reset(),
 step: () => v.step(),
 back: () => v.back(),
 render: () => v.render(),
 state: () => {
 const m = v.model;
 if (!m) return null;
 const st = m.st;
 const registers = { pc: st.pc, active_mask: st.active, stack0: st.s0, stack1: st.s1, depth: st.depth, cycles: st.cycles, idle_slots: st.idle,
 busy: st.busy, done: st.done, lanes: st.lanes };
 for (let l = 0; l < 8; l++) for (let k = 0; k < 4; k++) registers[`l${l}r${k}`] = l < st.lanes ? st.regs[l * 4 + k] : 0;
 return { pc: st.pc, instruction: st.pc, cycle: m.cycle, retired: m.cycle, halted: m.halted, error: m.error, dropped: m.dropped, registers, changed: [], written: null };
 },
 breakAt: () => (v.model && !v.model.halted ? v.model.st.pc : null),
 exportModel: () => microExportModel(v.program ?? { lanes: v.lanes, din: [], segments: [], listing: [] }, label),
 waveform: { defaults: ['pc', 'active_mask', 'stack0', 'depth', 'busy', 'done', 'dout0'],
 format: (name, val) => (/mask$|^stack\d$/.test(name) ? lanes0(val, v.lanes) : null) },
 revision: () => '',
 };
}
