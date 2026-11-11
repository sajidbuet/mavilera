// The strict firmware validator of the pico2 module (P1-C1, design §2 step 2, §6; checks 1-9 of the research study
// rp2350-uf2-validation.md §6, with check 8's VECTOR_TABLE rule corrected to a note after RP-001 §5.9.3.3): UF2 files built
// here block by block, every refusal and note, flash and RAM images, the block loop; and the SDK builds of the P1-M2 set when
// present (PICO2_FIRMWARE_DIR or %LOCALAPPDATA%\pico2sim-build\pico-examples-rv; skipped when absent): each UF2 and its ELF give
// the same pages and the entry the simulator boots.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateFirmware, buildId, FAMILY } from '../src/arch/pico2/firmware/validate.js';
import { readImage } from '../src/arch/pico2/boot/image.js';

const RISCV = FAMILY.RP2350_RISCV;
const START = 0xffffded3, END = 0xab123579;
const IMAGE_TYPE_RV = 0x11010142;              // IMAGE_TYPE item: EXE, RISC-V, RP2350
const entryItem = (pc, sp) => [0x00000344, pc, sp];
const last = (words, link = 0) => [0x000000ff | (words << 8), link, END];

/** A page list from words placed at addresses: {address: [words...]} -> pages of 256 bytes. */
function pagesOf(spec) {
  const pages = new Map();
  for (const [a0, words] of Object.entries(spec)) {
    words.forEach((w, i) => {
      const a = Number(a0) + i * 4, pa = a - (a % 256);
      if (!pages.has(pa)) pages.set(pa, new Uint8Array(256));
      new DataView(pages.get(pa).buffer).setUint32(a - pa, w >>> 0, true);
    });
  }
  return [...pages].sort((x, y) => x[0] - y[0]).map(([address, bytes]) => ({ address, bytes }));
}

/** A UF2 file from pages; `opt(block, i)` may change any field. */
function uf2(pages, opt = () => ({})) {
  const out = new Uint8Array(pages.length * 512);
  const dv = new DataView(out.buffer);
  pages.forEach((p, i) => {
    const f = { flags: 0x2000, address: p.address, size: 256, blockNo: i, count: pages.length, family: RISCV, bytes: p.bytes, magic: true, ...opt(p, i) };
    const o = i * 512;
    dv.setUint32(o, f.magic ? 0x0a324655 : 0, true); dv.setUint32(o + 4, 0x9e5d5157, true); dv.setUint32(o + 508, 0x0ab16f30, true);
    dv.setUint32(o + 8, f.flags, true); dv.setUint32(o + 12, f.address, true); dv.setUint32(o + 16, f.size, true);
    dv.setUint32(o + 20, f.blockNo, true); dv.setUint32(o + 24, f.count, true); dv.setUint32(o + 28, f.family, true);
    out.set(f.bytes.subarray(0, Math.min(476, f.bytes.length)), o + 32);
    if (f.tag !== undefined) dv.setUint32(o + 32 + 256, f.tag, true);
  });
  return out;
}

/** The E10 workaround block (study §4) as a UF2 block of its own. */
function e10Block({ fill = 0xef } = {}) {
  return uf2([{ address: 0x10ffff00, bytes: new Uint8Array(256).fill(fill) }], () => ({ flags: 0xa000, family: FAMILY.ABSOLUTE, count: 2, tag: 0x9957e304 }));
}
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };

const GOOD = { 0x10000000: [START, IMAGE_TYPE_RV, ...entryItem(0x10000100, 0x20082000), ...last(4)], 0x10000100: [0x00000013, 0x00100073] };
const codes = (r) => (r.ok ? 'ok' : r.errors.map((e) => e.code).join());

test('a minimal flash image: accepted, entry from ENTRY_POINT, touched sector completed with zero pages', () => {
  const r = validateFirmware(uf2(pagesOf(GOOD)));
  assert.equal(codes(r), 'ok');
  assert.equal(r.artifact.kind, 'flash');
  assert.deepEqual(r.artifact.entry, { pc: 0x10000100, sp: 0x20082000 });
  assert.equal(r.artifact.pages.length, 16);
  assert.equal(r.artifact.filled, 14);
  assert.deepEqual(r.notes.map((n) => n.code), ['filled']);
  assert.equal(r.artifact.blocks, 1);
});

