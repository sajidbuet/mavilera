// The RISC-V adapter of the architecture contract (W-D29, phase 2) changes nothing: on every assembly example of
// the iss profile, each step record of the adapter's engine equals the record of a Hart run beside it (pc, word,
// next pc, register and memory writes, output, halt), and the final state equals the Hart's.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { descriptor as riscv } from '../src/arch/riscv/index.js';
import { assemble } from '../src/asm/assembler.js';
import { Hart } from '../src/core/iss.js';
import { INSTRUCTIONS, FORMAT_FIELDS, ABI_NAMES, bits } from '../src/isa/encoding.js';
import { disassemble, disassembleAlias } from '../src/asm/disassembler.js';
import { immediateSteps } from '../src/arch/riscv/immediate.js';
import { defaultPlatform } from '../src/shell/share.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'content/examples');
const EXAMPLES = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')).examples
  .filter((e) => e.profile === 'iss' && e.lang === 'asm' && e.halts !== false);
const LIMIT = 200_000;

test('the adapter assembles exactly as the assembler (words, segments, entry, symbols)', () => {
  for (const e of EXAMPLES) {
    const files = [{ name: e.file, text: readFileSync(join(DIR, e.file), 'utf8') }];
    const a = riscv.language.assemble(files, { profile: 'iss' });
    const b = assemble(files, { profile: 'iss' });
    assert.deepEqual(a.listing.map((r) => [r.address, r.word]), b.listing.map((r) => [r.address, r.word]), e.id);
    assert.deepEqual(a.segments, b.segments, e.id);
    assert.equal(a.entry, b.entry, e.id);
    assert.deepEqual(a.symbols, Object.fromEntries(b.symbols), e.id);
    assert.equal(a.ok, b.ok && b.profileErrors.length === 0, e.id);
  }
});

test('listing data from the adapter (contract v2) equal what the listing computed from the assembler row', () => {
  const SHORT = { funct7: 'funct7', rs2: 'rs2', rs1: 'rs1', funct3: 'f3', rd: 'rd', opcode: 'opcode' };
  for (const e of EXAMPLES) {
    const files = [{ name: e.file, text: readFileSync(join(DIR, e.file), 'utf8') }];
    for (const l of assemble(files, { profile: 'iss' }).listing) {
      const fmt = INSTRUCTIONS[l.mnemonic]?.fmt;
      const f = riscv.language.fields(l.word, l.address);
      const d = riscv.language.describe(l.word, l.address);
      if (!fmt) { assert.deepEqual(f, [], l.text); assert.equal(d, null); continue; }
      assert.deepEqual(f.map((x) => [x.name, x.bits, x.value, x.short]), FORMAT_FIELDS[fmt].map(([name, hi, lo]) =>
        [name, hi === lo ? `${hi}` : `${hi}:${lo}`, bits(l.word, hi, lo), SHORT[name] ?? 'imm']), l.text);
      for (const x of f.filter((y) => ['rd', 'rs1', 'rs2'].includes(y.name))) {
        assert.equal(x.meaning, INSTRUCTIONS[l.mnemonic].syntax === 'rd,rs1,shamt' && x.name === 'rs2' ? `shamt = ${x.value}` : `x${x.value} (${ABI_NAMES[x.value]})`);
      }
      assert.deepEqual(d, { kind: `${fmt}-type`, immediate: immediateSteps(l.word, fmt)?.[1] ?? null }, l.text);
      assert.equal(riscv.language.disassemble(l.word, l.address, { names: 'x' }), disassemble(l.word, l.address, 'x'));
      assert.equal(riscv.language.disassemble(l.word, l.address, { aliases: true }), disassembleAlias(l.word, l.address, 'abi'));
    }
  }
});

for (const e of EXAMPLES) {
  test(`${e.id}: every step record of the adapter equals the Hart's`, () => {
    const files = [{ name: e.file, text: readFileSync(join(DIR, e.file), 'utf8') }];
    const p = riscv.language.assemble(files, { profile: 'iss' });
    const eng = riscv.engine.create(p);
    const h = new Hart(assemble(files, { profile: 'iss' }), { profile: 'iss', abiCheck: true, uninitCheck: true, platformConfig: defaultPlatform() });
    let n = 0;
    for (; n < LIMIT; n++) {
      let want;
      try { want = h.step(); } catch (err) { want = null; }
      const got = eng.step();
      if (!want) { assert.equal(got, null, `step ${n}`); break; }
      const map = {
        pc: want.pc, word: want.word, nextPc: want.nextPc,
        registers: want.reg ? [{ id: `x${want.reg.rd}`, old: want.reg.old, value: want.reg.value }] : [],
        memory: want.mem ? [{ address: want.mem.addr, size: want.mem.size, old: want.mem.old, value: want.mem.value }] : [],
        halt: Boolean(want.halt), output: want.output ? String.fromCharCode(...want.output) : null,
      };
      assert.deepEqual({ pc: got.pc, word: got.word, nextPc: got.nextPc, registers: got.registers, memory: got.memory,
        halt: Boolean(got.halt), output: got.output ?? null }, map, `step ${n}`);
      if (want.halt) { n++; break; }
    }
    const s = eng.state();
    assert.equal(s.retired, h.instret);
    assert.deepEqual(Object.values(s.registers), [...h.x]);
    assert.equal(s.pc, h.pc);
    assert.equal(s.output, String.fromCharCode(...h.output));
  });
}
