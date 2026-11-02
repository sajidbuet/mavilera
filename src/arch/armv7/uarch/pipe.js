// armv7/uarch/pipe.js -- the ARM five-stage pipelined processor at signal level (roadmap milestone ARM-A4, §5): the
// base design of Harris and Harris, DDCA ARM ed., §7.5, with full hazard handling as in Fig 7.58 (p. 441). One step is
// one clock cycle. evaluate() computes every signal of the dictionary (uarch/signals.js, PIPE_SIGNALS) from the state:
// the PC, the four pipeline registers, the flags register FlagsE, the register file and the two memories; step()
// applies the clock edge. Harris's names, stage suffixes F, D, E, M, W (spec W-D32 Q4); the view labels the stages
// IF, ID, EX, MEM, WB (Q5).
//
// The datapath (Figs 7.45-7.47, pp. 429-430): the register file is written in the first half of the cycle and read in
// the second (p. 431), so a register written by Writeback reads as its new value in Decode; its R15 input is
// PCPlus8D = PCPlus4F (Fig 7.46). The control unit is the single-cycle one (p. 430; uarch/single.js MAIN_DECODER and
// ALU_DECODER, including the HDL's values for the don't-cares, roadmap §3.3: STR has MemtoReg 1, author A4-Q3). Its
// PC output, PCSrcD, is (Rd == 15) AND RegW only: "PCSrcW is now only asserted for writes to the PC" (p. 438; roadmap
// §5.5, decision Q6). The Cond Unit, in Execute, holds the flags register FlagsE and computes CondExE and Flags' from
// CondE, FlagsE, ALUFlags and FlagWriteE; RegWrite, MemWrite and PCSrc are gated by CondExE on their way into the
// Memory stage (Fig 7.47). A taken branch is resolved in Execute: BranchTakenE = BranchE AND CondExE selects
// ALUResultE as the next PC (Fig 7.57, p. 439). PC' = BranchTakenE ? ALUResultE : (PCSrcW ? ResultW : PCPlus4F).
//
// The Hazard Unit (pp. 433-440, roadmap §5.3-§5.4): ForwardAE/BE (10 from the Memory stage before 01 from Writeback),
// LDRstall = Match_12D_E AND MemtoRegE, PCWrPendingF = PCSrcD OR PCSrcE OR PCSrcM, StallD = LDRstall,
// FlushE = LDRstall OR BranchTakenE, FlushD = PCWrPendingF OR PCSrcW OR BranchTakenE, and
//   StallF = (LDRstall OR PCWrPendingF) AND NOT BranchTakenE.
// The last term, AND NOT BranchTakenE, is this application's correction of p. 440 (author decision A4-Q2, discrepancy
// D15): with the textbook's StallF = LDRstall OR PCWrPendingF, a taken branch in Execute followed by a write to R15 in
// Decode (BEQ L, then MOV PC, LR) stalls the PC, so the branch target is never loaded, while FlushD and FlushE remove
// the write: the fall-through instruction runs. StallFTextbook is the textbook's value, for the view's mark.
//
// The Fetch/Decode register holds when StallD is 1, even if FlushD is 1 too: a register with an enable and a clear is
// cleared only when it is enabled (the Harris HDL's flopenrc; inferred for this design, whose HDL the textbook leaves to
// Exercise 7.40). Both are 1 when a write to R15 waits in Decode for a load (LDR R1, then MOV PC, R1): clearing would
// lose the write. A flushed register is a bubble: every control bit 0 (roadmap §5.4). The Fetch/Decode register holds
// only InstrD, which Harris's hardware clears to 0x00000000 (ANDEQ R0, R0, R0, harmless); the model marks the
// bubble and gives it all-zero controls, while the Hazard Unit still compares its register fields (RA1D = RA2D = 0).
//
// Hazard modes (teaching switches, roadmap ARM-A4): 'full' (Fig 7.58), 'forward' (forwarding only: no stall and no
// flush) and 'none' (neither). Without the full unit, the instructions after a taken branch or a write to R15 run on
// the wrong path and an operand may be stale; the model records both (stats, instances) and goes on.
//
// Errors (W-D32 Q3, W-D34): an instruction that reaches Execute stops the run if it is outside the base set or
// UNPREDICTABLE, or was fetched where no instruction was assembled; an unaligned LDR or STR whose condition passed
// stops in Execute; a write to R15 with bit 0 or bits 1:0 = 10 stops in Writeback, before the edge that writes it.
// Execute is the first stage from which no flush can remove an instruction (without the full Hazard Unit, a word
// fetched past the program on the wrong path is not an error: it runs as the 0x00000000 the memory gives). errorStage
// names the stage of the instruction the error is about. B . with condition AL ends the program
// when it reaches Writeback (no further edge), every older instruction having written (A1-Q1). Registers and flags
// start as in the instruction-level engine (SP at STACK_TOP); the pipeline registers start as bubbles and the PC at
// the entry. Memories: Harvard, as the single-cycle model. Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { decode, STACK_TOP, HALT_WORD, withinTier } from '../language.js';
import { Memory, passed } from '../engine.js';
import { mainDecode, aluDecode, alu, extend } from './single.js';
import { ARMV7_STRINGS as S } from '../strings.js';

