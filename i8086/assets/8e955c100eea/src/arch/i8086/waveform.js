// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { CPU_REGS } from './cpu.js';
import { ClockModel } from './biu-model.js';
import { CalibratedClockModel } from './timing.js';
import { MicroModel } from './micro-model.js';
import { I8086_STRINGS } from './strings.js';
const L = I8086_STRINGS.waveform.labels;
export const T_CODES = Object.freeze(['Ti', 'T1', 'T2', 'T3', 'Tw', 'T4']);
export const CYCLE_CODES = Object.freeze(['none', 'code', 'read', 'write', 'in', 'out', 'inta']);
export const EU_CODES = Object.freeze(['step', 'queue-wait', 'bus-wait', 'idle', 'halt', 'busy']);
export const STEP_CODES = Object.freeze(['queue', 'move', 'alu', 'bus', 'jump', 'hardwired', 'end']);
export const QS_CODE = Object.freeze({ F: 0b01, E: 0b10, S: 0b11 });
export const STATUS_CODE = Object.freeze({ inta: 0b000, in: 0b001, out: 0b010, code: 0b100, read: 0b101, write: 0b110 });
export const PASSIVE = 0b111;
const regSignals = () => CPU_REGS.map((name) => ({ name, width: 16, kind: 'data' }));
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
export const CALIBRATED_SIGNALS = Object.freeze([...CLOCK_SIGNALS,
 Object.freeze({ name: 'calibrated', width: 1, kind: 'control', label: L.calibrated })]);
export const STEP_SIGNALS = Object.freeze([{ name: 'step', width: 3, kind: 'data', label: L.step }, ...regSignals()].map(Object.freeze));
export const CLOCK_DEFAULTS = Object.freeze(['T', 'ALE', 'M_IO', 'RD_n', 'WR_n', 'QS', 'queue', 'EU', 'IP']);
export const STEP_DEFAULTS = Object.freeze(['step', 'IP']);
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
const isIo = (k) => k === 'in' || k === 'out' || k === 'inta';
export const usesHigh = (c) => c.size === 16 || Boolean(c.address & 1);
export function pins(rec, { prev = null, next = null, tw = 0, waitStates = 0, hold }) {
 const c = rec?.cycle ?? null;
 const t = rec?.t ?? 'Ti';
 if (c) { hold.mio = isIo(c.kind) ? 0 : 1; hold.dtr = writeLike(c.kind) ? 1 : 0; hold.address = c.address; }
 const inData = t === 'T2' || t === 'T3' || t === 'Tw';
 const rd = Boolean(c) && readLike(c.kind) && inData;
 const wr = Boolean(c) && writeLike(c.kind) && (inData || t === 'T4');
 let S = PASSIVE;
 if (c && (t === 'T1' || t === 'T2' || (t === 'T3' && waitStates > 0) || (t === 'Tw' && tw < waitStates))) S = STATUS_CODE[c.kind];
 else if (next?.t === 'T1' && next.cycle) S = STATUS_CODE[next.cycle.kind];
 return {
 T: T_CODES.indexOf(t),
 cycle: CYCLE_CODES.indexOf(c ? c.kind : 'none'),
 address: hold.address,
 ALE: t === 'T1' ? 1 : 0,
 BHE_n: c && t === 'T1' && usesHigh(c) ? 0 : 1,
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
export function clockExportModel(program, { waitStates = 0, calibrated = false } = {}) {
 const m = calibrated ? new CalibratedClockModel(program) : new ClockModel(program, { waitStates });
 if (calibrated) waitStates = 0;
 const tick = () => {
 const before = m.journal.length;
 const result = m.clock();
 const rec = m.journal.length > before ? m.journal.at(-1).rec : null;
 m.journal.length = 0; m.mm.history.length = 0;
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
export function stepExportModel(program) {
 const m = new MicroModel(program);
 const tick = () => {
 const kind = m.next?.kind ?? null;
 const result = m.step();
 m.history.length = 0;
 return { result, kind, regs: m.registers(), error: m.error };
 };
 return runAhead(tick, (i, at) => {
 const cur = at(i);
 return { step: Math.max(0, STEP_CODES.indexOf(cur?.kind)), ...(cur?.regs ?? m.registers()) };
 });
}
