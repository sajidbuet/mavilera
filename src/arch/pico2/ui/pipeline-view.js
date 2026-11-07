// pico2/ui/pipeline-view.js -- the pipeline view of the pico2 module (P1-M3; design docs/architecture/pico2-p1m3-pipeline.md §5):
// the approved drawing of Hazard3's F, X and M (geometry.js, decision Q6) stepped one clock cycle at a time on the stage model
// (uarch/session.js, stages.js, summary.js), with the tabs Stages, Diagram (instruction x cycle, live), Hazards (cycles by cause,
// CPI), BTB, Signals (every signal as a table: the text alternative of the drawing, WS-U-031) and Help; the shell's waveform
// tab and VCD export take their frames from the same stage model (capability waveform). Loaded on demand (WS-N-011). The
// values are the stage model's, built from the cost model's rules; the bus is perfect (Q4); the frontend has no prefetch
// buffer here (Q2). The simulator's own code and drawing (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP } from '../../contract.js';
import { el } from '../../../ui/dom.js';
import { decode, ABI } from '../core/decode.js';
import { K, KIND } from '../core/timing.js';
import { disassemble } from '../language.js';
import { PICO2_STRINGS } from '../strings.js';
import { XS, FS, MS, WHY, BYP, SIG, SIGNALS } from '../uarch/stages.js';
import { cpiByCause, hazardCounts, diagram, cycleInfo, CATEGORIES } from '../uarch/summary.js';
import { PipelineSession, WAVE_SIGNALS, WAVE_DEFAULTS, exportModel } from '../uarch/session.js';
import { VIEW, BANDS, BARS, UNITS, WIRES } from './geometry.js';

const P = PICO2_STRINGS.pipeline;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const h8 = (v) => `${((v >>> 16) & 0xffff).toString(16).padStart(4, '0')}_${(v & 0xffff).toString(16).padStart(4, '0')}`;
const hx = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const reg = (r) => (r ? ABI[r] : '—');
const pathOf = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');

const STYLE = `
.p2-view { flex: 1 1 0; min-height: 10rem; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.p2-svg { width: 100%; height: auto; max-height: 100%; font-family: var(--font-code); }
.p2-bg { fill: var(--surface); }
.p2-band { fill: var(--surface-2); }
.p2-band-t { font: 700 14px var(--font-ui); fill: var(--muted); }
.p2-bar { fill: var(--surface-3); stroke: var(--border-strong); }
.p2-bar-t { font-size: 11px; fill: var(--text); }
.p2-box { fill: var(--fig-fill); stroke: var(--text); stroke-width: 1.1; }
.p2-unit.p2-on > .p2-box { stroke: var(--primary); stroke-width: 2.4; }
.p2-name { font: 700 12.5px var(--font-ui); fill: var(--text); }
.p2-line { font-size: 11px; fill: var(--text); }
.p2-in { font-size: 9px; fill: var(--muted); }
.p2-sel { font-size: 9.5px; fill: var(--primary); }
.p2-w { fill: none; stroke: var(--border-strong); stroke-width: 2; }
.p2-w.p2-ctrl { stroke-width: 1.2; stroke-dasharray: 5 3; }
.p2-w.p2-fwd { stroke: var(--accent); }
.p2-head { fill: var(--border-strong); } .p2-fwdh { fill: var(--accent); }
.p2-wire.p2-on .p2-w { stroke: var(--primary); stroke-width: 3; } .p2-wire.p2-on .p2-head, .p2-wire.p2-on .p2-fwdh { fill: var(--primary); }
.p2-wire.p2-on .p2-w.p2-ctrl { stroke-width: 2; }
.p2-wl { font-size: 10.5px; fill: var(--muted); paint-order: stroke; stroke: var(--surface); stroke-width: 4px; stroke-linejoin: round; }
.p2-wire.p2-fwdw .p2-wl { fill: var(--accent); }
.p2-tab table { border-collapse: collapse; } .p2-tab td, .p2-tab th { padding: 2px 8px; text-align: left; vertical-align: top; }
.p2-tab caption { text-align: left; font-weight: 600; padding: 0.4em 0 0.2em; }
.p2-tab th[scope="row"] { font-weight: 600; white-space: nowrap; }
.p2-tab p { margin: 0.4em 0; max-width: 70em; } .p2-tab h3 { font-size: 1em; margin: 0.8em 0 0.2em; }
.p2-dg td, .p2-dg th { padding: 1px 3px; text-align: center; font-family: var(--font-code); min-width: 1.6em; }
.p2-dg td.p2-ins { text-align: left; white-space: nowrap; }
.p2-dg .p2-now { background: var(--changed-bg); }
.p2-dg button { font: inherit; padding: 0 2px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.p2-c1 { color: var(--muted); } .p2-c2 { font-weight: 700; color: var(--primary); } .p2-c3 { color: var(--text); } .p2-c4 { color: var(--warning); } .p2-c5 { color: var(--warning); text-decoration: line-through; }
.p2-mono { font-family: var(--font-code); }
`;

