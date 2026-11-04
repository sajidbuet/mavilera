// npu-views.test.mjs -- NPU-3, the NPU tab (gate V): the drawings' geometry as exported from the book's generator
// (every wire bound to a model signal; the source recorded), the signals of a cycle and the connections they make
// active on a laboratory run, the processing element's values against the registers of the next cycle, the bus log
// over a back-step, and the array explorer's 2 x 2 example against the PSUM line of the book's step-panel figure.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { assemble } from '../src/asm/assembler.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Platform } from '../src/mem/platform.js';
import { buildMemsys, defaultConfig } from '../src/mem/config.js';
import { parseHexWords } from '../src/shell/data-io.js';
import { Npu, NPU_BASE, npuEdge, npuReset, npuSignalInfo, npuSignals, runArray } from '../src/mem/npu.js';
import { wireWidth } from '../src/ui/schematic.js';
import { figureExample, panelModel, parseRows, peValues, recentBus, REGIONS, regionBox, registerBoundaries,
  subsystemTransfers, peTransfers, systemFlow, npuAccess } from '../src/ui/npu-view.js';
import { ROOT } from './npu-fixtures.mjs';

const GEOM = JSON.parse(readFileSync(join(ROOT, 'content', 'geometry', 'ch11-npu.json'), 'utf8'));
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
// the PSUM line of the book's figure (FIG-0113 header): PE00 PE01 PE10 PE11 at the end of steps 0..3
const PSUM = '10 0 0 0 | 0 15 12 0 | 0 0 0 7 | 0 0 0 0';
const GENERATOR = 'code/chapter11/make_fig_npu.py';
const BOOK = [process.env.MES_BOOK, process.env.BOOK_MES, join(ROOT, '..', 'book-MES'), join(ROOT, '..', 'book-MES-ch11fig')]
  .find((p) => p && existsSync(join(p, GENERATOR))) ?? null;

const parts = () => [['subsystem', GEOM.subsystem, GEOM.subsystem.n], ...Object.values(GEOM.array).map((a) => [`array N = ${a.n}`, a, a.n])];

test('NPU geometry: the book generator\'s export, with its source recorded', () => {
  assert.match(GEOM._copyright, /Apache License, Version 2\.0/);
  assert.equal(GEOM._source.exported_by, 'tools/export_ch11.py');
  for (const f of [GENERATOR, 'figures/FIG-0113.tex', 'figures/FIG-0114.tex', 'config/tikz-styles.tex']) {
    assert.match(GEOM._source.files[f] ?? '', /^[0-9a-f]{64}$/, f);
  }
  assert.equal(GEOM.units, 'cm');
  assert.deepEqual(Object.keys(GEOM.array), ['2', '3', '4']);
  assert.equal(GEOM.subsystem.elements.filter((e) => e.type === 'pe').length, 16);
  for (const [name, g] of parts()) {
    const ids = [...g.elements.map((e) => e.id), ...g.wires.map((w) => w.id)];
    assert.equal(new Set(ids).size, ids.length, `${name}: ids unique`);
  }
});

test('NPU geometry: every drawn wire carries a signal of the model\'s dictionary (no visual-only connection)', () => {
  for (const [name, g, n] of parts()) {
    const info = npuSignalInfo(n);
    for (const w of g.wires) {
      assert.ok(w.signal, `${name} ${w.id}: no signal`);
      for (const s of w.signal.split(',')) assert.ok(info[s], `${name} ${w.id}: ${s} is not a model signal`);
    }
  }
  // the bus-width markers: the d_ bus is 32 bits wide, the weights 4 x 32, the activations 4 x 8
  const info = npuSignalInfo(4);
  const w = (id) => { const x = GEOM.subsystem.wires.find((q) => q.id === id); return wireWidth(x.signal, x.style, info); };
  assert.deepEqual([w('d_bus'), w('weights'), w('abuf_skew'), w('sums_rbuf'), w('skew_r0'), w('sum0')], [32, 128, 32, 128, 8, 32]);
});

