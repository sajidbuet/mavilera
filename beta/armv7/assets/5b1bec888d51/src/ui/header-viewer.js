// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
import { STRINGS } from './strings.js';
export class HeaderViewer {
 constructor() {
 this.title = el('h2', { id: 'hv-title' });
 this.from = el('p.note', { id: 'hv-from' });
 this.code = el('pre.hv-code.mono', { tabindex: '0', 'aria-labelledby': 'hv-title' });
 this.copyBtn = el('button', { type: 'button', text: STRINGS.headerViewer.copy, onclick: () => this.copy() });
 this.root = el('dialog.header-viewer', { 'aria-labelledby': 'hv-title', 'aria-describedby': 'hv-from' },
 this.title, this.from, this.code,
 el('form.hv-acts', { method: 'dialog' }, this.copyBtn, ' ', el('button', { type: 'submit', text: STRINGS.aboutClose })));
 this.text = '';
 }
 open(h, L, kindLabel) {
 if (!this.root.isConnected) document.body.append(this.root);
 this.text = h.text ?? '';
 this.title.textContent = L.viewer(h.name);
 this.from.textContent = L.from(kindLabel, h.path);
 const lines = this.text.replace(/\n$/, '').split('\n');
 const w = String(lines.length).length;
 this.code.textContent = lines.map((l, i) => `${String(i + 1).padStart(w)}  ${l}`).join('\n');
 this.code.scrollTop = 0;
 this.root.showModal();
 this.code.focus();
 }
 async copy() {
 try { await navigator.clipboard.writeText(this.text); this.copyBtn.textContent = STRINGS.headerViewer.copied; } catch { }
 setTimeout(() => { this.copyBtn.textContent = STRINGS.headerViewer.copy; }, 1500);
 }
}
