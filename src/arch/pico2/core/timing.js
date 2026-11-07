// timing.js -- the Hazard3 cost model of the pico2 module (P1-M3; design docs/architecture/pico2-p1m3-pipeline.md §3 and the
// decisions D15-1 to D15-3): how many clk_sys cycles each step of the hart takes on the RP2350, from the instruction, its
// neighbour, the branch predictor's single entry and the alignment of jump targets. Pure tables and functions, no DOM; the
// hart (hart.js) applies them in step() and keeps the state (BTB, previous load, redirect) in its snapshots and history.
// Sources (reference IDs of the research repository): RP-001 §3.8.7 Tables 381-386 and their notes (the datasheet: first
// reference, ADR-0004); where it states nothing, the RTL measurements of experiment E-TIMING-1 (Hazard3 v1.0-rc1 + the two
// ECO commits, RP2350 parameters, perfect bus; Verilator, cross-checked under Icarus). Where the two differ the datasheet value
// is used (D15-1) and the RTL value is kept in RTL_DIFFERS for the help text.
// All counts assume a perfect bus (RP-001 §3.8.7: no downstream stalls); XIP flash, APB wait states and SRAM bank conflicts
// are not modelled (design §3, decision Q4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { OP, zcmpSReg } from './decode.js';

/** Step classes (what decides the cost after execution). */
export const K = Object.freeze({
  ALU: 0, LOAD: 1, EXCL: 2, AMO: 3, JUMP: 4, BRANCH: 5, DIV: 6, DIVU: 7, MRET: 8, WFI: 9, FENCE_I: 10, SLT: 11,
  PUSHPOP: 12, POPRET: 13, POPRETZ: 14, MV: 15, STORE: 16,
});

/** Causes of the cycles of a step (a bit mask, for the stage model and the view). */
export const CAUSE_BIT = Object.freeze({
  UNALIGNED: 1,    // the first instruction after a redirect is a 32-bit one at an address that is not 32-bit aligned: +1 before X
  LOAD_USE: 2,     // rule L: it reads in X the result of the load, lr.w or sc.w just before it: +1 before X
  EXCL: 4,         // rule E: lr.w or sc.w followed by lr.w, sc.w or an AMO: +1 before X
  JUMP: 8,         // jal, jalr, mret, cm.popret(z), fence.i: the frontend restarts at the target
  MISPREDICT: 16,  // a conditional branch whose outcome differs from the prediction
  PREDICTED: 32,   // a conditional branch predicted taken by the BTB and taken
  TAKEN: 64,       // a conditional branch that was taken
  MULTI: 128,      // the instruction holds X for more than one cycle (div, AMO, Zcmp, wfi, h3.block)
  TRAP: 256,       // exception entry
  IRQ: 512,        // interrupt entry
  SLEEP: 1024,     // a sleeping cycle (wfi, h3.block)
  DIV_CANCEL: 2048, // a div/rem cancelled by an interrupt (D15-2)
  BTB_SET: 4096,   // the branch was written into the BTB
  BTB_CLEAR: 8192, // the BTB was cleared
});

/** Fixed costs. */
export const COST = Object.freeze({
  TRAP_ENTRY: 3,   // ecall, ebreak [RP-001 Table 384]; illegal instruction, misaligned load and store measured 3 (E-TIMING-1 ids 104-108)
  IRQ_ENTRY: 2,    // from the X cycle of the interrupted instruction to the handler's first X cycle (E-TIMING-1 ids 120-135)
  JUMP: 2,         // jal, jalr [RP-001 Table 381]
  MRET: 2,         // [RP-001 Table 384]; the RTL takes 3 (RTL_DIFFERS)
  BRANCH_MISS: 2,  // [RP-001 Table 381]
  AMO: 4,          // per attempt [RP-001 Table 383]; one attempt (no other bus master is modelled)
  DIV: 18,         // div/rem 18 or 19, divu/remu 18 [RP-001 Table 382]
  WFI: 2,          // 2+ [RP-001 Table 384]: 2, then one per sleeping cycle
  BLOCK: 2,        // h3.block that falls through (an unblock was pending): E-TIMING-1 id 95; sleeping as wfi (assumption)
  FENCE_I: 2,      // E-TIMING-1 id 93
  MV01: 2,         // cm.mva01s, cm.mvsa01 [RP-001 Table 386]
});

/** The 18 rows where the RTL (E-TIMING-1) differs from the datasheet; the model uses the datasheet (D15-1). */
export const RTL_DIFFERS = Object.freeze([
  { what: 'divu, remu', datasheet: '18', rtl: '19' },
  { what: 'div, rem', datasheet: '18 or 19', rtl: '19, or 20 with a negative dividend' },
  { what: 'mret', datasheet: '2 (+1 to an unaligned 32-bit target)', rtl: '3 (+1)' },
  { what: 'cm.popretz with one register', datasheet: '5', rtl: '4' },
]);

const N_OPS = OP.ILLEGAL + 1;
/** The class of each operation. */
export const KIND = new Uint8Array(N_OPS);
/** Bit 0: reads rs1 in X; bit 1: reads rs2 in X (store data is read in M and is not a dependency: RP-001 Table 381 fn 2). */
export const USE = new Uint8Array(N_OPS);
/** lr.w, sc.w and the AMOs: an exclusive access right after lr.w/sc.w waits one cycle (rule E, RP-001 Table 383 fn 4). */
export const EXCLUSIVE = new Uint8Array(N_OPS);

