// multi.test.mjs -- the Chapter 7 multicycle model (spec §8.2): golden dumps
// of the chapter's programs (WS-V-020), cycles per instruction class equal to
// code/chapter07/ref/mc_cpi.json on every program (WS-V-023), lock-step with
// the ISA engine in the ch07 profile at every instruction boundary,
// back-stepping, the JALR option, and the controller against the chapter's
// tables. The program tests need the book repository beside this one and are
// skipped, saying so, without it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble, hexImage } from '../src/asm/assembler.js';
import { Hart, run } from '../src/core/iss.js';
import { Multicycle, buildController } from '../src/uarch/multi.js';
import { ch07 } from './ch07-content.mjs';
import { MULTI_SIGNALS, MULTI_INFO, MC_STATES } from '../src/uarch/signals.js';
import { programsCh07 } from './programs-ch07.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const CH07 = join(BOOK, 'code', 'chapter07');
const skip = existsSync(join(CH07, 'programs')) ? false : 'book repository not found beside this one';
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const T6 = read('content/data/ch06-tables.json');
const T7 = ch07().t7;

const PROGS = programsCh07(BOOK);
const words = (text) => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseInt(l, 16) >>> 0);

function build(p) {
  const prog = assemble([{ name: p.src, text: readFileSync(p.src, 'utf8') }], { profile: 'ch07' });
  assert.deepEqual(prog.errors, []);
  assert.deepEqual(prog.profileErrors, []);
  return prog;
}

for (const p of PROGS) {
  test(`WS-V-020: chapter07/${p.name} gives golden.hex`, { skip }, () => {
    const prog = build(p);
    if (existsSync(join(p.dir, 'prog.hex'))) assert.equal(hexImage(prog, 256), readFileSync(join(p.dir, 'prog.hex'), 'utf8'), 'prog.hex');
    const m = new Multicycle(T6, T7, { jalr: true });
    m.load(prog);
    assert.equal(m.run(), 'halt');
    assert.deepEqual(m.golden(), words(readFileSync(join(p.dir, 'golden.hex'), 'utf8')));
  });

  test(`WS-V-023: chapter07/${p.name}, cycles of every instruction equal mc_cpi.json for its class`, { skip }, () => {
    const cpi = JSON.parse(readFileSync(join(CH07, 'ref', 'mc_cpi.json'), 'utf8'));
    const prog = build(p);
    const m = new Multicycle(T6, T7, { jalr: true });
    m.load(prog);
    const hart = new Hart(prog, { profile: 'ch07' });
    const seen = {};
    run(hart, 100_000, (r) => {
      assert.equal(m.state, 'FETCH');
      assert.equal(m.pc, r.pc);
      const c0 = m.cycle;
      assert.equal(m.stepInstruction(), 'step');
      const n = m.cycle - c0;
      assert.equal(n, cpi[r.cls], `${r.cls} at ${r.pc.toString(16)}: ${n} cycles`);
      seen[r.cls] = (seen[r.cls] ?? 0) + 1;
      // lock-step with the ISA engine at the instruction boundary
      if (r.reg) assert.equal(m.x[r.reg.rd], r.reg.value >>> 0, `x${r.reg.rd} at ${r.pc.toString(16)}`);
      if (r.mem) assert.equal(m.mem.read(r.mem.addr, 4), r.mem.value >>> 0);
      assert.equal(m.pc, r.nextPc);
    });
    assert.equal(m.step(), 'halt');
    assert.deepEqual(Array.from(m.x), Array.from(hart.x));
    assert.equal(m.cycle, Object.entries(seen).reduce((a, [k, v]) => a + v * cpi[k], 0));
  });

  test(`chapter07/${p.name}: back-stepping returns every cycle's state, to the start`, { skip }, () => {
    const m = new Multicycle(T6, T7, { jalr: true });
    m.load(build(p));
    const snap = () => JSON.stringify([m.golden(), m.state, m.pc, m.ir, m.instr_pc, m.rs1_q, m.rs2_q, m.alu_q, m.mdr, m.retired]);
    const states = [];
    for (;;) {
      states.push(snap());
      if (m.step() !== 'step') break;
    }
    assert.ok(m.back()); // leaves the halt
    assert.equal(snap(), states[states.length - 1]);
    for (let i = states.length - 2; i >= 0; i--) {
      assert.ok(m.back());
      assert.equal(snap(), states[i]);
    }
    assert.equal(m.back(), false);
  });
}