test('check 1-2: length, magic, the E10 block skipped only when exact, NOT_MAIN_FLASH skipped', () => {
  assert.equal(codes(validateFirmware(new Uint8Array(100))), 'length');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), (p, i) => (i === 1 ? { magic: false } : {})))), 'magic');
  const withE10 = validateFirmware(cat(e10Block(), uf2(pagesOf(GOOD))));
  assert.equal(codes(withE10), 'ok');
  assert.ok(withE10.notes.some((n) => n.code === 'e10Skipped'));
  assert.equal(codes(validateFirmware(cat(e10Block({ fill: 0 }), uf2(pagesOf(GOOD))))), 'absoluteBlock');
  assert.equal(codes(validateFirmware(cat(e10Block(), e10Block(), uf2(pagesOf(GOOD))))), 'absoluteBlock', 'at most one');
  const notMain = uf2([{ address: 0x10100000, bytes: new Uint8Array(256) }], () => ({ flags: 0x2001, count: 9 }));
  const r = validateFirmware(cat(uf2(pagesOf(GOOD)), notMain));
  assert.equal(codes(r), 'ok');
  assert.ok(r.notes.some((n) => n.code === 'notMainSkipped'));
});

test('check 3: family named, payload, alignment, container and MD5 flags', () => {
  const rp2040 = validateFirmware(uf2(pagesOf(GOOD), () => ({ family: FAMILY.RP2040 })));
  assert.equal(codes(rp2040), 'family');
  assert.match(rp2040.errors[0].message, /RP2040/);
  assert.match(validateFirmware(uf2(pagesOf(GOOD), () => ({ family: FAMILY.RP2350_ARM_S }))).errors[0].message, /Arm/);
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), () => ({ flags: 0 })))), 'noFamily');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), () => ({ size: 476 })))), 'payload');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), (p, i) => (i === 1 ? { address: 0x10000180 } : {})))), 'align');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), () => ({ flags: 0x3000 })))), 'container');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), () => ({ flags: 0x6000 })))), 'md5');
});

test('check 4: block numbering', () => {
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), (p, i) => (i === 1 ? { count: 3 } : {})))), 'numBlocks');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), (p, i) => (i === 1 ? { blockNo: 2 } : {})))), 'blockNo');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), (p, i) => (i === 1 ? { blockNo: 0 } : {})))), 'duplicateBlock');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), () => ({ count: 3 })))), 'missingBlock');
  assert.equal(codes(validateFirmware(uf2(pagesOf(GOOD), (p, i) => (i === 1 ? { address: 0x10000000 } : {})))), 'duplicateAddress');
});

test('check 5-6: one binary type, flash start and size, RAM images, data outside', () => {
  const mixed = { ...GOOD, 0x20000000: [1] };
  assert.equal(codes(validateFirmware(uf2(pagesOf(mixed)))), 'mixed');
  const late = { 0x10001000: GOOD[0x10000000], 0x10001100: [0x13] };
  assert.equal(codes(validateFirmware(uf2(pagesOf(late)))), 'flashStart');
  const big = { ...GOOD, 0x10400000: [1] };
  assert.equal(codes(validateFirmware(uf2(pagesOf(big)))), 'flashSize');
  assert.equal(codes(validateFirmware(uf2(pagesOf(big)), { flashSize: 16 << 20 })), 'ok', 'a board with more flash');
  assert.equal(codes(validateFirmware(uf2(pagesOf({ ...GOOD, 0x30000000: [1] })))), 'outside');
  const ram = validateFirmware(uf2(pagesOf({ 0x20000000: [START, IMAGE_TYPE_RV, ...entryItem(0x20000100, 0x20082000), ...last(4)], 0x20000100: [0x13] })));
  assert.equal(codes(ram), 'ok');
  assert.equal(ram.artifact.kind, 'ram');
  assert.equal(ram.artifact.filled, 0);
});

