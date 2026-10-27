// multi-paths.test.mjs -- the Chapter 7 drawing against the model: the
// geometry check of WS-F-072 (every connection and control stub names a
// signal of the dictionary; the signals not drawn are listed with the reason),
// the state paths of WS-F-040 (the ten states of FIG-0068 and FIG-0069 take
// the chapter's own sets; the sets of every state, drawn or derived, agree
// with its column of the state-output table), and the state diagram (every
// next-state rule of the controller has an arc, and every arc a rule).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { multiPaths, DERIVED } from '../src/uarch/multi-paths.js';
import { buildController } from '../src/uarch/multi.js';
import { MULTI_SIGNALS, MULTI_INFO } from '../src/uarch/signals.js';
import { ch07 } from './ch07-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const { geom: GEOM, t7: T7 } = ch07();

// Signals of the dictionary that the drawing does not carry, and why.
const NOT_DRAWN = {
  state: 'inside the control unit (FIG-0071, not this drawing)', next: 'inside the control unit',
  PCWrite: 'inside the control unit; the drawing shows PCEn', Branch: 'inside the control unit; the drawing shows PCEn',
  BranchTaken: 'inside the control unit; the drawing shows PCEn', ALUOp: 'inside the control unit; the drawing shows ALUCtrl',
};

test('WS-F-072: every connection and control stub of the Chapter 7 drawing names a dictionary signal', () => {
  const drawn = new Set();
  for (const w of GEOM.wires) {
    for (const s of w.signal.split(',')) {
      if (s === 'const4') { assert.equal(w.id, 'four_sb'); continue; } // the constant 4 of operand multiplexer B
      assert.ok(MULTI_INFO[s], `${w.id} carries ${s}, not in the dictionary`);
      drawn.add(s);
    }
  }
  for (const c of GEOM.control) {
    assert.equal(MULTI_INFO[c.signal]?.kind, 'control', `control stub ${c.signal}`);
    drawn.add(c.signal);
  }
  for (const s of Object.keys(NOT_DRAWN)) assert.ok(MULTI_INFO[s] && !drawn.has(s), `exemption ${s} is stale`);
  const missing = MULTI_SIGNALS.filter((s) => !drawn.has(s.name) && !(s.name in NOT_DRAWN)).map((s) => s.name);
  assert.deepEqual(missing, []);
  const ids = GEOM.wires.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'connection ids are unique');
  // net names at the open end of a connection join it to an element of that name
  for (const w of GEOM.wires) if (w.from_net) assert.ok(GEOM.elements.some((e) => e.id === w.from_net), w.id);
});

test('WS-F-040: the drawn states take the chapter\'s sets; FIG-0068 and FIG-0069 are their unions', () => {
  const path = multiPaths(GEOM);
  for (const [state, wires] of Object.entries(GEOM.steps)) {
    assert.deepEqual([...path(state, { PCEn: 1 }).wires].sort(), wires, state);
  }
  for (const id of ['FIG-0068', 'FIG-0069']) {
    const f = GEOM.figures[id];
    const union = new Set(f.steps.flatMap((s) => GEOM.steps[s]));
    assert.deepEqual([...union].sort(), f.highlight, id);
  }
  for (const s of Object.keys({ ...DERIVED, ...GEOM.derived })) assert.ok(!(s in GEOM.steps), `${s} is drawn in the book now; use the book's set`);
});

// What a connection says about the state that uses it, as the state-output table must allow.
const NEEDS = {
  pc_sa: { ALUSrcA: '00' }, ipc_sa: { ALUSrcA: '01' }, rs1_sa: { ALUSrcA: '10' },
  rs2_sb: { ALUSrcB: '00' }, four_sb: { ALUSrcB: '01' }, imm_sb: { ALUSrcB: '10' },
  aq_rm: { ResultSel: '00' }, mdr_rm: { ResultSel: '01' }, aluy_rm: { ResultSel: '10' }, pc_rm: { ResultSel: '11' },
  pc_am: { AddrSel: '0' }, aq_am: { AddrSel: '1' }, mem_ir: { IRWrite: '1' }, pc_ipc: { IRWrite: '1' },
  rs2_mem: { MemWrite: '1' }, res_rf: { RegWrite: '1' }, flags: { Branch: '1' },
};