/** The parts of the drawing a cycle uses: units and wires by id. */
export function activity(info, xd, md) {
  const on = new Set();
  const w = new Set();
  if (!info) return { units: on, wires: w };
  const sig = info.sig;
  if (info.f.state !== FS.NONE) { on.add('FETCH'); on.add('NPC'); w.add('npcToFetch'); }
  if (info.f.state === FS.NEXT) { w.add('fetchToBar'); w.add('barToDec'); }
  if (sig & SIG.BTB_VALID) on.add('BTB');
  const xs = info.x.state;
  if (xd && (xs === XS.EXEC || xs === XS.STALL || xs === XS.UOP)) {
    on.add('DEC');
    const k = KIND[xd.op];
    if (info.rs1 || info.byp1 !== BYP.NONE) { on.add('RF'); on.add('BYP1'); w.add('rf1'); w.add('predecode'); }
    if (info.rs2 || info.byp2 !== BYP.NONE) { on.add('RF'); on.add('BYP2'); w.add('rf2'); w.add('predecode'); }
    if (info.byp1 === BYP.XM || info.byp2 === BYP.XM) { w.add('fwdXm'); if (info.byp2 === BYP.XM) w.add('fwdXm2'); }
    if (info.byp1 === BYP.MW || info.byp2 === BYP.MW) { w.add('fwdMw'); if (info.byp1 === BYP.MW) w.add('fwdMw2'); }
    if (k === K.LOAD || k === K.STORE || k === K.EXCL || k === K.AMO || k === K.PUSHPOP || k === K.POPRET || k === K.POPRETZ) {
      on.add('ADDR'); w.add('byp1Addr'); w.add('addrOut'); on.add('DBUS');
    }
    if (k === K.STORE) { w.add('storeData'); on.add('STD'); }
    if (k === K.BRANCH) { on.add('CMP'); on.add('ADDR'); w.add('byp1Addr'); w.add('byp1Cmp'); w.add('byp2Cmp'); w.add('taken'); w.add('target'); on.add('CTRL'); }
    if (k === K.JUMP) { on.add('ADDR'); w.add('target'); on.add('CTRL'); }
    if (k === K.DIV || k === K.DIVU || (k === K.ALU && xd.op >= 37 && xd.op <= 40)) { on.add('MULDIV'); w.add('mdOut'); }
    else if (k === K.ALU && xd.op >= 51 && xd.op <= 56) { on.add('CSR'); w.add('csrOut'); }
    else if (k === K.AMO) on.add('AMO');
    else if (k === K.ALU || k === K.SLT || k === K.MV) { on.add('ALU'); w.add('aluOut'); w.add('byp1Alu'); if (info.rs2) w.add('byp2Alu'); w.add('decImm'); }
    if (sig & (SIG.X_STALL | SIG.X_JUMP_REQ | SIG.X_BTB_SET)) on.add('CTRL');
  }
  if (sig & SIG.X_JUMP_REQ) w.add('jumpToF');
  if (sig & SIG.X_BTB_SET) { w.add('btbSet'); on.add('BTB'); }
  if (sig & SIG.X_BRANCH_WAS_PREDICTED) w.add('btbToNpc');
  if (info.m.state === MS.INSTR) {
    on.add('RES'); w.add('xmToRes');
    if (md) {
      const k = KIND[md.op];
      if (k === K.LOAD || k === K.EXCL || k === K.AMO) { on.add('DBUS'); w.add('busLoad'); }
      if (k === K.STORE) { on.add('DBUS'); on.add('STD'); }
    }
  }
  if (sig & SIG.M_REG_WEN) { w.add('regWrite'); w.add('resToBar'); w.add('barToMw'); on.add('RF'); }
  if (sig & SIG.M_TRAP_ENTER_VLD) { on.add('TRAP'); w.add('xmToTrap'); w.add('trapToF'); on.add('NPC'); }
  if (info.w.rd) on.add('MW');
  return { units: on, wires: w };
}

