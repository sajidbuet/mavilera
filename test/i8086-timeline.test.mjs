// The 8086 overlap timeline and waveforms (milestone 8086-B6, L2; design docs/architecture/i8086-timeline.md): the
// waveform frames reproduce the clock records of biu-model.js (templates, 0 and 2 wait states); the pins of a bus cycle
// follow the simulator's per-clock reading of IFUM Figs 4-7/4-8 and Tables 4-2/4-4; the step frames follow the teaching
// model's steps; the timeline's rows and spans reproduce the journal; the IFUM Fig 4-21 loop (p. 4-37, PDF 276; its 16
// bytes, cited, used here only) shows flushes, stalls and refills, qualitatively; the overlap template shows a stall,
// bus contention, a full queue with an idle bus and a flush; the VCD export names every signal. Nothing here is
// compared with the 8086's clock counts (L3, B7).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/i8086/index.js';
import { CPU_REGS } from '../src/arch/i8086/cpu.js';
import { ClockModel } from '../src/arch/i8086/biu-model.js';
import { MicroModel } from '../src/arch/i8086/micro-model.js';
import { invariantProblems } from '../tools/i8086/biu-check.mjs';
import { CLOCK_SIGNALS, STEP_SIGNALS, CLOCK_DEFAULTS, STEP_DEFAULTS, T_CODES, CYCLE_CODES, EU_CODES, STEP_CODES, QS_CODE, STATUS_CODE,
  PASSIVE, pins, clockExportModel, stepExportModel, formatValue } from '../src/arch/i8086/waveform.js';
import { timelineRows, busSpans, instructionSpans } from '../src/arch/i8086/ui/overlap-timeline.js';
import { vcd } from '../src/shell/vcd.js';

const dir = new URL('../content/i8086/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const asm = (text) => {
  const p = descriptor.language.assemble([{ name: 'p.asm', text }], { profile: 'flat' });
  assert.ok(p.ok, JSON.stringify(p.diagnostics ?? ''));
  return p;
};
const programs = index.templates.map((t) => [t.id, asm(readFileSync(new URL(t.file, dir), 'utf8'))]);
programs.push(['default', asm(descriptor.language.defaultSource)]);
// IFUM 9800722-03 Fig 4-21 (p. 4-37, PDF 276): MOV AX,0F802H; PUSH AX; MOV CX,BX; MOV DX,CX; ADD AX,[SI];
// ADD SI,8086H; JMP $-14 -- Intel's machine code, at an even address, as the figure's narrative assumes
const FIG_4_21 = 'top: DB 0B8H,02H,0F8H,50H,8BH,0CBH,8BH,0D1H,03H,04H,81H,0C6H,86H,80H,0EBH,0F0H\n';
const FIG_4_21_BYTES = [0xb8, 0x02, 0xf8, 0x50, 0x8b, 0xcb, 0x8b, 0xd1, 0x03, 0x04, 0x81, 0xc6, 0x86, 0x80, 0xeb, 0xf0];
const QUEUE_FULL_IDLE = 5; // with five or six bytes queued no fetch starts (two free bytes needed, IFUM PDF 29)

/** Run a ClockModel to its halt: the records and the registers after each clock. */
function runAll(p, waitStates) {
  const m = new ClockModel(p, { waitStates });
  const regs = [];
  let r;
  do { r = m.clock(); regs.push(m.mm.registers()); } while (r === 'step');
  return { m, recs: m.journal.map((j) => j.rec), regs, r };
}

for (const waitStates of [0, 2]) {
  test(`i8086 B6: clock frames reproduce the clock records (${waitStates} wait states)`, () => {
    for (const [name, p] of programs) {
      const { recs, regs, r } = runAll(p, waitStates);
      assert.equal(r, 'halt', name);
      const x = clockExportModel(p, { waitStates });
      const frames = [];
      let s = 'step';
      while (s === 'step') { frames.push(x.evaluate().signals); s = x.step(); }
      assert.equal(s, 'halt', name);
      assert.equal(frames.length, recs.length, `${name}: one frame per clock`);
      frames.forEach((f, k) => {
        const rec = recs[k];
        const at = `${name} clock ${k}`;
        assert.equal(T_CODES[f.T], rec.t, at);
        assert.equal(CYCLE_CODES[f.cycle], rec.cycle ? rec.cycle.kind : 'none', at);
        assert.equal(f.queue, rec.q, at);
        assert.equal(EU_CODES[f.EU], rec.eu, at);
        assert.equal(f.QS, k ? QS_CODE[recs[k - 1].qs] ?? 0 : 0, `${at}: QS shows the clock before (Table 4-4)`);
        if (rec.cycle) assert.equal(f.address, rec.cycle.address, at);
        for (const id of CPU_REGS) assert.equal(f[id], regs[k][id], `${at}: ${id} at the end of the clock`);
        for (const sig of CLOCK_SIGNALS) assert.ok(Number.isInteger(f[sig.name]) && f[sig.name] >= 0 && f[sig.name] < 2 ** sig.width, `${at}: ${sig.name}`);
      });
    }
  });
}

