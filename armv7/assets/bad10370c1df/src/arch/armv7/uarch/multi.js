// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { decode, STACK_TOP, HALT_WORD, withinTier } from '../language.js';
import { Memory, passed } from '../engine.js';
import { aluDecode, alu, extend } from './single.js';
import { ARMV7_STRINGS as S } from '../strings.js';
export const STATES = Object.freeze(['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB', 'MemWrite', 'ExecuteR', 'ExecuteI', 'ALUWB', 'Branch']);
export const STATE_CODE = Object.freeze(Object.fromEntries(STATES.map((s, i) => [s, i])));
export const FSM_OUTPUTS = Object.freeze(['NextPC', 'Branch', 'MemW', 'RegW', 'IRWrite', 'AdrSrc', 'ResultSrc', 'ALUSrcA', 'ALUSrcB', 'ALUOp']);
const row = (state, o) => ({ state, NextPC: 0, Branch: 0, MemW: 0, RegW: 0, IRWrite: 0, AdrSrc: null, ResultSrc: null, ALUSrcA: null, ALUSrcB: null, ALUOp: 0, ...o });
export const STATE_OUTPUTS = Object.freeze([
 row('Fetch', { AdrSrc: 0, ALUSrcA: 1, ALUSrcB: 0b10, ResultSrc: 0b10, IRWrite: 1, NextPC: 1 }),
 row('Decode', { ALUSrcA: 1, ALUSrcB: 0b10, ResultSrc: 0b10 }),
 row('MemAdr', { ALUSrcA: 0, ALUSrcB: 0b01 }),
 row('MemRead', { ResultSrc: 0b00, AdrSrc: 1 }),
 row('MemWB', { ResultSrc: 0b01, RegW: 1 }),
 row('MemWrite', { ResultSrc: 0b00, AdrSrc: 1, MemW: 1 }),
 row('ExecuteR', { ALUSrcA: 0, ALUSrcB: 0b00, ALUOp: 1 }),
 row('ExecuteI', { ALUSrcA: 0, ALUSrcB: 0b01, ALUOp: 1 }),
 row('ALUWB', { ResultSrc: 0b00, RegW: 1 }),
 row('Branch', { ALUSrcA: 0, ALUSrcB: 0b01, ResultSrc: 0b10, Branch: 1 }),
].map(Object.freeze));
export function nextState(state, Op, Funct) {
 switch (state) {
 case 'Fetch': return 'Decode';
 case 'Decode':
 if (Op === 0b01) return 'MemAdr';
 if (Op === 0b00) return (Funct >>> 5) & 1 ? 'ExecuteI' : 'ExecuteR';
 if (Op === 0b10) return 'Branch';
 return null;
 case 'MemAdr': return Funct & 1 ? 'MemRead' : 'MemWrite';
 case 'MemRead': return 'MemWB';
 case 'ExecuteR': case 'ExecuteI': return 'ALUWB';
 default: return 'Fetch';
 }
}
export function instrDecode(Op) {
 return { RegSrc: ((Op === 0b01 ? 1 : 0) << 1) | (Op === 0b10 ? 1 : 0), ImmSrc: Op & 3 };
}
const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;
export class ArmMulti {
 constructor({ historyLimit = 100_000 } = {}) {
 this.historyLimit = historyLimit;
 this.load({ segments: [] });
 }
 load(program) {
 this.program = program;
 this.code = (program.segments ?? []).filter((s) => s.executable).map((s) => [s.address, s.address + s.bytes.length]);
 this.reset();
 }
 reset() {
 this.mem = new Memory();
 for (const s of this.program.segments ?? []) for (let i = 0; i < s.bytes.length; i++) if (s.bytes[i]) this.mem.write8(s.address + i, s.bytes[i]);
 this.R = new Uint32Array(15);
 this.R[13] = STACK_TOP;
 this.F = { N: 0, Z: 0, C: 0, V: 0 };
 this.pc = (this.program.entry ?? 0) >>> 0;
 Object.assign(this, { IR: 0, Data: 0, A: 0, WD: 0, ALUOut: 0, CondExDelayed: 0 });
 this.state = 'Fetch';
 this.at = this.pc;
 this.cycle = 0;
 this.retired = 0;
 this.halted = false;
 this.error = null;
 this.history = [];
 this.dropped = 0;
 this.cache = null;
 }
 inCode(a) { return this.code.some(([lo, hi]) => a >= lo && a + 4 <= hi); }
 get instrAddress() { return this.state === 'Fetch' ? this.pc : this.at; }
 evaluate() {
 if (this.cache) return this.cache;
 const s = {};
 const st = STATE_CODE[this.state];
 const out = STATE_OUTPUTS[st];
 s.state = st;
 for (const k of FSM_OUTPUTS) s[k] = out[k] ?? 0;
 const w = this.IR;
 s.Instr = w;
 s.Cond = w >>> 28;
 s.Op = (w >>> 26) & 3;
 s.Funct = (w >>> 20) & 63;
 s.Rn = (w >>> 16) & 15;
 s.Rd = (w >>> 12) & 15;
 s.Rm = w & 15;
 s.Imm24 = w & 0xffffff;
 const id = instrDecode(s.Op);
 s.RegSrc = id.RegSrc;
 s.ImmSrc = id.ImmSrc;
 const a = aluDecode(s.ALUOp, s.Funct);
 s.ALUControl = a.ALUControl;
 s.FlagW = a.FlagW;
 s.PCS = ((s.Rd === 15 && s.RegW) || s.Branch) ? 1 : 0;
 s.PC = this.pc;
 s.A = this.A;
 s.WriteData = this.WD;
 s.ALUOut = this.ALUOut;
 s.Data = this.Data;
 s.Flags = flagsOf(this.F);
 s.CondExDelayed = this.CondExDelayed;
 s.ExtImm = extend(s.Imm24, s.ImmSrc);
 s.SrcA = s.ALUSrcA ? this.pc : this.A;
 s.SrcB = [this.WD, s.ExtImm, 4, 0][s.ALUSrcB];
 [s.ALUResult, s.ALUFlags] = alu(s.SrcA, s.SrcB, s.ALUControl);
 s.Result = [this.ALUOut, this.Data, s.ALUResult, 0][s.ResultSrc];
 s.RA1 = s.RegSrc & 1 ? 15 : s.Rn;
 s.RA2 = s.RegSrc & 2 ? s.Rd : s.Rm;
 const read = (n) => (n === 15 ? s.Result : this.R[n]);
 s.RD1 = read(s.RA1);
 s.RD2 = read(s.RA2);
 s.Adr = s.AdrSrc ? this.ALUOut : this.pc;
 s.ReadData = this.mem.read((s.Adr & ~3) >>> 0, 4);
 s.CondEx = passed(s.Cond, this.F) ? 1 : 0;
 s.FlagWrite = s.CondEx ? s.FlagW : 0;
 s.PCSGated = s.PCS & s.CondExDelayed;
 s.PCWrite = s.PCSGated | s.NextPC;
 s.RegWrite = s.RegW & s.CondExDelayed;
 s.MemWrite = s.MemW & s.CondExDelayed;
 const next = nextState(this.state, s.Op, s.Funct);
 s.next = next === null ? st : STATE_CODE[next];
 const d = decode(this.state === 'Fetch' ? s.ReadData : w);
 this.cache = {
 signals: s, state: this.state, next, d,
 rows: { state: st, alu: s.ALUOp ? a.index : 0 },
 cls: this.state === 'Fetch' ? null : classOf(s.Op, s.Funct),
 halt: this.state === 'Branch' && w === HALT_WORD,
 access: this.state === 'MemRead' ? { kind: 'load', size: 4 } : this.state === 'MemWrite' ? { kind: 'store', size: 4 } : null,
 tier: 'H',
 };
 return this.cache;
 }
 step() {
 if (this.halted) return 'halt';
 if (this.error) return 'error';
 const c = this.evaluate();
 const s = c.signals;
 const at = this.instrAddress;
 const fail = (msg) => { this.error = msg; return 'error'; };
 if (c.state === 'Fetch' && !this.inCode(s.PC)) return fail(S.engine.noCode(s.PC));
 if (c.state === 'Decode') {
 const d = c.d;
 if (d.bad) return fail(S.engine.notRun(s.Instr, at, S.outOfScope[d.bad]));
 if (d.unpredictable) return fail(S.engine.unpredictable(s.Instr, at, S.unpredictable[d.unpredictable]));
 if (!withinTier(d.tier, c.tier)) return fail(c.tier === 'H' ? S.multi.notBase(s.Instr, at, d.name, d.tier) : S.multi.notExtended(s.Instr, at, d.name));
 }
 if (c.access?.size === 4 && s.CondExDelayed && (s.Adr & 3)) return fail(S.engine.unaligned(c.access.kind, s.Adr, at));
 if (s.PCWrite && !s.NextPC && !s.Branch) {
 if (s.Result & 1) return fail(S.engine.thumb(s.Result, at));
 if (s.Result & 2) return fail(S.engine.pcHalf(s.Result, at));
 }
 const done = c.next === 'Fetch';
 const rec = { state: this.state, pc: this.pc, IR: this.IR, Data: this.Data, A: this.A, WD: this.WD, ALUOut: this.ALUOut,
 CondExDelayed: this.CondExDelayed, flags: s.Flags, at: this.at, reg: null, mem: null, done };
 const wa3 = c.wa3 ?? s.Rd;
 if (s.RegWrite && wa3 !== 15) {
 rec.reg = [wa3, this.R[wa3]];
 this.R[wa3] = s.Result;
 }
 if (s.MemWrite) {
 rec.mem = [s.Adr, this.mem.read(s.Adr, 4)];
 this.mem.write(s.Adr, 4, this.WD);
 }
 if (s.FlagWrite & 2) { this.F.N = (s.ALUFlags >>> 3) & 1; this.F.Z = (s.ALUFlags >>> 2) & 1; }
 if (s.FlagWrite & 1) { this.F.C = (s.ALUFlags >>> 1) & 1; this.F.V = s.ALUFlags & 1; }
 if (s.IRWrite) { this.IR = s.ReadData; this.at = this.pc; }
 this.Data = s.DataIn ?? s.ReadData;
 this.A = s.RD1;
 this.WD = s.RD2;
 this.ALUOut = s.ALUResult;
 this.CondExDelayed = s.CondEx;
 if (s.PCWrite) this.pc = s.Result;
 this.state = c.next;
 this.cycle += 1;
 if (done) this.retired += 1;
 this.remember(rec);
 this.cache = null;
 if (c.halt && s.CondExDelayed) { this.halted = true; return 'halt'; }
 return 'step';
 }
 remember(rec) {
 this.history.push(rec);
 if (this.history.length > this.historyLimit) {
 this.history.splice(0, this.history.length - this.historyLimit);
 this.dropped += 1;
 }
 }
 back() {
 if (this.error) { this.error = null; this.cache = null; return true; }
 const r = this.history.pop();
 if (!r) return false;
 if (r.mem) this.mem.write(r.mem[0], 4, r.mem[1]);
 if (r.reg) this.R[r.reg[0]] = r.reg[1];
 this.F = { N: (r.flags >>> 3) & 1, Z: (r.flags >>> 2) & 1, C: (r.flags >>> 1) & 1, V: r.flags & 1 };
 Object.assign(this, { state: r.state, pc: r.pc, IR: r.IR, Data: r.Data, A: r.A, WD: r.WD, ALUOut: r.ALUOut, CondExDelayed: r.CondExDelayed, at: r.at });
 this.cycle -= 1;
 if (r.done) this.retired -= 1;
 this.halted = false;
 this.cache = null;
 return true;
 }
 stepInstruction() {
 let r;
 do r = this.step(); while (r === 'step' && this.state !== 'Fetch');
 return r;
 }
 backInstruction() {
 if (!this.back()) return false;
 while (this.state !== 'Fetch' && this.back());
 return true;
 }
 get last() {
 return this.history.length ? this.history[this.history.length - 1] : null;
 }
 run(limit = 1_000_000) {
 for (;;) {
 if (this.cycle >= limit) throw new Error(`no halt within ${limit} cycles`);
 const r = this.step();
 if (r !== 'step') return r;
 }
 }
 registers() {
 return { ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i}`, i === 15 ? this.pc : this.R[i]])), ...this.F };
 }
}
export function classOf(Op, Funct) {
 if (Op === 0b00) return (Funct >>> 5) & 1 ? 'dpImm' : 'dpReg';
 if (Op === 0b01) return Funct & 1 ? 'ldr' : 'str';
 if (Op === 0b10) return 'b';
 return null;
}
export const SEQUENCES = Object.freeze({
 b: ['Fetch', 'Decode', 'Branch'],
 dpReg: ['Fetch', 'Decode', 'ExecuteR', 'ALUWB'],
 dpImm: ['Fetch', 'Decode', 'ExecuteI', 'ALUWB'],
 str: ['Fetch', 'Decode', 'MemAdr', 'MemWrite'],
 ldr: ['Fetch', 'Decode', 'MemAdr', 'MemRead', 'MemWB'],
});
