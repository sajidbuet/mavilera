// multi.js -- the Chapter 7 multicycle processor rv32i_multi, at signal level
// (spec §8.2, WS-F-040). One step is one clock cycle. The controller is the
// chapter's Moore machine: its outputs come from the state-output table
// (tab:mc-outputs, with LUI, AUIPC and, on request, JALR; exported to
// content/data/ch07-tables.json by tools/export_ch07.py), a don't-care is 0
// as in the reference design, and the next state follows the chapter's
// transitions. The ALU decoder, the ImmSel decoder (the ImmSel column of the
// Chapter 6 main decoder) and the branch condition are those of Chapter 6
// (content/data/ch06-tables.json). One memory of 256 words holds code and
// data. Pure JavaScript.
//
// The program runs from PC = 0 until FETCH reads `jal x0, 0`; that cycle is
// not executed (as the chapter's program testbench, which does not count it).
// golden() gives the 291-word dump of code/chapter07/ref/regen.py: registers,
// halt PC, instructions, cycles, memory words 0-255.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ECALL_WORD, stopKind, unsupportedEcall, decodeMnemonic } from '../isa/encoding.js';
import { WordMemory } from '../core/memory.js';
import { PROFILES } from '../core/profiles.js';
import { ALU_FUNCS, IMM, buildDecoders } from './single.js';
import { MC_STATES } from './signals.js';

const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const bit = (v) => (v ? 1 : 0);
const toBits = (s) => parseInt(s.replace(/x/g, '0'), 2);
export const STATE_CODE = Object.freeze(Object.fromEntries(MC_STATES.map((s, i) => [s, i])));

/** The controller of the chapter's tables: outputs per state and the next-state rule. */
export function buildController(t7, { jalr = false } = {}) {
  const cols = t7.state_outputs.columns.filter((c) => jalr || !c.answer);
  const outputs = new Map(cols.map((c, i) => [c.state, {
    index: i, values: Object.fromEntries(Object.entries(c.values).map(([k, s]) => [k, toBits(s)])),
  }]));
  const rules = t7.transitions.filter((r) => outputs.has(r.from) && outputs.has(r.to) && (jalr || !r.source.startsWith('exr:mc-jalr')));
  return {
    states: cols.map((c) => c.state),
    outputs(state) { return outputs.get(state); },
    /** Next state from `state` for an instruction of main-decoder class `cls` (null: not decoded). */
    next(state, cls) {
      const from = rules.filter((r) => r.from === state);
      const hit = from.find((r) => r.on === null || (Array.isArray(r.on) && r.on.includes(cls)))
        ?? from.find((r) => r.on === 'other');
      return hit ? hit.to : 'FETCH';
    },
  };
}

export class Multicycle {
  /**
   * @param {object} t6 content/data/ch06-tables.json (ALU decoder, ImmSel column, branch condition)
   * @param {object} t7 content/data/ch07-tables.json
   * @param {{jalr?: boolean, historyLimit?: number}} options jalr: the JALR state (the answer of exercise PRB-0129)
   */
  constructor(t6, t7, { jalr = false, historyLimit = 100_000, memsys = null } = {}) {
    this.memsys = memsys; // optional memory system (docs/architecture/memory-hierarchy.md)
    this.dec = buildDecoders(t6);
    // the JALR state is in the tables only where content/data/ch07-jalr.json was merged (src/uarch/ch07-jalr.js)
    this.jalrAvailable = t7.state_outputs.columns.some((c) => c.state === 'JALR');
    this.jalr = jalr && this.jalrAvailable;
    this.ctl = buildController(t7, { jalr: this.jalr });
    const p = PROFILES.ch07;
    this.isa = p.isa;
    this.words = this.memsys?.memWords ?? p.words;
    this.historyLimit = historyLimit;
    this.load({ segments: [] });
  }

  /** Load an assembled program (or {segments}) and reset. */
  load(program) {
    this.program = program;
    this.reset();
  }

  reset() {
    this.mem = new WordMemory(this.words);
    for (const seg of this.program.segments) this.mem.loadBytes(seg.address, seg.bytes);
    this.imem = this.mem;
    if (this.memsys) ({ I: this.imem, D: this.mem } = this.memsys.attach(this.mem, this.mem)); // one memory for fetch and data; two ports, so that L1I and L1D can differ
    this.x =new Uint32Array(32);
    this.pc = 0;
    // non-architectural registers: not reset in the RTL; the model starts them at 0
    Object.assign(this, { ir: 0, instr_pc: 0, rs1_q: 0, rs2_q: 0, alu_q: 0, mdr: 0 });
    this.state = 'FETCH';
    this.cycle = 0;
    this.retired = 0; // instructions completed (the last state of each returns to FETCH)
    this.halted = false;
    this.haltPc = null;
    this.error = null;
    this.history = []; // per edge: the registers before it and what it wrote; newest last
    this.dropped = 0;
    this.cache = null;
  }

