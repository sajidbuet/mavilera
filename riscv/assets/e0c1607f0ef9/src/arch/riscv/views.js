// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../contract.js';
import { STRINGS } from '../../ui/strings.js';
import { RISCV_STRINGS as RV } from './strings.js';
import { el, hex8 } from '../../ui/dom.js';
import { infoButton } from '../../ui/info-button.js';
import { labRows } from './lab-rows.js';
import { buildMemsys, defaultConfig } from '../../mem/config.js';
import { Platform } from '../../mem/platform.js';
import { withNpuSignals } from '../../mem/npu-wave.js';
const REG_IDS = Array.from({ length: 32 }, (_, i) => `x${i}`);
const PROFILE = { single: 'ch06', multi: 'ch07', pipe: 'ch08' };
const WAVE_DEFAULTS = {
 single: ['pc', 'instr', 'RegWrite', 'ALUSrc', 'MemWrite', 'ResultSel', 'PCSel', 'alu_y', 'result'],
 multi: ['state', 'pc', 'IRWrite', 'PCWrite', 'AddrSel', 'ALUSrcA', 'ALUSrcB', 'RegWrite', 'alu_y'],
 pipe: ['pc_if', 'instr_id', 'instr_ex', 'stall_if', 'flush_ex', 'fwd_sel_a', 'fwd_sel_b', 'PCSel_ex', 'alu_y_ex'],
};
const stopOf = (r) => (r === 'step' ? STOP.NONE : r);
function target(t) {
 if (t.panel === 'regs') return { panel: 'registers' };
 if (t.tab === STRINGS.memory || t.tab === RV.single.tabMemory) return { panel: 'memory' };
 return { tab: t.tab };
}
function dataAccess(id, m) {
 const c = m.evaluate();
 const s = c.signals;
 if (id === 'single') return s.MemWrite || s.ResultSel === 1 ? { address: s.alu_y >>> 0, size: 4, write: Boolean(s.MemWrite), value: (s.MemWrite ? s.rs2_val : s.rdata) >>> 0 } : null;
 if (id === 'multi') return c.state === 'MEMRD' || s.MemWrite ? { address: s.addr >>> 0, size: 4 } : null;
 return s.MemWrite_mem || s.MemRead_mem ? { address: s.exres_mem >>> 0, size: 4 } : null;
}
function exportModel(v, memsys, ctx) {
 const pl = memsys?.platform;
 if (!pl) return v.exportModel();
 const platform = new Platform({ ...pl.config, stimulus: pl.gpio.stim, rx: pl.uart?.rxStim ?? pl.config.rx });
 const fresh = buildMemsys(ctx.memConfig?.() ?? { ...defaultConfig(), devices: true }, { platform }).memsys;
 return withNpuSignals(v.exportModel(fresh), platform);
}
function datapath(id, v, ctx, { title, infoTitle, tabs, memoryTab, format = null }) {
 let program = null;
 const m = () => v.model;
 const waits = () => (m().memsys?.timed ? m().memsys.stats.waitCycles : 0);
 v.dp.setLinks(v.targets, (eid) => ctx.openPanel?.(target(v.targets[eid])), RV.elementNames[PROFILE[id]]);
 v.fsm?.setLink(() => ctx.openPanel?.(target(v.targets.cu)), (s) => STRINGS.openFor(s));
 return {
 root: v.root, title, infoTitle, status: v.status, headerTools: v.headerTools, tabs, memoryTab,
 diagrams: [v.dp.svg, ...(v.fsm ? [v.fsm.svg] : [])],
 load: (p) => {
 program = p;
 if (id === 'single') v.load(p, p?.subset ?? null); else v.load(p);
 },
 reset: () => v.reset(),
 step: () => {
 const r = stopOf(v.step());
 const npu = m().memsys?.platform?.npu;
 if (r === STOP.NONE && npu?.stopRequested) { npu.stopRequested = false; return STOP.WATCH; }
 return r;
 },
 back: () => v.back(),
 render: () => v.render(),
 state: () => {
 if (!v.loaded) return null;
 const x = m();
 const last = x.last;
 return {
 pc: x.pc, instruction: x.instrAddress ?? x.pc,
 cycle: x.cycle, retired: id === 'pipe' ? x.stats.retired : id === 'multi' ? x.retired : x.cycle - waits(),
 halted: x.halted, error: x.error, dropped: x.dropped,
 registers: Object.fromEntries(REG_IDS.map((r, i) => [r, x.x[i]])),
 changed: last?.rd ? [REG_IDS[last.rd]] : [],
 written: last && last.mem >= 0 ? { address: last.mem & ~3, size: 4 } : null,
 };
 },
 stopMessage: (stop) => {
 if (stop !== STOP.HALT) return null;
 const x = m();
 if (id === 'pipe') return RV.pipe.halted(hex8(x.haltPc ?? 0), x.cycle, x.stats.retired);
 if (id === 'multi') return RV.multi.halted(hex8(x.haltPc ?? 0), x.cycle, x.retired, x.retired ? (x.cycle / x.retired).toFixed(3) : '—');
 return RV.single.halted(hex8(x.pc), x.cycle);
 },
 counters: () => {
 const R = RV.pipe.cpiRows;
 const s = m().stats;
 return [...(id === 'pipe' ? [[R.stalls, s.loadUse], [R.redirects, s.redirects], [R.mispredicts, s.mispredicts]] : []),
 ...labRows(m().memsys?.platform)];
 },
 dataAccess: () => {
 try {
 if (!v.loaded || m().halted || m().error) return null;
 return dataAccess(id, m());
 } catch { return null; }
 },
 setMemsys: (ms) => v.setMemsys(ms),
 memoryPort: () => (v.loaded ? (m().dmem ?? m().mem) : null),
 ...(v.breakAt ? { breakAt: () => v.breakAt() } : {}),
 ...(v.stopReason ? { event: () => v.stopReason() } : {}),
 ...(v.stepInstruction ? { unit: { label: RV.multi.stepInstr, step: () => stopOf(v.stepInstruction()), back: () => v.backInstruction() } } : {}),
 exportModel: () => exportModel(v, m().memsys, ctx),
 waveform: { defaults: WAVE_DEFAULTS[id], ...(format ? { format } : {}) },
 revision: () => `${JSON.stringify(v.options ?? null)}|${v.jalr ?? ''}|${v.early ?? ''}|${program?.subset ?? ''}`,
 ...(v.applyOptions ? { options: { get: () => v.options, apply: (o) => v.applyOptions(o) } } : {}),
 };
}
export function single(v, ctx) {
 const S = RV.single;
 return datapath('single', v, ctx, { title: S.panel, infoTitle: S.info, memoryTab: S.tabMemory,
 tabs: [[S.tabCycle, v.cycleBox], [S.tabControl, v.controlBox], [S.tabTiming, v.timingBox]] });
}
export function multi(v, ctx, stateCode) {
 const M = RV.multi;
 const names = Object.fromEntries(Object.entries(stateCode).map(([n, c]) => [c, n]));
 return datapath('multi', v, ctx, { title: M.panel, infoTitle: M.info, memoryTab: STRINGS.memory,
 tabs: [[M.tabFsm, v.fsmBox], [M.tabCycle, v.cycleBox], [M.tabRegisters, v.regsBox], [M.tabStrip, v.stripBox], [M.tabTiming, v.timingBox]],
 format: (name, val) => (name === 'state' || name === 'next' ? names[val] ?? String(val) : null) });
}
export function pipe(v, ctx) {
 const P = RV.pipe;
 return datapath('pipe', v, ctx, { title: P.panel, infoTitle: P.info, memoryTab: RV.single.tabMemory,
 tabs: [[P.tabDiagram, v.diagramBox], [P.tabHazards, v.hazardsBox], [P.tabSummary, v.summaryBox], [P.tabRegisters, v.registersBox],
 [P.tabPredictor, v.predictorBox], [P.tabCpi, v.cpiBox], [P.tabSignals, v.signalsBox]] });
}
const NPU_WAVE_DEFAULTS = ['pc', 'instr', 'MemWrite', 'npu.sel_acc', 'npu.d_addr', 'npu.busy', 'npu.w_load', 'npu.run', 'npu.step'];
function withDevices(ms, ctx) {
 if (ms?.platform) return ms;
 const cfg = { ...(ctx.memConfig?.() ?? defaultConfig()), devices: true };
 return buildMemsys(cfg, { platform: new Platform() }).memsys;
}
export function npuSingle(sv, ctx) {
 sv.setMemsys(withDevices(null, ctx));
 const x = single(sv, ctx);
 sv.dp.setLinks({ npu: true }, () => ctx.command?.('view:npu'), { npu: RV.npuView.npuName });
 return { ...x, title: RV.npuView.singlePanel, setMemsys: (ms) => sv.setMemsys(withDevices(ms, ctx)), waveform: { defaults: NPU_WAVE_DEFAULTS } };
}
export function npu(sv, nv, ctx) {
 const N = RV.npuView;
 const S = RV.single;
 sv.setMemsys(withDevices(null, ctx));
 const d = datapath('single', sv, ctx, { title: N.panel, infoTitle: N.info, memoryTab: S.tabMemory,
 tabs: [[S.tabCycle, sv.cycleBox], [S.tabControl, sv.controlBox]] });
 const root = el('div.npu-main.scroll', {}, nv.root);
 const info = infoButton([N.note], N.about);
 const render = () => {
 sv.render();
 const a = d.dataAccess();
 const last = sv.loaded ? sv.model.last : null;
 nv.update({ dev: { platform: sv.model.memsys?.platform ?? null }, accessed: a ? { addr: a.address, size: a.size, write: a.write, value: a.value } : null,
 completed: last && !last.wait && last.acc ? { ...last.acc, size: 4 } : null });
 };
 const headerTools = el('span.npu-htools', {}, info, nv.flow.root);
 return {
 ...d, root, diagrams: [], render, headerTools,
 setMemsys: (ms) => sv.setMemsys(withDevices(ms, ctx)),
 waveform: { defaults: NPU_WAVE_DEFAULTS },
 };
}
export function analysis(v) {
 const none = () => STOP.NONE;
 return {
 root: v.root, title: RV.analysis.panel, infoTitle: '', tabs: [],
 load: (p) => v.load(p ?? null),
 step: none, back: () => false, state: () => null, render: () => {},
 };
}
export function compare(v, ctx) {
 v.onCsv = (name, text, n) => { ctx.download?.(name, text, 'text/csv'); ctx.message(STRINGS.mem.cmp.csvDone(n), 'ok'); };
 const none = () => STOP.NONE;
 return {
 root: v.root, title: RV.compare.panel, infoTitle: '', tabs: [],
 load: (p) => { v.memCfg = ctx.memConfig?.() ?? null; v.load(p ? p.files : null); },
 step: none, back: () => false, state: () => null, render: () => {},
 };
}
