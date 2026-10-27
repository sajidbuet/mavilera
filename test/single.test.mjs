// single.test.mjs -- the Chapter 6 single-cycle model (spec §8.1): golden
// dumps of the chapter's programs (WS-V-020), lock-step with the ISA engine
// in the ch06 profile (spec §5.3), back-stepping, and the signal dictionary
// against the chapter's tables. The golden-dump tests need the book
// repository beside this one and are skipped, saying so, without it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble, hexImage } from '../src/asm/assembler.js';
import { Hart, run } from '../src/core/iss.js';
import { SingleCycle } from '../src/uarch/single.js';
import { SINGLE_SIGNALS, SIGNAL_INFO } from '../src/uarch/signals.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const PROGS = join(BOOK, 'code', 'chapter06', 'programs');
const skip = existsSync(PROGS) ? false : 'book repository not found beside this one';
const TABLES = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const NAMES = skip ? [] : readdirSync(PROGS).filter((p) => existsSync(join(PROGS, p, 'prog.s')));

const words = (text) => text.split(/\r?\n/).filter((l) => l.trim()).map((l) => parseInt(l, 16) >>> 0);

function build(name) {
  const subset = name === 'ext' ? 'ext' : undefined;
  const file = join(PROGS, name, 'prog.s');
  const prog = assemble([{ name: file, text: readFileSync(file, 'utf8') }], { profile: 'ch06', subset });
  assert.deepEqual(prog.errors, []);
  assert.deepEqual(prog.profileErrors, []);
  return prog;
}

for (const name of NAMES) {
  test(`WS-V-020: chapter06/${name} gives golden.hex`, { skip }, () => {
    const prog = build(name);
    assert.equal(hexImage(prog, 256), readFileSync(join(PROGS, name, 'prog.hex'), 'utf8'), 'prog.hex');
    const m = new SingleCycle(TABLES, { ext: name === 'ext' });
    m.load(prog);
    assert.equal(m.run(), 'halt');
    assert.deepEqual(m.golden(), words(readFileSync(join(PROGS, name, 'golden.hex'), 'utf8')));
  });

  test(`chapter06/${name}: lock-step with the ISA engine (ch06 profile), and back to the start`, { skip }, () => {
    const prog = build(name);
    const m = new SingleCycle(TABLES, { ext: name === 'ext' });
    m.load(prog);
    const hart = new Hart(prog, { profile: 'ch06' });
    const states = [];
    run(hart, 100_000, (r) => {
      const c = m.evaluate();
      assert.equal(c.signals.pc, r.pc);
      assert.equal(c.signals.instr, r.word);
      states.push(m.golden());
      assert.equal(m.step(), 'step');
      if (r.reg) assert.equal(m.x[r.reg.rd], r.reg.value >>> 0, `x${r.reg.rd} at ${r.pc.toString(16)}`);
      if (r.mem) assert.equal(m.dmem.read(r.mem.addr, 4), r.mem.value >>> 0);
      assert.equal(m.pc, r.nextPc);
    });
    assert.equal(m.step(), 'halt');
    assert.deepEqual(Array.from(m.x), Array.from(hart.x));
    for (let i = states.length - 1; i >= 0; i--) {
      assert.ok(m.back());
      if (i === states.length - 1) assert.ok(m.back()); // first undo leaves the halt
      assert.deepEqual(m.golden(), states[i]);
    }
    assert.equal(m.back(), false);
  });
}

test('every decoder value of the chapter tables decodes, and control widths agree', () => {
  for (const s of TABLES.main_decoder.signals) {
    assert.ok(SIGNAL_INFO[s], `${s} in the dictionary`);
    for (const c of TABLES.main_decoder.columns) assert.equal(c.values[s].length, SIGNAL_INFO[s].width, `${s} in ${c.class}`);
  }
  const aluCtrl = SIGNAL_INFO.ALUCtrl.values;
  assert.deepEqual(Object.fromEntries(TABLES.alu_ops.map((r) => [r.ALUCtrl, r.op])), aluCtrl);
  assert.deepEqual(TABLES.imm_sel.map((r) => r.ImmSel), Object.keys(SIGNAL_INFO.ImmSel.values).sort());
  assert.equal(new Set(SINGLE_SIGNALS.map((s) => s.name)).size, SINGLE_SIGNALS.length);
});

test('unknown opcode decodes to all zeros and stops the model; misaligned lw stops it', () => {
  const m = new SingleCycle(TABLES);
  const mk = (ws) => ({ segments: [{ address: 0, executable: true, bytes: new Uint8Array(new Uint32Array(ws).buffer) }] });
  m.load(mk([0x0000000b]));
  const c = m.evaluate();
  assert.equal(c.cls, null);
  for (const k of ['RegWrite', 'ImmSel', 'ALUSrc', 'MemWrite', 'ResultSel', 'Branch', 'Jump', 'ALUOp', 'TargetSrc', 'PCSel']) {
    assert.equal(c.signals[k], 0, k);
  }
  assert.equal(m.step(), 'error');
  assert.match(m.error, /not implemented by the single-cycle processor/);
  m.load(mk([0x00202283])); // lw x5, 2(x0)
  assert.equal(m.step(), 'error');
  assert.match(m.error, /misaligned/);
});
