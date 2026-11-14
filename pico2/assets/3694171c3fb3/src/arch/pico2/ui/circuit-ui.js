// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { PICO2_STRINGS } from '../strings.js';
import { validateCircuit, parseValue, formatValue, GPIO_PADS } from '../circuit/format.js';
import { compile } from '../circuit/netlist.js';
import { PART_TYPES } from '../circuit/library.js';
import { addPart, removePart, setAttr, connectPin, freeNet, pinTarget, renameLabel } from '../circuit/edit.js';
import { V_IL, V_IH } from '../circuit/pad.js';
import { endKey, demoCircuit } from '../circuit/netlist.js';
import { withDemo, missingDemo, DEMO_KNOB } from '../circuit/demo.js';
import { partPins, partTransform, wireDrawings, wirePath, endPoint, turn, partBox, PIN_POS } from './circuit-sheet.js';
import { effectiveCircuit, speakerPad } from '../circuit/presets.js';
import { SEGMENTS, VALUE_SOURCES } from '../circuit/library.js';
const PIN_POS_OF = (t) => PIN_POS[t] ?? {};
const DEF_EXAMPLE = `{
  "type": "ledbar2",
  "label": "Two-LED bar",
  "pins": [{ "name": "A1", "x": -63.5, "y": -12.7 }, { "name": "A2", "x": -63.5, "y": 12.7 }, { "name": "K", "x": 63.5, "y": 0 }],
  "symbol": ["M-40 -25 H40 V25 H-40 Z", "M-63.5 -12.7 H-40 M-63.5 12.7 H-40 M40 0 H63.5"],
  "primitives": [
    { "kind": "D", "a": "A1", "k": "K", "color": "red" },
    { "kind": "D", "a": "A2", "k": "K", "color": "green" }
  ]
}`;
import { knobInput, KNOB_MAX } from './board-model.js';
const B = PICO2_STRINGS.board, T = B.circuit;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : String(v));
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
export function netLook(v, floating) { if (floating || !Number.isFinite(v)) return 'z'; return v >= V_IH ? 'high' : v <= V_IL ? 'low' : 'undef'; }
export const LOOK_LETTER = Object.freeze({ high: 'H', low: 'L', z: 'Z', undef: '?' });
export const LED_FULL_MA = 2;
export const ledGlow = (mA) => Math.max(0, Math.min(1, (Number(mA) || 0) / LED_FULL_MA));
export const RAIL_CHOICES = Object.freeze(['GND', '3V3', 'VSYS', 'VBUS', 'ADC_VREF']);
export const RAIL_SYMBOL = Object.freeze({ GND: 'ground', AGND: 'ground', '3V3': 'power', VSYS: 'power', VBUS: 'power', ADC_VREF: 'power' });
const LED_FILL = { red: '#ff4040', yellow: '#ffd23a', green: '#3ad35a', blue: '#4a8dff', white: '#f4f4f4' };
export function symbolBody(type, p = {}) {
 const color = typeof p === 'string' ? p : p.color ?? 'red';
 const sym = (path) => s('path', { class: 'bv-sym', d: path });
 const L = 63.5, G = 12.7, nodes = [];
 let glow = null, wiper = null, segs = null, lcd = null, arcs = null;
 const mod = PART_TYPES[type]?.module;
 if (mod) {
 const pins = PIN_POS_OF(type);
 const xs = Object.values(pins).map(([x]) => Math.abs(x)), half = Math.max(...xs) - 2 * G;
 const ys = Object.values(pins).map(([, y]) => Math.abs(y)), hh = type === 'lcd1602' ? 5 * G : Math.max(2.5 * G, Math.max(...ys) + 2 * G);
 nodes.push(s('rect', { class: type === 'lcd1602' ? 'bv-lcd' : 'bv-part', x: -half, y: -hh, width: 2 * half, height: 2 * hh, rx: 4 }));
 for (const [n, [x, y]] of Object.entries(pins)) {
 nodes.push(sym(`M${x} ${y} H${Math.sign(x) * half}`), s('text', { class: `bv-pin-l${x < 0 ? ' bv-start' : ''}`, x: x < 0 ? -half + 5 : half - 5, y }, n));
 }
 const addr = p.address ?? PART_TYPES[type].attrs.address?.default;
 if (type === 'lcd1602') {
 const W = { cols: 16, rows: 2, cell: 12.5, rowH: 24 }, wx = -W.cols * W.cell / 2, wy = -hh + 34;
 nodes.push(s('text', { class: 'bv-lcd-title', x: -half + 10, y: -hh + 18 }, `${mod.name} · ${addr}`));
 const win = s('g', { class: 'bv-lcd-glass bv-lcd-dark' }, s('rect', { class: 'bv-lcd-win', x: wx - 6, y: wy - 6, width: W.cols * W.cell + 12, height: W.rows * W.rowH + 12, rx: 3 }));
 lcd = { win, cells: [] };
 for (let r = 0; r < W.rows; r++) {
 const row = [];
 for (let c = 0; c < W.cols; c++) {
 const cx = wx + c * W.cell, cy = wy + r * W.rowH;
 win.append(s('rect', { class: 'bv-lcd-cell', x: cx + 0.75, y: cy + 2, width: W.cell - 1.5, height: W.rowH - 4, rx: 1 }));
 const t = s('text', { class: 'bv-lcd-ch', x: cx + W.cell / 2, y: cy + W.rowH / 2 + 1 });
 win.append(t); row.push(t);
 }
 lcd.cells.push(row);
 }
 nodes.push(win);
 } else {
 nodes.push(s('text', { class: 'bv-part-t', x: 0, y: -6 }, mod.name), s('text', { class: 'bv-part-s', x: 0, y: 14 }, mod.bus === 'i2c' ? `I2C ${addr}` : 'SPI'));
 }
 return { nodes, glow, wiper, segs, lcd, arcs };
 }
 switch (type) {
 case 'ldr':
 nodes.push(sym(`M${-L} 0 H-30 M30 0 H${L} M-30 -12 H30 V12 H-30 Z M-26 -40 l14 14 M-8 -40 l14 14`),
 s('path', { class: 'bv-symf', d: 'M-12 -26 l-1 -8 l8 1 z M6 -26 l-1 -8 l8 1 z' }));
 break;
 case 'ntc':
 nodes.push(sym(`M${-L} 0 H-30 M30 0 H${L} M-30 -12 H30 V12 H-30 Z M-38 22 H-26 L26 -22`), s('text', { class: 'bv-part-s', x: 28, y: 26 }, '−t°'));
 break;
 case 'rgb':
 glow = s('circle', { class: 'bv-uglow', cx: 0, cy: 0, r: 30, fill: '#000', opacity: 0 });
 nodes.push(glow, s('circle', { class: 'bv-sym', cx: 0, cy: 0, r: 28 }),
 sym(`M${-L} ${-2 * G} H-18 L-10 -12 M${-L} 0 H-28 M${-L} ${2 * G} H-18 L-10 12 M28 0 H${L}`),
 s('text', { class: 'bv-part-s', x: 0, y: 1 }, 'RGB'));
 break;
 case 'sevenseg': {
 const bx = 5 * G, by = 7 * G;
 nodes.push(s('rect', { class: 'bv-part', x: -bx, y: -by, width: 2 * bx, height: 2 * by, rx: 4 }));
 for (const [n, [x, y]] of Object.entries(PIN_POS_OF(type))) nodes.push(sym(`M${x} ${y} H${Math.sign(x) * bx}`), s('text', { class: `bv-pin-l${x < 0 ? ' bv-start' : ''}`, x: x < 0 ? -bx + 4 : bx - 4, y }, n));
 const w = 30, h = 34, t = 6, ox = 6, D = {
 a: `M${-w / 2 + ox} ${-h} h${w}`, b: `M${w / 2 + ox} ${-h + t} v${h - 2 * t}`, c: `M${w / 2 + ox} ${t} v${h - 2 * t}`, d: `M${-w / 2 + ox} ${h} h${w}`,
 e: `M${-w / 2 + ox} ${t} v${h - 2 * t}`, f: `M${-w / 2 + ox} ${-h + t} v${h - 2 * t}`, g: `M${-w / 2 + ox} 0 h${w}` };
 segs = {};
 for (const [n, d] of Object.entries(D)) { const e = s('path', { class: 'bv-seg', d }); segs[n] = e; nodes.push(e); }
 segs.DP = s('circle', { class: 'bv-seg bv-seg-dp', cx: w / 2 + ox + 9, cy: h + 2, r: 3.5 }); nodes.push(segs.DP);
 break;
 }
 case 'speaker':
 nodes.push(sym(`M${-L} ${-G} H-40 M${-L} ${G} H-40`), s('rect', { class: 'bv-part', x: -40, y: -16, width: 18, height: 32 }),
 s('path', { class: 'bv-part', d: 'M-22 -16 L0 -34 V34 L-22 16 Z' }));
 arcs = s('path', { class: 'bv-arcs', d: 'M12 -22 a30 30 0 0 1 0 44 M24 -34 a46 46 0 0 1 0 68' });
 nodes.push(arcs);
 break;
 case 'buzzer':
 nodes.push(sym(`M${-L} 0 H-24 M24 0 H${L}`), s('circle', { class: 'bv-part', cx: 0, cy: 0, r: 24 }), s('circle', { class: 'bv-sym', cx: 0, cy: 0, r: 9 }),
 s('text', { class: 'bv-part-s', x: -14, y: -28 }, '+'));
 arcs = s('path', { class: 'bv-arcs', d: 'M32 -18 a26 26 0 0 1 0 36' });
 nodes.push(arcs);
 break;
 default: break;
 }
 if (nodes.length) return { nodes, glow, wiper, segs, lcd, arcs };
 switch (type) {
 case 'resistor': case 'potentiometer':
 nodes.push(sym(`M${-L} 0 H-36 l4 -9 l8 18 l8 -18 l8 18 l8 -18 l8 18 l8 -18 l8 18 l4 -9 H${L}`));
 break;
 case 'led': case 'diode':
 if (type === 'led') { glow = s('circle', { class: 'bv-uglow', cx: 0, cy: 0, r: 30, fill: LED_FILL[color ?? 'red'] ?? LED_FILL.red, opacity: 0 }); nodes.push(glow); }
 nodes.push(sym(`M${-L} 0 H-14 M14 0 H${L} M14 -14 V14`), s('path', { class: 'bv-sym', d: 'M-14 -14 L14 0 L-14 14 Z' }));
 if (type === 'led') nodes.push(sym('M4 -18 l10 -12 M14 -18 l10 -12'));
 break;
 case 'capacitor': nodes.push(sym(`M${-L} 0 H-6 M6 0 H${L} M-6 -18 V18 M6 -18 V18`)); break;
 case 'button': nodes.push(sym(`M${-L} 0 H-24 M24 0 H${L} M-28 -14 H28 M0 -14 V-30 M-10 -30 H10`), s('circle', { class: 'bv-sym', cx: -24, cy: 0, r: 3 }), s('circle', { class: 'bv-sym', cx: 24, cy: 0, r: 3 })); break;
 case 'switch': nodes.push(sym(`M${-L} 0 H-24 M24 0 H${L} M-24 0 L20 -18`), s('circle', { class: 'bv-sym', cx: -24, cy: 0, r: 3 }), s('circle', { class: 'bv-sym', cx: 24, cy: 0, r: 3 })); break;
 case 'npn': nodes.push(s('circle', { class: 'bv-sym', cx: 0, cy: 0, r: 30 }), sym(`M${-L} 0 H-10 M-10 -18 V18 M-10 -8 L25.4 -30 V${-L} M-10 8 L25.4 30 V${L}`),
 s('path', { class: 'bv-symf', d: 'M25.4 30 l-13 -2 l6 -9 z' })); break;
 case 'ground': nodes.push(sym('M0 -25.4 V0 M-13 0 h26 M-8 6 h16 M-3 12 h6')); break;
 case 'power': nodes.push(sym('M0 25.4 V0 M-12 0 h24')); break;
 default: nodes.push(s('rect', { class: 'bv-sym', x: -40, y: -25, width: 80, height: 50 }));
 }
 if (type === 'potentiometer') { wiper = s('g', {}, sym('M0 50.8 V30 H0 V14'), s('path', { class: 'bv-symf', d: 'M0 10 l-6 10 h12 z' })); nodes.push(wiper); }
 return { nodes, glow, wiper, segs, lcd, arcs };
}
export const CIRCUIT_STYLE = `
.bv-user .bv-sym { fill: none; stroke: var(--text); stroke-width: 2; stroke-linejoin: round; }
.bv-user .bv-symf { fill: var(--text); stroke: none; }
.bv-user .bv-id { fill: var(--text); font-size: 15px; font-weight: 600; text-anchor: middle; pointer-events: none; }
.bv-user .bv-val { fill: var(--muted, #666); font-size: 13px; text-anchor: middle; pointer-events: none; }
.bv-nl { font-size: 13px; font-family: var(--font-code); dominant-baseline: central; fill: var(--bv-z); pointer-events: none; }
.bv-nl.bv-high { fill: var(--bv-high); } .bv-nl.bv-low { fill: var(--bv-low); } .bv-nl.bv-undef { fill: var(--bv-undef); font-weight: 700; }
.bv-uglow { pointer-events: none; }
.bv-uw { fill: none; stroke: var(--bv-z); stroke-width: 2.4; stroke-linejoin: round; }
.bv-uw.bv-high { stroke: var(--bv-high); } .bv-uw.bv-low { stroke: var(--bv-low); } .bv-uw.bv-undef { stroke: var(--bv-undef); stroke-dasharray: 3 3; }
.bv-uw.bv-rail { stroke: var(--text); stroke-width: 1.6; }
.bv-uw.bv-act { stroke-width: 5; }
.bv-ujn { fill: var(--text); }
.bv-seg { fill: none; stroke: #ff2a2a; stroke-width: 6; stroke-linecap: round; opacity: 0.12; pointer-events: none; }
.bv-seg-dp { fill: #ff2a2a; stroke: none; }
.bv-circ .bv-def { font: 0.78rem var(--font-code); width: 100%; max-width: 46rem; box-sizing: border-box; }
.bv-circ .bv-define { margin: 0.6em 0; } .bv-circ .bv-define summary { font-weight: 600; cursor: pointer; }
.bv-pinmark { fill: var(--surface, #fff); stroke: var(--text); stroke-width: 1.2; pointer-events: none; }
.bv-pinmark-on { fill: var(--text); stroke: none; }
.bv-ulead { fill: none; stroke: var(--muted, #666); stroke-width: 1; stroke-dasharray: 2 2; }
.bv-uctl { cursor: pointer; } .bv-uctl:focus { outline: none; } .bv-uctl:focus-visible .bv-hit { stroke: var(--primary); stroke-width: 3; stroke-dasharray: 5 3; }
.bv-circ select, .bv-circ input { font: inherit; font-size: 0.8rem; }
.bv-circ .bv-pinsel { display: inline-flex; gap: 0.25em; align-items: center; margin-right: 0.8em; white-space: nowrap; }
.bv-circ .bv-err { color: var(--error, #b00020); font-size: 0.78rem; display: block; }
.bv-circ .bv-addrow { display: flex; gap: 0.5em; align-items: center; margin: 0.5em 0; flex-wrap: wrap; }
`;
export class CircuitUI {
 constructor(ctx, { onSelect } = {}) {
 this.ctx = ctx; this.onSelect = onSelect ?? (() => {});
 this.text = undefined; this.kit = undefined; this.c = null; this.k = null; this.error = null;
 this.root = el('div.bv-tab.bv-circ');
 this.g = s('g', { class: 'bv-user' });
 this.drawn = new Map();
 this.potShown = new Map(); this.potPending = new Map();
 this.live = null;
 this.warnBox = el('div'); this.netBody = el('tbody');
 }
 sync() {
 const t = this.ctx.companion?.('circuit') ?? null, kit = this.ctx.option?.('parts') === 'kit', spk = speakerPad(this.ctx.option?.('speaker'));
 if (t === this.text && kit === this.kit && spk === this.spk) return false;
 this.text = t; this.kit = kit; this.spk = spk;
 let file = null;
 try { file = t ? validateCircuit(t) : null; this.error = null; } catch (e) { file = null; this.error = e.message; }
 try { this.c = effectiveCircuit(file, { kit, speaker: spk }); } catch (e) { this.c = effectiveCircuit(null, { kit, speaker: spk }); this.error = e.message; }
 this.fileC = this.c;
 try { this.k = compile(this.c); } catch (e) { this.k = compile(effectiveCircuit(null, { kit, speaker: spk })); this.error = e.message; }
 this.buildPanel(); this.buildDrawing();
 return true;
 }
 textOf(c) { return !c || JSON.stringify(c) === JSON.stringify(effectiveCircuit(null, { kit: this.kit, speaker: this.spk ?? -1 })) ? null : JSON.stringify(c, null, 1); }
 commit(c, { quiet = false, label = T.listEdit } = {}) {
 const text = this.textOf(c);
 const taken = this.onCommitted?.(text, label) === true;
 this.ctx.setCompanion?.('circuit', text);
 if (!quiet && !taken) this.ctx.message?.(T.changed, 'ok');
 }
 preview(c) {
 this.c = c ?? this.fileC ?? null;
 this.buildDrawing();
 }
 bounds() {
 const c = this.c;
 if (!c || !(c.parts.length || c.wires.length || c.nodes.length || c.labels.length)) return null;
 let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
 const add = (x, y, mx = 20, my = 20) => { x0 = Math.min(x0, x - mx); x1 = Math.max(x1, x + mx); y0 = Math.min(y0, y - my); y1 = Math.max(y1, y + my); };
 for (const p of c.parts) { add(p.x, p.y, 140, 90); add(p.x, p.y + 10, 0, 90); }
 for (const n of c.nodes) add(n.x, n.y);
 for (const l of c.labels) add(l.x, l.y, 80, 20);
 for (const w of c.wires) for (const [x, y] of wirePath(c, w) ?? []) add(x, y);
 return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
 }
 netChoices() {
 const own = [...new Set((this.c?.labels ?? []).map((l) => l.net))].filter((n) => !GPIO_PADS.includes(n) && !RAIL_CHOICES.includes(n)).sort();
 return [['', T.notConnected], ...GPIO_PADS.map((g) => [g, g]), ...RAIL_CHOICES.map((r) => [r, r]), ...own.map((n) => [n, n]), ['\u0000new', T.newNet]];
 }
 buildPanel() {
 const c = this.c, rows = [];
 const choices = this.netChoices();
 const typeInfo = (t) => PART_TYPES[t] ?? (() => { const d = c?.defs?.find((x) => x.type === t); return d ? { label: d.label ?? d.type, pins: d.pins.map((x) => x.name), attrs: {} } : null; })();
 for (const p of c?.parts ?? []) {
 const type = typeInfo(p.type);
 const value = this.fields(p, (k) => `${p.id} ${k}`, 'bv-err');
 const pins = (type?.pins ?? []).map((pin) => {
 const ref = `${p.id}.${pin}`, cur = pinTarget(c, ref);
 const sel = el('select', { 'aria-label': `${p.id}: ${T.netOf(pin)}`, onchange: (e) => {
 const to = e.target.value === '\u0000new' ? freeNet(this.c) : e.target.value;
 this.focusLabel = e.target.getAttribute('aria-label');
 this.commit(connectPin(this.c, ref, to));
 } }, ...choices.map(([v, label]) => el('option', { value: v, text: label, selected: v === cur })));
 return el('label.bv-pinsel', {}, el('span', { text: pin }), sel);
 });
 rows.push(el('tr', {}, el('th', { scope: 'row', text: p.id }), el('td', { text: type?.label ?? p.type }), el('td', {}, ...value), el('td', {}, ...pins),
 el('td', {}, this.control(p)), el('td', {}, el('button', { type: 'button', text: T.remove(p.id), onclick: () => this.commit(removePart(this.c, p.id)) }))));
 }
 const addSel = el('select', { 'aria-label': T.addType }, ...Object.entries(PART_TYPES).map(([id, t]) => el('option', { value: id, text: t.label })),
 ...(c?.defs ?? []).map((d) => el('option', { value: d.type, text: T.ownPart(d.label ?? d.type) })));
 const add = el('div.bv-addrow', {}, el('label', {}, `${T.addType} `, addSel), el('button', { type: 'button', text: T.add, onclick: () => {
 const r = addPart(this.c, addSel.value);
 this.focusPart = r.id;
 this.commit(r.circuit);
 this.onSelect(`upart:${r.id}`, false);
 } }));
 const missing = c ? missingDemo(c) : [];
 const restore = missing.length ? el('div.bv-addrow', {}, el('button', { type: 'button', text: T.restoreDemo(missing.join(', ')),
 onclick: () => this.commit(validateCircuit(withDemo(this.c)), { label: T.restoreDemo(missing.join(', ')) }) })) : null;
 this.root.replaceChildren(
 el('p', { text: T.intro }),
 ...(restore ? [restore] : []),
 ...(this.error ? [el('p.bv-err', { role: 'alert', text: T.invalid(this.error) })] : []),
 rows.length ? el('table', {}, el('caption', { text: T.partsCaption }),
 el('thead', {}, el('tr', {}, ...[T.colName, T.colType, T.colValue, T.colPins, T.colControl, ''].map((h) => el('th', { scope: 'col', text: h })))),
 el('tbody', {}, ...rows)) : el('p', { text: T.none }),
 add,
 el('table', {}, el('caption', { text: T.netsCaption }), el('thead', {}, el('tr', {}, ...[T.colNet, T.colMembers, T.colVolts].map((h) => el('th', { scope: 'col', text: h })))), this.netBody),
 el('h3', { text: T.warningsCaption, style: 'font-size: 0.9rem; margin: 0.6em 0 0.2em' }), this.warnBox,
 this.definePanel(c),
 el('p', { text: T.provisional }));
 this.netKey = null; this.warnKey = null;
 const want = this.focusPart ? `${this.focusPart}: ` : this.focusLabel;
 this.focusPart = null; this.focusLabel = null;
 if (want) [...this.root.querySelectorAll('select, input, button')].find((x) => (x.getAttribute('aria-label') ?? '').startsWith(want))?.focus();
 }
 definePanel(c) {
 const err = el('p.bv-err', { id: 'bv-def-err', role: 'alert', hidden: true });
 const area = el('textarea.bv-def', { rows: 12, cols: 60, spellcheck: 'false', 'aria-label': T.defineLabel, 'aria-describedby': 'bv-def-err' });
 area.value = this.defDraft ?? DEF_EXAMPLE;
 area.addEventListener('input', () => { this.defDraft = area.value; });
 const add = el('button', { type: 'button', text: T.defineAdd, onclick: () => {
 let d;
 try { d = JSON.parse(area.value); } catch (e) { err.textContent = T.defineBad(`not JSON (${e.message})`); err.hidden = false; return; }
 const next = { ...this.c, defs: [...(this.c.defs ?? []).filter((x) => x.type !== d?.type), d] };
 try { const v = validateCircuit(next); err.hidden = true; this.defDraft = null; this.commit(v, { label: T.defineDone(d.type) }); }
 catch (e) { err.textContent = T.defineBad(e.message); err.hidden = false; }
 } });
 const list = (c?.defs ?? []).map((d) => {
 const used = c.parts.some((p) => p.type === d.type);
 return el('li', {}, `${d.type} (${d.label ?? d.type}) `, el('button', { type: 'button', text: T.defineRemove(d.type), disabled: used, title: used ? T.defineUsed : null,
 onclick: () => this.commit(validateCircuit({ ...this.c, defs: this.c.defs.filter((x) => x.type !== d.type) })) }));
 });
 return el('details.bv-define', {}, el('summary', { text: T.defineTitle }), el('p', { text: T.defineIntro }),
 ...(list.length ? [el('ul', {}, ...list)] : []), area, el('div.bv-addrow', {}, add), err);
 }
 fields(p, name, idp) {
 const type = PART_TYPES[p.type], out = [];
 for (const [k, a] of Object.entries(type?.attrs ?? {})) {
 const cur = p[k] ?? a.default;
 if (a.kind === 'choice') {
 out.push(el('select', { 'aria-label': name(k), onchange: (e) => { this.focusLabel = name(k); this.commit(setAttr(this.c, p.id, k, e.target.value)); } },
 ...a.values.map((v) => el('option', { value: v, text: v, selected: v === cur }))));
 } else {
 const err = el('span.bv-err', { id: `${idp}-${p.id}-${k}`, hidden: true });
 const inp = el('input', { type: 'text', size: 6, value: typeof cur === 'number' ? formatValue(cur).replace(/ /g, '') : String(cur), 'aria-label': name(k),
 'aria-describedby': err.id, onchange: (e) => {
 const v = parseValue(e.target.value);
 if (!(v >= a.min && v <= a.max)) { err.textContent = T.badValue(formatValue(a.min, a.unit), formatValue(a.max, a.unit)); err.hidden = false; e.target.setAttribute('aria-invalid', 'true'); return; }
 err.hidden = true; e.target.removeAttribute('aria-invalid');
 this.focusLabel = name(k);
 this.commit(setAttr(this.c, p.id, k, e.target.value.trim()));
 } });
 out.push(el('span', {}, inp, a.unit ? ` ${a.unit}` : '', err));
 }
 }
 return out;
 }
 attrForm(sel) {
 const [kind, key] = [sel.slice(0, sel.indexOf(':')), sel.slice(sel.indexOf(':') + 1)];
 if (kind === 'upart') {
 const p = this.c?.parts.find((x) => x.id === key);
 const f = p ? this.fields(p, (k) => `${T.attrsCaption(p.id)}: ${k}`, 'bv-ierr') : [];
 return f.length ? el('fieldset.bv-iform', {}, el('legend', { text: T.attrsCaption(p.id) }), ...f.map((x) => el('div', {}, x))) : null;
 }
 if (kind === 'ulabel') {
 const i = Number(key), l = this.c?.labels[i];
 if (!l) return null;
 const err = el('span.bv-err', { id: `bv-ierr-label-${i}`, hidden: true });
 const inp = el('input', { type: 'text', size: 12, value: l.net, 'aria-label': T.labelName, 'aria-describedby': err.id, onchange: (e) => {
 const net = e.target.value.trim();
 try { this.commit(renameLabel(this.c, i, net), { label: PICO2_STRINGS.board.editor.renamed(net) }); }
 catch { err.textContent = T.badNet; err.hidden = false; e.target.setAttribute('aria-invalid', 'true'); }
 } });
 return el('fieldset.bv-iform', {}, el('legend', { text: T.rowLabel }), el('label', {}, `${T.labelName} `, inp), err);
 }
 return null;
 }
 labelRows(i) {
 const l = this.c?.labels[Number(i)];
 if (!l) return null;
 const st = this.pinState(this.k?.ends?.get(endKey(l.at)));
 return [[T.rowLabel, l.net], [B.rowPins, l.at], ...(this.live ? [[T.rowVoltage, st.floating ? T.floating : Number.isFinite(st.v) ? `${st.v.toFixed(3)} V (${LOOK_LETTER[st.look]})` : '—']] : [])];
 }
 busNets() {
 if (this.busK === this.k) return this.busN;
 const i2c = new Set(), spi = new Set();
 for (const x of this.k?.modules ?? []) for (const [n, info] of Object.entries(x.pins)) if (info.net !== undefined && !['VCC', 'GND'].includes(n)) (x.bus === 'i2c' ? i2c : spi).add(info.net);
 this.busK = this.k; this.busN = { i2c, spi };
 return this.busN;
 }
 control(p) {
 const give = (v) => this.ctx.input?.({ kind: 'part', id: p.id, value: v });
 if (p.type === 'button') {
 const b = el('button', { type: 'button', text: T.press, 'aria-pressed': 'false' });
 const down = () => { b.setAttribute('aria-pressed', 'true'); give(1); }, up = () => { if (b.getAttribute('aria-pressed') === 'true') { b.setAttribute('aria-pressed', 'false'); give(0); } };
 b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up);
 b.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); down(); } });
 b.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); up(); } });
 return b;
 }
 if (p.type === 'switch') return el('label', {}, el('input', { type: 'checkbox', 'data-ctl': p.id, onchange: (e) => give(e.target.checked ? 1 : 0) }), ` ${T.on}`);
 if (p.type === 'potentiometer') return el('label', {}, `${T.position} `, el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: p.id === DEMO_KNOB ? '0' : '0.5', 'data-ctl': p.id, 'aria-label': `${p.id} ${T.position}`,
 onchange: (e) => (p.id === DEMO_KNOB ? this.ctx.input?.(knobInput(Number(e.target.value) * KNOB_MAX)) : give(Number(e.target.value))) }));
 return '';
 }
 buildDrawing() {
 this.drawn.clear();
 const c = this.c;
 this.wireEls = []; this.labelEls = [];
 if (!c) { this.g.replaceChildren(); return; }
 const wires = s('g', { class: 'bv-uwires' });
 this.drawnEnds = new Set();
 wireDrawings(c).forEach((d, i) => {
 if (!d) return;
 const w = s('path', { class: 'bv-uw', d }); this.wireEls.push({ el: w, wire: c.wires[i] }); wires.append(w);
 this.drawnEnds.add(c.wires[i].a); this.drawnEnds.add(c.wires[i].b);
 });
 const dots = s('g', {}, ...c.nodes.map((n) => s('circle', { class: 'bv-ujn', cx: n.x, cy: n.y, r: 4 })));
 const labelAt = new Set(c.labels.map((l) => l.at));
 this.connected = new Set([...c.wires.flatMap((w) => [w.a, w.b]), ...c.labels.map((l) => l.at)]);
 this.potShown.clear();
 const labels = s('g', {}, ...c.labels.map((l) => {
 const p = endPoint(c, l.at);
 if (p && RAIL_SYMBOL[l.net]) {
 const lead = s('path', { class: 'bv-uw bv-rail', d: `M${p.x} ${p.y} L${l.x} ${p.y} L${l.x} ${l.y}` });
 const x = l.x, y = l.y;
 return RAIL_SYMBOL[l.net] === 'ground'
 ? s('g', { class: 'bv-usym' }, lead, s('path', { class: 'bv-uw bv-rail', d: `M${x} ${y} v6 M${x - 12} ${y + 6} h24 M${x - 7} ${y + 11} h14 M${x - 3} ${y + 16} h6` }), s('title', {}, l.net))
 : s('g', { class: 'bv-usym' }, lead, s('path', { class: 'bv-uw bv-rail', d: `M${x} ${y} v-6 M${x - 10} ${y - 6} h20` }), s('text', { class: 'bv-net', x, y: y - 12, 'text-anchor': 'middle' }, l.net));
 }
 const t = s('text', { class: 'bv-nl', x: l.x, y: l.y, 'text-anchor': p && l.x < p.x - 1 ? 'end' : p && Math.abs(l.x - p.x) <= 1 ? 'middle' : 'start' }, l.net);
 this.labelEls.push({ t, label: l });
 return s('g', {}, p && Math.hypot(p.x - l.x, p.y - l.y) > 12 ? s('path', { class: 'bv-ulead', d: `M${p.x} ${p.y} L${l.x} ${l.y}` }) : null, t);
 }));
 this.g.replaceChildren(wires, ...c.parts.map((p) => this.symbol(p, labelAt)), dots, labels);
 }
 symbol(p, labelAt = new Set()) {
 const { x, y } = p, g = s('g', { 'data-sel': `upart:${p.id}` }), d = [];
 const body = s('g', { transform: partTransform(p) });
 const sb = symbolBody(p.type, p);
 const { glow, wiper, segs, lcd, arcs } = sb;
 const def = PART_TYPES[p.type] ? null : this.c?.defs?.find((x) => x.type === p.type);
 body.append(...(def?.symbol?.length ? def.symbol.map((path) => s('path', { class: 'bv-sym', d: path })) : sb.nodes));
 d.push(body);
 const rail = PART_TYPES[p.type]?.rail;
 const value = p.type === 'resistor' || p.type === 'potentiometer' ? formatValue(parseValue(p.value ?? PART_TYPES[p.type].attrs.value.default), 'Ω')
 : p.type === 'capacitor' ? formatValue(parseValue(p.value ?? PART_TYPES.capacitor.attrs.value.default), 'F') : p.type === 'led' ? p.color ?? 'red' : '';
 const vertical = p.rot === 90 || p.rot === 270, box = partBox(p);
 let posT = null;
 if (PART_TYPES[p.type]?.module || ['sevenseg', 'rgb', 'speaker', 'buzzer', 'ldr'].includes(p.type)) {
 d.push(s('text', { class: 'bv-id', x, y: box.y0 - 8 }, p.id));
 } else if (rail) {
 if (p.type === 'power') { const [tx, ty] = turn(0, -9, p.rot, p.flip); d.push(s('text', { class: 'bv-net', x: x + tx, y: y + ty, 'text-anchor': 'middle' }, rail(p))); }
 } else if (vertical) {
 const tx = x + (wiper ? 34 : 24);
 d.push(s('text', { class: 'bv-id', x: tx, y: y - 6, 'text-anchor': 'start' }, p.id), value ? s('text', { class: 'bv-val', x: tx, y: y + 12, 'text-anchor': 'start' }, value) : null);
 if (wiper) { posT = s('text', { class: 'bv-val', x: tx, y: y + 30, 'text-anchor': 'start' }, ''); d.push(posT); }
 } else {
 d.push(s('text', { class: 'bv-id', x, y: y - 38 }, p.id), value ? s('text', { class: 'bv-val', x, y: y + (p.type === 'potentiometer' ? 78 : 34) }, value) : null);
 if (wiper) { posT = s('text', { class: 'bv-val', x, y: y + 94 }, ''); d.push(posT); }
 }
 const labels = [], conn = this.connected ?? new Set();
 for (const q of partPins(p, this.c?.defs ?? [])) {
 const on = conn.has(`${p.id}.${q.pin}`);
 d.push(on ? s('circle', { class: 'bv-pinmark bv-pinmark-on', cx: q.x, cy: q.y, r: 3.2 }) : s('rect', { class: 'bv-pinmark', x: q.x - 3.5, y: q.y - 3.5, width: 7, height: 7 }));
 if (rail || labelAt.has(`${p.id}.${q.pin}`)) continue;
 const [ox, oy] = q.out;
 const t = s('text', { class: 'bv-nl', x: q.x + ox * 6 + (oy ? 4 : 0), y: q.y + (oy > 0 ? 14 : oy < 0 ? -10 : 0) + (ox ? -9 : 0), 'text-anchor': ox < 0 ? 'end' : ox > 0 ? 'start' : 'start' }, '');
 labels.push({ pin: q.pin, t }); d.push(t);
 }
 let ctl = null;
 if (p.type === 'button' || p.type === 'switch') {
 ctl = s('g', { class: 'bv-uctl', tabindex: 0, role: p.type === 'button' ? 'button' : 'switch', 'aria-label': p.id, [p.type === 'button' ? 'aria-pressed' : 'aria-checked']: 'false' },
 s('rect', { class: 'bv-hit', x: x - 30, y: y - 36, width: 60, height: 44, transform: p.rot ? `rotate(${p.rot} ${x} ${y})` : null }));
 const give = (v) => this.ctx.input?.({ kind: 'part', id: p.id, value: v });
 if (p.type === 'button') {
 const down = () => { ctl.setAttribute('aria-pressed', 'true'); give(1); }, up = () => { if (ctl.getAttribute('aria-pressed') === 'true') { ctl.setAttribute('aria-pressed', 'false'); give(0); } };
 ctl.addEventListener('pointerdown', (e) => { e.stopPropagation(); down(); }); ctl.addEventListener('pointerup', up); ctl.addEventListener('pointerleave', up);
 ctl.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); down(); } });
 ctl.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); up(); } });
 } else {
 const flip = () => give(ctl.getAttribute('aria-checked') === 'true' ? 0 : 1);
 ctl.addEventListener('click', (e) => { e.stopPropagation(); flip(); });
 ctl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
 }
 d.push(ctl);
 }
 if (wiper) {
 const knob = p.id === DEMO_KNOB;
 ctl = s('g', { class: 'bv-uctl', tabindex: 0, role: 'slider', 'aria-label': T.potLabel(p.id), 'aria-valuemin': '0', 'aria-valuemax': knob ? String(KNOB_MAX) : '1' },
 s('rect', { class: 'bv-hit', x: -40, y: -16, width: 80, height: 32 }));
 body.append(ctl);
 const give = (pos) => {
 pos = Math.min(1, Math.max(0, pos));
 this.potPending.set(p.id, { v: pos, t: performance.now() });
 this.showPot(p.id, pos);
 this.ctx.input?.(knob ? knobInput(pos * KNOB_MAX) : { kind: 'part', id: p.id, value: Math.round(pos * 1024) / 1024 });
 };
 const at = (e) => { const m = body.getScreenCTM?.(); if (!m) return null; const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()); return (36 - q.x) / 72; };
 let drag = false;
 ctl.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); drag = true; try { ctl.setPointerCapture?.(e.pointerId); } catch { } ctl.focus?.({ preventScroll: true }); const v = at(e); if (v !== null) this.showPot(p.id, Math.min(1, Math.max(0, v))); });
 ctl.addEventListener('pointermove', (e) => { if (drag) { const v = at(e); if (v !== null) this.showPot(p.id, Math.min(1, Math.max(0, v))); } });
 const end = (e) => { if (!drag) return; drag = false; const v = at(e); give(v ?? this.potShown.get(p.id) ?? 0); };
 for (const t of ['pointerup', 'pointercancel']) ctl.addEventListener(t, end);
 ctl.addEventListener('keydown', (e) => {
 const now = this.potShown.get(p.id) ?? 0, st = knob ? 0.1 / KNOB_MAX : 0.05;
 const v = { ArrowUp: now + st, ArrowRight: now + st, ArrowDown: now - st, ArrowLeft: now - st, PageUp: now + 0.25, PageDown: now - 0.25, Home: 0, End: 1 }[e.key];
 if (v === undefined) return;
 e.preventDefault(); e.stopPropagation(); give(v);
 });
 }
 g.append(s('title', {}, B.partTitle(`${p.id} (${PART_TYPES[p.type]?.label ?? p.type})`)), ...d.filter(Boolean));
 this.drawn.set(p.id, { glow, labels, ctl, type: p.type, wiper, posT, knob: p.id === DEMO_KNOB, segs, lcd, arcs, g });
 return g;
 }
 showPot(id, pos) {
 const dr = this.drawn.get(id);
 if (!dr?.wiper || this.potShown.get(id) === pos) return;
 this.potShown.set(id, pos);
 const x = Math.round((36 - 72 * pos) * 10) / 10;
 dr.wiper.setAttribute('transform', `translate(${x} 0)`);
 dr.wiper.firstChild.setAttribute('d', `M${-x} 50.8 V30 H0 V14`);
 const text = dr.knob ? T.knobV(pos * KNOB_MAX) : T.potPos(pos);
 if (dr.posT) dr.posT.textContent = text;
 dr.ctl?.setAttribute('aria-valuenow', dr.knob ? (pos * KNOB_MAX).toFixed(2) : pos.toFixed(2));
 dr.ctl?.setAttribute('aria-valuetext', text);
 }
 update(lc, st = null) {
 this.live = lc && this.k && lc.hash === this.k.hash ? lc : null;
 const L = this.live;
 for (const [id, dr] of this.drawn) {
 for (const { pin, t } of dr.labels) {
 const w = this.k?.pins.get(`${id}.${pin}`);
 const name = w ? (w.rail ?? w.name) : '';
 const conn = this.c ? Boolean(pinTarget(this.c, `${id}.${pin}`)) || (this.c.wires ?? []).some((x) => x.a === `${id}.${pin}` || x.b === `${id}.${pin}`) || (this.c.labels ?? []).some((x) => x.at === `${id}.${pin}`) : false;
 const { look } = this.pinState(w);
 const drawn = this.drawnEnds?.has(`${id}.${pin}`);
 const text = !conn ? '—' : drawn ? (L ? LOOK_LETTER[look] : '') : `${name} ${L ? LOOK_LETTER[look] : ''}`.trim();
 if (t.textContent !== text) t.textContent = text;
 const cls = `bv-nl${L && conn ? ` bv-${look}` : ''}`;
 if (t.getAttribute('class') !== cls) t.setAttribute('class', cls);
 }
 if (dr.glow && dr.type === 'rgb') {
 const b = (sub) => ledGlow(L?.leds.find((x) => x.part === id && x.sub === sub)?.mA);
 const r = b('R'), gg = b('G'), bb = b('B'), o = String(Math.round(Math.max(r, gg, bb) * 0.8 * 100) / 100);
 const fill = `rgb(${Math.round(255 * r)}, ${Math.round(255 * gg)}, ${Math.round(255 * bb)})`;
 if (dr.glow.getAttribute('fill') !== fill) dr.glow.setAttribute('fill', fill);
 if (dr.glow.getAttribute('opacity') !== o) dr.glow.setAttribute('opacity', o);
 } else if (dr.glow) { const led = L?.leds.find((x) => x.part === id); const o = String(Math.round(ledGlow(led?.mA) * 0.7 * 100) / 100); if (dr.glow.getAttribute('opacity') !== o) dr.glow.setAttribute('opacity', o); }
 if (dr.segs) for (const sg of SEGMENTS) {
 const o = String(Math.round((0.12 + 0.88 * ledGlow(L?.leds.find((x) => x.part === id && x.sub === sg)?.mA)) * 100) / 100);
 if (dr.segs[sg].getAttribute('opacity') !== o) dr.segs[sg].setAttribute('opacity', o);
 }
 if (dr.lcd) {
 const lines = st?.parts?.lcds?.[id] ?? null, on = Boolean(lines?.some((x) => x));
 dr.lcd.cells.forEach((row, r) => row.forEach((t, c) => { const ch = lines?.[r]?.[c] ?? ''; const v = ch === ' ' ? '' : ch; if (t.textContent !== v) t.textContent = v; }));
 const cls = on ? 'bv-lcd-glass' : 'bv-lcd-glass bv-lcd-dark';
 if (dr.lcd.win.getAttribute('class') !== cls) dr.lcd.win.setAttribute('class', cls);
 }
 if (dr.arcs) {
 const pad = this.k?.sounders?.find((x) => x.id === id)?.pads[0];
 const on = pad !== undefined && pad === this.k?.tap && (st?.pins?.busy?.[pad] ?? 0) >= 2;
 dr.g.classList.toggle('bv-sounding', on);
 }
 if (dr.ctl && dr.type === 'switch') dr.ctl.setAttribute('aria-checked', String((L?.controls?.[id] ?? 0) >= 0.5));
 if (dr.wiper) {
 const ev = L?.controls?.[id], pend = this.potPending.get(id);
 if (pend && ((Number.isFinite(ev) && Math.abs(ev - pend.v) < 0.002) || performance.now() - pend.t > 1500)) this.potPending.delete(id);
 this.showPot(id, this.potPending.get(id)?.v ?? (Number.isFinite(ev) ? ev : dr.knob ? 0 : 0.5));
 }
 }
 const endState = (end) => { try { return this.pinState(this.k?.ends?.get(endKey(end))); } catch { return { look: 'z' }; } };
 const busNet = this.busNets();
 for (const { el: w, wire } of this.wireEls ?? []) {
 const rail = this.k?.ends?.get(endKey(wire.a))?.rail, net = this.k?.ends?.get(endKey(wire.a))?.net;
 const act = net !== undefined && ((st?.act?.i2c && busNet.i2c.has(net)) || (st?.act?.spi && busNet.spi.has(net)));
 const cls = rail ? 'bv-uw bv-rail' : `bv-uw${L ? ` bv-${endState(wire.a).look}` : ''}${act ? ' bv-act' : ''}`;
 if (w.getAttribute('class') !== cls) w.setAttribute('class', cls);
 }
 for (const { t, label } of this.labelEls ?? []) {
 const st = endState(label.at);
 const text = `${label.net}${L ? ` ${LOOK_LETTER[st.look]}` : ''}`, cls = `bv-nl${L ? ` bv-${st.look}` : ''}`;
 if (t.textContent !== text) t.textContent = text;
 if (t.getAttribute('class') !== cls) t.setAttribute('class', cls);
 }
 for (const inp of this.root.querySelectorAll('[data-ctl]')) {
 const v = L?.controls?.[inp.dataset.ctl];
 if (v === undefined || document.activeElement === inp) continue;
 if (inp.type === 'checkbox') inp.checked = v >= 0.5; else if (Math.abs(Number(inp.value) - v) > 0.005) inp.value = String(v);
 }
 this.updateNets(); this.updateWarnings();
 }
 pinState(w) {
 const L = this.live;
 if (!w || !L) return { look: 'z', v: NaN };
 if (w.rail) { const v = { GND: 0, '3V3': 3.3, VSYS: 5, VBUS: 5, ADC_VREF: 3.3 }[w.rail]; return { look: netLook(v, false), v }; }
 if (w.island === undefined) return { look: 'z', v: NaN };
 const n = L.nets[w.island];
 return { look: netLook(n?.volts[w.node], n?.floating[w.node]), v: n?.volts[w.node], floating: Boolean(n?.floating[w.node]) };
 }
 updateNets() {
 const nets = (this.k?.nets ?? []).filter((n) => n.members.some((m) => /^[A-Za-z][\w]*\.\w+$/.test(m)));
 const rows = nets.map((n) => {
 const pin = n.members.find((m) => /^[A-Za-z][\w]*\.\w+$/.test(m));
 const st = this.pinState(this.k.pins.get(pin));
 return [n.name, n.members.join(', '), !this.live ? '—' : st.floating ? T.floating : Number.isFinite(st.v) ? `${st.v.toFixed(3)} V (${LOOK_LETTER[st.look]})` : '—'];
 });
 const key = JSON.stringify(rows);
 if (key === this.netKey) return;
 this.netKey = key;
 this.netBody.replaceChildren(...rows.map(([a, b, c]) => el('tr', {}, el('th', { scope: 'row', text: a }), el('td', { text: b }), el('td', { text: c }))));
 }
 updateWarnings() {
 const w = this.live?.warnings ?? [];
 const key = JSON.stringify(w);
 if (key === this.warnKey) return;
 this.warnKey = key;
 const D = PICO2_STRINGS.diag;
 this.warnBox.replaceChildren(w.length ? el('ul', {}, ...w.map((x) => el('li', { text: D[x.kind] ? D[x.kind](...x.args) : x.kind }))) : el('p', { text: T.noWarnings }));
 }
 inspectRows(id) {
 const p = this.c?.parts.find((x) => x.id === id);
 if (!p) return null;
 const type = PART_TYPES[p.type], rows = [[B.rowPart, `${p.id}: ${type?.label ?? p.type}`]];
 if (VALUE_SOURCES[p.type]) rows.push([T.rowSource, VALUE_SOURCES[p.type]]);
 for (const [k, a] of Object.entries(type?.attrs ?? {})) rows.push([T.rowValue, a.kind === 'choice' ? `${k}: ${p[k] ?? a.default}` : formatValue(parseValue(p[k] ?? a.default), a.unit)]);
 for (const pin of type?.pins ?? []) {
 const w = this.k?.pins.get(`${id}.${pin}`), st = this.pinState(w);
 rows.push([T.rowNet(pin), `${w ? (w.rail ?? w.name) : '—'}${this.live ? (st.floating ? ` · ${T.floating}` : Number.isFinite(st.v) ? ` · ${st.v.toFixed(3)} V (${LOOK_LETTER[st.look]})` : '') : ''}`]);
 }
 const isl = this.k?.islands.findIndex((x) => x.prims.some((q) => q.part === id)) ?? -1;
 if (this.live && isl >= 0) {
 const i = this.k.islands[isl].prims.findIndex((q) => q.part === id), cur = this.live.nets[isl]?.current?.[i];
 if (Number.isFinite(cur)) rows.push([T.rowCurrent, `${(cur * 1000).toFixed(3)} mA`]);
 }
 if (p.type === 'led') { const led = this.live?.leds.find((x) => x.part === id); if (led) rows.push([B.rowShows, `${led.mA.toFixed(2)} mA (${Math.round(ledGlow(led.mA) * 100)} %)`]); }
 return rows;
 }
}
