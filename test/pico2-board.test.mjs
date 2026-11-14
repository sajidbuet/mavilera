// The Board view of pico2 (P1-B1; design docs/architecture/pico2-p1b1-board-view.md §4, research D47, D48): the drawing's
// pinout and outline against a table typed from the Pico 2 datasheet (RP-002, Release 5: §1 Figure 2 pin allocation, §3 Figure 3
// dimensions, §3.1 Figure 4 numbering and internal GPIO use); the pin colours of every template against the GPIO model, read
// independently; the LED and the speaker; a drawn button's inputs against the Pins panel's, with replay; the colours' contrast
// in every theme; the engine's live additions and the page's merge of change counts.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/pico2/index.js';
import { STOP, validateDescriptor, CONTRACT_VERSION } from '../src/arch/contract.js';
import { PICO2_PINS, INTERNAL_GPIO, pinLook, ledState, speakerState, speakerGpio, buttonInput, knobInput, knobVolts, busyFromLog, mergeBusy, BOARD_PALETTE, contrast, STATE } from '../src/arch/pico2/ui/board-model.js';
import { BOARD, PADS, SWD, MM } from '../src/arch/pico2/ui/board-geometry.js';
import { PinsPanel } from '../src/arch/pico2/ui/pins-panel.js';

// RP-002 §1 Figure 2 (pin allocation), typed here independently of the source: physical pin -> name
const RP002 = {
  1: 'GP0', 2: 'GP1', 3: 'GND', 4: 'GP2', 5: 'GP3', 6: 'GP4', 7: 'GP5', 8: 'GND', 9: 'GP6', 10: 'GP7', 11: 'GP8', 12: 'GP9', 13: 'GND', 14: 'GP10',
  15: 'GP11', 16: 'GP12', 17: 'GP13', 18: 'GND', 19: 'GP14', 20: 'GP15', 21: 'GP16', 22: 'GP17', 23: 'GND', 24: 'GP18', 25: 'GP19', 26: 'GP20',
  27: 'GP21', 28: 'GND', 29: 'GP22', 30: 'RUN', 31: 'GP26', 32: 'GP27', 33: 'AGND', 34: 'GP28', 35: 'ADC_VREF', 36: '3V3(OUT)', 37: '3V3_EN',
  38: 'GND', 39: 'VSYS', 40: 'VBUS',
};

test('pico2 board: the 40 pins have the names and places of RP-002 (§1 Figure 2, §3.1 Figure 4)', () => {
  assert.equal(PICO2_PINS.length, 40);
  for (const p of PICO2_PINS) assert.equal(p.name, RP002[p.pin], `pin ${p.pin}`);
  // §3.1: the non-GPIO pins the datasheet lists by number
  for (const [n, name] of [[40, 'VBUS'], [39, 'VSYS'], [37, '3V3_EN'], [36, '3V3(OUT)'], [35, 'ADC_VREF'], [33, 'AGND'], [30, 'RUN']]) assert.equal(PICO2_PINS[n - 1].name, name);
  // 26 GPIOs on the edge (§1: "Exposes 26 multi-function 3.3 V General Purpose I/O"); GP23, 24, 25, 29 used on the board (§3.1)
  const edge = PICO2_PINS.filter((p) => p.gpio >= 0).map((p) => p.gpio);
  assert.equal(edge.length, 26);
  assert.equal(new Set(edge).size, 26);
  for (const g of [23, 24, 25, 29]) { assert.ok(!edge.includes(g), `GP${g}`); assert.ok(INTERNAL_GPIO[g], `GP${g}`); }
  // places: 1-20 down the left edge, 21-40 up the right edge, 2.54 mm apart, rows 17.78 mm apart; pin 1 beside pin 40, 20 beside 21
  for (const p of PADS) {
    if (p.pin <= 20) { assert.equal(p.side, 'left'); assert.ok(Math.abs(p.y - PADS[0].y - (p.pin - 1) * 2.54 * MM) < 1e-9); }
    else { assert.equal(p.side, 'right'); assert.ok(Math.abs(p.y - PADS[0].y - (40 - p.pin) * 2.54 * MM) < 1e-9); }
    assert.ok(Math.abs(Math.abs(p.x - PADS[0].x) - (p.side === 'left' ? 0 : 17.78 * MM)) < 1e-9);
  }
  assert.equal(PADS[0].y, PADS[39].y);
  assert.equal(PADS[19].y, PADS[20].y);
  assert.ok(Math.abs(PADS[19].y - PADS[0].y - 48.26 * MM) < 1e-9); // §3 Figure 3: 48.26 mm
  // §3 Figure 3: 21 × 51 mm; the rows centred across the board
  assert.equal(BOARD.w, 21 * MM); assert.equal(BOARD.h, 51 * MM);
  assert.ok(Math.abs(PADS[0].x - (BOARD.w - PADS[39].x)) < 1e-9);
  assert.ok(BOARD.usb.y < 0, 'the USB connector overhangs the top edge');
  assert.deepEqual(SWD.map((d) => d.name), ['SWCLK', 'GND', 'SWDIO']); // §1 Figure 2, left to right
});

