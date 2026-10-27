// pipe-summary.test.mjs -- the analysis of a pipelined run (src/uarch/
// pipe-summary.js): the stop events of WS-F-091 agree with the model's
// counters; the hazard summary of WS-F-140 names the right instructions and
// its lost cycles add up to the cycle identity; prediction statistics and the
// CPI components of WS-F-142; the folded diagram of WS-F-141 keeps the first,
// last and differing iterations and hides the cycles of the folded ones.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { pipeEvents, hazardSummary, predictionStats, cpiParts, diagramRows, iterations, foldRows, foldColumns } from '../src/uarch/pipe-summary.js';
import { program } from './programs-ch08.mjs';

const TABLES = JSON.parse(readFileSync(fileURLToPath(new URL('../content/data/ch06-tables.json', import.meta.url)), 'utf8'));

const LOOP = (n) => `
        addi x1, x0, 64       # data base
        addi x2, x0, ${n}     # iterations
        addi x3, x0, 0
loop:   lw   x4, 0(x1)
        add  x3, x3, x4       # load-use
        addi x2, x2, -1
        bne  x2, x0, loop
        j    end
        addi x5, x0, 1        # jumped over
end:    jal  x0, 0
`;

function model(src, opts = {}) {
  const p = assemble([{ name: 't.s', text: src }], { profile: 'ch08' });
  assert.deepEqual(p.errors, []);
  const m = new Pipeline(TABLES, opts);
  m.load(p);
  return m;
}

test('WS-F-091: the stop events of each cycle agree with the counters', () => {
  for (const opts of [{}, { predictor: '2bit' }, { early: true }]) {
    const m = model(program(7, 30), opts);
    const seen = { stall: 0, flush: 0, mispredict: 0 };
    for (;;) {
      const e = pipeEvents(m.evaluate());
      if (e.stall) seen.stall += 1;
      if (e.mispredict) seen.mispredict += 1;
      if (e.flush) seen.flush += 1;
      if (m.step() !== 'step') break;
    }
    const st = m.stats;
    assert.equal(seen.stall, st.loadUse + st.branchStall, JSON.stringify(opts));
    assert.equal(seen.mispredict, st.mispredicts, JSON.stringify(opts));
    assert.ok(seen.flush >= st.redirects, JSON.stringify(opts)); // the halt's own redirect flushes too
  }
});

test('WS-F-140: hazard summary of a loop names the load and its user, the branch and the jump', () => {
  const m = model(LOOP(5));
  assert.equal(m.run(), 'halt');
  const { rows, totals } = hazardSummary(m);
  const lu = rows.find((r) => r.cause === 'loadUse');
  assert.equal(lu.a.pc, 0x0c); // lw
  assert.equal(lu.b.pc, 0x10); // add
  assert.equal(lu.count, 5);
  const br = rows.find((r) => r.cause === 'mispredict');
  assert.equal(br.a.pc, 0x18);
  assert.equal(br.taken, true);
  assert.equal(br.count, 4); // taken four times, predicted not taken
  assert.equal(br.lost, 8);
  const j = rows.find((r) => r.cause === 'jump');
  assert.equal(j.a.pc, 0x1c);
  assert.equal(j.count, 1);
  assert.deepEqual(totals.loadUse, { events: 5, lost: 5 });
  // each event links to its cycle: a load-use stall cycle holds the load in EX
  for (const k of lu.cycles) assert.equal(m.instance(m.trace[k].EX).pc, 0x0c);
  for (const k of br.cycles) assert.equal(m.instance(m.trace[k].EX).pc, 0x18);
});

