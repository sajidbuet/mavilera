// schematic.test.mjs -- the shared conventions of the processor drawings (src/ui/schematic.js,
// docs/ui/datapath-schematics.md) on the three RISC-V drawings: every connection's width comes from
// the model's signal dictionary; the bundles add up; each bus-width marker carries its net's width,
// one per net, clear of every text, element, junction, connection and other marker; the junction
// dots agree with connectivity; the multiplexer input numbers locate the ports. The overlaps of the
// book's geometry and the connections too short for a marker are recorded in
// test/fixtures/drawing-review.json (a list for the book's figure generators); a change shows here.
//   node --test test/schematic.test.mjs            (UPDATE_REVIEW=1 rewrites the fixture)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  wireWidth, nets, placeMarkers, muxPorts, selectedInputs, checkJunctions, collisions, texts,
  elementOutline, boxHitsPolygon, overlap, onPolyline,
} from '../src/ui/schematic.js';
import { SIGNAL_INFO, MULTI_INFO } from '../src/uarch/signals.js';
import { Multicycle } from '../src/uarch/multi.js';
import { assemble } from '../src/asm/assembler.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const geometry = (p) => JSON.parse(readFileSync(join(ROOT, 'content/geometry', `${p}.json`), 'utf8'));
const DRAWINGS = { ch06: SIGNAL_INFO, ch07: MULTI_INFO, ch08: SIGNAL_INFO };
const REVIEW = join(ROOT, 'test/fixtures/drawing-review.json');

/** Markers as datapath.js places them: the drawing's nets and stubs, then each variant's. */
function markersOf(p) {
  const g = geometry(p);
  const info = DRAWINGS[p];
  const widthOf = (w) => wireWidth(w.signal, w.style, info);
  const stubWidth = (c) => info[c.signal]?.width ?? null;
  return { g, widthOf, ...placeMarkers(g, widthOf, { stubs: g.control, stubWidth }) };
}

test('every connection has a width from the signal dictionary (the constant 4 of Chapter 7 excepted)', () => {
  for (const [p, info] of Object.entries(DRAWINGS)) {
    const g = geometry(p);
    const wires = [...g.wires, ...Object.values(g.variants ?? {}).flatMap((v) => v.wires)];
    const unknown = [...new Set(wires.filter((w) => wireWidth(w.signal, w.style, info) === null).map((w) => w.signal))];
    assert.deepEqual(unknown, p === 'ch07' ? ['const4'] : [], p);
    for (const c of g.control) assert.ok(info[c.signal], `${p}: control ${c.signal} in the dictionary`);
  }
});

test('widths: buses, fields, flags and the control bundles of the pipeline registers', () => {
  const w = (p, id) => {
    const g = geometry(p);
    const x = g.wires.find((y) => y.id === id);
    return wireWidth(x.signal, x.style, DRAWINGS[p]);
  };
  assert.equal(w('ch06', 'imem_bus'), 32);
  assert.equal(w('ch06', 'ins_rs1'), 5);
  assert.equal(w('ch06', 'alu_flags'), 3, 'zero, lt, ltu: three flags');
  assert.equal(w('ch07', 'irb_cu'), 11, 'op, funct3, funct7b5: 7 + 3 + 1');
  assert.equal(w('ch07', 'res_pc'), 32, 'result reaches the PC as pc_next: one 32-bit bus under two names');
  // ID/EX takes RegWrite, ALUSrc, MemWrite, ResultSel (2), Branch, Jump, TargetSrc, ALUCtrl (4);
  // EX/MEM RegWrite, MemWrite, ResultSel; MEM/WB RegWrite, ResultSel (src/uarch/pipe.js)
  assert.equal(w('ch08', 'ctl_id'), 12);
  assert.equal(w('ch08', 'ctl_ex'), 4);
  assert.equal(w('ch08', 'ctl_mem'), 3);
});

test('Chapter 7: result and pc_next, drawn as one bus, are both 32 bits and differ only in bit 0', () => {
  const t6 = JSON.parse(readFileSync(join(ROOT, 'content/data/ch06-tables.json'), 'utf8'));
  const t7 = JSON.parse(readFileSync(join(ROOT, 'content/data/ch07-tables.json'), 'utf8'));
  const m = new Multicycle(t6, t7);
  m.load(assemble('  addi x1, x0, 8\n  jalr x2, 1(x1)\n  halt\n'));
  for (let i = 0; i < 20 && !m.halted; i++) {
    const s = m.evaluate().signals;
    assert.equal(s.pc_next >>> 0, (s.result & ~1) >>> 0);
    m.step();
  }
});

