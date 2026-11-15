// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8, download, menu } from '../../../ui/dom.js';
import { STRINGS } from '../../../ui/strings.js';
import { DatapathView, flowControl, flowOrder } from '../../../ui/datapath.js';
import { SingleCycle } from '../../../uarch/single.js';
import { SINGLE_SIGNALS, SINGLE_EXT_SIGNALS, SIGNAL_INFO, binary, meaning } from '../../../uarch/signals.js';
import { activePath } from '../../../uarch/single-paths.js';
import { criticalPath, classTable, delayMap, PATH_CLASS } from '../../../uarch/timing.js';
import { disassemble } from '../../../asm/disassembler.js';
const S = STRINGS.single;
const VALUE_AT = {
 pc: { at: [2.3, -1.2], anchor: 'north west' },
 pc_plus4: { at: [0.55, 1.75], anchor: 'north' },
 pc_next: { at: [1.5, -0.72], anchor: 'north' },
 instr: { at: [3.2, 1.08], anchor: 'south' },
 rs1: { wire: 'ins_rs1' }, rs2: { wire: 'ins_rs2' }, rd: { wire: 'ins_rd' },
 rs1_val: { at: [7.3, 0.52], anchor: 'south' },
 rs2_val: { at: [8.4, -2.78], anchor: 'north' },
 imm: { at: [7.05, -2.42], anchor: 'west' },
 src_b: { at: [7.5, -0.12], anchor: 'south' },
 alu_y: { at: [10.4, 2.18], anchor: 'south' },
 rdata: { at: [10.62, 0.06], anchor: 'center' },
 result: { at: [8.4, -3.33], anchor: 'north' },
 pc_target: { at: [2.0, -3.84], anchor: 'north' },
};
export async function loadSingleContent(base) {
 const get = async (p) => {
 const r = await fetch(new URL(p, base));
 if (!r.ok) throw new Error(`${p}: ${r.status}`);
 return r.json();
 };
 const [geom, tables, delays, narrative] = await Promise.all([
 get('content/geometry/ch06.json'), get('content/data/ch06-tables.json'),
 get('content/data/ch06-delays.json'), get('content/help/narrative-ch06.json')]);
 return { geom, tables, delays, narrative };
}
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const signed = (v) => String(v | 0).replace('-', '−');
export class SingleView {
 constructor({ geom: bookGeom, tables, delays, narrative }, { extend = null } = {}) {
 const geom = extend ? extend.geom(bookGeom) : bookGeom;
 this.extend = extend;
 this.info = extend ? { ...SIGNAL_INFO, ...extend.info } : SIGNAL_INFO;
 Object.assign(this, { geom, tables, narrative });
 this.delayTable = delays;
 this.defaultDelays = delayMap(delays);
 this.delays = { ...this.defaultDelays };
 this.ext = false;
 this.memsys = null;
 this.model = new SingleCycle(tables);
 this.figure = '';
 this.critical = false;
 this.decimal = false;
 this.dp = new DatapathView(geom, { title: S.diagramTitle, description: geom.alt, valueAt: VALUE_AT, info: this.info });
 const check = (label, on) => el('label.toggle', {}, el('input', { type: 'checkbox', onchange: (e) => on(e.target.checked) }), ` ${label}`);
 this.figSel = el('select', { 'aria-label': S.figure, onchange: (e) => { this.figure = e.target.value; this.render(); } },
 el('option', { value: '', text: S.figureNone }),
 Object.entries(geom.figures).map(([id, f]) => el('option', { value: id, text: f.concept })));
 this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
 this.flow = flowControl();
 this.flowCycle = -1;
 this.headerTools = menu(STRINGS.pipe.display,
 this.flow.root,
 this.dp.marchToggle,
 check(S.showAll, (on) => this.dp.setShowAll(on)),
 check(S.decimal, (on) => { this.decimal = on; this.render(); }),
 el('button', { type: 'button', text: STRINGS.pipe.exportSvg, onclick: () => this.exportSvg() }),
 el('button', { type: 'button', text: STRINGS.pipe.exportPng, onclick: () => this.exportPng() }));
 this.root = el('div.col', {},
 el('div.panel-tools', {},
 check(S.criticalMode, (on) => { this.critical = on; this.render(); }),
 el('label.toggle', {}, `${S.figure} `, this.figSel)),
 this.dp.root);
 const cycle = { tab: S.tabCycle };
 this.targets = {
 pc: { panel: 'regs' }, rf: { panel: 'regs' }, imem: { tab: STRINGS.listing }, dm: { tab: S.tabMemory }, cu: { tab: S.tabControl },
 alu: cycle, bm: cycle, rm: cycle, pcm: cycle, tm: cycle, imm: cycle, add4: cycle, tadd: cycle,
 };
 this.cycleBox = el('div.scroll.sc-cycle');
 this.controlBox = el('div.scroll.sc-control');
 this.timingBox = el('div.scroll.sc-timing');
 }
 load(program, subset = null) {
 const ext = subset === 'ext';
 if (ext !== this.ext) {
 this.ext = ext;
 this.model = new SingleCycle(this.tables, { ext, memsys: this.memsys });
 }
 this.model.load(program ?? { segments: [] });
 this.loaded = Boolean(program);
 this.flowCycle = -1;
 this.figure = '';
 this.figSel.value = '';
 this.render();
 }
 reset() { this.model.reset(); this.flowCycle = -1; this.render(); }
 setMemsys(memsys) {
 const program = this.loaded ? this.model.program : null;
 this.memsys = memsys;
 this.model = new SingleCycle(this.tables, { ext: this.ext, memsys });
 this.load(program, this.ext ? 'ext' : null);
 }
 exportModel(memsys = null) {
 const m = new SingleCycle(this.tables, { ext: this.ext, historyLimit: 0, memsys });
 m.load(this.model.program);
 return { model: m, signals: this.ext ? [...SINGLE_SIGNALS, ...SINGLE_EXT_SIGNALS] : SINGLE_SIGNALS,
 module: 'rv32i_single', label: this.ext ? 'ch06 + xori/lbu' : 'ch06', retired: (x) => x.cycle };
 }
 step() {
 this.figure = '';
 this.figSel.value = '';
 return this.model.step();
 }
 back() { return this.model.back(); }
 fmt(name, v) {
 const s = SIGNAL_INFO[name];
 if (s.width === 32) return this.decimal ? `${hex8(v)} (${signed(v)})` : hex8(v);
 if (s.kind === 'control' || name === 'op' || name === 'funct3') return binary(v, s.width);
 return String(v);
 }
 tip(name, v) {
 const s = SIGNAL_INFO[name];
 const m = meaning(name, v);
 if (s.width === 32) return `${name} = ${hex8(v)} = ${signed(v)}`;
 return `${name} = ${binary(v, s.width)}${s.width > 1 ? ` (${v})` : ''}${m ? ` → ${m}` : ''}`;
 }
 render() {
 const m = this.model;
 const c = m.evaluate();
 const s = c.signals;
 const sigs = new Map();
 const ctls = new Map();
 for (const d of [...SINGLE_SIGNALS, ...(this.ext ? SINGLE_EXT_SIGNALS : [])]) {
 const v = s[d.name];
 const tag = d.width === 32 ? (this.decimal ? signed(v) : (v >>> 0).toString(16).padStart(8, '0')) : null;
 const rec = { text: this.fmt(d.name, v), tag, tip: this.tip(d.name, v) };
 (d.kind === 'control' ? ctls : sigs).set(d.name, rec);
 }
 if (this.extend) {
 for (const [name, v] of Object.entries(this.extend.values(s))) {
 const d = this.extend.info[name];
 const text = d.width === 32 ? hex8(v) : String(v);
 (d.kind === 'control' ? ctls : sigs).set(name, { text, tag: d.width === 32 ? (v >>> 0).toString(16).padStart(8, '0') : null, tip: `${name} = ${text}` });
 }
 }
 this.dp.setValues(sigs, ctls);
 const path = this.extend ? this.extend.path(s, activePath(s)) : activePath(s);
 let crit = null;
 let ann = [];
 if (this.figure) {
 const f = this.geom.figures[this.figure];
 this.dp.setPath({ wires: new Set(f.highlight), elements: new Set(this.geom.elements.map((e) => e.id)) });
 ann = this.figure === 'FIG-0012' ? f.arrivals.map((a) => ({ at: a.at, anchor: a.anchor, text: String(a.ps) })) : [];
 } else {
 if (this.critical && c.cls) {
 crit = criticalPath(this.delays, s).critical;
 ann = crit ? this.annotations(crit) : [];
 }
 this.dp.setPath(this.loaded ? path : null, crit ? new Set(crit.path.flatMap((p) => p.wires)) : null);
 this.animate(path, crit);
 }
 this.dp.setAnnotations(ann);
 const text = c.halt ? 'jal x0, 0' : c.mnemonic ? disassemble(s.instr, s.pc, 'x') : hex8(s.instr);
 this.status.textContent = this.figure ? `${this.figure}: ${this.geom.figures[this.figure].concept}`
 : S.status(m.cycle, hex8(s.pc), text, m.halted, m.error);
 const lines = this.narrate(c);
 this.dp.setDescription(`${this.geom.alt} ${S.thisCycle}: ${text}. ${lines.map((l) => l.val ?? l.rtn).join(' ')}`);
 this.renderCycle(c, text, lines);
 this.renderControl(c);
 this.renderTiming(c);
 }
 animate(path, crit) {
 const ms = this.flow.get();
 if (!this.loaded || crit || !ms) { this.dp.animate([], 0); return; }
 if (this.model.cycle === this.flowCycle) return;
 this.flowCycle = this.model.cycle;
 const xs = this.geom.wires.map((w) => w.points[0][0]);
 this.dp.animate(flowOrder(this.geom, [{ wires: path.wires, x0: Math.min(...xs), x1: Math.max(...xs) }]), ms);
 }
 annotations(crit) {
 const lw = this.geom.figures['FIG-0012'];
 const wires = [...new Set(crit.path.flatMap((p) => p.wires))].sort();
 const same = JSON.stringify(wires) === JSON.stringify(lw.highlight)
 && Object.keys(this.delays).every((k) => this.delays[k] === this.defaultDelays[k]);
 if (same) return lw.arrivals.map((a) => ({ at: a.at, anchor: a.anchor, text: String(a.ps) }));
 const out = [];
 const wire = (id) => this.geom.wires.find((w) => w.id === id);
 crit.path.forEach((p, i) => {
 const next = crit.path[i + 1];
 if (next?.wires.length) {
 const pts = wire(next.wires[0]).points;
 const [x0, y0] = pts[0];
 const [x1, y1] = pts[1];
 const len = Math.hypot(x1 - x0, y1 - y0) || 1;
 out.push({ at: [x0 + ((x1 - x0) / len) * 0.18, y0 + ((y1 - y0) / len) * 0.18], anchor: 'south west', text: String(p.t) });
 } else if (!next && p.wires.length) {
 const pts = wire(p.wires[p.wires.length - 1]).points;
 out.push({ at: pts[pts.length - 1], anchor: 'north west', text: `${p.t}` });
 }
 });
 return out;
 }
 narrate(c) {
 const n = this.narrative;
 const s = c.signals;
 if (!this.loaded) return [];
 if (c.halt) return [{ rtn: n.halt }];
 if (!c.cls) return [{ rtn: n.unknown }];
 const h = (v) => hex8(v);
 const op = this.dec(s.ALUCtrl);
 const a = { sym: 'R[rs1]', val: h(s.rs1_val) };
 const b = s.ALUSrc ? { sym: 'imm', val: h(s.imm) } : { sym: 'R[rs2]', val: h(s.rs2_val) };
 const expr = n.alu_expr[op] ?? '{a} ? {b}';
 const vars = {
 rd: s.rd, rs1: s.rs1, rs2: s.rs2, imm: h(s.imm), imm_dec: signed(s.imm), rs1_val: h(s.rs1_val), rs2_val: h(s.rs2_val),
 alu_y: h(s.alu_y), result: h(s.result), pc: h(s.pc), pc_plus4: h(s.pc_plus4), pc_target: h(s.pc_target),
 alu_sym: fill(expr, { a: a.sym, b: b.sym }), alu_val: fill(expr, { a: a.val, b: b.val }), byte: s.alu_y & 3,
 };
 let cls = c.cls;
 if (cls === 'lw' && this.ext && s.funct3 === 0b100) cls = 'lbu';
 const out = [];
 for (const t of n.classes[cls] ?? []) {
 if (cls === 'branch') {
 const mn = c.mnemonic;
 const cond = n.branch_cond[mn] ?? '{a} ? {b}';
 vars.cond_sym = fill(cond, { a: 'R[rs1]', b: 'R[rs2]' });
 vars.cond_val = fill(cond, { a: h(s.rs1_val), b: h(s.rs2_val) });
 out.push({ rtn: fill(t.rtn, vars), val: fill(s.BranchTaken ? t.val_taken : t.val_not, vars) });
 } else {
 out.push({ rtn: fill(t.rtn, vars), val: fill(t.val, vars) });
 }
 }
 if (!s.Branch && !s.Jump) out.push({ rtn: n.next_pc.rtn, val: fill(n.next_pc.val, vars) });
 if (s.RegWrite && s.rd === 0) out.push({ rtn: n.x0 });
 return out;
 }
 dec(ALUCtrl) {
 return this.tables.alu_ops.find((r) => parseInt(r.ALUCtrl, 2) === ALUCtrl)?.op ?? null;
 }
 renderCycle(c, text, lines) {
 const s = c.signals;
 const rows = [...SINGLE_SIGNALS, ...(this.ext ? SINGLE_EXT_SIGNALS : [])].map((d) => {
 const v = s[d.name];
 const m = meaning(d.name, v);
 return el('tr', {}, el('td.mono', { text: d.name }), el('td', { text: d.kind === 'control' ? S.kindControl : S.kindData }),
 el('td.mono', { text: d.width === 32 ? hex8(v) : binary(v, d.width) }),
 el('td.mono', { text: d.width === 32 ? signed(v) : String(v) }), el('td.mono', { text: m ?? '' }));
 });
 this.cycleBox.replaceChildren(
 el('p.sc-instr.mono', { text: this.loaded ? `${S.cycleLabel} ${this.model.cycle}: ${hex8(s.pc)}  ${text}` : S.noProgram }),
 el('ul.sc-rtn', {}, lines.map((l) => el('li', {}, el('span.mono', { text: l.rtn }), l.val ? el('br') : null,
 l.val ? el('span.mono.sc-val', { text: l.val }) : null))),
 el('table.listing.sc-signals', {}, el('caption', { text: S.signalsCaption }),
 el('thead', {}, el('tr', {}, [S.colSignal, S.colKind, S.colCode, S.colDecimal, S.colMeaning].map((t) => el('th', { text: t })))),
 el('tbody', {}, rows)),
 el('p.note', { text: S.fixedNote }));
 }
 renderControl(c) {
 const t = this.tables;
 const md = t.main_decoder;
 const act = c.rows.main;
 const mark = (on) => (on ? '▶ ' : '');
 const head = el('tr', {}, el('th', { text: '' }), md.columns.map((col, i) =>
 el(`th${i === act ? '.sc-active' : ''}`, { text: `${mark(i === act)}${col.class}`, 'aria-current': i === act ? 'true' : null })));
 const op = el('tr', {}, el('td.mono', { text: 'op' }), md.columns.map((col, i) =>
 el(`td.mono${i === act ? '.sc-active' : ''}`, { text: col.op.toString(16).toUpperCase().padStart(2, '0') })));
 const body = md.signals.map((sg) => el('tr', {}, el('td.mono', { text: sg }), md.columns.map((col, i) =>
 el(`td.mono${i === act ? '.sc-active' : ''}`, { text: col.values[sg] }))));
 const aluHead = el('tr', {}, ['ALUOp', 'op5', 'funct3', 'funct7b5', 'ALUCtrl', S.usedBy].map((x) => el('th', { text: x })));
 const aluRows = t.alu_decoder.map((r, i) => el(`tr${i === c.rows.alu ? '.sc-active' : ''}`, { 'aria-current': i === c.rows.alu ? 'true' : null },
 el('td.mono', { text: `${mark(i === c.rows.alu)}${r.ALUOp}` }), el('td.mono', { text: r.op5 }), el('td.mono', { text: r.funct3 }),
 el('td.mono', { text: r.funct7b5 }), el('td.mono', { text: r.ALUCtrl }), el('td', { text: r.used_by })));
 const brRows = t.branch_cond.map((r, i) => el(`tr${i === c.rows.branch ? '.sc-active' : ''}`, { 'aria-current': i === c.rows.branch ? 'true' : null },
 el('td.mono', { text: `${mark(i === c.rows.branch)}${r.funct3}` }), el('td.mono', { text: r.instr }), el('td.mono', { text: r.BranchTaken })));
 const s = c.signals;
 this.controlBox.replaceChildren(
 el('p.note', { text: act >= 0 ? S.mainActive(md.columns[act].class, s.op.toString(16).toUpperCase().padStart(2, '0')) : S.mainDefault }),
 el('table.listing.sc-table', {}, el('caption', { text: S.mainCaption }), el('thead', {}, head), el('tbody', {}, op, body)),
 el('table.listing.sc-table', {}, el('caption', { text: S.aluCaption }), el('thead', {}, aluHead), el('tbody', {}, aluRows)),
 el('table.listing.sc-table', {}, el('caption', { text: S.branchCaption }),
 el('thead', {}, el('tr', {}, ['funct3', S.instruction, 'BranchTaken'].map((x) => el('th', { text: x })))), el('tbody', {}, brRows)),
 el('p.mono.sc-pcsel', { text: `PCSel = Jump | (Branch & BranchTaken) = ${s.Jump} | (${s.Branch} & ${s.BranchTaken}) = ${s.PCSel}` }),
 el('p.note', { text: S.dontCareNote }));
 }
 renderTiming(c) {
 const t = classTable(this.delays, this.tables);
 const cur = c.cls && !c.halt ? criticalPath(this.delays, c.signals).critical : null;
 const inputs = this.delayList().map((d) => el('tr', {}, el('td', { text: d.element }), el('td', {},
 el('input.mono', { type: 'number', min: 0, step: 1, value: this.delays[d.key], 'aria-label': d.element, style: 'width:5rem',
 onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= 0) { this.delays[d.key] = v; this.render(); } } })),
 el('td.note', { text: this.delays[d.key] === this.defaultDelays[d.key] ? '' : S.changedFrom(this.defaultDelays[d.key]) })));
 const nodeName = (n) => S.nodes[n] ?? n;
 this.timingBox.replaceChildren(
 el('p.note', { text: S.illustrative }),
 cur ? el('div', {}, el('p', { text: S.currentPath(cur.delay, S.ends[cur.end]) }),
 el('ol.sc-path', {}, cur.path.map((p) => el('li', {}, `${nodeName(p.node)}: `, el('span.mono', { text: `${p.t} ps` })))))
 : el('p.note', { text: S.noPath }),
 el('table.listing.sc-table', {}, el('caption', { text: S.classCaption }),
 el('thead', {}, el('tr', {}, [S.colClass, S.colPath, S.colDelay].map((x) => el('th', { text: x })))),
 el('tbody', {}, t.rows.map((r) => el(`tr${t.setBy.includes(r.cls) ? '.sc-active' : ''}${r.cls === c.cls ? '.sc-current' : ''}`, {},
 el('td', { text: `${t.setBy.includes(r.cls) ? '▲ ' : ''}${r.cls === c.cls ? '▶ ' : ''}${r.label}` }),
 el('td', { text: r.path.filter((p) => p.node !== 'ALUCtrl').map((p) => nodeName(p.node)).join(', ') }),
 el('td.mono', { text: `${r.delay} ps` }))))),
 el('p', { text: S.tc(t.tc, t.setBy.map((k) => PATH_CLASS[k]).join(', '), (1e3 / t.tc).toFixed(2)) }),
 el('table.listing.sc-table', {}, el('caption', { text: S.delayCaption }), el('tbody', {}, inputs)),
 el('button', { type: 'button', text: S.resetDelays, onclick: () => { this.delays = { ...this.defaultDelays }; this.render(); } }));
 }
 delayList() {
 return this.delayTable.delays;
 }
 caption() {
 return S.caption(this.ext ? 'ch06 + ext' : 'ch06', this.model.cycle);
 }
 exportSvg() {
 download(`ch06-cycle${this.model.cycle}.svg`, this.dp.exportSvg(this.caption()), 'image/svg+xml');
 }
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
 cv.toBlob((b) => b && download(`ch06-cycle${this.model.cycle}.png`, b, 'image/png'));
 };
 img.src = url;
 }
}