test('check 7-9: block loop, IMAGE_DEF, entry, partition table refused, TBYB / LOAD_MAP / VECTOR_TABLE as notes', () => {
  assert.equal(codes(validateFirmware(uf2(pagesOf({ 0x10000000: [0x13, 0x13] })))), 'noBlockLoop');
  const block = (items, words) => ({ 0x10000000: [START, ...items, ...last(words)], 0x10000100: [0x13] });
  assert.equal(codes(validateFirmware(uf2(pagesOf(block([0x10010142], 1))))), 'notRiscv');
  assert.equal(codes(validateFirmware(uf2(pagesOf(block([0x10020142], 1))))), 'noImageDef', 'DATA, not EXE');
  assert.equal(codes(validateFirmware(uf2(pagesOf(block([0x01010142], 1))))), 'notRp2350', 'RISC-V EXE for chip RP2040');
  assert.equal(codes(validateFirmware(uf2(pagesOf(block([IMAGE_TYPE_RV, ...entryItem(0x10200000, 0)], 4))))), 'entryOutside');
  assert.equal(codes(validateFirmware(uf2(pagesOf(block([IMAGE_TYPE_RV, 0x0000010a], 2))))), 'partitionTable');
  const minimal = validateFirmware(uf2(pagesOf(block([IMAGE_TYPE_RV], 1))));
  assert.deepEqual(minimal.artifact.entry, { pc: 0x10000000, sp: null }, 'no ENTRY_POINT: the lowest address');
  const notes = validateFirmware(uf2(pagesOf(block([IMAGE_TYPE_RV | 0x80000000, 0x00000206, 0, 0x00000203, 0x20000000], 5))));
  assert.equal(codes(notes), 'ok');
  assert.deepEqual(notes.notes.map((n) => n.code).sort(), ['filled', 'loadMap', 'tbyb', 'vectorTable']);
  // a broken LAST size and an open link
  assert.equal(codes(validateFirmware(uf2(pagesOf({ 0x10000000: [START, IMAGE_TYPE_RV, ...last(3)] })))), 'openLoop');
  assert.equal(codes(validateFirmware(uf2(pagesOf({ 0x10000000: [START, IMAGE_TYPE_RV, ...last(1, 0x40)] })))), 'openLoop');
  // a loop of two blocks (as the SDK writes: one at each end of the image)
  const two = validateFirmware(uf2(pagesOf({ 0x10000000: [START, IMAGE_TYPE_RV, ...last(1, 0x200)], 0x10000200: [START, 0x00000142 | 0x10000, ...last(1, -0x200)] })));
  assert.equal(codes(two), 'ok');
  assert.equal(two.artifact.blocks, 2);
});

test('ELF and .bin inputs: refused when not RISC-V ELF, read as a flash image from 0x10000000', () => {
  const notElf = new Uint8Array(64); notElf.set([0x7f, 0x45, 0x4c, 0x46, 2]);
  assert.equal(codes(validateFirmware(notElf)), 'elf');
  const bin = new Uint8Array(0x104); new DataView(bin.buffer).setUint32(0, START, true);
  const words = [START, IMAGE_TYPE_RV, ...last(1)]; words.forEach((w, i) => new DataView(bin.buffer).setUint32(i * 4, w >>> 0, true));
  const r = validateFirmware(bin, { kind: 'bin' });
  assert.equal(codes(r), 'ok');
  assert.equal(r.source, 'bin');
  assert.equal(r.artifact.lowest, 0x10000000);
});

const FW_DIR = process.env.PICO2_FIRMWARE_DIR ?? path.join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'pico-examples-rv');
const FIRMWARES = ['uart/hello_uart/hello_uart', 'blink/blink', 'timer/timer_lowlevel/timer_lowlevel', 'gpio/hello_gpio_irq/hello_gpio_irq', 'timer/hello_timer/hello_timer'];
const haveFw = FIRMWARES.every((f) => fs.existsSync(path.join(FW_DIR, `${f}.uf2`)) && fs.existsSync(path.join(FW_DIR, `${f}.elf`)));

test('SDK builds of the P1-M2 set: UF2 and ELF accepted, same pages and build id, entry as the simulator boots it', { skip: haveFw ? false : `firmware not found in ${FW_DIR}` }, async () => {
  for (const f of FIRMWARES) {
    const u = new Uint8Array(fs.readFileSync(path.join(FW_DIR, `${f}.uf2`))), e = new Uint8Array(fs.readFileSync(path.join(FW_DIR, `${f}.elf`)));
    const ru = validateFirmware(u), re = validateFirmware(e);
    assert.equal(codes(ru), 'ok', f); assert.equal(codes(re), 'ok', f);
    assert.ok(ru.notes.some((n) => n.code === 'e10Skipped'), `${f}: SDK 2.3.1 Pico 2 UF2s carry the E10 block`);
    assert.equal(await buildId(ru.artifact), await buildId(re.artifact), f);
    assert.equal(ru.artifact.blocks, 2, `${f}: the SDK's loop of two blocks`);
    const im = readImage(u);
    assert.deepEqual(ru.artifact.entry, im.entry, f);
  }
});
