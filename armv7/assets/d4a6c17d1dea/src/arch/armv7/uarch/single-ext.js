// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { decode, HALT_WORD } from '../language.js';
import { passed } from '../engine.js';
import { ArmSingle, extend } from './single.js';
export const MAIN_DECODER_EXT = Object.freeze([
 { cls: 'dpReg', Op: 0b00, Funct5: 0, Funct4: null, Funct2: null, Funct0: null, RegSrc: 0b00, ImmSrc: 0b00, ALUSrc: 0, ResultSrc: 0b00, RegW: 1, MemW: 0, Branch: 0, ALUOp: 0b10, Link: 0 },
 { cls: 'dpImm', Op: 0b00, Funct5: 1, Funct4: null, Funct2: null, Funct0: null, RegSrc: 0b00, ImmSrc: 0b00, ALUSrc: 1, ResultSrc: 0b00, RegW: 1, MemW: 0, Branch: 0, ALUOp: 0b10, Link: 0 },
 { cls: 'ldr', Op: 0b01, Funct5: null, Funct4: null, Funct2: 0, Funct0: 1, RegSrc: 0b00, ImmSrc: 0b01, ALUSrc: 1, ResultSrc: 0b01, RegW: 1, MemW: 0, Branch: 0, ALUOp: 0b01, Link: 0 },
 { cls: 'ldrb', Op: 0b01, Funct5: null, Funct4: null, Funct2: 1, Funct0: 1, RegSrc: 0b00, ImmSrc: 0b01, ALUSrc: 1, ResultSrc: 0b10, RegW: 1, MemW: 0, Branch: 0, ALUOp: 0b01, Link: 0 },
 { cls: 'str', Op: 0b01, Funct5: null, Funct4: null, Funct2: null, Funct0: 0, RegSrc: 0b10, ImmSrc: 0b01, ALUSrc: 1, ResultSrc: 0b00, RegW: 0, MemW: 1, Branch: 0, ALUOp: 0b01, Link: 0 },
 { cls: 'b', Op: 0b10, Funct5: null, Funct4: 0, Funct2: null, Funct0: null, RegSrc: 0b01, ImmSrc: 0b10, ALUSrc: 1, ResultSrc: 0b00, RegW: 0, MemW: 0, Branch: 1, ALUOp: 0b00, Link: 0 },
 { cls: 'bl', Op: 0b10, Funct5: null, Funct4: 1, Funct2: null, Funct0: null, RegSrc: 0b01, ImmSrc: 0b10, ALUSrc: 1, ResultSrc: 0b11, RegW: 1, MemW: 0, Branch: 1, ALUOp: 0b00, Link: 1 },
]);
export const MAIN_OUTPUTS_EXT = Object.freeze(['RegSrc', 'ImmSrc', 'ALUSrc', 'ResultSrc', 'RegW', 'MemW', 'Branch', 'ALUOp', 'Link']);
const fit = (p, v) => p === null || p === v;
const bitOf = (v, n) => (v >>> n) & 1;
export function mainDecodeExt(Op, Funct) {
 const i = MAIN_DECODER_EXT.findIndex((r) => r.Op === Op && fit(r.Funct5, bitOf(Funct, 5)) && fit(r.Funct4, bitOf(Funct, 4))
 && fit(r.Funct2, bitOf(Funct, 2)) && fit(r.Funct0, bitOf(Funct, 0)));
 const r = MAIN_DECODER_EXT[i];
 return { index: i, cls: r?.cls ?? null, ...Object.fromEntries(MAIN_OUTPUTS_EXT.map((k) => [k, r ? r[k] : 0])) };
}
export const DP_OPS = Object.freeze(['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC', 'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN']);
const TIER_E_CMDS = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14];
export const ALU_DECODER_EXT = Object.freeze([
 { ALUOp: 0b00, cmd: null, U: null, name: 'B, BL', ALUControl: 0b0100, FlagW: '00', NoWrite: 0 },
 { ALUOp: 0b01, cmd: null, U: 1, name: 'LDR, LDRB, STR, +offset', ALUControl: 0b0100, FlagW: '00', NoWrite: 0 },
 { ALUOp: 0b01, cmd: null, U: 0, name: 'LDR, LDRB, STR, −offset', ALUControl: 0b0010, FlagW: '00', NoWrite: 0 },
 ...TIER_E_CMDS.map((cmd) => ({ ALUOp: 0b10, cmd, U: null, name: DP_OPS[cmd], ALUControl: cmd, FlagW: 'SS', NoWrite: cmd >= 8 && cmd <= 11 ? 1 : 0 })),
]);
export function aluDecodeExt(ALUOp, Funct) {
 const cmd = (Funct >>> 1) & 15;
 const S = Funct & 1;
 const U = bitOf(Funct, 3);
 const i = ALU_DECODER_EXT.findIndex((r) => r.ALUOp === ALUOp && fit(r.cmd, cmd) && fit(r.U, U));
 if (i < 0) return { index: -1, ALUControl: 0, FlagW: 0, NoWrite: 0 };
 const r = ALU_DECODER_EXT[i];
 return { index: i, ALUControl: r.ALUControl, FlagW: r.FlagW === 'SS' ? S * 0b11 : 0, NoWrite: r.NoWrite };
}
export function shifter(value, ShiftCtl, C) {
 const v = value >>> 0;
 const sh = ShiftCtl & 3;
 const imm5 = ShiftCtl >>> 2;
 if (sh === 3 && imm5 === 0) return [((C << 31) | (v >>> 1)) >>> 0, v & 1];
 const n = sh === 0 || sh === 3 ? imm5 : imm5 || 32;
 if (n === 0) return [v, C];
 if (sh === 0) return [n < 32 ? (v << n) >>> 0 : 0, n <= 32 ? (v >>> (32 - n)) & 1 : 0];
 if (sh === 1) return [n < 32 ? v >>> n : 0, (v >>> (n - 1)) & 1];
 if (sh === 2) return [n < 32 ? ((v | 0) >> n) >>> 0 : (v >>> 31 ? 0xffffffff : 0), (v >>> Math.min(n - 1, 31)) & 1];
 const r = ((v >>> n) | (v << (32 - n))) >>> 0;
 return [r, r >>> 31];
}
export function aluExt(a, b, ctl, C, V, ShiftC) {
 const x = a >>> 0;
 const y = b >>> 0;
 const add = (p, q, cin) => {
 const sum = p + q + cin;
 const r = sum >>> 0;
 return [r, sum > 0xffffffff ? 1 : 0, (((p ^ r) & (q ^ r)) >>> 31) & 1];
 };
 let res;
 let arith = null;
 switch (ctl) {
 case 0: case 8: res = (x & y) >>> 0; break;
 case 1: case 9: res = (x ^ y) >>> 0; break;
 case 2: case 10: arith = add(x, ~y >>> 0, 1); break;
 case 3: arith = add(~x >>> 0, y, 1); break;
 case 4: case 11: arith = add(x, y, 0); break;
 case 5: arith = add(x, y, C); break;
 case 6: arith = add(x, ~y >>> 0, C); break;
 case 7: arith = add(~x >>> 0, y, C); break;
 case 12: res = (x | y) >>> 0; break;
 case 13: res = y; break;
 case 14: res = (x & ~y) >>> 0; break;
 default: res = ~y >>> 0; break;
 }
 if (arith) res = arith[0];
 const N = res >>> 31;
 const Z = res === 0 ? 1 : 0;
 const [c, v] = arith ? [arith[1], arith[2]] : [ShiftC, V];
 return [res, (N << 3) | (Z << 2) | (c << 1) | v];
}
const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;
export class ArmSingleExt extends ArmSingle {
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
 s['Instr11:5'] = (w >>> 5) & 0x7f;
 const m = mainDecodeExt(s.Op, s.Funct);
 for (const k of MAIN_OUTPUTS_EXT) s[k] = m[k];
 const a = aluDecodeExt(s.ALUOp, s.Funct);
 s.ALUControl = a.ALUControl;
 s.FlagW = a.FlagW;
 s.NoWrite = a.NoWrite;
 s.ShiftCtl = m.cls === 'dpReg' ? s['Instr11:5'] : 0;
 s.PCS = ((s.Rd === 15 && s.RegW) || s.Branch) ? 1 : 0;
 s.PCPlus4 = (pc + 4) >>> 0;
 s.PCPlus8 = (s.PCPlus4 + 4) >>> 0;
 s.RA1 = s.RegSrc & 1 ? 15 : s.Rn;
 s.RA2 = s.RegSrc & 2 ? s.Rd : s.Rm;
 s.WA3 = s.Link ? 14 : s.Rd;
 const read = (n) => (n === 15 ? s.PCPlus8 : this.R[n]);
 s.SrcA = read(s.RA1);
 s.WriteData = read(s.RA2);
 s.Flags = flagsOf(this.F);
 [s.ShiftResult, s.ShiftC] = shifter(s.WriteData, s.ShiftCtl, this.F.C);
 s.ExtImm = extend(s.Imm24, s.ImmSrc);
 s.SrcB = s.ALUSrc ? s.ExtImm : s.ShiftResult;
 [s.ALUResult, s.ALUFlags] = aluExt(s.SrcA, s.SrcB, s.ALUControl, this.F.C, this.F.V, s.ShiftC);
 s['ALUResult1:0'] = s.ALUResult & 3;
 s.CondEx = passed(s.Cond, this.F) ? 1 : 0;
 s.FlagWrite = s.CondEx ? s.FlagW : 0;
 s.RegWrite = s.RegW & s.CondEx & (s.NoWrite ^ 1);
 s.MemWrite = s.MemW & s.CondEx;
 s.PCSrc = s.PCS & s.CondEx;
 s.ReadData = this.dmem.read((s.ALUResult & ~3) >>> 0, 4);
 s.ReadByte = (s.ReadData >>> (8 * (s.ALUResult & 3))) & 0xff;
 s.Result = [s.ALUResult, s.ReadData, s.ReadByte, s.PCPlus4][s.ResultSrc];
 s.PCTarget = s.Branch ? s.ALUResult : s.Result;
 s.PCNext = s.PCSrc ? s.PCTarget : s.PCPlus4;
 const load = s.RegW && (s.ResultSrc === 0b01 || s.ResultSrc === 0b10);
 this.cache = {
 signals: s, cls: m.cls, d: decode(w),
 rows: { main: m.index, alu: a.index },
 halt: w === HALT_WORD && this.inCode(pc),
 wa3: s.WA3,
 access: s.MemW ? { kind: 'store', size: 4 } : load ? { kind: 'load', size: s.ResultSrc === 0b10 ? 1 : 4 } : null,
 tier: 'E',
 };
 return this.cache;
 }
}
