// armv7/uarch/single.js -- the ARM single-cycle processor at signal level (roadmap milestone ARM-A2, §3): the base
// design of Harris and Harris, DDCA ARM ed., Fig 7.13 (p. 399), with the controller of Fig 7.14 (pp. 400-401). One step
// is one clock cycle and one instruction. evaluate() computes every signal of the roadmap's dictionary (§3.2,
// uarch/signals.js) from the state in the data-flow order of the datapath; step() applies the clock edge. The decoders
// are the tables below: the facts of Tables 7.2 and 7.3 with the values the single-cycle HDL's `decoder` gives the
// don't-cares (roadmap §3.3).
//
// Where the hardware would run a word wrongly (roadmap §1.3: rotations, shifts and the P, U, B, W bits ignored, BL as
// B), the model stops instead: a word outside the base set (tier H of the reference sheet) is an error, as are the
// rules of W-D32 Q3 (an unaligned LDR or STR, a write to R15 with bit 0 or bits 1:0 = 10) and of W-D34 (a fetch where
// no instruction was assembled). B . with condition AL is executed and ends the program (A1-Q1), as in the
// instruction-level engine. The register file holds R0-R14 (R15 reads as PCPlus8); a write with Rd = 15 goes to the
// PC only (roadmap §3.1, Writeback). Memories: Harvard, the code segments in the instruction memory and the data
// segments in the data memory, both sparse and byte-addressed; registers and flags start as in the instruction-level
// engine (SP at STACK_TOP, the rest 0). Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { decode, STACK_TOP, HALT_WORD, withinTier } from '../language.js';
import { Memory, passed } from '../engine.js';
import { ARMV7_STRINGS as S } from '../strings.js';

/**
 * The Main Decoder (Table 7.2, p. 401): one row per instruction class, matched on Op, Funct5 (I) and Funct0 (L);
 * null matches anything. The values are those of the HDL where the table has a don't-care (roadmap §3.3).
 */
export const MAIN_DECODER = Object.freeze([
  { cls: 'dpReg', Op: 0b00, Funct5: 0, Funct0: null, RegSrc: 0b00, ImmSrc: 0b00, ALUSrc: 0, MemtoReg: 0, RegW: 1, MemW: 0, Branch: 0, ALUOp: 1 },
  { cls: 'dpImm', Op: 0b00, Funct5: 1, Funct0: null, RegSrc: 0b00, ImmSrc: 0b00, ALUSrc: 1, MemtoReg: 0, RegW: 1, MemW: 0, Branch: 0, ALUOp: 1 },
  { cls: 'ldr', Op: 0b01, Funct5: null, Funct0: 1, RegSrc: 0b00, ImmSrc: 0b01, ALUSrc: 1, MemtoReg: 1, RegW: 1, MemW: 0, Branch: 0, ALUOp: 0 },
  { cls: 'str', Op: 0b01, Funct5: null, Funct0: 0, RegSrc: 0b10, ImmSrc: 0b01, ALUSrc: 1, MemtoReg: 1, RegW: 0, MemW: 1, Branch: 0, ALUOp: 0 },
  { cls: 'b', Op: 0b10, Funct5: null, Funct0: null, RegSrc: 0b01, ImmSrc: 0b10, ALUSrc: 1, MemtoReg: 0, RegW: 0, MemW: 0, Branch: 1, ALUOp: 0 },
]);
export const MAIN_OUTPUTS = Object.freeze(['RegSrc', 'ImmSrc', 'ALUSrc', 'MemtoReg', 'RegW', 'MemW', 'Branch', 'ALUOp']);

/**
 * The ALU Decoder (Table 7.3, p. 401): ALUOp, cmd (Funct4:1) and S (Funct0) -> ALUControl and FlagW. FlagW1 = S;
 * FlagW0 = S for ADD and SUB only (C and V come from the adder).
 */
export const ALU_DECODER = Object.freeze([
  { ALUOp: 0, cmd: null, S: null, name: null, ALUControl: 0b00, FlagW: 0b00 },
  { ALUOp: 1, cmd: 0b0100, S: 0, name: 'ADD', ALUControl: 0b00, FlagW: 0b00 },
  { ALUOp: 1, cmd: 0b0100, S: 1, name: 'ADD', ALUControl: 0b00, FlagW: 0b11 },
  { ALUOp: 1, cmd: 0b0010, S: 0, name: 'SUB', ALUControl: 0b01, FlagW: 0b00 },
  { ALUOp: 1, cmd: 0b0010, S: 1, name: 'SUB', ALUControl: 0b01, FlagW: 0b11 },
  { ALUOp: 1, cmd: 0b0000, S: 0, name: 'AND', ALUControl: 0b10, FlagW: 0b00 },
  { ALUOp: 1, cmd: 0b0000, S: 1, name: 'AND', ALUControl: 0b10, FlagW: 0b10 },
  { ALUOp: 1, cmd: 0b1100, S: 0, name: 'ORR', ALUControl: 0b11, FlagW: 0b00 },
  { ALUOp: 1, cmd: 0b1100, S: 1, name: 'ORR', ALUControl: 0b11, FlagW: 0b10 },
]);

