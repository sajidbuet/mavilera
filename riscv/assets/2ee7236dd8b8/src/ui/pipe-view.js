// pipe-view.js -- the pipelined view of Chapter 8 (spec §8.3, milestone M3):
// the instruction in each stage, with bubbles, stalls and flushes marked
// (WS-F-050); the datapath drawing with the paths each stage uses, the
// forwarding feeds and selects, and the registers that are held or cleared
// (WS-F-052); the pipeline registers' contents (WS-F-051); the hazard
// reasons in words and the laboratory-stage switches (WS-F-052, WS-F-054);
// the predictor and its table (WS-F-055); the pipeline diagram, built live,
// whose cells move the view to their cycle (WS-F-053); the CPI breakdown
// (WS-F-056); the permanent Hazard3 note (WS-F-058); every signal as a table,
// the text alternative of the drawing (WS-U-031); export (WS-U-004). M5b: a
// run stops on a stall, flush or misprediction (WS-F-091); the run summary of
// lost cycles by cause (WS-F-140); folded loop iterations in the diagram
// (WS-F-141); prediction statistics and the CPI bar (WS-F-142). Loaded on
// demand when its tab is first opened (WS-N-011).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8, download, store, menu } from './dom.js';
import { STRINGS } from './strings.js';
import { DatapathView, flowControl, flowOrder } from './datapath.js';
import { Pipeline, HAZARD_MODES, PREDICTORS } from '../uarch/pipe.js';
import { pipePaths } from '../uarch/pipe-paths.js';
import { PIPE_SIGNALS, PIPE_EXT_SIGNALS, SIGNAL_INFO, binary, meaning } from '../uarch/signals.js';
import { HALT_WORD, decodeMnemonic } from '../isa/encoding.js';
import { disassemble } from '../asm/disassembler.js';
import { STAGES, STOP_EVENTS, pipeEvents, hazardSummary, predictionStats, cpiParts, diagramRows, foldRows, foldColumns } from '../uarch/pipe-summary.js';

const S = STRINGS.pipe;
const WINDOW = 20; // cycles in the pipeline diagram
const ENTRIES = [2, 4, 8, 16, 32, 64];

// Where each value goes when all values are shown: the longest segment of a connection.
const VALUE_AT = {
  pc_if: { wire: 'pc_r1' }, instr_if: { wire: 'imem_r1' }, pc_plus4_if: { wire: 'pc4_pcm' },
  instr_id: { wire: 'ins_c' }, rs1_val_id: { wire: 'rd1_r2' }, rs2_val_id: { wire: 'rd2_r2' }, imm_id: { wire: 'imm_r2' },
  src_a_ex: { wire: 'fa_alu' }, fwd_b_ex: { wire: 'store_r3' }, src_b_ex: { wire: 'bm_alu' }, exres_ex: { wire: 'xm_r3' },
  pc_target_ex: { wire: 'tgt_pcm' }, exres_mem: { wire: 'exres_r4' }, rdata_mem: { wire: 'dm_r4' }, result_wb: { wire: 'result_rf' },
};

// Fields of each pipeline register (WS-F-051), as the stage-suffixed outputs.
const REGISTERS = [
  ['IF/ID', ['instr_id', 'pc_id', 'pc_plus4_id', 'pred_id']],
  ['ID/EX', ['instr_ex', 'pc_ex', 'pc_plus4_ex', 'rs1_val_ex', 'rs2_val_ex', 'imm_ex', 'rs1_ex', 'rs2_ex', 'rd_ex', 'funct3_ex',
    'pred_ex', 'RegWrite_ex', 'ALUSrc_ex', 'MemWrite_ex', 'Branch_ex', 'Jump_ex', 'TargetSrc_ex', 'ResultSel_ex', 'ALUCtrl_ex']],
  ['EX/MEM', ['instr_mem', 'exres_mem', 'store_data_mem', 'rd_mem', 'RegWrite_mem', 'MemWrite_mem', 'ResultSel_mem']],
  ['MEM/WB', ['instr_wb', 'exres_wb', 'rdata_wb', 'rd_wb', 'RegWrite_wb', 'ResultSel_wb']],
];

/** Fetch the Chapter 8 drawing and the Chapter 6 decoder tables from content/. */
export async function loadPipeContent(base) {
  const get = async (p) => {
    const r = await fetch(new URL(p, base));
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };
  const [geom, tables] = await Promise.all([get('content/geometry/ch08.json'), get('content/data/ch06-tables.json')]);
  return { geom, tables };
}

const signed = (v) => String(v | 0).replace('-', '−');
// PC in the stage strip and the diagram: four hex digits while the program is in the first 64 KiB
const short = (v) => (v >>> 0 < 0x10000 ? `0x${v.toString(16).padStart(4, '0')}` : hex8(v));

// replaceChildren without the nulls of optional parts (the DOM would show them as text)
const put = (box, ...kids) => box.replaceChildren(...kids.filter((k) => k !== null && k !== undefined && k !== false));

const fix = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : '—');

