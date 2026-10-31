// multi-view.js -- the multicycle view of Chapter 7 (spec §8.2, milestone
// M4): the datapath drawing with the paths of the current state, boxed with
// its name (WS-F-040), and its values (as WS-F-031); the controller: the state
// diagram with the current state and the transition taken, and the
// state-output table with the current column (WS-F-041); the registers
// between steps with what each holds and whether the next edge writes it
// (WS-F-042); the states of the last instructions over time (WS-F-043); the
// cycle narrative and a table of every signal, the text alternative of the
// drawing (WS-U-031); the chapter's step delays (tab:mc-steps); the chapter's
// figures as presets; export of the drawing (WS-U-004). The JALR state, the
// answer to an exercise, is shown only on request (author decision,
// 2026-10-26). Loaded on demand when its tab is first opened (WS-N-011).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8, download, menu, store } from '../../../ui/dom.js';
import { STRINGS } from '../../../ui/strings.js';
import { DatapathView, flowControl, flowOrder } from '../../../ui/datapath.js';
import { FsmView } from './fsm.js';
import { Multicycle } from '../../../uarch/multi.js';
import { multiPaths } from '../../../uarch/multi-paths.js';
import { withJalr, fetchJalr } from '../../../uarch/ch07-jalr.js';
import { MULTI_SIGNALS, MULTI_INFO, binary, meaning } from '../../../uarch/signals.js';
import { HALT_WORD, decodeMnemonic } from '../../../isa/encoding.js';
import { disassemble } from '../../../asm/disassembler.js';

const S = STRINGS.multi;
const STRIP_ROWS = 8; // instructions in the states-over-time table

// Where the value of each signal is written when all values are shown: a point of the
// drawing (cm, TikZ coordinates) in free space beside the connection, chosen by eye on the
// Chapter 7 geometry, or a connection whose longest segment takes the value. The values
// that pass straight on (rs1_val, rs2_val, src_a, src_b) are shown on hover only: the
// drawing has no free space beside them.
const VALUE_AT = {
  pc: { at: [1.2, 1.75], anchor: 'east' },
  addr: { at: [2.95, -0.83], anchor: 'center' }, // inside the memory, between its ports
  rdata: { at: [3.6, 0.78], anchor: 'south' },
  instr_pc: { at: [6.1, 2.27], anchor: 'north' }, // clear of the RegWrite label below
  ir: { at: [4.75, -0.15], anchor: 'north' },
  mdr: { at: [4.15, -1.75], anchor: 'north east' },
  rs1: { wire: 'f_rs1' }, rs2: { wire: 'f_rs2' }, rd: { wire: 'f_rd' },
  rs1_q: { at: [7.8, 1.5], anchor: 'south' },
  rs2_q: { at: [7.85, -1.0], anchor: 'north' },
  imm: { at: [7.2, -1.9], anchor: 'north west' },
  alu_y: { at: [11.0, -1.08], anchor: 'north' },
  alu_q: { at: [11.25, 0.33], anchor: 'south' },
  result: { at: [9.0, -3.08], anchor: 'north' },
};

/** Fetch the Chapter 7 drawing, the tables of Chapters 6 and 7 and the narrative templates from content/. */
export async function loadMultiContent(base) {
  const get = async (p) => {
    const r = await fetch(new URL(p, base));
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };
  const [geom0, t6, t70, n6, n7, x] = await Promise.all([
    get('content/geometry/ch07.json'), get('content/data/ch06-tables.json'), get('content/data/ch07-tables.json'),
    get('content/help/narrative-ch06.json'), get('content/help/narrative-ch07.json'), fetchJalr(base)]);
  const { geom, t7, jalrAvailable } = withJalr(geom0, t70, x);
  return { geom, t6, t7, n6, n7, jalrAvailable };
}

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const signed = (v) => String(v | 0).replace('-', '−');

