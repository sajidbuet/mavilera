// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { phys } from './cpu.js';
import { busCycles, QUEUE_SIZE, ClockModel } from './biu-model.js';
export const FETCH_LIMIT = QUEUE_SIZE - 2;
export const SETUP = 2;
export const RULES = Object.freeze({ hold: true, preempt: 't0' });
const takesQueue = (step) => Boolean(step?.transfers?.some((t) => t.from === 'Q'));
export const EU_TIMING = Object.freeze({
 nop: { ops: ['q', 'c', 'c'], sources: 'Table 2-21 NOP = 3 (p. 2-62, PDF 85); [TEST] 90' },
 movRR: { ops: ['q', 'q'], sources: 'Table 2-21 MOV register,register = 2 (p. 2-61, PDF 84); [TEST] 8B mod 3' },
 addAccImm: { ops: ['q', 'c', 'q', 'q'], sources: 'Table 2-21 ADD accumulator,immediate = 4 (p. 2-52, PDF 75); [TEST] 05' },
 pushReg: { ops: ['q', 'c', 'c', 'c', 'c', 'r', 'w'], sources: 'Table 2-21 PUSH register = 11 (p. 2-63, PDF 86; D13: 10 on an idle bus); [TEST] 50' },
 movRM: { ops: null, sources: 'Table 2-21 MOV register,memory = 8+EA (p. 2-61, PDF 84); Table 2-20 (p. 2-51, PDF 74); [TEST] 8B' },
 jmpShort: { ops: ['q', 'c', 'q', 'c', 'K', 'c', 'c', 'c', 'E'], sources: 'Table 2-21 JMP short-label = 15 (p. 2-58, PDF 81); [TEST] EB' },
 jccShort: { ops: ['q', 'c', 'q', 'x', 'c', 'K', 'c', 'c', 'c', 'E'], sources: 'Table 2-21 JE/JZ short-label = 16 or 4 (p. 2-57, PDF 80); [TEST] 74' },
 callNear: { ops: ['q', 'c', 'q', 'q', 'K', 'c', 'c', 'c', 'E', 'c', 'c', 'r', 'w'], sources: 'Table 2-21 CALL near-proc = 19 (p. 2-52, PDF 75; D14: 17 on an idle bus); [TEST] E8' },
 shlRegCL: { ops: null, sources: 'Table 2-21 SAL/SHL register,CL = 8+4/bit (p. 2-65, PDF 88); [TEST] D3.4' },
 shlMemCL: { ops: null, sources: 'Table 2-21 SAL/SHL memory,CL = 20+EA+4/bit (p. 2-65, PDF 88); [TEST] D3.4' },
 movRegImm: { ops: ['q', 'c', 'q', 'q'], sources: 'Table 2-21 MOV register,immediate = 4 (p. 2-61, PDF 84); [TEST] B8' },
 addRR: { ops: ['q', 'q', 'c'], sources: 'Table 2-21 ADD register,register = 3 (p. 2-52, PDF 75); [TEST] 03 mod 3' },
 addRM: { ops: null, sources: 'Table 2-21 ADD register,memory = 9+EA (p. 2-52, PDF 75); [TEST] 03' },
 addRegImm: { ops: ['q', 'q', 'q', 'q'], sources: 'Table 2-21 ADD register,immediate = 4 (p. 2-52, PDF 75); [TEST] 81.0 mod 3' },
 addMemImm: { ops: null, sources: 'Table 2-21 ADD memory,immediate = 17+EA (p. 2-52, PDF 75); [TEST] 81.0' },
});
export function eaClocks(mod, rm) {
 if (mod === 0 && rm === 6) return 6;
 const pair = rm < 4 ? ([0, 3].includes(rm) ? 7 : 8) : 5;
 if (mod === 0) return pair;
 return rm < 4 ? pair + 4 : 9;
}
function toRequest(mod, rm) {
 const ea = eaClocks(mod, rm);
 const n = mod === 1 ? 1 : mod === 2 || (mod === 0 && rm === 6) ? 2 : 0;
 const at = mod === 0 && rm === 6 ? ea - 3 : ea - 4;
 const ops = ['q', 'q'];
 while (ops.length < (n ? at : ea)) ops.push('c');
 for (let k = 0; k < n; k++) ops.push('q');
 while (ops.length < ea) ops.push('c');
 ops.push('r');
 return ops;
}
const SEG = new Set([0x26, 0x2e, 0x36, 0x3e]);
export function timingOf(d, regs = null) {
 if (!d || d.error || !d.bytes) return null;
 const pre = d.prefixes ?? [];
 if (pre.some((p) => !SEG.has(p))) return null;
 const k = pre.length;
 const op = d.bytes[k];
 let row = null;
 const mod = d.bytes[k + 1] >> 6; const rm = d.bytes[k + 1] & 7;
 if (op === 0x90) row = EU_TIMING.nop;
 else if (op === 0x8b && mod === 3) row = EU_TIMING.movRR;
 else if (op === 0x8b) return { ops: [...pre.flatMap(() => ['q', 'c']), ...toRequest(mod, rm), 'W', 'c', 'c'], row: EU_TIMING.movRM };
 else if (op === 0x03 && mod === 3) row = EU_TIMING.addRR;
 else if (op === 0x03) return { ops: [...pre.flatMap(() => ['q', 'c']), ...toRequest(mod, rm), 'W', 'c', 'c', 'c'], row: EU_TIMING.addRM };
 else if (op === 0x81 && ((d.bytes[k + 1] >> 3) & 7) === 0) {
 if (mod === 3) row = EU_TIMING.addRegImm;
 else return { ops: [...pre.flatMap(() => ['q', 'c']), ...toRequest(mod, rm), 'W', 'c', 'c', 'q', 'q', 'c', 'c', 'r', 'w'], row: EU_TIMING.addMemImm };
 } else if (op === 0xb8) row = EU_TIMING.movRegImm;
 else if (op === 0xd3 && ((d.bytes[k + 1] >> 3) & 7) === 4) {
 const bits = 4 * ((regs?.CX ?? 0) & 0xff);
 const c = (n) => Array(n).fill('c');
 const ops = mod === 3 ? ['q', 'q', ...c(6 + bits)] : [...toRequest(mod, rm), 'W', ...c(9 + bits), 'r', 'w'];
 return { ops: [...pre.flatMap(() => ['q', 'c']), ...ops], row: mod === 3 ? EU_TIMING.shlRegCL : EU_TIMING.shlMemCL };
 }
 else if (op === 0x05) row = EU_TIMING.addAccImm;
 else if (op >= 0x50 && op <= 0x57) row = EU_TIMING.pushReg;
 else if (op === 0xeb) row = EU_TIMING.jmpShort;
 else if (op === 0x74) row = EU_TIMING.jccShort;
 else if (op === 0xe8) row = EU_TIMING.callNear;
 if (!row) return null;
 return { ops: [...pre.flatMap(() => ['q', 'c']), ...row.ops], row };
}
export class CalibratedCore {
 constructor({ read, ip, queue = [], waitStates = 0, rules = {}, uncalibratedWaits = false }) {
 if (waitStates && !uncalibratedWaits) throw new Error('calibrated timing runs without wait states (B7-Q7)');
 this.waitStates = waitStates;
 this.read = read;
 this.rules = { ...RULES, ...rules };
 this.s = {
 codeT4: null,
 suspended: false,
 jumpLater: false,
 clock: 0,
 q: queue.map(({ a, v }) => ({ a, v })),
 arriving: null,
 fetch: (ip + queue.length) & 0xffff,
 rd: 0,
 cycle: null,
 next: null,
 req: null,
 pos: 0,
 ops: undefined,
 i: 0,
 calibrated: false,
 };
 }
 save() { const s = this.s; return { ...s, q: s.q.slice(), req: s.req && { ...s.req }, ops: s.ops && s.ops.slice() }; }
 load(snap) { this.s = { ...snap, q: snap.q.slice(), req: snap.req && { ...snap.req }, ops: snap.ops && snap.ops.slice() }; }
 occupancy() {
 const s = this.s;
 let n = s.q.length;
 if (s.cycle?.kind === 'code' && !s.cycle.discard) n += s.cycle.size / 8;
 if (s.next?.cycle.kind === 'code') n += s.next.cycle.size / 8;
 return n;
 }
 clock(driver) {
 const s = this.s;
 const rec = { n: s.clock, t: 'Ti', cycle: null, qs: null, eu: 'halt', step: null, performed: false, finished: false };
 if (s.arriving) { s.q.push(...s.arriving); s.arriving = null; }
 if (s.cycle) {
 const c = s.cycle;
 const t = c.t === 'T3' || c.t === 'Tw' ? (c.wait ? 'Tw' : 'T4') : { T1: 'T2', T2: 'T3' }[c.t];
 s.cycle = t ? { ...c, t, wait: t === 'Tw' ? c.wait - 1 : c.wait } : null;
 }
 if (!s.cycle && s.next && s.next.at === s.clock) {
 s.cycle = { ...s.next.cycle, t: 'T1', wait: this.waitStates };
 rec.start = { free: QUEUE_SIZE - s.q.length };
 s.next = null;
 }
 const free = !s.cycle || ((s.cycle.t === 'T3' || s.cycle.t === 'Tw') && !s.cycle.wait);
 if (!s.next && free) {
 if (s.req && s.req.started < s.req.cycles.length && s.clock >= (s.req.earliest ?? 0)) {
 const last = s.req.started + 1 === s.req.cycles.length;
 s.next = { cycle: { ...s.req.cycles[s.req.started], eu: true, last }, at: s.clock + SETUP };
 s.req.started += 1;
 } else if ((!s.req || s.req.started === s.req.cycles.length) && driver.step && this.occupancy() <= FETCH_LIMIT
 && !s.suspended && !(this.rules.hold && s.codeT4 === s.clock - 1)) {
 const cs = driver.regs.CS;
 const size = s.fetch & 1 ? 8 : 16;
 s.next = { cycle: { kind: 'code', address: phys(cs, s.fetch), size, cs, offset: s.fetch }, at: s.clock + SETUP };
 s.fetch = (s.fetch + size / 8) & 0xffff;
 }
 }
 this.eu(driver, rec);
 if (s.cycle) {
 const c = s.cycle;
 rec.t = c.t;
 rec.cycle = { kind: c.kind, address: c.address, size: c.size, ...(c.discard ? { discard: true } : {}) };
 if (c.t === 'T4') {
 if (c.kind === 'code' || this.rules.hold === 'any') s.codeT4 = s.clock;
 if (c.kind === 'code' && !c.discard) {
 s.arriving = [];
 for (let k = 0; k < c.size / 8; k++) { const a = phys(c.cs, c.offset + k); s.arriving.push({ a, v: this.read(a) & 0xff }); }
 }
 if (c.eu) {
 s.req.done += 1;
 if (s.req.done === s.req.cycles.length) {
 const auto = !s.req.calibrated;
 s.req = null;
 if (auto) this.perform(driver, rec);
 }
 }
 }
 }
 rec.q = s.q.length;
 rec.calibrated = s.calibrated;
 s.clock += 1;
 return rec;
 }
 perform(driver, rec) {
 rec.performed = true;
 rec.steps = (rec.steps ?? 0) + 1;
 rec.eu = 'step';
 if (driver.perform()) { rec.finished = true; this.s.pos = 0; this.s.ops = undefined; this.s.i = 0; this.s.jumpLater = false; }
 }
 take(driver, rec) {
 const s = this.s;
 const regs = driver.regs;
 const head = s.q.shift();
 s.rd = (s.rd + 1) % QUEUE_SIZE;
 const want = driver.step.transfers.find((t) => t.from === 'Q').value;
 rec.took = { a: head.a, v: head.v, expected: phys(regs.CS, regs.IP), stale: want !== null && want !== undefined && head.v !== want };
 rec.qs = s.pos <= driver.prefixes ? 'F' : 'S';
 s.pos += 1;
 this.perform(driver, rec);
 }
 eu(driver, rec) {
 const s = this.s;
 const step = driver.step;
 rec.step = step;
 if (!step) return;
 if (step.kind === 'idle') { rec.eu = 'idle'; return; }
 if (s.ops === undefined) {
 const t = timingOf(driver.decoded ?? driver.res?.d ?? null, driver.regs);
 s.ops = t ? t.ops.slice() : null;
 s.i = 0;
 s.calibrated = Boolean(t);
 }
 if (!s.ops) return this.teaching(driver, rec);
 const op = s.ops[s.i];
 const last = s.i === s.ops.length - 1;
 const catchUp = (all = false) => {
 const due = (k) => k !== 'bus' && (k !== 'jump' || (all && s.jumpLater)) && (all || k !== 'end');
 while (!rec.finished && driver.step && !takesQueue(driver.step) && due(driver.step.kind)) this.perform(driver, rec);
 };
 const internal = () => {
 if (step && !takesQueue(step) && !['bus', 'jump', 'end'].includes(step.kind) && !last) this.perform(driver, rec);
 else rec.eu = 'busy';
 };
 if (op === 'q') {
 catchUp();
 if (!s.q.length) { rec.eu = 'queue-wait'; return; }
 if (!takesQueue(driver.step)) throw new Error(`calibrated row: a queue clock where the teaching model has ${driver.step?.kind}`);
 this.take(driver, rec);
 } else if (op === 'r') {
 catchUp();
 if (driver.step?.kind !== 'bus') throw new Error(`calibrated row: a request where the teaching model has ${driver.step?.kind}`);
 s.req = { cycles: busCycles(driver.step.bus), started: 0, done: 0, calibrated: true };
 if (s.next?.cycle.kind === 'code' && this.rules.preempt) {
 s.fetch = s.next.cycle.offset;
 s.req.earliest = this.rules.preempt === 't0' ? s.next.at : s.clock + SETUP;
 s.next = null;
 rec.abandoned = true;
 }
 rec.eu = 'bus-wait';
 } else if (op === 'w' || op === 'W') {
 const c = s.cycle;
 const at = op === 'w' ? c?.t === 'T2' : (c?.t === 'T3' || c?.t === 'Tw') && !c.wait;
 if (!(c?.eu && c.last && at)) { rec.eu = 'bus-wait'; return; }
 this.perform(driver, rec);
 } else if (op === 'K') {
 if (!s.suspended) {
 s.suspended = true;
 if (s.next?.cycle.kind === 'code') { s.fetch = s.next.cycle.offset; s.next = null; rec.abandoned = true; }
 }
 if (s.cycle && s.cycle.t !== 'T4') { rec.eu = 'bus-wait'; return; }
 internal();
 } else if (op === 'E') {
 catchUp();
 let to;
 if (driver.step?.kind === 'jump') { this.perform(driver, rec); to = driver.regs; } else { to = driver.final; s.jumpLater = true; }
 s.q = []; s.arriving = null; s.rd = 0; s.fetch = to.IP; s.suspended = false;
 if (s.next?.cycle.kind === 'code') s.next = null;
 if (s.cycle?.kind === 'code' && s.cycle.t !== 'T4') s.cycle = { ...s.cycle, discard: true };
 rec.qs = 'E';
 rec.flushTo = { cs: to.CS, ip: to.IP };
 } else if (op === 'x') {
 internal();
 if (driver.step?.kind === 'end') catchUp(true);
 } else internal();
 s.i += 1;
 if (last && !rec.finished) {
 catchUp(true);
 if (!rec.finished) throw new Error('calibrated row ended before the teaching model\'s steps');
 }
 }
 teaching(driver, rec) {
 const s = this.s;
 const step = driver.step;
 if (takesQueue(step)) {
 if (s.q.length) this.take(driver, rec); else rec.eu = 'queue-wait';
 } else if (step.kind === 'bus') {
 if (!s.req) s.req = { cycles: busCycles(step.bus), started: 0, done: 0 };
 rec.eu = 'bus-wait';
 } else if (step.kind === 'jump') {
 this.perform(driver, rec);
 const r = driver.regs;
 s.q = []; s.arriving = null; s.rd = 0; s.fetch = r.IP;
 if (s.next?.cycle.kind === 'code') s.next = null;
 if (s.cycle?.kind === 'code' && s.cycle.t !== 'T4') s.cycle = { ...s.cycle, discard: true };
 rec.qs = 'E';
 rec.flushTo = { cs: r.CS, ip: r.IP };
 } else this.perform(driver, rec);
 }
}
export class CalibratedClockModel extends ClockModel {
 constructor(program, { rules = {}, testWaitStates = 0 } = {}) {
 super(program, { waitStates: 0 });
 this.rules = rules;
 this.testWaitStates = testWaitStates;
 const mm = this.mm;
 this.driver = {
 get step() { return mm.next; },
 get regs() { return mm.regs; },
 get prefixes() { return mm.cur.res.d?.prefixes?.length ?? 0; },
 get decoded() { return mm.cur.res.error ? null : mm.cur.res.d ?? null; },
 get final() { return mm.cur.final.c; },
 perform() { const n = mm.items; mm.step(); return mm.items !== n; },
 };
 this.reset();
 }
 reset() {
 this.mm.reset();
 this.core = new CalibratedCore({ read: (a) => this.mm.byte(a), ip: this.mm.c.IP, rules: this.rules ?? {},
 waitStates: this.testWaitStates ?? 0, uncalibratedWaits: Boolean(this.testWaitStates) });
 this.journal = [];
 this.dropped = 0;
 }
 back() {
 const mm = this.mm;
 if (mm.error) { mm.back(); return true; }
 const j = this.journal.pop();
 if (!j) return false;
 for (let i = 0; i < (j.rec.steps ?? 0); i++) mm.back();
 this.core.load(j.snap);
 return true;
 }
 peek() {
 const mm = this.mm;
 if (mm.halted || !mm.next) return null;
 const snap = this.core.save();
 const rec = this.core.clock(this.driver);
 for (let i = 0; i < (rec.steps ?? 0); i++) mm.back();
 this.core.load(snap);
 return rec;
 }
}