const fit = (p, v) => p === null || p === v;

/** The Main Decoder's row for Op and Funct: its index and outputs, or index -1 and all zeros. */
export function mainDecode(Op, Funct) {
  const i = MAIN_DECODER.findIndex((r) => r.Op === Op && fit(r.Funct5, (Funct >>> 5) & 1) && fit(r.Funct0, Funct & 1));
  const r = MAIN_DECODER[i];
  return { index: i, cls: r?.cls ?? null, ...Object.fromEntries(MAIN_OUTPUTS.map((k) => [k, r ? r[k] : 0])) };
}

/** The ALU Decoder's row for ALUOp and Funct: its index, ALUControl and FlagW (index -1, zeros: undefined in Harris). */
export function aluDecode(ALUOp, Funct) {
  const cmd = (Funct >>> 1) & 15;
  const i = ALU_DECODER.findIndex((r) => r.ALUOp === ALUOp && fit(r.cmd, cmd) && fit(r.S, Funct & 1));
  return { index: i, ALUControl: i < 0 ? 0 : ALU_DECODER[i].ALUControl, FlagW: i < 0 ? 0 : ALU_DECODER[i].FlagW };
}

/** The ALU (HDL `alu`): [ALUResult, ALUFlags {N, Z, C, V} as bits 3:0]. C and V are 0 for AND and ORR. */
export function alu(a, b, ALUControl) {
  const sub = ALUControl & 1;
  const sum = (a >>> 0) + ((sub ? ~b : b) >>> 0) + sub;
  const result = [sum >>> 0, sum >>> 0, (a & b) >>> 0, (a | b) >>> 0][ALUControl];
  const arith = (ALUControl & 2) === 0;
  const N = result >>> 31;
  const Z = result === 0 ? 1 : 0;
  const C = arith && sum > 0xffffffff ? 1 : 0;
  const V = arith && ((~(sub ^ (a >>> 31) ^ (b >>> 31)) & ((a >>> 31) ^ ((sum >>> 31) & 1))) & 1) ? 1 : 0;
  return [result, (N << 3) | (Z << 2) | (C << 1) | V];
}

/** Extend (Table 7.1, p. 397): ImmSrc 00 zero-extends Instr7:0, 01 Instr11:0, 10 sign-extends Instr23:0 times 4. */
export function extend(Imm24, ImmSrc) {
  if (ImmSrc === 0b00) return Imm24 & 0xff;
  if (ImmSrc === 0b01) return Imm24 & 0xfff;
  return ((Imm24 << 8) >> 6) >>> 0;
}

const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;

