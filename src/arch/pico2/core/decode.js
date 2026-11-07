// decode.js -- instruction decoder of the pico2 module's Hazard3 core (P1-M1): RV32IMAC, Zba, Zbb, Zbs, Zbkb, Zca, Zcb,
// Zcmp, Zicsr, Zifencei, Xh3bextm and the privileged instructions MRET and WFI, as the RP2350 configures Hazard3 (research
// repository, R-HZ-01 §3.2; RP-001 §3.8). One function turns a 32-bit fetch word into one record. A compressed
// instruction decodes to the operation of its 32-bit form (as Hazard3's expander does) and keeps its own mnemonic
// and operand format for the listing. Own code, written from the RISC-V specifications' encodings and checked
// against GNU objdump (test/pico2-decode.test.mjs, tools/pico2-decode-oracle.mjs); it shares nothing with the RISC-V
// module's decoder (docs/ADDING-SIMULATORS.md: no engine shared between architectures).
// Not decoded here (decode gives ILLEGAL): F/D, S-mode, Zbc and Zcmt (not in the RP2350's Hazard3).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const NAMES = [
  'LUI', 'AUIPC', 'JAL', 'JALR', 'BEQ', 'BNE', 'BLT', 'BGE', 'BLTU', 'BGEU',
  'LB', 'LH', 'LW', 'LBU', 'LHU', 'SB', 'SH', 'SW',
  'ADDI', 'SLTI', 'SLTIU', 'XORI', 'ORI', 'ANDI', 'SLLI', 'SRLI', 'SRAI',
  'ADD', 'SUB', 'SLL', 'SLT', 'SLTU', 'XOR', 'SRL', 'SRA', 'OR', 'AND',
  'MUL', 'MULH', 'MULHSU', 'MULHU', 'DIV', 'DIVU', 'REM', 'REMU',
  'FENCE', 'FENCE_I', 'ECALL', 'EBREAK', 'MRET', 'WFI',
  'CSRRW', 'CSRRS', 'CSRRC', 'CSRRWI', 'CSRRSI', 'CSRRCI',
  'LR_W', 'SC_W', 'AMOSWAP_W', 'AMOADD_W', 'AMOXOR_W', 'AMOAND_W', 'AMOOR_W', 'AMOMIN_W', 'AMOMAX_W', 'AMOMINU_W', 'AMOMAXU_W',
  'SH1ADD', 'SH2ADD', 'SH3ADD',
  'ANDN', 'ORN', 'XNOR', 'CLZ', 'CTZ', 'CPOP', 'SEXT_B', 'SEXT_H', 'ZEXT_H', 'MIN', 'MINU', 'MAX', 'MAXU',
  'ROL', 'ROR', 'RORI', 'ORC_B', 'REV8',
  'BCLR', 'BCLRI', 'BEXT', 'BEXTI', 'BINV', 'BINVI', 'BSET', 'BSETI',
  'PACK', 'PACKH', 'BREV8', 'ZIP', 'UNZIP',
  'CM_PUSH', 'CM_POP', 'CM_POPRET', 'CM_POPRETZ', 'CM_MVA01S', 'CM_MVSA01',
  'H3_BEXTM', 'H3_BEXTMI',
  'ILLEGAL',
];

/** Operation ids, by name: OP.ADDI, … The record's `op` is what an engine executes; `mn` is what the listing shows. */
export const OP = Object.freeze(Object.fromEntries(NAMES.map((n, i) => [n, i])));
export const OP_NAMES = Object.freeze(NAMES);

/** ABI register names, x0 to x31. */
export const ABI = Object.freeze(['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6']);

