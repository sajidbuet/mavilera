// output-cap.test.mjs -- the engines keep at most 2 × OUTPUT_KEEP characters of output (contract.js; author,
// 2026-10-29): past that the oldest go, counted in EngineState.outputDropped; the count and the kept text always add
// up to everything written; stepping back within what is kept removes the newest output, and stepping back past what
// was dropped leaves the output from that point on. RISC-V (write ecalls), SAP-1 (OUT) and SAP-1's bus model.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OUTPUT_KEEP } from '../src/arch/contract.js';
import { descriptor as sap1 } from '../src/arch/sap-1/index.js';
import { BusModel } from '../src/arch/sap-1/bus-model.js';
import { ARCHITECTURES } from '../src/arch/registry.js';

test('SAP-1 engine: the output is capped, the count adds up, step back works within and past the cap', () => {
  const p = sap1.language.assemble([{ name: 'o.asm', text: 'OUT\n'.repeat(16) }]); // every step writes a line
  const e = sap1.engine.create(p);
  const line = sap1.strings.engine.out(0).length;
  const n = Math.ceil((2.5 * OUTPUT_KEEP) / line);
  for (let i = 0; i < n; i++) e.step();
  let s = e.state();
  assert.ok(s.output.length <= 2 * OUTPUT_KEEP && s.output.length >= OUTPUT_KEEP, `${s.output.length}`);
  assert.equal(s.outputDropped + s.output.length, n * line);
  for (let i = 0; i < 10; i++) e.back();
  s = e.state();
  assert.equal(s.outputDropped + s.output.length, (n - 10) * line, 'back within what is kept');
  for (let i = 0; i < n - 20; i++) e.back(); // to step 10, before what was dropped
  s = e.state();
  assert.deepEqual([s.output, s.outputDropped], ['', 10 * line], 'back past the cap: the output from there on');
  e.step();
  assert.equal(e.state().output.length, line);
});

test('SAP-1 bus model: the same cap on its output', () => {
  const p = sap1.language.assemble([{ name: 'o.asm', text: 'OUT\n'.repeat(16) }]);
  const m = new BusModel(p);
  const line = sap1.strings.engine.out(0).length;
  const outs = Math.ceil((2.5 * OUTPUT_KEEP) / line);
  for (let i = 0; i < outs * 6; i++) m.step(); // six timing states an instruction
  assert.ok(m.output.length <= 2 * OUTPUT_KEEP);
  assert.equal(m.outBase + m.output.length, outs * line);
  for (let i = 0; i < 6; i++) m.back();
  assert.equal(m.outBase + m.output.length, (outs - 1) * line);
});

test('RISC-V engine: write ecalls past the cap; the state converts a million characters', async () => {
  const d = (await ARCHITECTURES.riscv()).descriptor;
  const blocks = Math.ceil((2.5 * OUTPUT_KEEP) / 4096);
  const src = `        .data
buf:    .space 4096
        .text
        li   s0, ${blocks}
loop:   li   a0, 1
        la   a1, buf
        li   a2, 4096
        li   a7, 64
        ecall
        addi s0, s0, -1
        bnez s0, loop
        li   a7, 93
        ecall
`;
  const p = d.language.assemble([{ name: 'w.s', text: src }], { profile: 'iss' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const e = d.engine.create(p, { profile: 'iss' });
  while (!e.state().halted) e.run({ chunk: 100_000 });
  const s = e.state();
  assert.equal(s.error, null);
  assert.ok(s.output.length <= 2 * OUTPUT_KEEP && s.output.length >= OUTPUT_KEEP, `${s.output.length}`);
  assert.equal(s.outputDropped + s.output.length, blocks * 4096);
  // back over the exit and the last write (and its loop): the newest 4096 characters go
  let back = 0;
  while (e.state().outputDropped + e.state().output.length > (blocks - 1) * 4096 && back < 20) { e.back(); back += 1; }
  assert.equal(e.state().outputDropped + e.state().output.length, (blocks - 1) * 4096);
});
