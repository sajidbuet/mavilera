// armv7-multi-drawing.test.mjs -- the draft drawing of the ARM multicycle processor (content/armv7/geometry/multi.json,
// written by tools/armv7/make-multi-geometry.mjs; roadmap ARM-A3) and its active paths (uarch/multi-paths.js): every
// connection has a width from the signal dictionary, the junction dots match the connectivity, no text collides, every
// id a path names exists, on every cycle of the test programs each multiplexer on the path passes the input its select
// chooses, and the state diagram has the ten states and the transitions of Fig 7.41.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/arch/armv7/language.js';
import { ArmMulti, STATES, nextState } from '../src/arch/armv7/uarch/multi.js';
import { multiPath } from '../src/arch/armv7/uarch/multi-paths.js';
import { MULTI_INFO, MULTI_EXT_INFO } from '../src/arch/armv7/uarch/signals.js';
import { ArmMultiExt, STATES_EXT, nextStateExt } from '../src/arch/armv7/uarch/multi-ext.js';
import { wireWidth, checkJunctions, collisions, muxPorts, selectedInputs } from '../src/ui/schematic.js';

const geom = JSON.parse(readFileSync(new URL('../content/armv7/geometry/multi.json', import.meta.url), 'utf8'));
const wireIds = new Set(geom.wires.map((w) => w.id));
const elementIds = new Set(geom.elements.map((e) => e.id));