/**
 * @typedef {object} Decoded
 * @property {number} op     OP id of the operation executed
 * @property {number} rd
 * @property {number} rs1    (Zcmp: the register list, `rlist`, 4 to 15; CM_MVA01S/CM_MVSA01: the first s register)
 * @property {number} rs2    (CM_MVA01S/CM_MVSA01: the second s register)
 * @property {number} imm    sign-extended (U-type: the value of the instruction, already shifted; CSR: the CSR address;
 *                           shifts: the shift amount; Zcmp push/pop: the stack adjustment in bytes, signed)
 * @property {number} len    2 or 4
 * @property {string} mn     the mnemonic as written for this encoding ('c.addi', 'addi')
 * @property {string} fmt    operand template for disasm.js
 */

const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);
const ILLEGAL16 = Object.freeze({ op: OP.ILLEGAL, rd: 0, rs1: 0, rs2: 0, imm: 0, len: 2, mn: 'illegal', fmt: '' });
const ILLEGAL32 = Object.freeze({ op: OP.ILLEGAL, rd: 0, rs1: 0, rs2: 0, imm: 0, len: 4, mn: 'illegal', fmt: '' });

function rec(op, mn, fmt, len, rd = 0, rs1 = 0, rs2 = 0, imm = 0) {
  return { op, rd, rs1, rs2, imm, len, mn, fmt };
}

const immI = (w) => w >> 20;
const immS = (w) => ((w >> 25) << 5) | ((w >>> 7) & 31);
const immB = (w) => ((w >> 31) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3f) << 5) | (((w >>> 8) & 0xf) << 1);
const immJ = (w) => ((w >> 31) << 20) | (w & 0xff000) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3ff) << 1);

const LOADS = [['lb', OP.LB], ['lh', OP.LH], ['lw', OP.LW], null, ['lbu', OP.LBU], ['lhu', OP.LHU], null, null];
const STORES = [['sb', OP.SB], ['sh', OP.SH], ['sw', OP.SW], null, null, null, null, null];
const BRANCHES = [['beq', OP.BEQ], ['bne', OP.BNE], null, null, ['blt', OP.BLT], ['bge', OP.BGE], ['bltu', OP.BLTU], ['bgeu', OP.BGEU]];
const OPIMM = [['addi', OP.ADDI], null, ['slti', OP.SLTI], ['sltiu', OP.SLTIU], ['xori', OP.XORI], null, ['ori', OP.ORI], ['andi', OP.ANDI]];
const MULS = [['mul', OP.MUL], ['mulh', OP.MULH], ['mulhsu', OP.MULHSU], ['mulhu', OP.MULHU], ['div', OP.DIV], ['divu', OP.DIVU], ['rem', OP.REM], ['remu', OP.REMU]];
const ALU0 = [['add', OP.ADD], ['sll', OP.SLL], ['slt', OP.SLT], ['sltu', OP.SLTU], ['xor', OP.XOR], ['srl', OP.SRL], ['or', OP.OR], ['and', OP.AND]];
const CSRS = [null, ['csrrw', OP.CSRRW], ['csrrs', OP.CSRRS], ['csrrc', OP.CSRRC], null, ['csrrwi', OP.CSRRWI], ['csrrsi', OP.CSRRSI], ['csrrci', OP.CSRRCI]];
const AMOS = { 0x00: ['amoadd.w', OP.AMOADD_W], 0x01: ['amoswap.w', OP.AMOSWAP_W], 0x04: ['amoxor.w', OP.AMOXOR_W], 0x08: ['amoor.w', OP.AMOOR_W],
  0x0c: ['amoand.w', OP.AMOAND_W], 0x10: ['amomin.w', OP.AMOMIN_W], 0x14: ['amomax.w', OP.AMOMAX_W], 0x18: ['amominu.w', OP.AMOMINU_W],
  0x1c: ['amomaxu.w', OP.AMOMAXU_W] };

