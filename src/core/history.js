// history.js -- reversible execution (WS-F-090): what each step changed, in
// a ring buffer of typed arrays (20 bytes per step: pc, packed info, old
// register value, store address, old memory value). The rare extras --
// console output length, a new lowest sp, a change of the --abi-check call
// stack -- are kept in a map by step number. When the limit is reached the
// oldest step is dropped and `dropped` counts them, so the interface can say
// so. The history can be exported and appended, to bring back the steps of a
// run made in the Worker.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

// info word: cls (4 bits) | rd << 4 (5 bits) | memSize << 9 (3 bits) | halt << 12 | extra << 13
const RD_SHIFT = 4;
const MEM_SHIFT = 9;
const HALT_BIT = 1 << 12;
const EXTRA_BIT = 1 << 13;
const TRAP = 9; // class of a trap step (iss.js)

export class History {
  constructor(limit = 1_000_000) {
    this.limit = limit;
    this.alloc(Math.min(limit, 4096));
    this.start = 0;
    this.size = 0;
    this.dropped = 0;
    this.seq = 0; // number of the next step pushed (absolute)
    this.extra = new Map(); // step number -> {out, spMinOld, abiTopOld, abiViolOld}
  }

  alloc(cap) {
    const grow = (old) => {
      const a = new Uint32Array(cap);
      if (old) for (let i = 0; i < this.size; i++) a[i] = old[(this.start + i) % old.length];
      return a;
    };
    this.pc = grow(this.pc);
    this.info = grow(this.info);
    this.regOld = grow(this.regOld);
    this.memAddr = grow(this.memAddr);
    this.memOld = grow(this.memOld);
    this.start = 0;
    this.cap = cap;
  }

  /** Record the step the hart has just executed (its d_* fields). */
  pushFrom(h) {
    if (this.size === this.cap && this.cap < this.limit) this.alloc(Math.min(this.limit, this.cap * 2));
    let i;
    if (this.size === this.cap) { // full: overwrite the oldest
      i = this.start;
      this.start = (this.start + 1) % this.cap;
      this.extra.delete(this.seq - this.size);
      this.dropped += 1;
    } else {
      i = (this.start + this.size) % this.cap;
      this.size += 1;
    }
    let info = h.d_cls | (h.d_rd << RD_SHIFT) | (h.d_memSize << MEM_SHIFT) | (h.d_halt ? HALT_BIT : 0);
    // iss-priv: the state saved before the step, a step that did not take one cycle, a trap step
    const priv = Boolean(h.priv) && (h.d_priv !== null || h.d_dcyc !== 1);
    if (h.d_outLen || h.d_spChanged || h.d_abiChanged || priv) {
      info |= EXTRA_BIT;
      const e = {
        out: h.d_outLen,
        spMinOld: h.d_spChanged ? h.d_spMinOld : null,
        abi: h.d_abiChanged ? { top: h.d_abiTopOld, viol: h.d_abiViolOld } : null,
      };
      if (priv) { e.priv = h.d_priv; e.dcyc = h.d_dcyc; e.idle = h.d_idle; e.trap = h.d_cls === TRAP ? h.d_trap : null; }
      this.extra.set(this.seq, e);
    }
    this.pc[i] = h.d_pc;
    this.info[i] = info;
    this.regOld[i] = h.d_regOld;
    this.memAddr[i] = h.d_memAddr;
    this.memOld[i] = h.d_memOld;
    this.seq += 1;
  }

