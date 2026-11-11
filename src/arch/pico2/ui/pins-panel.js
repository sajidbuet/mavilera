// pico2/ui/pins-panel.js -- the Pins panel (contract v8 Descriptor.panels; P1-M4, research D36 Q3, Q9): a tab of the shared
// memory pane with all 30 GPIOs of the Pico 2's RP2350A (GP0 … GP29). Each pin shows its level as a lamp and as text, what
// drives it (the chip: an output, or its pad's pull, or the outside), and the function its IO_BANK0 register selects; each can
// be driven from the outside: high, low, or released to the pad's pull (Engine.input {kind: 'pin', pin, level 1 | 0 | -1}).
// GP25 is marked as the Pico 2's LED. During a real-time run the shell gives the live pin state about 30 times a second
// (PanelInstance.live, contract v10 draft); after every step the panel reads it from the state's `pins`. Every value is also
// text, never colour alone. The simulator's own layout (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { PICO2_STRINGS } from '../strings.js';

const P = PICO2_STRINGS.pins;
export const PIN_COUNT = 30; // GP0-GP29 on the RP2350A of the Pico 2 (RP-002)
export const LED_PIN = 25;
const FUNCTIONS = { 0: 'HSTX', 1: 'SPI', 2: 'UART', 3: 'I2C', 4: 'PWM', 5: 'SIO', 6: 'PIO0', 7: 'PIO1', 8: 'PIO2', 9: 'CLK', 10: 'USB', 11: 'UART', 31: '' }; // F31 (NULL): no function, nothing shown

