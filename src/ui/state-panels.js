// state-panels.js -- registers (WS-F-100), memory (WS-F-101), counters
// (WS-F-092, WS-F-102), the call stack (WS-F-103, WS-F-143) and the console
// and message list.
// A register or byte changed by the last step is marked by a symbol (◆) and
// a background, never by colour alone (WS-U-032).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8, hex2, formatValue } from './dom.js';
import { STRINGS } from './strings.js';
import { ABI_NAMES, CLASSES } from '../isa/encoding.js';

export class RegistersPanel {
  constructor({ onWatch }) {
    this.onWatch = onWatch;
    this.format = 'hex';
    this.picked = null; // register shown in the detail line
    this.select = el('select', { 'aria-label': STRINGS.registers, onchange: (e) => { this.format = e.target.value; this.update(this.last); } },
      ['hex', 'signed', 'unsigned', 'binary'].map((f) => el('option', { value: f,
        text: STRINGS[`format${f[0].toUpperCase()}${f.slice(1)}`] })));
    this.cells = [];
    this.decs = [];
    this.rowEls = [];
    this.watches = [];
    // The register table is one Tab stop: ↑/↓ move between registers, W toggles a watch (WS-U-030).
    const rows = ABI_NAMES.map((name, i) => {
      const val = el('td.mono.reg-val');
      const dec = el('td.mono.reg-dec');
      const watch = el('input', { type: 'checkbox', 'aria-label': `${STRINGS.watch}: x${i}`, disabled: i === 0, tabindex: -1,
        onchange: (e) => this.onWatch?.(i, e.target.checked) });
      this.cells.push(val);
      this.decs.push(dec);
      this.watches.push(watch);
      const tr = el(`tr${i === 0 ? '.reg-zero' : ''}`, { tabindex: i === 1 ? 0 : -1, 'aria-label': `x${i} ${name}`,
        title: i === 0 ? STRINGS.tools.zero : null, onclick: () => this.pick(i), onfocus: () => this.pick(i),
        onkeydown: (e) => {
          const row = e.currentTarget;
          const move = (to) => { if (to) { e.preventDefault(); row.tabIndex = -1; to.tabIndex = 0; to.focus(); } };
          if (e.key === 'ArrowDown') move(row.nextElementSibling);
          else if (e.key === 'ArrowUp' && i > 0) move(row.previousElementSibling);
          else if ((e.key === 'w' || e.key === 'W' || e.key === ' ') && i > 0) {
            e.preventDefault();
            watch.checked = !watch.checked;
            this.onWatch?.(i, watch.checked);
          }
        } },
      el('td.mono.reg-x', { text: `x${i}` }), el('td.mono.reg-abi', { text: name }), val, dec, el('td.reg-watch', {}, watch));
      this.rowEls.push(tr);
      return tr;
    });
    this.pcVal = el('span.mono.pc-val');
    this.detail = el('p.reg-detail.mono.reg-hint', { 'aria-live': 'polite', text: STRINGS.tools.regPick, title: STRINGS.tools.regPick });
    this.root = el('div.regs', {},
      el('div.panel-tools', {}, el('span.pc-box', { title: STRINGS.tools.pc }, el('span.pc-name', { text: 'pc' }), this.pcVal), this.select),
      el('div.scroll', {}, el('table.listing.reg-table', {},
        el('thead', {}, el('tr', {}, el('th', { text: 'Reg' }), el('th', { text: 'ABI' }),
          el('th', { text: STRINGS.colValue }), el('th', { text: STRINGS.tools.colDec }), el('th', { title: STRINGS.watch, text: '👁' }))),
        el('tbody', {}, rows))),
      this.detail);
  }

  /** Show register i in every format below the table. */
  pick(i) {
    this.picked = i;
    this.rowEls.forEach((r, k) => r.classList.toggle('sel', k === i));
    this.showDetail();
  }

  showDetail() {
    const i = this.picked;
    this.detail.classList.toggle('reg-hint', i === null || !this.last);
    if (i === null || !this.last) { this.detail.textContent = STRINGS.tools.regPick; return; }
    const v = this.last.x[i];
    this.detail.textContent = STRINGS.tools.regDetail(i, ABI_NAMES[i], hex8(v), formatValue(v, 'signed'), formatValue(v, 'unsigned'),
      `0b${formatValue(v, 'binary').replace(/ /g, '_')}`);
  }

