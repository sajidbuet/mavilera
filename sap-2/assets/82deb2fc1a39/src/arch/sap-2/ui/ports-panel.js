// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { parseNumber } from '../language.js';
import { PORT_BITS } from '../engine.js';
import { SAP2_STRINGS } from '../strings.js';
const P = SAP2_STRINGS.ports;
const HEX = '0123456789ABCDEF';
export function parseByte(text) {
 const t = text.trim();
 const v = /^[0-9a-f]{1,2}$/i.test(t) ? parseInt(t, 16) : /^(0x|0b)|h$/i.test(t) ? parseNumber(t) : null;
 return v !== null && Number.isInteger(v) && v >= 0 && v <= 255 ? v : null;
}
export class PortsPanel {
 constructor(ctx) {
 this.ctx = ctx;
 this.steps = 0;
 this.serialIn = false;
 const value = () => el('div.sp-value.mono');
 const bit = (name, title, n) => {
 const lamp = el('span.sp-lamp', { 'aria-hidden': 'true' });
 const v = el('span.mono.sp-bit-v');
 return { lamp, v, root: el('div.sp-bit', { title }, lamp, el('span', { text: `${name} · ${P.bit(n)}` }), v) };
 };
 this.status = el('p.note.sp-status');
 this.in1 = value();
 this.keys = Array.from(HEX, (c, k) => el('button.sp-key.mono', { type: 'button', text: c, title: P.key(k), 'aria-label': P.key(k),
 onclick: () => this.enter(k) }));
 this.byteField = el('input.mono.sp-byte-in', { type: 'text', size: 6, maxlength: 10, spellcheck: 'false', autocomplete: 'off',
 'aria-label': P.byteTitle, title: P.byteTitle });
 this.enterBtn = el('button', { type: 'submit', text: P.enter, title: P.enterTitle });
 const form = el('form.sp-byte', { onsubmit: (e) => {
 e.preventDefault();
 const v = parseByte(this.byteField.value);
 if (v === null) { ctx.message(P.badByte(this.byteField.value.trim()), 'error'); return; }
 this.enter(v);
 } }, el('label', {}, `${P.byte} `, this.byteField), this.enterBtn);
 this.in2 = value();
 this.ready = bit(P.ready, P.readyTitle, 0);
 this.switchBtn = el('button.sp-switch', { type: 'button', role: 'switch', 'aria-checked': 'false', title: P.serialInTitle,
 onclick: () => this.toggleSerial() }, el('span.sp-track', { 'aria-hidden': 'true' }, el('span.sp-knob')), el('span', { text: `${P.serialIn} · ${P.bit(7)}` }));
 this.serialV = el('span.mono.sp-bit-v');
 this.display = el('div.sp-display.mono', { role: 'img' });
 this.out3 = value();
 this.out4 = value();
 this.serialOut = bit(P.serialOut, P.serialOutTitle, 0);
 this.ack = bit(P.acknowledge, P.acknowledgeTitle, 7);
 const port = (title, ...body) => el('section.sp-port', { 'aria-label': title }, el('h3', { text: title }), ...body);
 this.root = el('div.sap2-ports.scroll', {}, this.status,
 el('div.sp-grid', {},
 port(P.in1, this.in1, el('div.sp-keypad', { role: 'group', 'aria-label': P.keypad }, this.keys), form),
 port(P.in2, this.in2, this.ready.root, el('div.sp-bit', {}, this.switchBtn, this.serialV)),
 port(P.out3, this.display, this.out3),
 port(P.out4, this.out4, this.serialOut.root, this.ack.root)),
 el('p.note', { text: P.note }));
 this.controls = [...this.keys, this.byteField, this.enterBtn, this.switchBtn];
 this.update(null, { accepts: false, running: false });
 }
 enter(v) {
 this.ctx.input({ key: v });
 this.ctx.message(this.running ? P.enteredRun(v) : P.entered(v, this.steps, this.clock), 'info');
 }
 toggleSerial() {
 const on = !this.serialIn;
 this.ctx.input({ serialIn: on ? 1 : 0 });
 this.ctx.message(this.running ? P.switchedRun(on) : P.switched(on, this.steps, this.clock), 'info');
 }
 update(state, { accepts, running }) {
 const r = state?.registers ?? { IN1: 0, IN2: 0, OUT3: 0, OUT4: 0 };
 this.steps = state?.steps ?? 0;
 this.running = running;
 this.clock = Boolean(state?.clock);
 this.status.textContent = accepts ? '' : state ? P.noInput : P.noProgram;
 this.status.hidden = accepts;
 for (const c of this.controls) c.disabled = !accepts;
 const lamp = (b, on) => { b.lamp.classList.toggle('on', on); b.v.textContent = on ? '1' : '0'; };
 this.in1.textContent = P.value(r.IN1);
 this.in2.textContent = P.value(r.IN2);
 lamp(this.ready, Boolean(r.IN2 & PORT_BITS.READY));
 this.serialIn = Boolean(r.IN2 & PORT_BITS.SERIAL_IN);
 this.switchBtn.setAttribute('aria-checked', String(this.serialIn));
 this.switchBtn.classList.toggle('on', this.serialIn);
 this.serialV.textContent = this.serialIn ? '1' : '0';
 const d = r.OUT3.toString(16).toUpperCase().padStart(2, '0');
 this.display.textContent = d;
 this.display.setAttribute('aria-label', P.display(r.OUT3));
 this.out3.textContent = P.value(r.OUT3);
 this.out4.textContent = P.value(r.OUT4);
 lamp(this.serialOut, Boolean(r.OUT4 & PORT_BITS.SERIAL_OUT));
 lamp(this.ack, Boolean(r.OUT4 & PORT_BITS.ACKNOWLEDGE));
 }
}
