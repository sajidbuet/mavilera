// armv7/uarch/pipe-ext.js -- the Extended variant of the ARM pipelined processor (roadmap ARM-A4, part 3; spec W-D32 C5
// ruling; author decisions A4-Q5 to A4-Q8): the base design of uarch/pipe.js running the Chapter 7 exercise extensions
// (tier E of the reference sheet), with the parts of the single-cycle and multicycle Extended processors
// (uarch/single-ext.js, multi-ext.js) placed in the stages. MAVILERA's own design, labelled as such; nothing is taken from
// the solution manual. Semantics are DDI 0406C.d's, as in single-ext.js.
//   - Decode: the Extended Main and ALU Decoders (single-ext.js): ResultSrc (2 bits) in place of MemtoReg, ALUControl =
//     cmd (4 bits), NoWrite for TST, TEQ, CMP, CMN, Link for BL; ShiftCtl = Instr11:5 for a register operand, 0 otherwise;
//     WA3D = Link ? 14 : Rd (A4-Q8). PCPlus4F is registered into IF/ID as PCPlus4D (A4-Q5).
//   - Execute: the shifter between forwarding multiplexer B and the SrcB multiplexer (WriteDataE goes to memory
//     unshifted); the ALU takes ALUControlE, the C and V of FlagsE and ShiftCE. FlagsE is in Execute, so ADC, SBC and the
//     shifter read the flags the instruction ahead has just written, with no hazard. RegWrite passes a three-input gate:
//     RegWriteE AND CondExE AND NOT NoWriteE (A4-Q8).
//   - Writeback: the Byte unit takes the byte of ReadDataW at ALUOutW1:0; the result multiplexer chooses ALUOutW,
//     ReadDataW, ReadByteW or PCPlus4W by ResultSrcW (A4-Q6).
//   - Hazard Unit: LDRstall = Match_12D_E AND (ResultSrcE = 01 or 10) (A4-Q7); the rest as the base design.
// BL needs no forwarding of its link value: it is taken (or writes nothing), so the instruction at its target reads R14
// in Decode while BL is in Writeback, and the register file gives the new value (write first). Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ArmPipe } from './pipe.js';
import { mainDecodeExt, aluDecodeExt, shifter, aluExt } from './single-ext.js';

const keep = (r, drop) => Object.fromEntries(Object.entries(r).filter(([k]) => !drop.includes(k)));

// The pipeline registers of the Extended processor: the base fields, MemtoReg replaced by ResultSrc, and the added ones.
const REGS_EXT = Object.freeze({
  D: Object.freeze({ InstrD: 0, PCPlus4D: 0, seq: 0, at: 0, bubble: 1 }),
  E: Object.freeze({
    RD1E: 0, RD2E: 0, ExtImmE: 0, WA3E: 0, RA1E: 0, RA2E: 0, CondE: 0, PCSrcE: 0, RegWriteE: 0, ResultSrcE: 0, MemWriteE: 0,
    ALUControlE: 0, BranchE: 0, ALUSrcE: 0, FlagWriteE: 0, NoWriteE: 0, ShiftCtlE: 0, PCPlus4E: 0, seq: 0, at: 0, instr: 0, bubble: 1,
  }),
  M: Object.freeze({ ALUOutM: 0, WriteDataM: 0, WA3M: 0, PCSrcM: 0, RegWriteM: 0, ResultSrcM: 0, MemWriteM: 0, PCPlus4M: 0,
    seq: 0, at: 0, instr: 0, bubble: 1, exec: 0, flags: 0 }),
  W: Object.freeze({ ALUOutW: 0, ReadDataW: 0, WA3W: 0, PCSrcW: 0, RegWriteW: 0, ResultSrcW: 0, PCPlus4W: 0,
    seq: 0, at: 0, instr: 0, bubble: 1, exec: 0, flags: 0 }),
});

const byteOf = (word, a) => (word >>> (8 * (a & 3))) & 0xff;

export class ArmPipeExt extends ArmPipe {
  constructor(options = {}) {
    super(options);
    this.tier = 'E';
  }

  get regs() { return REGS_EXT; }

