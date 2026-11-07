// The stage model of the pico2 pipeline view (P1-M3, design §6.2): its cycles equal the hart's advance of time on every step of
// the E-TIMING-1 programs (ticks, and mcycle while it counts) and on the P1-M2 firmwares (the research repository's
// pico-examples builds, read from PICO2_FIRMWARE_DIR or %LOCALAPPDATA%\pico2sim-build\pico-examples-rv; skipped when absent);
// the per-cycle contents of a few hazards (load-use with its bypass, a jump bubble, a predicted branch, a trap) and the
// diagram; rewinding after step back.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Hart } from '../src/arch/pico2/core/hart.js';
import { assemble, RAM_BASE } from '../src/arch/pico2/language.js';
import { create } from '../src/arch/pico2/engine.js';
import { readImage } from '../src/arch/pico2/boot/image.js';
import { STOP } from '../src/arch/contract.js';
import { StageModel, XS, WHY, FS, MS, BYP, SIG } from '../src/arch/pico2/uarch/stages.js';
import { cpiByCause, hazardCounts, diagram, CELL } from '../src/arch/pico2/uarch/summary.js';
import { TestBus, runTiming } from './fixtures/pico2-timing.mjs';

test('stage model cycles = the hart\'s time on every step of the E-TIMING-1 programs (ticks, and mcycle while it counts)', () => {
  const model = new StageModel(1 << 12, 1 << 11);
  const bad = [];
  let steps = 0, counted = 0;
  const { bus, h } = runTiming({
    detail: true,
    afterStep: (hh, pc, t0, c0) => {
      const before = model.cycles;
      model.record(hh, pc, t0);
      const got = model.cycles - before;
      steps++;
      if (got !== hh.ticks - t0) bad.push(`step ${steps} pc ${(pc >>> 0).toString(16)}: ${got} vs ticks ${hh.ticks - t0}`);
      if (!(hh.mcountinhibit & 1) && hh.cycles - c0 === hh.ticks - t0) { counted++; if (got !== hh.cycles - c0) bad.push(`step ${steps}: mcycle`); }
    },
  });
  assert.equal(bus.exit, 0);
  assert.deepEqual(bad.slice(0, 5), []);
  assert.equal(model.cycles, h.ticks);
  assert.ok(counted > steps * 0.99, `${counted} of ${steps} steps with mcycle counting`);
  const c = cpiByCause(model, 0);
  assert.equal(Object.values(c.byCause).reduce((a, b) => a + b, 0), c.cycles, 'every kept cycle has one category');
});

