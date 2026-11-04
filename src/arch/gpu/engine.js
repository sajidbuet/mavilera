// gpu/engine.js -- the SIMT core of the Chapter 11 laboratory as an engine on the contract (Engine, spec W-D29; GPU-1 of
// docs/research/gpu-npu/roadmaps/GPU_DEVELOPMENT_ROADMAP.md; specification GPU_ARCHITECTURE.md §2). One program counter
// issues one 16-bit instruction per clock cycle to LANES lanes (4 or 8); a lane executes LDI, ADD and SUB only if its
// bit of the active mask is 1. The mask stack holds two levels per lane. Every instruction takes one cycle, even with
// no lane active; `cycles` counts the instructions of the run, HALT included, and `idle_slots` the inactive lanes
// summed over LDI, ADD and SUB (both 16-bit ports, so they wrap at 65 536). The PC wraps at sixteen words.
//
// Three layers, all without DOM:
//  - `initialState` and `execute`: the pure behaviour of one clock cycle while busy;
//  - `SimtCore`: the core at its ports (pm_we while idle, din, start, busy, done, dout, active_mask, cycles,
//    idle_slots), driven like the laboratory's testbench;
//  - `create`: the contract engine, one step per instruction from the start pulse, with step back.
//
// MAVILERA's choices where the textbook is silent (decision G7, documented in the help): a third nested IFLT, and ELSE
// or ENDIF with no IFLT to match, stop with an error (the core tracks the nesting depth for this; the depth is not a
// port); program writes and start while busy are refused with an error; the PC stays on the HALT word; the stack levels
// start all ones, like the mask; ENDIF leaves stack level 1 as it was. The simulator's own code (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP, OUTPUT_KEEP } from '../contract.js';
import { decode, sext8, programImage, PROGRAM_WORDS, MAX_LANES, MNEMONIC_OF, OPS } from './language.js';
import { GPU_STRINGS as S } from './strings.js';

export const LANE_REGISTERS = 4;
/** Register ids of a lane register (contract Registers): l<lane>r<k>. */
export const laneId = (l, k) => `l${l}r${k}`;
const popcount = (m) => { let n = 0; for (let x = m; x; x &= x - 1) n += 1; return n; };
const WORK = new Set([OPS.LDI, OPS.ADD, OPS.SUB]);
const MASK_OPS = new Set([OPS.IFLT, OPS.ELSE, OPS.ENDIF]);

/**
 * The core's state just after `start`: r0 = lane index, r1 = din of the lane, r2 = r3 = 0; mask and both stack levels
 * all ones; counters 0; busy.
 */
export function initialState(lanes, din = []) {
  const regs = new Uint32Array(lanes * LANE_REGISTERS);
  for (let l = 0; l < lanes; l++) { regs[l * 4] = l; regs[l * 4 + 1] = (din[l] ?? 0) >>> 0; }
  const full = 2 ** lanes - 1;
  return { lanes, pc: 0, regs, active: full, s0: full, s1: full, depth: 0, cycles: 0, idle: 0, busy: 1, done: 0 };
}

/** The error of op at st.pc if the mask stack would overflow (a third IFLT) or underflow (ELSE, ENDIF), or null. */
export function stackError(st, op) {
  if ((op === OPS.ELSE || op === OPS.ENDIF) && st.depth === 0) return S.engine.stackEmpty(MNEMONIC_OF[op], st.pc);
  if (op === OPS.IFLT && st.depth === 2) return S.engine.stackFull(st.pc);
  return null;
}

/**
 * One clock cycle while busy: execute `word` on `st` (changed in place). Returns {error} and changes nothing when the
 * mask stack would overflow or underflow; otherwise {op, halt?, writes: [[lane, register, old, value]]}.
 */
