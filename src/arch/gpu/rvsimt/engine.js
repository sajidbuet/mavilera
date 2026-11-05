// rvsimt/engine.js -- the RISC-V SIMT laboratory core (GPU-2, decisions G14, G16): WARPS warps of LANES threads share
// one fetch; each warp has a PC, an active mask, a reconvergence stack of STACK_DEPTH entries and a state (running,
// waiting at a barrier, ended). One instruction issues per clock cycle, from the next ready warp after the last one
// (round-robin); loads see a one-cycle ideal memory. Semantics: the textbook's Chapter 11A brief §16 (book D9-D11);
// fault codes as the supplied golden model. Written from the specification and checked against the book's golden files
// and the supplied model's trace (test/gpu-rvsimt.test.mjs); the code is MAVILERA's.
//
// MAVILERA's choices where the specification is silent (docs/architecture/gpu-rvsimt.md):
// - a faulting instruction is a step: it counts in cycles, issued and active_slots (as the golden files show) and
//   changes nothing else; then the run stops with the fault's name; step back undoes it;
// - a cycle in which every running warp waits at a barrier would never end (a deadlock): the run stops with an
//   error before it, without counting it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP } from '../../contract.js';
import { decode, IMEM_WORDS, DMEM_WORDS } from './isa.js';
import { RVSIMT_STRINGS as S } from './strings.js';

export const MAX_LANES = 8;
export const MAX_WARPS = 2;
export const STACK_DEPTH = 4;
/** The profiles: the laboratory core and the eight-lane, one-warp testbench (tb_rvsimt_l8). */
export const MACHINES = Object.freeze({ lab: { lanes: 4, warps: 2 }, 'lab-l8': { lanes: 8, warps: 1 } });
export const FAULTS = Object.freeze({ NONE: 0, DIVERGENT: 1, ILLEGAL: 2, OVERFLOW: 3, EMPTY: 4, TMC_STACK: 5, OPERAND: 6, ADDRESS: 7 });

const U = (v) => v >>> 0;
const S32 = (v) => v | 0;
const popcount = (m) => { let n = 0; for (let x = m; x; x &= x - 1) n += 1; return n; };
export const threadId = (w, l, k) => `w${w}l${l}x${k}`;

/** A fresh core for a machine {lanes, warps} with instruction words `prog` and data words `data` (warp 0 running). */
export function initialCore({ lanes, warps }, prog = [], data = []) {
  const imem = new Uint32Array(IMEM_WORDS);
  imem.set(prog.slice(0, IMEM_WORDS).map(U));
  const dmem = new Uint32Array(DMEM_WORDS);
  dmem.set(data.slice(0, DMEM_WORDS).map(U));
  const full = (1 << lanes) - 1;
  return {
    L: lanes, W: warps, full, imem, dmem,
    regs: new Uint32Array(warps * lanes * 32),
    pc: new Array(warps).fill(0), mask: new Array(warps).fill(full),
    running: Array.from({ length: warps }, (_, w) => w === 0), waiting: new Array(warps).fill(-1),
    stacks: Array.from({ length: warps }, () => []), arrived: [0, 0], last: warps - 1,
    cycles: 0, issued: 0, active: 0, fault: 0,
  };
}

const ri = (c, w, l, k) => ((w * c.L) + l) * 32 + k;
/** The register-immediate operations and the operation each computes. */
const IMM_BASE = Object.freeze({ addi: 'add', slti: 'slt', sltiu: 'sltu', xori: 'xor', ori: 'or', andi: 'and', slli: 'sll', srli: 'srl', srai: 'sra' });
const ready = (c, w) => c.running[w] && c.waiting[w] < 0;
/** The warp that issues in the next cycle (round-robin after the last), or -1 if none is ready. */
export function nextWarp(c) {
  for (let k = 1; k <= c.W; k++) { const w = (c.last + k) % c.W; if (ready(c, w)) return w; }
  return -1;
}
export const done = (c) => !c.fault && !c.running.some(Boolean);
/**
 * The identity CSRs of thread (w, l); block_index and kernel_args are 0 at launch (the laboratory's testbench) unless
 * a host set them (c.block, c.args: the GPU device of the RISC-V laboratory, GPU-7).
 */
