// hart.js -- one Hazard3 hart of the pico2 module (P1-M1): the architectural state and the instruction executor for RV32IMAC,
// Zba, Zbb, Zbs, Zbkb, Zcb, Zcmp, Zicsr, Zifencei in M and U modes, with the machine-mode CSRs, traps and a decode cache.
// One instruction per step(). Timing (P1-M3, timing.js): each step costs the clk_sys cycles of the Hazard3 cost model, and
// mcycle and `ticks` advance by that cost; the state the model needs (the BTB entry, the previous load's rd, whether it was
// an exclusive access, whether the frontend was redirected) is part of the snapshots and the history. A div/rem in X is
// cancelled by an interrupt that becomes due while it runs (D15-2) when a scheduler is attached (`sched`). The trigger
// module (4 breakpoint triggers) is in triggers.js. Debug mode is not modelled: dcsr, dpc and dmdata0 are illegal outside
// it, as in hazard3_csr.v; mseccfg(h) and mcontext are not decoded by the RTL and are illegal here too.
// Xh3power (P1-M2): h3.block (slt x0, x0, x0) sleeps like wfi until an interrupt that would end a wfi, or an unblock signal from
// the other processor; it falls through if an unblock arrived since the last block; h3.unblock (slt x0, x0, x1) posts one
// through onUnblock (Hazard3 manual, custom_extensions "h3.block"; research design §7). History snapshots reuse the last copy of
// the interrupt controller, PMP and trigger state while those are unchanged (their version counters).
// Fast paths (same results as the full checks, tested): the PMP check is skipped for M-mode accesses while no region is
// locked or M-mode-enabled (Pmp.mFree), except for a 32-bit fetch at the last halfword of a 32-byte granule, which could
// straddle a region boundary; the interrupt check is skipped while mie is 0; the trigger check runs only when armed.
// The bus is any object with read8/16/32(addr) and write8/16/32(addr, value) that sets `bus.fault = true` on an access
// fault (and returns 0); addresses are unsigned 32-bit numbers, values 32-bit integers.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { OP, decode, zcmpRegisters, zcmpSReg } from './decode.js';
import { Pmp } from './pmp.js';
import { IrqCtrl, MEIEA, MEICONTEXT, MEINEXT, CSR_WRITE, CSR_SET, CSR_CLEAR } from './irqctrl.js';
import { Triggers } from './triggers.js';
import { K, KIND, USE, EXCLUSIVE, COST, CAUSE_BIT as CB, readsInX, divCost, zcmpCost, zcmpCount, predictedTaken } from './timing.js';

/** The operations the fast path takes: 1 one-cycle ALU or store; 3 load; 2 jal/jalr; 4 conditional branch; 0 the full step. */
const FAST = new Uint8Array(KIND.length);
for (let o = 0; o < KIND.length; o++) {
  const k = KIND[o];
  FAST[o] = k === K.ALU || k === K.STORE ? 1 : k === K.LOAD ? 3 : k === K.JUMP ? 2 : k === K.BRANCH ? 4 : 0;
}

export const PRIV_U = 0;
export const PRIV_M = 3;

/** Exception causes (mcause without the interrupt bit). */
export const CAUSE = Object.freeze({
  FETCH_MISALIGNED: 0, FETCH_FAULT: 1, ILLEGAL: 2, BREAKPOINT: 3, LOAD_MISALIGNED: 4, LOAD_FAULT: 5, STORE_MISALIGNED: 6, STORE_FAULT: 7,
  ECALL_U: 8, ECALL_M: 11,
});
/** Interrupt causes handled here: machine software, timer, external. */
export const IRQ = Object.freeze({ MSI: 3, MTI: 7, MEI: 11 });

const MSTATUS_MIE = 1 << 3, MSTATUS_MPIE = 1 << 7, MSTATUS_MPP = 3 << 11, MSTATUS_MPRV = 1 << 17, MSTATUS_TW = 1 << 21;
const MSTATUS_MASK = MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP | MSTATUS_MPRV | MSTATUS_TW;
const MIE_MASK = (1 << IRQ.MSI) | (1 << IRQ.MTI) | (1 << IRQ.MEI);
/** misa of the RP2350's Hazard3: MXL 32; A, C, I, M, U, X. */
const MISA = ((1 << 30) | 1 | (1 << 2) | (1 << 8) | (1 << 12) | (1 << 20) | (1 << 23)) | 0;
export const MIMPID = 0x86fc4e3f;
const CACHE_SLOTS = 4096;

const mulhu = (a, b) => {
  a >>>= 0; b >>>= 0;
  const al = a & 0xffff, ah = a >>> 16, bl = b & 0xffff, bh = b >>> 16;
  const ll = al * bl, lh = al * bh, hl = ah * bl, hh = ah * bh;
  const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
  return (hh + (lh >>> 16) + (hl >>> 16) + (mid >>> 16)) | 0;
};
const popcount = (x) => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); x = (x + (x >>> 4)) & 0x0f0f0f0f; return Math.imul(x, 0x01010101) >>> 24; };
const ctz = (x) => (x === 0 ? 32 : 31 - Math.clz32(x & -x));
const rev8 = (x) => ((x << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24)) | 0;
const brev8 = (x) => {
  x = ((x & 0x0f0f0f0f) << 4) | ((x >>> 4) & 0x0f0f0f0f);
  x = ((x & 0x33333333) << 2) | ((x >>> 2) & 0x33333333);
  return (((x & 0x55555555) << 1) | ((x >>> 1) & 0x55555555)) | 0;
};
const orcb = (x) => (((x & 0xff) ? 0xff : 0) | ((x & 0xff00) ? 0xff00 : 0) | ((x & 0xff0000) ? 0xff0000 : 0) | ((x >>> 24) ? 0xff000000 : 0)) | 0;
const zip = (x) => { let r = 0; for (let i = 0; i < 16; i++) r |= (((x >>> i) & 1) << (2 * i)) | (((x >>> (i + 16)) & 1) << (2 * i + 1)); return r | 0; };
const unzip = (x) => { let r = 0; for (let i = 0; i < 16; i++) r |= (((x >>> (2 * i)) & 1) << i) | (((x >>> (2 * i + 1)) & 1) << (i + 16)); return r | 0; };

