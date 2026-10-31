// sap-1/bus-model.js -- the SAP-1 bus view's model (arch-contract.md phase 5): one clock is one timing state. A ring
// counter gives six states per instruction: T1 to T3 fetch (address, increment, memory), T4 to T6 execute; HLT stops
// the clock in T4. In each state the controller asserts control signals; at most one unit drives the W bus, the
// loading units take its value at the positive clock edge half-way through the state. The control word, its signal
// names, polarities and destinations, the clock and clear lines and the microprogram follow Malvino and Brown, Digital
// Computer Electronics, 3rd ed., ch. 10 (Fig. 10-1, Table 10-5, Figs. 10-12 to 10-15; author, 2026-10-29). Same results
// as the instruction-level engine at every instruction boundary (test/sap1-bus-model.test.mjs). The simulator's own
// code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { OPCODES, MNEMONIC_OF, MEMORY_BYTES } from './language.js';
import { SAP1_STRINGS as S } from './strings.js';
import { OUTPUT_KEEP } from '../contract.js';

/** Clocks kept for step back (as the engine's history); the oldest go first. */
const JOURNAL_KEEP = 1_000_000;

/**
 * The twelve signals of the control word CON = Cp Ep Lm' CE' Li' Ei' La' Ea Su Eu Lb' Lo', most significant first, each
 * with whether it is active low and the unit it goes to (the one source of all three; the drawing, the inspector and
 * the tests read them from here). Cp and Ep: increment and enable the program counter; Lm: load MAR; CE: enable the
 * memory; Li, Ei: load and enable the instruction register (Ei puts its lower nibble on the bus); La, Ea: load and enable
 * A; Su: subtract; Eu: enable the adder-subtracter; Lb: load B; Lo: load the output register.
 */
export const SIGNALS = Object.freeze([
  ['Cp', false, 'PC'], ['Ep', false, 'PC'], ['Lm', true, 'MAR'], ['CE', true, 'RAM'], ['Li', true, 'IR'], ['Ei', true, 'IR'],
  ['La', true, 'A'], ['Ea', false, 'A'], ['Su', false, 'ALU'], ['Eu', false, 'ALU'], ['Lb', true, 'B'], ['Lo', true, 'OUT'],
].map(([name, low, unit]) => Object.freeze({ name, low, unit })));

/**
 * The clock, clear and halt lines, which are not part of CON: the clock generator (Fig. 10-14: clock circuit, clear-start
 * debouncer) sends CLK to MAR, IR, A, B, OUT and the ring counter (which advances on its negative edge), its complement
 * to the program counter (whose negative edge, the positive edge of CLK, increments it), CLR' to the program counter and
 * the ring counter, CLR to the instruction register; the instruction decoder sends HLT' (opcode 1111) back to the clock.
 * `bar`: the name is written with an overbar; `low`: asserted when low.
 */
export const CLOCK_LINES = Object.freeze([
  { name: 'nCLK', bar: true, low: false, from: 'CLKG', to: ['PC'] },
  { name: 'nCLR', bar: true, low: true, from: 'CLKG', to: ['PC', 'CTRL'] },
  { name: 'CLK', bar: false, low: false, from: 'CLKG', to: ['MAR', 'IR', 'A', 'B', 'OUT', 'CTRL'] },
  { name: 'CLR', bar: false, low: false, from: 'CLKG', to: ['IR'] },
  { name: 'nHLT', bar: true, low: true, from: 'CTRL', to: ['CLKG'] },
].map((x) => Object.freeze({ ...x, to: Object.freeze(x.to) })));

/** Whether the instruction decoder asserts HLT' (low): the opcode in IR is 1111. */
export const haltLine = (ir) => ir >> 4 === OPCODES.HLT;

const FETCH = [['Ep', 'Lm'], ['Cp'], ['CE', 'Li']];
const EXECUTE = {
  [OPCODES.LDA]: [['Ei', 'Lm'], ['CE', 'La'], []],
  [OPCODES.ADD]: [['Ei', 'Lm'], ['CE', 'Lb'], ['Eu', 'La']],
  [OPCODES.SUB]: [['Ei', 'Lm'], ['CE', 'Lb'], ['Su', 'Eu', 'La']],
  [OPCODES.OUT]: [['Ea', 'Lo'], [], []],
  [OPCODES.HLT]: [[], [], []],
};

/** The signals asserted in timing state t (1 to 6) for the instruction in IR (only its opcode matters from T4). */
export function controlSignals(t, ir) {
  if (t <= 3) return FETCH[t - 1];
  return EXECUTE[ir >> 4]?.[t - 4] ?? [];
}

/** The control word as bits in SIGNALS order (an active-low signal is 0 when asserted), as a number. */
export function controlWord(active) {
  return SIGNALS.reduce((w, s) => (w << 1) | (active.includes(s.name) !== s.low ? 1 : 0), 0);
}