test('WS-F-140: the lost cycles of the summary add up to the cycle identity', () => {
  for (const opts of [{}, { predictor: '1bit', entries: 4 }, { predictor: '2bit' }, { early: true }, { early: true, predictor: '2bit' }]) {
    for (const seed of [1, 2, 3]) {
      const m = model(program(seed, 30), opts);
      assert.equal(m.run(), 'halt');
      const { totals } = hazardSummary(m);
      const lost = Object.values(totals).reduce((t, x) => t + x.lost, 0);
      const st = m.stats;
      assert.equal(lost, st.loadUse + st.branchStall + m.penalty * st.redirects, `${seed} ${JSON.stringify(opts)}`);
      assert.equal(m.cycle, st.retired + 4 + lost, `identity ${seed} ${JSON.stringify(opts)}`);
      assert.equal(totals.mispredict.events, st.mispredicts);
      assert.equal(totals.jump.events, st.jumps);
    }
  }
});

test('WS-F-140: without the flush a redirect loses no cycle and is marked', () => {
  const m = model(LOOP(3), { hazard: 'stall' });
  m.run();
  const br = hazardSummary(m).rows.find((r) => r.cause === 'mispredict');
  assert.equal(br.flushed, false);
  assert.equal(br.lost, 0);
});

test('WS-F-142: prediction statistics and CPI components of the textbook model', () => {
  const m = model(LOOP(8), { predictor: '2bit' });
  m.run();
  const ps = predictionStats(m.stats);
  assert.equal(ps.branches, 8);
  assert.equal(ps.correct + ps.mispredicts, 8);
  assert.ok(ps.rate > 0.5);
  assert.equal(predictionStats({ branches: 0, mispredicts: 0 }).rate, null);
  const c = cpiParts(m);
  assert.deepEqual(c.parts.map((x) => x.key), ['base', 'loadUse', 'branch', 'jump']);
  const sum = c.parts.reduce((t, x) => t + x.value, 0);
  assert.ok(Math.abs(sum - c.model) < 1e-12);
  assert.ok(Math.abs(c.parts[1].value - m.stats.loadUse / m.stats.retired) < 1e-12);
  assert.ok(Math.abs(c.parts[2].value - (m.stats.mispredicts / m.stats.retired) * 2) < 1e-12);
  assert.equal(cpiParts(model(LOOP(1))), null); // nothing retired yet
  const e = model(LOOP(3), { early: true });
  e.run();
  assert.deepEqual(cpiParts(e).parts.map((x) => x.key), ['base', 'loadUse', 'branchWait', 'branch', 'jump']);
});

test('WS-F-141: iterations are cut at the loop-closing branch, not at calls', () => {
  const m = model(LOOP(4));
  m.run();
  const rows = diagramRows(m, 0, m.cycle);
  const its = iterations(rows);
  assert.equal(its.length, 4);
  assert.equal(its[1][0].pc, 0x0c); // each later iteration starts at the loop head
  const call = model(`
        addi x2, x0, 3
loop:   jal  x1, f
        addi x2, x2, -1
        bne  x2, x0, loop
        jal  x0, 0
f:      addi x6, x6, 1
        jalr x0, 0(x1)
`);
  call.run();
  assert.equal(iterations(diagramRows(call, 0, call.cycle)).length, 3);
});

test('WS-F-141: folding keeps the first, last and differing iterations; the folded cycles become a gap', () => {
  const m = model(LOOP(8));
  m.run();
  const rows = diagramRows(m, 0, m.cycle);
  const items = foldRows(rows);
  const folds = items.filter((x) => x.kind === 'fold');
  assert.equal(folds.length, 1);
  // iteration 1 has the prologue, 8 leaves the loop: 2..7 are alike, 3..6 are folded
  assert.equal(folds[0].count, 4);
  const kept = items.filter((x) => x.kind === 'row').length;
  assert.equal(kept + 4 * iterations(rows)[2].length, rows.length);
  const cols = foldColumns(items, 0, m.cycle);
  const gaps = cols.filter((c) => typeof c === 'object');
  assert.equal(gaps.length, 1);
  assert.ok(gaps[0].gap[0] > folds[0].from && gaps[0].gap[1] < folds[0].to);
  // nothing folds in a straight program
  const s = model('addi x1, x0, 1\naddi x2, x1, 1\njal x0, 0\n');
  s.run();
  assert.equal(foldRows(diagramRows(s, 0, s.cycle)).filter((x) => x.kind === 'fold').length, 0);
});