test('markers: the net width, one per net, near the source, clear of texts, elements, junctions and each other', () => {
  for (const p of Object.keys(DRAWINGS)) {
    const { g, widthOf, markers } = markersOf(p);
    const textBoxes = texts(g).map((t) => t.box);
    const outlines = g.elements.map((e) => elementOutline(g, e));
    const netOf = new Map(nets(g.wires).flatMap((n, i) => n.map((w) => [w.id, i])));
    const seen = new Set();
    for (const m of markers) {
      const where = `${p} ${m.wire ?? m.stub.signal}`;
      if (m.wire) {
        const w = g.wires.find((x) => x.id === m.wire);
        assert.equal(m.width, widthOf(w), where);
        assert.ok(onPolyline(m.at, w.points), `${where}: on its connection`);
        assert.ok(!seen.has(netOf.get(m.wire)), `${where}: one marker per net`);
        seen.add(netOf.get(m.wire));
      } else {
        assert.equal(m.width, DRAWINGS[p][m.stub.signal].width, where);
      }
      assert.ok(m.width > 1, `${where}: no marker on a single bit`);
      assert.ok(textBoxes.every((b) => overlap(m.number.box, b) === 0), `${where}: number clear of the texts`);
      assert.ok(outlines.every((o) => !boxHitsPolygon(m.number.box, o) && !boxHitsPolygon(m.slash, o)), `${where}: clear of the elements`);
      assert.ok(g.junctions.every((j) => Math.hypot(j[0] - m.at[0], j[1] - m.at[1]) >= 0.15 - 1e-9), `${where}: clear of the junctions`);
      for (const o of markers) if (o !== m) assert.equal(overlap(m.number.box, o.number.box), 0, `${where}: numbers apart`);
    }
  }
});

test('markers: the register-file ports, the ALU operands and the write-back carry theirs', () => {
  const has = (p, ids) => {
    const { markers } = markersOf(p);
    for (const id of ids) assert.ok(markers.some((m) => m.wire === id || m.stub?.signal === id), `${p}: ${id}`);
  };
  has('ch06', ['imem_bus', 'ins_rs1', 'ins_rs2', 'ins_rd', 'rd1_alu', 'rd2_bm', 'result_rf', 'alu_rm', 'dm_rm', 'ALUCtrl', 'ResultSel', 'ImmSel']);
  has('ch07', ['mem_ir', 'irb_cu', 'imm_sb', 'res_pc', 'ALUSrcA', 'ALUSrcB', 'ResultSel', 'ALUCtrl']);
  has('ch08', ['ins_rs1', 'ins_rs2', 'ins_rd', 'rs1_fa', 'rs2_fb', 'result_rf', 'ctl_ex', 'fwd_sel_a', 'fwd_sel_b']);
});

test('junction dots agree with connectivity: none misplaced, none missing', () => {
  for (const p of Object.keys(DRAWINGS)) {
    const g = geometry(p);
    assert.deepEqual(checkJunctions(g.wires, g.junctions, g.control), { wrong: [], missing: [] }, p);
  }
  // a branch without a dot, and a dot on a lone wire
  const w = [{ signal: 's', points: [[0, 0], [2, 0]] }, { signal: 's', points: [[1, 0], [1, 1]] }];
  assert.deepEqual(checkJunctions(w, [[3, 3]]), { wrong: [[3, 3]], missing: [[1, 0]] });
});

test('multiplexer ports: the input numbers locate the ports; the active wire into one selects it', () => {
  const g = geometry('ch06');
  const ports = muxPorts(g);
  const bm = ports.get('bm');
  assert.deepEqual(bm.map((q) => q.index), [0, 1]);
  const into1 = g.wires.find((w) => w.id === 'imm_bm');
  assert.deepEqual(into1.points.at(-1), bm[1].at, 'imm reaches input 1 of the ALUSrc multiplexer');
  assert.equal(selectedInputs(ports, g.wires, new Set(['imm_bm'])).get('bm'), 1);
  assert.equal(selectedInputs(ports, g.wires, new Set(['rd2_bm'])).get('bm'), 0);
  assert.equal(selectedInputs(ports, g.wires, new Set()).size, 0);
  for (const p of Object.keys(DRAWINGS)) {
    const gp = geometry(p);
    for (const [id, list] of muxPorts(gp)) {
      const ins = [...gp.wires, ...Object.values(gp.variants ?? {}).flatMap((v) => v.wires)].filter((w) => list.some((q) => Math.hypot(q.at[0] - w.points.at(-1)[0], q.at[1] - w.points.at(-1)[1]) < 1e-6));
      assert.ok(ins.length >= 1, `${p} ${id}: a connection ends on a port`);
    }
  }
});

test('review list: overlaps of the book geometry and connections too short for a marker (fixture)', () => {
  const now = { _copyright: 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.',
    _source: 'UPDATE_REVIEW=1 node --test test/schematic.test.mjs; for the book figure generators (WS-F-071)' };
  for (const p of Object.keys(DRAWINGS)) now[p] = { collisions: collisions(geometry(p)), unmarked: markersOf(p).unplaced };
  if (process.env.UPDATE_REVIEW) writeFileSync(REVIEW, `${JSON.stringify(now, null, 1)}\n`);
  const was = JSON.parse(readFileSync(REVIEW, 'utf8'));
  for (const p of Object.keys(DRAWINGS)) assert.deepEqual(now[p], was[p], `${p}: run with UPDATE_REVIEW=1 after checking the change`);
});
