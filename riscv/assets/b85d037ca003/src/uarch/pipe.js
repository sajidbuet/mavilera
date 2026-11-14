// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { HALT_WORD, ECALL_WORD, EBREAK_WORD, stopKind, unsupportedEcall, decodeMnemonic, immB } from '../isa/encoding.js';
import { WordMemory } from '../core/memory.js';
import { PROFILES } from '../core/profiles.js';
import { buildDecoders, ALU_FUNCS, IMM } from './single.js';
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const bit = (v) => (v ? 1 : 0);
const OP_R = 0b0110011;
const OP_STORE = 0b0100011;
const OP_BRANCH = 0b1100011;
const OP_LUI = 0b0110111;
const OP_AUIPC = 0b0010111;
const OP_JAL = 0b1101111;
export const HAZARD_MODES = Object.freeze(['none', 'mem', 'memwb', 'stall', 'full']);
export const PREDICTORS = Object.freeze(['none', '1bit', '2bit']);
export const PENALTY = 2;
const IFID = { instr: 0, pc: 0, pc_plus4: 0, pred: 0, seq: 0 };
const IDEX = {
 instr: 0, pc: 0, pc_plus4: 0, rs1_val: 0, rs2_val: 0, imm: 0, rs1: 0, rs2: 0, rd: 0, funct3: 0, pred: 0,
 RegWrite: 0, ALUSrc: 0, MemWrite: 0, Branch: 0, Jump: 0, TargetSrc: 0, ResultSel: 0, ALUCtrl: 0, seq: 0,
};
const EXMEM = { instr: 0, exres: 0, store_data: 0, rd: 0, RegWrite: 0, MemWrite: 0, ResultSel: 0, seq: 0 };
const MEMWB = { instr: 0, exres: 0, rdata: 0, rd: 0, RegWrite: 0, ResultSel: 0, seq: 0 };
const STATS = { retired: 0, branches: 0, jumps: 0, mispredicts: 0, redirects: 0, loadUse: 0, flushed: 0, stale: 0, firstStaleCycle: -1, firstStalePc: 0, wrongPath: 0, branchStall: 0 };
export class Predictor {
 constructor(kind = 'none', entries = 8) {
 if (!PREDICTORS.includes(kind)) throw new Error(`unknown predictor ${kind}`);
 if (!(entries >= 1 && (entries & (entries - 1)) === 0)) throw new Error('ENTRIES must be a power of two');
 this.kind = kind;
 this.entries = entries;
 this.reset();
 }
 reset() {
 this.table = new Uint8Array(this.kind === 'none' ? 0 : this.entries).fill(this.kind === '2bit' ? 1 : 0);
 }
 index(pc) { return (pc >>> 2) & (this.entries - 1); }
 predict(pc) {
 if (this.kind === 'none') return 0;
 const v = this.table[this.index(pc)];
 return bit(this.kind === '2bit' ? v >= 2 : v);
 }
 next(pc, taken) {
 const v = this.table[this.index(pc)];
 if (this.kind === '1bit') return bit(taken);
 return taken ? Math.min(3, v + 1) : Math.max(0, v - 1);
 }
}
export class Pipeline {
 constructor(tables, { hazard = 'full', predictor = 'none', entries = 8, early = false, checks = true, historyLimit = 100_000, memsys = null } = {}) {
 this.memsys = memsys;
 if (!HAZARD_MODES.includes(hazard)) throw new Error(`unknown hazard mode ${hazard}`);
 if (early && hazard !== 'full') throw new Error('early branch resolution needs the complete hazard unit');
 this.dec = buildDecoders(tables);
 this.hazard = hazard;
 this.early = early;
 this.bp = new Predictor(predictor, entries);
 this.checks = checks;
 const p = PROFILES.ch08;
 this.isa = p.isa;
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
 this.bp.reset();
 this.pc_if = 0;
 this.ifid = IFID;
 this.idex = IDEX;
 this.exmem = EXMEM;
 this.memwb = MEMWB;
 this.ifSeq = 1;
 this.nextSeq = 2;
 this.cycle = 0;
 this.haltPc = null;
 this.halted = false;
 this.error = null;
 this.stats = { ...STATS };
 this.history = [];
 this.dropped = 0;
 this.trace = [];
 this.instances = new Map();
 this.instances.set(1, { kind: 'instr', pc: 0, instr: this.imem.read(0, 4), wrongPath: false });
 this.cache = null;
 }
 get pc() { return this.pc_if; }
 get penalty() { return this.early ? 1 : PENALTY; }
 evaluate() {
 if (this.cache) return this.cache;
 const s = {};
 const { ifid, idex, exmem, memwb } = this;
 s.instr_wb = memwb.instr; s.exres_wb = memwb.exres; s.rdata_wb = memwb.rdata; s.rd_wb = memwb.rd;
 s.RegWrite_wb = memwb.RegWrite; s.ResultSel_wb = memwb.ResultSel;
 s.result_wb = s.ResultSel_wb === 0b01 ? s.rdata_wb : s.exres_wb;
 s.instr_mem = exmem.instr; s.exres_mem = exmem.exres; s.store_data_mem = exmem.store_data; s.rd_mem = exmem.rd;
 s.RegWrite_mem = exmem.RegWrite; s.MemWrite_mem = exmem.MemWrite; s.ResultSel_mem = exmem.ResultSel;
 s.MemRead_mem = bit(s.ResultSel_mem === 0b01);
 s.rdata_mem = this.dmem.read(s.exres_mem, 4);
 s.instr_id = ifid.instr; s.pc_id = ifid.pc; s.pc_plus4_id = ifid.pc_plus4; s.pred_id = ifid.pred;
 const w = s.instr_id;
 s.op_id = w & 0x7f;
 s.rd_id = (w >>> 7) & 31;
 s.funct3_id = (w >>> 12) & 7;
 s.funct7b5_id = (w >>> 30) & 1;
 s.uses_rs1 = bit(!(s.op_id === OP_LUI || s.op_id === OP_AUIPC || s.op_id === OP_JAL));
 s.uses_rs2 = bit(s.op_id === OP_R || s.op_id === OP_STORE || s.op_id === OP_BRANCH);
 s.rs1_id = s.uses_rs1 ? (w >>> 15) & 31 : 0;
 s.rs2_id = s.uses_rs2 ? (w >>> 20) & 31 : 0;
 const m = this.dec.main(s.op_id);
 for (const k of ['RegWrite', 'ImmSel', 'ALUSrc', 'MemWrite', 'ResultSel', 'Branch', 'Jump', 'ALUOp', 'TargetSrc']) s[`${k}_id`] = m[k];
 const ad = this.dec.alu(s.ALUOp_id, (s.op_id >>> 5) & 1, s.funct3_id, s.funct7b5_id);
 s.ALUCtrl_id = ad.ALUCtrl;
 s.imm_id = IMM[s.ImmSel_id] ? IMM[s.ImmSel_id](w) >>> 0 : 0;
 const read = (r) => (r === 0 ? 0 : s.RegWrite_wb && s.rd_wb === r ? s.result_wb : this.x[r]);
 s.rs1_val_id = read(s.rs1_id);
 s.rs2_val_id = read(s.rs2_id);
 s.instr_ex = idex.instr; s.pc_ex = idex.pc; s.pc_plus4_ex = idex.pc_plus4; s.pred_ex = idex.pred;
 s.rs1_ex = idex.rs1; s.rs2_ex = idex.rs2; s.rd_ex = idex.rd; s.funct3_ex = idex.funct3;
 s.rs1_val_ex = idex.rs1_val; s.rs2_val_ex = idex.rs2_val; s.imm_ex = idex.imm;
 for (const k of ['RegWrite', 'ALUSrc', 'MemWrite', 'ResultSel', 'Branch', 'Jump', 'TargetSrc', 'ALUCtrl']) s[`${k}_ex`] = idex[k];
 s.MemRead_ex = bit(s.ResultSel_ex === 0b01);
 const fwd = (r) => {
 if (this.hazard === 'none' || r === 0) return 0b00;
 if (s.RegWrite_mem && s.rd_mem === r) return 0b10;
 if (this.hazard !== 'mem' && s.RegWrite_wb && s.rd_wb === r) return 0b01;
 return 0b00;
 };
 s.fwd_sel_a = fwd(s.rs1_ex);
 s.fwd_sel_b = fwd(s.rs2_ex);
 const pick = (sel, own) => (sel === 0b10 ? s.exres_mem : sel === 0b01 ? s.result_wb : own);
 s.src_a_ex = pick(s.fwd_sel_a, s.rs1_val_ex);
 s.fwd_b_ex = pick(s.fwd_sel_b, s.rs2_val_ex);
 s.src_b_ex = s.ALUSrc_ex ? s.imm_ex : s.fwd_b_ex;
 const f = ALU_FUNCS[this.dec.aluOp(s.ALUCtrl_ex)];
 s.alu_y_ex = f ? f(s.src_a_ex, s.src_b_ex) : 0;
 s.zero_ex = bit(s.alu_y_ex === 0);
 s.lt_ex = bit((s.src_a_ex | 0) < (s.src_b_ex | 0));
 s.ltu_ex = bit(s.src_a_ex < s.src_b_ex);
 const br = this.dec.branch(s.funct3_ex, { zero: s.zero_ex, lt: s.lt_ex, ltu: s.ltu_ex });
 s.BranchTaken_ex = br.BranchTaken;
 s.target_base_ex = s.TargetSrc_ex ? s.src_a_ex : s.pc_ex;
 s.target_sum_ex = (s.target_base_ex + s.imm_ex) >>> 0;
 s.pc_target_ex = (s.target_sum_ex & ~1) >>> 0;
 s.taken_ex = bit(s.Jump_ex || (s.Branch_ex && s.BranchTaken_ex));
 s.PCSel_ex = bit(s.Jump_ex || (s.Branch_ex && s.BranchTaken_ex !== s.pred_ex));
 s.pc_redirect_ex = s.taken_ex ? s.pc_target_ex : s.pc_plus4_ex;
 s.exres_ex = s.ResultSel_ex === 0b10 ? s.pc_plus4_ex : s.ResultSel_ex === 0b11 ? s.pc_target_ex : s.alu_y_ex;
 const sameSrc = (r) => r !== 0 && (r === s.rs1_id || r === s.rs2_id);
 const fwdId = (r) => (this.early && r !== 0 && s.RegWrite_mem && s.rd_mem === r ? 0b10 : 0b00);
 s.fwd_id_a = fwdId(s.rs1_id);
 s.fwd_id_b = fwdId(s.rs2_id);
 s.cmp_a_id = s.fwd_id_a ? s.exres_mem : s.rs1_val_id;
 s.cmp_b_id = s.fwd_id_b ? s.exres_mem : s.rs2_val_id;
 const brId = this.dec.branch(s.funct3_id, { zero: bit(s.cmp_a_id === s.cmp_b_id), lt: bit((s.cmp_a_id | 0) < (s.cmp_b_id | 0)), ltu: bit(s.cmp_a_id < s.cmp_b_id) });
 s.BranchTaken_id = this.early ? brId.BranchTaken : 0;
 s.pc_target_id = this.early ? (((s.TargetSrc_id ? s.cmp_a_id : s.pc_id) + s.imm_id) & ~1) >>> 0 : 0;
 s.taken_id = bit(this.early && (s.Jump_id || (s.Branch_id && s.BranchTaken_id)));
 const reads = s.Branch_id || (s.Jump_id && s.TargetSrc_id);
 const brStall = bit(this.early && reads && ((s.RegWrite_ex && sameSrc(s.rd_ex)) || (s.MemRead_mem && sameSrc(s.rd_mem))));
 const lwStall = bit(s.MemRead_ex && s.rd_ex !== 0 && (s.rd_ex === s.rs1_id || s.rd_ex === s.rs2_id));
 const stalls = this.hazard === 'stall' || this.hazard === 'full';
 s.stall_if = stalls ? bit(lwStall || brStall) : 0;
 s.stall_id = s.stall_if;
 s.PCSel_id = bit(this.early && !s.stall_id && (s.Jump_id || (s.Branch_id && s.BranchTaken_id !== s.pred_id)));
 s.pc_redirect_id = s.taken_id ? s.pc_target_id : this.early ? s.pc_plus4_id : 0;
 if (this.early) s.PCSel_ex = 0;
 s.flush_id = this.hazard === 'full' ? (this.early ? s.PCSel_id : s.PCSel_ex) : 0;
 s.flush_ex = bit((stalls && s.stall_id) || (this.hazard === 'full' && s.PCSel_ex));
 s.pc_if = this.pc_if;
 s.instr_if = this.imem.read(s.pc_if, 4);
 s.pc_plus4_if = (s.pc_if + 4) >>> 0;
 s.imm_b_if = immB(s.instr_if) >>> 0;
 s.pc_pred_if = (s.pc_if + s.imm_b_if) >>> 0;
 s.predict_taken = this.bp.predict(s.pc_if);
 s.pred_if = bit(s.predict_taken && (s.instr_if & 0x7f) === OP_BRANCH);
 s.pc_seq_if = s.pred_if ? s.pc_pred_if : s.pc_plus4_if;
 s.pc_next = s.PCSel_ex ? s.pc_redirect_ex : s.PCSel_id ? s.pc_redirect_id : s.pc_seq_if;
 const want = (r, own) => {
 if (r === 0) return own;
 if (s.RegWrite_mem && s.rd_mem === r) return s.MemRead_mem ? s.rdata_mem : s.exres_mem;
 if (s.RegWrite_wb && s.rd_wb === r) return s.result_wb;
 return own;
 };
 const stale = [];
 const wa = want(s.rs1_ex, s.rs1_val_ex);
 if (wa !== s.src_a_ex) stale.push({ reg: s.rs1_ex, got: s.src_a_ex, want: wa, operand: 'a' });
 const wb = want(s.rs2_ex, s.rs2_val_ex);
 if (s.rs2_ex !== s.rs1_ex && wb !== s.fwd_b_ex) stale.push({ reg: s.rs2_ex, got: s.fwd_b_ex, want: wb, operand: 'b' });
 this.cache = {
 signals: s,
 seq: { IF: this.ifSeq, ID: ifid.seq, EX: idex.seq, MEM: exmem.seq, WB: memwb.seq },
 lwStall,
 brStall,
 stale,
 rows: { main: m.index, alu: ad.index, branch: s.Branch_ex ? br.index : -1, branchId: s.Branch_id && this.early ? brId.index : -1 },
 bp: { indexIf: this.bp.index(s.pc_if), indexEx: this.bp.index(s.pc_ex), indexId: this.bp.index(s.pc_id) },
 halt: stopKind(s.instr_wb, this.x[17]) !== null,
 };
 return this.cache;
 }
 instance(seq) { return this.instances.get(seq) ?? null; }
 record() {
 const c = this.evaluate();
 const s = c.signals;
 return {
 ...c.seq, stall_if: s.stall_if, stall_id: s.stall_id, flush_id: s.flush_id, flush_ex: s.flush_ex,
 PCSel_ex: s.PCSel_ex, PCSel_id: s.PCSel_id, fwd_sel_a: s.fwd_sel_a, fwd_sel_b: s.fwd_sel_b, lwStall: c.lwStall,
 brStall: c.brStall, stale: c.stale.length > 0,
 waitOn: c.brStall ? (s.RegWrite_ex && s.rd_ex !== 0 && (s.rd_ex === s.rs1_id || s.rd_ex === s.rs2_id) ? 'EX' : 'MEM') : null,
 jump: this.early ? s.Jump_id : s.Jump_ex, taken: this.early ? s.BranchTaken_id : s.BranchTaken_ex,
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
 if (c.halt) { this.halted = true; return 'halt'; }
 if (s.instr_wb === ECALL_WORD) { this.error = unsupportedEcall('pipelined', this.x[17]); return 'error'; }
 if (this.checks && s.instr_ex !== 0) {
 const mn = decodeMnemonic(s.instr_ex);
 if ((!mn || !this.isa.has(mn)) && s.instr_ex !== ECALL_WORD && s.instr_ex !== EBREAK_WORD) {
 this.error = `instruction ${h8(s.instr_ex)} at ${h8(s.pc_ex)} is not implemented by the pipelined processor`;
 return 'error';
 }
 if ((mn === 'lw' || mn === 'sw') && (s.alu_y_ex & 3)) {
 this.error = `misaligned 4-byte access at ${h8(s.alu_y_ex)} (instruction ${h8(s.instr_ex)} at ${h8(s.pc_ex)})`;
 return 'error';
 }
 }
 const rec = {
 pc_if: this.pc_if, ifid: this.ifid, idex: this.idex, exmem: this.exmem, memwb: this.memwb,
 ifSeq: this.ifSeq, nextSeq: this.nextSeq, haltPc: this.haltPc, stats: { ...this.stats },
 rd: 0, old: 0, mem: -1, memOld: 0, bpIndex: -1, bpOld: 0,
 };
 if (this.memsys?.active) rec.hold = this.memsys.edge(this.cycle);
 if (this.memsys?.timed) {
 const reqs = {};
 if (!s.stall_if) reqs.I = { op: 'read', addr: s.pc_if, size: 4 };
 if (s.MemWrite_mem) reqs.D = { op: 'write', addr: s.exres_mem, size: 4 };
 else if (s.MemRead_mem) reqs.D = { op: 'read', addr: s.exres_mem, size: 4 };
 const cause = this.memsys.waitEdge(reqs);
 if (cause) {
 rec.wait = cause;
 this.trace[this.cycle] = { ...this.record(), stall_if: 0, stall_id: 0, flush_id: 0, flush_ex: 0, PCSel_ex: 0,
 PCSel_id: 0, lwStall: 0, brStall: 0, waitOn: null, stale: false, wait: cause };
 this.cycle += 1;
 this.remember(rec);
 this.cache = null;
 return 'step';
 }
 }
 if (s.MemRead_mem && this.memsys?.devices.length) this.dmem.commitRead(s.exres_mem, 4);
 this.trace[this.cycle] = this.record();
 if ((s.instr_ex === HALT_WORD || s.instr_ex === ECALL_WORD || s.instr_ex === EBREAK_WORD) && this.haltPc === null) this.haltPc = s.pc_ex;
 const st = this.stats;
 const real = (seq, instr) => seq !== 0 && instr !== 0 && instr !== HALT_WORD && instr !== ECALL_WORD && instr !== EBREAK_WORD && this.instances.get(seq)?.kind === 'instr';
 if (real(c.seq.WB, s.instr_wb)) st.retired += 1;
 if (this.early && real(c.seq.ID, s.instr_id) && !s.stall_id) {
 if (s.Branch_id) { st.branches += 1; if (s.BranchTaken_id !== s.pred_id) st.mispredicts += 1; }
 if (s.Jump_id) st.jumps += 1;
 if (s.PCSel_id) st.redirects += 1;
 }
 if (real(c.seq.EX, s.instr_ex)) {
 if (!this.early) {
 if (s.Branch_ex) { st.branches += 1; if (s.BranchTaken_ex !== s.pred_ex) st.mispredicts += 1; }
 if (s.Jump_ex) st.jumps += 1;
 if (s.PCSel_ex) st.redirects += 1;
 }
 if (c.stale.length) {
 if (!st.stale) { st.firstStaleCycle = this.cycle; st.firstStalePc = s.pc_ex; }
 st.stale += 1;
 }
 }
 if (s.stall_if && c.lwStall) st.loadUse += 1;
 else if (s.stall_if) st.branchStall += 1;
 if (s.flush_id && c.seq.IF) st.flushed += 1;
 if (s.flush_ex && !s.stall_id && c.seq.ID) st.flushed += 1;
 if (s.PCSel_ex && real(c.seq.EX, s.instr_ex)) {
 if (!s.flush_id) st.wrongPath += this.mark(c.seq.IF);
 if (!s.flush_ex) st.wrongPath += this.mark(c.seq.ID);
 }
 if (s.RegWrite_wb && s.rd_wb !== 0) {
 rec.rd = s.rd_wb;
 rec.old = this.x[s.rd_wb];
 this.x[s.rd_wb] = s.result_wb;
 }
 if (s.MemWrite_mem) {
 rec.mem = s.exres_mem;
 rec.memOld = this.dmem.write(s.exres_mem, 4, s.store_data_mem);
 }
 const upd = this.early ? (s.Branch_id && !s.stall_id ? [s.pc_id, s.BranchTaken_id] : null) : s.Branch_ex ? [s.pc_ex, s.BranchTaken_ex] : null;
 if (upd && this.bp.kind !== 'none') {
 rec.bpIndex = this.bp.index(upd[0]);
 rec.bpOld = this.bp.table[rec.bpIndex];
 this.bp.table[rec.bpIndex] = this.bp.next(upd[0], upd[1]);
 }
 this.memwb = { instr: s.instr_mem, exres: s.exres_mem, rdata: s.rdata_mem, rd: s.rd_mem,
 RegWrite: s.RegWrite_mem, ResultSel: s.ResultSel_mem, seq: c.seq.MEM };
 this.exmem = { instr: s.instr_ex, exres: s.exres_ex, store_data: s.fwd_b_ex, rd: s.rd_ex, RegWrite: s.RegWrite_ex,
 MemWrite: s.MemWrite_ex, ResultSel: s.ResultSel_ex, seq: c.seq.EX };
 if (s.flush_ex) {
 let seq = 0;
 if (s.stall_id) {
 seq = this.nextSeq++;
 this.instances.set(seq, { kind: 'bubble', pc: s.pc_id, instr: 0, wrongPath: false });
 }
 this.idex = { ...IDEX, seq };
 } else {
 this.idex = {
 instr: s.instr_id, pc: s.pc_id, pc_plus4: s.pc_plus4_id, rs1_val: s.rs1_val_id, rs2_val: s.rs2_val_id,
 imm: s.imm_id, rs1: s.rs1_id, rs2: s.rs2_id, rd: s.rd_id, funct3: s.funct3_id, pred: s.pred_id,
 RegWrite: s.RegWrite_id, ALUSrc: s.ALUSrc_id, MemWrite: s.MemWrite_id, Branch: s.Branch_id, Jump: s.Jump_id,
 TargetSrc: s.TargetSrc_id, ResultSel: s.ResultSel_id, ALUCtrl: s.ALUCtrl_id, seq: c.seq.ID,
 };
 }
 if (s.flush_id) this.ifid = IFID;
 else if (!s.stall_id) this.ifid = { instr: s.instr_if, pc: s.pc_if, pc_plus4: s.pc_plus4_if, pred: s.pred_if, seq: c.seq.IF };
 if (!s.stall_if) {
 this.pc_if = s.pc_next;
 this.ifSeq = this.nextSeq++;
 if (!this.instances.has(this.ifSeq)) {
 this.instances.set(this.ifSeq, { kind: 'instr', pc: this.pc_if, instr: this.imem.read(this.pc_if, 4), wrongPath: false });
 }
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
 mark(seq) {
 const i = this.instances.get(seq);
 if (!i || i.kind !== 'instr' || i.instr === 0) return 0;
 i.wrongPath = true;
 return 1;
 }
 back() {
 if (this.error) { this.error = null; this.cache = null; return true; }
 if (this.halted) { this.halted = false; return true; }
 const r = this.history.pop();
 if (!r) return false;
 if (r.hold) this.memsys.load(r.hold);
 if (r.wait) { this.cycle -= 1; this.cache = null; return true; }
 if (r.bpIndex >= 0) this.bp.table[r.bpIndex] = r.bpOld;
 if (r.mem >= 0) this.dmem.restore(r.mem, 4, r.memOld);
 if (r.rd) this.x[r.rd] = r.old;
 Object.assign(this, { pc_if: r.pc_if, ifid: r.ifid, idex: r.idex, exmem: r.exmem, memwb: r.memwb,
 ifSeq: r.ifSeq, nextSeq: r.nextSeq, haltPc: r.haltPc, stats: r.stats });
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
 d.push(this.haltPc ?? 0, this.cycle);
 for (let i = 0; i < 64; i++) d.push(this.dmem.words[i]);
 return d;
 }
}
