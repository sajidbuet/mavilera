// armv7/uarch/multi-ext.js -- the Extended datapath variant of the ARM multicycle processor (roadmap ARM-A3; spec W-D32
// Q1 and its C5 ruling; author decisions A3-Q3 to A3-Q5): the base design of uarch/multi.js with the instructions of
// Harris and Harris's Chapter 7 exercise extensions (tier E of the reference sheet): CMP, CMN, TST, TEQ, MOV, the
// constant shifts and shifted register operands, ADC, SBC, RSB, EOR, BIC, BL, LDRB, and negative LDR and STR offsets.
// MAVILERA's own design, labelled as such; nothing is taken from the solution manual. It carries the parts of the
// approved single-cycle Extended datapath (uarch/single-ext.js, A2-Q11) into the multicycle processor:
//   - a shifter between the WriteData register and the SrcB multiplexer (Example 7.3, p. 402), driven by ShiftCtl =
//     Instr11:5 for a register operand and 0 otherwise, so that WriteData still reaches the memory unshifted for STR; its
//     carry ShiftC and the flags enter the ALU, which takes ALUControl = cmd (4 bits) from the Extended ALU Decoder;
//   - ALUOp is two bits: 00 adds (Fetch, Decode, Branch, the don't-cares), 01 adds or subtracts by U (MemAdr), 10 passes
//     cmd (ExecuteR, ExecuteI);
//   - NoWrite holds RegWrite at 0 for TST, TEQ, CMP and CMN, which still pass through ALUWB (A3-Q4). It comes from the
//     Instr Decoder, NoWrite = (Op == 00) AND (Funct4:3 == 10), not from the ALU Decoder as in Example 7.2: ALUWB has
//     ALUOp = 00, so the ALU Decoder's NoWrite would be 0 there (this application's design decision);
//   - a Byte unit between the memory's ReadData and the Data register (A3-Q5): in MemRead, with ByteSel = (Op == 01) AND
//     Funct2 (the B bit) from the Instr Decoder, Data loads the byte at ALUOut1:0, zero-extended (A8-419; little-endian,
//     A3-108); ALUOut is the address Adr in MemRead (AdrSrc = 1). LDRB needs no alignment;
//   - two states for BL after Decode (A3-Q3): S10 Link writes R14 <- PC, the instruction's address + 4 (A8-346), through a
//     fourth Result-multiplexer input (ResultSrc 11) and an A3 multiplexer (Link: 14, else Rd), and at the same time
//     computes the target, ALUOut <- A + ExtImm (A still holds R15 = the address + 8, read in Decode); S11 BranchL writes
//     PC <- ALUOut. Branch cannot follow Link: A reloads at every edge, and in Link R15 reads Result = PC, the address + 4.
//     The PC Logic reads WA3, the register the write port addresses, so that Link (WA3 = 14) never writes the PC.
// The semantics are those of DDI 0406C.d, as in uarch/single-ext.js. Signal names are Harris's where the textbook has one;
// ShiftCtl, ShiftResult, ShiftC, Link, WA3, ReadByte, ByteSel and DataIn are this application's. Pure JavaScript.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { decode, HALT_WORD } from '../language.js';
import { passed } from '../engine.js';
import { ArmMulti, STATES, STATE_OUTPUTS, FSM_OUTPUTS, nextState, instrDecode } from './multi.js';
import { extend } from './single.js';
import { aluDecodeExt, aluExt, shifter, ALU_DECODER_EXT } from './single-ext.js';

/** The twelve states: the Main FSM's ten, S10 Link and S11 BranchL (A3-Q3). */
export const STATES_EXT = Object.freeze([...STATES, 'Link', 'BranchL']);
export const STATE_CODE_EXT = Object.freeze(Object.fromEntries(STATES_EXT.map((s, i) => [s, i])));

/** The Extended FSM's outputs: the base outputs and Link. */
export const FSM_OUTPUTS_EXT = Object.freeze([...FSM_OUTPUTS, 'Link']);