test('NPU geometry: equal to a fresh export from the book\'s generator (when the book repository is present)', { skip: !BOOK && 'no book checkout with the generator' }, () => {
  const r = spawnSync('python', ['-I', join(ROOT, 'tools', 'export_ch11.py'), '--book', BOOK, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const g = spawnSync('python', ['-I', join(BOOK, GENERATOR), '--check'], { encoding: 'utf8' });
  assert.equal(g.status, 0, `the generator writes the figures unchanged: ${g.stdout}${g.stderr}`);
  assert.ok(readFileSync(join(BOOK, 'figures', 'FIG-0113.tex'), 'utf8').includes(`%% PSUM        : ${PSUM}`), 'the PSUM line of FIG-0113');
});

test('subsystem regions (small screens): each holds its elements whole, lies inside the drawing, and is narrower than it', () => {
  const sub = GEOM.subsystem;
  const els = sub.elements.filter((e) => e.size);
  const whole = { x0: Math.min(...els.map((e) => e.at[0] - e.size[0] / 2)), x1: Math.max(...els.map((e) => e.at[0] + e.size[0] / 2)) };
  assert.equal(regionBox(sub, 'whole'), null);
  for (const [r, ids] of Object.entries(REGIONS).filter(([, ids]) => ids)) {
    const b = regionBox(sub, r);
    for (const id of ids) {
      const e = sub.elements.find((x) => x.id === id);
      assert.ok(e, `${r}: ${id} is an element of FIG-0114`);
      assert.ok(e.at[0] - e.size[0] / 2 >= b.x0 && e.at[0] + e.size[0] / 2 <= b.x1 && e.at[1] - e.size[1] / 2 >= b.y0 && e.at[1] + e.size[1] / 2 <= b.y1, `${r}: ${id} inside`);
    }
    assert.ok(b.x1 - b.x0 <= 0.75 * (whole.x1 - whole.x0), `${r}: at most three quarters of the width, so its text grows`);
  }
});

test('array explorer: the 2 x 2 example reproduces the PSUM line, the highlighted PEs and the outputs of the step panels', () => {
  const { W, X } = figureExample(GEOM);
  assert.deepEqual(W, [[2, -1], [3, 4]]);
  const run = runArray(W, X);
  assert.equal(run.steps.length, 4);
  const models = run.steps.map((_, s) => panelModel(run, s));
  assert.equal(models.map((m) => m.pes.map((p) => p.p).join(' ')).join(' | '), PSUM);
  assert.deepEqual(models.map((m) => m.pes.filter((p) => p.a !== null).map((p) => p.id)), [['pe00'], ['pe01', 'pe10'], ['pe11'], []]);
  assert.deepEqual(models.map((m) => m.pes.filter((p) => p.a !== null).map((p) => p.a)), [[5], [5, -2], [-2], []]);
  assert.deepEqual(models.map((m) => m.inputs), [[5, null], [null, -2], [null, null], [null, null]]);
  assert.deepEqual(models.map((m) => m.outputs.map((o) => o?.y ?? null)), [[null, null], [null, null], [12, null], [null, 7]]);
  // weights as drawn: PE (r, c) holds W[c][r]
  assert.deepEqual(models[0].pes.map((p) => p.w), [2, 3, -1, 4]);
});

test('array explorer: N = 3 and N = 4, batches, and the input check', () => {
  const W3 = [[1, 0, 2], [0, 1, 0], [1, 1, 1]];
  const run = runArray(W3, [[3, -1, 2], [1, 1, 1]]);
  assert.equal(run.steps.length, 2 + 2 * 3 - 1);
  assert.deepEqual(run.y, [[7, -1, 4], [3, 1, 3]]);
  const last = panelModel(run, run.steps.length - 1);
  assert.equal(last.outputs[2].b, 1);
  assert.equal(parseRows('1 2\n3 4', 2)?.length, 2);
  assert.equal(parseRows('1 2\n3', 2), null);
  assert.equal(parseRows('1 200\n3 4', 2), null);
  assert.deepEqual(parseRows('1, −2\n3; 4\n', 2), [[1, -2], [3, 4]]);
  assert.deepEqual(parseRows('1 2\n3 4\n5 6', 2, null), [[1, 2], [3, 4], [5, 6]]);
});

/** npu_mv with the data set v1 on the single-cycle host (the NPU at 0x5000_0000), stepped cycle by cycle. */
function labRun(onCycle) {
  const src = readFileSync(join(ROOT, 'content', 'templates', 'npu-mv.s'), 'utf8');
  const p = assemble([{ name: 'npu-mv.s', text: src }], { profile: 'ch06' });
  assert.ok(p.ok, p.errors.map((e) => e.message).join('; '));
  const data = parseHexWords(readFileSync(join(ROOT, 'test', 'fixtures', 'npu', 'ch11', 'data', 'v1', 'data.hex'), 'utf8'));
  const platform = new Platform();
  const { memsys } = buildMemsys({ ...defaultConfig(), words: 1024, devices: true }, { platform });
  const m = new SingleCycle(T6, { memsys, historyLimit: 0 });
  m.load({ ...p, segments: [...p.segments, { address: 0, bytes: data, executable: false }] });
  let r;
  do { r = m.step(); onCycle(platform.npu, m); } while (r === 'step' && m.cycle < 5000);
  assert.equal(r, 'halt');
}

test('signals of a cycle: the connections the drawing highlights follow the controller and the bus (laboratory run)', () => {
  const wires = new Set(GEOM.subsystem.wires.map((w) => w.id));
  const seen = { loadw: 0, run: new Set(), ctrl: 0, status: 0, result: 0 };
  labRun((npu) => {
    const v = npu.view();
    const bus = recentBus(v);
    const { values, active } = npuSignals(npu.visible, bus);
    for (const id of active) assert.ok(wires.has(id), `${id} is a wire of the drawing`);
    for (const k of Object.keys(npuSignalInfo())) assert.ok(k in values, `${k} has a value`);
    const { state, step } = v.ctrl;
    assert.equal(active.has('w_load') && active.has('weights'), state === 'LOADW');
    assert.equal(active.has('run_step'), state === 'RUN');
    for (let r = 0; r < 4; r++) {
      assert.equal(active.has(`skew_r${r}`), state === 'RUN' && step === r);
      assert.equal(active.has(`sum${r}`), state === 'RUN' && step === 4 + r);
      if (state === 'RUN' && step === r) assert.equal(values[`a_left[${r}]`], ((v.regs.act[r] << 24) >> 24));
    }
    if (state === 'LOADW') seen.loadw += 1;
    if (state === 'RUN') seen.run.add(step);
    if (bus) {
      assert.equal(values.sel_acc, 1);
      assert.equal(values.d_addr, (NPU_BASE + bus.offset) >>> 0);
      if (bus.register === 'CTRL') { assert.ok(active.has('ctrl_in')); assert.equal(values.start, 1); seen.ctrl += 1; }
      if (bus.register === 'STATUS') { assert.ok(active.has('status')); seen.status += 1; }
      if (bus.register.startsWith('RESULT')) { assert.ok(active.has('rbuf_rif')); seen.result += 1; }
    } else {
      assert.equal(values.sel_acc, 0);
      assert.ok(!active.has('d_bus'));
    }
  });
  assert.equal(seen.loadw, 1);
  assert.deepEqual([...seen.run].sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(seen.ctrl, 1);
  assert.ok(seen.status >= 3);
  assert.equal(seen.result, 4);
});

test('processing element: psum_in + product during a cycle is psum_out of the next (every PE, laboratory run)', () => {
  let prev = null;
  let checked = 0;
  labRun((npu) => {
    const s = npu.visible;
    if (prev) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          assert.equal(s.arr.p[r][c], prev.pe[r][c].sum, `PE (${r}, ${c}) at cycle ${npu.view().cycle}`);
          assert.equal(s.arr.a[r][c], prev.pe[r][c].a_in);
          if (prev.pe[r][c].prod) checked += 1;
        }
      }
    }
    prev = { pe: [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => peValues(s, r, c))) };
  });
  assert.ok(checked >= 8, `${checked} non-zero products seen`);
});

