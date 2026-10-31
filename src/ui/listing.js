// listing.js -- machine-code view (WS-F-020 to WS-F-023, WS-F-013, WS-F-014):
// listing with address, hexadecimal word, binary word grouped by the fields
// of its format (field names under the groups; spacing, not colour, marks
// the fields), disassembly and source; the data listing and the symbol
// table. Breakpoints are toggled on the address cell. Built on the
// architecture's language (contract v2, W-D29): disassemble with its
// options, fields() with their short names, describe() for the word tooltip.
// The instruction inspector is the architecture's (Language.inspector), or
// the plain fields table below.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8, hexAddr, hex2, store } from './dom.js';
import { STRINGS } from './strings.js';

/** A field's bits '31:25' or '7' as [hi, lo]. */
const span = (f) => { const [hi, lo = hi] = f.bits.split(':').map(Number); return [hi, lo]; };
const binOf = (v, n) => (v >>> 0).toString(2).padStart(n, '0');

function binaryGroups(fields) {
  return el('span.bin', {}, fields.map((f) => {
    const [hi, lo] = span(f);
    return el('span.bin-field', { title: `${f.name} [${hi}:${lo}]` },
      el('span.bin-bits', { text: binOf(f.value, hi - lo + 1) }),
      el('span.bin-name', { text: f.short ?? f.name }));
  }));
}

/** Contents of the word tooltip: the bits grouped by field, and each field's value. */
function wordTip(language, l) {
  const fields = language.fields?.(l.word, l.address) ?? [];
  const info = language.describe?.(l.word, l.address) ?? null;
  const head = el('div.tip-head.mono', {}, `0x${l.word.toString(16).padStart(2 * l.size, '0')}`,
    fields.length && info?.kind ? ` · ${info.kind}` : '');
  if (!fields.length) return [head, el('div.mono', { text: binOf(l.word, 8 * l.size) })];
  const rows = fields.map((f) => {
    const [hi, lo] = span(f);
    return el('tr', {}, el('td', { text: f.name }), el('td.mono', { text: f.bits }),
      el('td.mono', { text: binOf(f.value, hi - lo + 1) }), el('td.mono', { text: String(f.value) }), el('td', { text: f.meaning ?? '' }));
  });
  const imm = info?.immediate ?? null;
  return [head, el('div.tip-bin.mono', {}, binaryGroups(fields)),
    el('table.tip-fields', {}, el('tbody', {}, rows)),
    imm !== null && el('div.tip-imm.mono', { text: `${STRINGS.immediate}: ${imm}` })];
}

/** One tooltip element shared by the listing (hover or keyboard focus). */
class Tip {
  constructor() {
    this.node = el('div.tip', { role: 'tooltip', id: 'word-tip', hidden: true });
    document.body.append(this.node);
  }

  show(anchor, content) {
    this.node.replaceChildren(...content.filter(Boolean));
    this.node.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = this.node.offsetWidth;
    const h = this.node.offsetHeight;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    left = Math.max(8, left);
    this.node.style.left = `${left}px`;
    this.node.style.top = `${top}px`;
    anchor.setAttribute('aria-describedby', 'word-tip');
    this.anchor = anchor;
  }

  hide() {
    this.node.hidden = true;
    this.anchor?.removeAttribute('aria-describedby');
    this.anchor = null;
  }
}

