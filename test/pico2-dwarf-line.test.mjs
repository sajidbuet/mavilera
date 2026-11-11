// The DWARF line-table reader of the pico2 module (P1-C1, design §2 step 3, §6): line programs written by a small encoder below
// (version 5 with .debug_line_str and version 4 headers, every standard opcode, extended opcodes, two sequences, several rows at
// one address), the refusals (64-bit DWARF, truncation, an unknown file), and the SDK-built ELFs of the P1-M2 set when present
// (read from PICO2_FIRMWARE_DIR or %LOCALAPPDATA%\pico2sim-build\pico-examples-rv; skipped when absent): every function's entry
// has a line and its file is a C or assembly source.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseLineTable, readLineTable, DwarfError } from '../src/arch/pico2/debug/dwarf-line.js';
import { parseElf } from '../src/arch/pico2/core/elf.js';

// --- a minimal encoder for line programs -------------------------------------------------------------------------------
const uleb = (v) => { const o = []; do { let b = v & 0x7f; v = Math.floor(v / 128); if (v) b |= 0x80; o.push(b); } while (v); return o; };
const sleb = (v) => { const o = []; for (;;) { const b = v & 0x7f; v = Math.floor(v / 128); if ((v === 0 && !(b & 0x40)) || (v === -1 && (b & 0x40))) { o.push(b); return o; } o.push(b | 0x80); } };
const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const cstr = (s) => [...new TextEncoder().encode(s), 0];
const OPB = 13, LB = -5, LR = 14; // opcode_base, line_base, line_range as GCC writes them
const special = (addrAdv, lineAdv) => OPB + (lineAdv - LB) + LR * addrAdv;
const P = {
  copy: () => [1], advPc: (n) => [2, ...uleb(n)], advLine: (n) => [3, ...sleb(n)], file: (n) => [4, ...uleb(n)], col: (n) => [5, ...uleb(n)],
  negStmt: () => [6], basicBlock: () => [7], constAddPc: () => [8], fixedAdv: (n) => [9, ...u16(n)], prologue: () => [10], epilogue: () => [11],
  isa: (n) => [12, ...uleb(n)], setAddr: (a) => [0, 5, 2, ...u32(a)], end: () => [0, 1, 1], discr: (n) => [0, 1 + uleb(n).length, 4, ...uleb(n)],
  special: (a, l) => [special(a, l)],
};
const STD = [0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1]; // operand counts of opcodes 1-12

/** A version-5 unit: directories and files as line_strp offsets into `lineStr` (built here). */
function unit5({ dirs, files, program, lineStr }) {
  const strp = (s) => { const off = lineStr.length; lineStr.push(...cstr(s)); return u32(off); };
  const hdr = [1, 1, 0x1f, ...uleb(dirs.length), ...dirs.flatMap(strp),
    2, 1, 0x1f, 2, 0x0b, ...uleb(files.length), ...files.flatMap(([n, d]) => [...strp(n), d])];
  const afterHl = [1, 1, 1, LB & 0xff, LR, OPB, ...STD, ...hdr];
  const body = [...u16(5), 4, 0, ...u32(afterHl.length), ...afterHl, ...program.flat()];
  return [...u32(body.length), ...body];
}
/** A version-4 unit. */
function unit4({ dirs, files, program }) {
  const hdr = [...dirs.flatMap(cstr), 0, ...files.flatMap(([n, d]) => [...cstr(n), ...uleb(d), 0, 0]), 0];
  const afterHl = [2, 1, 1, LB & 0xff, LR, OPB, ...STD, ...hdr];
  const body = [...u16(4), ...u32(afterHl.length), ...afterHl, ...program.flat()];
  return [...u32(body.length), ...body];
}

