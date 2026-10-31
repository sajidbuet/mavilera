// sap-2/engine.js -- the SAP-2 instruction-level engine on the contract (Engine, spec W-D29; plan step 3 of
// docs/architecture/sap-2-plan.md). One step is a whole instruction (fetch and execute); the timing states are the bus
// view's. The 43 instructions of the reference sheet (docs/architecture/sap-2-reference.md §2) with its decisions (§9):
// S and Z set by the ten flag instructions from their 8-bit result; INR and DCR of B or C keep A (decision 2); CALL
// keeps the return address low byte at FFFEH, high byte at FFFFH, and RET takes it from there (decision 3); 0000H-07FFH
// is read-only, a STA there stops the run with an error (decision 4); IN takes port 1 or 2, OUT port 3 or 4, a byte
// naming another port stops the run with an error (decision 5); the keyboard handshake of decision 6. A byte that is
// not an op code stops the run with an error. Arithmetic wraps modulo 256, the PC modulo 64K.
//
// Registers: A, B, C, the flags S and Z, PC, IR, and the ports IN1, IN2, OUT3, OUT4 (8 bits). MAR, MDR and TMP are
// left to the bus view, whose microprogram (decision 7) fixes their values (author, 2026-10-30). The ports are part of
// the machine's state: `input` enters a key (port 1, and READY, port 2 bit 0) or sets the SERIAL IN switch (port 2
// bit 7) between steps. Each input is logged with the step count at which it was entered (author, 2026-10-30): step
// back past it withdraws it, `inputs()` returns the log, and an engine created with `{inputs}` applies each logged
// input when its step count is reached, so that a reload or the Worker replays the run as it was.
//
// Step back keeps, for each step, the registers before it in two numbers, the memory byte(s) it overwrote (STA: one;
// CALL: two) in one number, and the output's length, in a ring of `historyLimit` steps. The call depth (CALL adds one,
// RET takes one, down to 0) is kept with the registers; SAP-2 has no stack, so a nested CALL overwrites the return
// address of the outer one, as the hardware does. The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP, OUTPUT_KEEP } from '../contract.js';
import { BY_OPCODE, MNEMONICS, PORTS, RETURN_ADDRESS, memoryImage, wordOf } from './language.js';
import { SAP2_STRINGS as S } from './strings.js';

export const REGISTER_IDS = Object.freeze(['A', 'B', 'C', 'S', 'Z', 'PC', 'IR', 'IN1', 'IN2', 'OUT3', 'OUT4']);
/** The read-only region at the bottom of the memory (reference sheet §3, decision 4). */
export const ROM_BYTES = 0x0800;
/** Port 2: READY from the keyboard encoder (bit 0), SERIAL IN (bit 7); port 4: SERIAL OUT (bit 0), ACKNOWLEDGE (bit 7). */
export const PORT_BITS = Object.freeze({ READY: 0x01, SERIAL_IN: 0x80, SERIAL_OUT: 0x01, ACKNOWLEDGE: 0x80 });

const CALL = 0xcd;
const at = (a) => a & 0xffff;
const wordAt = (read, a) => read(a) | (read(at(a + 1)) << 8); // low byte first

/**
 * What the instruction at regs.PC does: its step record (contract StepRecord), the registers after it, its T states,
 * the change of the call depth, its console output and whether it halts; or `error` (nothing is changed). `read`
 * reads a memory byte.
 */