export class PinsPanel {
  /** @param {import('../../contract.js').PanelContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.status = el('p.note.pp-status', { text: P.noProgram });
    this.cells = Array.from({ length: PIN_COUNT }, (_, n) => {
      const lamp = el('span.sp-lamp', { 'aria-hidden': 'true' });
      const value = el('span.pp-value.mono');
      const fn = el('span.pp-fn');
      const drive = el('select.pp-drive', { 'aria-label': P.driveLabel(n), title: P.driveTitle,
        onchange: (e) => this.drive(n, Number(e.target.value)) },
        el('option', { value: '-1', text: P.release }), el('option', { value: '1', text: P.high }), el('option', { value: '0', text: P.low }));
      const name = el('span.pp-name.mono', { text: `GP${n}` });
      const root = el(`div.pp-pin${n === LED_PIN ? '.pp-led' : ''}`, { role: 'group', 'aria-label': `GP${n}${n === LED_PIN ? ` (${P.led})` : ''}` },
        lamp, name, n === LED_PIN ? el('span.pp-tag', { text: P.led, title: P.ledTitle }) : null, value, fn, drive);
      return { root, lamp, name, value, fn, drive, last: '' };
    });
    // the run's inputs (D36 Q5): how many, Replay from the start, Forget (the shell's PanelContext.command, contract v10 draft)
    this.count = el('span.pp-count');
    this.replayBtn = el('button', { type: 'button', text: P.replay, title: P.replayTitle, onclick: () => ctx.command?.('replay') });
    this.forgetBtn = el('button', { type: 'button', text: P.forget, title: P.forgetTitle, onclick: () => ctx.command?.('forget') });
    // the help behind a ? button, shown on click (author, 2026-11-10): the pins keep the room; the grid scrolls
    this.help = el('div.pp-help', { id: 'pico2-pins-help', hidden: true }, el('p.note', { text: P.intro }), this.status);
    this.helpBtn = el('button.pp-help-btn', { type: 'button', text: '?', title: P.helpTitle, 'aria-label': P.helpTitle,
      'aria-expanded': 'false', 'aria-controls': 'pico2-pins-help', onclick: () => this.toggleHelp() });
    // P1-M5 (research D39 Q4-Q5): the speaker pin and its converter, the shell's options with `panel: 'pins'` (kept, shared,
    // applied to the engine at once); the speaker pin is tagged in the grid
    const A = PICO2_STRINGS.audio;
    const opt = (id, label, title, values) => {
      const sel = el('select.pp-audio-sel', { 'aria-label': label, title, onchange: (e) => ctx.setOption?.(id, e.target.value) },
        values.map(([v, t]) => el('option', { value: v, text: t })));
      return { sel, label: el('label.pp-audio-field', { title }, el('span', { text: `${label} ` }), sel) };
    };
    this.speaker = opt('speaker', A.speaker, A.speakerTitle, [['none', A.none], ...Array.from({ length: PIN_COUNT }, (_, n) => [`gp${n}`, `GP${n}`])]);
    this.dac = opt('dac', A.converter, A.converterTitle, [['pin', A.pin], ['ideal', A.ideal]]);
    this.fallback = el('p.note.pp-fallback', { text: A.fallback, hidden: true });
    this.help.append(el('p.note', { text: A.help }));
    // P1-M7 (design Q2): the lab kit (an engine option with `panel: 'pins'`), its LCD, the analogue inputs and the environment;
    // a change is an input of the run (Engine.input {kind: 'adc' | 'env'}), given when the field is left or the slider let go
    const R = PICO2_STRINGS.parts;
    this.parts = opt('parts', R.label, R.title, [['none', R.none], ['kit', R.kit]]);
    this.lcd = el('pre.pp-lcd.mono', { role: 'group', 'aria-label': R.lcd, hidden: true });
    this.help.append(el('p.note', { text: R.wiring }), el('ul.pp-kit', {}, R.list.map(([n, t]) => el('li', { text: `${n}: ${t}` }))), el('p.note', { text: R.help }));
    const num = (label, title, min, max, step, send) => {
      const input = el('input.pp-num', { type: 'number', min: String(min), max: String(max), step: String(step), 'aria-label': label, title,
        onchange: (e) => { const v = Number(e.target.value); if (Number.isFinite(v)) send(v); } });
      return { input, label: el('label.pp-field', { title }, el('span', { text: `${label} ` }), input) };
    };
    this.volts = Array.from({ length: 4 }, (_, n) => {
      const f = num(R.volts(n), R.voltsTitle(n), 0, 3.3, 0.01, (v) => this.ctx.input({ kind: 'adc', channel: n, volts: v }));
      const slider = el('input.pp-slider', { type: 'range', min: '0', max: '3.3', step: '0.01', 'aria-label': R.volts(n), title: R.voltsTitle(n),
        onchange: (e) => this.ctx.input({ kind: 'adc', channel: n, volts: Number(e.target.value) }) });
      f.label.append(slider);
      return { ...f, slider };
    });
    this.envFields = Object.entries(R.keys).map(([k, [label, unit]]) => ({ k, ...num(`${label} (${unit})`, R.envTitle, -1000, 2000, 0.01, (v) => this.ctx.input({ kind: 'env', key: k, value: v })) }));
    // one folding section, closed at first, keeps the pins in view (the memory pane is short)
    this.envBox = el('details.pp-env', {}, el('summary', { text: R.section }),
      el('div.pp-analog', { role: 'group', 'aria-label': R.analog }, this.volts.map((v) => v.label)),
      el('div.pp-env-grid', { role: 'group', 'aria-label': R.env }, this.envFields.map((f) => f.label)));
    this.root = el('div.pico2-pins', {}, el('div.pp-inputs', {}, this.count, this.replayBtn, this.forgetBtn, this.helpBtn), this.help,
      el('div.pp-audio', { role: 'group', 'aria-label': A.heading }, this.speaker.label, this.dac.label, this.parts.label), this.fallback,
      this.lcd, this.envBox,
      // the LED's pin first, then GP0 … GP29: a first program blinks it, and the grid scrolls in a short pane (GUI
      // walkthrough, 2026-11-11: GP25 was out of sight at the end of the list)
      el('div.pp-grid', {}, [this.cells[LED_PIN], ...this.cells.filter((_, n) => n !== LED_PIN)].map((c) => c.root)));
    this.accepts = false;
    this.tagged = -1;
  }

  /** The speaker's options as the shell keeps them, the tag on its pin, and the fallback note. */
  syncAudio(status) {
    const sp = this.ctx.option?.('speaker') ?? 'none', dac = this.ctx.option?.('dac') ?? 'pin';
    if (this.speaker.sel.value !== sp) this.speaker.sel.value = sp;
    if (this.dac.sel.value !== dac) this.dac.sel.value = dac;
    const n = /^gp(\d+)$/.exec(sp) ? Number(sp.slice(2)) : -1;
    if (n !== this.tagged) {
      if (this.tagged >= 0) this.cells[this.tagged].root.querySelector('.pp-speaker')?.remove();
      if (n >= 0) this.cells[n].name.after(el('span.pp-tag.pp-speaker', { text: P.speakerTag, title: P.speakerTagTitle }));
      this.tagged = n;
    }
    this.fallback.hidden = !(status?.fallback && dac === 'ideal' && n >= 0);
  }

