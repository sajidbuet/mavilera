// mem-ui.js -- the memory setting dialog, the Cache tab and the Peripherals tab of the shared memory
// panel (docs/architecture/memory-hierarchy.md §11 phase 5c, D7, D8). The setting is a draft until it
// is applied; an invalid draft cannot be applied and its problems are listed. The viewer reads the
// caches without counting an access (mem-viewmodel.js).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8 } from './dom.js';
import { STRINGS } from './strings.js';
import { WORD_SIZES, CACHE_PRESETS, defaultConfig, validateConfig, fullWays } from '../mem/config.js';
import { MAIN_PRESETS } from '../mem/timing.js';
import { REPLACEMENT, validateCache } from '../mem/cache.js';
import { splitBar } from './cache-view.js';

const M = () => STRINGS.mem; // read when used: the architecture's strings are merged in after this module loads
const SIZES = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const BLOCKS = [4, 8, 16, 32, 64, 128];
const kib = (b) => (b >= 1024 ? `${b / 1024} KiB` : `${b} B`);
const log2 = (n) => Math.log2(n);

const geomOf = (c) => {
  const sets = c.size / (c.block * c.ways);
  const assoc = c.ways === 1 ? M().direct : sets === 1 ? M().full : M().nWay(c.ways);
  return { text: `${kib(c.size)}, ${c.block}-byte blocks, ${assoc.toLowerCase()}, ${sets} set${sets === 1 ? '' : 's'}`,
    tagBits: 32 - log2(sets) - log2(c.block), indexBits: log2(sets), offsetBits: log2(c.block) };
};

export class MemSettings {
  /** @param {{get: () => object, onApply: (cfg: object) => void}} o */
  constructor({ get, onApply }) {
    this.get = get;
    this.onApply = onApply;
    this.body = el('div.mem-form');
    this.problems = el('div.mem-problems', { role: 'alert' });
    this.applyBtn = el('button.primary', { type: 'button', text: M().apply, onclick: () => this.apply() });
    this.root = el('dialog.mem-dialog', { 'aria-labelledby': 'mem-title' },
      el('h2', { id: 'mem-title', text: M().title }), el('p.note', { text: M().intro }), this.body, this.problems,
      el('div.dialog-actions', {}, this.applyBtn,
        el('button', { type: 'button', text: M().toIdeal, onclick: () => { this.draft = defaultConfig(); this.render(); } }),
        el('button', { type: 'button', text: M().cancel, onclick: () => this.root.close() })));
  }

  open() {
    this.draft = structuredClone(this.get());
    this.render();
    this.root.showModal();
  }

  apply() {
    if (validateConfig(this.draft).length) return;
    this.root.close();
    this.onApply(this.draft);
  }

  /** Change the draft and draw again, keeping the keyboard focus on the same control. */
  set(fn) {
    const k = document.activeElement?.dataset?.k;
    fn(this.draft);
    this.render();
    if (k) this.body.querySelector(`[data-k="${k}"]`)?.focus();
  }

  select(k, value, options, onchange) {
    return el('select', { 'data-k': k, onchange: (e) => this.set(() => onchange(e.target.value)) },
      options.map(([v, t]) => el('option', { value: String(v), text: t, selected: String(v) === String(value) })));
  }

  number(k, value, onchange) {
    return el('input', { type: 'number', min: 0, step: 1, value: String(value), 'data-k': k, class: 'mem-num', onchange: (e) => this.set(() => onchange(Number(e.target.value))) });
  }

  field(label, control) { return el('label.mem-field', {}, el('span', { text: label }), control); }