export function execute(regs, read) {
  const pc = regs.PC;
  const op = read(pc);
  const ins = BY_OPCODE[op];
  if (!ins) return { error: S.engine.badOpcode(op, pc) };
  const bytes = Array.from({ length: ins.bytes }, (_, k) => read(at(pc + k)));
  const operand = ins.bytes === 3 ? bytes[1] | (bytes[2] << 8) : bytes[1];
  const writes = [['IR', op]];
  const memory = [];
  const reads = [];
  let nextPc = at(pc + ins.bytes);
  let states = ins.states;
  let call = 0;
  let output = '';
  const flagged = (id, v) => writes.push([id, v & 0xff], ['S', (v >> 7) & 1], ['Z', (v & 0xff) === 0 ? 1 : 0]);
  const src = ins.operand === 'byte' ? operand : regs[ins.regs[0]]; // the ALU's second operand
  const jump = (taken) => { if (taken) nextPc = operand; else states = ins.notTaken; };
  switch (ins.mnemonic) {
    case 'ADD': flagged('A', regs.A + src); break;
    case 'SUB': flagged('A', regs.A - src); break;
    case 'ANA': case 'ANI': flagged('A', regs.A & src); break;
    case 'ORA': case 'ORI': flagged('A', regs.A | src); break;
    case 'XRA': case 'XRI': flagged('A', regs.A ^ src); break;
    case 'INR': flagged(ins.regs[0], regs[ins.regs[0]] + 1); break;
    case 'DCR': flagged(ins.regs[0], regs[ins.regs[0]] - 1); break;
    case 'CMA': writes.push(['A', regs.A ^ 0xff]); break;
    case 'RAL': writes.push(['A', ((regs.A << 1) | (regs.A >> 7)) & 0xff]); break;
    case 'RAR': writes.push(['A', (regs.A >> 1) | ((regs.A & 1) << 7)]); break;
    case 'MOV': writes.push([ins.regs[0], regs[ins.regs[1]]]); break;
    case 'MVI': writes.push([ins.regs[0], operand]); break;
    case 'LDA': reads.push({ address: operand, size: 1 }); writes.push(['A', read(operand)]); break;
    case 'STA':
      if (operand < ROM_BYTES) return { error: S.engine.romWrite(operand, pc) };
      memory.push({ address: operand, size: 1, old: read(operand), value: regs.A });
      break;
    case 'JMP': jump(true); break;
    case 'JZ': jump(regs.Z === 1); break;
    case 'JNZ': jump(regs.Z === 0); break;
    case 'JM': jump(regs.S === 1); break;
    case 'CALL':
      memory.push({ address: RETURN_ADDRESS, size: 2, old: wordAt(read, RETURN_ADDRESS), value: nextPc });
      nextPc = operand;
      call = 1;
      break;
    case 'RET':
      reads.push({ address: RETURN_ADDRESS, size: 2 });
      nextPc = wordAt(read, RETURN_ADDRESS);
      call = -1;
      break;
    case 'IN':
      if (!PORTS.IN.includes(operand)) return { error: S.engine.badPort('IN', operand, pc) };
      writes.push(['A', regs[`IN${operand}`]]);
      break;
    case 'OUT':
      if (!PORTS.OUT.includes(operand)) return { error: S.engine.badPort('OUT', operand, pc) };
      writes.push([`OUT${operand}`, regs.A]);
      if (operand === 3) output = S.engine.out(regs.A);
      // ACKNOWLEDGE resets READY (decision 6)
      if (operand === 4 && regs.A & PORT_BITS.ACKNOWLEDGE && regs.IN2 & PORT_BITS.READY) writes.push(['IN2', regs.IN2 & ~PORT_BITS.READY]);
      break;
    default: break; // NOP, HLT
  }
  const after = { ...regs, PC: nextPc };
  const rec = { pc, word: wordOf(bytes), size: ins.bytes, nextPc, registers: [], memory, reads };
  for (const [id, value] of writes) { // one entry per register
    const w = rec.registers.find((r) => r.id === id);
    if (w) w.value = value; else rec.registers.push({ id, old: regs[id], value });
    after[id] = value;
  }
  return { rec, after, ins, states, call, output, halt: op === 0x76 };
}

// the registers in two numbers: A, B, C, IR at 8 bits and PC at 16 (48 bits); the four ports at 8 bits, S, Z, and
// the call depth at 16 (50 bits)
const DEPTH_MAX = 0xffff;
const pack1 = (r) => r.A + r.B * 2 ** 8 + r.C * 2 ** 16 + r.IR * 2 ** 24 + r.PC * 2 ** 32;
const pack2 = (r, depth) => r.IN1 + r.IN2 * 2 ** 8 + r.OUT3 * 2 ** 16 + r.OUT4 * 2 ** 24 + r.S * 2 ** 32 + r.Z * 2 ** 33 + depth * 2 ** 34;
const field = (n, shift, bits) => Math.floor(n / 2 ** shift) % 2 ** bits;
const unpack = (n1, n2) => ({ A: field(n1, 0, 8), B: field(n1, 8, 8), C: field(n1, 16, 8), S: field(n2, 32, 1), Z: field(n2, 33, 1),
  PC: field(n1, 32, 16), IR: field(n1, 24, 8), IN1: field(n2, 0, 8), IN2: field(n2, 8, 8), OUT3: field(n2, 16, 8), OUT4: field(n2, 24, 8) });
// the memory a step overwrote: address, size (1 or 2) and the old value (low byte first); -1 for none
const packUndo = (m) => (m ? m.address + m.size * 2 ** 16 + m.old * 2 ** 18 : -1);
const unpackUndo = (n) => ({ address: field(n, 0, 16), size: field(n, 16, 2), old: Math.floor(n / 2 ** 18) });