  /** Undo the newest step on the hart. Returns false if there is none. */
  undo(h) {
    if (this.size === 0) return false;
    this.size -= 1;
    this.seq -= 1;
    const i = (this.start + this.size) % this.cap;
    const info = this.info[i];
    const cls = info & 15;
    const rd = (info >>> RD_SHIFT) & 31;
    const memSize = (info >>> MEM_SHIFT) & 7;
    if (cls !== TRAP) h.instret -= 1; // a trap step retires nothing
    h.countArr[cls] -= 1;
    let dcyc = 1; // iss-priv: cycles the step took (one, unless it waited or took a trap)
    h.pc = this.pc[i];
    if (rd) h.x[rd] = this.regOld[i];
    if (memSize) h.mem.restore(this.memAddr[i], memSize, this.memOld[i]);
    h.halted = false;
    if (info & HALT_BIT) h.exitCode = null;
    if (info & EXTRA_BIT) {
      const e = this.extra.get(this.seq);
      this.extra.delete(this.seq);
      if (e.out) h.output.length = Math.max(0, h.output.length - e.out); // (none left: dropped by the cap, OUTPUT_KEEP)
      if (e.spMinOld !== null) h.spMin = e.spMinOld;
      if (e.abi) { h.abiTop = e.abi.top; h.abiViolations.length = e.abi.viol; }
      if (e.dcyc !== undefined) {
        dcyc = e.dcyc;
        h.idleCycles -= e.idle;
        if (e.trap !== null) h.trapCounts[e.trap] -= 1;
        if (e.priv) h.restorePriv(e.priv);
      }
    }
    if (h.priv) h.cycle -= dcyc;
    return true;
  }

  /** The newest step: {pc, rd, memAddr, memSize}, or null. */
  top() {
    if (this.size === 0) return null;
    const i = (this.start + this.size - 1) % this.cap;
    const info = this.info[i];
    return { pc: this.pc[i], rd: (info >>> RD_SHIFT) & 31, memAddr: this.memAddr[i], memSize: (info >>> MEM_SHIFT) & 7,
      regOld: this.regOld[i], memOld: this.memOld[i] };
  }

  /** pc of the k-th newest step (0 = newest). */
  pcAt(k) {
    return this.pc[(this.start + this.size - 1 - k) % this.cap];
  }

  clear() {
    this.pc = null;
    this.size = 0;
    this.alloc(Math.min(this.limit, 4096));
    this.dropped = 0;
    this.seq = 0;
    this.extra = new Map();
  }

  /** Linear copy, oldest first, with transferable buffers (Worker to page). */
  export() {
    const n = this.size;
    const lin = (a) => { const o = new Uint32Array(n); for (let k = 0; k < n; k++) o[k] = a[(this.start + k) % this.cap]; return o; };
    const first = this.seq - n;
    const extra = [];
    for (const [s, e] of this.extra) extra.push([s - first, e]);
    return { n, dropped: this.dropped, pc: lin(this.pc), info: lin(this.info), regOld: lin(this.regOld),
      memAddr: lin(this.memAddr), memOld: lin(this.memOld), extra };
  }

  /** Append the steps of an exported history (they follow the newest step here). */
  append(ex) {
    const extra = new Map(ex.extra);
    for (let k = 0; k < ex.n; k++) {
      const e = extra.get(k);
      // Reuse pushFrom through a stand-in hart record.
      const info = ex.info[k];
      const d = STAND_IN;
      d.d_pc = ex.pc[k];
      d.d_cls = info & 15;
      d.d_rd = (info >>> RD_SHIFT) & 31;
      d.d_memSize = (info >>> MEM_SHIFT) & 7;
      d.d_halt = Boolean(info & HALT_BIT);
      d.d_regOld = ex.regOld[k];
      d.d_memAddr = ex.memAddr[k];
      d.d_memOld = ex.memOld[k];
      d.d_outLen = e ? e.out : 0;
      d.d_spChanged = Boolean(e && e.spMinOld !== null);
      d.d_spMinOld = e?.spMinOld ?? 0;
      d.d_abiChanged = Boolean(e?.abi);
      d.d_abiTopOld = e?.abi?.top ?? null;
      d.d_abiViolOld = e?.abi?.viol ?? 0;
      this.pushFrom(d);
    }
    this.dropped += ex.dropped;
  }

  /** Bytes held by the step arrays (for the interface). */
  get bytes() {
    return this.cap * 20;
  }
}

const STAND_IN = {};
