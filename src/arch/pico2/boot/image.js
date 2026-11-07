// image.js -- SDK images for the pico2 module's high-level boot (ADR-0008; P1-M2): UF2 files (512-byte blocks with magic numbers
// 0x0a324655, 0x9e5d5157 and 0x0ab16f30, 256-byte payloads; family rp2350-riscv 0xe48bff5a, absolute 0xe48bff57; RP-001 §5.5.2)
// and ELF files (core/elf.js), and the search for the IMAGE_DEF block and its ENTRY_POINT item: block markers 0xffffded3 ...
// 0xab123579 within the first 4 KiB of a flash image (anywhere in a RAM image); items are a type byte (bit 7: two-byte size) and a
// size in words; ENTRY_POINT (0x44) holds pc and sp; type 0xff ends the items (RP-001 §5.9.5; pico-sdk picobin.h,
// embedded_start_block.inc.S). The SDK's ELF entry (_entry_point) re-enters the bootrom by default, so the boot uses the
// ENTRY_POINT item (research design E7, E8). Reads only; executes nothing.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { parseElf } from '../core/elf.js';

export const UF2_FAMILY = Object.freeze({ RP2350_RISCV: 0xe48bff5a, ABSOLUTE: 0xe48bff57, RP2350_ARM_S: 0xe48bff59, RP2040: 0xe48bff56 });
export class ImageError extends Error {}

/** @returns {{family: number|null, chunks: {address: number, bytes: Uint8Array}[]}} */
export function parseUf2(bytes) {
  if (bytes.length < 512 || bytes.length % 512) throw new ImageError('not a UF2 file: the length is not a multiple of 512 bytes');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = []; let family = null;
  for (let o = 0; o < bytes.length; o += 512) {
    if (dv.getUint32(o, true) !== 0x0a324655 || dv.getUint32(o + 4, true) !== 0x9e5d5157 || dv.getUint32(o + 508, true) !== 0x0ab16f30) {
      throw new ImageError(`not a UF2 file: bad magic number in block ${o / 512}`);
    }
    const flags = dv.getUint32(o + 8, true), address = dv.getUint32(o + 12, true), size = dv.getUint32(o + 16, true);
    if (size > 476) throw new ImageError(`UF2 block ${o / 512}: payload of ${size} bytes`);
    if (flags & 0x1) continue;                               // not for the main flash
    const fam = flags & 0x2000 ? dv.getUint32(o + 28, true) : null;
    chunks.push({ address, bytes: bytes.slice(o + 32, o + 32 + size), family: fam });
  }
  // picotool adds a block of family "absolute" for erratum RP2350-E10 (A2 bootrom; RP-001 App. D.2.1): with blocks of the
  // rp2350-riscv family present, only those are the image
  const riscv = chunks.filter((c) => c.family === UF2_FAMILY.RP2350_RISCV);
  if (riscv.length) return { family: UF2_FAMILY.RP2350_RISCV, chunks: riscv };
  family = chunks.find((c) => c.family !== null)?.family ?? null;
  return { family, chunks };
}

/** Chunks of an ELF file, at their physical addresses (zero fill of p_memsz beyond p_filesz included). */
export function elfChunks(bytes) {
  const elf = parseElf(bytes);
  const chunks = elf.segments.filter((s) => s.memsz > 0).map((s) => { const b = new Uint8Array(s.memsz); b.set(s.data); return { address: s.paddr >>> 0, bytes: b }; });
  return { elf, chunks };
}

/**
 * The ENTRY_POINT of the first IMAGE_DEF-shaped block in `read(offset)` (a word reader) over `window` bytes, or null.
 * Returns {block, entry: {pc, sp} | null, items}.
 */
export function findImageDef(read, window) {
  for (let o = 0; o + 8 <= window; o += 4) {
    if (read(o) !== 0xffffded3) continue;
    let p = o + 4; const items = []; let entry = null;
    for (let guard = 0; guard < 64; guard++) {
      const w = read(p), type = w & 0xff;
      if (type === 0xff) break;
      const words = type & 0x80 ? (w >>> 8) & 0xffff : (w >>> 8) & 0xff;
      if (!words) break;
      items.push(type);
      if (type === 0x44) entry = { pc: read(p + 4) >>> 0, sp: read(p + 8) >>> 0 };
      p += words * 4;
    }
    return { block: o, entry, items };
  }
  return null;
}

/**
 * Read an image file (UF2 or ELF, decided by its first bytes) into {kind, family, chunks, entry, symbols}. `entry` comes from the
 * IMAGE_DEF ENTRY_POINT (flash at 0x10000000, or the lowest RAM address of a RAM image), else the lowest address of the image.
 */
export function readImage(bytes) {
  let kind, family = null, chunks, symbols = new Map();
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    const r = elfChunks(bytes); kind = 'elf'; chunks = r.chunks; symbols = r.elf.symbols;
  } else { const r = parseUf2(bytes); kind = 'uf2'; family = r.family; chunks = r.chunks; }
  if (!chunks.length) throw new ImageError('the image holds no data');
  if (family !== null && family !== UF2_FAMILY.RP2350_RISCV && family !== UF2_FAMILY.ABSOLUTE) throw new ImageError(`UF2 family 0x${family.toString(16)} is not rp2350-riscv`);
  const lowest = Math.min(...chunks.map((c) => c.address));
  const word = (a) => { for (const c of chunks) { const o = a - c.address; if (o >= 0 && o + 4 <= c.bytes.length) return (c.bytes[o] | (c.bytes[o + 1] << 8) | (c.bytes[o + 2] << 16) | (c.bytes[o + 3] << 24)) >>> 0; } return 0xffffffff; };
  const inFlash = lowest >= 0x10000000 && lowest < 0x20000000;
  const def = findImageDef((o) => word(lowest + o), inFlash ? 4096 : Math.max(...chunks.map((c) => c.address + c.bytes.length)) - lowest);
  return { kind, family, chunks, imageDef: def, entry: def?.entry ?? { pc: lowest, sp: 0x20082000 }, symbols, lowest };
}
