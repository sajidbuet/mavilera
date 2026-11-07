// i8086/waveform.js -- the waveforms and the VCD export of the 8086 BIU and EU view (milestone 8086-B6; design
// docs/architecture/i8086-timeline.md, B6-Q1 to Q8 decided by the author 2026-11-05). In clock mode one frame is one
// clock of the teaching model (biu-model.js, L2): its T state and bus cycle, the pins of both bus modes as Intel draws
// them, the EU's activity, and the queue and registers at the end of the clock. The pins' clocks are the simulator's
// reading of IFUM 9800722-03 Figs 4-7 and 4-8 (minimum mode, PDF 245-246), Table 4-2 with the status timing of the data
// sheet (maximum mode, PDF 251, 553) and Table 4-4 (QS, valid in the clock after the event, PDF 253): one value per
// clock, edges inside a clock not shown, electrical levels (an active-low pin is 0 when active; names with _n). A real
// 8086 has one set: minimum mode (ALE, M/IO, WR, DT/R, DEN) or maximum mode (S2-S0, QS1-QS0); RD and BHE are common
// (Table 4-1, PDF 250). In step mode a frame is one teaching-model step: its kind and the registers after it. Clock
// counts are not the 8086's. The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CPU_REGS } from './cpu.js';
import { ClockModel } from './biu-model.js';
import { CalibratedClockModel } from './timing.js';
import { MicroModel } from './micro-model.js';
import { I8086_STRINGS } from './strings.js';

const L = I8086_STRINGS.waveform.labels;

/** Codes of the multi-valued tracks (the waveform's `format` writes the names). */
export const T_CODES = Object.freeze(['Ti', 'T1', 'T2', 'T3', 'Tw', 'T4']);
export const CYCLE_CODES = Object.freeze(['none', 'code', 'read', 'write', 'in', 'out', 'inta']); // inta: 8086-B8
export const EU_CODES = Object.freeze(['step', 'queue-wait', 'bus-wait', 'idle', 'halt', 'busy']); // busy: calibrated mode (B7-Q2)
export const STEP_CODES = Object.freeze(['queue', 'move', 'alu', 'bus', 'jump', 'hardwired', 'end']);
/** QS1 QS0 ([INTEL] Table 4-4): 00 no operation, 01 first byte, 10 queue emptied, 11 subsequent byte. */
export const QS_CODE = Object.freeze({ F: 0b01, E: 0b10, S: 0b11 });
/**
 * S2 S1 S0 ([INTEL] Table 4-2); 111 passive; 000 interrupt acknowledge (8086-B8: the INTA cycles of an INTR entry; RD
 * and WR stay inactive, the INTA strobe itself is not a track); halt (011) is not modelled.
 */
export const STATUS_CODE = Object.freeze({ inta: 0b000, in: 0b001, out: 0b010, code: 0b100, read: 0b101, write: 0b110 });
export const PASSIVE = 0b111;

const regSignals = () => CPU_REGS.map((name) => ({ name, width: 16, kind: 'data' }));

/** The signals of a clock frame. */
export const CLOCK_SIGNALS = Object.freeze([
  { name: 'T', width: 3, kind: 'data', label: L.T },
  { name: 'cycle', width: 3, kind: 'data', label: L.cycle },
  { name: 'address', width: 20, kind: 'data', label: L.address },
  ...['ALE', 'BHE_n', 'M_IO', 'RD_n', 'WR_n', 'DT_R', 'DEN_n'].map((name) => ({ name, width: 1, kind: 'control', label: L[name] })),
  { name: 'S', width: 3, kind: 'control', label: L.S },
  { name: 'QS', width: 2, kind: 'control', label: L.QS },
  { name: 'queue', width: 3, kind: 'data', label: L.queue },
  { name: 'EU', width: 3, kind: 'data', label: L.EU },
  ...regSignals(),
].map(Object.freeze));

/** The signals of a clock frame in calibrated mode (B7): those of clock mode and whether the instruction is calibrated (B7-Q4). */
export const CALIBRATED_SIGNALS = Object.freeze([...CLOCK_SIGNALS,
  Object.freeze({ name: 'calibrated', width: 1, kind: 'control', label: L.calibrated })]);

/** The signals of a step frame (step mode). */
export const STEP_SIGNALS = Object.freeze([{ name: 'step', width: 3, kind: 'data', label: L.step }, ...regSignals()].map(Object.freeze));

/**
 * The roadmap's defaults (B6): T state, ALE, M/IO, RD, WR, QS, the queue and the EU; step mode: the step. IP in both
 * (the EU taking queue bytes). The panel keeps one list of names for both modes and shows those a mode offers.
 */
export const CLOCK_DEFAULTS = Object.freeze(['T', 'ALE', 'M_IO', 'RD_n', 'WR_n', 'QS', 'queue', 'EU', 'IP']);
export const STEP_DEFAULTS = Object.freeze(['step', 'IP']);

/** The waveform's text of a value (null: the panel's own). */
export function formatValue(name, v) {
  if (name === 'T') return T_CODES[v] ?? null;
  if (name === 'cycle') return CYCLE_CODES[v] ?? null;
  if (name === 'EU') return I8086_STRINGS.waveform.eu[EU_CODES[v]] ?? null;
  if (name === 'step') return I8086_STRINGS.datapath.kinds[STEP_CODES[v]] ?? null;
  if (name === 'calibrated') return I8086_STRINGS.waveform.calibrated[v] ?? null;
  return null;
}