export const HAZARD_MODES = Object.freeze(['none', 'forward', 'full']);
export const STAGES = Object.freeze(['IF', 'ID', 'EX', 'MEM', 'WB']);

// The pipeline registers' contents (Figs 7.47, 7.58). Fields after the comment are bookkeeping for the display and the
// tests, not hardware: seq names the instruction (or load-use bubble) in the pipeline diagram, at its address, instr its
// word (Harris carries the word only to Decode), bubble marks a cleared register.
const DREG = Object.freeze({ InstrD: 0, /* */ seq: 0, at: 0, bubble: 1 });
const EREG = Object.freeze({
  RD1E: 0, RD2E: 0, ExtImmE: 0, WA3E: 0, RA1E: 0, RA2E: 0, CondE: 0,
  PCSrcE: 0, RegWriteE: 0, MemtoRegE: 0, MemWriteE: 0, ALUControlE: 0, BranchE: 0, ALUSrcE: 0, FlagWriteE: 0,
  /* */ seq: 0, at: 0, instr: 0, bubble: 1,
});
const MREG = Object.freeze({
  ALUOutM: 0, WriteDataM: 0, WA3M: 0, PCSrcM: 0, RegWriteM: 0, MemtoRegM: 0, MemWriteM: 0,
  /* */ seq: 0, at: 0, instr: 0, bubble: 1, exec: 0, flags: 0,
});
const WREG = Object.freeze({
  ALUOutW: 0, ReadDataW: 0, WA3W: 0, PCSrcW: 0, RegWriteW: 0, MemtoRegW: 0,
  /* */ seq: 0, at: 0, instr: 0, bubble: 1, exec: 0, flags: 0,
});

const REGS = Object.freeze({ D: DREG, E: EREG, M: MREG, W: WREG });

const STATS = Object.freeze({
  retired: 0, loads: 0, branches: 0, taken: 0, pcWrites: 0, loadUse: 0, unneeded: 0, pcWait: 0, flushed: 0, corrected: 0,
  stale: 0, wrongPath: 0,
});

const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;
const bit = (v) => (v ? 1 : 0);

/**
 * The registers an instruction really reads, by class: data-processing Rn (and Rm with a register operand), LDR Rn,
 * STR Rn and Rd, B none. The Hazard Unit compares RA1D and RA2D whatever the class (Harris-faithful, A4-Q1); this set
 * tells the view when a stall was needed by no register.
 */
export function sourcesOf(cls, w) {
  const Rn = (w >>> 16) & 15;
  const Rd = (w >>> 12) & 15;
  const Rm = w & 15;
  switch (cls) {
    case 'dpReg': return [Rn, Rm];
    case 'dpImm': case 'ldr': return [Rn];
    case 'str': return [Rn, Rd];
    default: return [];
  }
}

