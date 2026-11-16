// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../../contract.js';
import { el } from '../../../ui/dom.js';
import { PICO2_STRINGS } from '../strings.js';
import { PICO2_PINS, LED_GPIO, pinOfGpio, pinLook, ledState, BOARD_PALETTE, BOARD_LOOK } from './board-model.js';
import { CircuitUI, CIRCUIT_STYLE, ledGlow } from './circuit-ui.js';
import { CircuitEditor, EDITOR_STYLE } from './circuit-editor.js';
import { BOARD, PADS, SWD, CHIPS, NAME, SHEET, edgeX } from './board-geometry.js';
const B = PICO2_STRINGS.board;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...children) {
 const n = document.createElementNS(NS, tag);
 for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : String(v));
 for (const c of children.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
 return n;
}
const pathOf = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
const HOP = 6;
function routeD(pts, obst = {}) {
 let d = `M${pts[0][0]} ${pts[0][1]}`;
 const inside = (c, a, b) => (c - a) * Math.sign(b - a) > HOP && (b - c) * Math.sign(b - a) > HOP;
 const between = (c, a, b) => c > Math.min(a, b) && c < Math.max(a, b);
 for (let i = 1; i < pts.length; i++) {
 const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
 if (y1 === y2 && x1 !== x2) {
 const dir = Math.sign(x2 - x1);
 const cs = (obst.v ?? []).filter((o) => inside(o.x, x1, x2) && between(y1, o.y1, o.y2)).map((o) => o.x).sort((a, b) => (a - b) * dir);
 for (const c of cs) d += ` L${c - dir * HOP} ${y1} A${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${c + dir * HOP} ${y1}`;
 } else if (x1 === x2 && y1 !== y2) {
 const dir = Math.sign(y2 - y1);
 const cs = (obst.h ?? []).filter((o) => inside(o.y, y1, y2) && between(x1, o.x1, o.x2)).map((o) => o.y).sort((a, b) => (a - b) * dir);
 for (const c of cs) d += ` L${x1} ${c - dir * HOP} A${HOP} ${HOP} 0 0 ${dir > 0 ? 1 : 0} ${x1} ${c + dir * HOP}`;
 }
 d += ` L${x2} ${y2}`;
 }
 return d;
}
const FUNCTIONS = { 0: 'HSTX', 1: 'SPI', 2: 'UART', 3: 'I2C', 4: 'PWM', 5: 'SIO', 6: 'PIO0', 7: 'PIO1', 8: 'PIO2', 9: 'clock', 10: 'USB', 11: 'UART (alt.)' };
const fnName = (f) => (f === 31 || f === undefined ? B.noFunction : FUNCTIONS[f] ?? `F${f}`);
function paletteCss() {
 const vars = (p) => `--bv-sheet: ${p.sheet}; --bv-high: ${p.high}; --bv-low: ${p.low}; --bv-z: ${p.z}; --bv-busy: ${p.busy}; --bv-undef: ${p.undef};`;
 const P = BOARD_PALETTE;
 return [`:root { ${vars(P.light)} }`,
 `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { ${vars(P.dark)} } }`,
 ...Object.entries(P).map(([k, p]) => `:root[data-theme="${k}"] { ${vars(p)} }`)].join('\n');
}
const L = BOARD_LOOK;
const STYLE = `
${paletteCss()}
.bv-view { flex: 1 1 0; min-height: 10rem; display: flex; flex-direction: column; position: relative; overflow: hidden; }
.bv-svg { width: 100%; height: 100%; font-family: var(--font-ui); }
.bv-sheet { fill: var(--surface, var(--bv-sheet)); }
.bv-board { fill: ${L.board}; stroke: ${L.boardEdge}; stroke-width: 2; }
.bv-usb { fill: ${L.usb}; stroke: #6d7177; stroke-width: 1.5; }
.bv-hole { fill: ${L.hole}; } .bv-mhole { fill: var(--bv-sheet); stroke: ${L.copper}; stroke-width: 4; }
.bv-pad { fill: ${L.copper}; }
.bv-chip { fill: ${L.chip}; stroke: #555; stroke-width: 1; }
.bv-chip-t { fill: ${L.chipText}; font-size: 13px; font-weight: 600; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
.bv-chip-s { fill: ${L.chipText}; font-size: 10px; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
.bv-print { fill: ${L.print}; font-size: 9px; pointer-events: none; }
.bv-name { fill: ${L.print}; font-weight: 700; text-anchor: middle; dominant-baseline: middle; letter-spacing: 1px; pointer-events: none; }
.bv-pin-n { fill: var(--text); font-size: 15px; font-family: var(--font-code); dominant-baseline: middle; pointer-events: none; }
.bv-dot { stroke: #111; stroke-width: 1.5; fill: var(--bv-sheet); }
.bv-dot.bv-high { fill: var(--bv-high); } .bv-dot.bv-low { fill: var(--bv-low); } .bv-dot.bv-z { fill: var(--bv-z); } .bv-dot.bv-busy { fill: var(--bv-busy); }
.bv-letter { font-size: 9px; font-weight: 700; text-anchor: middle; dominant-baseline: central; fill: #ffffff; pointer-events: none; font-family: var(--font-code); }
.bv-letter.bv-z { fill: #111; }
.bv-pull { font-size: 13px; font-weight: 700; fill: ${L.print}; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.bv-w { fill: none; stroke: var(--bv-z); stroke-width: 2.4; stroke-linejoin: round; }
.bv-w.bv-high { stroke: var(--bv-high); } .bv-w.bv-low { stroke: var(--bv-low); } .bv-w.bv-busy { stroke: var(--bv-busy); stroke-dasharray: 7 4; }
.bv-w.bv-act { stroke-width: 5; }
.bv-w.bv-fixed { stroke: var(--text); stroke-width: 1.6; }
.bv-part { fill: var(--surface, #fff); stroke: var(--text); stroke-width: 1.6; }
.bv-part-t { fill: var(--text); font-size: 18px; font-weight: 600; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
.bv-part-s { fill: var(--muted, #666); font-size: 14px; text-anchor: middle; dominant-baseline: middle; pointer-events: none; }
.bv-net { fill: var(--muted, #666); font-size: 13px; font-family: var(--font-code); pointer-events: none; }
.bv-pin-l { fill: var(--muted, #666); font-size: 11px; font-family: var(--font-code); text-anchor: end; dominant-baseline: central; pointer-events: none; }
.bv-pin-l.bv-start, .bv-part-t.bv-start, .bv-part-s.bv-start { text-anchor: start; }
.bv-jn { fill: var(--text); }
.bv-lcd { fill: #1f3d5c; stroke: var(--text); stroke-width: 1.6; }
.bv-lcd-title { fill: #e8eef4; font-size: 12px; font-family: var(--font-code); pointer-events: none; }
.bv-lcd .bv-pin-l, .bv-lcdg .bv-pin-l { fill: #e8eef4; }
.bv-lcd-win { fill: #b7d23c; stroke: #0b1404; stroke-width: 2; }
.bv-lcd-cell { fill: #a9c534; }
.bv-lcd-ch { fill: #13210a; font-family: var(--font-code); font-size: 18px; font-weight: 600; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.bv-lcd-dark .bv-lcd-win { fill: #6d7f2a; } .bv-lcd-dark .bv-lcd-cell { fill: #66772a; }
.bv-knob { cursor: ns-resize; } .bv-knob:focus { outline: none; } .bv-knob:focus-visible .bv-hit { stroke: var(--primary); stroke-width: 3; stroke-dasharray: 5 3; }
.bv-wiper-a { fill: var(--text); stroke: var(--text); stroke-width: 1; }
.bv-knob-v { fill: var(--text); font-size: 18px; font-weight: 600; font-family: var(--font-code); dominant-baseline: middle; pointer-events: none; }
.bv-led { fill: #5a1a1a; stroke: #300; stroke-width: 1; }
.bv-glow { fill: #ff3030; opacity: 0; pointer-events: none; }
.bv-led-on .bv-led { fill: #ff4040; } .bv-led-on .bv-glow { opacity: 0.55; }
.bv-led-half .bv-led { fill: #c03030; } .bv-led-half .bv-glow { opacity: 0.25; }
.bv-btn-cap { fill: #3a3a3a; stroke: var(--text); stroke-width: 1.4; }
.bv-btn[aria-pressed="true"] .bv-btn-cap { fill: #777; transform: translateY(4px); }
.bv-btn:focus { outline: none; } .bv-btn:focus-visible .bv-hit { stroke: var(--primary); stroke-width: 3; stroke-dasharray: 5 3; }
.bv-hit { fill: transparent; stroke: none; cursor: pointer; }
.bv-arcs { fill: none; stroke: var(--bv-busy); stroke-width: 2.4; opacity: 0; }
.bv-sounding .bv-arcs { opacity: 1; }
.bv-sel { fill: none; stroke: var(--primary); stroke-width: 3; stroke-dasharray: 6 4; pointer-events: none; }
[data-sel] { cursor: pointer; }
.bv-tab { font-size: 0.84rem; }
.bv-tab table { border-collapse: collapse; } .bv-tab td, .bv-tab th { padding: 2px 8px; text-align: left; vertical-align: top; }
.bv-tab caption { text-align: left; font-weight: 600; padding: 0.4em 0 0.2em; }
.bv-tab th[scope="row"] { font-weight: 600; white-space: nowrap; }
.bv-tab p { margin: 0.4em 0; max-width: 70em; }
.bv-mono { font-family: var(--font-code); font-size: 0.8rem; }
.bv-tab button { font: inherit; font-size: 0.8rem; }
.bv-swatch { display: inline-block; width: 0.8em; height: 0.8em; border: 1px solid #111; border-radius: 50%; vertical-align: -0.05em; margin-right: 0.35em; }
${CIRCUIT_STYLE}
${EDITOR_STYLE}
.bv-iform { border: 1px solid var(--border, #bbb); margin: 0.5em 0; padding: 0.3em 0.6em; } .bv-iform div { margin: 0.2em 0; }
.bv-swatch.bv-high { background: var(--bv-high); } .bv-swatch.bv-low { background: var(--bv-low); } .bv-swatch.bv-z { background: var(--bv-z); } .bv-swatch.bv-busy { background: var(--bv-busy); }
`;
export class BoardView {
 constructor(ctx = {}) {
 this.ctx = ctx;
 this.eng = null;
 this.at = 0;
 this.sel = null;
 this.cur = null;
 this.prevBus = null;
 this.keys = new Map();
 this.padEls = [];
 this.wires = Array.from({ length: 30 }, () => []);
 this.status = el('span.dp-status.mono');
 this.cui = new CircuitUI(ctx, { onSelect: (id, open) => this.select(id, open) });
 this.buildSvg();
 this.root = el('div.bv-view', {}, el('style', { text: STYLE }), this.svg);
 this.ed = new CircuitEditor(this);
 this.ed.attach();
 this.cui.onCommitted = (text, label) => this.ed.noted(text, label);
 this.inspTable = el('div'); this.inspForm = el('div'); this.formKey = null;
 this.inspForm.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.ed.on) { e.preventDefault(); e.stopPropagation(); this.root.focus({ preventScroll: true }); } });
 this.boxes = { inspect: el('div.bv-tab', {}, this.inspTable, this.inspForm), circuit: this.cui.root, pins: el('div.bv-tab'), help: el('div.bv-tab', {}, B.help.map((t) => el('p', { text: t }))) };
 this.buildPinsTable();
 this.showInspect();
 }
 buildSvg() {
 const svg = s('svg', { class: 'bv-svg', viewBox: `${SHEET.x} ${SHEET.y} ${SHEET.w} ${SHEET.h}`, role: 'group', 'aria-label': B.svgTitle },
 s('title', {}, B.svgTitle), s('desc', {}, B.svgDesc));
 this.svg = svg;
 svg.append(s('rect', { class: 'bv-sheet', x: SHEET.x, y: SHEET.y, width: SHEET.w, height: SHEET.h }));
 const circuit = s('g', { class: 'bv-circuit' });
 const board = s('g', { class: 'bv-boardg' });
 svg.append(circuit, board);
 this.circuit = circuit;
 const u = BOARD.usb;
 board.append(this.selectable(s('rect', { class: 'bv-usb', x: u.x, y: u.y, width: u.w, height: u.h, rx: 4 }), 'part:usb', B.usb));
 board.append(s('rect', { class: 'bv-board', x: 0, y: 0, width: BOARD.w, height: BOARD.h, rx: 8 }));
 for (const [x, y] of BOARD.holes) board.append(s('circle', { class: 'bv-mhole', cx: x, cy: y, r: BOARD.holeR + 2 }));
 for (const p of PADS) {
 const left = p.side === 'left';
 const g = this.selectable(s('g', { class: 'bv-padg' }), `pin:${p.pin}`, B.pinTitle(p.pin, p.name));
 g.append(s('rect', { class: 'bv-pad', x: left ? 0 : BOARD.w - BOARD.padW, y: p.y - BOARD.padH / 2, width: BOARD.padW, height: BOARD.padH, rx: 3 }));
 g.append(s('circle', { class: 'bv-hole', cx: p.x, cy: p.y, r: BOARD.padHoleR }));
 let dot = null, letter = null, pull = null;
 if (p.gpio >= 0) {
 dot = s('circle', { class: 'bv-dot', cx: p.x, cy: p.y, r: 9 });
 letter = s('text', { class: 'bv-letter', x: p.x, y: p.y });
 pull = s('text', { class: 'bv-pull', x: p.x + (left ? 19 : -19), y: p.y });
 g.append(dot, letter, pull);
 }
 const nx = [1, 20, 21, 40].includes(p.pin) ? 64 : 30;
 g.append(s('text', { class: 'bv-print', x: p.x + (left ? nx : -nx), y: p.y + 3, 'text-anchor': left ? 'start' : 'end' }, String(p.pin)));
 board.append(g);
 circuit.append(s('text', { class: 'bv-pin-n', x: left ? -8 : BOARD.w + 8, y: p.y - 9, 'text-anchor': left ? 'end' : 'start' }, p.name));
 this.padEls[p.pin] = { dot, letter, pull, gpio: p.gpio };
 }
 const swd = this.selectable(s('g', {}), 'part:swd', B.swd);
 for (const d of SWD) {
 swd.append(s('rect', { class: 'bv-pad', x: d.x - 9, y: d.y - 9, width: 18, height: 18, rx: 3 }), s('circle', { class: 'bv-hole', cx: d.x, cy: d.y, r: 5 }));
 const ty = BOARD.h + 10;
 circuit.append(s('text', { class: 'bv-pin-n', x: d.x, y: ty, transform: `rotate(90 ${d.x} ${ty})`, 'font-size': 12 }, d.name));
 }
 board.append(swd, s('text', { class: 'bv-print', x: BOARD.w / 2, y: BOARD.h - 32, 'text-anchor': 'middle' }, 'DEBUG'));
 for (const c of CHIPS) {
 const id = `part:${c.id}`;
 if (c.kind === 'led') {
 const g = this.selectable(s('g', {}), id, B.led);
 this.ledGlowEl = s('circle', { class: 'bv-glow', cx: c.x + c.w / 2, cy: c.y + c.h / 2, r: 22 });
 g.append(this.ledGlowEl, s('rect', { class: 'bv-led', x: c.x, y: c.y, width: c.w, height: c.h, rx: 2 }),
 s('text', { class: 'bv-print', x: c.x + c.w + 6, y: c.y + c.h / 2 + 3 }, 'LED'));
 this.ledG = g;
 board.append(g);
 } else if (c.kind === 'button') {
 const g = this.selectable(s('g', {}), id, B.bootsel);
 g.append(s('rect', { class: 'bv-chip', x: c.x, y: c.y, width: c.w, height: c.h, rx: 3, fill: '#d8d8d8' }),
 s('circle', { cx: c.x + c.w / 2, cy: c.y + c.h / 2, r: c.w * 0.32, fill: '#f4f4f4', stroke: '#999' }),
 s('text', { class: 'bv-print', x: c.x + c.w / 2 + 4, y: c.y + c.h + 10, 'text-anchor': 'middle', 'font-size': 8 }, 'BOOTSEL'));
 board.append(g);
 } else {
 const name = { rp2350: B.rp2350, flash: B.flash, smps: B.smps, xtal: B.xtal }[c.id] ?? c.label;
 const g = this.selectable(s('g', {}), id, name);
 g.append(s('rect', { class: 'bv-chip', x: c.x, y: c.y, width: c.w, height: c.h, rx: 3 }),
 s('text', { class: 'bv-chip-t', x: c.x + c.w / 2, y: c.y + c.h / 2 - (c.sub ? 7 : 0) }, c.label));
 if (c.sub) g.append(s('text', { class: 'bv-chip-s', x: c.x + c.w / 2, y: c.y + c.h / 2 + 9 }, c.sub));
 board.append(g);
 }
 }
 board.append(s('text', { class: 'bv-name', x: NAME.x, y: NAME.y, 'font-size': NAME.size }, NAME.text));
 circuit.append(this.cui.g);
 this.selRect = s('rect', { class: 'bv-sel', visibility: 'hidden' });
 svg.append(this.selRect);
 svg.addEventListener('click', (e) => { if (this.ed?.on) return; const t = e.target.closest?.('[data-sel]'); if (t) this.select(t.dataset.sel); });
 }
 selectable(node, id, name) {
 node.dataset.sel = id;
 node.prepend(s('title', {}, id.startsWith('pin:') ? name : B.partTitle(name)));
 return node;
 }
 wire(pts, gpio = -1, obst = null) {
 const w = s('path', { class: gpio >= 0 ? 'bv-w' : 'bv-w bv-fixed', d: obst ? routeD(pts, obst) : pathOf(pts) });
 if (gpio >= 0) this.wires[gpio].push(w);
 return w;
 }
 dot(x, y) { return s('circle', { class: 'bv-jn', cx: x, cy: y, r: 4 }); }
 gnd(x, y) { return s('path', { class: 'bv-w bv-fixed', d: `M${x} ${y} v10 M${x - 12} ${y + 10} h24 M${x - 7} ${y + 15} h14 M${x - 3} ${y + 20} h6` }); }
 rail(x, y, text) { return [s('path', { class: 'bv-w bv-fixed', d: `M${x} ${y} v-10 M${x - 10} ${y - 10} h20` }), s('text', { class: 'bv-net', x, y: y - 16, 'text-anchor': 'middle' }, text)]; }
 resistor(x, y0, y1) {
 const m = (y0 + y1) / 2;
 return s('path', { class: 'bv-w bv-fixed', d: `M${x} ${y0} V${m - 18} l7 3 l-14 6 l14 6 l-14 6 l14 6 l-7 3 V${y1}` });
 }
 extOf(pins, g) { return pins?.ext?.[g] ?? -1; }
 put(node, cls) { if (node && this.keys.get(node) !== cls) { this.keys.set(node, cls); node.setAttribute('class', cls); } }
 text(node, t) { if (node && node.textContent !== t) node.textContent = t; }
 draw(st) {
 const pins = st?.pins ?? null;
 const act = { i2c: false, spi: false };
 if (st?.bus && this.prevBus) { act.i2c = st.bus.i2c[0] !== this.prevBus.i2c[0]; act.spi = st.bus.spi[0] !== this.prevBus.spi[0]; }
 this.prevBus = st?.bus ? { i2c: [...st.bus.i2c], spi: [...st.bus.spi] } : null;
 this.cur = st ? { pins, parts: st.parts ?? null, bus: st.bus ?? null, act, circuit: st.circuit ?? null } : null;
 for (let g = 0; g < 30; g++) {
 const lk = pins ? pinLook(pins.state[g], pins.busy?.[g] ?? 0, this.extOf(pins, g)) : null;
 const pin = pinOfGpio(g);
 if (pin) {
 const pe = this.padEls[pin];
 this.put(pe.dot, lk ? `bv-dot bv-${lk.look}` : 'bv-dot');
 this.put(pe.letter, lk ? `bv-letter bv-${lk.look}` : 'bv-letter');
 this.text(pe.letter, lk ? (lk.letter.length > 1 ? 'Z' : lk.letter) : '');
 this.text(pe.pull, lk?.pull === 'up' ? '↑' : lk?.pull === 'down' ? '↓' : '');
 }
 for (const w of this.wires[g]) this.put(w, `bv-w${lk ? ` bv-${lk.look}` : ''}`);
 }
 const gl = st?.circuit?.leds?.find((x) => x.part === 'GP25 LED');
 let led;
 if (gl) { const b = ledGlow(gl.mA); led = b >= 0.75 ? 'on' : b > 0.02 ? 'half' : 'off'; this.ledGlowEl.style.opacity = String(Math.round(b * 55) / 100); }
 else { led = pins ? ledState(pins.state[LED_GPIO], pins.busy?.[LED_GPIO] ?? 0) : 'off'; this.ledGlowEl.style.opacity = ''; }
 this.put(this.ledG, led === 'on' ? 'bv-led-on' : led === 'half' ? 'bv-led-half' : '');
 if (this.cui.sync()) this.fitSheet();
 this.cui.update(st?.circuit ?? null, this.cur);
 this.ed.draw();
 this.updatePinsTable();
 this.showInspect();
 this.status.textContent = '';
 }
 afterEdit() {
 if (this.cui.sync()) this.fitSheet();
 this.cui.update(this.cur?.circuit ?? null, this.cur);
 this.ed.draw();
 this.showInspect(true);
 }
 focusInspectField() { const f = this.inspForm.querySelector('input, select'); f?.focus(); if (f?.select && f.tagName === 'INPUT') f.select(); }
 fitSheet() {
 const b = this.cui.bounds();
 let x0 = Math.min(SHEET.x, b?.x ?? Infinity), y0 = Math.min(SHEET.y, b?.y ?? Infinity);
 let x1 = Math.max(SHEET.x + SHEET.w, b ? b.x + b.w : -Infinity), y1 = Math.max(SHEET.y + SHEET.h, b ? b.y + b.h : -Infinity);
 if (this.ed?.on) {
 const M = 400, v = this.sheetBox;
 if (v && x0 >= v.x0 && y0 >= v.y0 && x1 <= v.x1 && y1 <= v.y1) return;
 x0 -= M; y0 -= M; x1 += M; y1 += M;
 if (v) { x0 = Math.min(x0, v.x0); y0 = Math.min(y0, v.y0); x1 = Math.max(x1, v.x1); y1 = Math.max(y1, v.y1); }
 this.sheetBox = { x0, y0, x1, y1 };
 } else this.sheetBox = null;
 this.svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
 const sheet = this.svg.querySelector('.bv-sheet');
 for (const [k, v] of Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })) sheet.setAttribute(k, v);
 }
 live(st) {
 if (!st?.pins) return;
 if (Number.isFinite(st.pins.logTotal)) this.at = st.pins.logTotal;
 this.draw(st);
 }
 render() {
 const e = this.ctx.engine?.() ?? null;
 if (!e?.live) { this.eng = null; this.draw(null); return; }
 const fresh = e !== this.eng;
 this.eng = e;
 let st;
 try { st = e.live({ uartFrom: Infinity, pinsFrom: fresh ? Infinity : this.at }); } catch { st = null; }
 if (st?.pins) this.at = st.pins.logTotal;
 this.draw(st);
 }
 select(id, open = true) {
 this.sel = id;
 const node = this.ed?.on ? null : this.svg.querySelector(`[data-sel="${id}"]`);
 if (this.ed?.on) this.selRect.setAttribute('visibility', 'hidden');
 if (node?.getBBox) {
 try { const b = node.getBBox(); Object.entries({ x: b.x - 5, y: b.y - 5, width: b.width + 10, height: b.height + 10 }).forEach(([k, v]) => this.selRect.setAttribute(k, v)); this.selRect.setAttribute('visibility', 'visible'); } catch { }
 }
 this.showInspect(true);
 if (open) this.ctx.openPanel?.({ tab: B.tabInspect });
 }
 inspectRows() {
 const id = this.sel, c = this.cur, pins = c?.pins;
 if (!id) return null;
 const [kind, key] = id.split(':');
 if (kind === 'upart') return this.cui.inspectRows(key);
 if (kind === 'ulabel') return this.cui.labelRows(key);
 if (kind === 'pin') {
 const p = PICO2_PINS[Number(key) - 1];
 const rows = [[B.rowPin, String(p.pin)], [B.rowName, p.name]];
 if (p.gpio < 0) return [...rows, ['', B.power]];
 rows.push([B.rowGpio, String(p.gpio)]);
 if (!pins) return rows;
 return [...rows, ...this.gpioRows(p.gpio)];
 }
 const lk = (g) => (pins ? pinLook(pins.state[g], pins.busy?.[g] ?? 0, this.extOf(pins, g)) : null);
 switch (key) {
 case 'led': return [[B.rowPart, B.led], [B.rowShows, B.ledStates[pins ? ledState(pins.state[LED_GPIO], pins.busy?.[LED_GPIO] ?? 0) : 'off']], ...(pins ? this.gpioRows(LED_GPIO) : []), ['', B.ledNote]];
 default: {
 const named = { usb: [B.usb, B.usbNote], swd: [B.swd, B.swdNote], bootsel: [B.bootsel, B.bootselNote], rp2350: [B.rp2350, B.rp2350Note], flash: [B.flash, B.flashNote], smps: [B.smps, B.smpsNote], xtal: [B.xtal, B.xtalNote] }[key];
 return named ? [[B.rowPart, named[0]], ['', named[1]]] : null;
 }
 }
 }
 gpioRows(g) {
 const p = this.cur.pins, st = p.state[g], oe = p.oe[g], ext = this.extOf(p, g), lk = pinLook(st, p.busy?.[g] ?? 0, ext);
 return [[B.rowFunction, fnName(p.fn?.[g])], [B.rowState, B.looks[lk.look]], [B.rowLetter, lk.settled],
 [B.rowDirection, oe ? B.output : B.input],
 [B.rowDriven, oe ? B.byChip : ext >= 0 ? B.byOutside : lk.pull ? B.byPull : B.byNothing],
 [B.rowPull, B.pulls[lk.pull ?? 'none']], [B.rowLevel, p.level[g] ? 'H (1)' : 'L (0)'], [B.rowChanges, B.changes(p.busy?.[g] ?? 0)]];
 }
 showInspect(force = false) {
 const fkey = `${this.sel}|${this.cui.text}`;
 if (fkey !== this.formKey) {
 this.formKey = fkey;
 const had = this.inspForm.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
 this.inspForm.replaceChildren(...(this.sel ? [this.cui.attrForm(this.sel)].filter(Boolean) : []));
 if (had) [...this.inspForm.querySelectorAll('input, select')].find((x) => x.getAttribute('aria-label') === had)?.focus();
 }
 const rows = this.inspectRows();
 const key = rows ? JSON.stringify(rows) : this.cur ? 'none' : 'noprog';
 if (!force && key === this.inspectKey) return;
 this.inspectKey = key;
 if (!rows) { this.inspTable.replaceChildren(el('p', { text: this.cur ? B.pickPart : B.noProgram })); return; }
 this.inspTable.replaceChildren(el('table', {}, el('tbody', {}, ...rows.map(([k, v]) => (k ? el('tr', {}, el('th', { scope: 'row', text: k }), el('td', { text: v }))
 : el('tr', {}, el('td', { colspan: '2', text: v })))))));
 }
 buildPinsTable() {
 this.rows = [];
 const body = el('tbody');
 for (const p of PICO2_PINS) {
 const sw = el('span.bv-swatch', { 'aria-hidden': 'true' });
 const stateT = el('span');
 const fn = el('td');
 const btn = el('button', { type: 'button', text: B.inspect, 'aria-label': `${B.inspect} ${p.name} (${B.colPin.toLowerCase()} ${p.pin})`, onclick: () => this.select(`pin:${p.pin}`) });
 body.append(el('tr', {}, el('td.bv-mono', { text: String(p.pin) }), el('th.bv-mono', { scope: 'row', text: p.name }), el('td', {}, sw, stateT), fn, el('td', {}, btn)));
 this.rows.push({ p, sw, stateT, fn, key: '' });
 }
 this.boxes.pins.replaceChildren(el('table', {}, el('caption', { text: B.pinsCaption }),
 el('thead', {}, el('tr', {}, ...[B.colPin, B.colName, B.colState, B.colFunction, ''].map((t) => el('th', { scope: 'col', text: t })))), body));
 }
 updatePinsTable() {
 const pins = this.cur?.pins;
 for (const r of this.rows) {
 const g = r.p.gpio;
 const lk = pins && g >= 0 ? pinLook(pins.state[g], pins.busy?.[g] ?? 0, this.extOf(pins, g)) : null;
 const key = lk ? `${lk.look}${lk.settled}${pins.fn?.[g]}` : g >= 0 ? '-' : 'p';
 if (key === r.key) continue;
 r.key = key;
 r.sw.className = lk ? `bv-swatch bv-${lk.look}` : 'bv-swatch';
 r.sw.hidden = !lk;
 r.stateT.textContent = lk ? `${lk.settled} · ${B.looks[lk.look]}${lk.pull ? ` (${B.pulls[lk.pull]})` : ''}` : g >= 0 ? '—' : B.power.split(';')[0];
 r.fn.textContent = lk ? fnName(pins.fn?.[g]) : '';
 }
 }
}
export function boardInstance(v, ctx) {
 v.ctx = ctx; v.cui.ctx = ctx;
 return {
 root: v.root, title: B.title, infoTitle: B.infoTitle, status: v.status, headerTools: v.ed.toggle,
 diagrams: [v.svg],
 tabs: [[B.tabInspect, v.boxes.inspect], [B.tabCircuit, v.boxes.circuit], [B.tabPins, v.boxes.pins], [B.tabHelp, v.boxes.help]],
 load: () => {}, step: () => STOP.ERROR, back: () => false, state: () => null,
 render: () => v.render(),
 live: (st) => v.live(st),
 };
}
