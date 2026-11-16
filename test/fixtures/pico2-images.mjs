// pico2-images.mjs -- small validated RP2350 RISC-V images for the board-programming tests (pico2 P1-F3): UF2 files built page by
// page with a block loop (IMAGE_TYPE EXE/RISC-V/RP2350, ENTRY_POINT), run through the module's own validator. Own code.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { validateFirmware, FAMILY } from '../../src/arch/pico2/firmware/validate.js';

const START = 0xffffded3, END = 0xab123579;
/** pages from {address: words[]} */
export function pagesOf(spec) {
  const pages = new Map();
  for (const [a0, words] of Object.entries(spec)) words.forEach((w, i) => {
    const a = Number(a0) + i * 4, pa = a - (a % 256);
    if (!pages.has(pa)) pages.set(pa, new Uint8Array(256));
    new DataView(pages.get(pa).buffer).setUint32(a - pa, w >>> 0, true);
  });
  return [...pages].sort((x, y) => x[0] - y[0]).map(([address, bytes]) => ({ address, bytes }));
}
export function uf2(pages, family = FAMILY.RP2350_RISCV) {
  const out = new Uint8Array(pages.length * 512), dv = new DataView(out.buffer);
  pages.forEach((p, i) => {
    const o = i * 512;
    dv.setUint32(o, 0x0a324655, true); dv.setUint32(o + 4, 0x9e5d5157, true); dv.setUint32(o + 508, 0x0ab16f30, true);
    dv.setUint32(o + 8, 0x2000, true); dv.setUint32(o + 12, p.address, true); dv.setUint32(o + 16, 256, true);
    dv.setUint32(o + 20, i, true); dv.setUint32(o + 24, pages.length, true); dv.setUint32(o + 28, family, true);
    out.set(p.bytes, o + 32);
  });
  return out;
}
const loop = (base) => [START, 0x11010142, 0x00000344, base + 0x100, 0x20082000, 0x000004ff, 0, END];
/** UF2 bytes of a flash image over three sectors; `salt` changes one word (another build). */
export function flashUf2(salt = 0) {
  return uf2(pagesOf({ 0x10000000: loop(0x10000000), 0x10000100: [0x00000013, 0x0000006f],
    0x10001000: Array.from({ length: 64 }, (_, i) => 0x11110000 + i), 0x10003f00: [0xdeadbeef, 0xcafef00d ^ salt] }));
}
export function ramUf2() { return uf2(pagesOf({ 0x20000000: loop(0x20000000), 0x20000100: [0x00000013, 0x0000006f], 0x20000400: [1, 2, 3] })); }
export function artifactOf(bytes) {
  const r = validateFirmware(bytes);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.artifact;
}
export const flashArtifact = (salt = 0) => artifactOf(flashUf2(salt));
export const ramArtifact = () => artifactOf(ramUf2());
/** A program as the shell holds one after a build or an import: the artifact in debug (firmware/import.js). */
export const programOf = (artifact) => ({ ok: true, segments: [], debug: { artifact } });