const pick = ({ look, letter, pull, outside }) => ({ look, letter, pull, outside });
test('pico2 board: pinLook, the LED and the speaker follow the rules of D47/D48', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map((st) => pinLook(st).look), ['low', 'high', 'z', 'z', 'z']);
  assert.deepEqual([0, 1, 2, 3, 4].map((st) => pinLook(st).letter), ['L', 'H', 'Z', 'Z↑', 'Z↓']);
  assert.deepEqual([3, 4, 2].map((st) => pinLook(st).pull), ['up', 'down', null]);
  for (const st of [0, 1, 2, 3, 4]) { assert.equal(pinLook(st, 1).look, pinLook(st).look); assert.equal(pinLook(st, 2).look, 'busy'); }
  assert.equal(pinLook(STATE.PU, 2).pull, 'up');
  // a pin the chip does not drive shows a drive from outside (a held button: GP15 blue L, its pull-up kept); the chip's own drive wins
  assert.deepEqual(pick(pinLook(STATE.PU, 0, 0)), { look: 'low', letter: 'L', pull: 'up', outside: true });
  assert.deepEqual(pick(pinLook(STATE.Z, 0, 1)), { look: 'high', letter: 'H', pull: null, outside: true });
  assert.deepEqual(pick(pinLook(STATE.HIGH, 0, 0)), { look: 'high', letter: 'H', pull: null, outside: false });
  assert.deepEqual(pick(pinLook(STATE.PD, 0, -1)), { look: 'z', letter: 'Z↓', pull: 'down', outside: false });
  assert.equal(pinLook(STATE.PU, 2, 0).look, 'busy');
  assert.deepEqual([ledState(1), ledState(0), ledState(3), ledState(2), ledState(1, 2), ledState(0, 2)], ['on', 'off', 'off', 'off', 'half', 'half']);
  assert.deepEqual([speakerState(0), speakerState(1), speakerState(2)], ['quiet', 'quiet', 'sounding']);
  assert.deepEqual([speakerGpio('gp14'), speakerGpio('none'), speakerGpio(null)], [14, -1, -1]);
});

test('pico2 board: every state colour has at least 3:1 contrast against the sheet in every theme (WCAG 1.4.11)', () => {
  assert.deepEqual(Object.keys(BOARD_PALETTE).sort(), ['black', 'dark', 'dim', 'hc-dark', 'hc-light', 'light', 'sepia']);
  for (const [theme, p] of Object.entries(BOARD_PALETTE)) for (const k of ['high', 'low', 'z', 'busy']) {
    assert.ok(contrast(p[k], p.sheet) >= 3, `${theme} ${k}: ${contrast(p[k], p.sheet).toFixed(2)}`);
  }
  // the sheet is the theme's panel surface (src/ui/theme.css --surface), on which the drawing pane is shown
  const css = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8');
  for (const v of ['#ffffff', '#101a2b', '#262d37', '#000000', '#faf4e8']) assert.ok(css.includes(`--surface: ${v};`), `--surface: ${v}`);
});

