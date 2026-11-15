// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP, OUTPUT_KEEP } from '../contract.js';
import { decode, sext8, programImage, PROGRAM_WORDS, MAX_LANES, MNEMONIC_OF, OPS } from './language.js';
import { GPU_STRINGS as S } from './strings.js';
export const LANE_REGISTERS = 4;
export const laneId = (l, k) => `l${l}r${k}`;
const popcount = (m) => { let n = 0; for (let x = m; x; x &= x - 1) n += 1; return n; };
const WORK = new Set([OPS.LDI, OPS.ADD, OPS.SUB]);
const MASK_OPS = new Set([OPS.IFLT, OPS.ELSE, OPS.ENDIF]);
export function initialState(lanes, din = []) {
 const regs = new Uint32Array(lanes * LANE_REGISTERS);
 for (let l = 0; l < lanes; l++) { regs[l * 4] = l; regs[l * 4 + 1] = (din[l] ?? 0) >>> 0; }
 const full = 2 ** lanes - 1;
 return { lanes, pc: 0, regs, active: full, s0: full, s1: full, depth: 0, cycles: 0, idle: 0, busy: 1, done: 0 };
}
export function stackError(st, op) {
 if ((op === OPS.ELSE || op === OPS.ENDIF) && st.depth === 0) return S.engine.stackEmpty(MNEMONIC_OF[op], st.pc);
 if (op === OPS.IFLT && st.depth === 2) return S.engine.stackFull(st.pc);
 return null;
}
export function execute(st, word) {
 const { op, rd, rs, rt, imm } = decode(word);
 const { lanes, regs } = st;
 const full = 2 ** lanes - 1;
 const writes = [];
 const error = stackError(st, op);
 if (error) return { error };
 if (WORK.has(op)) {
 for (let l = 0; l < lanes; l++) {
 if (!(st.active & (1 << l))) continue;
 const b = l * 4;
 const v = op === OPS.LDI ? sext8(imm) >>> 0 : op === OPS.ADD ? (regs[b + rs] + regs[b + rt]) >>> 0 : (regs[b + rs] - regs[b + rt]) >>> 0;
 writes.push([l, rd, regs[b + rd], v]);
 regs[b + rd] = v;
 }
 st.idle = (st.idle + lanes - popcount(st.active)) & 0xffff;
 } else if (op === OPS.IFLT) {
 let cond = 0;
 for (let l = 0; l < lanes; l++) if ((regs[l * 4 + rs] | 0) < (regs[l * 4 + rt] | 0)) cond |= 1 << l;
 st.s1 = st.s0; st.s0 = st.active; st.active &= cond; st.depth += 1;
 } else if (op === OPS.ELSE) {
 st.active = st.s0 & ~st.active & full;
 } else if (op === OPS.ENDIF) {
 st.active = st.s0; st.s0 = st.s1; st.depth -= 1;
 }
 st.cycles = (st.cycles + 1) & 0xffff;
 if (op === OPS.HALT) { st.busy = 0; st.done = 1; return { op, halt: true, writes }; }
 st.pc = (st.pc + 1) % PROGRAM_WORDS;
 return { op, writes };
}
export const doutOf = (st) => Array.from({ length: st.lanes }, (_, l) => st.regs[l * 4 + 2] | 0);
export class SimtCore {
 constructor({ lanes = 4 } = {}) {
 this.lanes = lanes;
 this.pm = new Uint16Array(PROGRAM_WORDS);
 this.din = Array(lanes).fill(0);
 this.st = { ...initialState(lanes), busy: 0 };
 this.error = null;
 }
 get busy() { return this.st.busy === 1; }
 get done() { return this.st.done === 1; }
 get dout() { return doutOf(this.st); }
 get activeMask() { return this.st.active; }
 get cycles() { return this.st.cycles; }
 get idleSlots() { return this.st.idle; }
 pmWrite(addr, word) {
 if (this.busy) return S.engine.busyWrite;
 this.pm[addr & 15] = word & 0xffff;
 return null;
 }
 setDin(values) { this.din = Array.from({ length: this.lanes }, (_, l) => (values[l] ?? 0) >>> 0); }
 start() {
 if (this.busy) return S.engine.busyStart;
 this.st = initialState(this.lanes, this.din);
 this.error = null;
 return null;
 }
 clock() {
 if (!this.busy || this.error) return;
 const r = execute(this.st, this.pm[this.st.pc]);
 if (r.error) this.error = r.error;
 }
}
function registersOf(st) {
 const r = { pc: st.pc, active_mask: st.active, stack0: st.s0, stack1: st.s1, depth: st.depth, cycles: st.cycles, idle_slots: st.idle,
 busy: st.busy, done: st.done, lanes: st.lanes };
 for (let l = 0; l < MAX_LANES; l++) for (let k = 0; k < LANE_REGISTERS; k++) r[laneId(l, k)] = l < st.lanes ? st.regs[l * 4 + k] : 0;
 return r;
}
const SCALARS = Object.freeze([['active_mask', 'active'], ['stack0', 's0'], ['stack1', 's1'], ['depth', 'depth'], ['cycles', 'cycles'],
 ['idle_slots', 'idle'], ['busy', 'busy'], ['done', 'done']]);