const ALUOP_EXT = { MemAdr: 0b01, ExecuteR: 0b10, ExecuteI: 0b10 };
/** The outputs of each state: the base rows with a two-bit ALUOp and Link 0, then Link and BranchL. */
const rowExt = (state, o) => Object.freeze({ state, NextPC: 0, Branch: 0, MemW: 0, RegW: 0, IRWrite: 0, AdrSrc: null, ResultSrc: null,
  ALUSrcA: null, ALUSrcB: null, ALUOp: 0b00, Link: 0, ...o });
export const STATE_OUTPUTS_EXT = Object.freeze([
  ...STATE_OUTPUTS.map((r) => Object.freeze({ ...r, ALUOp: ALUOP_EXT[r.state] ?? 0b00, Link: 0 })),
  rowExt('Link', { ResultSrc: 0b11, RegW: 1, Link: 1, ALUSrcA: 0, ALUSrcB: 0b01 }),
  rowExt('BranchL', { ResultSrc: 0b00, Branch: 1 }),
]);

/** The transitions: the base FSM's, with BL (Op = 10, Funct4 = L = 1) through Link and BranchL. */
export function nextStateExt(state, Op, Funct) {
  if (state === 'Decode' && Op === 0b10) return (Funct >>> 4) & 1 ? 'Link' : 'Branch';
  if (state === 'Link') return 'BranchL';
  if (state === 'BranchL') return 'Fetch';
  return nextState(state, Op, Funct);
}

/** The Extended Instr Decoder: RegSrc and ImmSrc as Table 7.6, and ShiftCtl, NoWrite and ByteSel from the instruction. */
export function instrDecodeExt(Op, Funct, Instr) {
  const { RegSrc, ImmSrc } = instrDecode(Op);
  return {
    RegSrc, ImmSrc,
    ShiftCtl: Op === 0b00 && !((Funct >>> 5) & 1) ? (Instr >>> 5) & 0x7f : 0,
    NoWrite: Op === 0b00 && ((Funct >>> 3) & 3) === 0b10 ? 1 : 0,
    ByteSel: Op === 0b01 && (Funct >>> 2) & 1 ? 1 : 0,
  };
}

/** The Extended ALU Decoder's rows as the Controller tab shows them: ALUOp 00 also computes PC + 4 in Fetch and Decode. */
export const ALU_DECODER_MULTI_EXT = Object.freeze(ALU_DECODER_EXT.map((r, i) => (i === 0 ? { ...r, name: 'PC + 4, B, BL (add)' } : r)));

const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;

