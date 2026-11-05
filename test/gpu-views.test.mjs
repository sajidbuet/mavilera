// The views of the GPU module's RISC-V SIMT core (GPU-3, gate V; tests S12-S14 of docs/research/gpu-npu/verification/
// GOLDEN_TESTS.md). The view model (src/arch/gpu/rvsimt/core-model.js) runs the book's laboratory programs to their
// golden.hex through its export protocol; its mask grid under the masks-only filter gives FIG-0109's MASKS line for
// ifelse8 (S12); its stack rows give FIG-0215's rows (S13); its counters give FIG-0218's values (S14). The figure data
// are those of content/geometry/ch11a-gpu.json, exported from the book's generators (tools/export_ch11a.py); the
// export's own check runs when the book branch is at hand (MES_BOOK). Step back through the model is exact.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assemble } from '../src/arch/gpu/rvsimt/language.js';
import { CoreModel, exportModel, golden, maskRows, setupIssues, stackRows, results, waveSignals, lanes0 } from '../src/arch/gpu/rvsimt/core-model.js';
import { MicroModel, microMaskRows, microExportModel } from '../src/arch/gpu/mask-model.js';
import { assemble as microAssemble } from '../src/arch/gpu/language.js';
import { withVariant } from '../src/arch/contract.js';
import { descriptor } from '../src/arch/gpu/index.js';

const gpu = await withVariant(descriptor, 'microisa');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = join(ROOT, 'test', 'fixtures', 'gpu', 'lab');
const GEO = JSON.parse(readFileSync(join(ROOT, 'content', 'geometry', 'ch11a-gpu.json'), 'utf8'));
const PROGRAMS = ['uniform', 'ifelse', 'ifelse8', 'nested', 'vadd_tail', 'reverse_bar', 'fault_div', 'fault_join'];
const profileOf = (p) => (p === 'ifelse8' ? 'lab-l8' : 'lab');
const prog = (p) => {
  const a = assemble([{ name: 'prog.s', text: readFileSync(join(FIX, p, 'prog.s'), 'utf8') }], { profile: profileOf(p) });
  assert.ok(a.ok, JSON.stringify(a.diagnostics));
  // the testbench loads data.hex into the data memory from address 0
  const data = readFileSync(join(FIX, p, 'data.hex'), 'utf8').split(/\s+/).filter(Boolean).map((t) => parseInt(t, 16) >>> 0);
  const bytes = new Uint8Array(data.length * 4);
  data.forEach((v, i) => { for (let b = 0; b < 4; b++) bytes[4 * i + b] = (v >>> (8 * b)) & 255; });
  return { ...a, segments: [...a.segments.filter((s) => s.executable), { address: 0, bytes, executable: false }] };
};
const runAll = (program) => { const m = new CoreModel(program); while (m.step() === 'step'); return m; };

for (const p of PROGRAMS) {
  test(`the view model's golden dump of ${p} equals its golden.hex, through the export protocol`, () => {
    const { model, signals } = exportModel(prog(p), 'core');
    const names = new Set(signals.map((s) => s.name));
    for (const k of Object.keys(model.evaluate().signals)) assert.ok(names.has(k), `signal ${k} declared`);
    assert.equal(model.run(100_000), 'halt');
    assert.equal(golden(model).text, readFileSync(join(FIX, p, 'golden.hex'), 'utf8').replace(/\r\n/g, '\n'));
    assert.equal(golden(model).count, 260);
  });
}

test('S12: ifelse8 under the masks-only filter gives FIG-0109\'s MASKS and states what it hides', () => {
  const m = runAll(prog('ifelse8'));
  const program = prog('ifelse8');
  const setup = setupIssues(m.issues);
  const { rows, hidden } = maskRows(m.issues, { program, lanes: 8, masksOnly: true, setup });
  assert.deepEqual(rows.map((r) => r.mask), GEO.grid.rows.map((r) => r.mask));
  assert.deepEqual(rows.map((r) => r.count), GEO.grid.rows.map((r) => r.count));
  assert.equal(rows.map((r) => r.mask).join(' '), '11111111 01100100 01100100 01100100 10011011 10011011 11111111');
  // csrr, lw, lw, csrr, slli, add, add, lw before slt; split, two joins, tmc; beqz twice and j
  assert.deepEqual(hidden, { setup: 8, control: 4, branch: 3 });
  assert.equal(rows.length + 8 + 4 + 3, m.issues.length);
  // without the filter every issue is a row
  assert.equal(maskRows(m.issues, { program, lanes: 8, setup }).rows.length, m.issues.length);
  assert.deepEqual(GEO.grid.x, [4, -1, -6, 3, 0, -2, 7, 5]);
});

test('S13: the stack rows of ifelse8 from slt to the store after join equal FIG-0215', () => {
  const program = prog('ifelse8');
  const m = runAll(program);
  const rows = stackRows(m.issues, { program, lanes: 8 });
  const from = rows.findIndex((r) => r.text.startsWith('slt'));
  const to = rows.findIndex((r, i) => i > from && r.text.startsWith('sw'));
  const mine = rows.slice(from, to + 1).map((r) => ({ text: r.text, mask: r.mask, pc: r.pc, stack: r.stack }));
  assert.equal(mine.length, 13);
  assert.deepEqual(mine, GEO.stack.rows);
});

