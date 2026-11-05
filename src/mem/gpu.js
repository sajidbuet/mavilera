// gpu.js -- the RISC-V SIMT core of the GPU module (profile lab: two warps of four lanes) as a memory-mapped device of
// the RISC-V laboratory at 0x5000_1000 (GPU-7, decision G30; design docs/architecture/gpu-host.md). The register map is
// MAVILERA's design, labelled so (decision G3): CTRL, STATUS, ARGS, BLOCK, the counters, and windows onto the core's
// instruction and data memories. While it runs, the core issues one warp-instruction per CPU clock. The core itself is
// the GPU module's engine (src/arch/gpu/rvsimt/engine.js), unchanged; states are never mutated, an edge returns a new
// one (a copy of the core), so that back-step can keep them.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';
import { provideDevice } from './platform.js';
import { MACHINES, initialCore, issue, nextWarp, done as coreDone } from '../arch/gpu/rvsimt/engine.js';
import { decode } from '../arch/gpu/rvsimt/isa.js';
import { IMEM_WORDS, DMEM_WORDS } from '../arch/gpu/rvsimt/isa.js';

export const GPU_BASE = 0x50001000;
export const GPU_REG = Object.freeze({ CTRL: 0x000, STATUS: 0x004, ARGS: 0x008, BLOCK: 0x00c, CYCLES: 0x010, ISSUED: 0x014, ACTIVE: 0x018,
  IMEM: 0x400, DMEM: 0x800 });
export const GPU_CTRL = Object.freeze({ START: 1, CLEAR: 2 });
export const GPU_STATUS = Object.freeze({ BUSY: 1, DONE: 2, FAULT: 4 });
/** MAVILERA's fault code for a deadlock at a barrier (the core's own codes are 1 to 7). */
export const GPU_DEADLOCK = 8;
const MACHINE = MACHINES.lab;

/** A copy of a core (the arrays and the warp table), so that an edge never changes the state it starts from. */
export function cloneCore(c) {
  return { ...c, imem: c.imem.slice(), dmem: c.dmem.slice(), regs: c.regs.slice(), pc: c.pc.slice(), mask: c.mask.slice(),
    running: c.running.slice(), waiting: c.waiting.slice(), stacks: c.stacks.map((s) => s.map((e) => ({ ...e }))), arrived: c.arrived.slice() };
}

/** The issues of a launch kept for the views (the mask grid and the stack); a longer kernel keeps its first ones. */
export const ISSUE_LOG = 2000;

/** An issue as the GPU module's core model logs it (core-model.js log()): the views draw these rows. */
const logRow = (c, r) => ({ n: c.issued, cycle: c.cycles, w: r.w, pc: r.pc, word: r.word, op: decode(r.word).op ?? null,
  maskIn: r.maskIn, maskOut: r.maskOut, stack: c.stacks[r.w].map((e) => ({ ...e })), fault: r.fault });

/** The device at reset: an idle core (no warp running), memories 0, nothing done. */
export function gpuReset() {
  const core = initialCore(MACHINE);
  core.running.fill(false);
  return { core, busy: false, done: false, code: 0, args: 0, block: 0, issues: [] };
}

/** The name of the register at an offset (IMEM[i], DMEM[i]; '—' for an unused offset). */
export function gpuRegister(offset) {
  const o = offset & 0xffc;
  const named = Object.entries(GPU_REG).find(([k, v]) => v === o && k !== 'IMEM' && k !== 'DMEM');
  if (named) return named[0];
  if (o >= GPU_REG.IMEM && o < GPU_REG.IMEM + 4 * IMEM_WORDS) return `IMEM[${(o - GPU_REG.IMEM) >>> 2}]`;
  if (o >= GPU_REG.DMEM && o < GPU_REG.DMEM + 4 * DMEM_WORDS) return `DMEM[${(o - GPU_REG.DMEM) >>> 2}]`;
  return '—';
}

