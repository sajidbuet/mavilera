// armv7-single.test.mjs -- the ARM single-cycle processor (roadmap ARM-A2, §3): the Main and ALU Decoders against the
// roadmap's decoder table (§3.3, the facts of Harris and Harris's Tables 7.2 and 7.3 with the HDL's don't-care values),
// the ALU's flags against AddWithCarry, lock-step with the instruction-level engine after every cycle (Fig 7.60, the
// templates in the base set and generated programs), the error rules, and step back. The instruction-level engine is
// this application's own model (ARM-A1); agreement with it is not evidence of agreement with Harris's HDL or hardware.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble, STACK_TOP } from '../src/arch/armv7/language.js';
import { create, addWithCarry } from '../src/arch/armv7/engine.js';
import { ArmSingle, mainDecode, aluDecode, alu, extend, MAIN_DECODER } from '../src/arch/armv7/uarch/single.js';
import { SINGLE_SIGNALS, SIGNAL_INFO } from '../src/arch/armv7/uarch/signals.js';

const template = (name) => readFileSync(new URL(`../content/armv7/templates/${name}`, import.meta.url), 'utf8');
const build = (text, profile = 'arm-single') => assemble([{ name: 't.s', text }], { profile });
const ok = (text) => {
  const p = build(text);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return p;
};

/** Step both models to the end; after every cycle the architectural state and the store must agree. */
function lockStep(program, limit = 10_000) {
  const iss = create(program);
  const m = new ArmSingle();
  m.load(program);
  for (let n = 0; n < limit; n++) {
    const rec = iss.step();
    const r = m.step();
    if (!rec) {
      assert.equal(r, 'error', `cycle ${n}: the engine stopped (${iss.state().error}), the processor did not`);
      return { m, iss, cycles: n, error: m.error };
    }
    assert.notEqual(r, 'error', `cycle ${n} at 0x${rec.pc.toString(16)}: ${m.error}`);
    assert.deepEqual(m.registers(), iss.state().registers, `cycle ${n} at 0x${rec.pc.toString(16)}`);
    const st = m.last.mem;
    assert.deepEqual(st ? [[st[0], m.dmem.read(st[0], 4)]] : [], rec.memory.map((x) => [x.address, x.value]), `cycle ${n}: store`);
    if (rec.halt) { assert.equal(r, 'halt'); return { m, iss, cycles: n + 1 }; }
    assert.equal(r, 'step');
  }
  throw new Error('no halt');
}

test('signal dictionary: every signal of roadmap §3.2 with its width', () => {
  const want = { PC: 32, PCNext: 32, PCPlus4: 32, PCPlus8: 32, Instr: 32, Cond: 4, Op: 2, Funct: 6, Rd: 4, RA1: 4, RA2: 4, SrcA: 32,
    WriteData: 32, ExtImm: 32, SrcB: 32, ALUResult: 32, ALUFlags: 4, ReadData: 32, Result: 32, Flags: 4, RegSrc: 2, ImmSrc: 2,
    ALUSrc: 1, MemtoReg: 1, RegW: 1, MemW: 1, Branch: 1, ALUOp: 1, ALUControl: 2, FlagW: 2, PCS: 1, CondEx: 1, FlagWrite: 2,
    RegWrite: 1, MemWrite: 1, PCSrc: 1 };
  for (const [k, w] of Object.entries(want)) assert.equal(SIGNAL_INFO[k]?.width, w, k);
  const m = new ArmSingle();
  m.load(ok('ADD R0, R0, #1\nB .\n'));
  const s = m.evaluate().signals;
  for (const d of SINGLE_SIGNALS) assert.ok(Number.isInteger(s[d.name]) && s[d.name] >= 0 && s[d.name] < 2 ** d.width, d.name);
});

