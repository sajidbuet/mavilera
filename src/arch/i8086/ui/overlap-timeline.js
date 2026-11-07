// i8086/ui/overlap-timeline.js -- the Timeline tab of the 8086 BIU and EU view (milestone 8086-B6, B6-Q4 and Q5 approved
// by the author 2026-11-05; design docs/architecture/i8086-timeline.md §4): the clocks run so far in clock mode, from the
// ClockModel's journal, as two lanes -- the BIU's bus cycles (T states, kind, address) and the EU's instructions with the
// clocks in which it waits for the queue or for the bus -- with the queue length after each clock and the queue events
// F, S and E (IFUM Table 4-4) in the clock in which they happen; the next clock drawn faint. The layout idea of two
// activity lanes over a clock axis follows IFUM Figs 4-6 and 4-22; nothing of them is copied (C4). This is not a stage
// pipeline, and its clocks are the teaching model's (L2), not the 8086's. A table of the same rows is always present
// for screen readers and can be shown. Nothing is animated. The simulator's own code (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, store } from '../../../ui/dom.js';
import { format, hexH } from '../isa.js';
import { I8086_STRINGS } from '../strings.js';
import { cycleText } from './queue-panel.js';

const D = I8086_STRINGS.datapath;
const TL = I8086_STRINGS.timeline;
const NS = 'http://www.w3.org/2000/svg';
/** Clocks shown (a display preference of this browser, not a setting of links). */
export const WINDOWS = Object.freeze([32, 64, 128, 256]);
const WINDOW_KEY = 'pips.i8086.timelineClocks';
const TABLE_KEY = 'pips.i8086.timelineTable';
const CW = 26; // width of a clock column
const ROWS = Object.freeze({ axis: [0, 16], biu: [18, 44], eu: [66, 44], queue: [114, 48], events: [166, 18] }); // [top, height]
const HEIGHT = 186;
const QSTEP = 7; // pixels per queued byte
const xx = (v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');

function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const c of children.flat()) if (c !== null && c !== undefined) n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

/**
 * The rows of the timeline: one per journal entry ({rec, at}), plus the next clock (a record from ClockModel.peek, with
 * the instruction `nextAt`) marked `next`. Each row: {n, t, cycle, eu, qs, q, took, flushTo, finished, start, at, next}.
 */
export function timelineRows(entries, next = null, nextAt = null) {
  const rows = entries.map(({ rec, at }) => ({ ...pick(rec), at: at ?? null, next: false }));
  if (next) rows.push({ ...pick(next), at: nextAt, next: true });
  return rows;
}
const pick = (r) => ({ n: r.n, t: r.t, cycle: r.cycle, eu: r.eu, qs: r.qs, q: r.q, took: r.took ?? null, flushTo: r.flushTo ?? null,
  finished: r.finished, start: r.start ?? null, calibrated: r.calibrated ?? null });

/** The bus cycles over the rows: [{from, to, cycle}] (row indices, inclusive); a cycle begins at T1 and ends at T4. */
export function busSpans(rows) {
  const out = [];
  let cur = null;
  rows.forEach((r, i) => {
    if (!r.cycle) { cur = null; return; }
    if (!cur || r.t === 'T1') { cur = { from: i, to: i, cycle: r.cycle }; out.push(cur); } else cur.to = i;
    if (r.t === 'T4') cur = null;
  });
  return out;
}

/** The instructions over the rows: [{from, to, at}]; an instruction ends with the clock that finished it. */
export function instructionSpans(rows) {
  const out = [];
  let cur = null;
  rows.forEach((r, i) => {
    if (!cur) { cur = { from: i, to: i, at: r.at, calibrated: r.calibrated }; out.push(cur); } else cur.to = i;
    if (r.calibrated !== null && r.calibrated !== undefined) cur.calibrated = r.calibrated; // set from the instruction's first EU clock
    if (r.finished) cur = null;
  });
  return out;
}

// an interrupt entry (8086-B8) is named by its label
const insText = (at) => (at?.d ? format(at.d, at.ip) : at?.entry ? I8086_STRINGS.datapath.entry(I8086_STRINGS.interrupts.label[at.entry.kind](at.entry.type)) : '');