/** A flat byte-addressed RAM for tests and simple machines: `size` bytes at address 0; accesses outside fault. */
export class FlatMemory {
  constructor(size) { this.bytes = new Uint8Array(size); this.fault = false; }
  load(offset, data) { this.bytes.set(data, offset); }
  /** The value at `a` without side effects (a device would return undefined): the history uses it to keep the old value of a store. */
  peek(a, size) { return a + size > this.bytes.length ? 0 : size === 4 ? this.read32(a) : size === 2 ? this.read16(a) : this.bytes[a]; }
  read8(a) { if (a >= this.bytes.length) { this.fault = true; return 0; } return this.bytes[a]; }
  read16(a) { if (a + 1 >= this.bytes.length) { this.fault = true; return 0; } return this.bytes[a] | (this.bytes[a + 1] << 8); }
  read32(a) { if (a + 3 >= this.bytes.length) { this.fault = true; return 0; } const b = this.bytes; return (b[a] | (b[a + 1] << 8) | (b[a + 2] << 16) | (b[a + 3] << 24)) | 0; }
  write8(a, v) { if (a >= this.bytes.length) this.fault = true; else this.bytes[a] = v; }
  write16(a, v) { if (a + 1 >= this.bytes.length) this.fault = true; else { this.bytes[a] = v; this.bytes[a + 1] = v >>> 8; } }
  write32(a, v) { if (a + 3 >= this.bytes.length) this.fault = true; else { const b = this.bytes; b[a] = v; b[a + 1] = v >>> 8; b[a + 2] = v >>> 16; b[a + 3] = v >>> 24; } }
}

export class Hart {
  /** @param {object} bus @param {{hartid?: number, resetPc?: number}} [opts] */
  /** `reservationShift`: log2 of the LR/SC reservation granule in bytes (0: the exact word; the Hazard3 testbench's monitor uses 6). Not stated for the RP2350's bus. */
  constructor(bus, { hartid = 0, resetPc = 0, reservationShift = 0, xh3irq = true, pmp = {} } = {}) {
    this.bus = bus;
    this.reservationShift = reservationShift;
    this.hartid = hartid;
    this.resetPc = resetPc;
    this.x = new Int32Array(32);
    this.cacheTag = new Int32Array(CACHE_SLOTS);   // pc of the entry (+1 so that 0 means empty)
    this.cacheWord = new Int32Array(CACHE_SLOTS);  // the fetch word the entry was decoded from (only the used bits matter)
    this.cacheRec = new Array(CACHE_SLOTS);
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.pmp = new Pmp(pmp);
    this.irqc = new IrqCtrl(xh3irq);
    this.trig = new Triggers();
    this.hist = null;           // a HistoryRing, to record every step for step-back (attachHistory)
    this.onUnblock = null;      // called by h3.unblock (Xh3power): the machine wires it to the other processor
    this.sched = null;          // {deadline, serviceDue()}: the machine's scheduler, for an interrupt that cancels a div (D15-2)
    this.reset();
  }

  reset() {
    this.x.fill(0);
    this.pc = this.resetPc | 0;
    this.priv = PRIV_M;
    this.mstatus = MSTATUS_MPP; // MPP is M-mode after reset (Hazard3 holds M and U only)
    this.mie = 0; this.mtvec = 0; this.mscratch = 0; this.mepc = 0; this.mcause = 0;
    this.mcounteren = 0; this.mcountinhibit = 5; // the counters are inhibited by default (hazard3_csr.v)
    this.msleep = 0;
    this.irqIn = 0;              // pending bits driven from outside: MSI, MTI (MEI comes from the interrupt controller)
    this.cycles = 0; this.instret = 0; // mcycle, minstret: they count only when mcountinhibit lets them
    this.ticks = 0;              // clk_sys cycles taken (the cost of every step, asleep or not, never inhibited): the machine's time base
    // timing state (timing.js)
    this.btb = -1;               // the BTB entry: pc of the last taken backward branch, or -1
    this.ldRd = 0;               // rd of the previous instruction if it was a load, lr.w or sc.w (its result arrives in M), else 0
    this.ldExcl = false;         // the previous instruction was lr.w or sc.w
    this.redirect = false;       // the previous step redirected the frontend (jump, taken or mispredicted branch, trap, mret)
    this.lastPre = 0; this.lastCost = 0; this.lastCause = 0; // the newest step: cycles before X, total cycles, CAUSE_BIT mask
    this.lastD = null;           // the newest step's decoded instruction (null: none was fetched); full step only
    this.detail = false;         // a stage model reads lastPre/lastCost/lastCause/lastD: every step takes the full path
    this._cause = 0; this._cy0 = 0; this._ir0 = 0;
    this.reservation = -1;       // LR/SC: address, or -1
    this.sleeping = false;
    this.sleepBlock = false;     // the sleep is an h3.block (Xh3power): an unblock signal also ends it
    this.unblockIn = false;      // an unblock signal arrived (from the other processor) and is not consumed yet
    this.trapped = false;        // set by the last step if it took a trap
    this.cacheTag.fill(0);
    this.pmp.reset();
    this.irqc.reset();
    this.trig.reset();
  }

  /** Drive the machine software (bit 3) and timer (bit 7) interrupt lines. */
  setIrq(mask) { this.irqIn = mask & ((1 << IRQ.MSI) | (1 << IRQ.MTI)); }
  /** Drive the 52 external interrupt lines (Xh3irq): lines 0 to 31 and 32 to 51. */
  setExternalIrqs(lo, hi = 0) { this.irqc.setLines(lo, hi); }
  get mip() { return this.irqIn | (this.irqc.pending ? 1 << IRQ.MEI : 0); }

  flushCache() { this.cacheTag.fill(0); }

  /** Record each step in `ring` (a HistoryRing) from now on; null stops recording. */
  attachHistory(ring) { this.hist = ring; }
  /** Undo the newest recorded step; false if none is kept. */
  stepBack() { return this.hist ? this.hist.undo(this) : false; }