export class ArmMultiExt extends ArmMulti {
  /** Every signal of the current cycle of the Extended multicycle processor. */
  evaluate() {
    if (this.cache) return this.cache;
    const s = {};
    const st = STATE_CODE_EXT[this.state];
    const out = STATE_OUTPUTS_EXT[st];
    s.state = st;
    for (const k of FSM_OUTPUTS_EXT) s[k] = out[k] ?? 0;
    const w = this.IR;
    s.Instr = w;
    s.Cond = w >>> 28;
    s.Op = (w >>> 26) & 3;
    s.Funct = (w >>> 20) & 63;
    s.Rn = (w >>> 16) & 15;
    s.Rd = (w >>> 12) & 15;
    s.Rm = w & 15;
    s.Imm24 = w & 0xffffff;
    s['Instr11:5'] = (w >>> 5) & 0x7f;
    const id = instrDecodeExt(s.Op, s.Funct, w);
    Object.assign(s, id);
    const a = aluDecodeExt(s.ALUOp, s.Funct);
    s.ALUControl = a.ALUControl;
    s.FlagW = a.FlagW;
    s.WA3 = s.Link ? 14 : s.Rd;
    s.PCS = ((s.WA3 === 15 && s.RegW) || s.Branch) ? 1 : 0; // PC Logic on the write address
    s.PC = this.pc;
    s.A = this.A;
    s.WriteData = this.WD;
    s.ALUOut = this.ALUOut;
    s.Data = this.Data;
    s.Flags = flagsOf(this.F);
    s.CondExDelayed = this.CondExDelayed;
    [s.ShiftResult, s.ShiftC] = shifter(this.WD, s.ShiftCtl, this.F.C);
    s.ExtImm = extend(s.Imm24, s.ImmSrc);
    s.SrcA = s.ALUSrcA ? this.pc : this.A;
    s.SrcB = [s.ShiftResult, s.ExtImm, 4, 0][s.ALUSrcB];
    [s.ALUResult, s.ALUFlags] = aluExt(s.SrcA, s.SrcB, s.ALUControl, this.F.C, this.F.V, s.ShiftC);
    s.Result = [this.ALUOut, this.Data, s.ALUResult, this.pc][s.ResultSrc];
    s.RA1 = s.RegSrc & 1 ? 15 : s.Rn;
    s.RA2 = s.RegSrc & 2 ? s.Rd : s.Rm;
    const read = (n) => (n === 15 ? s.Result : this.R[n]);
    s.RD1 = read(s.RA1);
    s.RD2 = read(s.RA2);
    s.Adr = s.AdrSrc ? this.ALUOut : this.pc;
    s.ReadData = this.mem.read((s.Adr & ~3) >>> 0, 4);
    s['ALUOut1:0'] = this.ALUOut & 3;
    s.ReadByte = (s.ReadData >>> (8 * (this.ALUOut & 3))) & 0xff;
    s.DataIn = s.ByteSel ? s.ReadByte : s.ReadData;
    s.CondEx = passed(s.Cond, this.F) ? 1 : 0;
    s.FlagWrite = s.CondEx ? s.FlagW : 0;
    s.PCSGated = s.PCS & s.CondExDelayed;
    s.PCWrite = s.PCSGated | s.NextPC;
    s.RegWrite = s.RegW & s.CondExDelayed & (s.NoWrite ^ 1);
    s.MemWrite = s.MemW & s.CondExDelayed;
    const next = nextStateExt(this.state, s.Op, s.Funct);
    s.next = next === null ? st : STATE_CODE_EXT[next];
    const d = decode(this.state === 'Fetch' ? s.ReadData : w);
    this.cache = {
      signals: s, state: this.state, next, d,
      rows: { state: st, alu: a.index },
      cls: this.state === 'Fetch' ? null : classOfExt(s.Op, s.Funct),
      halt: this.state === 'Branch' && w === HALT_WORD,
      wa3: s.WA3,
      access: this.state === 'MemRead' ? { kind: 'load', size: s.ByteSel ? 1 : 4 } : this.state === 'MemWrite' ? { kind: 'store', size: 4 } : null,
      tier: 'E',
    };
    return this.cache;
  }
}

/** The instruction class of Op and Funct, as the single-cycle Extended Main Decoder's rows name them, or null. */
export function classOfExt(Op, Funct) {
  if (Op === 0b00) return (Funct >>> 5) & 1 ? 'dpImm' : 'dpReg';
  if (Op === 0b01) return Funct & 1 ? ((Funct >>> 2) & 1 ? 'ldrb' : 'ldr') : 'str';
  if (Op === 0b10) return (Funct >>> 4) & 1 ? 'bl' : 'b';
  return null;
}

/** The states an instruction of each class passes through in the Extended processor. */
export const SEQUENCES_EXT = Object.freeze({
  b: ['Fetch', 'Decode', 'Branch'],
  bl: ['Fetch', 'Decode', 'Link', 'BranchL'],
  dpReg: ['Fetch', 'Decode', 'ExecuteR', 'ALUWB'],
  dpImm: ['Fetch', 'Decode', 'ExecuteI', 'ALUWB'],
  str: ['Fetch', 'Decode', 'MemAdr', 'MemWrite'],
  ldr: ['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB'],
  ldrb: ['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB'],
});
