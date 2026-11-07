// E-TIMING-1 on the pico2 hart (P1-M3, design docs/architecture/pico2-p1m3-pipeline.md §6.1): every region of the research
// repository's experiments/e-timing-1/sw/timing.S, written again for the pico2 assembler (fixtures/pico2-timing.mjs: no macros
// there, so the macros are JS functions; local labels get unique names; GNU's `unimp` is its word 0xc0001073). Each region is measured as in the
// RTL run: mcycle before and after, minus the empty region (id 1). Gate (decision Q7, D15): exact equality with the datasheet
// (RP-001 §3.8.7) where it states a count, including the 52-cycle copy routine and the 3- and 2-cycle delay loops; for the
// 18 rows where the RTL differs, the datasheet value (D15-1; for div/rem "18 or 19" the model's rule, 19 with a negative
// dividend of a signed operation, an inference); the E-TIMING-1 RTL value where the datasheet states nothing.
// The interrupt rows: the RTL testbench raised the line N cycles after a store; the pico2 model has no pin latency, so the
// test raises it at the cycle the RTL recognised it (the store's X cycle + 3 + N for the software interrupt, + 2 + N for
// irq[0], read off the RTL's squashed-instruction index). That latency is an input here, not a claim of the model; what is
// gated is the entry cost (2 cycles), the squashed index and the handler's start, and the div cancelled by an interrupt.
// Also: step back restores the BTB and previous-load state exactly; the machine advances ticks and device time by the cost.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hart } from '../src/arch/pico2/core/hart.js';
import { HistoryRing } from '../src/arch/pico2/core/history.js';
import { assemble, RAM_BASE, RAM_SIZE } from '../src/arch/pico2/language.js';
import { create } from '../src/arch/pico2/engine.js';
import { STOP } from '../src/arch/contract.js';
import { TestBus, runTiming } from './fixtures/pico2-timing.mjs';

// ---- expected values ------------------------------------------------------------------------------------------------
// [id, cycles, basis]: DS = the datasheet (RP-001 §3.8.7); DS15 = the datasheet where the RTL differs (D15-1); RULE = the
// datasheet's "18 or 19" resolved by the model's rule (inference, D15-1); RTL = E-TIMING-1 (the datasheet states nothing).
const DS = 'datasheet', DS15 = 'datasheet (RTL differs, D15-1)', RULE = 'datasheet 18|19, model rule (inference)', RTL = 'E-TIMING-1 RTL';
const EXPECTED = [
  [10, 10, DS], [11, 10, DS], [12, 2, DS], [20, 2, DS], [21, 3, DS], [22, 2, DS], [23, 3, DS], [24, 3, DS], [25, 3, DS], [26, 3, DS],
  [27, 12, DS], [28, 3, DS], [29, 3, DS], [66, 7, DS],
  [30, 4, DS], [31, 2, DS], [32, 18, RULE], [33, 19, RULE], [34, 18, RULE], [35, 19, RULE], [36, 18, DS15], [37, 18, RULE], [38, 19, RULE],
  [39, 18, RULE], [40, 19, RULE], [41, 18, DS15], [42, 18, RULE], [43, 19, RULE], [44, 19, RULE], [45, 19, RULE], [46, 18, DS15],
  [47, 18, RULE], [48, 19, RULE], [49, 19, RULE],
  [50, 2, DS], [51, 3, DS], [52, 5, DS], [53, 4, DS], [54, 4, DS], [55, 6, DS], [56, 5, RTL], [57, 20, DS], [58, 3, DS],
  [60, 2, DS], [61, 3, DS], [62, 4, DS], [63, 4, DS], [64, 5, DS], [65, 3, RTL],
  [70, 1, DS], [71, 2, DS], [72, 3, DS], [73, 22, DS], [74, 42, DS], [75, 29, DS], [76, 59, DS], [77, 33, RTL], [78, 63, RTL],
  [79, 23, DS], [80, 43, DS], [81, 52, DS], [82, 54, DS],
  [90, 6, DS], [91, 2, DS], [92, 1, RTL], [93, 2, RTL], [94, 1, RTL], [95, 2, RTL], [96, 2, DS],
  [100, 3, DS], [101, 2, DS15], [102, 3, DS], [103, 3, DS15], [104, 3, RTL], [105, 2, DS15], [106, 3, RTL], [107, 2, DS15],
  [108, 3, RTL], [109, 2, DS15], [110, 4, DS], [111, 2, DS15],
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14].flatMap((n, i) => [[200 + 2 * i, n, DS], [201 + 2 * i, n, DS]]),
  [230, 4, DS], [231, 4, DS], [232, 5, DS], [233, 8, DS], [234, 15, DS], [240, 5, DS15], [241, 5, DS], [242, 6, DS], [243, 9, DS],
  [244, 16, DS], [235, 5, DS], [250, 2, DS], [251, 2, DS], [252, 11, DS], [253, 3, DS], [260, 34, DS],
];
// interrupt rows: [id, entry cycles, handler start - region start, squashed index] (E-TIMING-1 summary.csv)
const IRQ_EXPECTED = [
  ...[1, 2, 3, 4, 5, 6].map((k) => [119 + k, 2, 6 + k, 2 + k]),
  ...[1, 2, 3, 4, 5, 6].map((k) => [129 + k, 2, 5 + k, 1 + k]),
  [136, 8, 10, 0], [137, 14, 16, 0],
];

