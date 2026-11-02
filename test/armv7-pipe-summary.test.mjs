// armv7-pipe-summary.test.mjs -- the run summary of the ARM pipelined processor (uarch/pipe-summary.js; roadmap ARM-A4):
// lost cycles by cause against the Hazard Unit's costs (Example 7.7, p. 441: a dependent load 1 cycle, a taken branch 2)
// and a write to R15 (3 cycles of waiting and the flushed fetch), the CPI by component, the pipeline diagram's marks,
// folded loop iterations, and the events a run stops on.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/arch/armv7/language.js';
import { ArmPipe } from '../src/arch/armv7/uarch/pipe.js';
import { hazardSummary, cpiParts, diagramRows, foldRows, foldColumns, pipeEvents } from '../src/arch/armv7/uarch/pipe-summary.js';

const run = (text, hazard = 'full') => {
  const p = assemble([{ name: 't.s', text }], { profile: 'arm-pipe' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const m = new ArmPipe({ hazard });
  m.load(p);
  assert.equal(m.run(), 'halt');
  return m;
};

test('lost cycles by cause: a dependent load 1, an unneeded stall 1, a taken branch 2, a write to R15 4; B . not counted', () => {
  const m = run('LDR R1, [R0, #0x800]\nADD R2, R1, R1\nSTR R2, [R0, #0x804]\nADD R3, R2, R2\nB x\nADD R4, R4, #1\n'
    + 'x: ADD R15, R15, #0\nADD R5, R5, #1\nADD R6, R6, #1\nB .\n');
  const { rows, totals } = hazardSummary(m);
  assert.deepEqual(totals, { loadUse: { events: 1, lost: 1 }, unneeded: { events: 1, lost: 1 }, branch: { events: 1, lost: 2 },
    pcWrite: { events: 1, lost: 4 } });
  const pc = rows.find((r) => r.cause === 'pcWrite');
  assert.equal(pc.a.pc, 24);
  assert.equal(pc.cycles.length, 4);
  assert.deepEqual(rows.find((r) => r.cause === 'loadUse').b.pc, 4);
  assert.deepEqual(rows.find((r) => r.cause === 'unneeded').a.pc, 8, 'STR in EX (MemtoReg 1, A4-Q3)');
  // every lost cycle is accounted for: cycles = instructions (B . included) + 3 (fill) + lost
  const lost = Object.values(totals).reduce((t, x) => t + x.lost, 0);
  assert.equal(m.cycle, m.stats.retired + 1 + 3 + lost);
  // a write to R15 whose condition fails waits only in ID and EX
  const f = run('ADDS R9, R9, #1\nADDEQ R15, R15, #4\nADD R5, R5, #1\nB .\n');
  assert.deepEqual(hazardSummary(f).totals.pcWrite, { events: 1, lost: 2 });
});

test('CPI by component (Example 7.7): 1.23 from the measured counts of a program with its mix', () => {
  // the program of test/armv7-pipe.test.mjs: 200 instructions, 20 dependent loads, 13 taken branches
  const lines = ['SUBS R0, R0, R0'];
  let label = 0;
  let taken = 0;
  let b = 0;
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 5; j++) lines.push(`LDR R${1 + j}, [R0, #${0x800 + 4 * j}]`, j < 2 ? `ADD R8, R${1 + j}, R9` : 'ADD R8, R9, R10');
    lines.push('STR R10, [R0, #0x900]', 'STR R12, [R0, #0x904]');
    for (let j = 0; j < (i < 6 ? 3 : 2); j++) {
      const t = taken < 13 && b % 2 === 0;
      lines.push(`${t ? 'BEQ' : 'BNE'} M${label}`, `M${label++}:`);
      b += 1;
      if (t) taken += 1;
    }
    while (lines.filter((l) => !l.endsWith(':')).length < 20 * (i + 1)) lines.push('ADD R11, R12, R10');
  }
  lines.push('B .');
  const m = run(lines.join('\n'));
  const cp = cpiParts(m);
  assert.equal(cp.n, 200);
  assert.deepEqual(cp.parts.map((x) => [x.key, x.value]), [['base', 1], ['loadUse', 0.1], ['unneeded', 0], ['branch', 0.13], ['pcWrite', 0]]);
  assert.equal(cp.model.toFixed(2), '1.23');
  assert.equal(cp.measured, m.cycle / 200);
  assert.deepEqual(cp.f, { loads: 50, loadUse: 20, branches: 27, taken: 14 }, 'B . is a taken branch too');
});

test('the pipeline diagram marks held (‖), flushed (✕) and the load-use bubble (○)', () => {
  const m = run('LDR R1, [R0, #0x800]\nADD R2, R1, R1\nB x\nADD R4, R4, #1\nADD R5, R5, #1\nx: B .\n');
  const rows = diagramRows(m, 0, m.cycle);
  const at = (pc) => rows.find((r) => r.pc === pc && !r.flushed && !r.bubble) ?? rows.find((r) => r.pc === pc);
  assert.deepEqual(at(0).cells.map(([, c]) => c), ['IF', 'ID', 'EX', 'MEM', 'WB']);
  assert.deepEqual(at(4).cells.map(([, c]) => c), ['IF', 'ID‖', 'ID', 'EX', 'MEM', 'WB'], 'ADD waits one cycle in ID');
  assert.deepEqual(at(8).cells.map(([, c]) => c), ['IF‖', 'IF', 'ID', 'EX', 'MEM', 'WB'], 'B waits in IF behind it');
  const bubble = rows.find((r) => r.loadUse);
  assert.deepEqual(bubble.cells.map(([, c]) => c), ['EX○', 'MEM○', 'WB○']);
  const flushed = rows.filter((r) => r.flushed).map((r) => [r.pc, r.cells.at(-1)[1]]);
  assert.deepEqual(flushed.slice(0, 2), [[12, 'ID✕'], [16, 'IF✕']], 'the two after the taken branch');
});

test('folded loops: the middle iterations of a loop become one fold; columns keep the shown cycles', () => {
  const text = readFileSync(new URL('../content/armv7/templates/base-sum.s', import.meta.url), 'utf8');
  const m = run(text);
  const rows = diagramRows(m, 0, m.cycle);
  const items = foldRows(rows);
  const folds = items.filter((x) => x.kind === 'fold');
  assert.ok(folds.length >= 1 && folds[0].count >= 2, JSON.stringify(folds));
  assert.ok(items.length < rows.length);
  const cols = foldColumns(items, 0, m.cycle);
  assert.ok(cols.some((c) => typeof c === 'object' && c.gap));
});

test('the events a run stops on: stall, flush, taken branch', () => {
  const p = assemble([{ name: 't.s', text: 'LDR R1, [R0, #0x800]\nADD R2, R1, R1\nB x\nADD R4, R4, #1\nx: B .\n' }], { profile: 'arm-pipe' });
  const m = new ArmPipe();
  m.load(p);
  const seen = [];
  for (let i = 0; i < 12; i++) {
    const e = pipeEvents(m.evaluate());
    seen.push(Object.keys(e).filter((k) => e[k]).join('+') || '-');
    if (m.step() !== 'step') break;
  }
  // LDR in EX at cycle 2 stalls ADD; B, held one cycle in IF, reaches EX at cycle 5
  assert.deepEqual(seen.slice(0, 7), ['-', '-', 'stall', '-', '-', 'flush+taken', '-']);
});