  /** The machine state a step may change beyond registers, memory and pc (kept by the history for CSR, trap, mret, wfi, lr/sc steps). */
  saveSys() {
    // the controller, PMP and trigger states are copied only when they changed since the last snapshot (saved copies are never
    // mutated, and load() copies out of them), so CSR, trap and mret steps stay cheap for interrupt-heavy programs
    const ic = this.irqc, pm = this.pmp, tg = this.trig;
    if (this._icV !== ic.ver) { this._icS = ic.save(); this._icV = ic.ver; }
    if (this._pmV !== pm.ver) { this._pmS = pm.save(); this._pmV = pm.ver; }
    if (this._tgV !== tg.ver) { this._tgS = tg.save(); this._tgV = tg.ver; }
    return { priv: this.priv, mstatus: this.mstatus, mie: this.mie, mtvec: this.mtvec, mscratch: this.mscratch, mepc: this.mepc, mcause: this.mcause,
      mcounteren: this.mcounteren, mcountinhibit: this.mcountinhibit, msleep: this.msleep, reservation: this.reservation, sleeping: this.sleeping,
      sleepBlock: this.sleepBlock, unblockIn: this.unblockIn, cycles: this.cycles, instret: this.instret, irqc: this._icS, pmp: this._pmS, trig: this._tgS,
      btb: this.btb, ldRd: this.ldRd, ldExcl: this.ldExcl, redirect: this.redirect };
  }
  restoreSys(s) {
    this.priv = s.priv; this.mstatus = s.mstatus; this.mie = s.mie; this.mtvec = s.mtvec; this.mscratch = s.mscratch; this.mepc = s.mepc; this.mcause = s.mcause;
    this.mcounteren = s.mcounteren; this.mcountinhibit = s.mcountinhibit; this.msleep = s.msleep; this.reservation = s.reservation; this.sleeping = s.sleeping;
    this.sleepBlock = s.sleepBlock ?? false; this.unblockIn = s.unblockIn ?? false;
    this.cycles = s.cycles; this.instret = s.instret; this.irqc.load(s.irqc); this.pmp.load(s.pmp); this.trig.load(s.trig);
    this.btb = s.btb ?? -1; this.ldRd = s.ldRd ?? 0; this.ldExcl = s.ldExcl ?? false; this.redirect = s.redirect ?? false;
  }
  /** The timing state packed into one word for the history: ldRd, ldExcl (bit 5), redirect (bit 6). */
  tState() { return this.ldRd | (this.ldExcl ? 32 : 0) | (this.redirect ? 64 : 0); }
  setTState(t) { this.ldRd = t & 31; this.ldExcl = (t & 32) !== 0; this.redirect = (t & 64) !== 0; }
  /** Advance time by n cycles: ticks always, mcycle unless inhibited. */
  adv(n) { this.ticks += n; if (!(this.mcountinhibit & 1)) this.cycles += n; }
  // the snapshot of a step holds the counters as they were when the step began (a stall before X may already have counted)
  _snap() { if (this.hist && !this.hist.snapshotTaken) { const s = this.saveSys(); s.cycles = this._cy0; s.instret = this._ir0; this.hist.snapshot(s); } }
  /** Write a register, recording the old value for the history. */
  wr(i, v) { if (this.hist) this.hist.reg(i, this.x[i]); this.x[i] = v; }

  // ---- CSRs ----
  /** Read a CSR for an instruction in the current mode; returns undefined if the access is illegal. */
  csrRead(a, raw = 0, wtype = 0) {
    if (((a >>> 8) & 3) > this.priv) return undefined;
    if (Pmp.owns(a)) return this.pmp.csrRead(a);
    if (Triggers.owns(a)) return this.trig.csrRead(a);
    if (this.irqc.xh3 && a >= MEIEA && a <= MEICONTEXT) return this.irqc.read(a, raw, wtype, (this.mie >>> IRQ.MTI) & 1, (this.mie >>> IRQ.MSI) & 1);
    if ((a >= 0xb03 && a <= 0xb1f) || (a >= 0xb83 && a <= 0xb9f) || (a >= 0x323 && a <= 0x33f)) return 0; // mhpmcounter, mhpmcounterh, mhpmevent: zero
    if (a === 0xbf0) return this.msleep;
    switch (a) {
      case 0x300: return this.mstatus;
      case 0x301: return MISA;
      case 0x304: return this.mie;
      case 0x305: return this.mtvec;
      case 0x306: return this.mcounteren;
      case 0x320: return this.mcountinhibit;
      case 0x340: return this.mscratch;
      case 0x341: return this.mepc;
      case 0x342: return this.mcause;
      case 0x343: case 0x310: case 0x30a: case 0x31a: return 0; // mtval, mstatush, menvcfg, menvcfgh: zero in Hazard3
      case 0x344: return this.mip;
      case 0xb00: return this.cycles | 0;
      case 0xb02: return this.instret | 0;
      case 0xb80: return Math.floor(this.cycles / 4294967296) | 0;
      case 0xb82: return Math.floor(this.instret / 4294967296) | 0;
      case 0xc00: case 0xc02: case 0xc80: case 0xc82: {
        const bit = (a & 0x2) ? 2 : 0;
        if (this.priv < PRIV_M && !((this.mcounteren >>> bit) & 1)) return undefined;
        const v = (a & 0x2) ? this.instret : this.cycles;
        return (a & 0x80) ? Math.floor(v / 4294967296) | 0 : v | 0;
      }
      case 0xf11: return 0x493; // mvendorid (RP-001 Table 387)
      case 0xf12: return 0x1b;  // marchid: Hazard3
      case 0xf13: return MIMPID;
      case 0xf14: return this.hartid;
      case 0xf15: return 0;
      default: return undefined;
    }
  }

  /** Write a CSR; returns false if the access is illegal (unknown CSR, read-only CSR, or above the current mode). */
  csrWrite(a, v, raw = 0, wtype = CSR_WRITE) {
    if (((a >>> 8) & 3) > this.priv || (a >>> 10) === 3) return false;
    if (Pmp.owns(a)) { this.pmp.csrWrite(a, v); return true; }
    if (Triggers.owns(a)) { this.trig.csrWrite(a, v); return true; }
    if (this.irqc.xh3 && a >= MEIEA && a <= MEICONTEXT) {
      const r = this.irqc.write(a, v, raw, wtype, this._meinextSnap);
      if (r) { // meicontext: save and optionally clear the timer and software interrupt enables
        const keep = (b) => (r.clearts ? 0 : 1) & (((this.mie >>> b) & 1) | (b === IRQ.MTI ? r.mtiesave : r.msiesave));
        this.mie = (this.mie & ~((1 << IRQ.MTI) | (1 << IRQ.MSI))) | (keep(IRQ.MTI) << IRQ.MTI) | (keep(IRQ.MSI) << IRQ.MSI);
      }
      return true;
    }
    if ((a >= 0xb03 && a <= 0xb1f) || (a >= 0xb83 && a <= 0xb9f) || (a >= 0x323 && a <= 0x33f)) return true; // hpm: writes ignored
    if (a === 0xbf0) { this.msleep = v & 7; return true; }
    switch (a) {
      case 0x300: { // MPP holds M (3) or U (0): any non-zero value reads as M; the other fields are MIE, MPIE, MPRV, TW
        const m = v & MSTATUS_MASK;
        this.mstatus = (m & ~MSTATUS_MPP) | ((v >>> 12) & 1 ? MSTATUS_MPP : 0); // hazard3_csr.v: only bit 12 of MPP is stored, bit 11 mirrors it
        return true;
      }
      case 0x301: case 0x310: case 0x30a: case 0x31a: return true; // misa, mstatush, menvcfg(h): writes ignored
      case 0x304: this.mie = v & MIE_MASK; return true;
      case 0x305: this.mtvec = v & ~2; return true; // MODE 0 direct, 1 vectored; base 4-byte aligned
      case 0x306: this.mcounteren = v & 7; return true;
      case 0x320: this.mcountinhibit = v & 5; return true;
      case 0x340: this.mscratch = v; return true;
      case 0x341: this.mepc = v & ~1; return true;
      case 0x342: this.mcause = v & 0x8000000f; return true; // the interrupt bit and a 4-bit code
      case 0x343: return true;                    // mtval is hardwired to 0 in Hazard3 (hazard3_csr.v)
      case 0x344: return true;                    // mip: all bits are driven from outside
      case 0xb00: this.cycles = (Math.floor(this.cycles / 4294967296) * 4294967296) + (v >>> 0); return true;
      case 0xb02: this.instret = (Math.floor(this.instret / 4294967296) * 4294967296) + (v >>> 0); return true;
      case 0xb80: this.cycles = (v >>> 0) * 4294967296 + (this.cycles % 4294967296); return true;
      case 0xb82: this.instret = (v >>> 0) * 4294967296 + (this.instret % 4294967296); return true;
      default: return this.csrRead(a) !== undefined; // the zero-valued CSRs below ignore writes
    }
  }

