// priv.js -- machine-mode traps, interrupts and privilege of the profile `iss-priv` (WS-F-111):
// modes M and U, the CSRs of the book's reference model, trap entry and mret, the interrupt
// check at an instruction boundary, and eight PMP entries. Written after rvpriv.py (the book's
// model, itself written from the RISC-V Privileged Architecture); whether this module agrees with
// `rvsim.py --priv` is what test/priv-conformance.test.mjs checks, on the programs it lists.
// Not a model of any real core. Pure JavaScript, no DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CSR_NUMBERS } from '../isa/encoding.js';

export const M_MODE = 3;
export const U_MODE = 0;
export const TRAP_ENTRY_CYCLES = 3;
export const CSR = CSR_NUMBERS;
export const CSR_NAME = Object.fromEntries(Object.entries(CSR_NUMBERS).map(([k, v]) => [v, k]));

const MSTATUS_MIE = 1 << 3;
const MSTATUS_MPIE = 1 << 7;
const MPP_SHIFT = 11;
const MSTATUS_MPP = 3 << MPP_SHIFT;
export const MSI = 3;
export const MTI = 7;
export const MEI = 11;
const MSI_BIT = 1 << MSI;
const MTI_BIT = 1 << MTI;
const MEI_BIT = 1 << MEI;
const MISA = ((1 << 30) | (1 << 8) | (1 << 12) | (1 << 20)) >>> 0; // RV32, I, M, U
const M64 = (1n << 64n) - 1n;
const M32 = 0xffffffffn;

export const CAUSES = Object.freeze({
  0: 'instruction address misaligned', 1: 'instruction access fault', 2: 'illegal instruction', 3: 'breakpoint',
  4: 'load address misaligned', 5: 'load access fault', 6: 'store address misaligned', 7: 'store access fault',
  8: 'environment call from U-mode', 11: 'environment call from M-mode',
});
export const INTERRUPTS = Object.freeze({ 3: 'machine software interrupt', 7: 'machine timer interrupt', 11: 'machine external interrupt' });

export function causeText(mcause) {
  const code = mcause & 0x7fffffff;
  if (mcause >>> 31) return INTERRUPTS[code] ?? `interrupt ${code}`;
  return CAUSES[code] ?? `exception ${code}`;
}

/** A synchronous exception raised while executing one instruction. */
export class Trap extends Error {
  constructor(cause, tval = 0) {
    super(CAUSES[cause] ?? String(cause));
    this.cause = cause;
    this.tval = tval >>> 0;
  }
}

/** A run that cannot continue: a trap with no handler installed. */
export class PrivError extends Error {}

/** Physical memory protection: eight entries; modes OFF, TOR, NA4, NAPOT; grain 4 bytes. */
export class Pmp {
  static N = 8;

  constructor() {
    this.cfg = new Array(Pmp.N).fill(0);
    this.addr = new Array(Pmp.N).fill(0);
  }

  locked(i) { return Boolean(this.cfg[i] & 0x80); }

  writeCfg(reg, value) {
    for (let k = 0; k < 4; k++) {
      const i = 4 * reg + k;
      if (this.locked(i)) continue; // a locked entry ignores writes
      let b = (value >>> (8 * k)) & 0xff;
      if ((b & 0b011) === 0b010) b &= ~0b011; // W without R is reserved: keep R = W = 0
      this.cfg[i] = b & 0x9f;
    }
  }

  readCfg(reg) {
    let v = 0;
    for (let k = 0; k < 4; k++) v |= this.cfg[4 * reg + k] << (8 * k);
    return v >>> 0;
  }

  writeAddr(i, value) {
    const nextTor = i + 1 < Pmp.N && this.locked(i + 1) && ((this.cfg[i + 1] >> 3) & 3) === 1;
    if (!this.locked(i) && !nextTor) this.addr[i] = value >>> 0;
  }

  /** [lo, hi) in bytes, or null for an OFF entry. */
  region(i) {
    const a = (this.cfg[i] >> 3) & 3;
    if (a === 0) return null;
    if (a === 1) return [i ? this.addr[i - 1] * 4 : 0, this.addr[i] * 4]; // TOR
    if (a === 2) return [this.addr[i] * 4, this.addr[i] * 4 + 4]; // NA4
    let ones = 0; // NAPOT: the trailing ones of pmpaddr give the size
    while (ones < 32 && (this.addr[i] >>> ones) & 1) ones++;
    const size = 2 ** (ones + 3);
    const lo = Math.floor(this.addr[i] / 2 ** ones) * 2 ** ones * 4;
    return [lo, lo + size];
  }

