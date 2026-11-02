// armv7-timing.test.mjs -- the critical paths of the ARM single-cycle processor (src/arch/armv7/uarch/timing.js; roadmap
// ARM-A2, W-D35) with the illustrative delays of content/armv7/data/single-delays.json. The expected delays are a hand
// calculation from those values (not Harris's Table 7.5, W-D32 Q9):
//   LDR: PC 30, IMem 280, Main Decoder 340, RA1 mux 370, register file 490, ALU 670, data memory 920, result mux 950,
//        register-file setup 990.
//   STR: ALU 670, data-memory setup 710.  Data-processing, register: SrcB mux 520, ALU 700, result 730, setup 770.
//   Data-processing, immediate: Extend 390, SrcB 420, ALU 670 (SrcA last), result 700, setup 740.
//   B: RA1 mux 370 (R15 = PCPlus8 at 230 is earlier), SrcA 490, ALU 670, result 700, PCNext 730, PC setup 770.
//   Extended: LDRB adds the Byte unit after the data memory (960, 990, setup 1030); a register operand goes through the
//   shifter (WriteData 490 + 90 = 580, SrcB 610, ALU 790, result 820, setup 860).
// Every connection a path names exists in its drawing.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criticalPath, classTable, classSignals, delayMap } from '../src/arch/armv7/uarch/timing.js';
import { MAIN_DECODER, MAIN_OUTPUTS } from '../src/arch/armv7/uarch/single.js';
import { MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT } from '../src/arch/armv7/uarch/single-ext.js';

const json = (p) => JSON.parse(readFileSync(new URL(`../content/armv7/${p}`, import.meta.url), 'utf8'));
const D = delayMap(json('data/single-delays.json'));
const geom = json('geometry/single.json');
const geomExt = json('geometry/single-extended.json');

test('the delay table: illustrative values, no Table 7.5 claim, every key the model reads', () => {
  const t = json('data/single-delays.json');
  assert.equal(t.label, 'illustrative values');
  assert.match(t._source, /none comes from Harris and Harris, Table 7\.5/);
  for (const k of ['pcq', 'setup', 'imem', 'rf', 'ext', 'mux', 'alu', 'add', 'dmem', 'dec', 'aludec', 'cond', 'gate', 'shift', 'byte']) assert.ok(Number.isFinite(D[k]), k);
});

test('base design: the class delays of the hand calculation; LDR sets the clock period', () => {
  const t = classTable(D, MAIN_DECODER, MAIN_OUTPUTS);
  const by = Object.fromEntries(t.rows.map((r) => [r.cls, r.delay]));
  assert.deepEqual(by, { dpReg: 770, dpImm: 740, ldr: 990, str: 710, b: 770 });
  assert.equal(t.tc, 990);
  assert.deepEqual(t.setBy, ['ldr']);
  const ldr = t.rows.find((r) => r.cls === 'ldr').path.map((p) => [p.node, p.t]);
  assert.deepEqual(ldr, [['PC', 30], ['Instr', 280], ['Decoder', 340], ['RA1', 370], ['SrcA', 490], ['ALUResult', 670],
    ['ReadData', 920], ['Result', 950], ['register file', 990]]);
});

test('Extended datapath: LDRB through the Byte unit, a register operand through the shifter', () => {
  const t = classTable(D, MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT, true);
  const by = Object.fromEntries(t.rows.map((r) => [r.cls, r.delay]));
  assert.equal(by.ldr, 990);
  assert.equal(by.ldrb, 1030);
  assert.equal(by.dpReg, 860);
  assert.equal(t.tc, 1030);
});

test('every connection of every class path exists in its drawing', () => {
  for (const [g, main, outputs, ext] of [[geom, MAIN_DECODER, MAIN_OUTPUTS, false], [geomExt, MAIN_DECODER_EXT, MAIN_OUTPUTS_EXT, true]]) {
    const ids = new Set(g.wires.map((w) => w.id));
    for (const row of main) {
      const r = criticalPath(D, { ...classSignals(row, outputs), RA1: 15, RA2: 15 }, ext); // R15 reads add the PCPlus8 edge
      for (const id of Object.values(r.arrival).length ? r.critical.path.flatMap((p) => p.wires) : []) assert.ok(ids.has(id), `${row.cls}: ${id}`);
      const all = criticalPath(D, classSignals(row, outputs), ext);
      for (const id of all.critical.path.flatMap((p) => p.wires)) assert.ok(ids.has(id), `${row.cls}: ${id}`);
    }
  }
});
