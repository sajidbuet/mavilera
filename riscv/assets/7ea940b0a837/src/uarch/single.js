// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { ECALL_WORD, stopKind, unsupportedEcall, decodeMnemonic, immI, immS, immB, immU, immJ } from '../isa/encoding.js';
import { WordMemory } from '../core/memory.js';
import { PROFILES } from '../core/profiles.js';
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const bit = (v) => (v ? 1 : 0);
export const ALU_FUNCS = {
 add: (a, b) => (a + b) >>> 0,
 sub: (a, b) => (a - b) >>> 0,
 sll: (a, b) => (a << (b & 31)) >>> 0,
 slt: (a, b) => bit((a | 0) < (b | 0)),
 sltu: (a, b) => bit(a < b),
 xor: (a, b) => (a ^ b) >>> 0,
 srl: (a, b) => a >>> (b & 31),
 sra: (a, b) => ((a | 0) >> (b & 31)) >>> 0,
 or: (a, b) => (a | b) >>> 0,
 and: (a, b) => (a & b) >>> 0,
 pass: (a, b) => b >>> 0,
};
export const IMM = [immI, immS, immB, immU, immJ];
const toBits = (s) => parseInt(s.replace(/x/g, '0'), 2);
const matches = (pattern, value, width) => {
 for (let i = 0; i < width; i++) {
 const c = pattern[i];
 if (c !== 'x' && Number(c) !== ((value >>> (width - 1 - i)) & 1)) return false;
 }
 return true;
};
export function buildDecoders(tables) {
 const main = new Map();
 tables.main_decoder.columns.forEach((c, i) => {
 const v = Object.fromEntries(Object.entries(c.values).map(([k, s]) => [k, toBits(s)]));
 main.set(c.op, { index: i, cls: c.class, values: v });
 });
 const zero = Object.fromEntries(tables.main_decoder.signals.map((s) => [s, 0]));
 const aluRows = tables.alu_decoder;
 const ops = new Map(tables.alu_ops.map((r) => [parseInt(r.ALUCtrl, 2), r.op]));
 const branch = new Map(tables.branch_cond.map((r, i) => [parseInt(r.funct3, 2), { index: i, expr: r.BranchTaken }]));
 return {
 main(op) {
 const c = main.get(op);
 return c ? { index: c.index, cls: c.cls, ...c.values } : { index: -1, cls: null, ...zero };
 },
 alu(ALUOp, op5, funct3, funct7b5) {
 const i = aluRows.findIndex((r) => matches(r.ALUOp, ALUOp, 2) && matches(r.op5, op5, 1)
 && matches(r.funct3, funct3, 3) && matches(r.funct7b5, funct7b5, 1));
 return { index: i, ALUCtrl: i < 0 ? 0 : parseInt(aluRows[i].ALUCtrl, 2) };
 },
 branch(funct3, flags) {
 const b = branch.get(funct3);
 if (!b) return { index: -1, BranchTaken: 0 };
 const neg = b.expr.startsWith('~');
 return { index: b.index, BranchTaken: bit(Boolean(flags[neg ? b.expr.slice(1) : b.expr]) !== neg) };
 },
 aluOp(ALUCtrl) {
 return ops.get(ALUCtrl) ?? null;
 },
 };
}
export class SingleCycle {
 constructor(tables, { ext = false, historyLimit = 100_000, memsys = null } = {}) {
 this.dec = buildDecoders(tables);
 this.memsys = memsys;
 this.ext = ext;
 const p = PROFILES.ch06;
 this.isa = ext ? p.subsets.ext : p.isa;
 this.words = this.memsys?.memWords ?? p.words;
 this.historyLimit = historyLimit;
 this.load({ segments: [] });
 }
 load(program) {
 this.program = program;
 this.reset();
 }
 reset() {
 this.imem = new WordMemory(this.words);
 this.dmem = new WordMemory(this.words);
 for (const seg of this.program.segments) (seg.executable ? this.imem : this.dmem).loadBytes(seg.address, seg.bytes);
 if (this.memsys) ({ I: this.imem, D: this.dmem } = this.memsys.attach(this.imem, this.dmem));
 this.x =new Uint32Array(32);
 this.pc = 0;
 this.cycle = 0;
 this.halted = false;
 this.error = null;
 this.history = [];
 this.dropped = 0;
 this.cache = null;
 }
 evaluate() {
 if (this.cache) return this.cache;
 const s = {};
 const pc = this.pc;
 s.pc = pc;
 s.instr = this.imem.read(pc, 4);
 const w = s.instr;
 s.op = w & 0x7f;
 s.rd = (w >>> 7) & 31;
 s.funct3 = (w >>> 12) & 7;
 s.rs1 = (w >>> 15) & 31;
 s.rs2 = (w >>> 20) & 31;
 s.funct7b5 = (w >>> 30) & 1;
 const m = this.dec.main(s.op);
 for (const k of ['RegWrite', 'ImmSel', 'ALUSrc', 'MemWrite', 'ResultSel', 'Branch', 'Jump', 'ALUOp', 'TargetSrc']) s[k] = m[k];
 s.imm = IMM[s.ImmSel] ? IMM[s.ImmSel](w) >>> 0 : 0;
 s.rs1_val = this.x[s.rs1];
 s.rs2_val = this.x[s.rs2];
 s.src_b = s.ALUSrc ? s.imm : s.rs2_val;
 const ad = this.dec.alu(s.ALUOp, (s.op >>> 5) & 1, s.funct3, s.funct7b5);
 s.ALUCtrl = ad.ALUCtrl;
 const f = ALU_FUNCS[this.dec.aluOp(s.ALUCtrl)];
 s.alu_y = f ? f(s.rs1_val, s.src_b) : 0;
 s.zero = bit(s.alu_y === 0);
 s.lt = bit((s.rs1_val | 0) < (s.src_b | 0));
 s.ltu = bit(s.rs1_val < s.src_b);
 const br = this.dec.branch(s.funct3, s);
 s.BranchTaken = br.BranchTaken;
 s.PCSel = s.Jump | (s.Branch & s.BranchTaken);
 s.pc_plus4 = (pc + 4) >>> 0;
 s.target_base = s.TargetSrc ? s.rs1_val : pc;
 s.pc_target = ((s.target_base + s.imm) & ~1) >>> 0;
 s.pc_next = s.PCSel ? s.pc_target : s.pc_plus4;
 s.rdata = this.dmem.read(s.alu_y, 4);
 let loaded = s.rdata;
 if (this.ext) {
 s.load_val = s.funct3 === 0b100 ? (s.rdata >>> (8 * (s.alu_y & 3))) & 0xff : s.rdata;
 loaded = s.load_val;
 }
 s.result = [s.alu_y, loaded, s.pc_plus4, s.pc_target][s.ResultSel];
 this.cache = {
 signals: s,
 cls: m.cls,
 rows: { main: m.index, alu: ad.index, branch: s.Branch ? br.index : -1 },
 mnemonic: decodeMnemonic(w),
 halt: stopKind(w, this.x[17]) !== null,
 };
 return this.cache;
 }
 step() {
 if (this.halted) return 'halt';
 if (this.error) return 'error';
 const c = this.evaluate();
 const s = c.signals;
 if (c.halt) { this.halted = true; return 'halt'; }
 if (s.instr === ECALL_WORD) { this.error = unsupportedEcall('single-cycle', this.x[17]); return 'error'; }
 if (!c.mnemonic || !this.isa.has(c.mnemonic)) {
 this.error = `instruction ${h8(s.instr)} at ${h8(s.pc)} is not implemented by the single-cycle processor`;
 return 'error';
 }
 if ((c.mnemonic === 'lw' || c.mnemonic === 'sw') && (s.alu_y & 3)) {
 this.error = `misaligned 4-byte access at ${h8(s.alu_y)} (instruction ${h8(s.instr)} at ${h8(s.pc)})`;
 return 'error';
 }
 const rec = { pc: s.pc, rd: 0, old: 0, mem: -1, memOld: 0 };
 if (this.memsys?.active) {
 rec.hold = this.memsys.edge(this.cycle);
 }
 if (this.memsys?.timed) {
 const reqs = { I: { op: 'read', addr: s.pc, size: 4 } };
 if (s.MemWrite) reqs.D = { op: 'write', addr: s.alu_y, size: 4 };
 else if (s.ResultSel === 1) reqs.D = { op: 'read', addr: s.alu_y, size: 4 };
 const cause = this.memsys.waitEdge(reqs);
 if (cause) {
 rec.wait = cause;
 this.cycle += 1;
 this.remember(rec);
 this.cache = null;
 return 'step';
 }
 }
 if (s.ResultSel === 1 && this.memsys?.devices.length) this.dmem.commitRead(s.alu_y, 4);
 if (s.RegWrite && s.rd !== 0) {
 rec.rd = s.rd;
 rec.old = this.x[s.rd];
 this.x[s.rd] = s.result;
 }
 if (s.MemWrite) {
 rec.mem = s.alu_y;
 rec.memOld = this.dmem.write(s.alu_y, 4, s.rs2_val);
 }
 this.pc = s.pc_next;
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
 if (this.error) { this.error = null; this.cache = null; return true; }
 if (this.halted) { this.halted = false; return true; }
 const r = this.history.pop();
 if (!r) return false;
 if (r.hold) this.memsys.load(r.hold);
 if (r.wait) { this.cycle -= 1; this.cache = null; return true; }
 if (r.mem >= 0) this.dmem.restore(r.mem, 4, r.memOld);
 if (r.rd) this.x[r.rd] = r.old;
 this.pc = r.pc;
 this.cycle -= 1;
 this.cache = null;
 return true;
 }
 get last() {
 return this.history.length ? this.history[this.history.length - 1] : null;
 }
 run(limit = 100_000) {
 for (;;) {
 if (this.cycle >= limit) throw new Error(`no halt within ${limit} cycles`);
 const r = this.step();
 if (r !== 'step') return r;
 }
 }
 golden() {
 const d = Array.from(this.x);
 d.push(this.pc, this.cycle);
 for (let i = 0; i < 64; i++) d.push(this.dmem.words[i]);
 return d;
 }
}
