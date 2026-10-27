// encoding.js -- the RV32I + M (+ Zicsr, mret, wfi) encoding table: formats,
// opcodes, funct3/funct7, immediate packing and unpacking. One table drives
// the assembler, the disassembler and the decoder of the simulator (spec
// §5.2). Encodings follow the RISC-V Unprivileged ISA.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const OPCODE = Object.freeze({
  LOAD: 0b0000011, MISC_MEM: 0b0001111, OP_IMM: 0b0010011, AUIPC: 0b0010111,
  STORE: 0b0100011, OP: 0b0110011, LUI: 0b0110111, BRANCH: 0b1100011,
  JALR: 0b1100111, JAL: 0b1101111, SYSTEM: 0b1110011,
});

export const HALT_WORD = 0x0000006f; // jal x0, 0

export const ABI_NAMES = Object.freeze([
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11',
  't3', 't4', 't5', 't6',
]);

// Field layout of each format, bit 31 first (WS-F-021, WS-F-022).
export const FORMAT_FIELDS = Object.freeze({
  R: [['funct7', 31, 25], ['rs2', 24, 20], ['rs1', 19, 15], ['funct3', 14, 12], ['rd', 11, 7], ['opcode', 6, 0]],
  I: [['imm[11:0]', 31, 20], ['rs1', 19, 15], ['funct3', 14, 12], ['rd', 11, 7], ['opcode', 6, 0]],
  S: [['imm[11:5]', 31, 25], ['rs2', 24, 20], ['rs1', 19, 15], ['funct3', 14, 12], ['imm[4:0]', 11, 7], ['opcode', 6, 0]],
  B: [['imm[12|10:5]', 31, 25], ['rs2', 24, 20], ['rs1', 19, 15], ['funct3', 14, 12], ['imm[4:1|11]', 11, 7], ['opcode', 6, 0]],
  U: [['imm[31:12]', 31, 12], ['rd', 11, 7], ['opcode', 6, 0]],
  J: [['imm[20|10:1|11|19:12]', 31, 12], ['rd', 11, 7], ['opcode', 6, 0]],
});

// Instruction classes of the performance model, as rvsim.py counts them (WS-F-092).
export const CLASSES = Object.freeze(['alu', 'load', 'store', 'branch_taken', 'branch_not_taken',
  'jump', 'mul', 'div', 'system']);

// mn: [format, opcode, funct3, funct7 (or funct12 / fixed word), operand syntax, class]
// Operand syntax: 'rd,rs1,rs2' | 'rd,rs1,imm' | 'rd,rs1,shamt' | 'rd,mem' | 'rs2,mem' |
// 'rs1,rs2,target' | 'rd,imm20' | 'rd,target' | 'jalr' | 'fence' | '' | 'csr' | 'csri'.
const T = (fmt, op, f3, f7, syntax, cls) => Object.freeze({ fmt, op, f3, f7, syntax, cls });
const { LOAD, MISC_MEM, OP_IMM, AUIPC, STORE, OP, LUI, BRANCH, JALR, JAL, SYSTEM } = OPCODE;

