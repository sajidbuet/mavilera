// listing.js -- machine-code view (WS-F-020 to WS-F-023, WS-F-013, WS-F-014):
// listing with address, hexadecimal word, binary word grouped by the fields
// of its format (field names under the groups; spacing, not colour, marks
// the fields), disassembly and source; the field-breakdown panel of the
// selected instruction in the \RVFormat convention; the data listing and
// the symbol table. Breakpoints are toggled on the address cell.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8, hex2, store } from './dom.js';
import { STRINGS } from './strings.js';
import { FORMAT_FIELDS, INSTRUCTIONS, ABI_NAMES, OPCODE, bits, sext } from '../isa/encoding.js';
import { disassemble, disassembleAlias } from '../asm/disassembler.js';

const SHORT = { funct7: 'funct7', rs2: 'rs2', rs1: 'rs1', funct3: 'f3', rd: 'rd', opcode: 'opcode' };

function binaryGroups(word, fmt) {
  return el('span.bin', {}, FORMAT_FIELDS[fmt].map(([name, hi, lo]) =>
    el('span.bin-field', { title: `${name} [${hi}:${lo}]` },
      el('span.bin-bits', { text: bits(word, hi, lo).toString(2).padStart(hi - lo + 1, '0') }),
      el('span.bin-name', { text: SHORT[name] ?? 'imm' }))));
}

// Which source operand each field came from, by operand syntax (for hover highlighting).
function operandOf(syntax, field, nops) {
  const f = field.startsWith('imm') ? 'imm' : field;
  const maps = {
    'rd,rs1,rs2': { rd: 0, rs1: 1, rs2: 2 },
    'rd,rs1,imm': { rd: 0, rs1: 1, imm: 2 },
    'rd,rs1,shamt': { rd: 0, rs1: 1, rs2: 2 },
    'rd,mem': { rd: 0, rs1: 1, imm: 1 },
    'rs2,mem': { rs2: 0, rs1: 1, imm: 1 },
    'rs1,rs2,target': { rs1: 0, rs2: 1, imm: 2 },
    'rd,imm20': { rd: 0, imm: 1 },
    'rd,target': { rd: 0, imm: 1 },
    jalr: nops === 3 ? { rd: 0, rs1: 1, imm: 2 } : { rd: 0, rs1: 1, imm: 1 },
  };
  return maps[syntax]?.[f] ?? null;
}

/** Steps that rebuild the immediate of a word from its fields (WS-F-022). */
export function immediateSteps(word, fmt) {
  const b = (hi, lo) => bits(word, hi, lo).toString(2).padStart(hi - lo + 1, '0');
  switch (fmt) {
    case 'I': return [[`imm[11:0] = ${b(31, 20)}`], sext(bits(word, 31, 20), 12)];
    case 'S': return [[`imm[11:5] = ${b(31, 25)}`, `imm[4:0] = ${b(11, 7)}`,
      `${STRINGS.immGather}: ${b(31, 25)}${b(11, 7)}`], sext((bits(word, 31, 25) << 5) | bits(word, 11, 7), 12)];
    case 'B': {
      const g = `${b(31, 31)}${b(7, 7)}${b(30, 25)}${b(11, 8)}0`;
      return [[`imm[12] = bit 31 = ${b(31, 31)}`, `imm[11] = bit 7 = ${b(7, 7)}`, `imm[10:5] = bits 30:25 = ${b(30, 25)}`,
        `imm[4:1] = bits 11:8 = ${b(11, 8)}`, 'imm[0] = 0', `${STRINGS.immGather}: ${g}`], sext(parseInt(g, 2), 13)];
    }
    case 'J': {
      const g = `${b(31, 31)}${b(19, 12)}${b(20, 20)}${b(30, 21)}0`;
      return [[`imm[20] = bit 31 = ${b(31, 31)}`, `imm[19:12] = bits 19:12 = ${b(19, 12)}`, `imm[11] = bit 20 = ${b(20, 20)}`,
        `imm[10:1] = bits 30:21 = ${b(30, 21)}`, 'imm[0] = 0', `${STRINGS.immGather}: ${g}`], sext(parseInt(g, 2), 21)];
    }
    case 'U': return [[`imm[31:12] = ${b(31, 12)}`, 'imm[11:0] = 0'], (word & 0xfffff000) | 0];
    default: return null;
  }
}

