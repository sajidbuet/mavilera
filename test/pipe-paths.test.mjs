// pipe-paths.test.mjs -- the Chapter 8 drawing (content/geometry/ch08.json)
// against the model: the geometry check of WS-F-072 (every connection and
// control stub names a signal of the dictionary; the data signals that are
// not drawn are listed with the reason), and the per-stage paths of
// WS-F-050/052 (every connection they name exists; a bubble uses nothing;
// the forwarding feeds light up exactly when a forwarding select picks them).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { pipePaths } from '../src/uarch/pipe-paths.js';
import { PIPE_SIGNALS, SIGNAL_INFO } from '../src/uarch/signals.js';
import { program } from './programs-ch08.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const TABLES = read('content/data/ch06-tables.json');
const GEOM = read('content/geometry/ch08.json');

// Signals of the dictionary that the drawing does not carry, and why.
const NOT_DRAWN = {
  // the branch-history table and the prediction carried with the instruction (the adder,
  // B-immediate and choice are drawn in the variant 'predictor')
  predict_taken: 'IF', pred_id: 'IF', pred_ex: 'IF',
  // decode inside the decoders block and the hazard-unit inputs (FIG-0019, not this drawing)
  op_id: 'ID', funct3_id: 'ID', funct7b5_id: 'ID', uses_rs1: 'ID', uses_rs2: 'ID', ImmSel_id: 'ID', ALUOp_id: 'ID',
  rs1_ex: 'hazard', rs2_ex: 'hazard', funct3_ex: 'EX', MemRead_ex: 'hazard', MemRead_mem: 'hazard',
  // branch logic and the redirect selection inside the Branch block
  BranchTaken_ex: 'EX', taken_ex: 'EX', target_sum_ex: 'EX', pc_redirect_ex: 'EX', Branch_ex: 'EX', Jump_ex: 'EX',
  // the instruction words travel with each stage in the RTL; the drawing shows the fields
  instr_ex: 'EX', instr_mem: 'MEM', instr_wb: 'WB',
  // stall and flush: marks on the registers (WS-F-052), not connections
  stall_if: 'marks', stall_id: 'marks', flush_id: 'marks', flush_ex: 'marks',
};

test('WS-F-072: every connection and control stub of the Chapter 8 drawing names a dictionary signal', () => {
  const drawn = new Set();
  const variant = GEOM.variants.predictor;
  for (const w of [...GEOM.wires, ...variant.wires]) {
    for (const s of w.signal.split(',')) {
      assert.ok(SIGNAL_INFO[s], `${w.id} carries ${s}, not in the dictionary`);
      drawn.add(s);
    }
  }
  for (const c of [...GEOM.control, ...variant.control]) {
    assert.equal(SIGNAL_INFO[c.signal]?.kind, 'control', `control stub ${c.signal}`);
    drawn.add(c.signal);
  }
  for (const s of Object.keys(NOT_DRAWN)) assert.ok(SIGNAL_INFO[s] && !drawn.has(s), `exemption ${s} is stale`);
  const missing = PIPE_SIGNALS.filter((s) => !drawn.has(s.name) && !(s.name in NOT_DRAWN)).map((s) => s.name);
  assert.deepEqual(missing, []);
  for (const id of variant.hide) assert.ok(GEOM.wires.some((w) => w.id === id), `variant hides ${id}`);
  const ids = [...GEOM.wires, ...variant.wires].map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, 'connection ids are unique');
  for (const e of [...GEOM.elements, ...variant.elements]) assert.ok(e.size || GEOM.pics[e.type], `${e.id}: shape ${e.type}`);
});

test('WS-F-050/052: the stage paths name connections of the drawing; bubbles use nothing; feeds follow the selects', () => {
  const V = GEOM.variants.predictor;
  const used = new Set();
  const configs = [['full', 'none', false], ['memwb', 'none', false], ['none', 'none', false], ['full', '2bit', false], ['full', '1bit', true]];
  for (const [hazard, predictor, early] of configs) {
    const drawn = predictor !== 'none';
    const wires = new Set([...GEOM.wires.map((w) => w.id).filter((id) => !(drawn && V.hide.includes(id))), ...(drawn ? V.wires.map((w) => w.id) : [])]);
    const elements = new Set([...GEOM.elements, ...(drawn ? V.elements : [])].map((e) => e.id));
    for (let seed = 1; seed <= 6; seed++) {
      const m = new Pipeline(TABLES, { hazard, predictor, early, checks: false });
      m.load(assemble(program(seed * 31337, 8), { profile: 'ch08' }));
      for (let k = 0; k < 400; k++) {
        const s = m.evaluate().signals;
        const p = pipePaths(s, { predictor: drawn, early });
        for (const w of p.wires) { assert.ok(wires.has(w), `${w} not in the drawing`); used.add(w); }
        for (const e of p.elements) assert.ok(elements.has(e), `${e} not in the drawing`);
        for (const st of ['ID', 'EX', 'MEM']) {
          if (s[`instr_${st.toLowerCase()}`] === 0) assert.equal(p.stages[st].size, 0, `${st} bubble`);
        }
        assert.equal(p.wires.has('mem_fa'), s.fwd_sel_a === 2 && (p.wires.has('fa_alu') || p.wires.has('rs1_tm')));
        assert.equal(p.wires.has('wb_fa'), s.fwd_sel_a === 1 && (p.wires.has('fa_alu') || p.wires.has('rs1_tm')));
        if (m.step() !== 'step') break;
      }
    }
  }
  // every connection of the drawing is used by some instruction (the drawing has nothing extra)
  const all = [...GEOM.wires, ...V.wires].map((w) => w.id);
  assert.deepEqual(all.filter((w) => !used.has(w)).sort(), []);
});
