// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8 } from './dom.js';
import { STRINGS } from './strings.js';
import { accessStages, STAGE_PLACE } from './cache-anim-model.js';
const A = STRINGS.mem.cv.anim;
const STEP_MS = 700;
const hex = (v) => `0x${(v >>> 0).toString(16)}`;
export const prefersReducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
function describe(s) {
 const a = { ...s };
 for (const k of ['addr', 'block']) if (k in a) a[k] = hex8(a[k]);
 if (a.tag !== undefined) a.tag = hex(a.tag);
 if (a.kind) a.kind = STRINGS.mem.cv.kinds[a.kind];
 return A.stages[s.id](a);
}
export class CacheAnim {
 constructor() {
 this.rec = null;
 this.stages = [];
 this.shown = 0;
 this.timer = null;
 this.list = el('ol.ca-steps', { 'aria-live': 'off' });
 this.progress = el('span.ca-progress.note');
 this.replay = el('button', { type: 'button', text: A.play, title: A.playTitle, onclick: () => this.start() });
 this.nextBtn = el('button', { type: 'button', text: A.next, title: A.nextTitle, onclick: () => { this.stop(); this.reveal(this.shown + 1); } });
 this.allBtn = el('button', { type: 'button', text: A.all, title: A.allTitle, onclick: () => { this.stop(); this.reveal(this.stages.length); } });
 this.diagram = this.buildDiagram();
 this.steps = el('details.cv-more.ca-words', {}, el('summary', { text: A.stepsTitle }), this.list);
 this.note = el('p.note.ca-note', { hidden: true, text: A.reduced });
 this.root = el('section.cv-card.ca-card', { 'aria-label': A.title },
 el('div.ca-head', {}, el('h4', { text: A.title }), el('span.ca-controls', {}, this.replay, this.nextBtn, this.allBtn, this.progress)), this.note, this.diagram, this.steps);
 }
 buildDiagram() {
 const box = (k, text) => el(`span.ca-box.ca-box-${k}`, { text, 'data-box': k });
 const arrow = (k, text) => el(`span.ca-flow.ca-flow-${k}`, { 'data-flow': k, text });
 return el('div.ca-diagram', { 'aria-hidden': 'true' }, box('cpu', A.drawCpu), el('span.ca-link', { text: '⇄' }), box('cache', A.drawCache), arrow('toCache', A.drawToCache), arrow('toMem', A.drawToMem), box('mem', A.drawMem));
 }
 show(rec, cache) {
 if (rec === this.rec) return;
 this.stop();
 this.rec = rec;
 this.stages = rec ? accessStages(rec, cache) : [];
 this.list.replaceChildren(...this.stages.map((s, i) => el(`li.ca-step.ca-${A.kindOf[s.id]}`, { 'data-stage': s.id, 'data-n': String(i + 1) }, describe(s))));
 this.start();
 }
 start() {
 this.stop();
 const reduced = prefersReducedMotion();
 this.note.hidden = !reduced || !this.stages.length;
 if (reduced || !this.stages.length) { this.reveal(this.stages.length); return; }
 this.reveal(1);
 this.timer = setInterval(() => {
 if (!this.root.isConnected) { this.stop(); this.reveal(this.stages.length); return; }
 if (this.shown >= this.stages.length) { this.stop(); return; }
 this.reveal(this.shown + 1);
 }, STEP_MS);
 }
 stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
 reveal(n) {
 this.shown = Math.min(Math.max(n, 0), this.stages.length);
 [...this.list.children].forEach((li, i) => {
 li.classList.toggle('ca-on', i < this.shown);
 li.classList.toggle('ca-now', i === this.shown - 1);
 if (i === this.shown - 1) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
 });
 const place = STAGE_PLACE[this.stages[this.shown - 1]?.id] ?? {};
 for (const b of this.diagram.querySelectorAll('[data-box]')) b.classList.toggle('ca-lit', b.dataset.box === place.at);
 for (const f of this.diagram.querySelectorAll('[data-flow]')) f.classList.toggle('ca-lit', f.dataset.flow === place.flow);
 const empty = !this.stages.length;
 this.progress.textContent = empty ? A.none : A.progress(this.shown, this.stages.length);
 this.nextBtn.disabled = empty || this.shown >= this.stages.length;
 this.allBtn.disabled = this.nextBtn.disabled;
 this.replay.disabled = empty;
 }
}
