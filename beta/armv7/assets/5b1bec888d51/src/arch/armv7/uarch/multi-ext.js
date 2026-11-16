// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { decode, HALT_WORD } from '../language.js';
import { passed } from '../engine.js';
import { ArmMulti, STATES, STATE_OUTPUTS, FSM_OUTPUTS, nextState, instrDecode } from './multi.js';
import { extend } from './single.js';
import { aluDecodeExt, aluExt, shifter, ALU_DECODER_EXT } from './single-ext.js';
export const STATES_EXT = Object.freeze([...STATES, 'Link', 'BranchL']);
export const STATE_CODE_EXT = Object.freeze(Object.fromEntries(STATES_EXT.map((s, i) => [s, i])));
export const FSM_OUTPUTS_EXT = Object.freeze([...FSM_OUTPUTS, 'Link']);
const ALUOP_EXT = { MemAdr: 0b01, ExecuteR: 0b10, ExecuteI: 0b10 };
const rowExt = (state, o) => Object.freeze({ state, NextPC: 0, Branch: 0, MemW: 0, RegW: 0, IRWrite: 0, AdrSrc: null, ResultSrc: null,
 ALUSrcA: null, ALUSrcB: null, ALUOp: 0b00, Link: 0, ...o });
export const STATE_OUTPUTS_EXT = Object.freeze([
 ...STATE_OUTPUTS.map((r) => Object.freeze({ ...r, ALUOp: ALUOP_EXT[r.state] ?? 0b00, Link: 0 })),
 rowExt('Link', { ResultSrc: 0b11, RegW: 1, Link: 1, ALUSrcA: 0, ALUSrcB: 0b01 }),
 rowExt('BranchL', { ResultSrc: 0b00, Branch: 1 }),
]);
export function nextStateExt(state, Op, Funct) {
 if (state === 'Decode' && Op === 0b10) return (Funct >>> 4) & 1 ? 'Link' : 'Branch';
 if (state === 'Link') return 'BranchL';
 if (state === 'BranchL') return 'Fetch';
 return nextState(state, Op, Funct);
}
export function instrDecodeExt(Op, Funct, Instr) {
 const { RegSrc, ImmSrc } = instrDecode(Op);
 return {
 RegSrc, ImmSrc,
 ShiftCtl: Op === 0b00 && !((Funct >>> 5) & 1) ? (Instr >>> 5) & 0x7f : 0,
 NoWrite: Op === 0b00 && ((Funct >>> 3) & 3) === 0b10 ? 1 : 0,
 ByteSel: Op === 0b01 && (Funct >>> 2) & 1 ? 1 : 0,
 };
}
export const ALU_DECODER_MULTI_EXT = Object.freeze(ALU_DECODER_EXT.map((r, i) => (i === 0 ? { ...r, name: 'PC + 4, B, BL (add)' } : r)));
const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;
export class ArmMultiExt extends ArmMulti {
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
 s.PCS = ((s.WA3 === 15 && s.RegW) || s.Branch) ? 1 : 0;
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
export function classOfExt(Op, Funct) {
 if (Op === 0b00) return (Funct >>> 5) & 1 ? 'dpImm' : 'dpReg';
 if (Op === 0b01) return Funct & 1 ? ((Funct >>> 2) & 1 ? 'ldrb' : 'ldr') : 'str';
 if (Op === 0b10) return (Funct >>> 4) & 1 ? 'bl' : 'b';
 return null;
}
export const SEQUENCES_EXT = Object.freeze({
 b: ['Fetch', 'Decode', 'Branch'],
 bl: ['Fetch', 'Decode', 'Link', 'BranchL'],
 dpReg: ['Fetch', 'Decode', 'ExecuteR', 'ALUWB'],
 dpImm: ['Fetch', 'Decode', 'ExecuteI', 'ALUWB'],
 str: ['Fetch', 'Decode', 'MemAdr', 'MemWrite'],
 ldr: ['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB'],
 ldrb: ['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB'],
});
