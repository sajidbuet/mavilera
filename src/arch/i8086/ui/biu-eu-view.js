// i8086/ui/biu-eu-view.js -- the 8086 BIU/EU view (milestone 8086-B4; design docs/architecture/i8086-datapath.md): the
// drawing of ui/layout.js stepped one teaching-model step at a time on micro-model.js (microops.js, [EDU], the B3 design
// approved 2026-11-05). What is highlighted is the step the next click performs, over the values after the steps
// already performed (the SAP-2 bus view's convention). Every element names its source class in its tooltip: Intel
// (IFUM Fig 4-3), reverse engineering (Ken Shirriff) or added by the simulator (dashed). A step is not a clock. The
// drawing was approved by the author on 2026-11-05 (B4-Q1, with larger block names).
// Clock mode (milestone 8086-B5, B5-Q3 to Q6 approved 2026-11-05; design docs/architecture/i8086-biu.md): one click is
// one clock of biu-model.js (L2): the queue cells show the BIU's queue, the bus control block the T state and the bus
// cycle of the next clock, the EU control whether the EU performs its step or waits; the Queue tab (queue-panel.js)
// lists the cells, pointers and the last clocks. Wait states 0 to 3. Clock counts are the teaching model's, not the
// 8086's. The simulator's own drawing (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP } from '../../contract.js';
import { el, store } from '../../../ui/dom.js';
import { MicroModel } from '../micro-model.js';
import { ClockModel } from '../biu-model.js';
import { format, hexH } from '../isa.js';
import { I8086_STRINGS } from '../strings.js';
import { VIEW, FRAMES, BUS, SPINE, UNITS, DECODER, CELLS, FLAG_CELLS, STUBS, LINKS, ALU_INPUTS, PLACE_UNIT, PLACE_ROW, rowBox } from './layout.js';
import { QueuePanel, cycleText } from './queue-panel.js';

