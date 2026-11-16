// pico2/ui/serial-panel.js -- the UART monitor of the Hardware tab of Pico Full (design pico2-hardware-tab.md §7, 2026-11-15;
// before, the "Serial (board)" panel of P1-F3 stage F3-3, research D58 Q8 A; design pico2-p1f3-board.md §2.6, §2.10): a real
// board's serial output over Web Serial, apart from the simulated console. Connect a port (any, or the "Pico 2 USB" shortcut
// 2E8A:0009), speed (115200 by default; 1200 never offered), line end for sending (CR by default, as the simulated console),
// Clear, Copy, Save as .txt, optional time stamps, Hex (each received byte as two hex digits as well), the counters of lines and
// bytes, and Compare with the simulator (the board's lines against the simulated console's, text only). The text is role="log";
// announcing new lines to a screen reader is off by default (a toggle), since a fast program would flood it. Logic in hw/serial.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { PICO2_STRINGS } from '../strings.js';
import { SerialMonitor, BAUD_RATES, DEFAULT_BAUD, LINE_ENDINGS, compareOutputs, hexBytes } from '../hw/serial.js';
import { icon } from '../../../ui/icons.js';
import { card } from './hardware-panel.js';

const T = PICO2_STRINGS.serial, H = PICO2_STRINGS.hw;
const MAX_LINES = 5000; // lines drawn; the monitor keeps the text to its cap for Copy and Save

