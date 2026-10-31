// compare-view.js -- the comparison view (spec §8.4, WS-F-060): the program
// of the editor on the processors of Chapters 6, 7 and 8, tabulated in the
// layout of tab:mc-compare and tab:pipe-compare (quantities as rows, one
// column per processor), with units and the label "illustrative delays".
// Loaded on demand when its tab is first opened (WS-N-011).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, store } from '../../../ui/dom.js';
import { STRINGS } from '../../../ui/strings.js';
import { compare, compareMemory, memoryCsv, ORGANISATIONS, SCENARIOS } from '../../../uarch/compare.js';
import { PREDICTORS } from '../../../uarch/pipe.js';
import { withJalr, fetchJalr } from '../../../uarch/ch07-jalr.js';

const S = STRINGS.compare;
const CHAPTER = { ch06: 6, ch07: 7, ch08: 8 };
const int = (v) => v.toLocaleString('en-GB');
const dec = (v, d) => v.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d });

/** Fetch the chapters' tables and delays from content/. */
export async function loadCompareContent(base) {
  const get = async (p) => {
    const r = await fetch(new URL(p, base));
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  };
  const [t6, delays6, t70, timing8, x] = await Promise.all([get('content/data/ch06-tables.json'), get('content/data/ch06-delays.json'),
    get('content/data/ch07-tables.json'), get('content/data/ch08-timing.json'), fetchJalr(base)]);
  const { t7, jalrAvailable } = withJalr(null, t70, x);
  return { t6, delays6, t7, timing8, jalrAvailable };
}

export class CompareView {
  constructor(data) {
    this.data = data;
    this.files = null;
    const saved = store.get('pips.compare.predictor');
    this.predictor = PREDICTORS.includes(saved) ? saved : 'none';
    this.jalr = data.jalrAvailable && store.get('pips.compare.jalr') === '1';
    const predSel = el('select', { 'aria-label': S.predictor, onchange: (e) => {
      this.predictor = e.target.value;
      store.set('pips.compare.predictor', this.predictor);
      this.update();
    } }, PREDICTORS.map((p) => el('option', { value: p, text: STRINGS.pipe.predictors[p], selected: p === this.predictor })));
    const jalrBox = el('input', { type: 'checkbox', checked: this.jalr, onchange: (e) => {
      this.jalr = e.target.checked;
      store.set('pips.compare.jalr', this.jalr ? '1' : '0');
      this.update();
    } });
    this.body = el('div.scroll.cmp-body', { 'aria-live': 'polite' });
    this.root = el('div.col', {},
      el('div.panel-tools', {},
        el('label.toggle', {}, `${S.predictor} `, predSel),
        data.jalrAvailable ? el('label.toggle', { title: STRINGS.multi.jalrTitle }, jalrBox, ` ${S.jalr}`) : null),
      this.body);
  }

  /** Compare the sources (null: nothing assembled). */
  load(files) {
    this.files = files;
    this.update();
  }

  update() {
    if (!this.files) { this.body.replaceChildren(el('p.note', { text: S.empty })); return; }
    const { rows } = compare(this.files, this.data, { jalr: this.jalr, predictor: this.predictor });
    const cell = (r, f) => (r.ok ? f(r) : '');
    const line = (label, f) => el('tr', {}, el('th', { scope: 'row', text: label }),
      rows.map((r) => el('td.mono.num', { text: cell(r, f) })));
    const head = el('tr', {}, el('th', { scope: 'col', text: S.colQuantity }), ORGANISATIONS.map((p) => el('th', { scope: 'col', text: S.columns[p] })));
    const failed = rows.filter((r) => !r.ok);
    const differ = rows.some((r) => r.agrees === false);
    this.body.replaceChildren(...[
      el('table.listing.sc-table.cmp-table', {},
        el('caption', { text: S.caption }),
        el('thead', {}, head),
        el('tbody', {},
          line(S.rows.n, (r) => int(r.n)),
          line(S.rows.cycles, (r) => int(r.cycles)),
          line(S.rows.cpi, (r) => (r.cpi === null ? '—' : dec(r.cpi, 3))),
          line(S.rows.tc, (r) => int(r.tc)),
          line(S.rows.perInstr, (r) => (r.cpi === null ? '—' : dec(r.cpi * r.tc, 1))),
          line(S.rows.time, (r) => dec(r.timePs / 1000, 2)),
          line(S.rows.speedup, (r) => (r.speedup === null ? '—' : dec(r.speedup, 2))),
          line(S.rows.agrees, (r) => (r.agrees === null ? '—' : r.agrees ? S.yes : S.no)),
          failed.length ? el('tr', {}, el('th', { scope: 'row', text: '' }),
            rows.map((r) => el('td.cmp-stop', { text: r.ok ? '' : S.errors[r.error](r.detail, CHAPTER[r.profile]) }))) : null)),
      failed.length ? el('p.note', { text: S.stoppedNote }) : null,
      differ ? el('p.note.cmp-differ', { text: S.differNote }) : null,
      el('p.note', { text: S.tcNote }),
      el('p.note', { text: S.cyclesNote }),
      el('p.note', { text: S.pipeNote }),
      ...this.memorySection()].filter(Boolean));
  }