/** The registers of the map, for the bus and the memory viewer (the windows as one entry each). */
const REGISTERS = [
  { offset: GPU_REG.CTRL, name: 'CTRL', width: 32, access: 'wo' },
  { offset: GPU_REG.STATUS, name: 'STATUS', width: 32, access: 'ro' },
  { offset: GPU_REG.ARGS, name: 'ARGS', width: 32, access: 'rw' },
  { offset: GPU_REG.BLOCK, name: 'BLOCK', width: 32, access: 'rw' },
  { offset: GPU_REG.CYCLES, name: 'CYCLES', width: 32, access: 'ro' },
  { offset: GPU_REG.ISSUED, name: 'ISSUED', width: 32, access: 'ro' },
  { offset: GPU_REG.ACTIVE, name: 'ACTIVE', width: 32, access: 'ro' },
];

/**
 * One clock edge of the device from the state before it and the bus write of the cycle ({offset, value}, or null).
 * Busy: the write is ignored and the core issues one warp-instruction; the run ends when every warp has ended, on a
 * fault, or on a deadlock (code 8). Idle: the write is applied; START launches the kernel (after CLEAR when both).
 */
export function gpuEdge(G, req) {
  if (G.busy) {
    const core = cloneCore(G.core);
    const r = issue(core);
    if (!r) return { ...G, core, busy: false, done: true, code: coreDone(core) ? 0 : GPU_DEADLOCK };
    const issues = G.issues.length < ISSUE_LOG ? [...G.issues, logRow(core, r)] : G.issues;
    if (r.fault) return { ...G, core, issues, busy: false, done: true, code: r.fault };
    if (coreDone(core)) return { ...G, core, issues, busy: false, done: true, code: 0 };
    return { ...G, core, issues };
  }
  if (!req) return G;
  const o = req.offset & 0xffc;
  const v = req.value >>> 0;
  if (o === GPU_REG.CTRL) {
    let next = G;
    if (v & GPU_CTRL.CLEAR) next = { ...next, done: false, code: 0 };
    if (v & GPU_CTRL.START) {
      const core = initialCore(MACHINE, [...G.core.imem], [...G.core.dmem]);
      core.args = G.args; core.block = G.block;
      next = { ...next, core, busy: true, done: false, code: 0, issues: [] };
    }
    return next;
  }
  if (o === GPU_REG.ARGS) return { ...G, args: v };
  if (o === GPU_REG.BLOCK) return { ...G, block: v };
  const inImem = o >= GPU_REG.IMEM && o < GPU_REG.IMEM + 4 * IMEM_WORDS;
  const inDmem = o >= GPU_REG.DMEM && o < GPU_REG.DMEM + 4 * DMEM_WORDS;
  if (!inImem && !inDmem) return G;
  const core = { ...G.core, imem: inImem ? G.core.imem.slice() : G.core.imem, dmem: inDmem ? G.core.dmem.slice() : G.core.dmem };
  if (inImem) core.imem[(o - GPU_REG.IMEM) >>> 2] = v; else core.dmem[(o - GPU_REG.DMEM) >>> 2] = v;
  return { ...G, core };
}

/** The value of a register in a state (no side effects). */
export function gpuPeek(G, offset) {
  const o = offset & 0xffc;
  const c = G.core;
  switch (o) {
    case GPU_REG.STATUS: return ((G.busy ? GPU_STATUS.BUSY : 0) | (G.done ? GPU_STATUS.DONE : 0) | (G.code ? GPU_STATUS.FAULT : 0) | ((G.code & 0xf) << 8)) >>> 0;
    case GPU_REG.ARGS: return G.args >>> 0;
    case GPU_REG.BLOCK: return G.block >>> 0;
    case GPU_REG.CYCLES: return c.cycles >>> 0;
    case GPU_REG.ISSUED: return c.issued >>> 0;
    case GPU_REG.ACTIVE: return c.active >>> 0;
    default:
      if (o >= GPU_REG.IMEM && o < GPU_REG.IMEM + 4 * IMEM_WORDS) return c.imem[(o - GPU_REG.IMEM) >>> 2] >>> 0;
      if (o >= GPU_REG.DMEM && o < GPU_REG.DMEM + 4 * DMEM_WORDS) return c.dmem[(o - GPU_REG.DMEM) >>> 2] >>> 0;
      return 0; // CTRL and the unused offsets
  }
}

