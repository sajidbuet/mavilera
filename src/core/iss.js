// iss.js -- architectural (instruction-level) simulator, RV32I + M, profile
// `iss` (spec §6, §12). Semantics and stop messages follow rvsim.py without
// --priv (WS-F-092, WS-F-093, WS-F-110): halt at `jal x0, 0` (not executed),
// at ebreak, or at ecall a7 = 93; ecall a7 = 64 is write. Integer arithmetic
// only: 32-bit values with >>> 0 and | 0, Math.imul, and BigInt for the high
// product and division (spec §5.1). Pure JavaScript.
//
// stepFast() executes one instruction and leaves what it changed in the
// d_* fields (no allocation), which history.js stores for stepping back
// (WS-F-090). step() wraps it and returns a record object, for traces and
// tests. The --abi-check call stack is an immutable linked list, so that a
// step back restores it by restoring one pointer.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { HALT_WORD, CLASSES, ABI_NAMES } from '../isa/encoding.js';
import { Memory, WordMemory } from './memory.js';
import { PROFILES } from './profiles.js';

export class SimError extends Error {}

const SYS_WRITE = 64;
const SYS_EXIT = 93;
const SAVED_REGS = [2, 8, 9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]; // sp, s0-s11 (psABI)
// registers a prologue saves on the stack without having written them: ra, s0-s11 (WS-F-147)
const SAVE_ON_STACK = new Set([1, 8, 9, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;

// Class indexes (CLASSES order).
const ALU = 0; const LOAD = 1; const STORE = 2; const BR_T = 3; const BR_N = 4;
const JUMP = 5; const MUL = 6; const DIV = 7; const SYSTEM = 8;

export const STEP_DONE = 0;
export const STEP_HALT_WORD = 1;

export class Hart {
  /**
   * @param {{segments: Array<{address:number, bytes:Uint8Array}>, entry:number}} program
   * @param {{profile?: string, sp?: boolean, abiCheck?: boolean}} options
   */
  constructor(program, options = {}) {
    this.profile = PROFILES[options.profile ?? 'iss'];
    // Instructions are fetched from `imem`; loads and stores use `mem`. They are
    // the same memory except in the Harvard profiles (ch06, ch08).
    const kind = this.profile.memory;
    this.mem = kind === 'sparse' ? new Memory() : new WordMemory(this.profile.words);
    this.imem = kind === 'harvard' ? new WordMemory(this.profile.words) : this.mem;
    for (const seg of program.segments) {
      (seg.executable ? this.imem : this.mem).loadBytes(seg.address, seg.bytes);
    }
    this.x = new Uint32Array(32);
    if (options.sp !== false && this.profile.stackTop !== null) this.x[2] = this.profile.stackTop;
    this.pc = program.entry >>> 0;
    this.countArr = new Float64Array(CLASSES.length);
    this.instret = 0;
    this.halted = false;
    this.exitCode = null;
    this.output = [];
    this.abiCheck = Boolean(options.abiCheck);
    this.spTop = this.x[2];
    this.spMin = this.x[2];
    this.abiTop = null; // {ret, call, target, saved, args, sp, depth, parent}
    this.abiViolations = [];
    // Uninitialised-value check (WS-F-147): a simulator check with no rvsim.py reference. The
    // instruction count of the first write of each register and of each stack byte; a read of
    // one whose first write is later than now reads a value nothing has written. Keyed by count,
    // so that step back needs no undo: counts after the current one simply lie in the future.
    this.uninitCheck = Boolean(options.uninitCheck);
    this.regWritten = new Float64Array(32).fill(Infinity);
    this.regWritten[0] = 0;
    if (this.x[2]) this.regWritten[2] = 0; // sp, set by the profile
    this.stackWritten = new Map(); // byte address -> count of its first store
    this.uninitWarnings = []; // {count, pc, text}, in count order
    this.clearDelta();
  }

  clearDelta() {
    this.d_pc = 0; this.d_word = 0; this.d_cls = 0; this.d_next = 0;
    this.d_rd = 0; this.d_regOld = 0;
    this.d_memSize = 0; this.d_memAddr = 0; this.d_memOld = 0; this.d_memVal = 0;
    this.d_halt = false; this.d_outLen = 0;
    this.d_spChanged = false; this.d_spMinOld = 0;
    this.d_abiChanged = false; this.d_abiTopOld = null; this.d_abiViolOld = 0;
  }

  get counts() {
    return Object.fromEntries(CLASSES.map((c, i) => [c, this.countArr[i]]));
  }

  get abiFrames() { // innermost last, for display and tests
    const out = [];
    for (let f = this.abiTop; f; f = f.parent) out.unshift(f);
    return out;
  }

  /** Execute one instruction. Returns STEP_DONE, or STEP_HALT_WORD at `jal x0, 0` (not executed). */
  stepFast() {
    const pc = this.pc;
    if (pc & 3) throw new SimError(`misaligned instruction fetch at ${h8(pc)}`);
    const w = this.imem.read(pc, 4);
    if (w === HALT_WORD) {
      this.halted = true;
      return STEP_HALT_WORD;
    }
    const x = this.x;
    const op = w & 0x7f;
    const rd = (w >>> 7) & 31;
    const f3 = (w >>> 12) & 7;
    const rs1 = (w >>> 15) & 31;
    const rs2 = (w >>> 20) & 31;
    const f7 = w >>> 25;
    const a = x[rs1];
    const b = x[rs2];
    if (this.uninitCheck) this.uninitReads(pc, w, op, rs1, rs2);
    let next = (pc + 4) >>> 0;
    let cls = ALU;
    let dest = 0; // register written (0: none)
    let value = 0;
    let memSize = 0;
    let halt = false;
    let outLen = 0;

    switch (op) {
      case 0b0110011: // OP and M extension
        if (f7 === 0x01) {
          value = mulDiv(f3, a, b);
          cls = f3 < 4 ? MUL : DIV;
        } else {
          value = aluOp(f3, f7, a, b);
          if (value === null) throw this.bad(w, pc);
        }
        dest = rd;
        break;
      case 0b0010011: { // OP-IMM
        const i = w >> 20;
        switch (f3) {
          case 0: value = a + i; break;
          case 2: value = (a | 0) < i ? 1 : 0; break;
          case 3: value = a < (i >>> 0) ? 1 : 0; break;
          case 4: value = a ^ i; break;
          case 6: value = a | i; break;
          case 7: value = a & i; break;
          case 1: if (f7 !== 0) throw this.bad(w, pc); value = a << rs2; break;
          default: // 5
            if (f7 === 0) value = a >>> rs2;
            else if (f7 === 0x20) value = (a | 0) >> rs2;
            else throw this.bad(w, pc);
        }
        dest = rd;
        break;
      }
      case 0b0000011: { // LOAD
        cls = LOAD;
        const size = f3 === 2 ? 4 : (f3 & 3) === 1 ? 2 : (f3 & 3) === 0 ? 1 : 0;
        if (size === 0 || f3 === 6 || f3 === 7) throw this.bad(w, pc);
        const addr = (a + (w >> 20)) >>> 0;
        if (addr % size) throw this.misaligned(addr, size, w, pc);
        value = this.mem.read(addr, size);
        if (f3 === 0) value = (value << 24) >> 24;
        else if (f3 === 1) value = (value << 16) >> 16;
        dest = rd;
        break;
      }
      case 0b0100011: { // STORE
        cls = STORE;
        if (f3 > 2) throw this.bad(w, pc);
        const size = 1 << f3;
        const addr = (a + (((w >> 25) << 5) | ((w >>> 7) & 31))) >>> 0;
        if (addr % size) throw this.misaligned(addr, size, w, pc);
        const v = size === 4 ? b : b & ((1 << (8 * size)) - 1);
        this.d_memOld = this.mem.write(addr, size, v);
        this.d_memAddr = addr;
        this.d_memVal = v >>> 0;
        memSize = size;
        break;
      }
      case 0b1100011: { // BRANCH
        let taken;
        switch (f3) {
          case 0: taken = a === b; break;
          case 1: taken = a !== b; break;
          case 4: taken = (a | 0) < (b | 0); break;
          case 5: taken = (a | 0) >= (b | 0); break;
          case 6: taken = a < b; break;
          case 7: taken = a >= b; break;
          default: throw this.bad(w, pc);
        }
        if (taken) {
          cls = BR_T;
          const off = ((w >> 31) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3f) << 5) | (((w >>> 8) & 0xf) << 1);
          next = (pc + off) >>> 0;
        } else {
          cls = BR_N;
        }
        break;
      }
      case 0b1101111: { // JAL
        cls = JUMP;
        const off = ((w >> 31) << 20) | (((w >>> 12) & 0xff) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3ff) << 1);
        next = (pc + off) >>> 0;
        value = pc + 4;
        dest = rd;
        break;
      }
      case 0b1100111: // JALR
        if (f3 !== 0) throw this.bad(w, pc);
        cls = JUMP;
        next = ((a + (w >> 20)) & ~1) >>> 0;
        value = pc + 4;
        dest = rd;
        break;
      case 0b0110111: value = w & 0xfffff000; dest = rd; break; // LUI
      case 0b0010111: value = pc + (w & 0xfffff000); dest = rd; break; // AUIPC
      case 0b0001111: cls = SYSTEM; break; // FENCE, FENCE.I: no-operations
      case 0b1110011: { // SYSTEM
        if (f3 !== 0 || rd !== 0 || rs1 !== 0) throw this.bad(w, pc);
        cls = SYSTEM;
        const funct12 = w >>> 20;
        if (funct12 === 1) {
          halt = true; // ebreak
        } else if (funct12 === 0) {
          const num = x[17];
          if (num === SYS_EXIT) {
            halt = true;
          } else if (num === SYS_WRITE) {
            const fd = x[10];
            const buf = x[11];
            const n = x[12];
            if (fd !== 1 && fd !== 2) throw new SimError(`write to unsupported file descriptor ${fd}`);
            for (let k = 0; k < n; k++) this.output.push(this.mem.readByte((buf + k) >>> 0));
            outLen = n;
            value = n;
            dest = 10;
          } else {
            throw new SimError(`unsupported ecall a7=${num}`);
          }
        } else {
          throw this.bad(w, pc);
        }
        break;
      }
      default:
        throw this.bad(w, pc);
    }

    // Commit (nothing below can fail).
    this.d_pc = pc;
    this.d_word = w;
    this.d_cls = cls;
    this.d_next = next;
    this.d_memSize = memSize;
    this.d_outLen = outLen;
    this.d_halt = halt;
    if (dest !== 0) {
      this.d_rd = dest;
      this.d_regOld = x[dest];
      x[dest] = value;
    } else {
      this.d_rd = 0;
    }
    if (this.uninitCheck) {
      const now = this.instret + 1;
      if (dest !== 0 && this.regWritten[dest] > now) this.regWritten[dest] = now;
      if (memSize && this.inStack(this.d_memAddr, memSize, -65536)) {
        for (let k = 0; k < memSize; k++) {
          const at = (this.d_memAddr + k) >>> 0;
          if (!(this.stackWritten.get(at) <= now)) this.stackWritten.set(at, now);
        }
      }
    }
    if (halt) {
      this.halted = true;
      if (w === 0x00000073) this.exitCode = x[10];
    }
    this.d_abiChanged = false;
    if (this.abiCheck && (op === 0b1101111 || op === 0b1100111)) {
      this.d_abiChanged = true;
      this.d_abiTopOld = this.abiTop;
      this.d_abiViolOld = this.abiViolations.length;
      this.abiTrack(pc, op, rd, next);
    }
    this.pc = next;
    this.d_spChanged = false;
    if (x[2] < this.spMin) {
      this.d_spChanged = true;
      this.d_spMinOld = this.spMin;
      this.spMin = x[2];
    }
    this.countArr[cls] += 1;
    this.instret += 1;
    return STEP_DONE;
  }

  bad(w, pc) {
    return new SimError(`unsupported instruction ${h8(w)} at ${h8(pc)}`);
  }

  /** Whether [addr, addr + size) lies in the stack: from the lowest sp so far (less `below`) up to the initial sp. */
  inStack(addr, size, below = 0) {
    return this.spTop !== 0 && addr + size <= this.spTop && addr >= this.spMin + below;
  }

  /**
   * The reads of the instruction about to execute (WS-F-147): a register other than x0 and sp that
   * nothing has written since reset, or a stack word with a byte nothing has stored. Saving a
   * callee-saved register or ra to the stack is not a use of it (a procedure's prologue does it).
   */
  uninitReads(pc, w, op, rs1, rs2) {
    const now = this.instret + 1;
    const list = this.uninitWarnings;
    while (list.length && list[list.length - 1].count >= now) list.pop(); // a step taken again after step back
    const regs = [];
    switch (op) {
      case 0b0110011: case 0b0100011: case 0b1100011: regs.push(rs1, rs2); break; // OP, STORE, BRANCH
      case 0b0010011: case 0b0000011: case 0b1100111: regs.push(rs1); break; // OP-IMM, LOAD, JALR
      case 0b1110011: // ecall: the number and the arguments of the call it makes
        if (w === 0x00000073) {
          regs.push(17);
          if (this.x[17] === SYS_EXIT) regs.push(10);
          else if (this.x[17] === SYS_WRITE) regs.push(10, 11, 12);
        }
        break;
      default: break;
    }
    const saving = op === 0b0100011 && ((w >>> 12) & 7) === 2 && SAVE_ON_STACK.has(rs2)
      && this.inStack((this.x[rs1] + (((w >> 25) << 5) | ((w >>> 7) & 31))) >>> 0, 4, -2048);
    for (const r of new Set(regs)) {
      if (r === 0 || this.regWritten[r] < now || (saving && r === rs2)) continue;
      list.push({ count: now, pc, reg: r, text: `${h8(pc)}: reads x${r} (${ABI_NAMES[r]}), which nothing has written since reset` });
    }
    if (op === 0b0000011) {
      const f3 = (w >>> 12) & 7;
      const size = f3 === 2 ? 4 : (f3 & 3) === 1 ? 2 : 1;
      const addr = (this.x[rs1] + (w >> 20)) >>> 0;
      if (this.inStack(addr, size)) {
        for (let k = 0; k < size; k++) {
          if (!(this.stackWritten.get((addr + k) >>> 0) < now)) {
            list.push({ count: now, pc, addr, text: `${h8(pc)}: loads the stack word at ${h8(addr)}, which nothing has stored since reset` });
            break;
          }
        }
      }
    }
  }

  /** The warnings of the uninitialised-value check up to the current instruction. */
  get uninitSoFar() {
    const n = this.instret;
    return this.uninitWarnings.filter((u) => u.count <= n);
  }

  misaligned(addr, size, w, pc) {
    return new SimError(`misaligned ${size}-byte access at ${h8(addr)} (instruction ${h8(w)} at ${h8(pc)})`);
  }

  /** Execute one instruction; return its change record, or null once halted. */
  step() {
    if (this.halted) return null;
    const pc = this.pc;
    if (this.stepFast() === STEP_HALT_WORD) return { pc, word: HALT_WORD, halt: true, nextPc: pc };
    return {
      pc, word: this.d_word, cls: CLASSES[this.d_cls], nextPc: this.d_next,
      reg: this.d_rd ? { rd: this.d_rd, old: this.d_regOld, value: this.x[this.d_rd] } : null,
      mem: this.d_memSize ? { addr: this.d_memAddr, size: this.d_memSize, value: this.d_memVal, old: this.d_memOld } : null,
      halt: this.d_halt,
      output: this.d_outLen ? this.output.slice(this.output.length - this.d_outLen) : null,
    };
  }

  abiTrack(pc, op, rd, next) {
    if (rd === 1) { // a call: jal/jalr writing ra
      if (this.x[2] % 16) {
        this.abiViolations.push(`call at ${h8(pc)} to ${h8(next)}: sp = ${h8(this.x[2])} is not 16-byte aligned`);
      }
      const saved = new Uint32Array(SAVED_REGS.length);
      SAVED_REGS.forEach((r, k) => { saved[k] = this.x[r]; });
      const parent = this.abiTop;
      // args: a0-a7 at the call, for the call-stack panel (WS-F-143)
      this.abiTop = { call: pc, target: next, ret: (pc + 4) >>> 0, saved, args: this.x.slice(10, 18), sp: this.x[2], parent, depth: (parent?.depth ?? 0) + 1 };
    } else if (op === 0b1100111 && rd === 0) { // a possible return
      let f = this.abiTop;
      while (f && f.ret !== next) f = f.parent;
      if (!f) return; // an indirect jump, not a return
      this.abiTop = f.parent;
      SAVED_REGS.forEach((r, k) => {
        if (this.x[r] !== f.saved[k]) {
          this.abiViolations.push(`call at ${h8(f.call)} to ${h8(f.target)}: returned with `
            + `${ABI_NAMES[r]} changed (${h8(f.saved[k])} -> ${h8(this.x[r])})`);
        }
      });
    }
  }

  get callDepth() {
    return this.abiTop ? this.abiTop.depth : 0;
  }

  /** Architectural state, for the Worker (structured-clonable). */
  snapshot() {
    return {
      x: this.x.slice(), pc: this.pc, countArr: this.countArr.slice(), instret: this.instret,
      halted: this.halted, exitCode: this.exitCode, output: this.output.slice(),
      spTop: this.spTop, spMin: this.spMin, abiCheck: this.abiCheck, abiTop: this.abiTop,
      abiViolations: this.abiViolations.slice(), pages: this.mem.copyPages(),
      uninitCheck: this.uninitCheck, regWritten: this.regWritten.slice(), stackWritten: new Map(this.stackWritten),
      uninitWarnings: this.uninitWarnings.slice(),
      ipages: this.imem === this.mem ? null : this.imem.copyPages(),
    };
  }

  restore(s) {
    this.x = s.x;
    this.pc = s.pc;
    this.countArr = s.countArr;
    this.instret = s.instret;
    this.halted = s.halted;
    this.exitCode = s.exitCode;
    this.output = s.output;
    this.spTop = s.spTop;
    this.spMin = s.spMin;
    this.abiCheck = s.abiCheck;
    this.abiTop = s.abiTop;
    this.abiViolations = s.abiViolations;
    if (s.regWritten) {
      this.uninitCheck = s.uninitCheck;
      this.regWritten = s.regWritten;
      this.stackWritten = s.stackWritten;
      this.uninitWarnings = s.uninitWarnings;
    }
    this.mem.setPages(s.pages);
    if (s.ipages) this.imem.setPages(s.ipages);
  }

  /** Report in the shape of rvsim.Hart.report() without a CPI table. */
  report() {
    return {
      instructions: this.instret,
      by_class: this.counts,
      halt_pc: this.pc,
      exit_code: this.exitCode,
      registers: Array.from(this.x),
      stack_bytes: this.spTop - this.spMin,
    };
  }
}

