// editor.js -- assembly and C editor (WS-U-020, spec §10.1): a plain
// textarea (native undo and redo) over a highlighted copy of the text; line
// numbers, error markers, current-line marker following execution, Tab to the
// next 8-column stop (4 for C), and a find bar. Highlighting classes:
// mnemonic, register, immediate, label, directive, comment, string; for C,
// keywords, numbers, strings, comments and preprocessor lines. Errors are
// marked by a symbol and an underline, not by colour alone (WS-U-032).
// Linked lines (the counterpart of a line of the generated assembly,
// WS-F-082) are marked in the gutter and by a background. In assembly,
// mnemonics and registers are completed from a list under the cursor, and
// pointing at a mnemonic or register shows its help (WS-U-021, assist.js).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { STRINGS } from './strings.js';
import { INSTRUCTIONS, ABI_NAMES } from '../isa/encoding.js';
import { PSEUDOS } from '../asm/assembler.js';
import { completionContext, completions, helpFor, isComplete } from './assist.js';

const MNEMONICS = new Set([...Object.keys(INSTRUCTIONS), ...PSEUDOS]);
const REGISTERS = new Set([...ABI_NAMES, 'fp', ...Array.from({ length: 32 }, (_, i) => `x${i}`)]);
const escape = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function highlightLine(line) {
  let out = '';
  let rest = line;
  const hash = (() => {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === q && line[i - 1] !== '\\') q = null; } else if (c === '"' || c === "'") q = c;
      else if (c === '#') return i;
    }
    return -1;
  })();
  const comment = hash >= 0 ? line.slice(hash) : '';
  if (hash >= 0) rest = line.slice(0, hash);
  const re = /("(?:\\.|[^"])*"?|'(?:\\.|[^'])'?|[A-Za-z_.$%][\w.$]*:?|-?0[xX][0-9a-fA-F]+|-?0[bB][01]+|-?\d+|\s+|.)/g;
  let head = true; // still before the mnemonic or directive (labels may come first)
  for (const [tok] of rest.matchAll(re)) {
    let cls = null;
    if (/^\s+$/.test(tok)) { out += tok; continue; }
    if (tok[0] === '"' || tok[0] === "'") cls = 'tok-string';
    else if (head && tok.endsWith(':')) cls = 'tok-label';
    else if (head && tok[0] === '.') { cls = 'tok-directive'; head = false; }
    else if (head) { cls = MNEMONICS.has(tok.toLowerCase()) ? 'tok-mnemonic' : null; head = false; }
    else if (REGISTERS.has(tok.toLowerCase())) cls = 'tok-register';
    else if (/^-?\d/.test(tok)) cls = 'tok-immediate';
    else if (tok[0] === '%') cls = 'tok-directive';
    out += cls ? `<span class="${cls}">${escape(tok)}</span>` : escape(tok);
  }
  if (comment) out += `<span class="tok-comment">${escape(comment)}</span>`;
  return out;
}

const C_WORDS = new Set(['int', 'unsigned', 'signed', 'char', 'short', '_Bool', 'void', 'static', 'const', 'volatile', 'inline',
  'if', 'else', 'while', 'do', 'for', 'break', 'continue', 'return', 'switch', 'case', 'default', 'sizeof',
  'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t']);

