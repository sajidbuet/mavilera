// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { runMicro } from './microops.js';
import { phys } from './cpu.js';
import { MicroModel, replay } from './micro-model.js';
export const QUEUE_SIZE = 6;
export const FETCH_FREE = 2;
const JOURNAL_KEEP = 1_000_000;
export function busCycles(r) {
 const kind = r.op;
 if (kind === 'inta') return [{ kind, address: 0, size: 8 }, { kind, address: 0, size: 8 }];
 if (kind === 'in' || kind === 'out') {
 const p = r.port & 0xffff;
 if (r.size === 8) return [{ kind, address: p, size: 8 }];
 if (!(p & 1)) return [{ kind, address: p, size: 16 }];
 return [{ kind, address: p, size: 8 }, { kind, address: (p + 1) & 0xffff, size: 8 }];
 }
 if (r.size === 8) return [{ kind, address: r.address, size: 8 }];
 if (!(r.address & 1) && r.address2 === r.address + 1) return [{ kind, address: r.address, size: 16 }];
 return [{ kind, address: r.address, size: 8 }, { kind, address: r.address2, size: 8 }];
}
export class BiuCore {
 constructor({ read, ip, queue = [], waitStates = 0 }) {
 this.read = read;
 this.waitStates = waitStates;
 this.s = {
 clock: 0,
 q: queue.map(({ a, v }) => ({ a, v })),
 fetch: (ip + queue.length) & 0xffff,
 rd: 0,
 cycle: null,
 req: null,
 pos: 0,
 };
 }
 save() { const s = this.s; return { ...s, q: s.q.slice(), req: s.req && { ...s.req } }; }
 load(snap) { this.s = { ...snap, q: snap.q.slice(), req: snap.req && { ...snap.req } }; }
 clock(driver) {
 const s = this.s;
 const rec = { n: s.clock, t: 'Ti', cycle: null, qs: null, eu: 'halt', step: null, performed: false, finished: false };
 const perform = () => { rec.performed = true; rec.eu = 'step'; if (driver.perform()) { rec.finished = true; s.pos = 0; } };
 if (s.cycle) {
 const c = s.cycle;
 let t;
 if (c.t === 'T1') t = 'T2';
 else if (c.t === 'T2') t = 'T3';
 else if (c.w < this.waitStates) t = 'Tw';
 else t = 'T4';
 s.cycle = { ...c, t, w: t === 'Tw' ? c.w + 1 : c.w };
 if (t === 'T4' && c.kind === 'code' && !c.discard) {
 const n = c.size / 8;
 for (let i = 0; i < n; i++) {
 const a = phys(c.cs, c.offset + i);
 s.q.push({ a, v: this.read(a) & 0xff });
 }
 s.fetch = (c.offset + n) & 0xffff;
 }
 }
 const step = driver.step;
 rec.step = step;
 if (step) {
 const fromQ = step.transfers?.find((t) => t.from === 'Q');
 if (fromQ) {
 if (s.q.length) {
 const regs = driver.regs;
 const head = s.q.shift();
 s.rd = (s.rd + 1) % QUEUE_SIZE;
 const want = fromQ.value;
 rec.took = { a: head.a, v: head.v, expected: phys(regs.CS, regs.IP), stale: head.v !== want };
 rec.qs = s.pos <= driver.prefixes ? 'F' : 'S';
 s.pos += 1;
 perform();
 } else rec.eu = 'queue-wait';
 } else if (step.kind === 'bus') {
 if (!s.req) s.req = { cycles: busCycles(step.bus), started: 0, done: 0 };
 rec.eu = 'bus-wait';
 } else if (step.kind === 'jump') {
 perform();
 const r = driver.regs;
 s.q = []; s.rd = 0; s.fetch = r.IP;
 rec.qs = 'E';
 rec.flushTo = { cs: r.CS, ip: r.IP };
 if (s.cycle?.kind === 'code' && s.cycle.t !== 'T4') s.cycle = { ...s.cycle, discard: true };
 } else if (step.kind === 'idle') rec.eu = 'idle';
 else perform();
 }
 const halted = !driver.step && !s.req;
 if (!s.cycle) {
 if (s.req && s.req.started < s.req.cycles.length) {
 s.cycle = { ...s.req.cycles[s.req.started], t: 'T1', w: 0, eu: true };
 s.req.started += 1;
 rec.start = { free: QUEUE_SIZE - s.q.length };
 } else if (!halted && !s.req && s.q.length <= QUEUE_SIZE - FETCH_FREE) {
 const cs = driver.regs.CS;
 const size = s.fetch & 1 ? 8 : 16;
 s.cycle = { kind: 'code', address: phys(cs, s.fetch), size, t: 'T1', w: 0, cs, offset: s.fetch };
 rec.start = { free: QUEUE_SIZE - s.q.length };
 }
 }
 if (s.cycle) {
 const c = s.cycle;
 rec.t = c.t;
 rec.cycle = { kind: c.kind, address: c.address, size: c.size, ...(c.discard ? { discard: true } : {}) };
 if (c.t === 'T4') {
 if (c.kind !== 'code') {
 s.req.done += 1;
 if (s.req.done === s.req.cycles.length) { s.req = null; perform(); }
 }
 s.cycle = null;
 }
 }
 rec.q = s.q.length;
 s.clock += 1;
 return rec;
 }
}
export function instructionDriver(regs, mem, { emptyVector = false } = {}) {
 const read0 = typeof mem === 'function' ? mem : (a) => mem.get(a) ?? 0;
 const overlay = new Map();
 const read = (a) => (overlay.has(a & 0xfffff) ? overlay.get(a & 0xfffff) : read0(a & 0xfffff));
 const c = { ...regs };
 const temps = { IND: 0, OPR: 0, tmpA: 0, tmpB: 0, tmpC: 0, 'Σ': 0 };
 const start = { ...regs, ...temps };
 const res = runMicro(c, { read, peek: read, write: (a, v) => overlay.set(a & 0xfffff, v & 0xff) }, { emptyVector, temps: { ...temps } });
 const steps = res.error ? [] : res.steps;
 const after = res.error ? [] : replay(start, steps);
 let k = 0;
 return {
 res,
 final: c,
 overlay,
 get step() { return steps[k] ?? null; },
 get regs() { return k === 0 ? start : after[k - 1]; },
 get prefixes() { return res.d?.prefixes?.length ?? 0; },
 perform() { k += 1; return k === steps.length; },
 };
}
export function runClocked(core, driver, { limit = 100_000, tail = 0 } = {}) {
 const out = [];
 for (let i = 0; i < limit && driver.step; i++) out.push(core.clock(driver));
 if (tail && out.some((r) => r.qs === 'E')) {
 const e = out.findLastIndex((r) => r.qs === 'E');
 if (!out.slice(e).some((r) => r.start && r.cycle.kind === 'code')) {
 const idle = { step: { kind: 'idle' }, regs: driver.regs, prefixes: 0, perform: () => false };
 for (let i = 0; i < tail; i++) {
 const r = core.clock(idle);
 r.tail = true;
 out.push(r);
 if (r.start && r.cycle.kind === 'code') break;
 }
 }
 }
 return out;
}
export class ClockModel {
 constructor(program, { waitStates = 0 } = {}) {
 this.mm = new MicroModel(program);
 this.waitStates = waitStates;
 const mm = this.mm;
 this.driver = {
 get step() { return mm.next; },
 get regs() { return mm.regs; },
 get prefixes() { return mm.cur.res.d?.prefixes?.length ?? 0; },
 perform() { const n = mm.items; mm.step(); return mm.items !== n; },
 };
 this.reset();
 }
 input(x) { this.mm.input(x); }
 reset() {
 this.mm.reset();
 this.core = new BiuCore({ read: (a) => this.mm.byte(a), ip: this.mm.c.IP, waitStates: this.waitStates });
 this.journal = [];
 this.dropped = 0;
 }
 get halted() { return this.mm.halted; }
 get error() { return this.mm.error; }
 get clocks() { return this.core.s.clock; }
 get last() { return this.journal.at(-1)?.rec ?? null; }
 clock() {
 const mm = this.mm;
 if (mm.halted) return mm.error ? 'error' : 'halt';
 if (!mm.next) { mm.step(); return mm.error ? 'error' : 'halt'; }
 const snap = this.core.save();
 const at = this.instruction();
 const rec = this.core.clock(this.driver);
 this.journal.push({ snap, rec, at });
 if (this.journal.length > JOURNAL_KEEP) { this.journal.splice(0, 1000); this.dropped += 1000; }
 if (mm.halted) return mm.error ? 'error' : 'halt';
 return 'step';
 }
 instruction() {
 const cur = this.mm.cur;
 if (this.atCur !== cur) {
 this.atCur = cur;
 this.at = Object.freeze({ pc: cur.pc, cs: cur.cs, ip: cur.ip, d: cur.res.error ? null : cur.res.d ?? null, entry: cur.entry ?? null });
 }
 return this.at;
 }
 stepInstruction() {
 const n = this.mm.items;
 let r = 'step';
 while (r === 'step' && this.mm.items === n) r = this.clock();
 return r;
 }
 back() {
 const mm = this.mm;
 if (mm.error) { mm.back(); return true; }
 const j = this.journal.pop();
 if (!j) return false;
 if (j.rec.performed) mm.back();
 this.core.load(j.snap);
 return true;
 }
 backInstruction() {
 if (this.mm.error) this.mm.back();
 if (!this.journal.length) return false;
 do this.back(); while (this.journal.length && !this.journal.at(-1).rec.finished);
 return true;
 }
 get atStart() { return !this.mm.halted && this.mm.k === 0 && (!this.journal.length || this.last.finished); }
 peek() {
 const mm = this.mm;
 if (mm.halted || !mm.next) return null;
 const snap = this.core.save();
 const rec = this.core.clock(this.driver);
 if (rec.performed) mm.back();
 this.core.load(snap);
 return rec;
 }
}