{
  const set = (ops, k, use) => { for (const o of ops) { KIND[o] = k; USE[o] = use; } };
  for (let o = 0; o < N_OPS; o++) { KIND[o] = K.ALU; USE[o] = 3; } // R-type: rs1 and rs2
  set([OP.LUI, OP.AUIPC, OP.JAL, OP.FENCE, OP.ECALL, OP.EBREAK, OP.CSRRWI, OP.CSRRSI, OP.CSRRCI, OP.ILLEGAL], K.ALU, 0);
  set([OP.ADDI, OP.SLTI, OP.SLTIU, OP.XORI, OP.ORI, OP.ANDI, OP.SLLI, OP.SRLI, OP.SRAI, OP.CSRRW, OP.CSRRS, OP.CSRRC,
    OP.CLZ, OP.CTZ, OP.CPOP, OP.SEXT_B, OP.SEXT_H, OP.ZEXT_H, OP.RORI, OP.ORC_B, OP.REV8, OP.BCLRI, OP.BEXTI, OP.BINVI, OP.BSETI,
    OP.BREV8, OP.ZIP, OP.UNZIP, OP.H3_BEXTMI], K.ALU, 1);
  set([OP.LB, OP.LH, OP.LW, OP.LBU, OP.LHU], K.LOAD, 1);
  set([OP.SB, OP.SH, OP.SW], K.STORE, 1);
  // sc.w and the AMOs: rs2 is store data (an inference from fn 2: not measured)
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
  KIND[OP.SLT] = K.SLT; // h3.block / h3.unblock are slt x0, x0, x0 / x1 (Xh3power)
  // Zcmp: the registers in the record's fields are not register numbers; the hart asks zcmpFirstRead()
  set([OP.CM_PUSH, OP.CM_POP], K.PUSHPOP, 0);
  set([OP.CM_POPRET], K.POPRET, 0);
  set([OP.CM_POPRETZ], K.POPRETZ, 0);
  set([OP.CM_MVA01S, OP.CM_MVSA01], K.MV, 0);
  for (const o of [OP.LR_W, OP.SC_W, OP.AMOSWAP_W, OP.AMOADD_W, OP.AMOXOR_W, OP.AMOAND_W, OP.AMOOR_W, OP.AMOMIN_W, OP.AMOMAX_W, OP.AMOMINU_W, OP.AMOMAXU_W]) EXCLUSIVE[o] = 1;
}

/** Registers in a Zcmp list (rlist 4 to 15): ra, s0, s1, s2 ... */
export const zcmpCount = (rlist) => (rlist === 15 ? 13 : rlist - 3);

/**
 * The register the first micro-op of a Zcmp instruction reads in X (the one a load just before it can stall), or 0.
 * Push and pop address the stack through sp first; cm.mva01s copies an s register into a0 first, cm.mvsa01 a0 into an s
 * register (hazard3_instr_decompress.v, rc1). An inference: the Zcmp load-use cases were not measured.
 */
export function zcmpFirstRead(d) {
  switch (d.op) {
    case OP.CM_MVA01S: return zcmpSReg(d.rs1);
    case OP.CM_MVSA01: return 10;
    default: return 2;
  }
}

/** Does the instruction read register r (non-zero) in X? (rule L) */
export function readsInX(d, r) {
  const u = USE[d.op];
  if (u === 0) return KIND[d.op] >= K.PUSHPOP && KIND[d.op] <= K.MV && zcmpFirstRead(d) === r;
  return ((u & 1) !== 0 && d.rs1 === r) || ((u & 2) !== 0 && d.rs2 === r);
}

/** div/rem take 19 cycles when the dividend of the signed operation is negative, else 18 (D15-1: the RTL's condition, an inference). */
export const divCost = (signed, dividend) => (signed && dividend < 0 ? COST.DIV + 1 : COST.DIV);

/** Zcmp costs [RP-001 Table 386 and fn 5]: push/pop 1+n; popret 4 (n = 1) or 2+n; popretz 5 (n = 1) or 3+n. */
export function zcmpCost(kind, n) {
  if (kind === K.PUSHPOP) return 1 + n;
  if (kind === K.POPRET) return n === 1 ? 4 : 2 + n;
  if (kind === K.POPRETZ) return n === 1 ? 5 : 3 + n;
  return COST.MV01;
}

/**
 * The branch predictor's view of a conditional branch at `pc` with offset `imm`: true if it is predicted taken. The BTB holds
 * the last taken backward branch (RP-001 §3.8.7.10); a branch whose target lies in the same 32-bit word as the branch is not
 * recognised (the delay-loop caveat, §3.8.7.10.1: the tag is compared with bits 31:2 of the sequential fetch address; the
 * rule as written is an inference that reproduces E-TIMING-1 ids 73-80).
 */
export const predictedTaken = (btb, pc, imm) => btb === pc && (((pc + imm) >>> 2) !== (pc >>> 2));

/** One-line descriptions of the cause bits (for tests and debugging; the view's words are in strings.js). */
export function causeList(bits) {
  return Object.entries(CAUSE_BIT).filter(([, b]) => bits & b).map(([n]) => n);
}