test('bus log: every access in order, ignored writes marked, and a restore goes back to the saved length', () => {
  const npu = new Npu();
  const at = (t) => ({ cycle: t });
  npu.write(0x10, 4, 0x01020304, at(1));
  npu.write(0x20, 4, 5, at(2));
  npu.write(0x00, 4, 1, at(3)); // start
  const snap = npu.snapshot();
  npu.write(0x24, 4, 6, at(5)); // busy: ignored
  npu.read(0x04, 4, at(6));
  assert.deepEqual(npu.log.map((e) => [e.kind, e.register, e.ignored]),
    [['write', 'WEIGHT0', false], ['write', 'ACT0', false], ['write', 'CTRL', false], ['write', 'ACT1', true], ['read', 'STATUS', false]]);
  npu.restore(snap);
  assert.equal(npu.log.length, 3);
  npu.reset();
  assert.equal(npu.log.length, 0);
});

test('NPU-5 register boundaries: N - 1 between the columns, N - 1 between the rows, one above the outputs; each link crosses exactly one, none crosses a PE', () => {
  for (const g of Object.values(GEOM.array)) {
    const n = g.n;
    const lines = registerBoundaries(g);
    const kinds = (k) => lines.filter((b) => b.kind === k);
    assert.equal(kinds('a').length, n - 1, `N = ${n}: column boundaries`);
    assert.equal(kinds('psum').length, n - 1, `N = ${n}: row boundaries`);
    assert.equal(kinds('out').length, 1, `N = ${n}: output boundary`);
    const between = (v, a, b) => v > Math.min(a, b) && v < Math.max(a, b);
    const crosses = (b, w) => {
      const [[xa, ya], [xb, yb]] = [w.points[0], w.points[w.points.length - 1]];
      return b.x1 === b.x2 ? between(b.x1, xa, xb) && between(ya, b.y1, b.y2) : between(b.y1, ya, yb) && between(xa, b.x1, b.x2);
    };
    // every activation link a<r><c>, partial-sum link p<r><c>_<r+1><c> and output out<c> crosses exactly one boundary, of its kind
    for (const w of g.wires.filter((x) => /^(a\d\d|p\d\d_\d\d|out\d)$/.test(x.id))) {
      const hit = lines.filter((b) => crosses(b, w));
      const kind = w.id.startsWith('a') ? 'a' : w.id.startsWith('p') ? 'psum' : 'out';
      assert.equal(hit.length, 1, `N = ${n}: ${w.id} crosses ${hit.length} boundaries`);
      assert.equal(hit[0].kind, kind, `N = ${n}: ${w.id}`);
    }
    // the row inputs a_left enter before the first boundary: none crosses them
    for (const w of g.wires.filter((x) => /^in\d$/.test(x.id))) assert.ok(!lines.some((b) => crosses(b, w)), `N = ${n}: ${w.id}`);
    // no boundary passes through a PE box
    for (const e of g.elements) {
      const [x0, x1, y0, y1] = [e.at[0] - e.size[0] / 2, e.at[0] + e.size[0] / 2, e.at[1] - e.size[1] / 2, e.at[1] + e.size[1] / 2];
      for (const b of lines) {
        const inside = b.x1 === b.x2 ? between(b.x1, x0, x1) && Math.max(b.y1, b.y2) > y0 && Math.min(b.y1, b.y2) < y1
          : between(b.y1, y0, y1) && Math.max(b.x1, b.x2) > x0 && Math.min(b.x1, b.x2) < x1;
        assert.ok(!inside, `N = ${n}: a ${b.kind} boundary crosses ${e.id}`);
      }
    }
  }
});