  update(state) {
    this.last = state;
    if (!state) {
      for (const c of this.cells) c.textContent = '';
      for (const c of this.decs) c.textContent = '';
      this.pcVal.textContent = '—';
      this.showDetail();
      return;
    }
    const { x, pc, changed } = state;
    x.forEach((v, i) => {
      const c = this.cells[i];
      const mark = changed === i;
      c.textContent = `${mark ? '◆ ' : ''}${formatValue(v, this.format)}`;
      this.decs[i].textContent = formatValue(v, 'signed');
      const row = this.rowEls[i];
      row.classList.toggle('changed', mark);
      row.classList.remove('flash-change');
      if (mark && this.lastPc !== pc) { // a fresh change: a short highlight (none with reduced motion)
        void row.offsetWidth;
        row.classList.add('flash-change');
      }
      c.title = mark ? STRINGS.changed : '';
    });
    this.lastPc = pc;
    this.pcVal.textContent = formatValue(pc, 'hex');
    this.showDetail();
  }
}

export class MemoryPanel {
  constructor({ onWatch }) {
    this.onWatch = onWatch;
    this.base = 0x10000;
    this.mode = 'word';
    this.rows = 16;
    this.goto = el('input.mono', { type: 'text', size: 14, 'aria-label': STRINGS.goTo, placeholder: STRINGS.goTo,
      onkeydown: (e) => { if (e.key === 'Enter') this.goTo(e.target.value); } });
    this.modeSel = el('select', { 'aria-label': STRINGS.memory, onchange: (e) => { this.mode = e.target.value; this.render(); } },
      el('option', { value: 'word', text: STRINGS.byWord }), el('option', { value: 'byte', text: STRINGS.byByte }));
    this.regions = el('span.note');
    this.body = el('tbody');
    // Jump to where a register points: sp at one click, any register from the list (the value it holds now).
    this.regSel = el('select.mem-reg', { 'aria-label': STRINGS.memGoReg, title: STRINGS.memGoRegTitle, onchange: (e) => {
      const v = e.target.value;
      e.target.value = ''; // back to the prompt, so the same register can be chosen again
      if (v !== '' && this.x) this.goToAddress(this.x[Number(v)]);
    } }, el('option', { value: '', text: STRINGS.memGoReg }),
    ABI_NAMES.map((n, i) => el('option', { value: String(i), text: `x${i} (${n})` })));
    this.root = el('div.memory', {},
      el('div.panel-tools', {}, this.goto,
        el('button', { type: 'button', text: STRINGS.watchButton, title: STRINGS.watchButtonTitle, onclick: () => {
          const a = this.resolve(this.goto.value);
          if (a !== null) this.onWatch?.((a & ~3) >>> 0);
        } }),
        el('button.mem-sp', { type: 'button', text: 'sp', title: STRINGS.memGoSp, // the name is the visible text; the title describes it
          onclick: () => { if (this.x) this.goToAddress(this.x[2]); } }),
        this.regSel,
        this.modeSel,
        el('button', { type: 'button', text: '▲', 'aria-label': STRINGS.previous, onclick: () => { this.base -= 16 * this.rows; this.render(); } }),
        el('button', { type: 'button', text: '▼', 'aria-label': STRINGS.next, onclick: () => { this.base += 16 * this.rows; this.render(); } }),
        this.regions),
      el('div.scroll', {}, el('table.listing.memtable', {}, this.body)));
  }

  setContext({ mem, program, x, written, profile, watched }) {
    Object.assign(this, { mem, program, x, written, profile, watched });
    this.render();
  }

  /** Address of a label, a register's value, or a hexadecimal number; null if none. */
  resolve(text) {
    const t = text.trim();
    const sym = this.program?.symbols.get(t);
    const reg = ABI_NAMES.indexOf(t.toLowerCase());
    const a = sym ?? (reg >= 0 && this.x ? this.x[reg] : (/^(0x)?[0-9a-f]+$/i.test(t) ? parseInt(t.replace(/^0x/i, ''), 16) : null));
    return a === null || Number.isNaN(a) ? null : a >>> 0;
  }

  goTo(text) {
    const a = this.resolve(text);
    if (a === null) return;
    this.goToAddress(a);
  }