/** The engine for one program (contract Engine). */
export function create(program, { historyLimit = 1_000_000, runLimit = 10_000_000, inputs: seed = [] } = {}) {
  const image = memoryImage(program);
  const cap = Math.max(1, historyLimit);
  let mem, regs, depth, counts, states, halted, error, retired, steps, dropped, output, outBase; // outBase: characters dropped (OUTPUT_KEEP)
  let log; // the inputs, {at, key?, serialIn?}, in the order entered: `at` is the step count then
  // the history: a ring of the registers before each step, what it overwrote and the output's length then; `size`
  // entries end at `end`
  let before1, before2, undo, outLen, end, size;

  const reset = () => {
    mem = image.slice();
    regs = { A: 0, B: 0, C: 0, S: 0, Z: 0, PC: program.entry & 0xffff, IR: 0, IN1: 0, IN2: 0, OUT3: 0, OUT4: 0 };
    depth = 0;
    counts = {}; // instructions executed, by op code
    states = 0; // T states (reference sheet §2)
    halted = false; error = null; retired = 0; steps = 0; dropped = 0; output = ''; outBase = 0;
    before1 = []; before2 = []; undo = []; outLen = []; end = 0; size = 0;
    log = seed.map((x) => ({ ...x }));
    arrive();
  };

  const apply = ({ key, serialIn }) => {
    if (key !== undefined) { regs.IN1 = key & 0xff; regs.IN2 |= PORT_BITS.READY; }
    if (serialIn !== undefined) regs.IN2 = serialIn ? regs.IN2 | PORT_BITS.SERIAL_IN : regs.IN2 & ~PORT_BITS.SERIAL_IN;
  };
  /** The logged inputs of the present step count (a replay). */
  function arrive() { for (const x of log) if (x.at === steps) apply(x); }
  reset();

  const read = (a) => mem[a];
  const newest = () => (end - 1 + cap) % cap;
  /** Memory as it was before the newest step (its own write undone), for last(). */
  const readBefore = () => {
    const u = undo[newest()];
    if (u < 0) return read;
    const { address, size: n, old } = unpackUndo(u);
    return (a) => (a === address ? old & 0xff : n === 2 && a === at(address + 1) ? old >> 8 : mem[a]);
  };

  const state = () => ({ pc: regs.PC, registers: { ...regs }, halted, error, retired, output, outputDropped: outBase, historyDropped: dropped, steps });

  const step = () => {
    if (halted) return null;
    const x = execute(regs, read);
    if (x.error) { error = x.error; halted = true; return null; }
    before1[end] = pack1(regs);
    before2[end] = pack2(regs, depth);
    undo[end] = packUndo(x.rec.memory[0]);
    outLen[end] = outBase + output.length; // the output's length then, counting what the cap dropped
    end = (end + 1) % cap;
    if (size < cap) size += 1; else dropped += 1;
    for (const m of x.rec.memory) for (let k = 0; k < m.size; k++) mem[at(m.address + k)] = (m.value >> (8 * k)) & 0xff;
    regs = x.after;
    depth = Math.min(DEPTH_MAX, Math.max(0, depth + x.call));
    counts[x.ins.opcode] = (counts[x.ins.opcode] ?? 0) + 1;
    states += x.states;
    retired += 1;
    steps += 1;
    output += x.output;
    if (output.length > 2 * OUTPUT_KEEP) { const drop = output.length - OUTPUT_KEEP; output = output.slice(drop); outBase += drop; }
    if (x.halt) halted = true;
    arrive();
    return { ...x.rec, ...(x.halt ? { halt: true } : {}), ...(x.output ? { output: x.output } : {}) };
  };

  const back = () => {
    if (error) { error = null; halted = false; return true; } // the failed step changed nothing else
    if (!size) return false;
    const i = newest();
    if (undo[i] >= 0) {
      const { address, size: n, old } = unpackUndo(undo[i]);
      for (let k = 0; k < n; k++) mem[at(address + k)] = (old >> (8 * k)) & 0xff;
    }
    regs = unpack(before1[i], before2[i]);
    depth = field(before2[i], 34, 16);
    if (outLen[i] >= outBase) output = output.slice(0, outLen[i] - outBase);
    else { output = ''; outBase = outLen[i]; } // back past what the cap dropped: the output from here on
    const x = execute(regs, read); // the step undone, again: its op code and T states
    counts[x.ins.opcode] -= 1;
    states -= x.states;
    end = i;
    size -= 1;
    halted = false;
    retired -= 1;
    steps -= 1;
    log = log.filter((y) => y.at <= steps); // the inputs entered after the step undone are withdrawn
    return true;
  };

  const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, depth: within = null, resumed = false, watch = {} } = {}) => {
    const wr = watch.registers ?? new Set();
    const wm = watch.memory ?? new Set();
    for (let i = 0; i < chunk; i++) {
      if (halted) return error ? STOP.ERROR : STOP.HALT;
      if (steps >= runLimit) return STOP.BUDGET;
      if (i > 0 || resumed) {
        if (breakpoints.has(regs.PC)) return STOP.BREAK;
        if (regs.PC === target && (within === null || depth <= within)) return STOP.TARGET;
      }
      const rec = step();
      if (!rec) return STOP.ERROR;
      if (rec.halt) return STOP.HALT;
      if (wr.size && rec.registers.some((r) => wr.has(r.id))) return STOP.WATCH;
      if (wm.size && rec.memory.some((m) => wm.has(m.address) || (m.size === 2 && wm.has(at(m.address + 1))))) return STOP.WATCH;
    }
    return STOP.CHUNK;
  };

  /** The history oldest first, for the snapshot. */
  const ordered = (a) => Array.from({ length: size }, (_, k) => a[(end - size + k + cap) % cap]);

  return {
    reset, step, back, run, state,
    last: () => (size ? execute(unpack(before1[newest()], before2[newest()]), readBefore()).rec : null),
    peek: (address, length) => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = mem[at(address + i)];
      return out;
    },
    /** SAP-2's input ports (decision 6): `key` enters a byte on port 1 and sets READY; `serialIn` sets the SERIAL IN switch. */
    input: ({ key, serialIn } = {}) => {
      const x = { at: steps, ...(key !== undefined ? { key: key & 0xff } : {}), ...(serialIn !== undefined ? { serialIn: serialIn ? 1 : 0 } : {}) };
      log.push(x);
      apply(x);
    },
    /** The inputs since the reset, for a replay: pass them to create() as `inputs`. */
    inputs: () => log.map((x) => ({ ...x })),
    callDepth: () => depth,
    stepOverTarget: () => (!halted && mem[regs.PC] === CALL ? at(regs.PC + 3) : null),
    stepOutTarget: () => (depth > 0 ? wordAt(read, RETURN_ADDRESS) : null),
    /**
     * The call stack (contract v2, capability callStack): SAP-2 keeps one return address, so only the innermost call
     * is known, at the call depth; its site is the three bytes before the return address, and its target that CALL's
     * address (unknown if those bytes are no longer a CALL).
     */
    callStack: () => {
      if (!depth) return [];
      const ret = wordAt(read, RETURN_ADDRESS);
      const call = at(ret - 3);
      const isCall = mem[call] === CALL;
      return [{ depth, target: isCall ? wordAt(read, at(call + 1)) : ret, ...(isCall ? {} : { name: S.callUnknown }), call, ret, sp: null, args: [] }];
    },
    loopRange: () => {
      if (!size) return null;
      const pcs = Array.from({ length: Math.min(64, size) }, (_, k) => field(before1[(end - 1 - k + cap) % cap], 32, 16));
      return { from: Math.min(...pcs), to: Math.max(...pcs) };
    },
    counters: () => {
      const by = {};
      for (const [op, n] of Object.entries(counts)) if (n) by[BY_OPCODE[op].mnemonic] = (by[BY_OPCODE[op].mnemonic] ?? 0) + n;
      return [[S.counterNames.instructions, retired], [S.counterNames.states, states], ...MNEMONICS.filter((m) => by[m]).map((m) => [m, by[m]])];
    },
    dataAccess: () => {
      if (halted) return null;
      const ins = BY_OPCODE[mem[regs.PC]];
      if (ins?.mnemonic === 'LDA' || ins?.mnemonic === 'STA') return { address: wordAt(read, at(regs.PC + 1)), size: 1 };
      if (ins?.mnemonic === 'CALL' || ins?.mnemonic === 'RET') return { address: RETURN_ADDRESS, size: 2 };
      return null;
    },
    snapshot: () => ({ mem: mem.slice(), regs: { ...regs }, depth, counts: { ...counts }, states, halted, error, retired, steps, dropped, output, outBase,
      before1: ordered(before1), before2: ordered(before2), undo: ordered(undo), outLen: ordered(outLen), log: log.map((x) => ({ ...x })) }),
    restore: (s) => {
      mem = s.mem.slice(); regs = { ...s.regs }; counts = { ...s.counts }; log = s.log.map((x) => ({ ...x }));
      ({ depth, states, halted, error, retired, steps, dropped, output, outBase } = s);
      before1 = s.before1.slice(); before2 = s.before2.slice(); undo = s.undo.slice(); outLen = s.outLen.slice();
      size = before1.length; end = size % cap;
    },
  };
}