  // ---- traps ----
  trap(cause, tval, isInterrupt = false) {
    this._snap();
    this.mepc = this.pc & ~1;
    this.mcause = isInterrupt ? (cause | 0x80000000) | 0 : cause;
    const mpp = this.priv === PRIV_M ? MSTATUS_MPP : 0;
    this.mstatus = (this.mstatus & ~(MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP)) | ((this.mstatus & MSTATUS_MIE) ? MSTATUS_MPIE : 0) | mpp;
    this.priv = PRIV_M;
    const base = this.mtvec & ~3;
    this.pc = ((this.mtvec & 1) && isInterrupt ? base | (cause << 2) : base) | 0; // vectored: the cause is ORed into the base
    this.irqc.trapEnter(isInterrupt && cause === IRQ.MEI);
    this.trig.trapEnter();
    this.reservation = -1;
    this.trapped = true;
    this.sleeping = false;
  }

  /** The enabled pending interrupt to take, or -1. Order: external, software, timer (Hazard3 follows the priority of the privileged specification). */
  pendingInterrupt() {
    const p = this.mip & this.mie;
    if (!p) return -1;
    if (this.priv === PRIV_M && !(this.mstatus & MSTATUS_MIE)) return -1;
    if (p & (1 << IRQ.MEI)) return IRQ.MEI;
    if (p & (1 << IRQ.MSI)) return IRQ.MSI;
    return IRQ.MTI;
  }

  // ---- memory access (with the faults of the bus; PMP comes in a later slice) ----
  /** The privilege of data accesses: MPP when mstatus.MPRV is set, else the current mode (true: M). */
  dataMmode() { return (this.mstatus & MSTATUS_MPRV) ? (this.mstatus & MSTATUS_MPP) !== 0 : this.priv === PRIV_M; }

  /** Load (`amo`: the load half of an AMO, which needs write permission and faults as a store). Returns undefined after taking a trap. */
  load(addr, size, amo = false) {
    const b = this.bus;
    if (addr & (size - 1)) { this.trap(amo ? CAUSE.STORE_MISALIGNED : CAUSE.LOAD_MISALIGNED, addr); return undefined; }
    if (!(this.pmp.mFree && this.dataMmode()) && this.pmp.deniesData(addr, amo, this.dataMmode())) { this.trap(amo ? CAUSE.STORE_FAULT : CAUSE.LOAD_FAULT, addr); return undefined; }
    b.fault = false;
    const v = size === 4 ? b.read32(addr >>> 0) : size === 2 ? b.read16(addr >>> 0) : b.read8(addr >>> 0);
    if (b.fault) { b.fault = false; this.trap(amo ? CAUSE.STORE_FAULT : CAUSE.LOAD_FAULT, addr); return undefined; }
    return v;
  }
  store(addr, size, v) {
    const b = this.bus;
    if (addr & (size - 1)) { this.trap(CAUSE.STORE_MISALIGNED, addr); return false; }
    if (!(this.pmp.mFree && this.dataMmode()) && this.pmp.deniesData(addr, true, this.dataMmode())) { this.trap(CAUSE.STORE_FAULT, addr); return false; }
    if (this.hist) { const old = b.peek ? b.peek(addr >>> 0, size) : undefined; this.hist.mem(addr >>> 0, size, old ?? 0, old === undefined); }
    b.fault = false;
    if (size === 4) b.write32(addr >>> 0, v); else if (size === 2) b.write16(addr >>> 0, v); else b.write8(addr >>> 0, v);
    if (b.fault) { b.fault = false; this.trap(CAUSE.STORE_FAULT, addr); return false; }
    return true;
  }

  // ---- execution ----
  /** Fetch and decode the instruction at pc through the decode cache; returns undefined (after taking the trap) on a fetch fault. */
  fetch() {
    const pc = this.pc, b = this.bus;
    if (pc & 1) { this.trap(CAUSE.FETCH_MISALIGNED, pc); return undefined; }
    b.fault = false;
    let lo, word;
    if ((pc & 2) === 0) { // word-aligned: one 32-bit read (as Hazard3 fetches words); a fault there may be the unused upper half
      word = b.read32(pc >>> 0);
      if (b.fault) { b.fault = false; lo = b.read16(pc >>> 0); word = lo; if ((lo & 3) === 3) word = lo | (b.read16((pc + 2) >>> 0) << 16); }
      else { lo = word & 0xffff; if ((lo & 3) !== 3) word = lo; }
    } else {
      lo = b.read16(pc >>> 0); word = lo;
      if ((lo & 3) === 3) word = lo | (b.read16((pc + 2) >>> 0) << 16);
    }
    // M mode with no locked or M-mode-enabled region: only a 32-bit instruction in the last halfword of a 32-byte granule can
    // fail (a partial match across a region boundary); the full check decides that case
    const mfast = this.priv === PRIV_M && this.pmp.mFree;
    if (b.fault || ((!mfast || ((pc & 31) === 30 && (lo & 3) === 3)) && this.pmp.deniesFetch(pc, (lo & 3) === 3, this.priv === PRIV_M))) {
      b.fault = false; this.trap(CAUSE.FETCH_FAULT, pc); return undefined;
    }
    const slot = (pc >>> 1) & (CACHE_SLOTS - 1);
    if (this.cacheTag[slot] === pc + 1 && this.cacheWord[slot] === word) { this.cacheHits++; return this.cacheRec[slot]; }
    this.cacheMisses++;
    const d = decode(word);
    this.cacheTag[slot] = pc + 1; this.cacheWord[slot] = word; this.cacheRec[slot] = d;
    return d;
  }