  /** True if an access of `kind` ('r', 'w' or 'x') is allowed. */
  check(addr, size, kind, mode) {
    const perm = { r: 1, w: 2, x: 4 }[kind];
    for (let i = 0; i < Pmp.N; i++) {
      const r = this.region(i);
      if (r === null) continue;
      const [lo, hi] = r;
      if (lo >= hi || addr + size <= lo || addr >= hi) continue; // no byte matches
      if (addr < lo || addr + size > hi) return false; // only some bytes match
      if (mode === M_MODE && !this.locked(i)) return true;
      return Boolean(this.cfg[i] & perm);
    }
    return mode === M_MODE; // no match: M succeeds, U fails
  }
}

/** The privileged state of one hart. `platform` supplies mtip() and meip(). */
export class PrivState {
  constructor(platform, { mtvalZero = false, trapEntry = TRAP_ENTRY_CYCLES, trapCheck = false } = {}) {
    this.platform = platform;
    this.mtvalZero = mtvalZero; // mtval is 0 for every cause (as Hazard3 on the RP2350)
    this.trapEntry = trapEntry; // modelled cycles to take a trap
    this.trapCheck = trapCheck; // check that each interrupt handler gives back every register and returns to mepc
    this.frames = []; // the traps being served, innermost last: {interrupt, mcause, epc, regs}
    this.violations = []; // what the trap check found, in order
    this.journal = null;
    this.mode = M_MODE;
    this.mstatus = 0; this.mie = 0; this.mtvec = 0; this.mtvecSet = false;
    this.mscratch = 0; this.mepc = 0; this.mcause = 0; this.mtval = 0;
    this.pmp = new Pmp();
    this.cycleOff = 0n;
    this.instretOff = 0n;
  }

  touch() { this.journal?.touch(); }

  mip() { return ((this.platform.mtip() ? MTI_BIT : 0) | (this.platform.meip() ? MEI_BIT : 0)) >>> 0; }

  /** Read a CSR; `hart` supplies the counters. An unknown CSR raises an illegal-instruction exception. */
  read(num, hart) {
    switch (num) {
      case CSR.mstatus: return this.mstatus >>> 0;
      case CSR.mstatush: case CSR.mvendorid: case CSR.marchid: case CSR.mimpid: case CSR.mhartid: return 0;
      case CSR.misa: return MISA;
      case CSR.mie: return this.mie >>> 0;
      case CSR.mip: return this.mip();
      case CSR.mtvec: return this.mtvec >>> 0;
      case CSR.mscratch: return this.mscratch >>> 0;
      case CSR.mepc: return this.mepc >>> 0;
      case CSR.mcause: return this.mcause >>> 0;
      case CSR.mtval: return this.mtval >>> 0;
      case CSR.pmpcfg0: case CSR.pmpcfg1: return this.pmp.readCfg(num - CSR.pmpcfg0);
      default:
    }
    if (num >= CSR.pmpaddr0 && num <= CSR.pmpaddr7) return this.pmp.addr[num - CSR.pmpaddr0];
    const c = (BigInt(hart.cycle) + this.cycleOff) & M64;
    const r = (BigInt(hart.instret) + this.instretOff) & M64;
    switch (num) {
      case CSR.mcycle: return Number(c & M32);
      case CSR.mcycleh: return Number(c >> 32n);
      case CSR.minstret: return Number(r & M32);
      case CSR.minstreth: return Number(r >> 32n);
      default: throw new Trap(2);
    }
  }

