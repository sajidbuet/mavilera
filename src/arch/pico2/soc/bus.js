// bus.js -- the RP2350 address map as one Hazard3 hart sees it (P1-M2; research repository design §3, R-RP-01 §3.2-3.3):
//   0x00000000 ROM (32 KiB; the module's own ROM, boot/rom.js; writes are ignored, RP-001 §4.1)
//   0x10000000 XIP flash (the image; mirrors at 0x14/0x18/0x1c000000 read the same bytes; writes are ignored)
//   0x20000000 SRAM (520 KiB)
//   0x40000000 APB peripherals (32 KiB per block), 0x50000000 AHB peripherals (64 KiB pages), 0xd0000000 SIO (non-secure
//              mirror at 0xd0020000)
// Everything else, and the Cortex-M33 PPB at 0xe0000000, is a bus fault (RP-001 §2.2, §2.2.7). SRAM and flash are tested first:
// the hart's fetches, loads and stores take no other path for them.
// Peripheral blocks: +0x1000 XOR, +0x2000 SET, +0x3000 CLR aliases on write (RP-001 §2.1.3; reads ignore the alias). An 8- or
// 16-bit write is replicated across the 32-bit bus, or put in its own byte lanes with the others zero at +0x4000 (RP-001 §2.1.5).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const ROM_SIZE = 0x8000;
export const XIP_BASE = 0x10000000;
export const SRAM_BASE = 0x20000000;
export const SRAM_SIZE = 0x82000;
export const SIO_BASE = 0xd0000000;

export class Bus {
  /** @param {object} m the machine (devices call back into it) @param {{flashSize?: number}} [opts] */
  constructor(m, { flashSize = 4 << 20 } = {}) {
    this.m = m;
    const s = new ArrayBuffer(SRAM_SIZE);
    this.bytes = new Uint8Array(s); this.h16 = new Uint16Array(s); this.w32 = new Int32Array(s);
    const f = new ArrayBuffer(flashSize);
    this.flashSize = flashSize;
    this.fbytes = new Uint8Array(f); this.fh16 = new Uint16Array(f); this.fw32 = new Int32Array(f);
    const r = new ArrayBuffer(ROM_SIZE);
    this.rbytes = new Uint8Array(r); this.rh16 = new Uint16Array(r); this.rw32 = new Int32Array(r);
    this.apb = new Array(64).fill(null);    // (address - 0x40000000) >>> 15
    this.ahb = new Map();                   // address >>> 16
    this.sio = null;
    this.fault = false;
  }

  mapApb(base, dev) { this.apb[(base - 0x40000000) >>> 15] = dev; }
  mapAhb(base, dev) { this.ahb.set(base >>> 16, dev); }

  // ---- the hart's accesses (addresses are unsigned 32-bit numbers) ----
  read32(a) {
    let o = a - SRAM_BASE; if (o >= 0 && o < SRAM_SIZE) return this.w32[o >>> 2];
    o = a - XIP_BASE; if (o >= 0 && o < this.flashSize) return this.fw32[o >>> 2];
    return this.slowRead(a, 4);
  }
  read16(a) {
    let o = a - SRAM_BASE; if (o >= 0 && o < SRAM_SIZE) return this.h16[o >>> 1];
    o = a - XIP_BASE; if (o >= 0 && o < this.flashSize) return this.fh16[o >>> 1];
    return this.slowRead(a, 2);
  }
  read8(a) {
    let o = a - SRAM_BASE; if (o >= 0 && o < SRAM_SIZE) return this.bytes[o];
    o = a - XIP_BASE; if (o >= 0 && o < this.flashSize) return this.fbytes[o];
    return this.slowRead(a, 1);
  }
  write32(a, v) { const o = a - SRAM_BASE; if (o >= 0 && o < SRAM_SIZE) this.w32[o >>> 2] = v; else this.slowWrite(a, v, 4); }
  write16(a, v) { const o = a - SRAM_BASE; if (o >= 0 && o < SRAM_SIZE) this.h16[o >>> 1] = v; else this.slowWrite(a, v & 0xffff, 2); }
  write8(a, v) { const o = a - SRAM_BASE; if (o >= 0 && o < SRAM_SIZE) this.bytes[o] = v; else this.slowWrite(a, v & 0xff, 1); }