  writeback(s) {
    s['ALUOutW1:0'] = s.ALUOutW & 3;
    s.ReadByteW = byteOf(s.ReadDataW, s.ALUOutW);
    s.ResultW = [s.ALUOutW, s.ReadDataW, s.ReadByteW, s.PCPlus4W][s.ResultSrcW];
  }

  decodeStage(s, D) {
    const m = D.bubble ? null : mainDecodeExt(s.Op, s.Funct);
    const a = m && m.index >= 0 ? aluDecodeExt(m.ALUOp, s.Funct) : null;
    s['Instr11:5'] = (s.InstrD >>> 5) & 0x7f;
    s.RegSrcD = m?.RegSrc ?? 0;
    s.ImmSrcD = m?.ImmSrc ?? 0;
    s.ALUSrcD = m?.ALUSrc ?? 0;
    s.ResultSrcD = m?.ResultSrc ?? 0;
    s.RegWriteD = m?.RegW ?? 0;
    s.MemWriteD = m?.MemW ?? 0;
    s.BranchD = m?.Branch ?? 0;
    s.LinkD = m?.Link ?? 0;
    s.ALUControlD = a?.ALUControl ?? 0;
    s.FlagWriteD = a?.FlagW ?? 0;
    s.NoWriteD = a?.NoWrite ?? 0;
    s.ShiftCtlD = m?.cls === 'dpReg' ? s['Instr11:5'] : 0;
    s.WA3D = s.LinkD ? 14 : s.Rd;
    s.PCPlus4D = D.PCPlus4D;
    return { m, a: a ?? { index: -1 } };
  }

  execute(s) {
    [s.ShiftResultE, s.ShiftCE] = shifter(s.WriteDataE, s.ShiftCtlE, this.F.C);
    s.SrcBE = s.ALUSrcE ? s.ExtImmE : s.ShiftResultE;
    [s.ALUResultE, s.ALUFlags] = aluExt(s.SrcAE, s.SrcBE, s.ALUControlE, this.F.C, this.F.V, s.ShiftCE);
  }

  loadInE(s) { return s.ResultSrcE === 0b01 || s.ResultSrcE === 0b10 ? 1 : 0; }

  resultOfM(s) {
    return [s.ALUOutM, s.ReadDataM, byteOf(s.ReadDataM, s.ALUOutM), s.PCPlus4M][s.ResultSrcM];
  }

  classOfWord(w) { return mainDecodeExt((w >>> 26) & 3, (w >>> 20) & 63).cls; }

  /** The registers an instruction reads: MOV reads no Rn (its Rn field is 0, A5-193); BL none; LDRB as LDR. */
  sources(cls, w) {
    const Rn = (w >>> 16) & 15;
    const Rd = (w >>> 12) & 15;
    const Rm = w & 15;
    const mov = ((w >>> 21) & 15) === 13;
    switch (cls) {
      case 'dpReg': return mov ? [Rm] : [Rn, Rm];
      case 'dpImm': return mov ? [] : [Rn];
      case 'ldr': case 'ldrb': return [Rn];
      case 'str': return [Rn, Rd];
      default: return [];
    }
  }

  access(cls) {
    return cls === 'ldr' ? { kind: 'load', size: 4 } : cls === 'ldrb' ? { kind: 'load', size: 1 } : cls === 'str' ? { kind: 'store', size: 4 } : null;
  }

  nextW(s, M) {
    return { ...keep(super.nextW(s, M), ['MemtoRegW']), ResultSrcW: s.ResultSrcM, PCPlus4W: s.PCPlus4M };
  }

  nextM(s, E, nf) {
    return { ...keep(super.nextM(s, E, nf), ['MemtoRegM']), RegWriteM: s.RegWriteE & s.CondExE & (s.NoWriteE ^ 1), ResultSrcM: s.ResultSrcE,
      PCPlus4M: s.PCPlus4E };
  }

  nextE(s, D) {
    return { ...keep(super.nextE(s, D), ['MemtoRegE']), ResultSrcE: s.ResultSrcD, NoWriteE: s.NoWriteD, ShiftCtlE: s.ShiftCtlD, PCPlus4E: s.PCPlus4D };
  }

  nextD(s) { return { ...super.nextD(s), PCPlus4D: s.PCPlus4F }; }
}
