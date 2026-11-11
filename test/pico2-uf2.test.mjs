// pico2-uf2.test.mjs -- the UF2 writer (src/arch/pico2/firmware/uf2.js; pico2 P1-F2, research D33): byte for byte the file
// picotool made for every pico-examples program built for the RP2350's RISC-V cores (PICO2_FIRMWARE_DIR, default
// %LOCALAPPDATA%\pico2sim-build\pico-examples-rv; skipped without it); its output passes the strict validator and gives the
// same pages as the ELF; a file that is not a RISC-V program is refused.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { elfToUf2 } from '../src/arch/pico2/firmware/uf2.js';
import { validateFirmware } from '../src/arch/pico2/firmware/validate.js';

const FW = process.env.PICO2_FIRMWARE_DIR ?? join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'pico-examples-rv');
function pairs(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'CMakeFiles' && n !== '_deps') pairs(p, out); }
    else if (n.endsWith('.uf2') && existsSync(p.replace(/\.uf2$/, '.elf'))) out.push([p.replace(/\.uf2$/, '.elf'), p]);
  }
  return out;
}
const PAIRS = existsSync(FW) ? pairs(FW) : [];
const SKIP = PAIRS.length ? false : `needs the pico-examples RISC-V build with picotool's UF2 files (${FW})`;

test('every picotool UF2 of the pico-examples build is reproduced byte for byte from its ELF (those the validator accepts)', { skip: SKIP }, (t) => {
  const differ = [], refused = [];
  for (const [elf, uf2] of PAIRS) {
    const bytes = new Uint8Array(readFileSync(elf));
    if (!validateFirmware(bytes).ok) { refused.push(elf.slice(FW.length + 1)); continue; } // e.g. a partition table (P1-C1)
    if (Buffer.compare(Buffer.from(elfToUf2(bytes)), readFileSync(uf2)) !== 0) differ.push(uf2.slice(FW.length + 1));
  }
  t.diagnostic(`${PAIRS.length - refused.length} reproduced, ${refused.length} refused by the validator: ${refused.join(', ')}`);
  assert.deepEqual(differ, [], `${differ.length} of ${PAIRS.length} differ`);
  assert.ok(PAIRS.length - refused.length >= 100, `${PAIRS.length - refused.length} programs`);
});

test('the UF2 passes the strict validator with the E10 block noted, and holds the ELF\'s pages', { skip: SKIP }, () => {
  const elf = new Uint8Array(readFileSync(PAIRS[0][0]));
  const fromElf = validateFirmware(elf).artifact;
  const v = validateFirmware(elfToUf2(elf));
  assert.ok(v.ok);
  assert.ok(v.notes.some((n) => n.code === 'e10Skipped'));
  assert.deepEqual(v.artifact.pages.map((p) => p.address), fromElf.pages.map((p) => p.address));
  assert.ok(validateFirmware(elfToUf2(elf, { e10: false })).ok);
});

test('bytes that are not a RISC-V program for the RP2350 are refused with the validator\'s message', () => {
  assert.throws(() => elfToUf2(new Uint8Array(512)), Error);
  assert.throws(() => elfToUf2(new TextEncoder().encode('\x7fELF not really')), Error);
});
