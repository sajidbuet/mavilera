// The pico2 ELF loader (P1-M1): a small executable built with the RISC-V toolchain (test/fixtures/pico2-sum.elf, from an
// assembly source of ten lines that sums 10 to 1 into `result`), loaded and run on the hart; and the rejections.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseElf, loadElf, ElfError } from '../src/arch/pico2/core/elf.js';
import { Hart, FlatMemory, CAUSE } from '../src/arch/pico2/core/hart.js';

const bytes = new Uint8Array(readFileSync(new URL('./fixtures/pico2-sum.elf', import.meta.url)));

test('parse: entry, loadable segments and symbols', () => {
  const e = parseElf(bytes);
  assert.equal(e.entry, 0x100);
  assert.equal(e.symbols.get('_start'), 0x100);
  assert.equal(e.symbols.get('result'), 0x200);
  assert.ok(e.symbols.has('zeros'));
  assert.ok(e.segments.length >= 1);
  assert.ok(e.segments.every((s) => s.data.length <= s.memsz));
});

test('load and run: the program leaves 55 in `result` and stops at ebreak', () => {
  const e = parseElf(bytes);
  const mem = new FlatMemory(0x1000);
  mem.bytes.fill(0xaa);
  const entry = loadElf(e, (a, d) => mem.load(a, d));
  const h = new Hart(mem, { resetPc: entry });
  for (let i = 0; i < 200 && h.mcause !== CAUSE.BREAKPOINT; i++) h.step();
  assert.equal(h.mcause, CAUSE.BREAKPOINT);
  assert.equal(mem.read32(e.symbols.get('result')), 55);
  const z = e.symbols.get('zeros');
  assert.deepEqual([...mem.bytes.subarray(z, z + 16)], new Array(16).fill(0), 'the .bss tail (memsz beyond filesz) is zeroed');
});

test('rejections: magic, class, byte order, machine, type, truncation, offsets outside the file', () => {
  const bad = (f, re) => { const b = bytes.slice(); f(b); assert.throws(() => parseElf(b), (err) => err instanceof ElfError && re.test(err.message)); };
  assert.throws(() => parseElf(new Uint8Array(10)), ElfError);
  bad((b) => { b[0] = 0; }, /magic/);
  bad((b) => { b[4] = 2; }, /32-bit/);
  bad((b) => { b[5] = 2; }, /little-endian/);
  bad((b) => { b[18] = 40; }, /RISC-V/);
  bad((b) => { b[16] = 1; }, /executable/);
  bad((b) => { new DataView(b.buffer).setUint32(28, 0xfffffff0, true); }, /outside the file/);
  assert.throws(() => parseElf(bytes.subarray(0, 100)), ElfError);
  // p_filesz beyond p_memsz
  const dv = new DataView(bytes.buffer);
  const firstLoad = Array.from({ length: dv.getUint16(44, true) }, (_, i) => dv.getUint32(28, true) + 32 * i).find((p) => dv.getUint32(p, true) === 1);
  bad((b) => { new DataView(b.buffer).setUint32(firstLoad + 16, 0x7fffffff, true); }, /p_filesz/);
});

test('load: a segment whose p_memsz exceeds the limit is refused before anything is allocated or written', () => {
  const b = bytes.slice();
  const dv = new DataView(b.buffer);
  const firstLoad = Array.from({ length: dv.getUint16(44, true) }, (_, i) => dv.getUint32(28, true) + 32 * i).find((p) => dv.getUint32(p, true) === 1);
  dv.setUint32(firstLoad + 20, 0xffffffff, true); // p_memsz 4 GiB
  const e = parseElf(b);
  let writes = 0;
  assert.throws(() => loadElf(e, () => { writes++; }), (err) => err instanceof ElfError && /exceeds the limit/.test(err.message));
  assert.equal(writes, 0);
  assert.throws(() => loadElf(parseElf(bytes), () => {}, { maxSegment: 4 }), ElfError);
});