/** The state and signals of every cycle of a program. */
function cycles(text) {
  const p = assemble([{ name: 't.s', text }], { profile: 'arm-multi' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const m = new ArmMulti();
  m.load(p);
  const out = [];
  for (let i = 0; i < 2000; i++) {
    out.push(m.evaluate().signals);
    if (m.step() !== 'step') break;
  }
  return out;
}

test('every connection and control stub has a width in the signal dictionary (the constants 15 and 4 have none)', () => {
  for (const w of geom.wires) {
    if (w.signal === 'const15' || w.signal === 'const4') continue;
    assert.ok(wireWidth(w.signal, w.style, MULTI_INFO) !== null, `${w.id}: ${w.signal}`);
  }
  for (const c of geom.control) assert.ok(MULTI_INFO[c.signal], c.signal);
});

test('junction dots match the connectivity, and no text collides', () => {
  assert.deepEqual(checkJunctions(geom.wires, geom.junctions, geom.control), { wrong: [], missing: [] });
  assert.deepEqual(collisions(geom), []);
});

test('the parts of Figs 7.30 and 7.31: one memory, the five non-architectural registers, R15 from Result, the CondEx delay and gates', () => {
  for (const id of ['mem', 'am', 'ir', 'data', 'areg', 'wdreg', 'aoreg', 'sam', 'sbm', 'rm', 'flags', 'cc', 'cxd', 'g_pcs', 'g_pcwrite',
    'g_regw', 'g_memw', 'g_flagw', 'cu']) assert.ok(elementIds.has(id), id);
  assert.equal(geom.elements.filter((e) => e.type === 'mem').length, 1);
  assert.ok(geom.wires.some((w) => w.signal === 'Result' && w.id === 'res_r15'), 'Result drives the R15 input');
  for (const s of ['PCS', 'RegW', 'MemW', 'FlagW', 'NextPC', 'CondEx', 'CondExDelayed']) assert.ok(geom.wires.some((w) => w.signal === s), s);
});

test('the state diagram: the ten states of Fig 7.41 and one arc for every transition', () => {
  assert.deepEqual(geom.fsm.states.map((s) => s.id).sort(), [...STATES].sort());
  const want = new Set();
  for (const s of STATES) {
    for (const [Op, Funct] of [[0b00, 0], [0b00, 0b100000], [0b01, 0], [0b01, 1], [0b10, 0]]) {
      const n = nextState(s, Op, Funct);
      if (n) want.add(`${s}>${n}`);
    }
  }
  assert.deepEqual(new Set(geom.fsm.arcs.map((a) => `${a.from}>${a.to}`)), want);
  assert.equal(geom.fsm.arcs.filter((a) => a.arrow).length, 1, 'one arrow ends the shared return path');
});

const PROGRAMS = [
  'ADD R1, R1, #5\nADD R2, R2, #7\nADD R3, R1, R2\nSUBS R4, R1, #5\nANDS R5, R1, R2\nORR R6, R15, R1\nB .',
  'ADD R1, R1, #9\nSTR R1, [R12, #0x104]\nLDR R5, [R12, #0x104]\nSTR R15, [R12, #0x108]\nLDR R15, [R12, #0x10C]\nB .',
  'SUBS R0, R0, #0\nBEQ t\nADD R0, R0, #1\nt: BNE t\nADDNE R6, R6, #1\nSTRNE R6, [R12, #0x100]\nLDRNE R6, [R12, #0x100]\nADD R15, R15, R0\nADD R0, R0, #1\nB .',
  readFileSync(new URL('../content/armv7/templates/fig-7-60.s', import.meta.url), 'utf8'),
];

test('active paths: every id exists, and each multiplexer on the path passes the input its select chooses', () => {
  const ports = muxPorts(geom);
  let n = 0;
  for (const text of PROGRAMS) {
    for (const s of cycles(text)) {
      const p = multiPath(s);
      for (const id of p.wires) assert.ok(wireIds.has(id), id);
      for (const id of p.elements) assert.ok(elementIds.has(id), id);
      const sel = selectedInputs(ports, geom.wires, p.wires);
      for (const [mux, signal] of [['am', 'AdrSrc'], ['sam', 'ALUSrcA'], ['sbm', 'ALUSrcB'], ['rm', 'ResultSrc']]) {
        if (sel.has(mux)) assert.equal(sel.get(mux), s[signal], `${STATES[s.state]}: ${mux}`);
      }
      if (sel.has('ra1m')) assert.equal(sel.get('ra1m'), s.RegSrc & 1);
      if (sel.has('ra2m')) assert.equal(sel.get('ra2m'), s.RegSrc >> 1);
      const st = STATES[s.state];
      if (['Fetch', 'MemRead'].includes(st) || s.MemWrite) assert.ok(sel.has('am'), `${st}: the memory is addressed`);
      if (s.PCWrite || (s.RegWrite && s.Rd !== 15)) assert.ok(sel.has('rm'), `${st}: Result is written`);
      if (!s.MemWrite) assert.ok(!p.wires.has('wd_mem'));
      if (!s.PCWrite) assert.ok(!p.wires.has('res_pc'));
      n += 1;
    }
  }
  assert.ok(n > 150, `${n} cycles`);
});

// --- the Extended drawing (content/armv7/geometry/multi-extended.json; A3-Q3 to A3-Q5) --------------------------------
const gx = JSON.parse(readFileSync(new URL('../content/armv7/geometry/multi-extended.json', import.meta.url), 'utf8'));
const xWires = new Set(gx.wires.map((w) => w.id));
const xElements = new Set(gx.elements.map((e) => e.id));

test('Extended: every connection has a width, the junction dots match, no text collides', () => {
  for (const w of gx.wires) {
    if (['const15', 'const4', 'const14'].includes(w.signal)) continue;
    assert.ok(wireWidth(w.signal, w.style, MULTI_EXT_INFO) !== null, `${w.id}: ${w.signal}`);
  }
  for (const c of gx.control) assert.ok(MULTI_EXT_INFO[c.signal], c.signal);
  assert.deepEqual(checkJunctions(gx.wires, gx.junctions, gx.control), { wrong: [], missing: [] });
  assert.deepEqual(collisions(gx), []);
});

test('Extended: the base drawing\'s parts are all there, spread to the right in order, with the added parts', () => {
  const replaced = new Set(['rd_data', 'wd_sb', 'ins_rd']); // connections the added parts take the place of
  for (const w of geom.wires) if (!replaced.has(w.id)) assert.ok(xWires.has(w.id) || ['cu_regw', 'cxd_regw'].includes(w.id), w.id);
  for (const e of geom.elements) assert.ok(xElements.has(e.id), e.id);
  const order = (g) => g.elements.filter((e) => geom.elements.some((b) => b.id === e.id) && e.id !== 'rm' && e.id !== 'g_regw')
    .sort((a, b) => a.at[0] - b.at[0] || a.id.localeCompare(b.id)).map((e) => e.id);
  assert.deepEqual(order(gx), order(geom), 'left-to-right order kept');
  for (const id of ['byte', 'dsm', 'wa3m', 'sh', 'nw_bub']) assert.ok(xElements.has(id), id);
  assert.equal(gx.elements.find((e) => e.id === 'rm').type, 'mux4f');
  assert.equal(gx.elements.find((e) => e.id === 'g_regw').type, 'and3');
});

test('Extended state diagram: twelve states, Link and BranchL dashed, one arc per transition, one arrow', () => {
  assert.deepEqual(gx.fsm.states.map((s) => s.id).sort(), [...STATES_EXT].sort());
  assert.deepEqual(gx.fsm.states.filter((s) => s.selfstudy).map((s) => s.id), ['Link', 'BranchL']);
  const want = new Set();
  for (const s of STATES_EXT) {
    for (const [Op, Funct] of [[0b00, 0], [0b00, 0b100000], [0b01, 0], [0b01, 1], [0b10, 0], [0b10, 0b010000]]) {
      const n = nextStateExt(s, Op, Funct);
      if (n) want.add(`${s}>${n}`);
    }
  }
  assert.deepEqual(new Set(gx.fsm.arcs.map((a) => `${a.from}>${a.to}`)), want);
  assert.equal(gx.fsm.arcs.filter((a) => a.arrow).length, 1);
});

const PROGRAMS_EXT = [
  'MOV R0, #12\nMOV R1, #18\nBL gcd\nMOV R3, R0, LSL #2\nMOV R4, #0x80\nSTR R3, [R4, #0]\nLDRB R5, [R4, #1]\nLDR R6, [R4, #0]\n'
    + 'STR R5, [R4, #-4]\nADCS R8, R0, R1\nTST R0, #1\nMOVNE R2, #7\nB .\ngcd: CMP R0, R1\nSUBGT R0, R0, R1\nSUBLT R1, R1, R0\nBNE gcd\nMOV PC, LR\n',
  'MOVS R0, #0\nBLNE f\nBLEQ f\nANDS R1, R0, R0, LSR #1\nB .\nf: ADD R2, R2, #1\nMOV PC, LR\n',
];

test('Extended active paths: every id exists, and each multiplexer on the path passes the input its select chooses', () => {
  const ports = muxPorts(gx);
  let n = 0;
  for (const text of PROGRAMS_EXT) {
    const p = assemble([{ name: 't.s', text }], { profile: 'arm-multi', subset: 'extended' });
    assert.ok(p.ok, JSON.stringify(p.diagnostics));
    const m = new ArmMultiExt();
    m.load(p);
    for (let i = 0; i < 2000; i++) {
      const s = m.evaluate().signals;
      const path = multiPath(s, true);
      for (const id of path.wires) assert.ok(xWires.has(id), id);
      for (const id of path.elements) assert.ok(xElements.has(id), id);
      const sel = selectedInputs(ports, gx.wires, path.wires);
      for (const [mux, signal] of [['am', 'AdrSrc'], ['sam', 'ALUSrcA'], ['sbm', 'ALUSrcB'], ['rm', 'ResultSrc'], ['dsm', 'ByteSel'], ['wa3m', 'Link']]) {
        if (sel.has(mux)) assert.equal(sel.get(mux), s[signal], `${STATES_EXT[s.state]}: ${mux}`);
      }
      const st = STATES_EXT[s.state];
      if (st === 'MemRead') {
        assert.ok(sel.has('dsm'), 'MemRead: the Data multiplexer');
        assert.equal(path.wires.has('rd_dsm'), !s.ByteSel, 'MemRead: only the selected input of the Data multiplexer');
      }
      if (s.RegWrite && s.WA3 !== 15) assert.ok(sel.has('wa3m'), `${st}: the A3 multiplexer`);
      if (st === 'Link' && s.CondExDelayed) assert.ok(path.wires.has('pc_rm') && path.wires.has('c14_wa3m') && path.wires.has('alu_ao'), 'Link');
      if (!s.RegWrite) assert.ok(!path.wires.has('res_wd3'));
      n += 1;
      if (m.step() !== 'step') break;
    }
  }
  assert.ok(n > 120, `${n} cycles`);
});