const pack = (s) => (s.pc | (s.active << 4) | (s.s0 << 12) | (s.s1 << 20) | (s.depth << 28) | (s.busy << 30) | (s.done << 31)) >>> 0;
const unpackInto = (s, n) => {
 s.pc = n & 15; s.active = (n >>> 4) & 0xff; s.s0 = (n >>> 12) & 0xff; s.s1 = (n >>> 20) & 0xff; s.depth = (n >>> 28) & 3;
 s.busy = (n >>> 30) & 1; s.done = (n >>> 31) & 1;
};
export function create(program, { historyLimit = 1_000_000, runLimit = 10_000_000 } = {}) {
 const pm = programImage(program);
 const lanes = program.lanes ?? 4;
 const din = program.din ?? [];
 const cap = Math.max(1, historyLimit);
 let st, halted, error, retired, dropped, output, outBase, work, maskOps, busySlots;
 let ringLen, before, olds, outLen, end, size;
 const alloc = (n) => { ringLen = n; before = new Uint32Array(n); olds = new Uint32Array(n * lanes); outLen = new Float64Array(n); };
 const reset = () => {
 st = initialState(lanes, din);
 halted = false; error = null; retired = 0; dropped = 0; output = ''; outBase = 0; work = 0; maskOps = 0; busySlots = 0;
 alloc(Math.min(cap, 1024)); end = 0; size = 0;
 };
 reset();
 const grow = () => {
 const [b, o, ol] = [before, olds, outLen];
 const n0 = ringLen;
 alloc(Math.min(cap, 2 * n0));
 for (let k = 0; k < size; k++) {
 const i = (end - size + k + n0) % n0;
 before[k] = b[i]; outLen[k] = ol[i];
 olds.set(o.subarray(i * lanes, (i + 1) * lanes), k * lanes);
 }
 end = size;
 };
 const remember = (rd) => {
 if (size === ringLen && ringLen < cap) grow();
 before[end] = pack(st);
 for (let l = 0; l < lanes; l++) olds[end * lanes + l] = st.regs[l * 4 + rd];
 outLen[end] = outBase + output.length;
 end = (end + 1) % ringLen;
 if (size < ringLen) size += 1; else dropped += 1;
 };
 const newest = () => (end - 1 + ringLen) % ringLen;
 const recordOf = (a, b, res) => {
 const rec = { pc: a.pc, word: pm[a.pc], size: 2, nextPc: b.pc, registers: [], memory: [] };
 for (const [l, k, old, value] of res.writes) rec.registers.push({ id: laneId(l, k), old, value });
 for (const [id, key] of SCALARS) if (a[key] !== b[key]) rec.registers.push({ id, old: a[key], value: b[key] });
 return rec;
 };
 const recordAt = (s) => {
 const b = { ...s, regs: s.regs.slice() };
 return recordOf(s, b, execute(b, pm[s.pc]));
 };
 const state = () => ({ pc: st.pc, registers: registersOf(st), halted, error, retired, output, outputDropped: outBase,
 historyDropped: dropped, steps: retired });
 const step = () => {
 if (halted) return null;
 const word = pm[st.pc];
 const { op, rd } = decode(word);
 const bad = stackError(st, op);
 if (bad) { error = bad; halted = true; return null; }
 const prev = { ...st };
 remember(rd);
 const res = execute(st, word);
 retired += 1;
 if (WORK.has(op)) { work += 1; busySlots += popcount(prev.active); } else if (MASK_OPS.has(op)) maskOps += 1;
 const rec = recordOf(prev, st, res);
 if (res.halt) {
 halted = true;
 const out = S.engine.halted(st.cycles, st.idle, doutOf(st));
 output += out;
 if (output.length > 2 * OUTPUT_KEEP) { const drop = output.length - OUTPUT_KEEP; output = output.slice(drop); outBase += drop; }
 return { ...rec, halt: true, output: out };
 }
 return rec;
 };
 const stateBefore = (i) => {
 const s = { ...st, regs: st.regs.slice() };
 unpackInto(s, before[i]);
 const { op, rd } = decode(pm[s.pc]);
 if (WORK.has(op)) {
 for (let l = 0; l < lanes; l++) if (s.active & (1 << l)) s.regs[l * 4 + rd] = olds[i * lanes + l];
 s.idle = (s.idle - (lanes - popcount(s.active)) + 0x10000) & 0xffff;
 }
 s.cycles = (s.cycles - 1 + 0x10000) & 0xffff;
 return s;
 };
 const back = () => {
 if (error) { error = null; halted = false; return true; }
 if (!size) return false;
 const i = newest();
 st = stateBefore(i);
 const { op } = decode(pm[st.pc]);
 if (WORK.has(op)) { work -= 1; busySlots -= popcount(st.active); } else if (MASK_OPS.has(op)) maskOps -= 1;
 if (outLen[i] >= outBase) output = output.slice(0, outLen[i] - outBase);
 else { output = ''; outBase = outLen[i]; }
 end = i;
 size -= 1;
 halted = false;
 retired -= 1;
 return true;
 };
 const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, resumed = false, watch = {} } = {}) => {
 const wr = watch.registers ?? new Set();
 for (let i = 0; i < chunk; i++) {
 if (halted) return error ? STOP.ERROR : STOP.HALT;
 if (retired >= runLimit) return STOP.BUDGET;
 if (i > 0 || resumed) {
 if (breakpoints.has(st.pc)) return STOP.BREAK;
 if (st.pc === target) return STOP.TARGET;
 }
 const rec = step();
 if (!rec) return STOP.ERROR;
 if (rec.halt) return STOP.HALT;
 if (wr.size && rec.registers.some((r) => wr.has(r.id))) return STOP.WATCH;
 }
 return STOP.CHUNK;
 };
 const last = () => (size ? recordAt(stateBefore(newest())) : null);
 const ordered = () => {
 const b = new Uint32Array(size); const o = new Uint32Array(size * lanes); const ol = new Float64Array(size);
 for (let k = 0; k < size; k++) {
 const i = (end - size + k + ringLen) % ringLen;
 b[k] = before[i]; ol[k] = outLen[i]; o.set(olds.subarray(i * lanes, (i + 1) * lanes), k * lanes);
 }
 return { b, o, ol };
 };
 return {
 reset, step, back, run, state, last,
 peek: (address, length) => {
 const out = new Uint8Array(length);
 for (let i = 0; i < length; i++) { const w = pm[(address + (i >> 1)) % PROGRAM_WORDS]; out[i] = i & 1 ? w >>> 8 : w & 0xff; }
 return out;
 },
 loopRange: () => {
 if (!size) return null;
 const pcs = Array.from({ length: Math.min(64, size) }, (_, k) => before[(end - 1 - k + ringLen) % ringLen] & 15);
 return { from: Math.min(...pcs), to: Math.max(...pcs) };
 },
 counters: () => {
 const C = S.counterNames;
 return [[C.instructions, retired], [C.work, work], [C.maskOps, maskOps], [C.busy, busySlots], [C.idle, lanes * work - busySlots],
 [C.utilisation, C.percent(busySlots, lanes * work)]];
 },
 dataAccess: () => null,
 snapshot: () => {
 const { b, o, ol } = ordered();
 return { st: { ...st, regs: st.regs.slice() }, halted, error, retired, dropped, output, outBase, work, maskOps, busySlots, b, o, ol };
 },
 restore: (s) => {
 st = { ...s.st, regs: Uint32Array.from(s.st.regs) };
 ({ halted, error, retired, dropped, output, work, maskOps, busySlots } = s);
 outBase = s.outBase ?? 0;
 size = s.b.length;
 alloc(Math.min(cap, Math.max(1024, size)));
 before.set(s.b); olds.set(s.o); outLen.set(s.ol);
 end = size % ringLen;
 },
 };
}