export class ArmPipe {
  /** @param {{hazard?: 'none'|'forward'|'full', historyLimit?: number}} options */
  constructor({ hazard = 'full', historyLimit = 100_000 } = {}) {
    if (!HAZARD_MODES.includes(hazard)) throw new Error(`unknown hazard mode ${hazard}`);
    this.hazard = hazard;
    this.historyLimit = historyLimit;
    this.tier = 'H';
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
    this.R = new Uint32Array(15); // R0-R14; R15 is PCPlus8D when read, the PC when written
    this.R[13] = STACK_TOP;
    this.F = { N: 0, Z: 0, C: 0, V: 0 }; // FlagsE
    this.pcF = (this.program.entry ?? 0) >>> 0;
    ({ D: this.D, E: this.E, M: this.M, W: this.W } = this.regs);
    this.ifSeq = 1; // the instruction being fetched
    this.nextSeq = 2;
    this.cycle = 0;
    this.halted = false;
    this.error = null;
    this.errorStage = null; // 'EX' or 'WB': where the instruction the error names is
    this.stats = { ...STATS };
    this.history = []; // the state before each edge and what it wrote, newest last
    this.dropped = 0;
    // For the pipeline diagram: what each stage held in each cycle (trace) and what each seq is (instances). Kept when
    // stepping back, since stepping forward again repeats the same cycles; cleared by reset.
    this.trace = [];
    this.instances = new Map(); // seq -> {kind: 'instr'|'bubble', pc, instr, noCode, wrongPath}
    this.instances.set(1, this.fetched(this.pcF));
    this.cache = null;
  }

  inCode(a) { return this.code.some(([lo, hi]) => a >= lo && a + 4 <= hi); }

  fetched(pc) {
    const code = this.inCode(pc);
    return { kind: 'instr', pc, instr: code ? this.imem.read(pc, 4) : 0, noCode: !code, wrongPath: false };
  }

  /** The PC register (the fetch address). */
  get pc() { return this.pcF; }

  instance(seq) { return this.instances.get(seq) ?? null; }

