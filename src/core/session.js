// session.js -- one simulation session of the ISA view: sources, assembled
// program, hart and history, with the execution controls of WS-F-090 and
// WS-F-091 (step, step back, step over, step out, run to cursor, run with a
// budget, breakpoints, watchpoints), and the files loaded into data arrays
// (WS-F-145). Pure JavaScript, no DOM: the same class
// runs in the page, in the Worker (worker/run.js) and under Node.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { assemble } from '../asm/assembler.js';
import { Hart, SimError, STEP_HALT_WORD } from './iss.js';
import { History } from './history.js';
import { applyLoads, checkFits } from '../shell/data-io.js';
import { BusError } from '../mem/bus.js';
import { defaultPlatform } from '../shell/share.js';

export const STOP = Object.freeze({
  HALT: 'halt', ERROR: 'error', BREAK: 'break', WATCH: 'watch', BUDGET: 'budget',
  TARGET: 'target', PAUSE: 'pause', CHUNK: 'chunk', NONE: 'none',
});

export class Session {
  constructor({ historyLimit = 1_000_000, runLimit = 10_000_000 } = {}) {
    this.historyLimit = historyLimit;
    this.runLimit = runLimit;
    this.files = [{ name: 'main.s', text: '' }];
    this.profile = 'iss';
    this.subset = null; // an option of the profile (spec §6): 'lab' or 'ext' for ch06
    this.program = null;
    this.hart = null;
    this.history = new History(historyLimit);
    this.breakpoints = new Set(); // addresses
    this.watchRegs = new Set(); // register numbers
    this.watchWords = new Set(); // word-aligned addresses
    this.error = null; // SimError message that stopped the run
    this.runCount = 0; // instructions since the last reset, for the budget
    this.dataLoads = []; // files loaded into data arrays (WS-F-145): [{label, bytes, name}]
    this.uninitCheck = true; // the uninitialised-value check (WS-F-147), a simulator check
    this.loadReport = { applied: [], dropped: [] };
    // The platform of the profile iss-priv: pin events of the GPIO inputs, bytes arriving at the UART, the
    // MTIME divider. Kept across resets, so that a run can be repeated; the interface adds to it.
    this.platformConfig = defaultPlatform();
  }

  /** Assemble the sources and apply the data loads; on success load a fresh hart. Returns the program. */
  assemble() {
    this.program = assemble(this.files, { profile: this.profile, subset: this.subset ?? undefined });
    this.loadReport = applyLoads(this.program, this.dataLoads);
    this.reset();
    return this.program;
  }

  /** Keep `bytes` for the data array `label` (replacing an earlier load of it); assemble again to apply. */
  loadData(label, bytes, name) {
    checkFits(this.program, label, bytes);
    this.dataLoads = [...this.dataLoads.filter((l) => l.label !== label), { label, bytes, name }];
  }

  clearData() { this.dataLoads = []; }

  get runnable() {
    return Boolean(this.program && this.program.ok && this.program.profileErrors.length === 0);
  }

  reset() {
    this.hart = this.runnable
      ? new Hart(this.program, { profile: this.profile, abiCheck: true, uninitCheck: this.uninitCheck, platformConfig: this.platformConfig })
      : null;
    this.history.clear();
    this.error = null;
    this.runCount = 0;
  }

  get halted() {
    return !this.hart || this.hart.halted || this.error !== null;
  }

  /** What the newest step changed: {pc, rd, memAddr, memSize}, or null. */
  get last() {
    return this.history.top();
  }

  /** One instruction. Returns the stop reason. */
  step() {
    if (this.halted) return this.error ? STOP.ERROR : STOP.HALT;
    const h = this.hart;
    try {
      if (h.stepFast() === STEP_HALT_WORD) return STOP.HALT;
    } catch (e) {
      if (!(e instanceof SimError || e instanceof BusError)) throw e;
      this.error = e.message;
      return STOP.ERROR;
    }
    this.history.pushFrom(h);
    this.runCount += 1;
    if (h.halted) return STOP.HALT;
    if (this.watchRegs.size && h.d_rd && this.watchRegs.has(h.d_rd)) return STOP.WATCH;
    if (this.watchWords.size && h.d_memSize) {
      const first = (h.d_memAddr & ~3) >>> 0;
      const lastWord = ((h.d_memAddr + h.d_memSize - 1) & ~3) >>> 0;
      if (this.watchWords.has(first) || this.watchWords.has(lastWord)) return STOP.WATCH;
    }
    return STOP.NONE;
  }