const D = I8086_STRINGS.datapath;
/** The view's settings (contract v5 View.settings, key `i8biu`): stored as the shell stores them. */
export const MODES = Object.freeze(['step', 'clock']);
export const WAITS = Object.freeze(['0', '1', '2', '3']);
const KEY = 'pips.i8biu.';
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}
const path = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const h4 = (v) => hexH(v & 0xffff, 4);
const h2 = (v) => hexH(v & 0xff, 2);
const xx = (v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0'); // a byte in a cell, without the H suffix
const FLAG_BIT = { OF: 11, DF: 10, IF: 9, TF: 8, SF: 7, ZF: 6, AF: 4, PF: 2, CF: 0 };
const tip = (id) => `${D.units[id]} (${D.classes[D.sources[id]]}): ${D.unitHelp[id]}. ${D.classLong[D.sources[id]]}.`;
const RE_ROWS = new Set(['IND', 'OPR', 'tmpA', 'tmpB', 'tmpC']);

const STYLE = `
.i8-view { flex: 1 1 0; min-height: 10rem; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.i8-svg { width: 100%; height: auto; max-height: 100%; font-family: var(--font-code); }
.i8-bg { fill: var(--surface); }
.i8-frame { fill: none; stroke: var(--border-strong); stroke-width: 1.2; stroke-dasharray: 10 4; }
.i8-frame-t { font: 700 15px var(--font-ui); fill: var(--muted); letter-spacing: 0.02em; }
.i8-box { fill: var(--fig-fill); stroke: var(--text); stroke-width: 1.1; }
.i8-unit.i8-edu .i8-box, .i8-edu-box { stroke-dasharray: 5 3; }
.i8-unit.i8-on > .i8-box { stroke: var(--primary); stroke-width: 2.2; }
.i8-ctrlbox { fill: var(--surface-2); }
.i8-name { font: 700 14px var(--font-ui); fill: var(--text); }
.i8-re { font: 600 9.5px var(--font-ui); fill: var(--muted); }
.i8-row { fill: transparent; stroke: none; }
.i8-row.i8-on { fill: var(--changed-bg); stroke: var(--primary); stroke-width: 1.4; }
.i8-rn { font-size: 13px; fill: var(--muted); }
.i8-rv { font-size: 14px; fill: var(--text); }
.i8-val { font-size: 17px; fill: var(--text); }
.i8-sub { font-size: 10.5px; fill: var(--muted); }
.i8-small { font: 10.5px var(--font-ui); fill: var(--muted); }
.i8-mid { font-size: 11.5px; fill: var(--text); }
.i8-bus { fill: var(--surface-3); stroke: var(--border-strong); }
.i8-bus.i8-on { fill: var(--primary-soft); stroke: var(--primary); stroke-width: 1.6; }
.i8-busname { font-size: 10.5px; fill: var(--text); }
.i8-stub { stroke: var(--border-strong); stroke-width: 3; fill: none; } .i8-head { fill: var(--border-strong); }
.i8-d.i8-edu .i8-stub { stroke-dasharray: 6 3; }
.i8-d.i8-on .i8-stub { stroke: var(--primary); stroke-width: 4; } .i8-d.i8-on .i8-head { fill: var(--primary); }
.i8-width { font-size: 9px; fill: var(--muted); } .i8-slash { stroke: var(--muted); stroke-width: 1; }
.i8-halo { fill: none; stroke: var(--surface); stroke-width: 8; }
.i8-cell { fill: var(--surface); stroke: var(--border-strong); }
.i8-cell.i8-empty { fill: none; stroke: var(--border); stroke-dasharray: 2 2; }
.i8-cell.i8-on { fill: var(--primary); stroke: var(--primary); }
.i8-cell-t { font-size: 11px; fill: var(--text); } .i8-cell-t.i8-on { fill: var(--primary-on); }
.i8-flag { fill: var(--surface); stroke: var(--border); } .i8-flag.i8-set { fill: var(--changed-bg); stroke: var(--primary); }
.i8-flag-t { font: 600 9.5px var(--font-ui); fill: var(--muted); } .i8-flag-v { font-size: 13px; fill: var(--text); }
.i8-adder { fill: var(--fig-fill); stroke: var(--text); stroke-width: 1.1; }
.i8-unit.i8-on > .i8-adder { stroke: var(--primary); stroke-width: 2.2; }
.i8-sigma { font-size: 26px; fill: var(--text); font-family: var(--font-ui); }
.i8-note { font: italic 10px var(--font-ui); fill: var(--warning); }
.i8-caption { font: 11px var(--font-ui); fill: var(--text); }
.i8-legend-d { stroke: var(--primary); stroke-width: 4; } .i8-legend-e { stroke: var(--border-strong); stroke-width: 3; stroke-dasharray: 6 3; }
.i8-tab table { border-collapse: collapse; } .i8-tab td, .i8-tab th { padding: 2px 8px; text-align: left; vertical-align: top; }
.i8-tab tr.i8-on td { background: var(--changed-bg); font-weight: 600; }
.i8-tab tr.i8-done td { color: var(--muted); }
.i8-tab p { margin: 0.4em 0; }
.i8-src { color: var(--muted); font-size: 0.9em; }
.i8-tab caption { text-align: left; font-weight: 600; padding: 0.4em 0 0.2em; }
.i8-tab th[scope="row"] { font-weight: 600; white-space: nowrap; }
.i8-cell.i8-stale { stroke: var(--warning); stroke-width: 2.2; }
`;

/** What one clock uses in the drawing (clock mode): the EU's step when it performs it or its bus request runs, the
 *  queue while it waits for a byte, and the code fetch on the bus. */
export function clockActivity(rec, step) {
  if (!rec) return activity(null);
  const busEu = rec.cycle && rec.cycle.kind !== 'code';
  const on = rec.performed || busEu ? activity(step) : activity(null);
  if (rec.eu === 'queue-wait') { on.units.add('QUEUE'); on.cells = true; }
  if (rec.cycle?.kind === 'code') {
    on.units.add('BUSCTL'); on.links.add('external');
    if (rec.t === 'T1') { on.links.add('address'); on.links.add('segment'); on.units.add('ADDER'); on.units.add('SEG'); on.rows.add('CS'); }
    if (rec.t === 'T4' && !rec.cycle.discard) { on.links.add('prefetch'); on.units.add('QUEUE'); }
  }
  return on;
}

/** The places a step reads and writes, and the parts of the drawing it uses. */
export function activity(step) {
  const on = { units: new Set(), rows: new Set(), stubs: new Set(), links: new Set(), cells: false, bus: false, spine: false, flush: false, decoder: false };
  if (!step) return on;
  const unitOf = (p) => (typeof p === 'number' ? null : PLACE_UNIT[p] ?? null);
  const src = (p) => {
    if (typeof p === 'number') { on.links.add('constant'); on.decoder = true; on.units.add('CTRL'); on.bus = true; return; }
    const u = unitOf(p);
    if (!u) return;
    on.units.add(u);
    on.rows.add(PLACE_ROW[p] ?? p);
    if (u === 'QUEUE') { on.cells = true; return; }
    if (u === 'CTRL') { on.decoder = true; return; }
    on.stubs.add(`${u}.out`); on.bus = true;
    if (u === 'SEG' || u === 'ICR') on.spine = true;
  };
  const dst = (p) => {
    const u = unitOf(p);
    if (!u) return;
    on.units.add(u);
    on.rows.add(PLACE_ROW[p] ?? p);
    if (u === 'CTRL') { on.decoder = true; return; }
    on.stubs.add(`${u}.in`); on.bus = true;
    if (u === 'SEG' || u === 'ICR') on.spine = true;
  };
  for (const t of step.transfers ?? []) {
    if (t.from === 'Q') {
      on.cells = true; on.units.add('QUEUE');
      if (t.to === 'decode') { on.links.add('qbus'); on.decoder = true; on.units.add('CTRL'); } else { on.links.add('qdata'); on.bus = true; dst(t.to); }
      continue;
    }
    if (t.from === 'Σ') { on.units.add('SIGMA'); on.rows.add('Σ'); on.stubs.add('SIGMA.out'); on.bus = true; dst(t.to); continue; }
    src(t.from); dst(t.to);
  }
  if (step.alu?.op === 'condition') { // FLAGS (or CX) tested by the control: no ALU result
    on.units.add('CTRL'); on.units.add('FLAGS'); on.rows.add('FLAGS'); on.links.add('condition');
  } else if (step.alu) {
    on.units.add('ALU'); on.units.add('SIGMA'); on.links.add('result');
    for (const [k, p] of [['a', step.alu.a], ['b', step.alu.b]]) {
      if (p === null || p === undefined) continue;
      src(p);
      on.stubs.add(`ALU.in.${k}`);
    }
    if (step.alu.flags) { on.links.add('flags'); on.units.add('FLAGS'); on.rows.add('FLAGS'); }
  }
  if (step.count) { on.units.add('TEMPS'); on.rows.add(step.count.place); }
  if (step.bus) {
    const r = step.bus;
    on.units.add('BUSCTL'); on.links.add('address'); on.links.add('external');
    if (r.op === 'read' || r.op === 'in') { on.links.add('opr-in'); on.rows.add('OPR'); on.units.add('ICR'); } else { on.links.add('opr-out'); on.rows.add('OPR'); on.units.add('ICR'); }
    if (r.op === 'read' || r.op === 'write') {
      on.units.add('ADDER');
      if (typeof r.segment === 'string' && PLACE_UNIT[r.segment] === 'SEG') { on.links.add('segment'); on.units.add('SEG'); on.rows.add(r.segment); }
    }
    if (r.offset === 'IND') { on.links.add('ind'); on.rows.add('IND'); if (r.op === 'read' || r.op === 'write') on.units.add('ADDER'); } else {
      on.links.add('offset'); src(r.offset); on.spine = true; on.units.add('ADDER');
    }
  }
  if (step.flush) on.flush = true;
  if (step.kind === 'hardwired' || step.kind === 'end') on.units.add('CTRL');
  if (step.kind === 'hardwired' && step.FLAGS !== undefined) { on.units.add('FLAGS'); on.rows.add('FLAGS'); }
  return on;
}

export class BiuEuView {
  constructor() {
    this.model = null; // the MicroModel: the view's own (step mode) or the clock model's
    this.cm = null; // the ClockModel in clock mode
    this.onChange = () => {};
    const saved = (k, list) => { const v = store.get(`${KEY}${k}`); return list.includes(v) ? v : list[0]; };
    this.options = { mode: saved('mode', MODES), wait: saved('wait', WAITS) };
    this.svg = s('svg', { class: 'i8-svg', viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, role: 'group', focusable: 'false' });
    this.status = el('span.dp-status.mono');
    this.stepsBox = el('div.i8-tab.scroll');
    this.queue = new QueuePanel();
    this.modeSel = el('select', { 'aria-label': D.mode, onchange: (e) => this.applyOptions({ mode: e.target.value }) },
      MODES.map((v) => el('option', { value: v, text: D.modes[v], selected: v === this.options.mode })));
    this.waitSel = el('select', { 'aria-label': D.waitStates, onchange: (e) => this.applyOptions({ wait: e.target.value }) },
      WAITS.map((v) => el('option', { value: v, text: v, selected: v === this.options.wait })));
    this.root = el('div.i8-view', {}, el('style', { text: STYLE }), this.svg);
    this.build();
  }

  get clockMode() { return this.options.mode === 'clock'; }

  /** Take over settings (the menus, share links); the program restarts. */
  applyOptions(o) {
    if (MODES.includes(o?.mode)) this.options.mode = o.mode;
    if (WAITS.includes(String(o?.wait))) this.options.wait = String(o.wait);
    for (const k of ['mode', 'wait']) store.set(`${KEY}${k}`, this.options[k]);
    this.modeSel.value = this.options.mode;
    this.waitSel.value = this.options.wait;
    this.load(this.program);
    this.onChange();
  }

  load(program) {
    this.program = program ?? null;
    this.waitSel.disabled = !this.clockMode;
    this.cm = program && this.clockMode ? new ClockModel(program, { waitStates: Number(this.options.wait) }) : null;
    this.model = this.cm ? this.cm.mm : program ? new MicroModel(program) : null;
    this.render();
  }

  reset() {
    if (this.cm) this.cm.reset(); else this.model?.reset();
    this.render();
  }

  build() {
    const g = [s('rect', { class: 'i8-bg', x: 0, y: 0, width: VIEW.w, height: VIEW.h })];
    const P = this.parts = { units: {}, rows: {}, stubs: {}, links: {}, cells: [], flags: [] };
    const arrow = ([x1, y1], [x2, y2]) => {
      const dx = Math.sign(x2 - x1);
      const dy = Math.sign(y2 - y1);
      return dx ? `M${x2} ${y2} l${-8 * dx} -4.5 v9 z` : `M${x2} ${y2} l-4.5 ${-8 * dy} h9 z`;
    };
    const width = (a, b, bits) => {
      const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const vertical = a[0] === b[0];
      return [s('line', { class: 'i8-slash', x1: mx - 4, y1: my + 4, x2: mx + 4, y2: my - 4 }),
        s('text', { class: 'i8-width', x: vertical ? mx + 6 : mx, y: vertical ? my + 3.5 : my - 6, 'text-anchor': vertical ? 'start' : 'middle' }, bits)];
    };

    // the unit frames (Intel's partition)
    for (const [id, f] of Object.entries(FRAMES)) {
      g.push(s('g', {}, s('title', {}, `${D.frames[id]} (${D.classes.intel}). ${D.classLong.intel}.`),
        s('rect', { class: 'i8-frame', x: f.x, y: f.y, width: f.w, height: f.h, rx: 10 }),
        s('text', { class: 'i8-frame-t', x: id === 'BIU' ? f.x + f.w - 10 : f.x + 12, y: id === 'BIU' ? f.y + 22 : f.y + f.h - 10, 'text-anchor': id === 'BIU' ? 'end' : 'start' }, D.frames[id])));
    }

    // the links first, under the units
    for (const l of LINKS) {
      const d = path(l.points);
      const a = l.points.at(-2); const b = l.points.at(-1);
      const node = s('g', { class: `i8-d${l.cls === 'edu' ? ' i8-edu' : ''}` }, s('title', {}, `${D.links[l.id]} (${D.classes[l.cls]})`),
        l.points.length > 2 ? s('path', { class: 'i8-halo', d }) : null, s('path', { class: 'i8-stub', d }),
        s('path', { class: 'i8-head', d: arrow(a, b) }), l.id === 'external' ? s('path', { class: 'i8-head', d: arrow(b, l.points[0]) }) : null,
        width(l.points[0], l.points[1], l.width));
      P.links[l.id] = node;
      g.push(node);
    }

    for (const u of Object.values(UNITS)) {
      const kids = [s('title', {}, tip(u.id))];
      const x0 = u.x + 8;
      if (u.id === 'ADDER') {
        // a trapezoid narrowing to the output at the right
        const pts = [[u.x, u.y], [u.x + u.w, u.y + 22], [u.x + u.w, u.y + u.h - 22], [u.x, u.y + u.h]];
        kids.push(s('path', { class: 'i8-adder', d: `${path(pts)} Z` }), s('text', { class: 'i8-sigma', x: u.x + 12, y: u.y + 44 }, 'Σ'),
          s('text', { class: 'i8-name', x: u.x + 36, y: u.y + 40 }, D.units.ADDER), s('text', { class: 'i8-small', x: u.x + 12, y: u.y + 64 }, D.adderText));
        P.units[u.id] = { g: null, addr: s('text', { class: 'i8-mid', x: u.x + 12, y: u.y + 84 }) };
        kids.push(P.units[u.id].addr);
      } else if (u.id === 'ALU') {
        const pts = [[u.x, u.y], [u.x + 70, u.y], [u.x + 90, u.y + 20], [u.x + 110, u.y], [u.x + u.w, u.y], [u.x + u.w - 36, u.y + u.h], [u.x + 36, u.y + u.h]];
        kids.push(s('path', { class: 'i8-adder', d: `${path(pts)} Z` }), s('text', { class: 'i8-name', x: u.x + 60, y: u.y + 44 }, D.units.ALU));
        P.units[u.id] = { op: s('text', { class: 'i8-mid', x: u.x + 46, y: u.y + 64 }), val: s('text', { class: 'i8-mid', x: u.x + 46, y: u.y + 80 }) };
        kids.push(P.units[u.id].op, P.units[u.id].val);
      } else {
        kids.push(s('rect', { class: `i8-box${u.id === 'CTRL' ? ' i8-ctrlbox' : ''}`, x: u.x, y: u.y, width: u.w, height: u.h, rx: 6 }),
          s('text', { class: 'i8-name', x: x0, y: u.y + 17 }, D.units[u.id]));
        P.units[u.id] = {};
        if (u.cls === 're') kids.push(s('text', { class: 'i8-re', x: u.x + u.w - 8, y: u.y + 17, 'text-anchor': 'end' }, 'RE'));
        for (const r of u.rows ?? []) {
          const b = rowBox(u.id, r);
          const rect = s('rect', { class: 'i8-row', x: b.x - 2, y: b.y, width: b.w + 4, height: b.h, rx: 3 });
          const val = s('text', { class: 'i8-rv', x: b.x + 52, y: b.y + 16 });
          kids.push(rect, s('text', { class: 'i8-rn', x: b.x + 2, y: b.y + 16 }, r), val);
          if (RE_ROWS.has(r)) kids.push(s('text', { class: 'i8-re', x: b.x + b.w - 2, y: b.y + 15, 'text-anchor': 'end' }, 'RE'));
          P.rows[r] = { rect, val };
        }
        if (u.id === 'SIGMA') { P.rows['Σ'] = { rect: s('rect', { class: 'i8-row', x: x0 - 2, y: u.y + 28, width: u.w - 12, height: 26, rx: 3 }), val: s('text', { class: 'i8-val', x: x0, y: u.y + 48 }) }; kids.push(P.rows['Σ'].rect, P.rows['Σ'].val, s('text', { class: 'i8-small', x: x0, y: u.y + 68 }, 'Σ')); }
        if (u.id === 'FLAGS') {
          P.rows.FLAGS = { rect: s('rect', { class: 'i8-row', x: u.x + 4, y: u.y + 24, width: u.w - 8, height: 46, rx: 3 }), val: s('text', { class: 'i8-small', x: u.x + u.w - 8, y: u.y + 17, 'text-anchor': 'end' }) };
          kids.push(P.rows.FLAGS.rect, P.rows.FLAGS.val);
          FLAG_CELLS.forEach((f, i) => {
            const x = u.x + 10 + i * 33;
            const r = s('rect', { class: 'i8-flag', x, y: u.y + 28, width: 30, height: 38, rx: 3 });
            const v = s('text', { class: 'i8-flag-v', x: x + 15, y: u.y + 61, 'text-anchor': 'middle' });
            kids.push(r, s('text', { class: 'i8-flag-t', x: x + 15, y: u.y + 41, 'text-anchor': 'middle' }, f), v);
            P.flags.push([f, r, v]);
          });
        }
        if (u.id === 'QUEUE') {
          for (const c of CELLS) {
            const r = s('rect', { class: 'i8-cell i8-empty', x: c.x, y: c.y, width: c.w, height: c.h, rx: 3 });
            const t = s('text', { class: 'i8-cell-t', x: c.x + c.w / 2, y: c.y + 22, 'text-anchor': 'middle' });
            kids.push(r, t, s('text', { class: 'i8-small', x: c.x + c.w / 2, y: c.y - 4, 'text-anchor': 'middle' }, String(c.index)));
            P.cells.push([r, t]);
          }
          P.units.QUEUE.note = s('text', { class: 'i8-small', x: x0 + 150, y: u.y + 17 });
          kids.push(P.units.QUEUE.note, s('text', { class: 'i8-small', x: CELLS[5].x + CELLS[5].w, y: u.y + u.h - 5, 'text-anchor': 'end' }, `${D.queueHead} →`));
        }
        if (u.id === 'BUSCTL') {
          P.units.BUSCTL.lines = [0, 1, 2, 3, 4].map((i) => s('text', { class: i === 0 ? 'i8-mid' : 'i8-sub', x: x0, y: u.y + 48 + i * 18 }));
          kids.push(...P.units.BUSCTL.lines);
        }
        if (u.id === 'CTRL') kids.push(...this.buildControl(u));
      }
      const node = s('g', { class: `i8-unit${u.cls === 'edu' ? ' i8-edu' : ''}` }, kids);
      P.units[u.id].g = node;
      g.push(node);
    }

    // the ALU data bus and its riser into the BIU
    this.busRect = s('rect', { class: 'i8-bus', x: BUS.x, y: BUS.y, width: BUS.w, height: BUS.h, rx: 3 });
    this.spineRect = s('rect', { class: 'i8-bus', x: SPINE.x, y: SPINE.y, width: SPINE.w, height: SPINE.h + BUS.h, rx: 3 });
    g.push(s('g', {}, s('title', {}, `${D.busName} (${D.classes.intel}). ${D.classLong.intel}.`), this.spineRect, this.busRect,
      s('text', { class: 'i8-busname', x: BUS.x + 40, y: BUS.y + 15 }, D.busName)));
    for (const st of STUBS) {
      const [a, b] = st.points;
      const key = st === ALU_INPUTS.a ? 'ALU.in.a' : st === ALU_INPUTS.b ? 'ALU.in.b' : `${st.unit}.${st.dir}`;
      const node = s('g', { class: 'i8-d' }, s('line', { class: 'i8-stub', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }), s('path', { class: 'i8-head', d: arrow(a, b) }), width(a, b, st.width));
      P.stubs[key] = node;
      g.push(node);
    }
    // labels of the links that leave the drawing or carry a name
    const ext = LINKS.find((l) => l.id === 'external');
    g.push(s('text', { class: 'i8-small', x: ext.points[1][0] - 4, y: ext.points[0][1] + 18, 'text-anchor': 'end' }, D.external));
    const qb = LINKS.find((l) => l.id === 'qbus');
    g.push(s('text', { class: 'i8-small', x: qb.points[0][0] - 8, y: qb.points[1][1] - 6, 'text-anchor': 'end' }, D.qbus));

    // the left column: what the drawing is, and the legend
    const lx = 22;
    g.push(s('text', { class: 'i8-frame-t', x: lx, y: 34 }, D.title), s('text', { class: 'i8-small', x: lx, y: 50 }, D.subtitle));
    const ly = 340;
    g.push(s('line', { class: 'i8-legend-d', x1: lx, y1: ly, x2: lx + 30, y2: ly }), s('text', { class: 'i8-small', x: lx + 36, y: ly + 4 }, D.legendData),
      s('line', { class: 'i8-legend-e', x1: lx, y1: ly + 20, x2: lx + 30, y2: ly + 20 }), s('text', { class: 'i8-small', x: lx + 36, y: ly + 24 }, D.legendAdded),
      s('text', { class: 'i8-re', x: lx + 8, y: ly + 44 }, 'RE'), s('text', { class: 'i8-small', x: lx + 36, y: ly + 44 }, D.legendRe.replace(/^RE: /, '')));
    this.caption = s('text', { class: 'i8-caption', x: lx, y: VIEW.h - 20 });
    g.push(this.caption);
    this.svg.replaceChildren(...g);
  }

  /** The EU control: the decoder (the simulator's place), the instruction, the next step. */
  buildControl(u) {
    const x0 = u.x + 12;
    const p = this.parts.units.CTRL;
    p.decoder = s('g', {}, s('title', {}, tip('DECODER')), s('rect', { class: 'i8-box i8-edu-box', x: DECODER.x, y: DECODER.y, width: DECODER.w, height: DECODER.h, rx: 4 }),
      s('text', { class: 'i8-name', x: DECODER.x + 8, y: DECODER.y + 16 }, D.units.DECODER));
    p.ins = s('text', { class: 'i8-mid', x: DECODER.x + 8, y: DECODER.y + 32 });
    p.bytes = s('text', { class: 'i8-sub', x: DECODER.x + 8, y: DECODER.y + 47 });
    p.stepOf = s('text', { class: 'i8-mid', x: x0, y: DECODER.y + DECODER.h + 40 });
    p.kind = s('text', { class: 'i8-mid', x: x0, y: DECODER.y + DECODER.h + 58 });
    p.lines = Array.from({ length: 7 }, (_, i) => s('text', { class: 'i8-sub', x: x0, y: DECODER.y + DECODER.h + 82 + i * 16 }));
    p.note = s('text', { class: 'i8-note', x: x0, y: u.y + u.h - 46 });
    p.note2 = s('text', { class: 'i8-note', x: x0, y: u.y + u.h - 32 });
    p.count = s('text', { class: 'i8-small', x: x0, y: u.y + u.h - 12 });
    p.label = s('text', { class: 'i8-small', x: x0, y: DECODER.y + DECODER.h + 22 }, D.stepLabel);
    return [p.decoder, p.ins, p.bytes, p.label, p.stepOf, p.kind, ...p.lines, p.note, p.note2, p.count];
  }

  render() {
    if (this.cm) { this.renderClock(); return; }
    const m = this.model;
    const P = this.parts;
    P.units.CTRL.label.textContent = D.stepLabel;
    const regs = m ? m.regs : null;
    const next = m?.next ?? null;
    const on = activity(next);

    this.drawRegisters(regs);
    // the queue: this instruction's bytes not yet taken (B4: no prefetch, design §4)
    const bytes = m && !m.cur.res.error ? m.cur.res.d.bytes : [];
    const taken = m ? m.steps.slice(0, m.k).reduce((n, st) => n + (st.transfers ?? []).filter((t) => t.from === 'Q').length, 0) : 0;
    const left = m?.halted ? [] : bytes.slice(taken, taken + 6);
    this.drawCells(on.flush ? [] : left, on.cells, false);
    P.units.QUEUE.note.textContent = on.flush ? D.flushed : '';
    this.drawAlu(next);

    // the bus request
    const r = next?.bus;
    const BL = P.units.BUSCTL.lines;
    if (r) {
      const io = r.op === 'in' || r.op === 'out';
      BL[0].textContent = D.busOps[r.op];
      BL[1].textContent = io ? `port ${h4(r.port)}` : `${r.segment}:${r.offset}`;
      BL[2].textContent = io ? '' : `${hexH(r.address, 5)}${r.size === 16 ? ` and ${hexH(r.address2, 5)}` : ''}`;
      BL[3].textContent = `${r.size} bits: ${r.size === 8 ? h2(r.value) : h4(r.value)}`;
      BL[4].textContent = '';
      P.units.ADDER.addr.textContent = io ? '' : hexH(r.address, 5);
    } else {
      BL.forEach((t, i) => { t.textContent = i === 0 && m ? D.idle : ''; });
      P.units.ADDER.addr.textContent = '';
    }

    // the control
    const C = P.units.CTRL;
    const d = m && !m.cur.res.error && !m.halted ? m.cur.res.d : null; // after HLT: nothing decoded (B4 item 7, author 2026-11-05)
    C.ins.textContent = d ? format(d, m.cur.ip) : m?.error ? '?' : '';
    C.bytes.textContent = d ? `${hexH(m.cur.cs, 4)}:${hexH(m.cur.ip, 4)}  ${d.bytes.map(xx).join(' ')}` : '';
    C.stepOf.textContent = m && next ? D.stepOf(m.k + 1, m.steps.length) : m?.halted ? D.halted : '';
    C.kind.textContent = next ? `${D.kinds[next.kind]}${next.iteration ? ` · ${D.iteration(next.iteration.n, next.iteration.of)}` : ''}` : '';
    const words = next ? describeStep(next) : [];
    C.lines.forEach((t, i) => { t.textContent = words[i] ?? ''; });
    const note = next?.note ? wrap(next.note, 36) : [];
    C.note.textContent = note[0] ?? ''; C.note2.textContent = note[1] ?? '';
    C.count.textContent = m ? D.counts(m.retired, m.count) : '';

    this.highlight(on);
    this.caption.textContent = m ? '' : D.noProgram;
    this.svg.setAttribute('aria-label', D.figureLabel(next ? `${D.stepOf(m.k + 1, m.steps.length)}: ${describeStep(next).join('; ')}` : ''));
    this.status.textContent = m?.halted && !m.error ? D.halted : m && d ? `${format(d, m.cur.ip)} · ${next ? D.stepOf(m.k + 1, m.steps.length) : D.halted}` : '';
    this.renderSteps();
    this.queue.render({ model: null, next: null, clockMode: false });
  }

  /** The queue cells of the drawing: `left` the bytes from the head; the head sits in the right-hand cell. */
  drawCells(left, headOn, stale) {
    this.parts.cells.forEach(([r, t], i) => {
      const b = left[5 - i];
      const has = b !== undefined;
      const on = has && headOn && i === 5;
      r.setAttribute('class', `i8-cell${has ? '' : ' i8-empty'}${on ? ' i8-on' : ''}${on && stale ? ' i8-stale' : ''}`);
      t.setAttribute('class', `i8-cell-t${on ? ' i8-on' : ''}`);
      t.textContent = has ? xx(b) : '';
    });
  }

  /** The registers, temporaries, Σ and flags: the values after the steps performed. */
  drawRegisters(regs) {
    const P = this.parts;
    for (const [r, row] of Object.entries(P.rows)) {
      if (r === 'FLAGS') { row.val.textContent = regs ? h4(regs.FLAGS) : ''; continue; }
      const v = regs ? regs[r] : null;
      if (v === null || v === undefined) { row.val.textContent = ''; continue; }
      row.val.textContent = ['AX', 'BX', 'CX', 'DX'].includes(r) ? `${h4(v)}  ${xx(v >> 8)}|${xx(v)}` : h4(v);
    }
    for (const [f, rect, v] of P.flags) {
      const bit = regs ? (regs.FLAGS >> FLAG_BIT[f]) & 1 : 0;
      v.textContent = regs ? String(bit) : '';
      rect.classList.toggle('i8-set', Boolean(regs) && bit === 1);
    }
  }

  /** The ALU of the step `next` (none: blank). */
  drawAlu(next) {
    const alu = next?.alu;
    this.parts.units.ALU.op.textContent = alu ? alu.op : '';
    this.parts.units.ALU.val.textContent = alu && alu.op !== 'condition' ? `Σ = ${h4(alu.value)}` : alu ? `→ ${alu.value ? 'yes' : 'no'}` : '';
  }

  highlight(on) {
    const P = this.parts;
    for (const [id, p] of Object.entries(P.units)) p.g.classList.toggle('i8-on', on.units.has(id));
    for (const [id, row] of Object.entries(P.rows)) row.rect.classList.toggle('i8-on', on.rows.has(id));
    for (const [key, node] of Object.entries(P.stubs)) node.classList.toggle('i8-on', on.stubs.has(key));
    for (const [key, node] of Object.entries(P.links)) node.classList.toggle('i8-on', on.links.has(key));
    this.busRect.classList.toggle('i8-on', Boolean(on.bus));
    this.spineRect.classList.toggle('i8-on', on.spine);
    P.units.CTRL.decoder.classList.toggle('i8-on', on.decoder);
  }

  /**
   * Clock mode: the values after the clocks run; what the next clock does (ClockModel.peek): its T state and bus cycle,
   * and whether the EU performs its step or waits.
   */
  renderClock() {
    const cm = this.cm;
    const m = this.model;
    const P = this.parts;
    const rec = cm.peek();
    const next = m.next;
    const on = clockActivity(rec, next);
    this.drawRegisters(m.regs);

    // the BIU's queue, head at the right; the byte the next clock takes is marked
    const q = cm.core.s.q.map((b) => b.v);
    this.drawCells(q, Boolean(rec?.took), Boolean(rec?.took?.stale));
    P.units.QUEUE.note.textContent = rec?.qs === 'E' ? D.flushed : D.queueBytes(q.length);
    this.drawAlu(rec?.performed ? next : null);

    // the bus control: the next clock's T state and cycle
    const BL = P.units.BUSCTL.lines;
    const c = rec?.cycle;
    if (c) {
      const io = c.kind === 'in' || c.kind === 'out';
      const cur = cm.core.s.cycle;
      const w = rec.t === 'Tw' ? (cur && cur.t === 'Tw' ? cur.w + 1 : 1) : 0;
      BL[0].textContent = `${D.tState(rec.t, w)} · ${D.cycleKinds[c.kind]}`;
      BL[1].textContent = io ? `port ${h4(c.address)}` : hexH(c.address, 5);
      BL[2].textContent = `${c.size} bits${c.discard ? `; ${D.discarded}` : ''}`;
      P.units.ADDER.addr.textContent = io ? '' : hexH(c.address, 5);
    } else {
      BL[0].textContent = rec ? D.busIdleT : '';
      BL[1].textContent = ''; BL[2].textContent = '';
      P.units.ADDER.addr.textContent = '';
    }
    BL[3].textContent = rec?.qs ? `QS ${rec.qs}: ${D.qs[rec.qs]}` : '';
    BL[4].textContent = `${D.waitStates}: ${cm.waitStates}`;

    // the control
    const C = P.units.CTRL;
    C.label.textContent = D.clockLabel;
    const d = !m.cur.res.error && !m.halted ? m.cur.res.d : null; // after HLT: nothing decoded
    C.ins.textContent = d ? format(d, m.cur.ip) : m.error ? '?' : '';
    C.bytes.textContent = d ? `${hexH(m.cur.cs, 4)}:${hexH(m.cur.ip, 4)}  ${d.bytes.map(xx).join(' ')}` : '';
    C.stepOf.textContent = rec ? `${D.clockOf(cm.clocks)} · ${D.stepOf(m.k + 1, m.steps.length)}` : m.halted ? D.halted : '';
    C.kind.textContent = rec && next ? `${D.kinds[next.kind]}: EU ${D.eu[rec.eu]}` : '';
    const words = next ? describeStep(next) : [];
    C.lines.forEach((t, i) => { t.textContent = words[i] ?? ''; });
    const note = rec?.took?.stale ? wrap(D.staleShort, 36) : next?.note ? wrap(next.note, 36) : [];
    C.note.textContent = note[0] ?? ''; C.note2.textContent = note[1] ?? '';
    C.count.textContent = D.clockCounts(cm.clocks, m.retired);

    this.highlight(on);
    this.caption.textContent = '';
    const what = rec ? `${D.clockOf(cm.clocks)}: ${D.tState(rec.t, 0)}${c ? `, ${cycleText(c)}` : ''}; EU ${D.eu[rec.eu]}${next ? `: ${describeStep(next).join('; ')}` : ''}` : '';
    this.svg.setAttribute('aria-label', D.figureLabel(what));
    this.status.textContent = m.halted && !m.error ? D.halted : d ? `${format(d, m.cur.ip)} · ${rec ? D.clockOf(cm.clocks) : D.halted}` : '';
    this.staleNow = Boolean(rec?.took?.stale || cm.last?.took?.stale);
    this.renderSteps();
    this.queue.render({ model: cm, next: rec, clockMode: true });
  }

  /** The Steps tab: the instruction's steps, those performed dimmed, the next one marked. */
  renderSteps() {
    const m = this.model;
    if (!m) { this.stepsBox.replaceChildren(); return; }
    const rows = m.steps.map((st, i) => el(`tr${i === m.k && !m.halted ? '.i8-on' : i < m.k ? '.i8-done' : ''}`, {},
      el('td.mono', { text: String(i + 1) }), el('td', { text: D.kinds[st.kind] }), el('td.mono', { text: describeStep(st).join('; ') }), el('td', { text: st.note ?? '' })));
    this.stepsBox.replaceChildren(...[
      el('p', {}, el('strong', { text: `${D.title}: ` }), el('span', { text: D.subtitle })),
      el('table.listing', {}, el('tbody', {}, rows)),
      el('p.i8-src', { text: D.notice }),
      this.cm ? el('p.i8-src', { text: D.clockNotice }) : null,
      this.cm && this.staleNow ? el('p.note', { text: D.stale }) : null].filter(Boolean));
  }
}

const WORD_OF = { AL: 'AX', AH: 'AX', BL: 'BX', BH: 'BX', CL: 'CX', CH: 'CX', DL: 'DX', DH: 'DX' };
const CPU = ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'CS', 'DS', 'ES', 'SS', 'IP', 'FLAGS'];