export class MultiView {
  /**
   * @param {{geom, t6, t7, n6, n7}} content
   * @param {{onGoTo?: () => void, onStepInstr?: () => void, onBackInstr?: () => void}} opts callbacks of main.js
   */
  constructor({ geom, t6, t7, n6, n7, jalrAvailable = false }, { onGoTo = () => {}, onStepInstr = () => {}, onBackInstr = () => {} } = {}) {
    Object.assign(this, { geom, t6, t7, n6, n7, onGoTo });
    this.jalr = jalrAvailable && store.get('pips.multi.jalr') === '1';
    this.memsys = null;
    this.model = new Multicycle(t6, t7, { jalr: this.jalr });
    this.program = null;
    this.loaded = false;
    this.decimal = false;
    this.figure = '';
    this.paths = multiPaths(geom);
    this.flow = flowControl();
    this.flowCycle = -1;

    this.dp = new DatapathView(geom, { title: S.diagramTitle, description: geom.alt, valueAt: VALUE_AT, info: MULTI_INFO });
    this.fsm = new FsmView(geom.fsm, { title: S.fsmTitle, jalr: this.jalr });
    const check = (label, on, attrs = {}) => el('label.toggle', { title: attrs.title ?? null },
      el('input', { type: 'checkbox', checked: attrs.checked ?? false, onchange: (e) => on(e.target.checked) }), ` ${label}`);
    this.figSel = el('select', { 'aria-label': S.figure, onchange: (e) => { this.figure = e.target.value; this.render(); } },
      el('option', { value: '', text: S.figureNone }),
      Object.entries(geom.figures).map(([id, f]) => el('option', { value: id, text: f.concept })));
    this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
    this.headerTools = menu(STRINGS.pipe.display,
      this.flow.root,
      this.dp.marchToggle,
      check(STRINGS.single.showAll, (on) => this.dp.setShowAll(on)),
      check(STRINGS.single.decimal, (on) => { this.decimal = on; this.render(); }),
      el('button', { type: 'button', text: STRINGS.pipe.exportSvg, onclick: () => this.exportSvg() }),
      el('button', { type: 'button', text: STRINGS.pipe.exportPng, onclick: () => this.exportPng() }));
    this.jalrNote = el('p.note.mc-jalr', { text: S.jalrOn, hidden: !this.jalr });
    // The drawing area shows the datapath or the state diagram (WS-F-041); the state-output
    // table stays in the Controller tab, so that both can be seen at once.
    this.drawing = store.get('pips.multi.drawing') === 'fsm' ? 'fsm' : 'dp';
    this.drawButtons = [['dp', S.drawDatapath], ['fsm', S.drawFsm]].map(([id, text]) => el('button', {
      type: 'button', role: 'tab', text, 'aria-selected': String(this.drawing === id), onclick: () => this.setDrawing(id) }));
    this.root = el('div.col', {},
      el('div.panel-tools.mc-tools', {},
        el('span.tabs.mc-drawtabs', { role: 'tablist', 'aria-label': S.drawing }, this.drawButtons),
        el('button', { type: 'button', text: S.backInstr, title: S.backInstrTitle, onclick: onBackInstr }),
        el('button', { type: 'button', text: S.stepInstr, title: S.stepInstrTitle, 'aria-keyshortcuts': 'F11', onclick: onStepInstr }),
        el('label.toggle', {}, `${S.figure} `, this.figSel),
        jalrAvailable ? check(S.jalr, (on) => this.setJalr(on), { checked: this.jalr, title: S.jalrTitle }) : null),
      this.jalrNote,
      this.dp.root,
      this.fsm.root,
      el('p.note.pp-note', { text: S.fixedNote, title: S.fixedNote }));
    this.setDrawing(this.drawing);

    // What a click on an element of the drawing opens: a shared panel or an information tab.
    const cycle = { tab: S.tabCycle };
    const between = { tab: S.tabRegisters };
    this.targets = {
      pc: { panel: 'regs' }, rf: { panel: 'regs' }, mem: { tab: STRINGS.memory }, cu: { tab: S.tabFsm },
      ir: between, ipc: between, mdr: between, rs1q: between, rs2q: between, aq: between,
      am: cycle, sa: cycle, sb: cycle, rm: cycle, alu: cycle, imm: cycle,
    };
    this.fsmBox = el('div.scroll.mc-fsm');
    this.cycleBox = el('div.scroll.sc-cycle');
    this.regsBox = el('div.scroll.mc-regs');
    this.stripBox = el('div.scroll.mc-strip');
    this.timingBox = el('div.scroll.sc-timing');
  }

  /** Show the datapath ('dp') or the state diagram ('fsm') in the drawing area. */
  setDrawing(id) {
    this.drawing = id;
    store.set('pips.multi.drawing', id);
    this.drawButtons.forEach((b, i) => b.setAttribute('aria-selected', String(['dp', 'fsm'][i] === id)));
    this.dp.root.hidden = id !== 'dp';
    this.fsm.root.hidden = id !== 'fsm';
    this.figSel.parentElement.hidden = id !== 'dp';
  }

