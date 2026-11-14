// pico2/circuit/presets.js -- the Pins panel's lab kit and speaker as parts of the circuit (P1-B2 stage B2-4; design
// docs/architecture/pico2-p1b2-user-circuits.md §16, research D54 Q1 A, Q2 A). The circuit the machine runs is the *effective*
// circuit: the circuit file (or, with no file, the demo circuit, demo.js) and
//   - with Parts = lab kit and no kit module in it: the kit preset added: the BMP280, MPU-6050, MCP9808, LCD 16×2 and 24C02 on
//     I2C0 (GP4 SDA, GP5 SCL, through the net labels SDA and SCL, each pulled up by 4.7 kΩ to 3V3 as P1-M7's kit) and the BME280
//     on SPI0 (GP16 SDO, GP17 CSB, GP18 SCK, GP19 SDI), each powered by 3V3 and ground labels, where P1-B1 drew the kit;
//   - with a speaker pin chosen: the circuit's speaker (or buzzer) part with its + wired to that pin (moved there), or, if it has
//     none, the speaker preset (a speaker below the board, its − to ground). A pin without a pad (GP23-25, GP29) changes nothing.
// An edit of the effective circuit stores it as the file, so presets the student then changes are the student's parts; a file
// equal to the effective circuit of no file is stored as no file (circuit-ui.js). Pure, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { PART_TYPES } from './library.js';
import { validateCircuit, parseEnd } from './format.js';
import { demoCircuit, FIXED } from './netlist.js';
import { PAD_POINTS } from '../ui/circuit-sheet.js';

/** Each GPIO pad's row (y) and side on the sheet: {row: {gpio: y}, side: {gpio: 'left' | 'right'}}. */
const PADS_OF = (() => {
  const row = {}, side = {};
  for (const p of PAD_POINTS) if (/^GP\d+$/.test(p.name)) { const g = Number(p.name.slice(2)); row[g] = p.y; side[g] = p.side; }
  return { row, side };
})();
const PAD_ROWS = PADS_OF.row;

const I2C_MODULES = [
  { id: 'LCD1', type: 'lcd1602', y: 25.4 }, { id: 'BMP1', type: 'bmp280', y: 139.7 }, { id: 'MPU1', type: 'mpu6050', y: 228.6 },
  { id: 'MCP1', type: 'mcp9808', y: 317.5 }, { id: 'ROM1', type: 'eeprom24c02', y: 406.4 },
];
const R_PINS_X = -368.3; // the I2C modules' SDA and SCL pins (right edge), in one column left of the board (clear of the demo button)
const MODULE_HALF = Object.freeze({ lcd1602: 177.8, default: 127 }); // a module's pins, this far either side of its centre

/** The kit preset (research D54 Q1 A): the six modules and the two pull-ups, wired as the P1-M7 kit. */
export function kitPreset() {
  const parts = [], wires = [], labels = [], nodes = [];
  for (const m of I2C_MODULES) {
    const half = MODULE_HALF[m.type] ?? MODULE_HALF.default, x = R_PINS_X - half, lx = x - half;
    parts.push({ id: m.id, type: m.type, x, y: m.y });
    labels.push({ net: 'SDA', at: `${m.id}.SDA`, x: R_PINS_X + 12.7, y: m.y - 22.7 }, { net: 'SCL', at: `${m.id}.SCL`, x: R_PINS_X + 12.7, y: m.y + 22.7 });
    labels.push({ net: '3V3', at: `${m.id}.VCC`, x: lx - 25.4, y: m.y - 25.4 }, { net: 'GND', at: `${m.id}.GND`, x: lx - 50.8, y: m.y + 25.4 });
  }
  // GP4 and GP5 to the bus nets, each with its pull-up to 3V3 above (4.7 kΩ, the value P1-M7's kit had)
  const bus = [['SDA', FIXED.sda, -127, 'J1', 'RPU1'], ['SCL', FIXED.scl, -190.5, 'J2', 'RPU2']];
  for (const [net, g, x, j, r] of bus) {
    const y = PAD_ROWS[g];
    nodes.push({ id: j, x, y });
    wires.push({ a: `GP${g}`, b: j });
    labels.push({ net, at: j, x: x - 12.7, y: y + 12.7 });
    parts.push({ id: r, type: 'resistor', value: '4k7', x, y: Math.round((y - 76.2) * 10) / 10, rot: 90 });
    wires.push({ a: `${r}.2`, b: j });
    labels.push({ net: '3V3', at: `${r}.1`, x, y: Math.round((y - 76.2 - 63.5 - 12.7) * 10) / 10 });
  }
  // the BME280 right of the board, its four SPI pins on the rows of GP16-GP19
  const by = PAD_ROWS[16] - 50.8;
  parts.push({ id: 'BME1', type: 'bme280', x: 571.5, y: Math.round(by * 10) / 10 });
  for (const [pin, g] of [['SDO', 16], ['CSB', 17], ['SCK', 18], ['SDI', 19]]) wires.push({ a: `BME1.${pin}`, b: `GP${g}` });
  labels.push({ net: '3V3', at: 'BME1.VCC', x: 723.9, y: Math.round((by - 25.4) * 10) / 10 }, { net: 'GND', at: 'BME1.GND', x: 749.3, y: Math.round((by + 25.4) * 10) / 10 });
  return { parts, wires, labels, nodes };
}

