// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { OP, zcmpSReg } from './decode.js';
export const K = Object.freeze({
 ALU: 0, LOAD: 1, EXCL: 2, AMO: 3, JUMP: 4, BRANCH: 5, DIV: 6, DIVU: 7, MRET: 8, WFI: 9, FENCE_I: 10, SLT: 11,
 PUSHPOP: 12, POPRET: 13, POPRETZ: 14, MV: 15, STORE: 16,
});
export const CAUSE_BIT = Object.freeze({
 UNALIGNED: 1,
 LOAD_USE: 2,
 EXCL: 4,
 JUMP: 8,
 MISPREDICT: 16,
 PREDICTED: 32,
 TAKEN: 64,
 MULTI: 128,
 TRAP: 256,
 IRQ: 512,
 SLEEP: 1024,
 DIV_CANCEL: 2048,
 BTB_SET: 4096,
 BTB_CLEAR: 8192,
});
export const COST = Object.freeze({
 TRAP_ENTRY: 3,
 IRQ_ENTRY: 2,
 JUMP: 2,
 MRET: 2,
 BRANCH_MISS: 2,
 AMO: 4,
 DIV: 18,
 WFI: 2,
 BLOCK: 2,
 FENCE_I: 2,
 MV01: 2,
});
export const RTL_DIFFERS = Object.freeze([
 { what: 'divu, remu', datasheet: '18', rtl: '19' },
 { what: 'div, rem', datasheet: '18 or 19', rtl: '19, or 20 with a negative dividend' },
 { what: 'mret', datasheet: '2 (+1 to an unaligned 32-bit target)', rtl: '3 (+1)' },
 { what: 'cm.popretz with one register', datasheet: '5', rtl: '4' },
]);
const N_OPS = OP.ILLEGAL + 1;
export const KIND = new Uint8Array(N_OPS);
export const USE = new Uint8Array(N_OPS);
export const EXCLUSIVE = new Uint8Array(N_OPS);
{
 const set = (ops, k, use) => { for (const o of ops) { KIND[o] = k; USE[o] = use; } };
 for (let o = 0; o < N_OPS; o++) { KIND[o] = K.ALU; USE[o] = 3; }
 set([OP.LUI, OP.AUIPC, OP.JAL, OP.FENCE, OP.ECALL, OP.EBREAK, OP.CSRRWI, OP.CSRRSI, OP.CSRRCI, OP.ILLEGAL], K.ALU, 0);
 set([OP.ADDI, OP.SLTI, OP.SLTIU, OP.XORI, OP.ORI, OP.ANDI, OP.SLLI, OP.SRLI, OP.SRAI, OP.CSRRW, OP.CSRRS, OP.CSRRC,
 OP.CLZ, OP.CTZ, OP.CPOP, OP.SEXT_B, OP.SEXT_H, OP.ZEXT_H, OP.RORI, OP.ORC_B, OP.REV8, OP.BCLRI, OP.BEXTI, OP.BINVI, OP.BSETI,
 OP.BREV8, OP.ZIP, OP.UNZIP, OP.H3_BEXTMI], K.ALU, 1);
 set([OP.LB, OP.LH, OP.LW, OP.LBU, OP.LHU], K.LOAD, 1);
 set([OP.SB, OP.SH, OP.SW], K.STORE, 1);
 set([OP.LR_W, OP.SC_W], K.EXCL, 1);
 set([OP.AMOSWAP_W, OP.AMOADD_W, OP.AMOXOR_W, OP.AMOAND_W, OP.AMOOR_W, OP.AMOMIN_W, OP.AMOMAX_W, OP.AMOMINU_W, OP.AMOMAXU_W], K.AMO, 1);
 set([OP.JALR], K.JUMP, 1);
 KIND[OP.JAL] = K.JUMP;
 set([OP.BEQ, OP.BNE, OP.BLT, OP.BGE, OP.BLTU, OP.BGEU], K.BRANCH, 3);
 set([OP.DIV, OP.REM], K.DIV, 3);
 set([OP.DIVU, OP.REMU], K.DIVU, 3);
 set([OP.MRET], K.MRET, 0);
 set([OP.WFI], K.WFI, 0);
 set([OP.FENCE_I], K.FENCE_I, 0);
 KIND[OP.SLT] = K.SLT;
 set([OP.CM_PUSH, OP.CM_POP], K.PUSHPOP, 0);
 set([OP.CM_POPRET], K.POPRET, 0);
 set([OP.CM_POPRETZ], K.POPRETZ, 0);
 set([OP.CM_MVA01S, OP.CM_MVSA01], K.MV, 0);
 for (const o of [OP.LR_W, OP.SC_W, OP.AMOSWAP_W, OP.AMOADD_W, OP.AMOXOR_W, OP.AMOAND_W, OP.AMOOR_W, OP.AMOMIN_W, OP.AMOMAX_W, OP.AMOMINU_W, OP.AMOMAXU_W]) EXCLUSIVE[o] = 1;
}
export const zcmpCount = (rlist) => (rlist === 15 ? 13 : rlist - 3);
export function zcmpFirstRead(d) {
 switch (d.op) {
 case OP.CM_MVA01S: return zcmpSReg(d.rs1);
 case OP.CM_MVSA01: return 10;
 default: return 2;
 }
}
export function readsInX(d, r) {
 const u = USE[d.op];
 if (u === 0) return KIND[d.op] >= K.PUSHPOP && KIND[d.op] <= K.MV && zcmpFirstRead(d) === r;
 return ((u & 1) !== 0 && d.rs1 === r) || ((u & 2) !== 0 && d.rs2 === r);
}
export const divCost = (signed, dividend) => (signed && dividend < 0 ? COST.DIV + 1 : COST.DIV);
export function zcmpCost(kind, n) {
 if (kind === K.PUSHPOP) return 1 + n;
 if (kind === K.POPRET) return n === 1 ? 4 : 2 + n;
 if (kind === K.POPRETZ) return n === 1 ? 5 : 3 + n;
 return COST.MV01;
}
export const predictedTaken = (btb, pc, imm) => btb === pc && (((pc + imm) >>> 2) !== (pc >>> 2));
export function causeList(bits) {
 return Object.entries(CAUSE_BIT).filter(([, b]) => bits & b).map(([n]) => n);
}
