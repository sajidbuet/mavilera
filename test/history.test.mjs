// history.test.mjs -- WS-F-090 back-stepping: undoing every step restores
// registers, memory, pc, counters, console output, lowest sp and the
// --abi-check state exactly; the ring buffer drops the oldest steps at its
// limit and counts them; a history exported (as by the Worker) and appended
// gives the same back-steps; memory per step stays at 20 bytes.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Session, STOP } from '../src/core/session.js';

const SRC = `
        .data
msg:    .ascii "hi\\n"
        .align 2
buf:    .space 8
        .text
_start: la    s0, buf
        li    t0, 0x11223344
        sw    t0, 0(s0)
        sb    zero, 1(s0)
        li    a0, 1
        la    a1, msg
        li    a2, 3
        li    a7, 64
        ecall
        call  f
        call  g
        li    a7, 93
        ecall
f:      addi  sp, sp, -16
        sw    ra, 12(sp)
        lw    ra, 12(sp)
        addi  sp, sp, 16
        ret
g:      addi  sp, sp, -8
        li    s1, 5
        addi  sp, sp, 8
        ret
`;

function session(limit) {
  const s = new Session({ historyLimit: limit });
  s.files = [{ name: 'm.s', text: SRC }];
  s.assemble();
  assert.ok(s.runnable, JSON.stringify(s.program.errors));
  return s;
}

function snapshot(s) {
  const h = s.hart;
  const mem = [];
  for (let a = 0x10000; a < 0x10010; a++) mem.push(h.mem.readByte(a));
  for (let a = 0x000ffff0; a < 0x00100000; a++) mem.push(h.mem.readByte(a));
  return JSON.stringify({ x: Array.from(h.x), pc: h.pc, counts: h.counts, instret: h.instret,
    halted: h.halted, exit: h.exitCode, out: h.output, mem, spMin: h.spMin,
    abi: h.abiViolations, depth: h.callDepth });
}

test('WS-F-090: stepping back to the start restores every earlier state exactly', () => {
  const s = session(1000);
  const states = [snapshot(s)];
  let r;
  while ((r = s.step()) === STOP.NONE) states.push(snapshot(s));
  assert.equal(r, STOP.HALT);
  states.push(snapshot(s));
  assert.equal(String.fromCharCode(...s.hart.output), 'hi\n');
  assert.equal(s.hart.abiViolations.length, 1); // g returns with s1 changed
  states.pop();
  while (s.back()) assert.equal(snapshot(s), states.pop());
  assert.equal(states.length, 0);
});

test('WS-F-090: the history drops the oldest steps at its limit', () => {
  const s = session(5);
  while (s.step() === STOP.NONE);
  assert.equal(s.history.size, 5);
  assert.equal(s.history.dropped, s.hart.instret - 5);
  let n = 0;
  while (s.back()) n += 1;
  assert.equal(n, 5);
});

test('a history exported and appended (Worker round trip) steps back the same way', () => {
  const a = session(1000);
  for (let k = 0; k < 4; k++) a.step();
  const before = snapshot(a);
  const req = structuredClone(a.workerRequest({}));
  const w = Session.fromWorkerRequest(req);
  assert.equal(w.run({ chunk: 1000 }), STOP.HALT);
  a.applyWorkerResult(structuredClone(w.workerResult(STOP.HALT)));
  const ref = session(1000);
  while (ref.step() === STOP.NONE);
  assert.equal(snapshot(a), snapshot(ref));
  while (a.history.size > 4) a.back();
  assert.equal(snapshot(a), before);
});

test('history memory is 20 bytes per step', () => {
  const s = new Session({ historyLimit: 1 << 16 });
  s.files = [{ name: 'm.s', text: 'loop: addi a0, a0, 1\n sw a0, -4(sp)\n j loop\n' }];
  s.assemble();
  s.run({ chunk: 200_000 });
  assert.equal(s.history.size, 1 << 16);
  assert.equal(s.history.bytes, 20 * (1 << 16));
});