export class PipeView {
  /** @param {{geom, tables}} content  @param {{onGoTo?: () => void}} opts onGoTo: called after a diagram cell moved the cycle */
  constructor({ geom, tables }, { onGoTo = () => {} } = {}) {
    Object.assign(this, { geom, tables, onGoTo });
    const saved = (k, list, d) => { const v = store.get(k); return list.includes(v) ? v : d; };
    this.options = {
      hazard: saved('pips.pipe.hazard', HAZARD_MODES, 'full'),
      predictor: saved('pips.pipe.predictor', PREDICTORS, 'none'),
      entries: Number(saved('pips.pipe.entries', ENTRIES.map(String), '8')),
      resolution: saved('pips.pipe.resolution', ['ex', 'id'], 'ex'),
    };
    this.model = this.makeModel();
    this.flow = flowControl();
    this.flowCycle = -1; // the cycle last animated
    this.program = null;
    this.loaded = false;
    this.decimal = false;
    this.diagStart = null; // first column of the diagram window; null: follow the current cycle
    this.fold = store.get('pips.pipe.fold') === '1'; // fold repeated loop iterations (WS-F-141)
    this.stopOn = new Set((store.get('pips.pipe.stop') ?? '').split(',').filter((k) => STOP_EVENTS.includes(k))); // WS-F-091
    this.summary = null; // {model, cycle, value}: the run summary, kept while the cycle stays

    this.dp = new DatapathView(geom, { title: S.diagramTitle, description: geom.alt, valueAt: VALUE_AT, labelBounds: true, nearColours: true });
    const check = (label, on) => el('label.toggle', {}, el('input', { type: 'checkbox', onchange: (e) => on(e.target.checked) }), ` ${label}`);
    this.selects = {}; // option -> its select element
    const select = (label, key, values, names, title = null) => el('label.toggle', { title }, `${label} `, this.selects[key] = el('select', {
      'aria-label': label,
      onchange: (e) => this.setOption(key, key === 'entries' ? Number(e.target.value) : e.target.value),
    }, values.map((v) => el('option', { value: v, text: names ? names[v] : String(v), selected: String(this.options[key]) === String(v) }))));
    this.entriesSel = select(S.entries, 'entries', ENTRIES);
    this.hazardSel = select(S.hazard, 'hazard', ['full', 'stall', 'memwb', 'mem', 'none'], S.hazards, S.hazardTitle);
    this.extBanner = el('p.pp-ext', { text: S.extBanner, title: S.extBanner, role: 'note' });
    this.syncControls();
    this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
    // display settings and export, in the panel heading (main.js puts headerTools there)
    this.headerTools = menu(S.display,
      this.flow.root,
      this.dp.marchToggle,
      this.dp.colourToggle,
      check(STRINGS.single.showAll, (on) => this.dp.setShowAll(on)),
      check(STRINGS.single.decimal, (on) => { this.decimal = on; this.render(); }),
      el('button', { type: 'button', text: S.exportSvg, onclick: () => this.exportSvg() }),
      el('button', { type: 'button', text: S.exportPng, onclick: () => this.exportPng() }));
    this.strip = el('div.pp-strip', { role: 'group', 'aria-label': S.stripLabel });
    const stopBox = (k) => el('label.toggle', {}, el('input', { type: 'checkbox', checked: this.stopOn.has(k), onchange: (e) => {
      if (e.target.checked) this.stopOn.add(k); else this.stopOn.delete(k);
      store.set('pips.pipe.stop', [...this.stopOn].join(','));
      this.showStopCount();
    } }), ` ${S.stopEvents[k]}`);
    this.stopMenu = menu(S.stopOn, el('p.note', { text: S.stopOnTitle }), ...STOP_EVENTS.map(stopBox));
    this.stopMenu.title = S.stopOnTitle;
    this.showStopCount();
    this.root = el('div.col', {},
      el('div.panel-tools.pp-tools', {},
        this.hazardSel,
        select(S.resolution, 'resolution', ['ex', 'id'], S.resolutions, S.resolutionTitle),
        select(S.predictor, 'predictor', PREDICTORS, S.predictors),
        this.entriesSel,
        this.stopMenu),
      this.extBanner,
      this.strip,
      this.dp.root,
      el('p.note.pp-note', { text: S.note, title: S.drawingNote }));

    // What a click on an element of the drawing opens: a shared panel or an information tab.
    const sig = { tab: S.tabSignals };
    const regs = { tab: S.tabRegisters };
    const hz = { tab: S.tabHazards };
    const pred = { tab: S.tabPredictor };
    this.targets = {
      pc: { panel: 'regs' }, rf: { panel: 'regs' }, imem: { tab: STRINGS.listing }, dm: { tab: STRINGS.single.tabMemory },
      r1: regs, r2: regs, r3: regs, r4: regs, fa: hz, fb: hz, bc: hz, immb: pred, padd: pred, pm: pred,
      dec: sig, alu: sig, bm: sig, tm: sig, tadd: sig, xm: sig, rm: sig, imm: sig, add4: sig, pcm: sig,
    };
    this.diagramBox = el('div.scroll.pp-diagram');
    this.registersBox = el('div.scroll.pp-registers');
    this.hazardsBox = el('div.scroll.pp-hazards');
    this.predictorBox = el('div.scroll.pp-predictor');
    this.cpiBox = el('div.scroll.pp-cpi');
    this.signalsBox = el('div.scroll.pp-signals');
    this.summaryBox = el('div.scroll.pp-summary');
  }

  /** The Stop on menu names how many conditions are ticked. */
  showStopCount() {
    this.stopMenu.querySelector('summary').textContent = this.stopOn.size ? `${S.stopOn} (${this.stopOn.size})` : S.stopOn;
  }