  render() {
    const d = this.draft;
    const parts = [
      el('fieldset', {}, el('legend', { text: M().modeLegend }),
        ...['ideal', 'main', 'cache'].map((m) => el('label.mem-radio', {}, el('input', { type: 'radio', name: 'mem-mode', checked: d.mode === m, 'data-k': `mode-${m}`,
          onchange: () => this.set(() => { d.mode = m; }) }), ` ${M().modes[m]}`))),
      this.field(M().size, this.select('words', d.words, WORD_SIZES.map((w) => [w, M().sizeOption(w)]), (v) => { d.words = Number(v); })),
      el('p.note', { text: M().sizeNote }),
      el('label.mem-radio', {}, el('input', { type: 'checkbox', checked: d.devices, 'data-k': 'devices', onchange: (e) => this.set(() => { d.devices = e.target.checked; }) }), ` ${M().devices}`),
      el('p.note', { text: M().devicesNote }),
    ];
    if (d.mode !== 'ideal') parts.push(this.mainSection(d));
    if (d.mode === 'cache') {
      parts.push(this.field(M().writeBuffer, this.select('wbuf', d.writeBuffer, [['none', M().wbNone], ['ideal', M().wbIdeal]], (v) => { d.writeBuffer = v; })),
        this.cacheSection('l1i', 'L1I', d.l1i), this.cacheSection('l1d', 'L1D', d.l1d));
    }
    this.body.replaceChildren(...parts);
    const bad = validateConfig(d);
    this.problems.replaceChildren(...(bad.length ? [el('p', { text: M().problems }), el('ul', {}, bad.map((m) => el('li', { text: m })))] : []));
    this.applyBtn.disabled = bad.length > 0;
  }

  mainSection(d) {
    const m = d.main;
    const preset = MAIN_PRESETS.find((p) => p.id === m.preset);
    const custom = (k) => (v) => { m[k] = v; m.preset = 'custom'; };
    const wordR = m.overhead + m.readLatency + Math.ceil(4 / Math.max(m.busWidth, 1));
    const wordW = m.overhead + m.writeLatency + Math.ceil(4 / Math.max(m.busWidth, 1));
    return el('fieldset', {}, el('legend', { text: M().mainLegend }),
      this.field(M().preset, this.select('preset', m.preset, [...MAIN_PRESETS.map((p) => [p.id, p.name]), ['custom', M().custom]], (v) => {
        const p = MAIN_PRESETS.find((x) => x.id === v);
        if (p) Object.assign(m, { preset: p.id, overhead: p.overhead, readLatency: p.readLatency, writeLatency: p.writeLatency, busWidth: p.busWidth });
        else m.preset = 'custom';
      })),
      preset ? el('p.note', { text: preset.note }) : null,
      el('div.mem-grid', {},
        this.field(M().overhead, this.number('overhead', m.overhead, custom('overhead'))),
        this.field(M().readLatency, this.number('readLatency', m.readLatency, custom('readLatency'))),
        this.field(M().writeLatency, this.number('writeLatency', m.writeLatency, custom('writeLatency'))),
        this.field(M().busWidth, this.number('busWidth', m.busWidth, custom('busWidth')))),
      el('p.note', { text: `${M().transactionNote(wordR, wordW)} ${M().presetsNote}` }),
      this.field(M().ports, this.select('ports', d.ports, [[1, M().portsOne], [2, M().portsTwo]], (v) => { d.ports = Number(v); })));
  }

