// i8086/micro-model.js -- the model behind the 8086 BIU/EU view (milestone 8086-B4; design
// docs/architecture/i8086-datapath.md §4): a program run one teaching-model step at a time. Each instruction is run by
// microops.js (runMicro, [EDU], approved B3) on a copy of the state; the state after every step is rebuilt from the
// step records (`replay`), and the instruction's result is committed when its `end` step is performed. A step is not a
// clock (B3 design §1). Step back goes one step, or one instruction (`backInstruction`). The machine is the engine's
// (engine.js): the same reset, console port and empty-vector stop. The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { runMicro } from './microops.js';
import { phys, CPU_REGS } from './cpu.js';
import { hexH } from './isa.js';
import { memoryImage } from './language.js';
import { initialRegisters, CONSOLE_PORT } from './engine.js';
import { I8086_STRINGS as S } from './strings.js';

const MASK = 0xfffff;
const HISTORY_MAX = 250_000; // instructions kept for step back (as engine.js)
export const TEMP_IDS = Object.freeze(['IND', 'OPR', 'tmpA', 'tmpB', 'tmpC', 'Σ']);
const BYTE_REG = { AL: ['AX', 0], CL: ['CX', 0], DL: ['DX', 0], BL: ['BX', 0], AH: ['AX', 8], CH: ['CX', 8], DH: ['DX', 8], BH: ['BX', 8] };
const freshTemps = () => Object.fromEntries(TEMP_IDS.map((k) => [k, 0]));

/** Write a value to a place of a flat state record (registers and temporaries), as microops.js does. */
function put(st, p, v, part = null) {
  if (p === 'decode') return;
  const b = BYTE_REG[p];
  if (b) { st[b[0]] = (st[b[0]] & ~(0xff << b[1])) | ((v & 0xff) << b[1]); return; }
  const cur = st[p];
  let nv = part === 'lo' ? (cur & 0xff00) | (v & 0xff) : part === 'hi' ? (cur & 0x00ff) | ((v & 0xff) << 8)
    : part === 'sx' ? ((v & 0x80 ? 0xff00 : 0) | (v & 0xff)) : v & 0xffff;
  if (p === 'FLAGS') nv = (nv & 0x0fd5) | 0xf002;
  st[p] = nv;
}

/**
 * The state after each step, rebuilt from the step records alone: `start` is a flat record of the 14 registers and
 * the temporaries. Returns one record per step (registers, temporaries, and `mem`: the bytes written by that step).
 * The ALU result Σ is the value of the step's ALU operation (design B3 §2: "ALU result").
 */
export function replay(start, steps) {
  const out = [];
  let st = { ...start };
  for (const s of steps) {
    st = { ...st };
    const mem = [];
    for (const t of s.transfers ?? []) {
      if (t.from === 'Q') st.IP = (st.IP + 1) & 0xffff; // a queue byte: IP counts it
    }
    if (s.alu) st['Σ'] = s.alu.value & 0xffff;
    for (const t of s.transfers ?? []) put(st, t.to, t.value, t.part ?? null);
    if (s.alu?.flags) st.FLAGS = s.alu.FLAGS;
    if (s.count) put(st, s.count.place, s.count.value); // a shift by CL: tmpC counting down (design B3 §7a)
    if (s.kind === 'hardwired' && s.FLAGS !== undefined) st.FLAGS = s.FLAGS;
    if (s.bus) {
      const r = s.bus;
      if (r.op === 'read' || r.op === 'in') st.OPR = r.value;
      else if (r.op === 'write') {
        mem.push([r.address, r.value & 0xff]);
        if (r.size === 16) mem.push([r.address2, (r.value >> 8) & 0xff]);
      }
    }
    out.push({ ...st, mem });
  }
  return out;
}

/** The model of one program (the view's `load`). */
export class MicroModel {
  constructor(program) {
    this.program = program;
    this.image = memoryImage(program);
    this.reset();
  }

  reset() {
    this.mem = this.image.slice();
    this.c = initialRegisters(this.program);
    this.temps = freshTemps();
    this.history = [];
    this.output = '';
    this.halted = false;
    this.error = null;
    this.retired = 0;
    this.count = 0; // steps performed
    this.dropped = 0; // steps no longer kept for step back
    this.prepare();
  }

  /** Run the instruction at CS:IP on a copy; its steps and the state after each. */
  prepare() {
    this.k = 0;
    const cc = { ...this.c };
    const tt = { ...this.temps };
    const overlay = new Map();
    const read = (a) => (overlay.has(a & MASK) ? overlay.get(a & MASK) : this.mem[a & MASK]);
    const out = [];
    const bus = { read, peek: read, write: (a, v) => overlay.set(a & MASK, v & 0xff), output: (port, v) => out.push([port, v]) };
    const res = runMicro(cc, bus, { emptyVector: true, temps: tt });
    const start = { ...this.c, ...this.temps };
    this.cur = { res, start, after: res.error ? [] : replay(start, res.steps), final: { c: cc, temps: tt, overlay, out },
      pc: phys(this.c.CS, this.c.IP), cs: this.c.CS, ip: this.c.IP };
  }

