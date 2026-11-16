// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from '../../../ui/dom.js';
import { STOP } from '../../contract.js';
import { PICO2_STRINGS } from '../strings.js';
import { HardwareSections } from './hardware-panel.js';
import { SerialPanel } from './serial-panel.js';
import { infoButton } from '../../../ui/info-button.js';
import { boardReport } from '../hw/report.js';
const H = PICO2_STRINGS.hw, V = H.view;
const LOG_MAX = 500;
export class HardwareView {
 constructor(ctx, { serial } = {}) {
 this.ctx = ctx;
 this.logList = el('ol.hw-log-list', { 'aria-label': V.tabLog });
 this.logEmpty = el('p.note', { text: V.logEmpty });
 const log = (text) => this.log(text);
 const message = (text, kind) => ctx.message?.(text, kind);
 this.sections = new HardwareSections({ message, log });
 this.monitor = new SerialPanel({ message, log, simOutput: () => ctx.engine?.()?.state?.()?.output ?? '' }, { serial, head: V.monitorHead });
 this.headerTools = infoButton([V.intro, ...V.helpText, V.helpMore], V.about(V.tab), { glyph: '?' });
 this.root = el('div.hw-view', { role: 'region', 'aria-label': V.title },
 el('div.hw-cols', {}, el('div.hw-left', {}, this.sections.root), el('div.hw-right', {}, this.monitor.root)));
 this.boxes = {
 help: el('div.hw-help', {}, ...V.helpText.map((t) => el('p', { text: t })), el('p.note', { text: V.helpMore })),
 log: el('div.hw-log', {}, this.logEmpty, this.logList,
 el('div.hw-log-acts', {}, el('button.hw-log-copy', { type: 'button', text: V.logCopy, onclick: () => this.copyLog() }), ' ',
 el('button.hw-report-copy', { type: 'button', text: V.reportCopy, title: V.reportCopyTitle, onclick: () => this.copyReport() }))),
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
 async reportText() {
 const s = this.sections.s;
 let badge = null;
 try { badge = await s.badge(); } catch { }
 return boardReport({
 version: globalThis.document?.querySelector?.('meta[name="risc-vista-version"]')?.content ?? '',
 caps: s.caps, facts: s.facts ?? null, badge, state: s.state, history: s.history, log: [...this.logList.children].map((li) => li.textContent),
 });
 }
 async copyReport() {
 try { await navigator.clipboard.writeText(await this.reportText()); this.ctx.message?.(V.reportCopied, 'ok'); } catch (e) { this.ctx.message?.(String(e?.message ?? e), 'error'); }
 }
 load() { return this.sections.load(); }
 download() { return this.sections.download(); }
 render() { this.sections.update(); }
}
export function hardwareInstance(v) {
 return {
 root: v.root, title: V.title, infoTitle: V.infoTitle, headerTools: v.headerTools,
 tabs: [[V.tabHelp, v.boxes.help], [V.tabLog, v.boxes.log]],
 load: () => {}, step: () => STOP.ERROR, back: () => false, state: () => null,
 render: () => v.render(),
 hardware: v,
 };
}
