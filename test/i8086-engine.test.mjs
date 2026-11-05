// The 8086 engine (roadmap 8086-B2): hand-written cases from Intel's documented behaviour (IFUM 9800722-03, chapter 2)
// and the [TEST]-based details of the oracle policy (docs/references/INTEL-8086-SOURCE-INDEX.md §8): flags, segments and
// wrap-around, the stack, string instructions with REP, interrupts and the divide error, step back, the call list, the
// console port and the two profiles. The SingleStepTests replay is test/i8086-sst.test.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, CODE_BASE } from '../src/arch/i8086/language.js';
import { create } from '../src/arch/i8086/engine.js';
import { STOP } from '../src/arch/contract.js';

const run = (text, o = {}) => {
  const p = assemble([{ name: 't.asm', text }], o);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const e = create(p);
  let s; do s = e.run({ chunk: 1_000_000 }); while (s === STOP.CHUNK);
  return { e, s, r: e.state().registers, st: e.state(), p };
};
const F = { CF: 1, PF: 4, AF: 0x10, ZF: 0x40, SF: 0x80, OF: 0x800 };
const flags = (r, ...names) => names.filter((n) => r.FLAGS & F[n]);

test('i8086: arithmetic flags (IFUM Table 2-21)', () => {
  assert.deepEqual(flags(run('MOV AL, 7FH\nADD AL, 1\nHLT').r, 'CF', 'ZF', 'SF', 'OF'), ['SF', 'OF']);
  assert.deepEqual(flags(run('MOV AL, 0FFH\nADD AL, 1\nHLT').r, 'CF', 'ZF', 'SF', 'OF'), ['CF', 'ZF']);
  assert.deepEqual(flags(run('MOV AX, 0\nSUB AX, 1\nHLT').r, 'CF', 'ZF', 'SF', 'OF'), ['CF', 'SF']);
  assert.deepEqual(flags(run('MOV AL, 80H\nNEG AL\nHLT').r, 'CF', 'OF'), ['CF', 'OF']);
  assert.deepEqual(flags(run('STC\nMOV AX, 1\nINC AX\nHLT').r, 'CF'), ['CF'], 'INC keeps CF');
  const m = run('MOV AL, 38H\nADD AL, 45H\nDAA\nHLT').r;
  assert.equal(m.AX & 0xff, 0x83);
  const mul = run('MOV AX, 1234H\nMOV BX, 100H\nMUL BX\nHLT').r;
  assert.deepEqual([mul.DX, mul.AX], [0x12, 0x3400]);
  assert.deepEqual(flags(mul, 'CF', 'OF'), ['CF', 'OF']);
  const div = run('MOV DX, 0\nMOV AX, 1003\nMOV BX, 10\nDIV BX\nHLT').r;
  assert.deepEqual([div.AX, div.DX], [100, 3]);
  const idiv = run('MOV AX, -7\nMOV BL, 2\nIDIV BL\nHLT').r;
  assert.deepEqual([idiv.AX & 0xff, idiv.AX >> 8], [0xfd, 0xff], 'quotient -3, remainder -1');
});

test('i8086: shifts and rotates by 1 and by CL', () => {
  assert.equal(run('MOV AL, 81H\nROL AL, 1\nHLT').r.AX & 0xff, 0x03);
  assert.equal(run('MOV AX, 1\nMOV CL, 4\nSHL AX, CL\nHLT').r.AX, 0x10);
  assert.equal(run('MOV AL, 80H\nSAR AL, 1\nHLT').r.AX & 0xff, 0xc0);
  const r = run('MOV AL, 1\nSHR AL, 1\nHLT').r;
  assert.deepEqual([r.AX & 0xff, flags(r, 'CF', 'ZF')], [0, ['CF', 'ZF']]);
  assert.equal(run('MOV AX, 0FFFFH\nMOV CL, 0\nSTC\nRCL AX, CL\nHLT').r.FLAGS & F.CF, F.CF, 'a count of 0 changes nothing');
});

test('i8086: segments, physical addresses and wrap-around', () => {
  const { e } = run('MOV AX, 2000H\nMOV DS, AX\nMOV BYTE PTR [0010H], 41H\nMOV AX, 2001H\nMOV ES, AX\nMOV AL, ES:[0]\nHLT');
  assert.equal(e.peek(0x20010, 1)[0], 0x41);
  assert.equal(e.state().registers.AX & 0xff, 0x41);
  // a word at offset FFFFH takes its high byte from offset 0000H of the same segment
  const w = run('MOV AX, 3000H\nMOV DS, AX\nMOV WORD PTR [0FFFFH], 1234H\nHLT').e;
  assert.deepEqual([w.peek(0x3ffff, 1)[0], w.peek(0x30000, 1)[0]], [0x34, 0x12]);
  // physical addresses wrap at 1 MiB: FFFF:0010 is 00000H
  const p = run('MOV AX, 0FFFFH\nMOV DS, AX\nMOV BYTE PTR [0010H], 77H\nHLT').e;
  assert.equal(p.peek(0, 1)[0], 0x77);
  // [BP] uses SS
  const s = run('MOV AX, 4000H\nMOV SS, AX\nMOV BP, 10H\nMOV BYTE PTR [BP], 5\nHLT').e;
  assert.equal(s.peek(0x40010, 1)[0], 5);
});

