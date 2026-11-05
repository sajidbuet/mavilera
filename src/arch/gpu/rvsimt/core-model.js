// rvsimt/core-model.js -- the model of the RISC-V SIMT core views (GPU-3, gate V): one clock cycle is one issue of the
// core of engine.js (the same issue(), so the views and the Instructions view never disagree). It keeps a journal for
// step back and a log of the issues (warp, PC, word, mask before and after, the stack after, the lanes' results), from
// which the views draw the mask grid (FIG-0109, with the "Masks-only count" filter, decision G21), the stack rows
// (FIG-0215) and the counters (FIG-0218). evaluate() previews the coming issue on a copy of the core: the values the
// drawing of FIG-0216 shows on its wires (behaviour, not warp_ctrl's logic: decision G19), and the waveform signals.
// The export protocol is the shell's (arch-contract.md §14): evaluate().signals before each clock, step(), run(limit),
// and golden() in the testbench's golden.hex layout. No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { initialCore, issue, nextWarp, done, registersOf, loadProgram, MAX_WARPS } from './engine.js';
import { decode, disassemble, WARP_OPS, DMEM_WORDS } from './isa.js';
import { RVSIMT_STRINGS as S } from './strings.js';

const U = (v) => v >>> 0;
const popcount = (m) => { let n = 0; for (let x = m; x; x &= x - 1) n += 1; return n; };
/** A mask as the book writes it: lane 0 first. */
export const lanes0 = (m, n) => Array.from({ length: n }, (_, l) => ((m >>> l) & 1 ? '1' : '0')).join('');
const BRANCHES = new Set(['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'jal']);
/** What the masks-only filter hides an issue as: 'control' (warp control), 'branch', or null (shown, unless setup). */
export const opClass = (op) => (WARP_OPS.includes(op) ? 'control' : BRANCHES.has(op) ? 'branch' : null);
/** Whether an operation writes rd (for the drawing's write gates). */
const WRITES_RD = (op) => op && !['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu', 'sw', ...WARP_OPS].includes(op);

/** A copy of a core that issue() may change (the instruction memory is shared: nothing writes it). */
const copyCore = (c) => ({ ...c, regs: c.regs.slice(), dmem: c.dmem.slice(), pc: c.pc.slice(), mask: c.mask.slice(),
  running: c.running.slice(), waiting: c.waiting.slice(), stacks: c.stacks.map((s) => s.map((e) => ({ ...e }))), arrived: c.arrived.slice() });
const ctlOf = (c) => ({ pc: c.pc.slice(), mask: c.mask.slice(), running: c.running.slice(), waiting: c.waiting.slice(),
  stacks: c.stacks.map((s) => s.map((e) => ({ ...e }))), arrived: c.arrived.slice(), last: c.last,
  cycles: c.cycles, issued: c.issued, active: c.active, fault: c.fault });
const ri = (c, w, l, k) => ((w * c.L) + l) * 32 + k;

/**
 * The code of an instruction: its source line as written, without label and comment, spaces collapsed (as the book's
 * figure generator reads programs; a local label stays `1f`), or the disassembly for a program without source.
 */
export function codeText(program, pc, word) {
  const row = program?.listing?.find((r) => r.address === pc);
  if (row?.source && typeof row.text === 'string') {
    let t = row.text.replace(/#.*$/, '').trim();
    t = t.replace(/^[A-Za-z_.$0-9]+:\s*/, ''); // a label on the line
    t = t.replace(/\s+/g, ' ').replace(/ ,/g, ',');
    if (t) return t;
  }
  return disassemble(word, pc);
}

/**
 * The effect of one issue on core `c` without changing it: the issue record of engine.js with the decoded word, the
 * value each lane computes for rd (or the data it stores), the branch outcome, the split predicate and what warp_ctrl
 * tells the scheduler. null when no warp is ready.
 */
export function preview(c) {
  if (c.fault || nextWarp(c) < 0) return null;
  const k = copyCore(c);
  const w = nextWarp(c);
  const d = decode(c.imem[(c.pc[w] >>> 2) % c.imem.length] ?? 0);
  const res = issue(k);
  const A = res.maskIn;
  const result = new Array(c.L).fill(null);
  const x = (l, r) => c.regs[ri(c, w, l, r)];
  if (!res.fault && d.op) {
    for (let l = 0; l < c.L; l++) {
      if (!(A & (1 << l))) continue;
      if (d.op === 'sw') result[l] = x(l, d.rs2);
      else if (WRITES_RD(d.op) && d.rd) result[l] = k.regs[ri(c, w, l, d.rd)];
    }
  }
  let pred = null;
  if (d.op === 'split' && !res.fault) { pred = 0; for (let l = 0; l < c.L; l++) if ((A & (1 << l)) && (x(l, d.rs1) & 1)) pred |= 1 << l; }
  const branch = ['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'].includes(d.op);
  const taken = branch && !res.fault ? (k.pc[w] !== U(res.pc + 4) ? 1 : 0) : null;
  const ended = !res.fault && d.op === 'tmc' && !k.running[w];
  const redirect = !res.fault && d.op === 'join' && c.stacks[w].at(-1)?.kind === 'E' ? c.stacks[w].at(-1).pc : null;
  return { ...res, op: d.op ?? null, d, result, pred, taken, ended, redirect, after: k };
}

/** The waveform and VCD signals (capability waveform): the cycle's issue, then each warp's control state. */
export function waveSignals(lanes, warps) {
  return Object.freeze([
    { name: 'warp', width: 1, kind: 'state' }, { name: 'pc', width: 32 }, { name: 'instr', width: 32 },
    { name: 'mask', width: lanes }, { name: 'active', width: 4 },
    ...Array.from({ length: warps }, (_, w) => [{ name: `w${w}_state`, width: 2, kind: 'state' }, { name: `w${w}_pc`, width: 32 },
      { name: `w${w}_mask`, width: lanes }, { name: `w${w}_depth`, width: 3 }]).flat(),
    { name: 'cycles', width: 32 }, { name: 'issued', width: 32 }, { name: 'active_slots', width: 32 },
    { name: 'done', width: 1, kind: 'control' }, { name: 'fault', width: 1, kind: 'control' }, { name: 'fault_code', width: 4 },
  ]);
}

export class CoreModel {
  /** @param {object} program a Program of the profiles lab or lab-l8 */
  constructor(program, { journal = 1_000_000 } = {}) {
    this.program = program;
    this.keep = journal;
    this.reset();
  }

  reset() {
    const { machine, prog, data } = loadProgram(this.program);
    this.c = initialCore(machine, prog, data);
    this.journal = []; // per issue: {ctl, res} (the engine's undo record)
    this.issues = []; // per issue: the log row (see log())
    this.dropped = 0;
    this.error = null; // a deadlock (every running warp waits at bar)
  }

  get lanes() { return this.c.L; }
  get warps() { return this.c.W; }
  get cycle() { return this.c.cycles; }
  get halted() { return Boolean(this.c.fault) || done(this.c); }
  get fault() { return this.c.fault; }
  registers() { return registersOf(this.c); }

  /** The log row of an issue: {n, cycle, w, pc, word, op, maskIn, maskOut, stack: [{kind, mask, pc}] after, fault}. */
  log(res) {
    return { n: this.c.issued, cycle: this.c.cycles, w: res.w, pc: res.pc, word: res.word, op: decode(res.word).op ?? null,
      maskIn: res.maskIn, maskOut: res.maskOut, stack: this.c.stacks[res.w].map((e) => ({ ...e })), fault: res.fault };
  }

  /** One clock cycle: 'step' after an issue; 'halt' (every warp ended, or a fault: the run is over) or 'error' (deadlock) when none. */
  step() {
    if (this.c.fault || done(this.c)) return 'halt';
    if (nextWarp(this.c) < 0) { this.error = S.engine.deadlock; return 'error'; }
    const ctl = ctlOf(this.c);
    const res = issue(this.c);
    this.journal.push({ ctl, res });
    this.issues.push(this.log(res));
    if (this.journal.length > this.keep) { this.journal.shift(); this.dropped += 1; }
    return 'step';
  }

  /** Undo the last cycle; false when nothing is left to undo. */
  back() {
    this.error = null;
    const h = this.journal.pop();
    if (!h) return false;
    const { c } = this;
    for (const [k, old] of h.res.writes) c.regs[k] = old;
    for (let i = h.res.stores.length - 1; i >= 0; i--) { const [k, old] = h.res.stores[i]; c.dmem[k] = old; }
    for (const [k, regs] of h.res.spawned) c.regs.set(regs, ri(c, k, 0, 0));
    Object.assign(c, ctlOf(h.ctl));
    this.issues.pop();
    return true;
  }

  /** The coming issue (preview) with the waveform signals of this cycle. */
  evaluate() {
    const { c } = this;
    const p = preview(c);
    const r = registersOf(c);
    const signals = { warp: p ? p.w : 0, pc: p ? p.pc : r.pc, instr: p ? p.word : 0, mask: p ? p.maskIn : 0, active: p ? popcount(p.maskIn) : 0,
      cycles: c.cycles, issued: c.issued, active_slots: c.active, done: r.done, fault: r.fault, fault_code: r.fault_code };
    for (let w = 0; w < c.W; w++) for (const k of ['state', 'pc', 'mask', 'depth']) signals[`w${w}_${k}`] = r[`w${w}_${k}`];
    return { signals, issue: p };
  }

  /** Run to the end (the golden dump): 'halt', 'error' or 'budget'. Keeps no journal. */
  run(limit) {
    for (let i = 0; i < limit; i++) {
      const s = this.step();
      this.journal.length = 0;
      this.issues.length = 0;
      if (s !== 'step') return s;
    }
    return 'budget';
  }

  /** The testbench's golden.hex: the 256 data-memory words, then cycles, issued, active_slots, fault code (8 digits each). */
  golden() {
    const { c } = this;
    const words = [...c.dmem.slice(0, DMEM_WORDS), c.cycles, c.issued, c.active, c.fault];
    return { text: words.map((v) => `${U(v).toString(16).padStart(8, '0')}\n`).join(''), count: words.length };
  }
}

/** A fresh model with the shell's export protocol (contract v4): {model, signals, module, label}. */
export function exportModel(program, label) {
  const model = new CoreModel(program, { journal: 0 });
  return { model, signals: waveSignals(model.lanes, model.warps), module: 'rvsimt_core', label };
}

/** contract Exports.golden for a view's export model. */
export const golden = (model) => model.golden();

/**
 * The issues of each warp that the masks-only filter counts as launch and setup: those before the instruction that
 * computes the predicate of the warp's first split (the last issue of the warp before that split that wrote the split's
 * rs1). A warp without a split has none. `issues`: the log rows of a whole run. Returns a Set of issue numbers (n).
 */
export function setupIssues(issues) {
  const out = new Set();
  for (let w = 0; w < MAX_WARPS; w++) {
    const mine = issues.filter((r) => r.w === w);
    const s = mine.findIndex((r) => r.op === 'split' && !r.fault);
    if (s < 0) continue;
    const p = decode(mine[s].word).rs1;
    let from = s;
    for (let i = s - 1; i >= 0; i--) { const d = decode(mine[i].word); if (d.rd === p && WRITES_RD(d.op)) { from = i; break; } }
    for (let i = 0; i < from; i++) out.add(mine[i].n);
  }
  return out;
}

/**
 * The rows of the mask grid: every issue, or with `masksOnly` those that are not warp control, branches or setup
 * (decision G21), with how many of each kind are hidden. Each row: {n, cycle, w, pc, code, mask (lane 0 first), count,
 * hidden kind or null}.
 */
export function maskRows(issues, { program, lanes, masksOnly = false, setup = new Set() }) {
  const hidden = { control: 0, branch: 0, setup: 0 };
  const rows = [];
  for (const r of issues) {
    const kind = setup.has(r.n) ? 'setup' : opClass(r.op);
    if (masksOnly && kind) { hidden[kind] += 1; continue; }
    rows.push({ n: r.n, cycle: r.cycle, w: r.w, pc: r.pc, code: codeText(program, r.pc, r.word), mask: lanes0(r.maskIn, lanes),
      count: popcount(r.maskIn), kind, fault: r.fault });
  }
  return { rows, hidden };
}

/** The stack rows of FIG-0215's form: code, the active mask (lane 0 first) and the stack after the issue, top last. */
export function stackRows(issues, { program, lanes, warp = null }) {
  return issues.filter((r) => warp === null || r.w === warp).map((r) => ({ n: r.n, w: r.w, pc: r.pc, text: codeText(program, r.pc, r.word),
    mask: lanes0(r.maskIn, lanes), stack: r.stack.map((e) => ({ kind: e.kind, mask: lanes0(e.mask, lanes), pc: e.pc })), fault: r.fault }));
}

/** The counters of a run as FIG-0218 gives them: cycles, issued, active lane-slots, all lane-slots and the efficiency. */
export function results(c) {
  const slots = c.issued * c.L;
  return { cycles: c.cycles, issued: c.issued, active: c.active, slots, efficiency: slots ? c.active / slots : null };
}
