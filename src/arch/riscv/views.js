// views.js -- the RISC-V processor views on the contract (v4 ViewInstance, W-D29): the single-cycle (Chapter 6),
// multicycle (Chapter 7) and pipelined (Chapter 8) views and the comparison wrapped for the shell, which reads their
// headings, tabs, state, counters, stop messages, memory port, waveforms and exports from here and nothing else.
// The view classes (ui/*-view.js) are loaded by the descriptor, each with its tab (WS-N-011); this module only adapts.
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
import { withDeviceSignals, npuPart } from '../../mem/npu-wave.js';
import { gpuPart } from '../../mem/gpu.js';

const REG_IDS = Array.from({ length: 32 }, (_, i) => `x${i}`);
const PROFILE = { single: 'ch06', multi: 'ch07', pipe: 'ch08' };
// the signals a waveform shows first (WS-F-146)
const WAVE_DEFAULTS = {
  single: ['pc', 'instr', 'RegWrite', 'ALUSrc', 'MemWrite', 'ResultSel', 'PCSel', 'alu_y', 'result'],
  multi: ['state', 'pc', 'IRWrite', 'PCWrite', 'AddrSel', 'ALUSrcA', 'ALUSrcB', 'RegWrite', 'alu_y'],
  pipe: ['pc_if', 'instr_id', 'instr_ex', 'stall_if', 'flush_ex', 'fwd_sel_a', 'fwd_sel_b', 'PCSel_ex', 'alu_y_ex'],
};

/** A model's step result as a contract stop value ('step': the cycle completed). */
const stopOf = (r) => (r === 'step' ? STOP.NONE : r);

/** A drawing element's target as the contract's openPanel argument. */
function target(t) {
  if (t.panel === 'regs') return { panel: 'registers' };
  if (t.tab === STRINGS.memory || t.tab === RV.single.tabMemory) return { panel: 'memory' }; // the memory lives in the shared panel
  return { tab: t.tab };
}

/** The data access of this cycle, from the model's signals. */
function dataAccess(id, m) {
  const c = m.evaluate();
  const s = c.signals;
  if (id === 'single') return s.MemWrite || s.ResultSel === 1 ? { address: s.alu_y >>> 0, size: 4, write: Boolean(s.MemWrite), value: (s.MemWrite ? s.rs2_val : s.rdata) >>> 0 } : null;
  if (id === 'multi') return c.state === 'MEMRD' || s.MemWrite ? { address: s.addr >>> 0, size: 4 } : null;
  return s.MemWrite_mem || s.MemRead_mem ? { address: s.exres_mem >>> 0, size: 4 } : null;
}

/**
 * The view's export model (golden, VCD, waveforms). With the platform devices on, a fresh memory system of the same
 * setting and a fresh platform with the view's pin script and received bytes, so that a program that uses a device
 * replays as in the view, and the NPU's signals join the frames (NPU-3); otherwise ideal memory, as before.
 */
function exportModel(v, memsys, ctx) {
  const pl = memsys?.platform;
  if (!pl) return v.exportModel();
  const platform = new Platform({ ...pl.config, stimulus: pl.gpio.stim, rx: pl.uart?.rxStim ?? pl.config.rx });
  const fresh = buildMemsys(ctx.memConfig?.() ?? { ...defaultConfig(), devices: true }, { platform }).memsys;
  return withDeviceSignals(v.exportModel(fresh), [npuPart(platform), gpuPart(platform)].filter(Boolean)); // GPU-7: the GPU's too
}

/**
 * A datapath view as a ViewInstance. `v` is a SingleView, MultiView or PipeView; `id` its view id; `extra` the
 * view's own parts: title, infoTitle, tabs, memoryTab, and for the multicycle view the waveform's value format.
 */