  /** Every signal of the current cycle, with the decoder rows, the hazard reasons and the stage occupants. */
  evaluate() {
    if (this.cache) return this.cache;
    const s = {};
    const { D, E, M, W } = this;
    const full = this.hazard === 'full';

    // ---- Writeback and Memory: the registers' outputs, the result multiplexer, the data memory's read
    for (const k of Object.keys(this.regs.W)) if (/W$/.test(k)) s[k] = W[k];
    for (const k of Object.keys(this.regs.M)) if (/M$/.test(k)) s[k] = M[k];
    this.writeback(s);
    s.ReadDataM = this.dmem.read((s.ALUOutM & ~3) >>> 0, 4); // the memory ignores A1:0; an unaligned access stops in Execute

    // ---- Fetch (PCPlus4F is also the Decode stage's PCPlus8D)
    s.PCF = this.pcF;
    const fi = this.instance(this.ifSeq);
    s.InstrF = fi && !fi.noCode ? fi.instr : 0;
    s.PCPlus4F = (s.PCF + 4) >>> 0;

    // ---- Decode: fields, Control Unit, register file (write-first), Extend
    const w = D.InstrD;
    s.InstrD = w;
    s.Cond = w >>> 28;
    s.Op = (w >>> 26) & 3;
    s.Funct = (w >>> 20) & 63;
    s.Rn = (w >>> 16) & 15;
    s.Rd = (w >>> 12) & 15;
    s.Rm = w & 15;
    s.Imm24 = w & 0xffffff;
    const { m, a } = this.decodeStage(s, D);
    s.PCSrcD = bit(s.WA3D === 15 && s.RegWriteD); // writes to the PC only (p. 438)
    s.PCPlus8D = s.PCPlus4F;
    s.RA1D = s.RegSrcD & 1 ? 15 : s.Rn;
    s.RA2D = s.RegSrcD & 2 ? s.Rd : s.Rm;
    const read = (n) => (n === 15 ? s.PCPlus8D : s.RegWriteW && s.WA3W === n ? s.ResultW : this.R[n]);
    s.RD1D = read(s.RA1D);
    s.RD2D = read(s.RA2D);
    s.ExtImmD = extend(s.Imm24, s.ImmSrcD);

    // ---- Execute: the D/E register's outputs
    for (const k of Object.keys(this.regs.E)) if (/E$/.test(k)) s[k] = E[k];
    s.FlagsE = flagsOf(this.F);

    // ---- Hazard Unit: forwarding (§5.3)
    s.Match_1E_M = bit(s.RA1E === s.WA3M);
    s.Match_1E_W = bit(s.RA1E === s.WA3W);
    s.Match_2E_M = bit(s.RA2E === s.WA3M);
    s.Match_2E_W = bit(s.RA2E === s.WA3W);
    const forward = this.hazard !== 'none';
    const fwd = (mM, mW) => (!forward ? 0b00 : mM && s.RegWriteM ? 0b10 : mW && s.RegWriteW ? 0b01 : 0b00);
    s.ForwardAE = fwd(s.Match_1E_M, s.Match_1E_W);
    s.ForwardBE = fwd(s.Match_2E_M, s.Match_2E_W);
    const pick = (sel, own) => (sel === 0b10 ? s.ALUOutM : sel === 0b01 ? s.ResultW : own);

    // ---- Execute: datapath and Cond Unit
    s.SrcAE = pick(s.ForwardAE, s.RD1E);
    s.WriteDataE = pick(s.ForwardBE, s.RD2E);
    this.execute(s);
    s.CondExE = passed(s.CondE, this.F) ? 1 : 0;
    const fw = s.CondExE ? s.FlagWriteE : 0;
    s.FlagsNextE = ((fw & 2 ? s.ALUFlags : s.FlagsE) & 0b1100) | ((fw & 1 ? s.ALUFlags : s.FlagsE) & 0b0011); // Flags'
    s.BranchTakenE = s.BranchE & s.CondExE;

    // ---- Hazard Unit: stalls and flushes (§5.4)
    s.Match_12D_E = bit(s.RA1D === s.WA3E || s.RA2D === s.WA3E);
    const ldrStall = s.Match_12D_E & this.loadInE(s);
    s.LDRstall = full ? ldrStall : 0;
    s.PCWrPendingF = s.PCSrcD | s.PCSrcE | s.PCSrcM;
    s.StallFTextbook = full ? s.LDRstall | s.PCWrPendingF : 0;
    s.StallF = s.StallFTextbook & (s.BranchTakenE ^ 1); // A4-Q2, D15
    s.StallD = s.LDRstall;
    s.FlushE = full ? s.LDRstall | s.BranchTakenE : 0;
    s.FlushD = full ? s.PCWrPendingF | s.PCSrcW | s.BranchTakenE : 0;

    // ---- Fetch: next PC (Fig 7.58)
    s.PCMuxF = s.PCSrcW ? s.ResultW : s.PCPlus4F;
    s.PCNext = s.BranchTakenE ? s.ALUResultE : s.PCMuxF;

    // ---- what an operand of the instruction in Execute should have been: the newest value of its register (a load
    // in Memory supplies its data, not its address); differs only without the full Hazard Unit
    const want = (r, own) => {
      if (r === 15) return own;
      if (M.RegWriteM && M.WA3M === r) return this.resultOfM(s);
      if (W.RegWriteW && W.WA3W === r) return s.ResultW;
      return own;
    };
    const eCls = E.bubble ? null : this.classOfWord(E.instr);
    const eSrc = E.bubble ? [] : this.sources(eCls, E.instr);
    const stale = [];
    if (eSrc.includes(s.RA1E) && want(s.RA1E, s.RD1E) !== s.SrcAE) stale.push({ reg: s.RA1E, got: s.SrcAE, want: want(s.RA1E, s.RD1E), operand: 'a' });
    if (eSrc.includes(s.RA2E) && s.RA2E !== s.RA1E && want(s.RA2E, s.RD2E) !== s.WriteDataE) stale.push({ reg: s.RA2E, got: s.WriteDataE, want: want(s.RA2E, s.RD2E), operand: 'b' });

    // a load-use stall that no register needed: the instruction in Execute is not a load (STR: MemtoReg 1, A4-Q3), or
    // the matching field of the instruction in Decode is not one it reads (an immediate's bits, a branch; A4-Q1)
    const dCls = D.bubble ? null : this.classOfWord(w);
    const needed = ldrStall && this.access(eCls)?.kind === 'load' && this.sources(dCls, w).includes(s.WA3E);

    this.cache = {
      signals: s,
      seq: { IF: this.ifSeq, ID: D.seq, EX: E.seq, MEM: M.seq, WB: W.seq },
      rows: { main: m ? m.index : -1, alu: m ? a.index : -1 },
      clsD: dCls, clsE: eCls,
      dE: E.bubble ? null : decode(E.instr),
      ldrStall: Boolean(ldrStall), // the condition, whether or not this mode stalls on it
      unneeded: Boolean(s.LDRstall && !needed),
      corrected: Boolean(s.StallFTextbook && !s.StallF), // D15 applied this cycle
      stale,
      halt: !W.bubble && W.exec && W.instr === HALT_WORD,
      live: { IF: true, ID: !D.bubble, EX: !E.bubble, MEM: !M.bubble, WB: !W.bubble }, // which stages hold an instruction
    };
    return this.cache;
  }