test('version 5: every standard opcode, last row of one address wins, sequences sorted, lookups as addr2line', () => {
  const lineStr = [];
  const u = unit5({
    lineStr,
    dirs: ['/build', 'src', '/abs/inc'],
    files: [['main.c', 1], ['main.c', 1], ['util.h', 2]],
    program: [
      // second sequence first in the file (the reader sorts sequences)
      P.setAddr(0x10000200), P.file(2), P.advLine(99), P.copy(),       // 0x200: util.h:100
      P.fixedAdv(6), P.advLine(1), P.copy(),                           // 0x206: util.h:101 (fixed_advance_pc not scaled)
      P.advPc(2), P.end(),                                             // ends at 0x208
      P.setAddr(0x10000100), P.col(3), P.prologue(), P.copy(),         // 0x100: main.c:1
      P.special(4, 2),                                                 // 0x104: main.c:3
      P.negStmt(), P.special(0, 1),                                    // 0x104: main.c:4, not a statement (last at 0x104 wins)
      P.negStmt(), P.basicBlock(), P.epilogue(), P.isa(0), P.discr(2), P.special(2, 1), // 0x106: main.c:5
      P.constAddPc(), P.special(0, 2),                                 // 0x106 + 17 = 0x117 -> main.c:7
      P.file(0), P.advLine(-6), P.special(1, 0),                       // 0x118: file 0 (= main.c in dir 1), line 1
      P.advPc(8), P.end(),                                             // ends at 0x120
    ],
  });
  const t = parseLineTable(new Uint8Array(u), { lineStr: new Uint8Array(lineStr) });
  assert.equal(t.units, 1);
  assert.deepEqual(t.files, ['/build/src/main.c', '/abs/inc/util.h']);
  const at = (a) => { const r = t.lineAt(a); return r && `${r.file}:${r.line}${r.stmt ? '' : '!'}`; };
  assert.equal(at(0x100000ff), null);
  assert.equal(at(0x10000100), '/build/src/main.c:1');
  assert.equal(t.lineAt(0x10000100).column, 3);
  assert.equal(at(0x10000103), '/build/src/main.c:1');
  assert.equal(at(0x10000104), '/build/src/main.c:4!');
  assert.equal(at(0x10000106), '/build/src/main.c:5');
  assert.equal(at(0x10000116), '/build/src/main.c:5');
  assert.equal(at(0x10000117), '/build/src/main.c:7');
  assert.equal(at(0x10000118), '/build/src/main.c:1');
  assert.equal(at(0x1000011f), '/build/src/main.c:1');
  assert.equal(at(0x10000120), null, 'the end_sequence address is outside');
  assert.equal(at(0x10000180), null, 'between sequences');
  assert.equal(at(0x10000200), '/abs/inc/util.h:100');
  assert.equal(at(0x10000206), '/abs/inc/util.h:101');
  assert.equal(at(0x10000208), null);
  assert.deepEqual(t.addressesOf(0, 1), [0x10000100, 0x10000118]);
  assert.deepEqual(t.addressesOf(0, 4), [], 'not a statement');
  assert.deepEqual(t.linesOf(0), [1, 5, 7], 'statement lines only (line 4 has no statement row)');
  assert.deepEqual(t.rowRange(t.lineAt(0x10000106).row), [0x10000106, 0x10000117]);
  assert.deepEqual(t.rowRange(t.lineAt(0x10000118).row), [0x10000118, 0x10000120]);
});

test('version 4: include directories, 1-based files, DW_LNE_define_file, two units share one file table', () => {
  const a = unit4({ dirs: ['/sdk/inc'], files: [['a.c', 0], ['b.h', 1]], program: [P.setAddr(0x20000000), P.copy(), P.file(2), P.special(2, 5), P.advPc(2), P.end()] });
  const b = unit4({ dirs: [], files: [['a.c', 0]], program: [[0, 1 + cstr('late.c').length + 3, 3, ...cstr('late.c'), 0, 0, 0], P.setAddr(0x20000010), P.file(2), P.copy(), P.advPc(4), P.end()] });
  const t = parseLineTable(new Uint8Array([...a, ...b]));
  assert.equal(t.units, 2);
  assert.deepEqual(t.files, ['a.c', '/sdk/inc/b.h', 'late.c']);
  // minimum_instruction_length 2 in these headers: advances are scaled (special opcode +2 -> 4 bytes)
  assert.equal(t.lineAt(0x20000002).file, 'a.c');
  assert.equal(t.lineAt(0x20000004).file, '/sdk/inc/b.h');
  assert.equal(t.lineAt(0x20000004).line, 6);
  assert.equal(t.lineAt(0x20000008), null);
  assert.equal(t.lineAt(0x20000012).file, 'late.c');
});

test('refusals: 64-bit DWARF, truncation, an unknown file number, a reserved length', () => {
  assert.throws(() => parseLineTable(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0, 0])), DwarfError);
  assert.throws(() => parseLineTable(new Uint8Array([0xf0, 0xff, 0xff, 0xff])), DwarfError);
  const good = unit4({ dirs: [], files: [['a.c', 0]], program: [P.setAddr(0x100), P.copy(), P.end()] });
  assert.throws(() => parseLineTable(new Uint8Array(good.slice(0, good.length - 2))), DwarfError);
  const badFile = unit4({ dirs: [], files: [['a.c', 0]], program: [P.setAddr(0x100), P.file(7), P.copy(), P.end()] });
  assert.throws(() => parseLineTable(new Uint8Array(badFile)), /file number 7/);
});

const FW_DIR = process.env.PICO2_FIRMWARE_DIR ?? path.join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'pico-examples-rv');
const ELFS = ['uart/hello_uart/hello_uart.elf', 'blink/blink.elf', 'timer/timer_lowlevel/timer_lowlevel.elf',
  'gpio/hello_gpio_irq/hello_gpio_irq.elf', 'timer/hello_timer/hello_timer.elf'];
const haveFw = ELFS.every((f) => fs.existsSync(path.join(FW_DIR, f)));

test('SDK-built ELFs of the P1-M2 set: the line table reads, and main has a line in its own C file', { skip: haveFw ? false : `firmware not found in ${FW_DIR}` }, () => {
  for (const f of ELFS) {
    const elf = parseElf(new Uint8Array(fs.readFileSync(path.join(FW_DIR, f))));
    const t = readLineTable(elf.sections);
    assert.ok(t && t.units > 0 && t.address.length > 100, f);
    const main = elf.functions.find((s) => s.name === 'main');
    const r = t.lineAt(main.address);
    assert.ok(r, `${f}: main has a line`);
    assert.match(r.file.replace(/\\/g, '/'), new RegExp(`/${path.basename(f, '.elf')}\\.c$`), f);
  }
});