function datapath(id, v, ctx, { title, infoTitle, tabs, memoryTab, format = null }) {
  let program = null;
  const m = () => v.model;
  const waits = () => (m().memsys?.timed ? m().memsys.stats.waitCycles : 0); // clock edges spent waiting for memory
  v.dp.setLinks(v.targets, (eid) => ctx.openPanel?.(target(v.targets[eid])), RV.elementNames[PROFILE[id]]);
  v.fsm?.setLink(() => ctx.openPanel?.(target(v.targets.cu)), (s) => STRINGS.openFor(s)); // multicycle: the state-output table
  return {
    root: v.root, title, infoTitle, status: v.status, headerTools: v.headerTools, tabs, memoryTab,
    diagrams: [v.dp.svg, ...(v.fsm ? [v.fsm.svg] : [])], // v7: pan and zoom (multicycle: the state diagram too)
    load: (p) => {
      program = p;
      if (id === 'single') v.load(p, p?.subset ?? null); else v.load(p);
    },
    reset: () => v.reset(),
    step: () => {
      const r = stopOf(v.step());
      const npu = m().memsys?.platform?.npu;
      if (r === STOP.NONE && npu?.stopRequested) { npu.stopRequested = false; return STOP.WATCH; } // RESULT read while busy (G5)
      return r;
    },
    back: () => v.back(),
    render: () => v.render(),
    state: () => {
      if (!v.loaded) return null;
      const x = m();
      const last = x.last;
      return {
        pc: x.pc, instruction: x.instrAddress ?? x.pc, // multicycle: the instruction the cycle works on
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
        ...labRows(m().memsys?.platform)]; // the Chapter 11 laboratory measurement (NPU-2)
    },
    dataAccess: () => {
      try {
        if (!v.loaded || m().halted || m().error) return null;
        return dataAccess(id, m());
      } catch { return null; }
    },
    setMemsys: (ms) => v.setMemsys(ms),
    memoryPort: () => (v.loaded ? (m().dmem ?? m().mem) : null), // in cache mode the port carries `store`, the RAM
    ...(v.breakAt ? { breakAt: () => v.breakAt() } : {}), // multicycle: only at a FETCH
    ...(v.stopReason ? { event: () => v.stopReason() } : {}), // pipelined: a stall, flush or misprediction (WS-F-091)
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
const GPU_WAVE_DEFAULTS = ['pc', 'instr', 'MemWrite', 'gpu.sel', 'gpu.d_addr', 'gpu.busy', 'gpu.warp', 'gpu.pc', 'gpu.mask'];

/**
 * A memory system with the platform devices for the NPU tool's views: the shell's when it has them, else one of the
 * same setting with a default platform (ViewContext.memConfig: a view that builds its own models).
 */
function withDevices(ms, ctx) {
  if (ms?.platform) return ms;
  const cfg = { ...(ctx.memConfig?.() ?? defaultConfig()), devices: true };
  return buildMemsys(cfg, { platform: new Platform() }).memsys;
}

/**
 * The NPU tool's single-cycle view (NPU-3): the single-cycle view of Chapter 6, always with the platform devices, its
 * drawing extended by the NPU on the data bus (`sv` built with npu-datapath.js), the NPU signals among the waveforms'.
 */
export function npuSingle(sv, ctx) {
  sv.setMemsys(withDevices(null, ctx));
  const x = single(sv, ctx);
  // the NPU block opens the NPU view (the shell's command `view:<id>`)
  sv.dp.setLinks({ npu: true }, () => ctx.command?.('view:npu'), { npu: RV.npuView.npuName });
  return { ...x, title: RV.npuView.singlePanel, setMemsys: (ms) => sv.setMemsys(withDevices(ms, ctx)), waveform: { defaults: NPU_WAVE_DEFAULTS } };
}

/**
 * The NPU tool's NPU view (NPU-3): the main pane shows the platform's NPU at its four levels (`nv`, src/ui/npu-view.js);
 * the single-cycle processor `sv` runs the program behind it (stepping, registers, counters, waveforms, exports as in
 * the single-cycle view), always with the platform devices.
 */
export function npu(sv, nv, ctx) {
  const N = RV.npuView;
  const S = RV.single;
  sv.setMemsys(withDevices(null, ctx));
  const d = datapath('single', sv, ctx, { title: N.panel, infoTitle: N.info, memoryTab: S.tabMemory,
    tabs: [[S.tabCycle, sv.cycleBox], [S.tabControl, sv.controlBox]] });
  const root = el('div.npu-main.scroll', {}, nv.root);
  // what drives the view, behind an information button in the heading (a hover shows it; a press opens it)
  const info = infoButton([N.note], N.about);
  const render = () => {
    sv.render();
    const a = d.dataAccess();
    // both of the cycle shown: the access its instruction makes, and the one the edge into it completed (NPU-5)
    const last = sv.loaded ? sv.model.last : null;
    nv.update({ dev: { platform: sv.model.memsys?.platform ?? null }, accessed: a ? { addr: a.address, size: a.size, write: a.write, value: a.value } : null,
      completed: last && !last.wait && last.acc ? { ...last.acc, size: 4 } : null });
  };
  // the heading: the note behind the i button, and the NPU drawings' flow speed (NPU-5)
  const headerTools = el('span.npu-htools', {}, info, nv.flow.root);
  return {
    ...d, root, diagrams: [], render, headerTools, // the hidden processor's Display menu does not apply here
    setMemsys: (ms) => sv.setMemsys(withDevices(ms, ctx)),
    waveform: { defaults: NPU_WAVE_DEFAULTS },
  };
}

/**
 * A memory system with the platform devices and the GPU for the CPU + GPU tool (GPU-7): the shell's when its platform
 * has the GPU (the tool's pages start with it, src/shell/platform-archs.js), else one of the same setting with it.
 */
function withGpu(ms, ctx) {
  if (ms?.platform?.gpu) return ms;
  const cfg = { ...(ctx.memConfig?.() ?? defaultConfig()), devices: true };
  return buildMemsys(cfg, { platform: new Platform({ ...(ms?.platform?.config ?? {}), gpu: true }) }).memsys;
}

/** The CPU + GPU tool's single-cycle view (GPU-7): the single-cycle view with the GPU on the data bus (gpu-datapath.js). */
export function gpuSingle(sv, ctx) {
  sv.setMemsys(withGpu(null, ctx));
  const x = single(sv, ctx);
  sv.dp.setLinks({ gpu: true }, () => ctx.command?.('view:gpu-host'), { gpu: RV.gpuView.gpuName });
  return { ...x, title: RV.gpuView.singlePanel, setMemsys: (ms) => sv.setMemsys(withGpu(ms, ctx)), waveform: { defaults: GPU_WAVE_DEFAULTS } };
}

/**
 * The CPU + GPU tool's GPU view (GPU-7): the main pane shows the platform's GPU (`hv`, ui/gpu-host-view.js: the GPU
 * module's core drawing driven by the device); the single-cycle processor `sv` runs the host program behind it.
 */
export function gpuHost(sv, hv, ctx) {
  const N = RV.gpuView;
  const S = RV.single;
  sv.setMemsys(withGpu(null, ctx));
  const cv = hv.cv;
  const d = datapath('single', sv, ctx, { title: N.panel, infoTitle: N.info, memoryTab: S.tabMemory,
    tabs: [[N.tabIssue, cv.issueBox], [N.tabMasks, cv.masksBox, () => cv.drawMasks()], [N.tabStack, cv.stackBox, () => cv.drawStack()],
      [N.tabInterface, hv.ifaceBox], [S.tabCycle, sv.cycleBox]] });
  const root = el('div.npu-main.scroll', {}, hv.root);
  const info = infoButton([N.note], N.about);
  const render = () => {
    sv.render();
    hv.update(sv.loaded ? sv.model.memsys?.platform ?? null : null);
  };
  return {
    ...d, root, diagrams: [cv.dp.svg], render, headerTools: el('span.npu-htools', {}, info, cv.headerTools),
    setMemsys: (ms) => sv.setMemsys(withGpu(ms, ctx)),
    waveform: { defaults: GPU_WAVE_DEFAULTS },
  };
}

/**
 * The NPU tool's Analysis view (NPU-4): Chapter 11's offload breakdown, comparison and analytical panels
 * (ui/analysis-view.js); it measures the session's assembled program itself (profile ch11), nothing to step.
 */
export function analysis(v) {
  const none = () => STOP.NONE;
  return {
    root: v.root, title: RV.analysis.panel, infoTitle: '', tabs: [],
    load: (p) => v.load(p ?? null),
    step: none, back: () => false, state: () => null, render: () => {},
  };
}

/** The comparison of the three processors (WS-F-060): it assembles the program's files for each itself. */
export function compare(v, ctx) {
  v.onCsv = (name, text, n) => { ctx.download?.(name, text, 'text/csv'); ctx.message(STRINGS.mem.cmp.csvDone(n), 'ok'); };
  const none = () => STOP.NONE;
  return {
    root: v.root, title: RV.compare.panel, infoTitle: '', tabs: [],
    load: (p) => { v.memCfg = ctx.memConfig?.() ?? null; v.load(p ? p.files : null); },
    step: none, back: () => false, state: () => null, render: () => {},
  };
}