/** Decode a 32-bit instruction (its low 2 bits are 11). */
function decode32(w) {
  const opc = w & 0x7f, rd = (w >>> 7) & 31, f3 = (w >>> 12) & 7, rs1 = (w >>> 15) & 31, rs2 = (w >>> 20) & 31, f7 = w >>> 25;
  switch (opc) {
    case 0x37: return rec(OP.LUI, 'lui', 'rd,hi', 4, rd, 0, 0, w & 0xfffff000);
    case 0x17: return rec(OP.AUIPC, 'auipc', 'rd,hi', 4, rd, 0, 0, w & 0xfffff000);
    case 0x6f: return rec(OP.JAL, 'jal', 'rd,target', 4, rd, 0, 0, immJ(w));
    case 0x67: return f3 === 0 ? rec(OP.JALR, 'jalr', 'rd,imm(rs1)', 4, rd, rs1, 0, immI(w)) : ILLEGAL32;
    case 0x63: { const b = BRANCHES[f3]; return b ? rec(b[1], b[0], 'rs1,rs2,target', 4, 0, rs1, rs2, immB(w)) : ILLEGAL32; }
    case 0x03: { const l = LOADS[f3]; return l ? rec(l[1], l[0], 'rd,imm(rs1)', 4, rd, rs1, 0, immI(w)) : ILLEGAL32; }
    case 0x23: { const s = STORES[f3]; return s ? rec(s[1], s[0], 'rs2,imm(rs1)', 4, 0, rs1, rs2, immS(w)) : ILLEGAL32; }
    case 0x13: return decodeOpImm(w, rd, f3, rs1, rs2, f7);
    case 0x33: return decodeOp(w, rd, f3, rs1, rs2, f7);
    case 0x0f:
      // Hazard3 (rv_opcodes.vh): fence needs rd = rs1 = 0 and ignores the rest; fence.i is the one exact word
      if (f3 === 0) return rd === 0 && rs1 === 0 ? rec(OP.FENCE, 'fence', 'fence', 4, 0, 0, 0, (w >>> 20) & 0xfff) : ILLEGAL32;
      if (f3 === 1) return w === 0x0000100f ? rec(OP.FENCE_I, 'fence.i', '', 4) : ILLEGAL32;
      return ILLEGAL32;
    case 0x0b: // custom-0: Xh3bextm (hazard3_decode.v RVOPC_H3_BEXTM, _BEXTMI: bits 31:29 and 25 are zero, bits 28:26 hold size - 1)
      if ((w >>> 29) !== 0 || ((w >>> 25) & 1) !== 0) return ILLEGAL32;
      if (f3 === 0) return rec(OP.H3_BEXTM, 'h3.bextm', 'rd,rs1,rs2,size', 4, rd, rs1, rs2, ((w >>> 26) & 7) + 1);
      if (f3 === 4) return rec(OP.H3_BEXTMI, 'h3.bextmi', 'rd,rs1,shamt5,size', 4, rd, rs1, rs2, ((w >>> 26) & 7) + 1);
      return ILLEGAL32;
    case 0x2f: return decodeAmo(w, rd, f3, rs1, rs2);
    case 0x73: return decodeSystem(w, rd, f3, rs1, rs2);
    default: return ILLEGAL32;
  }
}

function decodeOpImm(w, rd, f3, rs1, rs2, f7) {
  const i = OPIMM[f3];
  if (i) return rec(i[1], i[0], 'rd,rs1,imm', 4, rd, rs1, 0, immI(w));
  const imm12 = w >>> 20;
  const un = (op, mn) => rec(op, mn, 'rd,rs1', 4, rd, rs1);
  const sh = (op, mn) => rec(op, mn, 'rd,rs1,shamt', 4, rd, rs1, 0, rs2);
  if (f3 === 1) {
    switch (f7) {
      case 0x00: return sh(OP.SLLI, 'slli');
      case 0x24: return sh(OP.BCLRI, 'bclri');
      case 0x14: return sh(OP.BSETI, 'bseti');
      case 0x34: return sh(OP.BINVI, 'binvi');
      case 0x30:
        switch (rs2) {
          case 0: return un(OP.CLZ, 'clz');
          case 1: return un(OP.CTZ, 'ctz');
          case 2: return un(OP.CPOP, 'cpop');
          case 4: return un(OP.SEXT_B, 'sext.b');
          case 5: return un(OP.SEXT_H, 'sext.h');
          default: return ILLEGAL32;
        }
      case 0x04: return imm12 === 0x08f ? un(OP.ZIP, 'zip') : ILLEGAL32;
      default: return ILLEGAL32;
    }
  }
  // f3 === 5
  switch (f7) {
    case 0x00: return sh(OP.SRLI, 'srli');
    case 0x20: return sh(OP.SRAI, 'srai');
    case 0x24: return sh(OP.BEXTI, 'bexti');
    case 0x30: return sh(OP.RORI, 'rori');
    case 0x14: return imm12 === 0x287 ? un(OP.ORC_B, 'orc.b') : ILLEGAL32;
    case 0x34: return imm12 === 0x698 ? un(OP.REV8, 'rev8') : imm12 === 0x687 ? un(OP.BREV8, 'brev8') : ILLEGAL32;
    case 0x04: return imm12 === 0x08f ? un(OP.UNZIP, 'unzip') : ILLEGAL32;
    default: return ILLEGAL32;
  }
}