export class ArmSingle {
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
    this.imem = new Memory();
    this.dmem = new Memory();
    for (const s of this.program.segments ?? []) {
      const m = s.executable ? this.imem : this.dmem;
      for (let i = 0; i < s.bytes.length; i++) if (s.bytes[i]) m.write8(s.address + i, s.bytes[i]);
    }
    this.R = new Uint32Array(15); // R0-R14; R15 is the PC
    this.R[13] = STACK_TOP;
    this.F = { N: 0, Z: 0, C: 0, V: 0 };
    this.pc = (this.program.entry ?? 0) >>> 0;
    this.cycle = 0;
    this.halted = false;
    this.error = null;
    this.history = []; // {pc, flags, reg: [n, old] | null, mem: [address, old] | null}, newest last
    this.dropped = 0;
    this.cache = null;
  }

  inCode(a) { return this.code.some(([lo, hi]) => a >= lo && a + 4 <= hi); }

  /** Every signal of the current cycle, the decoder rows used, and the instruction's class and decoding. */
  evaluate() {
    if (this.cache) return this.cache;
    const s = {};
    const pc = this.pc;
    s.PC = pc;
    s.Instr = this.inCode(pc) ? this.imem.read(pc, 4) : 0;
    const w = s.Instr;
    s.Cond = w >>> 28;
    s.Op = (w >>> 26) & 3;
    s.Funct = (w >>> 20) & 63;
    s.Rn = (w >>> 16) & 15;
    s.Rd = (w >>> 12) & 15;
    s.Rm = w & 15;
    s.Imm24 = w & 0xffffff;
    const m = mainDecode(s.Op, s.Funct);
    for (const k of MAIN_OUTPUTS) s[k] = m[k];
    const a = aluDecode(s.ALUOp, s.Funct);
    s.ALUControl = a.ALUControl;
    s.FlagW = a.FlagW;
    s.PCS = ((s.Rd === 15 && s.RegW) || s.Branch) ? 1 : 0; // PC Logic (p. 400)
    s.PCPlus4 = (pc + 4) >>> 0;
    s.PCPlus8 = (s.PCPlus4 + 4) >>> 0;
    s.RA1 = s.RegSrc & 1 ? 15 : s.Rn;
    s.RA2 = s.RegSrc & 2 ? s.Rd : s.Rm;
    const read = (n) => (n === 15 ? s.PCPlus8 : this.R[n]);
    s.SrcA = read(s.RA1);
    s.WriteData = read(s.RA2);
    s.ExtImm = extend(s.Imm24, s.ImmSrc);
    s.SrcB = s.ALUSrc ? s.ExtImm : s.WriteData;
    [s.ALUResult, s.ALUFlags] = alu(s.SrcA, s.SrcB, s.ALUControl);
    s.Flags = flagsOf(this.F);
    s.CondEx = passed(s.Cond, this.F) ? 1 : 0; // Condition Check (Fig 7.14c)
    s.FlagWrite = s.CondEx ? s.FlagW : 0;
    s.RegWrite = s.RegW & s.CondEx;
    s.MemWrite = s.MemW & s.CondEx;
    s.PCSrc = s.PCS & s.CondEx;
    s.ReadData = this.dmem.read((s.ALUResult & ~3) >>> 0, 4); // the memory ignores A1:0; an unaligned access stops in step()
    s.Result = s.MemtoReg ? s.ReadData : s.ALUResult;
    s.PCNext = s.PCSrc ? s.Result : s.PCPlus4;
    const d = decode(w);
    this.cache = {
      signals: s, cls: m.cls, d,
      rows: { main: m.index, alu: s.ALUOp ? a.index : 0 },
      halt: w === HALT_WORD && this.inCode(pc),
      wa3: s.Rd, // the register the write port addresses
      access: s.MemW ? { kind: 'store', size: 4 } : s.MemtoReg && s.RegW ? { kind: 'load', size: 4 } : null,
      tier: 'H',
    };
    return this.cache;
  }

  /**
   * Apply one clock edge. Returns 'halt' after B . (executed), 'error' (this.error set) for a word the base processor
   * does not run or a rule of W-D32 Q3, otherwise 'step'.
   */
  step() {
    if (this.halted) return 'halt';
    if (this.error) return 'error';
    const c = this.evaluate();
    const s = c.signals;
    const d = c.d;
    const fail = (msg) => { this.error = msg; return 'error'; };
    if (!this.inCode(s.PC)) return fail(S.engine.noCode(s.PC));
    if (d.bad) return fail(S.engine.notRun(s.Instr, s.PC, S.outOfScope[d.bad]));
    if (d.unpredictable) return fail(S.engine.unpredictable(s.Instr, s.PC, S.unpredictable[d.unpredictable]));
    if (!withinTier(d.tier, c.tier)) return fail(c.tier === 'H' ? S.single.notBase(s.Instr, s.PC, d.name, d.tier) : S.single.notExtended(s.Instr, s.PC, d.name));
    if (s.CondEx && c.access?.size === 4 && (s.ALUResult & 3)) return fail(S.engine.unaligned(c.access.kind, s.ALUResult, s.PC));
    if (s.PCSrc && !s.Branch) {
      if (s.Result & 1) return fail(S.engine.thumb(s.Result, s.PC));
      if (s.Result & 2) return fail(S.engine.pcHalf(s.Result, s.PC));
    }
    const rec = { pc: s.PC, flags: s.Flags, reg: null, mem: null };
    if (s.RegWrite && c.wa3 !== 15) {
      rec.reg = [c.wa3, this.R[c.wa3]];
      this.R[c.wa3] = s.Result;
    }
    if (s.MemWrite) {
      rec.mem = [s.ALUResult, this.dmem.read(s.ALUResult, 4)];
      this.dmem.write(s.ALUResult, 4, s.WriteData);
    }
    if (s.FlagWrite & 2) { this.F.N = (s.ALUFlags >>> 3) & 1; this.F.Z = (s.ALUFlags >>> 2) & 1; }
    if (s.FlagWrite & 1) { this.F.C = (s.ALUFlags >>> 1) & 1; this.F.V = s.ALUFlags & 1; }
    this.pc = s.PCNext;
    this.cycle += 1;
    this.remember(rec);
    this.cache = null;
    if (c.halt && s.CondEx) { this.halted = true; return 'halt'; }
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
    if (r.mem) this.dmem.write(r.mem[0], 4, r.mem[1]);
    if (r.reg) this.R[r.reg[0]] = r.reg[1];
    this.F = { N: (r.flags >>> 3) & 1, Z: (r.flags >>> 2) & 1, C: (r.flags >>> 1) & 1, V: r.flags & 1 };
    this.pc = r.pc;
    this.cycle -= 1;
    this.halted = false;
    this.cache = null;
    return true;
  }

  /** What the last edge changed: {pc, flags, reg, mem} or null. */
  get last() {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  /** Run to the halt or an error; throws after `limit` cycles. Returns the stop reason. */
  run(limit = 100_000) {
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