  // --- the parts the Extended processor (uarch/pipe-ext.js) changes ---------------------------------------------------
  /** The pipeline registers' empty contents (bubbles). */
  get regs() { return REGS; }

  /** The result multiplexer of Writeback (MemtoRegW). */
  writeback(s) { s.ResultW = s.MemtoRegW ? s.ReadDataW : s.ALUOutW; }

  /** The Control Unit (the single-cycle Main and ALU Decoders) and WA3D; a bubble decodes to all zeros. Returns the rows. */
  decodeStage(s, D) {
    const m = D.bubble ? null : mainDecode(s.Op, s.Funct);
    const a = m ? aluDecode(m.ALUOp, s.Funct) : null;
    s.RegSrcD = m?.RegSrc ?? 0;
    s.ImmSrcD = m?.ImmSrc ?? 0;
    s.ALUSrcD = m?.ALUSrc ?? 0;
    s.MemtoRegD = m?.MemtoReg ?? 0;
    s.RegWriteD = m?.RegW ?? 0;
    s.MemWriteD = m?.MemW ?? 0;
    s.BranchD = m?.Branch ?? 0;
    s.ALUControlD = a?.ALUControl ?? 0;
    s.FlagWriteD = a?.FlagW ?? 0;
    s.WA3D = s.Rd;
    return { m, a: a && m.ALUOp ? a : { index: 0 } };
  }

  /** The SrcB multiplexer and the ALU, from SrcAE and WriteDataE. */
  execute(s) {
    s.SrcBE = s.ALUSrcE ? s.ExtImmE : s.WriteDataE;
    [s.ALUResultE, s.ALUFlags] = alu(s.SrcAE, s.SrcBE, s.ALUControlE);
  }

  /** A load in Execute, for LDRstall: MemtoRegE (Fig 7.54). */
  loadInE(s) { return s.MemtoRegE; }

  /** The value the instruction in Memory will write: its load data or its ALU result. */
  resultOfM(s) { return s.MemtoRegM ? s.ReadDataM : s.ALUOutM; }

  classOfWord(w) { return classOf((w >>> 26) & 3, (w >>> 20) & 63); }

  sources(cls, w) { return sourcesOf(cls, w); }

  /** The memory access of a class: {kind, size} or null. */
  access(cls) { return cls === 'ldr' ? { kind: 'load', size: 4 } : cls === 'str' ? { kind: 'store', size: 4 } : null; }

  /** The registers at the clock edge, each from the stage before. */
  nextW(s, M) {
    return { ALUOutW: s.ALUOutM, ReadDataW: s.ReadDataM, WA3W: s.WA3M, PCSrcW: s.PCSrcM, RegWriteW: s.RegWriteM, MemtoRegW: s.MemtoRegM,
      seq: M.seq, at: M.at, instr: M.instr, bubble: M.bubble, exec: M.exec, flags: M.flags };
  }

  nextM(s, E, nf) {
    return { ALUOutM: s.ALUResultE, WriteDataM: s.WriteDataE, WA3M: s.WA3E, PCSrcM: s.PCSrcE & s.CondExE, RegWriteM: s.RegWriteE & s.CondExE,
      MemtoRegM: s.MemtoRegE, MemWriteM: s.MemWriteE & s.CondExE, seq: E.seq, at: E.at, instr: E.instr, bubble: E.bubble, exec: s.CondExE, flags: nf };
  }

  nextE(s, D) {
    return { RD1E: s.RD1D, RD2E: s.RD2D, ExtImmE: s.ExtImmD, WA3E: s.WA3D, RA1E: s.RA1D, RA2E: s.RA2D, CondE: D.bubble ? 0 : s.Cond,
      PCSrcE: s.PCSrcD, RegWriteE: s.RegWriteD, MemtoRegE: s.MemtoRegD, MemWriteE: s.MemWriteD, ALUControlE: s.ALUControlD,
      BranchE: s.BranchD, ALUSrcE: s.ALUSrcD, FlagWriteE: s.FlagWriteD, seq: D.seq, at: D.at, instr: D.InstrD, bubble: D.bubble };
  }