function decodeOp(w, rd, f3, rs1, rs2, f7) {
  const r = (op, mn) => rec(op, mn, 'rd,rs1,rs2', 4, rd, rs1, rs2);
  switch (f7) {
    case 0x00: return r(ALU0[f3][1], ALU0[f3][0]);
    case 0x01: return r(MULS[f3][1], MULS[f3][0]);
    case 0x20:
      switch (f3) {
        case 0: return r(OP.SUB, 'sub');
        case 5: return r(OP.SRA, 'sra');
        case 7: return r(OP.ANDN, 'andn');
        case 6: return r(OP.ORN, 'orn');
        case 4: return r(OP.XNOR, 'xnor');
        default: return ILLEGAL32;
      }
    case 0x10: return f3 === 2 ? r(OP.SH1ADD, 'sh1add') : f3 === 4 ? r(OP.SH2ADD, 'sh2add') : f3 === 6 ? r(OP.SH3ADD, 'sh3add') : ILLEGAL32;
    case 0x05: return f3 >= 4 ? r([OP.MIN, OP.MINU, OP.MAX, OP.MAXU][f3 - 4], ['min', 'minu', 'max', 'maxu'][f3 - 4]) : ILLEGAL32;
    case 0x30: return f3 === 1 ? r(OP.ROL, 'rol') : f3 === 5 ? r(OP.ROR, 'ror') : ILLEGAL32;
    case 0x24: return f3 === 1 ? r(OP.BCLR, 'bclr') : f3 === 5 ? r(OP.BEXT, 'bext') : ILLEGAL32;
    case 0x14: return f3 === 1 ? r(OP.BSET, 'bset') : ILLEGAL32;
    case 0x34: return f3 === 1 ? r(OP.BINV, 'binv') : ILLEGAL32;
    case 0x04:
      if (f3 === 4) return rs2 === 0 ? rec(OP.ZEXT_H, 'zext.h', 'rd,rs1', 4, rd, rs1) : r(OP.PACK, 'pack');
      return f3 === 7 ? r(OP.PACKH, 'packh') : ILLEGAL32;
    default: return ILLEGAL32;
  }
}

function decodeAmo(w, rd, f3, rs1, rs2) {
  if (f3 !== 2) return ILLEGAL32;
  const f5 = w >>> 27;
  const aqrl = (w >>> 25) & 3;
  const f = (op, mn, fmt, r2) => ({ ...rec(op, mn, fmt, 4, rd, rs1, r2), aqrl });
  if (f5 === 0x02) return rs2 === 0 ? f(OP.LR_W, 'lr.w', 'rd,(rs1)', 0) : ILLEGAL32;
  if (f5 === 0x03) return f(OP.SC_W, 'sc.w', 'rd,rs2,(rs1)', rs2);
  const a = AMOS[f5];
  return a ? f(a[1], a[0], 'rd,rs2,(rs1)', rs2) : ILLEGAL32;
}