export class ListingPanel {
  /** @param {{language: import('../arch/contract.js').Language, addressBits?: number, onSelect: Function, onToggleBreak: Function}} o */
  constructor({ language, addressBits = 32, onSelect, onToggleBreak }) {
    this.language = language;
    this.addrDigits = Math.ceil(addressBits / 4);
    this.onSelect = onSelect;
    this.onToggleBreak = onToggleBreak;
    this.showHex = true;
    this.showBinary = store.get('pips.showBinary') === '1'; // hidden by default; expand from the header
    this.aliases = false;
    // register names in the disassembly (language.disassembly.names); a view may choose its own (RISC-V: 'x' in
    // the datapath views of Chapters 6-8)
    this.names = language.disassembly?.names?.[0];
    this.rows = new Map(); // address -> tr
    this.tip = new Tip();
    this.body = el('tbody');
    this.binToggle = el('button.col-toggle', { type: 'button', onclick: () => this.setBinary(!this.showBinary) });
    this.binHead = el('th.col-bin', {}, el('span', { text: STRINGS.colBinary }));
    this.table = el('table.listing.code-listing', {}, el('thead', {}, el('tr', {},
      el('th.st', { title: STRINGS.breakpointHint }),
      el('th', { text: STRINGS.colAddress }),
      el('th.col-hex', {}, el('span', { text: STRINGS.colWord }), ' ', this.binToggle),
      this.binHead, el('th', { text: STRINGS.colInstruction }),
      el('th.src', { text: STRINGS.colSource }))), this.body);
    const toggle = (label, key) => el('label.toggle', {}, el('input', { type: 'checkbox', checked: this[key],
      onchange: (e) => { this[key] = e.target.checked; this.render(); } }), label);
    this.root = el('div.listing-wrap', {},
      el('div.panel-tools', {}, toggle(STRINGS.showHex, 'showHex'), language.disassembly?.aliases ? toggle(STRINGS.aliases, 'aliases') : null,
        el('span.note.tools-note', { text: STRINGS.breakpointHint, title: STRINGS.breakpointHint })),
      el('div.scroll', { onscroll: () => this.tip.hide() }, this.table));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.tip.hide(); });
  }

  setBinary(on) {
    this.showBinary = on;
    store.set('pips.showBinary', on ? '1' : '0');
    this.render();
  }

  setProgram(program, breakpoints) {
    this.program = program;
    this.breakpoints = breakpoints;
    this.render();
  }

  render() {
    this.tip.hide();
    this.table.classList.toggle('hide-hex', !this.showHex);
    this.table.classList.toggle('hide-bin', !this.showBinary);
    this.binToggle.textContent = this.showBinary ? STRINGS.binaryHide : STRINGS.binaryShow;
    this.binToggle.setAttribute('aria-expanded', String(this.showBinary));
    this.binToggle.title = this.showBinary ? STRINGS.binaryHideTitle : STRINGS.binaryShowTitle;
    this.rows.clear();
    const L = this.language;
    const addr = (a) => (a >>> 0).toString(16).padStart(this.addrDigits, '0');
    const rows = (this.program?.listing ?? []).map((l) => {
      const fields = L.fields?.(l.word, l.address) ?? [];
      const text = L.disassemble(l.word, l.address, { aliases: this.aliases, names: this.names });
      const bp = this.breakpoints?.has(l.address);
      const tip = () => wordTip(L, l);
      const hexCell = el('td.col-hex.mono', { text: l.word.toString(16).padStart(2 * l.size, '0'),
        onmouseenter: (e) => this.tip.show(e.currentTarget, tip()), onmouseleave: () => this.tip.hide() });
      const tr = el(`tr${bp ? '.bp' : ''}`, { tabindex: -1, onclick: () => this.select(l.address),
        onfocus: () => { this.setFocusRow(l.address); if (this.showHex) this.tip.show(hexCell, tip()); },
        onblur: () => this.tip.hide(),
        onkeydown: (e) => this.rowKey(e, l) },
      el('td.st', {}, el('button.bp-btn', { type: 'button', 'aria-pressed': String(Boolean(bp)),
        'aria-label': STRINGS.breakpointAt(`0x${addr(l.address)}`), title: STRINGS.breakpointAt(`0x${addr(l.address)}`), tabindex: -1,
        onclick: (e) => { e.stopPropagation(); this.onToggleBreak?.(l.address); } }, bp ? '●' : '○')),
      el('td.addr.mono', { onclick: (e) => { e.stopPropagation(); this.onToggleBreak?.(l.address); } }, addr(l.address)),
      hexCell,
      el('td.col-bin.mono', {}, fields.length ? binaryGroups(fields) : binOf(l.word, 8 * l.size)),
      el('td.mono', { text }),
      el('td.mono.src', {}, l.part === 0 ? `${l.line}: ${l.text.trim()}` : l.part > 0 ? `↳ (${STRINGS.pseudoOf(l.source)})` : ''));
      this.rows.set(l.address, tr);
      return tr;
    });
    this.body.replaceChildren(...rows);
    if (!this.rows.has(this.focusAddr)) this.focusAddr = this.program?.listing[0]?.address;
    this.setFocusRow(this.focusAddr);
    this.markPc(this.pc);
  }

  /** Roving tab stop: the listing is one Tab stop; arrows move inside it (WS-U-030). */
  setFocusRow(address) {
    const old = this.rows.get(this.focusAddr);
    if (old) old.tabIndex = -1;
    this.focusAddr = address;
    const tr = this.rows.get(address);
    if (tr) tr.tabIndex = 0;
  }

  // Keyboard: ↑/↓/Home/End/PageUp/PageDown move, Enter selects, B toggles a breakpoint.
  rowKey(e, l) {
    const tr = e.currentTarget;
    const go = (row) => { if (row) { e.preventDefault(); row.focus(); } };
    const all = [...this.rows.values()];
    const i = all.indexOf(tr);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.select(l.address); }
    else if (e.key === 'ArrowDown') go(all[i + 1]);
    else if (e.key === 'ArrowUp') go(all[i - 1]);
    else if (e.key === 'PageDown') go(all[Math.min(all.length - 1, i + 10)]);
    else if (e.key === 'PageUp') go(all[Math.max(0, i - 10)]);
    else if (e.key === 'Home') go(all[0]);
    else if (e.key === 'End') go(all[all.length - 1]);
    else if (e.key === 'b' || e.key === 'B') { e.preventDefault(); this.onToggleBreak?.(l.address); this.rows.get(l.address)?.focus(); }
  }

  select(address) {
    this.selected = address;
    for (const [a, tr] of this.rows) tr.classList.toggle('sel', a === address);
    this.onSelect?.(this.program.listing.find((l) => l.address === address));
  }

  markPc(pc) {
    this.pc = pc;
    for (const [a, tr] of this.rows) tr.classList.toggle('pc', a === pc);
    const tr = this.rows.get(pc);
    if (tr) {
      const box = tr.closest('.scroll');
      if (box && (tr.offsetTop < box.scrollTop || tr.offsetTop > box.scrollTop + box.clientHeight - tr.offsetHeight)) {
        box.scrollTop = tr.offsetTop - box.clientHeight / 3;
      }
    }
  }
}

