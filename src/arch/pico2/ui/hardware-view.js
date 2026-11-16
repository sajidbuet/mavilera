// pico2/ui/hardware-view.js -- the Hardware tab of Pico Full (design docs/architecture/pico2-hardware-tab.md, 2026-11-15): a real
// Pico 2 on USB, apart from the simulator. Two columns (author's choice H3): on the left the Board, Program and Debug sections
// (ui/hardware-panel.js), on the right a large UART monitor (ui/serial-panel.js); below 900 px of pane width they stack. The
// detail tabs are Help (the short form of the topic "Load to a Pico 2") and Log (every hardware action with its time).
// A page view (contract v11 View.engine 'page'): the simulator runs as in the instruction view and this view never touches it
// (ADR-0010 point 4); it only reads the simulated console's text for Compare with the simulator. Shown only where capability
// hardware is on (contract v14 View.capability): Pico Full.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { STOP } from '../../contract.js';
import { PICO2_STRINGS } from '../strings.js';
import { HardwareSections } from './hardware-panel.js';
import { SerialPanel } from './serial-panel.js';
import { infoButton } from '../../../ui/info-button.js';

const H = PICO2_STRINGS.hw, V = H.view;
const LOG_MAX = 500;

export class HardwareView {
  /** @param {object} ctx the shell's ViewContext (message, engine) */
  constructor(ctx, { serial } = {}) {
    this.ctx = ctx;
    this.logList = el('ol.hw-log-list', { 'aria-label': V.tabLog });
    this.logEmpty = el('p.note', { text: V.logEmpty });
    const log = (text) => this.log(text);
    const message = (text, kind) => ctx.message?.(text, kind);
    this.sections = new HardwareSections({ message, log });
    this.monitor = new SerialPanel({ message, log, simOutput: () => ctx.engine?.()?.state?.()?.output ?? '' }, { serial, head: V.monitorHead });
    // the intro and the short help behind a "?" in the pane's header (2026-11-15: less text on the page)
    this.headerTools = infoButton([V.intro, ...V.helpText, V.helpMore], V.about(V.tab), { glyph: '?' });
    this.root = el('div.hw-view', { role: 'region', 'aria-label': V.title },
      el('div.hw-cols', {}, el('div.hw-left', {}, this.sections.root), el('div.hw-right', {}, this.monitor.root)));
    this.boxes = {
      help: el('div.hw-help', {}, ...V.helpText.map((t) => el('p', { text: t })), el('p.note', { text: V.helpMore })),
      log: el('div.hw-log', {}, this.logEmpty, this.logList,
        el('button.hw-log-copy', { type: 'button', text: V.logCopy, onclick: () => this.copyLog() })),
    };
  }

  log(text) {
    this.logEmpty.hidden = true;
    this.logList.append(el('li', { text: `${new Date().toISOString().slice(11, 19)}  ${text}` }));
    while (this.logList.childElementCount > LOG_MAX) this.logList.firstElementChild.remove();
  }

  async copyLog() {
    const text = [...this.logList.children].map((li) => li.textContent).join('\n');
    try { await navigator.clipboard.writeText(text); this.ctx.message?.(PICO2_STRINGS.serial.copied, 'ok'); } catch (e) { this.ctx.message?.(String(e?.message ?? e), 'error'); }
  }

  /** The toolbar's Load to Pico (design §8): the load starts inside the click; this view shows its state. */
  load() { return this.sections.load(); }
  download() { return this.sections.download(); }

  render() { this.sections.update(); }
}

/** The ViewInstance of the shell's contract (a page view: the model fields are not called). */
export function hardwareInstance(v) {
  return {
    root: v.root, title: V.title, infoTitle: V.infoTitle, headerTools: v.headerTools,
    tabs: [[V.tabHelp, v.boxes.help], [V.tabLog, v.boxes.log]],
    load: () => {}, step: () => STOP.ERROR, back: () => false, state: () => null,
    render: () => v.render(),
    hardware: v, // the shell's Load to Pico button reaches the sections through this
  };
}