export class PipelineView {
  constructor() {
    this.session = null;
    this.program = null;
    this.goTo = () => {};
    this.svg = s('svg', { class: 'p2-svg', viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, role: 'group', focusable: 'false', 'aria-label': P.title });
    this.status = el('span.dp-status.mono');
    this.boxes = {
      stages: el('div.p2-tab.scroll'), diagram: el('div.p2-tab.scroll'), hazards: el('div.p2-tab.scroll'),
      btb: el('div.p2-tab.scroll'), signals: el('div.p2-tab.scroll'), help: el('div.p2-tab.scroll'),
    };
    this.root = el('div.p2-view', {}, el('style', { text: STYLE }), this.svg);
    this.build();
    this.buildHelp();
  }

  load(program) {
    this.program = program ?? null;
    let error = null;
    try { this.session = program ? new PipelineSession(program) : null; } catch (e) { this.session = null; error = String(e.message ?? e); }
    this.loadError = error;
    this.render();
  }
  reset() { this.session?.reset(); this.render(); }

  build() {
    const g = [s('rect', { class: 'p2-bg', x: 0, y: 0, width: VIEW.w, height: VIEW.h })];
    for (const b of BANDS) g.push(s('rect', { class: 'p2-band', x: b.x, y: 6, width: b.w, height: VIEW.h - 12, rx: 4 }), s('text', { class: 'p2-band-t', x: b.x + 6, y: 24 }, P.stages[b.id]));
    this.wires = {};
    for (const w of WIRES) {
      const a = w.pts.at(-2), b = w.pts.at(-1);
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      const head = dx ? `M${b[0]} ${b[1]} l${-8 * dx} -4 v8 z` : `M${b[0]} ${b[1]} l-4 ${-8 * dy} h8 z`;
      const node = s('g', { class: `p2-wire${w.kind === 'fwd' ? ' p2-fwdw' : ''}` },
        s('path', { class: `p2-w${w.kind === 'ctrl' ? ' p2-ctrl' : w.kind === 'fwd' ? ' p2-fwd' : ''}`, d: pathOf(w.pts) }),
        w.noHead === true ? null : s('path', { class: w.kind === 'fwd' ? 'p2-fwdh' : 'p2-head', d: head }),
        w.label ? s('text', { class: 'p2-wl', x: w.at[0], y: w.at[1] }, w.label) : null);
      this.wires[w.id] = node;
      g.push(node);
    }
    for (const b of BARS) {
      const cx = b.x + b.w / 2 + 4, cy = b.y + b.h / 2;
      g.push(s('g', {}, s('title', {}, P.bars[b.id]), s('rect', { class: 'p2-bar', x: b.x, y: b.y, width: b.w, height: b.h }),
        s('text', { class: 'p2-bar-t', x: cx, y: cy, transform: `rotate(-90 ${cx} ${cy})`, 'text-anchor': 'middle' }, P.bars[b.id])));
    }
    this.units = {};
    for (const u of UNITS) {
      const lines = [];
      let body;
      if (u.mux) {
        const { x, y, w, h } = u;
        body = [s('path', { class: 'p2-box', d: `M${x} ${y} L${x + w} ${y + 12} L${x + w} ${y + h - 12} L${x} ${y + h} Z` }),
          ...u.inputs.map((t, k) => s('text', { class: 'p2-in', x: x + 3, y: y + u.inY[k] + 3 }, t))];
        const t = s('text', { class: 'p2-sel', x: x + w / 2, y: y + h + 11, 'text-anchor': 'middle' }, '');
        lines.push(t); body.push(t);
      } else {
        body = [s('rect', { class: 'p2-box', x: u.x, y: u.y, width: u.w, height: u.h, rx: 3 }),
          s('text', { class: 'p2-name', x: u.x + 6, y: u.y + 16 }, P.units[u.id])];
        u.lines.forEach((_, k) => { const t = s('text', { class: 'p2-line', x: u.x + 6, y: u.y + 32 + k * 15 }, ''); lines.push(t); body.push(t); });
      }
      const node = s('g', { class: 'p2-unit' }, s('title', {}, `${P.units[u.id]}: ${P.unitHelp[u.id]}.`), ...body);
      this.units[u.id] = { node, lines, def: u };
      g.push(node);
    }
    this.svg.replaceChildren(...g);
  }

