// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
import { Editor } from './editor.js';
import { STRINGS } from './strings.js';
let seq = 0;
export class EditorStack {
 constructor({ language, onChange, onCursorLine = null, onHoverLine = null, onGutterClick = null, onSelect = null, onClose = null, langOf = () => 'asm' }) {
 this.language = language;
 this.cb = { onChange, onCursorLine, onHoverLine, onGutterClick, onSelect, onClose };
 this.langOf = langOf;
 this.editors = new Map();
 this.order = [];
 this.activeName = null;
 this.areaListeners = [];
 this.errorsBy = new Map();
 this.breaksBy = new Map();
 this.currentAt = null;
 this.id = `eds${++seq}`;
 this.tabs = el('div.ed-tabs', { role: 'tablist', 'aria-label': STRINGS.projects.tabs, onkeydown: (e) => this.tabKey(e) });
 this.root = el('div.editor-stack', {});
 }
 ed(name = this.activeName) { return this.editors.get(name)?.ed ?? null; }
 get active() { return this.activeName; }
 get names() { return [...this.order]; }
 open(name, text = '') {
 if (this.editors.has(name)) return this.ed(name);
 const n = ++seq;
 const ed = new Editor({
 language: this.language, listId: `ed-complete-${n}`,
 onChange: (t) => this.cb.onChange(this.nameOf(ed), t),
 onCursorLine: (l) => this.cb.onCursorLine?.(l),
 onHoverLine: (l) => this.cb.onHoverLine?.(l),
 onGutterClick: (l) => this.cb.onGutterClick?.(l, this.nameOf(ed)),
 });
 ed.value = text;
 ed.setLanguage(this.langOf(name));
 if (this.errorsBy.has(name)) ed.setErrors(this.errorsBy.get(name));
 if (this.breaksBy.has(name)) ed.setBreaks(this.breaksBy.get(name));
 if (this.currentAt?.file === name) ed.setCurrentLine(this.currentAt.line);
 const panel = el('div.ed-panel', { role: 'tabpanel', id: `${this.id}-p${n}`, 'aria-labelledby': `${this.id}-t${n}`, hidden: true }, ed.root);
 for (const [type, fn] of this.areaListeners) ed.area.addEventListener(type, fn);
 this.editors.set(name, { ed, panel, n });
 this.order.push(name);
 this.root.append(panel);
 this.renderTabs();
 return ed;
 }
 nameOf(ed) { for (const [k, v] of this.editors) if (v.ed === ed) return k; return null; }
 show(name, text) {
 if (!this.editors.has(name)) this.open(name, text ?? '');
 this.activeName = name;
 for (const [k, v] of this.editors) v.panel.hidden = k !== name;
 this.renderTabs();
 return this.ed(name);
 }
 close(name) {
 const v = this.editors.get(name);
 if (!v) return;
 v.panel.remove();
 this.editors.delete(name);
 this.order = this.order.filter((k) => k !== name);
 if (this.activeName === name) this.activeName = this.order[0] ?? null;
 if (this.activeName) this.show(this.activeName); else this.renderTabs();
 }
 rename(from, to) {
 const v = this.editors.get(from);
 if (!v) return;
 this.editors.delete(from);
 this.editors.set(to, v);
 this.order = this.order.map((k) => (k === from ? to : k));
 if (this.activeName === from) this.activeName = to;
 for (const m of [this.errorsBy, this.breaksBy]) if (m.has(from)) { m.set(to, m.get(from)); m.delete(from); }
 if (this.currentAt?.file === from) this.currentAt = { ...this.currentAt, file: to };
 v.ed.setLanguage(this.langOf(to));
 this.renderTabs();
 }
 reset(open, active, textOf) {
 for (const v of this.editors.values()) v.panel.remove();
 this.editors.clear();
 this.order = [];
 for (const n of open) this.open(n, textOf(n));
 this.show(active);
 }
 setText(name, text) { const ed = this.ed(name); if (ed && ed.value !== text) ed.value = text; }
 addAreaListener(type, fn) {
 this.areaListeners.push([type, fn]);
 for (const v of this.editors.values()) v.ed.area.addEventListener(type, fn);
 }
 renderTabs() {
 const S = STRINGS.projects;
 this.tabs.replaceChildren(...this.order.map((name) => {
 const v = this.editors.get(name);
 const on = name === this.activeName;
 return el('span.ed-tab-item', { 'data-name': name, role: 'presentation' },
 el('button.ed-tab', { type: 'button', role: 'tab', id: `${this.id}-t${v.n}`, 'aria-selected': String(on), 'aria-controls': v.panel.id,
 tabindex: on ? '0' : '-1', 'data-name': name, 'aria-keyshortcuts': this.order.length > 1 ? 'Delete' : null,
 onclick: () => this.cb.onSelect?.(name) }, el('span.ed-tab-name', { text: name })),
 this.order.length > 1 ? el('button.ed-tab-close', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', title: S.closeTab(name),
 onclick: (e) => { e.stopPropagation(); this.cb.onClose?.(name); } }, '×') : null);
 }));
 }
 tabKey(e) {
 const tab = e.target.closest?.('[role=tab]');
 if (!tab) return;
 const i = this.order.indexOf(tab.dataset.name);
 let j = null;
 if (e.key === 'ArrowRight') j = (i + 1) % this.order.length;
 else if (e.key === 'ArrowLeft') j = (i - 1 + this.order.length) % this.order.length;
 else if (e.key === 'Home') j = 0;
 else if (e.key === 'End') j = this.order.length - 1;
 else if (e.key === 'Delete' && this.order.length > 1) { e.preventDefault(); this.cb.onClose?.(tab.dataset.name); return; }
 if (j === null) return;
 e.preventDefault();
 this.cb.onSelect?.(this.order[j]);
 this.tabs.querySelector(`[role=tab][data-name="${CSS.escape(this.order[j])}"]`)?.focus();
 }
 setErrorsByFile(diags, fallback) {
 const by = new Map();
 for (const d of diags) { const f = d.file ?? fallback; if (!by.has(f)) by.set(f, []); by.get(f).push(d); }
 this.errorsBy = by;
 for (const [k, v] of this.editors) v.ed.setErrors(by.get(k) ?? []);
 }
 setCurrentAt(loc, follow = true) {
 this.currentAt = loc;
 if (loc && follow && loc.file && loc.file !== this.activeName) this.cb.onSelect?.(loc.file);
 for (const [k, v] of this.editors) {
 const line = loc && k === loc.file ? loc.line : null;
 if (v.ed.current !== line) v.ed.setCurrentLine(line);
 }
 }
 setBreaksByFile(map) {
 this.breaksBy = map;
 for (const [k, v] of this.editors) v.ed.setBreaks(map.get(k) ?? new Set());
 }
 clearMarks() { this.errorsBy = new Map(); this.breaksBy = new Map(); this.currentAt = null; }
 get value() { return this.ed()?.value ?? ''; }
 set value(v) { const ed = this.ed(); if (ed) ed.value = v; }
 get area() { return this.ed().area; }
 get current() { return this.ed()?.current ?? null; }
 cursorLine() { return this.ed().cursorLine(); }
 setErrors(errors) { this.ed()?.setErrors(errors); }
 selectAt(line, col, len) { this.ed()?.selectAt(line, col, len); }
 setCurrentLine(line) { this.ed()?.setCurrentLine(line); }
 setBreaks(lines) { this.ed()?.setBreaks(lines); }
 setLanguage() { }
 setLinked(lines) { this.ed()?.setLinked(lines); }
 goToLine(line) { this.ed()?.goToLine(line); }
 scrollToLine(line, onlyIfHidden) { this.ed()?.scrollToLine(line, onlyIfHidden); }
 syncScroll() { this.ed()?.syncScroll(); }
}