test('NPU-5 transfers: every write, read, LOADW and RUN step of npu-mv moves its data along its path, in order, to the right destination', () => {
  const g = GEOM.subsystem;
  const wireIds = new Set(g.wires.map((w) => w.id));
  const elIds = new Set(g.elements.map((e) => e.id));
  const p = assemble([{ name: 'npu-mv.s', text: readFileSync(join(ROOT, 'content', 'templates', 'npu-mv.s'), 'utf8') }], { profile: 'ch06' });
  assert.ok(p.ok);
  const platform = new Platform();
  const { memsys } = buildMemsys({ ...defaultConfig(), devices: true }, { platform });
  const m = new SingleCycle(T6, { memsys, historyLimit: 0 });
  m.load(p);
  const npu = platform.npu;
  const seen = new Set();
  const at = (tr, id) => tr.flow.find((f) => f.id === id);
  let r;
  do {
    r = m.step();
    const S = npu.visible;
    const bus = recentBus(npu.view());
    const tr = subsystemTransfers(S, bus, g, npu.n);
    for (const f of tr.flow) assert.ok(wireIds.has(f.id), `wire ${f.id}`);
    for (const id of tr.elements) assert.ok(elIds.has(id), `element ${id}`);
    for (const t of tr.tags) assert.ok(Number.isFinite(t.at[0]) && Number.isFinite(t.at[1]) && t.text, 'a tag has a place and a text');
    assert.equal(tr.lines.length > 0, tr.flow.length > 0, 'words for every movement');
    if (bus?.kind === 'write' && !bus.ignored && bus.register.startsWith('WEIGHT')) {
      const i = Number(bus.register.slice(-1));
      assert.ok(at(tr, 'd_bus').at < at(tr, 'rif_wbuf').at && !at(tr, 'd_bus').reverse);
      assert.ok(tr.elements.has('wbuf') && tr.tags.some((t) => t.text.startsWith(`[${i}] ←`)));
      assert.equal(S.weight[i], bus.value >>> 0, 'the register holds what the tag says');
      seen.add('weight');
    }
    if (bus?.kind === 'write' && bus.register.startsWith('ACT')) { assert.ok(at(tr, 'rif_abuf') && tr.elements.has('abuf')); seen.add('act'); }
    if (bus?.kind === 'write' && bus.register === 'CTRL') { assert.ok(at(tr, 'ctrl_in') && tr.elements.has('ctrl')); seen.add('ctrl'); }
    if (bus?.kind === 'read') {
      const src = bus.register === 'STATUS' ? 'status' : 'rbuf_rif';
      assert.ok(at(tr, src).at < at(tr, 'd_bus').at && at(tr, 'd_bus').reverse, `${bus.register}: from the NPU back over the bus`);
      seen.add(bus.register === 'STATUS' ? 'status' : 'result');
    }
    if (S.ctrl.state === 'LOADW') {
      assert.ok(at(tr, 'weights') && at(tr, 'w_load'));
      for (let rr = 0; rr < 4; rr++) for (let c = 0; c < 4; c++) assert.ok(tr.elements.has(`p${rr}${c}`));
      seen.add('loadw');
    }
    if (S.ctrl.state === 'RUN') {
      const s = S.ctrl.step;
      if (s < 4) assert.ok(at(tr, 'abuf_skew').at < at(tr, `skew_r${s}`).at, `step ${s}: x[${s}] into row ${s}`);
      for (let rr = 0; rr < 4; rr++) for (let c = 0; c < 4; c++) assert.equal(tr.elements.has(`p${rr}${c}`), rr + c === s || (s >= 4 && rr === 3 && c === s - 4), `step ${s}: PE (${rr}, ${c})`);
      if (s >= 4) {
        const c = s - 4;
        assert.ok(at(tr, `sum${c}`).at < at(tr, 'sums_rbuf').at);
        // the sum the words announce is the RESULT register after the edge
        const after = npuEdge(S, null, 4).result[c];
        assert.ok(tr.lines.some((l) => l.text.includes(`RESULT[${c}]`) && l.text.endsWith(`${String(after).replace('-', '−')} at the end of the step.`)), `step ${s}: ${tr.lines.map((l) => l.text).join(' | ')}`);
      }
      seen.add(`run${s}`);
    }
  } while (r === 'step' && m.cycle < 400);
  for (const k of ['weight', 'act', 'ctrl', 'status', 'result', 'loadw', ...Array.from({ length: 8 }, (_, s) => `run${s}`)]) assert.ok(seen.has(k), `${k} reached`);
});

