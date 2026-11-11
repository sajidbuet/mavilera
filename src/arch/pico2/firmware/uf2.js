// uf2.js -- an ELF for the RP2350's RISC-V cores as a UF2 file (pico2 P1-F2, research D33; R-PICO-ED-01 §3.2.4: "picotool
// is not needed"), laid out as `picotool uf2 convert --family rp2350-riscv --abs-block` writes it (checked byte for byte
// against picotool's files: test/pico2-uf2.test.mjs):
//   block 0          flash images only: the RP2350-E10 workaround: family "absolute", address 0x10ffff00, 256 bytes of 0xef,
//                    numbered 0 of 2, with the extension "ignore" tag (RP2350 datasheet erratum E10; the bootrom skips it);
//                    a RAM image has none (as picotool: checked on flash_nuke)
//   blocks 1..n      the ELF's loadable pages in address order, family rp2350-riscv, numbered 0..n-1 of n
// UF2 format: Microsoft's UF2 specification (32-byte header, 476-byte data area, magic numbers); the writer is own code.
// The simulator's own code (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { validateFirmware, elfPages, FAMILY, PAGE } from './validate.js';

const MAGIC0 = 0x0a324655, MAGIC1 = 0x9e5d5157, MAGIC_END = 0x0ab16f30;
const FAMILY_PRESENT = 0x2000, EXTENSIONS = 0x8000;
const IGNORE_TAG = 0x9957e304; // extension: size 4, type 0x9957e3 ("ignore this block")
const E10_ADDRESS = 0x10ffff00;

function block(out, i, { flags, address, payload, blockNo, numBlocks, family, extension = null }) {
  const o = i * 512;
  const dv = new DataView(out.buffer, o, 512);
  dv.setUint32(0, MAGIC0, true); dv.setUint32(4, MAGIC1, true);
  dv.setUint32(8, flags, true); dv.setUint32(12, address, true); dv.setUint32(16, PAGE, true);
  dv.setUint32(20, blockNo, true); dv.setUint32(24, numBlocks, true); dv.setUint32(28, family, true);
  out.set(payload, o + 32);
  if (extension !== null) dv.setUint32(32 + PAGE, extension, true);
  dv.setUint32(508, MAGIC_END, true);
}

/**
 * The UF2 file of an ELF (Uint8Array). Throws an Error with the validator's message if the ELF is not a program for the
 * RP2350's RISC-V cores. `e10`: write the E10 workaround block first (default: for a flash image, as picotool --abs-block).
 */
export function elfToUf2(elf, { e10 = null } = {}) {
  const v = validateFirmware(elf);
  if (!v.ok) throw new Error(v.errors[0].message);
  if (v.source !== 'elf') throw new Error('not an ELF file');
  e10 ??= v.artifact.kind === 'flash';
  const pages = [...elfPages(elf)].sort((a, b) => a[0] - b[0]);
  const out = new Uint8Array((pages.length + (e10 ? 1 : 0)) * 512);
  let i = 0;
  if (e10) block(out, i++, { flags: FAMILY_PRESENT | EXTENSIONS, address: E10_ADDRESS, payload: new Uint8Array(PAGE).fill(0xef), blockNo: 0, numBlocks: 2, family: FAMILY.ABSOLUTE, extension: IGNORE_TAG });
  pages.forEach(([address, payload], n) => block(out, i++, { flags: FAMILY_PRESENT, address, payload, blockNo: n, numBlocks: pages.length, family: FAMILY.RP2350_RISCV }));
  return out;
}
