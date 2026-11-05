// The model behind the 8086 BIU/EU view (src/arch/i8086/micro-model.js; milestone 8086-B4): the state rebuilt from the
// step records equals what microops.js computed, after every instruction of the six templates and of 5 000 generated
// instructions; the committed state follows the instruction-level engine (FLAGS under the undefined-flag mask); step
// back, one step and one instruction, returns to exactly the earlier state; the console output and the HLT stop.
// Agreement of the simulator's own models is not evidence about the 8086 (CLAUDE.md rule 7).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CPU_REGS } from '../src/arch/i8086/cpu.js';
import { runMicro, undefinedFlags } from '../src/arch/i8086/microops.js';
import { create } from '../src/arch/i8086/engine.js';
import { descriptor } from '../src/arch/i8086/index.js';
import { MicroModel, replay, TEMP_IDS } from '../src/arch/i8086/micro-model.js';

const dir = new URL('../content/i8086/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const programs = index.templates.flatMap((t) => (t.id === 'segments' ? ['flat', 'segmented'] : ['flat']).map((profile) => {
  const p = descriptor.language.assemble([{ name: t.file, text: readFileSync(new URL(t.file, dir), 'utf8') }], { profile });
  assert.ok(p.ok, t.id);
  return [`${t.id}/${profile}`, p];
}));
programs.push(['default', descriptor.language.assemble([{ name: 'main.asm', text: descriptor.language.defaultSource }], { profile: 'flat' })]);
const WITHOUT_SIGMA = TEMP_IDS.filter((k) => k !== 'Σ');

test('i8086 B4: the state rebuilt from the steps equals runMicro\'s after each instruction; commits follow the L1 engine', () => {
  for (const [name, p] of programs) {
    const m = new MicroModel(p);
    const e = create(p);
    let n = 0;
    for (; n < 100000 && !m.halted; n++) {
      const { res, after, final } = m.cur;
      assert.ok(!res.error, `${name}: instruction ${n} ${res.error}`);
      const last = after.at(-1);
      for (const r of CPU_REGS) assert.equal(last[r], final.c[r], `${name}: replay ${r} at ${n}`);
      for (const t of WITHOUT_SIGMA) assert.equal(last[t], final.temps[t], `${name}: replay ${t} at ${n}`);
      const written = new Map(after.flatMap((a) => a.mem));
      assert.deepEqual([...written].sort(), [...final.overlay].sort(), `${name}: memory written at ${n}`);
      assert.equal(m.steps.at(-1).kind, 'end');
      const r = m.stepInstruction();
      e.step();
      const ref = e.state().registers;
      const mask = ~undefinedFlags(res.d) & 0xffff;
      for (const k of CPU_REGS) assert.equal((m.c[k] ^ ref[k]) & (k === 'FLAGS' ? mask : 0xffff), 0, `${name}: ${k} after ${n}`);
      if (r === 'halt') break;
    }
    assert.ok(m.halted && !m.error, `${name}: runs to HLT`);
    assert.deepEqual(m.mem, Uint8Array.from(e.peek(0, 0x100000)), `${name}: memory at the end`);
    assert.equal(m.output, e.state().output, `${name}: console`);
  }
});

test('i8086 B4: one step at a time, k counts the steps; step back returns to every earlier state exactly', () => {
  const [, p] = programs.find(([n]) => n === 'default');
  const m = new MicroModel(p);
  const seen = [];
  const snap = () => JSON.stringify({ k: m.k, regs: m.regs, retired: m.retired, out: m.output, pc: m.cur.pc, count: m.count });
  for (let i = 0; i < 400 && !m.halted; i++) { seen.push(snap()); m.step(); }
  assert.ok(m.retired > 20);
  for (let i = seen.length - 1; i >= 0; i--) { assert.ok(m.back()); assert.equal(snap(), seen[i], `back to ${i}`); }
  assert.equal(m.back(), false);
  // one instruction at a time
  const starts = [];
  for (let i = 0; i < 30; i++) { starts.push(snap()); m.stepInstruction(); }
  for (let i = starts.length - 1; i >= 0; i--) { assert.ok(m.backInstruction()); assert.equal(snap(), starts[i]); }
  // from the middle of an instruction, backInstruction goes to its start
  m.step(); m.step();
  assert.ok(m.k === 2 && m.backInstruction() && m.k === 0 && m.retired === 0);
});

test('i8086 B4: the shown memory has the writes of the steps performed; a write is committed with the instruction', () => {
  // PUSH AX: SP − 2, AX → OPR, write SS:SP
  const p = descriptor.language.assemble([{ name: 'p.asm', text: 'MOV AX, 1234H\nPUSH AX\nHLT\n' }], { profile: 'flat' });
  const m = new MicroModel(p);
  m.stepInstruction();
  const sp = (m.c.SS << 4) + ((m.c.SP - 2) & 0xffff);
  const kinds = m.steps.map((s) => s.kind);
  const w = kinds.indexOf('bus');
  while (m.k <= w) { assert.equal(m.byte(sp), 0); m.step(); }
  assert.equal(m.byte(sp), 0x34);
  assert.equal(m.byte(sp + 1), 0x12);
  assert.equal(m.mem[sp], 0, 'not committed before end');
  m.stepInstruction();
  assert.equal(m.mem[sp], 0x34);
  assert.equal(m.stepInstruction(), 'halt');
  assert.equal(m.step(), 'halt');
});

test('i8086 B4: replay of generated instructions equals runMicro (5 000 cases: registers, temporaries, bytes written)', () => {
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed >>> 16; };
  let n = 0;
  for (let i = 0; i < 5000; i++) {
    const regs = { AX: rnd(), BX: rnd(), CX: rnd() & 0x1f, DX: rnd(), SP: rnd() & 0xfffe, BP: rnd(), SI: rnd(), DI: rnd(), CS: 0x1000, DS: 0x2000, ES: 0x3000, SS: 0x4000, IP: 0x100, FLAGS: 0xf002 | (rnd() & 0x0cd5) };
    const mem = new Map();
    const code = Array.from({ length: 8 }, () => rnd() & 0xff);
    code.forEach((b, k) => mem.set(0x10100 + k, b));
    const fill = (a) => (Math.imul(a, 2654435761) >>> 24) & 0xff;
    const read = (a) => (mem.has(a) ? mem.get(a) : fill(a));
    const temps = Object.fromEntries(TEMP_IDS.map((k) => [k, rnd()]));
    const start = { ...regs, ...temps };
    const c = { ...regs }; const t = { ...temps };
    const written = new Map();
    const r = runMicro(c, { read, peek: read, write: (a, v) => { written.set(a, v); mem.set(a, v); } }, { temps: t });
    if (r.error) continue;
    n += 1;
    const last = replay(start, r.steps).at(-1);
    for (const k of CPU_REGS) assert.equal(last[k], c[k], `case ${i} ${k}`);
    for (const k of WITHOUT_SIGMA) assert.equal(last[k], t[k], `case ${i} ${k}`);
    assert.deepEqual(new Map(replay(start, r.steps).flatMap((a) => a.mem)), written, `case ${i} bytes`);
  }
  assert.ok(n > 3000, `${n} cases ran`);
});
