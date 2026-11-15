// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, store } from '../../../ui/dom.js';
import { phys } from '../cpu.js';
import { hexH } from '../isa.js';
import { QUEUE_SIZE, FETCH_FREE } from '../biu-model.js';
import { I8086_STRINGS } from '../strings.js';
const D = I8086_STRINGS.datapath;
const GROUP_KEY = 'pips.i8086.queueWords';
const RECENT = 16;
const xx = (v) => (v & 0xff).toString(16).toUpperCase().padStart(2, '0');
export function cycleText(c) {
 if (!c) return '';
 const where = c.kind === 'inta' ? '' : c.kind === 'in' || c.kind === 'out' ? `port ${hexH(c.address, 4)}` : hexH(c.address, 5);
 return `${D.cycleKinds[c.kind]}, ${c.size} bits${where ? ` at ${where}` : ''}${c.discard ? `; ${D.discarded}` : ''}`;
}
export function queueCells(s) {
 const cells = Array.from({ length: QUEUE_SIZE }, () => null);
 s.q.forEach((b, j) => { cells[(s.rd + j) % QUEUE_SIZE] = b; });
 return { cells, read: s.rd, write: (s.rd + s.q.length) % QUEUE_SIZE };
}
export class QueuePanel {
 constructor() {
 let saved = null;
 try { saved = store.get(GROUP_KEY); } catch { }
 this.words = saved === '1';
 this.toggle = el('input', { type: 'checkbox', checked: this.words, onchange: (e) => {
 this.words = e.target.checked;
 store.set(GROUP_KEY, this.words ? '1' : '0');
 this.render(this.last);
 } });
 this.body = el('div');
 this.root = el('div.i8-tab.scroll', {}, this.body);
 this.last = null;
 }
 render(arg) {
 this.last = arg;
 const { model: m, next, clockMode } = arg ?? {};
 if (!clockMode || !m) {
 this.body.replaceChildren(el('p', {}, el('strong', { text: D.queueHeading })), el('p', { text: D.queueStepMode }));
 return;
 }
 const s = m.core.s;
 const { cells, read, write } = queueCells(s);
 const pointer = (i) => (i === read && i === write ? D.bothPtr : i === read ? D.readPtr : i === write ? D.writePtr : '');
 const rows = cells.map((b, i) => el(`tr${i === read && s.q.length ? '.i8-on' : ''}`, {},
 this.words && i % 2 === 0 ? el('td', { rowspan: 2, text: D.word(i / 2 + 1) }) : null,
 el('td.mono', { text: String(i + 1) }),
 el('td.mono', { text: b ? hexH(b.a, 5) : '' }),
 el('td.mono', { text: b ? xx(b.v) : '' }),
 el('td', { text: pointer(i) })));
 const head = el('tr', {}, this.words ? el('th', { scope: 'col', text: D.wordCol }) : null,
 ...D.cellCols.map((t) => el('th', { scope: 'col', text: t })));
 const cs = m.mm.regs.CS;
 const free = QUEUE_SIZE - s.q.length;
 const fetchRule = m.halted ? D.fetchHalted : s.req ? D.fetchNoReq : free >= FETCH_FREE ? D.fetchYes : D.fetchNoRoom;
 const bus = s.cycle ? `${D.tState(s.cycle.t, s.cycle.w)} · ${cycleText(s.cycle)}` : D.busIdleT;
 const nextText = next ? `${next.t}${next.cycle ? ` · ${cycleText(next.cycle)}` : ''}; ${D.eu[next.eu] ?? ''}${next.qs ? `; ${next.qs}: ${D.qs[next.qs]}` : ''}` : '';
 const facts = [
 [D.facts.queued, D.queueBytes(s.q.length)],
 [D.facts.nextFetch, `${hexH(cs, 4)}:${hexH(s.fetch, 4)} = ${hexH(phys(cs, s.fetch), 5)}${s.fetch & 1 ? ` ${D.oddFetch}` : ''}`],
 [D.facts.fetchRule, fetchRule],
 [D.facts.bus, bus],
 [D.facts.next, nextText],
 [D.facts.wait, String(m.waitStates)],
 ];
 const recs = m.journal.slice(-RECENT).map((j) => j.rec);
 const recent = recs.length ? el('table.listing', {},
 el('caption', { text: D.recentCaption }),
 el('thead', {}, el('tr', {}, D.recentCols.map((t) => el('th', { scope: 'col', text: t })))),
 el('tbody', {}, recs.map((r) => el('tr', {},
 el('td.mono', { text: String(r.n + 1) }),
 el('td.mono', { text: r.t }),
 el('td', { text: cycleText(r.cycle) }),
 el('td', { text: `${D.euShort[r.eu] ?? ''}${r.took ? ` (${xx(r.took.v)})` : ''}${r.took?.stale ? ` ⚠ ${D.staleShort}` : ''}` }),
 el('td', { text: r.qs ? `${r.qs}: ${D.qs[r.qs]}` : '' }),
 el('td.mono', { text: String(r.q) }))))) : el('p', { text: D.noClocks });
 this.body.replaceChildren(...[
 el('p', {}, el('strong', { text: D.queueHeading })),
 el('table.listing', {}, el('caption', { text: D.cellsCaption }), el('thead', {}, head), el('tbody', {}, rows)),
 el('p', {}, el('label.toggle', { title: D.groupTitle }, this.toggle, ` ${D.groupWords}`)),
 this.words ? el('p.i8-src', { text: D.groupNote }) : null,
 el('table', {}, el('tbody', {}, facts.map(([k, v]) => el('tr', {}, el('th', { scope: 'row', text: k }), el('td', { text: v }))))),
 recent,
 el('p.i8-src', { text: D.qsNote }),
 el('p.i8-src', { text: D.rulesNote })].filter(Boolean));
 }
}
