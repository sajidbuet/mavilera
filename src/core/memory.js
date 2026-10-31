// memory.js -- sparse byte-addressed little-endian memory; unwritten bytes
// read as zero (spec §5.2; as rvsim.Memory). Pages of 4 KiB are created on
// first write. Accesses that stay inside one page (every aligned access) take
// a fast path with one page lookup. WordMemory is the memory of the chapter
// profiles (spec §6): a fixed number of 32-bit words, the word selected by
// the address bits above bit 1, so that addresses wrap as in the RTL.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const PAGE_BITS = 12;
const PAGE = 1 << PAGE_BITS;
const MASK = PAGE - 1;
const ZERO = new Uint8Array(PAGE);

export class Memory {
  constructor() {
    this.pages = new Map();
    this.lastN = -1; // one-entry page cache
    this.lastP = null;
  }

  page(addr, create) {
    const n = addr >>> PAGE_BITS;
    if (n === this.lastN) return this.lastP;
    let p = this.pages.get(n);
    if (!p) {
      if (!create) return null;
      p = new Uint8Array(PAGE);
      this.pages.set(n, p);
    }
    this.lastN = n;
    this.lastP = p;
    return p;
  }

  readByte(addr) {
    const a = addr >>> 0;
    const p = this.page(a, false);
    return p ? p[a & MASK] : 0;
  }

  writeByte(addr, value) {
    const a = addr >>> 0;
    this.page(a, true)[a & MASK] = value & 0xff;
  }

  loadBytes(addr, bytes) {
    for (let i = 0; i < bytes.length; i++) this.writeByte((addr + i) >>> 0, bytes[i]);
  }

  /** Unsigned little-endian value of `size` bytes (1, 2 or 4). */
  read(addr, size) {
    const a = addr >>> 0;
    const o = a & MASK;
    if (o + size <= PAGE) {
      const p = this.page(a, false) ?? ZERO;
      if (size === 4) return (p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24)) >>> 0;
      if (size === 2) return p[o] | (p[o + 1] << 8);
      return p[o];
    }
    let v = 0;
    for (let i = size - 1; i >= 0; i--) v = (v << 8) | this.readByte((a + i) >>> 0);
    return v >>> 0;
  }

  /** Write `size` bytes little-endian; returns the previous value (for back-stepping). */
  write(addr, size, value) {
    const old = this.read(addr, size);
    const a = addr >>> 0;
    const o = a & MASK;
    if (o + size <= PAGE) {
      const p = this.page(a, true);
      p[o] = value;
      if (size > 1) p[o + 1] = value >>> 8;
      if (size > 2) { p[o + 2] = value >>> 16; p[o + 3] = value >>> 24; }
      return old;
    }
    for (let i = 0; i < size; i++) this.writeByte((a + i) >>> 0, value >>> (8 * i));
    return old;
  }

  /** Undo of a store (back-step); a MemPort distinguishes it from a store, which may reach a device. */
  restore(addr, size, old) { this.write(addr, size, old); }

  /** Copy of all pages (for a snapshot sent to or from the Worker). */
  copyPages() {
    const out = new Map();
    for (const [n, p] of this.pages) out.set(n, p.slice());
    return out;
  }

  setPages(pages) {
    this.pages = pages;
    this.lastN = -1;
    this.lastP = null;
  }
}

/**
 * Word-organised memory of the book's processors: `words` 32-bit words (a
 * power of two); byte address bits [log2(words)+1:2] select the word
 * (`imem`, `dmem`, `umem` of Chapters 6-8). Byte and half-word reads take
 * their lanes from the word (the `lbu` extension of Chapter 6).
 */
export class WordMemory {
  constructor(words = 256) {
    this.words = new Uint32Array(words);
    this.mask = words - 1;
  }

  index(addr) {
    return (addr >>> 2) & this.mask;
  }

  readByte(addr) {
    return (this.words[this.index(addr)] >>> (8 * (addr & 3))) & 0xff;
  }

  writeByte(addr, value) {
    const i = this.index(addr);
    const sh = 8 * (addr & 3);
    this.words[i] = ((this.words[i] & ~(0xff << sh)) | ((value & 0xff) << sh)) >>> 0;
  }

  loadBytes(addr, bytes) {
    for (let i = 0; i < bytes.length; i++) this.writeByte((addr + i) >>> 0, bytes[i]);
  }

  read(addr, size) {
    if (size === 4) return this.words[this.index(addr)];
    if (size === 2) return this.readByte(addr) | (this.readByte(addr + 1) << 8);
    return this.readByte(addr);
  }

  write(addr, size, value) {
    const old = this.read(addr, size);
    if (size === 4) this.words[this.index(addr)] = value >>> 0;
    else for (let i = 0; i < size; i++) this.writeByte(addr + i, value >>> (8 * i));
    return old;
  }

  restore(addr, size, old) { this.write(addr, size, old); }

  copyPages() {
    return this.words.slice();
  }

  setPages(words) {
    this.words = words;
  }
}