  /** Address of the instruction the current cycle works on. */
  get instrAddress() {
    return this.state === 'FETCH' ? this.pc : this.instr_pc;
  }

  /** Every named signal of the current cycle, the state-output column and the decoder rows used. */
  evaluate() {
    if (this.cache) return this.cache;
    const s = { state: STATE_CODE[this.state] };
    const out = this.ctl.outputs(this.state);
    Object.assign(s, out.values);
    Object.assign(s, { pc: this.pc, instr_pc: this.instr_pc, ir: this.ir, rs1_q: this.rs1_q, rs2_q: this.rs2_q,
      alu_q: this.alu_q, mdr: this.mdr });
    const w = this.ir;
    s.op = w & 0x7f;
    s.rd = (w >>> 7) & 31;
    s.funct3 = (w >>> 12) & 7;
    s.rs1 = (w >>> 15) & 31;
    s.rs2 = (w >>> 20) & 31;
    s.funct7b5 = (w >>> 30) & 1;
    const m = this.dec.main(s.op); // its ImmSel column and its class (the next-state input)
    s.ImmSel = m.ImmSel;
    s.imm = IMM[s.ImmSel] ? IMM[s.ImmSel](w) >>> 0 : 0;
    s.rs1_val = this.x[s.rs1];
    s.rs2_val = this.x[s.rs2];
    s.addr = s.AddrSel ? this.alu_q : this.pc;
    s.rdata = (this.state === 'FETCH' ? this.imem : this.mem).read(s.addr, 4);
    s.src_a = s.ALUSrcA === 0 ? this.pc : s.ALUSrcA === 1 ? this.instr_pc : this.rs1_q;
    s.src_b = s.ALUSrcB === 0 ? this.rs2_q : s.ALUSrcB === 1 ? 4 : s.imm;
    const ad = this.dec.alu(s.ALUOp, (s.op >>> 5) & 1, s.funct3, s.funct7b5);
    s.ALUCtrl = ad.ALUCtrl;
    const f = ALU_FUNCS[this.dec.aluOp(s.ALUCtrl)];
    s.alu_y = f ? f(s.src_a, s.src_b) : 0;
    s.zero = bit(s.alu_y === 0);
    s.lt = bit((s.src_a | 0) < (s.src_b | 0));
    s.ltu = bit(s.src_a < s.src_b);
    const br = this.dec.branch(s.funct3, s);
    s.BranchTaken = br.BranchTaken;
    s.PCEn = s.PCWrite | (s.Branch & s.BranchTaken);
    s.result = [this.alu_q, this.mdr, s.alu_y, this.pc][s.ResultSel];
    s.pc_next = (s.result & ~1) >>> 0;
    const next = this.ctl.next(this.state, m.cls);
    s.next = STATE_CODE[next];
    const mnemonic = decodeMnemonic(w);
    this.cache = {
      signals: s,
      state: this.state,
      next,
      cls: m.cls, // main-decoder class of the instruction in ir, or null
      rows: { state: out.index, alu: ad.index, branch: s.Branch ? br.index : -1 },
      mnemonic,
      halt: this.state === 'FETCH' && stopKind(s.rdata, this.x[17]) !== null,
    };
    return this.cache;
  }