test('Main Decoder: the rows of roadmap §3.3 (Table 7.2 with the HDL values)', () => {
  // class: Op, Funct (I in bit 5, L in bit 0) -> RegSrc ImmSrc ALUSrc MemtoReg RegW MemW Branch ALUOp
  const rows = [
    ['dpReg', 0b00, 0b000000, '00 00 0 0 1 0 0 1'], ['dpReg', 0b00, 0b011111, '00 00 0 0 1 0 0 1'],
    ['dpImm', 0b00, 0b100000, '00 00 1 0 1 0 0 1'], ['dpImm', 0b00, 0b111001, '00 00 1 0 1 0 0 1'],
    ['ldr', 0b01, 0b011001, '00 01 1 1 1 0 0 0'], ['str', 0b01, 0b011000, '10 01 1 1 0 1 0 0'],
    ['b', 0b10, 0b100000, '01 10 1 0 0 0 1 0'], ['b', 0b10, 0b110000, '01 10 1 0 0 0 1 0'],
  ];
  for (const [cls, Op, Funct, bits] of rows) {
    const d = mainDecode(Op, Funct);
    assert.equal(d.cls, cls);
    const got = `${d.RegSrc.toString(2).padStart(2, '0')} ${d.ImmSrc.toString(2).padStart(2, '0')} ${d.ALUSrc} ${d.MemtoReg} ${d.RegW} ${d.MemW} ${d.Branch} ${d.ALUOp}`;
    assert.equal(got, bits, `${cls} ${Funct.toString(2)}`);
  }
  assert.equal(mainDecode(0b11, 0).index, -1, 'Op = 11 is undefined');
  assert.equal(MAIN_DECODER.length, 5);
});

test('ALU Decoder: ALUControl and FlagW (Table 7.3)', () => {
  const f = (cmd, S) => (cmd << 1) | S;
  assert.deepEqual([aluDecode(0, f(0b0010, 1)).ALUControl, aluDecode(0, f(0b0010, 1)).FlagW], [0, 0], 'ALUOp 0: add, no flags');
  for (const [cmd, ctl, fw] of [[0b0100, 0b00, 0b11], [0b0010, 0b01, 0b11], [0b0000, 0b10, 0b10], [0b1100, 0b11, 0b10]]) {
    assert.deepEqual([aluDecode(1, f(cmd, 0)).ALUControl, aluDecode(1, f(cmd, 0)).FlagW], [ctl, 0]);
    assert.deepEqual([aluDecode(1, f(cmd, 1)).ALUControl, aluDecode(1, f(cmd, 1)).FlagW], [ctl, fw]);
  }
  assert.equal(aluDecode(1, f(0b1101, 0)).index, -1, 'MOV is not in the base design');
});

test('ALU: ADD and SUB flags equal AddWithCarry; AND and ORR give C = V = 0', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed; };
  const corners = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff, 0x80000001, 0xfffffffe];
  const values = [...corners, ...Array.from({ length: 300 }, rnd)];
  for (const a of values) for (const b of corners.concat(rnd(), rnd())) {
    const [ra, fa] = alu(a, b, 0b00);
    const [x, c, v] = addWithCarry(a, b, 0);
    assert.deepEqual([ra, fa], [x, ((x >>> 31) << 3) | ((x === 0 ? 1 : 0) << 2) | (c << 1) | v], `${a} + ${b}`);
    const [rs, fs] = alu(a, b, 0b01);
    const [y, c2, v2] = addWithCarry(a, ~b >>> 0, 1);
    assert.deepEqual([rs, fs], [y, ((y >>> 31) << 3) | ((y === 0 ? 1 : 0) << 2) | (c2 << 1) | v2], `${a} - ${b}`);
    assert.equal(alu(a, b, 0b10)[1] & 3, 0);
    assert.equal(alu(a, b, 0b11)[1] & 3, 0);
  }
});

test('Extend (Table 7.1): imm8 and imm12 zero-extended, imm24 sign-extended times 4', () => {
  assert.equal(extend(0xabcdef, 0b00), 0xef);
  assert.equal(extend(0xabcdef, 0b01), 0xdef);
  assert.equal(extend(0xfffffe, 0b10), 0xfffffff8);
  assert.equal(extend(0x000010, 0b10), 0x40);
});