  /** Step back one instruction (WS-F-090). Returns false if nothing is left to undo. */
  back() {
    if (!this.hart) return false;
    if (!this.history.undo(this.hart)) {
      if (this.hart.halted) { this.hart.halted = false; return true; } // halted at the first instruction
      return false;
    }
    this.error = null;
    this.runCount -= 1;
    return true;
  }

  /**
   * Run up to `chunk` instructions, stopping at halt, error, breakpoint,
   * watchpoint, the target address or the run budget. A breakpoint or target
   * on the first instruction of a run is passed (the run starts there);
   * `resumed` marks a later slice of the same run, where it is not.
   */
  run({ chunk = 100_000, target = null, depth = null, resumed = false } = {}) {
    const bps = this.breakpoints;
    for (let i = 0; i < chunk; i++) {
      if (this.halted) return this.error ? STOP.ERROR : STOP.HALT;
      if (this.runCount >= this.runLimit) return STOP.BUDGET;
      if (i > 0 || resumed) {
        const pc = this.hart.pc;
        if (bps.size && bps.has(pc)) return STOP.BREAK;
        if (pc === target && (depth === null || this.hart.callDepth <= depth)) return STOP.TARGET;
      }
      const r = this.step();
      if (r !== STOP.NONE) return r;
    }
    return STOP.CHUNK;
  }

  callDepth() {
    return this.hart ? this.hart.callDepth : 0;
  }

  /** Target of step over: the instruction after a call (jal/jalr writing ra), else null. */
  stepOverTarget() {
    if (this.halted) return null;
    const w = this.hart.imem.read(this.hart.pc, 4);
    const op = w & 0x7f;
    const rd = (w >>> 7) & 31;
    if ((op === 0b1101111 || op === 0b1100111) && rd === 1) return (this.hart.pc + 4) >>> 0;
    return null;
  }

  /** Return address of the innermost call, for step out, or null outside a call. */
  stepOutTarget() {
    return this.hart?.abiTop ? this.hart.abiTop.ret : null;
  }

  /** Address range of the last instructions before the budget stopped a run (WS-F-090). */
  loopRange(n = 64) {
    const h = this.history;
    if (!h.size) return null;
    let lo = 0xffffffff;
    let hi = 0;
    for (let k = 0; k < Math.min(n, h.size); k++) {
      const pc = h.pcAt(k);
      if (pc < lo) lo = pc;
      if (pc > hi) hi = pc;
    }
    return { from: lo, to: hi };
  }

  // --- Worker support ---------------------------------------------------------------
  /** Everything a Worker needs to continue this session. */
  /** The profile iss-priv keeps devices and privileged state that a Worker does not carry: it runs in slices on the page. */
  get workerCapable() { return !this.hart?.priv; }

  workerRequest(opts) {
    return {
      state: this.hart.snapshot(), runCount: this.runCount, runLimit: this.runLimit,
      historyLimit: this.historyLimit, profile: this.profile, opts,
      breakpoints: [...this.breakpoints], watchRegs: [...this.watchRegs], watchWords: [...this.watchWords],
    };
  }

  /** Session inside the Worker, from a workerRequest. */
  static fromWorkerRequest(req) {
    const s = new Session({ historyLimit: req.historyLimit, runLimit: req.runLimit });
    s.profile = req.profile;
    s.program = { ok: true, profileErrors: [] };
    s.hart = new Hart({ segments: [], entry: 0 }, { profile: req.profile });
    s.hart.restore(req.state);
    s.runCount = req.runCount;
    s.breakpoints = new Set(req.breakpoints);
    s.watchRegs = new Set(req.watchRegs);
    s.watchWords = new Set(req.watchWords);
    return s;
  }

  /** Result of a Worker run, with its history. */
  workerResult(stop) {
    return { stop, error: this.error, runCount: this.runCount, state: this.hart.snapshot(), history: this.history.export() };
  }

  /** Take over the state and steps of a Worker run. */
  applyWorkerResult(res) {
    this.hart.restore(res.state);
    this.history.append(res.history);
    this.runCount = res.runCount;
    this.error = res.error;
  }
}