const csrValue = (c, w, l, csr) => U({ 0xcc0: w * c.L + l, 0xcc1: l, 0xcc2: w, 0xcc3: c.block ?? 0, 0xcc4: c.W * c.L, 0xcc5: c.args ?? 0 }[csr]);

/** The control state, copied (for the history). */
const ctlOf = (c) => ({ pc: c.pc.slice(), mask: c.mask.slice(), running: c.running.slice(), waiting: c.waiting.slice(),
  stacks: c.stacks.map((s) => s.map((e) => ({ ...e }))), arrived: c.arrived.slice(), last: c.last,
  cycles: c.cycles, issued: c.issued, active: c.active, fault: c.fault });
const setCtl = (c, t) => Object.assign(c, ctlOf(t));

/**
 * One clock cycle on core `c` (changed in place). Returns {w, pc, word, maskIn, maskOut, writes: [[index, old]],
 * stores: [[word index, old]], reads: [byte address], spawned: [[warp, old registers]], fault} or null when no warp
 * is ready (`done(c)` or a deadlock). Every issue counts in cycles, issued and active_slots; a fault changes nothing else.
 */
export function issue(c) {
  if (c.fault) return null;
  const w = nextWarp(c);
  if (w < 0) return null;
  c.last = w;
  const pc = c.pc[w];
  const A = c.mask[w];
  c.cycles += 1; c.issued += 1; c.active += popcount(A);
  const fetchOk = pc % 4 === 0 && (pc >>> 2) < IMEM_WORDS;
  const word = fetchOk ? c.imem[pc >>> 2] : 0;
  const out = { w, pc, word, maskIn: A, maskOut: A, writes: [], stores: [], reads: [], spawned: [], fault: 0 };
  const fail = (code) => { c.fault = code; out.fault = code; return out; };
  if (!fetchOk) return fail(FAULTS.ILLEGAL);
  const d = decode(word);
  if (!d.op) return fail(FAULTS.ILLEGAL);
  const act = [];
  for (let l = 0; l < c.L; l++) if (A & (1 << l)) act.push(l);
  const x = (l, k) => c.regs[ri(c, w, l, k)];
  const lead = act[0];
  let npc = U(pc + 4);
  const results = new Map(); // lane -> value for rd

  switch (d.op) {
    case 'beq': case 'bne': case 'blt': case 'bge': case 'bltu': case 'bgeu': {
      const t = act.map((l) => {
        const a = x(l, d.rs1); const b = x(l, d.rs2);
        return { beq: a === b, bne: a !== b, blt: S32(a) < S32(b), bge: S32(a) >= S32(b), bltu: a < b, bgeu: a >= b }[d.op];
      });
      if (t.some((v) => v !== t[0])) return fail(FAULTS.DIVERGENT);
      if (t[0]) npc = U(pc + d.imm);
      break;
    }
    case 'jal': for (const l of act) results.set(l, U(pc + 4)); npc = U(pc + d.imm); break;
    case 'lui': for (const l of act) results.set(l, d.imm); break;
    case 'csrr': for (const l of act) results.set(l, csrValue(c, w, l, d.csr)); break;
    case 'lw': case 'sw': {
      const addr = act.map((l) => U(x(l, d.rs1) + d.imm));
      if (addr.some((a) => a % 4 || (a >>> 2) >= DMEM_WORDS)) return fail(FAULTS.ADDRESS);
      if (d.op === 'lw') act.forEach((l, i) => { results.set(l, c.dmem[addr[i] >>> 2]); out.reads.push(addr[i]); });
      else act.forEach((l, i) => { const k = addr[i] >>> 2; out.stores.push([k, c.dmem[k]]); c.dmem[k] = x(l, d.rs2); }); // ascending lanes: the highest writes last
      break;
    }
    case 'tmc': {
      if (c.stacks[w].length) return fail(FAULTS.TMC_STACK);
      const m = x(lead, d.rs1) & c.full;
      if (m === 0) c.running[w] = false; else c.mask[w] = m;
      break;
    }
    case 'wspawn': {
      const n = x(lead, d.rs1);
      const others = c.running.some((r, k) => r && k !== w);
      if (w !== 0 || n > c.W || others) return fail(FAULTS.OPERAND);
      for (let k = 1; k < n; k++) {
        const base = ri(c, k, 0, 0);
        out.spawned.push([k, c.regs.slice(base, base + c.L * 32)]);
        c.regs.fill(0, base, base + c.L * 32);
        c.running[k] = true; c.pc[k] = U(x(lead, d.rs2)); c.mask[k] = c.full; c.stacks[k] = []; c.waiting[k] = -1;
      }
      break;
    }
    case 'split': {
      let p = 0;
      for (const l of act) if (x(l, d.rs1) & 1) p |= 1 << l;
      const divergent = p !== 0 && p !== A;
      if (c.stacks[w].length + (divergent ? 2 : 1) > STACK_DEPTH) return fail(FAULTS.OVERFLOW);
      c.stacks[w].push({ kind: 'R', mask: A, pc: 0 });
      if (divergent) { c.stacks[w].push({ kind: 'E', mask: A & ~p & c.full, pc: npc }); c.mask[w] = p; }
      break;
    }
    case 'join': {
      if (!c.stacks[w].length) return fail(FAULTS.EMPTY);
      const e = c.stacks[w].pop();
      c.mask[w] = e.mask;
      if (e.kind === 'E') npc = e.pc;
      break;
    }
    case 'bar': {
      const id = x(lead, d.rs1); const n = x(lead, d.rs2);
      if (id > 1 || n === 0 || n > c.W) return fail(FAULTS.OPERAND);
      if (c.arrived[id] + 1 === n) {
        c.arrived[id] = 0;
        for (let k = 0; k < c.W; k++) if (c.waiting[k] === id) c.waiting[k] = -1;
      } else { c.arrived[id] += 1; c.waiting[w] = id; }
      break;
    }
    default: { // register-register and register-immediate operations
      const imm = Object.hasOwn(IMM_BASE, d.op);
      const base = IMM_BASE[d.op] ?? d.op;
      for (const l of act) {
        const a = x(l, d.rs1);
        const b = imm ? U(d.imm) : x(l, d.rs2);
        const sh = b & 31;
        results.set(l, U({ add: a + b, sub: a - b, sll: a << sh, slt: S32(a) < S32(b) ? 1 : 0, sltu: a < b ? 1 : 0,
          xor: a ^ b, srl: a >>> sh, sra: S32(a) >> sh, or: a | b, and: a & b }[base]));
      }
    }
  }
  if (d.rd) for (const [l, v] of results) { const k = ri(c, w, l, d.rd); out.writes.push([k, c.regs[k]]); c.regs[k] = v; }
  if (c.running[w]) c.pc[w] = npc;
  out.maskOut = c.mask[w];
  return out;
}