function aluOp(f3, f7, a, b) {
  const sh = b & 31;
  if (f7 === 0x00) {
    switch (f3) {
      case 0: return a + b;
      case 1: return a << sh;
      case 2: return (a | 0) < (b | 0) ? 1 : 0;
      case 3: return a < b ? 1 : 0;
      case 4: return a ^ b;
      case 5: return a >>> sh;
      case 6: return a | b;
      default: return a & b;
    }
  }
  if (f7 === 0x20) {
    if (f3 === 0) return a - b;
    if (f3 === 5) return (a | 0) >> sh;
  }
  return null;
}

// M extension. Quotients round towards zero; the remainder takes the sign of
// the dividend; division by zero and signed overflow give the results of the
// specification's table, as rvsim.py does.
function mulDiv(f3, a, b) {
  if (f3 === 0) return Math.imul(a, b);
  const overflow = (a | 0) === -0x80000000 && (b | 0) === -1;
  switch (f3) {
    case 1: return Number(BigInt.asIntN(32, (BigInt(a | 0) * BigInt(b | 0)) >> 32n));
    case 2: return Number(BigInt.asIntN(32, (BigInt(a | 0) * BigInt(b >>> 0)) >> 32n));
    case 3: return Number(BigInt.asUintN(32, (BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n));
    case 4: if (b === 0) return -1; if (overflow) return a; return Number(BigInt(a | 0) / BigInt(b | 0));
    case 5: if (b === 0) return 0xffffffff; return Number(BigInt(a >>> 0) / BigInt(b >>> 0));
    case 6: if (b === 0) return a; if (overflow) return 0; return Number(BigInt(a | 0) % BigInt(b | 0));
    default: if (b === 0) return a; return Number(BigInt(a >>> 0) % BigInt(b >>> 0));
  }
}

/** Run until halt; stop with SimError after `limit` instructions (WS-F-090). */
export function run(hart, limit = 10_000_000, onStep = null) {
  while (!hart.halted) {
    if (hart.instret >= limit) throw new SimError(`no halt within ${limit} instructions and traps`);
    const rec = hart.step();
    if (rec && rec.cls && onStep) onStep(rec);
  }
  return hart;
}

/** One line of the JSON-lines trace of WS-V-010, as rvsim.py --trace-json writes it (iss profile). */
export function traceLine(rec) {
  const o = { pc: rec.pc, word: rec.word };
  if (rec.reg) { o.rd = rec.reg.rd; o.rd_value = rec.reg.value; }
  if (rec.mem) { o.mem_addr = rec.mem.addr; o.mem_size = rec.mem.size; o.mem_value = rec.mem.value; }
  return JSON.stringify(o);
}
