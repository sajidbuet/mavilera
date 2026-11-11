// The import of SDK-built programs in the pico2 module (P1-C1, design §2, §6): Language.loadImage on a UF2 built here (accepted:
// the engine boots the validated pages at the ENTRY_POINT and runs to its ebreak; refused: the validator's message), the shell's
// image kinds in the descriptor, and the SDK builds of the P1-M2 set when present (PICO2_FIRMWARE_DIR or %LOCALAPPDATA%\
// pico2sim-build\pico-examples-rv; skipped when absent): UF2 and ELF boot to the same state after 200 000 steps, the ELF brings
// its functions and line table, the listing is capped. The C source view's model (debug/source-session.js): line stepping from
// reset to main's first line by a line breakpoint, back by line, the file matching.
// The oracle comparison through this path is the research repository's experiment E-CC-IMPORT.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { descriptor } from '../src/arch/pico2/index.js';
import { create } from '../src/arch/pico2/engine.js';
import { STOP, validateDescriptor } from '../src/arch/contract.js';
import { LISTING_MAX } from '../src/arch/pico2/firmware/import.js';
import { SourceSession, matchFiles } from '../src/arch/pico2/debug/source-session.js';

const L = descriptor.language;

/** A one-page flash image: block loop with IMAGE_DEF and ENTRY_POINT at 0x10000000, code at 0x10000100 (li a0, 42; ebreak). */
function tinyUf2() {
  const words = new Map([[0x10000000, [0xffffded3, 0x11010142, 0x00000344, 0x10000100, 0x20082000, 0x000004ff, 0, 0xab123579]],
    [0x10000100, [0x02a00513, 0x00100073]]]);
  const out = new Uint8Array(2 * 512), dv = new DataView(out.buffer);
  [...words].forEach(([addr, ws], i) => {
    const o = i * 512;
    dv.setUint32(o, 0x0a324655, true); dv.setUint32(o + 4, 0x9e5d5157, true); dv.setUint32(o + 508, 0x0ab16f30, true);
    dv.setUint32(o + 8, 0x2000, true); dv.setUint32(o + 12, addr, true); dv.setUint32(o + 16, 256, true);
    dv.setUint32(o + 20, i, true); dv.setUint32(o + 24, 2, true); dv.setUint32(o + 28, 0xe48bff5a, true);
    ws.forEach((w, k) => dv.setUint32(o + 32 + 4 * k, w >>> 0, true));
  });
  return out;
}

test('descriptor: imageImport on, image kinds uf2/elf/bin, the C source view registered; the descriptor validates', () => {
  assert.equal(descriptor.capabilities.imageImport, true);
  assert.deepEqual(L.imageKinds, ['uf2', 'elf', 'bin']);
  assert.ok(descriptor.views.some((v) => v.id === 'source' && v.kind === 'datapath'));
  assert.deepEqual(validateDescriptor(descriptor), []);
});

test('loadImage: a UF2 built here boots at its ENTRY_POINT and runs; the notes become warnings; a refused file throws the reason', () => {
  const p = L.loadImage(tinyUf2(), 'uf2', 'tiny.uf2');
  assert.equal(p.ok, true);
  assert.equal(p.imported, true);
  assert.equal(p.entry, 0x10000100);
  assert.ok(p.diagnostics.every((d) => d.severity === 'warning'));
  assert.ok(p.diagnostics.some((d) => /14 pages/.test(d.message)), 'the sector fill is reported');
  assert.equal(p.debug.lineTable, null);
  const e = create(p);
  assert.equal(e.state().pc, 0x10000100);
  assert.equal(e.run({ chunk: 100 }), STOP.HALT);
  assert.equal(e.state().registers.x10, 42);
  const bad = tinyUf2(); new DataView(bad.buffer).setUint32(28, 0xe48bff56, true);
  assert.throws(() => L.loadImage(bad, 'uf2', 'rp2040.uf2'), /RP2040/);
  assert.throws(() => L.loadImage(new Uint8Array(10), 'uf2', 'x.uf2'), /multiple of 512/);
});

