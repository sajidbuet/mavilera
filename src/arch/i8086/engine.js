// i8086/engine.js -- the 8086 instruction-level engine on the contract (Engine, spec W-D29; roadmap 8086-B2): one step
// is one instruction with its prefixes, a REP string instruction with all its iterations (accuracy level L1: state,
// no clocks). The instruction semantics are cpu.js's, checked against SingleStepTests/8086 (tools/i8086/sst.mjs).
//
// Machine (author, 2026-11-05): 1 MiB of memory; the program in segment 1000H. Profile 'flat' (the default) starts with
// CS = DS = ES = SS = 1000H and SP = 0FFFEH, as one 64K segment; profile 'segmented' starts with CS = 1000H and DS, ES,
// SS and SP at 0, so that the program sets its segments. IP starts at the program's entry; FLAGS at F002H. The
// interrupt vector table at 00000H-003FFH starts at zero: an interrupt through a vector of 0000:0000 stops the run with a
// message instead of jumping to address 0. I/O ports read FFH; OUT to port 0E9H writes the character in AL to the
// console (the simulator's convention, not an 8086 feature). Not modelled: WAIT and LOCK (no effect), the coprocessor
// (ESC does nothing).
//
// Interrupt inputs (8086-B8; interrupts.js has the rules and sources): the NMI button and the INTR switch with its type
// come in through `input` (contract v8), logged with the step count as SAP-2's ports are, and are recognised at
// instruction boundaries; the single-step trap follows TF. Each interrupt entry is a step of its own that completes no
// instruction (its record names the instruction it comes before, with `trap`). A repeated string instruction can be
// stopped between repetitions for NMI or INTR. HLT stops the run; an NMI, or INTR with IF = 1, wakes the processor
// again, and the handler returns past the HLT.
//
// Step back keeps, for each step, the 14 registers before it, the bytes it overwrote, the output's length, the call
// list and the interrupt inputs' state, in a ring of `historyLimit` steps (at most 250,000). The simulator's own code
// (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP, OUTPUT_KEEP } from '../contract.js';
import { execute, enterInterrupt, phys, CPU_REGS } from './cpu.js';
import { initialInputs, copyInputs, applyInput, tick, arriveAll, boundaryAfter, REP_BOUNDARY, due, repStopper, take,
  loadsSegment } from './interrupts.js';
import { decode, hexH } from './isa.js';
import { CODE_SEG, CODE_BASE, memoryImage, remember } from './language.js';
import { I8086_STRINGS as S } from './strings.js';

export const REGISTER_IDS = CPU_REGS;
export const CONSOLE_PORT = 0xe9;
/**
 * The interrupt inputs' state as hidden registers (8086-B8; the panel reads EngineState.registers): NMI latched (1),
 * INTR line (1), its type, the interrupt due next (0 none, 1 NMI, 2 INTR, 3 single-step), inputs on their way, and
 * IHALT: halted by HLT, waiting for an interrupt (1).
 */
export const IRQ_REGS = Object.freeze([['NMI', 1], ['INTR', 1], ['ITYPE', 8], ['INEXT', 2], ['ICOMING', 10], ['IHALT', 1]]);
const NEXT_CODE = { nmi: 1, intr: 2, trap: 3 };
/** The hidden registers of an inputs' state (`next`: the kind due next, or null; `waiting`: halted by HLT). */
export const irqRegisters = (s, next, waiting = false) => ({ NMI: s.nmi ? 1 : 0, INTR: s.intr ? 1 : 0, ITYPE: s.type,
  INEXT: NEXT_CODE[next] ?? 0, ICOMING: s.coming.length, IHALT: waiting ? 1 : 0 });
const HISTORY_MAX = 250_000;
const MASK = 0xfffff;

const where = (cs, ip) => `${hexH(cs, 4)}:${hexH(ip, 4)}`;

