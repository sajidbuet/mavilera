// armv7-pipe-drawing.test.mjs -- the draft drawing of the ARM pipelined processor (content/armv7/geometry/pipe.json,
// written by tools/armv7/make-pipe-geometry.mjs; roadmap ARM-A4) and its active paths (uarch/pipe-paths.js): every
// connection has a width from the signal dictionary, the junction dots match the connectivity, no text collides, the
// parts of Fig 7.58 are there, every id a path names exists, and on every cycle of the test programs each multiplexer on
// the path passes the input its select chooses (the forwarding multiplexers' inputs are numbered 00, 01, 10).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/arch/armv7/language.js';
import { ArmPipe } from '../src/arch/armv7/uarch/pipe.js';
import { pipePaths } from '../src/arch/armv7/uarch/pipe-paths.js';
import { PIPE_INFO, PIPE_EXT_INFO } from '../src/arch/armv7/uarch/signals.js';
import { ArmPipeExt } from '../src/arch/armv7/uarch/pipe-ext.js';
import { wireWidth, checkJunctions, collisions, muxPorts, selectedInputs } from '../src/ui/schematic.js';

const geom = JSON.parse(readFileSync(new URL('../content/armv7/geometry/pipe.json', import.meta.url), 'utf8'));
const wireIds = new Set(geom.wires.map((w) => w.id));
const elementIds = new Set(geom.elements.map((e) => e.id));

test('every connection and control stub has a width in the signal dictionary (the constant 15 has none)', () => {
  for (const w of geom.wires) {
    if (w.signal === 'const15') continue;
    assert.ok(wireWidth(w.signal, w.style, PIPE_INFO) !== null, `${w.id}: ${w.signal}`);
  }
  for (const c of geom.control) assert.ok(wireWidth(c.signal, 'ctrl', PIPE_INFO) !== null, c.signal);
});

test('junction dots match the connectivity, and no text collides', () => {
  assert.deepEqual(checkJunctions(geom.wires, geom.junctions, geom.control), { wrong: [], missing: [] });
  assert.deepEqual(collisions(geom), []);
});

test('the parts of Fig 7.58: two next-PC multiplexers, the pipeline registers, forwarding, the Cond Unit and its gates, the Hazard Unit', () => {
  for (const id of ['pcm', 'brm', 'pc', 'imem', 'add4', 'fd', 'cu', 'ra1m', 'ra2m', 'rf', 'ext', 'de', 'de_c', 'fam', 'fbm', 'bm', 'alu',
    'flags', 'cond', 'g_pcsrc', 'g_regw', 'g_memw', 'g_branch', 'em', 'em_c', 'dm', 'mw', 'mw_c', 'rm', 'hz']) assert.ok(elementIds.has(id), id);
  assert.equal(geom.elements.filter((e) => e.type === 'mem').length, 2, 'instruction and data memories');
  assert.equal(geom.elements.find((e) => e.id === 'fam').type, 'mux3');
  // PCPlus4F passes the Fetch/Decode register unregistered and enters the register file as PCPlus8D (Fig 7.46)
  assert.ok(geom.wires.some((w) => w.id === 'pc8_rf' && w.signal === 'PCPlus8D'));
  // the write address travels with the instruction (Fig 7.45)
  for (const s of ['WA3D', 'WA3E', 'WA3M', 'WA3W']) assert.ok(geom.wires.some((w) => w.signal === s), s);
  const stubs = new Set(geom.control.map((c) => c.text ?? c.signal));
  for (const s of ['Match', 'MemtoRegE', 'BranchTakenE', 'PCSrcD', 'PCSrcE', 'PCSrcM', 'PCSrcW', 'RegWriteM', 'RegWriteW', 'StallF', 'StallD',
    'FlushD', 'FlushE', 'ForwardAE', 'ForwardBE']) assert.ok(stubs.has(s), s);
});