/** Run a small program on a bare hart and record every step. */
function small(text) {
  const p = assemble([{ name: 's.s', text }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const bus = new TestBus(); bus.deadline = Infinity;
  for (const sg of p.segments) bus.bytes.set(sg.bytes, sg.address - RAM_BASE);
  const h = new Hart(bus, { resetPc: p.entry }); bus.hart = h; h.detail = true;
  const model = new StageModel(256, 128);
  for (let i = 0; i < 60 && bus.exit === null; i++) { const pc = h.pc, t0 = h.ticks; h.step(); model.record(h, pc, t0); }
  return { p, h, model };
}
const recs = (model) => { const out = []; for (let r = model.lo; r < model.n; r++) out.push(r); return out; };

test('load-use: X stalls with the load in M (x_stall_on_raw), then the consumer takes the value from mw_result', () => {
  const { p, model } = small(`li a1, ${RAM_BASE + 0x100}
      li t1, 5
      sw t1, 0(a1)
      lw t0, 0(a1)
use:  addi t2, t0, 1
      addi t3, t2, 1
      j use2
      nop
use2: nop
`);
  const use = p.symbols.use;
  const stall = recs(model).find((r) => model.xPc[model.at(r)] === use && model.xState[model.at(r)] === XS.STALL);
  assert.ok(stall !== undefined, 'a stall cycle of the consumer');
  const i = model.at(stall), j = model.at(stall + 1);
  assert.equal(model.why[i], WHY.RAW);
  assert.ok(model.sig[i] & SIG.X_STALL_ON_RAW);
  assert.equal(model.mPc[i], use - 4, 'the load is in M');
  assert.equal(model.xState[j], XS.EXEC); assert.equal(model.mState[j], MS.EMPTY, 'a bubble enters M');
  assert.equal(model.byp1[j], BYP.MW, 'rs1 from mw_result'); assert.equal(model.mwRd[j], 5); assert.equal(model.mwResult[j], 5);
  const next = model.at(stall + 2);
  assert.equal(model.byp1[next], BYP.XM, 'addi t3, t2: from xm (the addi before it is in M)');
  // the jump: x_jump_req, a wrong-path fetch, then a bubble while the target is fetched
  const jr = recs(model).find((r) => model.sig[model.at(r)] & SIG.X_JUMP_REQ);
  const a = model.at(jr), b = model.at(jr + 1);
  assert.equal(model.fState[a], FS.WRONG);
  assert.equal(model.xState[b], XS.EMPTY); assert.equal(model.why[b], WHY.JUMP);
  assert.equal(model.fState[b], FS.TARGET); assert.equal(model.fPc[b], p.symbols.use2);
});

test('a loop: the first taken branch sets the BTB, the next ones are predicted; the diagram shows F, X and M per step', () => {
  const { p, model } = small(`la t0, hd
      csrw mtvec, t0
      li a0, 3
loop: addi a0, a0, -1
      bgez a0, loop
      ecall
      .balign 4
hd:   j hd
`);
  const br = p.symbols.loop + 4;
  const rs = recs(model).filter((r) => model.xPc[model.at(r)] === br && model.xState[model.at(r)] === XS.EXEC);
  assert.ok(model.sig[model.at(rs[0])] & SIG.X_BTB_SET, 'the first iteration sets the BTB');
  assert.ok(model.sig[model.at(rs[1])] & SIG.X_BRANCH_WAS_PREDICTED, 'the second is predicted');
  assert.equal(model.btb[model.at(rs[1])], br, 'btb_src_addr');
  const ecall = recs(model).find((r) => model.mState[model.at(r)] === MS.TRAP);
  assert.ok(model.sig[model.at(ecall)] & SIG.M_TRAP_ENTER_VLD);
  const dgm = diagram(model, 4);
  assert.equal(dgm.rows.length, 4);
  for (const row of dgm.rows.slice(0, -1)) assert.ok(row.cells.includes(CELL.X) || row.cells.includes(CELL.SQUASH), 'each step is in X');
  const h = hazardCounts(model);
  assert.ok(h.predicted >= 1 && h.mispredict >= 2, JSON.stringify(h));
});

test('rewind after step back: the engine\'s stage model follows the hart back and forth', () => {
  const prog = assemble([{ name: 'r.s', text: `
      li a1, 0x20040000
      li a0, 20
l:    lw t0, 0(a1)
      add t1, t0, a0
      addi a0, a0, -1
      bnez a0, l
      div t2, t1, a0
      ebreak
` }]);
  const e = create(prog);
  const model = new StageModel(1024, 512);
  e.attachStages(model);
  for (let i = 0; i < 40; i++) e.step();
  const ticks = e.machine.hart.ticks, n = model.cycles;
  assert.equal(n, ticks);
  for (let i = 0; i < 15; i++) assert.ok(e.back());
  assert.equal(model.cycles, e.machine.hart.ticks, 'after 15 steps back');
  const snap = JSON.stringify([...model.xPc.slice(0, model.n)]);
  for (let i = 0; i < 15; i++) e.step();
  assert.equal(model.cycles, ticks, 'forward again: the same cycles');
  assert.ok(snap.length > 0);
});

// ---- the P1-M2 firmwares ------------------------------------------------------------------------------------------------
const FW_DIR = process.env.PICO2_FIRMWARE_DIR ?? path.join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'pico-examples-rv');
const FIRMWARES = ['uart/hello_uart/hello_uart.uf2', 'blink/blink.uf2', 'timer/timer_lowlevel/timer_lowlevel.uf2',
  'gpio/hello_gpio_irq/hello_gpio_irq.uf2', 'timer/hello_timer/hello_timer.uf2'];
const haveFw = FIRMWARES.every((f) => fs.existsSync(path.join(FW_DIR, f)));

test('stage model cycles = ticks on the five P1-M2 firmwares (500 000 steps each), and after stepping back', { skip: haveFw ? false : `firmware not found in ${FW_DIR}` }, () => {
  for (const f of FIRMWARES) {
    const image = readImage(new Uint8Array(fs.readFileSync(path.join(FW_DIR, f))));
    const e = create({ image }, { runLimit: Infinity });
    const model = new StageModel();
    e.attachStages(model);
    const h = e.machine.hart, t0 = h.ticks;
    let bad = null, steps = 0;
    while (steps < 500_000) {
      const s = e.run({ chunk: 50_000, resumed: true });
      steps = e.state().steps;
      if (model.cycles !== h.ticks - t0) { bad = `${f}: ${model.cycles} vs ${h.ticks - t0} at step ${steps}`; break; }
      if (s !== STOP.CHUNK) break;
    }
    assert.equal(bad, null);
    assert.ok(model.cycles > 0);
    for (let i = 0; i < 20; i++) e.back();
    assert.equal(model.cycles, h.ticks - t0, `${f}: after 20 steps back`);
  }
});
