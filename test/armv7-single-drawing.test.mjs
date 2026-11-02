// armv7-single-drawing.test.mjs -- the draft drawing of the ARM single-cycle processor (content/armv7/geometry/
// single.json, written by tools/armv7/make-single-geometry.mjs; roadmap ARM-A2) and its active paths
// (uarch/single-paths.js): every connection has a width from the signal dictionary, the junction dots match the
// connectivity, no text collides, every id a path names exists, and on every cycle of the generated programs each
// multiplexer on the path passes the input its control signal selects.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/arch/armv7/language.js';
import { ArmSingle } from '../src/arch/armv7/uarch/single.js';
import { ArmSingleExt } from '../src/arch/armv7/uarch/single-ext.js';
import { activePath, activePathExt } from '../src/arch/armv7/uarch/single-paths.js';
import { SIGNAL_INFO, SIGNAL_INFO_EXT } from '../src/arch/armv7/uarch/signals.js';
import { wireWidth, checkJunctions, collisions, muxPorts, selectedInputs } from '../src/ui/schematic.js';

const geom = JSON.parse(readFileSync(new URL('../content/armv7/geometry/single.json', import.meta.url), 'utf8'));
const wireIds = new Set(geom.wires.map((w) => w.id));
const elementIds = new Set(geom.elements.map((e) => e.id));