export class OverlapTimeline {
  constructor() {
    const saved = (k) => { try { return store.get(k); } catch { return null; } };
    const w = Number(saved(WINDOW_KEY));
    this.window = WINDOWS.includes(w) ? w : 64;
    this.tableShown = saved(TABLE_KEY) === '1';
    this.windowSel = el('select', { onchange: (e) => { this.window = Number(e.target.value); store.set(WINDOW_KEY, String(this.window)); this.render(this.last); } },
      WINDOWS.map((v) => el('option', { value: String(v), text: String(v), selected: v === this.window })));
    this.tableToggle = el('input', { type: 'checkbox', checked: this.tableShown, onchange: (e) => {
      this.tableShown = e.target.checked; store.set(TABLE_KEY, this.tableShown ? '1' : '0'); this.render(this.last);
    } });
    this.tools = el('p.i8t-tools', {}, el('label.toggle', {}, `${TL.shown} `, this.windowSel), ' ', el('label.toggle', {}, this.tableToggle, ` ${TL.showTable}`));
    this.labels = el('div.i8t-labels', { 'aria-hidden': 'true' },
      ...['biu', 'eu', 'queue', 'events'].map((k) => el('div.i8t-label', { text: TL.lanes[k], style: `top:${ROWS[k][0]}px;height:${ROWS[k][1]}px` })));
    this.plot = el('div.i8t-plot', { tabindex: '0', role: 'group', 'aria-label': TL.plotLabel }); // the arrow keys scroll it (WS-U-030)
    this.plot.addEventListener('click', (e) => {
      const svg = this.plot.querySelector('svg');
      if (!svg || !this.rows?.length) return;
      const i = Math.floor((e.clientX - svg.getBoundingClientRect().left) / CW);
      const r = this.rows[i];
      if (r && !r.next) this.last?.onGoTo?.(r.n);
    });
    this.legend = el('p.i8t-legend');
    this.body = el('div');
    this.root = el('div.i8-tab.scroll.i8t', {}, el('style', { text: STYLE }), this.body);
  }

  /** The tab is shown: the latest clocks in sight (a hidden box does not scroll). */
  show() { this.plot.scrollLeft = this.plot.scrollWidth; }

  /** Draw from {model: ClockModel | null, next: the next clock's record, clockMode, onGoTo(n), onClockMode()}. */
  render(arg) {
    this.last = arg;
    const { model: m, next, clockMode } = arg ?? {};
    const head = el('p', {}, el('strong', { text: TL.heading }));
    if (!clockMode || !m) {
      this.rows = [];
      this.body.replaceChildren(head, el('p', { text: TL.stepMode }),
        el('p', {}, el('button', { type: 'button', text: TL.toClock, onclick: () => arg?.onClockMode?.() })),
        el('p.i8-src', { text: TL.notPipeline }));
      return;
    }
    const entries = m.journal.slice(-this.window);
    const rows = timelineRows(entries, next, next ? m.instruction() : null);
    this.rows = rows;
    if (!rows.length) {
      this.body.replaceChildren(head, el('p', { text: TL.empty }), el('p.i8-src', { text: TL.notPipeline }));
      return;
    }
    const first = rows[0].n + 1;
    const lastRun = rows.filter((r) => !r.next).at(-1);
    const svg = this.draw(rows, first, lastRun ? lastRun.n + 1 : first);
    this.plot.replaceChildren(svg);
    this.legend.replaceChildren(
      el('span.i8t-key.i8t-k-q'), ` ${TL.legend.qwait} `, el('span.i8t-key.i8t-k-b'), ` ${TL.legend.bwait} `,
      el('span.i8t-key.i8t-k-d'), ` ${TL.legend.discard} `, el('span.i8t-key.i8t-k-n'), ` ${TL.next}`);
    const table = this.table(rows);
    this.body.replaceChildren(head, this.tools,
      el('div.i8t-strip', {}, this.labels, this.plot), this.legend,
      this.tableShown ? table : el('div.sr-only', {}, table),
      ...(arg.calibrated ? [el('p.i8-src', { text: TL.notPipelineCalibrated }), el('p.i8-src', { text: D.calibratedNotice })]
        : [el('p.i8-src', { text: TL.notPipeline })]),
      el('p.i8-src', { text: TL.eventsNote }));
    this.plot.scrollLeft = this.plot.scrollWidth; // the latest clocks; instant, nothing animated
  }