  /** The memory setting of the interface (main.js gives it; null: the section is left out). */
  setMemory(cfg) {
    this.memCfg = cfg;
    if (this.files) this.update();
  }

  /** The three processors under the memory models A, B and C (D9): table, ratios, bar chart, CSV. */
  memorySection() {
    if (!this.memCfg) return [];
    const X = STRINGS.mem.cmp;
    const result = compareMemory(this.files, this.data, this.memCfg, { jalr: this.jalr, predictor: this.predictor, limit: MEMORY_LIMIT });
    this.memResult = result;
    const { rows } = result;
    const pct = (v) => (v === null || v === undefined ? '—' : `${dec(100 * v, 1)} %`);
    const ratio = (v) => (v === null ? '—' : dec(v, 2));
    const head = ['colProcessor', 'colScenario', 'colCycles', 'colRetired', 'colCpi', 'colIpc', 'colStallData', 'colStallFetch', 'colStallArb', 'colStallTotal',
      'colHitI', 'colHitD', 'colSame'].map((k) => el('th', { scope: 'col', text: X[k] }));
    const body = rows.map((r) => el(`tr${r.ok ? '' : '.cmp-fail'}`, {}, el('th', { scope: 'row', text: S.columns[r.profile] }), el('td', { text: X.scenarios[r.scenario] }),
      ...(r.ok ? [int(r.cycles), int(r.n), r.cpi === null ? '—' : dec(r.cpi, 3), r.ipc === null ? '—' : dec(r.ipc, 3), int(r.stalls.data), int(r.stalls.fetch),
        int(r.stalls.arbitration), int(r.stalls.total), pct(r.hit.I), pct(r.hit.D), r.sameResult === null ? '—' : r.sameResult ? X.yes : X.no].map((t) => el('td.mono.num', { text: t }))
        : [el('td.cmp-stop', { colSpan: 11, text: r.error === 'config' ? X.notBuilt(X.scenarioShort[r.scenario], r.detail) : S.errors[r.error]?.(r.detail, CHAPTER[r.profile]) ?? r.error })])));
    const rt = result.ratios;
    const ratios = el('table.listing.cmp-table', {}, el('caption', { text: X.ratiosCaption }),
      el('thead', {}, el('tr', {}, [X.colProcessor, X.ratioCA, X.ratioCB, X.ratioBA].map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, ORGANISATIONS.map((p) => el('tr', {}, el('th', { scope: 'row', text: S.columns[p] }),
        ...[rt.perProcessor[p].cOverA, rt.perProcessor[p].cOverB, rt.perProcessor[p].bOverA].map((v) => el('td.mono.num', { text: ratio(v) }))))));
    const vs = el('table.listing.cmp-table', {}, el('caption', { text: X.vsSingleCaption }),
      el('thead', {}, el('tr', {}, [X.colProcessor, ...SCENARIOS.map((s) => X.scenarios[s])].map((t) => el('th', { scope: 'col', text: t })))),
      el('tbody', {}, ORGANISATIONS.map((p) => el('tr', {}, el('th', { scope: 'row', text: S.columns[p] }),
        ...SCENARIOS.map((s) => el('td.mono.num', { text: ratio(rt.cpiVsSingle[s][p]) }))))));
    const problems = SCENARIOS.filter((s) => result.scenarios.problems[s].length).map((s) => X.notBuilt(s, result.scenarios.problems[s][0]));
    return [el('h3.cmp-h', { text: X.title }), el('p.note', { text: X.intro }), ...problems.map((t) => el('p.note.cmp-differ', { text: t })),
      el('div.scroll.cmp-memory', {}, el('table.listing.cmp-table.cmp-mem', {}, el('caption', { text: X.caption }), el('thead', {}, el('tr', {}, head)), el('tbody', {}, body))),
      cpiChart(rows), el('div.cmp-ratios', {}, ratios, vs),
      el('p.note', { text: X.cpiOnly }), el('p.note', { text: X.byDesign }),
      rows.some((r) => r.sameResult === false) ? el('p.note.cmp-differ', { text: X.differNote }) : null,
      el('button', { type: 'button', text: X.csv, onclick: () => this.onCsv?.(X.csvName, memoryCsv(result), result.rows.length) })];
  }
}

const MEMORY_LIMIT = 300_000; // cycles per run in the memory comparison; a longer run is reported as stopped by the limit
const SCENARIO_COLOUR = { A: 'var(--accent)', B: 'var(--insight)', C: 'var(--ui-warning)' };

/** CPI of each processor under A, B and C as grouped bars, each labelled with its value; the table above is its text form. */
function cpiChart(rows) {
  const X = STRINGS.mem.cmp;
  const ok = rows.filter((r) => r.ok && r.cpi !== null);
  if (!ok.length) return null;
  const W = 560; const H = 230; const L = 40; const B = 34; const T = 16;
  const max = Math.max(...ok.map((r) => r.cpi));
  const top = Math.ceil(max * 1.1);
  const y = (v) => H - B - ((H - B - T) * v) / top;
  const gw = (W - L) / ORGANISATIONS.length;
  const bw = Math.min(40, (gw - 24) / SCENARIOS.length);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    n.append(...kids.filter((k) => k !== null));
    return n;
  };
  const marks = [];
  for (let t = 0; t <= top; t += top > 8 ? Math.ceil(top / 6) : 1) {
    marks.push(svg('line', { x1: L, x2: W, y1: y(t), y2: y(t), class: 'cmp-grid' }), svg('text', { x: L - 6, y: y(t) + 4, class: 'cmp-tick', 'text-anchor': 'end' }, String(t)));
  }
  ORGANISATIONS.forEach((p, gi) => {
    const x0 = L + gi * gw + (gw - bw * SCENARIOS.length) / 2;
    SCENARIOS.forEach((s, si) => {
      const r = rows.find((q) => q.profile === p && q.scenario === s);
      if (!r?.ok || r.cpi === null) return;
      marks.push(svg('rect', { x: x0 + si * bw, y: y(r.cpi), width: bw - 3, height: H - B - y(r.cpi), fill: SCENARIO_COLOUR[s] },
        svg('title', {}, `${S.columns[p]}, ${X.scenarios[s]}: CPI ${dec(r.cpi, 3)}`)),
      svg('text', { x: x0 + si * bw + (bw - 3) / 2, y: y(r.cpi) - 3, class: 'cmp-val', 'text-anchor': 'middle' }, dec(r.cpi, 2)));
    });
    marks.push(svg('text', { x: L + gi * gw + gw / 2, y: H - 12, class: 'cmp-tick', 'text-anchor': 'middle' }, S.columns[p]));
  });
  const parts = ok.map((r) => `${S.columns[r.profile]} ${X.scenarioShort[r.scenario]} ${dec(r.cpi, 2)}`).join(', ');
  const legend = el('p.cmp-legend', {}, SCENARIOS.map((s) => el('span.cmp-key', {}, el('span.cmp-swatch', { style: `background:${SCENARIO_COLOUR[s]}` }), ` ${X.scenarios[s]}`)));
  return el('figure.cmp-chart', {}, el('figcaption', { text: X.chartTitle }),
    svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': X.chartLabel(parts), class: 'cmp-svg' }, ...marks), legend);
}