// --- the templates ---------------------------------------------------------------------------------------------------------
const dir = new URL('../content/pico2/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const cc = await descriptor.language.extraLanguages.find((x) => x.id === 'c').load();
function build(t) {
  const text = readFileSync(new URL(t.file, dir), 'utf8');
  const companions = t.companion ? [{ name: t.companion, text: readFileSync(new URL(t.companion, dir), 'utf8') }] : [];
  let files = [{ name: t.file, text }, ...companions];
  if (t.lang === 'c') {
    const r = cc.compile(text, { name: t.file, profile: 'hazard3', companions });
    assert.ok(r.ok, t.file);
    files = [{ name: t.file.replace(/\.c$/, '.s'), text: r.text }];
  }
  const p = descriptor.language.assemble(files, { profile: 'hazard3' });
  assert.ok(p.ok, t.file);
  return p;
}
/** A pin's state code read from the GPIO model's pad registers, independently of Pins.state: as soc/gpio.js documents it. */
function stateFromPads(m, n) {
  if (m.pins.padOe[n]) return m.pins.padOut[n];
  const pad = m.pins.pad[n];
  return pad & 0x4 ? 4 : pad & 0x8 ? 3 : 2; // PDE, PUE (RP-001 §9)
}

test('pico2 board: the pin colours of every template follow the GPIO model at 50 points; every look occurs', () => {
  const seen = new Set();
  const led = new Set(), spk = new Set();
  for (const t of index.templates) {
    const p = build(t);
    const e = descriptor.engine.create(p, { runLimit: Infinity });
    if (t.opts) e.configure(t.opts);
    const m = e.machine;
    let at = e.live({ uartFrom: Infinity }).pins.logTotal;
    const slice = Math.ceil(m.freq.sys * 0.01); // 10 ms of machine time between redraws
    for (let k = 0; k < 50; k++) {
      const r = e.advance({ cycles: slice });
      const st = e.live({ uartFrom: Infinity, pinsFrom: at });
      const log = m.pins.log, now = log.base + log.pins.length;
      const busy = busyFromLog(log, at, now);
      assert.equal(st.pins.logTotal, now, `${t.id} @${k}`);
      for (let n = 0; n < 30; n++) {
        assert.equal(st.pins.state[n], stateFromPads(m, n), `${t.id} @${k}: GP${n} state`);
        assert.equal(st.pins.busy[n], busy[n], `${t.id} @${k}: GP${n} busy`);
        const lk = pinLook(st.pins.state[n], st.pins.busy[n]);
        seen.add(lk.look); if (lk.pull) seen.add(`pull-${lk.pull}`);
      }
      led.add(ledState(st.pins.state[25], st.pins.busy[25]));
      const g = speakerGpio(t.opts?.speaker);
      if (g >= 0) spk.add(speakerState(st.pins.busy[g]));
      at = now;
      if (r.stop !== STOP.CHUNK) break;
    }
  }
  for (const look of ['high', 'low', 'z', 'busy', 'pull-up', 'pull-down']) assert.ok(seen.has(look), `look ${look} never met`);
  for (const s of ['on', 'off', 'half']) assert.ok(led.has(s), `LED ${s} never met`);
  for (const s of ['sounding', 'quiet']) assert.ok(spk.has(s), `speaker ${s} never met`);
});

test('pico2 board: the engine\'s change counts without pinsFrom are since the previous live() call', () => {
  const p = build(index.templates.find((t) => t.id === 'pwm-fade'));
  const e = descriptor.engine.create(p, { runLimit: Infinity });
  e.live();
  e.advance({ cycles: 400_000 });
  const a = e.live();
  assert.ok(a.pins.busy[25] === 2, 'GP25 busy under PWM');
  const b = e.live();
  assert.ok(b.pins.busy.every((x) => x === 0), 'nothing changed between two calls');
  assert.ok(Array.isArray(a.bus.i2c) && Array.isArray(a.bus.spi));
});

test('pico2 board: the page merges the change counts of a live state it did not draw (D48 Q12)', () => {
  assert.deepEqual([...mergeBusy(Uint8Array.from([0, 1, 1, 2, 0]), Uint8Array.from([0, 0, 1, 1, 2]))], [0, 1, 2, 2, 2]);
  assert.deepEqual(mergeBusy([1, 0], [1, 1]), [2, 1]); // plain arrays (the SAB ring's JSON)
  // the shell's own merge in src/main.js rtLive (the same rule, kept in step with mergeBusy)
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /now\[i\] = Math\.min\(2, now\[i\] \+ was\[i\]\)/);
});