const PROGRAMS = [
  readFileSync(new URL('../content/armv7/templates/fig-7-60.s', import.meta.url), 'utf8'),
  'ADD R1, R1, #5\nADD R2, R1, R1\nADD R3, R1, R2\nLDR R4, [R0, #0x100]\nADD R5, R4, R4\nSTR R5, [R0, #0x104]\nORR R6, R15, R1\nB .',
  'SUBS R0, R0, #0\nBEQ t\nADD R0, R0, #1\nt: BNE t\nADDNE R6, R6, #1\nSTRNE R6, [R12, #0x100]\nLDRNE R6, [R12, #0x100]\nADD R15, R15, R0\nADD R0, R0, #1\nB .',
  'ADD R2, R2, #24\nSTR R2, [R0, #0x800]\nLDR R1, [R0, #0x800]\nADD R15, R1, #0\nADD R5, R5, #1\nADD R6, R6, #1\nSTR R15, [R0, #0x804]\nLDR R15, [R0, #0x800]\nB .',
];

test('active paths: every id exists, and each multiplexer on the path passes the input its select chooses', () => {
  const ports = muxPorts(geom);
  const sels = [['pcm', 'PCSrcW'], ['brm', 'BranchTakenE'], ['fam', 'ForwardAE'], ['fbm', 'ForwardBE'], ['bm', 'ALUSrcE'], ['rm', 'MemtoRegW']];
  let n = 0;
  const seen = new Set();
  for (const hazard of ['full', 'forward', 'none']) {
    for (const text of PROGRAMS) {
      const p = assemble([{ name: 't.s', text }], { profile: 'arm-pipe' });
      assert.ok(p.ok, JSON.stringify(p.diagnostics));
      const m = new ArmPipe({ hazard });
      m.load(p);
      for (let i = 0; i < 400; i++) {
        const c = m.evaluate();
        const s = c.signals;
        const path = pipePaths(c);
        for (const id of path.wires) assert.ok(wireIds.has(id), id);
        for (const id of path.elements) assert.ok(elementIds.has(id), id);
        const sel = selectedInputs(ports, geom.wires, path.wires);
        for (const [mux, signal] of sels) {
          if (!sel.has(mux)) continue;
          const got = parseInt(String(sel.get(mux)), mux.startsWith('f') ? 2 : 10); // 00, 01, 10 read as binary
          assert.equal(got, s[signal], `cycle ${m.cycle}: ${mux}`);
          seen.add(`${mux}=${got}`);
        }
        if (sel.has('ra1m')) assert.equal(sel.get('ra1m'), s.RegSrcD & 1);
        if (sel.has('ra2m')) assert.equal(sel.get('ra2m'), s.RegSrcD >> 1);
        assert.ok(sel.has('brm') && (sel.has('pcm') || s.BranchTakenE), 'the next PC is always on the path');
        if (!c.live.EX || !(s.MemWriteE && s.CondExE)) assert.ok(!path.wires.has('wd_em'));
        if (!c.live.WB || !s.RegWriteW) assert.ok(!path.wires.has('res_rf'));
        n += 1;
        if (m.step() !== 'step') break;
      }
    }
  }
  assert.ok(n > 300, `${n} cycles`);
  for (const k of ['fam=0', 'fam=1', 'fam=2', 'fbm=0', 'fbm=1', 'fbm=2', 'brm=1', 'pcm=1', 'rm=1', 'bm=1']) assert.ok(seen.has(k), `${k} seen`);
});

// --- the Extended drawing (content/armv7/geometry/pipe-extended.json; A4-Q5 to A4-Q8) -------------------------------------
const gx = JSON.parse(readFileSync(new URL('../content/armv7/geometry/pipe-extended.json', import.meta.url), 'utf8'));
const xWires = new Set(gx.wires.map((w) => w.id));
const xElements = new Set(gx.elements.map((e) => e.id));

test('Extended: every connection has a width, the junction dots match, no text collides', () => {
  for (const w of gx.wires) {
    if (w.signal === 'const15' || w.signal === 'const14') continue;
    assert.ok(wireWidth(w.signal, w.style, PIPE_EXT_INFO) !== null, `${w.id}: ${w.signal}`);
  }
  for (const c of gx.control) assert.ok(wireWidth(c.signal, 'ctrl', PIPE_EXT_INFO) !== null, c.signal);
  assert.deepEqual(checkJunctions(gx.wires, gx.junctions, gx.control), { wrong: [], missing: [] });
  assert.deepEqual(collisions(gx), []);
});