test('S14: the counters of the five laboratory programs equal FIG-0218', () => {
  assert.equal(GEO.results.lanes, 4);
  assert.deepEqual(Object.keys(GEO.results.programs), ['uniform', 'ifelse', 'nested', 'vadd_tail', 'reverse_bar']);
  for (const [p, want] of Object.entries(GEO.results.programs)) {
    const r = results(runAll(prog(p)).c);
    assert.deepEqual({ cycles: r.cycles, issued: r.issued, active: r.active }, want, p);
    assert.equal(r.slots, 4 * want.issued);
  }
});

test('step back through the view model is exact (state, issue log, preview)', () => {
  for (const p of PROGRAMS) {
    const m = new CoreModel(prog(p));
    const snap = () => JSON.stringify({ r: m.registers(), d: [...m.c.dmem], e: m.evaluate().signals, n: m.issues.length });
    const seen = [];
    for (;;) {
      seen.push(snap());
      if (m.step() !== 'step') break;
    }
    seen.pop(); // the state after the last issue
    while (seen.length) { assert.ok(m.back()); assert.equal(snap(), seen.pop(), p); }
    assert.equal(m.back(), false);
  }
});

test('the preview of the coming issue: split predicate, branch outcome, results gated by the mask', () => {
  const program = prog('ifelse8');
  const m = new CoreModel(program);
  let e;
  for (;;) { e = m.evaluate().issue; if (e.op === 'split') break; m.step(); }
  assert.equal(lanes0(e.pred, 8), '01100100');
  m.step();
  e = m.evaluate().issue; // beqz under the then-mask: not taken
  assert.equal(e.op, 'beq');
  assert.equal(e.taken, 0);
  m.step();
  e = m.evaluate().issue; // sub t2, zero, t1 on lanes 1, 2, 5
  assert.equal(e.op, 'sub');
  assert.deepEqual(e.result.map((v) => (v === null ? null : v | 0)), [null, 1, 6, null, null, 2, null, null]);
  assert.deepEqual(waveSignals(8, 1).map((s) => s.name).slice(0, 5), ['warp', 'pc', 'instr', 'mask', 'active']);
});

// --- the micro-ISA's mask views (decision G23) -------------------------------------------------------------------
const micro = (file, profile) => {
  const p = microAssemble([{ name: file, text: readFileSync(join(ROOT, 'content', 'gpu', 'templates', file), 'utf8') }], { profile });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};

test('G9: the eight-lane template warp8 under the masks-only filter gives FIG-0109\'s MASKS', () => {
  const program = micro('warp8.simt', 'simt8');
  const m = new MicroModel(program);
  while (m.step() === 'step');
  assert.ok(m.halted);
  const { rows, hidden } = microMaskRows(m.issues, { program, lanes: 8, masksOnly: true });
  assert.equal(rows.map((r) => r.mask).join(' '), GEO.grid.rows.map((r) => r.mask).join(' '));
  assert.deepEqual(hidden, { setup: 1, control: 3, branch: 0 }); // LDI; ELSE, ENDIF, HALT
  assert.deepEqual(rows.map((r) => r.op), ['IFLT', 'SUB', 'ADD', 'SUB', 'ADD', 'ADD', 'ADD']);
  // while it runs, the setup is already known (no branches): the first row shown is the compare
  const n = new MicroModel(program);
  n.step(); n.step();
  assert.deepEqual(microMaskRows(n.issues, { program, lanes: 8, masksOnly: true }).rows.map((r) => r.op), ['IFLT']);
});

test('the micro-ISA mask model: same registers as the engine every cycle, exact step back, golden dump', () => {
  for (const [file, profile] of [['abs.simt', 'simt4'], ['nested.simt', 'simt4'], ['clamp8.simt', 'simt8'], ['warp8.simt', 'simt8']]) {
    const program = micro(file, profile);
    const e = gpu.engine.create(program);
    const m = new MicroModel(program);
    const snaps = [];
    for (;;) {
      const s = e.state().registers;
      const sig = m.evaluate().signals;
      for (const k of ['pc', 'active_mask', 'stack0', 'stack1', 'cycles', 'idle_slots', 'done']) assert.equal(sig[k], s[k], `${file} ${k}`);
      snaps.push(JSON.stringify(sig));
      if (m.step() !== 'step') break;
      e.step();
    }
    snaps.pop();
    while (snaps.length) { assert.ok(m.back()); assert.equal(JSON.stringify(m.evaluate().signals), snaps.pop(), file); }
    const x = microExportModel(program, 'x');
    assert.equal(x.model.run(1000), 'halt');
    const lines = golden(x.model).text.trim().split('\n');
    assert.equal(lines.length, x.model.lanes + 3);
    const st = x.model.st;
    assert.deepEqual(lines.map((t) => parseInt(t, 16) | 0), [...[...Array(x.model.lanes)].map((_, l) => st.regs[l * 4 + 2] | 0), st.cycles, st.idle, st.active]);
    for (const k of Object.keys(x.model.evaluate().signals)) assert.ok(x.signals.some((s) => s.name === k), k);
  }
});

const BOOK = process.env.MES_BOOK_FIGS ?? join(ROOT, '..', 'book-MES-ch11a-fig');
const noBook = existsSync(join(BOOK, 'code', 'chapter11a', 'make_fig_core.py')) ? false
  : `the book's generators are not at ${BOOK} (set MES_BOOK_FIGS to a checkout of fig/ch11a-gpu-generators)`;
test('content/geometry/ch11a-gpu.json is what the book\'s generators export', { skip: noBook }, () => {
  const r = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', 'tools/export_ch11a.py', '--book', BOOK, '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