/** The registers of the descriptor (index.js), by id, for core `c`. */
export function registersOf(c) {
  const r = { pc: 0, cycles: c.cycles, issued: c.issued, active_slots: c.active, done: done(c) ? 1 : 0, fault: c.fault ? 1 : 0, fault_code: c.fault };
  const nw = nextWarp(c);
  r.pc = nw >= 0 ? c.pc[nw] : c.pc[c.last];
  r.next_warp = nw >= 0 ? nw : 0;
  r.lanes = c.L; r.warps = c.W;
  for (let w = 0; w < MAX_WARPS; w++) {
    const on = w < c.W;
    r[`w${w}_pc`] = on ? c.pc[w] : 0;
    r[`w${w}_mask`] = on ? c.mask[w] : 0;
    r[`w${w}_state`] = !on || !c.running[w] ? 0 : c.waiting[w] >= 0 ? 2 : 1;
    r[`w${w}_depth`] = on ? c.stacks[w].length : 0;
    for (let i = 0; i < STACK_DEPTH; i++) {
      const e = on ? c.stacks[w][i] : undefined;
      r[`w${w}_s${i}_kind`] = e ? (e.kind === 'R' ? 1 : 2) : 0;
      r[`w${w}_s${i}_mask`] = e ? e.mask : 0;
      r[`w${w}_s${i}_pc`] = e ? e.pc : 0;
    }
    for (let l = 0; l < MAX_LANES; l++) for (let k = 0; k < 32; k++) r[threadId(w, l, k)] = on && l < c.L ? c.regs[ri(c, w, l, k)] : 0;
  }
  return r;
}

