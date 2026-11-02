// armv7-engine.test.mjs -- the ARMv7 instruction-level engine (roadmap ARM-A1; reference sheet
// docs/architecture/armv7-reference.md): AddWithCarry and Shift_C corners, the 15 condition codes passing and failing,
// R15 reads and writes, the error rules (W-D32 Q3), branches and the call stack, step back over every kind of step,
// snapshots, and twelve programs whose end states were computed by hand (the expected values below are the hand
// calculation; Fig 7.60's are Harris's: 7 stored at 96 and at 100, p. 453). No oracle has been run (sheet §12).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, STACK_TOP, CONDS } from '../src/arch/armv7/language.js';
import { create, addWithCarry, shiftC, passed } from '../src/arch/armv7/engine.js';
import { STOP } from '../src/arch/contract.js';
import { readFileSync } from 'node:fs';

const template = (name) => readFileSync(new URL(`../content/armv7/templates/${name}`, import.meta.url), 'utf8');

const build = (src) => {
  const p = assemble([{ name: 't.s', text: src }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};
/** Run to the end; returns {e, s (state), regs (r0-r15 and flags), word(a), stores}. */
function run(src, options) {
  const e = create(build(src), options);
  const stores = [];
  let r;
  while ((r = e.step())) { for (const m of r.memory) stores.push([m.address, m.value]); if (r.halt) break; }
  const s = e.state();
  const word = (a) => { const b = e.peek(a, 4); return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; };
  return { e, s, regs: s.registers, word, stores };
}
/** The flags as a string, NZCV. */
const nzcv = (r) => `${r.N}${r.Z}${r.C}${r.V}`;

test('AddWithCarry (A2-43): the carry and overflow corners', () => {
  assert.deepEqual(addWithCarry(0xffffffff, 1, 0), [0, 1, 0]);
  assert.deepEqual(addWithCarry(0x7fffffff, 1, 0), [0x80000000, 0, 1]);
  assert.deepEqual(addWithCarry(0x80000000, 0x80000000, 0), [0, 1, 1]);
  assert.deepEqual(addWithCarry(0, ~1 >>> 0, 1), [0xffffffff, 0, 0], '0 - 1: a borrow, C = 0');
  assert.deepEqual(addWithCarry(0x80000000, ~1 >>> 0, 1), [0x7fffffff, 1, 1], 'CMP 0x80000000, 1 (HH p. 307)');
  assert.deepEqual(addWithCarry(5, ~5 >>> 0, 1), [0, 1, 0], '5 - 5: no borrow, C = 1');
});

test('Shift_C (A8-290): amounts 0, 1-31, 32 and over 32, and RRX', () => {
  assert.deepEqual(shiftC(0x80000001, 0, 0, 1), [0x80000001, 1], 'amount 0: carry in');
  assert.deepEqual(shiftC(0x80000001, 0, 1, 0), [2, 1]);
  assert.deepEqual(shiftC(0x00000001, 0, 32, 0), [0, 1]);
  assert.deepEqual(shiftC(0xffffffff, 0, 33, 1), [0, 0]);
  assert.deepEqual(shiftC(0x80000000, 1, 32, 0), [0, 1]);
  assert.deepEqual(shiftC(0x80000000, 1, 31, 0), [1, 0]);
  assert.deepEqual(shiftC(0x80000000, 2, 32, 0), [0xffffffff, 1]);
  assert.deepEqual(shiftC(0x80000000, 2, 200, 0), [0xffffffff, 1]);
  assert.deepEqual(shiftC(0x40000000, 2, 40, 1), [0, 0]);
  assert.deepEqual(shiftC(0x80000001, 3, 1, 0), [0xc0000000, 1]);
  assert.deepEqual(shiftC(0x80000001, 3, 32, 0), [0x80000001, 1], 'ROR by 32: unchanged, C = bit 31');
  assert.deepEqual(shiftC(0x00000002, 4, 1, 1), [0x80000001, 0], 'RRX');
});

test('flags of programs: arithmetic sets N Z C V; logical sets N Z and C from the shifter, leaves V (sheet §4.5)', () => {
  const cases = [
    ['MVN R1, #0\n ADDS R0, R1, #1', 0, '0110'],
    ['MVN R1, #0x80000000\n ADDS R0, R1, #1', 0x80000000, '1001'],
    ['MOV R1, #0\n SUBS R0, R1, #1', 0xffffffff, '1000'],
    ['MOV R1, #0x80000000\n SUBS R0, R1, #1', 0x7fffffff, '0011'],
    ['MOV R1, #5\n SUBS R0, R1, #5', 0, '0110'],
    ['MOV R1, #5\n RSBS R0, R1, #3', 0xfffffffe, '1000'],
    ['MVN R1, #0\n ADDS R1, R1, R1\n MOV R1, #1\n ADCS R0, R1, #1', 3, '0000'],
    ['MOV R1, #0\n SUBS R1, R1, #1\n MOV R1, #5\n SBCS R0, R1, #3', 1, '0010'], // C = 0 before: 5 - 3 - 1
    ['MOV R1, #3\n SUBS R1, R1, #1\n MOV R1, #5\n SBCS R0, R1, #3', 2, '0010'], // C = 1 before: 5 - 3
    ['MOV R1, #0\n SUBS R1, R1, #1\n MOV R1, #3\n MOV R2, #5\n RSCS R0, R1, R2', 1, '0010'], // 5 - 3 - NOT C
    ['MOV R1, #0x80000000\n SUBS R2, R1, #1\n ANDS R0, R1, R1', 0x80000000, '1011'], // C and V stay 1
    ['MOV R1, #0x80000000\n SUBS R2, R1, #1\n MOV R1, #0\n ORRS R0, R1, R1', 0, '0111'],
    ['MOV R1, #0x80000001\n ORRS R0, R1, R1, LSL #1', 0x80000003, '1010'],
    ['MOVS R0, #0x80000000', 0x80000000, '1010'], // a rotated constant: C = bit 31
    ['MOV R1, #1\n SUBS R2, R1, #0\n MOVS R0, #0x40000000', 0x40000000, '0000'],
    ['MOV R1, #1\n SUBS R2, R1, #0\n MOVS R0, #1', 1, '0010'], // rotation 0: C unchanged (1)
    ['MOV R1, #0x80000001\n LSLS R0, R1, #1', 2, '0010'],
    ['MOV R1, #0x80000000\n LSRS R0, R1, #32', 0, '0110'],
    ['MOV R1, #0x80000000\n ASRS R0, R1, #32', 0xffffffff, '1010'],
    ['MOV R1, #1\n SUBS R2, R1, #0\n MOV R1, #2\n RRXS R0, R1', 0x80000001, '1000'],
    ['MOV R1, #1\n MOV R2, #33\n LSLS R0, R1, R2', 0, '0100'],
    ['MOV R1, #1\n MOV R2, #32\n LSLS R0, R1, R2', 0, '0110'],
    ['MOV R1, #0x80000000\n MOV R2, #256\n LSRS R0, R1, R2', 0x80000000, '1000'], // Rs[7:0] = 0: no shift, C unchanged
    ['MOV R1, #0x80000001\n MOV R2, #32\n RORS R0, R1, R2', 0x80000001, '1010'],
    ['MOV R1, #5\n TST R1, #2', null, '0100'],
    ['MOV R1, #5\n TEQ R1, #5', null, '0100'],
    ['MOV R1, #5\n CMN R1, #5', null, '0000'],
    ['MOV R1, #1\n MVNS R0, R1', 0xfffffffe, '1000'],
    ['MOV R1, #0xFF\n BICS R0, R1, #0x0F', 0xf0, '0000'],
    ['MOV R1, #0xFF\n EORS R0, R1, #0xFF', 0, '0100'],
  ];
  for (const [src, r0, flags] of cases) {
    const { regs, s } = run(` ${src}\n B .`);
    assert.equal(s.error, null, src);
    if (r0 !== null) assert.equal(regs.r0, r0, `${src}: R0`);
    assert.equal(nzcv(regs), flags, `${src}: NZCV`);
  }
});

test('all 15 condition codes, passing and failing, for all 16 flag values (sheet §3)', () => {
  const ref = { EQ: (f) => f.Z, NE: (f) => !f.Z, CS: (f) => f.C, CC: (f) => !f.C, MI: (f) => f.N, PL: (f) => !f.N, VS: (f) => f.V, VC: (f) => !f.V,
    HI: (f) => f.C && !f.Z, LS: (f) => !f.C || f.Z, GE: (f) => f.N === f.V, LT: (f) => f.N !== f.V, GT: (f) => !f.Z && f.N === f.V,
    LE: (f) => f.Z || f.N !== f.V, AL: () => true };
  let seen = 0;
  for (const c of CONDS) {
    const e = create(build(` ADD${c === 'AL' ? '' : c} R0, R0, #1\n B .`));
    const base = e.snapshot();
    const results = new Set();
    for (let k = 0; k < 16; k++) {
      const F = { N: (k >> 3) & 1, Z: (k >> 2) & 1, C: (k >> 1) & 1, V: k & 1 };
      e.restore({ ...base, F });
      const want = Boolean(ref[c](F));
      assert.equal(passed(CONDS.indexOf(c), F), want, `${c} ${k}`);
      const r = e.step();
      assert.equal(r.executed, want, `${c} with NZCV ${k.toString(2).padStart(4, '0')}`);
      assert.equal(r.nextPc, 4);
      assert.deepEqual(r.registers.map((x) => x.id), want ? ['r0'] : []);
      assert.equal(e.state().registers.r0, want ? 1 : 0);
      results.add(want);
    }
    assert.ok(c === 'AL' ? results.size === 1 : results.size === 2, `${c} both passes and fails`);
    seen += 1;
  }
  assert.equal(seen, 15);
});

test('R15 reads as the address + 8; STR R15 stores it; writes to R15 by ADD, MOV and LDR branch (sheet §§4.5, 5.3, 9)', () => {
  const { regs, word } = run(` MOV R0, PC\n ADD R1, PC, #4\n STR PC, [R2, #0x100]\n LDR R3, [PC, #-4]\n ADD PC, PC, #0\n MOV R4, #1\n MOV R5, #2\n B .`);
  assert.equal(regs.r0, 8);
  assert.equal(regs.r1, 4 + 8 + 4);
  assert.equal(word(0x100), 8 + 8);
  assert.equal(regs.r3, 0xe28ff000, 'LDR R3, [PC, #-4] at 12 reads the word at 16, ADD PC, PC, #0');
  assert.equal(regs.r4, 0, 'ADD PC, PC, #0 at 16 skips the instruction at 20');
  assert.equal(regs.r5, 2);
  const ld = run(` MOV R1, #0x100\n MOV R2, #0x14\n STR R2, [R1]\n LDR PC, [R1]\n MOV R0, #1\n MOV R0, #2\n B .`);
  assert.equal(ld.regs.r0, 2, 'LDR PC jumps to 0x14');
  const mov = run(` MOV R3, #12\n MOV PC, R3\n MOV R0, #1\n MOV R0, #9\n B .`);
  assert.equal(mov.regs.r0, 9);
});

test('LDR =value loads the value (MOV, MVN or the literal pool); NOP writes R0 with its own value (A1-Q5b)', () => {
  const { regs, s } = run(` NOP\n LDR R0, =0x12345678\n LDR R1, =-2\n LDR R2, =0x12345678\n LDR R3, =words\n LDR R4, [R3, #4]\n NOP\n B .\n .data\nwords: .word 1, 0xCAFE`);
  assert.equal(s.error, null);
  assert.deepEqual([regs.r0, regs.r1, regs.r2, regs.r3, regs.r4], [0x12345678, 0xfffffffe, 0x12345678, 0x10000, 0xcafe]);
  assert.equal(nzcv(regs), '0000');
  const e = create(build(' MOV R0, #7\n NOP\n B .'));
  e.step();
  assert.deepEqual(e.step().registers, [{ id: 'r0', old: 7, value: 7 }], 'MOV R0, R0');
});

test('the error rules stop the run and change nothing; step back clears the error (W-D32 Q3)', () => {
  const cases = [
    [' MOV R1, #2\n LDR R0, [R1]', /Unaligned load at 0x00000002/],
    [' MOV R1, #1\n STR R0, [R1, #4]', /Unaligned store at 0x00000005/],
    [' MOV R1, #2\n LDM R1, {R2, R3}', /Unaligned load/],
    [' MOV R3, #0x11\n MOV PC, R3', /Thumb/],
    [' MOV R3, #0x12\n MOV PC, R3', /bits 1:0 = 10/],
    [' MOV R1, #0x100\n MOV R2, #0x21\n STR R2, [R1]\n LDR PC, [R1]', /Thumb/],
    [' MOV R2, #0x1\n PUSH {R2}\n POP {PC}', /Thumb/],
    [' B 0x400', /left the program/],
    [' MOV R0, R0', /left the program/],
  ];
  for (const [src, re] of cases) {
    const e = create(build(src));
    let r;
    let n = 0;
    while ((r = e.step())) n += 1;
    const s = e.state();
    assert.match(s.error, re, src);
    assert.equal(s.halted, true);
    assert.equal(s.retired, n);
    assert.equal(e.run({}), STOP.ERROR);
    assert.ok(e.back());
    assert.equal(e.state().error, null);
    assert.equal(e.state().retired, n, 'the failed step left nothing to undo');
  }
  // a word written by the program is decoded when fetched: SVC is out of scope
  const w = create(build(` MOV R1, #0xEF000000\n STR R1, [PC, #-4]\n B .`));
  w.run({});
  assert.match(w.state().error, /is not run: a coprocessor instruction or SVC/);
  // LDRB is unaligned-safe
  assert.equal(run(` MOV R1, #0x100\n ADD R1, R1, #1\n LDRB R0, [R1]\n B .`).s.error, null);
});

test('branches both ways; BL links; the call stack, step over and step out follow BL and its return', () => {
  const src = ` MOV R0, #0
        BL   f          ; 4
        B    .          ; 8
f:      ADD  R0, R0, #1 ; 12
        CMP  R0, #3
        BLT  f          ; backwards
        PUSH {LR}       ; 24
        BL   g          ; 28
        POP  {PC}       ; 32: back to 8
g:      MOV  PC, LR     ; 36: back to 32`;
  const e = create(build(src));
  e.step();
  assert.equal(e.stepOverTarget(), 8);
  const bl = e.step();
  assert.equal(bl.nextPc, 12);
  assert.deepEqual(bl.registers, [{ id: 'r14', old: 0, value: 8 }]);
  assert.equal(e.callDepth(), 1);
  assert.deepEqual(e.callStack().map((f) => [f.depth, f.name, f.target, f.call, f.ret, f.sp]), [[1, 'f', 12, 4, 8, STACK_TOP]]);
  assert.equal(e.stepOutTarget(), 8);
  assert.equal(e.run({ target: 24, chunk: 100 }), STOP.TARGET);
  assert.equal(e.state().registers.r0, 3);
  e.step(); // PUSH {LR}
  e.step();
  assert.equal(e.callDepth(), 2);
  assert.equal(e.callStack()[0].name, 'g');
  assert.equal(e.callStack()[0].sp, STACK_TOP - 4);
  e.step();
  assert.equal(e.callDepth(), 1, 'MOV PC, LR to the return address of g closes its frame');
  e.step();
  assert.equal(e.callDepth(), 0, 'POP {PC} to the return address of f closes its frame');
  assert.equal(e.state().pc, 8);
  assert.ok(e.back());
  assert.equal(e.callDepth(), 1, 'step back reopens the frame');
  // run to cursor with a depth: 8 is reached only at depth 0
  const e2 = create(build(src));
  assert.equal(e2.run({ target: 8, depth: 0, chunk: 1000 }), STOP.TARGET);
  assert.equal(e2.callDepth(), 0);
});

/** The twelve hand-computed programs: source, then a check of the end state. */
const PROGRAMS = {
  'sum 1 to 10 (the default program)': [`        MOV  R0, #0\n        MOV  R1, #1\nloop:   ADD  R0, R0, R1\n        ADD  R1, R1, #1\n        CMP  R1, #10\n        BLE  loop\n        STR  R0, [R2, #100]\ndone:   B    done`,
    ({ regs, word }) => { assert.equal(regs.r0, 55); assert.equal(regs.r1, 11); assert.equal(word(100), 55); }],
  'Fig 7.60': [template('fig-7-60.s'), ({ regs, stores, s }) => {
    assert.deepEqual(stores, [[96, 7], [100, 7]]);
    assert.deepEqual([regs.r0, regs.r2, regs.r3, regs.r4, regs.r5, regs.r7, regs.r8], [0, 7, 12, 7, 11, 7, 0xfffffffe]);
    assert.equal(nzcv(regs), '1000');
    assert.equal(s.retired, 20);
  }],
  'recursive factorial with PUSH, POP and BL': [`        MOV  R0, #5
        BL   fact
        MOV  R4, R0
done:   B    done
fact:   PUSH {R4, LR}
        MOV  R4, R0
        CMP  R0, #1
        MOVLE R0, #1
        BLE  ret
        SUB  R0, R0, #1
        BL   fact
        MOV  R1, R0
        MOV  R0, #0
mul:    ADD  R0, R0, R1
        SUBS R4, R4, #1
        BNE  mul
ret:    POP  {R4, PC}`, ({ regs }) => { assert.equal(regs.r4, 120); assert.equal(regs.r0, 120); assert.equal(regs.r13, STACK_TOP); }],
  'array sum with post-indexed LDR': [`        MOV  R4, #0x10000\n        MOV  R1, #8\n        MOV  R0, #0\nloop:   LDR  R2, [R4], #4\n        ADD  R0, R0, R2\n        SUBS R1, R1, #1\n        BNE  loop\ndone:   B done\n        .data\n        .word 3, 1, 4, 1, 5, 9, 2, 6`,
    ({ regs }) => { assert.equal(regs.r0, 31); assert.equal(regs.r4, 0x10020); assert.equal(regs.r1, 0); }],
  'string length with LDRB': [`        MOV  R1, #0x10000\n        MOV  R0, #0\nnext:   LDRB R2, [R1], #1\n        CMP  R2, #0\n        ADDNE R0, R0, #1\n        BNE  next\ndone:   B done\n        .data\n        .asciz "hello"`,
    ({ regs }) => { assert.equal(regs.r0, 5); assert.equal(regs.r1, 0x10006); }],
  'signed and unsigned maximum': [`        MOV  R1, #7\n        MVN  R2, #2\n        CMP  R1, R2\n        MOVGT R0, R1\n        MOVLE R0, R2\n        MOVHI R3, R1\n        MOVLS R3, R2\ndone:   B done`,
    ({ regs }) => { assert.equal(regs.r0, 7); assert.equal(regs.r3, 0xfffffffd); assert.equal(nzcv(regs), '0000'); }],
  'copy four words with LDM and STM': [`        MOV  R0, #0x10000\n        ADD  R1, R0, #16\n        LDM  R0!, {R2-R5}\n        STM  R1!, {R2-R5}\ndone:   B done\n        .data\n        .word 10, 20, 30, 40`,
    ({ regs, word }) => {
      assert.deepEqual([regs.r0, regs.r1, regs.r2, regs.r3, regs.r4, regs.r5], [0x10010, 0x10020, 10, 20, 30, 40]);
      assert.deepEqual([0, 4, 8, 12].map((k) => word(0x10010 + k)), [10, 20, 30, 40]);
    }],
  'count the 1 bits with LSRS and ADC': [`        MOV  R1, #0xF000\n        ORR  R1, R1, #0xF0\n        MOV  R0, #0\nloop:   LSRS R1, R1, #1\n        ADC  R0, R0, #0\n        BNE  loop\ndone:   B done`,
    ({ regs }) => { assert.equal(regs.r0, 8); assert.equal(regs.r1, 0); }],
  '64-bit addition with ADDS and ADC': [`        MVN  R0, #0\n        MOV  R1, #1\n        MOV  R2, #1\n        MOV  R3, #2\n        ADDS R4, R0, R2\n        ADC  R5, R1, R3\ndone:   B done`,
    ({ regs }) => { assert.equal(regs.r4, 0); assert.equal(regs.r5, 4); assert.equal(nzcv(regs), '0110'); }],
  'times ten with shifted operands': [`        MOV  R1, #13\n        ADD  R0, R1, R1, LSL #2\n        LSL  R0, R0, #1\ndone:   B done`,
    ({ regs }) => assert.equal(regs.r0, 130)],
  'greatest common divisor with SUBGT and SUBLT': [`        MOV  R0, #48\n        MOV  R1, #18\ngcd:    CMP  R0, R1\n        SUBGT R0, R0, R1\n        SUBLT R1, R1, R0\n        BNE  gcd\ndone:   B done`,
    ({ regs }) => { assert.equal(regs.r0, 6); assert.equal(regs.r1, 6); }],
  'byte reversal with EOR, BIC and ROR': [`        MOV  R4, #0x10000\n        LDR  R0, [R4]\n        EOR  R1, R0, R0, ROR #16\n        BIC  R1, R1, #0xFF0000\n        MOV  R0, R0, ROR #8\n        EOR  R0, R0, R1, LSR #8\n        STR  R0, [R4, #4]\ndone:   B done\n        .data\n        .word 0x12345678`,
    ({ regs, word }) => { assert.equal(regs.r0, 0x78563412); assert.equal(word(0x10004), 0x78563412); }],
};

for (const [name, [src, check]] of Object.entries(PROGRAMS)) {
  test(`hand-computed program: ${name}`, () => {
    const r = run(src);
    assert.equal(r.s.error, null);
    assert.equal(r.s.halted, true);
    check(r);
  });
}

test('step back from the end of each program restores every earlier state, registers and memory (LDM, STM, BL, POP)', () => {
  for (const [name, [src]] of Object.entries(PROGRAMS)) {
    const e = create(build(src));
    const mem = () => [...e.peek(0, 0x80), ...e.peek(0x10000, 0x40), ...e.peek(STACK_TOP - 0x40, 0x40)];
    const states = [];
    for (;;) {
      states.push([e.state(), mem(), e.callDepth()]);
      const r = e.step();
      if (!r || r.halt) break;
    }
    states.push([e.state(), mem(), e.callDepth()]);
    for (let i = states.length - 2; i >= 0; i--) {
      assert.ok(e.back(), name);
      assert.deepEqual([e.state(), mem(), e.callDepth()], states[i], `${name}: back to step ${i}`);
    }
    assert.equal(e.back(), false);
  }
});

test('last() repeats the newest step record; a snapshot carries the history, and step back works after restore', () => {
  const src = PROGRAMS['recursive factorial with PUSH, POP and BL'][0];
  const e = create(build(src));
  const recs = [];
  for (let i = 0; i < 40; i++) {
    const r = e.step();
    const { reads, executed, halt, ...core } = r;
    assert.deepEqual(e.last(), core, `step ${i}`);
    recs.push(e.state());
  }
  const snap = structuredClone(e.snapshot());
  const f = create(build(src));
  f.restore(snap);
  assert.deepEqual(f.state(), e.state());
  assert.equal(f.callDepth(), e.callDepth());
  for (let i = 38; i >= 0; i--) { assert.ok(f.back()); assert.deepEqual(f.state(), recs[i]); }
});

test('a short history drops the oldest steps and counts them', () => {
  const e = create(build(PROGRAMS['greatest common divisor with SUBGT and SUBLT'][0]), { historyLimit: 4 });
  for (let i = 0; i < 10; i++) e.step();
  assert.equal(e.state().historyDropped, 6);
  for (let i = 0; i < 4; i++) assert.ok(e.back());
  assert.equal(e.back(), false);
  assert.equal(e.state().retired, 6);
});

test('watchpoints on a flag and a memory word; data access of the next instruction; counters', () => {
  const src = PROGRAMS['copy four words with LDM and STM'][0];
  const e = create(build(src));
  assert.equal(e.run({ watch: { memory: new Set([0x10018]) } }), STOP.WATCH);
  assert.equal(e.state().pc, 16);
  e.reset();
  e.step(); e.step();
  assert.deepEqual(e.dataAccess(), { address: 0x10000, size: 16 });
  const g = create(build(PROGRAMS['greatest common divisor with SUBGT and SUBLT'][0]));
  assert.equal(g.run({ watch: { registers: new Set(['Z']) } }), STOP.WATCH);
  g.run({});
  const c = Object.fromEntries(g.counters());
  assert.equal(c.Instructions, c.Executed + c['Condition failed'] + c['Branches not taken']);
  assert.equal(c['Branches taken'], 5, 'BNE taken four times, and B . that ends the run');
  assert.equal(c['Branches not taken'], 1);
});
