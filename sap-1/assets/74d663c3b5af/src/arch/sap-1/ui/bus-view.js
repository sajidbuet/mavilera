// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../../contract.js';
import { el } from '../../../ui/dom.js';
import { BusModel, SIGNALS, CLOCK_LINES, controlSignals, controlWord, haltLine } from '../bus-model.js';
import { MNEMONIC_OF, OPCODES } from '../language.js';
import { REGISTER_IDS } from '../engine.js';
import { SAP1_STRINGS as S } from '../strings.js';
import { VIEW, BUS, UNITS, PORTS, CELLS, CTRL_PINS, WIRES, DOTS, STUBS, LINKS, symbolBox } from './layout.js';
const B = S.bus;
const X = B.explain;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
const hx = (v, n = 2) => { const t = v.toString(16).toUpperCase().padStart(n, '0'); return `${/^[A-F]/.test(t) ? '0' : ''}${t}H`; };
const bin = (v, n) => v.toString(2).padStart(n, '0');
const nib = (v, n) => bin(v, n).replace(/(.{4})(?!$)/g, '$1 ');
export const conHex = (w) => `${w.toString(16).toUpperCase().padStart(3, '0')}H`;
const path = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const SIG = Object.fromEntries(SIGNALS.map((x) => [x.name, x]));
const LINE = Object.fromEntries(CLOCK_LINES.map((x) => [x.name, x]));
export const barOf = (name) => SIG[name]?.low ?? LINE[name]?.bar ?? false;
const plainSym = (name) => { const [m, sub] = B.symbols[name]; return B.plain(m, sub, barOf(name)); };
function symbol(name, x, y, size, anchor = 'middle') {
 const [main, sub] = B.symbols[name];
 const { mainW, subW, w } = symbolBox(main, sub, size);
 const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
 const g = s('g', { class: 'sb-sym' },
 s('text', { x: x0, y, 'font-size': size, textLength: mainW, lengthAdjust: 'spacing' }, main),
 sub ? s('text', { x: x0 + mainW, y: y + size * 0.28, 'font-size': size * 0.72, textLength: subW, lengthAdjust: 'spacing' }, sub) : null,
 barOf(name) ? s('line', { class: 'sb-bar', x1: x0, x2: x0 + w, y1: y - size * 0.86, y2: y - size * 0.86 }) : null);
 return { g, w };
}
function htmlSym(name) {
 const [main, sub] = B.symbols[name];
 return el('span.sb-hsym', {}, el(`span${barOf(name) ? '.sb-ov' : ''}`, {}, main, sub ? el('sub', { text: sub }) : null),
 barOf(name) ? el('span.sr-only', { text: ' bar' }) : null);
}
const TRACE = {
 Cp: {}, Ep: { stubs: ['PC.out'], bus: true }, Lm: { stubs: ['MAR.in'], bus: true, links: ['MAR.RAM'] },
 CE: { stubs: ['RAM.out'], bus: true, links: ['MAR.RAM'] }, Li: { stubs: ['IR.in'], bus: true, links: ['IR.CTRL'] },
 Ei: { stubs: ['IR.out'], bus: true }, La: { stubs: ['A.in'], bus: true }, Ea: { stubs: ['A.out'], bus: true },
 Su: { links: ['A.ALU', 'B.ALU'] }, Eu: { stubs: ['ALU.out'], bus: true, links: ['A.ALU', 'B.ALU'] },
 Lb: { stubs: ['B.in'], bus: true }, Lo: { stubs: ['OUT.in'], bus: true, links: ['OUT.DISP'] },
};
const LOADS = { Lm: 'MAR', Li: 'IR', La: 'A', Lb: 'B', Lo: 'OUT' };
const ENABLES = { Ep: 'PC', CE: 'RAM', Ei: 'IR', Ea: 'A', Eu: 'ALU' };
const STYLE = `
.sb-view { flex: 1 1 0; min-height: 10rem; display: flex; flex-direction: column; position: relative; overflow: hidden; } /* fitted; the shell pans and zooms (contract v7) */
.sb-svg { width: 100%; height: auto; max-height: 100%; font-family: var(--font-code); }
.sb-bg { fill: var(--surface); }
.sb-box { fill: var(--fig-fill); stroke: var(--text); stroke-width: 1.1; }
.sb-unit.sb-on .sb-box { stroke: var(--primary); stroke-width: 2.2; }
.sb-unit.sb-trace .sb-box { stroke: var(--accent); stroke-width: 2.6; }
.sb-ctrlbox { fill: var(--surface-2); }
.sb-clkbox { fill: var(--surface-2); stroke: var(--ui-warning); stroke-width: 1.4; }
.sb-name { font: 600 11px var(--font-ui); fill: var(--text); }
.sb-title { font: 600 12px var(--font-ui); fill: var(--text); }
.sb-val { font-size: 18px; fill: var(--text); }
.sb-sub { font-size: 11px; fill: var(--muted); }
.sb-small { font: 9px var(--font-ui); fill: var(--muted); }
.sb-mid { font-size: 10.5px; fill: var(--text); }
.sb-sym { color: var(--text); }
.sb-sym text { fill: currentColor; font-family: var(--font-ui); font-style: italic; }
.sb-sym .sb-bar { stroke: currentColor; stroke-width: 0.9; }
.sb-bus { fill: var(--surface-3); stroke: var(--border-strong); }
.sb-bus.sb-on { fill: var(--primary-soft); stroke: var(--primary); stroke-width: 1.6; }
.sb-bus.sb-trace { stroke: var(--accent); stroke-width: 2.4; }
.sb-busval { font-size: 11px; fill: var(--text); }
.sb-stub { stroke: var(--border-strong); stroke-width: 3; }
.sb-head { fill: var(--border-strong); }
.sb-d.sb-on .sb-stub { stroke: var(--primary); stroke-width: 4; } .sb-d.sb-on .sb-head { fill: var(--primary); }
.sb-d.sb-trace .sb-stub { stroke: var(--accent); stroke-width: 4.5; } .sb-d.sb-trace .sb-head { fill: var(--accent); }
.sb-width { font-size: 9.5px; fill: var(--muted); } .sb-slash { stroke: var(--muted); stroke-width: 1; }
.sb-ctl .sb-line { fill: none; stroke: var(--rule); stroke-width: 1.1; stroke-dasharray: 3 2; }
.sb-ctl .sb-arrow { fill: var(--rule); }
.sb-ctl.sb-on .sb-line { stroke: var(--accent); stroke-width: 2; stroke-dasharray: none; } .sb-ctl.sb-on .sb-arrow { fill: var(--accent); }
.sb-glow { fill: none; stroke: none; }
.sb-ctl.sb-sel .sb-glow { stroke: var(--accent-tint); stroke-width: 8; stroke-linejoin: round; }
.sb-ctl.sb-sel .sb-line { stroke: var(--accent); stroke-width: 2.6; }
.sb-hit { fill: none; stroke: transparent; stroke-width: 9; pointer-events: stroke; cursor: pointer; }
.sb-halo { fill: none; stroke: var(--surface); stroke-width: 5; }
.sb-clk .sb-line { fill: none; stroke: var(--ui-warning); stroke-width: 1.2; }
.sb-clk.sb-clear .sb-line { stroke-dasharray: 1.5 2.5; opacity: 0.75; }
.sb-clk.sb-stopped .sb-line { stroke: var(--rule); }
.sb-clk.sb-on .sb-line { stroke: var(--warning); stroke-width: 2.2; }
.sb-clk.sb-sel .sb-line { stroke-width: 2.6; }
.sb-dot { fill: var(--ui-warning); }
.sb-arrowk { fill: var(--ui-warning); } .sb-clk.sb-on .sb-arrowk { fill: var(--warning); }
.sb-glyph { fill: none; stroke: var(--ui-warning); stroke-width: 1.6; }
.sb-glyph.sb-stopped { stroke: var(--rule); }
.sb-edge { fill: none; stroke: var(--text); stroke-width: 1; } .sb-bubble { fill: var(--surface); stroke: var(--text); stroke-width: 1; }
.sb-pin .sb-sym { color: var(--muted); } .sb-pin.sb-on .sb-sym { color: var(--accent); font-weight: 700; }
.sb-pin.sb-sel .sb-sym { color: var(--accent); }
.sb-cell { fill: var(--surface); stroke: var(--border-strong); }
.sb-cellg { cursor: pointer; } .sb-cellg:focus { outline: none; } .sb-cellg:focus-visible .sb-cell { stroke: var(--insight); stroke-width: 2; }
.sb-cellg.sb-on .sb-cell { fill: var(--accent-tint); stroke: var(--accent); }
.sb-cellg.sb-on .sb-sym { color: var(--accent); }
.sb-cellg.sb-sel .sb-cell { stroke: var(--accent); stroke-width: 2.4; }
.sb-bit { font-size: 10px; fill: var(--text); }
.sb-mem { fill: var(--surface); stroke: var(--border); }
.sb-mem.sb-mar { fill: var(--changed-bg); stroke: var(--primary); }
.sb-mem-t { font-size: 10px; fill: var(--text); }
.sb-ring { fill: var(--surface); stroke: var(--border-strong); }
.sb-ring.sb-on { fill: var(--primary); }
.sb-ring-t { font-size: 10px; fill: var(--text); } .sb-ring-t.sb-on { fill: var(--primary-on); }
.sb-chip { fill: var(--surface); stroke: var(--border-strong); } .sb-chip.sb-on { fill: var(--primary-soft); stroke: var(--primary); }
.sb-chip-t { font-size: 9px; fill: var(--muted); } .sb-chip-t.sb-on { fill: var(--text); font-weight: 700; }
.sb-con { font-size: 22px; font-weight: 700; fill: var(--text); }
.sb-led { fill: var(--surface-3); stroke: var(--border-strong); } .sb-led.sb-on { fill: var(--warning); }
.sb-caption { font: 11px var(--font-ui); fill: var(--text); }
.sb-legend-d { stroke: var(--primary); stroke-width: 4; } .sb-legend-c { stroke: var(--accent); stroke-width: 1.4; stroke-dasharray: 3 2; }
.sb-legend-k { stroke: var(--ui-warning); stroke-width: 1.4; }
@keyframes sb-tick { 0% { stroke-width: 3; } 100% { stroke-width: 1.2; } }
@keyframes sb-tick-g { 0% { stroke-width: 3.2; } 100% { stroke-width: 1.6; } }
.sb-tick .sb-clk.sb-run .sb-line { animation: sb-tick 0.4s ease-out; }
.sb-tick .sb-glyph { animation: sb-tick-g 0.4s ease-out; }
@media (prefers-reduced-motion: reduce) { .sb-tick .sb-clk .sb-line, .sb-tick .sb-glyph { animation: none; } }
.sb-tab table { border-collapse: collapse; } .sb-tab td, .sb-tab th { padding: 2px 8px; text-align: left; vertical-align: top; }
.sb-tab tr.sb-on td { background: var(--changed-bg); font-weight: 600; }
.sb-tab tr.sb-sel td { outline: 2px solid var(--accent); outline-offset: -2px; }
.sb-tab p { margin: 0.4em 0; }
.sb-hsym { font-style: italic; white-space: nowrap; }
.sb-ov { display: inline-block; border-top: 1px solid currentColor; line-height: 1.05; padding-top: 1px; }
.sb-hsym sub { font-size: 0.72em; }
.sb-pick { font: inherit; background: none; border: 1px solid var(--border); border-radius: 4px; padding: 0 6px; cursor: pointer; color: inherit; }
.sb-pick[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-tint); }
.sb-con-line .sb-hsym { margin-right: 0.35em; }
.sb-src { color: var(--muted); font-size: 0.9em; }
`;
export class BusView {
 constructor() {
 this.model = null;
 this.selected = null;
 this.lastCycle = null;
 this.svg = s('svg', { class: 'sb-svg', viewBox: `0 0 ${VIEW.w} ${VIEW.h}`, role: 'group', focusable: 'false' });
 this.status = el('span.dp-status.mono');
 this.controlBox = el('div.sb-tab.scroll');
 this.sequenceBox = el('div.sb-tab.scroll');
 this.root = el('div.sb-view', {}, el('style', { text: STYLE }), this.svg);
 this.build();
 }
 get loaded() { return Boolean(this.model); }
 load(program) {
 this.program = program;
 this.model = program ? new BusModel(program) : null;
 this.lastCycle = null;
 this.render();
 }
 select(name) {
 this.selected = this.selected === name ? null : name;
 this.render();
 }
 build() {
 const g = [s('rect', { class: 'sb-bg', x: 0, y: 0, width: VIEW.w, height: VIEW.h })];
 this.parts = { units: {}, stubs: {}, links: {}, ctl: {}, clk: {}, pins: {}, cells: {} };
 const P = this.parts;
 const pick = (node, name) => node.addEventListener('click', () => this.select(name));
 for (const u of Object.values(UNITS)) {
 const p = { box: s('rect', { class: `sb-box${u.id === 'CTRL' ? ' sb-ctrlbox' : u.id === 'CLKG' ? ' sb-clkbox' : ''}`, x: u.x, y: u.y, width: u.w, height: u.h, rx: 6 }) };
 const kids = [s('title', {}, `${B.units[u.id]}: ${B.unitNames[u.id]}`), p.box];
 const top = u.row === 'top';
 const nameY = top ? u.y + 36 : u.y + 18;
 if (u.id === 'RAM') {
 kids.push(s('text', { class: 'sb-name', x: u.x + 44, y: u.y + 17 }, B.units.RAM));
 p.cells = [];
 for (let a = 0; a < 16; a++) {
 const x = u.x + 8 + (a % 8) * 25.5;
 const y = u.y + 26 + Math.floor(a / 8) * 30;
 const r = s('rect', { class: 'sb-mem', x, y, width: 24, height: 26, rx: 2 });
 const t = s('text', { class: 'sb-mem-t', x: x + 12, y: y + 17, 'text-anchor': 'middle' });
 p.cells.push([r, t]);
 kids.push(s('g', {}, s('title', {}, hx(a, 1)), r, t));
 }
 } else if (u.id === 'CTRL') {
 kids.push(...this.buildController(u, p, pick));
 } else if (u.id === 'CLKG') {
 p.glyph = s('path', { class: 'sb-glyph', d: `M${u.x + 8} ${u.y + 58} ${'h7 v-16 h7 v16 '.repeat(4)}` });
 p.cycle = s('text', { class: 'sb-mid', x: u.x + 8, y: u.y + 92 });
 p.state = s('text', { class: 'sb-small', x: u.x + 8, y: u.y + 106 });
 kids.push(s('text', { class: 'sb-title', x: u.x + 8, y: u.y + 18 }, B.units.CLKG),
 s('text', { class: 'sb-small', x: u.x + 8, y: u.y + 31 }, B.clockSub), p.glyph,
 s('text', { class: 'sb-small', x: u.x + 8, y: u.y + 78 }, B.cycleLabel), p.cycle, p.state);
 } else if (u.id === 'DISP') {
 kids.push(s('text', { class: 'sb-name', x: u.x + 8, y: nameY }, B.units.DISP));
 p.leds = [];
 for (let b = 0; b < 8; b++) {
 const c = s('circle', { class: 'sb-led', cx: u.x + 14 + b * 13.5, cy: u.y + 40, r: 5.5 });
 p.leds.push(c);
 kids.push(c);
 }
 p.val = s('text', { class: 'sb-val', x: u.x + 8, y: u.y + 72 });
 kids.push(p.val);
 } else {
 p.val = s('text', { class: 'sb-val', x: u.x + 8, y: top ? u.y + 62 : u.y + 44 });
 p.sub = s('text', { class: 'sb-sub', x: u.x + 8, y: top ? u.y + 82 : u.y + 64 });
 kids.push(s('text', { class: 'sb-name', x: u.x + 8, y: nameY }, B.units[u.id]), p.val, p.sub);
 }
 p.g = s('g', { class: 'sb-unit' }, kids);
 P.units[u.id] = p;
 g.push(p.g);
 }
 this.busRect = s('rect', { class: 'sb-bus', x: BUS.x, y: BUS.y, width: BUS.w, height: BUS.h, rx: 3 });
 this.busText = s('text', { class: 'sb-busval', x: BUS.x + BUS.w - 8, y: BUS.y + 15, 'text-anchor': 'end' });
 g.push(s('g', {}, s('title', {}, B.busName), this.busRect, s('text', { class: 'sb-busval', x: BUS.x + 8, y: BUS.y + 15 }, B.busName), this.busText));
 const arrow = ([x1, y1], [x2, y2]) => {
 const dx = Math.sign(x2 - x1);
 const dy = Math.sign(y2 - y1);
 return dx ? `M${x2} ${y2} l${-8 * dx} -4.5 v9 z` : `M${x2} ${y2} l-4.5 ${-8 * dy} h9 z`;
 };
 const width = (a, b, bits) => {
 const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
 const vertical = a[0] === b[0];
 return [s('line', { class: 'sb-slash', x1: mx - 4, y1: my + 4, x2: mx + 4, y2: my - 4 }),
 s('text', { class: 'sb-width', x: vertical ? mx + 7 : mx, y: vertical ? my + 3.5 : my - 7, 'text-anchor': vertical ? 'start' : 'middle' }, bits)];
 };
 for (const d of STUBS) {
 const [a, b] = d.points;
 const node = s('g', { class: 'sb-d' }, s('line', { class: 'sb-stub', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }), s('path', { class: 'sb-head', d: arrow(a, b) }), width(a, b, d.width));
 P.stubs[`${d.unit}.${d.dir}`] = node;
 g.push(node);
 }
 for (const l of LINKS) {
 const [a, b] = l.points;
 const node = s('g', { class: 'sb-d' }, s('line', { class: 'sb-stub', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }), s('path', { class: 'sb-head', d: arrow(a, b) }), width(a, b, l.width));
 P.links[`${l.from}.${l.to}`] = node;
 g.push(node);
 }
 for (const w of WIRES.filter((x) => x.kind === 'control')) {
 const d = path(w.points);
 const node = s('g', { class: 'sb-ctl' }, s('title', {}, `${plainSym(w.signal)}: ${B.signals[w.signal]} (${B.units[w.to.unit]})`),
 s('path', { class: 'sb-glow', d }), s('path', { class: 'sb-line', d }), s('path', { class: 'sb-arrow', d: arrow(w.points.at(-2), w.points.at(-1)) }),
 s('path', { class: 'sb-hit', d }));
 pick(node, w.signal);
 P.ctl[w.signal] = node;
 g.push(node);
 }
 const clocks = WIRES.filter((x) => x.kind === 'clock');
 g.push(s('g', {}, clocks.map((w) => s('path', { class: 'sb-halo', d: path(w.points) }))));
 this.clockLayer = s('g', {});
 for (const w of clocks) {
 const d = path(w.points);
 const node = s('g', { class: `sb-clk${/CLR/.test(w.signal) ? ' sb-clear' : ''}` }, s('title', {}, `${plainSym(w.signal)}: ${B.clockLines[w.signal]}`),
 s('path', { class: 'sb-line', d }), w.signal === 'nHLT' ? s('path', { class: 'sb-arrowk', d: arrow(w.points[0], w.points[1]) }) : null,
 s('path', { class: 'sb-hit', d }));
 pick(node, w.signal);
 (P.clk[w.signal] ??= []).push(node);
 this.clockLayer.append(node);
 }
 for (const [x, y] of DOTS) this.clockLayer.append(s('circle', { class: 'sb-dot', cx: x, cy: y, r: 2.6 }));
 g.push(this.clockLayer);
 const G = UNITS.CLKG;
 for (const w of clocks.filter((x) => x.id.endsWith('.top'))) g.push(symbol(w.signal, G.x + G.w + 4, w.points[0][1] - 3, 8.5, 'start').g);
 g.push(symbol('CLK', 20, WIRES.find((x) => x.id === 'clk.CLK.bottom').points[2][1] - 3, 8.5, 'start').g);
 for (const p of PORTS) {
 const dir = p.side === 'top' ? 1 : -1;
 if (p.edge) {
 g.push(s('path', { class: 'sb-edge', d: `M${p.x - 4} ${p.y} L${p.x} ${p.y + 6 * dir} L${p.x + 4} ${p.y}` }));
 if (p.edge === 'neg') g.push(s('circle', { class: 'sb-bubble', cx: p.x, cy: p.y - 3.2 * dir, r: 3.2 }));
 }
 const label = s('g', { class: 'sb-pin' }, symbol(p.name, p.x, p.side === 'top' ? p.y + 18 : p.y - 9, 9.5).g);
 pick(label, p.name);
 label.style.cursor = 'pointer';
 (P.pins[p.name] ??= []).push(label);
 g.push(label);
 }
 const ly = VIEW.h - 34;
 g.push(s('line', { class: 'sb-legend-d', x1: 28, y1: ly - 4, x2: 58, y2: ly - 4 }), s('text', { class: 'sb-small', x: 64, y: ly }, B.legendData),
 s('line', { class: 'sb-legend-c', x1: 190, y1: ly - 4, x2: 220, y2: ly - 4 }), s('text', { class: 'sb-small', x: 226, y: ly }, B.legendControl),
 s('line', { class: 'sb-legend-k', x1: 400, y1: ly - 4, x2: 430, y2: ly - 4 }), s('text', { class: 'sb-small', x: 436, y: ly }, B.legendClock));
 this.caption = s('g', {});
 g.push(this.caption);
 this.svg.replaceChildren(...g);
 }
 buildController(u, p, pick) {
 const kids = [];
 const x0 = u.x + 10;
 for (const [name, pin] of Object.entries(CTRL_PINS)) {
 if (pin.edge) kids.push(s('path', { class: 'sb-edge', d: `M${pin.x - 4} ${u.y} L${pin.x} ${u.y + 6} L${pin.x + 4} ${u.y}` }),
 s('circle', { class: 'sb-bubble', cx: pin.x, cy: u.y - 3.2, r: 3.2 }));
 kids.push(symbol(name, pin.x, u.y + 17, 8).g);
 }
 for (const sg of SIGNALS) {
 const c = CELLS[sg.name];
 const top = c.side === 'top';
 const bit = s('text', { class: 'sb-bit', x: c.cx, y: top ? c.y + 28 : c.y + 12, 'text-anchor': 'middle' });
 const node = s('g', { class: 'sb-cellg', tabindex: '0', role: 'button', 'aria-label': B.selectSignal(plainSym(sg.name)) },
 s('rect', { class: 'sb-cell', x: c.x, y: c.y, width: c.w, height: c.h, rx: 2 }),
 symbol(sg.name, c.cx, top ? c.y + 14 : c.y + 28, 10).g, bit);
 pick(node, sg.name);
 node.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.select(sg.name); } });
 this.parts.cells[sg.name] = { g: node, bit };
 kids.push(node);
 }
 p.opcode = s('text', { class: 'sb-mid', x: x0, y: u.y + 73 });
 p.ring = [];
 const ring = [];
 for (let t = 1; t <= 6; t++) {
 const x = x0 + (t - 1) * 31;
 const r = s('rect', { class: 'sb-ring', x, y: u.y + 104, width: 28, height: 20, rx: 3 });
 const tx = s('text', { class: 'sb-ring-t', x: x + 14, y: u.y + 118, 'text-anchor': 'middle' }, `T${t}`);
 p.ring.push([r, tx]);
 ring.push(r, tx);
 }
 p.phase = s('text', { class: 'sb-mid', x: x0, y: u.y + 144 });
 p.con = s('text', { class: 'sb-con', x: x0, y: u.y + 198 });
 p.conBin = s('text', { class: 'sb-sub', x: x0, y: u.y + 218 });
 p.chips = [];
 const chips = [];
 ['LDA', 'ADD', 'SUB', 'OUT', 'nHLT'].forEach((m, i) => {
 const x = x0 + i * 37;
 const r = s('rect', { class: 'sb-chip', x, y: u.y + 252, width: 34, height: 18, rx: 3 });
 const t = m === 'nHLT' ? symbol('nHLT', x + 17, u.y + 265, 9).g : s('text', { class: 'sb-chip-t', x: x + 17, y: u.y + 265, 'text-anchor': 'middle' }, m);
 p.chips.push([r, t]);
 chips.push(r, t);
 });
 kids.push(s('text', { class: 'sb-title', x: x0, y: u.y + 54 }, B.units.CTRL), p.opcode,
 s('text', { class: 'sb-small', x: x0, y: u.y + 98 }, B.ringLabel), ...ring, p.phase,
 s('text', { class: 'sb-small', x: x0, y: u.y + 172 }, `${B.conLabel} · ${B.conBits}`), p.con, p.conBin,
 s('text', { class: 'sb-small', x: x0, y: u.y + 246 }, B.decoderLabel), ...chips);
 return kids;
 }
 present() {
 const m = this.model;
 const regs = m?.regs ?? { A: 0, B: 0, OUT: 0, PC: 0, IR: 0, MAR: 0 };
 const t = m?.t ?? 1;
 const signals = m ? controlSignals(t, regs.IR) : [];
 const e = m && !m.halted ? m.evaluate() : null;
 return { m, regs, t, on: new Set(signals), word: controlWord(signals), e, hlt: Boolean(m) && haltLine(regs.IR), running: Boolean(m) && !m.halted };
 }
 render() {
 const st = this.present();
 const { m, regs, t, on, word, e } = st;
 const P = this.parts;
 const U = P.units;
 const loads = new Set((e?.loads ?? []).map(([id]) => id));
 const sel = this.selected;
 const trace = sel && TRACE[sel] ? TRACE[sel] : {};
 const traceUnits = new Set(sel ? (SIG[sel] ? [SIG[sel].unit] : LINE[sel] ? [...LINE[sel].to, LINE[sel].from] : []) : []);
 const setVal = (id, v, bits) => { U[id].val.textContent = hx(v, bits === 4 ? 1 : 2); U[id].sub.textContent = nib(v, bits); };
 setVal('PC', regs.PC, 4);
 setVal('MAR', regs.MAR, 4);
 setVal('IR', regs.IR, 8);
 setVal('A', regs.A, 8);
 setVal('B', regs.B, 8);
 setVal('OUT', regs.OUT, 8);
 const sum = (regs.A + regs.B) & 0xff;
 const diff = (regs.A - regs.B) & 0xff;
 U.ALU.val.textContent = hx(on.has('Su') ? diff : sum);
 U.ALU.sub.textContent = on.has('Su') ? 'A − B' : 'A + B';
 for (let a = 0; a < 16; a++) {
 const [r, tx] = U.RAM.cells[a];
 tx.textContent = (m?.mem[a] ?? 0).toString(16).toUpperCase().padStart(2, '0');
 r.classList.toggle('sb-mar', a === regs.MAR);
 }
 for (let b = 0; b < 8; b++) U.DISP.leds[b].classList.toggle('sb-on', Boolean((regs.OUT >> (7 - b)) & 1));
 U.DISP.val.textContent = String(regs.OUT);
 const op = regs.IR >> 4;
 const mn = MNEMONIC_OF[op] ?? '?';
 U.CTRL.opcode.textContent = m ? B.opcode(bin(op, 4), t >= 4 ? mn : B.fetching) : '';
 U.CTRL.ring.forEach(([r, tx], i) => { r.classList.toggle('sb-on', Boolean(m) && i + 1 === t); tx.classList.toggle('sb-on', Boolean(m) && i + 1 === t); });
 U.CTRL.phase.textContent = m ? `T${t} · ${B.phase(t)}` : '';
 U.CTRL.con.textContent = conHex(word);
 U.CTRL.conBin.textContent = nib(word, 12);
 const decoded = m && t >= 4 ? (op === OPCODES.HLT ? 'nHLT' : mn) : null;
 U.CTRL.chips.forEach(([r, tx], i) => {
 const name = ['LDA', 'ADD', 'SUB', 'OUT', 'nHLT'][i];
 r.classList.toggle('sb-on', decoded === name);
 tx.classList.toggle('sb-on', decoded === name);
 });
 for (const sg of SIGNALS) {
 const c = P.cells[sg.name];
 const asserted = on.has(sg.name);
 c.bit.textContent = String(asserted !== sg.low ? 1 : 0);
 c.g.setAttribute('aria-label', B.cellName(...B.symbols[sg.name], c.bit.textContent, sg.low));
 c.g.classList.toggle('sb-on', asserted);
 c.g.classList.toggle('sb-sel', sel === sg.name);
 c.g.setAttribute('aria-pressed', String(sel === sg.name));
 P.ctl[sg.name].classList.toggle('sb-on', asserted);
 P.ctl[sg.name].classList.toggle('sb-sel', sel === sg.name);
 for (const pin of P.pins[sg.name]) { pin.classList.toggle('sb-on', asserted); pin.classList.toggle('sb-sel', sel === sg.name); }
 }
 U.CLKG.cycle.textContent = m ? String(m.cycle) : '';
 U.CLKG.state.textContent = m ? (st.running ? B.clockNext : B.clockStopped) : '';
 U.CLKG.glyph.classList.toggle('sb-stopped', !st.running);
 for (const [name, nodes] of Object.entries(P.clk)) {
 for (const n of nodes) {
 n.classList.toggle('sb-run', st.running && /CLK/.test(name));
 n.classList.toggle('sb-stopped', !st.running && /CLK/.test(name));
 n.classList.toggle('sb-on', name === 'nHLT' && st.hlt);
 n.classList.toggle('sb-sel', sel === name);
 }
 }
 if (m && m.cycle !== this.lastCycle && this.lastCycle !== null) {
 this.svg.classList.remove('sb-tick');
 void this.svg.getBoundingClientRect();
 this.svg.classList.add('sb-tick');
 }
 this.lastCycle = m ? m.cycle : null;
 const driver = e?.driver ?? null;
 for (const [id, p] of Object.entries(U)) {
 p.g.classList.toggle('sb-on', Boolean(m) && (driver === id || (loads.has(id) && id !== 'PC') || (id === 'PC' && on.has('Cp'))));
 p.g.classList.toggle('sb-trace', traceUnits.has(id));
 }
 this.busRect.classList.toggle('sb-on', Boolean(driver));
 this.busRect.classList.toggle('sb-trace', Boolean(trace.bus));
 this.busText.textContent = driver ? B.busValue(hx(e.bus), nib(e.bus, 8), B.units[driver]) : B.busIdle;
 for (const [key, node] of Object.entries(P.stubs)) {
 const [id, dir] = key.split('.');
 node.classList.toggle('sb-on', dir === 'out' ? driver === id : loads.has(id));
 node.classList.toggle('sb-trace', (trace.stubs ?? []).includes(key));
 }
 const linkOn = { 'MAR.RAM': driver === 'RAM', 'IR.CTRL': Boolean(e) && t >= 4, 'A.ALU': driver === 'ALU', 'B.ALU': driver === 'ALU', 'OUT.DISP': loads.has('OUT') };
 for (const [key, node] of Object.entries(P.links)) {
 node.classList.toggle('sb-on', Boolean(linkOn[key]));
 node.classList.toggle('sb-trace', (trace.links ?? []).includes(key));
 }
 this.renderCaption(st);
 const what = e ? (e.driver ? B.drives(B.units[e.driver], hx(e.bus)) : B.idle) : '';
 this.svg.setAttribute('aria-label', B.figureLabel(t, what));
 this.status.textContent = m ? B.status(t, B.phase(t), t >= 4 ? mn : B.fetching, `0x${m.instrPc.toString(16).toUpperCase()}`) : '';
 this.renderControl(st);
 this.renderSequence();
 }
 explain(name, st) {
 const { regs, on, e, m } = st;
 if (SIG[name]) {
 const sg = SIG[name];
 const asserted = on.has(name);
 const parts = [X.level(asserted !== sg.low ? 1 : 0, asserted, sg.low)];
 const from = e?.driver ? B.units[e.driver] : null;
 if (LOADS[name]) {
 const reg = LOADS[name];
 parts.push(asserted && from ? X.load(B.units[reg], hx(reg === 'MAR' ? e.bus & 0xf : e.bus, reg === 'MAR' ? 1 : 2), from)
 : X.keep(B.units[reg], hx(regs[reg], reg === 'MAR' ? 1 : 2)));
 } else if (ENABLES[name]) {
 const unit = ENABLES[name];
 parts.push(asserted && e ? X.drive(B.units[unit], hx(e.bus, unit === 'PC' || unit === 'IR' ? 1 : 2)) : X.off(B.units[unit]));
 } else if (name === 'Cp') {
 parts.push(asserted && e ? X.count(hx(regs.PC, 1), hx((regs.PC + 1) & 0xf, 1)) : X.hold(hx(regs.PC, 1)));
 } else if (name === 'Su') {
 parts.push(asserted ? X.sub(hx((regs.A - regs.B) & 0xff)) : X.add(hx((regs.A + regs.B) & 0xff)));
 }
 return parts.join(' ');
 }
 const extra = name === 'nHLT' ? X.halt(st.hlt) : /CLR/.test(name) ? X.clearIdle : st.running ? X.clock(m.cycle) : X.stopped;
 return `: ${B.clockLines[name]}. ${extra} ${X.notCon}`;
 }
 renderCaption(st) {
 const y = VIEW.h - 12;
 if (!this.selected) {
 this.caption.replaceChildren(s('text', { class: 'sb-caption', x: 28, y }, B.hint));
 return;
 }
 const sym = symbol(this.selected, 28, y, 12, 'start');
 this.caption.replaceChildren(sym.g, s('text', { class: 'sb-caption', x: 28 + sym.w + 2, y }, this.explain(this.selected, st)));
 }
 renderControl(st) {
 const { on, word, t, m } = st;
 const refocus = this.controlBox.contains(document.activeElement) ? document.activeElement.dataset?.sig : null;
 const pickBtn = (name) => el('button.sb-pick', { type: 'button', 'data-sig': name, 'aria-pressed': String(this.selected === name),
 title: B.selectSignal(plainSym(name)), onclick: () => this.select(name) }, htmlSym(name));
 const con = el('p.sb-con-line', {}, el('strong', { text: `${B.conLabel} = ` }),
 SIGNALS.map((sg) => htmlSym(sg.name)));
 const val = el('p.mono', { text: `${B.word(nib(word, 12), conHex(word))}${m ? ` · T${t} · ${B.phase(t)}` : ''}` });
 const rows = SIGNALS.map((sg, i) => {
 const asserted = on.has(sg.name);
 return el(`tr${asserted ? '.sb-on' : ''}${this.selected === sg.name ? '.sb-sel' : ''}`, {},
 el('td.mono', { text: String(11 - i) }), el('td', {}, pickBtn(sg.name)), el('td.mono', { text: String(asserted !== sg.low ? 1 : 0) }),
 el('td', { text: asserted ? B.yes : B.no }), el('td', { text: sg.low ? B.low : B.high }), el('td', { text: B.units[sg.unit] }),
 el('td', { text: B.signals[sg.name] }));
 });
 const lineRows = CLOCK_LINES.map((ln) => {
 const level = ln.name === 'nHLT' ? (st.hlt ? '0' : '1') : /CLR/.test(ln.name) ? (ln.low ? '1' : '0') : st.running ? B.clockNext : B.clockStopped;
 return el(`tr${ln.name === 'nHLT' && st.hlt ? '.sb-on' : ''}${this.selected === ln.name ? '.sb-sel' : ''}`, {},
 el('td', {}, pickBtn(ln.name)), el('td.mono', { text: level }), el('td', { text: B.units[ln.from] }),
 el('td', { text: ln.to.map((u) => B.units[u]).join(', ') }), el('td', { text: B.clockLines[ln.name] }));
 });
 const explanation = this.selected ? el('p', {}, htmlSym(this.selected), this.explain(this.selected, st)) : el('p.sb-src', { text: B.hint });
 this.controlBox.replaceChildren(con, val, explanation,
 el('table.listing', {}, el('thead', {}, el('tr', {}, [B.colBit, B.colSignal, B.colLevel, B.colOn, B.colActive, B.colTo, B.colMeaning].map((h) => el('th', { text: h })))),
 el('tbody', {}, rows)),
 el('p', {}, el('strong', { text: B.clockTitle })),
 el('table.listing', {}, el('thead', {}, el('tr', {}, [B.colLine, B.colLevel, B.colFrom, B.colTo, B.colMeaning].map((h) => el('th', { text: h })))),
 el('tbody', {}, lineRows)),
 el('p.sb-src', { text: B.source }));
 if (refocus) this.controlBox.querySelector(`button[data-sig="${refocus}"]`)?.focus();
 }
 renderSequence() {
 const m = this.model;
 const ir = m && m.t >= 4 ? m.regs.IR : null;
 const rows = [];
 for (let t = 1; t <= 6; t++) {
 const sig = t <= 3 || ir !== null ? controlSignals(t, ir ?? 0) : null;
 rows.push(el(`tr${m && m.t === t && !m.halted ? '.sb-on' : ''}`, {}, el('td.mono', { text: `T${t}` }), el('td', { text: B.phase(t) }),
 el('td.mono', { text: sig === null ? '' : conHex(controlWord(sig)) }),
 el('td', {}, sig === null ? '…' : sig.length ? sig.flatMap((n, i) => (i ? [' ', htmlSym(n)] : [htmlSym(n)])) : B.nop),
 el('td.mono', { text: sig === null ? '' : transfer(sig) })));
 }
 this.sequenceBox.replaceChildren(el('table.listing', {}, el('thead', {}, el('tr', {},
 [B.colState, '', B.colCon, B.colSignal, B.colTransfer].map((h) => el('th', { text: h })))), el('tbody', {}, rows)));
 }
 step() {
 const r = this.model.step();
 return r === 'step' ? STOP.NONE : r === 'halt' ? STOP.HALT : STOP.ERROR;
 }
}
function transfer(sig) {
 const on = (n) => sig.includes(n);
 const src = on('Ep') ? 'PC' : on('CE') ? 'M[MAR]' : on('Ei') ? 'IR[3:0]' : on('Ea') ? 'A' : on('Eu') ? (on('Su') ? 'A − B' : 'A + B') : null;
 const dst = [['Lm', 'MAR'], ['Li', 'IR'], ['La', 'A'], ['Lb', 'B'], ['Lo', 'OUT']].filter(([n]) => on(n)).map(([, r]) => r);
 const parts = dst.map((d) => `${d} ← ${src}`);
 if (on('Cp')) parts.push('PC ← PC + 1');
 return parts.join('; ');
}
export const WAVE_SIGNALS = Object.freeze([{ name: 'T', width: 3, kind: 'state' }, ...SIGNALS.map((x) => ({ name: x.name, width: 1, kind: 'control' })),
 ...[['bus', 8], ['PC', 4], ['MAR', 4], ['IR', 8], ['A', 8], ['B', 8], ['OUT', 8]].map(([name, width]) => ({ name, width }))]);
