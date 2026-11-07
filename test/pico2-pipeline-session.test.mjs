// The model behind the pico2 pipeline view (P1-M3): the session's cycle cursor forward and back over instructions, the export
// model of the waveforms and VCD (one frame per record, the same records as the view), the trace export's cycles, and the
// module's descriptor (the view registered, waveform and exportTrace on).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/arch/pico2/language.js';
import { STOP } from '../src/arch/contract.js';
import { PipelineSession, exportModel, frameOf } from '../src/arch/pico2/uarch/session.js';
import { trace, traceCsv, traceJsonLines } from '../src/arch/pico2/exports.js';
import { descriptor } from '../src/arch/pico2/index.js';
import { recordFrames, vcd } from '../src/shell/vcd.js';
import { WAVE_SIGNALS } from '../src/arch/pico2/uarch/session.js';

const SRC = `_start: li a1, 0x20040000
      li a0, 4
loop: lw t0, 0(a1)
      add t1, t0, a0
      addi a0, a0, -1
      bnez a0, loop
      li a2, 100
      div a3, a2, a0
      ebreak
`;
const prog = () => { const p = assemble([{ name: 's.s', text: SRC }]); assert.ok(p.ok); return p; };

test('session: one record per click to the end, every record once; back returns over the same records to cycle 0', () => {
  const s = new PipelineSession(prog());
  assert.equal(s.cycle, 0);
  const seen = [s.cursor];
  let r;
  while ((r = s.forward()) === STOP.NONE) seen.push(s.cursor);
  assert.equal(r, STOP.HALT);
  assert.deepEqual(seen, seen.map((_, i) => i), 'consecutive records');
  assert.equal(s.model.cycles, s.hart.ticks, 'every cycle recorded');
  const end = s.cursor;
  let backs = 0;
  while (s.back()) backs++;
  assert.equal(s.cursor, 0); assert.equal(backs, end);
  assert.equal(s.model.ns - s.model.slo, 1, 'only the first instruction is left');
  // forward again: the same number of records
  let n = 0; while (s.forward() === STOP.NONE) n++;
  assert.equal(n, end);
});

test('session: an instruction at a time; the engine stands at the end of the instruction shown', () => {
  const s = new PipelineSession(prog());
  let k = 0;
  while (s.forwardInstruction() === STOP.NONE) { k++; assert.equal(s.cursor, s.firstRecordOf(s.stepOf(s.cursor))); }
  assert.ok(k > 10);
  assert.ok(s.backInstruction());
  assert.equal(s.cursor, s.firstRecordOf(s.stepOf(s.cursor)));
});

test('export model: frames are the session\'s records; the VCD has the RTL-named signals', () => {
  const s = new PipelineSession(prog());
  const want = [];
  do want.push(frameOf(s.model, s.cursor)); while (s.forward() === STOP.NONE);
  const { frames, stop } = recordFrames(exportModel(prog()), 10_000);
  assert.equal(stop, 'halt');
  assert.deepEqual(frames, want);
  const text = vcd(frames, WAVE_SIGNALS, { module: 'hazard3' });
  assert.match(text, /\$var wire 1 \S+ x_stall_on_raw \$end/);
  assert.match(text, /\$var wire 32 \S+ d_pc \[31:0\] \$end/);
});

test('trace export: the cycles of the steps add up to the machine\'s; CSV and JSON lines', () => {
  const { records, error } = trace(prog(), { cap: 1000 });
  assert.equal(error, null);
  assert.ok(records.at(-1).halt);
  const s = new PipelineSession(prog());
  while (s.forward() === STOP.NONE);
  assert.equal(records.reduce((a, r) => a + r.cycles, 0), s.hart.ticks);
  assert.match(traceCsv(records), /^step,pc,word,instruction,cycles/);
  assert.equal(traceJsonLines(records).trim().split('\n').length, records.length);
});

test('descriptor: the pipeline view is registered and loads; waveform and exportTrace are on', () => {
  const v = descriptor.views.find((x) => x.id === 'pipeline');
  assert.equal(v.kind, 'datapath'); assert.equal(v.profile, 'hazard3'); assert.equal(typeof v.load, 'function');
  assert.equal(descriptor.capabilities.waveform, true); assert.equal(descriptor.capabilities.exportTrace, true);
  assert.equal(typeof descriptor.exports.trace, 'function');
});