const add = (a, b) => (a + b) & 0xff;
const sub = (a, b) => (a - b) & 0xff;

export class BusModel {
  constructor(program) {
    this.image = new Uint8Array(MEMORY_BYTES);
    for (const seg of program?.segments ?? []) this.image.set(seg.bytes.slice(0, MEMORY_BYTES - seg.address), seg.address);
    this.entry = (program?.entry ?? 0) & 0xf;
    this.reset();
  }

  reset() {
    this.mem = this.image.slice();
    this.regs = { A: 0, B: 0, OUT: 0, PC: this.entry, IR: 0, MAR: 0 };
    this.t = 1; // the timing state the next clock performs
    this.cycle = 0;
    this.retired = 0;
    this.halted = false;
    this.error = null;
    this.instrPc = this.entry; // the address of the instruction being fetched or executed
    this.last = null; // what the newest clock did: {t, signals, bus, driver, loads}
    this.output = '';
    this.outBase = 0; // characters of output dropped by the cap (OUTPUT_KEEP)
    this.journal = [];
  }

  /** What timing state `t` does now, without doing it: the signals, the bus value and its driver, the loads. */
  evaluate() {
    const { regs, mem } = this;
    const signals = controlSignals(this.t, regs.IR);
    const on = (n) => signals.includes(n);
    let bus = null;
    let driver = null;
    if (on('Ep')) { bus = regs.PC; driver = 'PC'; }
    else if (on('CE')) { bus = mem[regs.MAR]; driver = 'RAM'; }
    else if (on('Ei')) { bus = regs.IR & 0xf; driver = 'IR'; }
    else if (on('Ea')) { bus = regs.A; driver = 'A'; }
    else if (on('Eu')) { bus = on('Su') ? sub(regs.A, regs.B) : add(regs.A, regs.B); driver = 'ALU'; }
    const loads = [];
    if (on('Lm')) loads.push(['MAR', bus & 0xf]);
    if (on('Li')) loads.push(['IR', bus]);
    if (on('La')) loads.push(['A', bus]);
    if (on('Lb')) loads.push(['B', bus]);
    if (on('Lo')) loads.push(['OUT', bus]);
    if (on('Cp')) loads.push(['PC', (regs.PC + 1) & 0xf]);
    return { t: this.t, signals, bus, driver, loads, word: controlWord(signals) };
  }

  /** One clock. Returns 'step', 'halt' or 'error'. */
  step() {
    if (this.halted) return this.error ? 'error' : 'halt';
    const op = this.regs.IR >> 4;
    if (this.t === 4 && MNEMONIC_OF[op] === undefined) {
      this.error = S.engine.badOpcode(op, this.instrPc);
      this.halted = true;
      return 'error';
    }
    this.journal.push({ regs: { ...this.regs }, t: this.t, cycle: this.cycle, retired: this.retired, instrPc: this.instrPc,
      last: this.last, output: this.outBase + this.output.length });
    if (this.journal.length > 2 * JOURNAL_KEEP) this.journal.splice(0, JOURNAL_KEEP);
    const e = this.evaluate();
    for (const [id, v] of e.loads) this.regs[id] = v;
    this.cycle += 1;
    this.last = e;
    if (e.loads.some(([id]) => id === 'OUT')) {
      this.output += S.engine.out(this.regs.OUT);
      if (this.output.length > 2 * OUTPUT_KEEP) { const drop = this.output.length - OUTPUT_KEEP; this.output = this.output.slice(drop); this.outBase += drop; }
    }
    if (this.t === 4 && op === OPCODES.HLT) { // HLT stops the clock: the ring counter stays in T4
      this.halted = true;
      this.retired += 1;
      return 'halt';
    }
    if (this.t === 6) { this.retired += 1; this.t = 1; this.instrPc = this.regs.PC; } else this.t += 1;
    return 'step';
  }

  /** Undo the newest clock; false at the start. */
  back() {
    if (this.error) { this.error = null; this.halted = false; return true; }
    const j = this.journal.pop();
    if (!j) return false;
    Object.assign(this, { regs: j.regs, t: j.t, cycle: j.cycle, retired: j.retired, instrPc: j.instrPc, last: j.last });
    if (j.output >= this.outBase) this.output = this.output.slice(0, j.output - this.outBase);
    else { this.output = ''; this.outBase = j.output; } // back past what the cap dropped
    this.halted = false;
    return true;
  }

  /** The rest of the instruction: clocks up to the next T1 (or the stop). */
  stepInstruction() {
    let r = this.step();
    while (r === 'step' && this.t !== 1) r = this.step();
    return r;
  }

  /** Back to the T1 of the instruction (or of the previous one when already there). */
  backInstruction() {
    if (!this.back()) return false;
    while (this.t !== 1 && this.back());
    return true;
  }
}