function decodeSystem(w, rd, f3, rs1, rs2) {
  if (f3 === 0) {
    if (rd !== 0 || rs1 !== 0) return ILLEGAL32;
    switch (w >>> 20) {
      case 0x000: return rs2 === 0 ? rec(OP.ECALL, 'ecall', '', 4) : ILLEGAL32;
      case 0x001: return rec(OP.EBREAK, 'ebreak', '', 4);
      case 0x302: return rec(OP.MRET, 'mret', '', 4);
      case 0x105: return rec(OP.WFI, 'wfi', '', 4);
      default: return ILLEGAL32;
    }
  }
  const c = CSRS[f3];
  if (!c) return ILLEGAL32;
  const csr = w >>> 20;
  return f3 < 4 ? rec(c[1], c[0], 'rd,csr,rs1', 4, rd, rs1, 0, csr) : rec(c[1], c[0], 'rd,csr,uimm', 4, rd, rs1, 0, csr);
}

// ---- compressed (Zca, Zcb, Zcmp) ----
const R3 = (v) => 8 + (v & 7);
const cjImm = (w) => sext(((w >>> 1) & 0x800) | ((w >>> 7) & 0x10) | ((w >>> 1) & 0x300) | ((w << 2) & 0x400) | ((w >>> 1) & 0x40) | ((w << 1) & 0x80)
  | ((w >>> 2) & 0xe) | ((w << 3) & 0x20), 12);
const cbImm = (w) => sext(((w >>> 4) & 0x100) | ((w >>> 7) & 0x18) | ((w << 1) & 0xc0) | ((w >>> 2) & 0x6) | ((w << 3) & 0x20), 9);
const ci6 = (w) => sext(((w >>> 7) & 0x20) | ((w >>> 2) & 0x1f), 6);

/** s0, s1, s2 … as `r1s'`/`r2s'` of Zcmp name them: 0, 1 are x8, x9; 2 to 7 are x18 to x23. */
const sreg = (v) => (v & 7) < 2 ? 8 + (v & 7) : 18 + (v & 7) - 2;