/** The program's machine, instruction words and data words. */
export function loadProgram(program) {
  const m = MACHINES[program.profile] ?? MACHINES.lab;
  const words = (seg) => {
    const out = [];
    for (let i = 0; seg && i + 3 < seg.bytes.length; i += 4) out.push(U(seg.bytes[i] | (seg.bytes[i + 1] << 8) | (seg.bytes[i + 2] << 16) | (seg.bytes[i + 3] << 24)));
    return out;
  };
  const text = program.segments.find((s) => s.executable && s.address === 0);
  const data = program.segments.find((s) => !s.executable);
  const dataWords = data ? new Array(data.address >>> 2).fill(0).concat(words(data)) : [];
  return { machine: m, prog: words(text), data: dataWords };
}

/** A run of the core to its end, for the tests and the trace export: {core, trace, stop}. */
export function runCore(program, { limit = 100_000, onIssue = null } = {}) {
  const { machine, prog, data } = loadProgram(program);
  const c = initialCore(machine, prog, data);
  let n = 0;
  while (n < limit) {
    const r = issue(c);
    if (!r) break;
    n += 1;
    onIssue?.(r, c);
    if (r.fault) break;
  }
  const stop = c.fault ? 'fault' : done(c) ? 'done' : n >= limit ? 'limit' : 'deadlock';
  return { core: c, stop };
}

const HISTORY_CAP = 200_000; // steps kept for step back (each keeps the control state; the laboratory's runs are short)

