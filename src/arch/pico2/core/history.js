// history.js -- reversible execution for the pico2 module's hart (P1-M1): what each step changed, in one ring of 32-bit words.
// A step's record has a variable length (a Zcmp push or pop writes up to 13 registers or words): [length, pc, counts, register
// writes (register, old value) x n, memory writes (address, size, old value) x m, (old BTB entry), flags/length]. The length word
// at both ends lets the oldest record be dropped (read from the front) and the newest undone (read from the back). P1-M3: the
// counts word also holds the timing state before the step (previous load's rd, exclusive, redirect: hart.tState()), the flags
// word holds the step's cost in cycles, and the old BTB entry is kept only when the step changed it. Steps that change machine state
// beyond registers and memory (CSR instructions, traps, mret, wfi, lr/sc) keep a snapshot of that state, in a map by step
// number. Designed after, and sharing no code with, the RISC-V module's src/core/history.js.
// Memory is restored through `bus.restore(addr, size, value)` when the bus has it, else through `bus.write8/16/32`. A write the
// bus could not peek (a device register) is recorded as `device` and not restored: reversing it would repeat its side effect.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

// flags in the last word: the low 8 bits are the payload length; F_CY: mcycle counted the step's cycles; F_IR: minstret advanced
// by one; F_SYS: a snapshot is kept; F_BTB: the old BTB entry is in the record; bits 12 and up: the step's cost in cycles
const F_CY = 1 << 8, F_IR = 1 << 9, F_SYS = 1 << 10, F_BTB = 1 << 11, COST_SHIFT = 12;
const SCRATCH = 256;                                  // words: more than the largest record (Zcmp: 2 + 26 + 39)

export class HistoryRing {
  /** @param {number} [words] capacity of the ring in 32-bit words (default 1 Mi words = 4 MiB, about 170 000 plain steps) */
  constructor(words = 1 << 20) {
    this.cap = words;
    this.buf = new Uint32Array(words);
    this.start = 0;         // index of the oldest record
    this.used = 0;          // words in use
    this.count = 0;         // records held
    this.dropped = 0;       // records lost to the limit
    this.seq = 0;           // absolute number of the next record
    this.sys = new Map();   // step number -> state snapshot
    this.cur = new Uint32Array(SCRATCH);
    this.n = 0;             // words of the record being built (after the pc and counts words)
    this.nreg = 0; this.nmem = 0; this.pc = 0; this.hasSys = false; this.deviceWrites = 0; this.t0 = 0; this.btb0 = -1;
  }

  // ---- recording (called by the hart during a step) ----
  /** Start a step at `pc`; `t` is the hart's packed timing state and `btb` its BTB entry before the step. */
  begin(pc, t = 0, btb = -1) { this.pc = pc | 0; this.t0 = t; this.btb0 = btb; this.n = 0; this.nreg = 0; this.nmem = 0; this.hasSys = false; this.pendingSys = null; }
  reg(r, old) { this.cur[this.n++] = r; this.cur[this.n++] = old | 0; this.nreg++; }
  /** Registers come first in the payload, memory writes after them: a memory write is kept in its own list until the end. */
  mem(addr, size, old, device = false) {
    if (!this.memBuf) this.memBuf = new Uint32Array(SCRATCH);
    const k = this.nmem * 3;
    this.memBuf[k] = addr >>> 0; this.memBuf[k + 1] = size | (device ? 0x100 : 0); this.memBuf[k + 2] = old | 0;
    this.nmem++;
  }
  /** Keep the machine state before this step (once per step). */
  snapshot(s) { if (!this.hasSys) { this.hasSys = true; this.pendingSys = s; } }
  get snapshotTaken() { return this.hasSys; }

  /**
   * Commit the step: `cy` mcycle counted its cycles, `ir` minstret advanced by one, `cost` its cycles (ticks), `btb` the BTB
   * entry after it.
   */
  end(cy, ir, cost = 1, btb = this.btb0) {
    const nb = btb !== this.btb0 ? 1 : 0;
    const payload = 2 + this.n + this.nmem * 3 + nb;             // pc, counts, register pairs, memory triples, old BTB
    const total = payload + 2;                                  // + the length word at each end
    if (total > this.cap) return;
    while (this.used + total > this.cap) this.dropOldest();
    const flags = (cy ? F_CY : 0) | (ir ? F_IR : 0) | (this.hasSys ? F_SYS : 0) | (nb ? F_BTB : 0) | payload | (cost << COST_SHIFT);
    const counts = this.nreg | (this.nmem << 8) | (this.t0 << 16);
    const buf = this.buf, cap = this.cap;
    let p = this.start + this.used; if (p >= cap) p -= cap;
    if (p + total <= cap) { // the common case: the record does not wrap
      buf[p] = total; buf[p + 1] = this.pc; buf[p + 2] = counts;
      let q = p + 3;
      for (let i = 0; i < this.n; i++) buf[q++] = this.cur[i];
      for (let i = 0, k = this.nmem * 3; i < k; i++) buf[q++] = this.memBuf[i];
      if (nb) buf[q++] = this.btb0;
      buf[q] = flags;
    } else {
      const put = (v) => { buf[p] = v; if (++p === cap) p = 0; };
      put(total); put(this.pc); put(counts);
      for (let i = 0; i < this.n; i++) put(this.cur[i]);
      for (let i = 0; i < this.nmem * 3; i++) put(this.memBuf[i]);
      if (nb) put(this.btb0);
      put(flags);
    }
    this.used += total; this.count++;
    if (this.hasSys) { this.sys.set(this.seq, this.pendingSys); this.pendingSys = null; }
    this.seq++;
    for (let i = 0; i < this.nmem; i++) if (this.memBuf[i * 3 + 1] & 0x100) this.deviceWrites++;
  }

