// data-dialog.js -- the dialog of data import and export (WS-F-145): a CSV,
// text or binary file loaded into a labelled data array before a run, and a
// memory range saved as CSV or .bin. The arithmetic is in core/data-io.js;
// files are read and written in the browser only (WS-N-008).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8 } from './dom.js';
import { STRINGS } from './strings.js';
import { SIZES, parseNumbers, parseHexWords, dataArrays, readRange, saveCsv, saveBin } from '../shell/data-io.js';

const D = () => STRINGS.dataIo;

export class DataDialog {
  /**
   * @param {{program: () => object, memory: () => object|null, loads: () => Array, onLoad: (label, bytes, name) => void,
   *   onClear: () => void, onSave: (name, data, type) => void, hex?: (address) => string}} hooks  hex: an address with the
   *   architecture's digits (default 32 bits)
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.hex = hooks.hex ?? hex8;
    const T = D();
    const sizeSel = () => el('select', {}, Object.keys(SIZES).map((k) => el('option', { value: k, text: T.sizes[k] })));
    this.array = el('select', { 'aria-label': T.array });
    this.loadSize = sizeSel();
    this.loadSize.setAttribute('aria-label', T.element);
    this.file = el('input', { type: 'file', accept: '.csv,.txt,.bin,.hex', 'aria-label': T.file });
    this.loadStatus = el('p.note', { role: 'status' });
    this.loadList = el('ul.data-loads');
    this.from = el('input.mono', { type: 'text', size: 12, 'aria-label': T.from, placeholder: T.fromHint });
    this.count = el('input.mono', { type: 'number', min: 1, max: 65536, value: 16, 'aria-label': T.count });
    this.saveSize = sizeSel();
    this.saveSize.setAttribute('aria-label', T.element);
    this.format = el('select', { 'aria-label': T.format }, el('option', { value: 'csv', text: 'CSV' }), el('option', { value: 'bin', text: '.bin' }));
    this.saveStatus = el('p.note', { role: 'status' });
    const row = (label, control) => el('label.data-row', {}, el('span', { text: label }), control);
    this.root = el('dialog.data-dialog', { 'aria-labelledby': 'data-title' },
      el('h2', { id: 'data-title', text: T.title }),
      el('section', {}, el('h3', { text: T.loadHead }), el('p.note', { text: T.loadNote }),
        row(T.array, this.array), row(T.element, this.loadSize), row(T.file, this.file),
        el('div.data-actions', {}, el('button', { type: 'button', text: T.load, onclick: () => this.load() }),
          el('button', { type: 'button', text: T.clear, onclick: () => { this.hooks.onClear(); this.fill(); } })),
        this.loadStatus, this.loadList),
      el('section', {}, el('h3', { text: T.saveHead }),
        row(T.from, this.from), row(T.count, this.count), row(T.element, this.saveSize), row(T.format, this.format),
        el('div.data-actions', {}, el('button', { type: 'button', text: T.save, onclick: () => this.save() })),
        this.saveStatus),
      el('p.note', { text: T.privacy }),
      el('form', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose })));
  }

  open() {
    this.loadStatus.textContent = '';
    this.saveStatus.textContent = '';
    this.fill();
    this.root.showModal();
  }

  /** The arrays of the assembled program and the loads in force. */
  fill() {
    const T = D();
    const arrays = dataArrays(this.hooks.program());
    const keep = this.array.value;
    this.array.replaceChildren(...arrays.map((a) => el('option', { value: a.name, text: T.arrayOption(a.name, this.hex(a.address), a.room) })));
    if (arrays.some((a) => a.name === keep)) this.array.value = keep;
    if (!arrays.length) this.loadStatus.textContent = T.noArrays;
    if (!this.from.value && arrays.length) this.from.value = arrays[0].name;
    const loads = this.hooks.loads();
    this.loadList.replaceChildren(...loads.map((l) => el('li', { text: T.loaded(l.name, l.label, l.bytes.length) })));
  }

  async load() {
    const T = D();
    const label = this.array.value;
    const f = this.file.files?.[0];
    if (!label) { this.loadStatus.textContent = T.noArrays; return; }
    if (!f) { this.loadStatus.textContent = T.noFile; return; }
    try {
      const name = f.name.toLowerCase();
      const size = SIZES[this.loadSize.value];
      const bytes = name.endsWith('.bin') ? new Uint8Array(await f.arrayBuffer())
        : name.endsWith('.hex') ? parseHexWords(await f.text(), size) // $readmemh words, as the book's data.hex
          : parseNumbers(await f.text(), size);
      this.hooks.onLoad(label, bytes, f.name);
      this.loadStatus.textContent = T.loadedNow(f.name, label, bytes.length);
      this.fill();
    } catch (e) {
      this.loadStatus.textContent = T.refused(e.message);
    }
  }

  save() {
    const T = D();
    const mem = this.hooks.memory();
    const p = this.hooks.program();
    if (!mem) { this.saveStatus.textContent = T.noMemory; return; }
    const t = this.from.value.trim();
    const sym = p?.symbols && Object.hasOwn(p.symbols, t) ? p.symbols[t] : undefined; // contract: a plain record
    const addr = sym ?? (/^(0x)?[0-9a-f]+$/i.test(t) ? parseInt(t.replace(/^0x/i, ''), 16) : null);
    const n = Number(this.count.value);
    const size = SIZES[this.saveSize.value];
    if (addr === null || Number.isNaN(addr)) { this.saveStatus.textContent = T.badFrom; return; }
    if (!(n >= 1 && n <= 65536 && Number.isInteger(n))) { this.saveStatus.textContent = T.badCount; return; }
    if (addr % size) { this.saveStatus.textContent = T.misaligned(size); return; }
    const values = readRange(mem, addr >>> 0, n, size);
    const base = /^[A-Za-z_]\w*$/.test(t) ? t : `mem-${(addr >>> 0).toString(16)}`;
    if (this.format.value === 'bin') this.hooks.onSave(`${base}.bin`, saveBin(values, size), 'application/octet-stream');
    else this.hooks.onSave(`${base}.csv`, saveCsv(values, addr >>> 0, size), 'text/csv');
    this.saveStatus.textContent = T.saved(n, this.hex(addr));
  }
}
