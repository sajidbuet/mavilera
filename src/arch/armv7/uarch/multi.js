// armv7/uarch/multi.js -- the ARM multicycle processor at signal level (roadmap milestone ARM-A3, §4): the base design
// of Harris and Harris, DDCA ARM ed., §7.4: the datapath of Fig 7.30 (p. 414), the control unit of Fig 7.31 (p. 415)
// and the Main FSM of Fig 7.41 (p. 423). One step is one clock cycle, one state of the FSM. evaluate() computes every
// signal of the dictionary (uarch/signals.js, MULTI_SIGNALS) from the state in the data-flow order of the datapath;
// step() applies the clock edge.
//
// The datapath: one memory for instructions and data, its address Adr from the PC (AdrSrc 0) or ALUOut (AdrSrc 1:
// text p. 409, author decision Q7); the five non-architectural registers IR (enabled by IRWrite), Data, A, WriteData
// and ALUOut, all but IR loaded on every edge (p. 425); one ALU, which also computes PC + 4 in Fetch and PC + 8 in
// Decode (pp. 410, 417); the PC loaded from Result when PCWrite is 1 (Fig 7.30); Result feeds WD3, the R15 input of
// the register file and the PC. The control unit: the Main FSM (a Moore machine, the outputs of STATE_OUTPUTS), the
// Instr Decoder of Table 7.6 (RegSrc1 = (Op == 01), RegSrc0 = (Op == 10), ImmSrc = Op, p. 417), the ALU Decoder and PC
// Logic of the single-cycle processor (p. 413), and the Conditional Logic: FlagWrite = FlagW AND CondEx; CondEx delayed
// by one edge (CondExDelayed, "so that updated condition flags are not seen until the end of an instruction",
// pp. 413-414) gates PCWrite = (PCS AND CondExDelayed) OR NextPC, RegWrite and MemWrite.
//
// A select the FSM leaves as don't-care (Fig 7.41 lists it only where its value matters, p. 414) is null in the table
// and drives 0. That choice matters in one place only: in MemAdr, ResultSrc 00 makes the R15 port read ALUOut, which
// holds the instruction's address + 8 from Decode, so STR R15 stores the address + 8 (PCStoreValue, DDI A2.3.2,
// A2-47) as in the single-cycle design.
//
// As in uarch/single.js, the model stops where the hardware would run a word wrongly (roadmap §1.3): a word outside the
// base set is an error in Decode; an unaligned LDR or STR whose condition passed is an error before its memory access;
// a write to R15 with bit 0 or bits 1:0 = 10 is an error before the edge that writes it (W-D32 Q3); a fetch where no
// instruction was assembled is an error in Fetch (W-D34). B . with condition AL ends the program at the edge that ends
// its Branch state (A1-Q1). The register file holds R0-R14; a write with Rd = 15 goes to the PC only (roadmap §3.1,
// Writeback). Registers and flags start as in the instruction-level engine (SP at STACK_TOP, the rest 0); the
// non-architectural registers start at 0 and the FSM in Fetch (p. 414). Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { decode, STACK_TOP, HALT_WORD, withinTier } from '../language.js';
import { Memory, passed } from '../engine.js';
import { aluDecode, alu, extend } from './single.js';
import { ARMV7_STRINGS as S } from '../strings.js';

/** The ten states of the Main FSM (Fig 7.41, p. 423), S0 to S9 in order. */
export const STATES = Object.freeze(['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB', 'MemWrite', 'ExecuteR', 'ExecuteI', 'ALUWB', 'Branch']);
export const STATE_CODE = Object.freeze(Object.fromEntries(STATES.map((s, i) => [s, i])));

/** The Main FSM's outputs, in the order of Fig 7.31(b): enables, then selects. */
export const FSM_OUTPUTS = Object.freeze(['NextPC', 'Branch', 'MemW', 'RegW', 'IRWrite', 'AdrSrc', 'ResultSrc', 'ALUSrcA', 'ALUSrcB', 'ALUOp']);

/**
 * The outputs of each state (Fig 7.41, p. 423; Figs 7.32-7.40, pp. 416-422). Enables not listed in the figure are 0;
 * a select not listed is a don't-care, null here, and drives 0 (see the head of this file).
 */
