// callstack.test.mjs -- the call-stack panel's data (WS-F-103, WS-F-143):
// frames follow the calls of the --abi-check model (jal/jalr writing ra,
// ended by the jalr that returns to the address after the call), innermost
// first, with the procedure and call site named by labels and a0-a7 as they
// were at each call; stepping back restores them; a Worker round trip
// (snapshot and restore) keeps them.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Session, STOP } from '../src/core/session.js';
import { callStack, textNamer } from '../src/core/callstack.js';

const SRC = `
        .text
_start: li    a0, 5
        li    a1, -2
        call  outer          # frame 1
        li    a7, 93
        ecall
outer:  addi  sp, sp, -16
        sw    ra, 12(sp)
        addi  a0, a0, 10
        li    a7, 77
        call  inner          # frame 2
        lw    ra, 12(sp)
        addi  sp, sp, 16
        ret
inner:  nop
        ret
`;

function session() {
  const s = new Session();
  s.files = [{ name: 'c.s', text: SRC }];
  const p = s.assemble();
  assert.deepEqual(p.errors, []);
  return s;
}

const stepUntil = (s, label) => {
  const a = s.program.symbols.get(label);
  while (s.hart.pc !== a) assert.equal(s.step(), STOP.NONE);
};

test('WS-F-103/143: frames, names and a0-a7 at each call', () => {
  const s = session();
  assert.deepEqual(callStack(s.hart, s.program), []);
  stepUntil(s, 'inner');
  const f = callStack(s.hart, s.program);
  assert.equal(f.length, 2);
  assert.equal(f[0].name, 'inner'); // innermost first
  assert.equal(f[0].depth, 2);
  assert.equal(f[0].site, 'outer+0x10');
  assert.equal(f[0].ret, s.program.symbols.get('outer') + 0x14);
  assert.equal(f[0].args[0], 15); // a0 after addi a0, a0, 10
  assert.equal(f[0].args[7], 77); // a7
  assert.equal(f[1].name, 'outer');
  assert.equal(f[1].site, '_start+0x8');
  assert.equal(f[1].args[0], 5);
  assert.equal(f[1].args[1] | 0, -2);
  assert.equal(f[1].sp, 0x00100000);
  assert.equal(f[0].sp, 0x00100000 - 16);
  // the return of inner pops it, the return of outer the other
  assert.equal(s.step(), STOP.NONE); // nop
  assert.equal(s.step(), STOP.NONE); // ret
  assert.equal(callStack(s.hart, s.program).length, 1);
  // stepping back restores the frame as it was
  assert.ok(s.back());
  assert.equal(callStack(s.hart, s.program)[0].args[0], 15);
});

test('WS-F-103: the frames survive a Worker round trip', () => {
  const s = session();
  stepUntil(s, 'inner');
  const w = Session.fromWorkerRequest(structuredClone(s.workerRequest({})));
  const f = callStack(w.hart, s.program);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].args.slice(0, 2), [15, 0xfffffffe]);
});

test('textNamer: the label at or before an address, with an offset', () => {
  const s = session();
  const name = textNamer(s.program);
  assert.equal(name(0), '_start');
  assert.equal(name(s.program.symbols.get('inner') + 4), 'inner+0x4');
  assert.equal(textNamer({ symbolTable: [] })(0), null);
});