  write(num, value, hart) {
    const v = value >>> 0;
    if ((num >> 10) === 3) throw new Trap(2); // a read-only CSR
    if (!this.writable(num)) throw new Trap(2);
    this.touch();
    switch (num) {
      case CSR.mstatus: {
        const mpp = (v >>> MPP_SHIFT) & 3;
        this.mstatus = ((v & (MSTATUS_MIE | MSTATUS_MPIE)) | ((mpp === M_MODE ? M_MODE : U_MODE) << MPP_SHIFT)) >>> 0;
        return;
      }
      case CSR.mstatush: case CSR.misa: case CSR.mip: return; // no writable fields
      case CSR.mie: this.mie = (v & (MSI_BIT | MTI_BIT | MEI_BIT)) >>> 0; return;
      case CSR.mtvec: this.mtvec = (v & ~0b10) >>> 0; this.mtvecSet = true; return;
      case CSR.mscratch: this.mscratch = v; return;
      case CSR.mepc: this.mepc = (v & ~3) >>> 0; return;
      case CSR.mcause: this.mcause = v; return;
      case CSR.mtval: this.mtval = v; return;
      case CSR.pmpcfg0: case CSR.pmpcfg1: this.pmp.writeCfg(num - CSR.pmpcfg0, v); return;
      default:
    }
    if (num >= CSR.pmpaddr0 && num <= CSR.pmpaddr7) { this.pmp.writeAddr(num - CSR.pmpaddr0, v); return; }
    if (num === CSR.mcycle || num === CSR.mcycleh) {
      let c = (BigInt(hart.cycle) + this.cycleOff) & M64;
      c = num === CSR.mcycle ? (c & ~M32 & M64) | BigInt(v) : (c & M32) | (BigInt(v) << 32n);
      this.cycleOff = c - BigInt(hart.cycle);
    } else { // minstret, minstreth
      let r = (BigInt(hart.instret) + this.instretOff) & M64;
      r = num === CSR.minstret ? (r & ~M32 & M64) | BigInt(v) : (r & M32) | (BigInt(v) << 32n);
      this.instretOff = r - BigInt(hart.instret) - 1n; // this instruction still retires
    }
  }

  writable(num) {
    return num === CSR.mstatus || num === CSR.mstatush || num === CSR.misa || num === CSR.mie || num === CSR.mip || num === CSR.mtvec
      || num === CSR.mscratch || num === CSR.mepc || num === CSR.mcause || num === CSR.mtval || num === CSR.pmpcfg0 || num === CSR.pmpcfg1
      || (num >= CSR.pmpaddr0 && num <= CSR.pmpaddr7) || num === CSR.mcycle || num === CSR.mcycleh || num === CSR.minstret || num === CSR.minstreth;
  }

  /** The interrupt to take now (its code), or null. */
  interruptToTake() {
    const pend = (this.mip() & this.mie) >>> 0;
    if (!pend) return null;
    if (this.mode === M_MODE && !(this.mstatus & MSTATUS_MIE)) return null;
    for (const code of [MEI, MSI, MTI]) if ((pend >>> code) & 1) return code; // MEI before MSI before MTI
    return null;
  }

  /** Trap entry; returns the new pc. */
  enter(interrupt, code, epc, tval) {
    if (!this.mtvecSet) {
      throw new PrivError(`${causeText(((interrupt ? 1 : 0) << 31) | code)} at pc=0x${(epc >>> 0).toString(16).padStart(8, '0')} but mtvec was never written`);
    }
    this.touch();
    this.mepc = (epc & ~3) >>> 0;
    this.mcause = (((interrupt ? 1 : 0) << 31) | code) >>> 0;
    this.mtval = interrupt || this.mtvalZero ? 0 : tval >>> 0;
    const mie = this.mstatus & MSTATUS_MIE;
    this.mstatus = (((this.mstatus & ~(MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP)) | (mie ? MSTATUS_MPIE : 0) | (this.mode << MPP_SHIFT))) >>> 0;
    this.mode = M_MODE;
    const base = (this.mtvec & ~3) >>> 0;
    if (interrupt && (this.mtvec & 1)) return (base + 4 * code) >>> 0;
    return base;
  }

  mret() {
    if (this.mode !== M_MODE) throw new Trap(2);
    this.touch();
    const mpp = (this.mstatus >>> MPP_SHIFT) & 3;
    const mpie = this.mstatus & MSTATUS_MPIE;
    this.mstatus = (((this.mstatus & ~(MSTATUS_MIE | MSTATUS_MPP)) | (mpie ? MSTATUS_MIE : 0) | MSTATUS_MPIE | (U_MODE << MPP_SHIFT))) >>> 0;
    this.mode = mpp;
    return this.mepc;
  }

  snapshot() {
    return {
      mode: this.mode, mstatus: this.mstatus, mie: this.mie, mtvec: this.mtvec, mtvecSet: this.mtvecSet,
      mscratch: this.mscratch, mepc: this.mepc, mcause: this.mcause, mtval: this.mtval,
      pmpCfg: this.pmp.cfg.slice(), pmpAddr: this.pmp.addr.slice(), cycleOff: this.cycleOff, instretOff: this.instretOff,
      frames: this.frames.slice(), violations: this.violations.slice(), // the entries are never changed once made
    };
  }

  restore(s) {
    const { pmpCfg, pmpAddr, frames, violations, ...rest } = s;
    Object.assign(this, rest);
    this.frames = frames.slice();
    this.violations = violations.slice();
    this.pmp.cfg = pmpCfg.slice();
    this.pmp.addr = pmpAddr.slice();
  }
}