test('i8086 B6: the pins of read, write and I/O cycles (Figs 4-7, 4-8; Tables 4-2, 4-4)', () => {
  // a sequence of hand records: one cycle T1..T4 (with `w` wait states), then an idle clock
  const run = (kind, w, address = 0x100) => {
    const ts = ['T1', 'T2', 'T3', ...Array(w).fill('Tw'), 'T4'];
    const recs = [{ t: 'Ti', cycle: null, qs: null, q: 0, eu: 'step' }, ...ts.map((t) => ({ t, cycle: { kind, address, size: 16 }, qs: null, q: 0, eu: 'bus-wait' })),
      { t: 'Ti', cycle: null, qs: 'F', q: 0, eu: 'step' }, { t: 'Ti', cycle: null, qs: null, q: 0, eu: 'step' }];
    const hold = { mio: 1, dtr: 1, address: 0 };
    let tw = 0;
    return recs.map((rec, i) => { tw = rec.t === 'Tw' ? tw + 1 : 0; return pins(rec, { prev: recs[i - 1], next: recs[i + 1], tw, waitStates: w, hold }); });
  };
  const col = (f, k) => f.map((x) => x[k]).join('');
  // index 0: Ti before T1; then T1 T2 T3 (Tw...) T4; Ti (QS of F shows a clock later); Ti
  let f = run('read', 0);
  assert.equal(col(f, 'ALE'), '010000' + '0');
  assert.equal(col(f, 'RD_n'), '1100111'); // T2, T3 (Fig 4-7)
  assert.equal(col(f, 'WR_n'), '1111111');
  assert.equal(col(f, 'DEN_n'), '1100111');
  assert.equal(col(f, 'DT_R').slice(1, 5), '0000');
  assert.equal(col(f, 'M_IO').slice(1, 5), '1111');
  assert.equal(col(f, 'BHE_n'), '1011111'); // a word: BHE in T1
  assert.deepEqual(f.map((x) => x.S), [STATUS_CODE.read, STATUS_CODE.read, STATUS_CODE.read, PASSIVE, PASSIVE, PASSIVE, PASSIVE]);
  assert.deepEqual(f.map((x) => x.QS), [0, 0, 0, 0, 0, 0, QS_CODE.F]);
  f = run('write', 1);
  assert.equal(col(f, 'WR_n'), '11000011'); // T2 T3 Tw T4 active (Fig 4-8)
  assert.equal(col(f, 'RD_n'), '11111111');
  assert.equal(col(f, 'DEN_n'), '11000011');
  assert.equal(col(f, 'DT_R').slice(1, 6), '11111');
  assert.deepEqual(f.map((x) => x.S), [STATUS_CODE.write, STATUS_CODE.write, STATUS_CODE.write, STATUS_CODE.write, PASSIVE, PASSIVE, PASSIVE, PASSIVE]); // T3 active with a wait state; the last Tw passive
  f = run('in', 0, 0x61);
  assert.equal(col(f, 'M_IO').slice(1, 7), '000000'); // held after the cycle
  assert.equal(col(f, 'RD_n'), '1100111');
  assert.equal(f[1].S, STATUS_CODE.in);
  f = run('code', 0, 0x101);
  assert.equal(f[1].BHE_n, 0, 'a byte at an odd address uses the high byte');
  assert.equal(f[1].S, STATUS_CODE.code);
  assert.equal(pins({ t: 'T1', cycle: { kind: 'read', address: 0x100, size: 8 }, q: 0, eu: 'step' }, { hold: { mio: 1, dtr: 1, address: 0 } }).BHE_n, 1, 'a byte at an even address');
});

test('i8086 B6: step frames follow the teaching model', () => {
  for (const [name, p] of programs) {
    const m = new MicroModel(p);
    const kinds = [];
    const regs = [];
    let r;
    do { kinds.push(m.next?.kind); r = m.step(); regs.push(m.registers()); } while (r === 'step');
    const x = stepExportModel(p);
    const frames = [];
    let s = 'step';
    while (s === 'step') { frames.push(x.evaluate().signals); s = x.step(); }
    assert.equal(s, 'halt', name);
    assert.equal(frames.length, kinds.length, name);
    frames.forEach((f, k) => {
      assert.equal(STEP_CODES[f.step], kinds[k], `${name} step ${k}`);
      for (const id of CPU_REGS) assert.equal(f[id], regs[k][id], `${name} step ${k}: ${id}`);
    });
  }
});

test('i8086 B6: signal lists, defaults and the format', () => {
  for (const list of [CLOCK_SIGNALS, STEP_SIGNALS]) {
    assert.equal(new Set(list.map((x) => x.name)).size, list.length);
    for (const x of list) assert.match(x.name, /^[A-Za-z][A-Za-z0-9_]*$/, 'a VCD-safe name');
  }
  for (const n of CLOCK_DEFAULTS) assert.ok(CLOCK_SIGNALS.some((x) => x.name === n), n);
  for (const n of STEP_DEFAULTS) assert.ok(STEP_SIGNALS.some((x) => x.name === n), n);
  assert.equal(formatValue('T', 4), 'Tw');
  assert.equal(formatValue('cycle', 1), 'code');
  assert.equal(formatValue('AX', 3), null);
  // the VCD export names every signal
  const x = clockExportModel(programs[0][1]);
  const frames = [];
  for (let i = 0; i < 40; i++) { frames.push(x.evaluate().signals); if (x.step() !== 'step') break; }
  const text = vcd(frames, CLOCK_SIGNALS, { module: 'i8086' });
  for (const sig of CLOCK_SIGNALS) assert.match(text, new RegExp(`\\$var wire ${sig.width} \\S+ ${sig.name}( \\[|\\s)`), sig.name);
});

