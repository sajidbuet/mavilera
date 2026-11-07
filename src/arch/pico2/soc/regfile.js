// regfile.js -- a register block of the RP2350 driven by the generated SVD table (regs.generated.js): reset values, and the
// effect of a write through each atomic alias (RP-001 §2.1.3): normal write, XOR, SET, CLR on read-write fields. Write-1-to-clear
// fields clear on every bit written as 1 through any alias, CLR included: the SDK example timer_lowlevel acknowledges its alarm
// with hw_clear_bits() on TIMER INTR (pico-examples; research repository, design §3, decision D13). The datasheet does not state
// this case: an inference, listed in the module's notes. Read-only and write-only fields are left to the device models.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { SVD_REGS } from './regs.generated.js';

export const ALIAS_NORMAL = 0;
export const ALIAS_XOR = 1;
export const ALIAS_SET = 2;
export const ALIAS_CLR = 3;

export class RegFile {
  /** @param {string} block name in SVD_REGS */
  constructor(block) {
    const t = SVD_REGS[block];
    if (!t) throw new Error(`no register table for ${block}`);
    this.block = block;
    const n = t.length;
    this.names = t.map((r) => r[0]);
    this.index = new Map(t.map((r, i) => [r[1], i]));
    this.byName = new Map(t.map((r, i) => [r[0], r[1]]));
    this.resetV = Uint32Array.from(t, (r) => r[2]);
    this.rw = Uint32Array.from(t, (r) => r[3]);
    this.w1c = Uint32Array.from(t, (r) => r[4]);
    this.v = new Uint32Array(n);
    // word offset -> register index (-1: none): a typed table instead of the Map on every access (P1-M3 profile)
    const top = t.reduce((a, r) => Math.max(a, r[1] >>> 2), 0);
    this.idx = new Int32Array(Math.max(1024, top + 1)).fill(-1);
    t.forEach((r, i) => { if ((r[1] & 3) === 0) this.idx[r[1] >>> 2] = i; });
    this.old = 0;              // the value before the last write()
    this.reset();
  }

  reset() { this.v.set(this.resetV); }
  /** Offset of a register by name (throws if absent: a programming error in a device model). */
  off(name) { const o = this.byName.get(name); if (o === undefined) throw new Error(`${this.block} has no register ${name}`); return o; }
  /** Register index of a byte offset, or -1. */
  at(off) { return (off & 3) === 0 && (off >>> 2) < this.idx.length ? this.idx[off >>> 2] : (this.index.get(off) ?? -1); }
  has(off) { return this.at(off) >= 0; }
  get(off) { const i = this.at(off); return i < 0 ? 0 : this.v[i]; }
  set(off, value) { const i = this.at(off); if (i >= 0) this.v[i] = value >>> 0; }

  /** Apply a bus write to the stored value; returns the new value (old one in `old`), or -1 for an offset with no register. */
  write(off, value, alias) {
    const i = this.at(off);
    if (i < 0) return -1;
    const old = this.v[i], rw = this.rw[i], w1c = this.w1c[i];
    let nv;
    switch (alias) {
      case ALIAS_XOR: nv = old ^ (value & rw); break;
      case ALIAS_SET: nv = old | (value & rw); break;
      case ALIAS_CLR: nv = old & ~(value & rw); break;
      default: nv = (old & ~rw) | (value & rw);
    }
    nv = (nv & ~(value & w1c)) >>> 0;
    this.v[i] = nv;
    this.old = old;
    return nv;
  }

  save() { return this.v.slice(); }
  load(s) { this.v.set(s); }
}

/** The value a write through `alias` gives a plain register (no field classes): for registers a device keeps itself. */
export function aliasApply(old, value, alias) {
  switch (alias) {
    case ALIAS_XOR: return (old ^ value) >>> 0;
    case ALIAS_SET: return (old | value) >>> 0;
    case ALIAS_CLR: return (old & ~value) >>> 0;
    default: return value >>> 0;
  }
}