  /**
   * Execute one instruction (or take one interrupt or trap, or sleep one cycle). Returns true if an instruction retired.
   * Time advances by the step's cost (timing.js): the stall before X first (so that a csrr of mcycle reads the cycle of its
   * own X stage), then the cycles from that X cycle to the next instruction's.
   */
  step() {
    if (this.hist === null && !this.detail && this.mie === 0 && !this.sleeping && !this.trig.armed) return this._fast();
    return this._step(undefined);
  }

  /**
   * The common case, small enough for the engine's loop to inline it (P1-M3 profile): no history, no interrupt enabled, awake,
   * no trigger armed; a one-cycle ALU instruction, store or load with no stall pending. Anything else goes on through _step
   * with the instruction already fetched (same results: the tests run both paths).
   */
  _fast() {
    this.trapped = false;
    const d = this.fetch();
    if (d === undefined) return this._trapTail(false); // fetch fault: the trap is taken
    const f = FAST[d.op];
    if (f === 0) return this._step(d);
    const r = this.ldRd;
    if (r !== 0 || this.ldExcl) { // a load just before: one stall cycle before X if this instruction reads its rd there (rule L)
      if (this.ldExcl) return this._step(d);
      const u = USE[d.op];
      if (((u & 1) !== 0 && d.rs1 === r) || ((u & 2) !== 0 && d.rs2 === r)) { this.ticks++; if (!(this.mcountinhibit & 1)) this.cycles++; }
      this.ldRd = 0;
    }
    const pc = this.pc;
    if (this.redirect) { if ((pc & 2) !== 0 && d.len === 4) return this._step(d); this.redirect = false; }
    const ok = this.execute(d);
    if (this.trapped) return this._trapTail(ok);
    if (ok && !(this.mcountinhibit & 4)) this.instret++;
    let cost = 1;
    if (f === 3) this.ldRd = d.rd;
    else if (f === 2) { // jal, jalr: 2 cycles to the target
      cost = COST.JUMP; this.redirect = true;
    } else if (f === 4) cost = this._branch(d, pc);
    this.ticks += cost;
    if (!(this.mcountinhibit & 1)) this.cycles += cost;
    return ok;
  }

  /** A conditional branch on the fast path: its cycles and the BTB (the rules of _cost, without the cause bits). */
  _branch(d, pc) {
    const taken = this.pc !== ((pc + d.len) | 0);
    if (predictedTaken(this.btb, pc, d.imm)) {
      this.redirect = true;
      if (taken) return 1;
      this.btb = -1; return COST.BRANCH_MISS;
    }
    if (!taken) return 1;
    this.redirect = true;
    if (d.imm < 0) this.btb = pc;
    return COST.BRANCH_MISS;
  }

  /** The decoded instruction of the newest step (null: none was fetched), for the stage model (which sets `detail`). */
  lastInstr() { return this.lastD; }

  /** The end of a fast-path step that took an exception (no history is recorded on the fast path). */
  _trapTail(ok) {
    if (ok && !(this.mcountinhibit & 4)) this.instret++;
    const cause = CB.TRAP | (this.btb !== -1 ? CB.BTB_CLEAR : 0);
    this.btb = -1; this.ldRd = 0; this.ldExcl = false; this.redirect = true;
    this.ticks += COST.TRAP_ENTRY;
    if (!(this.mcountinhibit & 1)) this.cycles += COST.TRAP_ENTRY;
    this.lastPre = 0; this.lastCost = COST.TRAP_ENTRY; this.lastCause = cause;
    return ok;
  }

  /** The full step; `d0` is the instruction when _fast already fetched it (it did so only with mie 0, awake, no trigger). */
  _step(d0) {
    this.trapped = false;
    const irq = this.mie === 0 ? -1 : this.pendingInterrupt(); // nothing enabled: nothing to take (mip is not read)
    const hist = this.hist;
    const pc = this.pc;
    if (hist) hist.begin(pc, this.tState(), this.btb);
    this._cy0 = this.cycles; this._ir0 = this.instret;
    this.lastD = null;
    let ok = false, pre = 0, cost = 1, cause = 0;
    if (this.sleeping && !(this.mip & this.mie) && !(this.sleepBlock && this.unblockIn)) { // asleep: one cycle passes (recorded, so that step-back takes it back)
      cause = CB.SLEEP;
    } else {
      if (this.sleeping) { this._snap(); this.sleeping = false; if (this.sleepBlock && this.unblockIn) this.unblockIn = false; this.sleepBlock = false; }
      if (irq >= 0) { this.trap(irq, 0, true); cost = COST.IRQ_ENTRY; cause = CB.IRQ; }
      else if (this.trig.armed && this.trig.matches(pc, this.priv === PRIV_M)) { this.trap(CAUSE.BREAKPOINT, 0); cost = COST.TRAP_ENTRY; cause = CB.TRAP; } // before the fetch (hazard3_core.v x_except)
      else {
        const d = d0 !== undefined ? d0 : this.fetch();
        if (d === undefined) { cost = COST.TRAP_ENTRY; cause = CB.TRAP; }
        else {
          this.lastD = d;
          // stalls before X: the second fetch of a misaligned 32-bit target, then load-use or exclusive overlap; the timing
          // state is consumed here (the class of the instruction sets it again below)
          if (this.redirect) { this.redirect = false; if ((pc & 2) !== 0 && d.len === 4) { pre = 1; cause = CB.UNALIGNED; } }
          const r = this.ldRd;
          if (r !== 0 || this.ldExcl) {
            this.ldRd = 0;
            if (r !== 0 && readsInX(d, r)) { pre++; cause |= CB.LOAD_USE; }
            else if (this.ldExcl && EXCLUSIVE[d.op] === 1) { pre++; cause |= CB.EXCL; } // not added twice (design §3 rule E)
            this.ldExcl = false;
          }
          if (pre !== 0) { this.ticks += pre; if (!(this.mcountinhibit & 1)) this.cycles += pre; }
          const k = KIND[d.op];
          if (k === K.ALU || k === K.STORE) ok = this.execute(d); // the common case: one cycle, no timing state
          else if (k === K.LOAD) { ok = this.execute(d); this.ldRd = d.rd; }
          else {
            const dividend = this.x[d.rs1];
            if ((k === K.DIV || k === K.DIVU) && this.sched !== null && this.sched.deadline < this.ticks + divCost(k === K.DIV, dividend)) {
              const c = this._divInterrupted();
              if (c >= 0) { cause |= CB.DIV_CANCEL | CB.MULTI; this._end(hist, pre, c, cause, false); return false; }
            } // else the events at the deadline raised no interrupt: the div runs to its end
            ok = this.execute(d);
            if (!this.trapped) { cost = this._cost(d, k, pc, dividend); cause |= this._cause; }
          }
          if (ok && !(this.mcountinhibit & 4)) this.instret++;
          if (this.trapped) { cost = COST.TRAP_ENTRY; cause |= CB.TRAP; }
        }
      }
      if (this.trapped) { // every trap clears the BTB (hazard3_core.v) and restarts the frontend at the handler
        if (this.btb !== -1) cause |= CB.BTB_CLEAR;
        this.btb = -1; this.ldRd = 0; this.ldExcl = false; this.redirect = true;
      }
    }
    this.ticks += cost;
    if (!(this.mcountinhibit & 1)) this.cycles += cost;
    this.lastPre = pre; this.lastCost = pre + cost; this.lastCause = cause;
    if (hist) hist.end(!(this.mcountinhibit & 1), ok && this.instret === this._ir0 + 1, pre + cost, this.btb);
    return ok;
  }