test('NPU-5 transfers inside a PE: the weight in LOADW, the multiply-add in its step, the registered outputs in the step after', () => {
  const n = 4;
  const S = npuReset(n);
  S.weight = [0x04030201, 0x08070605, 0x0c0b0a09, 0x100f0e0d];
  S.ctrl = { state: 'LOADW', step: 0, done: false };
  const load = peTransfers(S, 1, 2);
  assert.deepEqual([...load.wires], ['w_in']);
  assert.match(load.lines[0].text, /W\[2\]\[1\] = 10/);
  S.ctrl = { state: 'RUN', step: 3, done: false };
  const mac = peTransfers(S, 1, 2);
  for (const id of ['a_in', 'w_mul', 'a_mul', 'prod', 'ext', 'psum_in', 'sum']) assert.ok(mac.wires.has(id), id);
  const order = (id) => mac.flow.find((f) => f.id === id).at;
  assert.ok(order('a_in') < order('prod') && order('prod') < order('ext') && order('ext') < order('sum'));
  S.ctrl = { state: 'RUN', step: 4, done: false };
  assert.deepEqual([...peTransfers(S, 1, 2).wires].sort(), ['a_out', 'psum_out']);
  assert.match(peTransfers(S, 3, 0).lines[0].text, /psum_bottom\[0\]/);
  S.ctrl = { state: 'RUN', step: 6, done: false };
  assert.equal(peTransfers(S, 1, 2).flow.length, 0, 'quiet');
});

