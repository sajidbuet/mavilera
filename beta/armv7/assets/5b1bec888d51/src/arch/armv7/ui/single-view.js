// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8, download, menu } from '../../../ui/dom.js';
import { STRINGS } from '../../../ui/strings.js';
import { DatapathView, flowControl, flowOrder, groupRole } from '../../../ui/datapath.js';
import { STOP } from '../../contract.js';
import { ArmSingle, MAIN_DECODER, MAIN_OUTPUTS, ALU_DECODER } from '../uarch/single.js';
import { ArmSingleExt, MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT, ALU_DECODER_EXT } from '../uarch/single-ext.js';
import { SINGLE_SIGNALS, SIGNAL_INFO, SINGLE_EXT_SIGNALS, SIGNAL_INFO_EXT, binary, meaning } from '../uarch/signals.js';
import { activePath, activePathExt } from '../uarch/single-paths.js';
import { criticalPath, classTable, classSignals, delayMap } from '../uarch/timing.js';
import { disassemble, CONDS, SHIFT_NAMES, immShift } from '../language.js';
import { ARMV7_STRINGS } from '../strings.js';
const S = ARMV7_STRINGS.singleView;
const R = S.rtn;
const X = S.ext;
const REG_IDS = [...Array.from({ length: 16 }, (_, i) => `r${i}`), 'N', 'Z', 'C', 'V'];
const signed = (v) => String(v | 0).replace('-', '−');
const bits = (v, w) => binary(v, w);
const VALUE_AT = {
 PC: { wire: 'pc_add4' }, PCPlus4: { wire: 'pc4_add8' }, Instr: { wire: 'bus_dn1' }, SrcA: { wire: 'rd1_alu' },
 WriteData: { wire: 'rd2_dm' }, ExtImm: { wire: 'ext_bm' }, ALUResult: { wire: 'alu_rm' }, ReadData: { wire: 'dm_rm' },
 Result: { wire: 'res_pcm' },
};
const VALUE_AT_EXT = { ...VALUE_AT, ALUResult: { wire: 'alu_up' }, ReadData: { wire: 'dm_rm4' }, Result: { wire: 'res_tgm' } };
const MODES = {
 base: { Model: ArmSingle, signals: SINGLE_SIGNALS, info: SIGNAL_INFO, main: MAIN_DECODER, outputs: MAIN_OUTPUTS, path: activePath,
 valueAt: VALUE_AT, title: S.diagramTitle, label: S.label, noProgram: S.noProgram },
 ext: { Model: ArmSingleExt, signals: SINGLE_EXT_SIGNALS, info: SIGNAL_INFO_EXT, main: MAIN_DECODER_EXT, outputs: MAIN_OUTPUTS_EXT,
 path: activePathExt, valueAt: VALUE_AT_EXT, title: X.diagramTitle, label: X.label, noProgram: X.noProgram },
};
const WAVE_SIGNALS = Object.freeze([...SINGLE_EXT_SIGNALS, ...SINGLE_SIGNALS.filter((s) => !SIGNAL_INFO_EXT[s.name])]);
const padded = (Model) => class extends Model {
 evaluate() {
 const c = super.evaluate();
 for (const d of WAVE_SIGNALS) if (!(d.name in c.signals)) c.signals[d.name] = 0;
 return c;
 }
};
export async function loadArmSingleContent(base) {
 const get = async (p) => {
 const r = await fetch(new URL(p, base));
 if (!r.ok) throw new Error(`${p}: ${r.status}`);
 return r.json();
 };
 const [geom, geomExt, delays] = await Promise.all([get('content/armv7/geometry/single.json'),
 get('content/armv7/geometry/single-extended.json'), get('content/armv7/data/single-delays.json')]);
 return { geom, geomExt, delays };
}
export class ArmSingleView {
 constructor({ geom, geomExt, delays }) {
 this.geoms = { base: geom, ext: geomExt };
 this.delayTable = delays;
 this.defaultDelays = delayMap(delays);
 this.delays = { ...this.defaultDelays };
 this.critical = false;
 this.dps = Object.fromEntries(Object.entries(this.geoms).map(([k, g]) => [k,
 new DatapathView(g, { title: MODES[k].title, description: g.alt, valueAt: MODES[k].valueAt, info: MODES[k].info })]));
 this.dps.ext.root.hidden = true;
 this.loaded = false;
 this.figure = '';
 this.decimal = false;
 this.showAll = false;
 this.flowCycle = -1;
 const check = (label, on) => el('label.toggle', {}, el('input', { type: 'checkbox', onchange: (e) => on(e.target.checked) }), ` ${label}`);
 this.figSel = el('select', { 'aria-label': S.figure, onchange: (e) => { this.figure = e.target.value; this.render(); } });
 this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
 this.badge = el('p.note', { text: X.badge, hidden: true });
 this.hint = el('p.note.sc-hint', { role: 'note' });
 this.flow = flowControl();
 this.dps.ext.marchToggle.hidden = true;
 this.headerTools = menu(S.display,
 this.flow.root,
 this.dps.base.marchToggle,
 this.dps.ext.marchToggle,
 check(S.showAll, (on) => { this.showAll = on; this.dp.setShowAll(on); }),
 check(S.decimal, (on) => { this.decimal = on; this.render(); }),
 el('button', { type: 'button', text: S.exportSvg, onclick: () => this.exportSvg() }),
 el('button', { type: 'button', text: S.exportPng, onclick: () => this.exportPng() }));
 this.root = el('div.col', {},
 el('div.panel-tools', {}, check(S.criticalMode, (on) => { this.critical = on; this.render(); }),
 el('label.toggle', {}, `${S.figure} `, this.figSel)),
 this.badge, this.hint,
 this.dps.base.root, this.dps.ext.root);
 const cycle = { tab: S.tabCycle };
 const control = { tab: S.tabControl };
 this.targets = {
 pc: { panel: 'registers' }, rf: { panel: 'registers' }, flags: { panel: 'registers' }, dm: { panel: 'memory' }, imem: { tab: STRINGS.listing },
 dec: control, cc: control, g_pcsrc: control, g_regw: control, g_memw: control, g_flagw: control,
 alu: cycle, bm: cycle, rm: cycle, pcm: cycle, ra1m: cycle, ra2m: cycle, ext: cycle, add4: cycle, add8: cycle,
 sh: cycle, tgm: cycle, wa3m: cycle, byte: cycle,
 };
 this.cycleBox = el('div.scroll.sc-cycle');
 this.controlBox = el('div.scroll.sc-control');
 this.timingBox = el('div.scroll.sc-timing');
 this.setMode('base');
 }
 setMode(mode) {
 if (this.mode === mode) return;
 this.mode = mode;
 this.m = MODES[mode];
 this.dp = this.dps[mode];
 for (const [k, d] of Object.entries(this.dps)) { d.root.hidden = k !== mode; d.marchToggle.hidden = k !== mode; }
 this.dp.setShowAll(this.showAll);
 this.badge.hidden = mode !== 'ext';
 this.model = new this.m.Model();
 this.figSel.replaceChildren(el('option', { value: '', text: S.figureNone }),
 ...this.m.main.map((r) => el('option', { value: r.cls, text: S.classes[r.cls] })));
 }
 load(program) {
 this.setMode(program?.subset === 'extended' ? 'ext' : 'base');
 this.model.load(program ?? { segments: [] });
 this.loaded = Boolean(program);
 this.flowCycle = -1;
 this.figure = '';
 this.figSel.value = '';
 this.render();
 }
 reset() { this.model.reset(); this.flowCycle = -1; this.render(); }
 step() {
 this.figure = '';
 this.figSel.value = '';
 return this.model.step();
 }
 back() { return this.model.back(); }
 exportModel() {
 const m = new (padded(this.m.Model))({ historyLimit: 0 });
 m.load(this.model.program);
 return { model: m, signals: WAVE_SIGNALS, module: this.mode === 'ext' ? 'arm_single_ext' : 'arm_single', label: this.m.label };
 }
 fmt(name, v) {
 const d = this.m.info[name];
 if (d.width === 32) return this.decimal ? `${hex8(v)} (${signed(v)})` : hex8(v);
 if (d.kind === 'control' || ['Cond', 'Op', 'Funct', 'ALUFlags', 'Flags', 'Instr11:5'].includes(name)) return bits(v, d.width);
 return String(v);
 }
 tip(name, v) {
 const d = this.m.info[name];
 const m = meaning(name, v, this.m.info);
 if (d.width === 32) return `${name} = ${hex8(v)} = ${signed(v)}`;
 return `${name} = ${bits(v, d.width)}${d.width > 1 ? ` (${v})` : ''}${m ? ` → ${m}` : ''}`;
 }
 render() {
 const c = this.model.evaluate();
 const s = c.signals;
 const sigs = new Map();
 const ctls = new Map();
 for (const d of this.m.signals) {
 const v = s[d.name];
 const tag = d.width === 32 ? (this.decimal ? signed(v) : (v >>> 0).toString(16).padStart(8, '0')) : null;
 (d.kind === 'control' ? ctls : sigs).set(d.name, { text: this.fmt(d.name, v), tag, tip: this.tip(d.name, v) });
 }
 this.dp.setValues(sigs, ctls);
 const path = this.m.path(s);
 const ext = this.mode === 'ext';
 let crit = null;
 if (this.figure) {
 this.dp.setPath(this.m.path(classSignals(this.m.main.find((r) => r.cls === this.figure), this.m.outputs)));
 this.dp.animate([], 0);
 } else {
 if (this.critical && this.loaded && c.cls && !c.d.bad) crit = criticalPath(this.delays, s, ext).critical;
 this.dp.setPath(this.loaded ? path : null, crit ? new Set(crit.path.flatMap((p) => p.wires)) : null);
 if (crit) this.dp.animate([], 0); else this.animate(path);
 }
 const failed = !this.figure && this.loaded && c.cls && !c.d.bad && !c.halt && !s.CondEx;
 this.dp.setMarks(failed ? ['g_pcsrc', 'g_regw', 'g_memw', 'g_flagw'].map((id) => ({ id, kind: 'hold', text: '' })) : []);
 this.dp.setAnnotations([...(crit ? this.annotations(crit) : []), ...(failed ? [{ at: [13.2, 5.875], anchor: 'center', text: S.failedMark }] : [])]);
 const text = this.instructionText(c);
 this.status.textContent = this.figure ? S.preset(S.classes[this.figure]) : S.status(this.model.cycle, hex8(s.PC), text, this.model.halted, this.model.error);
 this.hint.hidden = this.loaded;
 this.hint.textContent = this.loaded ? '' : this.m.noProgram;
 const lines = this.mode === 'ext' ? this.narrateExt(c) : this.narrate(c);
 this.dp.setDescription(`${this.geoms[this.mode].alt} ${S.thisCycle}: ${text}. ${lines.map((l) => l.val ?? l.rtn).join(' ')}`);
 this.renderCycle(c, text, lines);
 if (this.mode === 'ext') this.renderControlExt(c); else this.renderControl(c);
 this.renderTiming(c, crit ?? (this.loaded && c.cls && !c.d.bad ? criticalPath(this.delays, s, ext).critical : null));
 }
 annotations(crit) {
 const g = this.geoms[this.mode];
 const wire = (id) => g.wires.find((w) => w.id === id);
 const out = [];
 crit.path.forEach((p, i) => {
 const next = crit.path[i + 1];
 if (next?.wires.length) {
 const [[x0, y0], [x1, y1]] = wire(next.wires[0]).points;
 const len = Math.hypot(x1 - x0, y1 - y0) || 1;
 out.push({ at: [x0 + ((x1 - x0) / len) * 0.18, y0 + ((y1 - y0) / len) * 0.18], anchor: 'south west', text: String(p.t) });
 } else if (!next && p.wires.length) {
 const pts = wire(p.wires[p.wires.length - 1]).points;
 out.push({ at: pts[pts.length - 1], anchor: 'north west', text: String(p.t) });
 }
 });
 return out;
 }
 renderTiming(c, cur) {
 const ext = this.mode === 'ext';
 const t = classTable(this.delays, this.m.main, this.m.outputs, ext);
 const inputs = this.delayTable.delays.filter((d) => d.key !== 'hazard' && (ext || (d.key !== 'shift' && d.key !== 'byte'))).map((d) => el('tr', {},
 el('td', { text: d.element }),
 el('td', {}, el('input.mono', { type: 'number', min: 0, step: 1, value: this.delays[d.key], 'aria-label': d.element, style: 'width:5rem',
 onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) { this.delays[d.key] = v; this.render(); } } })),
 el('td.note', { text: this.delays[d.key] === this.defaultDelays[d.key] ? '' : S.changedFrom(this.defaultDelays[d.key]) })));
 this.timingBox.replaceChildren(
 el('p.note', { text: S.illustrative }),
 cur ? el('div', {}, el('p', { text: S.currentPath(cur.delay, cur.end) }),
 el('ol.sc-path', {}, cur.path.map((p) => el('li', {}, `${p.node}: `, el('span.mono', { text: `${p.t} ps` })))))
 : el('p.note', { text: S.noPath }),
 el('table.listing.sc-table', {}, el('caption', { text: S.classCaption }),
 el('thead', {}, el('tr', {}, [S.colClass2, S.colPath, S.colDelay].map((x) => el('th', { text: x })))),
 el('tbody', {}, t.rows.map((r) => el(`tr${t.setBy.includes(r.cls) ? '.sc-active' : ''}`, {},
 el('td', { text: `${t.setBy.includes(r.cls) ? '▲ ' : ''}${r.cls === c.cls ? '▶ ' : ''}${S.classes[r.cls]}` }),
 el('td', { text: r.path.map((p) => p.node).join(', ') }),
 el('td.mono', { text: `${r.delay} ps` }))))),
 el('p', { text: S.tc(t.tc, t.setBy.map((k) => S.classes[k]).join(', '), (1e3 / t.tc).toFixed(2)) }),
 el('table.listing.sc-table', {}, el('caption', { text: S.delayCaption }), el('tbody', {}, inputs)),
 el('button', { type: 'button', text: S.resetDelays, onclick: () => { this.delays = { ...this.defaultDelays }; this.render(); } }));
 }
 instructionText(c) {
 if (!this.loaded) return '';
 return c.d.bad ? hex8(c.signals.Instr) : disassemble(c.signals.Instr, c.signals.PC);
 }
 animate(path) {
 const ms = this.flow.get();
 if (!this.loaded || !ms) { this.dp.animate([], 0); return; }
 if (this.model.cycle === this.flowCycle) return;
 this.flowCycle = this.model.cycle;
 const g = this.geoms[this.mode];
 const xs = g.wires.map((w) => w.points[0][0]);
 this.dp.animate(flowOrder(g, [{ wires: path.wires, x0: Math.min(...xs), x1: Math.max(...xs) }]), ms);
 }
 start(c, out, line) {
 const s = c.signals;
 line(R.fetch, hex8(s.PC), hex8(s.Instr));
 if (!c.cls || c.d.bad) return false;
 line(R.cond, s.Cond === 14 ? 'AL' : CONDS[s.Cond] ?? bits(s.Cond, 4), bits(s.Flags, 4), s.CondEx);
 if (c.halt) { out.push({ rtn: R.halt }); return false; }
 return true;
 }
 flagLine(s, line) {
 if (!s.FlagWrite) return;
 const after = s.FlagWrite === 3 ? s.ALUFlags : (s.ALUFlags & 0b1100) | (s.Flags & 0b0011);
 line(R.flags(meaning('FlagWrite', s.FlagWrite, this.m.info)), bits(after, 4));
 }
 narrate(c) {
 if (!this.loaded) return [];
 const s = c.signals;
 const h = hex8;
 const out = [];
 const line = ([rtn, val], ...args) => out.push({ rtn, val: val(...args) });
 if (!this.start(c, out, line)) return out;
 const op = S.aluOps[s.ALUControl];
 if (c.cls === 'b') line(R.target, h(s.SrcA), h(s.SrcB), h(s.ALUResult));
 else {
 line(R.srcA(s.RA1, s.RA1 === 15), h(s.SrcA));
 if (c.cls === 'dpReg') line(R.srcBReg(s.RA2, s.RA2 === 15), h(s.SrcB));
 if (c.cls === 'dpReg' || c.cls === 'dpImm') {
 if (c.cls === 'dpImm') line(R.srcBImm('Instr7:0'), h(s.SrcB));
 line(R.alu(op), h(s.SrcA), h(s.SrcB), h(s.ALUResult));
 } else line(R.address, h(s.ALUResult));
 }
 if (!s.CondEx) { out.push({ rtn: R.failed }); line(R.next, h(s.PCPlus4)); return out; }
 if (c.cls === 'ldr') line(R.load, h(s.ALUResult), h(s.ReadData));
 if (c.cls === 'str') line(R.store(s.Rd, s.Rd === 15), h(s.ALUResult), h(s.WriteData));
 const from = s.MemtoReg ? 'ReadData' : 'ALUResult';
 if (s.RegWrite && s.Rd !== 15) line(R.writeReg(s.Rd, from), h(s.Result));
 this.flagLine(s, line);
 if (s.PCSrc) line(R.writePc(c.cls === 'b' ? 'ALUResult' : from), h(s.PCNext));
 else line(R.next, h(s.PCPlus4));
 return out;
 }
 narrateExt(c) {
 if (!this.loaded) return [];
 const s = c.signals;
 const h = hex8;
 const out = [];
 const line = ([rtn, val], ...args) => out.push({ rtn, val: val(...args) });
 if (!this.start(c, out, line)) return out;
 const branch = c.cls === 'b' || c.cls === 'bl';
 if (branch) line(R.target, h(s.SrcA), h(s.SrcB), h(s.ALUResult));
 else {
 const mov = s.ALUOp === 0b10 && (s.ALUControl === 13 || s.ALUControl === 15);
 if (!mov) line(R.srcA(s.RA1, s.RA1 === 15), h(s.SrcA));
 if (c.cls === 'dpReg') {
 const [type, n] = immShift(s.ShiftCtl & 3, s.ShiftCtl >>> 2);
 if (s.ShiftCtl) line(X.shift(s.RA2, type === 4 ? 'RRX' : SHIFT_NAMES[type], n), h(s.ShiftResult), s.ShiftC);
 else line(R.srcBReg(s.RA2, s.RA2 === 15), h(s.SrcB));
 }
 if (c.cls === 'dpReg' || c.cls === 'dpImm') {
 if (c.cls === 'dpImm') line(R.srcBImm('Instr7:0'), h(s.SrcB));
 const expr = X.aluExpr[s.ALUControl];
 const vals = expr.replace('SrcA', h(s.SrcA)).replace('SrcB', h(s.SrcB)).replace(/\bC\b/, String((s.Flags >>> 1) & 1));
 line(X.aluLine(expr), vals, h(s.ALUResult));
 if (s.NoWrite) out.push({ rtn: X.noWrite });
 } else line(X.address((s.Funct >>> 3) & 1 ? '+' : '−'), h(s.ALUResult));
 }
 if (!s.CondEx) { out.push({ rtn: R.failed }); line(R.next, h(s.PCPlus4)); return out; }
 if (c.cls === 'ldr') line(R.load, h(s.ALUResult), h(s.ReadData));
 if (c.cls === 'ldrb') line(X.loadByte, s.ALUResult, h(s.ReadByte));
 if (c.cls === 'str') line(R.store(s.Rd, s.Rd === 15), h(s.ALUResult), h(s.WriteData));
 if (s.RegWrite && s.Link) line(X.link, h(s.Result));
 else if (s.RegWrite && s.WA3 !== 15) line(R.writeReg(s.WA3, meaning('ResultSrc', s.ResultSrc, this.m.info)), h(s.Result));
 this.flagLine(s, line);
 if (s.PCSrc) {
 if (s.Branch) line(X.writePc, h(s.PCNext));
 else line(R.writePc(meaning('ResultSrc', s.ResultSrc, this.m.info)), h(s.PCNext));
 } else line(R.next, h(s.PCPlus4));
 return out;
 }
 renderCycle(c, text, lines) {
 const s = c.signals;
 const rows = this.m.signals.map((d) => {
 const v = s[d.name];
 return el('tr', {}, el('td.mono', { text: d.name }), el('td', { text: d.kind === 'control' ? S.kindControl : S.kindData }),
 el('td.mono', { text: d.width === 32 ? hex8(v) : bits(v, d.width) }),
 el('td.mono', { text: d.width === 32 ? signed(v) : String(v) }), el('td.mono', { text: meaning(d.name, v, this.m.info) ?? '' }));
 });
 this.cycleBox.replaceChildren(
 el('p.sc-instr.mono', { text: this.loaded ? `${S.cycleLabel} ${this.model.cycle}: ${hex8(s.PC)}  ${text}` : this.m.noProgram }),
 el('ul.sc-rtn', {}, lines.map((l) => el('li', {}, el('span.mono', { text: l.rtn }), l.val ? el('br') : null,
 l.val ? el('span.mono.sc-val', { text: l.val }) : null))),
 el('table.listing.sc-signals', {}, el('caption', { text: S.signalsCaption }),
 el('thead', {}, el('tr', {}, [S.colSignal, S.colKind, S.colCode, S.colDecimal, S.colMeaning].map((t) => el('th', { text: t })))),
 el('tbody', {}, rows)),
 el('p.note', { text: S.fixedNote }));
 }
 mainTable(c, caption, keys) {
 const s = c.signals;
 const act = this.loaded ? c.rows.main : -1;
 const mark = (on) => (on ? '▶ ' : '');
 const head = el('tr', {}, [S.colClass, 'Op', ...keys, ...this.m.outputs].map((t) => el('th', { text: t })));
 const rows = this.m.main.map((r, i) => el(`tr${i === act ? '.sc-active' : ''}`, { 'aria-current': i === act ? 'true' : null },
 el('td', { text: `${mark(i === act)}${S.classes[r.cls]}` }), el('td.mono', { text: bits(r.Op, 2) }),
 keys.map((k) => el('td.mono', { text: r[k] === null ? '–' : String(r[k]) })),
 this.m.outputs.map((k) => el('td.mono', { text: bits(r[k], this.m.info[k].width) }))));
 return [
 el('p.note', { text: act >= 0 ? S.mainActive(S.classes[this.m.main[act].cls], bits(s.Op, 2), bits(s.Funct, 6)) : this.loaded ? S.mainNone : this.m.noProgram }),
 el('table.listing.sc-table', {}, el('caption', { text: caption }), el('thead', {}, head), el('tbody', {}, rows))];
 }
 renderControl(c) {
 const s = c.signals;
 const mark = (on) => (on ? '▶ ' : '');
 const any = (v, w) => (v === null ? '–' : bits(v, w));
 const aluAct = this.loaded && c.rows.main >= 0 ? c.rows.alu : -1;
 const aluHead = el('tr', {}, ['ALUOp', 'cmd', 'S', S.usedBy, 'ALUControl', 'FlagW'].map((t) => el('th', { text: t })));
 const aluRows = ALU_DECODER.map((r, i) => el(`tr${i === aluAct ? '.sc-active' : ''}`, { 'aria-current': i === aluAct ? 'true' : null },
 el('td.mono', { text: `${mark(i === aluAct)}${r.ALUOp}` }), el('td.mono', { text: any(r.cmd, 4) }), el('td.mono', { text: any(r.S, 1) }),
 el('td', { text: r.name ?? S.notDp }), el('td.mono', { text: bits(r.ALUControl, 2) }), el('td.mono', { text: bits(r.FlagW, 2) })));
 const eq = (t) => el('p.mono.sc-pcsel', { text: t });
 const fw = (k) => bits(s[k], 2);
 this.controlBox.replaceChildren(
 ...this.mainTable(c, S.mainCaption, ['Funct5', 'Funct0']),
 el('table.listing.sc-table', {}, el('caption', { text: S.aluCaption }), el('thead', {}, aluHead), el('tbody', {}, aluRows)),
 el('h3', { text: S.condCaption }),
 eq(`PCS = ((Rd == 15) AND RegW) OR Branch = ((${s.Rd} == 15) AND ${s.RegW}) OR ${s.Branch} = ${s.PCS}`),
 eq(`CondEx = ConditionCheck(Cond = ${bits(s.Cond, 4)}, NZCV = ${bits(s.Flags, 4)}) = ${s.CondEx}`),
 eq(`PCSrc = PCS AND CondEx = ${s.PCS} AND ${s.CondEx} = ${s.PCSrc}`),
 eq(`RegWrite = RegW AND CondEx = ${s.RegW} AND ${s.CondEx} = ${s.RegWrite}`),
 eq(`MemWrite = MemW AND CondEx = ${s.MemW} AND ${s.CondEx} = ${s.MemWrite}`),
 eq(`FlagWrite = FlagW AND CondEx = ${fw('FlagW')} AND {${s.CondEx}, ${s.CondEx}} = ${fw('FlagWrite')}`),
 el('p.note', { text: S.dontCareNote }));
 }
 renderControlExt(c) {
 const s = c.signals;
 const mark = (on) => (on ? '▶ ' : '');
 const any = (v, w) => (v === null ? '–' : bits(v, w));
 const aluAct = this.loaded && c.rows.main >= 0 ? c.rows.alu : -1;
 const aluHead = el('tr', {}, ['ALUOp', 'cmd', 'U', S.usedBy, 'ALUControl', 'FlagW', 'NoWrite'].map((t) => el('th', { text: t })));
 const aluRows = ALU_DECODER_EXT.map((r, i) => el(`tr${i === aluAct ? '.sc-active' : ''}`, { 'aria-current': i === aluAct ? 'true' : null },
 el('td.mono', { text: `${mark(i === aluAct)}${bits(r.ALUOp, 2)}` }), el('td.mono', { text: any(r.cmd, 4) }), el('td.mono', { text: any(r.U, 1) }),
 el('td', { text: r.name }), el('td.mono', { text: bits(r.ALUControl, 4) }), el('td.mono', { text: r.FlagW }), el('td.mono', { text: String(r.NoWrite) })));
 const eq = (t) => el('p.mono.sc-pcsel', { text: t });
 const fw = (k) => bits(s[k], 2);
 this.controlBox.replaceChildren(
 el('p.note', { text: X.badge }),
 ...this.mainTable(c, X.mainCaption, ['Funct5', 'Funct4', 'Funct2', 'Funct0']),
 el('table.listing.sc-table', {}, el('caption', { text: X.aluCaption }), el('thead', {}, aluHead), el('tbody', {}, aluRows)),
 el('h3', { text: X.condCaption }),
 eq(`PCS = ((Rd == 15) AND RegW) OR Branch = ((${s.Rd} == 15) AND ${s.RegW}) OR ${s.Branch} = ${s.PCS}`),
 eq(`CondEx = ConditionCheck(Cond = ${bits(s.Cond, 4)}, NZCV = ${bits(s.Flags, 4)}) = ${s.CondEx}`),
 eq(`PCSrc = PCS AND CondEx = ${s.PCS} AND ${s.CondEx} = ${s.PCSrc}; PCTarget = Branch ? ALUResult : Result`),
 eq(`RegWrite = RegW AND CondEx AND NOT NoWrite = ${s.RegW} AND ${s.CondEx} AND NOT ${s.NoWrite} = ${s.RegWrite}`),
 eq(`MemWrite = MemW AND CondEx = ${s.MemW} AND ${s.CondEx} = ${s.MemWrite}`),
 eq(`FlagWrite = FlagW AND CondEx = ${fw('FlagW')} AND {${s.CondEx}, ${s.CondEx}} = ${fw('FlagWrite')}`),
 eq(`ShiftCtl = (dpReg ? Instr11:5 : 0) = ${bits(s.ShiftCtl, 7)}; WA3 = Link ? 14 : Rd = ${s.WA3}`),
 el('p.note', { text: X.note }));
 }
 caption() { return `${this.m.label}, ${S.cycleLabel.toLowerCase()} ${this.model.cycle}`; }
 fileName(ext) { return `arm-single${this.mode === 'ext' ? '-extended' : ''}-cycle${this.model.cycle}.${ext}`; }
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
export function armSingleInstance(v, ctx) {
 for (const dp of Object.values(v.dps)) {
 dp.setLinks(v.targets, (id) => {
 const t = v.targets[id];
 ctx.openPanel?.(t.panel ? { panel: t.panel } : { tab: t.tab });
 }, S.elementNames);
 }
 const x = v.dps.ext;
 x.titleNode.id = 'dp-title-ext';
 x.descNode.id = 'dp-desc-ext';
 groupRole(x.svg, 'dp-title-ext', 'dp-desc-ext');
 return {
 root: v.root, title: S.panel, infoTitle: S.info, status: v.status, headerTools: v.headerTools,
 tabs: [[S.tabCycle, v.cycleBox], [S.tabControl, v.controlBox], [S.tabTiming, v.timingBox]],
 diagrams: Object.values(v.dps).map((d) => d.svg),
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
 return { pc: m.pc, instruction: m.pc, cycle: m.cycle, retired: m.cycle, halted: m.halted, error: m.error, dropped: m.dropped,
 registers: Object.fromEntries(REG_IDS.map((id) => [id, regs[id]])), changed,
 written: last?.mem ? { address: last.mem[0], size: 4 } : null };
 },
 stopMessage: (stop) => (stop === STOP.HALT && v.loaded ? S.halted(hex8(v.model.pc), v.model.cycle) : null),
 dataAccess: () => {
 if (!v.loaded || v.model.halted || v.model.error) return null;
 const c = v.model.evaluate();
 return c.signals.CondEx && c.access ? { address: c.signals.ALUResult >>> 0, size: c.access.size } : null;
 },
 memoryPort: () => (v.loaded ? v.model.dmem : null),
 exportModel: () => v.exportModel(),
 waveform: { defaults: ['PC', 'Instr', 'CondEx', 'RegWrite', 'MemWrite', 'PCSrc', 'ALUControl', 'ALUResult', 'Result'] },
 revision: () => v.mode,
 };
}