export const INSTRUCTIONS = Object.freeze({
  lui: T('U', LUI, null, null, 'rd,imm20', 'alu'),
  auipc: T('U', AUIPC, null, null, 'rd,imm20', 'alu'),
  jal: T('J', JAL, null, null, 'rd,target', 'jump'),
  jalr: T('I', JALR, 0, null, 'jalr', 'jump'),
  beq: T('B', BRANCH, 0, null, 'rs1,rs2,target', 'branch'),
  bne: T('B', BRANCH, 1, null, 'rs1,rs2,target', 'branch'),
  blt: T('B', BRANCH, 4, null, 'rs1,rs2,target', 'branch'),
  bge: T('B', BRANCH, 5, null, 'rs1,rs2,target', 'branch'),
  bltu: T('B', BRANCH, 6, null, 'rs1,rs2,target', 'branch'),
  bgeu: T('B', BRANCH, 7, null, 'rs1,rs2,target', 'branch'),
  lb: T('I', LOAD, 0, null, 'rd,mem', 'load'),
  lh: T('I', LOAD, 1, null, 'rd,mem', 'load'),
  lw: T('I', LOAD, 2, null, 'rd,mem', 'load'),
  lbu: T('I', LOAD, 4, null, 'rd,mem', 'load'),
  lhu: T('I', LOAD, 5, null, 'rd,mem', 'load'),
  sb: T('S', STORE, 0, null, 'rs2,mem', 'store'),
  sh: T('S', STORE, 1, null, 'rs2,mem', 'store'),
  sw: T('S', STORE, 2, null, 'rs2,mem', 'store'),
  addi: T('I', OP_IMM, 0, null, 'rd,rs1,imm', 'alu'),
  slti: T('I', OP_IMM, 2, null, 'rd,rs1,imm', 'alu'),
  sltiu: T('I', OP_IMM, 3, null, 'rd,rs1,imm', 'alu'),
  xori: T('I', OP_IMM, 4, null, 'rd,rs1,imm', 'alu'),
  ori: T('I', OP_IMM, 6, null, 'rd,rs1,imm', 'alu'),
  andi: T('I', OP_IMM, 7, null, 'rd,rs1,imm', 'alu'),
  slli: T('I', OP_IMM, 1, 0x00, 'rd,rs1,shamt', 'alu'),
  srli: T('I', OP_IMM, 5, 0x00, 'rd,rs1,shamt', 'alu'),
  srai: T('I', OP_IMM, 5, 0x20, 'rd,rs1,shamt', 'alu'),
  add: T('R', OP, 0, 0x00, 'rd,rs1,rs2', 'alu'),
  sub: T('R', OP, 0, 0x20, 'rd,rs1,rs2', 'alu'),
  sll: T('R', OP, 1, 0x00, 'rd,rs1,rs2', 'alu'),
  slt: T('R', OP, 2, 0x00, 'rd,rs1,rs2', 'alu'),
  sltu: T('R', OP, 3, 0x00, 'rd,rs1,rs2', 'alu'),
  xor: T('R', OP, 4, 0x00, 'rd,rs1,rs2', 'alu'),
  srl: T('R', OP, 5, 0x00, 'rd,rs1,rs2', 'alu'),
  sra: T('R', OP, 5, 0x20, 'rd,rs1,rs2', 'alu'),
  or: T('R', OP, 6, 0x00, 'rd,rs1,rs2', 'alu'),
  and: T('R', OP, 7, 0x00, 'rd,rs1,rs2', 'alu'),
  mul: T('R', OP, 0, 0x01, 'rd,rs1,rs2', 'mul'),
  mulh: T('R', OP, 1, 0x01, 'rd,rs1,rs2', 'mul'),
  mulhsu: T('R', OP, 2, 0x01, 'rd,rs1,rs2', 'mul'),
  mulhu: T('R', OP, 3, 0x01, 'rd,rs1,rs2', 'mul'),
  div: T('R', OP, 4, 0x01, 'rd,rs1,rs2', 'div'),
  divu: T('R', OP, 5, 0x01, 'rd,rs1,rs2', 'div'),
  rem: T('R', OP, 6, 0x01, 'rd,rs1,rs2', 'div'),
  remu: T('R', OP, 7, 0x01, 'rd,rs1,rs2', 'div'),
  fence: T('I', MISC_MEM, 0, null, 'fence', 'system'),
  'fence.i': T('I', MISC_MEM, 1, null, '', 'system'),
  ecall: T('I', SYSTEM, 0, 0x000, '', 'system'),
  ebreak: T('I', SYSTEM, 0, 0x001, '', 'system'),
  wfi: T('I', SYSTEM, 0, 0x105, '', 'system'),
  mret: T('I', SYSTEM, 0, 0x302, '', 'system'),
  csrrw: T('I', SYSTEM, 1, null, 'csr', 'system'),
  csrrs: T('I', SYSTEM, 2, null, 'csr', 'system'),
  csrrc: T('I', SYSTEM, 3, null, 'csr', 'system'),
  csrrwi: T('I', SYSTEM, 5, null, 'csri', 'system'),
  csrrsi: T('I', SYSTEM, 6, null, 'csri', 'system'),
  csrrci: T('I', SYSTEM, 7, null, 'csri', 'system'),
});

// Machine-mode CSR numbers accepted by the assembler (as rvasm.py, via rvpriv.CSR).
export const CSR_NUMBERS = Object.freeze({
  mstatus: 0x300, misa: 0x301, mie: 0x304, mtvec: 0x305, mstatush: 0x310,
  mscratch: 0x340, mepc: 0x341, mcause: 0x342, mtval: 0x343, mip: 0x344,
  pmpcfg0: 0x3a0, pmpcfg1: 0x3a1,
  pmpaddr0: 0x3b0, pmpaddr1: 0x3b1, pmpaddr2: 0x3b2, pmpaddr3: 0x3b3,
  pmpaddr4: 0x3b4, pmpaddr5: 0x3b5, pmpaddr6: 0x3b6, pmpaddr7: 0x3b7,
  mcycle: 0xb00, minstret: 0xb02, mcycleh: 0xb80, minstreth: 0xb82,
  mvendorid: 0xf11, marchid: 0xf12, mimpid: 0xf13, mhartid: 0xf14,
});

