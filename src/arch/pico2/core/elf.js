// elf.js -- reader for the 32-bit little-endian RISC-V ELF executables the pico2 module loads (P1-M1): the program headers
// (PT_LOAD segments), the entry point and the symbol table. Checks every offset against the file size; it reads nothing
// it was not asked to and executes nothing.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const EM_RISCV = 243;
const PT_LOAD = 1;
const SHT_SYMTAB = 2;

export class ElfError extends Error {}

/**
 * @param {Uint8Array} bytes
 * @returns {{entry: number, flags: number, segments: {vaddr: number, paddr: number, memsz: number, flags: number, data: Uint8Array}[],
 *            symbols: Map<string, number>}}
 */
export function parseElf(bytes) {
  const fail = (m) => { throw new ElfError(m); };
  if (bytes.length < 52) fail('not an ELF file: shorter than the header');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, false) !== 0x7f454c46) fail('not an ELF file: wrong magic');
  if (bytes[4] !== 1) fail('not a 32-bit ELF file');
  if (bytes[5] !== 1) fail('not a little-endian ELF file');
  if (dv.getUint16(16, true) !== 2) fail('not an executable (e_type must be ET_EXEC)');
  if (dv.getUint16(18, true) !== EM_RISCV) fail(`not a RISC-V ELF file (e_machine ${dv.getUint16(18, true)})`);
  const entry = dv.getUint32(24, true), phoff = dv.getUint32(28, true), shoff = dv.getUint32(32, true), flags = dv.getUint32(36, true);
  const phentsize = dv.getUint16(42, true), phnum = dv.getUint16(44, true), shentsize = dv.getUint16(46, true), shnum = dv.getUint16(48, true);
  const range = (off, len, what) => { if (off + len > bytes.length) fail(`${what} lies outside the file`); };

  const segments = [];
  if (phnum && phentsize < 32) fail('program header entries are too small');
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phentsize;
    range(p, 32, 'a program header');
    if (dv.getUint32(p, true) !== PT_LOAD) continue;
    const off = dv.getUint32(p + 4, true), vaddr = dv.getUint32(p + 8, true), paddr = dv.getUint32(p + 12, true);
    const filesz = dv.getUint32(p + 16, true), memsz = dv.getUint32(p + 20, true), pf = dv.getUint32(p + 24, true);
    if (filesz > memsz) fail(`segment ${i}: p_filesz exceeds p_memsz`);
    range(off, filesz, `segment ${i}`);
    segments.push({ vaddr, paddr, memsz, flags: pf, data: bytes.subarray(off, off + filesz) });
  }

  const symbols = new Map();
  if (shoff && shnum) {
    if (shentsize < 40) fail('section header entries are too small');
    for (let i = 0; i < shnum; i++) {
      const s = shoff + i * shentsize;
      range(s, 40, 'a section header');
      if (dv.getUint32(s + 4, true) !== SHT_SYMTAB) continue;
      const off = dv.getUint32(s + 16, true), size = dv.getUint32(s + 20, true), link = dv.getUint32(s + 24, true), ent = dv.getUint32(s + 36, true);
      if (ent < 16 || link >= shnum) fail('malformed symbol table');
      const str = shoff + link * shentsize;
      range(str, 40, 'a section header');
      const stroff = dv.getUint32(str + 16, true), strsize = dv.getUint32(str + 20, true);
      range(off, size, 'the symbol table'); range(stroff, strsize, 'the string table');
      for (let q = off; q + ent <= off + size; q += ent) {
        const name = dv.getUint32(q, true);
        if (!name || name >= strsize) continue;
        let e = stroff + name; while (e < stroff + strsize && bytes[e] !== 0) e++;
        symbols.set(new TextDecoder().decode(bytes.subarray(stroff + name, e)), dv.getUint32(q + 4, true));
      }
    }
  }
  return { entry, flags, segments, symbols };
}

/**
 * Copy the loadable segments into a target through `write(address, bytes)` (the zero-filled tail of a segment, p_memsz beyond
 * p_filesz, is written as zeros). Loads at the physical address (what a boot loader does). Returns the entry point.
 * `maxSegment` bounds p_memsz (default 64 MiB, the RP2350's XIP window) so that a malformed file cannot ask for a huge
 * allocation; the target still checks that each segment fits its memory map.
 */
export function loadElf(elf, write, { maxSegment = 0x04000000 } = {}) {
  for (const s of elf.segments) {
    if (s.memsz > maxSegment) throw new ElfError(`segment at 0x${(s.paddr >>> 0).toString(16)}: p_memsz ${s.memsz} exceeds the limit of ${maxSegment} bytes`);
  }
  for (const s of elf.segments) {
    if (s.memsz === 0) continue;
    const img = new Uint8Array(s.memsz); img.set(s.data);
    write(s.paddr >>> 0, img);
  }
  return elf.entry;
}
