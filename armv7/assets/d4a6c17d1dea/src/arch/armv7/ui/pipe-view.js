// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8, download, menu, store } from '../../../ui/dom.js';
import { DatapathView, flowControl, flowOrder, groupRole } from '../../../ui/datapath.js';
import { STOP } from '../../contract.js';
import { ArmPipe, HAZARD_MODES } from '../uarch/pipe.js';
import { ArmPipeExt } from '../uarch/pipe-ext.js';
import { pipePaths } from '../uarch/pipe-paths.js';
import { stageNarrative } from '../uarch/pipe-narrative.js';
import { STAGES, STOP_EVENTS, CAUSES, pipeEvents, hazardSummary, cpiParts, diagramRows, foldRows, foldColumns } from '../uarch/pipe-summary.js';
import { PIPE_SIGNALS, PIPE_INFO, PIPE_EXT_SIGNALS, PIPE_EXT_INFO, binary, meaning } from '../uarch/signals.js';
import { pipeTiming, PIPE_DELAY_KEYS, PIPE_EXT_DELAY_KEYS } from '../uarch/pipe-timing.js';
import { ArmSingle, MAIN_DECODER, MAIN_OUTPUTS } from '../uarch/single.js';
import { ArmSingleExt, MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT } from '../uarch/single-ext.js';
import { ArmMulti } from '../uarch/multi.js';
import { ArmMultiExt } from '../uarch/multi-ext.js';
import { classTable, delayMap } from '../uarch/timing.js';
import { stateTable } from '../uarch/multi-timing.js';
import { disassemble } from '../language.js';
import { ARMV7_STRINGS } from '../strings.js';
const S = ARMV7_STRINGS.pipeView;
const X = S.ext;
const SV = ARMV7_STRINGS.singleView;
const REG_IDS = [...Array.from({ length: 16 }, (_, i) => `r${i}`), 'N', 'Z', 'C', 'V'];
const WINDOW = 20;
const KEY = 'pips.armv7.pipe.';
const signed = (v) => String(v | 0).replace('-', '−');
const bits = (v, w) => binary(v, w);
const short = (v) => (v >>> 0 < 0x10000 ? `0x${v.toString(16).padStart(4, '0')}` : hex8(v));
const put = (box, ...kids) => box.replaceChildren(...kids.filter((k) => k !== null && k !== undefined && k !== false));
const fix = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const VALUE_AT = {
 PCF: { wire: 'pc_imem' }, InstrF: { wire: 'imem_fd' }, PCPlus4F: { wire: 'pc4_pcm' }, PCPlus8D: { wire: 'pc8_rf' },
 RD1D: { wire: 'rd1_de' }, RD2D: { wire: 'rd2_de' }, ExtImmD: { wire: 'ext_de' }, SrcAE: { wire: 'fam_alu' },
 WriteDataE: { wire: 'wd_em' }, ALUResultE: { wire: 'alu_em' }, ALUOutM: { wire: 'aom_mw' }, ReadDataM: { wire: 'dm_mw' },
 ResultW: { wire: 'res_a' },
};
const REGISTERS = [
 ['IF/ID', 'D', ['InstrD']],
 ['ID/EX', 'E', ['RD1E', 'RD2E', 'ExtImmE', 'WA3E', 'RA1E', 'RA2E', 'CondE', 'PCSrcE', 'RegWriteE', 'MemtoRegE', 'MemWriteE', 'ALUControlE',
 'BranchE', 'ALUSrcE', 'FlagWriteE']],
 ['EX/MEM', 'M', ['ALUOutM', 'WriteDataM', 'WA3M', 'PCSrcM', 'RegWriteM', 'MemtoRegM', 'MemWriteM']],
 ['MEM/WB', 'W', ['ALUOutW', 'ReadDataW', 'WA3W', 'PCSrcW', 'RegWriteW', 'MemtoRegW']],
];
const REGISTERS_EXT = REGISTERS.map(([name, st, fields]) => [name, st, [...fields.map((f) => f.replace('MemtoReg', 'ResultSrc')),
 ...{ D: ['PCPlus4D'], E: ['NoWriteE', 'ShiftCtlE', 'PCPlus4E'], M: ['PCPlus4M'], W: ['PCPlus4W'] }[st]]]);
const MODES = {
 base: { Model: ArmPipe, signals: PIPE_SIGNALS, info: PIPE_INFO, registers: REGISTERS, keys: PIPE_DELAY_KEYS, title: S.diagramTitle,
 label: S.label, noProgram: S.noProgram, module: 'arm_pipe' },
 ext: { Model: ArmPipeExt, signals: PIPE_EXT_SIGNALS, info: PIPE_EXT_INFO, registers: REGISTERS_EXT, keys: PIPE_EXT_DELAY_KEYS,
 title: X.diagramTitle, label: X.label, noProgram: X.noProgram, module: 'arm_pipe_ext' },
};
const WAVE_SIGNALS = Object.freeze([...PIPE_EXT_SIGNALS, ...PIPE_SIGNALS.filter((s) => !PIPE_EXT_INFO[s.name])]);
const padded = (Model) => class extends Model {
 evaluate() {
 const c = super.evaluate();
 for (const d of WAVE_SIGNALS) if (!(d.name in c.signals)) c.signals[d.name] = 0;
 return c;
 }
};
const HAZARD_SIGNALS = new Set(['Match_1E_M', 'Match_1E_W', 'Match_2E_M', 'Match_2E_W', 'Match_12D_E', 'ForwardAE', 'ForwardBE', 'LDRstall',
 'PCWrPendingF', 'StallF', 'StallFTextbook', 'StallD', 'FlushD', 'FlushE']);