test('Fig 7.60 (p. 453): lock-step with the instruction-level engine; 7 stored at 96 and at 100', () => {
  const { m, cycles } = lockStep(ok(template('fig-7-60.s')));
  assert.equal(m.dmem.read(96, 4), 7);
  assert.equal(m.dmem.read(100, 4), 7);
  assert.equal(m.cycle, cycles);
  assert.ok(m.halted);
});

test('templates: those in the base set run in lock-step; the others are refused by the assembler', () => {
  const index = JSON.parse(template('index.json'));
  let base = 0;
  for (const t of index.templates ?? index) {
    const p = build(template(t.file));
    if (!p.ok) { assert.ok(p.diagnostics.some((x) => x.kind === 'profile'), t.file); continue; }
    lockStep(p);
    base += 1;
  }
  assert.ok(base >= 1);
});

/** A generated program in the base set: ADD, SUB, AND, ORR (register, immediate, S, conditions, R15 as an operand),
 *  LDR and STR at R12 + offset in a data area away from the code, forward branches and ADD R15 skips. */
function generate(seed) {
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  const conds = ['', '', '', 'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE'];
  const ops = ['ADD', 'SUB', 'AND', 'ORR'];
  const reg = () => `R${rnd(12)}`; // R0-R11; R12 is the data base (0)
  const src = () => (rnd(8) === 0 ? 'R15' : reg());
  const n = 8 + rnd(40);
  const lines = Array.from({ length: 4 }, (_, i) => `ADD R${i}, R${i}, #${rnd(256)}`);
  for (let i = 0; i < n; i++) {
    const k = rnd(20);
    const c = conds[rnd(conds.length)];
    if (k < 11) {
      const s = rnd(3) === 0 ? 'S' : '';
      const op2 = rnd(2) ? `#${rnd(256)}` : src();
      lines.push(`${ops[rnd(4)]}${c}${s} ${reg()}, ${src()}, ${op2}`);
    } else if (k < 14) lines.push(`LDR${c} ${reg()}, [R12, #${0x800 + 4 * rnd(256)}]`);
    else if (k < 17) lines.push(`STR${c} ${rnd(10) === 0 ? 'R15' : reg()}, [R12, #${0x800 + 4 * rnd(256)}]`);
    else if (k < 19) lines.push(`B${c} L${i + 1 + rnd(3)}`);
    else lines.push(`ADD${c} R15, R15, #${4 * rnd(3)}`);
    lines.push(`L${i + 1}:`);
  }
  for (let j = n + 1; j <= n + 3; j++) lines.push(`L${j}:`);
  lines.push('NOP_END: B NOP_END');
  return lines.join('\n');
}

test('generated programs: lock-step with the instruction-level engine after every cycle (400 programs)', () => {
  let cycles = 0;
  for (let k = 1; k <= 400; k++) {
    const text = generate(k * 7919);
    const p = build(text);
    assert.ok(p.ok, `program ${k}: ${JSON.stringify(p.diagnostics)}\n${text}`);
    cycles += lockStep(p).cycles;
  }
  assert.ok(cycles > 4000, `${cycles} cycles`);
});

test('errors: a word outside the base set, an unaligned access, a write of an odd address to R15, leaving the code', () => {
  const runIss = (text) => { const m = new ArmSingle(); m.load(build(text, 'arm-iss')); return [m.run(), m.error]; };
  let [r, e] = runIss('MOV R0, #1\nB .\n');
  assert.equal(r, 'error');
  assert.match(e, /does not run MOV/);
  [r, e] = runIss('ADD R1, R1, #2\nLDR R0, [R1, #0]\nB .\n');
  assert.match(e, /Unaligned load/);
  [r, e] = runIss('ADD R1, R1, #2\nSTR R0, [R1, #4]\nB .\n');
  assert.match(e, /Unaligned store/);
  [r, e] = runIss('ADD R1, R1, #9\nADD R15, R1, #0\nB .\n');
  assert.match(e, /Thumb/);
  [r, e] = runIss('ADD R1, R1, #10\nADD R15, R1, #0\nB .\n');
  assert.match(e, /bits 1:0 = 10/);
  [r, e] = runIss('ADD R15, R15, #64\nB .\n');
  assert.match(e, /has left the program/);
  // a failed condition makes no access, so an unaligned address is not an error then
  [r, e] = runIss('ADD R1, R1, #2\nADDS R2, R2, #1\nLDREQ R0, [R1, #0]\nB .\n');
  assert.equal(r, 'halt', e);
});