test('i8086 B6: the timeline rows and spans reproduce the journal', () => {
  for (const [name, p] of programs) {
    const { m, recs } = runAll(p, 1);
    const rows = timelineRows(m.journal);
    assert.equal(rows.length, recs.length, name);
    rows.forEach((r, i) => {
      for (const k of ['n', 't', 'cycle', 'eu', 'qs', 'q', 'finished']) assert.deepEqual(r[k], recs[i][k], `${name} row ${i}: ${k}`);
      assert.equal(r.at, m.journal[i].at);
    });
    for (const sp of busSpans(rows)) {
      const ts = rows.slice(sp.from, sp.to + 1).map((r) => r.t).join(' ');
      if (sp.to === rows.length - 1 && rows[sp.to].t !== 'T4') assert.ok('T1 T2 T3 Tw T4'.startsWith(ts), `${name}: the cycle under way at the halt`);
      else assert.equal(ts, 'T1 T2 T3 Tw T4', `${name}: a bus cycle at row ${sp.from}`);
    }
    assert.equal(busSpans(rows).length, recs.filter((r) => r.t === 'T1').length, name);
    const ins = instructionSpans(rows);
    assert.equal(ins.length, recs.filter((r) => r.finished).length, `${name}: one span per instruction`);
    for (const sp of ins) {
      assert.ok(rows[sp.to].finished, name);
      assert.ok(rows.slice(sp.from, sp.to + 1).every((r) => r.at.pc === rows[sp.from].at.pc), `${name}: one instruction per span`);
    }
    // a window that starts inside a cycle, and the next clock
    const cut = timelineRows(m.journal.slice(5, 30), recs[30], m.journal[30].at);
    assert.equal(cut.length, 26);
    assert.ok(cut.at(-1).next);
  }
});

for (const waitStates of [0, 1]) {
  test(`i8086 B6: the IFUM Fig 4-21 loop shows flushes, stalls and refills (qualitative, ${waitStates} wait states)`, () => {
    const p = asm(FIG_4_21);
    const m = new ClockModel(p, { waitStates });
    const base = (m.mm.c.CS << 4) + m.mm.c.IP;
    assert.equal(m.mm.c.IP % 2, 0, 'an even address');
    assert.deepEqual([...m.mm.mem.slice(base, base + 16)], FIG_4_21_BYTES);
    for (let i = 0; i < 600; i++) assert.equal(m.clock(), 'step');
    const recs = m.journal.map((j) => j.rec);
    assert.deepEqual(invariantProblems(recs, { waitStates }), []);
    const flushes = recs.map((r, i) => (r.qs === 'E' ? i : -1)).filter((i) => i >= 0);
    assert.ok(flushes.length >= 4, `flushes: ${flushes.length}`);
    for (const i of flushes) assert.deepEqual(recs[i].flushTo, { cs: m.mm.c.CS, ip: base - (m.mm.c.CS << 4) }, 'the JMP goes back to the loop');
    assert.ok(recs.some((r) => r.eu === 'queue-wait'), 'the EU stalls on an empty queue');
    for (let k = 1; k < flushes.length; k++) {
      const between = recs.slice(flushes[k - 1] + 1, flushes[k]);
      assert.ok(between.some((r) => r.start && r.cycle.kind === 'code' && r.q === 0), 'the queue refills from empty after the flush');
      assert.ok(Math.max(...between.map((r) => r.q)) >= 2, 'bytes are queued ahead of the EU');
    }
    // every pass runs the seven instructions
    const passes = m.mm.retired / 7;
    assert.ok(passes >= flushes.length, `${m.mm.retired} instructions`);
  });
}

test('i8086 B6: the overlap template shows a stall, bus contention, a full queue with an idle bus and a flush', () => {
  const p = programs.find(([n]) => n === 'overlap')[1];
  const { m, recs, r } = runAll(p, 0);
  assert.equal(r, 'halt');
  assert.equal(m.mm.c.DI, 609);
  assert.ok(recs.some((x) => x.eu === 'queue-wait'), 'a stall on an empty queue');
  assert.ok(recs.some((x) => x.eu === 'bus-wait' && x.cycle?.kind === 'code'), 'the EU waits while a code fetch runs');
  assert.ok(recs.some((x) => x.t === 'Ti' && x.q >= QUEUE_FULL_IDLE), 'the bus idles with the queue (nearly) full');
  assert.ok(recs.filter((x) => x.qs === 'E').length >= 2, 'flushes');
});
