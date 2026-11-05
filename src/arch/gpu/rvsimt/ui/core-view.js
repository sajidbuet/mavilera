// rvsimt/ui/core-view.js -- the core views of the RISC-V SIMT core (GPU-3, gate V; contract ViewInstance, kind
// 'datapath'): the drawing of the laboratory core (geometry content/geometry/ch11a-gpu.json, exported from the book's
// generator: four lanes as drawn, eight with the same shapes and pitch), stepped one issue per clock cycle, with the
// values of the coming issue on its wires and the active path; below it the warps (state, PC, mask, reconvergence
// stack). warp_ctrl and the write gates are shown by their behaviour, not their logic (decision G19). Tabs: the coming
// issue lane by lane; the mask grid of the issues so far, with the "Masks-only count" filter (decision G21); the stack
// after each issue; the counters of this program and of the laboratory programs. coreInstance() wraps the view as the
// contract's ViewInstance, with the export model for the waveforms, the VCD and the golden dump. Masks are written lane
// 0 first, as the book writes them; a mask bit is shown as 1 or 0 and "on" or "off", never by colour alone.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8, download, menu } from '../../../../ui/dom.js';
import { DatapathView, groupRole } from '../../../../ui/datapath.js';
import { STOP } from '../../../contract.js';
import { CoreModel, exportModel, codeText, lanes0, maskRows, setupIssues, stackRows, results } from '../core-model.js';
import { assemble } from '../language.js';
import { FAULT_NAMES, RVSIMT_STRINGS } from '../strings.js';
import { maskGrid, showLast, GRID_ROWS } from '../../ui/mask-grid.js';

const S = RVSIMT_STRINGS;
const C = S.core;
const PRE_RUN = 20_000; // issues of the run made at load to find each warp's launch and setup (the masks-only filter)
const signed = (v) => String(v | 0).replace('-', '−');
const active = (m, n) => Array.from({ length: n }, (_, l) => l).filter((l) => (m >>> l) & 1);

/** Fetch the geometry of the drawings and the laboratory templates (for the Results tab). */
export async function loadCoreContent(base) {
  const get = async (p, kind = 'json') => {
    const r = await fetch(new URL(p, base));
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return kind === 'json' ? r.json() : r.text();
  };
  const geom = await get('content/geometry/ch11a-gpu.json');
  const index = await get('content/gpu/rvsimt/templates/index.json');
  const lab = index.templates.filter((t) => t.group === 'lab' && t.profile === 'lab');
  const templates = await Promise.all(lab.map(async (t) => ({ id: t.id, text: await get(`content/gpu/rvsimt/templates/${t.file}`, 'text') })));
  return { geom, templates };
}