const LOG_LIMIT = 4096;
const newCounters = () => ({ accesses: 0, statusReads: 0, ignoredWrites: 0, launches: 0 });
/** Is this write one the device takes (and so a write a busy device ignores)? */
const takes = (offset) => gpuRegister(offset) !== '—' && !['STATUS', 'CYCLES', 'ISSUED', 'ACTIVE'].includes(gpuRegister(offset));

/**
 * The device. Time as the NPU's (src/mem/npu.js): S(now) is the state at the start of host cycle `now`; a store
 * executed in cycle t arrives stamped t + 1 and is applied by the edge t -> t + 1; a load executed in cycle t sees S(t).
 */
export class GpuDevice extends Device {
  constructor() {
    super({ name: 'GPU', size: 0x1000, registers: REGISTERS, widths: [4] });
    this.widthMessage = 'the GPU takes whole words';
    this.diagnostics = [];
    this.reset();
  }

  reset() {
    this.s = gpuReset();
    this.now = 0;
    this.pending = null;
    this.prev = null;
    this.since = 0;
    this.counters = newCounters();
    this.last = null;
    this.log = [];
    this.logDropped = 0;
    this.diagnostics.length = 0;
    this.stopRequested = false;
  }

  get busy() { return this.s.busy; }
  get quiescent() { return !this.s.busy && this.pending === null; }
  canRewind(t) { return t < this.now && this.quiescent && t >= this.since; }

  advance(t) {
    if (t <= this.now) {
      if (this.canRewind(t)) { this.now = t; this.prev = null; }
      return;
    }
    if (this.quiescent) { this.now = t; this.prev = null; return; }
    this.touch();
    while (this.now < t) {
      this.prev = { s: this.s, pending: this.pending };
      this.s = gpuEdge(this.s, this.pending);
      this.pending = null;
      this.now += 1;
      if (this.quiescent) {
        this.since = this.now;
        if (this.now < t) { this.now = t; this.prev = null; break; }
      }
    }
    this.emit();
  }

  tick(cycle) { this.advance(cycle); }

  /** The registers as the bus sees them between two ticks: S(now + 1) (computed, not stored). */
  get visible() { return this.quiescent ? this.s : gpuEdge(this.s, this.pending); }

  peek(offset) { return gpuPeek(this.visible, offset); }

  read(offset, size, ctx) {
    if (ctx.cycle < this.now && !this.canRewind(ctx.cycle)) throw new Error(`GPU: a read of cycle ${ctx.cycle} reached the device at cycle ${this.now}`);
    this.advance(ctx.cycle);
    this.touch();
    const name = gpuRegister(offset);
    const value = gpuPeek(this.s, offset);
    this.counters = { ...this.counters, accesses: this.counters.accesses + 1, statusReads: this.counters.statusReads + (name === 'STATUS' ? 1 : 0) };
    let diagnostic = null;
    if (this.busy && name.startsWith('DMEM')) {
      diagnostic = { cycle: ctx.cycle, code: 'dmem-busy', offset, message: `${name} read while the GPU is busy: the kernel may still change it` };
      this.diagnostics.push(diagnostic);
    }
    this.last = { kind: 'read', cycle: ctx.cycle, offset, register: name, value, ignored: false, diagnostic };
    this.record(this.last);
    this.emit();
    return value;
  }

  write(offset, size, value, ctx) {
    const t = ctx.cycle - 1;
    const replay = t === this.now - 1 && this.prev !== null && this.prev.pending === null;
    if (t > this.now || (!replay && this.canRewind(t))) this.advance(t);
    let base;
    if (t === this.now) {
      if (this.pending) throw new Error(`GPU: two bus writes in cycle ${t}`);
      base = this.s;
    } else if (replay) {
      base = this.prev.s;
    } else {
      throw new Error(`GPU: a write of cycle ${t} reached the device at cycle ${this.now}`);
    }
    this.touch();
    const name = gpuRegister(offset);
    const ignored = base.busy && takes(offset);
    const c = this.counters;
    this.counters = { ...c, accesses: c.accesses + 1, ignoredWrites: c.ignoredWrites + (ignored ? 1 : 0),
      launches: c.launches + (!ignored && name === 'CTRL' && (value & GPU_CTRL.START) ? 1 : 0) };
    this.last = { kind: 'write', cycle: t, offset, register: name, value: value >>> 0, ignored, diagnostic: null };
    this.record(this.last);
    if (!ignored) {
      const req = { offset, value: value >>> 0 };
      if (base === this.s) this.pending = req;
      else { this.prev = { s: base, pending: req }; this.s = gpuEdge(base, req); this.since = this.now; }
    }
    this.emit();
  }