test('signals of one cycle: STR R15 stores PCPlus8; a failed condition gates every write', () => {
  const m = new ArmSingle();
  m.load(ok('ADDS R0, R0, #0\nSTR R15, [R12, #0x800]\nADDNE R1, R1, #1\nB .\n'));
  m.step();
  let s = m.evaluate().signals;
  assert.equal(s.RA2, 15);
  assert.equal(s.WriteData, 4 + 8);
  assert.equal(s.MemWrite, 1);
  m.step();
  assert.equal(m.dmem.read(0x800, 4), 12);
  s = m.evaluate().signals;
  assert.equal(s.CondEx, 0, 'Z = 1, so NE fails');
  assert.deepEqual([s.RegW, s.RegWrite, s.FlagWrite, s.MemWrite, s.PCSrc], [1, 0, 0, 0, 0]);
  m.step();
  assert.equal(m.R[1], 0);
  assert.equal(m.step(), 'halt');
});

test('step back restores the registers, flags, memory and PC of every cycle', () => {
  const p = ok(generate(12345));
  const m = new ArmSingle();
  m.load(p);
  const states = [];
  const snap = () => JSON.stringify([m.registers(), Array.from({ length: 512 }, (_, i) => m.dmem.read(0x800 + 4 * i, 4))]);
  let r;
  do { states.push(snap()); r = m.step(); } while (r === 'step' && states.length < 1000);
  assert.equal(r, 'halt');
  states.push(snap());
  for (let i = states.length - 2; i >= 0; i--) {
    assert.ok(m.back());
    assert.equal(snap(), states[i], `back to cycle ${i}`);
  }
  assert.equal(m.back(), false);
  assert.equal(m.R[13], STACK_TOP);
});

// --- the Extended datapath (tier E) -----------------------------------------------------------------------------

import { ArmSingleExt, shifter, aluExt, mainDecodeExt, aluDecodeExt } from '../src/arch/armv7/uarch/single-ext.js';
import { shiftC as issShiftC, addWithCarry as issAdd } from '../src/arch/armv7/engine.js';
import { immShift } from '../src/arch/armv7/language.js';

const buildExt = (text) => assemble([{ name: 't.s', text }], { profile: 'arm-single', subset: 'extended' });

/** lockStep() for the Extended processor. */
function lockStepExt(program, limit = 10_000) {
  const iss = create(program);
  const m = new ArmSingleExt();
  m.load(program);
  for (let n = 0; n < limit; n++) {
    const rec = iss.step();
    const r = m.step();
    if (!rec) {
      assert.equal(r, 'error', `cycle ${n}: the engine stopped (${iss.state().error}), the processor did not`);
      return { m, iss, cycles: n };
    }
    assert.notEqual(r, 'error', `cycle ${n} at 0x${rec.pc.toString(16)}: ${m.error}`);
    assert.deepEqual(m.registers(), iss.state().registers, `cycle ${n} at 0x${rec.pc.toString(16)}`);
    const st = m.last.mem;
    assert.deepEqual(st ? [[st[0], m.dmem.read(st[0], 4)]] : [], rec.memory.map((x) => [x.address, x.value]), `cycle ${n}: store`);
    if (rec.halt) { assert.equal(r, 'halt'); return { m, iss, cycles: n + 1 }; }
  }
  throw new Error(`no halt: pc 0x${m.pc.toString(16)}`);
}