export function execute(st, word) {
  const { op, rd, rs, rt, imm } = decode(word);
  const { lanes, regs } = st;
  const full = 2 ** lanes - 1;
  const writes = [];
  const error = stackError(st, op);
  if (error) return { error };
  if (WORK.has(op)) {
    for (let l = 0; l < lanes; l++) {
      if (!(st.active & (1 << l))) continue;
      const b = l * 4;
      const v = op === OPS.LDI ? sext8(imm) >>> 0 : op === OPS.ADD ? (regs[b + rs] + regs[b + rt]) >>> 0 : (regs[b + rs] - regs[b + rt]) >>> 0;
      writes.push([l, rd, regs[b + rd], v]);
      regs[b + rd] = v;
    }
    st.idle = (st.idle + lanes - popcount(st.active)) & 0xffff;
  } else if (op === OPS.IFLT) {
    let cond = 0;
    for (let l = 0; l < lanes; l++) if ((regs[l * 4 + rs] | 0) < (regs[l * 4 + rt] | 0)) cond |= 1 << l;
    st.s1 = st.s0; st.s0 = st.active; st.active &= cond; st.depth += 1;
  } else if (op === OPS.ELSE) {
    st.active = st.s0 & ~st.active & full;
  } else if (op === OPS.ENDIF) {
    st.active = st.s0; st.s0 = st.s1; st.depth -= 1;
  }
  st.cycles = (st.cycles + 1) & 0xffff;
  if (op === OPS.HALT) { st.busy = 0; st.done = 1; return { op, halt: true, writes }; }
  st.pc = (st.pc + 1) % PROGRAM_WORDS;
  return { op, writes };
}

/** dout: r2 of every lane, signed. */
export const doutOf = (st) => Array.from({ length: st.lanes }, (_, l) => st.regs[l * 4 + 2] | 0);

/**
 * The SIMT core at its ports, as the laboratory's testbench drives it: write the program while idle, set din, pulse
 * start, clock until done. `pmWrite` and `start` return null, or the error text when the core is busy (nothing
 * changes). A clock while not busy does nothing; an error of the mask stack stops the core (`error`).
 */
export class SimtCore {
  constructor({ lanes = 4 } = {}) {
    this.lanes = lanes;
    this.pm = new Uint16Array(PROGRAM_WORDS);
    this.din = Array(lanes).fill(0);
    this.st = { ...initialState(lanes), busy: 0 };
    this.error = null;
  }

  get busy() { return this.st.busy === 1; }
  get done() { return this.st.done === 1; }
  get dout() { return doutOf(this.st); }
  get activeMask() { return this.st.active; }
  get cycles() { return this.st.cycles; }
  get idleSlots() { return this.st.idle; }

  pmWrite(addr, word) {
    if (this.busy) return S.engine.busyWrite;
    this.pm[addr & 15] = word & 0xffff;
    return null;
  }

  setDin(values) { this.din = Array.from({ length: this.lanes }, (_, l) => (values[l] ?? 0) >>> 0); }

  start() {
    if (this.busy) return S.engine.busyStart;
    this.st = initialState(this.lanes, this.din);
    this.error = null;
    return null;
  }

  clock() {
    if (!this.busy || this.error) return;
    const r = execute(this.st, this.pm[this.st.pc]);
    if (r.error) this.error = r.error;
  }
}

/** The registers by id after `st` (EngineState.registers): the core's, then every lane register of eight lanes. */
function registersOf(st) {
  const r = { pc: st.pc, active_mask: st.active, stack0: st.s0, stack1: st.s1, depth: st.depth, cycles: st.cycles, idle_slots: st.idle,
    busy: st.busy, done: st.done, lanes: st.lanes };
  for (let l = 0; l < MAX_LANES; l++) for (let k = 0; k < LANE_REGISTERS; k++) r[laneId(l, k)] = l < st.lanes ? st.regs[l * 4 + k] : 0;
  return r;
}

/** The core's scalar registers, as [register id, state key], in the order a step record lists them. */
const SCALARS = Object.freeze([['active_mask', 'active'], ['stack0', 's0'], ['stack1', 's1'], ['depth', 'depth'], ['cycles', 'cycles'],
  ['idle_slots', 'idle'], ['busy', 'busy'], ['done', 'done']]);

// the scalar state in one 32-bit number: pc 4 | active 8 | s0 8 | s1 8 | depth 2 | busy 1 | done 1
const pack = (s) => (s.pc | (s.active << 4) | (s.s0 << 12) | (s.s1 << 20) | (s.depth << 28) | (s.busy << 30) | (s.done << 31)) >>> 0;
const unpackInto = (s, n) => {
  s.pc = n & 15; s.active = (n >>> 4) & 0xff; s.s0 = (n >>> 12) & 0xff; s.s1 = (n >>> 20) & 0xff; s.depth = (n >>> 28) & 3;
  s.busy = (n >>> 30) & 1; s.done = (n >>> 31) & 1;
};

