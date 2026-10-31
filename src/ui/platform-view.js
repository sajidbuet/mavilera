// platform-view.js -- the platform panel of the Peripherals tab (profile iss-priv, WS-F-111): the
// board drawing with live switches and button, the processor's privileged state, the device
// registers (read by peek: no side effect), the UART terminal, the interrupt log and the stimulus
// script. It reads the platform and the privileged state the engine gives (contract v5 Engine.platform); the pins and the UART receiver are changed through the
// callbacks, so that the page records them in the session's script and redraws. The pieces that
// take input (the board, the terminal's field) are built once and kept; the rest is replaced.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, hex8 } from './dom.js';
import { STRINGS } from './strings.js';
import { buildBoard } from './platform-figure.js';
import { latencySummary } from '../mem/platform.js';
import { UART_STATUS } from '../mem/devices.js';

const P = () => STRINGS.platform; // read when used: the architecture's strings are merged in after this module loads
const hex = (v, n = 8) => `0x${(v >>> 0).toString(16).padStart(n, '0')}`;
const range = (r) => (r ? (r.min === r.max ? String(r.min) : `${r.min} to ${r.max} (mean ${Number.isInteger(r.mean) ? r.mean : r.mean.toFixed(1)})`) : '–');

/** The text of a pin event of the script: which switch or button moved. */
export function pinText(e) {
  if (e.mask === 1 << 8) return P().pinText.btn(Boolean(e.value));
  for (let n = 0; n < 4; n++) if (e.mask === 1 << (4 + n)) return P().pinText.sw(n, Boolean(e.value));
  return P().pinText.other;
}

export class PlatformView {
  /** @param {{onPin: (mask: number, value: number) => void, onReceive: (bytes: number[]) => void, onClearScript: () => void, onSettings: (change: object) => void}} cb */
  constructor({ onPin, onReceive, onClearScript, onSettings }) {
    this.onPin = onPin;
    this.board = buildBoard({
      onSwitch: (n, up) => onPin(1 << (4 + n), up ? 1 << (4 + n) : 0),
      onButton: (down) => onPin(1 << 8, down ? 1 << 8 : 0),
    });
    this.prev = new Map(); // register -> last text, to mark what changed
    this.cpuBox = el('dl.pf-cpudl');
    this.regBox = el('div');
    this.irqBox = el('div');
    this.stimBox = el('div');
    this.termOut = el('pre.pf-term', { tabindex: 0, role: 'log', 'aria-label': P().uartOut });
    this.termStatus = el('p.note');
    this.termIn = el('input', { type: 'text', 'aria-label': P().uartIn, placeholder: P().uartPlaceholder, autocomplete: 'off', size: 12 });
    const send = () => {
      const bytes = [...new TextEncoder().encode(this.termIn.value)];
      this.termIn.value = '';
      if (bytes.length) onReceive(bytes);
    };
    this.termIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    this.uartBox = el('section.pf-sec', {}, el('h4', { text: P().uartHeading }), this.termOut, this.termStatus,
      el('div.pf-send', {}, el('label', {}, el('span', { text: `${P().uartIn}: ` }), this.termIn), el('button', { type: 'button', text: P().uartSend, onclick: send })),
      el('p.note', { text: P().uartNote }));
    this.clearBtn = el('button', { type: 'button', text: P().stimClear, onclick: onClearScript });
    // the settings of the model: the MTIME divider for every view, and the trap options of rvsim.py --priv for the profile with traps
    this.fields = {
      div: el('input', { type: 'number', min: 1, step: 1, 'aria-label': P().set.div, class: 'mem-num', onchange: (e) => onSettings({ mtimeDiv: Math.max(1, Math.floor(Number(e.target.value)) || 1) }) }),
      entry: el('input', { type: 'number', min: 0, step: 1, 'aria-label': P().set.entry, class: 'mem-num', onchange: (e) => onSettings({ trapEntry: Math.max(0, Math.floor(Number(e.target.value)) || 0) }) }),
      zero: el('input', { type: 'checkbox', 'aria-label': P().set.zero, onchange: (e) => onSettings({ mtvalZero: e.target.checked }) }),
      check: el('input', { type: 'checkbox', 'aria-label': P().set.check, onchange: (e) => onSettings({ trapCheck: e.target.checked }) }),
    };
    const row = (label, f) => el('label.pf-set', {}, el('span', { text: label }), f);
    this.privSet = el('div', {}, row(P().set.entry, this.fields.entry), row(P().set.zero, this.fields.zero), row(P().set.check, this.fields.check));
    this.setBox = el('section.pf-sec', {}, el('h4', { text: P().set.heading }), row(P().set.div, this.fields.div), this.privSet, el('p.note', { text: P().set.note }));
    this.violBox = el('div');
    this.root = el('div.platform', {},
      el('h3', { text: P().heading }), el('p.note', { text: P().intro }), this.board.svg,
      el('section.pf-sec', {}, el('h4', { text: P().cpuHeading }), this.cpuBox, this.violBox),
      el('section.pf-sec', {}, el('h4', { text: P().regHeading }), el('p.note', { text: P().regNote }), this.regBox),
      this.uartBox,
      el('section.pf-sec', {}, el('h4', { text: P().irqHeading }), this.irqBox),
      el('section.pf-sec', {}, el('h4', { text: P().stimHeading }), this.stimBox, this.clearBtn, el('p.note', { text: P().stimNote })),
      this.setBox);
  }

