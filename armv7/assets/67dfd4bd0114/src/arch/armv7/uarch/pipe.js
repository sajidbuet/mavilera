// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { decode, STACK_TOP, HALT_WORD, withinTier } from '../language.js';
import { Memory, passed } from '../engine.js';
import { mainDecode, aluDecode, alu, extend } from './single.js';
import { ARMV7_STRINGS as S } from '../strings.js';
export const HAZARD_MODES = Object.freeze(['none', 'forward', 'full']);
export const STAGES = Object.freeze(['IF', 'ID', 'EX', 'MEM', 'WB']);
const DREG = Object.freeze({ InstrD: 0, seq: 0, at: 0, bubble: 1 });
const EREG = Object.freeze({
 RD1E: 0, RD2E: 0, ExtImmE: 0, WA3E: 0, RA1E: 0, RA2E: 0, CondE: 0,
 PCSrcE: 0, RegWriteE: 0, MemtoRegE: 0, MemWriteE: 0, ALUControlE: 0, BranchE: 0, ALUSrcE: 0, FlagWriteE: 0,
 seq: 0, at: 0, instr: 0, bubble: 1,
});
const MREG = Object.freeze({
 ALUOutM: 0, WriteDataM: 0, WA3M: 0, PCSrcM: 0, RegWriteM: 0, MemtoRegM: 0, MemWriteM: 0,
 seq: 0, at: 0, instr: 0, bubble: 1, exec: 0, flags: 0,
});
const WREG = Object.freeze({
 ALUOutW: 0, ReadDataW: 0, WA3W: 0, PCSrcW: 0, RegWriteW: 0, MemtoRegW: 0,
 seq: 0, at: 0, instr: 0, bubble: 1, exec: 0, flags: 0,
});
const REGS = Object.freeze({ D: DREG, E: EREG, M: MREG, W: WREG });
const STATS = Object.freeze({
 retired: 0, loads: 0, branches: 0, taken: 0, pcWrites: 0, loadUse: 0, unneeded: 0, pcWait: 0, flushed: 0, corrected: 0,
 stale: 0, wrongPath: 0,
});
const flagsOf = (F) => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;
const bit = (v) => (v ? 1 : 0);
export function sourcesOf(cls, w) {
 const Rn = (w >>> 16) & 15;
 const Rd = (w >>> 12) & 15;
 const Rm = w & 15;
 switch (cls) {
 case 'dpReg': return [Rn, Rm];
 case 'dpImm': case 'ldr': return [Rn];
 case 'str': return [Rn, Rd];
 default: return [];
 }
}
export class ArmPipe {
 constructor({ hazard = 'full', historyLimit = 100_000 } = {}) {
 if (!HAZARD_MODES.includes(hazard)) throw new Error(`unknown hazard mode ${hazard}`);
 this.hazard = hazard;
 this.historyLimit = historyLimit;
 this.tier = 'H';
 this.load({ segments: [] });
 }
 load(program) {
 this.program = program;
 this.code = (program.segments ?? []).filter((s) => s.executable).map((s) => [s.address, s.address + s.bytes.length]);
 this.reset();
 }
 reset() {
 this.imem = new Memory();
 this.dmem = new Memory();
 for (const s of this.program.segments ?? []) {
 const m = s.executable ? this.imem : this.dmem;
 for (let i = 0; i < s.bytes.length; i++) if (s.bytes[i]) m.write8(s.address + i, s.bytes[i]);
 }
 this.R = new Uint32Array(15);
 this.R[13] = STACK_TOP;
 this.F = { N: 0, Z: 0, C: 0, V: 0 };
 this.pcF = (this.program.entry ?? 0) >>> 0;
 ({ D: this.D, E: this.E, M: this.M, W: this.W } = this.regs);
 this.ifSeq = 1;
 this.nextSeq = 2;
 this.cycle = 0;
 this.halted = false;
 this.error = null;
 this.errorStage = null;
 this.stats = { ...STATS };
 this.history = [];
 this.dropped = 0;
 this.trace = [];
 this.instances = new Map();
 this.instances.set(1, this.fetched(this.pcF));
 this.cache = null;
 }
 inCode(a) { return this.code.some(([lo, hi]) => a >= lo && a + 4 <= hi); }
 fetched(pc) {
 const code = this.inCode(pc);
 return { kind: 'instr', pc, instr: code ? this.imem.read(pc, 4) : 0, noCode: !code, wrongPath: false };
 }
 get pc() { return this.pcF; }
 instance(seq) { return this.instances.get(seq) ?? null; }
 evaluate() {
 if (this.cache) return this.cache;
 const s = {};
 const { D, E, M, W } = this;
 const full = this.hazard === 'full';
 for (const k of Object.keys(this.regs.W)) if (/W$/.test(k)) s[k] = W[k];
 for (const k of Object.keys(this.regs.M)) if (/M$/.test(k)) s[k] = M[k];
 this.writeback(s);
 s.ReadDataM = this.dmem.read((s.ALUOutM & ~3) >>> 0, 4);
 s.PCF = this.pcF;
 const fi = this.instance(this.ifSeq);
 s.InstrF = fi && !fi.noCode ? fi.instr : 0;
 s.PCPlus4F = (s.PCF + 4) >>> 0;
 const w = D.InstrD;
 s.InstrD = w;
 s.Cond = w >>> 28;
 s.Op = (w >>> 26) & 3;
 s.Funct = (w >>> 20) & 63;
 s.Rn = (w >>> 16) & 15;
 s.Rd = (w >>> 12) & 15;
 s.Rm = w & 15;
 s.Imm24 = w & 0xffffff;
 const { m, a } = this.decodeStage(s, D);
 s.PCSrcD = bit(s.WA3D === 15 && s.RegWriteD);
 s.PCPlus8D = s.PCPlus4F;
 s.RA1D = s.RegSrcD & 1 ? 15 : s.Rn;
 s.RA2D = s.RegSrcD & 2 ? s.Rd : s.Rm;
 const read = (n) => (n === 15 ? s.PCPlus8D : s.RegWriteW && s.WA3W === n ? s.ResultW : this.R[n]);
 s.RD1D = read(s.RA1D);
 s.RD2D = read(s.RA2D);
 s.ExtImmD = extend(s.Imm24, s.ImmSrcD);
 for (const k of Object.keys(this.regs.E)) if (/E$/.test(k)) s[k] = E[k];
 s.FlagsE = flagsOf(this.F);
 s.Match_1E_M = bit(s.RA1E === s.WA3M);
 s.Match_1E_W = bit(s.RA1E === s.WA3W);
 s.Match_2E_M = bit(s.RA2E === s.WA3M);
 s.Match_2E_W = bit(s.RA2E === s.WA3W);
 const forward = this.hazard !== 'none';
 const fwd = (mM, mW) => (!forward ? 0b00 : mM && s.RegWriteM ? 0b10 : mW && s.RegWriteW ? 0b01 : 0b00);
 s.ForwardAE = fwd(s.Match_1E_M, s.Match_1E_W);
 s.ForwardBE = fwd(s.Match_2E_M, s.Match_2E_W);
 const pick = (sel, own) => (sel === 0b10 ? s.ALUOutM : sel === 0b01 ? s.ResultW : own);
 s.SrcAE = pick(s.ForwardAE, s.RD1E);
 s.WriteDataE = pick(s.ForwardBE, s.RD2E);
 this.execute(s);
 s.CondExE = passed(s.CondE, this.F) ? 1 : 0;
 const fw = s.CondExE ? s.FlagWriteE : 0;
 s.FlagsNextE = ((fw & 2 ? s.ALUFlags : s.FlagsE) & 0b1100) | ((fw & 1 ? s.ALUFlags : s.FlagsE) & 0b0011);
 s.BranchTakenE = s.BranchE & s.CondExE;
 s.Match_12D_E = bit(s.RA1D === s.WA3E || s.RA2D === s.WA3E);
 const ldrStall = s.Match_12D_E & this.loadInE(s);
 s.LDRstall = full ? ldrStall : 0;
 s.PCWrPendingF = s.PCSrcD | s.PCSrcE | s.PCSrcM;
 s.StallFTextbook = full ? s.LDRstall | s.PCWrPendingF : 0;
 s.StallF = s.StallFTextbook & (s.BranchTakenE ^ 1);
 s.StallD = s.LDRstall;
 s.FlushE = full ? s.LDRstall | s.BranchTakenE : 0;
 s.FlushD = full ? s.PCWrPendingF | s.PCSrcW | s.BranchTakenE : 0;
 s.PCMuxF = s.PCSrcW ? s.ResultW : s.PCPlus4F;
 s.PCNext = s.BranchTakenE ? s.ALUResultE : s.PCMuxF;
 const want = (r, own) => {
 if (r === 15) return own;
 if (M.RegWriteM && M.WA3M === r) return this.resultOfM(s);
 if (W.RegWriteW && W.WA3W === r) return s.ResultW;
 return own;
 };
 const eCls = E.bubble ? null : this.classOfWord(E.instr);
 const eSrc = E.bubble ? [] : this.sources(eCls, E.instr);
 const stale = [];
 if (eSrc.includes(s.RA1E) && want(s.RA1E, s.RD1E) !== s.SrcAE) stale.push({ reg: s.RA1E, got: s.SrcAE, want: want(s.RA1E, s.RD1E), operand: 'a' });
 if (eSrc.includes(s.RA2E) && s.RA2E !== s.RA1E && want(s.RA2E, s.RD2E) !== s.WriteDataE) stale.push({ reg: s.RA2E, got: s.WriteDataE, want: want(s.RA2E, s.RD2E), operand: 'b' });
 const dCls = D.bubble ? null : this.classOfWord(w);
 const needed = ldrStall && this.access(eCls)?.kind === 'load' && this.sources(dCls, w).includes(s.WA3E);
 this.cache = {
 signals: s,
 seq: { IF: this.ifSeq, ID: D.seq, EX: E.seq, MEM: M.seq, WB: W.seq },
 rows: { main: m ? m.index : -1, alu: m ? a.index : -1 },
 clsD: dCls, clsE: eCls,
 dE: E.bubble ? null : decode(E.instr),
 ldrStall: Boolean(ldrStall),
 unneeded: Boolean(s.LDRstall && !needed),
 corrected: Boolean(s.StallFTextbook && !s.StallF),
 stale,
 halt: !W.bubble && W.exec && W.instr === HALT_WORD,
 live: { IF: true, ID: !D.bubble, EX: !E.bubble, MEM: !M.bubble, WB: !W.bubble },
 };
 return this.cache;
 }
 get regs() { return REGS; }
 writeback(s) { s.ResultW = s.MemtoRegW ? s.ReadDataW : s.ALUOutW; }
 decodeStage(s, D) {
 const m = D.bubble ? null : mainDecode(s.Op, s.Funct);
 const a = m ? aluDecode(m.ALUOp, s.Funct) : null;
 s.RegSrcD = m?.RegSrc ?? 0;
 s.ImmSrcD = m?.ImmSrc ?? 0;
 s.ALUSrcD = m?.ALUSrc ?? 0;
 s.MemtoRegD = m?.MemtoReg ?? 0;
 s.RegWriteD = m?.RegW ?? 0;
 s.MemWriteD = m?.MemW ?? 0;
 s.BranchD = m?.Branch ?? 0;
 s.ALUControlD = a?.ALUControl ?? 0;
 s.FlagWriteD = a?.FlagW ?? 0;
 s.WA3D = s.Rd;
 return { m, a: a && m.ALUOp ? a : { index: 0 } };
 }
 execute(s) {
 s.SrcBE = s.ALUSrcE ? s.ExtImmE : s.WriteDataE;
 [s.ALUResultE, s.ALUFlags] = alu(s.SrcAE, s.SrcBE, s.ALUControlE);
 }
 loadInE(s) { return s.MemtoRegE; }
 resultOfM(s) { return s.MemtoRegM ? s.ReadDataM : s.ALUOutM; }
 classOfWord(w) { return classOf((w >>> 26) & 3, (w >>> 20) & 63); }
 sources(cls, w) { return sourcesOf(cls, w); }
 access(cls) { return cls === 'ldr' ? { kind: 'load', size: 4 } : cls === 'str' ? { kind: 'store', size: 4 } : null; }
 nextW(s, M) {
 return { ALUOutW: s.ALUOutM, ReadDataW: s.ReadDataM, WA3W: s.WA3M, PCSrcW: s.PCSrcM, RegWriteW: s.RegWriteM, MemtoRegW: s.MemtoRegM,
 seq: M.seq, at: M.at, instr: M.instr, bubble: M.bubble, exec: M.exec, flags: M.flags };
 }
 nextM(s, E, nf) {
 return { ALUOutM: s.ALUResultE, WriteDataM: s.WriteDataE, WA3M: s.WA3E, PCSrcM: s.PCSrcE & s.CondExE, RegWriteM: s.RegWriteE & s.CondExE,
 MemtoRegM: s.MemtoRegE, MemWriteM: s.MemWriteE & s.CondExE, seq: E.seq, at: E.at, instr: E.instr, bubble: E.bubble, exec: s.CondExE, flags: nf };
 }
 nextE(s, D) {
 return { RD1E: s.RD1D, RD2E: s.RD2D, ExtImmE: s.ExtImmD, WA3E: s.WA3D, RA1E: s.RA1D, RA2E: s.RA2D, CondE: D.bubble ? 0 : s.Cond,
 PCSrcE: s.PCSrcD, RegWriteE: s.RegWriteD, MemtoRegE: s.MemtoRegD, MemWriteE: s.MemWriteD, ALUControlE: s.ALUControlD,
 BranchE: s.BranchD, ALUSrcE: s.ALUSrcD, FlagWriteE: s.FlagWriteD, seq: D.seq, at: D.at, instr: D.InstrD, bubble: D.bubble };
 }
 nextD(s) { return { InstrD: s.InstrF, seq: this.ifSeq, at: this.pcF, bubble: 0 }; }
 record() {
 const c = this.evaluate();
 const s = c.signals;
 return {
 ...c.seq, StallF: s.StallF, StallD: s.StallD, FlushD: s.FlushD, FlushE: s.FlushE, ForwardAE: s.ForwardAE,
 ForwardBE: s.ForwardBE, BranchTakenE: s.BranchTakenE, PCSrcW: s.PCSrcW, ldrStall: c.ldrStall, LDRstall: s.LDRstall,
 unneeded: c.unneeded, pcWait: Boolean(s.StallF && !s.LDRstall), corrected: c.corrected, stale: c.stale.length > 0,
 pcWriter: s.PCSrcD ? this.D.seq : s.PCSrcE ? this.E.seq : s.PCSrcM ? this.M.seq : 0, pcWritten: s.PCSrcW ? this.W.seq : 0,
 };
 }
 recordAt(k) {
 return k === this.cycle ? this.record() : this.trace[k] ?? null;
 }
 step() {
 if (this.halted) return 'halt';
 if (this.error) return 'error';
 const c = this.evaluate();
 const s = c.signals;
 const { D, E, M, W } = this;
 const fail = (msg, stage) => { this.error = msg; this.errorStage = stage; return 'error'; };
 if (c.halt) { this.halted = true; return 'halt'; }
 if (s.PCSrcW) {
 if (s.ResultW & 1) return fail(S.engine.thumb(s.ResultW, W.at), 'WB');
 if (s.ResultW & 2) return fail(S.engine.pcHalf(s.ResultW, W.at), 'WB');
 }
 const ei = this.instance(E.seq);
 if (!E.bubble && !(ei?.noCode && ei.wrongPath)) {
 const d = c.dE;
 const fail = (msg) => { this.error = msg; this.errorStage = 'EX'; return 'error'; };
 if (ei?.noCode) return fail(S.engine.noCode(E.at));
 if (d.bad) return fail(S.engine.notRun(E.instr, E.at, S.outOfScope[d.bad]));
 if (d.unpredictable) return fail(S.engine.unpredictable(E.instr, E.at, S.unpredictable[d.unpredictable]));
 if (!withinTier(d.tier, this.tier)) return fail(this.tier === 'H' ? S.pipe.notBase(E.instr, E.at, d.name, d.tier) : S.pipe.notExtended(E.instr, E.at, d.name));
 const access = this.access(c.clsE);
 if (access?.size === 4 && s.CondExE && (s.ALUResultE & 3)) return fail(S.engine.unaligned(access.kind, s.ALUResultE, E.at));
 }
 this.trace[this.cycle] = this.record();
 const rec = {
 pcF: this.pcF, D, E, M, W, F: { ...this.F }, ifSeq: this.ifSeq, nextSeq: this.nextSeq, stats: { ...this.stats },
 reg: null, mem: null, marks: [],
 };
 const st = this.stats;
 if (!W.bubble) st.retired += 1;
 if (!E.bubble && this.access(c.clsE)?.kind === 'load') st.loads += 1;
 if (!E.bubble && E.BranchE) { st.branches += 1; if (s.BranchTakenE) st.taken += 1; }
 if (!W.bubble && s.PCSrcW) st.pcWrites += 1;
 if (s.LDRstall) { st.loadUse += 1; if (c.unneeded) st.unneeded += 1; }
 else if (s.StallF) st.pcWait += 1;
 if (c.corrected) st.corrected += 1;
 if (s.FlushD && !s.StallD && !s.StallF) st.flushed += 1;
 if (s.FlushE && !s.LDRstall && !D.bubble) st.flushed += 1;
 if (c.stale.length) st.stale += 1;
 if (this.hazard !== 'full') {
 const mark = (seq) => {
 const i = this.instances.get(seq);
 if (!i || i.kind !== 'instr' || i.wrongPath) return;
 i.wrongPath = true;
 rec.marks.push(seq);
 st.wrongPath += 1;
 };
 if (s.BranchTakenE && !E.bubble) { if (!D.bubble) mark(D.seq); mark(this.ifSeq); }
 if (s.PCSrcW && !W.bubble) { for (const r of [M, E, D]) if (!r.bubble) mark(r.seq); mark(this.ifSeq); }
 }
 if (s.RegWriteW && s.WA3W !== 15) {
 rec.reg = [s.WA3W, this.R[s.WA3W]];
 this.R[s.WA3W] = s.ResultW;
 }
 if (s.MemWriteM) {
 rec.mem = [s.ALUOutM, this.dmem.read(s.ALUOutM, 4)];
 this.dmem.write(s.ALUOutM, 4, s.WriteDataM);
 }
 const nf = s.FlagsNextE;
 this.F = { N: (nf >>> 3) & 1, Z: (nf >>> 2) & 1, C: (nf >>> 1) & 1, V: nf & 1 };
 this.W = Object.freeze(this.nextW(s, M));
 this.M = Object.freeze(this.nextM(s, E, nf));
 if (s.FlushE) {
 let seq = 0;
 if (s.LDRstall) {
 seq = this.nextSeq++;
 this.instances.set(seq, { kind: 'bubble', pc: D.at, instr: 0, noCode: false, wrongPath: false });
 }
 this.E = Object.freeze({ ...this.regs.E, seq });
 } else this.E = Object.freeze(this.nextE(s, D));
 if (!s.StallD) this.D = s.FlushD ? this.regs.D : Object.freeze(this.nextD(s));
 if (!s.StallF) {
 this.pcF = s.PCNext;
 this.ifSeq = this.nextSeq++;
 if (!this.instances.has(this.ifSeq)) this.instances.set(this.ifSeq, this.fetched(this.pcF));
 }
 this.cycle += 1;
 this.remember(rec);
 this.cache = null;
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
 if (this.error) { this.error = null; this.errorStage = null; this.cache = null; return true; }
 if (this.halted) { this.halted = false; this.cache = null; return true; }
 const r = this.history.pop();
 if (!r) return false;
 if (r.mem) this.dmem.write(r.mem[0], 4, r.mem[1]);
 if (r.reg) this.R[r.reg[0]] = r.reg[1];
 for (const seq of r.marks) this.instances.get(seq).wrongPath = false;
 Object.assign(this, { pcF: r.pcF, D: r.D, E: r.E, M: r.M, W: r.W, F: r.F, ifSeq: r.ifSeq, nextSeq: r.nextSeq, stats: r.stats });
 this.cycle -= 1;
 this.cache = null;
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
 return { ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i}`, i === 15 ? this.pcF : this.R[i]])), ...this.F };
 }
}
export function classOf(Op, Funct) {
 if (Op === 0b00) return (Funct >>> 5) & 1 ? 'dpImm' : 'dpReg';
 if (Op === 0b01) return Funct & 1 ? 'ldr' : 'str';
 if (Op === 0b10) return 'b';
 return null;
}