test('Extended: the base drawing\'s parts are all there, in the same left-to-right order, with the added parts', () => {
  const replaced = new Set(['wd_bm', 'mw_MemtoReg']); // the shifter takes the first's place; ResultSrcW's row the second's
  assert.ok(xWires.has('mw_ResultSrc'));
  for (const w of geom.wires) if (!replaced.has(w.id)) assert.ok(xWires.has(w.id), w.id);
  for (const e of geom.elements) assert.ok(xElements.has(e.id), e.id);
  const order = (g) => g.elements.filter((e) => geom.elements.some((b) => b.id === e.id) && !['rm', 'g_regw', 'hz'].includes(e.id))
    .sort((a, b) => a.at[0] - b.at[0] || a.id.localeCompare(b.id)).map((e) => e.id);
  assert.deepEqual(order(gx), order(geom), 'left-to-right order kept');
  for (const id of ['fd_p', 'a3m', 'sh', 'nw_bub', 'byte']) assert.ok(xElements.has(id), id);
  assert.equal(gx.elements.find((e) => e.id === 'rm').type, 'mux4f');
  assert.equal(gx.elements.find((e) => e.id === 'g_regw').type, 'and3');
  for (const s of ['PCPlus4D', 'PCPlus4E', 'PCPlus4M', 'PCPlus4W', 'ShiftResultE', 'ShiftCE', 'NoWriteE', 'ReadByteW']) assert.ok(gx.wires.some((w) => w.signal === s), s);
});

const PROGRAMS_EXT = [
  'MOV R0, #12\nMOV R1, #18\nBL gcd\nMOV R3, R0, LSL #2\nMOV R4, #0x80\nSTR R3, [R4, #0]\nLDRB R5, [R4, #1]\nADD R6, R5, R5\nLDR R7, [R4, #0]\n'
    + 'STR R5, [R4, #-4]\nADCS R8, R0, R1\nTST R0, #1\nANDS R9, R1, R0, LSR #1\nMOVNE R2, #7\nB .\ngcd: CMP R0, R1\nSUBGT R0, R0, R1\nSUBLT R1, R1, R0\nBNE gcd\nMOV PC, LR\n',
  'MOVS R0, #0\nBLNE f\nBLEQ f\nANDS R1, R0, R0, LSR #1\nLDR R15, [R0, #0x100]\nB .\nf: ADD R2, R2, #1\nMOV PC, LR\n',
];

test('Extended active paths: every id exists, and each multiplexer on the path passes the input its select chooses', () => {
  const ports = muxPorts(gx);
  const sels = [['pcm', 'PCSrcW'], ['brm', 'BranchTakenE'], ['fam', 'ForwardAE'], ['fbm', 'ForwardBE'], ['bm', 'ALUSrcE'], ['rm', 'ResultSrcW'], ['a3m', 'LinkD']];
  const seen = new Set();
  let n = 0;
  for (const text of PROGRAMS_EXT) {
    const p = assemble([{ name: 't.s', text }], { profile: 'arm-pipe', subset: 'extended' });
    assert.ok(p.ok, JSON.stringify(p.diagnostics));
    const m = new ArmPipeExt();
    m.load(p);
    for (let i = 0; i < 400; i++) {
      const c = m.evaluate();
      const s = c.signals;
      const path = pipePaths(c, true);
      for (const id of path.wires) assert.ok(xWires.has(id), id);
      for (const id of path.elements) assert.ok(xElements.has(id), id);
      const sel = selectedInputs(ports, gx.wires, path.wires);
      for (const [mux, signal] of sels) {
        if (!sel.has(mux)) continue;
        const got = parseInt(String(sel.get(mux)), mux.startsWith('f') ? 2 : 10);
        assert.equal(got, s[signal], `cycle ${m.cycle}: ${mux}`);
        seen.add(`${mux}=${got}`);
      }
      n += 1;
      if (m.step() !== 'step') break;
    }
  }
  assert.ok(n > 60, `${n} cycles`);
  for (const k of ['rm=0', 'rm=1', 'rm=2', 'rm=3', 'a3m=0', 'a3m=1', 'bm=0', 'bm=1']) assert.ok(seen.has(k), `${k} seen`);
});
