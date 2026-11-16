// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PMP_REGIONS = 11;
export const PMP_GRAIN = 3;
const HARDWIRED = 0x700;
const HARDWIRED_ADDR = [0, 0, 0, 0, 0, 0, 0, 0, 0x01ffffff, 0x13ffffff, 0x35ffffff];
const HARDWIRED_CFG = 0x1f;
const A_OFF = 0, A_NAPOT = 3;
const LOW = ~(~0 << (PMP_GRAIN - 1)) >>> 0;
export class Pmp {
 constructor(opts = {}) { this.opts = opts; this.reset(); }
 reset() {
 this.ver = (this.ver ?? 0) + 1;
 this.l = new Uint8Array(PMP_REGIONS); this.a = new Uint8Array(PMP_REGIONS);
 this.r = new Uint8Array(PMP_REGIONS); this.w = new Uint8Array(PMP_REGIONS); this.x = new Uint8Array(PMP_REGIONS);
 this.addr = new Int32Array(PMP_REGIONS);
 this.m = 0;
 this.mask = new Int32Array(PMP_REGIONS); this.base = new Int32Array(PMP_REGIONS);
 for (let i = 0; i < PMP_REGIONS; i++) {
 if (HARDWIRED >>> i & 1) { this.a[i] = A_NAPOT; this.r[i] = this.w[i] = this.x[i] = 1; this.addr[i] = HARDWIRED_ADDR[i]; } else this.addr[i] = LOW;
 this.decode(i);
 }
 this._free();
 }
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
 decode(i) {
 let mask = 0;
 const pa = this.addr[i] >>> 0;
 for (let j = 3; j < 32; j++) if ((mask >>> (j - 1)) & 1 || !((pa >>> (j - 3)) & 1)) mask |= 1 << j;
 this.mask[i] = mask; this.base[i] = (pa << 2) & mask;
 }
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
 if (this.opts.specReadback && !(HARDWIRED >>> i & 1)) return (this.a[i] === A_OFF ? this.addr[i] & ~((1 << PMP_GRAIN) - 1) : this.addr[i] | LOW) | 0;
 if (!(HARDWIRED >>> i & 1) && this.a[i] !== A_OFF) return (this.addr[i] & ~LOW) | 0;
 return this.addr[i];
 }
 return this.m;
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
 this.a[i] = aa === A_NAPOT ? A_NAPOT : A_OFF;
 if (this.opts.clearWriteOnly && !this.r[i] && this.w[i]) this.w[i] = this.x[i] = 0;
 }
 } else if (a >= 0x3b0 && a <= 0x3bf) {
 const i = a - 0x3b0;
 if (i < PMP_REGIONS && !this.l[i] && !(HARDWIRED >>> i & 1)) { this.addr[i] = (v | LOW) | 0; this.decode(i); }
 } else this.m = v & ((1 << PMP_REGIONS) - 1) & ~HARDWIRED;
 this._free();
 }
 deniesData(addr, write, mmode) {
 for (let i = 0; i < PMP_REGIONS; i++) {
 if (this.a[i] && ((addr & this.mask[i]) === this.base[i])) {
 const checked = !mmode || this.l[i] === 1 || (this.m >>> i & 1) === 1;
 return checked && !(write ? this.w[i] : this.r[i]);
 }
 }
 return !mmode;
 }
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