test('E-TIMING-1 programs: every region matches the datasheet, D15 or the RTL measurement exactly', () => {
  const { bus } = runTiming();
  assert.equal(bus.exit, 0, 'the program reached its end (not fail)');
  const r = bus.results;
  const calib = r.get(1)[0];
  assert.equal(calib, 1, 'calibration: csrr to csrr is one cycle');
  const bad = [];
  for (const [id, want, basis] of EXPECTED) {
    const got = r.get(id)?.[0] - calib;
    if (got !== want) bad.push(`${id}: ${got} (want ${want}, ${basis})`);
  }
  for (const [id, entry, start, index] of IRQ_EXPECTED) {
    const v = r.get(id);
    const idx = v?.[1] / 4;
    if (v?.[0] !== start || idx !== index || v[0] - (2 + idx) !== entry) bad.push(`${id}: start ${v?.[0]}, index ${idx} (want ${start}, ${index}; entry ${entry})`);
  }
  assert.deepEqual(bad, []);
  assert.equal(EXPECTED.length + IRQ_EXPECTED.length, 135, 'all 135 rows of E-TIMING-1');
});

test('the hart\'s fast path (no history) and its full step (history attached, and detail) give the same cycles, results and timing state', () => {
  const trace = (history, detail) => {
    const out = [];
    const r = runTiming({ history, detail, afterStep: (h, pc) => out.push(`${pc}:${h.ticks}:${h.cycles}:${h.instret}:${h.btb}:${h.tState()}:${h.x.join(',')}`) });
    return { out, results: JSON.stringify([...r.bus.results]) };
  };
  const a = trace(null, false), b = trace(new HistoryRing(1 << 22), false), c = trace(null, true);
  assert.deepEqual(c, b, 'detail without history: the full step');
  assert.equal(a.results, b.results);
  assert.equal(a.out.length, b.out.length);
  const k = a.out.findIndex((x, i) => x !== b.out[i]);
  assert.equal(k, -1, `first difference at step ${k}: ${a.out[k]} vs ${b.out[k]}`);
});

test('rule E also after lr.w x0 and sc.w x0 (no rd): the next exclusive access waits one cycle, a later one does not', () => {
  const p = assemble([{ name: 'e.s', text: `li a1, 0x20040000
      csrw mcountinhibit, zero
      csrr t3, mcycle
      lr.w x0, (a1)
      sc.w x0, a0, (a1)
      csrr t4, mcycle
      lr.w x0, (a1)
      addi t0, t0, 1
      lr.w t1, (a1)
      csrr t5, mcycle
      ebreak
` }]);
  assert.ok(p.ok);
  const bus = new TestBus();
  for (const sg of p.segments) bus.bytes.set(sg.bytes, sg.address - RAM_BASE);
  for (const history of [null, new HistoryRing(1 << 12)]) {
    const h = new Hart(bus, { resetPc: p.entry }); bus.hart = h; h.attachHistory(history);
    for (let i = 0; i < 12 && !h.trapped; i++) h.step();
    assert.equal(h.x[29] - h.x[28], 1 + 1 + 2, 'csrr, lr.w, sc.w with the bubble');
    assert.equal(h.x[30] - h.x[29], 1 + 1 + 1 + 1, 'csrr, lr.w, addi, lr.w: no bubble two instructions later');
  }
});