export function exportModel(program) {
 const m = new BusModel(program);
 const outs = [];
 const step = () => {
 const r = m.step();
 if (m.last?.loads.some(([id]) => id === 'OUT') && r !== 'error') outs.push(m.regs.OUT);
 return r;
 };
 return {
 evaluate: () => {
 const e = m.evaluate();
 return { signals: { T: m.t, ...Object.fromEntries(SIGNALS.map((x) => [x.name, e.signals.includes(x.name) ? 1 : 0])), bus: e.bus ?? 0, ...m.regs } };
 },
 step,
 run: (limit) => {
 for (let i = 0; i < limit; i++) {
 const r = step();
 m.journal.length = 0;
 if (r !== 'step') return r;
 }
 return 'budget';
 },
 get error() { return m.error; },
 outs,
 };
}
export function busInstance(v, ctx) {
 const headerTools = el('span.sb-tools', {},
 el('button', { type: 'button', text: B.backInstr, title: B.backInstrTitle, onclick: () => ctx.command?.('backUnit') }),
 el('button', { type: 'button', text: B.stepInstr, title: B.stepInstrTitle, onclick: () => ctx.command?.('stepUnit') }));
 return {
 root: v.root, title: B.title, infoTitle: B.infoTitle, status: v.status, headerTools,
 diagrams: [v.svg],
 tabs: [[B.tabControl, v.controlBox], [B.tabSequence, v.sequenceBox]],
 load: (p) => v.load(p),
 reset: () => { v.model?.reset(); v.lastCycle = null; v.render(); },
 step: () => v.step(),
 back: () => v.model?.back() ?? false,
 render: () => v.render(),
 state: () => {
 const m = v.model;
 if (!m) return null;
 return { pc: m.regs.PC, instruction: m.instrPc, cycle: m.cycle, retired: m.retired, halted: m.halted, error: m.error,
 registers: Object.fromEntries(REGISTER_IDS.map((id) => [id, m.regs[id]])),
 changed: (m.last?.loads ?? []).map(([id]) => id), written: null };
 },
 stopMessage: (stop) => (stop === STOP.HALT && v.model ? B.halted(`0x${v.model.instrPc.toString(16).toUpperCase()}`, v.model.cycle, v.model.retired) : null),
 breakAt: () => (v.model && v.model.t === 1 ? v.model.regs.PC : null),
 unit: { label: B.stepInstr, step: () => { const r = v.model.stepInstruction(); return r === 'step' ? STOP.NONE : r === 'halt' ? STOP.HALT : STOP.ERROR; },
 back: () => v.model?.backInstruction() ?? false },
 dataAccess: () => {
 const m = v.model;
 if (!m || m.halted || m.t !== 5) return null;
 const op = m.regs.IR >> 4;
 return op <= 2 ? { address: m.regs.MAR, size: 1 } : null;
 },
 exportModel: () => ({ model: exportModel(v.program), signals: WAVE_SIGNALS, module: 'sap1', label: B.title }),
 waveform: { defaults: ['T', 'bus', 'Ep', 'Lm', 'CE', 'Li', 'Ei', 'La', 'A', 'OUT'], format: (name, val) => (name === 'T' ? `T${val}` : null) },
 memoryPort: () => (v.model ? { read: (address, size) => { let x = 0; for (let i = size - 1; i >= 0; i--) x = x * 256 + v.model.mem[(address + i) & 0xf]; return x; } } : null),
 };
}