test('matchFiles: the longest run of trailing path components, without case; the file name at least', () => {
  const table = ['C:/work/proj/src/main.c', '/sdk/src/rp2_common/hardware_gpio/gpio.c', '/sdk/include/pico.h', '/x/other.c'];
  const opened = ['proj/src/main.c', 'proj/main.c', 'pico-sdk/src/rp2_common/hardware_gpio/gpio.c', 'pico-sdk/src/rp2040/hardware_gpio/gpio.c', 'PICO.H'];
  const m = matchFiles(table, opened);
  assert.equal(m.get(0), 'proj/src/main.c');
  assert.equal(m.get(1), 'pico-sdk/src/rp2_common/hardware_gpio/gpio.c');
  assert.equal(m.get(2), 'PICO.H');
  assert.equal(m.has(3), false);
});

const FW_DIR = process.env.PICO2_FIRMWARE_DIR ?? path.join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'pico-examples-rv');
const FIRMWARES = ['uart/hello_uart/hello_uart', 'blink/blink', 'timer/timer_lowlevel/timer_lowlevel', 'gpio/hello_gpio_irq/hello_gpio_irq', 'timer/hello_timer/hello_timer'];
const haveFw = FIRMWARES.every((f) => fs.existsSync(path.join(FW_DIR, `${f}.uf2`)) && fs.existsSync(path.join(FW_DIR, `${f}.elf`)));
const read = (f) => new Uint8Array(fs.readFileSync(path.join(FW_DIR, f)));

test('SDK builds: UF2 and ELF imported, booted, and in the same state after 200 000 steps; the ELF brings functions and lines', { skip: haveFw ? false : `firmware not found in ${FW_DIR}` }, () => {
  for (const f of FIRMWARES) {
    const pu = L.loadImage(read(`${f}.uf2`), 'uf2', `${f}.uf2`), pe = L.loadImage(read(`${f}.elf`), 'elf', `${f}.elf`);
    assert.ok(pe.debug.lineTable && pe.debug.functions.some((x) => x.name === 'main'), f);
    assert.ok(pe.listing.length > 100 && pe.listing.length <= LISTING_MAX && pu.listing.length <= LISTING_MAX, f);
    assert.ok(pu.diagnostics.some((d) => /E10/.test(d.message)), `${f}: the E10 block noted`);
    const eu = create(pu, { runLimit: Infinity }), ee = create(pe, { runLimit: Infinity });
    for (let k = 0; k < 2; k++) { eu.run({ chunk: 100_000, resumed: k > 0 }); ee.run({ chunk: 100_000, resumed: k > 0 }); }
    const su = eu.state(), se = ee.state();
    assert.equal(su.pc, se.pc, f); assert.deepEqual(su.registers, se.registers, f); assert.equal(su.output, se.output, f);
  }
});

test('source session: a line breakpoint on main\'s first line is reached from reset; step line moves to another line; back line returns', { skip: haveFw ? false : `firmware not found in ${FW_DIR}` }, () => {
  const p = L.loadImage(read('uart/hello_uart/hello_uart.elf'), 'elf', 'hello_uart.elf');
  const s = new SourceSession(p, { runLimit: Infinity });
  const main = p.debug.functions.find((x) => x.name === 'main');
  const at = s.where(main.address);
  assert.match(at.file.replace(/\\/g, '/'), /\/hello_uart\.c$/);
  assert.ok(s.toggleBreak(at.fileIndex, at.line).includes(main.address));
  let k = 0;
  while (!s.breakAddrs.has(s.pc) && k < 1_000_000) { assert.equal(s.step(), STOP.NONE); k++; }
  assert.equal(s.pc, main.address, 'stopped before main\'s first instruction');
  const w0 = s.where();
  assert.equal(s.stepLine(), STOP.NONE);
  const w1 = s.where();
  assert.ok(w1.line > 0 && (w1.fileIndex !== w0.fileIndex || w1.line !== w0.line), 'another line');
  assert.ok(p.debug.lineTable.stmt[w1.row] === 1 && p.debug.lineTable.address[w1.row] === s.pc, 'at the start of a statement row');
  const n1 = s.n;
  assert.equal(s.backLine(), true);
  assert.ok(s.n < n1);
  assert.equal(s.pc, main.address, 'back at main\'s first line');
  // with no step line to undo (main was reached by single steps), back line goes to the previous statement start of another line
  assert.equal(s.backLine(), true);
  const lt = p.debug.lineTable, wb = s.where();
  assert.ok(wb.row >= 0 && lt.stmt[wb.row] === 1 && lt.address[wb.row] === s.pc && (wb.fileIndex !== at.fileIndex || wb.line !== at.line));
  s.toggleBreak(at.fileIndex, at.line);
  assert.equal(s.breakAddrs.size, 0, 'toggled off');
});
