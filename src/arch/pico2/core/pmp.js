// pmp.js -- physical memory protection of the RP2350's Hazard3 (P1-M1): 11 regions, regions 8 to 10 hardwired, NAPOT only (TOR is
// WARL'd to OFF, and so is NA4 because the granule is 32 bytes), pmpcfgm0 (Xh3pmpm: apply an unlocked region to M mode).
// Follows hazard3_pmp.v of the pinned hazard3-rp2350 tree (research repository, R-HZ-01 §3.2) and the RP2350 values of the
// configuration (RP-001 §3.8.3.1, §3.8.8.1). Where the RTL differs from the privileged specification (pmpaddr read-back,
// below) the RTL is followed, including the transposed R and X bits of pmpcfg (silicon erratum RP2350-E6, R-HZ-01 §3.1) unless
// the option specCfgBits asks for the standard layout (the riscv-arch-test runs use it).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const PMP_REGIONS = 11;
export const PMP_GRAIN = 3; // G: the granule is 2^(G+2) = 32 bytes; the G-1 low bits of pmpaddr are forced
const HARDWIRED = 0x700;
const HARDWIRED_ADDR = [0, 0, 0, 0, 0, 0, 0, 0, 0x01ffffff, 0x13ffffff, 0x35ffffff];
const HARDWIRED_CFG = 0x1f; // NAPOT, R, W, X, not locked
const A_OFF = 0, A_NAPOT = 3;
const LOW = ~(~0 << (PMP_GRAIN - 1)) >>> 0; // 0b11

export class Pmp {
  /**
   * @param {{specCfgBits?: boolean, clearWriteOnly?: boolean, specReadback?: boolean}} [opts] All default to the pinned RTL (hazard3_pmp.v). `specCfgBits`:
   * the standard pmpcfg layout (R is bit 0, X is bit 2); the RTL has R and X transposed (R bit 2, X bit 0), which is the silicon erratum RP2350-E6. clearWriteOnly: a write of
   * R=0, W=1 clears R, W and X (the privileged specification's WARL choice, Sail's PMP_ClearPermissions); specReadback: pmpaddr reads
   * its granule bits as zero for an OFF region and one for NAPOT, as the specification has it (the RTL does the opposite).
   */
  constructor(opts = {}) { this.opts = opts; this.reset(); }

  reset() {
    this.ver = (this.ver ?? 0) + 1; // changes of the saved state (the hart reuses its last copy while this is unchanged)
    this.l = new Uint8Array(PMP_REGIONS); this.a = new Uint8Array(PMP_REGIONS);
    this.r = new Uint8Array(PMP_REGIONS); this.w = new Uint8Array(PMP_REGIONS); this.x = new Uint8Array(PMP_REGIONS);
    this.addr = new Int32Array(PMP_REGIONS);     // bits 31:2 of the address, as pmpaddr holds them
    this.m = 0;                                  // pmpcfgm0 (bit per region)
    this.mask = new Int32Array(PMP_REGIONS); this.base = new Int32Array(PMP_REGIONS); // decoded match, kept up to date
    for (let i = 0; i < PMP_REGIONS; i++) {
      if (HARDWIRED >>> i & 1) { this.a[i] = A_NAPOT; this.r[i] = this.w[i] = this.x[i] = 1; this.addr[i] = HARDWIRED_ADDR[i]; } else this.addr[i] = LOW;
      this.decode(i);
    }
    this._free();
  }

  /** mFree: no active region is locked or M-mode-enabled, so M-mode data accesses always pass and M-mode fetches fail only on a
   * partial match (the hart's fast path). Regions are NAPOT of at least 32 bytes, so their boundaries are 32-byte aligned. */
  _free() {
    let free = true;
    for (let i = 0; i < PMP_REGIONS; i++) if (this.a[i] && (this.l[i] || (this.m >>> i & 1))) free = false;
    this.mFree = free;
  }

  save() { return { l: this.l.slice(), a: this.a.slice(), r: this.r.slice(), w: this.w.slice(), x: this.x.slice(), addr: this.addr.slice(), m: this.m }; }
  load(s) {
    this.ver++;
    this.l.set(s.l); this.a.set(s.a); this.r.set(s.r); this.w.set(s.w); this.x.set(s.x); this.addr.set(s.addr); this.m = s.m;
    for (let i = 0; i < PMP_REGIONS; i++) this.decode(i);
    this._free();
  }

  /** Match mask and base of region i: NAPOT checks every address bit above the lowest zero bit of pmpaddr. */
  decode(i) {
    let mask = 0;
    const pa = this.addr[i] >>> 0;
    // bit j (3..31) of the mask is set when bit j-1 of the mask is set or bit j-3 of pmpaddr is zero
    for (let j = 3; j < 32; j++) if ((mask >>> (j - 1)) & 1 || !((pa >>> (j - 3)) & 1)) mask |= 1 << j;
    this.mask[i] = mask; this.base[i] = (pa << 2) & mask;
  }