  buildHelp() {
    this.boxes.help.replaceChildren(...P.help.flatMap(([h, t]) => [el('h3', { text: h }), el('p', { text: t })]));
  }

  // ---- reading the model ----
  /** The decoded instruction of step s (null for an interrupt, sleep or ROM step). */
  decodedOf(stepNo) {
    const m = this.session.model;
    if (stepNo < m.slo || stepNo >= m.ns) return null;
    const i = m.stepAt(stepNo);
    return m.sLen[i] ? decode(m.sWord[i]) : null;
  }
  textOf(stepNo) {
    const m = this.session.model;
    if (stepNo < m.slo || stepNo >= m.ns) return '';
    const i = m.stepAt(stepNo);
    return m.sLen[i] ? disassemble(m.sWord[i], m.sPc[i]) : '';
  }
  info() {
    const ss = this.session;
    if (!ss || ss.cursor < ss.model.lo) return null;
    const inf = cycleInfo(ss.model, ss.cursor);
    // F of the newest instruction's cycles waits for the next step; that instruction is at the hart's pc
    if (inf.f.step < 0 && !ss.stop && ss.model.pendingF.includes(ss.cursor)) {
      inf.f.pc = ss.hart.pc >>> 0;
      if (inf.f.state === FS.NONE) inf.f.state = FS.NEXT;
    }
    return inf;
  }

  // ---- drawing ----
  render() {
    const ss = this.session;
    const inf = this.info();
    const xd = inf && inf.x.step >= 0 ? this.decodedOf(inf.x.step) : null;
    const md = inf && inf.m.step >= 0 ? this.decodedOf(inf.m.step) : null;
    const act = activity(inf, xd, md);
    for (const [id, u] of Object.entries(this.units)) {
      u.node.classList.toggle('p2-on', act.units.has(id));
      const vals = this.unitLines(id, inf, xd);
      u.lines.forEach((t, k) => { t.textContent = vals[k] ?? ''; });
    }
    for (const [id, n] of Object.entries(this.wires)) n.classList.toggle('p2-on', act.wires.has(id));
    if (ss) {
      const c = cpiByCause(ss.model, ss.model.slo, ss.cursor + 1);
      this.status.textContent = P.status(ss.cycle, ss.cycles, c.cpi ? c.cpi.toFixed(2) : '—');
    } else this.status.textContent = '';
    this.renderTabs(inf);
  }

