// i8086/ui/interrupt-panel.js -- the 8086 interrupt inputs' panel (contract v8, Descriptor.panels; 8086-B8, roadmap §12
// question 9, design docs/architecture/i8086-review.md §4, decisions B8-Q4 to Q8): a tab of the shared memory pane, as
// SAP-2's ports are. An NMI button (a rising edge, latched), the INTR switch (a level: it stays on until turned off,
// B8-Q4) with the type byte the second INTA cycle returns, and a delay in instructions before an input arrives. The
// panel shows what is latched, what is due next and why an interrupt waits; every value is also text, never colour alone.
// The inputs go to the shell (PanelContext.input), which gives them to the engine with the step count. The state comes
// from the engine's hidden registers NMI, INTR, ITYPE, INEXT, ICOMING and IHALT (engine.js IRQ_REGS). The panel's layout is
// the simulator's own (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { I8086_STRINGS } from '../strings.js';
import { FLAG } from '../cpu.js';

const T = I8086_STRINGS.interrupts;
const hex2 = (v) => `${v.toString(16).toUpperCase().padStart(2, '0')}H`;

/** A type typed in the field: one or two hexadecimal digits, with or without H; or null. */
export function parseType(text) {
  const t = text.trim().replace(/h$/i, '');
  return /^[0-9a-f]{1,3}$/i.test(t) && parseInt(t, 16) <= 255 ? parseInt(t, 16) : null;
}

/** A delay typed in the field: 0 to 999; or null. */
export function parseDelay(text) {
  const t = text.trim();
  return /^\d{1,3}$/.test(t) ? Number(t) : t === '' ? 0 : null;
}

export class InterruptPanel {
  /** @param {import('../../contract.js').PanelContext} ctx */
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

  /** The delay field's value, or null after a message. */
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
    const has = 'NMI' in r; // the view in use may not model the inputs
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
    // what comes next, and why an interrupt waits
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