  /**
   * Apply one clock edge. Returns 'halt' when FETCH reads the halt instruction
   * (that cycle is not executed), 'error' (this.error set) in DECODE for an
   * instruction the processor does not implement (and for jalr without the JALR
   * state) and in ADDR for a misaligned word address, otherwise 'step'.
   */
  step() {
    if (this.halted) return 'halt';
    if (this.error) return 'error';
    const c = this.evaluate();
    const s = c.signals;
    if (c.halt) { this.halted = true; this.haltPc = this.pc; return 'halt'; }
    if (c.state === 'DECODE' && this.ir === ECALL_WORD) { this.error = unsupportedEcall('multicycle', this.x[17]); return 'error'; }
    if (c.state === 'DECODE') {
      if (c.mnemonic === 'jalr' && !this.jalr) {
        this.error = this.jalrAvailable
          ? `jalr at ${h8(this.instr_pc)}: the JALR state is an optional extension of the controller, off by default; turn it on to run jalr`
          : `jalr at ${h8(this.instr_pc)}: this multicycle processor has no state for jalr`;
        return 'error';
      }
      if (!c.mnemonic || !this.isa.has(c.mnemonic)) {
        this.error = `instruction ${h8(this.ir)} at ${h8(this.instr_pc)} is not implemented by the multicycle processor`;
        return 'error';
      }
    }
    if (c.state === 'ADDR' && (s.alu_y & 3)) {
      this.error = `misaligned 4-byte access at ${h8(s.alu_y)} (instruction ${h8(this.ir)} at ${h8(this.instr_pc)})`;
      return 'error';
    }
    const rec = { state: this.state, pc: this.pc, ir: this.ir, instr_pc: this.instr_pc, rs1_q: this.rs1_q, rs2_q: this.rs2_q,
      alu_q: this.alu_q, mdr: this.mdr, at: this.instrAddress, rd: 0, old: 0, mem: -1, memOld: 0, done: c.next === 'FETCH' };
    if (this.memsys?.active) rec.hold = this.memsys.edge(this.cycle); // also tells the platform devices the time (step back restores them)
    if (this.memsys?.timed && (c.state === 'FETCH' || c.state === 'MEMRD' || s.MemWrite)) {
      // FETCH_WAIT / MEM_WAIT: the state repeats until the memory is ready (the request is held, issued once)
      const cause = this.memsys.waitEdge(c.state === 'FETCH'
        ? { I: { op: 'read', addr: s.addr, size: 4 } }
        : { D: { op: s.MemWrite ? 'write' : 'read', addr: s.addr, size: 4 } });
      if (cause) {
        rec.wait = cause;
        rec.done = false;
        this.cycle += 1;
        this.remember(rec);
        this.cache = null;
        return 'step';
      }
    }
    if (c.state === 'MEMRD' && this.memsys?.devices.length) this.mem.commitRead(s.addr, 4); // a device's side effect of a load, once
    if (s.RegWrite && s.rd !== 0) {
      rec.rd = s.rd;
      rec.old = this.x[s.rd];
      this.x[s.rd] = s.result;
    }
    if (s.MemWrite) {
      rec.mem = s.addr;
      rec.memOld = this.mem.write(s.addr, 4, this.rs2_q);
    }
    if (s.IRWrite) { this.ir = s.rdata; this.instr_pc = this.pc; }
    this.mdr = s.rdata;
    this.rs1_q = s.rs1_val;
    this.rs2_q = s.rs2_val;
    this.alu_q = s.alu_y;
    if (s.PCEn) this.pc = s.pc_next;
    this.state = c.next;
    this.cycle += 1;
    if (rec.done) this.retired += 1;
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

  /** Undo the last clock edge (WS-F-090). Returns false if nothing is left. */
  back() {
    if (this.error) { this.error = null; this.cache = null; return true; }
    if (this.halted) { this.halted = false; this.haltPc = null; return true; }
    const r = this.history.pop();
    if (!r) return false;
    if (r.hold) this.memsys.load(r.hold);
    if (r.wait) { this.cycle -= 1; this.cache = null; return true; } // a wait edge changed nothing else
    if (r.mem >= 0) this.mem.restore(r.mem, 4, r.memOld);
    if (r.rd) this.x[r.rd] = r.old;
    Object.assign(this, { state: r.state, pc: r.pc, ir: r.ir, instr_pc: r.instr_pc, rs1_q: r.rs1_q, rs2_q: r.rs2_q,
      alu_q: r.alu_q, mdr: r.mdr });
    this.cycle -= 1;
    if (r.done) this.retired -= 1;
    this.cache = null;
    return true;
  }

  /** Clock cycles up to the next FETCH: the rest of this instruction (WS-F-040). */
  stepInstruction() {
    let r;
    do r = this.step(); while (r === 'step' && (this.state !== 'FETCH' || this.last.wait)); // FETCH_WAIT repeats FETCH
    return r;
  }

  /** Undo cycles back to the FETCH of this instruction, or of the one before when at a FETCH. */
  backInstruction() {
    if (!this.back()) return false;
    while ((this.state !== 'FETCH' || this.last?.wait) && this.back());
    return true;
  }

  /** What the last edge changed: {pc, rd, mem} or null. */
  get last() {
    return this.history.length ? this.history[this.history.length - 1] : null;
  }

  /** Run to the halt; throws after `limit` cycles. Returns the stop reason. */
  run(limit = 1_000_000) {
    for (;;) {
      if (this.cycle >= limit) throw new Error(`no halt within ${limit} cycles`);
      const r = this.step();
      if (r !== 'step') return r;
    }
  }

  /** The chapter's 291-word golden dump (code/chapter07/ref/regen.py, tb_rv32i_multi.sv). */
  golden() {
    const d = Array.from(this.x);
    d.push(this.haltPc ?? this.instrAddress, this.retired, this.cycle);
    for (let i = 0; i < this.words; i++) d.push(this.mem.words[i]);
    return d;
  }
}