  unitLines(id, inf, xd) {
    const L = P.lines;
    if (!inf) return [];
    const yes = (b) => (b ? '1' : '0');
    switch (id) {
      case 'FETCH': {
        const st = inf.f.state;
        if (st === FS.NONE) return [L.fNone];
        const text = this.fText(inf);
        return [L.fPc(h8(inf.f.pc)), text, st === FS.WRONG ? L.fWrong : st === FS.TARGET ? L.fTarget : L.fNext];
      }
      case 'NPC': return [inf.sig & SIG.M_TRAP_ENTER_VLD ? L.npcTrap : inf.sig & SIG.X_JUMP_REQ ? L.npcJump : inf.sig & SIG.X_BRANCH_WAS_PREDICTED ? L.npcBtb : L.npcSeq];
      case 'BTB': return [`btb_src_addr  ${inf.btb === -1 ? L.none : h8(inf.btb)}`, `btb_valid  ${yes(inf.btb !== -1)}`];
      case 'DEC': {
        const xs = inf.x.state;
        const state = xs === XS.EMPTY ? L.xEmpty : xs === XS.STALL ? L.xStall : xs === XS.SQUASH ? L.xSquash : xs === XS.SLEEP ? L.xSleep : xs === XS.UOP ? L.xUop(inf.x.uop) : L.xExec;
        const has = inf.x.step >= 0;
        const rep = inf.rep > 1 ? ` · ${L.repeat(inf.rep)}` : '';
        return [`d_pc  ${has ? h8(inf.x.pc) : L.none}`, has ? this.textOf(inf.x.step) : '', `d_rs1 ${reg(inf.rs1)}  d_rs2 ${reg(inf.rs2)}  d_rd ${reg(inf.rd)}`,
          `${state}${inf.x.why && xs !== XS.EXEC ? `: ${P.why[inf.x.why]}` : ''}${rep}`];
      }
      case 'RF': return [`rs1 ${reg(inf.rs1)}`, `rs2 ${reg(inf.rs2)}`];
      case 'BYP1': return [P.bypass[inf.byp1] === '—' ? '' : `x_rs1_bypass: ${['', 'regs', 'xm', 'mw', 'zero'][inf.byp1]}`];
      case 'BYP2': return [P.bypass[inf.byp2] === '—' ? '' : `x_rs2_bypass: ${['', 'regs', 'xm', 'mw', 'zero'][inf.byp2]}`];
      case 'ALU': return [xd && (KIND[xd.op] === K.ALU || KIND[xd.op] === K.SLT) && inf.x.state === XS.EXEC ? xd.mn : L.none];
      case 'ADDR': {
        if (!xd || inf.x.state === XS.EMPTY) return [L.none];
        const k = KIND[xd.op];
        return [k === K.BRANCH || k === K.JUMP ? L.addrJump : k === K.LOAD || k === K.STORE || k === K.EXCL || k === K.AMO || k >= K.PUSHPOP ? L.addrMem : L.none];
      }
      case 'CMP': return [xd && KIND[xd.op] === K.BRANCH && inf.x.state === XS.EXEC ? `${(inf.sig & SIG.X_JUMP_REQ) || (inf.sig & SIG.X_BRANCH_WAS_PREDICTED) ? '' : ''}${inf.sig & SIG.X_BRANCH_WAS_PREDICTED ? L.predicted : inf.sig & SIG.X_JUMP_REQ ? L.branchTaken : L.branchNot}` : L.none];
      case 'MULDIV': return [`x_stall_muldiv  ${yes(inf.sig & SIG.X_STALL_MULDIV)}`];
      case 'CSR': return [xd && xd.op >= 51 && xd.op <= 56 && inf.x.state === XS.EXEC ? `csr ${hx(xd.imm & 0xfff).slice(-3)}` : L.none];
      case 'AMO': return [`x_stall_on_amo  ${yes(inf.sig & SIG.X_STALL_ON_AMO)}`];
      case 'CTRL': return [`x_stall  ${yes(inf.sig & SIG.X_STALL)}`, L.cause(inf.x.why && inf.x.state !== XS.EXEC ? P.why[inf.x.why] : L.none),
        `x_jump_req  ${yes(inf.sig & SIG.X_JUMP_REQ)}`, `x_branch_was_predicted  ${yes(inf.sig & SIG.X_BRANCH_WAS_PREDICTED)}`, `x_btb_set  ${yes(inf.sig & SIG.X_BTB_SET)}`];
      case 'DBUS': {
        if (!xd) return [L.none, ''];
        const k = KIND[xd.op];
        return k === K.LOAD || k === K.EXCL || k === K.AMO ? [L.addrMem, L.busRead] : k === K.STORE ? [L.addrMem, L.busWrite] : [L.none, ''];
      }
      case 'RES': return [`xm_rd  ${reg(inf.m.rd)}`, `m_result  ${inf.sig & SIG.M_REG_WEN ? h8(inf.m.value) : L.none}`, `m_reg_wen  ${yes(inf.sig & SIG.M_REG_WEN)}`];
      case 'STD': return [inf.byp2 === BYP.MW && xd && KIND[xd.op] === K.STORE ? 'mw_result' : L.none];
      case 'TRAP': return [`m_trap_enter_vld  ${yes(inf.sig & SIG.M_TRAP_ENTER_VLD)}`, `m_trap_is_irq  ${yes(inf.sig & SIG.M_TRAP_IS_IRQ)}`, inf.sig & SIG.M_TRAP_ENTER_VLD ? L.trapTo('mtvec') : L.none];
      case 'MW': return [`mw_rd  ${reg(inf.w.rd)}`, `mw_result  ${inf.w.rd ? h8(inf.w.value) : L.none}`];
      default: return [];
    }
  }