function decode16(w) {
  w &= 0xffff;
  const f3 = w >>> 13;
  const rdFull = (w >>> 7) & 31, rs2Full = (w >>> 2) & 31;
  switch (w & 3) {
    case 0: {
      switch (f3) {
        case 0: {
          const imm = ((w >>> 7) & 0x30) | ((w >>> 1) & 0x3c0) | ((w >>> 4) & 4) | ((w >>> 2) & 8);
          // the specification reserves imm = 0; Hazard3 (hazard3_instr_decompress.v) flags only the all-zero halfword
          return w === 0 ? ILLEGAL16 : rec(OP.ADDI, 'c.addi4spn', 'rd,sp,imm', 2, R3(w >>> 2), 2, 0, imm);
        }
        case 2: return rec(OP.LW, 'c.lw', 'rd,imm(rs1)', 2, R3(w >>> 2), R3(w >>> 7), 0, ((w >>> 7) & 0x38) | ((w >>> 4) & 4) | ((w << 1) & 0x40));
        case 6: return rec(OP.SW, 'c.sw', 'rs2,imm(rs1)', 2, 0, R3(w >>> 7), R3(w >>> 2), ((w >>> 7) & 0x38) | ((w >>> 4) & 4) | ((w << 1) & 0x40));
        case 4: { // Zcb loads and stores of bytes and halfwords
          const sel = (w >>> 10) & 7, ub = ((w >>> 5) & 1) << 1 | ((w >>> 6) & 1), uh = ((w >>> 5) & 1) << 1;
          const rs1 = R3(w >>> 7), r = R3(w >>> 2);
          switch (sel) {
            case 0: return rec(OP.LBU, 'c.lbu', 'rd,imm(rs1)', 2, r, rs1, 0, ub);
            case 1: return rec((w & 0x40) ? OP.LH : OP.LHU, (w & 0x40) ? 'c.lh' : 'c.lhu', 'rd,imm(rs1)', 2, r, rs1, 0, uh);
            case 2: return rec(OP.SB, 'c.sb', 'rs2,imm(rs1)', 2, 0, rs1, r, ub);
            case 3: return (w & 0x40) ? ILLEGAL16 : rec(OP.SH, 'c.sh', 'rs2,imm(rs1)', 2, 0, rs1, r, uh);
            default: return ILLEGAL16;
          }
        }
        default: return ILLEGAL16;
      }
    }
    case 1: {
      switch (f3) {
        case 0: {
          const imm = ci6(w);
          return rec(OP.ADDI, 'c.addi', 'rd,imm', 2, rdFull, rdFull, 0, imm); // rd = 0: c.nop, or a hint, as objdump words it
        }
        case 1: return rec(OP.JAL, 'c.jal', 'target', 2, 1, 0, 0, cjImm(w));
        case 2: return rec(OP.ADDI, 'c.li', 'rd,imm', 2, rdFull, 0, 0, ci6(w));
        case 3: {
          if (rdFull === 2) {
            const imm = sext(((w >>> 3) & 0x200) | ((w >>> 2) & 0x10) | ((w << 1) & 0x40) | ((w << 4) & 0x180) | ((w << 3) & 0x20), 10);
            return imm === 0 ? ILLEGAL16 : rec(OP.ADDI, 'c.addi16sp', 'sp,imm', 2, 2, 2, 0, imm);
          }
          const imm = ci6(w);
          return imm === 0 ? ILLEGAL16 : rec(OP.LUI, 'c.lui', 'rd,hi', 2, rdFull, 0, 0, imm << 12);
        }
        case 4: {
          const rd = R3(w >>> 7), sel = (w >>> 10) & 3;
          if (sel === 0 || sel === 1) {
            if (w & 0x1000) return ILLEGAL16; // shift amount above 31 (RV32: reserved/NSE)
            return sel === 0 ? rec(OP.SRLI, 'c.srli', 'rd,shamt', 2, rd, rd, 0, (w >>> 2) & 31) : rec(OP.SRAI, 'c.srai', 'rd,shamt', 2, rd, rd, 0, (w >>> 2) & 31);
          }
          if (sel === 2) return rec(OP.ANDI, 'c.andi', 'rd,imm', 2, rd, rd, 0, ci6(w));
          const rs2 = R3(w >>> 2), sub = (w >>> 5) & 3;
          if (!(w & 0x1000)) return rec([OP.SUB, OP.XOR, OP.OR, OP.AND][sub], ['c.sub', 'c.xor', 'c.or', 'c.and'][sub], 'rd,rs2', 2, rd, rd, rs2);
          if (sub === 2) return rec(OP.MUL, 'c.mul', 'rd,rs2', 2, rd, rd, rs2);
          if (sub !== 3) return ILLEGAL16;
          switch ((w >>> 2) & 7) {
            case 0: return rec(OP.ANDI, 'c.zext.b', 'rd', 2, rd, rd, 0, 0xff);
            case 1: return rec(OP.SEXT_B, 'c.sext.b', 'rd', 2, rd, rd);
            case 2: return rec(OP.ZEXT_H, 'c.zext.h', 'rd', 2, rd, rd);
            case 3: return rec(OP.SEXT_H, 'c.sext.h', 'rd', 2, rd, rd);
            case 5: return rec(OP.XORI, 'c.not', 'rd', 2, rd, rd, 0, -1);
            default: return ILLEGAL16;
          }
        }
        case 5: return rec(OP.JAL, 'c.j', 'target', 2, 0, 0, 0, cjImm(w));
        case 6: return rec(OP.BEQ, 'c.beqz', 'rs1,target', 2, 0, R3(w >>> 7), 0, cbImm(w));
        default: return rec(OP.BNE, 'c.bnez', 'rs1,target', 2, 0, R3(w >>> 7), 0, cbImm(w));
      }
    }
    default: {
      switch (f3) {
        case 0: return (w & 0x1000) ? ILLEGAL16 : rec(OP.SLLI, 'c.slli', 'rd,shamt', 2, rdFull, rdFull, 0, (w >>> 2) & 31);
        case 2: return rdFull === 0 ? ILLEGAL16 : rec(OP.LW, 'c.lwsp', 'rd,imm(sp)', 2, rdFull, 2, 0, ((w >>> 7) & 0x20) | ((w >>> 2) & 0x1c) | ((w << 4) & 0xc0));
        case 6: return rec(OP.SW, 'c.swsp', 'rs2,imm(sp)', 2, 0, 2, rs2Full, ((w >>> 7) & 0x3c) | ((w >>> 1) & 0xc0));
        case 4:
          if (!(w & 0x1000)) {
            if (rs2Full === 0) return rdFull === 0 ? ILLEGAL16 : rec(OP.JALR, 'c.jr', 'rs1', 2, 0, rdFull, 0, 0);
            return rec(OP.ADD, 'c.mv', 'rd,rs2', 2, rdFull, 0, rs2Full);
          }
          if (rs2Full === 0) return rdFull === 0 ? rec(OP.EBREAK, 'c.ebreak', '', 2) : rec(OP.JALR, 'c.jalr', 'rs1', 2, 1, rdFull, 0, 0);
          return rec(OP.ADD, 'c.add', 'rd,rs2', 2, rdFull, rdFull, rs2Full);
        case 5: return decodeZcmp(w);
        default: return ILLEGAL16;
      }
    }
  }
}