test('NPU-5 system flow: a store from the processor out to the device, a load back, on either side of the tap', () => {
  const st = systemFlow(['bus_1', 'bus_2', 'bus_3'], 'npu', true, true);
  assert.deepEqual(st.map((f) => f.id), ['cpu_bus', 'bus_1', 'bus_2', 'bus_3', 'to_npu']);
  assert.ok(st.every((f) => !f.reverse) && st.every((f, i) => i === 0 || f.at > st[i - 1].at));
  const ld = systemFlow(['bus_1', 'bus_2', 'bus_3'], 'npu', true, false);
  assert.deepEqual(ld.map((f) => f.id), ['to_npu', 'bus_3', 'bus_2', 'bus_1', 'cpu_bus']);
  assert.ok(ld.every((f) => f.reverse));
  const left = systemFlow(['bus_0', 'bus_1'], 'ram', false, true);
  assert.deepEqual(left.map((f) => [f.id, f.reverse]), [['cpu_bus', false], ['bus_1', true], ['bus_0', true], ['to_ram', false]]);
});

test('NPU-5 both accesses of a cycle: the coming access is drawn dashed and becomes, one cycle later, the completed transfer it announced', () => {
  const g = GEOM.subsystem;
  const p = assemble([{ name: 'npu-mv.s', text: readFileSync(join(ROOT, 'content', 'templates', 'npu-mv.s'), 'utf8') }], { profile: 'ch06' });
  const platform = new Platform();
  const { memsys } = buildMemsys({ ...defaultConfig(), devices: true }, { platform });
  const m = new SingleCycle(T6, { memsys, historyLimit: 10 });
  m.load(p);
  const npu = platform.npu;
  let predicted = null;
  let checked = 0;
  for (let k = 0; k < 120; k++) {
    // the coming access of the cycle shown (as views.js dataAccess) and the completed one (the model's last edge)
    const s = m.evaluate().signals;
    const next = s.MemWrite || s.ResultSel === 1 ? { addr: s.alu_y >>> 0, write: Boolean(s.MemWrite), value: (s.MemWrite ? s.rs2_val : s.rdata) >>> 0 } : null;
    const bus = recentBus(npu.view());
    if (predicted) {
      assert.ok(bus, `cycle ${k}: the announced ${predicted.register} access was not completed`);
      for (const key of ['kind', 'register', 'value', 'ignored']) assert.equal(bus[key], predicted[key], `cycle ${k}: ${key}`);
      checked += 1;
    } else assert.equal(bus, null, `cycle ${k}: a completed NPU transfer nobody announced`);
    if (m.last?.acc) assert.equal(m.last.acc.addr >= NPU_BASE && m.last.acc.addr < NPU_BASE + 0x1000, Boolean(bus), `cycle ${k}: the model's last access and the NPU log agree`);
    predicted = npuAccess(npu.visible, next);
    const tr = subsystemTransfers(npu.visible, bus, g, 4, next);
    if (predicted) {
      assert.ok(tr.lines.some((l) => l.when === 'now' && (l.text.startsWith('sw') || l.text.startsWith('lw'))), `cycle ${k}: no words for the coming access`);
      assert.ok(tr.next.size > 0 || tr.flow.some((f) => f.at >= 0.4), `cycle ${k}: the coming access is not drawn`);
      for (const id of tr.next) assert.ok(tr.wires.has(id));
    } else if (next) assert.ok(tr.lines.some((l) => l.when === 'now' && /not the NPU/.test(l.text)));
    if (m.step() !== 'step') break;
  }
  assert.ok(checked >= 20, `${checked} announced accesses checked`);
});
