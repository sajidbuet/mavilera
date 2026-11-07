// disasm.js -- text of a decoded instruction for the pico2 module's listing: the base mnemonics, no pseudo-instruction
// aliases, ABI register names, in the operand order of the RISC-V assembly syntax. Compressed instructions keep their
// own mnemonic (`c.addi a0,4`). Checked against GNU objdump (`-M no-aliases`) by tools/pico2-decode-oracle.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ABI, OP, decode, zcmpRegisters, zcmpSReg } from './decode.js';

/** Names of the CSRs of the RP2350's Hazard3 (RP-001 §3.8.9, R-HZ-01 §3.13); others print as hexadecimal numbers. */
export const CSR_NAMES = Object.freeze({
  0x300: 'mstatus', 0x301: 'misa', 0x302: 'medeleg', 0x303: 'mideleg', 0x304: 'mie', 0x305: 'mtvec', 0x306: 'mcounteren',
  0x310: 'mstatush', 0x320: 'mcountinhibit', 0x340: 'mscratch', 0x341: 'mepc', 0x342: 'mcause', 0x343: 'mtval', 0x344: 'mip',
  0x30a: 'menvcfg', 0x31a: 'menvcfgh',
  0x3a0: 'pmpcfg0', 0x3a1: 'pmpcfg1', 0x3a2: 'pmpcfg2', 0x3a3: 'pmpcfg3',
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [0x3b0 + i, `pmpaddr${i}`])),
  0x747: 'mseccfg', 0x757: 'mseccfgh',
  0xb00: 'mcycle', 0xb02: 'minstret', 0xb80: 'mcycleh', 0xb82: 'minstreth',
  0xc00: 'cycle', 0xc02: 'instret', 0xc80: 'cycleh', 0xc82: 'instreth',
  0xf11: 'mvendorid', 0xf12: 'marchid', 0xf13: 'mimpid', 0xf14: 'mhartid', 0xf15: 'mconfigptr',
  0x7a0: 'tselect', 0x7a1: 'tdata1', 0x7a2: 'tdata2', 0x7a3: 'tdata3', 0x7a8: 'mcontext', 0x7a4: 'tinfo', 0x7a5: 'tcontrol',
  0x7b0: 'dcsr', 0x7b1: 'dpc',
  0xbe0: 'meiea', 0xbe1: 'meipa', 0xbe2: 'meifa', 0xbe3: 'meipra', 0xbe4: 'meinext', 0xbe5: 'meicontext',
  0xbd0: 'pmpcfgm0', 0xbf0: 'msleep', 0x8f0: 'sleep', 0xbff: 'dmdata0',
});

const hex = (v) => '0x' + (v >>> 0).toString(16);
const fenceSet = (v) => ((v & 8 ? 'i' : '') + (v & 4 ? 'o' : '') + (v & 2 ? 'r' : '') + (v & 1 ? 'w' : '')) || '0';

/** The text of an instruction (`d` from decode) at address `pc` (branch and jump targets are shown as addresses). */
export function format(d, pc = 0) {
  if (d.fmt === '' && d.mn === 'illegal') return 'illegal';
  if (d.op === OP.FENCE && d.imm === 0x833) return 'fence.tso'; // fm = 1000, pred = succ = rw
  const toks = d.fmt === '' ? [] : d.fmt.split(',');
  const out = toks.map((t) => {
    switch (t) {
      case 'rd': return ABI[d.rd];
      case 'rs1': return ABI[d.rs1];
      case 'rs2': return ABI[d.rs2];
      case 'sp': return 'sp';
      case 'imm': return String(d.imm);
      case 'shamt': return hex(d.imm); // objdump writes shift amounts in hexadecimal
      case 'hi': return hex((d.imm >>> 12) & 0xfffff);
      case 'target': return hex(pc + d.imm);
      case 'csr': return CSR_NAMES[d.imm] ?? hex(d.imm);
      case 'uimm': return String(d.rs1);
      case 'imm(rs1)': return `${d.imm}(${ABI[d.rs1]})`;
      case 'imm(sp)': return `${d.imm}(sp)`;
      case '(rs1)': return `(${ABI[d.rs1]})`;
      case 'fence': return `${fenceSet((d.imm >>> 4) & 15)},${fenceSet(d.imm & 15)}`;
      case 'rlist': return rlistText(d.rs1);
      case 'shamt5': return String(d.rs2);
      case 'size': return String(d.imm);
      case 'sa': return ABI[zcmpSReg(d.rs1)];
      case 'sb': return ABI[zcmpSReg(d.rs2)];
      default: throw new Error(`disasm: unknown operand ${t}`);
    }
  });
  const aq = d.aqrl === 3 ? '.aqrl' : d.aqrl === 2 ? '.aq' : d.aqrl === 1 ? '.rl' : '';
  return out.length ? `${d.mn}${aq}\t${out.join(',')}` : `${d.mn}${aq}`;
}

/** `{ra,s0-s2}` for a Zcmp register list. */
export function rlistText(rlist) {
  const regs = zcmpRegisters(rlist);
  if (regs.length === 1) return '{ra}';
  const last = ABI[regs[regs.length - 1]];
  return regs.length === 2 ? '{ra,s0}' : `{ra,s0-${last}}`;
}

/** Disassemble a fetch word at `pc`. */
export const disassemble = (word, pc = 0) => format(decode(word), pc);