  /** Is `a` one of the PMP CSRs (including pmpcfg4 to 15 and pmpaddr11 to 15, which exist and read as zero)? */
  static owns(a) { return (a >= 0x3a0 && a <= 0x3a3) || (a >= 0x3b0 && a <= 0x3bf) || a === 0xbd0; }

  csrRead(a) {
    if (a >= 0x3a0 && a <= 0x3a3) {
      let v = 0;
      for (let k = 0; k < 4; k++) {
        const i = (a - 0x3a0) * 4 + k;
        if (i < PMP_REGIONS) v |= ((this.l[i] << 7) | (this.a[i] << 3) | (this.opts.specCfgBits ? (this.x[i] << 2) | (this.w[i] << 1) | this.r[i] : (this.r[i] << 2) | (this.w[i] << 1) | this.x[i])) << (8 * k);
      }
      return v | 0;
    }
    if (a >= 0x3b0 && a <= 0x3bf) {
      const i = a - 0x3b0;
      if (i >= PMP_REGIONS) return 0;
      // hazard3_pmp.v clears the G-1 low bits of a non-hardwired pmpaddr when its region is not OFF (the specification has them
      // read as ones for NAPOT, zeros for OFF); the stored value always has them set
      if (this.opts.specReadback && !(HARDWIRED >>> i & 1)) return (this.a[i] === A_OFF ? this.addr[i] & ~((1 << PMP_GRAIN) - 1) : this.addr[i] | LOW) | 0; // OFF: the G low bits read zero; NAPOT: the G-1 low bits read one
      if (!(HARDWIRED >>> i & 1) && this.a[i] !== A_OFF) return (this.addr[i] & ~LOW) | 0;
      return this.addr[i];
    }
    return this.m; // 0xbd0
  }

  csrWrite(a, v) {
    this.ver++;
    if (a >= 0x3a0 && a <= 0x3a3) {
      for (let k = 0; k < 4; k++) {
        const i = (a - 0x3a0) * 4 + k;
        if (i >= PMP_REGIONS || this.l[i] || (HARDWIRED >>> i & 1)) continue;
        const b = (v >>> (8 * k)) & 0xff;
        const aa = (b >>> 3) & 3;
        this.l[i] = b >>> 7; this.w[i] = (b >>> 1) & 1;
        if (this.opts.specCfgBits) { this.r[i] = b & 1; this.x[i] = (b >>> 2) & 1; } else { this.r[i] = (b >>> 2) & 1; this.x[i] = b & 1; }
        this.a[i] = aa === A_NAPOT ? A_NAPOT : A_OFF; // TOR and NA4 are not supported: they read back as OFF
        if (this.opts.clearWriteOnly && !this.r[i] && this.w[i]) this.w[i] = this.x[i] = 0;
      }
    } else if (a >= 0x3b0 && a <= 0x3bf) {
      const i = a - 0x3b0;
      if (i < PMP_REGIONS && !this.l[i] && !(HARDWIRED >>> i & 1)) { this.addr[i] = (v | LOW) | 0; this.decode(i); }
    } else this.m = v & ((1 << PMP_REGIONS) - 1) & ~HARDWIRED;
    this._free();
  }

  /** Does the access of a hart in M mode (`mmode`) to the first byte at `addr` fail? Write: store or AMO. */
  deniesData(addr, write, mmode) {
    for (let i = 0; i < PMP_REGIONS; i++) {
      if (this.a[i] && ((addr & this.mask[i]) === this.base[i])) {
        const checked = !mmode || this.l[i] === 1 || (this.m >>> i & 1) === 1;
        return checked && !(write ? this.w[i] : this.r[i]);
      }
    }
    return !mmode; // no match: M mode may, U mode may not
  }

  /** Does fetching the instruction at `pc` fail (`is32`: its two low bits are 11)? A 32-bit instruction that straddles a region fails. */
  deniesFetch(pc, is32, mmode) {
    const hw1 = (pc + 2) | 0;
    for (let i = 0; i < PMP_REGIONS; i++) {
      if (!this.a[i]) continue;
      const m0 = (pc & this.mask[i]) === this.base[i], m1 = (hw1 & this.mask[i]) === this.base[i];
      if (m0 || m1) {
        if ((m0 !== m1) && is32) return true;
        const checked = !mmode || this.l[i] === 1 || (this.m >>> i & 1) === 1;
        return checked && !this.x[i];
      }
    }
    return !mmode;
  }
}