  /** Turn the reference JALR state on or off; the program restarts. */
  setJalr(on) {
    this.jalr = on;
    store.set('pips.multi.jalr', on ? '1' : '0');
    this.model = new Multicycle(this.t6, this.t7, { jalr: on, memsys: this.memsys });
    this.fsm.setJalr(on);
    this.jalrNote.hidden = !on;
    this.load(this.program);
    this.onGoTo();
  }

  /** Load an assembled program (null: nothing to run). */
  load(program) {
    this.program = program;
    this.model.load(program ?? { segments: [] });
    this.loaded = Boolean(program);
    this.flowCycle = -1;
    this.figure = '';
    this.figSel.value = '';
    this.render();
  }

  reset() { this.model.reset(); this.flowCycle = -1; this.render(); }

  /** Take another memory system (null: ideal memory, as the book's processor); the program restarts. */
  setMemsys(memsys) {
    this.memsys = memsys;
    this.model = new Multicycle(this.t6, this.t7, { jalr: this.jalr, memsys });
    this.load(this.program);
  }

  /** For the exports (core/exports.js): a fresh model with this view's options and program, its signals and RTL module. */
  exportModel() {
    const m = new Multicycle(this.t6, this.t7, { jalr: this.jalr, historyLimit: 0 });
    m.load(this.program ?? { segments: [] });
    return { model: m, signals: MULTI_SIGNALS, module: 'rv32i_multi', label: this.jalr ? 'ch07 + JALR' : 'ch07', retired: (x) => x.retired };
  }

  /** One clock cycle; returns 'step', 'halt' or 'error'. */
  step() {
    this.figure = '';
    this.figSel.value = '';
    return this.model.step();
  }

  back() { return this.model.back(); }

  /** The rest of this instruction (WS-F-040); returns as step(). */
  stepInstruction() {
    this.figure = '';
    this.figSel.value = '';
    return this.model.stepInstruction();
  }

  backInstruction() { return this.model.backInstruction(); }

  /** Move to cycle k (an earlier cycle, or a later one by running to it). */
  goTo(k) {
    const m = this.model;
    while (m.cycle > k && m.back());
    if (m.halted && m.cycle > k) m.back();
    while (m.cycle < k && m.step() === 'step');
    this.onGoTo();
  }

  /** Address where a breakpoint or run-to-cursor stops: the next FETCH's PC, or null mid-instruction. */
  breakAt() { return this.model.state === 'FETCH' ? this.model.pc : null; }

  // --- formatting ------------------------------------------------------------------------
  fmt(name, v) {
    const s = MULTI_INFO[name];
    if (s.width === 32) return this.decimal ? `${hex8(v)} (${signed(v)})` : hex8(v);
    if (name === 'state' || name === 'next') return meaning(name, v, MULTI_INFO);
    if (s.kind === 'control' || name === 'op' || name === 'funct3') return binary(v, s.width);
    return String(v);
  }

  tip(name, v) {
    const s = MULTI_INFO[name];
    const m = meaning(name, v, MULTI_INFO);
    if (s.width === 32) return `${name} = ${hex8(v)} = ${signed(v)}`;
    return `${name} = ${binary(v, s.width)}${s.width > 1 ? ` (${v})` : ''}${m ? ` → ${m}` : ''}`;
  }

  /** Assembly text of a word (x-numbers, as Chapter 7's worked examples). */
  text(w, pc) {
    if (w === HALT_WORD) return 'jal x0, 0';
    return decodeMnemonic(w) ? disassemble(w, pc, 'x') : hex8(w);
  }