const SPEAKER_AT = Object.freeze({ x: 105, y: 685.8, colLeft: -95.3, colRight: 304.8 });
/** The wire from pad GP`g` to the speaker's + pin at (px, py): out of the pad to its side's column, down, across. */
function speakerWire(g, plus, px, py) {
  const row = PAD_ROWS[g];
  const col = PADS_OF.side[g] === 'left' ? SPEAKER_AT.colLeft : SPEAKER_AT.colRight;
  return { a: `GP${g}`, b: plus, via: [[col, row], [col, py]] };
}
/** The speaker preset (research D54 Q2 A) on pad GP`g`: a speaker below the board, its − to ground. */
export function speakerPreset(g) {
  const id = 'SPK1', x = SPEAKER_AT.x, y = SPEAKER_AT.y;
  return { parts: [{ id, type: 'speaker', x, y }], wires: [speakerWire(g, `${id}.+`, x - 63.5, y - 12.7)],
    labels: [{ net: 'GND', at: `${id}.-`, x: x - 88.9, y: y + 25.4 }], nodes: [] };
}

/**
 * Add `extra` ({parts, wires, labels, nodes}) to circuit `c` (not changed): a name already used gets the next free one of its
 * kind (R3, J4, …), and the wires and labels follow. Returns a new object (not validated).
 */
export function mergeInto(c, extra) {
  const out = JSON.parse(JSON.stringify(c));
  const used = new Set([...out.parts.map((p) => p.id), ...out.nodes.map((n) => n.id)]);
  const name = new Map();
  const free = (id) => { if (!used.has(id)) return id; const pre = id.replace(/\d+$/, ''); for (let i = 1; ; i++) if (!used.has(`${pre}${i}`)) return `${pre}${i}`; };
  for (const p of extra.parts) { const id = free(p.id); used.add(id); name.set(p.id, id); out.parts.push({ ...p, id }); }
  for (const n of extra.nodes) { const id = free(n.id); used.add(id); name.set(n.id, id); out.nodes.push({ ...n, id }); }
  const ren = (end) => { const e = parseEnd(end); if (e?.kind === 'pin') return `${name.get(e.part) ?? e.part}.${e.pin}`; if (e?.kind === 'node') return name.get(e.id) ?? e.id; return end; };
  for (const w of extra.wires) out.wires.push({ ...w, a: ren(w.a), b: ren(w.b) });
  for (const l of extra.labels) out.labels.push({ ...l, at: ren(l.at) });
  return out;
}

/** The pad of a speaker option value ('none', 'gp14', …): its GPIO, or −1 (none, or a GPIO with no pad on the board's edge). */
export const speakerPad = (opt) => { const k = /^gp(\d+)$/.exec(String(opt ?? '')); const g = k ? Number(k[1]) : -1; return g >= 0 && PAD_ROWS[g] !== undefined ? g : -1; };

/**
 * The effective circuit (validated): `file` (a validated circuit, or null: the demo) with the kit preset when `kit` and it has
 * no kit module, and the sounding part on pad `speaker` (≥ 0) when chosen.
 */
export function effectiveCircuit(file, { kit = false, speaker = -1 } = {}) {
  let c = file ? JSON.parse(JSON.stringify(file)) : demoCircuit();
  if (kit && !c.parts.some((p) => PART_TYPES[p.type]?.module)) c = mergeInto(c, kitPreset());
  if (speaker >= 0) {
    const sp = c.parts.find((p) => PART_TYPES[p.type]?.sounds);
    if (sp) {
      const plus = `${sp.id}.+`;
      const at = c.wires.find((w) => w.a === plus || w.b === plus);
      if (!(at && (at.a === `GP${speaker}` || at.b === `GP${speaker}`))) {
        c.wires = c.wires.filter((w) => w.a !== plus && w.b !== plus);
        c.labels = c.labels.filter((l) => l.at !== plus);
        const [dx, dy] = (PART_PINS_SPEAKER[sp.type] ?? PART_PINS_SPEAKER.speaker)['+'];
        c.wires.push(speakerWire(speaker, plus, sp.x + dx, sp.y + dy)); // (an unturned part's pin; the path is redrawn as needed)
      }
    } else c = mergeInto(c, speakerPreset(speaker));
  }
  return validateCircuit(c);
}
const PART_PINS_SPEAKER = Object.freeze({ speaker: { '+': [-63.5, -12.7] }, buzzer: { '+': [-63.5, 0] } });