  /** The instruction in F: a recorded step's, or (a wrong-path fetch, or the next instruction not run yet) the word at its pc. */
  fText(inf) { return inf.f.step >= 0 && inf.f.state !== FS.WRONG ? this.textOf(inf.f.step) : this.wordText(inf.f.pc); }

  wordText(pc) {
    const ss = this.session;
    if (!ss) return '';
    const b = ss.engine.peek(pc >>> 0, 4);
    const w = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) | 0;
    return disassemble((w & 3) === 3 ? w : w & 0xffff, pc);
  }

  // ---- the tabs ----
  renderTabs(inf) {
    const ss = this.session;
    const B = this.boxes;
    if (!ss || !inf) {
      const note = this.loadError ? el('p', { text: this.loadError }) : null;
      for (const k of ['stages', 'diagram', 'hazards', 'btb', 'signals']) B[k].replaceChildren(...(note ? [note.cloneNode(true)] : []));
      return;
    }
    // stages
    const L = P.lines;
    const fText = inf.f.state === FS.NONE ? L.fNone : `${h8(inf.f.pc)}  ${this.fText(inf)}`;
    const xs = inf.x.state;
    const xText = inf.x.step >= 0 ? `${h8(inf.x.pc)}  ${this.textOf(inf.x.step)}` : L.xEmpty;
    const mText = inf.m.state === MS.EMPTY ? L.xEmpty : `${h8(inf.m.pc)}  ${this.textOf(inf.m.step)}`;
    const row = (stage, holds, state, why) => el('tr', {}, el('th', { scope: 'row', text: stage }), el('td.p2-mono', { text: holds }), el('td', { text: state }), el('td', { text: why }));
    B.stages.replaceChildren(el('table', {}, el('caption', { text: P.status(ss.cycle, ss.cycles, '') .replace(/ · CPI $/, '') }),
      el('thead', {}, el('tr', {}, ...[P.stageCol, P.holdsCol, P.stateCol, P.whyCol].map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {},
        row(P.stageNames.F, fText, inf.f.state === FS.WRONG ? L.fWrong : inf.f.state === FS.TARGET ? L.fTarget : inf.f.state === FS.NONE ? '' : L.fNext, ''),
        row(P.stageNames.X, xText, xs === XS.EMPTY ? L.xEmpty : xs === XS.STALL ? L.xStall : xs === XS.SQUASH ? L.xSquash : xs === XS.SLEEP ? L.xSleep : xs === XS.UOP ? L.xUop(inf.x.uop) : L.xExec,
          `${xs === XS.EXEC ? '' : P.why[inf.x.why]}${inf.rep > 1 ? ` (${L.repeat(inf.rep)})` : ''}`),
        row(P.stageNames.M, mText, inf.m.state === MS.TRAP || (inf.sig & SIG.M_TRAP_ENTER_VLD) ? P.why[inf.sig & SIG.M_TRAP_IS_IRQ ? WHY.IRQ : WHY.TRAP] : inf.sig & SIG.M_REG_WEN ? `${reg(inf.m.rd)} ← ${hx(inf.m.value)}` : '', ''),
        row(P.stageNames.W, inf.w.rd ? `${reg(inf.w.rd)} = ${hx(inf.w.value)}` : L.none, '', ''))));
    // diagram
    const dg = diagram(ss.model, 12, Math.min(ss.model.ns, ss.stepOf(ss.cursor) + 4));
    const head = el('tr', {}, el('th', { scope: 'col', text: P.diagramInstr }), ...dg.cycles.map((c) => el(`th${c.record === ss.cursor ? '.p2-now' : ''}`, { scope: 'col' },
      el('button', { type: 'button', text: String(c.record), title: P.goCycle(c.record), 'aria-label': P.goCycle(c.record), onclick: () => this.goTo(c.record) }))));
    const rows = dg.rows.map((r) => el('tr', {}, el('td.p2-ins', { text: `${h8(r.pc)} ${r.len ? disassemble(r.word, r.pc) : P.why[WHY.IRQ]}` }),
      ...[...r.cells].map((code, k) => el(`td.p2-c${code}${dg.cycles[k].record === ss.cursor ? '.p2-now' : ''}`, { text: P.cellShort[code] ?? '', title: P.cellNames[code] ?? '' }))));
    B.diagram.replaceChildren(el('table.p2-dg', {}, el('caption', { text: P.diagramCaption }), el('thead', {}, head), el('tbody', {}, ...rows)));
    // hazards
    const c = cpiByCause(ss.model, ss.model.slo, ss.cursor + 1);
    const hz = hazardCounts(ss.model);
    B.hazards.replaceChildren(
      el('table', {}, el('caption', { text: `${P.hazardsCaption}: ${P.totals(c.cycles, c.instructions, c.cpi ? c.cpi.toFixed(3) : '—')}` }),
        el('thead', {}, el('tr', {}, ...[P.causeCol, P.cyclesCol, P.cpiCol].map((t) => el('th', { scope: 'col', text: t })))),
        el('tbody', {}, ...CATEGORIES.map((k) => el('tr', {}, el('th', { scope: 'row', text: P.categories[k] }), el('td', { text: String(c.byCause[k]) }),
          el('td', { text: c.instructions ? (c.byCause[k] / c.instructions).toFixed(3) : '—' }))))),
      el('table', {}, el('thead', {}, el('tr', {}, el('th', { scope: 'col', text: P.causeCol }), el('th', { scope: 'col', text: P.countCol }))),
        el('tbody', {}, ...Object.entries(hz).map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: P.hazards[k] }), el('td', { text: String(v) }))))));
    // BTB
    B.btb.replaceChildren(el('table', {}, el('caption', { text: P.btbCaption }), el('tbody', {},
      el('tr', {}, el('th', { scope: 'row', text: P.btbValid }), el('td', { text: inf.btb === -1 ? '0' : '1' })),
      el('tr', {}, el('th', { scope: 'row', text: P.btbSrc }), el('td.p2-mono', { text: inf.btb === -1 ? P.btbEmpty : `${hx(inf.btb)}  ${this.wordText(inf.btb)}` })))),
    el('p', { text: P.btbNote }));
    // signals
    B.signals.replaceChildren(el('table', {}, el('caption', { text: P.signalsCaption }),
      el('thead', {}, el('tr', {}, ...[P.stageCol, P.signalCol, P.valueCol, P.meaningCol].map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, ...SIGNALS.map((sg) => {
        const v = ss.model.signal(sg.name, ss.cursor);
        const text = sg.enum ? P.bypass[v] : sg.width === 1 ? String(v) : sg.width === 5 ? reg(v) : hx(v);
        return el('tr', {}, el('td', { text: sg.stage }), el('th.p2-mono', { scope: 'row', text: sg.name }), el('td.p2-mono', { text }), el('td', { text: P.signalHelp[sg.name] }));
      }))));
  }
}

