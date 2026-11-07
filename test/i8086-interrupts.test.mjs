// The 8086 interrupt inputs and the single-step trap (8086-B8; src/arch/i8086/interrupts.js, engine.js): hand cases for
// the rules of IFUM pp. 2-22 to 2-27 and AP-67 p. A-27 (validation matrix, roadmap §8: NMI, INTR and TF are not exercised
// by SingleStepTests, so these cases are the check), the HLT wake, step back, replay and the recomputed record.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { descriptor } from '../src/arch/i8086/index.js';
import { STOP } from '../src/arch/contract.js';

const build = (body, options = {}) => {
  const p = descriptor.language.assemble([{ name: 't.asm', text: body }], { profile: 'flat' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  return { p, e: descriptor.engine.create(p, options) };
};
const runAll = (e) => { let s; do s = e.run({ chunk: 100_000 }); while (s === STOP.CHUNK); return s; };
const out = (e) => e.state().output;

// Handlers print a letter: N for NMI (type 2), I for INTR type 20H, T for single-step (type 1), D for a divide error.
const VECTORS = `
        XOR  AX, AX
        MOV  ES, AX
        MOV  WORD PTR ES:[4*2], OFFSET nmi_h
        MOV  ES:[4*2+2], CS
        MOV  WORD PTR ES:[4*20H], OFFSET intr_h
        MOV  ES:[4*20H+2], CS
        MOV  WORD PTR ES:[4*1], OFFSET step_h
        MOV  ES:[4*1+2], CS
        MOV  WORD PTR ES:[0], OFFSET div_h
        MOV  ES:[2], CS
        PUSH CS
        POP  ES`;
const HANDLERS = `
nmi_h:  PUSH AX
        MOV  AL, 'N'
        OUT  0E9H, AL
        POP  AX
        IRET
intr_h: PUSH AX
        MOV  AL, 'I'
        OUT  0E9H, AL
        POP  AX
        IRET
step_h: PUSH AX
        MOV  AL, 'T'
        OUT  0E9H, AL
        POP  AX
        IRET
div_h:  PUSH AX
        MOV  AL, 'D'
        OUT  0E9H, AL
        POP  AX
        IRET`;
const prog = (main) => `${VECTORS}\n${main}\n        HLT\n${HANDLERS}\n`;

/** Step until the instruction at label `at` is next. */
const stepTo = (p, e, label) => {
  const target = p.symbols[label];
  for (let i = 0; i < 10_000 && e.state().pc !== target; i++) assert.ok(e.step(), e.state().error ?? 'stopped');
  assert.equal(e.state().pc, target);
};

test('i8086 interrupts: NMI is taken at the next boundary even with IF = 0, entry pushes FLAGS, CS, IP and clears IF, TF', () => {
  const { p, e } = build(prog('        CLI\nhere:   NOP\n        MOV  AL, \'.\'\n        OUT  0E9H, AL'));
  stepTo(p, e, 'here');
  const sp = e.state().registers.SP;
  e.input({ nmi: true });
  const rec = e.step();
  assert.equal(rec.trap.cause, 2);
  assert.equal(rec.executed, false);
  assert.equal(rec.pc, p.symbols.here, 'the record names the instruction it comes before');
  const r = e.state().registers;
  assert.equal(r.SP, (sp - 6) & 0xffff);
  assert.equal(r.IP, p.symbols.nmi_h - 0x10000);
  assert.equal(r.FLAGS & 0x0300, 0);
  assert.equal(runAll(e), STOP.HALT);
  assert.equal(out(e), 'N.');
  assert.equal(e.state().retired, e.state().steps - 1, 'an entry completes no instruction');
});

test('i8086 interrupts: INTR waits while IF = 0 and is taken one instruction after STI; the switch stays on (level)', () => {
  const { p, e } = build(prog(`        CLI
hold:   NOP
        STI
        MOV  AL, '1'
        OUT  0E9H, AL
        CLI
        MOV  AL, '2'
        OUT  0E9H, AL`));
  stepTo(p, e, 'hold');
  e.input({ intr: true, type: 0x20 });
  assert.equal(runAll(e), STOP.HALT);
  // after STI, MOV AL,'1' runs first (the STI delay), then I; the handler's IRET restores IF = 1 and INTR is still on,
  // so after one more instruction (the IRET delay: OUT '1') it is taken again; then CLI runs (the IRET delay) and ends it
  assert.equal(out(e), 'I1I2');
});

test('i8086 interrupts: no interrupt after MOV SS until after the next instruction (p. 2-24)', () => {
  const entryAfter = (second) => {
    const { p, e } = build(prog(`here:   MOV  AX, SS\n        ${second}\n        MOV  AL, 'a'\n        OUT  0E9H, AL`));
    stepTo(p, e, 'here');
    e.input({ nmi: true, delay: 2 }); // latched after the second instruction
    let n = 0;
    for (let rec = e.step(); !rec.trap; rec = e.step()) n += 1;
    return n; // instructions before the entry
  };
  assert.equal(entryAfter('MOV  BX, AX'), 2);
  assert.equal(entryAfter('MOV  SS, AX'), 3, 'held back past the instruction after MOV SS');
  assert.equal(entryAfter('POP  DS'), 3, 'POP to a segment register too');
});

test('i8086 interrupts: NMI before INTR; the NMI handler runs with IF = 0, INTR after its IRET plus one instruction', () => {
  const { p, e } = build(prog(`        STI
here:   NOP
        MOV  AL, '.'
        OUT  0E9H, AL
        CLI`));
  stepTo(p, e, 'here');
  e.input({ intr: true, type: 0x20 });
  e.input({ nmi: true });
  const first = e.step();
  assert.equal(first.trap.cause, 2);
  assert.equal(e.step().trap, undefined, 'IF was cleared by the NMI entry: no INTR entry next');
  assert.equal(runAll(e), STOP.HALT);
  // N; its IRET sets IF and holds INTR back one instruction (NOP); I; IRET, MOV AL; I; IRET, OUT '.'; I; IRET, CLI
  assert.equal(out(e), 'NII.I');
});

test('i8086 interrupts: single-step traps after each instruction that starts with TF = 1, not after the POPF that sets it', () => {
  const { p, e } = build(prog(`        PUSHF
        POP  AX
        OR   AX, 0100H
        PUSH AX
here:   POPF
        NOP
        NOP
        PUSHF
        POP  AX
        AND  AX, 0FEFFH
        PUSH AX
        POPF
        MOV  AL, '.'
        OUT  0E9H, AL`));
  stepTo(p, e, 'here');
  assert.equal(runAll(e), STOP.HALT);
  // traps after: NOP, NOP, PUSHF, POP, AND, PUSH, POPF (TF was 1 at its start) = 7; none inside the handler (TF cleared)
  assert.equal(out(e), 'TTTTTTT.');
});

test('i8086 interrupts: a divide error and single-step: both entered, the single-step handler runs first (Fig 2-31)', () => {
  const { p, e } = build(prog(`        PUSHF
        POP  AX
        OR   AX, 0100H
        PUSH AX
        MOV  BL, 0
        MOV  AX, 1
        POPF
here:   DIV  BL
        PUSHF
        POP  AX
        AND  AX, 0FEFFH
        PUSH AX
        POPF`));
  stepTo(p, e, 'here');
  const div = e.step();
  assert.equal(div.trap.cause, 0);
  const trap = e.step();
  assert.equal(trap.trap.cause, 1, 'TF was 1 when DIV started: the single-step entry follows the divide-error entry');
  assert.equal(trap.pc, p.symbols.div_h, 'it comes before the divide handler\'s first instruction');
  assert.equal(runAll(e), STOP.HALT);
  assert.match(out(e), /^TD/);
});

test('i8086 interrupts: REP MOVSB stops between repetitions; REP ES: MOVSB resumes at ES: only (AP-67 p. A-27)', () => {
  const body = (order) => prog(`        MOV  SI, OFFSET src
        MOV  DI, OFFSET dst
        MOV  CX, 10
        CLD
here:   ${order}
        MOV  [left], CX`) + `src:    DB 'ABCDEFGHIJ'\ndst:    DB 10 DUP (0)\nleft:   DW 0\n`;
  // REP immediately before MOVSB: restored; the copy completes after the handler
  const a = build(body('DB 26H, 0F3H, 0A4H   ; ES: REP MOVSB'));
  stepTo(a.p, a.e, 'here');
  a.e.input({ nmi: true, delay: 3 });
  const cut = a.e.step();
  assert.equal(cut.nextPc, a.p.symbols.here + 1, 'IP points at the REP prefix, the one before the op code');
  assert.equal(a.e.state().registers.CX, 7);
  a.e.step(); a.e.back(); // the cut step's record recomputed
  const { output: _o, ...cutRec } = cut;
  assert.deepEqual(a.e.last(), cutRec);
  assert.equal(runAll(a.e), STOP.HALT);
  const peek = (x, l, n) => [...x.e.peek(x.p.symbols[l], n)];
  assert.deepEqual(peek(a, 'left', 2), [0, 0]);
  assert.equal(String.fromCharCode(...peek(a, 'dst', 10)), 'ABCDEFGHIJ');
  // ES: immediately before MOVSB: ES: restored, REP lost: one more transfer (MOVSB alone leaves CX), CX left at 7
  const b = build(body('DB 0F3H, 26H, 0A4H   ; REP ES: MOVSB'));
  stepTo(b.p, b.e, 'here');
  b.e.input({ nmi: true, delay: 3 });
  b.e.step();
  assert.equal(b.e.state().registers.IP, b.p.symbols.here + 1 - 0x10000);
  assert.equal(runAll(b.e), STOP.HALT);
  assert.deepEqual(peek(b, 'left', 2), [7, 0]);
  assert.equal(String.fromCharCode(...peek(b, 'dst', 4)), 'ABCD');
});

test('i8086 interrupts: HLT stops; NMI wakes the processor and the handler returns past the HLT', () => {
  const { e } = build(`${VECTORS}
        MOV  AL, '1'
        OUT  0E9H, AL
        HLT
        MOV  AL, '2'
        OUT  0E9H, AL
        HLT
${HANDLERS}`);
  assert.equal(runAll(e), STOP.HALT);
  assert.equal(out(e), '1');
  assert.equal(e.step(), null, 'halted: no step without an interrupt');
  e.input({ nmi: true });
  assert.equal(runAll(e), STOP.HALT);
  assert.equal(out(e), '1N2');
});

test('i8086 interrupts: step back undoes an entry and withdraws later inputs; last() recomputes entries and cut REPs', () => {
  const { p, e } = build(prog(`        NOP                     ; not straight after POP ES (its shadow would hold the NMI back)
here:   NOP
        MOV  AL, '.'
        OUT  0E9H, AL`));
  stepTo(p, e, 'here');
  e.input({ nmi: true });
  const before = { ...e.state().registers };
  assert.equal(before.NMI, 1);
  const rec = e.step();
  assert.ok(e.back());
  assert.deepEqual(e.state().registers, before, 'back to the latched NMI, due next');
  assert.equal(e.inputs().length, 1, 'the input entered before the step undone stays');
  const again = e.step();
  assert.deepEqual(again, rec);
  e.step(); e.back(); // the entry is the newest step again: last() recomputes its record
  assert.deepEqual(e.last(), rec);
  e.back();
  const redo = e.step();
  assert.equal(redo.trap.cause, 2);
  assert.ok(e.back());
  assert.ok(e.back());
  assert.equal(e.inputs().length, 0, 'stepping back past it withdraws the input');
});

test('i8086 interrupts: create(program, {inputs}) replays a run with its inputs', () => {
  const src = prog(`        STI
here:   NOP
        NOP
        MOV  AL, '.'
        OUT  0E9H, AL
        CLI`);
  const { p, e } = build(src);
  stepTo(p, e, 'here');
  e.input({ nmi: true });
  e.input({ intr: true, type: 0x20, delay: 1 });
  runAll(e);
  const { e: r } = build(src, { inputs: e.inputs() });
  runAll(r);
  assert.equal(out(r), out(e));
  assert.deepEqual(r.state().registers, e.state().registers);
  assert.equal(r.state().steps, e.state().steps);
});

// --- the BIU and EU view's models (B8-Q8): step mode, clock mode (L2), calibrated mode (L3, entries not calibrated)
const SRC_VIEW = prog(`        STI
        NOP
here:   NOP
        MOV  CX, 4
        MOV  SI, OFFSET nmi_h
        MOV  DI, OFFSET nmi_h+40H
        CLD
        DB   0F3H, 0A4H          ; REP MOVSB
        MOV  AL, '.'
        OUT  0E9H, AL
        CLI`);
/** Run a view model to its halt with the inputs given at the instruction label `here`. */
const runModel = (Model, p, inputs) => {
  const x = new Model(p);
  const mm = x.mm ?? x;
  const tick = () => (x.clock ? x.clock() : x.step());
  for (let i = 0; i < 100_000 && !(mm.k === 0 && mm.cur.pc === p.symbols.here && !mm.cur.entry); i++) tick();
  for (const inp of inputs) x.input ? x.input(inp) : mm.input(inp);
  let r;
  for (let i = 0; i < 1_000_000; i++) { r = tick(); if (r !== 'step') break; }
  return { x, mm, r };
};

test('i8086 interrupts: the view\'s step, clock and calibrated models reach the engine\'s state with the same inputs', async () => {
  const { MicroModel } = await import('../src/arch/i8086/micro-model.js');
  const { ClockModel } = await import('../src/arch/i8086/biu-model.js');
  const { CalibratedClockModel } = await import('../src/arch/i8086/timing.js');
  const inputs = [{ intr: true, type: 0x20 }, { nmi: true, delay: 6 }, { intr: false, delay: 1 }];
  const { p, e } = build(SRC_VIEW);
  stepTo(p, e, 'here');
  for (const x of inputs) e.input(x);
  assert.equal(runAll(e), STOP.HALT);
  const want = e.state();
  for (const Model of [MicroModel, ClockModel, CalibratedClockModel]) {
    const { mm, r } = runModel(Model, p, inputs);
    assert.equal(r, 'halt', `${Model.name}: ${mm.error}`);
    assert.equal(mm.output, want.output, Model.name);
    const regs = mm.registers();
    for (const k of ['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'CS', 'DS', 'ES', 'SS', 'IP', 'FLAGS']) assert.equal(regs[k], want.registers[k], `${Model.name} ${k}`);
    assert.equal(mm.retired, want.retired, `${Model.name}: instructions retired`);
    assert.deepEqual([...e.peek(0x10000, 0x200)], Array.from({ length: 0x200 }, (_, i) => mm.byte(0x10000 + i)), `${Model.name}: memory`);
  }
});

test('i8086 interrupts: in clock mode an INTR entry runs two INTA bus cycles (status 000); calibrated mode marks it not calibrated', async () => {
  const { ClockModel } = await import('../src/arch/i8086/biu-model.js');
  const { CalibratedClockModel } = await import('../src/arch/i8086/timing.js');
  const { STATUS_CODE } = await import('../src/arch/i8086/waveform.js');
  assert.equal(STATUS_CODE.inta, 0);
  const { p } = build(SRC_VIEW);
  for (const Model of [ClockModel, CalibratedClockModel]) {
    const x = new Model(p);
    for (let i = 0; i < 100_000 && !(x.mm.k === 0 && x.mm.cur.pc === p.symbols.here); i++) x.clock();
    x.input({ intr: true, type: 0x20 });
    assert.equal(x.mm.cur.entry?.kind, 'intr');
    const recs = [];
    while (x.mm.cur.entry) { x.clock(); recs.push(x.last); }
    const inta = recs.filter((r) => r.cycle?.kind === 'inta' && r.t === 'T1');
    assert.equal(inta.length, 2, `${Model.name}: two INTA cycles`);
    if (Model === CalibratedClockModel) assert.ok(recs.every((r) => !r.calibrated), 'the entry is not calibrated');
    // step back over the whole entry, then the input is still there
    do x.back(); while (!(x.mm.cur.entry && x.mm.k === 0 && (!x.journal.length || x.last.finished)));
    assert.ok(x.mm.cur.entry, 'back at the start of the entry');
    assert.equal(x.mm.registers().INTR, 1);
    x.back(); // one more: back past the clock at which the input was given
    assert.equal(x.mm.registers().INTR, 0, 'withdrawn');
  }
});

test('i8086 interrupts: an input type without a handler stops with a message and changes nothing', () => {
  const { e } = build('        NOP\n        HLT\n');
  const cpu = () => Object.fromEntries(['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'CS', 'DS', 'ES', 'SS', 'IP', 'FLAGS'].map((k) => [k, e.state().registers[k]]));
  const before = cpu();
  e.input({ intr: true, type: 0x40 });
  e.input({ nmi: true });
  assert.equal(e.state().registers.INEXT, 1, 'the panel sees the NMI due next');
  assert.equal(e.step(), null);
  assert.match(e.state().error, /NMI before the instruction at 1000H:0000H.*type 02H/);
  assert.deepEqual(cpu(), before);
});