  dropOldest() {
    const len = this.buf[this.start];
    if (this.sys.size) this.sys.delete(this.seq - this.count);
    this.start += len; if (this.start >= this.cap) this.start -= this.cap;
    this.used -= len; this.count--; this.dropped++;
  }

  // ---- reading back ----
  /** Undo the newest step on `h` (a Hart). Returns false when no step is kept. */
  undo(h) {
    if (this.count === 0) return false;
    const last = (this.start + this.used - 1) % this.cap;
    const flags = this.buf[last];
    const payload = flags & 0xff;
    const total = payload + 2;
    const first = (last - total + 1 + this.cap) % this.cap;
    const at = (k) => this.buf[(first + k) % this.cap];
    const pc = at(1), counts = at(2), nreg = counts & 0xff, nmem = (counts >>> 8) & 0xff;
    const cost = flags >>> COST_SHIFT;
    // memory writes, newest first, then register writes, newest first
    const memBase = 3 + nreg * 2;
    for (let i = nmem - 1; i >= 0; i--) {
      const addr = at(memBase + i * 3), sz = at(memBase + i * 3 + 1), old = at(memBase + i * 3 + 2) | 0;
      if (sz & 0x100) continue; // a device register: not restored
      const size = sz & 0xff;
      if (h.bus.restore) h.bus.restore(addr, size, old);
      else if (size === 4) h.bus.write32(addr, old); else if (size === 2) h.bus.write16(addr, old & 0xffff); else h.bus.write8(addr, old & 0xff);
    }
    for (let i = nreg - 1; i >= 0; i--) { const r = at(3 + i * 2); if (r) h.x[r] = at(4 + i * 2) | 0; }
    h.pc = pc | 0;
    this.used -= total; this.count--; this.seq--;
    if (flags & F_SYS) { h.restoreSys(this.sys.get(this.seq)); this.sys.delete(this.seq); } // the counters as the step began
    else { if (flags & F_CY) h.cycles -= cost; if (flags & F_IR) h.instret--; }
    h.ticks -= cost;
    h.setTState(counts >>> 16);
    if (flags & F_BTB) h.btb = at(memBase + nmem * 3) | 0;
    h.trapped = false;
    return true;
  }

  /**
   * The newest step, without undoing it: its pc, the registers it wrote with their old values (in order), its memory writes
   * ([address, size, old value, device]) and the machine-state snapshot of a CSR/trap/mret/wfi/lr/sc step (else null); null if
   * no step is kept.
   */
  newest() {
    if (this.count === 0) return null;
    const last = (this.start + this.used - 1) % this.cap;
    const flags = this.buf[last];
    const first = (last - ((flags & 0xff) + 2) + 1 + this.cap) % this.cap;
    const at = (k) => this.buf[(first + k) % this.cap];
    const counts = at(2), nreg = counts & 0xff, nmem = (counts >>> 8) & 0xff;
    const regs = [], mem = [];
    for (let i = 0; i < nreg; i++) regs.push([at(3 + i * 2), at(4 + i * 2) | 0]);
    const memBase = 3 + nreg * 2;
    for (let i = 0; i < nmem; i++) { const sz = at(memBase + i * 3 + 1); mem.push([at(memBase + i * 3), sz & 0xff, at(memBase + i * 3 + 2) | 0, (sz & 0x100) !== 0]); }
    return { pc: at(1) | 0, regs, mem, sys: (flags & F_SYS) ? this.sys.get(this.seq - 1) ?? null : null, cost: flags >>> COST_SHIFT };
  }

  /** pc of the newest step, or -1. */
  get topPc() {
    if (!this.count) return -1;
    const last = (this.start + this.used - 1) % this.cap;
    const first = (last - ((this.buf[last] & 0xff) + 2) + 1 + this.cap) % this.cap;
    return this.buf[(first + 1) % this.cap] | 0;
  }

  clear() { this.start = 0; this.used = 0; this.count = 0; this.dropped = 0; this.seq = 0; this.sys.clear(); this.deviceWrites = 0; }

  /** Bytes held by the ring. */
  get bytes() { return this.cap * 4; }
}