const readLike = (k) => k === 'code' || k === 'read' || k === 'in';
const writeLike = (k) => k === 'write' || k === 'out';
const isIo = (k) => k === 'in' || k === 'out' || k === 'inta'; // M/IO low in INTA cycles too ([EDU] for the drawing)
/** A cycle uses the upper data byte (BHE active): a word, or a byte at an odd address ([INTEL] p. 4-14, bank selection). */
export const usesHigh = (c) => c.size === 16 || Boolean(c.address & 1);

/**
 * The pins of one clock. `rec` is the clock's record (BiuCore.clock), `prev` the one before (QS shows its event, Table
 * 4-4 note), `next` the one after (S2-S0 go active in the clock before T1); `tw` is the number of this Tw within its
 * cycle (1, 2, ...; 0 when not a Tw); `hold` carries M/IO, DT/R and the address between cycles and is updated.
 */
export function pins(rec, { prev = null, next = null, tw = 0, waitStates = 0, hold }) {
  const c = rec?.cycle ?? null;
  const t = rec?.t ?? 'Ti';
  if (c) { hold.mio = isIo(c.kind) ? 0 : 1; hold.dtr = writeLike(c.kind) ? 1 : 0; hold.address = c.address; }
  const inData = t === 'T2' || t === 'T3' || t === 'Tw'; // RD and DEN of a read: T2 to the start of T4 (Fig 4-7)
  const rd = Boolean(c) && readLike(c.kind) && inData;
  const wr = Boolean(c) && writeLike(c.kind) && (inData || t === 'T4'); // WR and DEN of a write: T2 into T4 (Fig 4-8)
  // S2-S0: active in the clock before T1 (T4 or Ti), T1, T2, and T3/Tw up to the state before T4, which is passive
  // (data sheet, PDF 553: "returned to the passive state (1,1,1) during T3 or during Tw when READY is HIGH")
  let S = PASSIVE;
  if (c && (t === 'T1' || t === 'T2' || (t === 'T3' && waitStates > 0) || (t === 'Tw' && tw < waitStates))) S = STATUS_CODE[c.kind];
  else if (next?.t === 'T1' && next.cycle) S = STATUS_CODE[next.cycle.kind];
  return {
    T: T_CODES.indexOf(t),
    cycle: CYCLE_CODES.indexOf(c ? c.kind : 'none'),
    address: hold.address,
    ALE: t === 'T1' ? 1 : 0,
    BHE_n: c && t === 'T1' && usesHigh(c) ? 0 : 1, // BHE is output in T1 with the address; S7 afterwards (not shown)
    M_IO: hold.mio,
    RD_n: rd ? 0 : 1,
    WR_n: wr ? 0 : 1,
    DT_R: hold.dtr,
    DEN_n: rd || wr ? 0 : 1,
    S,
    QS: QS_CODE[prev?.qs] ?? 0,
    queue: rec?.q ?? 0,
    EU: Math.max(0, EU_CODES.indexOf(rec?.eu ?? 'halt')),
  };
}

/**
 * The shell's export protocol over a model run one record ahead: `tick()` runs one unit and returns {result, data}.
 * Frame i is built from the records (frameOf(i, at), at(j) gives record j or null), in order.
 */
function runAhead(tick, frameOf) {
  const recs = [];
  const frames = [];
  let k = 0;
  let ended = false;
  const at = (i) => {
    while (recs.length <= i && !ended) {
      const r = tick();
      recs.push(r);
      if (r.result !== 'step') ended = true;
    }
    return recs[i] ?? null;
  };
  return {
    evaluate() {
      while (frames.length <= k) frames.push(frameOf(frames.length, at));
      return { signals: frames[k] };
    },
    step() {
      const r = at(k);
      k += 1;
      return r ? r.result : recs.at(-1)?.result ?? 'halt';
    },
    run(limit) {
      for (let i = 0; i < limit; i++) { const r = this.step(); if (r !== 'step') return r; }
      return 'budget';
    },
    get error() { return recs.at(-1)?.error ?? null; },
  };
}

/**
 * A fresh clock-mode model of the program with the shell's export protocol (evaluate, step, run); `calibrated`: the
 * calibrated model (timing.js, B7; no wait states) with the `calibrated` track.
 */
export function clockExportModel(program, { waitStates = 0, calibrated = false } = {}) {
  const m = calibrated ? new CalibratedClockModel(program) : new ClockModel(program, { waitStates });
  if (calibrated) waitStates = 0;
  const tick = () => {
    const before = m.journal.length;
    const result = m.clock();
    const rec = m.journal.length > before ? m.journal.at(-1).rec : null;
    m.journal.length = 0; m.mm.history.length = 0; // an export never steps back
    return { result, rec, regs: m.mm.registers(), error: m.error };
  };
  const hold = { mio: 1, dtr: 1, address: 0 };
  let tw = 0;
  return runAhead(tick, (i, at) => {
    const cur = at(i);
    const rec = cur?.rec ?? null;
    tw = rec?.t === 'Tw' ? tw + 1 : 0;
    const p = pins(rec, { prev: i ? at(i - 1)?.rec : null, next: rec ? at(i + 1)?.rec : null, tw, waitStates, hold });
    return { ...p, ...(calibrated ? { calibrated: rec?.calibrated ? 1 : 0 } : {}), ...(cur?.regs ?? m.mm.registers()) };
  });
}

/** A fresh step-mode model: one frame per teaching-model step, its kind and the registers after it. */
export function stepExportModel(program) {
  const m = new MicroModel(program);
  const tick = () => {
    const kind = m.next?.kind ?? null;
    const result = m.step();
    m.history.length = 0; // an export never steps back
    return { result, kind, regs: m.registers(), error: m.error };
  };
  return runAhead(tick, (i, at) => {
    const cur = at(i);
    return { step: Math.max(0, STEP_CODES.indexOf(cur?.kind)), ...(cur?.regs ?? m.registers()) };
  });
}