/** Contents of the word tooltip: the 32 bits grouped by field, and each field's value. */
function wordTip(l) {
  const fmt = INSTRUCTIONS[l.mnemonic]?.fmt;
  const head = el('div.tip-head.mono', {}, `0x${l.word.toString(16).padStart(8, '0')}`,
    fmt ? ` · ${STRINGS.formatName(fmt)}` : '');
  if (!fmt) return [head, el('div.mono', { text: l.word.toString(2).padStart(32, '0') })];
  const regName = (n) => `x${n} (${ABI_NAMES[n]})`;
  const rows = FORMAT_FIELDS[fmt].map(([name, hi, lo]) => {
    const v = bits(l.word, hi, lo);
    let meaning = '';
    if (name === 'rd' || name === 'rs1' || name === 'rs2') meaning = INSTRUCTIONS[l.mnemonic].syntax === 'rd,rs1,shamt' && name === 'rs2' ? `shamt = ${v}` : regName(v);
    return el('tr', {}, el('td', { text: name }), el('td.mono', { text: hi === lo ? `${hi}` : `${hi}:${lo}` }),
      el('td.mono', { text: v.toString(2).padStart(hi - lo + 1, '0') }), el('td.mono', { text: String(v) }), el('td', { text: meaning }));
  });
  const imm = immediateSteps(l.word, fmt);
  return [head, el('div.tip-bin.mono', {}, binaryGroups(l.word, fmt)),
    el('table.tip-fields', {}, el('tbody', {}, rows)),
    imm && el('div.tip-imm.mono', { text: `${STRINGS.immediate}: ${imm[1]}` })];
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
  constructor({ onSelect, onToggleBreak }) {
    this.onSelect = onSelect;
    this.onToggleBreak = onToggleBreak;
    this.showHex = true;
    this.showBinary = store.get('pips.showBinary') === '1'; // hidden by default; expand from the header
    this.aliases = false;
    this.names = 'abi'; // register names in the disassembly: 'abi', or 'x' in the datapath views (Chapters 6-8)
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
      el('th', { text: STRINGS.colSource }))), this.body);
    const toggle = (label, key) => el('label.toggle', {}, el('input', { type: 'checkbox', checked: this[key],
      onchange: (e) => { this[key] = e.target.checked; this.render(); } }), label);
    this.root = el('div.listing-wrap', {},
      el('div.panel-tools', {}, toggle(STRINGS.showHex, 'showHex'), toggle(STRINGS.aliases, 'aliases'),
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
    const rows = (this.program?.listing ?? []).map((l) => {
      const fmt = INSTRUCTIONS[l.mnemonic]?.fmt;
      const text = this.aliases ? disassembleAlias(l.word, l.address, this.names) : disassemble(l.word, l.address, this.names);
      const bp = this.breakpoints?.has(l.address);
      const hexCell = el('td.col-hex.mono', { text: l.word.toString(16).padStart(8, '0'),
        onmouseenter: (e) => this.tip.show(e.currentTarget, wordTip(l)), onmouseleave: () => this.tip.hide() });
      const tr = el(`tr${bp ? '.bp' : ''}`, { tabindex: -1, onclick: () => this.select(l.address),
        onfocus: () => { this.setFocusRow(l.address); if (this.showHex) this.tip.show(hexCell, wordTip(l)); },
        onblur: () => this.tip.hide(),
        onkeydown: (e) => this.rowKey(e, l) },
      el('td.st', {}, el('button.bp-btn', { type: 'button', 'aria-pressed': String(Boolean(bp)),
        'aria-label': STRINGS.breakpointAt(hex8(l.address)), title: STRINGS.breakpointAt(hex8(l.address)), tabindex: -1,
        onclick: (e) => { e.stopPropagation(); this.onToggleBreak?.(l.address); } }, bp ? '●' : '○')),
      el('td.addr.mono', { onclick: (e) => { e.stopPropagation(); this.onToggleBreak?.(l.address); } }, hex8(l.address).slice(2)),
      hexCell,
      el('td.col-bin.mono', {}, fmt ? binaryGroups(l.word, fmt) : l.word.toString(2).padStart(32, '0')),
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

/** Field-breakdown panel (WS-F-022). */
export class FieldsPanel {
  constructor() {
    this.root = el('div.fields', {}, el('p.note', { text: STRINGS.fieldsNone }));
  }

  show(l) {
    if (!l || !INSTRUCTIONS[l.mnemonic]) { this.root.replaceChildren(el('p.note', { text: STRINGS.fieldsNone })); return; }
    const d = INSTRUCTIONS[l.mnemonic];
    const fmt = d.fmt;
    const real = l.source === l.mnemonic && l.parts === 1;
    const srcLine = l.text.replace(/\t/g, ' ');
    const srcBox = el('div.fields-src.mono', {}, srcLine);
    const highlight = (k) => {
      if (k === null || !real || !l.operands[k]) { srcBox.textContent = srcLine; return; }
      const { col, text } = l.operands[k];
      srcBox.replaceChildren(srcLine.slice(0, col), el('mark', { text: srcLine.slice(col, col + text.length) }),
        srcLine.slice(col + text.length));
    };
    const boxes = FORMAT_FIELDS[fmt].map(([name, hi, lo]) => {
      const v = bits(l.word, hi, lo);
      const k = operandOf(d.syntax, name, l.operands.length);
      const role = name.startsWith('imm') ? 'imm' : name;
      return el(`div.fbox.f-${role}`, { style: `flex-grow:${hi - lo + 1}`, tabindex: 0,
        onmouseenter: () => highlight(k), onmouseleave: () => highlight(null), onfocus: () => highlight(k),
        onblur: () => highlight(null) },
      el('div.fbox-bits', {}, el('span', { text: String(hi) }), el('span', { text: hi === lo ? '' : String(lo) })),
      el('div.fbox-name', { text: name }),
      el('div.fbox-val.mono', { text: v.toString(2).padStart(hi - lo + 1, '0') }),
      el('div.fbox-dec', { text: `= ${v}` }),
      el('div.fbox-width', { text: `${hi - lo + 1} ${STRINGS.fieldBits}` }));
    });
    const imm = immediateSteps(l.word, fmt);
    const I = STRINGS.inspector;
    const reg = (n) => `x${n} (${ABI_NAMES[n]})`;
    const has = (f) => FORMAT_FIELDS[fmt].some(([name]) => name === f);
    const opName = Object.entries(OPCODE).find(([, v]) => v === (l.word & 0x7f))?.[0] ?? '';
    const decoded = [
      [I.opcode, `${bits(l.word, 6, 0).toString(2).padStart(7, '0')}${opName ? ` (${opName})` : ''}`, 'opcode'],
      has('rd') && ['rd', reg(bits(l.word, 11, 7)), 'rd'],
      has('rs1') && ['rs1', reg(bits(l.word, 19, 15)), 'rs1'],
      has('rs2') && (d.syntax === 'rd,rs1,shamt' ? ['shamt', String(bits(l.word, 24, 20)), 'rs2'] : ['rs2', reg(bits(l.word, 24, 20)), 'rs2']),
      has('funct3') && ['funct3', bits(l.word, 14, 12).toString(2).padStart(3, '0'), 'funct3'],
      has('funct7') && ['funct7', bits(l.word, 31, 25).toString(2).padStart(7, '0'), 'funct7'],
      imm && [STRINGS.immediate, `${imm[1]} (${hex8(imm[1])})`, 'imm'],
    ].filter(Boolean);
    this.root.replaceChildren(
      el('div.insp-head', {}, el('span.insp-asm.mono', { text: disassemble(l.word, l.address) }),
        el('span.insp-type', { text: `${I.type(fmt)}${opName ? ` · ${opName}` : ''}` }),
        el('span.insp-addr.mono', { text: `${hex8(l.address)} · ${l.word.toString(16).padStart(8, '0')}` })),
      srcBox,
      el('div.fbox-row', { role: 'group', 'aria-label': I.fieldsCaption }, boxes),
      el('dl.insp-decoded', { 'aria-label': I.decoded }, decoded.map(([k, v, role]) => el(`div.f-${role}`, {}, el('dt', { text: k }), el('dd.mono', { text: v })))),
      STRINGS.semantics[l.mnemonic] && el('p.insp-sem', {}, el('strong', { text: `${I.semantics}: ` }), el('span.mono', { text: STRINGS.semantics[l.mnemonic] })),
      imm && el('div.imm', {}, el('strong', { text: `${STRINGS.immediate}: ` }),
        el('ol.imm-steps.mono', {}, imm[0].map((s) => el('li', { text: s })),
          el('li', { text: `${STRINGS.immSigned}: ${imm[1]} (${hex8(imm[1])})` }))));
  }
}

/** Data listing (WS-F-023) and symbol table (WS-F-014). */
export function dataTable(program) {
  const labels = new Map();
  for (const s of program?.symbolTable ?? []) if (s.section !== 'abs') labels.set(s.address, s.name);
  const rows = [];
  for (const d of program?.dataListing ?? []) {
    for (let off = 0; off < d.bytes.length; off += 4) {
      const chunk = d.bytes.slice(off, off + 4);
      const addr = d.address + off;
      const word = chunk.length === 4 ? (chunk[0] | (chunk[1] << 8) | (chunk[2] << 16) | (chunk[3] << 24)) >>> 0 : null;
      rows.push(el('tr', {}, el('td.mono', { text: hex8(addr) }), el('td.mono', { text: chunk.map(hex2).join(' ') }),
        el('td.mono', { text: word === null ? '' : hex8(word) }), el('td.mono', { text: labels.get(addr) ?? '' }),
        el('td.mono.src', { text: off === 0 ? `${d.line}: ${d.text.trim()}` : '' })));
    }
  }
  return el('table.listing', {}, el('thead', {}, el('tr', {}, el('th', { text: STRINGS.colAddress }),
    el('th', { text: STRINGS.colBytes }), el('th', { text: STRINGS.colValue }), el('th', { text: STRINGS.colLabel }),
    el('th', { text: STRINGS.colSource }))), el('tbody', {}, rows));
}

export function symbolTable(program, onGo) {
  return el('table.listing', {}, el('thead', {}, el('tr', {}, el('th', { text: STRINGS.colLabel }),
    el('th', { text: STRINGS.colSection }), el('th', { text: STRINGS.colAddress }), el('th', { text: STRINGS.colLine }))),
  el('tbody', {}, (program?.symbolTable ?? []).map((s) => el('tr', {},
    el('td.mono', {}, el('button.link', { type: 'button', text: s.name, onclick: () => onGo?.(s) })),
    el('td', { text: s.section }), el('td.mono', { text: hex8(s.address) }), el('td', { text: `${s.file}:${s.line}` })))));
}