test('step back over the whole timing program restores registers, counters, BTB and the previous-load state exactly', () => {
  const ring = new HistoryRing(1 << 22);
  const states = [];
  const full = (h) => JSON.stringify({ x: [...h.x], pc: h.pc, ticks: h.ticks, cycles: h.cycles, instret: h.instret, btb: h.btb, t: h.tState(), sys: h.saveSys() });
  const { h, bus } = runTiming({ history: ring, onStep: (hh) => states.push(full(hh)) });
  assert.equal(bus.exit, 0);
  assert.equal(ring.dropped, 0);
  let k = states.length;
  let btbSeen = 0, ldSeen = 0;
  while (h.stepBack()) {
    k--;
    const s = full(h);
    if (s !== states[k]) assert.fail(`step ${k}: ${s.slice(0, 300)}\nwant ${states[k].slice(0, 300)}`);
    if (h.btb !== -1) btbSeen++;
    if (h.ldRd !== 0) ldSeen++;
  }
  assert.equal(k, 0, 'every step was undone');
  assert.ok(btbSeen > 0 && ldSeen > 0, 'the walk passed through BTB and load-use states');
});

test('the machine: ticks and mcycle advance by the cost; an interrupt due during a div cancels it (mepc = the div)', () => {
  const p = assemble([{ name: 't.s', text: `
      la t0, handler
      csrw mtvec, t0
      csrw mcountinhibit, zero
      li t0, 0xd0000000
      li t1, 3
      sw t1, 0x1a4(t0)        # MTIME_CTRL: EN | FULLSPEED (clk_sys cycles)
      sw zero, 0x1bc(t0)
      li t1, 0x80
      csrw mie, t1            # MTIE
      li a3, 1000
      li a4, 7
      lw t1, 0x1b0(t0)        # MTIME
      addi t1, t1, 40
      sw t1, 0x1b8(t0)        # MTIMECMP = MTIME + 40: inside the second div
      csrsi mstatus, 8
      nop
      nop
divi: div a5, a3, a4
      div a5, a3, a4
      div a5, a3, a4
      ebreak
handler:
      csrr s2, mepc
      li t1, -1
      sw t1, 0x1bc(t0)        # MTIMECMPH: no more interrupts
      csrr s3, mcause
      csrw mtvec, zero        # the simulator's halting rule: ebreak ends the program when no handler is installed
      ebreak
` }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const e = create(p);
  let s; do s = e.run({ chunk: 100_000 }); while (s === STOP.CHUNK);
  assert.equal(s, STOP.HALT);
  const h = e.machine.hart, st = e.state();
  assert.equal(h.ticks - h.cycles, 3, 'mcycle counts every cycle after the three instructions before mcountinhibit was cleared');
  assert.equal(st.registers.x19 >>> 0, 0x80000007, 'machine timer interrupt');
  assert.equal(st.registers.x18, p.symbols.divi + 4, 'mepc is the second div, cancelled by the interrupt');
});

test('steps report their cost and causes; the BTB is cleared by fence.i and by traps', () => {
  const p = assemble([{ name: 't.s', text: `
      la t0, h
      csrw mtvec, t0
      li a0, 3
loop: addi a0, a0, -1
      bgez a0, loop
      fence.i
      li a0, 3
loop2: addi a0, a0, -1
      bgez a0, loop2
      ecall
      .balign 4
h:    j h
` }]);
  assert.ok(p.ok);
  const bus = new TestBus();
  for (const sg of p.segments) bus.bytes.set(sg.bytes, sg.address - RAM_BASE);
  const h = new Hart(bus, { resetPc: p.entry }); bus.hart = h; h.detail = true; // lastCost is kept for a stage model
  const seen = [];
  for (let i = 0; i < 40; i++) { const pc = h.pc; h.step(); seen.push([pc, h.lastCost, h.btb]); }
  const loop = p.symbols.loop + 4, loop2 = p.symbols.loop2 + 4;
  assert.ok(seen.some(([pc, , btb]) => pc === loop && btb === loop), 'a taken backward branch enters the BTB');
  const fi = seen.find(([pc]) => pc === loop + 4);
  assert.deepEqual([fi[1], fi[2]], [2, -1], 'fence.i: 2 cycles, BTB cleared');
  const ec = seen.find(([pc]) => pc === loop2 + 4);
  assert.deepEqual([ec[1], ec[2]], [3, -1], 'ecall: 3 cycles, BTB cleared');
});
