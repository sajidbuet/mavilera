// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { PICO2_STRINGS } from '../strings.js';
import { disassemblePio } from '../pio/asm.js';
const P = PICO2_STRINGS.pio;
const hex = (v, n = 8) => `0x${(v >>> 0).toString(16).padStart(n, '0')}`;
export class PioPanel {
 constructor() {
 this.note = el('p.note.dv-note', { text: P.noProgram });
 this.body = el('div.dv-body');
 this.root = el('div.pico2-devices.dv-pio', { tabindex: '0', role: 'region', 'aria-label': P.caption }, this.note, this.body);
 this.last = '';
 }
 update(state, { running }) {
 const p = state?.panel?.pio;
 if (!p) { this.note.textContent = running ? P.running : P.noProgram; if (!running) this.body.replaceChildren(); return; }
 const key = JSON.stringify(p);
 if (key === this.last) return;
 this.last = key;
 const used = p.filter((b) => b.imem.some((w) => w) || b.sm.some((s) => s.enabled || s.executed));
 this.note.textContent = used.length ? P.intro : P.unused;
 this.body.replaceChildren(...used.flatMap((b) => this.block(b)));
 }
 block(b) {
 const sideOf = (a) => {
 for (const s of b.sm) {
 const lo = (s.execctrl >>> 7) & 31, hi = (s.execctrl >>> 12) & 31;
 if ((s.enabled || s.executed) && a >= Math.min(lo, hi) && a <= Math.max(lo, hi)) return [s.pinctrl >>> 29, (s.execctrl >>> 30) & 1];
 }
 return [0, 0];
 };
 const rows = [];
 for (let a = 0; a < 32; a++) {
 const w = b.imem[a], marks = b.sm.filter((s) => (s.enabled || s.executed) && s.pc === a).map((s) => `SM${s.i}`);
 const wraps = b.sm.filter((s) => s.enabled || s.executed).flatMap((s) => [((s.execctrl >>> 7) & 31) === a ? P.wrapTarget(s.i) : null, ((s.execctrl >>> 12) & 31) === a ? P.wrap(s.i) : null]).filter(Boolean);
 if (!w && !marks.length) continue;
 const [bits, opt] = sideOf(a);
 rows.push(el('tr', {}, el('th', { scope: 'row', text: String(a) }), el('td.mono', { text: hex(w, 4) }), el('td.mono', { text: disassemblePio(w, bits, opt === 1) }),
 el('td', { text: marks.join(' ') }), el('td.note', { text: wraps.join(', ') })));
 }
 const prog = el('table.dv-table', {}, el('caption', { text: P.memory(b.index) }),
 el('thead', {}, el('tr', {}, P.memHead.map(([h, t]) => el('th', { scope: 'col', text: h, title: t ?? null })))), el('tbody', {}, rows));
 const smRows = b.sm.filter((s) => s.enabled || s.executed || s.tx.length || s.rx.length).map((s) => {
 const div = (s.clkdiv >>> 16 || 65536) + ((s.clkdiv >>> 8) & 0xff) / 256, pc = s.pinctrl;
 return [P.sm(s.i), s.enabled ? (s.stall ? P.stalls[s.stall] : s.wait ? P.delay(s.wait) : P.runningSm) : P.stopped, String(+div.toFixed(4)), String(s.pc),
 hex(s.x), hex(s.y), `${hex(s.isr)} (${s.isrN})`, `${hex(s.osr)} (${32 - s.osrN})`, s.tx.map((v) => hex(v)).join(' ') || '—', s.rx.map((v) => hex(v)).join(' ') || '—',
 P.pins(pc & 31, (pc >>> 20) & 63, (pc >>> 5) & 31, (pc >>> 26) & 7, (pc >>> 10) & 31, pc >>> 29, (pc >>> 15) & 31), String(s.executed)];
 });
 const sms = el('table.dv-table', {}, el('caption', { text: P.smCaption(b.index) }),
 el('thead', {}, el('tr', {}, P.smHead.map(([h, t]) => el('th', { scope: 'col', text: h, title: t ?? null })))),
 el('tbody', {}, smRows.map((r) => el('tr', {}, r.map((c, i) => (i === 0 ? el('th', { scope: 'row', text: c }) : el('td.mono', { text: c })))))));
 const flags = [];
 for (let k = 0; k < 8; k++) if ((b.flags >>> k) & 1) flags.push(String(k));
 return [prog, sms, el('p.note', { text: P.flags(b.index, flags) })];
 }
}