  /** Memory value without side effects (history, memory view); undefined for a device register. */
  peek(a, size) {
    a >>>= 0;
    let o = a - SRAM_BASE;
    if (o >= 0 && o + size <= SRAM_SIZE) return size === 4 ? this.w32[o >>> 2] : size === 2 ? this.h16[o >>> 1] : this.bytes[o];
    o = this.flashOffset(a);
    if (o >= 0 && o + size <= this.flashSize) return size === 4 ? this.fw32[o >>> 2] : size === 2 ? this.fh16[o >>> 1] : this.fbytes[o];
    if (a + size <= ROM_SIZE) return size === 4 ? this.rw32[a >>> 2] : size === 2 ? this.rh16[a >>> 1] : this.rbytes[a];
    return undefined;
  }
  /** Undo a store (history): SRAM only; other memory is not written by a store that the history can undo. */
  restore(a, size, v) {
    const o = (a >>> 0) - SRAM_BASE;
    if (o >= 0 && o + size <= SRAM_SIZE) { if (size === 4) this.w32[o >>> 2] = v; else if (size === 2) this.h16[o >>> 1] = v; else this.bytes[o] = v; }
  }
  /** One byte for the memory view: memory, else 0 (device registers are not read by the view). */
  viewByte(a) { const v = this.peek(a >>> 0, 1); return v === undefined ? 0 : v & 0xff; }

  flashOffset(a) { return a >= XIP_BASE && a < 0x20000000 ? (a & 0x03ffffff) : -1; }

  // ---- everything that is not SRAM or flash at 0x10000000 ----
  slowRead(a, size) {
    if (a < ROM_SIZE) return size === 4 ? this.rw32[a >>> 2] : size === 2 ? this.rh16[a >>> 1] : this.rbytes[a];
    const fo = this.flashOffset(a);
    if (fo >= 0) {
      if (fo + size <= this.flashSize) return size === 4 ? this.fw32[fo >>> 2] : size === 2 ? this.fh16[fo >>> 1] : this.fbytes[fo];
      this.fault = true; return 0;
    }
    const dev = this.decode(a);
    if (!dev) { this.fault = true; return 0; }
    this.m.touched = true;
    const v = dev.read(this.dOff & ~3, a);
    const sh = (a & 3) * 8;
    return size === 4 ? v | 0 : size === 2 ? (v >>> sh) & 0xffff : (v >>> sh) & 0xff;
  }

  slowWrite(a, v, size) {
    if (a < ROM_SIZE) return;                      // mask ROM: writes are ignored without a fault (RP-001 §4.1)
    if (this.flashOffset(a) >= 0) { this.m.diag('xipWrite', a); return; }
    const dev = this.decode(a);
    if (!dev) { this.fault = true; return; }
    this.m.touched = true;
    let w;
    if (size === 4) w = v >>> 0;
    else if (this.dLanes) w = (v << ((a & 3) * 8)) >>> 0;           // +0x4000: the other byte lanes are zero
    else w = size === 2 ? ((v & 0xffff) * 0x10001) >>> 0 : ((v & 0xff) * 0x1010101) >>> 0; // replicated across the bus
    dev.write(this.dOff & ~3, w, this.dAlias, a, size, v);
  }

  /** The device at a peripheral address, or null (bus fault); sets dOff, dAlias, dLanes (no object per access). */
  decode(a) {
    const top = a >>> 28;
    let dev = null;
    this.dOff = a & 0x0fff; this.dAlias = (a >>> 12) & 3; this.dLanes = (a & 0x4000) !== 0;
    if (top === 4) { const i = (a - 0x40000000) >>> 15; dev = i < 64 ? this.apb[i] : null; }
    else if (top === 5) dev = this.ahb.get(a >>> 16) ?? null;
    else if (top === 0xd && ((a & 0xfffc0000) >>> 0) === 0xd0000000 && (a & 0x1f000) === 0) {
      dev = this.sio; this.dAlias = 0; this.dLanes = false; // secure bank and non-secure mirror; no generic aliases (RP-001 §2.1.3)
    }
    if (dev && dev.ahbRaw) { this.dOff = a & 0xffff; this.dAlias = 0; this.dLanes = false; }
    return dev;
  }
}