  cacheSection(key, name, c) {
    const matching = CACHE_PRESETS.find((p) => ['size', 'block', 'ways', 'repl', 'write', 'hit'].every((k) => p[k] === c[k]) && (p.alloc ?? null) === (c.alloc ?? null));
    const sets = c.size / (c.block * c.ways);
    const assoc = c.ways === 1 ? '1' : c.ways === fullWays(c.size, c.block) ? 'full' : String(c.ways);
    const assocOptions = [['1', M().direct], ...[2, 4, 8, 16].map((n) => [String(n), M().nWay(n)]), ['full', M().full]];
    if (!assocOptions.some(([v]) => v === assoc)) assocOptions.push([assoc, M().nWay(c.ways)]);
    const sizes = SIZES.includes(c.size) ? SIZES : [...SIZES, c.size].sort((a, b) => a - b);
    const blocks = BLOCKS.includes(c.block) ? BLOCKS : [...BLOCKS, c.block].sort((a, b) => a - b);
    const wasFull = assoc === 'full';
    const g = Number.isFinite(sets) && validateCache(c).length === 0 ? geomOf(c) : null;
    return el('fieldset.mem-cache', {}, el('legend', { text: M().cacheLegend(name) }),
      el('label.mem-radio', {}, el('input', { type: 'checkbox', checked: c.on, 'data-k': `${key}-on`, onchange: (e) => this.set(() => { c.on = e.target.checked; }) }), ` ${M().cacheOn}`),
      c.on ? [
        this.field(M().cachePreset, this.select(`${key}-preset`, matching?.id ?? 'custom', [...CACHE_PRESETS.map((p) => [p.id, p.name]), ['custom', M().custom]], (v) => {
          const p = CACHE_PRESETS.find((x) => x.id === v);
          if (p) Object.assign(c, { size: p.size, block: p.block, ways: p.ways, repl: p.repl, write: p.write, alloc: p.alloc ?? null, hit: p.hit, seed: p.seed ?? 1 });
        })),
        el('div.mem-grid', {},
          this.field(M().cacheSize, this.select(`${key}-size`, c.size, sizes.map((s) => [s, kib(s)]), (v) => { c.size = Number(v); if (wasFull) c.ways = fullWays(c.size, c.block); })),
          this.field(M().cacheBlock, this.select(`${key}-block`, c.block, blocks.map((s) => [s, `${s} B`]), (v) => { c.block = Number(v); if (wasFull) c.ways = fullWays(c.size, c.block); })),
          this.field(M().cacheAssoc, this.select(`${key}-ways`, assoc, assocOptions, (v) => { c.ways = v === 'full' ? fullWays(c.size, c.block) : Number(v); })),
          this.field(M().repl, this.select(`${key}-repl`, c.repl, REPLACEMENT.map((r) => [r, M().replNames[r]]), (v) => { c.repl = v; })),
          c.repl === 'random' ? this.field(M().seed, this.number(`${key}-seed`, c.seed, (v) => { c.seed = v; })) : null,
          this.field(M().write, this.select(`${key}-write`, c.write, Object.entries(M().writeNames), (v) => { c.write = v; })),
          this.field(M().alloc, this.select(`${key}-alloc`, c.alloc ?? '', Object.entries(M().allocNames), (v) => { c.alloc = v === '' ? null : v; })),
          this.field(M().hit, this.number(`${key}-hit`, c.hit, (v) => { c.hit = v; }))),
        g ? [el('p.note', { text: M().geometry(g) }), splitBar(g)] : null,
      ] : null);
  }
}

export class PeripheralsView {
  /** @param {{root: HTMLElement, update: (hart: object) => void}|null} platformView the board of the profile iss-priv */
  constructor(platformView = null) {
    this.platformView = platformView;
    this.root = el('div.periph-view.scroll');
  }

  update({ memsys, cfg, words, dev = null }) {
    const rows = [];
    const map = (dev?.memsys ?? memsys)?.maps?.[0];
    if (map) {
      for (const r of [...map.regions].sort((a, b) => a.lo - b.lo)) {
        rows.push([r.name, r.wrap ? '0x00000000' : hex8(r.base), r.wrap ? '0xffffffff' : hex8(r.base + r.size - 1), M().kinds[r.kind], r.wrap ? M().wraps(r.size / 4) : '']);
      }
    } else {
      rows.push(['ram', '0x00000000', '0xffffffff', M().kinds.ram, M().wraps(words ?? cfg.words)]);
    }
    if (dev && this.platformView) this.platformView.update(dev);
    this.root.replaceChildren(...(dev && this.platformView ? [this.platformView.root] : [el('p.note', { text: M().periphNote })]),
      ...(dev ? [el('p.note', { text: M().periphNoteDevices })] : []),
      el('table.listing.mem-table', {}, el('tbody', {}, el('tr', {}, [M().colName, M().colFrom, M().colTo, M().colKind, ''].map((t) => el('th', { text: t }))),
        ...rows.map((r) => el('tr', {}, r.map((t, i) => el(i === 0 || i === 4 ? 'td' : 'td.mono', { text: t })))))));
  }
}