/** The engine for one program (contract Engine). The program's `lanes` and `din` come from the assembler. */
export function create(program, { historyLimit = 1_000_000, runLimit = 10_000_000 } = {}) {
  const pm = programImage(program);
  const lanes = program.lanes ?? 4;
  const din = program.din ?? [];
  const cap = Math.max(1, historyLimit);
  let st, halted, error, retired, dropped, output, outBase, work, maskOps, busySlots;
  // the history: a ring of the scalar state before each step (packed) and the old value of rd in each lane; it grows
  // in chunks up to `cap` entries; `size` entries end at `end`
  let ringLen, before, olds, outLen, end, size;

  const alloc = (n) => { ringLen = n; before = new Uint32Array(n); olds = new Uint32Array(n * lanes); outLen = new Float64Array(n); };
  const reset = () => {
    st = initialState(lanes, din);
    halted = false; error = null; retired = 0; dropped = 0; output = ''; outBase = 0; work = 0; maskOps = 0; busySlots = 0;
    alloc(Math.min(cap, 1024)); end = 0; size = 0;
  };
  reset();

  /** Keep the history as it is, oldest first, in a larger ring. */
  const grow = () => {
    const [b, o, ol] = [before, olds, outLen];
    const n0 = ringLen;
    alloc(Math.min(cap, 2 * n0));
    for (let k = 0; k < size; k++) {
      const i = (end - size + k + n0) % n0;
      before[k] = b[i]; outLen[k] = ol[i];
      olds.set(o.subarray(i * lanes, (i + 1) * lanes), k * lanes);
    }
    end = size;
  };

  const remember = (rd) => {
    if (size === ringLen && ringLen < cap) grow();
    before[end] = pack(st);
    for (let l = 0; l < lanes; l++) olds[end * lanes + l] = st.regs[l * 4 + rd];
    outLen[end] = outBase + output.length;
    end = (end + 1) % ringLen;
    if (size < ringLen) size += 1; else dropped += 1;
  };
  const newest = () => (end - 1 + ringLen) % ringLen;

  /** The step record of a step from state `a` (scalars as before it) to state `b`, with the lane writes of `res`. */
  const recordOf = (a, b, res) => {
    const rec = { pc: a.pc, word: pm[a.pc], size: 2, nextPc: b.pc, registers: [], memory: [] };
    for (const [l, k, old, value] of res.writes) rec.registers.push({ id: laneId(l, k), old, value });
    for (const [id, key] of SCALARS) if (a[key] !== b[key]) rec.registers.push({ id, old: a[key], value: b[key] });
    return rec;
  };
  /** The record of the step from state `s`, computed on a copy (last()). */
  const recordAt = (s) => {
    const b = { ...s, regs: s.regs.slice() };
    return recordOf(s, b, execute(b, pm[s.pc]));
  };

  const state = () => ({ pc: st.pc, registers: registersOf(st), halted, error, retired, output, outputDropped: outBase,
    historyDropped: dropped, steps: retired });

  const step = () => {
    if (halted) return null;
    const word = pm[st.pc];
    const { op, rd } = decode(word);
    const bad = stackError(st, op);
    if (bad) { error = bad; halted = true; return null; } // nothing changes
    const prev = { ...st };
    remember(rd);
    const res = execute(st, word);
    retired += 1;
    if (WORK.has(op)) { work += 1; busySlots += popcount(prev.active); } else if (MASK_OPS.has(op)) maskOps += 1;
    const rec = recordOf(prev, st, res);
    if (res.halt) {
      halted = true;
      const out = S.engine.halted(st.cycles, st.idle, doutOf(st));
      output += out;
      if (output.length > 2 * OUTPUT_KEEP) { const drop = output.length - OUTPUT_KEEP; output = output.slice(drop); outBase += drop; }
      return { ...rec, halt: true, output: out };
    }
    return rec;
  };

  /** A copy of the core's state before the newest step (history entry i), without changing the engine. */
  const stateBefore = (i) => {
    const s = { ...st, regs: st.regs.slice() };
    unpackInto(s, before[i]);
    const { op, rd } = decode(pm[s.pc]);
    if (WORK.has(op)) {
      for (let l = 0; l < lanes; l++) if (s.active & (1 << l)) s.regs[l * 4 + rd] = olds[i * lanes + l];
      s.idle = (s.idle - (lanes - popcount(s.active)) + 0x10000) & 0xffff;
    }
    s.cycles = (s.cycles - 1 + 0x10000) & 0xffff;
    return s;
  };

  const back = () => {
    if (error) { error = null; halted = false; return true; } // the failed step changed nothing
    if (!size) return false;
    const i = newest();
    st = stateBefore(i);
    const { op } = decode(pm[st.pc]);
    if (WORK.has(op)) { work -= 1; busySlots -= popcount(st.active); } else if (MASK_OPS.has(op)) maskOps -= 1;
    if (outLen[i] >= outBase) output = output.slice(0, outLen[i] - outBase);
    else { output = ''; outBase = outLen[i]; } // back past what the cap dropped: the output from here on
    end = i;
    size -= 1;
    halted = false;
    retired -= 1;
    return true;
  };

  const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, resumed = false, watch = {} } = {}) => {
    const wr = watch.registers ?? new Set();
    for (let i = 0; i < chunk; i++) {
      if (halted) return error ? STOP.ERROR : STOP.HALT;
      if (retired >= runLimit) return STOP.BUDGET;
      if (i > 0 || resumed) {
        if (breakpoints.has(st.pc)) return STOP.BREAK;
        if (st.pc === target) return STOP.TARGET;
      }
      const rec = step();
      if (!rec) return STOP.ERROR;
      if (rec.halt) return STOP.HALT;
      if (wr.size && rec.registers.some((r) => wr.has(r.id))) return STOP.WATCH; // no instruction writes memory
    }
    return STOP.CHUNK;
  };

  /** The newest step's record, rebuilt by running it again on a copy of the state before it. */
  const last = () => (size ? recordAt(stateBefore(newest())) : null);

  /** The history oldest first, for the snapshot. */
  const ordered = () => {
    const b = new Uint32Array(size); const o = new Uint32Array(size * lanes); const ol = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      const i = (end - size + k + ringLen) % ringLen;
      b[k] = before[i]; ol[k] = outLen[i]; o.set(olds.subarray(i * lanes, (i + 1) * lanes), k * lanes);
    }
    return { b, o, ol };
  };

  return {
    reset, step, back, run, state, last,
    /** `length` bytes of the program memory from word address `address` (16-bit units), each word little-endian. */
    peek: (address, length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) { const w = pm[(address + (i >> 1)) % PROGRAM_WORDS]; out[i] = i & 1 ? w >>> 8 : w & 0xff; }
      return out;
    },
    loopRange: () => {
      if (!size) return null;
      const pcs = Array.from({ length: Math.min(64, size) }, (_, k) => before[(end - 1 - k + ringLen) % ringLen] & 15);
      return { from: Math.min(...pcs), to: Math.max(...pcs) };
    },
    counters: () => {
      const C = S.counterNames;
      return [[C.instructions, retired], [C.work, work], [C.maskOps, maskOps], [C.busy, busySlots], [C.idle, lanes * work - busySlots],
        [C.utilisation, C.percent(busySlots, lanes * work)]];
    },
    dataAccess: () => null,
    snapshot: () => {
      const { b, o, ol } = ordered();
      return { st: { ...st, regs: st.regs.slice() }, halted, error, retired, dropped, output, outBase, work, maskOps, busySlots, b, o, ol };
    },
    restore: (s) => {
      st = { ...s.st, regs: Uint32Array.from(s.st.regs) };
      ({ halted, error, retired, dropped, output, work, maskOps, busySlots } = s);
      outBase = s.outBase ?? 0;
      size = s.b.length;
      alloc(Math.min(cap, Math.max(1024, size)));
      before.set(s.b); olds.set(s.o); outLen.set(s.ol);
      end = size % ringLen;
    },
  };
}