/** The registers at a reset for a profile and an entry address. */
export function initialRegisters(program) {
  const r = Object.fromEntries(CPU_REGS.map((k) => [k, 0]));
  r.CS = CODE_SEG;
  r.IP = (program.entry - CODE_BASE) & 0xffff;
  r.FLAGS = 0xf002;
  if ((program.i8086?.profile ?? 'flat') === 'flat') { r.DS = r.ES = r.SS = CODE_SEG; r.SP = 0xfffe; }
  return r;
}

/** The engine for one program (contract Engine). */
export function create(program, { historyLimit = 1_000_000, runLimit = 10_000_000, inputs: seed = [] } = {}) {
  const image = memoryImage(program);
  const cap = Math.max(1, Math.min(HISTORY_MAX, historyLimit));
  const names = new Map(Object.entries(program.symbols ?? {}).map(([n, a]) => [a, n]));
  let mem, c, halted, error, retired, steps, dropped, output, outBase, counts, calls, lastRec;
  let before, undo, outLen, callsAt, irqAt, kindAt, end, size;
  let irq, log; // the interrupt inputs' state; the inputs as entered, {at (the step count then), nmi?, intr?, type?, delay?}

  /** The logged inputs of the present step count (a replay). */
  const arrive = () => { for (const x of log) if (x.at === steps) applyInput(irq, x); };
  const reset = () => {
    mem = image.slice();
    c = initialRegisters(program);
    halted = false; error = null; retired = 0; steps = 0; dropped = 0; output = ''; outBase = 0;
    counts = {}; calls = null; lastRec = null;
    before = []; undo = []; outLen = []; callsAt = []; irqAt = []; kindAt = []; end = 0; size = 0;
    irq = initialInputs();
    log = seed.map((x) => ({ ...x }));
    arrive();
  };
  reset();

  const bus = {
    read: (a) => mem[a & MASK],
    write: (a, v) => { mem[a & MASK] = v; },
    peek: (a) => mem[a & MASK],
    output: (port, v) => { if (port === CONSOLE_PORT) output += String.fromCharCode(v & 0xff); },
  };
  const pcOf = (r) => phys(r.CS, r.IP);
  const newest = () => (end - 1 + cap) % cap;

  /** The contract's step record of an execution: registers changed, memory written (by byte if one was written twice). */
  function recordOf(old, now, res) {
    const pc = pcOf(old);
    const registers = [];
    for (const id of CPU_REGS) if (old[id] !== now[id]) registers.push({ id, old: old[id], value: now[id] });
    const seen = new Set(); let twice = false;
    for (const w of res.writes) for (let k = 0; k < w.size; k++) { const a = (w.address + k) & MASK; if (seen.has(a)) twice = true; seen.add(a); }
    let memory = res.writes.map((w) => ({ ...w }));
    if (twice) {
      const firstOld = new Map(); const last = new Map();
      for (const w of res.writes) for (let k = 0; k < w.size; k++) {
        const a = (w.address + k) & MASK;
        if (!firstOld.has(a)) firstOld.set(a, (w.old >> (8 * k)) & 0xff);
        last.set(a, (w.value >> (8 * k)) & 0xff);
      }
      memory = [...last.keys()].map((a) => ({ address: a, size: 1, old: firstOld.get(a), value: last.get(a) }));
    }
    return { pc, word: remember(pc, res.d.bytes), size: res.length, nextPc: pcOf(now), registers, memory, reads: res.reads,
      ...(res.trap ? { trap: res.trap } : {}) };
  }

  const errorText = (res, old) => {
    const at = where(old.CS, old.IP);
    if (res.error === 'noHandler') return res.vector === 0 && res.d.entry?.mnem !== 'INT' ? S.engine.divideNoHandler(at) : S.engine.noHandler(res.vector, at);
    const bytes = (res.d.bytes ?? []).map((b) => hexH(b, 2)).join(' ');
    return S.engine.notRun(S.engine.status[res.error] ?? res.error, bytes, at);
  };

  /** The record of an interrupt entry: it comes before the instruction at the old CS:IP, which it names. */
  const entryRecord = (old, now, res, d, kind, type) => {
    const pc = pcOf(old);
    const registers = [];
    for (const id of CPU_REGS) if (old[id] !== now[id]) registers.push({ id, old: old[id], value: now[id] });
    return { pc, word: remember(pc, d.bytes ?? [mem[pc]]), size: d.length ?? 1, nextPc: pcOf(now), registers,
      memory: res.writes.map((w) => ({ ...w })), reads: res.reads, executed: false,
      trap: { cause: type, label: S.interrupts.label[kind](type) } };
  };

  /** A halted processor wakes for an NMI, or INTR with IF = 1 (inputs on their way arrive while it waits). */
  const wakes = () => {
    if (!halted || error) return false;
    arriveAll(irq);
    return due(irq, c.FLAGS) !== null;
  };

  const step = () => {
    if (halted && !wakes()) return null;
    halted = false;
    const old = { ...c };
    const irqOld = copyInputs(irq);
    const outStart = output.length;
    const kind = due(irq, c.FLAGS);
    let res, rec, info = null;
    if (kind) {
      const d = decode((k) => mem[(pcOf(c) + k) & MASK]);
      const type = take(irq, kind);
      res = enterInterrupt(c, bus, type, { emptyVector: true });
      if (res.error) {
        Object.assign(c, old); irq = irqOld;
        error = S.interrupts.noHandler(kind, type, where(old.CS, old.IP)); halted = true; return null;
      }
      rec = entryRecord(old, c, res, d, kind, type);
      info = { kind, type };
    } else {
      irq.boundary = null;
      res = execute(c, bus, { emptyVector: true, repStop: repStopper(irq, () => c.FLAGS) });
      if (res.error) { irq = irqOld; error = errorText(res, old); halted = true; return null; }
      tick(irq);
      irq.boundary = res.repInterrupted ? { ...REP_BOUNDARY } : boundaryAfter(old.FLAGS, res.d.entry.mnem, loadsSegment(res.d));
      rec = recordOf(old, c, res);
      if (res.repInterrupted) info = { rep: res.repInterrupted };
    }
    // history
    before[end] = Uint16Array.from(CPU_REGS, (k) => old[k]);
    const u = [];
    for (const w of res.writes) for (let k = 0; k < w.size; k++) u.push(((w.address + k) & MASK) * 256 + ((w.old >> (8 * k)) & 0xff));
    undo[end] = u.length ? u : null;
    outLen[end] = outBase + outStart;
    callsAt[end] = calls;
    irqAt[end] = irqOld;
    kindAt[end] = info;
    end = (end + 1) % cap;
    if (size < cap) size += 1; else dropped += 1;
    // the call list: CALL, INT, a divide error and an interrupt entry add a frame; RET, RETF and IRET take one
    const ret = kind ? pcOf(old) : phys(old.CS, (old.IP + res.length) & 0xffff);
    if (res.call > 0) calls = { target: pcOf(c), call: rec.pc, ret, sp: c.SP, depth: (calls?.depth ?? 0) + 1, up: calls };
    else if (res.call < 0 && calls) calls = calls.up;
    if (!info) { const m = res.d.entry.mnem; counts[m] = (counts[m] ?? 0) + 1; retired += 1; }
    steps += 1;
    // HLT: the processor waits, unless an interrupt is due at once
    const halt = Boolean(res.halt) && due(irq, c.FLAGS) === null;
    if (halt) halted = true;
    const out = output.slice(outStart); // what this step wrote to the console
    if (output.length > 2 * OUTPUT_KEEP) { const drop = output.length - OUTPUT_KEEP; output = output.slice(drop); outBase += drop; }
    lastRec = rec;
    arrive();
    return { ...rec, ...(halt ? { halt: true } : {}), ...(out ? { output: out } : {}) };
  };

  const back = () => {
    if (error) { error = null; halted = false; return true; }
    if (!size) return false;
    const i = newest();
    const u = undo[i];
    if (u) for (let k = u.length - 1; k >= 0; k--) mem[Math.floor(u[k] / 256)] = u[k] % 256;
    CPU_REGS.forEach((k, j) => { c[k] = before[i][j]; });
    if (outLen[i] >= outBase) output = output.slice(0, outLen[i] - outBase);
    else { output = ''; outBase = outLen[i]; }
    calls = callsAt[i];
    irq = copyInputs(irqAt[i]);
    if (!kindAt[i]) {
      const d = decode((k) => mem[(pcOf(c) + k) & MASK]);
      if (d.entry) counts[d.entry.mnem] -= 1;
      retired -= 1;
    }
    end = i; size -= 1;
    halted = false; steps -= 1;
    log = log.filter((y) => y.at <= steps); // the inputs entered after the step undone are withdrawn
    lastRec = null;
    return true;
  };

  /** The newest step's record, computed again from the state before it when step back has dropped it. */
  const last = () => {
    if (!size) return null;
    if (lastRec) return lastRec;
    const i = newest();
    const old = Object.fromEntries(CPU_REGS.map((k, j) => [k, before[i][j]]));
    const undone = new Map();
    for (const x of undo[i] ?? []) { const a = Math.floor(x / 256); if (!undone.has(a)) undone.set(a, x % 256); }
    const scratch = new Map();
    const read = (a) => (scratch.has(a & MASK) ? scratch.get(a & MASK) : undone.has(a & MASK) ? undone.get(a & MASK) : mem[a & MASK]);
    const sbus = { read, peek: read, write: (a, v) => scratch.set(a & MASK, v) };
    const cpu = { ...old };
    const info = kindAt[i];
    if (info?.kind) {
      const d = decode((k) => read((pcOf(old) + k) & MASK));
      const res = enterInterrupt(cpu, sbus, info.type);
      lastRec = entryRecord(old, cpu, res, d, info.kind, info.type);
      return lastRec;
    }
    let n = 0;
    const res = execute(cpu, sbus, info?.rep ? { repStop: () => (n += 1) >= info.rep } : {});
    lastRec = res.error ? null : recordOf(old, cpu, res);
    return lastRec;
  };

  const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, depth: within = null, resumed = false, watch = {} } = {}) => {
    const wr = watch.registers ?? new Set();
    const wm = watch.memory ?? new Set();
    for (let i = 0; i < chunk; i++) {
      if (halted && !wakes()) return error ? STOP.ERROR : STOP.HALT;
      if (steps >= runLimit) return STOP.BUDGET;
      const pc = pcOf(c);
      if (i > 0 || resumed) {
        if (breakpoints.has(pc)) return STOP.BREAK;
        if (pc === target && (within === null || (calls?.depth ?? 0) <= within)) return STOP.TARGET;
      }
      const rec = step();
      if (!rec) return STOP.ERROR;
      if (rec.halt) return STOP.HALT;
      if (wr.size && rec.registers.some((r) => wr.has(r.id))) return STOP.WATCH;
      if (wm.size && rec.memory.some((m) => Array.from({ length: m.size }, (_, k) => m.address + k).some((a) => wm.has(a)))) return STOP.WATCH;
    }
    return STOP.CHUNK;
  };

  const ordered = (a) => Array.from({ length: size }, (_, k) => a[(end - size + k + cap) % cap]);
  const decodeAt = () => decode((k) => mem[(pcOf(c) + k) & MASK]);

  return {
    reset, step, back, run, last,
    state: () => {
      // halted: what the inputs given since would wake it with (worked out on a copy; the step does it for real)
      let next = null; let waiting = false;
      if (!halted) next = due(irq, c.FLAGS);
      else if (!error) { const t = copyInputs(irq); arriveAll(t); next = due(t, c.FLAGS); waiting = !next; }
      return { pc: pcOf(c), registers: { ...c, ...irqRegisters(irq, next, waiting) }, halted, error, retired,
        output, outputDropped: outBase, historyDropped: dropped, steps };
    },
    peek: (address, length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = mem[(address + i) & MASK];
      return out;
    },
    callDepth: () => calls?.depth ?? 0,
    stepOverTarget: () => {
      if (halted) return null;
      const d = decodeAt();
      const m = d.entry?.mnem;
      return m === 'CALL' || m === 'INT' || m === 'INTO' ? phys(c.CS, c.IP + d.length) : null;
    },
    stepOutTarget: () => calls?.ret ?? null,
    callStack: () => {
      const out = [];
      for (let f = calls; f; f = f.up) out.push({ depth: f.depth, ...(names.has(f.target) ? { name: names.get(f.target) } : {}), target: f.target, call: f.call, ret: f.ret, sp: f.sp, args: [] });
      return out;
    },
    loopRange: () => {
      if (!size) return null;
      const pcs = Array.from({ length: Math.min(64, size) }, (_, k) => { const b = before[(end - 1 - k + cap) % cap]; return phys(b[CPU_REGS.indexOf('CS')], b[CPU_REGS.indexOf('IP')]); });
      return { from: Math.min(...pcs), to: Math.max(...pcs) };
    },
    counters: () => [[S.counterNames.instructions, retired], ...Object.keys(counts).filter((m) => counts[m] > 0).sort().map((m) => [m, counts[m]])],
    dataAccess: () => {
      if (halted) return null;
      const d = decodeAt();
      const o = d.operands?.find((x) => x.t === 'mem');
      if (!o || d.status !== 'normal' || ['LEA', 'ESC'].includes(d.entry.mnem)) return null;
      const off = o.direct ? o.disp & 0xffff : ([c.BX + c.SI, c.BX + c.DI, c.BP + c.SI, c.BP + c.DI, c.SI, c.DI, c.BP, c.BX][o.rm] + o.disp) & 0xffff;
      const seg = d.seg ? c[d.seg] : !o.direct && [2, 3, 6].includes(o.rm) ? c.SS : c.DS;
      return { address: phys(seg, off), size: o.size === 8 ? 1 : o.size === 32 ? 4 : 2 };
    },
    /** The interrupt inputs (8086-B8): {nmi: true}, {intr: true | false, type?}, with `delay` instructions; logged. */
    input: (x = {}) => {
      const e = { at: steps, ...(x.nmi ? { nmi: true } : {}), ...('intr' in x ? { intr: Boolean(x.intr) } : {}),
        ...(Number.isInteger(x.type) ? { type: x.type & 0xff } : {}), ...(x.delay ? { delay: Math.floor(x.delay) } : {}) };
      if (applyInput(irq, e)) log.push(e);
    },
    /** The inputs since the reset, for a replay: pass them to create() as `inputs`. */
    inputs: () => log.map((x) => ({ ...x })),
    /** The interrupt inputs' state for the panel: {nmi, intr, type, coming, boundary, due}. */
    interrupts: () => ({ ...copyInputs(irq), due: halted && !error ? null : due(irq, c.FLAGS), halted }),
    snapshot: () => ({ mem: mem.slice(), c: { ...c }, halted, error, retired, steps, dropped, output, outBase, counts: { ...counts }, calls,
      before: ordered(before).map((b) => b.slice()), undo: ordered(undo).map((u) => (u ? u.slice() : null)), outLen: ordered(outLen), callsAt: ordered(callsAt),
      irq: copyInputs(irq), log: log.map((x) => ({ ...x })), irqAt: ordered(irqAt).map(copyInputs), kindAt: ordered(kindAt).map((k) => (k ? { ...k } : null)) }),
    restore: (s) => {
      mem = s.mem.slice(); c = { ...s.c }; counts = { ...s.counts };
      ({ halted, error, retired, steps, dropped, output, outBase, calls } = s);
      before = s.before.map((b) => Uint16Array.from(b)); undo = s.undo.map((u) => (u ? u.slice() : null)); outLen = s.outLen.slice(); callsAt = s.callsAt.slice();
      irq = copyInputs(s.irq ?? initialInputs()); log = (s.log ?? []).map((x) => ({ ...x }));
      irqAt = (s.irqAt ?? before.map(() => initialInputs())).map(copyInputs); kindAt = (s.kindAt ?? before.map(() => null)).map((k) => (k ? { ...k } : null));
      size = before.length; end = size % cap; lastRec = null;
    },
  };
}