/**
 * The inspector of an architecture without its own (contract v2: no Language.inspector): the disassembly and the
 * encoding fields of the selected row, from Language.fields().
 */
export class FieldsTable {
  constructor(language, addressBits = 32) {
    this.language = language;
    this.addressBits = addressBits;
    this.root = el('div.fields', {}, el('p.note', { text: STRINGS.fieldsNone }));
  }

  show(l) {
    const fields = l ? this.language.fields?.(l.word, l.address) ?? [] : [];
    if (!fields.length) { this.root.replaceChildren(el('p.note', { text: STRINGS.fieldsNone })); return; }
    this.root.replaceChildren(
      el('div.insp-head', {}, el('span.insp-asm.mono', { text: this.language.disassemble(l.word, l.address) }),
        el('span.insp-addr.mono', { text: `${hexAddr(l.address, this.addressBits)} ·${l.word.toString(16).padStart(2 * l.size, '0')}` })),
      el('table.tip-fields', { 'aria-label': STRINGS.inspector.fieldsCaption }, el('tbody', {}, fields.map((f) => {
        const [hi, lo] = span(f);
        return el('tr', {}, el('td', { text: f.name }), el('td.mono', { text: f.bits }),
          el('td.mono', { text: binOf(f.value, hi - lo + 1) }), el('td.mono', { text: String(f.value) }), el('td', { text: f.meaning ?? '' }));
      }))));
  }
}

/** Data listing (WS-F-023) and symbol table (WS-F-014). */
// `addressBits` and `wordBytes` of the architecture's address space: with one-byte words a row is one byte and its
// value is shown in decimal (SAP-1); otherwise four bytes and their little-endian word (RISC-V).
export function dataTable(program, { addressBits = 32, wordBytes = 4 } = {}) {
  const labels = new Map();
  for (const s of program?.symbolTable ?? []) if (s.section !== 'abs') labels.set(s.address, s.name);
  const rows = [];
  const per = wordBytes === 1 ? 1 : 4;
  for (const d of program?.data ?? []) {
    for (let off = 0; off < d.bytes.length; off += per) {
      const chunk = d.bytes.slice(off, off + per);
      const addr = d.address + off;
      const word = per === 1 ? String(chunk[0])
        : chunk.length === 4 ? hex8((chunk[0] | (chunk[1] << 8) | (chunk[2] << 16) | (chunk[3] << 24)) >>> 0) : '';
      rows.push(el('tr', {}, el('td.mono', { text: hexAddr(addr, addressBits) }), el('td.mono', { text: Array.from(chunk, hex2).join(' ') }),
        el('td.mono', { text: word }), el('td.mono', { text: labels.get(addr) ?? '' }),
        el('td.mono.src', { text: off === 0 ? `${d.line}: ${d.text.trim()}` : '' })));
    }
  }
  return el('table.listing', {}, el('thead', {}, el('tr', {}, el('th', { text: STRINGS.colAddress }),
    el('th', { text: STRINGS.colBytes }), el('th', { text: STRINGS.colValue }), el('th', { text: STRINGS.colLabel }),
    el('th.src', { text: STRINGS.colSource }))), el('tbody', {}, rows));
}

export function symbolTable(program, onGo, addressBits = 32) {
  return el('table.listing', {}, el('thead', {}, el('tr', {}, el('th', { text: STRINGS.colLabel }),
    el('th', { text: STRINGS.colSection }), el('th', { text: STRINGS.colAddress }), el('th', { text: STRINGS.colLine }))),
  el('tbody', {}, (program?.symbolTable ?? []).map((s) => el('tr', {},
    el('td.mono', {}, el('button.link', { type: 'button', text: s.name, onclick: () => onGo?.(s) })),
    el('td', { text: s.section }), el('td.mono', { text: hexAddr(s.address, addressBits) }), el('td', { text: `${s.file}:${s.line}` })))));
}
