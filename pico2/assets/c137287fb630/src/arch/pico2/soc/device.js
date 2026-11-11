// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { RegFile } from './regfile.js';
export class Device {
 constructor(m, name, { regs = name, resetBit = -1 } = {}) {
 this.m = m; this.name = name; this.resetBit = resetBit;
 this.r = regs ? new RegFile(regs) : null;
 this.next = Infinity;
 this.heldFlag = false;
 }
 get now() { const m = this.m; return m.cur >= 0 ? m.cur : m.hart.ticks; }
 held() { return this.heldFlag; }
 read(off) {
 const i = this.r.at(off);
 if (i < 0) { this.m.diag('noRegister', this.name, off); return 0; }
 if (this.heldFlag) { this.m.diag('heldInReset', this.name); return this.r.resetV[i]; }
 return this.readReg(off);
 }
 write(off, value, alias, addr, size, raw) {
 if (this.held()) { this.m.diag('heldInReset', this.name); return; }
 const nv = this.r.write(off, value, alias);
 if (nv < 0) { this.m.diag('noRegister', this.name, off); return; }
 this.onWrite(off, nv, this.r.old, value, alias);
 }
 readReg(off) { return this.r.get(off); }
 onWrite(off, now, old, value, alias) {}
 event(now) { this.next = Infinity; }
 reset() { if (this.r) this.r.reset(); this.next = Infinity; }
 save() { return { r: this.r ? this.r.save() : null, next: this.next }; }
 load(s) { if (this.r) this.r.load(s.r); this.next = s.next; }
}
export class Storage extends Device {}
export class Unmodelled extends Device {
 constructor(m, name) { super(m, name, { regs: null }); this.store = new Map(); }
 read(off) { this.m.diag('notModelled', this.name); return this.store.get(off) ?? 0; }
 write(off, value) { this.m.diag('notModelled', this.name); this.store.set(off, value >>> 0); }
 reset() { this.store.clear(); this.next = Infinity; }
 save() { return { store: [...this.store], next: this.next }; }
 load(s) { this.store = new Map(s.store); this.next = s.next; }
}
export class Resets extends Device {
 constructor(m) {
 super(m, 'RESETS');
 this.oReset = this.r.off('RESET'); this.oDone = this.r.off('RESET_DONE');
 }
 isHeld(bit) { return ((this.r.get(this.oReset) >>> bit) & 1) === 1; }
 readReg(off) {
 if (off === this.oDone) return (~this.r.get(this.oReset) & 0x1fffffff) >>> 0;
 return this.r.get(off);
 }
 onWrite(off, now, old) {
 if (off !== this.oReset) return;
 const asserted = now & ~old;
 this.updateHeld();
 if (asserted) for (const d of this.m.resettable) if (d.resetBit >= 0 && ((asserted >>> d.resetBit) & 1)) d.reset();
 if (now !== old) this.m.resetsChanged(old, now);
 }
 updateHeld() { const v = this.r.get(this.oReset); for (const d of this.m.resettable ?? []) d.heldFlag = ((v >>> d.resetBit) & 1) === 1; }
 reset() { super.reset(); this.updateHeld(); }
 load(s) { super.load(s); this.updateHeld(); }
}
export class SysInfo extends Device {
 constructor(m) {
 super(m, 'SYSINFO', { resetBit: 21 });
 this.oChip = this.r.off('CHIP_ID'); this.oPlat = this.r.off('PLATFORM'); this.oPkg = this.r.off('PACKAGE_SEL');
 }
 readReg(off) {
 if (off === this.oChip) return ((4 << 28) | (this.r.resetV[this.r.index.get(off)] & 0x0fffffff)) >>> 0;
 if (off === this.oPlat) return 0x2;
 if (off === this.oPkg) return 0x1;
 return this.r.get(off);
 }
}
export class Watchdog extends Device {
 constructor(m) { super(m, 'WATCHDOG'); this.oCtrl = this.r.off('CTRL'); }
 onWrite(off, now) { if (off === this.oCtrl && (now & (1 << 30))) this.m.diag('watchdogEnabled'); }
}
export class BootRam extends Device {
 constructor(m) {
 super(m, 'BOOTRAM');
 this.ram = new Uint8Array(1024);
 this.oStat = this.r.off('BOOTLOCK_STAT'); this.oLock0 = this.r.off('BOOTLOCK0');
 this.locks = 0;
 }
 read(off, addr) {
 if (off < 0x400) { const o = off; return (this.ram[o] | (this.ram[o + 1] << 8) | (this.ram[o + 2] << 16) | (this.ram[o + 3] << 24)) >>> 0; }
 if (off === this.oStat) return this.locks;
 if (off >= this.oLock0 && off < this.oLock0 + 32) {
 const n = (off - this.oLock0) >>> 2;
 if (this.locks & (1 << n)) return 0;
 this.locks |= 1 << n; return 1 << n;
 }
 return super.read(off, addr);
 }
 write(off, value, alias, addr, size, raw) {
 if (off < 0x400) {
 const o = addr & 0x3ff;
 if (size === 4) { this.ram[o & ~3] = raw; this.ram[(o & ~3) + 1] = raw >>> 8; this.ram[(o & ~3) + 2] = raw >>> 16; this.ram[(o & ~3) + 3] = raw >>> 24; }
 else if (size === 2) { this.ram[o & ~1] = raw; this.ram[(o & ~1) + 1] = raw >>> 8; }
 else this.ram[o] = raw;
 return;
 }
 if (off >= this.oLock0 && off < this.oLock0 + 32) { this.locks &= ~(1 << ((off - this.oLock0) >>> 2)); return; }
 super.write(off, value, alias, addr, size, raw);
 }
 reset() { super.reset(); this.ram.fill(0); this.locks = 0; }
 save() { return { ...super.save(), ram: this.ram.slice(), locks: this.locks }; }
 load(s) { super.load(s); this.ram.set(s.ram); this.locks = s.locks; }
}
