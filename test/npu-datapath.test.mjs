// npu-datapath.test.mjs -- NPU-3, the NPU view's drawing (src/arch/riscv/npu-datapath.js): the Chapter 6 datapath with
// the NPU on its data bus. The book's geometry is kept (every element, wire and control line, moved only to the right),
// every new wire carries a signal of the model or of the extension, and the active path of a cycle follows its data
// access to the NPU or to the RAM (laboratory run on the single-cycle host).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assemble } from '../src/asm/assembler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Platform } from '../src/mem/platform.js';
import { buildMemsys, defaultConfig } from '../src/mem/config.js';
import { SIGNAL_INFO } from '../src/uarch/signals.js';
import { activePath } from '../src/uarch/single-paths.js';
import { extendForNpu, NPU_DP_INFO, npuDpPath, npuDpValues, dataTarget } from '../src/arch/riscv/npu-datapath.js';
import { ROOT } from './npu-fixtures.mjs';

const G6 = JSON.parse(readFileSync(join(ROOT, 'content', 'geometry', 'ch06.json'), 'utf8'));
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));

test('the extended drawing keeps the book\'s geometry: every element, wire and control line, unchanged left of the data memory', () => {
  const before = JSON.stringify(G6);
  const x = extendForNpu(G6);
  assert.equal(JSON.stringify(G6), before, 'the input is not changed');
  for (const kind of ['elements', 'wires']) {
    for (const e of G6[kind]) {
      const y = x[kind].find((z) => z.id === e.id);
      assert.ok(y, `${kind} ${e.id} kept`);
      const pts = (o) => (kind === 'wires' ? o.points : [o.at]);
      if (pts(e).every(([px]) => px < 11.15) && e.id !== 'dm_rm') assert.deepEqual(pts(y), pts(e), `${e.id} not moved`);
    }
  }
  assert.equal(x.control.filter((c) => G6.control.some((d) => d.signal === c.signal)).length >= G6.control.length, true);
  assert.equal(x.elements.find((e) => e.id === 'rm').at[0], 12.75, 'the result multiplexer moves 1 cm right');
  const ids = [...x.elements, ...x.wires].map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids unique');
});

test('the extended drawing: every wire and control line carries a signal of the model or of the extension', () => {
  const info = { ...SIGNAL_INFO, ...NPU_DP_INFO };
  const x = extendForNpu(G6);
  for (const w of x.wires) for (const s of w.signal.split(',')) assert.ok(s in info, `${w.id}: ${s}`);
  for (const c of x.control) assert.ok(c.signal in info, `control ${c.signal}`);
  const wires = new Set(x.wires.map((w) => w.id));
  for (const id of ['dsel_rm', 'alu_npu', 'rd2_npu', 'npu_dsel']) assert.ok(wires.has(id), id);
});

test('the active path follows the data access: stores and loads of the NPU reach the NPU block, RAM loads the data memory', () => {
  const p = assemble([{ name: 'npu-mv.s', text: readFileSync(join(ROOT, 'content', 'templates', 'npu-mv.s'), 'utf8') }], { profile: 'ch06' });
  assert.ok(p.ok);
  const platform = new Platform();
  const { memsys } = buildMemsys({ ...defaultConfig(), words: 1024, devices: true }, { platform });
  const m = new SingleCycle(T6, { memsys, historyLimit: 0 });
  m.load(p);
  const wires = new Set(extendForNpu(G6).wires.map((w) => w.id));
  const seen = { npuStore: 0, npuLoad: 0, ramLoad: 0 };
  let r;
  do {
    const s = m.evaluate().signals;
    const path = npuDpPath(s, activePath(s));
    for (const id of path.wires) assert.ok(wires.has(id), `${id} is a wire of the drawing`);
    const v = npuDpValues(s);
    const t = dataTarget(s);
    if (t === 'npu') {
      assert.equal(v.sel_acc, 1);
      assert.ok(path.wires.has('alu_npu') && !path.wires.has('alu_dm') && !path.elements.has('dm'));
      if (s.MemWrite) { assert.ok(path.wires.has('rd2_npu')); seen.npuStore += 1; }
      else { assert.ok(path.wires.has('npu_dsel') && path.wires.has('dsel_rm')); assert.equal(v.acc_rdata, s.rdata >>> 0); seen.npuLoad += 1; }
    } else if (t === 'ram' && !s.MemWrite) {
      assert.equal(v.sel_ram, 1);
      assert.ok(path.wires.has('dm_rm') && path.wires.has('dsel_rm') && !path.wires.has('npu_dsel'));
      seen.ramLoad += 1;
    }
    r = m.step();
  } while (r === 'step' && m.cycle < 5000);
  assert.equal(r, 'halt');
  assert.ok(seen.npuStore >= 9 && seen.npuLoad >= 5 && seen.ramLoad >= 4, JSON.stringify(seen));
});