  nextD(s) { return { InstrD: s.InstrF, seq: this.ifSeq, at: this.pcF, bubble: 0 }; }

  /** What each stage holds in the current cycle, with the hazard outputs (the pipeline-diagram record). */
  record() {
    const c = this.evaluate();
    const s = c.signals;
    return {
      ...c.seq, StallF: s.StallF, StallD: s.StallD, FlushD: s.FlushD, FlushE: s.FlushE, ForwardAE: s.ForwardAE,
      ForwardBE: s.ForwardBE, BranchTakenE: s.BranchTakenE, PCSrcW: s.PCSrcW, ldrStall: c.ldrStall, LDRstall: s.LDRstall,
      unneeded: c.unneeded, pcWait: Boolean(s.StallF && !s.LDRstall), corrected: c.corrected, stale: c.stale.length > 0,
      // the write to R15 that Fetch waits for (in ID, EX or MEM), and the one in WB that writes the PC this cycle
      pcWriter: s.PCSrcD ? this.D.seq : s.PCSrcE ? this.E.seq : s.PCSrcM ? this.M.seq : 0, pcWritten: s.PCSrcW ? this.W.seq : 0,
    };
  }

  /** The diagram record of cycle k: recorded, or the current cycle. */
  recordAt(k) {
    return k === this.cycle ? this.record() : this.trace[k] ?? null;
  }