/** Zcmp: cm.push, cm.pop, cm.popret, cm.popretz, cm.mva01s, cm.mvsa01 (quadrant 2, funct3 101). */
function decodeZcmp(w) {
  const top = (w >>> 8) & 0x1f;
  if (((w >>> 10) & 0x3f) === 0x2b) { // 101011: the two moves
    const kind = (w >>> 5) & 3;
    if (kind === 3) return rec(OP.CM_MVA01S, 'cm.mva01s', 'sa,sb', 2, 0, (w >>> 7) & 7, (w >>> 2) & 7);
    // Hazard3's pattern (rv_opcodes.vh RVOPC_CM_MVSA01) has no r1s' != r2s' check, although the Zcmp specification reserves it
    if (kind === 1) return rec(OP.CM_MVSA01, 'cm.mvsa01', 'sa,sb', 2, 0, (w >>> 7) & 7, (w >>> 2) & 7);
    return ILLEGAL16;
  }
  const names = { 0x18: ['cm.push', OP.CM_PUSH], 0x1a: ['cm.pop', OP.CM_POP], 0x1c: ['cm.popretz', OP.CM_POPRETZ], 0x1e: ['cm.popret', OP.CM_POPRET] };
  const n = names[top];
  const rlist = (w >>> 4) & 15;
  if (!n || rlist < 4) return ILLEGAL16;
  const base = rlist < 8 ? 16 : rlist < 12 ? 32 : rlist < 15 ? 48 : 64;
  const adj = base + ((w >>> 2) & 3) * 16;
  return rec(n[1], n[0], 'rlist,imm', 2, 0, rlist, 0, top === 0x18 ? -adj : adj);
}

/** The register numbers a Zcmp push, pop or popret of this register list covers: ra, s0, s1, then x18 upward. */
export function zcmpRegisters(rlist) {
  const out = [1];
  const n = rlist === 15 ? 12 : rlist - 4; // s registers
  for (let i = 0; i < n; i++) out.push(i < 2 ? 8 + i : 18 + i - 2);
  return out;
}

/** The register number of a Zcmp `r1s'`/`r2s'` field. */
export const zcmpSReg = sreg;

/**
 * Decode the instruction in a fetch word: its low 16 bits are the first halfword, the high 16 bits the next
 * (ignored for a compressed instruction). Returns a fresh record.
 * @param {number} word
 * @returns {Decoded}
 */
export function decode(word) {
  word |= 0;
  return (word & 3) === 3 ? decode32(word) : decode16(word);
}