/**
 * The view as a ViewInstance for the shell (contract v4-v8): one click is one teaching-model step, or in clock mode one
 * clock of the teaching model (B5); neither is a clock of the 8086.
 */
export function biuEuInstance(v, ctx) {
  v.onChange = () => ctx.refresh?.();
  const headerTools = el('span.sb-tools', {},
    el('label.toggle', { title: D.modeTitle }, `${D.mode} `, v.modeSel),
    el('label.toggle', { title: D.waitTitle }, `${D.waitStates} `, v.waitSel),
    el('button', { type: 'button', text: D.backInstr, title: D.backInstrTitle, onclick: () => ctx.command?.('backUnit') }),
    el('button', { type: 'button', text: D.stepInstr, title: D.stepInstrTitle, onclick: () => ctx.command?.('stepUnit') }));
  const STOPS = { step: STOP.NONE, halt: STOP.HALT, error: STOP.ERROR };
  let line = ''; // console output (OUT 0E9H) is sent a line at a time; the console is a log and is not stepped back
  const flush = () => { if (line) { ctx.message?.(line); line = ''; } };
  const forward = (fn) => {
    const m = v.model;
    const before = m.output.length;
    const r = fn();
    for (const ch of m.output.slice(before)) { if (ch === '\n') flush(); else if (ch !== '\r') line += ch; }
    if (r !== 'step') flush();
    return STOPS[r];
  };
  return {
    root: v.root, title: D.title, infoTitle: D.infoTitle, status: v.status, headerTools,
    diagrams: [v.svg],
    tabs: [[D.tabSteps, v.stepsBox], [D.tabQueue, v.queue.root]],
    load: (p) => { line = ''; v.load(p); },
    reset: () => { line = ''; v.reset(); },
    step: () => forward(() => (v.cm ? v.cm.clock() : v.model.step())),
    back: () => (v.cm ? v.cm.back() : v.model?.back() ?? false),
    render: () => v.render(),
    options: { get: () => ({ ...v.options }), apply: (o) => v.applyOptions(o) },
    revision: () => `${v.options.mode}|${v.options.wait}`,
    state: () => {
      const m = v.model;
      if (!m) return null;
      // the step the last click performed: none when the last clock only waited
      const last = v.cm && !v.cm.last?.performed ? null : m.last;
      const changed = new Set();
      for (const t of last?.transfers ?? []) { const w = WORD_OF[t.to] ?? t.to; if (CPU.includes(w)) changed.add(w); }
      if (last?.transfers?.some((t) => t.from === 'Q')) changed.add('IP');
      if (last?.alu?.flags || (last?.kind === 'hardwired' && last.FLAGS !== undefined)) changed.add('FLAGS');
      const w = last?.bus?.op === 'write' ? last.bus : null;
      return { pc: m.cur.pc, instruction: m.cur.pc, cycle: v.cm ? v.cm.clocks : m.count, retired: m.retired, halted: m.halted, error: m.error,
        dropped: v.cm ? v.cm.dropped : m.dropped, registers: m.registers(), changed: [...changed],
        written: w ? { address: w.address, size: w.size / 8 } : null };
    },
    stopMessage: (r) => {
      const m = v.model;
      if (r !== STOP.HALT || !m) return null;
      const at = `${hexH(m.cur.cs, 4)}:${hexH(m.cur.ip, 4)}`;
      return v.cm ? D.haltedAtClock(at, m.retired, v.cm.clocks) : D.haltedAt(at, m.retired, m.count);
    },
    // a breakpoint is checked once per instruction: before its first step (clock mode: the clock after the previous
    // instruction finished, however long the EU then waits for the queue)
    breakAt: () => (v.cm ? (v.cm.atStart ? v.model.cur.pc : null) : v.model && v.model.k === 0 ? v.model.cur.pc : null),
    unit: { label: D.stepInstr,
      step: () => forward(() => (v.cm ? v.cm.stepInstruction() : v.model.stepInstruction())),
      back: () => (v.cm ? v.cm.backInstruction() : v.model?.backInstruction() ?? false) },
    dataAccess: () => {
      if (v.cm) { // the EU's memory cycle of the next clock
        const c = v.cm.peek()?.cycle;
        return c && (c.kind === 'read' || c.kind === 'write') ? { address: c.address, size: c.size / 8 } : null;
      }
      const r = v.model?.next?.bus;
      return r && (r.op === 'read' || r.op === 'write') ? { address: r.address, size: r.size / 8 } : null;
    },
    memoryPort: () => (v.model ? { read: (address, size) => { let x = 0; for (let i = size - 1; i >= 0; i--) x = x * 256 + v.model.byte(address + i); return x; } } : null),
  };
}

