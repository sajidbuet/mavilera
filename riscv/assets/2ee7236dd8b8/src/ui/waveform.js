// waveform.js -- the waveform panel of a datapath view (spec WS-F-146): chosen signals over the
// cycles run so far, as a timing diagram -- one-bit signals as a level, wider ones as a bus with
// its value -- built from the same signal records as the VCD export (core/exports.js recordFrames,
// WS-F-125). The axis orders clock cycles; it is not hardware timing. A cycle is selected with a
// click, or with the keyboard on the cycle buttons; a table of the same values serves screen
// readers (WS-U-031).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, store } from './dom.js';
import { STRINGS } from './strings.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const k of kids.flat()) if (k !== null && k !== undefined) n.append(k);
  return n;
};
const CW_MIN = 34; // width of a cycle: from this, wider when few cycles fill the panel
const CW_MAX = 76;
const RH = 22; // height of a row
const AXIS = 18; // height of the cycle axis
const MAX_SHOWN = 400; // cycles drawn (the last ones)
const hex = (v, width) => `${(v >>> 0).toString(16).padStart(Math.ceil(width / 4), '0')}`;

export class WaveformPanel {
  /**
   * @param {{id: string, signals: Array<{name, width, kind}>, defaults: string[],
   *   format?: (name: string, v: number) => string|null, onGoTo: (cycle: number) => void}} o
   */
  constructor({ id, signals, defaults, format = null, onGoTo }) {
    Object.assign(this, { id, signals, format, onGoTo });
    const W = STRINGS.wave;
    const key = `pips.wave.${id}`;
    let saved = null;
    try { saved = JSON.parse(store.get(key) ?? 'null'); } catch { /* none kept */ }
    const known = new Set(signals.map((s) => s.name));
    this.chosen = (Array.isArray(saved) ? saved : defaults).filter((n) => known.has(n));
    this.frames = [];
    this.current = 0;
    const pick = (s) => el('label.wave-pick', {}, el('input', { type: 'checkbox', checked: this.chosen.includes(s.name), onchange: (e) => {
      this.chosen = e.target.checked ? [...this.chosen, s.name] : this.chosen.filter((n) => n !== s.name);
      this.chosen = signals.map((x) => x.name).filter((n) => this.chosen.includes(n)); // the dictionary's order
      store.set(key, JSON.stringify(this.chosen));
      this.render();
    } }), ` ${s.name}`);
    const group = (kind, title) => el('fieldset.wave-group', {}, el('legend', { text: title }), signals.filter((s) => s.kind === kind).map(pick));
    this.picker = el('details.wave-picker', {}, el('summary', { text: W.signals }),
      el('div.wave-picks', {}, group('control', W.control), group('data', W.data)));
    this.labels = el('div.wave-labels', { 'aria-hidden': 'true' });
    this.plot = el('div.wave-plot', { tabindex: '0', 'aria-label': W.plotLabel });
    this.cycles = el('div.wave-cycles', { role: 'toolbar', 'aria-label': W.cyclesLabel });
    this.table = el('table.sr-only');
    this.root = el('div.wave', {},
      el('div.panel-tools.wave-tools', {}, this.picker, el('span.note', { text: W.note, title: W.note })),
      el('div.wave-body', {}, this.labels, this.plot),
      this.cycles, this.table);
    this.first = 0;
    this.cw = CW_MIN;
    this.plot.addEventListener('click', (e) => { // the column under the pointer, whatever shape is on top
      const r = this.plot.querySelector('svg')?.getBoundingClientRect();
      if (!r) return;
      const k = this.first + Math.floor((e.clientX - r.left) / this.cw);
      if (k >= 0 && k < this.frames.length) this.onGoTo(k);
    });
  }

  /** The records of cycles 0 to `current` (frames[k]: the signals of cycle k). */
  update(frames, current) {
    this.frames = frames;
    this.current = current;
    this.render();
  }

  text(s, v) {
    const f = this.format?.(s.name, v);
    if (f !== null && f !== undefined) return f;
    if (s.kind === 'control') return (v >>> 0).toString(2).padStart(s.width, '0');
    return s.width >= 8 ? hex(v, s.width) : String(v >>> 0);
  }