  /**
   * After a cycle of a run: the reason to stop at the current cycle (WS-F-091), as a
   * message, or null. The first cycle of a run is never checked, so a run continues
   * from a stop.
   */
  stopReason() {
    if (!this.stopOn.size || !this.loaded || this.model.halted || this.model.error) return null;
    const c = this.model.evaluate();
    const e = pipeEvents(c);
    const kind = STOP_EVENTS.find((k) => e[k] && this.stopOn.has(k));
    if (!kind) return null;
    const s = c.signals;
    const at = kind === 'stall' ? c.seq.ID : (s.PCSel_id ? c.seq.ID : c.seq.EX);
    return S.stoppedOn(S.stopWhat[kind], this.model.cycle, this.name(at));
  }

  /** The model for the options: early resolution (an extension) runs with the complete hazard unit. */
  makeModel(historyLimit = undefined) {
    const o = this.options;
    const early = o.resolution === 'id';
    return new Pipeline(this.tables, { hazard: early ? 'full' : o.hazard, predictor: o.predictor, entries: o.entries, early, historyLimit });
  }

  /** For the exports (core/exports.js): a fresh model with this view's options and program, its signals and RTL module. */
  exportModel() {
    const m = this.makeModel(0);
    m.load(this.program ?? { segments: [] });
    const o = this.options;
    const label = `ch08, ${this.early ? 'early resolution (extension)' : `hazard ${o.hazard}`}, predictor ${o.predictor}${o.predictor === 'none' ? '' : `/${o.entries}`}`;
    return { model: m, signals: [...PIPE_SIGNALS, ...PIPE_EXT_SIGNALS.filter((s) => this.early || !s.extension)],
      module: 'rv32i_pipe', label, retired: (x) => x.stats.retired };
  }

  get early() { return this.options.resolution === 'id'; }

  /** The hazard-handling mode in use (the complete unit under early resolution). */
  get hazard() { return this.model.hazard; }

  syncControls() {
    this.entriesSel.hidden = this.options.predictor === 'none';
    const hs = this.hazardSel.querySelector('select');
    hs.disabled = this.early;
    hs.title = this.early ? S.hazardFixed : '';
    if (this.early) hs.value = 'full'; else hs.value = this.options.hazard;
    this.extBanner.hidden = !this.early;
    this.dp.setVariant('predictor', this.options.predictor !== 'none');
  }

  setOption(key, value) {
    this.options[key] = value;
    store.set(`pips.pipe.${key}`, String(value));
    this.model = this.makeModel();
    this.syncControls();
    this.load(this.program);
    this.onGoTo();
  }

  /** Take over options from a share link or settings file (WS-F-144); null values keep the current ones. */
  applyOptions(o) {
    for (const k of ['hazard', 'predictor', 'entries', 'resolution']) {
      if (o[k] === null || o[k] === undefined) continue;
      this.options[k] = o[k];
      store.set(`pips.pipe.${k}`, String(o[k]));
      if (this.selects[k]) this.selects[k].value = String(o[k]);
    }
    this.model = this.makeModel();
    this.syncControls();
    this.load(this.program);
  }

  /** Load an assembled program (null: nothing to run). */
  load(program) {
    this.program = program;
    this.model.load(program ?? { segments: [] });
    this.loaded = Boolean(program);
    this.diagStart = null;
    this.flowCycle = -1;
    this.summary = null;
    this.render();
  }

  reset() { this.model.reset(); this.diagStart = null; this.flowCycle = -1; this.summary = null; this.render(); }

  /** One clock cycle; returns 'step', 'halt' or 'error'. */
  step() { this.diagStart = null; return this.model.step(); }

  back() { this.diagStart = null; return this.model.back(); }

  /** Move to cycle k, backwards or (over cycles already run) forwards. */
  goTo(k) {
    const m = this.model;
    while (m.cycle > k && m.back());
    if (m.halted && m.cycle > k) m.back();
    while (m.cycle < k && m.step() === 'step');
    this.onGoTo();
  }

  // --- formatting ------------------------------------------------------------------------
  fmt(name, v) {
    const s = SIGNAL_INFO[name];
    if (s.width === 32) return this.decimal ? `${hex8(v)} (${signed(v)})` : hex8(v);
    if (s.kind === 'control' || /^(op|funct3)_/.test(name)) return binary(v, s.width);
    return String(v);
  }

  tip(name, v) {
    const s = SIGNAL_INFO[name];
    const m = meaning(name, v);
    if (s.width === 32) return `${name} = ${hex8(v)} = ${signed(v)}`;
    return `${name} = ${binary(v, s.width)}${s.width > 1 ? ` (${v})` : ''}${m ? ` → ${m}` : ''}`;
  }

  /** Assembly text of an instruction word (x-numbers, as Chapter 8). */
  text(w, pc) {
    if (w === HALT_WORD) return 'jal x0, 0';
    return decodeMnemonic(w) ? disassemble(w, pc, 'x') : hex8(w);
  }

  /** What a seq stands for: {label, pc, bubble, wrong}. */
  describe(seq) {
    const i = seq ? this.model.instance(seq) : null;
    if (!i) return { label: S.bubble, pc: null, bubble: true, wrong: false };
    if (i.kind === 'bubble') return { label: S.bubble, pc: null, bubble: true, wrong: false, loadUse: true };
    if (i.instr === 0) return { label: S.bubble, pc: i.pc, bubble: true, wrong: i.wrongPath };
    return { label: this.text(i.instr, i.pc), pc: i.pc, bubble: false, wrong: i.wrongPath };
  }

