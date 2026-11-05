// rvsimt/isa.js -- the instruction set of the RISC-V SIMT laboratory core (GPU-2; decision G14): the subset of the
// textbook's Chapter 11A brief §16 (book decisions D9-D11). Per thread RV32I without auipc, jalr, byte and half-word
// loads and stores, fence, ecall and ebreak; of Zicsr only csrr rd, csr (csrrs rd, csr, x0) on the six identity CSRs;
// warp control on custom-0 (opcode 0001011), R-type, funct7 0: funct3 tmc 0, wspawn 1, split 2, join 3, bar 4. Any
// other word is illegal and faults when it issues. Written from the specification; decoding, names and wording are
// MAVILERA's. The assembler side (built-in names of simt.inc, decision G18) is `ASM_CUSTOM`.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { bits, immI, immS, immB, immU, immJ, ABI_NAMES } from '../../../isa/encoding.js';
import { disassemble as rvDisassemble } from '../../../asm/disassembler.js';

export const CUSTOM0 = 0x0b;
export const WARP_OPS = Object.freeze(['tmc', 'wspawn', 'split', 'join', 'bar']);
/** The identity CSRs (book D11), read-only: number → name. */
export const CSRS = Object.freeze({ 0xcc0: 'thread_index', 0xcc1: 'lane_id', 0xcc2: 'warp_id', 0xcc3: 'block_index', 0xcc4: 'block_size', 0xcc5: 'kernel_args' });
/** The assembler names of simt.inc (`.equ`), the same values. */
export const SIMT_INC_SYMBOLS = Object.freeze({ LANES: 4, THREAD_INDEX: 0xcc0, LANE_ID: 0xcc1, WARP_ID: 0xcc2, BLOCK_INDEX: 0xcc3, BLOCK_SIZE: 0xcc4, KERNEL_ARGS: 0xcc5 });

const BRANCH = ['beq', 'bne', null, null, 'blt', 'bge', 'bltu', 'bgeu'];
const OP_IMM = ['addi', 'slli', 'slti', 'sltiu', 'xori', 'srli', 'ori', 'andi'];
const OP_REG = { '0,0': 'add', '0,32': 'sub', '1,0': 'sll', '2,0': 'slt', '3,0': 'sltu', '4,0': 'xor', '5,0': 'srl', '5,32': 'sra', '6,0': 'or', '7,0': 'and' };

/**
 * The instruction a word encodes in the subset: {op, rd, rs1, rs2, imm, csr}; `op` null when the core faults on it
 * (illegal instruction, fault code 2).
 */
export function decode(w) {
  w >>>= 0;
  const opc = w & 0x7f;
  const f3 = bits(w, 14, 12);
  const f7 = w >>> 25;
  const d = { op: null, rd: bits(w, 11, 7), rs1: bits(w, 19, 15), rs2: bits(w, 24, 20), imm: 0, csr: null };
  switch (opc) {
    case 0x37: d.op = 'lui'; d.imm = immU(w) >>> 0; break;
    case 0x6f: d.op = 'jal'; d.imm = immJ(w); break;
    case 0x63: d.op = BRANCH[f3]; d.imm = immB(w); break;
    case 0x03: if (f3 === 2) { d.op = 'lw'; d.imm = immI(w); } break;
    case 0x23: if (f3 === 2) { d.op = 'sw'; d.imm = immS(w); } break;
    case 0x13:
      if (f3 === 1) { if (f7 === 0) { d.op = 'slli'; d.imm = d.rs2; } }
      else if (f3 === 5) { if (f7 === 0) d.op = 'srli'; else if (f7 === 0x20) d.op = 'srai'; d.imm = d.rs2; }
      else { d.op = OP_IMM[f3]; d.imm = immI(w); }
      break;
    case 0x33: d.op = OP_REG[`${f3},${f7}`] ?? null; break;
    case 0x73: {
      const csr = w >>> 20;
      if (f3 === 2 && d.rs1 === 0 && Object.hasOwn(CSRS, csr)) { d.op = 'csrr'; d.csr = csr; }
      break;
    }
    case CUSTOM0: if (f7 === 0 && f3 <= 4) d.op = WARP_OPS[f3]; break;
    default: break;
  }
  return d;
}

const reg = (n) => ABI_NAMES[n];

/** The word as the listing shows it: the warp-control mnemonics and the identity CSR names; else RISC-V's. */
export function disassemble(w, pc = 0, names = 'abi') {
  const d = decode(w);
  const r = (n) => (names === 'abi' ? reg(n) : `x${n}`);
  switch (d.op) {
    case null: return `.word 0x${(w >>> 0).toString(16).padStart(8, '0')}`;
    case 'tmc': case 'split': return `${d.op} ${r(d.rs1)}`;
    case 'wspawn': case 'bar': return `${d.op} ${r(d.rs1)}, ${r(d.rs2)}`;
    case 'join': return 'join';
    case 'csrr': return `csrr ${r(d.rd)}, ${CSRS[d.csr]}`;
    default: return rvDisassemble(w, pc, names);
  }
}

/**
 * The assembler's additions (src/asm/assembler.js `options.custom`, decision G18): the five warp-control mnemonics,
 * the names of simt.inc and the identity CSR names; `.include "simt.inc"` is accepted. `machine` describes the core's
 * memories for the assembler's size checks: 64 instruction words and 256 data words, both from address 0.
 */
export const ASM_CUSTOM = Object.freeze({
  instructions: Object.freeze({
    tmc: { opcode: CUSTOM0, f3: 0, operands: ['rs1'] },
    wspawn: { opcode: CUSTOM0, f3: 1, operands: ['rs1', 'rs2'] },
    split: { opcode: CUSTOM0, f3: 2, operands: ['rs1'] },
    join: { opcode: CUSTOM0, f3: 3, operands: [] },
    bar: { opcode: CUSTOM0, f3: 4, operands: ['rs1', 'rs2'] },
  }),
  symbols: SIMT_INC_SYMBOLS,
  csrs: Object.freeze(Object.fromEntries(Object.entries(CSRS).map(([n, name]) => [name, Number(n)]))),
  includes: Object.freeze(['simt.inc']),
  localLabels: true, // GNU's `1:` with `1f` and `1b`, which the laboratory's programs use
});

export const IMEM_WORDS = 64;
export const DMEM_WORDS = 256;
