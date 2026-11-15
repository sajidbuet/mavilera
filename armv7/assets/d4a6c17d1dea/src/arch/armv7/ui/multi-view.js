// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8, download, menu, store } from '../../../ui/dom.js';
import { DatapathView, flowControl, flowOrder, groupRole } from '../../../ui/datapath.js';
import { FsmView } from '../../../ui/fsm.js';
import { STOP } from '../../contract.js';
import { ArmMulti, STATES, FSM_OUTPUTS, STATE_OUTPUTS } from '../uarch/multi.js';
import { ArmMultiExt, STATES_EXT, FSM_OUTPUTS_EXT, STATE_OUTPUTS_EXT, ALU_DECODER_MULTI_EXT } from '../uarch/multi-ext.js';
import { multiPath } from '../uarch/multi-paths.js';
import { ALU_DECODER, MAIN_DECODER, MAIN_OUTPUTS } from '../uarch/single.js';
import { MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT } from '../uarch/single-ext.js';
import { classTable, delayMap } from '../uarch/timing.js';
import { multiCriticalPath, stateTable, MULTI_DELAY_KEYS, MULTI_EXT_DELAY_KEYS } from '../uarch/multi-timing.js';
import { MULTI_SIGNALS, MULTI_INFO, MULTI_EXT_SIGNALS, MULTI_EXT_INFO, binary, meaning } from '../uarch/signals.js';
import { disassemble, CONDS, SHIFT_NAMES, immShift } from '../language.js';
import { ARMV7_STRINGS } from '../strings.js';
const S = ARMV7_STRINGS.multiView;
const X = S.ext;
const SV = ARMV7_STRINGS.singleView;
const R = S.rtn;
const REG_IDS = [...Array.from({ length: 16 }, (_, i) => `r${i}`), 'N', 'Z', 'C', 'V'];
const STRIP_ROWS = 8;
const signed = (v) => String(v | 0).replace('-', '−');
const bits = (v, w) => binary(v, w);
const DRAWING_KEY = 'pips.armv7.multi.drawing';
const VALUE_AT = {
 PC: { wire: 'pc_sa' }, ReadData: { wire: 'rd_ir' }, Instr: { wire: 'bus_up2' }, Data: { wire: 'data_rm' }, RD1: { wire: 'rd1_a' },
 RD2: { wire: 'rd2_wd' }, A: { wire: 'a_sa' }, WriteData: { wire: 'wd_mem' }, ExtImm: { wire: 'ext_sb' }, ALUResult: { wire: 'alu_rm' },
 ALUOut: { wire: 'ao_am' }, Result: { wire: 'rm_res' },
};
const MODES = {
 base: { Model: ArmMulti, signals: MULTI_SIGNALS, info: MULTI_INFO, states: STATES, outputs: FSM_OUTPUTS, rows: STATE_OUTPUTS,
 keys: MULTI_DELAY_KEYS, title: S.diagramTitle, fsmTitle: S.fsmTitle, label: S.label, noProgram: S.noProgram, module: 'arm_multi' },
 ext: { Model: ArmMultiExt, signals: MULTI_EXT_SIGNALS, info: MULTI_EXT_INFO, states: STATES_EXT, outputs: FSM_OUTPUTS_EXT,
 rows: STATE_OUTPUTS_EXT, keys: MULTI_EXT_DELAY_KEYS, title: X.diagramTitle, fsmTitle: X.fsmTitle, label: X.label, noProgram: X.noProgram,
 module: 'arm_multi_ext' },
};
const WAVE_SIGNALS = Object.freeze([...MULTI_EXT_SIGNALS, ...MULTI_SIGNALS.filter((s) => !MULTI_EXT_INFO[s.name])]);
const padded = (Model) => class extends Model {
 evaluate() {
 const c = super.evaluate();
 for (const d of WAVE_SIGNALS) if (!(d.name in c.signals)) c.signals[d.name] = 0;
 return c;
 }
};
export async function loadArmMultiContent(base) {
 const get = async (p) => {
 const r = await fetch(new URL(p, base));
 if (!r.ok) throw new Error(`${p}: ${r.status}`);
 return r.json();
 };
 const [geom, geomExt, delays] = await Promise.all([get('content/armv7/geometry/multi.json'),
 get('content/armv7/geometry/multi-extended.json'), get('content/armv7/data/single-delays.json')]);
 return { geom, geomExt, delays };
}
export class ArmMultiView {
 constructor({ geom, geomExt, delays }, { onGoTo = () => {}, onStepInstr = () => {}, onBackInstr = () => {} } = {}) {
 this.geoms = { base: geom, ext: geomExt };
 this.delayTable = delays;
 this.defaultDelays = delayMap(delays);
 this.delays = { ...this.defaultDelays };
 this.onGoTo = onGoTo;
 this.loaded = false;
 this.decimal = false;
 this.showAll = false;
 this.flowCycle = -1;
 this.dps = Object.fromEntries(Object.entries(this.geoms).map(([k, g]) => [k,
 new DatapathView(g, { title: MODES[k].title, description: g.alt, valueAt: VALUE_AT, info: MODES[k].info })]));
 this.fsms = Object.fromEntries(Object.entries(this.geoms).map(([k, g]) => [k, new FsmView(g.fsm, { title: MODES[k].fsmTitle })]));
 this.dps.ext.titleNode.id = 'dp-title-ext';
 this.dps.ext.descNode.id = 'dp-desc-ext';
 this.fsms.ext.titleNode.id = 'fsm-title-ext';
 this.fsms.ext.descNode.id = 'fsm-desc-ext';
 const check = (label, on) => el('label.toggle', {}, el('input', { type: 'checkbox', onchange: (e) => on(e.target.checked) }), ` ${label}`);
 this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
 this.badge = el('p.note', { text: X.badge, hidden: true });
 this.hint = el('p.note.sc-hint', { role: 'note' });
 this.flow = flowControl();
 this.headerTools = menu(SV.display,
 this.flow.root,
 this.dps.base.marchToggle,
 this.dps.ext.marchToggle,
 check(SV.showAll, (on) => { this.showAll = on; this.dp.setShowAll(on); }),
 check(SV.decimal, (on) => { this.decimal = on; this.render(); }),
 el('button', { type: 'button', text: SV.exportSvg, onclick: () => this.exportSvg() }),
 el('button', { type: 'button', text: SV.exportPng, onclick: () => this.exportPng() }));
 this.drawing = store.get(DRAWING_KEY) === 'fsm' ? 'fsm' : 'dp';
 this.drawButtons = [['dp', S.drawDatapath], ['fsm', S.drawFsm]].map(([id, text]) => el('button', {
 type: 'button', role: 'tab', text, 'aria-selected': String(this.drawing === id), onclick: () => this.setDrawing(id) }));
 this.root = el('div.col', {},
 el('div.panel-tools.mc-tools', {},
 el('span.tabs.mc-drawtabs', { role: 'tablist', 'aria-label': S.drawing }, this.drawButtons),
 el('button', { type: 'button', text: S.backInstr, title: S.backInstrTitle, onclick: onBackInstr }),
 el('button', { type: 'button', text: S.stepInstr, title: S.stepInstrTitle, 'aria-keyshortcuts': 'F11', onclick: onStepInstr })),
 this.badge, this.hint,
 this.dps.base.root, this.dps.ext.root, this.fsms.base.root, this.fsms.ext.root,
 el('p.note.pp-note', { text: S.fixedNote, title: S.fixedNote }));
 const cycle = { tab: S.tabCycle };
 const between = { tab: S.tabRegisters };
 const control = { tab: S.tabFsm };
 this.targets = {
 pc: { panel: 'registers' }, rf: { panel: 'registers' }, flags: { panel: 'registers' }, mem: { panel: 'memory' },
 ir: between, data: between, areg: between, wdreg: between, aoreg: between, cxd: between,
 cu: control, cc: control, g_flagw: control, g_memw: control, g_regw: control, g_pcs: control, g_pcwrite: control,
 am: cycle, ra1m: cycle, ra2m: cycle, ext: cycle, sam: cycle, sbm: cycle, alu: cycle, rm: cycle,
 byte: cycle, dsm: cycle, wa3m: cycle, sh: cycle,
 };
 this.fsmBox = el('div.scroll.mc-fsm');
 this.cycleBox = el('div.scroll.sc-cycle');
 this.regsBox = el('div.scroll.mc-regs');
 this.stripBox = el('div.scroll.mc-strip');
 this.timingBox = el('div.scroll.sc-timing');
 this.setMode('base');
 }
 setMode(mode) {
 if (this.mode === mode) return;
 this.mode = mode;
 this.m = MODES[mode];
 this.ext = mode === 'ext';
 this.geom = this.geoms[mode];
 this.dp = this.dps[mode];
 this.fsm = this.fsms[mode];
 for (const [k, d] of Object.entries(this.dps)) d.marchToggle.hidden = k !== mode;
 this.dp.setShowAll(this.showAll);
 this.badge.hidden = !this.ext;
 this.model = new this.m.Model();
 this.setDrawing(this.drawing);
 }
 setDrawing(id) {
 this.drawing = id;
 store.set(DRAWING_KEY, id);
 this.drawButtons.forEach((b, i) => b.setAttribute('aria-selected', String(['dp', 'fsm'][i] === id)));
 for (const k of Object.keys(MODES)) {
 this.dps[k].root.hidden = id !== 'dp' || k !== this.mode;
 this.fsms[k].root.hidden = id !== 'fsm' || k !== this.mode;
 }
 }
 load(program) {
 this.setMode(program?.subset === 'extended' ? 'ext' : 'base');
 this.model.load(program ?? { segments: [] });
 this.loaded = Boolean(program);
 this.flowCycle = -1;
 this.render();
 }
 reset() { this.model.reset(); this.flowCycle = -1; this.render(); }
 step() { return this.model.step(); }
 back() { return this.model.back(); }
 stepInstruction() { return this.model.stepInstruction(); }
 backInstruction() { return this.model.backInstruction(); }
 goTo(k) {
 const m = this.model;
 while (m.cycle > k && m.back());
 while (m.cycle < k && m.step() === 'step');
 this.onGoTo();
 }
 breakAt() { return this.model.state === 'Fetch' ? this.model.pc : null; }
 exportModel() {
 const m = new (padded(this.m.Model))({ historyLimit: 0 });
 m.load(this.model.program);
 return { model: m, signals: WAVE_SIGNALS, module: this.m.module, label: this.m.label, retired: (x) => x.retired };
 }
 fmt(name, v) {
 const d = this.m.info[name];
 if (d.width === 32) return this.decimal ? `${hex8(v)} (${signed(v)})` : hex8(v);
 if (name === 'state' || name === 'next') return meaning(name, v, this.m.info);
 if (d.kind === 'control' || ['Cond', 'Op', 'Funct', 'ALUFlags', 'Flags', 'Instr11:5'].includes(name)) return bits(v, d.width);
 return String(v);
 }
 tip(name, v) {
 const d = this.m.info[name];
 const m = meaning(name, v, this.m.info);
 if (d.width === 32) return `${name} = ${hex8(v)} = ${signed(v)}`;
 return `${name} = ${bits(v, d.width)}${d.width > 1 ? ` (${v})` : ''}${m ? ` → ${m}` : ''}`;
 }
 text(c) {
 if (!this.loaded) return '';
 const w = c.state === 'Fetch' ? c.signals.ReadData : c.signals.Instr;
 return c.d.bad ? hex8(w) : disassemble(w, this.model.instrAddress);
 }
 render() {
 const m = this.model;
 const c = m.evaluate();
 const s = c.signals;
 const sigs = new Map();
 const ctls = new Map();
 for (const d of this.m.signals) {
 const v = s[d.name];
 const tag = d.width === 32 ? (this.decimal ? signed(v) : (v >>> 0).toString(16).padStart(8, '0')) : null;
 (d.kind === 'control' ? ctls : sigs).set(d.name, { text: this.fmt(d.name, v), tag, tip: this.tip(d.name, v) });
 }
 sigs.set('const4', { text: '4', tag: '4', tip: 'the constant 4' });
 sigs.set('const15', { text: '15', tag: null, tip: 'the constant 15' });
 sigs.set('const14', { text: '14', tag: null, tip: 'the constant 14' });
 this.dp.setValues(sigs, ctls);
 const live = this.loaded && !m.halted && !m.error;
 if (live) {
 const p = multiPath(s, this.ext);
 this.dp.setPath(p);
 this.animate(p);
 } else {
 this.dp.setPath(null);
 this.dp.animate([], 0);
 }
 this.dp.setBadge('cu', this.loaded && !m.halted ? c.state : null);
 const marks = live ? this.failedMarks(c) : [];
 this.dp.setMarks(marks.map((x) => ({ ...x, text: '' })));
 const or = this.geom.elements.find((e) => e.id === 'g_pcwrite').at[0];
 this.dp.setAnnotations(marks.filter((x) => x.text).map((x) => ({ at: [or + 1.6, 7.85], anchor: 'west', text: x.text })));
 const next = live ? c.next : null;
 const text = this.text(c);
 this.status.textContent = S.status(m.cycle, c.state, next, hex8(m.instrAddress), text, m.halted, m.error);
 this.hint.hidden = this.loaded;
 this.hint.textContent = this.loaded ? '' : this.m.noProgram;
 const prev = m.last?.state ?? null;
 this.fsm.show(this.loaded ? c.state : null, this.loaded ? prev : null, next, (this.ext ? X : S).fsmDesc(c.state, prev));
 const lines = this.narrate(c);
 this.dp.setDescription(`${this.geom.alt} ${SV.thisCycle} (${m.cycle}, ${c.state}): ${text}. ${lines.map((l) => l.val ?? l.rtn).join(' ')}`);
 this.renderFsm(c);
 this.renderCycle(c, text, lines);
 this.renderRegisters(c);
 this.renderStrip();
 this.renderTiming(c);
 }
 renderTiming(c) {
 const m = this.model;
 const t = stateTable(this.delays, this.ext);
 const live = this.loaded && !m.halted && !m.error;
 const cur = live ? multiCriticalPath(this.delays, c.signals, this.ext).critical : null;
 const single = this.ext ? classTable(this.delays, MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT, true).tc : classTable(this.delays, MAIN_DECODER, MAIN_OUTPUTS).tc;
 const ns = (ps) => (ps / 1000).toFixed(2);
 const name = (d) => S.delayNames[d.key] ?? d.element;
 const inputs = this.delayTable.delays.filter((d) => this.m.keys.includes(d.key)).map((d) => el('tr', {},
 el('td', { text: name(d) }),
 el('td', {}, el('input.mono', { type: 'number', min: 0, step: 1, value: this.delays[d.key], 'aria-label': name(d),
 style: 'width:5rem', onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) { this.delays[d.key] = v; this.render(); } } })),
 el('td.note', { text: this.delays[d.key] === this.defaultDelays[d.key] ? '' : S.changedFrom(this.defaultDelays[d.key]) })));
 this.timingBox.replaceChildren(
 el('p.note', { text: S.illustrative }),
 cur ? el('div', {}, el('p', { text: S.currentPath(c.state, cur.delay, cur.end) }),
 el('ol.sc-path', {}, cur.path.map((p) => el('li', {}, `${p.node}: `, el('span.mono', { text: `${p.t} ps` })))))
 : el('p.note', { text: S.noPath }),
 el('table.listing.sc-table', {}, el('caption', { text: S.stateCaption }),
 el('thead', {}, el('tr', {}, [S.colState, S.colPath, S.colDelay].map((x) => el('th', { text: x })))),
 el('tbody', {}, t.rows.map((r) => {
 const by = t.setBy.includes(r.state);
 const now = live && r.state === c.state;
 return el(`tr${by ? '.sc-active' : ''}`, {},
 el('td.mono', { text: `${by ? '▲ ' : ''}${now ? '▶ ' : ''}${r.state}` }),
 el('td', { text: r.path.map((p) => p.node).join(', ') }),
 el('td.mono', { text: `${r.delay} ps` }));
 }))),
 el('p.note', { text: this.ext ? X.stateNote : S.stateNote }),
 el('p', { text: S.tc(t.tc, t.setBy.join(', '), (1e3 / t.tc).toFixed(2)) }),
 el('p', { text: this.loaded && m.retired ? S.compare(m.retired, m.cycle, t.tc, ns(m.cycle * t.tc), single, ns(m.retired * single)) : S.compareNone }),
 el('table.listing.sc-table', {}, el('caption', { text: S.delayCaption }), el('tbody', {}, inputs)),
 el('button', { type: 'button', text: S.resetDelays, onclick: () => { this.delays = { ...this.defaultDelays }; this.render(); } }));
 }
 failedMarks(c) {
 const s = c.signals;
 const writes = s.RegW || s.MemW || s.Branch;
 if (writes && !s.CondExDelayed) {
 return [{ id: 'g_pcwrite', kind: 'hold', text: S.failedMark }, ...['g_pcs', 'g_regw', 'g_memw'].map((id) => ({ id, kind: 'hold', text: '' }))];
 }
 if (s.FlagW && !s.CondEx) return [{ id: 'g_pcwrite', kind: 'hold', text: S.flagsFailedMark }, { id: 'g_flagw', kind: 'hold', text: '' }];
 return [];
 }
 animate(path) {
 const ms = this.flow.get();
 if (!ms) { this.dp.animate([], 0); return; }
 if (this.model.cycle === this.flowCycle) return;
 this.flowCycle = this.model.cycle;
 const xs = this.geom.wires.map((w) => w.points[0][0]);
 this.dp.animate(flowOrder(this.geom, [{ wires: path.wires, x0: Math.min(...xs), x1: Math.max(...xs) }]), ms);
 }
 narrate(c) {
 if (!this.loaded) return [];
 const m = this.model;
 const s = c.signals;
 const h = hex8;
 const out = [];
 const line = ([rtn, val], ...args) => out.push({ rtn, val: val(...args) });
 const op = S.aluOps[s.ALUControl];
 const cond = () => line(R.cond, s.Cond === 14 ? 'AL' : CONDS[s.Cond] ?? bits(s.Cond, 4), bits(s.Flags, 4), s.CondEx);
 const failed = () => { if (!s.CondExDelayed) out.push({ rtn: R.failed }); };
 const flags = () => {
 if (!s.FlagWrite) return;
 const after = s.FlagWrite === 3 ? s.ALUFlags : (s.ALUFlags & 0b1100) | (s.Flags & 0b0011);
 line(R.flags(meaning('FlagWrite', s.FlagWrite, this.m.info)), bits(after, 4));
 };
 const aluExt = () => {
 if (s.ShiftCtl) {
 const [type, n] = immShift(s.ShiftCtl & 3, s.ShiftCtl >>> 2);
 line(X.shift(type === 4 ? 'RRX' : SHIFT_NAMES[type], n), h(s.ShiftResult), s.ShiftC);
 }
 const expr = SV.ext.aluExpr[s.ALUControl].replaceAll('SrcA', 'A');
 const vals = expr.replace(/\bA\b/, h(s.SrcA)).replace('SrcB', h(s.SrcB)).replace(/\bC\b/, String((s.Flags >>> 1) & 1));
 line(X.aluLine(expr), vals, h(s.ALUResult));
 };
 switch (c.state) {
 case 'Fetch':
 line(R.fetch, h(s.PC), h(s.ReadData));
 line(R.pc4, h(s.PC), h(s.ALUResult));
 break;
 case 'Decode':
 line(R.pc8, h(s.ALUResult));
 line(R.readA(s.RA1), h(s.RD1));
 line(R.readWD(s.RA2, c.cls === 'dpReg' || c.cls === 'str'), h(s.RD2));
 cond();
 break;
 case 'MemAdr':
 if (this.ext) line(X.address((s.Funct >>> 3) & 1 ? '+' : '−'), h(s.SrcA), h(s.SrcB), h(s.ALUResult));
 else line(R.address, h(s.SrcA), h(s.SrcB), h(s.ALUResult));
 cond();
 break;
 case 'ExecuteR': case 'ExecuteI':
 if (this.ext) aluExt();
 else line(c.state === 'ExecuteR' ? R.aluReg(op) : R.aluImm(op), h(s.SrcA), h(s.SrcB), h(s.ALUResult));
 cond();
 flags();
 break;
 case 'MemRead':
 if (this.ext && s.ByteSel) line(X.loadByte, s['ALUOut1:0'], h(s.ReadByte));
 else line(R.load, h(s.Adr), h(s.ReadData));
 break;
 case 'MemWrite':
 failed();
 if (s.MemWrite) line(R.store(s.Rd), h(s.Adr), h(s.WriteData));
 break;
 case 'MemWB': case 'ALUWB': {
 failed();
 if (this.ext && s.NoWrite) out.push({ rtn: X.noWrite });
 const from = s.ResultSrc === 1 ? 'Data' : 'ALUOut';
 const wa3 = this.ext ? s.WA3 : s.Rd;
 if (s.RegWrite && wa3 !== 15) line(R.writeReg(wa3, from), h(s.Result));
 if (s.PCWrite) line(R.writePc(from), h(s.Result));
 break;
 }
 case 'Branch':
 failed();
 if (s.PCWrite) line(R.branch, h(s.SrcA), h(s.SrcB), h(s.Result));
 if (c.halt && s.CondExDelayed) out.push({ rtn: R.halt });
 break;
 case 'Link':
 failed();
 if (s.RegWrite) line(X.link, h(s.Result));
 line(X.target, h(s.SrcA), h(s.SrcB), h(s.ALUResult));
 break;
 case 'BranchL':
 failed();
 if (s.PCWrite) line(X.branchL, h(s.Result));
 break;
 default: break;
 }
 if (!m.error && c.next) out.push({ rtn: R.next(c.next) });
 return out;
 }
 renderFsm(c) {
 const s = c.signals;
 const cur = this.loaded ? c.state : null;
 const mark = (on) => (on ? '▶ ' : '');
 const cell = (v, k) => (v === null ? 'x' : bits(v, this.m.info[k].width));
 const head = el('tr', {}, el('th', { text: '' }), this.m.states.map((st, i) => el(`th.mono${st === cur ? '.sc-active' : ''}`,
 { text: `${mark(st === cur)}S${i} ${st}`, 'aria-current': st === cur ? 'true' : null })));
 const body = this.m.outputs.map((k) => el('tr', {}, el('td.mono', { text: k }), this.m.rows.map((r) =>
 el(`td.mono${r.state === cur ? '.sc-active' : ''}`, { text: cell(r[k], k) }))));
 const aluAct = this.loaded ? c.rows.alu : -1;
 const any = (v, w) => (v === null ? '–' : bits(v, w));
 const eq = (t) => el('p.mono.sc-pcsel', { text: t });
 const fw = (k) => bits(s[k], 2);
 let aluTable;
 if (this.ext) {
 const aluHead = el('tr', {}, ['ALUOp', 'cmd', 'U', SV.usedBy, 'ALUControl', 'FlagW'].map((t) => el('th', { text: t })));
 const aluRows = ALU_DECODER_MULTI_EXT.map((r, i) => el(`tr${i === aluAct ? '.sc-active' : ''}`, { 'aria-current': i === aluAct ? 'true' : null },
 el('td.mono', { text: `${mark(i === aluAct)}${bits(r.ALUOp, 2)}` }), el('td.mono', { text: any(r.cmd, 4) }), el('td.mono', { text: any(r.U, 1) }),
 el('td', { text: r.name }), el('td.mono', { text: bits(r.ALUControl, 4) }), el('td.mono', { text: r.FlagW })));
 aluTable = el('table.listing.sc-table', {}, el('caption', { text: X.aluCaption }), el('thead', {}, aluHead), el('tbody', {}, aluRows));
 } else {
 const aluHead = el('tr', {}, ['ALUOp', 'cmd', 'S', SV.usedBy, 'ALUControl', 'FlagW'].map((t) => el('th', { text: t })));
 const aluRows = ALU_DECODER.map((r, i) => el(`tr${i === aluAct ? '.sc-active' : ''}`, { 'aria-current': i === aluAct ? 'true' : null },
 el('td.mono', { text: `${mark(i === aluAct)}${r.ALUOp}` }), el('td.mono', { text: any(r.cmd, 4) }), el('td.mono', { text: any(r.S, 1) }),
 el('td', { text: r.name ?? SV.notDp }), el('td.mono', { text: bits(r.ALUControl, 2) }), el('td.mono', { text: bits(r.FlagW, 2) })));
 aluTable = el('table.listing.sc-table', {}, el('caption', { text: S.aluCaption }), el('thead', {}, aluHead), el('tbody', {}, aluRows));
 }
 this.fsmBox.replaceChildren(
 this.ext ? el('p.note', { text: X.badge }) : null,
 el('p.note', { text: this.loaded ? S.outActive(c.state) : this.m.noProgram }),
 el('table.listing.sc-table.mc-out', {}, el('caption', { text: this.ext ? X.outCaption : S.outCaption }), el('thead', {}, head), el('tbody', {}, body)),
 el('p.note', { text: this.ext ? X.outNote : S.outNote }),
 this.loaded && c.next ? eq(S.transitions(c.state, bits(s.Op, 2), bits(s.Funct, 6), c.next)) : null,
 eq(this.ext ? X.instrDecoder(bits(s.Op, 2), bits(s.RegSrc, 2), bits(s.ImmSrc, 2), bits(s.ShiftCtl, 7), s.NoWrite, s.ByteSel)
 : S.instrDecoder(bits(s.Op, 2), bits(s.RegSrc, 2), bits(s.ImmSrc, 2))),
 aluTable,
 el('h3', { text: S.condCaption }),
 this.ext ? eq(`PCS = ((WA3 == 15) AND RegW) OR Branch = ((${s.WA3} == 15) AND ${s.RegW}) OR ${s.Branch} = ${s.PCS}; WA3 = Link ? 14 : Rd = ${s.WA3}`)
 : eq(`PCS = ((Rd == 15) AND RegW) OR Branch = ((${s.Rd} == 15) AND ${s.RegW}) OR ${s.Branch} = ${s.PCS}`),
 eq(`CondEx = ConditionCheck(Cond = ${bits(s.Cond, 4)}, NZCV = ${bits(s.Flags, 4)}) = ${s.CondEx}; CondExDelayed = ${s.CondExDelayed}`),
 eq(`FlagWrite = FlagW AND CondEx = ${fw('FlagW')} AND {${s.CondEx}, ${s.CondEx}} = ${fw('FlagWrite')}`),
 eq(`PCWrite = (PCS AND CondExDelayed) OR NextPC = (${s.PCS} AND ${s.CondExDelayed}) OR ${s.NextPC} = ${s.PCWrite}`),
 this.ext ? eq(`RegWrite = RegW AND CondExDelayed AND NOT NoWrite = ${s.RegW} AND ${s.CondExDelayed} AND NOT ${s.NoWrite} = ${s.RegWrite}`)
 : eq(`RegWrite = RegW AND CondExDelayed = ${s.RegW} AND ${s.CondExDelayed} = ${s.RegWrite}`),
 eq(`MemWrite = MemW AND CondExDelayed = ${s.MemW} AND ${s.CondExDelayed} = ${s.MemWrite}`));
 }
 renderCycle(c, text, lines) {
 const s = c.signals;
 const rows = this.m.signals.map((d) => {
 const v = s[d.name];
 return el('tr', {}, el('td.mono', { text: d.name }), el('td', { text: d.kind === 'control' ? SV.kindControl : SV.kindData }),
 el('td.mono', { text: d.width === 32 ? hex8(v) : bits(v, d.width) }),
 el('td.mono', { text: d.width === 32 ? signed(v) : String(v) }), el('td.mono', { text: meaning(d.name, v, this.m.info) ?? '' }));
 });
 const m = this.model;
 this.cycleBox.replaceChildren(
 el('p.sc-instr.mono', { text: this.loaded ? `${S.cycleLabel} ${m.cycle}, ${c.state}: ${hex8(m.instrAddress)}  ${text}` : this.m.noProgram }),
 el('ul.sc-rtn', {}, lines.map((l) => el('li', {}, el('span.mono', { text: l.rtn }), l.val ? el('br') : null,
 l.val ? el('span.mono.sc-val', { text: l.val }) : null))),
 el('table.listing.sc-signals', {}, el('caption', { text: SV.signalsCaption }),
 el('thead', {}, el('tr', {}, [SV.colSignal, SV.colKind, SV.colCode, SV.colDecimal, SV.colMeaning].map((x) => el('th', { text: x })))),
 el('tbody', {}, rows)),
 el('p.note', { text: S.fixedNote }));
 }
 renderRegisters(c) {
 const m = this.model;
 const s = c.signals;
 const rows = [
 ['IR', m.IR, s.IRWrite, 'IRWrite', s.ReadData, hex8], ['Data', m.Data, 1, null, s.DataIn ?? s.ReadData, hex8],
 ['A', m.A, 1, null, s.RD1, hex8], ['WriteData', m.WD, 1, null, s.RD2, hex8], ['ALUOut', m.ALUOut, 1, null, s.ALUResult, hex8],
 ['CondExDelayed', m.CondExDelayed, 1, null, s.CondEx, String],
 ].map(([name, now, en, sig, next, f]) => el(`tr${sig && en ? '.sc-active' : ''}`, {},
 el('td.mono', { text: name }), el('td.mono', { text: f(now) }),
 el('td', { text: sig ? (en ? S.yes(sig) : S.no(sig)) : S.always }),
 el('td.mono', { text: f(en ? next : now) }), el('td', { text: S.why[name] })));
 const after = s.FlagWrite === 3 ? s.ALUFlags : s.FlagWrite === 2 ? (s.ALUFlags & 0b1100) | (s.Flags & 0b0011) : s.Flags;
 const arch = [S.archPc(s.PCWrite, hex8(s.Result)), S.archRf(s.RegWrite, this.ext ? s.WA3 : s.Rd, hex8(s.Result)),
 S.archMem(s.MemWrite, hex8(s.Adr), hex8(s.WriteData)), S.archFlags(s.FlagWrite ? bits(s.FlagWrite, 2) : 0, bits(after, 4))];
 this.regsBox.replaceChildren(
 el('table.listing.sc-table.mc-regtable', {}, el('caption', { text: S.regsCaption }),
 el('thead', {}, el('tr', {}, [S.colReg, S.colHolds, S.colEnable, S.colNext, S.colWhy].map((x) => el('th', { text: x })))),
 el('tbody', {}, rows)),
 el('p', { text: S.archCaption }),
 el('ul.sc-rtn', {}, arch.map((x) => el('li.mono', { text: x }))));
 }
 renderStrip() {
 const m = this.model;
 if (!this.loaded) { this.stripBox.replaceChildren(el('p.note', { text: this.m.noProgram })); return; }
 const first = m.cycle - m.history.length;
 const cyc = [];
 for (let k = first; k <= m.cycle; k++) {
 const r = k < m.cycle ? m.history[k - first] : null;
 cyc.push({ k, state: r ? r.state : m.state, at: r ? (r.state === 'Fetch' ? r.pc : r.at) : m.instrAddress });
 }
 const groups = [];
 for (const x of cyc) {
 if (x.state === 'Fetch' || !groups.length) groups.push({ at: x.at, cells: [] });
 groups[groups.length - 1].cells.push(x);
 }
 const shown = groups.slice(-STRIP_ROWS);
 const k0 = shown[0].cells[0].k;
 const cols = [];
 for (let k = k0; k <= m.cycle; k++) cols.push(k);
 const wordAt = (g) => {
 const kf = g.cells[0].k;
 if (kf === m.cycle) return m.evaluate().signals.ReadData;
 if (kf + 1 === m.cycle) return m.IR;
 return m.history[kf + 1 - first]?.IR ?? 0;
 };
 const rows = shown.map((g) => {
 const label = `${hex8(g.at).slice(-4)}  ${disassemble(wordAt(g), g.at)}`;
 const by = new Map(g.cells.map((x) => [x.k, x.state]));
 return el('tr', {}, el('th.mono', { scope: 'row', text: label }),
 cols.map((k) => {
 const st = by.get(k);
 if (!st) return el(`td${k === m.cycle ? '.pd-cur' : ''}`, {});
 return el(`td.pd-cell${k === m.cycle ? '.pd-cur' : ''}`, {}, el('button', {
 type: 'button', text: st, title: S.cellTitle(st, k), 'aria-label': `${S.cellTitle(st, k)}. ${S.goToCycle(k)}`,
 onclick: () => this.goTo(k) }));
 }),
 el('td.mono', { text: String(g.cells.length) }));
 });
 const head = el('tr', {}, el('th', { text: S.colInstr }), cols.map((k) => el(`th.mono${k === m.cycle ? '.pd-cur' : ''}`, { text: String(k) })),
 el('th', { text: S.colCycles }));
 this.stripBox.replaceChildren(
 el('table.listing.pd-table.mc-striptable', {}, el('caption', { text: S.stripCaption }), el('thead', {}, head), el('tbody', {}, rows)),
 el('p.note', { text: this.ext ? `${S.stripLegend} ${S.stripLegendExt}` : S.stripLegend }),
 m.retired ? el('p', { text: S.cpi(m.retired, m.cycle, (m.cycle / m.retired).toFixed(3)) }) : null);
 const cur = this.stripBox.querySelector('thead th.pd-cur');
 if (cur) this.stripBox.scrollLeft = Math.max(0, cur.offsetLeft - this.stripBox.clientWidth / 2);
 }
 caption() { return `${this.m.label}, ${S.cycleLabel.toLowerCase()} ${this.model.cycle} (${this.model.state})`; }
 fileName(ext) { return `arm-multi${this.ext ? '-extended' : ''}-cycle${this.model.cycle}.${ext}`; }
 exportSvg() { download(this.fileName('svg'), this.dp.exportSvg(this.caption()), 'image/svg+xml'); }
 exportPng() {
 const text = this.dp.exportSvg(this.caption());
 const img = new Image();
 const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
 img.onload = () => {
 const cv = document.createElement('canvas');
 cv.width = img.width;
 cv.height = img.height;
 cv.getContext('2d').drawImage(img, 0, 0);
 URL.revokeObjectURL(url);
 cv.toBlob((b) => b && download(this.fileName('png'), b, 'image/png'));
 };
 img.src = url;
 }
}
const stopOf = (r) => (r === 'step' ? STOP.NONE : r === 'halt' ? STOP.HALT : STOP.ERROR);
export function armMultiInstance(v, ctx) {
 const open = (t) => ctx.openPanel?.(t.panel ? { panel: t.panel } : { tab: t.tab });
 for (const dp of Object.values(v.dps)) dp.setLinks(v.targets, (id) => open(v.targets[id]), S.elementNames);
 for (const f of Object.values(v.fsms)) f.setLink(() => open(v.targets.cu), S.openState);
 groupRole(v.dps.ext.svg, 'dp-title-ext', 'dp-desc-ext');
 groupRole(v.fsms.ext.svg, 'fsm-title-ext', 'fsm-desc-ext');
 return {
 root: v.root, title: S.panel, infoTitle: S.info, status: v.status, headerTools: v.headerTools,
 tabs: [[S.tabFsm, v.fsmBox], [S.tabCycle, v.cycleBox], [S.tabRegisters, v.regsBox], [S.tabStrip, v.stripBox], [S.tabTiming, v.timingBox]],
 diagrams: [v.dps.base.svg, v.dps.ext.svg, v.fsms.base.svg, v.fsms.ext.svg],
 load: (p) => v.load(p),
 reset: () => v.reset(),
 step: () => stopOf(v.step()),
 back: () => v.back(),
 render: () => v.render(),
 state: () => {
 if (!v.loaded) return null;
 const m = v.model;
 const last = m.last;
 const regs = m.registers();
 const changed = [];
 if (last?.reg) changed.push(`r${last.reg[0]}`);
 if (last) ['N', 'Z', 'C', 'V'].forEach((f, k) => { if (((last.flags >>> (3 - k)) & 1) !== regs[f]) changed.push(f); });
 return { pc: m.pc, instruction: m.instrAddress, cycle: m.cycle, retired: m.retired, halted: m.halted, error: m.error, dropped: m.dropped,
 registers: Object.fromEntries(REG_IDS.map((id) => [id, regs[id]])), changed,
 written: last?.mem ? { address: last.mem[0], size: 4 } : null };
 },
 stopMessage: (stop) => {
 if (stop !== STOP.HALT || !v.loaded) return null;
 const m = v.model;
 return S.halted(hex8(m.pc), m.cycle, m.retired, m.retired ? (m.cycle / m.retired).toFixed(3) : '—');
 },
 dataAccess: () => {
 if (!v.loaded || v.model.halted || v.model.error) return null;
 const c = v.model.evaluate();
 return c.access && c.signals.CondExDelayed ? { address: c.signals.Adr >>> 0, size: c.access.size } : null;
 },
 memoryPort: () => (v.loaded ? v.model.mem : null),
 breakAt: () => v.breakAt(),
 unit: { label: S.stepInstr, step: () => stopOf(v.stepInstruction()), back: () => v.backInstruction() },
 exportModel: () => v.exportModel(),
 waveform: { defaults: ['state', 'PC', 'IRWrite', 'AdrSrc', 'ALUSrcA', 'ALUSrcB', 'ResultSrc', 'CondExDelayed', 'PCWrite', 'RegWrite', 'ALUResult'],
 format: (name, val) => (name === 'state' || name === 'next' ? STATES_EXT[val] ?? String(val) : null) },
 revision: () => v.mode,
 };
}