// --- bit helpers -------------------------------------------------------------
export const bits = (w, hi, lo) => (hi - lo === 31 ? w >>> 0 : (w >>> lo) & ((1 << (hi - lo + 1)) - 1));
export const sext = (v, n) => (n >= 32 ? v | 0 : ((v << (32 - n)) >> (32 - n)));

export const immI = (w) => sext(bits(w, 31, 20), 12);
export const immS = (w) => sext((bits(w, 31, 25) << 5) | bits(w, 11, 7), 12);
export const immB = (w) => sext((bits(w, 31, 31) << 12) | (bits(w, 7, 7) << 11)
  | (bits(w, 30, 25) << 5) | (bits(w, 11, 8) << 1), 13);
export const immU = (w) => (w & 0xfffff000) | 0;
export const immJ = (w) => sext((bits(w, 31, 31) << 20) | (bits(w, 19, 12) << 12)
  | (bits(w, 20, 20) << 11) | (bits(w, 30, 21) << 1), 21);

// --- packing (values already range-checked by the assembler) -------------------
export function packR(op, f3, f7, rd, rs1, rs2) {
  return ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
}
export function packI(op, f3, rd, rs1, imm) {
  return (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
}
export function packS(op, f3, rs1, rs2, imm) {
  const i = imm & 0xfff;
  return (((i >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((i & 0x1f) << 7) | op) >>> 0;
}
export function packB(op, f3, rs1, rs2, off) {
  const o = off & 0x1fff;
  return ((((o >> 12) & 1) << 31) | (((o >> 5) & 0x3f) << 25) | (rs2 << 20) | (rs1 << 15)
    | (f3 << 12) | (((o >> 1) & 0xf) << 8) | (((o >> 11) & 1) << 7) | op) >>> 0;
}
export function packU(op, rd, imm20) {
  return (((imm20 & 0xfffff) << 12) | (rd << 7) | op) >>> 0;
}
export function packJ(op, rd, off) {
  const o = off & 0x1fffff;
  return ((((o >> 20) & 1) << 31) | (((o >> 1) & 0x3ff) << 21) | (((o >> 11) & 1) << 20)
    | (((o >> 12) & 0xff) << 12) | (rd << 7) | op) >>> 0;
}

// --- decoding ------------------------------------------------------------------
const BY_KEY = new Map();
for (const [mn, d] of Object.entries(INSTRUCTIONS)) {
  BY_KEY.set(`${d.op}/${d.f3}/${d.fmt === 'R' || d.syntax === 'rd,rs1,shamt' ? d.f7 : ''}`, mn);
}

/** Mnemonic of a 32-bit word, or null if it is not an RV32I/M/Zicsr instruction. */
export function decodeMnemonic(w) {
  const op = w & 0x7f;
  const f3 = bits(w, 14, 12);
  const f7 = bits(w, 31, 25);
  switch (op) {
    case LUI: return 'lui';
    case AUIPC: return 'auipc';
    case JAL: return 'jal';
    case OP: return BY_KEY.get(`${op}/${f3}/${f7}`) ?? null;
    case OP_IMM:
      if (f3 === 1 || f3 === 5) return BY_KEY.get(`${op}/${f3}/${f7}`) ?? null;
      return BY_KEY.get(`${op}/${f3}/`) ?? null;
    case SYSTEM:
      if (f3 === 0) {
        if (bits(w, 11, 7) !== 0 || bits(w, 19, 15) !== 0) return null;
        return { 0x000: 'ecall', 0x001: 'ebreak', 0x105: 'wfi', 0x302: 'mret' }[bits(w, 31, 20)] ?? null;
      }
      return BY_KEY.get(`${op}/${f3}/`) ?? null;
    default:
      return BY_KEY.get(`${op}/${f3}/`) ?? null;
  }
}

/** Fields of a word for the listing and field-breakdown panel (WS-F-021, WS-F-022). */
export function fields(w, fmt) {
  return FORMAT_FIELDS[fmt].map(([name, hi, lo]) => ({ name, hi, lo, value: bits(w, hi, lo) }));
}

export function formatOf(mn) {
  return INSTRUCTIONS[mn]?.fmt ?? null;
}