  name(seq) {
    const d = this.describe(seq);
    return d.bubble ? S.bubble : `${d.label} (${hex8(d.pc)})`;
  }

  // --- rendering -------------------------------------------------------------------------
  render() {
    const m = this.model;
    const c = m.evaluate();
    const s = c.signals;
    const sigs = new Map();
    const ctls = new Map();
    for (const d of [...PIPE_SIGNALS, ...PIPE_EXT_SIGNALS]) {
      const v = s[d.name];
      const tag = d.width === 32 ? (this.decimal ? signed(v) : (v >>> 0).toString(16).padStart(8, '0')) : null;
      const rec = { text: this.fmt(d.name, v), tag, tip: this.tip(d.name, v) };
      sigs.set(d.name, rec); // control bundles are connections too
      if (d.kind === 'control') ctls.set(d.name, rec);
    }
    this.dp.setValues(sigs, ctls);
    const paths = pipePaths(s, { predictor: this.options.predictor !== 'none', early: this.early });
    this.dp.setPath(this.loaded ? paths : null);
    this.animate(paths);
    const marks = [];
    if (this.loaded) {
      if (s.stall_if) marks.push({ id: 'pc', kind: 'hold', text: S.stallMark });
      if (s.flush_id) marks.push({ id: 'r1', kind: 'clear', text: S.flushMark });
      else if (s.stall_id) marks.push({ id: 'r1', kind: 'hold', text: S.stallMark });
      if (s.flush_ex) marks.push({ id: 'r2', kind: 'clear', text: S.flushMark });
    }
    this.dp.setMarks(marks);

    this.status.textContent = S.status(m.cycle, hex8(m.pc), m.halted, m.error);
    this.renderStrip(c);
    const summary = STAGES.map((st) => `${st}: ${this.name(c.seq[st])}`).join('; ');
    this.dp.setDescription(`${this.geom.alt} ${STRINGS.single.thisCycle} (${m.cycle}): ${summary}.`);
    this.renderDiagram();
    this.renderRegisters(c);
    this.renderHazards(c);
    this.renderPredictor(c);
    this.renderCpi();
    this.renderSignals(c);
    this.renderSummary();
  }

  /**
   * Signal flow once per new cycle (WS-U-003): every stage starts at its register at the
   * same clock edge, and the forwarding feeds leave MEM and WB at once.
   */
  animate(paths) {
    const ms = this.flow.get();
    if (!this.loaded || !ms) { this.dp.animate([], 0); return; }
    if (this.model.cycle === this.flowCycle) return;
    this.flowCycle = this.model.cycle;
    const x = (id) => this.geom.elements.find((e) => e.id === id);
    const east = (id) => x(id).at[0] + x(id).size[0] / 2;
    const left = this.options.predictor !== 'none' ? -1.5 : -0.16;
    const right = Math.max(...this.geom.wires.flatMap((w) => w.points.map((p) => p[0])));
    const st = paths.stages;
    const groups = [
      { wires: st.IF, x0: left, x1: x('r1').at[0] }, { wires: st.ID, x0: east('r1'), x1: x('r2').at[0] },
      { wires: st.EX, x0: east('r2'), x1: x('r3').at[0] }, { wires: st.MEM, x0: east('r3'), x1: x('r4').at[0] },
      { wires: st.WB, x0: east('r4'), x1: right }, { wires: st.fwd, x0: 0, x1: 1 },
    ];
    const order = flowOrder(this.geom, groups, new Set(['wb_up', 'mem_up']));
    for (const o of order) if (st.fwd.has(o.id) && !o.id.endsWith('_up')) o.at = 0.35; // the branches after the trunk
    this.dp.animate(order, ms);
  }

  renderStrip(c) {
    const s = c.signals;
    const held = { IF: s.stall_if, ID: s.stall_id && !s.flush_id };
    const gone = { IF: s.flush_id, ID: s.flush_ex && !s.stall_id };
    put(this.strip, ...STAGES.map((st) => {
      const d = this.loaded ? this.describe(c.seq[st]) : { label: S.empty, pc: null, bubble: true };
      const flags = [held[st] ? `‖ ${S.held}` : null, gone[st] && !d.bubble ? `✕ ${S.flushed}` : null, d.wrong ? `! ${S.wrongPath}` : null].filter(Boolean);
      return el(`div.pp-stage${d.bubble ? '.pp-bubble' : ''}${gone[st] && !d.bubble ? '.pp-flushed' : ''}${held[st] ? '.pp-held' : ''}`, {},
        el('span.pp-stage-head', {}, el('b', { text: S.stages[st] }), ' ',
          el('span.mono.pp-stage-pc', { text: d.pc === null || d.bubble ? '' : short(d.pc), title: d.pc === null ? null : hex8(d.pc) }), ' ',
          flags.length ? el('span.pp-stage-flags', { text: flags.join(' · ') }) : null),
        el('span.mono.pp-stage-instr', { text: d.bubble && this.loaded ? `○ ${S.bubble}` : d.label }));
    }));
  }