  draw(rows, a, b) {
    const W = rows.length * CW;
    const g = s('svg', { class: 'i8t-svg', width: W, height: HEIGHT, viewBox: `0 0 ${W} ${HEIGHT}`, role: 'img', 'aria-label': TL.figureLabel(a, b) },
      s('defs', {},
        s('pattern', { id: 'i8t-hq', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { class: 'i8t-hatch-q', x1: 0, y1: 0, x2: 0, y2: 6 })),
        s('pattern', { id: 'i8t-hb', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(-45)' }, s('line', { class: 'i8t-hatch-b', x1: 0, y1: 0, x2: 0, y2: 6 }))));
    const [bt, bh] = ROWS.biu; const [et, eh] = ROWS.eu; const [qt, qh] = ROWS.queue; const [vt, vh] = ROWS.events;
    // columns and the axis
    rows.forEach((r, i) => {
      const x = i * CW;
      g.append(s('rect', { class: `i8t-col${r.next ? ' i8t-next' : ''}`, x, y: 0, width: CW, height: HEIGHT },
        s('title', {}, r.next ? `${D.clockOf(r.n)} (${TL.next})` : TL.goTo(r.n + 1))));
      if ((r.n + 1) % (rows.length > 80 ? 5 : 1) === 0 || i === 0) g.append(s('text', { class: 'i8t-num', x: x + CW / 2, y: 12 }, String(r.n + 1)));
    });
    // BIU lane: bus cycles; T states in the cells
    for (const sp of busSpans(rows)) {
      const c = sp.cycle;
      const x0 = sp.from * CW + 1; const x1 = (sp.to + 1) * CW - 1;
      const cls = `i8t-cyc i8t-${c.kind === 'code' ? 'code' : c.kind === 'write' || c.kind === 'out' ? 'wr' : 'rd'}${c.discard ? ' i8t-disc' : ''}`;
      g.append(s('rect', { class: cls, x: x0, y: bt + 2, width: x1 - x0, height: bh - 18, rx: 3 }, s('title', {}, cycleText(c))));
      const label = `${TL.cycleShort[c.kind]} ${c.kind === 'in' || c.kind === 'out' ? hexH(c.address, 4) : hexH(c.address, 5)}`;
      if (label.length * 6.2 < x1 - x0 - 4) g.append(s('text', { class: 'i8t-cyc-t', x: (x0 + x1) / 2, y: bt + 16 }, label));
      else g.append(s('text', { class: 'i8t-cyc-t', x: (x0 + x1) / 2, y: bt + 16 }, TL.cycleShort[c.kind]));
    }
    rows.forEach((r, i) => g.append(s('text', { class: `i8t-t${r.t === 'Ti' ? ' i8t-ti' : ''}`, x: i * CW + CW / 2, y: bt + bh - 3 }, r.t)));
    // EU lane: instructions; waiting clocks hatched
    for (const sp of instructionSpans(rows)) {
      const x0 = sp.from * CW + 1; const x1 = (sp.to + 1) * CW - 1;
      // calibrated mode: an instruction without a calibrated row is marked (B7-Q4)
      const text = `${insText(sp.at)}${this.last?.calibrated && sp.calibrated === false ? ` (${D.notCalibrated})` : ''}`;
      g.append(s('rect', { class: 'i8t-ins', x: x0, y: et + 2, width: x1 - x0, height: eh - 4, rx: 3 }, s('title', {}, text)));
      const fit = Math.floor((x1 - x0 - 6) / 6.6);
      if (fit >= 3) g.append(s('text', { class: 'i8t-ins-t', x: x0 + 3, y: et + 14 }, text.length > fit ? `${text.slice(0, fit - 1)}…` : text));
    }
    rows.forEach((r, i) => {
      if (r.eu !== 'queue-wait' && r.eu !== 'bus-wait') return;
      g.append(s('rect', { class: r.eu === 'queue-wait' ? 'i8t-qwait' : 'i8t-bwait', x: i * CW + 2, y: et + 18, width: CW - 4, height: eh - 22 },
        s('title', {}, `${D.clockOf(r.n)}: EU ${D.eu[r.eu]}`)));
    });
    // queue length after each clock
    const base = qt + qh - 4;
    g.append(s('line', { class: 'i8t-grid', x1: 0, x2: W, y1: base, y2: base }), s('line', { class: 'i8t-grid', x1: 0, x2: W, y1: base - 6 * QSTEP, y2: base - 6 * QSTEP }));
    let d = '';
    rows.forEach((r, i) => { const y = base - r.q * QSTEP; d += `${i ? 'L' : 'M'}${i * CW},${y}L${(i + 1) * CW},${y}`; });
    g.append(s('path', { class: 'i8t-q', d }));
    rows.forEach((r, i) => g.append(s('text', { class: 'i8t-qn', x: i * CW + CW / 2, y: base - r.q * QSTEP - 2 }, String(r.q))));
    // queue events; a flush across the lanes
    rows.forEach((r, i) => {
      const x = i * CW + CW / 2;
      if (r.qs) g.append(s('text', { class: `i8t-ev${r.qs === 'E' ? ' i8t-e' : ''}`, x, y: vt + vh - 4 }, `${r.qs}${r.took?.stale ? '⚠' : ''}`, s('title', {}, `${r.qs}: ${D.qs[r.qs]}`)));
      if (r.qs === 'E') g.append(s('line', { class: 'i8t-flush', x1: (i + 1) * CW, x2: (i + 1) * CW, y1: bt, y2: vt }, s('title', {}, TL.flush)));
    });
    return g;
  }

  table(rows) {
    return el('table.listing', {},
      el('caption', { text: TL.caption(rows[0].n + 1, rows.at(-1).n + 1) }),
      el('thead', {}, el('tr', {}, TL.cols.map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, rows.map((r) => el(`tr${r.next ? '.i8-on' : ''}`, {},
        el('td.mono', {}, r.next ? `${r.n + 1} (${TL.next})` : el('button.link-btn.mono', { type: 'button', text: String(r.n + 1), title: TL.goTo(r.n + 1), onclick: () => this.last?.onGoTo?.(r.n) })),
        el('td.mono', { text: r.t }),
        el('td', { text: cycleText(r.cycle) }),
        el('td', { text: `${D.euShort[r.eu] ?? ''}${r.took ? ` (${xx(r.took.v)})` : ''}${r.took?.stale ? ` ⚠ ${D.staleShort}` : ''}` }),
        el('td.mono', { text: insText(r.at) }),
        el('td.mono', { text: String(r.q) }),
        el('td', { text: r.qs ? `${r.qs}: ${D.qs[r.qs]}` : '' })))));
  }
}

const STYLE = `
.i8t-strip { position: relative; display: flex; align-items: flex-start; margin: 0.4em 0; }
.i8t-labels { position: relative; flex: 0 0 6.5em; height: ${HEIGHT}px; }
.i8t-label { position: absolute; left: 0; right: 0.4em; display: flex; align-items: center; font: 600 11px var(--font-ui); color: var(--muted); }
.i8t-plot { flex: 1 1 auto; overflow-x: auto; cursor: pointer; }
.i8t-svg { display: block; font-family: var(--font-code); }
.i8t-col { fill: transparent; stroke: var(--border); stroke-width: 0.5; }
.i8t-col.i8t-next { fill: var(--surface-2); stroke-dasharray: 3 2; }
.i8t-num { font-size: 9.5px; fill: var(--muted); text-anchor: middle; }
.i8t-cyc { stroke-width: 1.2; }
.i8t-code { fill: var(--surface-3); stroke: var(--border-strong); }
.i8t-rd { fill: var(--primary-soft); stroke: var(--primary); }
.i8t-wr { fill: var(--changed-bg); stroke: var(--primary); }
.i8t-disc { stroke-dasharray: 4 3; fill-opacity: 0.4; }
.i8t-cyc-t { font-size: 10.5px; fill: var(--text); text-anchor: middle; }
.i8t-t { font-size: 9.5px; fill: var(--text); text-anchor: middle; } .i8t-ti { fill: var(--muted); }
.i8t-ins { fill: var(--fig-fill); stroke: var(--text); stroke-width: 0.9; }
.i8t-ins-t { font-size: 10.5px; fill: var(--text); }
.i8t-qwait { fill: url(#i8t-hq); stroke: var(--warning); stroke-width: 1; }
.i8t-bwait { fill: url(#i8t-hb); stroke: var(--primary); stroke-width: 1; }
.i8t-hatch-q { stroke: var(--warning); stroke-width: 2; } .i8t-hatch-b { stroke: var(--primary); stroke-width: 2; }
.i8t-grid { stroke: var(--border); stroke-dasharray: 2 3; }
.i8t-q { fill: none; stroke: var(--primary); stroke-width: 2; }
.i8t-qn { font-size: 9px; fill: var(--muted); text-anchor: middle; }
.i8t-ev { font-size: 11px; font-weight: 700; fill: var(--text); text-anchor: middle; } .i8t-e { fill: var(--warning); }
.i8t-flush { stroke: var(--warning); stroke-width: 1.6; stroke-dasharray: 5 3; }
.i8t-legend { font-size: 0.9em; color: var(--muted); }
.i8t-key { display: inline-block; width: 1.4em; height: 0.9em; vertical-align: middle; border: 1px solid var(--border-strong); }
.i8t-k-q { background: repeating-linear-gradient(45deg, var(--warning) 0 2px, transparent 2px 5px); border-color: var(--warning); }
.i8t-k-b { background: repeating-linear-gradient(-45deg, var(--primary) 0 2px, transparent 2px 5px); border-color: var(--primary); }
.i8t-k-d { border-style: dashed; }
.i8t-k-n { background: var(--surface-2); border-style: dashed; }
`;
