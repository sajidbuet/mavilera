// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const ROM_SIZE = 0x8000;
export const XIP_BASE = 0x10000000;
export const SRAM_BASE = 0x20000000;
export const SRAM_SIZE = 0x82000;
export const SIO_BASE = 0xd0000000;
export class Bus {
 constructor(m, { flashSize = 4 << 20 } = {}) {
 this.m = m;
 const s = new ArrayBuffer(SRAM_SIZE);
 this.bytes = new Uint8Array(s); this.h16 = new Uint16Array(s); this.w32 = new Int32Array(s);
 const f = new ArrayBuffer(flashSize);
 this.flashSize = flashSize;
 this.fbytes = new Uint8Array(f); this.fh16 = new Uint16Array(f); this.fw32 = new Int32Array(f);
 const r = new ArrayBuffer(ROM_SIZE);
 this.rbytes = new Uint8Array(r); this.rh16 = new Uint16Array(r); this.rw32 = new Int32Array(r);
 this.apb = new Array(64).fill(null);
 this.ahb = new Map();
 this.sio = null;
 this.fault = false;
 }
 mapApb(base, dev) { this.apb[(base - 0x40000000) >>> 15] = dev; }
 mapAhb(base, dev) { this.ahb.set(base >>> 16, dev); }
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
 peek(a, size) {
 a >>>= 0;
 let o = a - SRAM_BASE;
 if (o >= 0 && o + size <= SRAM_SIZE) return size === 4 ? this.w32[o >>> 2] : size === 2 ? this.h16[o >>> 1] : this.bytes[o];
 o = this.flashOffset(a);
 if (o >= 0 && o + size <= this.flashSize) return size === 4 ? this.fw32[o >>> 2] : size === 2 ? this.fh16[o >>> 1] : this.fbytes[o];
 if (a + size <= ROM_SIZE) return size === 4 ? this.rw32[a >>> 2] : size === 2 ? this.rh16[a >>> 1] : this.rbytes[a];
 return undefined;
 }
 restore(a, size, v) {
 const o = (a >>> 0) - SRAM_BASE;
 if (o >= 0 && o + size <= SRAM_SIZE) { if (size === 4) this.w32[o >>> 2] = v; else if (size === 2) this.h16[o >>> 1] = v; else this.bytes[o] = v; }
 }
 viewByte(a) { const v = this.peek(a >>> 0, 1); return v === undefined ? 0 : v & 0xff; }
 flashOffset(a) { return a >= XIP_BASE && a < 0x20000000 ? (a & 0x03ffffff) : -1; }
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
 if (a < ROM_SIZE) return;
 if (this.flashOffset(a) >= 0) { this.m.diag('xipWrite', a); return; }
 const dev = this.decode(a);
 if (!dev) { this.fault = true; return; }
 this.m.touched = true;
 let w;
 if (size === 4) w = v >>> 0;
 else if (this.dLanes) w = (v << ((a & 3) * 8)) >>> 0;
 else w = size === 2 ? ((v & 0xffff) * 0x10001) >>> 0 : ((v & 0xff) * 0x1010101) >>> 0;
 dev.write(this.dOff & ~3, w, this.dAlias, a, size, v);
 }
 decode(a) {
 const top = a >>> 28;
 let dev = null;
 this.dOff = a & 0x0fff; this.dAlias = (a >>> 12) & 3; this.dLanes = (a & 0x4000) !== 0;
 if (top === 4) { const i = (a - 0x40000000) >>> 15; dev = i < 64 ? this.apb[i] : null; }
 else if (top === 5) dev = this.ahb.get(a >>> 16) ?? null;
 else if (top === 0xd && ((a & 0xfffc0000) >>> 0) === 0xd0000000 && (a & 0x1f000) === 0) {
 dev = this.sio; this.dAlias = 0; this.dLanes = false;
 }
 if (dev && dev.ahbRaw) { this.dOff = a & 0xffff; this.dAlias = 0; this.dLanes = false; }
 return dev;
 }
}