const place = (p) => (typeof p === 'number' ? hexH(p, 4) : p);
/** A step in register-transfer notation, as a list of short lines. */
export function describeStep(st) {
  const out = [];
  const val = (t) => (t.value === undefined ? '' : ` (${t.to && /^[A-D][LH]$/.test(t.to) || t.from === 'Q' ? h2(t.value) : h4(t.value)})`);
  if (st.alu) {
    const a = st.alu;
    out.push(a.op === 'condition' ? `test: ${a.value ? 'true' : 'false'}` : `Σ ← ${a.op}(${[a.a, a.b].filter((x) => x !== null && x !== undefined).map(place).join(', ')})`);
    if (a.flags) out.push('FLAGS ← flags of the result');
  }
  for (const t of st.transfers ?? []) {
    const part = t.part === 'lo' ? '[7:0]' : t.part === 'hi' ? '[15:8]' : '';
    out.push(`${t.to === 'decode' ? 'decoder' : t.to}${part} ← ${t.from === 'Q' ? 'queue' : place(t.from)}${t.part === 'sx' ? ' (sign-extended)' : ''}${t.to === 'decode' ? ` (${h2(t.value)})` : val(t)}`);
  }
  if (st.count) out.push(`${st.count.place} ← ${st.count.value} (count)`);
  if (st.bus) {
    const r = st.bus;
    out.push(r.op === 'in' || r.op === 'out' ? `${D.busOps[r.op]}: port ${place(r.offset)}` : `${D.busOps[r.op]}: ${r.segment}:${r.offset}`);
    out.push(r.op === 'read' || r.op === 'in' ? `OPR ← ${r.size === 8 ? h2(r.value) : h4(r.value)}` : `← OPR (${r.size === 8 ? h2(r.value) : h4(r.value)})`);
  }
  if (st.flush) out.push('queue flushed');
  if (st.kind === 'hardwired' && st.FLAGS !== undefined) out.push(`FLAGS ← ${h4(st.FLAGS)}`);
  if (st.kind === 'end') out.push('the next instruction starts');
  return out;
}

function wrap(text, n) {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) { if ((lines.at(-1) + ' ' + w).trim().length > n) lines.push(w); else lines[lines.length - 1] = `${lines.at(-1)} ${w}`.trim(); }
  return lines;
}
