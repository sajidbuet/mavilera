// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../../contract.js';
import { el } from '../../../ui/dom.js';
import { BusModel, SIGNALS, microinstruction, signalsOf, executeStates, alu } from '../bus-model.js';
import { BY_OPCODE, disassemble } from '../language.js';
import { REGISTER_IDS } from '../engine.js';
import { SAP2_STRINGS as S } from '../strings.js';
import { VIEW, BUS, UNITS, PINS, TAPS, STUBS, LINKS, BUNDLES, symbolBox } from './layout.js';
const B = S.bus;
const XF = B.xfer;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
const hx = (v, n = 2) => { const t = v.toString(16).toUpperCase().padStart(n, '0'); return `${/^[A-F]/.test(t) ? '0' : ''}${t}H`; };
const bin = (v, n) => v.toString(2).padStart(n, '0').replace(/(.{4})(?!$)/g, '$1 ');
const path = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const plainSym = (name) => B.plain(...B.symbols[name]);
const SIG = Object.fromEntries(SIGNALS.map((x) => [x.name, x]));
const UNIT_OF = { PCL: 'PC', PCH: 'PC', MARL: 'MAR', MARH: 'MAR', MEM: 'MEM', K: 'CTRL', IN: 'IN' };
const unitOf = (x) => UNIT_OF[x] ?? x;
function symbol(name, x, y, size, anchor = 'middle') {
 const [main, sub] = B.symbols[name];
 const { mainW, subW, w } = symbolBox(main, sub, size);
 const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
 return { w, g: s('g', { class: 's2-sym' }, s('text', { x: x0, y, 'font-size': size, textLength: mainW, lengthAdjust: 'spacing' }, main),
 sub ? s('text', { x: x0 + mainW, y: y + size * 0.28, 'font-size': size * 0.72, textLength: subW, lengthAdjust: 'spacing' }, sub) : null) };
}
const htmlSym = (name) => { const [main, sub] = B.symbols[name]; return el('span.s2-hsym', {}, main, sub ? el('sub', { text: sub }) : null); };
export function transfer(m) {
 if (!m) return '';
 const src = { PC: 'PC', PCL: 'PC[7:0]', PCH: 'PC[15:8]', MEM: XF.mem, IN: XF.in, K: m.k !== undefined ? hx(m.k, 4) : 'K',
 ALU: m.alu ? XF.alu(typeof B.aluOp[m.alu] === 'function' ? B.aluOp[m.alu](m.x ?? 'A') : B.aluOp[m.alu]) : 'ALU' }[m.src] ?? m.src;
 const dst = { MARL: 'MAR[7:0]', MARH: 'MAR[15:8]', PCL: 'PC[7:0]', PCH: 'PC[15:8]', OUT: XF.out };
 const parts = m.dst.map((d) => `${dst[d] ?? d} ← ${src}`);
 if (m.src === 'MEM') parts.push(`MDR ← ${XF.mem}`);
 if (m.flags) parts.push(`${XF.flags} ← ${src}`);
 if (m.inc) parts.push(XF.count);
 if (m.write) parts.push(XF.write);
 if (m.test) parts.push(XF.test);
 if (m.halt) parts.push(XF.halt);
 return parts.join('; ') || XF.idle;
}
const STYLE = `
.s2-view { flex: 1 1 0; min-height: 10rem; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.s2-svg { width: 100%; height: auto; max-height: 100%; font-family: var(--font-code); }
.s2-bg { fill: var(--surface); }
.s2-box { fill: var(--fig-fill); stroke: var(--text); stroke-width: 1.1; }
.s2-unit.s2-added .s2-box { stroke-dasharray: 5 3; }
.s2-unit.s2-on .s2-box { stroke: var(--primary); stroke-width: 2.2; }
.s2-unit.s2-trace .s2-box { stroke: var(--accent); stroke-width: 2.6; }
.s2-ctrlbox { fill: var(--surface-2); }
.s2-name { font: 600 11px var(--font-ui); fill: var(--text); }
.s2-title { font: 600 12px var(--font-ui); fill: var(--text); }
.s2-val { font-size: 17px; fill: var(--text); }
.s2-sub { font-size: 10.5px; fill: var(--muted); }
.s2-small { font: 9.5px var(--font-ui); fill: var(--muted); }
.s2-mid { font-size: 10.5px; fill: var(--text); }
.s2-sym { color: var(--text); } .s2-sym text { fill: currentColor; font-family: var(--font-ui); font-style: italic; }
.s2-bus { fill: var(--surface-3); stroke: var(--border-strong); }
.s2-bus.s2-on { fill: var(--primary-soft); stroke: var(--primary); stroke-width: 1.6; }
.s2-busval { font-size: 11px; fill: var(--text); }
.s2-stub { stroke: var(--border-strong); stroke-width: 3; fill: none; } .s2-head { fill: var(--border-strong); }
.s2-d.s2-on .s2-stub { stroke: var(--primary); stroke-width: 4; } .s2-d.s2-on .s2-head { fill: var(--primary); }
.s2-width { font-size: 9px; fill: var(--muted); } .s2-slash { stroke: var(--muted); stroke-width: 1; }
.s2-halo { fill: none; stroke: var(--surface); stroke-width: 7; }
.s2-bundle { stroke: var(--rule); stroke-width: 5; stroke-linecap: round; }
.s2-bundle.s2-on { stroke: var(--accent); }
.s2-tap .s2-line { stroke: var(--rule); stroke-width: 1.1; stroke-dasharray: 3 2; }
.s2-tap.s2-on .s2-line { stroke: var(--accent); stroke-width: 2.2; stroke-dasharray: none; }
.s2-tap.s2-sel .s2-line { stroke: var(--accent); stroke-width: 3; }
.s2-hit { fill: none; stroke: transparent; stroke-width: 9; pointer-events: stroke; cursor: pointer; }
.s2-pin { cursor: pointer; } .s2-pin:focus { outline: none; } .s2-pin:focus-visible .s2-pinbox { stroke: var(--insight); stroke-width: 2; }
.s2-pinbox { fill: transparent; stroke: none; }
.s2-pin .s2-sym { color: var(--muted); } .s2-pin.s2-on .s2-sym { color: var(--accent); font-weight: 700; }
.s2-pin.s2-sel .s2-pinbox { stroke: var(--accent); stroke-width: 1.6; }
.s2-mem { fill: var(--surface); stroke: var(--border); } .s2-mem.s2-mar { fill: var(--changed-bg); stroke: var(--primary); }
.s2-mem-t { font-size: 9.5px; fill: var(--text); }
.s2-chip { fill: var(--surface); stroke: var(--border-strong); } .s2-chip-t.s2-on { fill: var(--primary-on); } .s2-chip.s2-on { fill: var(--primary); } .s2-chip.s2-out { fill: none; stroke: var(--border); stroke-dasharray: 2 2; }
.s2-disp { font-size: 30px; font-weight: 700; fill: var(--text); }
.s2-dispbox { fill: var(--code-back); stroke: var(--border-strong); }
.s2-pend { font: italic 10px var(--font-ui); fill: var(--warning); }
.s2-caption { font: 11px var(--font-ui); fill: var(--text); }
.s2-legend-d { stroke: var(--primary); stroke-width: 4; } .s2-legend-c { stroke: var(--accent); stroke-width: 1.4; stroke-dasharray: 3 2; }
.s2-tab table { border-collapse: collapse; } .s2-tab td, .s2-tab th { padding: 2px 8px; text-align: left; vertical-align: top; }
.s2-tab tr.s2-on td { background: var(--changed-bg); font-weight: 600; }
.s2-tab tr.s2-sel td { outline: 2px solid var(--accent); outline-offset: -2px; }
.s2-tab p { margin: 0.4em 0; }
.s2-hsym { font-style: italic; white-space: nowrap; } .s2-hsym sub { font-size: 0.72em; }
.s2-pick { font: inherit; background: none; border: 1px solid var(--border); border-radius: 4px; padding: 0 6px; cursor: pointer; color: inherit; }
.s2-pick[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-tint); }
.s2-src { color: var(--muted); font-size: 0.9em; }
`;
export class BusView {
 constructor() {
 this.model = null;
 this.selected = null;
 this.svg = s('svg', { class: 's2-svg', viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, role: 'group', focusable: 'false' });
 this.status = el('span.dp-status.mono');
 this.controlBox = el('div.s2-tab.scroll');
 this.sequenceBox = el('div.s2-tab.scroll');
 this.root = el('div.s2-view', {}, el('style', { text: STYLE }), this.svg);
 this.build();
 }
 load(program) {
 this.program = program;
 this.model = program ? new BusModel(program) : null;
 this.render();
 }
 select(name) {
 this.selected = this.selected === name ? null : name;
 this.render();
 }
 build() {
 const g = [s('rect', { class: 's2-bg', x: 0, y: 0, width: VIEW.w, height: VIEW.h })];
 const P = this.parts = { units: {}, stubs: {}, links: {}, taps: {}, pins: {} };
 const arrow = ([x1, y1], [x2, y2]) => {
 const dx = Math.sign(x2 - x1);
 const dy = Math.sign(y2 - y1);
 return dx ? `M${x2} ${y2} l${-8 * dx} -4.5 v9 z` : `M${x2} ${y2} l-4.5 ${-8 * dy} h9 z`;
 };
 const width = (a, b, bits) => {
 const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
 const vertical = a[0] === b[0];
 return [s('line', { class: 's2-slash', x1: mx - 4, y1: my + 4, x2: mx + 4, y2: my - 4 }),
 s('text', { class: 's2-width', x: vertical ? mx + 6 : mx, y: vertical ? my + 3.5 : my - 6, 'text-anchor': vertical ? 'start' : 'middle' }, bits)];
 };
 this.bundles = {};
 for (const [side, b] of Object.entries(BUNDLES)) {
 this.bundles[side] = s('line', { class: 's2-bundle', x1: b.points[0][0], y1: b.y, x2: b.points[1][0], y2: b.y });
 g.push(this.bundles[side]);
 }
 for (const t of TAPS) {
 const d = path(t.points);
 const node = s('g', { class: 's2-tap' }, s('title', {}, `${plainSym(t.signal)}: ${B.signals[t.signal]}`), s('path', { class: 's2-line', d }), s('path', { class: 's2-hit', d }));
 node.addEventListener('click', () => this.select(t.signal));
 P.taps[t.signal] = node;
 g.push(node);
 }
 for (const u of Object.values(UNITS)) {
 const p = { box: s('rect', { class: `s2-box${u.id === 'CTRL' ? ' s2-ctrlbox' : ''}`, x: u.x, y: u.y, width: u.w, height: u.h, rx: 6 }) };
 const kids = [s('title', {}, `${B.units[u.id]}: ${B.unitNames[u.id]}`), p.box];
 const top = u.row === 'top';
 const nameY = top ? u.y + 36 : u.y + 18;
 const x0 = u.x + 8;
 if (u.id === 'CTRL') kids.push(...this.buildController(u, p));
 else if (u.id === 'MEM') {
 kids.push(s('text', { class: 's2-name', x: x0, y: nameY }, B.units.MEM));
 p.rows = [];
 p.cells = [];
 for (let r = 0; r < 2; r++) {
 const y = u.y + 46 + r * 30;
 const lab = s('text', { class: 's2-small', x: x0, y: y + 16 });
 p.rows.push(lab);
 kids.push(lab);
 for (let c = 0; c < 8; c++) {
 const x = u.x + 46 + c * 27.5;
 const rect = s('rect', { class: 's2-mem', x, y, width: 26, height: 24, rx: 2 });
 const t = s('text', { class: 's2-mem-t', x: x + 13, y: y + 16, 'text-anchor': 'middle' });
 p.cells.push([rect, t]);
 kids.push(rect, t);
 }
 }
 } else if (u.id === 'IN' || u.id === 'OUT') {
 kids.push(s('text', { class: 's2-name', x: x0, y: nameY }, B.units[u.id]));
 const ids = u.id === 'IN' ? ['IN1', 'IN2'] : ['OUT3', 'OUT4'];
 p.vals = ids.map((id, i) => {
 const y = (top ? u.y + 62 : u.y + 44) + i * 30;
 const t = s('text', { class: 's2-mid', x: x0, y });
 const sub = s('text', { class: 's2-sub', x: x0, y: y + 13 });
 kids.push(t, sub);
 return [id, t, sub];
 });
 if (u.id === 'OUT') {
 kids.push(s('rect', { class: 's2-dispbox', x: u.x + u.w - 78, y: u.y + 30, width: 66, height: 46, rx: 4 }));
 p.disp = s('text', { class: 's2-disp', x: u.x + u.w - 45, y: u.y + 65, 'text-anchor': 'middle' });
 kids.push(p.disp);
 }
 } else if (u.id === 'FLAGS') {
 kids.push(s('text', { class: 's2-name', x: x0, y: nameY }, B.units.FLAGS));
 p.val = s('text', { class: 's2-val', x: x0, y: u.y + 50 });
 kids.push(p.val);
 } else {
 p.val = s('text', { class: 's2-val', x: x0, y: top ? u.y + 62 : u.y + 44 });
 p.sub = s('text', { class: 's2-sub', x: x0, y: top ? u.y + 80 : u.y + 62 });
 kids.push(s('text', { class: 's2-name', x: x0, y: nameY }, B.units[u.id]), p.val, p.sub);
 if (u.id === 'TMP2') kids.push(s('text', { class: 's2-small', x: x0, y: u.y + 80 }, B.added));
 }
 p.g = s('g', { class: `s2-unit${u.id === 'TMP2' ? ' s2-added' : ''}` }, kids);
 P.units[u.id] = p;
 g.push(p.g);
 }
 this.busRect = s('rect', { class: 's2-bus', x: BUS.x, y: BUS.y, width: BUS.w, height: BUS.h, rx: 3 });
 this.busText = s('text', { class: 's2-busval', x: BUS.x + BUS.w - 8, y: BUS.y + 16, 'text-anchor': 'end' });
 g.push(s('g', {}, s('title', {}, B.busName), this.busRect, s('text', { class: 's2-busval', x: BUS.x + 8, y: BUS.y + 16 }, B.busName), this.busText));
 for (const d of STUBS) {
 const [a, b] = d.points;
 const node = s('g', { class: 's2-d' }, s('line', { class: 's2-stub', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }), s('path', { class: 's2-head', d: arrow(a, b) }), width(a, b, d.width));
 P.stubs[`${d.unit}.${d.dir}`] = node;
 g.push(node);
 }
 for (const l of LINKS) {
 const d = path(l.points);
 const node = s('g', { class: 's2-d' }, l.points.length > 2 ? s('path', { class: 's2-halo', d }) : null, s('path', { class: 's2-stub', d }),
 s('path', { class: 's2-head', d: arrow(l.points.at(-2), l.points.at(-1)) }), width(l.points[0], l.points[1], l.width));
 P.links[`${l.from}.${l.to}`] = node;
 g.push(node);
 }
 for (const p of PINS) {
 const y = p.side === 'top' ? p.y + 15 : p.y - 7;
 const sym = symbol(p.name, p.x, y, 9.5);
 const node = s('g', { class: 's2-pin', tabindex: '0', role: 'button', 'aria-label': B.selectSignal(plainSym(p.name)) },
 s('rect', { class: 's2-pinbox', x: p.x - sym.w / 2 - 2, y: y - 10, width: sym.w + 4, height: 14, rx: 2 }), sym.g);
 node.addEventListener('click', () => this.select(p.name));
 node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.select(p.name); } });
 P.pins[p.name] = node;
 g.push(node);
 }
 const ly = VIEW.h - 30;
 g.push(s('line', { class: 's2-legend-d', x1: 28, y1: ly - 4, x2: 58, y2: ly - 4 }), s('text', { class: 's2-small', x: 64, y: ly }, B.legendData),
 s('line', { class: 's2-legend-c', x1: 170, y1: ly - 4, x2: 200, y2: ly - 4 }), s('text', { class: 's2-small', x: 206, y: ly }, B.legendControl));
 this.caption = s('g', {});
 g.push(this.caption);
 this.svg.replaceChildren(...g);
 }
 buildController(u, p) {
 const x0 = u.x + 10;
 const y0 = u.y + 30;
 p.opcode = s('text', { class: 's2-mid', x: x0, y: y0 + 34 });
 p.chips = [];
 const chips = [];
 for (let t = 1; t <= 18; t++) {
 const x = x0 + ((t - 1) % 9) * 21.5;
 const y = y0 + 70 + Math.floor((t - 1) / 9) * 22;
 const r = s('rect', { class: 's2-chip', x, y, width: 19, height: 18, rx: 3 });
 const tx = s('text', { class: 's2-small s2-chip-t', x: x + 9.5, y: y + 12.5, 'text-anchor': 'middle' }, String(t));
 p.chips.push([r, tx]);
 chips.push(r, tx);
 }
 p.phase = s('text', { class: 's2-mid', x: x0, y: y0 + 130 });
 p.micro = s('text', { class: 's2-mid', x: x0, y: y0 + 170 });
 p.micro2 = s('text', { class: 's2-mid', x: x0, y: y0 + 184 });
 p.sigs = s('g', {});
 p.pend = s('text', { class: 's2-pend', x: x0, y: y0 + 270 });
 p.cycle = s('text', { class: 's2-mid', x: x0, y: y0 + 310 });
 return [s('text', { class: 's2-title', x: x0, y: y0 + 4 }, B.units.CTRL), s('text', { class: 's2-small', x: x0, y: y0 + 20 }, 'IR'), p.opcode,
 s('text', { class: 's2-small', x: x0, y: y0 + 62 }, 'T'), ...chips, p.phase,
 s('text', { class: 's2-small', x: x0, y: y0 + 156 }, B.microLabel), p.micro, p.micro2,
 s('text', { class: 's2-small', x: x0, y: y0 + 208 }, B.signalsLabel), p.sigs, p.pend,
 s('text', { class: 's2-small', x: x0, y: y0 + 296 }, B.cycleLabel), p.cycle];
 }
 present() {
 const m = this.model;
 const regs = m?.regs ?? { A: 0, B: 0, C: 0, S: 0, Z: 0, PC: 0, IR: 0, IN1: 0, IN2: 0, OUT3: 0, OUT4: 0, MAR: 0, MDR: 0, TMP: 0, TMP2: 0 };
 const e = m && !m.halted ? m.evaluate() : null;
 const mi = m ? microinstruction(m.t, regs.IR, regs.S, regs.Z) : null;
 return { m, regs, t: m?.t ?? 1, e, mi, on: new Set(e && !e.error ? e.signals : []) };
 }
 render() {
 const st = this.present();
 const { m, regs, t, e, mi, on } = st;
 const U = this.parts.units;
 const P = this.parts;
 const sel = this.selected;
 const loads = new Set((e?.loads ?? []).map(([id]) => id));
 const driver = e && !e.error ? e.driver : null;
 const setVal = (id, v, bits) => { U[id].val.textContent = hx(v, bits / 4); U[id].sub.textContent = bin(v, bits); };
 for (const [id, bits] of [['PC', 16], ['MAR', 16], ['MDR', 8], ['IR', 8], ['A', 8], ['TMP', 8], ['TMP2', 8], ['B', 8], ['C', 8]]) setVal(id, regs[id], bits);
 U.FLAGS.val.textContent = `S ${regs.S}  Z ${regs.Z}`;
 for (const [id, t1, t2] of [...U.IN.vals, ...U.OUT.vals]) { t1.textContent = `${id.replace(/\d/, ' $&')} = ${hx(regs[id])}`; t2.textContent = bin(regs[id], 8); }
 U.OUT.disp.textContent = regs.OUT3.toString(16).toUpperCase().padStart(2, '0');
 const fn = (driver === 'ALU' || (mi?.alu && m)) ? mi : null;
 U.ALU.val.textContent = fn?.alu ? hx(alu(fn.alu, regs.A, regs.TMP, fn.x)) : '';
 U.ALU.sub.textContent = fn?.alu ? (typeof B.aluOp[fn.alu] === 'function' ? B.aluOp[fn.alu](fn.x ?? 'A') : B.aluOp[fn.alu]) : '';
 const pend = m?.pending();
 const base = regs.MAR & 0xfff0;
 U.MEM.rows.forEach((r, i) => { r.textContent = (base + 8 * i).toString(16).toUpperCase().padStart(4, '0'); });
 U.MEM.cells.forEach(([r, tx], i) => {
 const a = base + i;
 tx.textContent = (m?.mem[a] ?? 0).toString(16).toUpperCase().padStart(2, '0');
 r.classList.toggle('s2-mar', Boolean(m) && a === regs.MAR);
 });
 const n = m && t >= 4 ? 3 + (executeStates(regs.IR, regs.S, regs.Z)?.length ?? 0) : null;
 const ins = BY_OPCODE[regs.IR];
 U.CTRL.opcode.textContent = m ? `${hx(regs.IR)} · ${t >= 4 ? (ins?.mnemonic ?? '?') : B.fetching}` : '';
 U.CTRL.chips.forEach(([r, tx], i) => {
 r.classList.toggle('s2-on', Boolean(m) && i + 1 === t);
 r.classList.toggle('s2-out', n !== null && i + 1 > n);
 tx.classList.toggle('s2-on', Boolean(m) && i + 1 === t);
 });
 U.CTRL.phase.textContent = m ? `${n ? B.stateOf(t, n) : `T${t}`} · ${B.phase(t)}` : '';
 const words = transfer(mi).split('; ');
 U.CTRL.micro.textContent = m ? words.slice(0, 2).join('; ') : '';
 U.CTRL.micro2.textContent = m ? words.slice(2).join('; ') : '';
 const sigs = [...on];
 U.CTRL.sigs.replaceChildren(...(sigs.length ? sigs.map((name, i) => symbol(name, UNITS.CTRL.x + 10 + (i % 5) * 40, UNITS.CTRL.y + 30 + 226 + Math.floor(i / 5) * 18, 11, 'start').g)
 : [s('text', { class: 's2-small', x: UNITS.CTRL.x + 10, y: UNITS.CTRL.y + 256 }, m ? B.none : '')]));
 U.CTRL.pend.textContent = pend ? B.pending(transfer(pend).split(';')[0]) : '';
 U.CTRL.cycle.textContent = m ? String(m.cycle) : '';
 for (const [id, p] of Object.entries(U)) {
 p.g.classList.toggle('s2-on', Boolean(driver) && (unitOf(driver) === id || loads.has(id) || (id === 'MEM' && (on.has('CE') || on.has('WE')))));
 p.g.classList.toggle('s2-trace', Boolean(sel) && SIG[sel]?.unit === id);
 }
 for (const id of ['OUT3', 'OUT4']) if (loads.has(id)) U.OUT.g.classList.add('s2-on');
 for (const [name, node] of Object.entries(P.taps)) {
 node.classList.toggle('s2-on', on.has(name));
 node.classList.toggle('s2-sel', sel === name);
 }
 for (const [name, node] of Object.entries(P.pins)) {
 node.classList.toggle('s2-on', on.has(name));
 node.classList.toggle('s2-sel', sel === name);
 node.setAttribute('aria-pressed', String(sel === name));
 }
 for (const [side, line] of Object.entries(this.bundles)) line.classList.toggle('s2-on', PINS.some((p) => p.side === side && on.has(p.name)));
 this.busRect.classList.toggle('s2-on', Boolean(driver));
 this.busText.textContent = driver ? B.busValue(hx(e.bus, mi?.src === 'PC' || mi?.src === 'K' ? 4 : 2), B.units[unitOf(driver)]) : B.busIdle;
 const stubOn = { out: (id) => driver !== null && unitOf(driver) === id, in: (id) => loads.has(id) || (id === 'OUT' && (loads.has('OUT3') || loads.has('OUT4'))) };
 for (const [key, node] of Object.entries(P.stubs)) {
 const [id, dir] = key.split('.');
 node.classList.toggle('s2-on', stubOn[dir](id) && !(id === 'MDR' && dir === 'in' && driver === 'MEM'));
 }
 const linkOn = { 'MAR.MEM': on.has('CE') || on.has('WE'), 'MEM.MDR': on.has('CE'), 'MDR.MEM': on.has('WE'), 'IR.CTRL': Boolean(m) && t === 4,
 'A.ALU': driver === 'ALU', 'TMP.ALU': driver === 'ALU', 'FLAGS.CTRL': Boolean(mi?.test), 'ALU.FLAGS': on.has('Lf') };
 for (const [key, node] of Object.entries(P.links)) node.classList.toggle('s2-on', Boolean(linkOn[key]));
 this.renderCaption(st);
 const what = e && !e.error ? (driver ? B.drives(B.units[unitOf(driver)], hx(e.bus)) : B.idle) : '';
 this.svg.setAttribute('aria-label', B.figureLabel(t, what));
 this.status.textContent = m ? B.status(t, n ?? 3, t >= 4 ? (ins?.mnemonic ?? '?') : B.fetching, hx(m.instrPc, 4)) : '';
 this.renderControl(st);
 this.renderSequence();
 }
 renderCaption(st) {
 const y = VIEW.h - 10;
 if (!this.selected) { this.caption.replaceChildren(s('text', { class: 's2-caption', x: 28, y }, B.hint)); return; }
 const sym = symbol(this.selected, 28, y, 12, 'start');
 const on = st.on.has(this.selected);
 this.caption.replaceChildren(sym.g, s('text', { class: 's2-caption', x: 28 + sym.w + 6, y },
 `${on ? B.explain.on : B.explain.off}${B.signals[this.selected]} (${B.units[SIG[this.selected].unit]})`));
 }
 renderControl(st) {
 const { on, mi, m, t } = st;
 const refocus = this.controlBox.contains(document.activeElement) ? document.activeElement.dataset?.sig : null;
 const rows = SIGNALS.map((sg) => el(`tr${on.has(sg.name) ? '.s2-on' : ''}${this.selected === sg.name ? '.s2-sel' : ''}`, {},
 el('td', {}, el('button.s2-pick', { type: 'button', 'data-sig': sg.name, 'aria-pressed': String(this.selected === sg.name),
 title: B.selectSignal(plainSym(sg.name)), onclick: () => this.select(sg.name) }, htmlSym(sg.name))),
 el('td', { text: on.has(sg.name) ? B.yes : B.no }), el('td', { text: B.units[sg.unit] }), el('td', { text: B.signals[sg.name] })));
 const pend = m?.pending();
 this.controlBox.replaceChildren(...[
 el('p', {}, el('strong', { text: `${B.microLabel}: ` }), el('span.mono', { text: m ? `T${t} · ${transfer(mi)}` : '' })),
 pend ? el('p', { text: `${B.pending(transfer(pend).split(';')[0])}. ${B.pendingNote}` }) : null,
 el('table.listing', {}, el('thead', {}, el('tr', {}, [B.colSignal, B.colOn, B.colTo, B.colMeaning].map((h) => el('th', { text: h })))), el('tbody', {}, rows)),
 el('p.s2-src', { text: B.source })].filter(Boolean));
 if (refocus) this.controlBox.querySelector(`button[data-sig="${refocus}"]`)?.focus();
 }
 renderSequence() {
 const m = this.model;
 if (!m) { this.sequenceBox.replaceChildren(); return; }
 const known = m.t >= 4;
 const { IR, S: sf, Z } = m.regs;
 const list = known ? executeStates(IR, sf, Z) ?? [] : [];
 const rows = [];
 const n = known ? 3 + list.length : 3;
 for (let t = 1; t <= n; t++) {
 const x = t === 2 && !known ? microinstruction(2, IR) : t <= 3 ? microinstruction(t, 0) : list[t - 4];
 rows.push(el(`tr${m.t === t && !m.halted ? '.s2-on' : ''}`, {}, el('td.mono', { text: `T${t}` }), el('td', { text: B.phase(t) }),
 el('td', {}, signalsOf(x).flatMap((name, i) => (i ? [' ', htmlSym(name)] : [htmlSym(name)]))), el('td.mono', { text: transfer(x) })));
 }
 if (!known) rows.push(el('tr', {}, el('td.mono', { text: 'T4…' }), el('td', { text: B.phase(4) }), el('td', { text: '…' }), el('td')));
 this.sequenceBox.replaceChildren(
 el('p.mono', { text: known ? disassemble(wordOfPc(m)) : '' }),
 el('table.listing', {}, el('thead', {}, el('tr', {}, [B.colState, '', B.colSignal, B.colTransfer].map((h) => el('th', { text: h })))), el('tbody', {}, rows)),
 el('p.s2-src', { text: B.pendingNote }));
 }
}
function wordOfPc(m) {
 const ins = BY_OPCODE[m.regs.IR];
 if (!ins) return m.regs.IR;
 let w = 0;
 for (let k = 0; k < ins.bytes; k++) w = w * 256 + m.mem[(m.instrPc + k) & 0xffff];
 return w;
}
export const WAVE_SIGNALS = Object.freeze([{ name: 'T', width: 5, kind: 'state' }, ...SIGNALS.map((x) => ({ name: x.name, width: 1, kind: 'control' })),
 ...[['bus', 16], ['PC', 16], ['MAR', 16], ['MDR', 8], ['IR', 8], ['A', 8], ['TMP', 8], ['TMP2', 8], ['B', 8], ['C', 8], ['S', 1], ['Z', 1],
 ['OUT3', 8], ['OUT4', 8]].map(([name, w]) => ({ name, width: w }))]);