const row = (state, o) => ({ state, NextPC: 0, Branch: 0, MemW: 0, RegW: 0, IRWrite: 0, AdrSrc: null, ResultSrc: null, ALUSrcA: null, ALUSrcB: null, ALUOp: 0, ...o });
export const STATE_OUTPUTS = Object.freeze([
  row('Fetch', { AdrSrc: 0, ALUSrcA: 1, ALUSrcB: 0b10, ResultSrc: 0b10, IRWrite: 1, NextPC: 1 }),
  row('Decode', { ALUSrcA: 1, ALUSrcB: 0b10, ResultSrc: 0b10 }),
  row('MemAdr', { ALUSrcA: 0, ALUSrcB: 0b01 }),
  row('MemRead', { ResultSrc: 0b00, AdrSrc: 1 }),
  row('MemWB', { ResultSrc: 0b01, RegW: 1 }),
  row('MemWrite', { ResultSrc: 0b00, AdrSrc: 1, MemW: 1 }),
  row('ExecuteR', { ALUSrcA: 0, ALUSrcB: 0b00, ALUOp: 1 }),
  row('ExecuteI', { ALUSrcA: 0, ALUSrcB: 0b01, ALUOp: 1 }),
  row('ALUWB', { ResultSrc: 0b00, RegW: 1 }),
  row('Branch', { ALUSrcA: 0, ALUSrcB: 0b01, ResultSrc: 0b10, Branch: 1 }),
].map(Object.freeze));

/** The transitions (Fig 7.41): from Decode by Op and Funct5, from MemAdr by Funct0; null for an Op the FSM lacks. */
export function nextState(state, Op, Funct) {
  switch (state) {
    case 'Fetch': return 'Decode';
    case 'Decode':
      if (Op === 0b01) return 'MemAdr';
      if (Op === 0b00) return (Funct >>> 5) & 1 ? 'ExecuteI' : 'ExecuteR';
      if (Op === 0b10) return 'Branch';
      return null;
    case 'MemAdr': return Funct & 1 ? 'MemRead' : 'MemWrite';
    case 'MemRead': return 'MemWB';
    case 'ExecuteR': case 'ExecuteI': return 'ALUWB';
    default: return 'Fetch';
  }
}

/** The Instr Decoder (Table 7.6, p. 416, simplified on p. 417): RegSrc and ImmSrc from Op. */
export function instrDecode(Op) {
  return { RegSrc: ((Op === 0b01 ? 1 : 0) << 1) | (Op === 0b10 ? 1 : 0), ImmSrc: Op & 3 };
}

const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;

export class ArmMulti {
  constructor({ historyLimit = 100_000 } = {}) {
    this.historyLimit = historyLimit;
    this.load({ segments: [] });
  }

  /** Load an assembled program (or {segments}) and reset. */
  load(program) {
    this.program = program;
    this.code = (program.segments ?? []).filter((s) => s.executable).map((s) => [s.address, s.address + s.bytes.length]);
    this.reset();
  }

  reset() {
    this.mem = new Memory();
    for (const s of this.program.segments ?? []) for (let i = 0; i < s.bytes.length; i++) if (s.bytes[i]) this.mem.write8(s.address + i, s.bytes[i]);
    this.R = new Uint32Array(15); // R0-R14; R15 is the PC
    this.R[13] = STACK_TOP;
    this.F = { N: 0, Z: 0, C: 0, V: 0 };
    this.pc = (this.program.entry ?? 0) >>> 0;
    // the non-architectural registers and the delayed CondEx (state, restored by back())
    Object.assign(this, { IR: 0, Data: 0, A: 0, WD: 0, ALUOut: 0, CondExDelayed: 0 });
    this.state = 'Fetch';
    this.at = this.pc; // the address of the instruction in IR: bookkeeping for the display, not a register of the design
    this.cycle = 0;
    this.retired = 0; // instructions completed (the last state of each returns to Fetch)
    this.halted = false;
    this.error = null;
    this.history = []; // per edge: the state before it and what it wrote; newest last
    this.dropped = 0;
    this.cache = null;
  }

  inCode(a) { return this.code.some(([lo, hi]) => a >= lo && a + 4 <= hi); }

  /** Address of the instruction the current cycle works on. */
  get instrAddress() { return this.state === 'Fetch' ? this.pc : this.at; }

