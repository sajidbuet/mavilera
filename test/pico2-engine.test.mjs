// The pico2 engine (P1-M1) beyond the contract's conformance suite: the halting rule (ebreak or a trap with no handler), traps
// taken through a handler, wfi with nothing enabled, memory watchpoints, CSR writes in step records, bus faults.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/arch/pico2/language.js';
import { create } from '../src/arch/pico2/engine.js';
import { STOP } from '../src/arch/contract.js';

const engine = (text) => { const p = assemble([{ name: 't.s', text }]); assert.ok(p.ok, JSON.stringify(p.diagnostics)); return { e: create(p), p }; };
const runAll = (e) => { let s; do s = e.run({ chunk: 10_000 }); while (s === STOP.CHUNK); return s; };

test('ebreak with no handler halts without executing; step back resumes from before it', () => {
  const { e, p } = engine('li a0, 1\nend: ebreak\n');
  e.step();
  const r = e.step();
  assert.equal(r.halt, true);
  assert.equal(r.pc, p.symbols.end);
  assert.equal(r.nextPc, p.symbols.end);
  const s = e.state();
  assert.equal(s.halted, true);
  assert.equal(s.registers.mcause, 0, 'the trap was not taken');
  assert.equal(e.step(), null);
  assert.ok(e.back());
  assert.equal(e.state().halted, false);
  assert.equal(e.state().pc, p.symbols.end);
  assert.ok(e.back());
  assert.equal(e.state().pc, p.symbols._start ?? 0x20000000);
});

test('a trap with no handler stops with an error naming the cause; with a handler it is taken as on the chip', () => {
  const bad = engine('li a0, 0xe0000000\nlw a1, 0(a0)\nebreak\n'); // the Cortex-M33 PPB faults for RISC-V (RP-001 §2.2.7)
  assert.equal(runAll(bad.e), STOP.ERROR);
  assert.match(bad.e.state().error, /load access fault.*mtvec is 0/);
  const good = engine(`la t0, handler\ncsrw mtvec, t0\nli a0, 0xe0000000\nlw a1, 0(a0)\nebreak\nhandler: csrr a2, mcause\ncsrw mtvec, zero\nebreak\n`);
  assert.equal(runAll(good.e), STOP.HALT);
  assert.equal(good.e.state().registers.x12, 5, 'mcause 5: load access fault');
});

test('a step that traps carries the trap in its record, and its CSR writes', () => {
  const { e } = engine('la t0, h\ncsrw mtvec, t0\necall\nh: csrw mtvec, zero\nebreak\n');
  e.step(); e.step();
  const w = e.step(); // csrw mtvec
  assert.deepEqual(w.registers.map((r) => r.id), ['mtvec']);
  const t = e.step(); // ecall
  assert.deepEqual(t.trap, { cause: 11, label: 'environment call from M-mode' });
  assert.ok(t.registers.some((r) => r.id === 'mepc') && t.registers.some((r) => r.id === 'mcause'));
});

test('wfi with no interrupt enabled stops with an error', () => {
  const { e } = engine('wfi\nebreak\n');
  assert.equal(runAll(e), STOP.ERROR);
  assert.match(e.state().error, /sleep for ever/);
});

test('a watched memory word stops the run after the store; breakpoints and run to a target', () => {
  const { e, p } = engine('la a0, v\nli a1, 9\nmark: sw a1, 0(a0)\nnop\nebreak\n.data\nv: .word 0\n');
  assert.equal(e.run({ chunk: 100, watch: { memory: new Set([p.symbols.v]) } }), STOP.WATCH);
  assert.deepEqual(e.last().memory, [{ address: p.symbols.v, size: 4, old: 0, value: 9 }]);
  e.reset();
  assert.equal(e.run({ chunk: 100, breakpoints: new Set([p.symbols.mark]) }), STOP.BREAK);
  assert.equal(e.state().pc, p.symbols.mark);
  e.reset();
  assert.equal(e.run({ chunk: 100, target: p.symbols.mark }), STOP.TARGET);
});

test('the stack pointer starts at the top of the SRAM; counters count instructions and steps', () => {
  const { e } = engine('nop\nnop\nebreak\n');
  assert.equal(e.state().registers.x2, 0x20082000);
  runAll(e);
  assert.deepEqual(e.counters().slice(0, 2).map((c) => c[1]), [2, 2]);
});