  /** Show the memory from the 16-byte row that holds address a. */
  goToAddress(a) {
    this.base = (a & ~15) >>> 0;
    this.goto.value = `0x${(a >>> 0).toString(16).padStart(8, '0')}`;
    this.render();
  }

  region(a) {
    const segs = this.program?.segments ?? [];
    const harvard = this.profile?.memory === 'harvard'; // the data memory holds no code
    for (const s of segs) {
      if (harvard && s.executable) continue;
      if (a >= s.address && a < s.address + Math.max(s.bytes.length, 1)) return s.executable ? STRINGS.regionText : STRINGS.regionData;
    }
    const top = this.profile?.stackTop;
    // The stack: from sp up to the stack top, within the 64 KiB below the top (sp may hold anything).
    if (top && this.x && a >= (this.x[2] & ~15) && a < top && a >= top - 0x10000) return STRINGS.regionStack;
    return '';
  }

  render() {
    this.base >>>= 0;
    if (!this.mem) { this.body.replaceChildren(); return; }
    const labels = new Map();
    const harvard = this.profile?.memory === 'harvard';
    for (const s of this.program?.symbolTable ?? []) {
      if (s.section !== 'abs' && !(harvard && s.section === 'text')) labels.set(s.address, s.name);
    }
    const stack = this.profile?.stackTop != null; // the chapter processors have no stack convention
    const sp = stack ? this.x?.[2] : undefined;
    const fp = stack ? this.x?.[8] : undefined;
    const rows = [];
    for (let r = 0; r < this.rows; r++) {
      const a = (this.base + 16 * r) >>> 0;
      const cells = [];
      for (let k = 0; k < 16; k += this.mode === 'word' ? 4 : 1) {
        const addr = (a + k) >>> 0;
        const size = this.mode === 'word' ? 4 : 1;
        const v = this.mem.read(addr, size);
        const hit = this.written && addr < this.written.addr + this.written.size && addr + size > this.written.addr;
        const watched = this.watched?.has((addr & ~3) >>> 0);
        const marks = [addr === sp ? 'sp' : '', addr === fp ? 'fp' : ''].filter(Boolean).join(',');
        const lbl = labels.get(addr);
        cells.push(el(`td.mono${hit ? '.changed' : ''}${watched ? '.watched' : ''}`, {
          title: [hex8(addr), lbl, marks, hit ? STRINGS.changed : '', watched ? STRINGS.watchedMark : ''].filter(Boolean).join(' '),
          ondblclick: size === 4 ? () => this.onWatch?.(addr) : null,
        }, watched && (size === 4 || (addr & 3) === 0) ? '👁' : '', hit ? '◆' : '', marks ? `‹${marks}›` : '', size === 4 ? v.toString(16).padStart(8, '0') : hex2(v)));
      }
      const lbl = [];
      for (let k = 0; k < 16; k++) if (labels.has((a + k) >>> 0)) lbl.push(labels.get((a + k) >>> 0));
      rows.push(el('tr', {}, el('td.mono.addr', { text: hex8(a) }), cells,
        el('td.note', { text: [this.region(a), lbl.join(' ')].filter(Boolean).join(' · ') })));
    }
    const step = this.mode === 'word' ? 4 : 1;
    const head = el('tr', {}, el('th', { text: STRINGS.colAddress }),
      Array.from({ length: 16 / step }, (_, i) => el('th.mono', { text: `+${(i * step).toString(16)}` })), el('th'));
    this.body.replaceChildren(head, ...rows);
    this.regions.textContent = this.mode === 'word' ? STRINGS.memWordsNote : STRINGS.memBytesNote;
  }
}

/**
 * The call stack of the ISA view (WS-F-103, WS-F-143), innermost call first: the procedure,
 * the call site and return address, sp at the call, and a0-a7 as they were at the call.
 * Selecting a frame shows its call site (onGoTo(address)).
 */
export class CallStackPanel {
  constructor({ onGoTo }) {
    this.onGoTo = onGoTo;
    this.root = el('div.callstack.scroll');
  }