  /** Every signal of the current cycle, the state-output row, the decoder rows used, and the instruction's decoding. */
  evaluate() {
    if (this.cache) return this.cache;
    const s = {};
    const st = STATE_CODE[this.state];
    const out = STATE_OUTPUTS[st];
    s.state = st;
    for (const k of FSM_OUTPUTS) s[k] = out[k] ?? 0;
    // the instruction register and its fields
    const w = this.IR;
    s.Instr = w;
    s.Cond = w >>> 28;
    s.Op = (w >>> 26) & 3;
    s.Funct = (w >>> 20) & 63;
    s.Rn = (w >>> 16) & 15;
    s.Rd = (w >>> 12) & 15;
    s.Rm = w & 15;
    s.Imm24 = w & 0xffffff;
    const id = instrDecode(s.Op);
    s.RegSrc = id.RegSrc;
    s.ImmSrc = id.ImmSrc;
    const a = aluDecode(s.ALUOp, s.Funct);
    s.ALUControl = a.ALUControl;
    s.FlagW = a.FlagW;
    s.PCS = ((s.Rd === 15 && s.RegW) || s.Branch) ? 1 : 0; // PC Logic, as single-cycle (p. 413)
    // the registers' outputs
    s.PC = this.pc;
    s.A = this.A;
    s.WriteData = this.WD;
    s.ALUOut = this.ALUOut;
    s.Data = this.Data;
    s.Flags = flagsOf(this.F);
    s.CondExDelayed = this.CondExDelayed;
    // the ALU and the Result multiplexer come before the register file: Result drives its R15 input
    s.ExtImm = extend(s.Imm24, s.ImmSrc);
    s.SrcA = s.ALUSrcA ? this.pc : this.A;
    s.SrcB = [this.WD, s.ExtImm, 4, 0][s.ALUSrcB];
    [s.ALUResult, s.ALUFlags] = alu(s.SrcA, s.SrcB, s.ALUControl);
    s.Result = [this.ALUOut, this.Data, s.ALUResult, 0][s.ResultSrc];
    s.RA1 = s.RegSrc & 1 ? 15 : s.Rn;
    s.RA2 = s.RegSrc & 2 ? s.Rd : s.Rm;
    const read = (n) => (n === 15 ? s.Result : this.R[n]);
    s.RD1 = read(s.RA1);
    s.RD2 = read(s.RA2);
    s.Adr = s.AdrSrc ? this.ALUOut : this.pc;
    s.ReadData = this.mem.read((s.Adr & ~3) >>> 0, 4); // the memory ignores Adr1:0; an unaligned access stops in step()
    // the Conditional Logic (Fig 7.31c)
    s.CondEx = passed(s.Cond, this.F) ? 1 : 0;
    s.FlagWrite = s.CondEx ? s.FlagW : 0;
    s.PCSGated = s.PCS & s.CondExDelayed;
    s.PCWrite = s.PCSGated | s.NextPC;
    s.RegWrite = s.RegW & s.CondExDelayed;
    s.MemWrite = s.MemW & s.CondExDelayed;
    const next = nextState(this.state, s.Op, s.Funct);
    s.next = next === null ? st : STATE_CODE[next];
    const d = decode(this.state === 'Fetch' ? s.ReadData : w);
    this.cache = {
      signals: s, state: this.state, next, d,
      rows: { state: st, alu: s.ALUOp ? a.index : 0 },
      cls: this.state === 'Fetch' ? null : classOf(s.Op, s.Funct),
      halt: this.state === 'Branch' && w === HALT_WORD,
      access: this.state === 'MemRead' ? { kind: 'load', size: 4 } : this.state === 'MemWrite' ? { kind: 'store', size: 4 } : null,
      tier: 'H',
    };
    return this.cache;
  }