  record(entry) {
    if (this.log.length < LOG_LIMIT) this.log.push(entry); else this.logDropped += 1;
  }

  nextEvent() { return null; }

  snapshot() {
    return { s: this.s, now: this.now, pending: this.pending, prev: this.prev, since: this.since, counters: this.counters,
      last: this.last, diagLen: this.diagnostics.length, stopRequested: this.stopRequested, logLen: this.log.length, logDropped: this.logDropped };
  }

  restore(st) {
    Object.assign(this, { s: st.s, now: st.now, pending: st.pending, prev: st.prev, since: st.since, counters: st.counters,
      last: st.last, stopRequested: st.stopRequested });
    this.diagnostics.length = st.diagLen;
    this.log.length = Math.min(this.log.length, st.logLen ?? 0);
    this.logDropped = st.logDropped ?? 0;
    this.emit();
  }

  /** The state for a view, as peek() sees it: the core (a copy), the flags and the last bus transaction. */
  view() {
    const s = this.visible;
    return { cycle: this.now + 1, busy: s.busy, done: s.done, code: s.code, args: s.args, block: s.block, core: cloneCore(s.core), issues: s.issues,
      bus: this.last && { ...this.last }, counters: { ...this.counters } };
  }
}

// --- the GPU's signals in the waveform panel and the VCD (scope gpu: the simulator's model of the device) -----------------

const wave = (name, width) => ({ name: `gpu.${name}`, width, kind: 'gpu', vcd: `gpu.${name}` });
/** The bus side (MAVILERA's names: sel, d_addr, d_wdata, d_rdata, start), the flags, and the coming issue of the core. */
export const GPU_WAVE_SIGNALS = Object.freeze([
  wave('sel', 1), wave('d_addr', 32), wave('d_wdata', 32), wave('d_rdata', 32), wave('start', 1),
  wave('busy', 1), wave('done', 1), wave('fault', 1), wave('code', 4),
  wave('warp', 1), wave('pc', 32), wave('mask', MACHINE.lanes), wave('cycles', 32), wave('issued', 32),
]);

/** The frame values of GPU_WAVE_SIGNALS in the cycle whose device state is G and whose bus access is `bus` (or null). */
export function gpuFrame(G, bus) {
  const c = G.core;
  const w = G.busy ? nextWarp(c) : -1;
  return {
    'gpu.sel': bus ? 1 : 0, 'gpu.d_addr': bus ? (GPU_BASE + bus.offset) >>> 0 : 0,
    'gpu.d_wdata': bus?.kind === 'write' ? bus.value >>> 0 : 0, 'gpu.d_rdata': bus?.kind === 'read' ? bus.value >>> 0 : 0,
    'gpu.start': bus?.kind === 'write' && !bus.ignored && bus.register === 'CTRL' && (bus.value & GPU_CTRL.START) ? 1 : 0,
    'gpu.busy': G.busy ? 1 : 0, 'gpu.done': G.done ? 1 : 0, 'gpu.fault': G.code ? 1 : 0, 'gpu.code': G.code & 0xf,
    'gpu.warp': w > 0 ? w : 0, 'gpu.pc': w >= 0 ? c.pc[w] >>> 0 : 0, 'gpu.mask': w >= 0 ? c.mask[w] : 0,
    'gpu.cycles': c.cycles >>> 0, 'gpu.issued': c.issued >>> 0,
  };
}

/** The GPU part of withDeviceSignals (src/mem/npu-wave.js) for a platform (null without the GPU). */
export const gpuPart = (platform) => (platform?.gpu ? { device: platform.gpu, signals: GPU_WAVE_SIGNALS, frame: gpuFrame } : null);
// the platform's gpu option takes this device (the platform imports no module's device, W-D29)
provideDevice('gpu', { create: () => new GpuDevice(), base: GPU_BASE });