export class CoreView {
  /** @param {{geom: object, templates: {id, text}[]}} content @param {number} lanes 4 (profile lab) or 8 (lab-l8) */
  constructor({ geom, templates }, lanes) {
    this.lanes = lanes;
    this.warps = lanes === 8 ? 1 : 2;
    this.templates = templates;
    const g = { ...geom.core[String(lanes)], pics: {} };
    const info = { pc: { width: 32 }, instr: { width: 32 }, ...Object.fromEntries(Array.from({ length: lanes }, (_, l) => [[`result[${l}]`, { width: 32 }], [`write[${l}]`, { width: 32 }]]).flat()) };
    this.dp = new DatapathView(g, { title: C.diagramTitle, description: C.description(lanes), ids: `gpu-core${lanes}`, info, textSize: 9.84,
      valueAt: { pc: { wire: 'pc' }, instr: { wire: 'instr' }, ...Object.fromEntries(Array.from({ length: lanes }, (_, l) => [`write[${l}]`, { wire: `g${l}_out` }])) } });
    for (const e of g.elements) if (e.student) this.dp.elements.get(e.id)?.classList.add('dp-student');
    groupRole(this.dp.svg, `gpu-core${lanes}-title`, `gpu-core${lanes}-desc`);
    this.status = el('span.dp-status.mono', { role: 'status', 'aria-live': 'polite' });
    this.line = el('p.note.gpu-coming', { 'aria-live': 'polite' });
    this.warpBox = el('div.gpu-warps');
    this.headerTools = menu(C.display,
      el('label.toggle', {}, el('input', { type: 'checkbox', onchange: (e) => this.dp.setShowAll(e.target.checked) }), ` ${C.showAll}`),
      this.dp.marchToggle,
      el('button', { type: 'button', text: C.exportSvg, onclick: () => download(this.fileName('svg'), this.dp.exportSvg(this.caption()), 'image/svg+xml') }),
      el('button', { type: 'button', text: C.exportPng, onclick: () => this.exportPng() }));
    // a narrow screen shows one lane at a time with a mask strip in place of the drawing (decision G27); the drawing on request
    this.lane = 0;
    this.laneCard = el('section.gpu-lanecard', { 'aria-label': C.laneCard.title });
    this.root = el('div.col.gpu-core', {}, el('p.note', { text: C.studentNote }), this.laneCard, this.dp.root, this.line,
      el('h4', { text: C.warpsHeading }), this.warpBox);
    this.issueBox = el('div.scroll.gpu-issue');
    this.masksOnly = false;
    this.masksBox = el('div.scroll.gpu-masks');
    this.stackWarp = 0;
    this.stackBox = el('div.scroll.gpu-stack');
    this.resultsBox = el('div.scroll.gpu-results');
    this.lab = null; // the laboratory programs' counters, computed when the Results tab is first shown
    this.model = null;
    this.changed = [];
  }

  /** Load an assembled program (null: nothing to run). */
  load(program) {
    this.program = program;
    this.model = program ? new CoreModel(program) : null;
    this.setup = new Set();
    if (program) { // each warp's launch and setup, from a run of the whole program (the filter needs the first split)
      const pre = new CoreModel(program);
      for (let i = 0; i < PRE_RUN && pre.step() === 'step'; i++);
      this.setup = setupIssues(pre.issues);
    }
    this.changed = [];
    this.render();
  }

  reset() { this.model?.reset(); this.changed = []; this.render(); }

  step() {
    const m = this.model;
    if (!m) return STOP.ERROR;
    const before = m.registers();
    const r = m.step();
    if (r !== 'step') return r === 'halt' ? STOP.HALT : STOP.ERROR;
    const after = m.registers();
    this.changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    return m.fault ? STOP.ERROR : m.halted ? STOP.HALT : STOP.NONE;
  }

  back() { this.changed = []; return this.model?.back() ?? false; }

  error() {
    const m = this.model;
    if (!m) return null;
    if (m.fault) { const r = m.issues.at(-1); return S.engine.fault(m.fault, r.pc, r.w); }
    return m.error;
  }