  /**
   * Redraw from {platform, privileged, cycle, config}: the platform to show, the privileged state as the architecture words
   * it ({rows, mode, violations}; null in the processor models, which have no traps), the current cycle and the setting.
   * Nothing here changes a device.
   */
  update(ctx) {
    const { platform: pl, privileged: pv, cycle: cyc } = ctx;
    const g = pl.gpio;
    const u = pl.uart;
    const status = u ? u.status() : 0;
    this.board.update({
      out: g.out, inp: g.inp, mtime: pl.timer.mtime(cyc), cmp: pl.timer.cmp, mtip: pl.timer.mtip(cyc), meip: pl.meip(), gpioIrq: g.irq(),
      uart: u && { busy: !u.txReady(cyc), last: u.tx.length ? u.tx[u.tx.length - 1] : 0, rxWaiting: u.rxFifo.length > 0, irq: u.irq() },
      mode: pv ? pv.mode : P().cpu.noTraps,
    });
    this.updateCpu(ctx);
    this.updateRegisters(pl);
    this.updateUart(u, status);
    this.updateIrq(pl);
    this.updateStim(g, u);
    this.updateSettings(ctx);
  }

  updateSettings({ privileged: pv, config }) {
    const set = (f, v) => { if (document.activeElement !== f) { if (f.type === 'checkbox') f.checked = Boolean(v); else f.value = String(v); } };
    set(this.fields.div, config.mtimeDiv);
    set(this.fields.entry, config.trapEntry);
    set(this.fields.zero, config.mtvalZero);
    set(this.fields.check, config.trapCheck);
    this.privSet.hidden = !pv;
  }

  updateCpu({ privileged: pv, cycle }) {
    const C = P().cpu;
    if (!pv) {
      this.cpuBox.replaceChildren(el('dt', { text: C.cycle }), el('dd', { text: String(cycle) }), el('dt', { text: C.mode }), el('dd', { text: C.noTraps }));
      this.violBox.replaceChildren();
      return;
    }
    this.cpuBox.replaceChildren(...pv.rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: String(v) })]));
    this.violBox.replaceChildren(...(pv.violations ? [el('h5', { text: P().set.violations }),
      pv.violations.length ? el('ul.pf-stim', {}, pv.violations.map((m) => el('li', { text: m }))) : el('p.note', { text: P().set.noViolations })] : []));
  }
  updateRegisters(pl) {
    const rows = [];
    const seen = new Map();
    for (const { base, device } of pl.devices()) {
      if (device === pl.window) continue;
      for (const r of device.registers) {
        const v = device.peek(r.offset, 4);
        const key = `${device.name}.${r.name}`;
        const t = hex(v ?? 0);
        seen.set(key, t);
        rows.push(el(`tr${this.prev.has(key) && this.prev.get(key) !== t ? '.mem-hit' : ''}`, {},
          el('td', { text: key }), el('td.mono', { text: hex8(base + r.offset) }), el('td', { text: P().access[r.access] }), el('td.mono', { text: t })));
      }
    }
    this.prev = seen;
    this.regBox.replaceChildren(el('table.listing.mem-table', {}, el('tbody', {},
      el('tr', {}, ['', 'Address', P().colAccess, P().colValue].map((t) => el('th', { text: t === '' ? P().colReg : t }))), ...rows)));
  }

  updateUart(u, status) {
    if (!u) { this.uartBox.hidden = true; return; }
    this.uartBox.hidden = false;
    this.termOut.textContent = String.fromCharCode(...u.tx);
    this.termStatus.textContent = P().uartStatus({ txrdy: status & UART_STATUS.TXRDY, rxvalid: status & UART_STATUS.RXVALID,
      txovr: status & UART_STATUS.TXOVR, rxovr: status & UART_STATUS.RXOVR });
  }

  updateIrq(pl) {
    const sum = latencySummary(pl.log);
    const names = Object.keys(sum);
    const C = P().irqCols;
    if (!names.length) { this.irqBox.replaceChildren(el('p.note', { text: P().irqNone })); return; }
    this.irqBox.replaceChildren(el('table.listing.mem-table', {}, el('tbody', {},
      el('tr', {}, [C.source, C.events, C.taken, C.acked, C.toHandler, C.toAck].map((t) => el('th', { text: t }))),
      ...names.map((n) => el('tr', {}, [n, sum[n].events, sum[n].taken, sum[n].acked, range(sum[n].to_handler), range(sum[n].to_ack)].map((t) => el('td', { text: String(t) }))))),
    ), el('p.note', { text: P().irqNote }));
  }

  updateStim(g, u) {
    const ev = [...g.stim.map((e) => ({ cycle: e.cycle, text: pinText(e) })), ...(u ? u.rxStim.map((e) => ({ cycle: e.cycle, text: `UART receives 0x${e.byte.toString(16).padStart(2, '0')}` })) : [])]
      .sort((a, b) => a.cycle - b.cycle);
    this.clearBtn.hidden = ev.length === 0;
    this.stimBox.replaceChildren(ev.length ? el('ul.pf-stim', {}, ev.map((e) => el('li', { text: P().stimEvent(e) }))) : el('p.note', { text: P().stimNone }));
  }
}
