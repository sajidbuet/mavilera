// device.js -- the base of the pico2 machine's peripheral models (P1-M2) and the simple system blocks: RESETS, SYSINFO,
// WATCHDOG (registers only), BOOTRAM (1 KiB RAM and the boot locks) and a stub for blocks that are not modelled.
// Interface used by the bus (bus.js): read(off, addr) -> u32 (side effects allowed), write(off, value, alias, addr, size, raw);
// scheduler interface (machine.js): `next` (the cycle of the device's next event, Infinity if none), event(now).
// A block held in reset by RESETS ignores writes and reads its reset values (RP-001 §7.5); the access is reported once.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { RegFile } from './regfile.js';

export class Device {
  /** @param {object} m machine @param {string} name block name (SVD) @param {{regs?: string|null, resetBit?: number}} [o] */
  constructor(m, name, { regs = name, resetBit = -1 } = {}) {
    this.m = m; this.name = name; this.resetBit = resetBit;
    this.r = regs ? new RegFile(regs) : null;
    this.next = Infinity;
    this.heldFlag = false; // P1-M5: RESETS keeps it (Resets.onWrite, Machine.powerOn), so that a read does not look it up
  }
  /** The present cycle: the hart's, or the cycle of the event being run (machine.js `cur`; P1-M5). */
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
  /** Register value as read (devices override for computed and read-only fields). */
  readReg(off) { return this.r.get(off); }
  /** After a write has been applied to the stored value: devices react here. */
  onWrite(off, now, old, value, alias) {}
  event(now) { this.next = Infinity; }
  /** Back to the reset state (also when RESETS asserts the block's reset). */
  reset() { if (this.r) this.r.reset(); this.next = Infinity; }
  save() { return { r: this.r ? this.r.save() : null, next: this.next }; }
  load(s) { if (this.r) this.r.load(s.r); this.next = s.next; }
}

/** A block with registers from the SVD table and no behaviour beyond storing them (QMI, XIP_CTRL, POWMAN, ...). */
export class Storage extends Device {}

/** A block of the address map with no model: reads 0, writes are kept, every first access is reported. */
export class Unmodelled extends Device {
  constructor(m, name) { super(m, name, { regs: null }); this.store = new Map(); }
  read(off) { this.m.diag('notModelled', this.name); return this.store.get(off) ?? 0; }
  write(off, value) { this.m.diag('notModelled', this.name); this.store.set(off, value >>> 0); }
  reset() { this.store.clear(); this.next = Infinity; }
  save() { return { store: [...this.store], next: this.next }; }
  load(s) { this.store = new Map(s.store); this.next = s.next; }
}

/** RESETS (RP-001 §7.5): RESET holds blocks in reset; RESET_DONE is the inverse at once (no reset sequencing time). */
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
  /** Each block's held-in-reset flag from RESET (after a write, a reset or a restored checkpoint). */
  updateHeld() { const v = this.r.get(this.oReset); for (const d of this.m.resettable ?? []) d.heldFlag = ((v >>> d.resetBit) & 1) === 1; }
  reset() { super.reset(); this.updateHeld(); }
  load(s) { super.load(s); this.updateHeld(); }
}

/** SYSINFO: CHIP_ID of an RP2350A stepping A4 (decision D13, Q6; REVISION field per RP-001 App. C), PLATFORM = ASIC. */
export class SysInfo extends Device {
  constructor(m) {
    super(m, 'SYSINFO', { resetBit: 21 });
    this.oChip = this.r.off('CHIP_ID'); this.oPlat = this.r.off('PLATFORM'); this.oPkg = this.r.off('PACKAGE_SEL');
  }
  readReg(off) {
    if (off === this.oChip) return ((4 << 28) | (this.r.resetV[this.r.index.get(off)] & 0x0fffffff)) >>> 0;
    if (off === this.oPlat) return 0x2;  // ASIC (SYSINFO_PLATFORM_ASIC_BITS); the SDK's running_on_fpga() reads bit 0
    if (off === this.oPkg) return 0x1;   // QFN-60 (RP2350A, the Pico 2's chip: RP-002 p.4)
    return this.r.get(off);
  }
}

/** WATCHDOG: the registers (scratch, reason, control) without the countdown; enabling it is reported. */
export class Watchdog extends Device {
  constructor(m) { super(m, 'WATCHDOG'); this.oCtrl = this.r.off('CTRL'); }
  onWrite(off, now) { if (off === this.oCtrl && (now & (1 << 30))) this.m.diag('watchdogEnabled'); }
}

/** BOOTRAM: 1 KiB of RAM at +0x000 (byte-addressable here) and the 8 boot locks (a read claims, a write releases). */
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