test('WS-F-040: every state path, drawn or derived, agrees with the state-output table', () => {
  const path = multiPaths(GEOM);
  for (const col of T7.state_outputs.columns) {
    const v = col.values;
    const w = path(col.state, { PCEn: 1 }).wires;
    for (const [id, need] of Object.entries(NEEDS)) {
      if (!w.has(id)) continue;
      for (const [sig, val] of Object.entries(need)) assert.equal(v[sig], val, `${col.state} uses ${id}: ${sig}`);
    }
    if (w.has('res_pc')) assert.ok(v.PCWrite === '1' || v.Branch === '1', `${col.state} uses res_pc`);
    // and the converse: every enable that is 1 has its connection
    if (v.PCWrite === '1' || v.Branch === '1') assert.ok(w.has('res_pc'), `${col.state} writes the PC`);
    if (v.RegWrite === '1') assert.ok(w.has('res_rf'), `${col.state} writes a register`);
    if (v.MemWrite === '1') assert.ok(w.has('rs2_mem') && w.has('aq_am'), `${col.state} writes the memory`);
    if (v.IRWrite === '1') assert.ok(w.has('mem_ir') && w.has('pc_ipc'), `${col.state} writes ir`);
    // every highlighted connection exists; every state has a tag
    for (const id of w) assert.ok(GEOM.wires.some((x) => x.id === id), `${col.state}: ${id}`);
    assert.ok(path(col.state, { PCEn: 1 }).tags.length > 0, `${col.state} has a tag`);
  }
  const nt = path('BRANCH', { PCEn: 0 });
  assert.ok(!nt.wires.has('res_pc') && nt.wires.has('flags'), 'a branch not taken does not reach the PC');
});

test('WS-F-041: the state diagram has an arc for every next-state rule, and no other', () => {
  const ctl = buildController(T7, { jalr: true });
  const arcs = new Set(GEOM.fsm.arcs.map((a) => `${a.from}>${a.to}`));
  const rules = new Set(T7.transitions.map((r) => `${r.from}>${r.to}`));
  assert.deepEqual([...arcs].sort(), [...rules].sort());
  assert.deepEqual(GEOM.fsm.states.map((s) => s.id).sort(), [...ctl.states].sort());
  for (const s of GEOM.fsm.states) assert.equal(Boolean(s.selfstudy), ['LUI', 'AUIPC', 'JALR'].includes(s.id), s.id);
});

test('W-D20: without content/data/ch07-jalr.json (a release) nothing of the JALR answer remains, and the diagram matches the rules', () => {
  for (const p of ['content/geometry/ch07.json', 'content/data/ch07-tables.json']) {
    const text = readFileSync(join(ROOT, p), 'utf8');
    assert.ok(!/"answer"|"source": "exr:mc-jalr|"junctions_jalr"|"id": "JALR"/.test(text), `${p} holds part of the JALR answer`);
  }
  const { geom, t7, jalrAvailable } = ch07({ jalr: false });
  assert.equal(jalrAvailable, false);
  const ctl = buildController(t7, { jalr: true });
  assert.ok(!ctl.states.includes('JALR'));
  assert.deepEqual(geom.fsm.arcs.map((a) => `${a.from}>${a.to}`).sort(),
    [...new Set(t7.transitions.map((r) => `${r.from}>${r.to}`))].sort());
  assert.equal(multiPaths(geom)('JALR').wires.size, 0);
  // the merge does not change its inputs
  assert.ok(!read('content/data/ch07-tables.json').state_outputs.columns.some((c) => c.state === 'JALR'));
});