/** One line of C, highlighted; `inComment` says whether a block comment is open at its start. Returns [html, inComment]. */
export function highlightC(line, inComment) {
  let out = '';
  let i = 0;
  const span = (cls, s) => `<span class="${cls}">${escape(s)}</span>`;
  if (!inComment && /^\s*#/.test(line)) return [span('tok-directive', line), false];
  while (i < line.length) {
    if (inComment) {
      const end = line.indexOf('*/', i);
      const stop = end < 0 ? line.length : end + 2;
      out += span('tok-comment', line.slice(i, stop));
      i = stop;
      inComment = end < 0;
      continue;
    }
    const rest = line.slice(i);
    let m;
    if (rest.startsWith('//')) { out += span('tok-comment', rest); break; }
    if (rest.startsWith('/*')) { inComment = true; out += span('tok-comment', '/*'); i += 2; continue; }
    if ((m = /^("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)/.exec(rest))) out += span('tok-string', m[0]);
    else if ((m = /^(0[xX][0-9a-fA-F]+|\d+)[uU]?/.exec(rest))) out += span('tok-immediate', m[0]);
    else if ((m = /^[A-Za-z_]\w*/.exec(rest))) out += C_WORDS.has(m[0]) ? span('tok-mnemonic', m[0]) : escape(m[0]);
    else { m = [line[i]]; out += escape(line[i]); }
    i += m[0].length;
  }
  return [out, inComment];
}

export class Editor {
  constructor({ onChange, onCursorLine, onHoverLine = null, onGutterClick = null }) {
    this.onChange = onChange;
    this.onCursorLine = onCursorLine;
    this.onHoverLine = onHoverLine;
    this.onGutterClick = onGutterClick;
    this.breaks = new Set(); // lines with a breakpoint (the gutter's red dot)
    this.lang = 'asm'; // 'asm' or 'c'
    this.linked = new Set(); // lines linked to the line pointed at elsewhere (WS-F-082)
    this.errors = new Map(); // line -> [{col, len, message}]
    this.tabLeaves = false; // after Escape, Tab moves the focus on (no keyboard trap, WCAG 2.1.2)
    this.current = null;
    // The gutter is a breakpoint margin for the pointer; the listing's B key is the keyboard way (WS-U-030).
    this.gutter = el('div.ed-gutter', { 'aria-hidden': 'true', title: STRINGS.breakpointGutter,
      onclick: (e) => { const n = Number(e.target.closest('.ed-num')?.dataset.n); if (n) this.onGutterClick?.(n); } });
    this.code = el('pre.ed-code', { 'aria-hidden': 'true' });
    this.marks = el('pre.ed-marks', { 'aria-hidden': 'true' });
    this.area = el('textarea.ed-input', {
      spellcheck: false, autocapitalize: 'off', autocomplete: 'off', wrap: 'off',
      'aria-label': STRINGS.editor, 'aria-autocomplete': 'list', 'aria-controls': 'ed-complete',
      oninput: (e) => { this.showTip(null); this.render(); this.onChange?.(this.area.value); if (e.isTrusted) this.complete(); else this.closeList(); },
      onscroll: () => { this.syncScroll(); this.closeList(); this.showTip(null); },
      onkeydown: (e) => this.key(e),
      onclick: () => { this.closeList(); this.onCursorLine?.(this.cursorLine()); },
      onkeyup: () => this.onCursorLine?.(this.cursorLine()),
      onmousemove: (e) => this.hover(e),
      onmouseleave: () => { this.hoverAt = null; this.onHoverLine?.(null); this.showTip(null); },
      onblur: () => setTimeout(() => this.closeList(), 150),
    });
    // completion list and help tooltip (WS-U-021)
    this.list = el('ul.ed-complete', { id: 'ed-complete', role: 'listbox', 'aria-label': STRINGS.assist.listLabel, hidden: true });
    this.tip = el('div.ed-tip', { role: 'tooltip', hidden: true });
    this.items = [];
    this.pick = 0;
    this.findInput = el('input.ed-find-input', { type: 'search', 'aria-label': STRINGS.find, placeholder: STRINGS.find,
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.findNext(); } if (e.key === 'Escape') this.closeFind(); } });
    this.findBar = el('div.ed-find', { hidden: true }, this.findInput,
      el('button', { type: 'button', text: STRINGS.findNext, onclick: () => this.findNext() }));
    this.root = el('div.editor', {}, this.findBar,
      el('div.ed-body', {}, this.gutter, el('div.ed-stack', {}, this.code, this.marks, this.area, this.list, this.tip)));
  }

  // --- completion and help (WS-U-021) ------------------------------------------------------------
  /** Width of one character and the height of a line of the text, in px. */
  metrics() {
    if (!this.charW) {
      const probe = el('span', { text: 'M'.repeat(20) });
      this.code.append(probe);
      this.charW = probe.getBoundingClientRect().width / 20 || 8;
      probe.remove();
    }
    const cs = getComputedStyle(this.area);
    return { cw: this.charW, lh: parseFloat(cs.lineHeight) || 18, pl: parseFloat(cs.paddingLeft) || 0, pt: parseFloat(cs.paddingTop) || 0 };
  }

  /** Offer completions for the word before the cursor (assembly only). */
  complete() {
    const a = this.area;
    if (this.lang !== 'asm' || a.selectionStart !== a.selectionEnd) { this.closeList(); return; }
    const pos = a.selectionStart;
    const lineStart = a.value.lastIndexOf('\n', pos - 1) + 1;
    const before = a.value.slice(lineStart, pos);
    const ctx = completionContext(before);
    const items = completions(ctx);
    if (!items.length) { this.closeList(); return; }
    this.ctx = { ...ctx, lineStart };
    this.items = items;
    // a whole word typed ("add") keeps Enter and Tab for the text; the arrows choose a longer one ("addi")
    this.pick = isComplete(ctx) ? -1 : 0;
    this.list.replaceChildren(...items.map((it, i) => el('li', { id: `ed-opt-${i}`, role: 'option', 'aria-selected': String(i === this.pick),
      onmousedown: (e) => { e.preventDefault(); this.insert(i); } }, el('span.mono.ed-opt-label', { text: it.label }), el('span.ed-opt-detail', { text: it.detail }))));
    const { cw, lh, pl, pt } = this.metrics();
    const line = a.value.slice(0, pos).split('\n').length;
    this.list.style.left = `${Math.max(0, pl + ctx.from * cw - this.code.scrollLeft)}px`;
    const below = pt + line * lh - this.code.scrollTop;
    this.list.style.top = `${below}px`;
    this.list.hidden = false;
    // no room under the line: open above it
    if (below + this.list.offsetHeight > this.area.clientHeight && below - lh - this.list.offsetHeight >= 0) {
      this.list.style.top = `${below - lh - this.list.offsetHeight}px`;
    }
    a.setAttribute('aria-expanded', 'true');
    if (this.pick >= 0) a.setAttribute('aria-activedescendant', `ed-opt-${this.pick}`); else a.removeAttribute('aria-activedescendant');
    this.showTip(null);
  }

  closeList() {
    if (this.list.hidden) return;
    this.list.hidden = true;
    this.items = [];
    this.area.setAttribute('aria-expanded', 'false');
    this.area.removeAttribute('aria-activedescendant');
  }

  movePick(d) {
    this.pick = this.pick < 0 ? (d > 0 ? 0 : this.items.length - 1) : (this.pick + d + this.items.length) % this.items.length;
    [...this.list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === this.pick)));
    this.area.setAttribute('aria-activedescendant', `ed-opt-${this.pick}`);
    this.list.children[this.pick]?.scrollIntoView({ block: 'nearest' });
  }

  insert(i) {
    const it = this.items[i];
    if (!it) return;
    const a = this.area;
    a.setRangeText(it.label, this.ctx.lineStart + this.ctx.from, a.selectionStart, 'end');
    this.closeList();
    a.dispatchEvent(new Event('input'));
  }

  /** The help tooltip at (x, y) in the editor's box, or none. */
  showTip(h, x = 0, y = 0) {
    if (!h) { this.tip.hidden = true; this.tipWord = null; return; }
    const A = STRINGS.assist;
    const parts = h.kind === 'register' ? [el('span.mono', { text: h.text })]
      : [el('div.mono.ed-tip-usage', { text: h.usage }), el('div.ed-tip-kind', { text: h.kind === 'pseudo' ? A.pseudo : h.format }),
        h.operation ? el('div.mono.ed-tip-op', { text: h.operation }) : null];
    this.tip.replaceChildren(...parts);
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
    this.tip.hidden = false;
  }

  get value() { return this.area.value; }
  set value(v) { this.area.value = v; this.render(); }

  cursorLine() {
    return this.area.value.slice(0, this.area.selectionStart).split('\n').length;
  }

  key(e) {
    if (!this.list.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.movePick(e.key === 'ArrowDown' ? 1 : -1); return; }
      if ((e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) && this.pick >= 0) { e.preventDefault(); this.insert(this.pick); return; }
      if (e.key === 'Enter' || e.key === 'Tab') this.closeList();
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeList(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') this.closeList();
    }
    if (e.key === 'Escape') { this.tabLeaves = true; return; }
    if (e.key === 'Tab' && this.tabLeaves) { this.tabLeaves = false; return; }
    this.tabLeaves = false;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      const s = this.area.selectionStart;
      const col = s - this.area.value.lastIndexOf('\n', s - 1) - 1;
      const stop = this.lang === 'c' ? 4 : 8;
      const pad = ' '.repeat(stop - (col % stop));
      this.area.setRangeText(pad, s, this.area.selectionEnd, 'end');
      this.area.dispatchEvent(new Event('input'));
    } else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.findBar.hidden = false;
      this.findInput.focus();
      this.findInput.select();
    }
  }

  findNext() {
    const q = this.findInput.value;
    if (!q) return;
    const text = this.area.value.toLowerCase();
    let i = text.indexOf(q.toLowerCase(), this.area.selectionEnd);
    if (i < 0) i = text.indexOf(q.toLowerCase());
    if (i < 0) return;
    this.area.focus();
    this.area.setSelectionRange(i, i + q.length);
    this.scrollToLine(this.area.value.slice(0, i).split('\n').length);
  }

  closeFind() {
    this.findBar.hidden = true;
    this.area.focus();
  }

  setErrors(errors) {
    this.errors = new Map();
    for (const e of errors) {
      if (!this.errors.has(e.line)) this.errors.set(e.line, []);
      this.errors.get(e.line).push({ col: (e.column ?? 1) - 1, len: e.length ?? 0, message: e.message });
    }
    this.area.setAttribute('aria-invalid', String(errors.length > 0));
    this.render();
  }

  /** Select columns [col, col + len) of a line (1-based line and column). */
  selectAt(line, col = 1, len = 0) {
    const lines = this.area.value.split('\n');
    const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col - 1;
    this.area.focus();
    this.area.setSelectionRange(pos, pos + len);
    this.scrollToLine(line, true);
  }

  setCurrentLine(line) {
    this.current = line;
    this.render();
    if (line) this.scrollToLine(line, true);
  }

  /** Lines that hold a breakpoint, marked ● in the gutter. */
  setBreaks(lines) {
    this.breaks = new Set(lines);
    this.render();
  }

  /** The language of the text: 'asm' or 'c' (highlighting and tab stops). */
  setLanguage(lang) {
    this.lang = lang;
    this.render();
  }

  /** Mark the lines linked to a line pointed at elsewhere (WS-F-082); scroll the first into view. */
  setLinked(lines) {
    this.linked = new Set(lines);
    this.render();
    const first = Math.min(...this.linked);
    if (Number.isFinite(first)) this.scrollToLine(first, true);
  }

  /** The line under the pointer, reported once per line change; in assembly, the help of the word under it. */
  hover(e) {
    const r = this.area.getBoundingClientRect();
    const { cw, lh, pl, pt } = this.metrics();
    const line = Math.floor((e.clientY - r.top - pt + this.area.scrollTop) / lh) + 1;
    const lines = this.area.value.split('\n');
    if (this.lang === 'asm' && this.list.hidden && line >= 1 && line <= lines.length) {
      const col = Math.floor((e.clientX - r.left - pl + this.area.scrollLeft) / cw);
      const h = col >= 0 ? helpFor(lines[line - 1], col) : null;
      const key = h ? `${line}:${h.word}` : null;
      if (key !== this.tipWord) {
        this.showTip(h, e.clientX - r.left + 12, e.clientY - r.top + 16);
        this.tipWord = key;
      }
    } else if (!this.tip.hidden) this.showTip(null);
    if (!this.onHoverLine || line === this.hoverAt) return;
    this.hoverAt = line;
    this.onHoverLine(line >= 1 && line <= lines.length ? line : null);
  }

  goToLine(line) {
    const lines = this.area.value.split('\n');
    const pos = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
    this.area.focus();
    this.area.setSelectionRange(pos, pos);
    this.scrollToLine(line);
  }

  scrollToLine(line, onlyIfHidden = false) {
    const lh = parseFloat(getComputedStyle(this.area).lineHeight) || 18;
    const top = (line - 1) * lh;
    const view = this.area.clientHeight;
    if (onlyIfHidden && top >= this.area.scrollTop && top + lh <= this.area.scrollTop + view) return;
    this.area.scrollTop = Math.max(0, top - view / 3);
    this.syncScroll();
  }

  syncScroll() {
    this.code.scrollTop = this.area.scrollTop;
    this.code.scrollLeft = this.area.scrollLeft;
    this.marks.scrollTop = this.area.scrollTop;
    this.marks.scrollLeft = this.area.scrollLeft;
    this.gutter.scrollTop = this.area.scrollTop;
  }

  render() {
    const lines = this.area.value.split('\n');
    let inComment = false;
    this.code.innerHTML = lines.map((l, i) => {
      const cls = `${this.current === i + 1 ? ' ed-cur' : ''}${this.linked.has(i + 1) ? ' ed-link' : ''}`;
      let html;
      if (this.lang === 'c') [html, inComment] = highlightC(l, inComment);
      else html = highlightLine(l);
      return `<span class="ed-line${cls}">${html || ' '}</span>`;
    }).join('\n') + '\n';
    // Error layer: transparent text, the faulty token underlined, the message after the line.
    this.marks.innerHTML = lines.map((l, i) => {
      const errs = this.errors.get(i + 1);
      if (!errs) return escape(l);
      const { col, len, message } = errs[0];
      const from = Math.min(col, l.length);
      const to = Math.min(l.length, from + Math.max(len, 1));
      const bad = l.slice(from, to) || ' ';
      return `${escape(l.slice(0, from))}<span class="ed-errspan">${escape(bad)}</span>${escape(l.slice(to))}`
        + `<span class="ed-annot">   ◀ ${escape(message)}${errs.length > 1 ? ` (+${errs.length - 1})` : ''}</span>`;
    }).join('\n') + '\n';
    this.gutter.replaceChildren(...lines.map((_, i) => {
      const n = i + 1;
      const err = this.errors.get(n);
      const bp = this.breaks.has(n);
      return el(`div.ed-num${err ? '.ed-num-err' : ''}${this.current === n ? '.ed-num-cur' : ''}${this.linked.has(n) ? '.ed-num-link' : ''}${bp ? '.ed-num-bp' : ''}`,
        { title: err ? err.map((x) => x.message).join('\n') : null, 'data-n': n },
        el('span.ed-bp', { text: bp ? '●' : '' }),
        err ? '✖ ' : this.current === n ? '▶ ' : this.linked.has(n) ? '◆ ' : '', String(n));
    }));
    this.syncScroll();
  }
}