  /** The steps of the current instruction; k is the index of the step the next `step()` performs. */
  get steps() { return this.cur.res.steps ?? []; }
  /** The state shown: after k steps (registers, temporaries, Σ). */
  get regs() { return this.k === 0 ? this.cur.start : this.cur.after[this.k - 1]; }
  /** The step the next clock of the view performs, or null. */
  get next() { return this.halted ? null : this.steps[this.k] ?? null; }
  /** The step just performed, or null at the start of an instruction. */
  get last() { return this.k > 0 ? this.steps[this.k - 1] : null; }

  /** A memory byte as the view shows it: with the writes of the steps performed so far. */
  byte(a) {
    for (let j = this.k - 1; j >= 0; j--) {
      const hit = this.cur.after[j].mem.find(([x]) => x === (a & MASK));
      if (hit) return hit[1];
    }
    return this.mem[a & MASK];
  }

  /** One step: 'step', 'halt' or 'error'. Performing the `end` step commits the instruction. */
  step() {
    if (this.halted) return this.error ? 'error' : 'halt';
    const { res } = this.cur;
    if (res.error) { this.error = errorText(res, this.cur); this.halted = true; return 'error'; }
    this.k += 1;
    this.count += 1;
    if (this.k < this.steps.length) return 'step';
    // commit
    const { c, temps, overlay, out } = this.cur.final;
    const undo = [];
    for (const [a, v] of overlay) { undo.push([a, this.mem[a]]); this.mem[a] = v; }
    this.history.push({ c: { ...this.c }, temps: { ...this.temps }, undo, outLen: this.output.length, n: this.steps.length });
    if (this.history.length > HISTORY_MAX) { // the oldest instructions can no longer be stepped back
      for (const h of this.history.splice(0, 1000)) this.dropped += h.n;
    }
    for (const [port, v] of out) if (port === CONSOLE_PORT) this.output += String.fromCharCode(v & 0xff);
    this.c = { ...c };
    this.temps = { ...temps };
    this.retired += 1;
    const halt = Boolean(res.halt);
    this.lastResult = res;
    this.prepare();
    if (halt) { this.halted = true; return 'halt'; }
    return 'step';
  }

  /** Run to the end of the current instruction. */
  stepInstruction() {
    const n = this.retired;
    let r = 'step';
    while (r === 'step' && this.retired === n) r = this.step();
    return r;
  }

  /** One step back; at the start of an instruction, to the step before the previous instruction's `end`. */
  back() {
    if (this.error) { this.error = null; this.halted = false; return true; }
    if (this.k > 0) { this.k -= 1; this.count -= 1; this.halted = false; return true; }
    if (!this.uncommit()) return false;
    this.k = this.steps.length - 1;
    this.count -= 1;
    return true;
  }

  /** Back to the start of the current instruction, or of the previous one when at the start. */
  backInstruction() {
    if (this.error) { this.error = null; this.halted = false; }
    if (this.k > 0) { this.count -= this.k; this.k = 0; this.halted = false; return true; }
    if (!this.uncommit()) return false;
    this.count -= this.steps.length;
    this.k = 0;
    return true;
  }

  uncommit() {
    const h = this.history.pop();
    if (!h) return false;
    for (let i = h.undo.length - 1; i >= 0; i--) this.mem[h.undo[i][0]] = h.undo[i][1];
    this.c = h.c; this.temps = h.temps;
    this.output = this.output.slice(0, h.outLen);
    this.retired -= 1;
    this.halted = false;
    this.prepare();
    return true;
  }

  /** The 14 registers as the view shows them (after k steps). */
  registers() { return Object.fromEntries(CPU_REGS.map((k) => [k, this.regs[k]])); }
}

/** The engine's wording of an instruction that cannot run (engine.js errorText). */
function errorText(res, cur) {
  const at = `${hexH(cur.cs, 4)}:${hexH(cur.ip, 4)}`;
  if (res.error === 'noHandler') return res.vector === 0 && res.d.entry?.mnem !== 'INT' ? S.engine.divideNoHandler(at) : S.engine.noHandler(res.vector, at);
  const bytes = (res.d.bytes ?? []).map((b) => hexH(b, 2)).join(' ');
  return S.engine.notRun(S.engine.status[res.error] ?? res.error, bytes, at);
}