  _end(hist, pre, cost, cause, ok) {
    this.adv(cost);
    this.lastPre = pre; this.lastCost = pre + cost; this.lastCause = cause;
    if (hist) hist.end(!(this.mcountinhibit & 1), ok && this.instret === this._ir0 + 1, pre + cost, this.btb);
  }

  /**
   * A div/rem whose cycles would pass the scheduler's deadline: time advances to the deadline, the due events run, and if an
   * interrupt is now to be taken the div is cancelled (D15-2; E-TIMING-1 ids 136-137: mepc = the div, which runs again after
   * the handler). Returns the cycles spent (the step's cost after the stall) when cancelled, else -1.
   */
  _divInterrupted() {
    const s = this.sched, c0 = this.ticks;
    const spent = Math.max(s.deadline, c0) - c0;
    this.adv(spent);
    s.serviceDue();          // the devices see the deadline's cycle
    this.adv(-spent);        // _end advances by the step's whole cost; nothing runs in between
    if (this.mie !== 0 && this.pendingInterrupt() >= 0) {
      this.ldRd = 0; this.ldExcl = false; this.redirect = false;
      return spent;
    }
    return -1;
  }

  /** The cost of an executed instruction from its X cycle to the next instruction's (timing.js), and the new timing state. */
  _cost(d, k, pc, dividend) {
    this._cause = 0;
    if (k === K.ALU || k === K.STORE) { this.ldRd = 0; this.ldExcl = false; this.redirect = false; return 1; }
    if (k === K.LOAD) { this.ldRd = d.rd; this.ldExcl = false; this.redirect = false; return 1; }
    if (k === K.BRANCH) {
      this.ldRd = 0; this.ldExcl = false;
      const taken = this.pc !== ((pc + d.len) | 0);
      if (predictedTaken(this.btb, pc, d.imm)) {
        this.redirect = true;
        if (taken) { this._cause = CB.PREDICTED | CB.TAKEN; return 1; }
        this.btb = -1; this._cause = CB.MISPREDICT | CB.BTB_CLEAR; return COST.BRANCH_MISS; // recovery: the fall-through is refetched
      }
      if (!taken) { this.redirect = false; return 1; }
      this.redirect = true;
      this._cause = CB.MISPREDICT | CB.TAKEN;
      if (d.imm < 0) { this.btb = pc; this._cause |= CB.BTB_SET; }
      return COST.BRANCH_MISS;
    }
    this.ldRd = 0; this.ldExcl = false; this.redirect = false;
    switch (k) {
      case K.EXCL: this.ldRd = d.rd; this.ldExcl = true; return 1;
      case K.AMO: this._cause = CB.MULTI; return COST.AMO;
      case K.JUMP: this.redirect = true; this._cause = CB.JUMP; return COST.JUMP;
      case K.MRET: this.redirect = true; this._cause = CB.JUMP; return COST.MRET;
      case K.DIV: this._cause = CB.MULTI; return divCost(true, dividend);
      case K.DIVU: this._cause = CB.MULTI; return COST.DIV;
      case K.WFI: this._cause = CB.MULTI; return COST.WFI;
      case K.SLT: if (d.rd === 0 && d.rs1 === 0 && d.rs2 === 0) { this._cause = CB.MULTI; return COST.BLOCK; } return 1; // h3.block; h3.unblock 1 (E-TIMING-1 id 94)
      case K.FENCE_I:
        if (this.btb !== -1) this._cause = CB.BTB_CLEAR;
        this.btb = -1; this.redirect = true; this._cause |= CB.JUMP; return COST.FENCE_I;
      case K.PUSHPOP: this._cause = CB.MULTI; return zcmpCost(k, zcmpCount(d.rs1));
      case K.POPRET: case K.POPRETZ: this.redirect = true; this._cause = CB.MULTI | CB.JUMP; return zcmpCost(k, zcmpCount(d.rs1));
      case K.MV: this._cause = CB.MULTI; return COST.MV01;
      default: return 1;
    }
  }

  /** Run up to `n` instructions (a trap or an interrupt counts as a step, so does a WFI sleeping cycle); stops when the hart sleeps. */
  run(n) {
    let i = 0;
    for (; i < n; i++) { this.step(); if (this.sleeping) { i++; break; } }
    return i;
  }