  /** @param frames from core/callstack.js, or null when nothing runs */
  update(frames) {
    const T = STRINGS.calls;
    if (!frames) { this.root.replaceChildren(el('p.note', { text: T.none })); return; }
    if (!frames.length) { this.root.replaceChildren(el('p.note', { text: T.empty })); return; }
    const sig = (v) => String(v | 0);
    this.root.replaceChildren(el('ol.cs-list', { 'aria-label': STRINGS.calls.title }, frames.map((f, i) => el('li.cs-frame', {},
      el('button.cs-head', { type: 'button', title: T.goTo, onclick: () => this.onGoTo?.(f.call) },
        el('span.cs-depth.mono', { text: `#${f.depth}` }), ' ',
        el('b.mono', { text: f.name ?? hex8(f.target) }), i === 0 ? el('span.cs-top', { text: ` ${T.innermost}` }) : null),
      el('div.cs-site.mono', { text: T.site(f.site ?? hex8(f.call), hex8(f.call), hex8(f.ret), f.sp === null ? '' : hex8(f.sp)) }),
      el('table.cs-args.mono', { 'aria-label': T.argsLabel(f.depth) }, el('caption', { text: T.args }),
        el('tbody', {}, [0, 4].map((k) => el('tr', {}, f.args.slice(k, k + 4).map((v, j) => el('td', { title: `a${k + j} = ${hex8(v)} = ${sig(v)}` },
          el('span.cs-reg', { text: `a${k + j}` }), ` ${sig(v)}`))))))))),
    el('p.note', { text: T.note }));
  }
}

/** Counter cards: a value over its name; the first card of a set is the headline. */
const cards = (items) => el('dl.counter-cards', {}, items.map(([k, v], i) => el(`div.counter-card${i === 0 ? '.lead' : ''}`, { title: k },
  el('dd.mono', { text: typeof v === 'number' ? v.toLocaleString('en-GB') : String(v) }), el('dt', { text: k }))));

export class CountersPanel {
  constructor() {
    this.root = el('div.counters');
  }

  /** Counters of a microarchitecture view: cycles, instructions, CPI (WS-F-092), and the view's own (`extra`). */
  updateCycles({ cycles, instructions, extra = [] }) {
    const cpi = instructions ? (cycles / instructions).toFixed(2) : '–';
    this.root.replaceChildren(cards([[STRINGS.single.cycles, cycles], [STRINGS.single.instructions, instructions], [STRINGS.single.cpi, cpi], ...extra]));
  }

  /** Counters of the ISA view: instructions retired by class, as rvsim.py counts them; the deepest stack use. */
  update(hart) {
    if (!hart) { this.root.replaceChildren(); return; }
    const rep = hart.report();
    this.root.replaceChildren(cards([[STRINGS.instructions, rep.instructions],
      ...CLASSES.filter((c) => rep.by_class[c] || ['alu', 'load', 'store', 'branch_taken', 'branch_not_taken', 'jump'].includes(c))
        .map((c) => [STRINGS.classes[c], rep.by_class[c]]),
      [STRINGS.stackUse, rep.stack_bytes]]));
  }
}

export class ConsolePanel {
  constructor({ onGoTo }) {
    this.onGoTo = onGoTo;
    this.out = el('pre.console-out', { 'aria-live': 'polite', 'aria-label': STRINGS.console });
    this.msgs = el('ul.messages', { 'aria-live': 'polite', 'aria-label': STRINGS.messages });
    this.root = el('div.console', {}, this.out, this.msgs);
  }

  setOutput(bytes) {
    this.out.textContent = new TextDecoder().decode(Uint8Array.from(bytes));
  }

  clearMessages() { this.msgs.replaceChildren(); }

  /** A message; `loc` makes its location a link to the source, `detail` adds a hint line. */
  message(text, kind = 'info', loc = null, detail = null) {
    const icon = { error: '✖', warn: '▲', info: 'ℹ', ok: '✔' }[kind] ?? '';
    const link = loc ? el('button.link.msg-loc', { type: 'button', onclick: () => this.onGoTo?.(loc) },
      `${loc.file}:${loc.line}${loc.column ? `:${loc.column}` : ''}`) : null;
    this.msgs.append(el(`li.msg-${kind}`, {}, el('div', {}, `${icon} `, link, link ? ' ' : '', el('span.msg-text', { text })),
      detail ? el('div.msg-hint', { text: detail }) : null));
    this.msgs.scrollTop = this.msgs.scrollHeight;
  }
}