export class SerialPanel {
  /** @param {object} ctx {message(text, kind), log?(text), simOutput?() -> string}  @param {{serial?: object, head?: string}} o */
  constructor(ctx, { serial = globalThis.navigator?.serial ?? null, head = null } = {}) {
    this.ctx = ctx;
    this.m = new SerialMonitor({ serial, onLine: (l) => this.line(l), onPartial: (p) => { this.partial.textContent = p; }, onState: (s) => this.state(s), onBytes: (b) => this.bytes(b) });
    // the refined monitor (2026-11-15): icon buttons; the long texts in the card's "?"
    const ib = (cls, iconName, text, title, onclick, kind = '') => el(`button.hw-btn.${cls}${kind}`, { type: 'button', title: title ?? text, onclick }, icon(iconName, { size: 16 }), el('span', { text }));
    const io = (cls, iconName, title, onclick) => el(`button.hw-ibtn.${cls}`, { type: 'button', title, 'aria-label': title, onclick }, icon(iconName, { size: 16 }));
    this.connectBtn = ib('sp-connect', 'plug', T.portShort, T.connectTitle, () => this.connect(false));
    this.picoBtn = ib('sp-connect-pico', 'usb', T.connectPico, T.connectPicoTitle, () => this.connect(true), '.hw-primary');
    this.disconnectBtn = io('sp-disconnect', 'unplug', T.disconnect, () => this.m.close());
    this.forgetBtn = io('sp-forget', 'trash', T.forget, () => this.m.forget());
    this.baud = el('select.sp-baud', { 'aria-label': T.baud, title: T.baudTitle }, BAUD_RATES.map((r) => el('option', { value: String(r), text: String(r) })));
    this.baud.value = String(DEFAULT_BAUD);
    this.ending = el('select.sp-ending', { 'aria-label': T.ending }, Object.keys(LINE_ENDINGS).map((k) => el('option', { value: k, text: T.endings[k] })));
    this.input = el('input.sp-input', { type: 'text', 'aria-label': T.sendLabel, placeholder: T.sendLabel, onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); this.send(); } } });
    this.sendBtn = io('sp-send', 'send', T.send, () => this.send());
    const toggle = (input, text, title) => el('label.hw-chip', { title: title ?? text }, input, el('span', { text }));
    this.stamps = el('input', { type: 'checkbox' });
    this.hex = el('input', { type: 'checkbox', onchange: () => { this.hexBox.hidden = !this.hex.checked; } });
    this.announce = el('input', { type: 'checkbox', onchange: () => this.log.setAttribute('aria-live', this.announce.checked ? 'polite' : 'off') });
    this.status = el('span.sp-state', { role: 'status', 'aria-live': 'polite', text: T.state.closed });
    this.lines = el('div.sp-lines.mono');
    this.partial = el('span.sp-partial.mono');
    this.empty = el('p.sp-empty', { text: T.empty });
    this.log = el('div.sp-log', { role: 'log', 'aria-label': T.output, 'aria-live': 'off', tabindex: '0' }, this.empty, this.lines, this.partial);
    this.hexBox = el('div.sp-hex.mono', { 'aria-label': T.hex, tabindex: '0', hidden: true });
    this.countsEl = el('span.sp-counts', { text: T.counts(0, 0) });
    this.compareOut = el('p.sp-compare', { role: 'status', 'aria-live': 'polite', hidden: true });
    const supported = this.m.supported;
    const H2 = PICO2_STRINGS.hw.view;
    const body = [
      el('div.hw-status.sp-status', {}, el('span.hw-dot.sp-dot', { 'aria-hidden': 'true' }), this.status),
      supported ? null : el('p.hw-fallback', { title: T.unsupported }, el('span', { text: T.unsupportedShort })),
      el('div.hw-acts.sp-acts', { role: 'group', 'aria-label': head ?? T.tab, hidden: !supported }, this.picoBtn, this.connectBtn, this.disconnectBtn, this.forgetBtn,
        el('span.hw-acts-gap'), el('label.sp-field', { title: T.baudTitle }, el('span', { text: T.baud }), this.baud), el('label.sp-field', {}, el('span', { text: T.ending }), this.ending)),
      this.log, this.hexBox,
      el('div.sp-send-row', { hidden: !supported }, this.input, this.sendBtn),
      el('div.sp-tools', {}, toggle(this.stamps, T.timeShort, T.timestamps), toggle(this.hex, T.hex, T.hexTitle), toggle(this.announce, T.readAloudShort, T.announceTitle),
        el('span.hw-acts-gap'), this.countsEl),
      el('div.hw-acts.sp-acts2', {},
        ...(ctx.simOutput ? [ib('sp-compare', 'compare', T.compareShort, T.compareTitle, () => this.compare())] : []),
        el('span.hw-acts-gap'),
        io('sp-clear', 'trash', T.clear, () => this.clear()), io('sp-copy', 'copy', T.copy, () => this.copy()), io('sp-save', 'save', T.save, () => this.save())),
      this.compareOut,
    ];
    this.root = head ? card('sp-panel', 'terminal', head, H2.monitorHelp, ...body) : el('div.sp-panel', { role: 'region', 'aria-label': T.tab }, ...body);    this.state({ state: 'closed' });
  }

  async connect(pico) {
    try {
      const port = await this.m.choose({ pico });
      await this.m.open(port, Number(this.baud.value));
    } catch (e) {
      const [what, next] = H.errors[e.code] ?? H.errors.failed;
      if (e.code !== 'denied') this.ctx.message(`${what} ${next}`, 'error');
    }
  }

  async send() {
    const text = this.input.value;
    try { await this.m.send(text, this.ending.value); this.input.value = ''; } catch (e) { const [what] = H.errors[e.code] ?? H.errors.failed; this.ctx.message(what, 'error'); }
  }

  line(l) {
    const stamp = this.stamps.checked ? `${new Date().toISOString().slice(11, 23)}  ` : '';
    this.empty.hidden = true;
    this.lines.append(el('div.sp-line', { text: stamp + l }));
    while (this.lines.childElementCount > MAX_LINES) this.lines.firstElementChild.remove();
    if (this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40) this.log.scrollTop = this.log.scrollHeight;
    this.counts();
  }

  /** Each received chunk: the hex view (kept to MAX_LINES rows) and the byte counter. */
  bytes(chunk) {
    if (this.hex.checked) {
      this.hexBox.append(el('div.sp-hexrow', { text: hexBytes(chunk) }));
      while (this.hexBox.childElementCount > MAX_LINES) this.hexBox.firstElementChild.remove();
      this.hexBox.scrollTop = this.hexBox.scrollHeight;
    }
    this.counts();
  }

  counts() { this.countsEl.textContent = T.counts(this.m.counts.lines, this.m.counts.bytes); }

  /** Compare with the simulator (design §6): text only, line by line. */
  compare() {
    const r = compareOutputs(this.m.text, this.ctx.simOutput?.() ?? '');
    this.compareOut.textContent = T.compareResult(r);
    this.compareOut.hidden = false;
    this.ctx.log?.(T.compareResult(r));
    return r;
  }

  state(s) {
    const open = s.state === 'open';
    this.status.textContent = s.state === 'open' ? T.state.open(s.ids, s.baud) : T.state[s.state] ?? '';
    this.disconnectBtn.disabled = !open && s.state !== 'waiting';
    this.sendBtn.disabled = this.input.disabled = !open;
    this.baud.disabled = open;
    this.root?.querySelector('.sp-dot')?.setAttribute('data-mode', open ? 'on' : s.state === 'waiting' ? 'wait' : 'off');
  }

  clear() { this.m.clear(); this.lines.replaceChildren(); this.hexBox.replaceChildren(); this.partial.textContent = ''; this.compareOut.hidden = true; this.empty.hidden = false; this.counts(); }
  async copy() { try { await navigator.clipboard.writeText(this.m.text); this.ctx.message(T.copied, 'ok'); } catch (e) { this.ctx.message(String(e?.message ?? e), 'error'); } }
  save() {
    const blob = new Blob([this.m.text], { type: 'text/plain' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'serial-board.txt' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  update() {}
}