test('Extended: the shifter equals Shift_C with DecodeImmShift for every type and amount', () => {
  const values = [0, 1, 0x80000000, 0xffffffff, 0x12345678, 0x80000001, 0x7fffffff];
  for (const v of values) for (const c of [0, 1]) for (let sh = 0; sh < 4; sh++) for (let imm5 = 0; imm5 < 32; imm5++) {
    assert.deepEqual(shifter(v, (imm5 << 2) | sh, c), issShiftC(v, ...immShift(sh, imm5), c), `${v} sh ${sh} imm5 ${imm5} C ${c}`);
  }
});

test('Extended: the ALU equals AddWithCarry for the arithmetic operations; logical ones give C = ShiftC and keep V', () => {
  const vals = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff, 0x12345678];
  const f = ([r, c, v]) => [r, ((r >>> 31) << 3) | ((r === 0 ? 1 : 0) << 2) | (c << 1) | v];
  for (const a of vals) for (const b of vals) for (const c of [0, 1]) {
    assert.deepEqual(aluExt(a, b, 4, c, 0, 0), f(issAdd(a, b, 0)));
    assert.deepEqual(aluExt(a, b, 5, c, 0, 0), f(issAdd(a, b, c)));
    assert.deepEqual(aluExt(a, b, 2, c, 0, 0), f(issAdd(a, ~b >>> 0, 1)));
    assert.deepEqual(aluExt(a, b, 3, c, 0, 0), f(issAdd(~a >>> 0, b, 1)));
    assert.deepEqual(aluExt(a, b, 6, c, 0, 0), f(issAdd(a, ~b >>> 0, c)));
    for (const [ctl, want] of [[0, a & b], [1, a ^ b], [12, a | b], [13, b], [14, a & ~b]]) {
      const [r, fl] = aluExt(a, b, ctl, 0, c, 1 - c);
      assert.equal(r, want >>> 0);
      assert.equal(fl & 3, ((1 - c) << 1) | c, 'C = ShiftC, V kept');
    }
  }
});

test('Extended: decoders: BL links, LDRB selects the byte, U chooses the sign of the offset, the tests set NoWrite', () => {
  assert.equal(mainDecodeExt(0b10, 0b110000).cls, 'bl');
  assert.equal(mainDecodeExt(0b10, 0b100000).cls, 'b');
  assert.equal(mainDecodeExt(0b01, 0b011101).cls, 'ldrb');
  assert.equal(aluDecodeExt(0b01, 0b011001).ALUControl, 0b0100, 'U = 1: add');
  assert.equal(aluDecodeExt(0b01, 0b010001).ALUControl, 0b0010, 'U = 0: subtract');
  for (const [cmd, nw] of [[8, 1], [9, 1], [10, 1], [11, 1], [13, 0], [5, 0]]) assert.equal(aluDecodeExt(0b10, (cmd << 1) | 1).NoWrite, nw, DP_NAME(cmd));
  assert.equal(aluDecodeExt(0b10, 0b011010).FlagW, 0, 'S = 0');
  assert.equal(aluDecodeExt(0b10, 0b011011).FlagW, 3, 'S = 1');
});
const DP_NAME = (cmd) => ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'RSC', 'TST', 'TEQ', 'CMP', 'CMN', 'ORR', 'MOV', 'BIC', 'MVN'][cmd];

test('Extended: every template the extended assembler accepts runs in lock-step', () => {
  const index = JSON.parse(template('index.json'));
  let n = 0;
  for (const t of index.templates) {
    const p = buildExt(template(t.file));
    if (!p.ok) { assert.ok(p.diagnostics.some((x) => x.kind === 'profile'), t.file); continue; }
    lockStepExt(p);
    n += 1;
  }
  assert.ok(n >= 2, `${n} templates`);
});

/** A generated tier-E program: every tier-E data-processing operation with constant shifts and S, LDR, LDRB and STR
 *  with both offset signs, BL to a subroutine that returns with MOV PC, LR, forward branches. */