  render() {
    const W = STRINGS.wave;
    const sigs = this.chosen.map((n) => this.signals.find((s) => s.name === n));
    const n = this.frames.length;
    const first = Math.max(0, n - MAX_SHOWN);
    this.first = first;
    const shown = this.frames.slice(first);
    if (!n || !sigs.length) {
      this.labels.replaceChildren();
      this.plot.replaceChildren(el('p.note', { text: !n ? W.empty : W.none }));
      this.cycles.replaceChildren();
      this.table.replaceChildren();
      return;
    }
    const CW = Math.max(CW_MIN, Math.min(CW_MAX, Math.floor((this.plot.clientWidth || 600) / shown.length)));
    this.cw = CW;
    const width = shown.length * CW;
    const height = AXIS + sigs.length * RH;
    const g = svg('svg', { class: 'wave-svg', width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
      'aria-label': W.summary(sigs.length, first, n - 1) });
    // the cycle columns: axis numbers, the current one marked, a target for clicks
    shown.forEach((_, i) => {
      const k = first + i;
      const x = i * CW;
      g.append(svg('rect', { class: `wave-col${k === this.current ? ' now' : ''}`, x, y: 0, width: CW, height, 'data-cycle': k }));
      if (k % (shown.length > 60 ? 5 : 1) === 0) g.append(svg('text', { class: 'wave-num', x: x + CW / 2, y: 12 }, String(k)));
    });
    sigs.forEach((s, r) => {
      const top = AXIS + r * RH;
      const hi = top + 4;
      const lo = top + RH - 4;
      g.append(svg('line', { class: 'wave-sep', x1: 0, x2: width, y1: top + RH, y2: top + RH }));
      if (s.width === 1) {
        let d = '';
        shown.forEach((f, i) => {
          const y = (f[s.name] ?? 0) ? hi : lo;
          d += `${i ? 'L' : 'M'}${i * CW},${y}L${(i + 1) * CW},${y}`;
        });
        g.append(svg('path', { class: 'wave-bit', d }));
        return;
      }
      // a bus: one shape per run of equal values, the value written inside when it fits
      let i = 0;
      while (i < shown.length) {
        const v = shown[i][s.name] ?? 0;
        let j = i + 1;
        while (j < shown.length && (shown[j][s.name] ?? 0) === v) j++;
        const x0 = i * CW + 1;
        const x1 = j * CW - 1;
        const m = (hi + lo) / 2;
        const label = this.text(s, v);
        g.append(svg('path', { class: 'wave-bus', d: `M${x0},${m}L${x0 + 3},${hi}L${x1 - 3},${hi}L${x1},${m}L${x1 - 3},${lo}L${x0 + 3},${lo}Z` },
          svg('title', {}, `${s.name} = ${label} (${W.cycleRange(first + i, first + j - 1)})`)));
        if (label.length * 6.4 < x1 - x0 - 6) g.append(svg('text', { class: 'wave-val', x: (x0 + x1) / 2, y: m + 3.5 }, label));
        i = j;
      }
    });
    this.plot.replaceChildren(g);
    this.labels.replaceChildren(el('div.wave-label.axis', { text: W.cycle }), ...sigs.map((s) => el('div.wave-label.mono', { text: s.name, title: s.name })));
    // keep the current cycle in sight
    const x = (this.current - first) * this.cw;
    if (x < this.plot.scrollLeft || x + this.cw > this.plot.scrollLeft + this.plot.clientWidth) this.plot.scrollLeft = Math.max(0, x - this.plot.clientWidth / 2);
    // keyboard: earlier, later; and the table of the last cycles for screen readers
    this.cycles.replaceChildren(
      el('button', { type: 'button', text: W.earlier, disabled: this.current <= 0, onclick: () => this.onGoTo(this.current - 1) }),
      el('span.note', { text: W.at(this.current, n - 1) }),
      el('button', { type: 'button', text: W.later, disabled: this.current >= n - 1, onclick: () => this.onGoTo(this.current + 1) }));
    const last = this.frames.slice(Math.max(0, n - 16));
    const from = n - last.length;
    this.table.replaceChildren(el('caption', { text: W.tableCaption(from, n - 1) }),
      el('thead', {}, el('tr', {}, el('th', { text: W.signal }), last.map((_, i) => el('th', { text: String(from + i) })))),
      el('tbody', {}, sigs.map((s) => el('tr', {}, el('th', { text: s.name }), last.map((f) => el('td', { text: this.text(s, f[s.name] ?? 0) }))))));
  }
}