test('i8086: the stack; PUSH SP pushes the decremented SP', () => {
  const { r, e } = run('MOV AX, 1234H\nPUSH AX\nPOP BX\nPUSH SP\nPOP CX\nHLT');
  assert.equal(r.BX, 0x1234);
  assert.equal(r.CX, 0xfffc);
  assert.equal(r.SP, 0xfffe);
  assert.equal(e.peek(CODE_BASE + 0xfffc, 2)[1], 0xff);
});

test('i8086: REP MOVSB is one step; step back restores the memory it wrote', () => {
  const p = assemble([{ name: 't.asm', text: 'CLD\nMOV SI, OFFSET a\nMOV DI, OFFSET b\nMOV CX, 4\nREP MOVSB\nHLT\na DB 1,2,3,4\nb DB 4 DUP (0)' }]);
  const e = create(p);
  for (let i = 0; i < 4; i++) e.step();
  const before = [...e.peek(p.symbols.b, 4)];
  const rec = e.step();
  assert.deepEqual([...e.peek(p.symbols.b, 4)], [1, 2, 3, 4]);
  assert.equal(e.state().registers.CX, 0);
  assert.equal(rec.memory.length, 4);
  assert.ok(e.back());
  assert.deepEqual([...e.peek(p.symbols.b, 4)], before);
  assert.equal(e.state().registers.CX, 4);
  assert.deepEqual(e.last().pc, rec.pc - 3, 'last() is the MOV CX before');
});

test('i8086: an interrupt without a handler stops with a message and changes nothing', () => {
  const p = assemble([{ name: 't.asm', text: 'MOV AX, 5\nINT 21H\nHLT' }]);
  const e = create(p);
  e.step();
  const s0 = e.state();
  assert.equal(e.step(), null);
  assert.match(e.state().error, /INT 21H at 1000H:0003H: its vector at 00084H is 0000:0000/);
  assert.deepEqual(e.state().registers, s0.registers);
  assert.ok(e.back());
  assert.equal(e.state().error, null);
  const d = run('MOV AX, 1\nMOV BL, 0\nDIV BL\nHLT');
  assert.equal(d.s, STOP.ERROR);
  assert.match(d.st.error, /Divide error at 1000H:0005H/);
});

test('i8086: INT, a divide error with a handler, IRET, and the call list', () => {
  const src = `XOR AX, AX
MOV ES, AX
MOV WORD PTR ES:[0], OFFSET h0
MOV ES:[2], CS
MOV AL, 9
MOV BL, 0
DIV BL
MOV AL, '!'
OUT 0E9H, AL
CALL f
HLT
f: NOP
RET
h0: MOV AL, 'E'
OUT 0E9H, AL
IRET`;
  const p = assemble([{ name: 't.asm', text: src }]);
  const e = create(p);
  let rec;
  do rec = e.step(); while (rec && !rec.trap);
  assert.ok(rec.trap && rec.trap.cause === 0, 'the DIV traps');
  assert.equal(e.callDepth(), 1);
  assert.equal(e.callStack()[0].name, 'h0');
  assert.equal(rec.pc, CODE_BASE + 0x14);
  assert.equal(e.stepOutTarget(), CODE_BASE + 0x16, 'returns past the DIV (8086: the next instruction)');
  let s; do s = e.run({ chunk: 1000 }); while (s === STOP.CHUNK);
  assert.equal(s, STOP.HALT);
  assert.equal(e.state().output, 'E!');
  assert.equal(e.callDepth(), 0);
});

test('i8086: step over a CALL, run to a breakpoint, watch a register', () => {
  const p = assemble([{ name: 't.asm', text: 'CALL f\nMOV BX, 1\nHLT\nf: MOV CX, 2\nRET' }]);
  const e = create(p);
  assert.equal(e.stepOverTarget(), CODE_BASE + 3);
  assert.equal(e.run({ chunk: 100, target: e.stepOverTarget() }), STOP.TARGET);
  assert.equal(e.state().registers.CX, 2);
  e.reset();
  assert.equal(e.run({ chunk: 100, breakpoints: new Set([p.symbols.f]) }), STOP.BREAK);
  e.reset();
  assert.equal(e.run({ chunk: 100, watch: { registers: new Set(['BX']) } }), STOP.WATCH);
});

test('i8086: profiles: one segment, or segments set by the program', () => {
  const flat = run('HLT').r;
  assert.deepEqual([flat.CS, flat.DS, flat.ES, flat.SS, flat.SP, flat.IP, flat.FLAGS], [0x1000, 0x1000, 0x1000, 0x1000, 0xfffe, 1, 0xf002]);
  const seg = run('HLT', { profile: 'segmented' }).r;
  assert.deepEqual([seg.CS, seg.DS, seg.ES, seg.SS, seg.SP], [0x1000, 0, 0, 0, 0]);
});

test('i8086: undocumented op codes stop the run (author\'s default: documented instructions only)', () => {
  const p = assemble([{ name: 't.asm', text: 'start: DB 0D6H\nHLT\nEND start' }]);
  const e = create(p);
  assert.equal(e.step(), null);
  assert.match(e.state().error, /0D6H.*undocumented/);
});