const FIELDS = new Set(['Cond', 'Op', 'Funct', 'Rn', 'Rd', 'Rm', 'Imm24', 'Instr11:5']);
export function stageOf(name) {
 if (HAZARD_SIGNALS.has(name)) return 'hazard';
 if (FIELDS.has(name)) return 'ID';
 if (name === 'PCNext' || name === 'PCMuxF') return 'IF';
 if (name === 'ALUFlags') return 'EX';
 if (name === 'ALUOutW1:0') return 'WB';
 return { F: 'IF', D: 'ID', E: 'EX', M: 'MEM', W: 'WB' }[name.at(-1)] ?? 'EX';
}
export async function loadArmPipeContent(base) {
 const get = async (p) => {
 const r = await fetch(new URL(p, base));
 if (!r.ok) throw new Error(`${p}: ${r.status}`);
 return r.json();
 };
 const [geom, geomExt, delays] = await Promise.all([get('content/armv7/geometry/pipe.json'), get('content/armv7/geometry/pipe-extended.json'),
 get('content/armv7/data/single-delays.json')]);
 return { geom, geomExt, delays };
}
function runAll(program, ext) {
 const one = (m, retired) => {
 m.load(program);
 let r;
 try { r = m.run(50_000); } catch (e) { return { error: e.message }; }
 return r === 'halt' ? { instructions: retired(m), cycles: m.cycle } : { error: m.error };
 };
 return {
 single: one(new (ext ? ArmSingleExt : ArmSingle)({ historyLimit: 0 }), (m) => m.cycle),
 multi: one(new (ext ? ArmMultiExt : ArmMulti)({ historyLimit: 0 }), (m) => m.retired),
 pipe: one(new (ext ? ArmPipeExt : ArmPipe)({ historyLimit: 0 }), (m) => m.stats.retired + 1),
 };
}
export class ArmPipeView {
 constructor({ geom, geomExt, delays }, { onGoTo = () => {} } = {}) {
 this.geoms = { base: geom, ext: geomExt };
 this.delayTable = delays;
 this.defaultDelays = delayMap(delays);
 this.delays = { ...this.defaultDelays };
 this.runs = null;
 this.onGoTo = onGoTo;
 const saved = store.get(`${KEY}hazard`);
 this.options = { hazard: HAZARD_MODES.includes(saved) ? saved : 'full' };
 this.program = null;
 this.loaded = false;
 this.decimal = false;
 this.flowCycle = -1;
 this.diagStart = null;
 this.fold = store.get(`${KEY}fold`) === '1';
 this.stopOn = new Set((store.get(`${KEY}stop`) ?? '').split(',').filter((k) => STOP_EVENTS.includes(k)));
 this.summary = null;
 this.dps = Object.fromEntries(Object.entries(this.geoms).map(([k, g]) => {
 const x = (id) => g.elements.find((e) => e.id === id).at[0];
 return [k, new DatapathView(g, { title: MODES[k].title, description: g.alt, valueAt: VALUE_AT, labelBounds: true, info: MODES[k].info,
 bands: [['fd', 'de'], ['em', 'mw']].map(([a, b]) => ({ left: x(a), right: x(b) })) })];
 }));
 this.dps.ext.titleNode.id = 'dp-title-pipe-ext';
 this.dps.ext.descNode.id = 'dp-desc-pipe-ext';
 this.showAll = false;
 const check = (label, on) => el('label.toggle', {}, el('input', { type: 'checkbox', onchange: (e) => on(e.target.checked) }), ` ${label}`);
 this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
 this.badge = el('p.note', { text: X.badge, hidden: true });
 this.flow = flowControl();
 this.headerTools = menu(SV.display,
 this.flow.root,
 this.dps.base.marchToggle,
 this.dps.ext.marchToggle,
 check(SV.showAll, (on) => { this.showAll = on; this.dp.setShowAll(on); }),
 check(SV.decimal, (on) => { this.decimal = on; this.render(); }),
 el('button', { type: 'button', text: SV.exportSvg, onclick: () => this.exportSvg() }),
 el('button', { type: 'button', text: SV.exportPng, onclick: () => this.exportPng() }));
 this.hazardSel = el('select', { 'aria-label': S.hazard, onchange: (e) => this.applyOptions({ hazard: e.target.value }) },
 HAZARD_MODES.map((v) => el('option', { value: v, text: S.hazards[v], selected: v === this.options.hazard })));
 const stopBox = (k) => el('label.toggle', {}, el('input', { type: 'checkbox', checked: this.stopOn.has(k), onchange: (e) => {
 if (e.target.checked) this.stopOn.add(k); else this.stopOn.delete(k);
 store.set(`${KEY}stop`, [...this.stopOn].join(','));
 this.showStopCount();
 } }), ` ${S.stopEvents[k]}`);
 this.stopMenu = menu(S.stopOn, el('p.note', { text: S.stopOnTitle }), ...STOP_EVENTS.map(stopBox));
 this.stopMenu.title = S.stopOnTitle;
 this.showStopCount();
 this.strip = el('div.pp-strip', { role: 'group', 'aria-label': S.stripLabel });
 this.hint = el('p.note.sc-hint', { role: 'note' });
 this.root = el('div.col', {},
 el('div.panel-tools.pp-tools', {}, el('label.toggle', { title: S.hazardTitle }, `${S.hazard} `, this.hazardSel), this.stopMenu),
 this.badge, this.hint, this.strip, this.dps.base.root, this.dps.ext.root,
 el('p.note.pp-note', { text: S.fixedNote, title: S.fixedNote }));
 const regs = { tab: S.tabRegisters };
 const hz = { tab: S.tabHazards };
 const sig = { tab: S.tabSignals };
 this.targets = {
 pc: { panel: 'registers' }, rf: { panel: 'registers' }, flags: { panel: 'registers' }, dm: { panel: 'memory' },
 fd: regs, de: regs, de_c: regs, em: regs, em_c: regs, mw: regs, mw_c: regs,
 hz, fam: hz, fbm: hz, cond: hz, g_pcsrc: hz, g_regw: hz, g_memw: hz, g_branch: hz,
 pcm: sig, brm: sig, add4: sig, imem: sig, cu: sig, ra1m: sig, ra2m: sig, ext: sig, bm: sig, alu: sig, rm: sig,
 fd_p: regs, a3m: sig, sh: sig, byte: sig, nw_bub: hz,
 };
 this.diagramBox = el('div.scroll.pp-diagram');
 this.stagesBox = el('div.scroll.pp-stages');
 this.hazardsBox = el('div.scroll.pp-hazards');
 this.summaryBox = el('div.scroll.pp-summary');
 this.registersBox = el('div.scroll.pp-registers');
 this.signalsBox = el('div.scroll.pp-signals');
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
 for (const [k, d] of Object.entries(this.dps)) { d.root.hidden = k !== mode; d.marchToggle.hidden = k !== mode; }
 this.dp.setShowAll(this.showAll);
 this.badge.hidden = !this.ext;
 this.model = new this.m.Model({ hazard: this.options.hazard });
 this.runs = null;
 }
 showStopCount() {
 this.stopMenu.querySelector('summary').textContent = this.stopOn.size ? `${S.stopOn} (${this.stopOn.size})` : S.stopOn;
 }
 applyOptions(o) {
 if (o?.hazard && HAZARD_MODES.includes(o.hazard)) {
 this.options.hazard = o.hazard;
 store.set(`${KEY}hazard`, o.hazard);
 this.hazardSel.value = o.hazard;
 }
 this.model = new this.m.Model({ hazard: this.options.hazard });
 this.load(this.program);
 this.onGoTo();
 }
 load(program) {
 this.setMode(program?.subset === 'extended' ? 'ext' : 'base');
 this.program = program;
 this.model.load(program ?? { segments: [] });
 this.loaded = Boolean(program);
 this.diagStart = null;
 this.flowCycle = -1;
 this.summary = null;
 this.render();
 }
 reset() { this.model.reset(); this.diagStart = null; this.flowCycle = -1; this.summary = null; this.render(); }
 step() { this.diagStart = null; return this.model.step(); }
 back() { this.diagStart = null; return this.model.back(); }
 goTo(k) {
 const m = this.model;
 while (m.cycle > k && m.back());
 if (m.halted && m.cycle > k) m.back();
 while (m.cycle < k && m.step() === 'step');
 this.onGoTo();
 }
 stopReason() {
 if (!this.stopOn.size || !this.loaded || this.model.halted || this.model.error) return null;
 const c = this.model.evaluate();
 const e = pipeEvents(c);
 const kind = STOP_EVENTS.find((k) => e[k] && this.stopOn.has(k));
 if (!kind) return null;
 const at = kind === 'stall' ? (c.signals.LDRstall ? c.seq.ID : c.seq.IF) : c.seq.EX;
 return S.stoppedOn(S.stopWhat[kind], this.model.cycle, this.name(at));
 }
 exportModel() {
 const m = new (padded(this.m.Model))({ hazard: this.options.hazard, historyLimit: 0 });
 m.load(this.program ?? { segments: [] });
 return { model: m, signals: WAVE_SIGNALS, module: this.m.module, label: `${this.m.label}, ${S.hazards[this.options.hazard]}`, retired: (x) => x.stats.retired };
 }
 fmt(name, v) {
 const d = this.m.info[name];
 if (d.width === 32) return this.decimal ? `${hex8(v)} (${signed(v)})` : hex8(v);
 if (d.kind === 'control' || ['Cond', 'Op', 'Funct', 'ALUFlags', 'FlagsE', 'FlagsNextE'].includes(name)) return bits(v, d.width);
 return String(v);
 }
 tip(name, v) {
 const d = this.m.info[name];
 const m = meaning(name, v, this.m.info);
 if (d.width === 32) return `${name} = ${hex8(v)} = ${signed(v)}`;
 return `${name} = ${bits(v, d.width)}${d.width > 1 ? ` (${v})` : ''}${m ? ` → ${m}` : ''}`;
 }
 describe(seq) {
 const i = seq ? this.model.instance(seq) : null;
 if (!i) return { label: S.bubble, pc: null, bubble: true, wrong: false };
 if (i.kind === 'bubble') return { label: S.bubble, pc: null, bubble: true, loadUse: true, wrong: false };
 if (i.noCode) return { label: S.empty, pc: i.pc, bubble: true, wrong: i.wrongPath };
 return { label: disassemble(i.instr, i.pc), pc: i.pc, bubble: false, wrong: i.wrongPath };
 }
 name(seq) {
 const d = this.describe(seq);
 return d.bubble ? S.bubble : `${d.label} (${hex8(d.pc)})`;
 }
 occupant(c, st) { return c.live[st] ? c.seq[st] : 0; }
 render() {
 const m = this.model;
 const c = m.evaluate();
 const s = c.signals;
 const sigs = new Map();
 const ctls = new Map();
 for (const d of this.m.signals) {
 const v = s[d.name];
 const tag = d.width === 32 ? (this.decimal ? signed(v) : (v >>> 0).toString(16).padStart(8, '0')) : null;
 const rec = { text: this.fmt(d.name, v), tag, tip: this.tip(d.name, v) };
 sigs.set(d.name, rec);
 if (d.kind === 'control') ctls.set(d.name, rec);
 }
 sigs.set('const15', { text: '15', tag: null, tip: 'the constant 15' });
 ctls.set('Match_1E_M,Match_1E_W,Match_2E_M,Match_2E_W,Match_12D_E', { text: [s.Match_1E_M, s.Match_1E_W, s.Match_2E_M, s.Match_2E_W, s.Match_12D_E].join(''),
 tag: null, tip: `Match_1E_M ${s.Match_1E_M}, Match_1E_W ${s.Match_1E_W}, Match_2E_M ${s.Match_2E_M}, Match_2E_W ${s.Match_2E_W}, Match_12D_E ${s.Match_12D_E}` });
 this.dp.setValues(sigs, ctls);
 const live = this.loaded && !m.halted && !m.error;
 const paths = pipePaths(c, this.ext);
 this.dp.setPath(live ? paths : null);
 this.animate(live ? paths : null);
 const marks = [];
 const notes = [];
 if (live) {
 if (s.StallF) marks.push({ id: 'pc', kind: 'hold', text: S.stallMark });
 if (s.StallD) marks.push({ id: 'fd', kind: 'hold', text: S.stallMark });
 else if (s.FlushD) marks.push({ id: 'fd', kind: 'clear', text: S.flushMark });
 if (this.ext && (s.StallD || s.FlushD)) marks.push({ id: 'fd_p', kind: s.StallD ? 'hold' : 'clear', text: '' });
 if (s.FlushE) marks.push({ id: 'de', kind: 'clear', text: S.flushMark });
 const e = c.live.EX;
 if (e && !s.CondExE && (s.PCSrcE || s.RegWriteE || s.MemWriteE || s.BranchE || s.FlagWriteE)) {
 for (const id of ['g_pcsrc', 'g_regw', 'g_memw', 'g_branch']) marks.push({ id, kind: 'hold', text: '' });
 const g = this.geom.elements.find((x) => x.id === 'g_pcsrc').at;
 notes.push({ at: [g[0] - 0.2, g[1] + 0.35], anchor: 'south east', text: S.failedMark });
 }
 const pc = this.geom.elements.find((x) => x.id === 'pc').at;
 if (c.corrected) notes.push({ at: [pc[0] - 0.4, pc[1] + 1.55], anchor: 'south', text: S.correctedMark });
 if (c.unneeded) {
 const fd = this.geom.elements.find((x) => x.id === 'fd').at;
 notes.push({ at: [fd[0], fd[1] - 1.85], anchor: 'north', text: S.unneededMark });
 }
 }
 this.dp.setMarks(marks);
 this.dp.setAnnotations(notes);
 this.status.textContent = S.status(m.cycle, hex8(m.pc), m.halted, m.error);
 this.hint.hidden = this.loaded;
 this.hint.textContent = this.loaded ? '' : this.m.noProgram;
 this.renderStrip(c);
 const summary = STAGES.map((st) => `${st}: ${this.loaded ? this.name(this.occupant(c, st)) : S.empty}`).join('; ');
 this.dp.setDescription(`${this.geom.alt} ${SV.thisCycle} (${m.cycle}): ${summary}.`);
 this.renderDiagram();
 this.renderStages(c);
 this.renderHazards(c);
 this.renderSummary();
 this.renderRegisters(c);
 this.renderSignals(c);
 this.renderTiming();
 }
 renderTiming() {
 const t = pipeTiming(this.delays, this.ext);
 const name = (d) => d.element;
 const ns = (ps) => (ps / 1000).toFixed(2);
 const inputs = this.delayTable.delays.filter((d) => this.m.keys.includes(d.key)).map((d) => el('tr', {},
 el('td', { text: name(d) }),
 el('td', {}, el('input.mono', { type: 'number', min: 0, step: 1, value: this.delays[d.key], 'aria-label': name(d), style: 'width:5rem',
 onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) { this.delays[d.key] = v; this.renderTiming(); } } })),
 el('td.note', { text: this.delays[d.key] === this.defaultDelays[d.key] ? '' : S.changedFrom(this.defaultDelays[d.key]) })));
 let compare = el('p.note', { text: S.compareNone });
 if (this.loaded) {
 if (this.runs?.program !== this.program) this.runs = { program: this.program, result: runAll(this.program, this.ext) };
 const r = this.runs.result;
 const tcs = { single: this.ext ? classTable(this.delays, MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT, true).tc : classTable(this.delays, MAIN_DECODER, MAIN_OUTPUTS).tc,
 multi: stateTable(this.delays, this.ext).tc, pipe: t.tc };
 const failed = Object.values(r).find((x) => x.error);
 compare = failed ? el('p.note', { text: S.compareFailed(failed.error) }) : el('table.listing.sc-table', {}, el('caption', { text: S.compareCaption }),
 el('thead', {}, el('tr', {}, [S.colProcessor, S.colInstructions, S.colCycles2, S.colTc, S.colTime].map((x) => el('th', { text: x })))),
 el('tbody', {}, ['single', 'multi', 'pipe'].map((k) => el('tr', {}, el('td', { text: S.processors[k] }),
 el('td.mono', { text: String(r[k].instructions) }), el('td.mono', { text: `${r[k].cycles} (CPI ${(r[k].cycles / r[k].instructions).toFixed(2)})` }),
 el('td.mono', { text: `${tcs[k]} ps` }), el('td.mono', { text: `${ns(r[k].cycles * tcs[k])} ns` })))));
 }
 this.timingBox.replaceChildren(
 el('p.note', { text: S.illustrative }),
 el('table.listing.sc-table', {}, el('caption', { text: S.stageCaption }),
 el('thead', {}, el('tr', {}, [S.colStage, S.colEnd, S.colPath, S.colDelay].map((x) => el('th', { text: x })))),
 el('tbody', {}, t.rows.map((r) => {
 const top = r.delay === t.tc;
 return el(`tr${top ? '.sc-active' : ''}`, {},
 el('td.mono', { text: `${top ? '▲ ' : ''}${r.stage}` }),
 el('td', { text: `${r.end}${r.half ? ` ${S.halfNote}` : ''}` }),
 el('td', { text: r.path.map((p) => `${p.node} ${p.t}`).join(' → ') }),
 el('td.mono', { text: `${r.delay} ps` }));
 }))),
 el('p.note', { text: S.eqNote }),
 this.ext ? el('p.note', { text: X.timingNote }) : null,
 el('p', { text: S.tc(t.tc, t.setBy.join(', '), (1e3 / t.tc).toFixed(2)) }),
 compare,
 el('table.listing.sc-table', {}, el('caption', { text: S.delayCaption }), el('tbody', {}, inputs)),
 el('button', { type: 'button', text: S.resetDelays, onclick: () => { this.delays = { ...this.defaultDelays }; this.renderTiming(); } }));
 }
 animate(paths) {
 const ms = this.flow.get();
 if (!paths || !ms) { this.dp.animate([], 0); return; }
 if (this.model.cycle === this.flowCycle) return;
 this.flowCycle = this.model.cycle;
 const x = (id) => this.geom.elements.find((e) => e.id === id);
 const east = (id) => x(id).at[0] + x(id).size[0] / 2;
 const xs = this.geom.wires.flatMap((w) => w.points.map((p) => p[0]));
 const st = paths.stages;
 const groups = [
 { wires: st.IF, x0: Math.min(...xs), x1: x('fd').at[0] }, { wires: st.ID, x0: east('fd'), x1: x('de').at[0] },
 { wires: st.EX, x0: east('de'), x1: x('em').at[0] }, { wires: st.MEM, x0: east('em'), x1: x('mw').at[0] },
 { wires: st.WB, x0: east('mw'), x1: Math.max(...xs) }, { wires: st.fwd, x0: 0, x1: 1 },
 ];
 this.dp.animate(flowOrder(this.geom, groups, new Set(['aom_fwd', 'res_up'])), ms);
 }
 renderStrip(c) {
 const s = c.signals;
 const held = { IF: s.StallF, ID: s.StallD };
 const gone = { IF: s.FlushD && !s.StallD && !s.StallF, ID: s.FlushE && !s.StallD };
 const failed = { EX: c.live.EX && !s.CondExE };
 put(this.strip, ...STAGES.map((st) => {
 const d = this.loaded ? this.describe(this.occupant(c, st)) : { label: S.empty, pc: null, bubble: true };
 const flags = [held[st] ? `‖ ${S.held}` : null, gone[st] && !d.bubble ? `✕ ${S.flushed}` : null, d.wrong ? `! ${S.wrongPath}` : null,
 failed[st] && !d.bubble ? S.failed : null].filter(Boolean);
 return el(`div.pp-stage${d.bubble ? '.pp-bubble' : ''}${gone[st] && !d.bubble ? '.pp-flushed' : ''}${held[st] ? '.pp-held' : ''}`, {},
 el('span.pp-stage-head', {}, el('b', { text: S.stages[st] }), ' ',
 el('span.mono.pp-stage-pc', { text: d.pc === null || d.bubble ? '' : short(d.pc), title: d.pc === null ? null : hex8(d.pc) }), ' ',
 flags.length ? el('span.pp-stage-flags', { text: flags.join(' · ') }) : null),
 el('span.mono.pp-stage-instr', { text: d.bubble && this.loaded ? `○ ${S.bubble}` : d.label }));
 }));
 }
 renderDiagram() {
 const m = this.model;
 if (!this.loaded) { put(this.diagramBox, el('p.note', { text: S.noProgram })); return; }
 const last = Math.max(m.cycle, m.trace.length - 1);
 let items;
 let cols;
 if (this.fold) {
 items = foldRows(diagramRows(m, 0, last));
 cols = foldColumns(items, 0, last);
 } else cols = Array.from({ length: last + 1 }, (_, k) => k);
 const at = (col) => (typeof col === 'number' ? col : col.gap[1]);
 const curIdx = Math.max(0, cols.findIndex((col) => at(col) >= m.cycle));
 let i0 = this.diagStart ?? Math.max(0, Math.min(cols.length - 1, curIdx + 4) - WINDOW + 1);
 i0 = Math.max(0, Math.min(i0, Math.max(0, cols.length - WINDOW)));
 const shown = cols.slice(i0, i0 + WINDOW);
 const lo = typeof shown[0] === 'number' ? shown[0] : shown[0].gap[0];
 const hi = at(shown[shown.length - 1]);
 if (!this.fold) items = diagramRows(m, lo, hi).map((row) => ({ kind: 'row', row }));
 const inWindow = (row) => row.cells.some(([k]) => k >= lo && k <= hi);
 const rows = items.filter((it) => (it.kind === 'row' ? inWindow(it.row) && !(it.row.bubble && !it.row.loadUse) : it.from <= hi && it.to >= lo)).map((it) => {
 if (it.kind === 'fold') {
 return el('tr.pd-foldrow', {}, el('th.mono', { scope: 'row', text: S.foldRow(it.count, it.from, it.to) }),
 shown.map((col) => (typeof col === 'number' ? el('td', {}) : el('td.pd-gap.mono', { text: col.gap[0] <= it.to && col.gap[1] >= it.from ? S.foldCell(it.count) : '' }))));
 }
 const r = it.row;
 const label = r.loadUse ? S.bubbleRow : `${r.wrong ? '! ' : ''}${hex8(r.pc).slice(-4)}  ${disassemble(r.instr, r.pc)}`;
 const byCycle = new Map(r.cells);
 const cells = shown.map((col) => {
 if (typeof col !== 'number') return el('td.pd-gap', {});
 const code = byCycle.get(col);
 if (!code) return el(`td${col === m.cycle ? '.pd-cur' : ''}`, {});
 const st = code.replace(/[‖✕○]$/, '');
 const mark = code.slice(st.length);
 const [what, cls] = { '‖': [S.held, '.pd-stall'], '✕': [S.flushed, '.pd-flush'], '○': [S.bubble, '.pd-bubble'] }[mark] ?? ['', ''];
 return el(`td.pd-cell${cls}${col === m.cycle ? '.pd-cur' : ''}${col > m.cycle ? '.pd-future' : ''}`, {},
 el('button', { type: 'button', text: `${S.stages[st]}${mark}`, title: S.cellTitle(st, col, what),
 'aria-label': `${S.cellTitle(st, col, what)}. ${S.goToCycle(col)}`, onclick: () => this.goTo(col) }));
 });
 return el(`tr${r.loadUse ? '.pd-bubblerow' : ''}${r.wrong ? '.pd-wrong' : ''}`, {}, el('th.mono', { scope: 'row', text: label }), cells);
 });
 const head = el('tr', {}, el('th', { text: S.colInstr }), shown.map((col) => (typeof col === 'number'
 ? el(`th.mono${col === m.cycle ? '.pd-cur' : ''}`, { text: String(col) })
 : el('th.mono.pd-gap', { text: S.gapHead(col.gap[0], col.gap[1]), title: S.gapTitle(col.gap[0], col.gap[1]) }))));
 const foldBox = el('label.toggle', { title: S.foldTitle }, el('input', { type: 'checkbox', checked: this.fold, onchange: (e) => {
 this.fold = e.target.checked;
 store.set(`${KEY}fold`, this.fold ? '1' : '0');
 this.diagStart = null;
 this.renderDiagram();
 } }), ` ${S.fold}`);
 const nav = el('div.panel-tools', {},
 el('button', { type: 'button', text: S.earlier, disabled: i0 === 0, onclick: () => { this.diagStart = Math.max(0, i0 - WINDOW / 2); this.renderDiagram(); } }),
 el('button', { type: 'button', text: S.later, disabled: i0 + WINDOW >= cols.length, onclick: () => { this.diagStart = i0 + WINDOW / 2; this.renderDiagram(); } }),
 foldBox);
 put(this.diagramBox, nav,
 this.fold && !items.some((it) => it.kind === 'fold') ? el('p.note', { text: S.foldNone }) : null,
 el('table.listing.pd-table', {}, el('caption', { text: S.diagramCaption }), el('thead', {}, head), el('tbody', {}, rows)),
 el('p.note', { text: S.legend }));
 const cur = this.diagramBox.querySelector('thead th.pd-cur');
 if (cur && this.diagStart === null) this.diagramBox.scrollLeft = Math.max(0, cur.offsetLeft - this.diagramBox.clientWidth / 2);
 }
 renderHazards(c) {
 const s = c.signals;
 const m = this.model;
 const lines = [];
 if (this.loaded && !m.halted) {
 const ex = this.name(this.occupant(c, 'EX'));
 const operand = (r) => (r === 15 ? 'R15' : `R${r}`);
 if (s.ForwardAE) lines.push(S.fwd('ForwardAE', bits(s.ForwardAE, 2), `SrcAE (${operand(s.RA1E)})`, ex, s.ForwardAE === 2 ? 'MEM' : 'WB', this.name(s.ForwardAE === 2 ? c.seq.MEM : c.seq.WB)));
 if (s.ForwardBE) lines.push(S.fwd('ForwardBE', bits(s.ForwardBE, 2), `WriteDataE (${operand(s.RA2E)})`, ex, s.ForwardBE === 2 ? 'MEM' : 'WB', this.name(s.ForwardBE === 2 ? c.seq.MEM : c.seq.WB)));
 if (s.LDRstall && !c.unneeded) lines.push(S.loadUse(ex, s.WA3E, this.name(c.seq.ID)));
 if (s.LDRstall && c.unneeded) lines.push(S.loadUseUnneeded(ex, s.WA3E, this.name(c.seq.ID), c.clsE === 'str' ? S.unneededWhy.store : S.unneededWhy.field));
 if (c.ldrStall && !s.LDRstall && this.model.access(c.clsE)?.kind === 'load') lines.push(S.loadUseMissed(ex, s.WA3E, this.name(c.seq.ID)));
 if (s.PCWrPendingF && s.StallF) {
 const st = s.PCSrcD ? 'ID' : s.PCSrcE ? 'EX' : 'MEM';
 lines.push(S.pcWait(this.name(this.occupant(c, st)), st));
 }
 if (s.PCSrcW) lines.push(S.pcWrite(this.name(c.seq.WB), hex8(s.ResultW)));
 if (c.live.EX && s.BranchE) lines.push(s.BranchTakenE ? S.taken(ex, hex8(s.ALUResultE)) : S.notTaken(ex));
 else if (c.live.EX && !s.CondExE && (s.RegWriteE || s.MemWriteE || s.PCSrcE)) lines.push(S.condFailed(ex));
 if (c.corrected) lines.push(S.corrected);
 for (const x of c.stale) lines.push(S.stale(ex, x.reg, hex8(x.got), hex8(x.want)));
 }
 const eq = (name, text) => el('tr', {}, el('td.mono', { text: name }), el('td.mono', { text }), el('td.mono', { text: bits(s[name], this.m.info[name].width) }));
 const rows = [
 eq('Match_1E_M', `RA1E (${s.RA1E}) == WA3M (${s.WA3M})`), eq('Match_1E_W', `RA1E (${s.RA1E}) == WA3W (${s.WA3W})`),
 eq('Match_2E_M', `RA2E (${s.RA2E}) == WA3M (${s.WA3M})`), eq('Match_2E_W', `RA2E (${s.RA2E}) == WA3W (${s.WA3W})`),
 eq('ForwardAE', `10 if Match_1E_M AND RegWriteM (${s.RegWriteM}); 01 if Match_1E_W AND RegWriteW (${s.RegWriteW}); else 00`),
 eq('ForwardBE', '10 if Match_2E_M AND RegWriteM; 01 if Match_2E_W AND RegWriteW; else 00'),
 eq('Match_12D_E', `RA1D (${s.RA1D}) == WA3E (${s.WA3E}) OR RA2D (${s.RA2D}) == WA3E`),
 this.ext ? eq('LDRstall', `Match_12D_E AND (ResultSrcE = 01 or 10) (ResultSrcE = ${bits(s.ResultSrcE, 2)}) (A4-Q7)`)
 : eq('LDRstall', `Match_12D_E AND MemtoRegE (${s.MemtoRegE})`),
 eq('PCWrPendingF', `PCSrcD (${s.PCSrcD}) OR PCSrcE (${s.PCSrcE}) OR PCSrcM (${s.PCSrcM})`),
 eq('StallFTextbook', 'LDRstall OR PCWrPendingF (p. 440)'),
 eq('StallF', `(LDRstall OR PCWrPendingF) AND NOT BranchTakenE (${s.BranchTakenE}) (A4-Q2)`),
 eq('StallD', 'LDRstall'),
 eq('FlushE', 'LDRstall OR BranchTakenE'),
 eq('FlushD', `PCWrPendingF OR PCSrcW (${s.PCSrcW}) OR BranchTakenE`),
 ];
 const st = m.stats;
 put(this.hazardsBox,
 el('p.note', { text: S.modeNote(S.hazardLong[this.options.hazard]) }),
 el('h3', { text: S.reasonsCaption }),
 lines.length ? el('ul.pp-reasons', {}, lines.map((t) => el('li', { text: t }))) : el('p', { text: this.loaded ? S.nothing : S.noProgram }),
 el('table.listing.sc-table', {}, el('caption', { text: S.unitCaption }),
 el('thead', {}, el('tr', {}, [S.colSignal, S.colEquation, S.colValue].map((t) => el('th', { text: t })))), el('tbody', {}, rows)),
 this.options.hazard !== 'full' && st.wrongPath ? el('p', { text: S.wrong(st.wrongPath) }) : null);
 }
 renderSummary() {
 const m = this.model;
 if (!this.loaded) { put(this.summaryBox, el('p.note', { text: S.noProgram })); return; }
 if (this.summary?.model === m && this.summary.cycle === m.cycle) return;
 this.summary = { model: m, cycle: m.cycle };
 const { rows, totals } = hazardSummary(m);
 const instr = (x) => (x.instr ? `${disassemble(x.instr, x.pc)} (${hex8(x.pc)})` : S.bubble);
 const links = (cycles) => [...cycles.slice(0, 6).map((k) => el('button.link-btn.mono', { type: 'button', text: String(k), title: S.goToCycle(k), onclick: () => this.goTo(k) })),
 cycles.length > 6 ? el('span.note', { text: ` ${S.moreCycles(cycles.length - 6)}` }) : null];
 const head = (...t) => el('thead', {}, el('tr', {}, t.map((x) => el('th', { text: x }))));
 const cp = cpiParts(m);
 put(this.summaryBox,
 el('p.note', { text: S.modeNote(S.hazardLong[this.options.hazard]) }),
 el('table.listing.sc-table', {}, el('caption', { text: S.summaryTotals }), head(S.colCause, S.colEvents, S.colLost),
 el('tbody', {}, CAUSES.map((k) => el('tr', {}, el('td', { text: S.causes[k] }), el('td.mono', { text: String(totals[k].events) }),
 el('td.mono', { text: String(totals[k].lost) }))))),
 cp ? el('table.listing.sc-table', {}, el('caption', { text: S.cpiCaption }),
 el('tbody', {}, [...cp.parts.map((x) => el('tr', {}, el('td', { text: S.cpiParts[x.key] }), el('td.mono', { text: fix(x.value) }))),
 el('tr', {}, el('td', { text: S.cpiModel }), el('td.mono', { text: fix(cp.model) }))])) : el('p.note', { text: S.notYet }),
 cp ? el('p', { text: S.cpiMeasured(m.cycle, cp.n, fix(cp.measured), fix(cp.fill)) }) : null,
 cp ? el('p', { text: S.cpiMix(cp.f.loads, cp.f.loadUse, cp.f.branches, cp.f.taken) }) : null,
 this.options.hazard !== 'full' ? el('p.note', { text: S.incomplete }) : null,
 rows.length ? el('table.listing.sc-table.pp-sumtable', {}, el('caption', { text: S.summaryCaption(m.cycle) }),
 head(S.colCause, S.colInstrs, S.colEvents, S.colLost, S.colCycles),
 el('tbody', {}, rows.map((r) => el('tr', {}, el('td', { text: S.causes[r.cause] }),
 el('td.mono', { text: r.b ? S.pair(instr(r.a), instr(r.b)) : instr(r.a) }),
 el('td.mono', { text: String(r.count) }), el('td.mono', { text: String(r.lost) }), el('td', {}, links(r.cycles))))))
 : el('p', { text: S.summaryNone }),
 el('p.note', { text: S.summaryNote }));
 }
 renderRegisters(c) {
 const s = c.signals;
 const m = this.model;
 const status = { 'IF/ID': s.StallD ? 'hold' : s.FlushD ? 'clear' : null, 'ID/EX': s.FlushE ? 'clear' : null };
 const row = (name) => {
 const v = s[name];
 const d = this.m.info[name];
 const mm = meaning(name, v, this.m.info);
 const extra = name === 'InstrD' ? `  ${c.live.ID ? disassemble(v, m.D.at) : S.bubble}` : mm ? `  → ${mm}` : '';
 return el('tr', {}, el('td.mono', { text: name }), el('td.mono', { text: `${d.width === 32 ? hex8(v) : bits(v, d.width)}${extra}` }));
 };
 put(this.registersBox,
 el('p.mono', { text: S.pcLine(hex8(s.PCF), s.StallF) }),
 ...this.m.registers.map(([name, stage, fields]) => {
 const st = { D: 'ID', E: 'EX', M: 'MEM', W: 'WB' }[stage];
 return el('table.listing.sc-table.pp-reg', {},
 el('caption', { text: `${S.regCaption(name)}: ${this.loaded ? this.name(this.occupant(c, st)) : S.empty}${status[name] ? ` · ${S.regStatus[status[name]]}` : ''}` }),
 el('thead', {}, el('tr', {}, el('th', { text: S.colField }), el('th', { text: S.colValueNow }))),
 el('tbody', {}, c.live[st] ? fields.map(row) : [el('tr', {}, el('td', { colspan: 2, text: S.regBubble }))]));
 }),
 el('p.mono', { text: `FlagsE (NZCV) = ${bits(s.FlagsE, 4)}; Flags′ = ${bits(s.FlagsNextE, 4)}` }),
 el('p.note', { text: S.regNote }));
 }
 renderStages(c) {
 if (!this.loaded) { put(this.stagesBox, el('p.note', { text: this.m.noProgram })); return; }
 const who = (st) => this.name(this.occupant(c, st));
 put(this.stagesBox, el('p.note', { text: S.stagesNote }),
 ...stageNarrative(c, { ext: this.ext, name: who }).map((x) => el('section.pp-stage', {},
 el('h4', { text: S.stageHead(x.stage, x.who) }),
 el('ul.sc-rtn', {}, x.lines.map((l) => el('li', {}, el('span.mono', { text: l.rtn }), l.val ? el('br') : null,
 l.val ? el('span.mono.note', { text: l.val }) : null))))));
 }
 renderSignals(c) {
 const s = c.signals;
 const rows = [];
 for (const g of [...STAGES, 'hazard']) {
 rows.push(el('tr.pp-group', {}, el('th', { colspan: 4, scope: 'rowgroup', text: g === 'hazard' ? S.hazardStage : g })));
 for (const d of this.m.signals.filter((x) => stageOf(x.name) === g)) {
 const v = s[d.name];
 rows.push(el('tr', {}, el('td.mono', { text: d.name }), el('td.mono', { text: d.width === 32 ? hex8(v) : bits(v, d.width) }),
 el('td.mono', { text: d.width === 32 ? signed(v) : String(v) }), el('td.mono', { text: meaning(d.name, v, this.m.info) ?? '' })));
 }
 }
 put(this.signalsBox, el('p.note', { text: S.fixedNote }), el('table.listing.sc-signals', {}, el('caption', { text: S.signalsCaption }),
 el('thead', {}, el('tr', {}, [SV.colSignal, SV.colCode, SV.colDecimal, SV.colMeaning].map((t) => el('th', { text: t })))),
 el('tbody', {}, rows)));
 }
 caption() { return `${this.m.label} (${S.hazards[this.options.hazard]}), ${SV.cycleLabel.toLowerCase()} ${this.model.cycle}`; }
 fileName(ext) { return `arm-pipe${this.ext ? '-extended' : ''}-${this.options.hazard}-cycle${this.model.cycle}.${ext}`; }
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
export function armPipeInstance(v, ctx) {
 for (const dp of Object.values(v.dps)) {
 dp.setLinks(v.targets, (id) => {
 const t = v.targets[id];
 ctx.openPanel?.(t.panel ? { panel: t.panel } : { tab: t.tab });
 }, S.elementNames);
 }
 groupRole(v.dps.ext.svg, 'dp-title-pipe-ext', 'dp-desc-pipe-ext');
 return {
 root: v.root, title: S.panel, infoTitle: S.info, status: v.status, headerTools: v.headerTools,
 tabs: [[S.tabDiagram, v.diagramBox], [S.tabStages, v.stagesBox], [S.tabHazards, v.hazardsBox], [S.tabSummary, v.summaryBox], [S.tabRegisters, v.registersBox],
 [S.tabSignals, v.signalsBox], [S.tabTiming, v.timingBox]],
 diagrams: [v.dps.base.svg, v.dps.ext.svg],
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
 if (last) ['N', 'Z', 'C', 'V'].forEach((f) => { if (last.F[f] !== regs[f]) changed.push(f); });
 return { pc: m.pc, cycle: m.cycle, retired: m.stats.retired, halted: m.halted, error: m.error, dropped: m.dropped,
 registers: Object.fromEntries(REG_IDS.map((id) => [id, regs[id]])), changed,
 written: last?.mem ? { address: last.mem[0], size: 4 } : null };
 },
 stopMessage: (stop) => {
 if (stop !== STOP.HALT || !v.loaded) return null;
 const m = v.model;
 const n = m.stats.retired + 1;
 return S.halted(hex8(m.W.at), m.cycle, n, (m.cycle / n).toFixed(3));
 },
 counters: () => {
 const st = v.model.stats;
 return [[S.counters.stalls, st.loadUse + st.pcWait], [S.counters.flushed, st.flushed], [S.counters.taken, st.taken]];
 },
 event: () => v.stopReason(),
 dataAccess: () => {
 if (!v.loaded || v.model.halted || v.model.error) return null;
 const s = v.model.evaluate().signals;
 return s.MemWriteM || (s.MemtoRegM && s.RegWriteM) ? { address: s.ALUOutM >>> 0, size: 4 } : null;
 },
 memoryPort: () => (v.loaded ? v.model.dmem : null),
 exportModel: () => v.exportModel(),
 waveform: { defaults: ['PCF', 'InstrD', 'StallF', 'StallD', 'FlushD', 'FlushE', 'ForwardAE', 'ForwardBE', 'BranchTakenE', 'ALUResultE', 'ResultW'] },
 options: { get: () => ({ ...v.options }), apply: (o) => v.applyOptions(o) },
 revision: () => `${v.options.hazard}|${v.mode}`,
 };
}