  /**
   * The pipeline diagram (WS-F-053): a window of WINDOW columns. A column is a cycle or,
   * with folding (WS-F-141), a gap of cycles that only folded iterations occupy.
   */
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
    const at = (c) => (typeof c === 'number' ? c : c.gap[1]); // the last cycle of a column
    const curIdx = Math.max(0, cols.findIndex((c) => at(c) >= m.cycle));
    let i0 = this.diagStart ?? Math.max(0, Math.min(cols.length - 1, curIdx + 4) - WINDOW + 1);
    i0 = Math.max(0, Math.min(i0, Math.max(0, cols.length - WINDOW)));
    const shown = cols.slice(i0, i0 + WINDOW);
    const lo = typeof shown[0] === 'number' ? shown[0] : shown[0].gap[0];
    const hi = at(shown[shown.length - 1]);
    if (!this.fold) items = diagramRows(m, lo, hi).map((row) => ({ kind: 'row', row }));
    const inWindow = (row) => row.cells.some(([k]) => k >= lo && k <= hi);
    const rows = items.filter((it) => (it.kind === 'row' ? inWindow(it.row) : it.from <= hi && it.to >= lo)).map((it) => {
      if (it.kind === 'fold') {
        return el('tr.pd-foldrow', {}, el('th.mono', { scope: 'row', text: S.foldRow(it.count, it.from, it.to) }),
          shown.map((c) => (typeof c === 'number' ? el('td', {}) : el('td.pd-gap.mono', { text: c.gap[0] <= it.to && c.gap[1] >= it.from ? S.foldCell(it.count) : '' }))));
      }
      const d = this.describe(it.row.seq);
      const label = d.loadUse ? S.bubbleRow : `${d.wrong ? '! ' : ''}${d.pc === null ? '' : `${hex8(d.pc).slice(-4)}  `}${d.label}`;
      const byCycle = new Map(it.row.cells);
      const cells = shown.map((c) => {
        if (typeof c !== 'number') return el('td.pd-gap', {});
        const code = byCycle.get(c);
        if (!code) return el(`td${c === m.cycle ? '.pd-cur' : ''}`, {});
        const st = code.replace(/[‖✕○]$/, '');
        const mark = code.slice(st.length);
        const [what, cls] = { '‖': [S.held, '.pd-stall'], '✕': [S.flushed, '.pd-flush'], '○': [S.bubble, '.pd-bubble'] }[mark] ?? ['', ''];
        return el(`td.pd-cell${cls}${c === m.cycle ? '.pd-cur' : ''}${c > m.cycle ? '.pd-future' : ''}`, {},
          el('button', { type: 'button', text: `${S.stages[st]}${mark}`, title: S.cellTitle(st, c, what), 'aria-label': `${S.cellTitle(st, c, what)}. ${S.goToCycle(c)}`,
            onclick: () => this.goTo(c) }));
      });
      return el(`tr${d.loadUse ? '.pd-bubblerow' : ''}${d.wrong ? '.pd-wrong' : ''}`, {}, el('th.mono', { scope: 'row', text: label }), cells);
    });
    const head = el('tr', {}, el('th', { text: S.colInstr }), shown.map((c) => (typeof c === 'number'
      ? el(`th.mono${c === m.cycle ? '.pd-cur' : ''}`, { text: String(c) })
      : el('th.mono.pd-gap', { text: S.gapHead(c.gap[0], c.gap[1]), title: S.gapTitle(c.gap[0], c.gap[1]) }))));
    const foldBox = el('label.toggle', { title: S.foldTitle }, el('input', { type: 'checkbox', checked: this.fold, onchange: (e) => {
      this.fold = e.target.checked;
      store.set('pips.pipe.fold', this.fold ? '1' : '0');
      this.diagStart = null;
      this.renderDiagram();
    } }), ` ${S.fold}`);
    const nav = el('div.panel-tools', {},
      el('button', { type: 'button', text: S.earlier, disabled: i0 === 0, onclick: () => { this.diagStart = Math.max(0, i0 - WINDOW / 2); this.renderDiagram(); } }),
      el('button', { type: 'button', text: S.later, disabled: i0 + WINDOW >= cols.length, onclick: () => { this.diagStart = i0 + WINDOW / 2; this.renderDiagram(); } }),
      foldBox);
    const folded = this.fold && !items.some((it) => it.kind === 'fold');
    put(this.diagramBox, nav,
      folded ? el('p.note', { text: S.foldNone }) : null,
      el('table.listing.pd-table', {}, el('caption', { text: S.diagramCaption }), el('thead', {}, head), el('tbody', {}, rows)),
      el('p.note', { text: S.legend }));
    const cur = this.diagramBox.querySelector('thead th.pd-cur');
    if (cur && this.diagStart === null) this.diagramBox.scrollLeft = Math.max(0, cur.offsetLeft - this.diagramBox.clientWidth / 2);
  }

  renderRegisters(c) {
    const s = c.signals;
    const status = { 'IF/ID': s.flush_id ? 'clear' : s.stall_id ? 'hold' : 'none', 'ID/EX': s.flush_ex ? 'clear' : 'none' };
    const row = (name) => {
      const v = s[name];
      const d = SIGNAL_INFO[name];
      const m = meaning(name, v);
      const extra = name.startsWith('instr_') ? `  ${v ? this.text(v, s[`pc_${name.slice(6)}`] ?? 0) : S.bubble}` : m ? `  → ${m}` : '';
      return el('tr', {}, el('td.mono', { text: name }), el('td.mono', { text: `${d.width === 32 ? hex8(v) : binary(v, d.width)}${extra}` }));
    };
    put(this.registersBox, 
      el('p.mono', { text: `PC: pc_if = ${hex8(s.pc_if)}${s.stall_if ? `  (${S.regStatus.hold.replace('stall', 'stall_if')})` : ''}` }),
      ...REGISTERS.map(([name, fields]) => el('table.listing.sc-table.pp-reg', {},
        el('caption', { text: `${S.regCaption(name)}${status[name] && status[name] !== 'none' ? ` · ${S.regStatus[status[name]]}` : ''}` }),
        el('thead', {}, el('tr', {}, el('th', { text: S.colField }), el('th', { text: S.colValue }))),
        el('tbody', {}, fields.map(row)))),
      el('p.note', { text: S.regNever }));
  }

  renderHazards(c) {
    const s = c.signals;
    const m = this.model;
    const x = (r) => `x${r}`;
    const lines = [];
    if (this.loaded) {
      const user = this.name(c.seq.EX);
      if (s.fwd_sel_a) lines.push(S.fwd('fwd_sel_a', binary(s.fwd_sel_a, 2), `rs1 (${x(s.rs1_ex)})`, user, s.fwd_sel_a === 2 ? 'MEM' : 'WB', this.name(s.fwd_sel_a === 2 ? c.seq.MEM : c.seq.WB)));
      if (s.fwd_sel_b) lines.push(S.fwd('fwd_sel_b', binary(s.fwd_sel_b, 2), `rs2 (${x(s.rs2_ex)})`, user, s.fwd_sel_b === 2 ? 'MEM' : 'WB', this.name(s.fwd_sel_b === 2 ? c.seq.MEM : c.seq.WB)));
      if (c.lwStall) lines.push((s.stall_if ? S.loadUse : S.loadUseMissed)(this.name(c.seq.EX), x(s.rd_ex), this.name(c.seq.ID)));
      if (c.brStall && !c.lwStall) {
        const inEx = s.RegWrite_ex && s.rd_ex !== 0 && (s.rd_ex === s.rs1_id || s.rd_ex === s.rs2_id);
        lines.push(S.branchWait(this.name(c.seq.ID), x(inEx ? s.rd_ex : s.rd_mem), this.name(inEx ? c.seq.EX : c.seq.MEM), inEx ? 'EX' : 'MEM'));
      }
      if (s.fwd_id_a || s.fwd_id_b) lines.push(S.fwdId(this.name(c.seq.ID), this.name(c.seq.MEM)));
      if (s.PCSel_id) {
        const why = s.Jump_id ? S.why.jump : s.BranchTaken_id ? S.why.taken : S.why.notTaken;
        lines.push(S.redirectId(this.name(c.seq.ID), why));
        if (!this.describe(c.seq.IF).bubble) lines.push(S.flushOne(this.name(c.seq.IF)));
      }
      if (s.PCSel_ex) {
        const why = s.Jump_ex ? S.why.jump : s.BranchTaken_ex ? S.why.taken : S.why.notTaken;
        lines.push(S.redirect(this.name(c.seq.EX), why));
        const young = [c.seq.IF, c.seq.ID].filter((q) => !this.describe(q).bubble).map((q) => this.name(q));
        if (young.length) lines.push((s.flush_id ? S.flushes : S.noFlush)(young.join(' and ')));
      }
      for (const st of c.stale) lines.push(S.stale(this.name(c.seq.EX), x(st.reg), hex8(st.got), hex8(st.want)));
    }
    const out = ['fwd_sel_a', 'fwd_sel_b', 'stall_if', 'stall_id', 'flush_id', 'flush_ex'].map((n) => {
      const mm = meaning(n, s[n]);
      return el('tr', {}, el('td.mono', { text: n }), el('td.mono', { text: binary(s[n], SIGNAL_INFO[n].width) }), el('td.mono', { text: mm ?? '' }));
    });
    const st = m.stats;
    put(this.hazardsBox, 
      el('p.note', { text: S.modeNote(S.hazardLong[this.hazard]) }),
      this.early ? el('p.pp-ext', { text: S.extBanner }) : null,
      el('h3', { text: S.reasonsCaption }),
      lines.length ? el('ul.pp-reasons', {}, lines.map((t) => el('li', { text: t }))) : el('p', { text: this.loaded ? S.nothing : S.noProgram }),
      el('table.listing.sc-table', {}, el('caption', { text: S.unitCaption }),
        el('thead', {}, el('tr', {}, [STRINGS.single.colSignal, STRINGS.single.colCode, STRINGS.single.colMeaning].map((t) => el('th', { text: t })))),
        el('tbody', {}, out)),
      this.hazard === 'full' ? null : el('p', { text: S.staleCount(st.stale, st.firstStaleCycle, hex8(st.firstStalePc)) }),
      this.hazard === 'full' || !st.wrongPath ? null : el('p', { text: S.wrongCount(st.wrongPath) }));
  }

  renderPredictor(c) {
    const s = c.signals;
    const bp = this.model.bp;
    if (bp.kind === 'none') { put(this.predictorBox, el('p', { text: S.predNone }), el('p.note', { text: S.predHardwareNote })); return; }
    const width = bp.kind === '2bit' ? 2 : 1;
    const isBranch = (s.instr_if & 0x7f) === 0b1100011;
    // the resolved branch that writes the table at the next edge: in EX, or in ID (early resolution, when not held)
    const upd = this.early ? (s.Branch_id && !s.stall_id ? { st: 'ID', pc: s.pc_id, k: c.bp.indexId, taken: s.BranchTaken_id } : null)
      : s.Branch_ex ? { st: 'EX', pc: s.pc_ex, k: c.bp.indexEx, taken: s.BranchTaken_ex } : null;
    const rows = Array.from(bp.table, (v, i) => {
      const tags = [i === c.bp.indexIf ? 'IF ▶' : '', upd && i === upd.k ? `${upd.st} ◀` : ''].filter(Boolean).join(' ');
      const pred = bp.kind === '2bit' ? v >= 2 : v === 1;
      return el(`tr${tags ? '.sc-active' : ''}`, {}, el('td.mono', { text: `${tags ? `${tags} ` : ''}${i}` }),
        el('td.mono', { text: binary(v, width) }), el('td', { text: pred ? S.taken : S.notTaken }));
    });
    const lines = [S.lookup(hex8(s.pc_if), c.bp.indexIf, isBranch, s.predict_taken ? S.taken : S.notTaken)];
    if (upd) {
      lines.push(S.update(hex8(upd.pc), upd.st, upd.k, binary(bp.table[upd.k], width), binary(bp.next(upd.pc, upd.taken), width), upd.taken ? S.taken : S.notTaken));
    } else lines.push(S.noUpdate(this.early ? 'ID' : 'EX'));
    put(this.predictorBox, 
      el('p', { text: this.predText() }),
      el('ul.pp-reasons', {}, lines.map((t) => el('li', { text: t }))),
      el('table.listing.sc-table', {}, el('caption', { text: S.predCaption(S.predictors[bp.kind], bp.entries) }),
        el('thead', {}, el('tr', {}, [S.colIndex, S.colCounter, S.colPredicts].map((t) => el('th', { text: t })))),
        el('tbody', {}, rows)),
      bp.kind === '1bit' ? el('p.note', { text: S.oneBitNote }) : null,
      el('p.note', { text: S.predHardwareNote }));
  }

  renderCpi() {
    const m = this.model;
    const st = m.stats;
    const n = st.retired;
    const R = S.cpiRows;
    const p = m.penalty;
    const counts = [[R.cycles, m.cycle], [R.n, n], [R.stalls, st.loadUse], ...(this.early ? [[R.branchStalls, st.branchStall]] : []),
      [R.redirects, st.redirects], [R.flushCycles(p), p * st.redirects], [R.branches, st.branches], [R.jumps, st.jumps], [R.mispredicts, st.mispredicts]];
    const table = (caption, rows) => el('table.listing.sc-table', {}, el('caption', { text: caption }),
      el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('td', { text: k }), el('td.mono', { text: String(v) })))));
    const parts = [table(S.cpiCaption, counts), el('p', { text: this.predText() })];
    const cp = cpiParts(m);
    if (cp) {
      const { f } = cp;
      const symbols = Object.entries(S.symbols).filter(([k]) => this.early || k !== 'f_bs');
      parts.push(table(this.early ? S.modelCaptionEarly : S.modelCaption, [...symbols.map(([k, label]) => [label, k === 'p' ? String(f.p) : fix(f[k])]),
        [S.cpiModel, fix(cp.model)], [S.cpiMeasured, fix(cp.measured)]]));
      parts.push(el('p.note', { text: S.fill(fix(4 / n)) }));
      parts.push(this.cpiBar(cp));
      if (m.halted && this.hazard === 'full') {
        parts.push(el('p.mono', { text: this.early ? S.identityEarly(m.cycle, n, st.loadUse + st.branchStall, st.redirects) : S.identity(m.cycle, n, st.loadUse, st.redirects) }));
      }
    } else parts.push(el('p.note', { text: S.notYet }));
    if (this.hazard !== 'full') parts.push(el('p.note', { text: S.incomplete }));
    if (this.early) parts.push(el('p.pp-ext', { text: S.extBanner }));
    put(this.cpiBox, ...parts);
  }

  /** Branches predicted correctly out of all branches, for the chosen predictor (WS-F-142). */
  predText() {
    const ps = predictionStats(this.model.stats);
    const o = this.options;
    const kind = `${S.predictors[o.predictor]}${o.predictor === 'none' ? '' : `, ${o.entries} entries`}`;
    return S.predStats(ps.correct, ps.branches, ps.rate === null ? '' : `${(100 * ps.rate).toFixed(1)} %`, kind);
  }

  /**
   * The CPI of the textbook model as one bar of its components (WS-F-142). Each segment
   * carries its name and value as text and its own hatching, so colour is not needed to
   * tell them apart (WS-U-032); the table under it says the same.
   */
  cpiBar(cp) {
    const parts = cp.parts.filter((x) => x.key === 'base' || x.value > 0);
    const label = parts.map((x) => `${S.cpiParts[x.key]} ${fix(x.value)}`).join(', ');
    const bar = el('div.cpi-bar', { role: 'img', 'aria-label': S.cpiBarLabel(`${label}; total ${fix(cp.model)}`) },
      parts.map((x) => el(`div.cpi-seg.cpi-${x.key}`, { style: `flex-grow: ${x.value}`, title: `${S.cpiParts[x.key]}: ${fix(x.value)}` },
        el('span', { text: `${fix(x.value, 2)}` }))));
    return el('figure.cpi-figure', {},
      el('figcaption', { text: `${S.cpiBarCaption}: ${fix(cp.model)}` }),
      bar,
      el('table.listing.sc-table.cpi-legend', {}, el('tbody', {}, parts.map((x) => el('tr', {},
        el('td', {}, el(`span.cpi-key.cpi-${x.key}`, { 'aria-hidden': 'true' }), ` ${S.cpiParts[x.key]}`), el('td.mono', { text: fix(x.value) }))))),
      el('p.note', { text: S.cpiBarNote }));
  }

  /** Lost cycles by cause, with the instructions and the cycles of each (WS-F-140); kept while the cycle stays. */
  renderSummary() {
    const m = this.model;
    if (!this.loaded) { put(this.summaryBox, el('p.note', { text: S.noProgram })); return; }
    if (this.summary?.model === m && this.summary.cycle === m.cycle) return;
    const { rows, totals } = hazardSummary(m);
    this.summary = { model: m, cycle: m.cycle };
    const instr = (x) => (x.instr ? `${this.text(x.instr, x.pc)} (${hex8(x.pc)})` : S.bubble);
    const what = (r) => {
      if (r.cause === 'loadUse' || r.cause === 'branchWait') return S.pair(instr(r.a), instr(r.b));
      const t = r.cause === 'mispredict' ? `${instr(r.a)}: ${S.outcome(r.taken)}` : instr(r.a);
      return r.flushed ? t : `${t}; ${S.notFlushedNote}`;
    };
    const links = (cycles) => {
      const first = cycles.slice(0, 6).map((k) => el('button.link-btn.mono', { type: 'button', text: String(k), title: S.goToCycle(k), onclick: () => this.goTo(k) }));
      return [...first, cycles.length > 6 ? el('span.note', { text: ` ${S.moreCycles(cycles.length - 6)}` }) : null];
    };
    const head = (...t) => el('thead', {}, el('tr', {}, t.map((x) => el('th', { text: x }))));
    const causes = Object.keys(totals).filter((k) => k !== 'branchWait' || this.early);
    put(this.summaryBox, 
      el('p.note', { text: S.modeNote(S.hazardLong[this.hazard]) }),
      el('table.listing.sc-table', {}, el('caption', { text: S.summaryTotals }), head(S.colCause, S.colEvents, S.colLost),
        el('tbody', {}, causes.map((k) => el('tr', {}, el('td', { text: S.causes[k] }), el('td.mono', { text: String(totals[k].events) }),
          el('td.mono', { text: String(totals[k].lost) }))))),
      el('p', { text: this.predText() }),
      rows.length ? el('table.listing.sc-table.pp-sumtable', {}, el('caption', { text: S.summaryCaption(m.cycle) }),
        head(S.colCause, S.colInstrs, S.colEvents, S.colLost, S.colCycles),
        el('tbody', {}, rows.map((r) => el('tr', {}, el('td', { text: S.causes[r.cause] }), el('td.mono', { text: what(r) }),
          el('td.mono', { text: String(r.count) }), el('td.mono', { text: String(r.lost) }), el('td', {}, links(r.cycles))))))
        : el('p', { text: S.summaryNone }),
      el('p.note', { text: S.summaryNote }),
      this.early ? el('p.pp-ext', { text: S.extBanner }) : null);
  }

  renderSignals(c) {
    const s = c.signals;
    const groups = [...STAGES, 'hazard'];
    const rows = [];
    for (const g of groups) {
      rows.push(el('tr.pp-group', {}, el('th', { colspan: 4, scope: 'rowgroup', text: g === 'hazard' ? S.hazardStage : g })));
      const ext = PIPE_EXT_SIGNALS.filter((x) => x.stage === g && (this.early || !x.extension));
      for (const d of [...PIPE_SIGNALS.filter((x) => x.stage === g), ...ext]) {
        const v = s[d.name];
        rows.push(el('tr', {}, el('td.mono', { text: d.name }), el('td.mono', { text: d.width === 32 ? hex8(v) : binary(v, d.width) }),
          el('td.mono', { text: d.width === 32 ? signed(v) : String(v) }), el('td.mono', { text: meaning(d.name, v) ?? '' })));
      }
    }
    put(this.signalsBox, el('p.note', { text: S.drawingNote }), el('table.listing.sc-signals', {}, el('caption', { text: S.signalsCaption }),
      el('thead', {}, el('tr', {}, [STRINGS.single.colSignal, STRINGS.single.colCode, STRINGS.single.colDecimal, STRINGS.single.colMeaning].map((t) => el('th', { text: t })))),
      el('tbody', {}, rows)));
  }

  // --- export (WS-U-004) -----------------------------------------------------------------
  caption() {
    const o = this.options;
    const bp = o.predictor === 'none' ? '' : `, ${S.predictors[o.predictor]} ${o.entries}`;
    const early = this.early ? `, ${S.resolutions.id}` : '';
    return S.caption(`ch08 (${S.hazardShort[this.hazard]}${early}${bp})`, this.model.cycle);
  }

  exportSvg() {
    download(`ch08-cycle${this.model.cycle}.svg`, this.dp.exportSvg(this.caption()), 'image/svg+xml');
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
      cv.toBlob((b) => b && download(`ch08-cycle${this.model.cycle}.png`, b, 'image/png'));
    };
    img.src = url;
  }
}
