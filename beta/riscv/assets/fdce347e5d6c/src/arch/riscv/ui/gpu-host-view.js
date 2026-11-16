// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el, hex8 } from '../../../ui/dom.js';
import { CoreView } from '../../gpu/rvsimt/ui/core-view.js';
import { preview } from '../../gpu/rvsimt/core-model.js';
import { registersOf } from '../../gpu/rvsimt/engine.js';
import { FAULT_NAMES } from '../../gpu/rvsimt/strings.js';
import { GPU_BASE, GPU_REG, GPU_DEADLOCK, gpuReset } from '../../../mem/gpu.js';
import { RISCV_STRINGS as RV } from '../strings.js';
const BUS_SHOWN = 16;
const hex4 = (v) => `0x${v.toString(16).padStart(3, '0')}`;
export async function loadCoreContent(base) {
 const r = await fetch(new URL('content/geometry/ch11a-gpu.json', base));
 if (!r.ok) throw new Error(`content/geometry/ch11a-gpu.json: ${r.status}`);
 return { geom: await r.json(), templates: [] };
}
function modelOf(G) {
 const c = G.core;
 return {
 c, issues: G.issues ?? [], journal: [],
 get cycle() { return c.cycles; },
 get fault() { return G.code && G.code !== GPU_DEADLOCK ? G.code : 0; },
 get halted() { return !G.busy; },
 get error() { return G.code === GPU_DEADLOCK ? RV.gpuView.deadlock : null; },
 evaluate: () => ({ issue: G.busy ? preview(c) : null }),
 registers: () => registersOf(c),
 };
}
export class GpuHostView {
 constructor(content) {
 this.cv = new CoreView(content, 4);
 this.ifaceBox = el('div.scroll.gpu-iface');
 this.root = this.cv.root;
 this.G = gpuReset();
 this.device = null;
 this.update(null);
 }
 update(platform) {
 const dev = platform?.gpu ?? null;
 this.device = dev;
 const G = dev ? dev.visible : gpuReset();
 this.G = G;
 const cv = this.cv;
 cv.program = null;
 cv.model = modelOf(G);
 cv.render();
 const X = RV.gpuView;
 const c = G.core;
 cv.line.textContent = G.busy ? cv.line.textContent
 : G.code === GPU_DEADLOCK ? X.deadlock
 : G.code ? X.faulted(G.code, FAULT_NAMES[G.code])
 : G.done ? X.ended(c.cycles, c.issued) : X.idle;
 if (!G.busy) cv.status.textContent = G.done ? `${c.cycles} cycles` : '';
 else cv.status.textContent = X.running(c.cycles);
 this.drawInterface(dev, G);
 }
 drawInterface(dev, G) {
 const X = RV.gpuView;
 const M = X.regMeaning;
 const peek = (o) => (dev ? dev.peek(o) : 0);
 const st = peek(GPU_REG.STATUS);
 const rows = [
 [GPU_REG.CTRL, 'CTRL', '—', M.CTRL],
 [GPU_REG.STATUS, 'STATUS', hex8(st), M.STATUS(st & 1, (st >>> 1) & 1, (st >>> 2) & 1, (st >>> 8) & 15)],
 ...['ARGS', 'BLOCK', 'CYCLES', 'ISSUED', 'ACTIVE'].map((n) => [GPU_REG[n], n, hex8(peek(GPU_REG[n])), M[n]]),
 [GPU_REG.IMEM, 'IMEM[0..63]', '', M.IMEM],
 [GPU_REG.DMEM, 'DMEM[0..255]', '', M.DMEM],
 ];
 const regs = el('table.listing.mem-table', {}, el('caption', { text: X.regsCaption }),
 el('thead', {}, el('tr', {}, X.regCols.map((t) => el('th', { scope: 'col', text: t })))),
 el('tbody', {}, rows.map(([o, n, v, m]) => el('tr', {}, el('td.mono', { text: hex4(o) }), el('th', { scope: 'row', text: n }),
 el('td.mono', { text: v }), el('td', { text: m })))));
 const log = dev?.log ?? [];
 const shown = log.slice(-BUS_SHOWN);
 const bus = log.length
 ? el('table.listing.mem-table', {}, el('caption', { text: X.busCaption }),
 el('thead', {}, el('tr', {}, X.busCols.map((t) => el('th', { scope: 'col', text: t })))),
 el('tbody', {}, shown.map((b) => el('tr', {}, el('td.mono', { text: String(b.cycle) }), el('td', { text: X.busKinds[b.kind] }),
 el('td.mono', { text: b.register }), el('td.mono', { text: hex8(b.value) }),
 el('td', { text: b.ignored ? X.busIgnored : b.diagnostic?.message ?? '' })))))
 : el('p.note', { text: X.busNone });
 this.ifaceBox.replaceChildren(el('p.note', { text: `GPU at ${hex8(GPU_BASE)}` }), regs,
 log.length > BUS_SHOWN ? el('p.note', { text: X.busMore(log.length - BUS_SHOWN) }) : null, bus);
 }
}
