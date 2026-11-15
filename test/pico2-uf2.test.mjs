// pico2-uf2.test.mjs -- the UF2 writer (src/arch/pico2/firmware/uf2.js; pico2 P1-F2, research D33): byte for byte the file
// picotool made for every pico-examples program built for the RP2350's RISC-V cores (PICO2_FIRMWARE_DIR, default
// %LOCALAPPDATA%\pico2sim-build\pico-examples-rv; skipped without it); its output passes the strict validator and gives the
// same pages as the ELF; a file that is not a RISC-V program is refused.
//
// The byte-for-byte comparison of the 121 programs runs in a worker thread (this same file, loaded with workerData). Under
// `node --test` on Windows (Node 23.9.0) the test process sometimes never exited after all tests had passed when the comparison
// ran on the main thread: 7-9 runs in 100 hung (no CPU, main thread blocked in native code), 0 in 200 with V8's
// --single-threaded-gc, 0 without the firmware files, 0 when the file ran without the test runner, 0 in 150 with the comparison
// in a worker. Root cause not established (no native debugger on the host); inference: V8's concurrent garbage collector at the
// end of the run, after the comparison's ~240 file reads. Design note: docs/architecture/pico2-uf2-test-stall.md.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

import { elfToUf2 } from '../src/arch/pico2/firmware/uf2.js';
import { validateFirmware } from '../src/arch/pico2/firmware/validate.js';

const FW = process.env.PICO2_FIRMWARE_DIR ?? join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'pico-examples-rv');

/** The comparison: every ELF the validator accepts against picotool's UF2 of it. */
function compareAll(pairs, fw) {
  const differ = [], refused = [];
  for (const [elf, uf2] of pairs) {
    const bytes = new Uint8Array(readFileSync(elf));
    if (!validateFirmware(bytes).ok) { refused.push(elf.slice(fw.length + 1)); continue; } // e.g. a partition table (P1-C1)
    if (Buffer.compare(Buffer.from(elfToUf2(bytes)), readFileSync(uf2)) !== 0) differ.push(uf2.slice(fw.length + 1));
  }
  return { differ, refused };
}

if (!isMainThread && workerData?.pico2Uf2Compare) {
  parentPort.postMessage(compareAll(workerData.pairs, workerData.fw));
} else if (isMainThread) {
  const { test } = await import('node:test');
  const { default: assert } = await import('node:assert/strict');

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

  test('every picotool UF2 of the pico-examples build is reproduced byte for byte from its ELF (those the validator accepts)', { skip: SKIP }, async (t) => {
    const { differ, refused } = await new Promise((ok, fail) => {
      const w = new Worker(new URL(import.meta.url), { workerData: { pico2Uf2Compare: true, pairs: PAIRS, fw: FW } });
      w.once('message', ok);
      w.once('error', fail);
      w.once('exit', (code) => fail(new Error(`the comparison worker exited (${code}) without a result`)));
    });
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
}
