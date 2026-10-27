// session.test.mjs -- execution controls of WS-F-090/091: step over and out
// across recursion, breakpoints, watchpoints, run budget with the loop's
// address range, back-stepping across a run.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Session, STOP } from '../src/core/session.js';

const FACT = `
_start: li   a0, 5
        call fact
        mv   s1, a0
        li   a7, 93
        ecall
fact:   addi sp, sp, -16
        sw   ra, 12(sp)
        sw   a0, 8(sp)
        li   t0, 1
        ble  a0, t0, base
        addi a0, a0, -1
        call fact
        lw   t1, 8(sp)
        mul  a0, a0, t1
        j    done
base:   li   a0, 1
done:   lw   ra, 12(sp)
        addi sp, sp, 16
        ret
`;

function session(src) {
  const s = new Session();
  s.files = [{ name: 'main.s', text: src }];
  s.assemble();
  assert.ok(s.runnable, JSON.stringify(s.program.errors));
  return s;
}

test('step over a recursive call stops after it returns, with the result', () => {
  const s = session(FACT);
  s.step(); // li
  const t = s.stepOverTarget();
  assert.equal(t, 8);
  assert.equal(s.run({ target: t, depth: s.callDepth() }), STOP.TARGET);
  assert.equal(s.hart.x[10], 120);
});

test('step out returns to the caller of the innermost call', () => {
  const s = session(FACT);
  s.step();
  s.step(); // into fact
  assert.equal(s.callDepth(), 1);
  assert.equal(s.run({ target: s.stepOutTarget(), depth: 0 }), STOP.TARGET);
  assert.equal(s.hart.pc, 8);
  assert.equal(s.hart.x[10], 120);
});

test('breakpoints and register watchpoints stop a run', () => {
  const s = session(FACT);
  s.breakpoints.add(s.program.symbols.get('base'));
  assert.equal(s.run(), STOP.BREAK);
  assert.equal(s.hart.pc, s.program.symbols.get('base'));
  s.watchRegs.add(9);
  assert.equal(s.run(), STOP.WATCH);
  assert.equal(s.hart.x[9], 120);
  assert.equal(s.run(), STOP.HALT);
  assert.equal(s.hart.exitCode, 120);
});

test('the run budget stops a runaway loop and names its address range', () => {
  const s = new Session({ runLimit: 1000 });
  s.files = [{ name: 'm.s', text: 'nop\nloop: addi a0, a0, 1\n bnez a0, loop\n' }];
  s.assemble();
  let r;
  do r = s.run({ chunk: 300 }); while (r === STOP.CHUNK);
  assert.equal(r, STOP.BUDGET);
  assert.deepEqual(s.loopRange(), { from: 4, to: 8 });
});

test('back-stepping after a run returns to the start state', () => {
  const s = session(FACT);
  const start = Array.from(s.hart.x);
  assert.equal(s.run(), STOP.HALT);
  while (s.back());
  assert.deepEqual(Array.from(s.hart.x), start);
  assert.equal(s.hart.pc, 0);
  assert.equal(s.hart.instret, 0);
});

test('a program with instructions outside the profile is not runnable (WS-F-001)', () => {
  const s = new Session();
  s.profile = 'ch06';
  s.files = [{ name: 'm.s', text: 'lb a0, 0(a1)\n' }];
  s.assemble();
  assert.equal(s.runnable, false);
});