function generateExt(seed) {
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) % n; };
  const conds = ['', '', '', 'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE'];
  const three = ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'ORR', 'BIC'];
  const tests = ['TST', 'TEQ', 'CMP', 'CMN'];
  const shifts = ['LSL', 'LSR', 'ASR', 'ROR'];
  const reg = () => `R${rnd(11)}`; // R0-R10; R11 = 0x800 base, R12 = 0x1000 base
  const src = () => (rnd(8) === 0 ? 'R15' : reg());
  const op2 = () => {
    const k = rnd(4);
    if (k === 0) return `#${rnd(256)}`;
    if (k === 1) return src();
    const s = shifts[rnd(4)];
    return `${reg()}, ${s} #${s === 'LSL' || s === 'ROR' ? 1 + rnd(31) : 1 + rnd(32)}`;
  };
  const n = 8 + rnd(40);
  const lines = ['MOV R11, #128', 'LSL R11, R11, #4', 'MOV R12, #1', 'LSL R12, R12, #12', ...Array.from({ length: 4 }, (_, i) => `MOV R${i}, #${rnd(256)}`)];
  for (let i = 0; i < n; i++) {
    const k = rnd(24);
    const c = conds[rnd(conds.length)];
    const s = rnd(3) === 0 ? 'S' : '';
    if (k < 8) lines.push(`${three[rnd(three.length)]}${c}${s} ${reg()}, ${src()}, ${op2()}`);
    else if (k < 10) lines.push(`${tests[rnd(4)]}${c} ${src()}, ${op2()}`);
    else if (k < 12) lines.push(rnd(2) ? `MOV${c}${s} ${reg()}, ${op2()}` : `${shifts[rnd(4)]}${c}${s} ${reg()}, ${reg()}, #${1 + rnd(31)}`);
    else if (k < 14) lines.push(`LDR${c} ${reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${4 * rnd(256)}]`);
    else if (k < 16) lines.push(`LDRB${c} ${reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${rnd(1024)}]`);
    else if (k < 18) lines.push(`STR${c} ${rnd(10) === 0 ? 'R15' : reg()}, [R${rnd(2) ? 11 : 12}, #${rnd(2) ? '' : '-'}${4 * rnd(256)}]`);
    else if (k < 20) lines.push(`B${c} L${i + 1 + rnd(3)}`);
    else if (k < 22) lines.push(`BL${c} SUB`);
    else lines.push(`ADD${c} R15, R15, #${4 * rnd(3)}`);
    lines.push(`L${i + 1}:`);
  }
  for (let j = n + 1; j <= n + 3; j++) lines.push(`L${j}:`);
  lines.push('B END', 'B END', 'B END', 'END: B END', 'SUB: ADD R10, R10, #1', 'MOV PC, LR'); // an ADD R15 skip lands on a B END
  return lines.join('\n');
}

test('Extended: generated tier-E programs run in lock-step with the instruction-level engine (400 programs)', () => {
  let cycles = 0;
  for (let k = 1; k <= 400; k++) {
    const text = generateExt(k * 104729);
    const p = buildExt(text);
    assert.ok(p.ok, `program ${k}: ${JSON.stringify(p.diagnostics.slice(0, 3))}\n${text}`);
    try { cycles += lockStepExt(p).cycles; } catch (e) { throw new Error(`program ${k}: ${e.message}\n${text}`); }
  }
  assert.ok(cycles > 4000, `${cycles} cycles`);
});

test('Extended: an instruction-level form is refused; LDRB needs no alignment; the base model still refuses MOV', () => {
  const m = new ArmSingleExt();
  m.load(assemble([{ name: 't.s', text: 'MOV R0, #0x10000\nB .\n' }]));
  assert.equal(m.run(), 'error');
  assert.match(m.error, /Extended datapath does not run/);
  const p = buildExt('MOV R1, #0x80\nLSL R1, R1, #4\nADD R1, R1, #3\nMOV R2, #0x41\nSTR R2, [R1, #-3]\nLDRB R3, [R1, #0]\nLDRB R4, [R1, #-3]\nB .\n');
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const { m: x } = lockStepExt(p);
  assert.deepEqual([x.R[3], x.R[4]], [0, 0x41]);
});