  toggleHelp(on = this.help.hidden) {
    this.help.hidden = !on;
    this.helpBtn.setAttribute('aria-expanded', String(on));
  }

  drive(n, level) { this.ctx.input({ kind: 'pin', pin: n, level }); }

  /** P1-M7: the lab kit's state (Engine.live's `parts`): the LCD's lines, the analogue inputs and the environment (a field being edited is left alone). */
  syncParts(p) {
    const kit = this.ctx.option?.('parts') ?? 'none';
    if (this.parts.sel.value !== kit) this.parts.sel.value = kit;
    this.lcd.hidden = !(p?.on);
    if (p?.on) { const t = p.lcd?.some((l) => l) ? p.lcd.join('\n') : PICO2_STRINGS.parts.lcdOff; if (this.lcd.textContent !== t) this.lcd.textContent = t; }
    if (!p) return;
    const active = globalThis.document?.activeElement;
    const show = (input, v) => { if (input !== active && (input.value === '' || Number(input.value) !== v)) input.value = String(+v.toFixed(3)); };
    this.volts.forEach((f, n) => { show(f.input, p.volts[n]); show(f.slider, p.volts[n]); });
    for (const f of this.envFields) show(f.input, p.env[f.k]);
  }

  /** The pins as Engine.live gives them: {level, oe, ext, fn} (arrays of 30); P1-M7: the whole live state second (its `parts`). */
  live(pins, s) {
    if (s?.parts) this.syncParts(s.parts);
    if (!pins) return;
    for (let n = 0; n < PIN_COUNT; n++) {
      const c = this.cells[n], lv = pins.level[n], oe = pins.oe[n], ext = pins.ext[n], f = pins.fn?.[n] ?? 31;
      const by = oe ? P.byChip : ext >= 0 ? P.byOutside : P.byPull;
      const key = `${lv}${oe}${ext}${f}`;
      if (key === c.last) continue;
      c.last = key;
      c.lamp.classList.toggle('on', lv === 1);
      c.value.textContent = `${lv ? P.highShort : P.lowShort} · ${by}`;
      c.fn.textContent = FUNCTIONS[f] ?? `F${f}`;
      c.fn.title = P.fnTitle;
      const want = String(ext);
      if (c.drive.value !== want) c.drive.value = want;
    }
  }

  update(state, { accepts, running }) {
    this.accepts = accepts;
    for (const c of this.cells) c.drive.disabled = !accepts;
    for (const f of [...this.volts, ...this.envFields]) { f.input.disabled = !accepts; if (f.slider) f.slider.disabled = !accepts; }
    this.syncParts(state?.parts ?? null);
    this.status.textContent = !state ? P.noProgram : running ? P.running : P.stopped;
    if (state?.pins) this.live(state.pins);
    const n = state?.inputs ?? 0;
    this.count.textContent = P.inputs(n);
    this.replayBtn.disabled = this.forgetBtn.disabled = running || !accepts || n === 0;
    this.syncAudio(state?.audio);
  }
}
