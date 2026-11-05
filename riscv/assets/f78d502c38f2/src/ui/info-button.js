// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
let seq = 0;
const GAP = 6;
const EDGE = 8;
function place(button, pop) {
 const b = button.getBoundingClientRect();
 const w = Math.min(pop.offsetWidth || 384, innerWidth - 2 * EDGE);
 const h = pop.offsetHeight || 0;
 const left = Math.max(EDGE, Math.min(b.right - w, innerWidth - EDGE - w));
 const below = b.bottom + GAP;
 const top = below + h > innerHeight - EDGE && b.top - GAP - h > EDGE ? b.top - GAP - h : below;
 Object.assign(pop.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
}
export function infoButton(paragraphs, label) {
 const id = `info-pop-${++seq}`;
 const text = paragraphs.join('\n\n');
 const pop = el('div.info-pop', { id, popover: 'auto', role: 'note', 'aria-label': label }, paragraphs.map((p) => el('p', { text: p })));
 const button = el('button.info-btn', { type: 'button', title: text, 'aria-label': label, 'aria-expanded': 'false', 'aria-controls': id, popovertarget: id }, 'i');
 if (!('popover' in pop)) {
 pop.removeAttribute('popover');
 pop.hidden = true;
 button.addEventListener('click', () => { pop.hidden = !pop.hidden; button.setAttribute('aria-expanded', String(!pop.hidden)); });
 } else {
 pop.addEventListener('beforetoggle', (e) => {
 const open = e.newState === 'open';
 button.setAttribute('aria-expanded', String(open));
 if (open) place(button, pop);
 });
 pop.addEventListener('toggle', (e) => { if (e.newState === 'open') place(button, pop); });
 }
 return el('span.info-wrap', {}, button, pop);
}