/** The view as a ViewInstance (contract v4-v8): one click is one clock cycle of the stage model. */
export function pipelineInstance(v, ctx) {
  v.goTo = (n) => ctx.goToCycle?.(n);
  const headerTools = el('span.sb-tools', {},
    el('button', { type: 'button', text: P.backInstr, title: P.backInstrTitle, onclick: () => ctx.command?.('backUnit') }),
    el('button', { type: 'button', text: P.stepInstr, title: P.stepInstrTitle, onclick: () => ctx.command?.('stepUnit') }));
  const ss = () => v.session;
  return {
    root: v.root, title: P.title, infoTitle: P.infoTitle, status: v.status, headerTools,
    diagrams: [v.svg],
    tabs: [[P.tabStages, v.boxes.stages], [P.tabDiagram, v.boxes.diagram], [P.tabHazards, v.boxes.hazards], [P.tabBtb, v.boxes.btb],
      [P.tabSignals, v.boxes.signals], [P.tabHelp, v.boxes.help]],
    waveform: { defaults: [...WAVE_DEFAULTS], format: (name, val) => (name === 'x_rs1_bypass' || name === 'x_rs2_bypass' ? ['', 'regs', 'xm', 'mw', 'zero'][val] ?? null : null) },
    exportModel: () => ({ model: v.program ? exportModel(v.program) : null, signals: WAVE_SIGNALS, module: 'hazard3', label: P.wave.label }),
    load: (p) => v.load(p),
    reset: () => v.reset(),
    step: () => (ss() ? ss().forward() : STOP.ERROR),
    back: () => ss()?.back() ?? false,
    render: () => v.render(),
    state: () => {
      const x = ss();
      if (!x) return null;
      const st = x.engine.state();
      const last = x.engine.last();
      const inf = v.info();
      return { pc: st.pc, instruction: inf && inf.x.step >= 0 ? inf.x.pc : st.pc, cycle: x.cycle, retired: st.retired, halted: x.stop === STOP.HALT,
        error: x.stop === STOP.ERROR ? st.error : null, dropped: x.model.lo, registers: st.registers,
        changed: last && x.cursor === x.model.n - 1 ? last.registers.map((r) => r.id) : [] };
    },
    stopMessage: (r) => {
      const x = ss();
      if (r !== STOP.HALT || !x) return null;
      const st = x.engine.state();
      return P.haltedAt(hx(st.pc), st.retired, x.hart.ticks);
    },
    counters: () => {
      const x = ss();
      if (!x) return [];
      const c = cpiByCause(x.model, x.model.slo, x.cursor + 1);
      const stalls = c.byCause.loadUse + c.byCause.exclusive + c.byCause.multi;
      return [[P.counters.cycles, x.hart.ticks], [P.counters.records, x.cycle], [P.counters.instructions, x.engine.state().retired],
        [P.counters.cpi, c.cpi ? Number(c.cpi.toFixed(3)) : 0], [P.counters.stalls, stalls], [P.counters.bubbles, c.byCause.jump + c.byCause.mispredict + c.byCause.fetch]];
    },
    // a breakpoint is checked before the next instruction enters X: at the newest instruction's last cycle
    breakAt: () => { const x = ss(); return x && !x.stop && x.cursor === x.model.n - 1 ? x.hart.pc >>> 0 : null; },
    unit: { label: P.stepInstr, step: () => (ss() ? ss().forwardInstruction() : STOP.ERROR), back: () => ss()?.backInstruction() ?? false },
    memoryPort: () => (ss() ? { read: (address, size) => { const b = ss().engine.peek(address >>> 0, size); let x = 0; for (let i = size - 1; i >= 0; i--) x = x * 256 + b[i]; return x; } } : null),
  };
}