/** The contract engine (src/arch/contract.js Engine) for a program of the RISC-V SIMT profiles. */
export function create(program, { historyLimit = 1_000_000, runLimit = 10_000_000 } = {}) {
  const { machine, prog, data } = loadProgram(program);
  const cap = Math.max(1, Math.min(historyLimit, HISTORY_CAP));
  let c; let history; let halted; let error; let output; let dropped;
  const reset = () => { c = initialCore(machine, prog, data); history = []; halted = false; error = null; output = ''; dropped = 0; };
  reset();

  const say = (text) => { output += text; };
  const scalars = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/^w\dl\d/.test(k)));
  const recordOf = (h, before, after) => {
    const rec = { pc: h.res.pc, word: h.res.word, size: 4, nextPc: after.pc, registers: [], memory: [], reads: h.res.reads.map((a) => ({ address: a, size: 4 })) };
    for (const [k, old] of h.res.writes) {
      const w = Math.floor(k / (c.L * 32)); const l = Math.floor((k % (c.L * 32)) / 32);
      rec.registers.push({ id: threadId(w, l, k % 32), old, value: c.regs[k] });
    }
    for (const [k, old] of Object.entries(before)) if (after[k] !== old) rec.registers.push({ id: k, old, value: after[k] });
    for (const [k, old] of h.res.stores) rec.memory.push({ address: k * 4, size: 4, old, value: c.dmem[k] });
    return rec;
  };

  const finish = (res) => {
    if (res.fault) {
      halted = true;
      error = S.engine.fault(res.fault, res.pc, res.w);
    } else if (done(c)) {
      halted = true;
      say(S.engine.done(c.cycles, c.issued, c.active, c.L));
    }
  };

  const step = () => {
    if (halted) return null;
    if (nextWarp(c) < 0) { halted = true; error = S.engine.deadlock; return null; } // every running warp waits at bar
    const before = scalars(registersOf(c));
    const ctl = ctlOf(c);
    const outLen = output.length;
    const res = issue(c);
    const h = { ctl, res, outLen };
    history.push(h);
    if (history.length > cap) { history.shift(); dropped += 1; }
    finish(res);
    const rec = recordOf(h, before, scalars(registersOf(c)));
    h.rec = rec;
    if (halted && !error) return { ...rec, halt: true, output: output.slice(outLen) };
    return rec;
  };

  const back = () => {
    if (!history.length) {
      if (error) { error = null; halted = false; return true; } // a deadlock stop changed nothing
      return false;
    }
    const h = history.pop();
    for (const [k, old] of h.res.writes) c.regs[k] = old;
    for (let i = h.res.stores.length - 1; i >= 0; i--) { const [k, old] = h.res.stores[i]; c.dmem[k] = old; }
    for (const [k, regs] of h.res.spawned) c.regs.set(regs, ri(c, k, 0, 0));
    setCtl(c, h.ctl);
    output = output.slice(0, h.outLen);
    halted = false; error = null;
    return true;
  };

  const state = () => {
    const regs = registersOf(c);
    return { pc: regs.pc, registers: regs, halted, error, retired: c.issued, output, historyDropped: dropped, steps: history.length + dropped };
  };

  const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, resumed = false, watch = {} } = {}) => {
    const wr = watch.registers ?? new Set();
    const wm = watch.memory ?? new Set();
    for (let i = 0; i < chunk; i++) {
      if (halted) return error ? STOP.ERROR : STOP.HALT;
      if (c.issued >= runLimit) return STOP.BUDGET;
      const pc = registersOf(c).pc;
      if (i > 0 || resumed) {
        if (breakpoints.has(pc)) return STOP.BREAK;
        if (pc === target) return STOP.TARGET;
      }
      const rec = step();
      if (!rec) return STOP.ERROR;
      if (error) return STOP.ERROR;
      if (rec.halt) return STOP.HALT;
      if (wr.size && rec.registers.some((r) => wr.has(r.id))) return STOP.WATCH;
      if (wm.size && rec.memory.some((m) => wm.has(m.address))) return STOP.WATCH;
    }
    return STOP.CHUNK;
  };

  return {
    reset, step, back, run, state,
    last: () => (history.length ? history[history.length - 1].rec : null),
    /** `length` bytes of the data memory from byte address `address` (the instruction memory is the listing's). */
    peek: (address, length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        const a = (address + i) >>> 0;
        out[i] = (a >>> 2) < DMEM_WORDS ? (c.dmem[a >>> 2] >>> (8 * (a & 3))) & 0xff : 0;
      }
      return out;
    },
    loopRange: () => {
      if (!history.length) return null;
      const pcs = history.slice(-64).map((h) => h.res.pc);
      return { from: Math.min(...pcs), to: Math.max(...pcs) };
    },
    counters: () => {
      const C = S.counterNames;
      return [[C.cycles, c.cycles], [C.issued, c.issued], [C.active, c.active], [C.idle, c.L * c.issued - c.active],
        [C.efficiency, C.percent(c.active, c.L * c.issued)]];
    },
    dataAccess: () => null,
    snapshot: () => ({ c: { ...ctlOf(c), regs: c.regs.slice(), dmem: c.dmem.slice() }, history, halted, error, output, dropped }),
    restore: (s) => {
      c = initialCore(machine, prog, data);
      setCtl(c, s.c);
      c.regs.set(s.c.regs); c.dmem.set(s.c.dmem);
      ({ history, halted, error, output, dropped } = s);
    },
  };
}