/** The signals of every cycle of a program. */
function cycles(text) {
  const p = assemble([{ name: 't.s', text }], { profile: 'arm-single' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const m = new ArmSingle();
  m.load(p);
  const out = [];
  for (let i = 0; i < 500; i++) {
    out.push(m.evaluate().signals);
    if (m.step() !== 'step') break;
  }
  return out;
}

test('every connection and control stub has a width in the signal dictionary (the constant 15 has none)', () => {
  for (const w of geom.wires) {
    if (w.signal === 'const15') continue;
    assert.ok(wireWidth(w.signal, w.style, SIGNAL_INFO) !== null, `${w.id}: ${w.signal}`);
  }
  for (const c of geom.control) assert.ok(SIGNAL_INFO[c.signal], c.signal);
  assert.equal(wireWidth('Op,Funct,Rd', 'bus', SIGNAL_INFO), 12);
});

test('junction dots match the connectivity, and no text collides', () => {
  assert.deepEqual(checkJunctions(geom.wires, geom.junctions, geom.control), { wrong: [], missing: [] });
  assert.deepEqual(collisions(geom), []);
});

test('the ARM-specific parts of roadmap §7: R15 input, PC + 8 path, flags and Condition Check, the CondEx gates', () => {
  for (const id of ['add8', 'flags', 'cc', 'g_pcsrc', 'g_regw', 'g_memw', 'g_flagw']) assert.ok(elementIds.has(id), id);
  assert.ok(geom.wires.some((w) => w.signal === 'PCPlus8' && w.points.at(-1)[1] === 1.8), 'PCPlus8 ends at the register file');
  for (const s of ['PCS', 'RegW', 'MemW', 'FlagW', 'CondEx']) assert.ok(geom.wires.some((w) => w.signal === s), s);
});

const PROGRAMS = [
  'ADD R1, R1, #5\nADD R2, R2, #7\nADD R3, R1, R2\nSUBS R4, R1, #5\nANDS R5, R1, R2\nORR R6, R15, R1\nB .',
  'ADD R1, R1, #9\nSTR R1, [R12, #0x104]\nLDR R5, [R12, #0x104]\nSTR R15, [R12, #0x108]\nB .',
  'SUBS R0, R0, #0\nBEQ t\nADD R0, R0, #1\nt: BNE t\nADDNE R6, R6, #1\nSTRNE R6, [R12, #0x100]\nADD R15, R15, R0\nADD R0, R0, #1\nB .',
  readFileSync(new URL('../content/armv7/templates/fig-7-60.s', import.meta.url), 'utf8'),
];

test('active paths: every id exists, and each multiplexer on the path passes the input its select chooses', () => {
  const ports = muxPorts(geom);
  let n = 0;
  for (const text of PROGRAMS) {
    for (const s of cycles(text)) {
      const p = activePath(s);
      for (const id of p.wires) assert.ok(wireIds.has(id), id);
      for (const id of p.elements) assert.ok(elementIds.has(id), id);
      const sel = selectedInputs(ports, geom.wires, p.wires);
      assert.equal(sel.get('pcm'), s.PCSrc, 'pcm');
      assert.equal(sel.get('ra1m'), s.RegSrc & 1, 'ra1m');
      assert.equal(sel.get('bm'), s.ALUSrc, 'bm');
      if (!s.ALUSrc || s.MemW) assert.equal(sel.get('ra2m'), s.RegSrc >> 1, 'ra2m'); else assert.equal(sel.has('ra2m'), false);
      if (s.RegWrite || s.PCSrc) assert.equal(sel.get('rm'), s.MemtoReg, 'rm'); else assert.equal(sel.has('rm'), false);
      n += 1;
    }
  }
  assert.ok(n > 30);
});

test('active paths by class: the writes follow the gated signals', () => {
  const at = (text, k) => activePath(cycles(text)[k]).wires;
  const str = at('ADD R1, R1, #9\nSTR R1, [R12, #0x104]\nB .', 1);
  assert.ok(str.has('rd2_dm') && str.has('rd_ra2m') && !str.has('res_rf') && !str.has('ins_rd'));
  const ldr = at('LDR R5, [R12, #0x100]\nB .', 0);
  assert.ok(ldr.has('dm_rm') && ldr.has('res_rf') && ldr.has('ext_bm') && !ldr.has('rd2_dm'));
  const b = at('SUBS R0, R0, #0\nBEQ t\nADD R0, R0, #1\nt: B t', 1);
  assert.ok(b.has('res_pcm') && b.has('c15_ra1m') && b.has('pc8_rf') && !b.has('pc4_pcm') && !b.has('res_rf'));
  const fail = at('SUBS R0, R0, #0\nADDNE R6, R6, #1\nB .', 1);
  for (const id of ['res_rf', 'res_pcm', 'rd2_dm', 'alu_flags', 'res_a']) assert.ok(!fail.has(id), id);
  assert.ok(fail.has('pc4_pcm') && fail.has('condex'));
  const flags = at('SUBS R0, R0, #0\nB .', 0);
  assert.ok(flags.has('alu_flags'));
  const pcw = at('ADD R15, R15, R0\nADD R0, R0, #1\nB .', 0);
  assert.ok(pcw.has('res_pcm') && pcw.has('pc8_rf') && !pcw.has('res_rf'), 'Rd = 15 writes the PC only');
});

// --- the Extended datapath (single-extended.json, uarch/single-ext.js) -------------------------------------------

const geomExt = JSON.parse(readFileSync(new URL('../content/armv7/geometry/single-extended.json', import.meta.url), 'utf8'));
const wireIdsExt = new Set(geomExt.wires.map((w) => w.id));
const elementIdsExt = new Set(geomExt.elements.map((e) => e.id));

function cyclesExt(text) {
  const p = assemble([{ name: 't.s', text }], { profile: 'arm-single', subset: 'extended' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const m = new ArmSingleExt();
  m.load(p);
  const out = [];
  for (let i = 0; i < 500; i++) {
    out.push(m.evaluate().signals);
    if (m.step() !== 'step') break;
  }
  return out;
}

test('Extended drawing: widths, junctions, no collisions; an overlay of the base drawing', () => {
  for (const w of geomExt.wires) {
    if (w.signal === 'const15' || w.signal === 'const14') continue;
    assert.ok(wireWidth(w.signal, w.style, SIGNAL_INFO_EXT) !== null, `${w.id}: ${w.signal}`);
  }
  for (const c of geomExt.control) assert.ok(SIGNAL_INFO_EXT[c.signal], c.signal);
  assert.deepEqual(checkJunctions(geomExt.wires, geomExt.junctions, geomExt.control), { wrong: [], missing: [] });
  assert.deepEqual(collisions(geomExt), []);
  // every base element stays where it is (two get a wider shape at the same place); a base wire is kept or replaced, never moved
  for (const e of geom.elements) assert.deepEqual(geomExt.elements.find((y) => y.id === e.id).at, e.at, e.id);
  for (const w of geom.wires) {
    const x = geomExt.wires.find((y) => y.id === w.id);
    if (x && x.signal === w.signal) assert.deepEqual(x.points, w.points, w.id);
  }
});

const PROGRAMS_EXT = [
  'MOV R1, #6\nMOV R2, #3\nANDS R3, R1, R2, LSR #1\nADC R4, R1, #7\nCMP R1, R2\nTEQ R1, R1\nRSB R5, R1, R2, LSL #2\nBIC R6, R1, R2\nB .',
  'MOV R12, #16\nLDRB R5, [R12, #-3]\nSTR R1, [R12, #-4]\nLDR R6, [R12, #-4]\nBL sub\nMOVS R7, R5, ASR #1\nB .\nsub: MOV PC, LR',
  'SUBS R0, R0, #0\nBLNE sub\nMOVEQ R1, #1\nCMNNE R1, #1\nB .\nsub: MOV PC, LR',
];

test('Extended active paths: every id exists, and each multiplexer passes the input its select chooses', () => {
  const ports = muxPorts(geomExt);
  let n = 0;
  for (const text of [...PROGRAMS, ...PROGRAMS_EXT]) {
    for (const s of cyclesExt(text)) {
      const p = activePathExt(s);
      for (const id of p.wires) assert.ok(wireIdsExt.has(id), id);
      for (const id of p.elements) assert.ok(elementIdsExt.has(id), id);
      const sel = selectedInputs(ports, geomExt.wires, p.wires);
      assert.equal(sel.get('pcm'), s.PCSrc, 'pcm');
      if (s.PCSrc) assert.equal(sel.get('tgm'), s.Branch, 'tgm'); else assert.equal(sel.has('tgm'), false);
      assert.equal(sel.get('ra1m'), s.RegSrc & 1, 'ra1m');
      assert.equal(sel.get('bm'), s.ALUSrc, 'bm');
      if (!s.ALUSrc || s.MemW) assert.equal(sel.get('ra2m'), s.RegSrc >> 1, 'ra2m'); else assert.equal(sel.has('ra2m'), false);
      if (s.RegWrite || (s.PCSrc && !s.Branch)) assert.equal(sel.get('rm'), s.ResultSrc, 'rm'); else assert.equal(sel.has('rm'), false);
      if (s.RegWrite && s.WA3 !== 15) assert.equal(sel.get('wa3m'), s.Link, 'wa3m'); else assert.equal(sel.has('wa3m'), false);
      n += 1;
    }
  }
  assert.ok(n > 50);
});

test('Extended active paths by class: shifter, NoWrite, LDRB, BL', () => {
  const at = (text, k) => activePathExt(cyclesExt(text)[k]);
  const sh = at('MOV R1, #6\nMOV R2, #3\nANDS R3, R1, R2, LSR #1\nB .', 2);
  for (const id of ['rd2_sh', 'sh_bm', 'flags_dn', 'flags_alu', 'shc_alu', 'alu_flags', 'res_rf']) assert.ok(sh.wires.has(id), id);
  const cmp = at('MOV R1, #6\nCMP R1, #3\nB .', 1).wires;
  assert.ok(cmp.has('alu_flags') && !cmp.has('res_rf') && !cmp.has('res_a'), 'CMP writes the flags only');
  const ldrb = at('MOV R12, #16\nLDRB R5, [R12, #-3]\nB .', 1);
  for (const id of ['dm_byte', 'byte_rm4', 'alu_byte', 'res_rf']) assert.ok(ldrb.wires.has(id), id);
  assert.ok(ldrb.elements.has('byte'));
  const bl = at('BL sub\nB .\nsub: MOV PC, LR', 0).wires;
  for (const id of ['alur_tgm', 'tgm_pcm', 'pc4_rm4', 'c14_wa3m', 'res_rf']) assert.ok(bl.has(id), id);
  const ret = at('BL sub\nB .\nsub: MOV PC, LR', 1).wires;
  assert.ok(ret.has('res_tgm') && ret.has('tgm_pcm') && !ret.has('res_rf'), 'MOV PC, LR: the PC from Result');
});
