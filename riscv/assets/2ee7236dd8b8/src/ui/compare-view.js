// compare-view.js -- the comparison view (spec §8.4, WS-F-060): the program
// of the editor on the processors of Chapters 6, 7 and 8, tabulated in the
// layout of tab:mc-compare and tab:pipe-compare (quantities as rows, one
// column per processor), with units and the label "illustrative delays".
// Loaded on demand when its tab is first opened (WS-N-011).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, store } from './dom.js';
import { STRINGS } from './strings.js';
import { compare, ORGANISATIONS } from '../uarch/compare.js';
import { PREDICTORS } from '../uarch/pipe.js';
import { withJalr, fetchJalr } from '../uarch/ch07-jalr.js';

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
      el('p.note', { text: S.pipeNote })].filter(Boolean));
  }
}