  caption() { return `${C.label(this.warps, this.lanes)}, cycle ${this.model?.cycle ?? 0}`; }
  fileName(ext) { return `simt-core-${this.warps}x${this.lanes}-cycle${this.model?.cycle ?? 0}.${ext}`; }
  exportPng() {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([this.dp.exportSvg(this.caption())], { type: 'image/svg+xml' }));
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => b && download(this.fileName('png'), b, 'image/png'));
    };
    img.src = url;
  }

  // --- rendering ------------------------------------------------------------------------
  render() {
    const m = this.model;
    if (!m) {
      this.dp.setPath(null); this.dp.setValues(new Map(), new Map());
      this.status.textContent = '';
      this.line.textContent = C.noProgram;
      this.warpBox.replaceChildren();
      this.laneCard.replaceChildren(el('p.note', { text: C.noProgram }));
      for (const b of [this.issueBox, this.masksBox, this.stackBox]) b.replaceChildren(el('p.note', { text: C.noProgram }));
      return;
    }
    const { issue: p } = m.evaluate();
    this.p = p;
    this.drawCore(p);
    this.status.textContent = `cycle ${m.cycle}`;
    const code = p ? codeText(this.program, p.pc, p.word) : '';
    this.line.textContent = p ? C.coming(m.cycle, p.w, hex8(p.pc), code, lanes0(p.maskIn, this.lanes))
      : m.fault ? C.faulted(m.fault, FAULT_NAMES[m.fault]) : m.error ? m.error : C.ended(m.cycle);
    this.dp.setDescription(C.description(this.lanes) + this.line.textContent);
    this.drawWarps();
    this.drawIssue(p, code);
    this.drawLane(p, code);
    if (this.masksBox.isConnected) this.drawMasks();
    if (this.stackBox.isConnected) this.drawStack();
    if (this.resultsBox.isConnected) this.drawResults();
  }

  drawCore(p) {
    const L = this.lanes;
    const sig = new Map();
    const put = (name, text, tip) => sig.set(name, { text, tip: `${name} = ${tip ?? text}` });
    if (!p) {
      this.dp.setPath(null);
      this.dp.setValues(sig, new Map());
      return;
    }
    const code = codeText(this.program, p.pc, p.word);
    put('pc', hex8(p.pc), `${hex8(p.pc)} (warp ${p.w})`);
    put('instr', hex8(p.word), `${hex8(p.word)}: ${code}`);
    put('decoded', code);
    const mask = lanes0(p.maskIn, L);
    put('mask', mask, `${mask} (lane 0 first): lanes ${active(p.maskIn, L).join(', ') || C.none} active`);
    for (let l = 0; l < L; l++) {
      const v = p.result[l];
      const on = (p.maskIn >>> l) & 1;
      put(`result[${l}]`, v === null ? C.none : signed(v), v === null ? `${C.none} (lane ${on ? C.on : C.off})` : `${signed(v)} (${hex8(v)})`);
      put(`write[${l}]`, v === null ? C.none : signed(v), v === null ? (on ? C.none : `${C.off}: the gate holds the write back`) : `${signed(v)} (${hex8(v)})`);
    }
    if (p.taken !== null) put('taken', String(p.taken), `${p.taken} (${p.taken ? C.yes : C.no})`);
    if (p.pred !== null) put('pred', lanes0(p.pred, L), `${lanes0(p.pred, L)} (lane 0 first)`);
    put('end', p.ended ? '1' : '0');
    if (p.redirect !== null) put('redirect', hex8(p.redirect));
    this.dp.setValues(sig, new Map());

    const wires = new Set(['pc', 'instr', 'dec_bcast', 'bcast', 'mask', ...Array.from({ length: L }, (_, l) => `bc${l}`),
      ...Array.from({ length: L - 1 }, (_, k) => `mask${k + 1}_${k}`)]);
    const elements = new Set(['sched', 'imem', 'dec', 'wctrl', 'cnt']);
    for (let l = 0; l < L; l++) {
      if (!((p.maskIn >>> l) & 1)) continue;
      elements.add(`ln${l}`);
      if (p.result[l] !== null) { wires.add(`ln${l}_g${l}`); wires.add(`g${l}_out`); elements.add(`g${l}`); }
    }
    if (p.taken !== null || p.pred !== null) wires.add('branch');
    if (p.ended || p.redirect !== null || ['tmc', 'wspawn', 'bar', 'join'].includes(p.op)) wires.add('end');
    if (p.op === 'lw' || p.op === 'sw') elements.add('dmem');
    this.dp.setPath(p.fault ? null : { wires, elements });
  }

  drawWarps() {
    const r = this.model.registers();
    const st = S.warpState;
    const stack = (w) => {
      const n = r[`w${w}_depth`];
      if (!n) return C.stackEmpty;
      return Array.from({ length: n }, (_, i) => C.entry(r[`w${w}_s${i}_kind`] === 1 ? 'R' : 'E', lanes0(r[`w${w}_s${i}_mask`], this.lanes),
        codeText(this.program, r[`w${w}_s${i}_pc`], this.model.c.imem[r[`w${w}_s${i}_pc`] >>> 2] ?? 0))).join(' · ');
    };
    const next = this.p?.w;
    this.warpBox.replaceChildren(el('table.listing.mem-table.gpu-warps-table', {},
      el('thead', {}, el('tr', {}, C.warpCols.map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, Array.from({ length: this.warps }, (_, w) => el(`tr${w === next ? '.gpu-next' : ''}`, {},
        el('th.mono', { scope: 'row', text: `${w}${w === next ? ' ▶' : ''}` }), el('td', { text: st[r[`w${w}_state`]] }),
        el('td.mono', { text: hex8(r[`w${w}_pc`]) }), el('td.mono', { text: lanes0(r[`w${w}_mask`], this.lanes) }),
        el('td.mono', { text: stack(w) }))))),
    el('p.note', { text: C.entryNote }));
  }

  drawIssue(p, code) {
    const L = this.lanes;
    if (!p) { this.issueBox.replaceChildren(el('p.note', { text: this.line.textContent })); return; }
    const R = C.issueRows;
    const rows = [[R.pc, hex8(p.pc)], [R.word, hex8(p.word)], [R.mask, lanes0(p.maskIn, L)]];
    if (p.pred !== null) rows.push([R.pred, lanes0(p.pred, L)]);
    if (p.taken !== null) rows.push([R.taken, p.taken ? C.yes : C.no]);
    if (p.op === 'tmc') rows.push([R.end, p.ended ? C.yes : C.no]);
    if (p.redirect !== null) rows.push([R.redirect, `${hex8(p.redirect)} (${codeText(this.program, p.redirect, this.model.c.imem[p.redirect >>> 2] ?? 0)})`]);
    if (!p.fault) rows.push([R.after, lanes0(p.maskOut, L)]);
    this.issueBox.replaceChildren(el('h4', { text: C.issueHeading(p.w, code) }),
      el('table.listing.mem-table', {}, el('tbody', {}, rows.map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td.mono', { text: v }))))),
      el('table.listing.mem-table', {}, el('thead', {}, el('tr', {}, C.laneCols.map((t) => el('th', { scope: 'col', text: t })))),
        el('tbody', {}, Array.from({ length: L }, (_, l) => {
          const on = (p.maskIn >>> l) & 1;
          const v = p.result[l];
          return el(`tr${on ? '' : '.lane-off'}`, {}, el('th.mono', { scope: 'row', text: String(l) }), el('td', { text: `${on} (${on ? C.on : C.off})` }),
            el('td.mono', { text: v === null ? C.none : signed(v) }), el('td.mono', { text: v === null || !on ? C.none : signed(v) }));
        }))));
  }

  /**
   * The one-lane card of narrow screens (decision G27): the mask strip of the coming issue, a button per lane (its bit
   * written 1 or 0), and the chosen lane's part of the issue: what it computes and whether the gate lets it write.
   */
  drawLane(p, code) {
    const L = this.lanes;
    const K = C.laneCard;
    if (this.lane >= L) this.lane = 0;
    const whole = el('button.btn', { type: 'button', 'aria-pressed': String(this.root.classList.contains('gpu-wide')), text: K.whole,
      onclick: () => { this.root.classList.toggle('gpu-wide'); this.drawLane(this.p, code); } });
    if (!p) { this.laneCard.replaceChildren(el('p.note', { text: this.line.textContent }), whole); return; }
    const go = (l) => { this.lane = (l + L) % L; this.drawLane(this.p, code); this.laneCard.querySelector(`[data-lane="${this.lane}"]`)?.focus(); };
    const strip = el('div.gpu-strip', { role: 'group', 'aria-label': K.strip },
      Array.from({ length: L }, (_, l) => {
        const b = (p.maskIn >>> l) & 1;
        return el(`button.gpu-bit.${b ? 'on' : 'off'}`, { type: 'button', 'data-lane': String(l), 'aria-pressed': String(l === this.lane),
          'aria-label': K.laneBtn(l, b), title: K.laneBtn(l, b), text: String(b), onclick: () => go(l) });
      }));
    const l = this.lane;
    const on = (p.maskIn >>> l) & 1;
    const v = p.result[l];
    const rows = [[K.rows.warp, String(p.w)], [K.rows.pc, hex8(p.pc)], [K.rows.instr, code], [K.rows.bit, `${on} (${on ? C.on : C.off})`],
      [K.rows.computes, v === null ? C.none : signed(v)], [K.rows.written, v === null || !on ? C.none : signed(v)]];
    this.laneCard.replaceChildren(
      el('div.gpu-lanehead', {}, el('h4', { text: K.heading(l, L) }),
        el('button.btn', { type: 'button', text: '◀', 'aria-label': K.prev, title: K.prev, onclick: () => go(l - 1) }),
        el('button.btn', { type: 'button', text: '▶', 'aria-label': K.next, title: K.next, onclick: () => go(l + 1) })),
      el('p.gm-title', { text: K.strip }), strip,
      el('table.listing.mem-table', {}, el('tbody', {}, rows.map(([k, x]) => el(`tr${on ? '' : '.lane-off'}`, {}, el('th', { scope: 'row', text: k }), el('td.mono', { text: x }))))),
      whole);
  }

  /** The mask grid: one row per issue so far, a cell per lane (FIG-0109's form), optionally only the work under a mask. */
  drawMasks() {
    const m = this.model;
    const { rows, hidden } = maskRows(m.issues, { program: this.program, lanes: this.lanes, masksOnly: this.masksOnly, setup: this.setup });
    this.masksBox.replaceChildren(...maskGrid({ rows, hidden, total: m.issues.length, lanes: this.lanes, warps: this.warps, masksOnly: this.masksOnly,
      onToggle: (on) => { this.masksOnly = on; this.drawMasks(); }, T: C }));
    showLast(this.masksBox);
  }

  /** The stack after each issue of one warp (FIG-0215's form). */
  drawStack() {
    const m = this.model;
    const L = this.lanes;
    const sel = this.warps > 1 ? el('label', {}, `${C.stackWarp} `, el('select', { onchange: (e) => { this.stackWarp = Number(e.target.value); this.drawStack(); } },
      Array.from({ length: this.warps }, (_, w) => el('option', { value: w, text: String(w), selected: w === this.stackWarp })))) : null;
    const rows = stackRows(m.issues, { program: this.program, lanes: L, warp: this.warps > 1 ? this.stackWarp : null });
    if (!rows.length) { this.stackBox.replaceChildren(el('div.npu-tools', {}, sel), el('p.note', { text: C.noIssues })); return; }
    const cut = Math.max(0, rows.length - GRID_ROWS);
    const entries = (s) => (s.length ? s.map((e) => el('span.gpu-entry.mono', { text: C.entry(e.kind, e.mask, codeText(this.program, e.pc, m.c.imem[e.pc >>> 2] ?? 0)) })) : el('span.note', { text: C.stackEmpty }));
    this.stackBox.replaceChildren(el('div.npu-tools', {}, sel),
      el('table.listing.gpu-grid.gpu-stack-table', {}, el('thead', {}, el('tr', {}, C.stackCols.map((t, i) => el('th', { scope: 'col', colspan: i === 2 ? L : null, text: t })))),
        el('tbody', {}, rows.slice(cut).map((r, i, all) => el(`tr${i === all.length - 1 ? '.gpu-last' : ''}`, {}, el('td.mono', { text: String(r.n) }),
          el('td.mono.gpu-code', { text: r.text }), [...r.mask].map((b, l) => el(`td.gpu-bit.${b === '1' ? 'on' : 'off'}`, { title: C.laneCell(l, b), text: b })),
          el('td.gpu-entries', {}, entries(r.stack)))))),
      cut ? el('p.note', { text: C.gridCut(cut) }) : null, el('p.note', { text: C.entryNote }));
    this.stackBox.querySelector('tr.gpu-last')?.scrollIntoView?.({ block: 'nearest' });
  }

  /** The counters of this program, and of the laboratory programs run from their templates. */
  drawResults() {
    const row = (name, r) => el('tr', {}, el('th.mono', { scope: 'row', text: name }), [r.cycles, r.issued, r.active, r.slots].map((v) => el('td.mono', { text: String(v) })),
      el('td.mono', { text: r.efficiency === null ? C.none : `${(100 * r.efficiency).toFixed(1)} %` }));
    const table = (rows) => el('table.listing.mem-table', {}, el('thead', {}, el('tr', {}, C.resultsCols.map((t) => el('th', { scope: 'col', text: t })))), el('tbody', {}, rows));
    if (!this.lab) {
      this.lab = this.templates.map(({ id, text }) => {
        const p = assemble([{ name: `${id}.s`, text }], { profile: 'lab' });
        if (!p.ok) return { id, failed: true };
        const mm = new CoreModel(p, { journal: 0 });
        const s = mm.run(100_000);
        return s === 'halt' && !mm.fault ? { id, r: results(mm.c) } : { id, failed: true };
      });
    }
    this.resultsBox.replaceChildren(el('h4', { text: C.resultsHeading }), table([row(C.thisProgram, results(this.model.c))]),
      el('h4', { text: C.resultsLab }), table(this.lab.filter((x) => !x.failed).map((x) => row(x.id, x.r))),
      ...this.lab.filter((x) => x.failed).map((x) => el('p.note', { text: C.resultsFailed(x.id) })),
      el('p.note', { text: C.resultsNote }));
  }
}

/** The view as the contract's ViewInstance (v4, v7: the drawing pans and zooms). */
export function coreInstance(v, ctx) {
  v.dp.setLinks({ sched: { panel: 'registers' }, wctrl: { panel: 'registers' }, dmem: { panel: 'memory' }, cnt: { tab: C.tabResults },
    ...Object.fromEntries(Array.from({ length: v.lanes }, (_, l) => [`ln${l}`, { tab: C.tabIssue }])) },
  (id) => ctx.openPanel?.(id === 'sched' || id === 'wctrl' ? { panel: 'registers' } : id === 'dmem' ? { panel: 'memory' } : { tab: id === 'cnt' ? C.tabResults : C.tabIssue }));
  const label = C.label(v.warps, v.lanes);
  const lanesFmt = (name, val) => (/mask$/.test(name) ? lanes0(val, v.lanes) : /_state$/.test(name) ? C.stateFormat[val] ?? String(val) : null);
  return {
    root: v.root, title: C.title(v.warps, v.lanes), infoTitle: C.infoTitle, status: v.status, headerTools: v.headerTools,
    diagrams: [v.dp.svg],
    tabs: [[C.tabIssue, v.issueBox], [C.tabMasks, v.masksBox, () => v.drawMasks()], [C.tabStack, v.stackBox, () => v.drawStack()],
      [C.tabResults, v.resultsBox, () => v.drawResults()]],
    load: (p) => v.load(p),
    reset: () => v.reset(),
    step: () => v.step(),
    back: () => v.back(),
    render: () => v.render(),
    state: () => {
      const m = v.model;
      if (!m) return null;
      const regs = m.registers();
      const last = m.journal.at(-1)?.res;
      const st = last?.stores?.length ? { address: last.stores[0][0] * 4, size: 4 } : null;
      // regs.pc is the PC of the warp that issues next: the instruction of the coming cycle (state() may come before render())
      return { pc: regs.pc, instruction: regs.pc, cycle: m.cycle, retired: m.c.issued, halted: m.halted, error: v.error(),
        dropped: m.dropped, registers: regs, changed: v.changed, written: st };
    },
    stopMessage: (stop) => (stop === STOP.HALT && v.model && !v.model.fault ? C.halted(v.model.cycle, v.model.c.issued) : null),
    breakAt: () => (v.model && !v.model.halted ? v.model.registers().pc : null),
    memoryPort: () => (v.model ? { read: (address, size) => {
      let x = 0;
      for (let i = size - 1; i >= 0; i--) { const a = (address + i) >>> 0; x = x * 256 + (((v.model.c.dmem[a >>> 2] ?? 0) >>> (8 * (a & 3))) & 0xff); }
      return x;
    } } : null),
    // before a program is loaded (the waveform tab asks for the signals): an empty program of the view's machine
    exportModel: () => exportModel(v.program ?? { profile: v.lanes === 8 ? 'lab-l8' : 'lab', segments: [], listing: [] }, label),
    waveform: { defaults: ['warp', 'pc', 'mask', ...Array.from({ length: v.warps }, (_, w) => [`w${w}_state`, `w${w}_mask`]).flat(), 'done', 'fault'], format: lanesFmt },
    revision: () => '',
  };
}
