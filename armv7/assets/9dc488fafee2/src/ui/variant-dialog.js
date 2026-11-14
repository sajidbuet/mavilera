// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
import { STRINGS } from './strings.js';
export class VariantDialog {
 constructor() {
 const V = STRINGS.variant;
 this.text = el('p', {});
 this.kept = el('p.note', {});
 this.reloadBtn = el('button', { type: 'submit', value: 'reload', text: V.reload });
 this.root = el('dialog.variant-dialog', { 'aria-labelledby': 'variant-title' },
 el('h2', { id: 'variant-title', text: V.title }),
 this.text, this.kept,
 el('form', { method: 'dialog' },
 el('button', { type: 'submit', value: 'cancel', text: V.cancel }), ' ', this.reloadBtn));
 }
 ask(from, to) {
 const V = STRINGS.variant;
 this.text.textContent = V.text(from, to);
 this.kept.textContent = V.kept(from);
 this.root.returnValue = '';
 return new Promise((resolve) => {
 this.root.addEventListener('close', () => resolve(this.root.returnValue === 'reload'), { once: true });
 this.root.showModal();
 this.reloadBtn.focus();
 });
 }
}