  // --- rendering -------------------------------------------------------------------------
  render() {
    const m = this.model;
    const c = m.evaluate();
    const s = c.signals;
    const sigs = new Map();
    const ctls = new Map();
    for (const d of MULTI_SIGNALS) {
      const v = s[d.name];
      const tag = d.width === 32 ? (this.decimal ? signed(v) : (v >>> 0).toString(16).padStart(8, '0')) : null;
      const rec = { text: this.fmt(d.name, v), tag, tip: this.tip(d.name, v) };
      (d.kind === 'control' ? ctls : sigs).set(d.name, rec);
    }
    sigs.set('const4', { text: '4', tag: '4', tip: 'the constant 4' });
    this.dp.setValues(sigs, ctls);

    // The state: one badge on the control unit while a program runs; the book's boxed state names on
    // the paths only for a figure (FIG-0068, FIG-0069), where several states share the drawing.
    let tags = [];
    let badge = null;
    if (this.figure) {
      const f = this.geom.figures[this.figure];
      this.dp.setPath({ wires: new Set(f.highlight), elements: new Set(this.geom.elements.map((e) => e.id)) });
      tags = f.tags;
      this.dp.animate([], 0);
    } else if (this.loaded && !m.halted) {
      const p = this.paths(c.state, s);
      this.dp.setPath(p);
      badge = c.state;
      this.animate(p);
    } else {
      this.dp.setPath(null);
      this.dp.animate([], 0);
    }
    this.dp.setAnnotations([]);
    this.dp.setStateTags(tags);
    this.dp.setBadge('cu', badge);

    const addr = m.instrAddress;
    const word = c.state === 'FETCH' ? s.rdata : m.ir;
    const text = this.loaded ? this.text(word, addr) : '';
    this.status.textContent = this.figure ? `${this.figure}: ${this.geom.figures[this.figure].concept}`
      : S.status(m.cycle, c.state, m.halted || m.error ? null : c.next, hex8(addr), text, m.halted, m.error);
    const prev = m.last?.state ?? null;
    this.fsm.show(c.state, prev, m.halted || m.error ? null : c.next, S.fsmDesc(c.state, prev));
    const lines = this.narrate(c);
    this.dp.setDescription(`${this.geom.alt} ${STRINGS.single.thisCycle} (${m.cycle}, ${c.state}): ${text}. ${lines.map((l) => l.val ?? l.rtn).join(' ')}`);
    this.renderFsm(c);
    this.renderCycle(c, text, lines);
    this.renderRegisters(c);
    this.renderStrip();
    this.renderTiming(c);
  }