  /**
   * Apply one clock edge. Returns 'halt' after the Branch state of B . (executed), 'error' (this.error set) for a word
   * the base processor does not run or a rule of W-D32 Q3, otherwise 'step'.
   */
  step() {
    if (this.halted) return 'halt';
    if (this.error) return 'error';
    const c = this.evaluate();
    const s = c.signals;
    const at = this.instrAddress;
    const fail = (msg) => { this.error = msg; return 'error'; };
    if (c.state === 'Fetch' && !this.inCode(s.PC)) return fail(S.engine.noCode(s.PC));
    if (c.state === 'Decode') {
      const d = c.d;
      if (d.bad) return fail(S.engine.notRun(s.Instr, at, S.outOfScope[d.bad]));
      if (d.unpredictable) return fail(S.engine.unpredictable(s.Instr, at, S.unpredictable[d.unpredictable]));
      if (!withinTier(d.tier, c.tier)) return fail(c.tier === 'H' ? S.multi.notBase(s.Instr, at, d.name, d.tier) : S.multi.notExtended(s.Instr, at, d.name));
    }
    if (c.access?.size === 4 && s.CondExDelayed && (s.Adr & 3)) return fail(S.engine.unaligned(c.access.kind, s.Adr, at));
    if (s.PCWrite && !s.NextPC && !s.Branch) {
      if (s.Result & 1) return fail(S.engine.thumb(s.Result, at));
      if (s.Result & 2) return fail(S.engine.pcHalf(s.Result, at));
    }
    const done = c.next === 'Fetch';
    const rec = { state: this.state, pc: this.pc, IR: this.IR, Data: this.Data, A: this.A, WD: this.WD, ALUOut: this.ALUOut,
      CondExDelayed: this.CondExDelayed, flags: s.Flags, at: this.at, reg: null, mem: null, done };
    const wa3 = c.wa3 ?? s.Rd; // the register the write port addresses (the Extended processor's A3 multiplexer)
    if (s.RegWrite && wa3 !== 15) {
      rec.reg = [wa3, this.R[wa3]];
      this.R[wa3] = s.Result;
    }
    if (s.MemWrite) {
      rec.mem = [s.Adr, this.mem.read(s.Adr, 4)];
      this.mem.write(s.Adr, 4, this.WD);
    }
    if (s.FlagWrite & 2) { this.F.N = (s.ALUFlags >>> 3) & 1; this.F.Z = (s.ALUFlags >>> 2) & 1; }
    if (s.FlagWrite & 1) { this.F.C = (s.ALUFlags >>> 1) & 1; this.F.V = s.ALUFlags & 1; }
    if (s.IRWrite) { this.IR = s.ReadData; this.at = this.pc; }
    this.Data = s.DataIn ?? s.ReadData; // the Extended processor's Byte unit
    this.A = s.RD1;
    this.WD = s.RD2;
    this.ALUOut = s.ALUResult;
    this.CondExDelayed = s.CondEx;
    if (s.PCWrite) this.pc = s.Result;
    this.state = c.next;
    this.cycle += 1;
    if (done) this.retired += 1;
    this.remember(rec);
    this.cache = null;
    if (c.halt && s.CondExDelayed) { this.halted = true; return 'halt'; }
    return 'step';
  }

  remember(rec) {
    this.history.push(rec);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
      this.dropped += 1;
    }
  }

  /** Undo the last clock edge. Returns false if nothing is left. */
  back() {
    if (this.error) { this.error = null; this.cache = null; return true; }
    const r = this.history.pop();
    if (!r) return false;
    if (r.mem) this.mem.write(r.mem[0], 4, r.mem[1]);
    if (r.reg) this.R[r.reg[0]] = r.reg[1];
    this.F = { N: (r.flags >>> 3) & 1, Z: (r.flags >>> 2) & 1, C: (r.flags >>> 1) & 1, V: r.flags & 1 };
    Object.assign(this, { state: r.state, pc: r.pc, IR: r.IR, Data: r.Data, A: r.A, WD: r.WD, ALUOut: r.ALUOut, CondExDelayed: r.CondExDelayed, at: r.at });
    this.cycle -= 1;
    if (r.done) this.retired -= 1;
    this.halted = false;
    this.cache = null;
    return true;
  }

  /** Clock cycles up to the next Fetch: the rest of this instruction. Returns as step(). */
  stepInstruction() {
    let r;
    do r = this.step(); while (r === 'step' && this.state !== 'Fetch');
    return r;
  }

  /** Undo cycles back to the Fetch of this instruction, or of the one before when at a Fetch. */
  backInstruction() {
    if (!this.back()) return false;
    while (this.state !== 'Fetch' && this.back());
    return true;
  }

  /** What the last edge changed and the state before it, or null. */
  get last() {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  /** Run to the halt or an error; throws after `limit` cycles. Returns the stop reason. */
  run(limit = 1_000_000) {
    for (;;) {
      if (this.cycle >= limit) throw new Error(`no halt within ${limit} cycles`);
      const r = this.step();
      if (r !== 'step') return r;
    }
  }

  /** The architectural state in the instruction-level engine's register record: r0-r15 (r15 the PC), N, Z, C, V. */
  registers() {
    return { ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i}`, i === 15 ? this.pc : this.R[i]])), ...this.F };
  }
}

/** The instruction class of Op and Funct, as the single-cycle Main Decoder's rows name them, or null. */
export function classOf(Op, Funct) {
  if (Op === 0b00) return (Funct >>> 5) & 1 ? 'dpImm' : 'dpReg';
  if (Op === 0b01) return Funct & 1 ? 'ldr' : 'str';
  if (Op === 0b10) return 'b';
  return null;
}

/** The states an instruction of each class passes through (roadmap §4.5; Example 7.5, p. 424). */
export const SEQUENCES = Object.freeze({
  b: ['Fetch', 'Decode', 'Branch'],
  dpReg: ['Fetch', 'Decode', 'ExecuteR', 'ALUWB'],
  dpImm: ['Fetch', 'Decode', 'ExecuteI', 'ALUWB'],
  str: ['Fetch', 'Decode', 'MemAdr', 'MemWrite'],
  ldr: ['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB'],
});