  /**
   * Apply one clock edge. Returns 'halt' when B . (AL) is in Writeback (no edge), 'error' (this.error set) for an
   * instruction in Execute the base processor does not run or a rule of W-D32 Q3, otherwise 'step'.
   */
  step() {
    if (this.halted) return 'halt';
    if (this.error) return 'error';
    const c = this.evaluate();
    const s = c.signals;
    const { D, E, M, W } = this;
    const fail = (msg, stage) => { this.error = msg; this.errorStage = stage; return 'error'; };
    if (c.halt) { this.halted = true; return 'halt'; }
    if (s.PCSrcW) {
      if (s.ResultW & 1) return fail(S.engine.thumb(s.ResultW, W.at), 'WB');
      if (s.ResultW & 2) return fail(S.engine.pcHalf(s.ResultW, W.at), 'WB');
    }
    const ei = this.instance(E.seq);
    // without the full Hazard Unit a word fetched past the program on the wrong path runs as the hardware would (0)
    if (!E.bubble && !(ei?.noCode && ei.wrongPath)) {
      const d = c.dE;
      const fail = (msg) => { this.error = msg; this.errorStage = 'EX'; return 'error'; };
      if (ei?.noCode) return fail(S.engine.noCode(E.at));
      if (d.bad) return fail(S.engine.notRun(E.instr, E.at, S.outOfScope[d.bad]));
      if (d.unpredictable) return fail(S.engine.unpredictable(E.instr, E.at, S.unpredictable[d.unpredictable]));
      if (!withinTier(d.tier, this.tier)) return fail(this.tier === 'H' ? S.pipe.notBase(E.instr, E.at, d.name, d.tier) : S.pipe.notExtended(E.instr, E.at, d.name));
      const access = this.access(c.clsE);
      if (access?.size === 4 && s.CondExE && (s.ALUResultE & 3)) return fail(S.engine.unaligned(access.kind, s.ALUResultE, E.at));
    }

    this.trace[this.cycle] = this.record();
    const rec = {
      pcF: this.pcF, D, E, M, W, F: { ...this.F }, ifSeq: this.ifSeq, nextSeq: this.nextSeq, stats: { ...this.stats },
      reg: null, mem: null, marks: [],
    };

    // statistics
    const st = this.stats;
    if (!W.bubble) st.retired += 1;
    if (!E.bubble && this.access(c.clsE)?.kind === 'load') st.loads += 1;
    if (!E.bubble && E.BranchE) { st.branches += 1; if (s.BranchTakenE) st.taken += 1; }
    if (!W.bubble && s.PCSrcW) st.pcWrites += 1;
    if (s.LDRstall) { st.loadUse += 1; if (c.unneeded) st.unneeded += 1; }
    else if (s.StallF) st.pcWait += 1;
    if (c.corrected) st.corrected += 1;
    if (s.FlushD && !s.StallD && !s.StallF) st.flushed += 1; // a held IF is not lost
    if (s.FlushE && !s.LDRstall && !D.bubble) st.flushed += 1;
    if (c.stale.length) st.stale += 1;
    // without the full Hazard Unit, the instructions after a taken branch or a write to R15 run
    if (this.hazard !== 'full') {
      const mark = (seq) => {
        const i = this.instances.get(seq);
        if (!i || i.kind !== 'instr' || i.wrongPath) return;
        i.wrongPath = true;
        rec.marks.push(seq);
        st.wrongPath += 1;
      };
      if (s.BranchTakenE && !E.bubble) { if (!D.bubble) mark(D.seq); mark(this.ifSeq); }
      if (s.PCSrcW && !W.bubble) { for (const r of [M, E, D]) if (!r.bubble) mark(r.seq); mark(this.ifSeq); }
    }

    // the clock edge: Writeback writes the register file, Memory the data memory, the Cond Unit the flags
    if (s.RegWriteW && s.WA3W !== 15) {
      rec.reg = [s.WA3W, this.R[s.WA3W]];
      this.R[s.WA3W] = s.ResultW;
    }
    if (s.MemWriteM) {
      rec.mem = [s.ALUOutM, this.dmem.read(s.ALUOutM, 4)];
      this.dmem.write(s.ALUOutM, 4, s.WriteDataM);
    }
    const nf = s.FlagsNextE;
    this.F = { N: (nf >>> 3) & 1, Z: (nf >>> 2) & 1, C: (nf >>> 1) & 1, V: nf & 1 };
    // the pipeline registers
    this.W = Object.freeze(this.nextW(s, M));
    this.M = Object.freeze(this.nextM(s, E, nf));
    if (s.FlushE) {
      // a load-use bubble gets its own row in the pipeline diagram; a flushed instruction keeps its own
      let seq = 0;
      if (s.LDRstall) {
        seq = this.nextSeq++;
        this.instances.set(seq, { kind: 'bubble', pc: D.at, instr: 0, noCode: false, wrongPath: false });
      }
      this.E = Object.freeze({ ...this.regs.E, seq });
    } else this.E = Object.freeze(this.nextE(s, D));
    if (!s.StallD) this.D = s.FlushD ? this.regs.D : Object.freeze(this.nextD(s));
    if (!s.StallF) {
      this.pcF = s.PCNext;
      this.ifSeq = this.nextSeq++;
      if (!this.instances.has(this.ifSeq)) this.instances.set(this.ifSeq, this.fetched(this.pcF));
    }
    this.cycle += 1;
    this.remember(rec);
    this.cache = null;
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
    if (this.error) { this.error = null; this.errorStage = null; this.cache = null; return true; }
    if (this.halted) { this.halted = false; this.cache = null; return true; }
    const r = this.history.pop();
    if (!r) return false;
    if (r.mem) this.dmem.write(r.mem[0], 4, r.mem[1]);
    if (r.reg) this.R[r.reg[0]] = r.reg[1];
    for (const seq of r.marks) this.instances.get(seq).wrongPath = false;
    Object.assign(this, { pcF: r.pcF, D: r.D, E: r.E, M: r.M, W: r.W, F: r.F, ifSeq: r.ifSeq, nextSeq: r.nextSeq, stats: r.stats });
    this.cycle -= 1;
    this.cache = null;
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

  /**
   * The registers in the instruction-level engine's record: r0-r14 from the register file, r15 the PC register (the
   * fetch address, ahead of the instructions in the pipeline), N, Z, C, V from FlagsE (which the instructions in
   * Execute have already updated).
   */
  registers() {
    return { ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i}`, i === 15 ? this.pcF : this.R[i]])), ...this.F };
  }
}

/** The instruction class of Op and Funct, as the single-cycle Main Decoder's rows name them, or null. */
export function classOf(Op, Funct) {
  if (Op === 0b00) return (Funct >>> 5) & 1 ? 'dpImm' : 'dpReg';
  if (Op === 0b01) return Funct & 1 ? 'ldr' : 'str';
  if (Op === 0b10) return 'b';
  return null;
}
