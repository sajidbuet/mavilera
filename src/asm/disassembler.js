// disassembler.js -- disassembly of RV32IM, Zicsr, mret and wfi words
// (spec §5.2). Style 'base' is the text of rvdis.py and objdump -M no-aliases:
// decimal immediates, hexadecimal lui/auipc immediates and shift amounts,
// absolute hexadecimal branch and jal targets without 0x (WS-V-013). Style
// 'alias' prints the common pseudo-instructions instead, for reading.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import {
  INSTRUCTIONS, ABI_NAMES, bits, immI, immS, immB, immJ, decodeMnemonic,
} from '../isa/encoding.js';

// Machine-mode CSR names as the pinned objdump prints them; mstatush (0x310) is
// printed as a number (rvdis.py).
const CSR_NAMES = {
  0x300: 'mstatus', 0x301: 'misa', 0x304: 'mie', 0x305: 'mtvec', 0x340: 'mscratch', 0x341: 'mepc',
  0x342: 'mcause', 0x343: 'mtval', 0x344: 'mip', 0x3a0: 'pmpcfg0', 0x3a1: 'pmpcfg1',
  0x3b0: 'pmpaddr0', 0x3b1: 'pmpaddr1', 0x3b2: 'pmpaddr2', 0x3b3: 'pmpaddr3',
  0x3b4: 'pmpaddr4', 0x3b5: 'pmpaddr5', 0x3b6: 'pmpaddr6', 0x3b7: 'pmpaddr7',
  0xb00: 'mcycle', 0xb02: 'minstret', 0xb80: 'mcycleh', 0xb82: 'minstreth',
  0xf11: 'mvendorid', 0xf12: 'marchid', 0xf13: 'mimpid', 0xf14: 'mhartid',
};

export function regName(n, names = 'abi') {
  return names === 'abi' ? ABI_NAMES[n] : `x${n}`;
}

const hex = (v) => (v >>> 0).toString(16);
const fenceSet = (v) => ['i', 'o', 'r', 'w'].filter((_, k) => v & (8 >> k)).join('') || '0';

/** Base-mnemonic text of one word at address pc. */
export function disassemble(w, pc = 0, names = 'abi') {
  const word = w >>> 0;
  const r = (n) => regName(n, names);
  const mn = decodeMnemonic(word);
  if (!mn) return `.word 0x${hex(word).padStart(8, '0')}`;
  const d = INSTRUCTIONS[mn];
  const rd = bits(word, 11, 7);
  const rs1 = bits(word, 19, 15);
  const rs2 = bits(word, 24, 20);
  switch (d.syntax) {
    case 'rd,imm20': return `${mn} ${r(rd)},0x${hex(bits(word, 31, 12))}`;
    case 'rd,target': return `${mn} ${r(rd)},${hex(pc + immJ(word))}`;
    case 'jalr': return `${mn} ${r(rd)},${immI(word)}(${r(rs1)})`;
    case 'rs1,rs2,target': return `${mn} ${r(rs1)},${r(rs2)},${hex(pc + immB(word))}`;
    case 'rd,mem': return `${mn} ${r(rd)},${immI(word)}(${r(rs1)})`;
    case 'rs2,mem': return `${mn} ${r(rs2)},${immS(word)}(${r(rs1)})`;
    case 'rd,rs1,shamt': return `${mn} ${r(rd)},${r(rs1)},0x${hex(rs2)}`;
    case 'rd,rs1,imm': return `${mn} ${r(rd)},${r(rs1)},${immI(word)}`;
    case 'rd,rs1,rs2': return `${mn} ${r(rd)},${r(rs1)},${r(rs2)}`;
    case 'fence': return `fence ${fenceSet(bits(word, 27, 24))},${fenceSet(bits(word, 23, 20))}`;
    case 'csr': case 'csri': {
      const num = bits(word, 31, 20);
      const name = CSR_NAMES[num] ?? `0x${hex(num)}`;
      return `${mn} ${r(rd)},${name},${d.syntax === 'csr' ? r(rs1) : String(rs1)}`;
    }
    default: return mn;
  }
}

/** Text with the common pseudo-instructions (nop, li, mv, j, ret, beqz, ...). */
export function disassembleAlias(w, pc = 0, names = 'abi') {
  const word = w >>> 0;
  const mn = decodeMnemonic(word);
  const r = (n) => regName(n, names);
  const rd = bits(word, 11, 7);
  const rs1 = bits(word, 19, 15);
  const rs2 = bits(word, 24, 20);
  if (mn === 'addi') {
    const i = immI(word);
    if (rd === 0 && rs1 === 0 && i === 0) return 'nop';
    if (rs1 === 0) return `li ${r(rd)},${i}`;
    if (i === 0) return `mv ${r(rd)},${r(rs1)}`;
  }
  if (mn === 'xori' && immI(word) === -1) return `not ${r(rd)},${r(rs1)}`;
  if (mn === 'sub' && rs1 === 0) return `neg ${r(rd)},${r(rs2)}`;
  if (mn === 'sltiu' && immI(word) === 1) return `seqz ${r(rd)},${r(rs1)}`;
  if (mn === 'sltu' && rs1 === 0) return `snez ${r(rd)},${r(rs2)}`;
  if (mn === 'jal') {
    const t = hex(pc + immJ(word));
    if (rd === 0) return `j ${t}`;
    if (rd === 1) return `jal ${t}`;
  }
  if (mn === 'jalr' && immI(word) === 0) {
    if (rd === 0 && rs1 === 1) return 'ret';
    if (rd === 0) return `jr ${r(rs1)}`;
    if (rd === 1) return `jalr ${r(rs1)}`;
  }
  if ((mn === 'beq' || mn === 'bne' || mn === 'blt' || mn === 'bge') && rs2 === 0) {
    return `${mn}z ${r(rs1)},${hex(pc + immB(word))}`;
  }
  return disassemble(word, pc, names);
}

/** Words of a $readmemh image (one word per line) or of a little-endian .bin (WS-F-026). */
export function readWords(content, kind) {
  if (kind === 'hex') {
    const words = [];
    for (const raw of content.split(/\r\n|\r|\n/)) {
      const line = raw.split('//', 1)[0].split('#', 1)[0].trim();
      if (line && !line.startsWith('@')) {
        if (!/^[0-9a-fA-F]+$/.test(line)) throw new Error(`bad hex word '${line}'`);
        words.push(parseInt(line, 16) >>> 0);
      }
    }
    return words;
  }
  const b = content;
  const out = [];
  for (let i = 0; i + 3 < b.length; i += 4) out.push((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0);
  return out;
}