test('without the JALR option, jalr stops in DECODE naming the option', () => {
  const prog = assemble([{ name: 't.s', text: 'jalr x1, 0(x0)\n' }], { profile: 'ch07' });
  const m = new Multicycle(T6, T7);
  m.load(prog);
  assert.equal(m.step(), 'step'); // FETCH
  assert.equal(m.state, 'DECODE');
  assert.equal(m.step(), 'error');
  assert.match(m.error, /the JALR state is an optional extension of the controller, off by default; turn it on/);
  assert.ok(!buildController(T7).states.includes('JALR'));
  assert.ok(buildController(T7, { jalr: true }).states.includes('JALR'));
});

test('an unimplemented instruction stops in DECODE; a misaligned lw stops in ADDR', () => {
  const mk = (ws) => ({ segments: [{ address: 0, executable: true, bytes: new Uint8Array(new Uint32Array(ws).buffer) }] });
  const m = new Multicycle(T6, T7);
  m.load(mk([0x00000073])); // ecall
  m.step();
  assert.equal(m.step(), 'error');
  assert.match(m.error, /not implemented by the multicycle processor/);
  m.load(mk([0x00202283])); // lw x5, 2(x0)
  m.step(); m.step();
  assert.equal(m.state, 'ADDR');
  assert.equal(m.step(), 'error');
  assert.match(m.error, /misaligned/);
});

test('controller: state outputs of the chapter table, don\'t-cares 0, next states of FIG-0072', () => {
  const c = buildController(T7, { jalr: true });
  assert.deepEqual(c.states, [...MC_STATES.slice(0, 11), 'LUI', 'AUIPC', 'JALR']);
  for (const col of T7.state_outputs.columns) {
    for (const [k, v] of Object.entries(col.values)) {
      assert.equal(v.length, MULTI_INFO[k].width, `${k} in ${col.state}`);
      assert.equal(c.outputs(col.state).values[k], parseInt(v.replace(/x/g, '0'), 2));
    }
  }
  const next = (s, cls) => c.next(s, cls);
  assert.equal(next('FETCH', 'lw'), 'DECODE');
  assert.equal(next('DECODE', 'R'), 'EXEC_R');
  assert.equal(next('DECODE', 'I-ALU'), 'EXEC_I');
  assert.equal(next('DECODE', 'sw'), 'ADDR');
  assert.equal(next('DECODE', null), 'FETCH');
  assert.equal(next('ADDR', 'lw'), 'MEMRD');
  assert.equal(next('ADDR', 'sw'), 'MEMWR');
  assert.equal(next('JAL', 'jal'), 'ALUWB');
  assert.equal(next('JAL', 'jalr'), 'FETCH');
  assert.equal(next('JALR', 'jalr'), 'JAL');
  for (const s of ['LOADWB', 'MEMWR', 'ALUWB', 'BRANCH']) assert.equal(next(s, 'R'), 'FETCH');
  // every table column's step list follows the next-state rule
  const cls = { 'R-type': 'R', 'I-type ALU': 'I-ALU', lw: 'lw', sw: 'sw', branch: 'branch', jal: 'jal', jalr: 'jalr', lui: 'lui', auipc: 'auipc' };
  for (const row of T7.cycles) {
    const steps = row.steps;
    for (let i = 0; i < steps.length; i++) assert.equal(next(steps[i], cls[row.class]), steps[i + 1] ?? 'FETCH', `${row.class} after ${steps[i]}`);
    assert.equal(steps.length, row.cycles);
  }
  assert.equal(new Set(MULTI_SIGNALS.map((s) => s.name)).size, MULTI_SIGNALS.length);
});