  execute(d) {
    const x = this.x;
    const pc = this.pc;
    let next = (pc + d.len) | 0;
    const rs1 = x[d.rs1], rs2 = x[d.rs2], imm = d.imm;
    let r; // result for rd
    switch (d.op) {
      case OP.LUI: r = imm; break;
      case OP.AUIPC: r = (pc + imm) | 0; break;
      case OP.JAL: r = next; next = (pc + imm) | 0; break;
      case OP.JALR: r = next; next = (rs1 + imm) & ~1; break;
      case OP.BEQ: if (rs1 === rs2) next = (pc + imm) | 0; break;
      case OP.BNE: if (rs1 !== rs2) next = (pc + imm) | 0; break;
      case OP.BLT: if (rs1 < rs2) next = (pc + imm) | 0; break;
      case OP.BGE: if (rs1 >= rs2) next = (pc + imm) | 0; break;
      case OP.BLTU: if ((rs1 >>> 0) < (rs2 >>> 0)) next = (pc + imm) | 0; break;
      case OP.BGEU: if ((rs1 >>> 0) >= (rs2 >>> 0)) next = (pc + imm) | 0; break;
      case OP.LB: { const v = this.load((rs1 + imm) | 0, 1); if (v === undefined) return false; r = (v << 24) >> 24; break; }
      case OP.LH: { const v = this.load((rs1 + imm) | 0, 2); if (v === undefined) return false; r = (v << 16) >> 16; break; }
      case OP.LW: { const v = this.load((rs1 + imm) | 0, 4); if (v === undefined) return false; r = v; break; }
      case OP.LBU: { const v = this.load((rs1 + imm) | 0, 1); if (v === undefined) return false; r = v & 0xff; break; }
      case OP.LHU: { const v = this.load((rs1 + imm) | 0, 2); if (v === undefined) return false; r = v & 0xffff; break; }
      case OP.SB: if (!this.store((rs1 + imm) | 0, 1, rs2)) return false; break;
      case OP.SH: if (!this.store((rs1 + imm) | 0, 2, rs2)) return false; break;
      case OP.SW: if (!this.store((rs1 + imm) | 0, 4, rs2)) return false; break;
      case OP.ADDI: r = (rs1 + imm) | 0; break;
      case OP.SLTI: r = rs1 < imm ? 1 : 0; break;
      case OP.SLTIU: r = (rs1 >>> 0) < (imm >>> 0) ? 1 : 0; break;
      case OP.XORI: r = rs1 ^ imm; break;
      case OP.ORI: r = rs1 | imm; break;
      case OP.ANDI: r = rs1 & imm; break;
      case OP.SLLI: r = rs1 << imm; break;
      case OP.SRLI: r = rs1 >>> imm; break;
      case OP.SRAI: r = rs1 >> imm; break;
      case OP.ADD: r = (rs1 + rs2) | 0; break;
      case OP.SUB: r = (rs1 - rs2) | 0; break;
      case OP.SLL: r = rs1 << (rs2 & 31); break;
      case OP.SLT:
        if (d.rd === 0 && d.rs1 === 0 && d.rs2 <= 1) { // Xh3power hints: h3.block (slt x0, x0, x0), h3.unblock (slt x0, x0, x1)
          this._snap();
          if (d.rs2 === 1) { if (this.onUnblock) this.onUnblock(); } // posted to the other processor (none modelled here)
          else if (this.unblockIn) this.unblockIn = false;           // an unblock already arrived: falls through as a nop
          else { this.sleeping = true; this.sleepBlock = true; }
          break;
        }
        r = rs1 < rs2 ? 1 : 0; break;
      case OP.SLTU: r = (rs1 >>> 0) < (rs2 >>> 0) ? 1 : 0; break;
      case OP.XOR: r = rs1 ^ rs2; break;
      case OP.SRL: r = rs1 >>> (rs2 & 31); break;
      case OP.SRA: r = rs1 >> (rs2 & 31); break;
      case OP.OR: r = rs1 | rs2; break;
      case OP.AND: r = rs1 & rs2; break;
      case OP.MUL: r = Math.imul(rs1, rs2); break;
      case OP.MULH: r = (mulhu(rs1, rs2) - (rs1 < 0 ? rs2 : 0) - (rs2 < 0 ? rs1 : 0)) | 0; break;
      case OP.MULHSU: r = (mulhu(rs1, rs2) - (rs1 < 0 ? rs2 : 0)) | 0; break;
      case OP.MULHU: r = mulhu(rs1, rs2); break;
      case OP.DIV: r = rs2 === 0 ? -1 : (rs1 === -2147483648 && rs2 === -1) ? rs1 : (rs1 / rs2) | 0; break;
      case OP.DIVU: r = rs2 === 0 ? -1 : ((rs1 >>> 0) / (rs2 >>> 0)) | 0; break;
      case OP.REM: r = rs2 === 0 ? rs1 : (rs1 === -2147483648 && rs2 === -1) ? 0 : (rs1 % rs2) | 0; break;
      case OP.REMU: r = rs2 === 0 ? rs1 : ((rs1 >>> 0) % (rs2 >>> 0)) | 0; break;
      case OP.FENCE: break;
      case OP.FENCE_I: this.flushCache(); break;
      case OP.ECALL: this.trap(this.priv === PRIV_M ? CAUSE.ECALL_M : CAUSE.ECALL_U, 0); return false;
      case OP.EBREAK: this.trap(CAUSE.BREAKPOINT, pc); return false;
      case OP.MRET: {
        this._snap();
        if (this.priv !== PRIV_M) return this.illegal(d);
        const s = this.mstatus;
        this.priv = (s & MSTATUS_MPP) ? PRIV_M : PRIV_U;
        // MPRV is cleared only when the return is to U mode (hazard3_csr.v); MPP becomes U
        this.mstatus = (s & ~(MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP | ((s & MSTATUS_MPP) ? 0 : MSTATUS_MPRV))) | ((s & MSTATUS_MPIE) ? MSTATUS_MIE : 0) | MSTATUS_MPIE;
        this.reservation = -1;
        this.irqc.trapExit();
        this.trig.trapExit();
        next = this.mepc;
        break;
      }
      case OP.WFI:
        this._snap();
        if (this.priv !== PRIV_M && (this.mstatus & MSTATUS_TW)) return this.illegal(d);
        this.sleeping = true; this.sleepBlock = false;
        break;
      case OP.CSRRW: case OP.CSRRS: case OP.CSRRC: case OP.CSRRWI: case OP.CSRRSI: case OP.CSRRCI: {
        this._snap();
        const imm5 = d.op >= OP.CSRRWI;
        const src = imm5 ? d.rs1 : rs1;
        const write = d.op === OP.CSRRW || d.op === OP.CSRRWI || d.rs1 !== 0;
        const read = !((d.op === OP.CSRRW || d.op === OP.CSRRWI) && d.rd === 0);
        const wtype = (d.op === OP.CSRRW || d.op === OP.CSRRWI) ? CSR_WRITE : (d.op === OP.CSRRS || d.op === OP.CSRRSI) ? CSR_SET : CSR_CLEAR;
        if (imm === MEINEXT) this._meinextSnap = { ...this.irqc.next }; // meinext's update request uses the value before the read clears meifa
        const old = read || !write ? this.csrRead(imm, src, write ? wtype : 0) : 0;
        if (old === undefined) return this.illegal(d);
        if (write) {
          const base = read ? old : 0;
          const v = (d.op === OP.CSRRW || d.op === OP.CSRRWI) ? src : (d.op === OP.CSRRS || d.op === OP.CSRRSI) ? base | src : base & ~src;
          if (!this.csrWrite(imm, v, src, wtype)) return this.illegal(d);
        }
        r = old;
        break;
      }
      case OP.LR_W: {
        this._snap();
        const a = rs1; const v = this.load(a, 4); if (v === undefined) return false;
        this.reservation = (a >>> 0) >>> this.reservationShift; r = v; break;
      }
      case OP.SC_W: {
        this._snap();
        const a = rs1;
        if (a & 3) { this.trap(CAUSE.STORE_MISALIGNED, a); return false; }
        // the PMP check applies whether or not the store will happen: Hazard3 checks the address in the core, before any bus access
        if (this.pmp.deniesData(a >>> 0, true, this.dataMmode())) { this.trap(CAUSE.STORE_FAULT, a); return false; }
        if (this.reservation === ((a >>> 0) >>> this.reservationShift)) { if (!this.store(a, 4, rs2)) return false; r = 0; } else r = 1;
        this.reservation = -1; break;
      }
      case OP.AMOSWAP_W: case OP.AMOADD_W: case OP.AMOXOR_W: case OP.AMOAND_W: case OP.AMOOR_W:
      case OP.AMOMIN_W: case OP.AMOMAX_W: case OP.AMOMINU_W: case OP.AMOMAXU_W: {
        const a = rs1;
        if (a & 3) { this.trap(CAUSE.STORE_MISALIGNED, a); return false; }
        const old = this.load(a, 4, true); if (old === undefined) return false;
        let v;
        switch (d.op) {
          case OP.AMOSWAP_W: v = rs2; break;
          case OP.AMOADD_W: v = (old + rs2) | 0; break;
          case OP.AMOXOR_W: v = old ^ rs2; break;
          case OP.AMOAND_W: v = old & rs2; break;
          case OP.AMOOR_W: v = old | rs2; break;
          case OP.AMOMIN_W: v = old < rs2 ? old : rs2; break;
          case OP.AMOMAX_W: v = old > rs2 ? old : rs2; break;
          case OP.AMOMINU_W: v = (old >>> 0) < (rs2 >>> 0) ? old : rs2; break;
          default: v = (old >>> 0) > (rs2 >>> 0) ? old : rs2; break;
        }
        if (!this.store(a, 4, v)) return false;
        r = old; break;
      }
      case OP.SH1ADD: r = ((rs1 << 1) + rs2) | 0; break;
      case OP.SH2ADD: r = ((rs1 << 2) + rs2) | 0; break;
      case OP.SH3ADD: r = ((rs1 << 3) + rs2) | 0; break;
      case OP.ANDN: r = rs1 & ~rs2; break;
      case OP.ORN: r = rs1 | ~rs2; break;
      case OP.XNOR: r = ~(rs1 ^ rs2); break;
      case OP.CLZ: r = Math.clz32(rs1); break;
      case OP.CTZ: r = ctz(rs1); break;
      case OP.CPOP: r = popcount(rs1); break;
      case OP.SEXT_B: r = (rs1 << 24) >> 24; break;
      case OP.SEXT_H: r = (rs1 << 16) >> 16; break;
      case OP.ZEXT_H: r = rs1 & 0xffff; break;
      case OP.MIN: r = rs1 < rs2 ? rs1 : rs2; break;
      case OP.MAX: r = rs1 > rs2 ? rs1 : rs2; break;
      case OP.MINU: r = (rs1 >>> 0) < (rs2 >>> 0) ? rs1 : rs2; break;
      case OP.MAXU: r = (rs1 >>> 0) > (rs2 >>> 0) ? rs1 : rs2; break;
      case OP.ROL: { const s = rs2 & 31; r = (rs1 << s) | (rs1 >>> ((32 - s) & 31)); break; }
      case OP.ROR: { const s = rs2 & 31; r = (rs1 >>> s) | (rs1 << ((32 - s) & 31)); break; }
      case OP.RORI: r = (rs1 >>> imm) | (rs1 << ((32 - imm) & 31)); break;
      case OP.ORC_B: r = orcb(rs1); break;
      case OP.REV8: r = rev8(rs1); break;
      case OP.BCLR: r = rs1 & ~(1 << (rs2 & 31)); break;
      case OP.BCLRI: r = rs1 & ~(1 << imm); break;
      case OP.BEXT: r = (rs1 >>> (rs2 & 31)) & 1; break;
      case OP.BEXTI: r = (rs1 >>> imm) & 1; break;
      case OP.BINV: r = rs1 ^ (1 << (rs2 & 31)); break;
      case OP.BINVI: r = rs1 ^ (1 << imm); break;
      case OP.BSET: r = rs1 | (1 << (rs2 & 31)); break;
      case OP.BSETI: r = rs1 | (1 << imm); break;
      case OP.PACK: r = (rs1 & 0xffff) | (rs2 << 16); break;
      case OP.PACKH: r = (rs1 & 0xff) | ((rs2 & 0xff) << 8); break;
      case OP.BREV8: r = brev8(rs1); break;
      case OP.ZIP: r = zip(rs1); break;
      case OP.UNZIP: r = unzip(rs1); break;
      case OP.H3_BEXTM: r = (rs1 >>> (rs2 & 31)) & ((1 << imm) - 1); break;      // Xh3bextm: imm is the field width, 1 to 8
      case OP.H3_BEXTMI: r = (rs1 >>> d.rs2) & ((1 << imm) - 1); break;
      case OP.CM_MVA01S: { const a = x[zcmpSReg(d.rs1)], b = x[zcmpSReg(d.rs2)]; this.wr(10, a); this.wr(11, b); break; }
      case OP.CM_MVSA01: { const a = x[10], b = x[11]; this.wr(zcmpSReg(d.rs1), a); this.wr(zcmpSReg(d.rs2), b); break; }
      case OP.CM_PUSH: {
        // ra at the lowest address, the highest s register at sp-4 (hazard3_instr_decompress.v zcmp_stack_sw_offset; Zcmp specification)
        const regs = zcmpRegisters(d.rs1), n = regs.length;
        const sp = x[2];
        for (let i = 0; i < n; i++) if (!this.store((sp - 4 * (n - i)) | 0, 4, x[regs[i]])) return false;
        this.wr(2, (sp + imm) | 0);
        break;
      }
      case OP.CM_POP: case OP.CM_POPRET: case OP.CM_POPRETZ: {
        const regs = zcmpRegisters(d.rs1), n = regs.length;
        const sp = x[2], top = (sp + imm) | 0;
        const vals = new Array(n);
        for (let i = 0; i < n; i++) { const v = this.load((top - 4 * (n - i)) | 0, 4); if (v === undefined) return false; vals[i] = v; }
        for (let i = 0; i < regs.length; i++) this.wr(regs[i], vals[i]);
        if (d.op === OP.CM_POPRETZ) this.wr(10, 0);
        this.wr(2, top);
        if (d.op !== OP.CM_POP) next = x[1] & ~1;
        break;
      }
      default: return this.illegal(d);
    }
    if (r !== undefined && d.rd !== 0) this.wr(d.rd, r);
    this.pc = next;
    return true;
  }

  illegal(d) {
    this.trap(CAUSE.ILLEGAL, 0); // mtval is hardwired to 0 in Hazard3
    return false;
  }
}