  /** Signal flow along the paths of the state, once per new cycle (WS-U-003). */
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
    if (c.halt) return [{ rtn: this.n7.halt }];
    const h = hex8;
    const op = this.t6.alu_ops.find((r) => parseInt(r.ALUCtrl, 2) === s.ALUCtrl)?.op;
    const expr = this.n6.alu_expr[op] ?? '{a} ? {b}';
    const a = this.n7.alu_a[c.state] ?? 'rs1_q';
    const b = this.n7.alu_b[c.state] ?? 'rs2_q';
    const vars = {
      pc: h(m.pc), rdata: h(s.rdata), pc_next: h(s.pc_next), rs1: s.rs1, rs2: s.rs2, rd: s.rd, rs1_val: h(s.rs1_val),
      rs2_val: h(s.rs2_val), instr_pc: h(m.instr_pc), imm: h(s.imm), imm_dec: signed(s.imm), alu_y: h(s.alu_y),
      rs1_q: h(m.rs1_q), rs2_q: h(m.rs2_q), alu_q: h(m.alu_q), mdr: h(m.mdr),
      alu_sym: fill(expr, { a, b }), alu_val: fill(expr, { a: h(s.src_a), b: h(s.src_b) }),
    };
    if (c.state === 'BRANCH') {
      const cond = this.n6.branch_cond[c.mnemonic] ?? '{a} ? {b}';
      vars.cond_sym = fill(cond, { a: 'rs1_q', b: 'rs2_q' });
      vars.cond_val = fill(cond, { a: h(m.rs1_q), b: h(m.rs2_q) });
    }
    const out = (this.n7.states[c.state] ?? []).map((t) => ({
      rtn: fill(t.rtn, vars),
      val: fill(t.val ?? (s.BranchTaken ? t.val_taken : t.val_not), vars),
    }));
    if (s.RegWrite && s.rd === 0) out.push({ rtn: this.n7.x0 });
    if (!m.error) out.push({ rtn: fill(this.n7.next, { next: c.next }) });
    return out;
  }

  renderFsm(c) {
    const t = this.t7.state_outputs;
    const cols = t.columns.filter((col) => this.jalr || !col.answer);
    const mark = (on) => (on ? '▶ ' : '');
    const cur = c.state;
    const head = el('tr', {}, el('th', { text: '' }), cols.map((col) => el(`th.mono${col.state === cur ? '.sc-active' : ''}`,
      { text: `${mark(col.state === cur)}${col.state}${col.selfstudy ? '*' : ''}`, 'aria-current': col.state === cur ? 'true' : null })));
    const body = t.signals.map((sg) => el('tr', {}, el('td.mono', { text: sg }), cols.map((col) =>
      el(`td.mono${col.state === cur ? '.sc-active' : ''}`, { text: col.values[sg] }))));
    const s = c.signals;
    const opHex = s.op.toString(16).toUpperCase().padStart(2, '0');
    this.fsmBox.replaceChildren(
      el('p.note', { text: S.outActive(cur) }),
      el('table.listing.sc-table.mc-out', {}, el('caption', { text: S.outCaption }), el('thead', {}, head), el('tbody', {}, body)),
      el('p.note', { text: `* Additional states for the remaining instructions. ${this.jalr ? S.jalrColumn : ''} ${S.outNote}` }),
      el('p.mono.sc-pcsel', { text: S.decoders(binary(s.ALUOp, 2), binary(s.ALUCtrl, 4), `0x${opHex}`, binary(s.ImmSel, 3)) }),
      el('p.mono.sc-pcsel', { text: S.pcen(s.PCWrite, s.Branch, s.BranchTaken, s.PCEn) }),
      el('p.note', { text: `${S.fsmWhere} ${S.fsmLegend} ${S.fsmDerived}` }));
  }

  renderCycle(c, text, lines) {
    const s = c.signals;
    const rows = MULTI_SIGNALS.map((d) => {
      const v = s[d.name];
      const mn = meaning(d.name, v, MULTI_INFO);
      return el('tr', {}, el('td.mono', { text: d.name }), el('td', { text: d.kind === 'control' ? STRINGS.single.kindControl : STRINGS.single.kindData }),
        el('td.mono', { text: d.width === 32 ? hex8(v) : binary(v, d.width) }),
        el('td.mono', { text: d.width === 32 ? signed(v) : String(v) }), el('td.mono', { text: mn ?? '' }));
    });
    const m = this.model;
    this.cycleBox.replaceChildren(
      el('p.sc-instr.mono', { text: this.loaded ? `${S.cycleLabel} ${m.cycle}, ${c.state}: ${hex8(m.instrAddress)}  ${text}` : S.noProgram }),
      el('ul.sc-rtn', {}, lines.map((l) => el('li', {}, el('span.mono', { text: l.rtn }), l.val ? el('br') : null,
        l.val ? el('span.mono.sc-val', { text: l.val }) : null))),
      el('table.listing.sc-signals', {}, el('caption', { text: S.signalsCaption }),
        el('thead', {}, el('tr', {}, [STRINGS.single.colSignal, STRINGS.single.colKind, STRINGS.single.colCode, STRINGS.single.colDecimal,
          STRINGS.single.colMeaning].map((x) => el('th', { text: x })))),
        el('tbody', {}, rows)),
      el('p.note', { text: S.fixedNote }));
  }

  renderRegisters(c) {
    const m = this.model;
    const s = c.signals;
    const why = new Map();
    for (const r of this.t7.registers) for (const name of r.register.split(', ')) why.set(name, r.why);
    const rows = [
      ['ir', m.ir, s.IRWrite, 'IRWrite', s.rdata], ['instr_pc', m.instr_pc, s.IRWrite, 'IRWrite', m.pc],
      ['rs1_q', m.rs1_q, 1, null, s.rs1_val], ['rs2_q', m.rs2_q, 1, null, s.rs2_val],
      ['alu_q', m.alu_q, 1, null, s.alu_y], ['mdr', m.mdr, 1, null, s.rdata],
    ].map(([name, now, en, sig, next]) => el(`tr${sig && en ? '.sc-active' : ''}`, {},
      el('td.mono', { text: name }), el('td.mono', { text: hex8(now) }),
      el('td', { text: sig ? (en ? S.yes(sig) : S.no(sig)) : S.always }),
      el('td.mono', { text: hex8(en ? next : now) }), el('td', { text: why.get(name) ?? '' })));
    const arch = [S.archPc(s.PCEn, hex8(s.pc_next)), S.archRf(s.RegWrite, s.rd, hex8(s.result)), S.archMem(s.MemWrite, hex8(s.addr), hex8(m.rs2_q))];
    this.regsBox.replaceChildren(
      el('table.listing.sc-table.mc-regtable', {}, el('caption', { text: S.regsCaption }),
        el('thead', {}, el('tr', {}, [S.colReg, S.colHolds, S.colEnable, S.colNext, S.colWhy].map((x) => el('th', { text: x })))),
        el('tbody', {}, rows)),
      el('p', { text: S.archCaption }),
      el('ul.sc-rtn', {}, arch.map((x) => el('li.mono', { text: x }))));
  }

  /** The states of the last instructions, one row each, cycles left to right (WS-F-043). */
  renderStrip() {
    const m = this.model;
    if (!this.loaded) { this.stripBox.replaceChildren(el('p.note', { text: S.noProgram })); return; }
    const first = m.cycle - m.history.length; // cycles before it were dropped from the history
    const cyc = [];
    for (let k = first; k <= m.cycle; k++) {
      const r = k < m.cycle ? m.history[k - first] : null;
      cyc.push({ k, state: r ? r.state : m.state, at: r ? r.at : m.instrAddress });
    }
    const groups = [];
    for (const x of cyc) {
      if (x.state === 'FETCH' || !groups.length) groups.push({ at: x.at, cells: [] });
      groups[groups.length - 1].cells.push(x);
    }
    const shown = groups.slice(-STRIP_ROWS);
    const k0 = shown[0].cells[0].k;
    const cols = [];
    for (let k = k0; k <= m.cycle; k++) cols.push(k);
    const wordAt = (g) => { // the instruction word: ir after its FETCH
      const kf = g.cells[0].k;
      if (kf === m.cycle) return m.evaluate().signals.rdata;
      if (kf + 1 === m.cycle) return m.ir;
      return m.history[kf + 1 - first]?.ir ?? 0;
    };
    const rows = shown.map((g, gi) => {
      const halt = m.halted && gi === shown.length - 1;
      const label = `${hex8(g.at).slice(-4)}  ${halt ? 'jal x0, 0' : this.text(wordAt(g), g.at)}`;
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
      el('p.note', { text: S.stripLegend }));
    const cur = this.stripBox.querySelector('thead th.pd-cur');
    if (cur) this.stripBox.scrollLeft = Math.max(0, cur.offsetLeft - this.stripBox.clientWidth / 2);
  }

  renderTiming(c) {
    const t = this.t7.timing;
    const max = Math.max(...t.steps.map((r) => r.ps));
    const setBy = t.steps.filter((r) => r.ps === max).map((r) => r.state);
    const m = this.model;
    const cpi = m.retired ? m.cycle / m.retired : 0;
    this.timingBox.replaceChildren(
      el('p.note', { text: S.illustrative }),
      el('table.listing.sc-table', {}, el('caption', { text: S.stepsCaption }),
        el('thead', {}, el('tr', {}, [S.colStep, S.colPath, S.colDelay].map((x) => el('th', { text: x })))),
        el('tbody', {}, t.steps.map((r) => el(`tr${setBy.includes(r.state) ? '.sc-active' : ''}${r.state === c.state ? '.sc-current' : ''}`, {},
          el('td.mono', { text: `${setBy.includes(r.state) ? '▲ ' : ''}${r.state === c.state ? '▶ ' : ''}${r.state}` }),
          el('td', { text: r.path }), el('td.mono', { text: `${r.ps} ps` }))))),
      t.steps.some((r) => r.state === c.state) ? null : el('p.note', { text: S.notInTable(c.state) }),
      el('p', { text: S.tc(t.tc, setBy.join(', ')) }),
      el('p', { text: S.cpiNow(m.retired, m.cycle, cpi.toFixed(3), ((m.cycle * t.tc) / 1000).toFixed(2)) }),
      el('table.listing.sc-table', {}, el('caption', { text: S.delayCaption }),
        el('tbody', {}, t.delays.map((d) => el('tr', {}, el('td', { text: d.element }), el('td.mono', { text: `${d.ps}` }))))));
  }

  // --- export (WS-U-004) -----------------------------------------------------------------
  caption() {
    return S.caption(this.jalr ? 'ch07 + JALR' : 'ch07', this.model.cycle);
  }

  exportSvg() {
    download(`ch07-cycle${this.model.cycle}.svg`, this.dp.exportSvg(this.caption()), 'image/svg+xml');
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
      cv.toBlob((b) => b && download(`ch07-cycle${this.model.cycle}.png`, b, 'image/png'));
    };
    img.src = url;
  }
}
