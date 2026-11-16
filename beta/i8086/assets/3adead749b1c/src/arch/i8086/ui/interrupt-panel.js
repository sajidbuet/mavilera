// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { I8086_STRINGS } from '../strings.js';
import { FLAG } from '../cpu.js';
const T = I8086_STRINGS.interrupts;
const hex2 = (v) => `${v.toString(16).toUpperCase().padStart(2, '0')}H`;
export function parseType(text) {
 const t = text.trim().replace(/h$/i, '');
 return /^[0-9a-f]{1,3}$/i.test(t) && parseInt(t, 16) <= 255 ? parseInt(t, 16) : null;
}
export function parseDelay(text) {
 const t = text.trim();
 return /^\d{1,3}$/.test(t) ? Number(t) : t === '' ? 0 : null;
}
export class InterruptPanel {
 constructor(ctx) {
 this.ctx = ctx;
 this.steps = 0;
 this.intr = false;
 this.type = 8;
 const lamp = () => el('span.sp-lamp', { 'aria-hidden': 'true' });
 this.status = el('p.note.sp-status');
 this.nmiBtn = el('button.sp-key', { type: 'button', text: T.nmi, title: T.nmiTitle, onclick: () => this.raiseNmi() });
 this.nmiLamp = lamp();
 this.nmiV = el('span.mono.sp-bit-v');
 this.intrBtn = el('button.sp-switch', { type: 'button', role: 'switch', 'aria-checked': 'false', title: T.intrTitle,
 onclick: () => this.toggleIntr() }, el('span.sp-track', { 'aria-hidden': 'true' }, el('span.sp-knob')), el('span', { text: T.intr }));
 this.intrV = el('span.mono.sp-bit-v');
 this.typeField = el('input.mono.sp-byte-in', { type: 'text', size: 4, maxlength: 4, spellcheck: 'false', autocomplete: 'off',
 'aria-label': T.typeTitle, title: T.typeTitle, value: '08' });
 this.typeV = el('span.mono.sp-value');
 this.delayField = el('input.mono.sp-byte-in', { type: 'text', size: 4, maxlength: 3, spellcheck: 'false', autocomplete: 'off',
 'aria-label': T.delayTitle, title: T.delayTitle, value: '0', inputmode: 'numeric' });
 this.comingV = el('span.note');
 this.next = el('p.sp-value', { 'aria-live': 'polite' });
 const box = (title, ...body) => el('section.sp-port', { 'aria-label': title }, el('h3', { text: title }), ...body);
 this.root = el('div.sap2-ports.i8-irq.scroll', {}, this.status,
 el('div.sp-grid', {},
 box(T.nmi, el('div.sp-bit', {}, this.nmiBtn), el('div.sp-bit', {}, this.nmiLamp, this.nmiV)),
 box(T.intr, el('div.sp-bit', {}, this.intrBtn, this.intrV),
 el('div.sp-byte', {}, el('label', {}, `${T.type} `, this.typeField), this.typeV)),
 box(T.delay, el('div.sp-byte', {}, el('label', {}, `${T.delay} `, this.delayField)), this.comingV)),
 this.next,
 el('p.note', { text: T.note }));
 this.controls = [this.nmiBtn, this.intrBtn, this.typeField, this.delayField];
 this.update(null, { accepts: false, running: false });
 }
 delay() {
 const d = parseDelay(this.delayField.value);
 if (d === null) this.ctx.message(T.badDelay(this.delayField.value.trim()), 'error');
 return d;
 }
 raiseNmi() {
 const delay = this.delay();
 if (delay === null) return;
 const steps = this.steps;
 this.ctx.input({ nmi: true, ...(delay ? { delay } : {}) });
 this.ctx.message(this.running ? T.sentRun : T.sentNmi(steps, delay), 'info');
 }
 toggleIntr() {
 const delay = this.delay();
 if (delay === null) return;
 const type = parseType(this.typeField.value);
 if (type === null) { this.ctx.message(T.badType(this.typeField.value.trim()), 'error'); return; }
 const on = !this.intr;
 const steps = this.steps;
 this.ctx.input({ intr: on, type, ...(delay ? { delay } : {}) });
 this.ctx.message(this.running ? T.sentRun : T.sentIntr(on, type, steps, delay), 'info');
 }
 update(state, { accepts, running }) {
 const r = state?.registers ?? {};
 this.steps = state?.steps ?? 0;
 this.running = running;
 const has = 'NMI' in r;
 this.status.textContent = !state ? T.noProgram : accepts && has ? '' : T.noInput;
 this.status.hidden = Boolean(state && accepts && has);
 for (const c of this.controls) c.disabled = !(accepts && has);
 const nmi = Boolean(r.NMI);
 this.nmiLamp.classList.toggle('on', nmi);
 this.nmiV.textContent = nmi ? T.latched : T.notLatched;
 this.intr = Boolean(r.INTR);
 this.intrBtn.setAttribute('aria-checked', String(this.intr));
 this.intrBtn.classList.toggle('on', this.intr);
 this.intrV.textContent = this.intr ? T.on : T.off;
 this.typeV.textContent = has ? `${T.type}: ${hex2(r.ITYPE ?? 8)}` : '';
 this.comingV.textContent = r.ICOMING ? T.pending(r.ICOMING) : '';
 const ifOn = Boolean((r.FLAGS ?? 0) & FLAG.IF);
 let text = '';
 if (has) {
 if (r.IHALT) text = T.halted;
 else if (r.INEXT === 1) text = T.due.nmi;
 else if (r.INEXT === 2) text = T.due.intr(r.ITYPE ?? 8);
 else if (r.INEXT === 3) text = T.due.trap;
 else if (this.intr && !ifOn) text = T.waitIf;
 else if (nmi || this.intr) text = T.waitShadow;
 }
 this.next.textContent = text;
 this.next.hidden = !text;
 }
}