export function exportModel(program) {
 const m = new BusModel(program);
 return {
 evaluate: () => {
 const e = m.evaluate();
 const on = new Set(e.error ? [] : e.signals);
 return { signals: { T: m.t, ...Object.fromEntries(SIGNALS.map((x) => [x.name, on.has(x.name) ? 1 : 0])), bus: e.bus ?? 0,
 ...Object.fromEntries(WAVE_SIGNALS.slice(1 + SIGNALS.length + 1).map((x) => [x.name, m.regs[x.name]])) } };
 },
 step: () => m.step(),
 run: (limit) => {
 for (let i = 0; i < limit; i++) {
 const r = m.step();
 m.journal.length = 0;
 if (r !== 'step') return r;
 }
 return 'budget';
 },
 get error() { return m.error; },
 get writes() { return m.writes; },
 };
}
export function busInstance(v, ctx) {
 const headerTools = el('span.sb-tools', {},
 el('button', { type: 'button', text: B.backInstr, title: B.backInstrTitle, onclick: () => ctx.command?.('backUnit') }),
 el('button', { type: 'button', text: B.stepInstr, title: B.stepInstrTitle, onclick: () => ctx.command?.('stepUnit') }));
 const stop = (r) => (r === 'step' ? STOP.NONE : r === 'halt' ? STOP.HALT : STOP.ERROR);
 return {
 root: v.root, title: B.title, infoTitle: B.infoTitle, status: v.status, headerTools,
 diagrams: [v.svg],
 tabs: [[B.tabControl, v.controlBox], [B.tabSequence, v.sequenceBox]],
 load: (p) => v.load(p),
 reset: () => { v.model?.reset(); v.render(); },
 step: () => stop(v.model.step()),
 back: () => v.model?.back() ?? false,
 render: () => v.render(),
 input: (x) => { v.model?.input(x); },
 state: () => {
 const m = v.model;
 if (!m) return null;
 return { pc: m.regs.PC, instruction: m.instrPc, cycle: m.cycle, retired: m.retired, halted: m.halted, error: m.error,
 registers: Object.fromEntries(REGISTER_IDS.map((id) => [id, m.regs[id]])),
 changed: (m.last?.loads ?? []).map(([id]) => id).filter((id) => REGISTER_IDS.includes(id)),
 written: m.last?.write ? { address: m.last.write.address, size: 1 } : null };
 },
 stopMessage: (r) => (r === STOP.HALT && v.model ? B.halted(hx(v.model.instrPc, 4), v.model.cycle, v.model.retired) : null),
 breakAt: () => (v.model && v.model.t === 1 ? v.model.regs.PC : null),
 unit: { label: B.stepInstr, step: () => stop(v.model.stepInstruction()), back: () => v.model?.backInstruction() ?? false },
 dataAccess: () => {
 const m = v.model;
 if (!m || m.halted || m.t <= 3) return null;
 const mi = microinstruction(m.t, m.regs.IR, m.regs.S, m.regs.Z);
 return mi && (mi.src === 'MEM' || mi.write) ? { address: m.regs.MAR, size: 1 } : null;
 },
 exportModel: () => ({ model: exportModel(v.program), signals: WAVE_SIGNALS, module: 'sap2', label: B.title }),
 waveform: { defaults: ['T', 'bus', 'Ep', 'Lm', 'CE', 'Li', 'Eu', 'Lf', 'A', 'TMP', 'OUT3'], format: (name, val) => (name === 'T' ? `T${val}` : null) },
 memoryPort: () => (v.model ? { read: (address, size) => { let x = 0; for (let i = size - 1; i >= 0; i--) x = x * 256 + v.model.mem[(address + i) & 0xffff]; return x; } } : null),
 };
}
