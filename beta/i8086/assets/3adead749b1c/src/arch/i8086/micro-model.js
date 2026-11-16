// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { runMicro } from './microops.js';
import { phys, CPU_REGS } from './cpu.js';
import { hexH } from './isa.js';
import { memoryImage } from './language.js';
import { initialRegisters, CONSOLE_PORT, irqRegisters } from './engine.js';
import { initialInputs, copyInputs, applyInput, tick, arriveAll, boundaryAfter, REP_BOUNDARY, due, repStopper, take,
 loadsSegment } from './interrupts.js';
import { I8086_STRINGS as S } from './strings.js';
const MASK = 0xfffff;
const HISTORY_MAX = 250_000;
export const TEMP_IDS = Object.freeze(['IND', 'OPR', 'tmpA', 'tmpB', 'tmpC', 'Σ']);
const BYTE_REG = { AL: ['AX', 0], CL: ['CX', 0], DL: ['DX', 0], BL: ['BX', 0], AH: ['AX', 8], CH: ['CX', 8], DH: ['DX', 8], BH: ['BX', 8] };
const freshTemps = () => Object.fromEntries(TEMP_IDS.map((k) => [k, 0]));
function put(st, p, v, part = null) {
 if (p === 'decode') return;
 const b = BYTE_REG[p];
 if (b) { st[b[0]] = (st[b[0]] & ~(0xff << b[1])) | ((v & 0xff) << b[1]); return; }
 const cur = st[p];
 let nv = part === 'lo' ? (cur & 0xff00) | (v & 0xff) : part === 'hi' ? (cur & 0x00ff) | ((v & 0xff) << 8)
 : part === 'sx' ? ((v & 0x80 ? 0xff00 : 0) | (v & 0xff)) : v & 0xffff;
 if (p === 'FLAGS') nv = (nv & 0x0fd5) | 0xf002;
 st[p] = nv;
}
export function replay(start, steps) {
 const out = [];
 let st = { ...start };
 for (const s of steps) {
 st = { ...st };
 const mem = [];
 for (const t of s.transfers ?? []) {
 if (t.from === 'Q') st.IP = (st.IP + 1) & 0xffff;
 }
 if (s.alu) st['Σ'] = s.alu.value & 0xffff;
 for (const t of s.transfers ?? []) put(st, t.to, t.value, t.part ?? null);
 if (s.alu?.flags) st.FLAGS = s.alu.FLAGS;
 if (s.count) put(st, s.count.place, s.count.value);
 if (s.kind === 'hardwired' && s.FLAGS !== undefined) st.FLAGS = s.FLAGS;
 if (s.bus) {
 const r = s.bus;
 if (r.op === 'read' || r.op === 'in') st.OPR = r.value;
 else if (r.op === 'write') {
 mem.push([r.address, r.value & 0xff]);
 if (r.size === 16) mem.push([r.address2, (r.value >> 8) & 0xff]);
 }
 }
 out.push({ ...st, mem });
 }
 return out;
}
export class MicroModel {
 constructor(program) {
 this.program = program;
 this.image = memoryImage(program);
 this.reset();
 }
 reset() {
 this.mem = this.image.slice();
 this.c = initialRegisters(this.program);
 this.temps = freshTemps();
 this.history = [];
 this.output = '';
 this.halted = false;
 this.error = null;
 this.retired = 0;
 this.items = 0;
 this.count = 0;
 this.dropped = 0;
 this.irq = initialInputs();
 this.pending = [];
 this.log = [];
 this.prepare();
 }
 prepare() {
 this.k = 0;
 const cc = { ...this.c };
 const tt = { ...this.temps };
 const overlay = new Map();
 const read = (a) => (overlay.has(a & MASK) ? overlay.get(a & MASK) : this.mem[a & MASK]);
 const out = [];
 const bus = { read, peek: read, write: (a, v) => overlay.set(a & MASK, v & 0xff), output: (port, v) => out.push([port, v]) };
 const irq = copyInputs(this.irq);
 const kind = this.halted ? null : due(irq, this.c.FLAGS);
 let res;
 if (kind) res = runMicro(cc, bus, { emptyVector: true, temps: tt, entry: { kind, type: take(irq, kind) } });
 else {
 irq.boundary = null;
 res = runMicro(cc, bus, { emptyVector: true, temps: tt, repStop: repStopper(irq, () => cc.FLAGS) });
 if (!res.error) {
 tick(irq);
 irq.boundary = res.repInterrupted ? { ...REP_BOUNDARY } : boundaryAfter(this.c.FLAGS, res.d.entry.mnem, loadsSegment(res.d));
 }
 }
 const start = { ...this.c, ...this.temps };
 this.cur = { res, start, after: res.error ? [] : replay(start, res.steps), final: { c: cc, temps: tt, overlay, out, irq },
 pc: phys(this.c.CS, this.c.IP), cs: this.c.CS, ip: this.c.IP, entry: res.entry ?? null };
 }
 input(x) {
 const e = { at: this.count, ...x };
 this.log.push(e);
 if (this.k > 0) { this.pending.push(e); return; }
 applyInput(this.irq, x);
 if (this.halted && !this.error) {
 arriveAll(this.irq);
 if (due(this.irq, this.c.FLAGS)) this.halted = false;
 }
 if (!this.halted) this.prepare();
 }
 get steps() { return this.cur.res.steps ?? []; }
 get regs() { return this.k === 0 ? this.cur.start : this.cur.after[this.k - 1]; }
 get next() { return this.halted ? null : this.steps[this.k] ?? null; }
 get last() { return this.k > 0 ? this.steps[this.k - 1] : null; }
 byte(a) {
 for (let j = this.k - 1; j >= 0; j--) {
 const hit = this.cur.after[j].mem.find(([x]) => x === (a & MASK));
 if (hit) return hit[1];
 }
 return this.mem[a & MASK];
 }
 step() {
 if (this.halted) return this.error ? 'error' : 'halt';
 const { res } = this.cur;
 if (res.error) { this.error = errorText(res, this.cur); this.halted = true; return 'error'; }
 this.k += 1;
 this.count += 1;
 if (this.k < this.steps.length) return 'step';
 const { c, temps, overlay, out, irq } = this.cur.final;
 const undo = [];
 for (const [a, v] of overlay) { undo.push([a, this.mem[a]]); this.mem[a] = v; }
 this.history.push({ c: { ...this.c }, temps: { ...this.temps }, undo, outLen: this.output.length, n: this.steps.length,
 irq: copyInputs(this.irq), pending: this.pending.slice(), retires: !this.cur.entry && !res.repInterrupted });
 if (this.history.length > HISTORY_MAX) {
 for (const h of this.history.splice(0, 1000)) this.dropped += h.n;
 }
 for (const [port, v] of out) if (port === CONSOLE_PORT) this.output += String.fromCharCode(v & 0xff);
 this.c = { ...c };
 this.temps = { ...temps };
 if (this.history.at(-1).retires) this.retired += 1;
 this.items += 1;
 this.irq = copyInputs(irq);
 for (const x of this.pending) applyInput(this.irq, x);
 this.pending = [];
 const halt = Boolean(res.halt) && due(this.irq, this.c.FLAGS) === null;
 this.lastResult = res;
 this.prepare();
 if (halt) { this.halted = true; return 'halt'; }
 return 'step';
 }
 stepInstruction() {
 const n = this.items;
 let r = 'step';
 while (r === 'step' && this.items === n) r = this.step();
 return r;
 }
 back() {
 if (this.error) { this.error = null; this.halted = false; return true; }
 if (this.k > 0) { this.k -= 1; this.count -= 1; this.halted = false; this.withdraw(); return true; }
 if (!this.uncommit()) return false;
 this.k = this.steps.length - 1;
 this.count -= 1;
 this.withdraw();
 return true;
 }
 backInstruction() {
 if (this.error) { this.error = null; this.halted = false; }
 if (this.k > 0) { this.count -= this.k; this.k = 0; this.halted = false; this.withdraw(); return true; }
 if (!this.uncommit()) return false;
 this.count -= this.steps.length;
 this.k = 0;
 this.withdraw();
 return true;
 }
 withdraw() {
 this.log = this.log.filter((x) => x.at <= this.count);
 this.pending = this.pending.filter((x) => x.at <= this.count);
 }
 uncommit() {
 const h = this.history.pop();
 if (!h) return false;
 for (let i = h.undo.length - 1; i >= 0; i--) this.mem[h.undo[i][0]] = h.undo[i][1];
 this.c = h.c; this.temps = h.temps;
 this.output = this.output.slice(0, h.outLen);
 if (h.retires) this.retired -= 1;
 this.items -= 1;
 this.irq = copyInputs(h.irq); this.pending = h.pending.slice();
 this.halted = false;
 this.prepare();
 return true;
 }
 registers() {
 const next = this.halted || this.k > 0 ? null : this.cur.entry?.kind ?? null;
 return { ...Object.fromEntries(CPU_REGS.map((k) => [k, this.regs[k]])), ...irqRegisters(this.irq, next, this.halted && !this.error) };
 }
}
function errorText(res, cur) {
 const at = `${hexH(cur.cs, 4)}:${hexH(cur.ip, 4)}`;
 if (res.entry) return S.interrupts.noHandler(res.entry.kind, res.entry.type, at);
 if (res.error === 'noHandler') return res.vector === 0 && res.d.entry?.mnem !== 'INT' ? S.engine.divideNoHandler(at) : S.engine.noHandler(res.vector, at);
 const bytes = (res.d.bytes ?? []).map((b) => hexH(b, 2)).join(' ');
 return S.engine.notRun(S.engine.status[res.error] ?? res.error, bytes, at);
}