test('pico2 board: a drawn button gives the Pins panel\'s inputs; the runs and their replay are equal (D47)', () => {
  // the Pins panel's own drive(n, level), with a context that only records
  const fromPanel = [];
  const panel = Object.create(PinsPanel.prototype);
  panel.ctx = { input: (x) => fromPanel.push(x) };
  panel.drive(15, 0); panel.drive(15, -1);
  assert.deepEqual([buttonInput(15, true), buttonInput(15, false)], fromPanel);
  // gpio-button.c: five presses from each, at the same cycles; equal machine states, input logs and replays
  const p = build(index.templates.find((t) => t.id === 'gpio-button'));
  const runWith = (give) => {
    const e = descriptor.engine.create(p, { runLimit: Infinity });
    const slice = Math.ceil(e.machine.freq.sys * 0.02);
    for (let k = 0; k < 5; k++) {
      e.advance({ cycles: slice }); give(e, true);
      e.advance({ cycles: slice }); give(e, false);
    }
    let r; do r = e.advance({ cycles: slice }); while (r.stop === STOP.CHUNK && e.clock().timeNs < 2e9);
    return e;
  };
  const a = runWith((e, on) => e.input(buttonInput(15, on)));
  const b = runWith((e, on) => { const pp = Object.create(PinsPanel.prototype); pp.ctx = { input: (x) => e.input(x) }; pp.drive(15, on ? 0 : -1); });
  assert.equal(a.state().halted, true, 'five presses end the program');
  assert.equal(a.state().output, b.state().output);
  assert.deepEqual(a.inputs(), b.inputs());
  assert.equal(a.stateHash(), b.stateHash());
  const replay = descriptor.engine.create(p, { inputs: a.inputs(), runLimit: Infinity });
  let r; do r = replay.run({ chunk: 1_000_000, resumed: true }); while (r === STOP.CHUNK);
  assert.equal(replay.state().output, a.state().output);
  assert.equal(replay.state().steps, a.state().steps);
});

test('pico2 board: the drawn knob gives the Pins panel\'s ADC input 0; a run with it and its replay are equal', () => {
  // the Pins panel's GP26 field and slider give {kind: 'adc', channel: n, volts} (ui/pins-panel.js), 0 to 3.3 V in 0.01 V steps
  const pins = readFileSync(new URL('../src/arch/pico2/ui/pins-panel.js', import.meta.url), 'utf8');
  assert.match(pins, /this\.ctx\.input\(\{ kind: 'adc', channel: n, volts: v \}\)/);
  assert.match(pins, /type: 'range', min: '0', max: '3\.3', step: '0\.01'/);
  assert.deepEqual(knobInput(1.65), { kind: 'adc', channel: 0, volts: 1.65 });
  assert.deepEqual([knobVolts(-1), knobVolts(4), knobVolts(1.234), knobVolts(NaN)], [0, 3.3, 1.23, 0]);
  // adc-knob.c reads GP26 ten times, 300 ms apart: turn the knob to 1.65 V, then to 3.3 V, between readings
  const p = build(index.templates.find((t) => t.id === 'adc-knob'));
  const e = descriptor.engine.create(p, { runLimit: Infinity });
  const slice = Math.ceil(e.machine.freq.sys * 0.15);
  e.advance({ cycles: slice }); e.input(knobInput(1.65));
  e.advance({ cycles: slice * 4 }); e.input(knobInput(3.3));
  let r; do r = e.advance({ cycles: slice }); while (r.stop === STOP.CHUNK && e.clock().timeNs < 5e9);
  const out = e.state().output;
  assert.match(out, /result 20[45]\d = 16\d\d mV/, out);
  assert.match(out, /result 409[0-5] = 3299 mV|result 4095 = 3299 mV|= 3300 mV/, out);
  assert.equal(e.live().parts.volts[0], 3.3);
  const replay = descriptor.engine.create(p, { inputs: e.inputs(), runLimit: Infinity });
  do r = replay.run({ chunk: 1_000_000, resumed: true }); while (r === STOP.CHUNK);
  assert.equal(replay.state().output, out);
});

test('pico2 board: the descriptor\'s Board view is a page view, last, and the contract accepts it (v11, approved D50)', () => {
  assert.ok(CONTRACT_VERSION >= 11); // v11 approved (D50); v12 (P1-B2's companions) approved and frozen with 1.6.0 (D57)
  const v = descriptor.views[descriptor.views.length - 1];
  assert.equal(v.id, 'board'); assert.equal(v.engine, 'page'); assert.equal(v.kind, 'datapath');
  assert.deepEqual(validateDescriptor(descriptor), []);
  const bad = { ...descriptor, views: [...descriptor.views.slice(0, -1), { ...v, engine: 'own' }] };
  assert.ok(validateDescriptor(bad).some((m) => /engine 'page'/.test(m)));
});
