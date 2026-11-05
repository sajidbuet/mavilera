// i8086/biu-model.js -- the 8086's bus interface unit and instruction queue, one clock at a time (milestone 8086-B5;
// accuracy level L2 of roadmap §5; design docs/architecture/i8086-biu.md, a draft for the author's review). The rules
// are Intel's documented ones: a six-byte queue; the BIU starts a code fetch when at least two queue bytes are empty
// and the EU has no bus request; it fetches words, and after a transfer to an odd address one byte first; a fetch
// already in progress is completed before the EU's request (IFUM 9800722-03 p. 2-6, PDF 29); a bus cycle is T1-T4,
// with wait states (Tw) after T3 (Figs 4-5, 4-6); a word operand at an odd address takes two bus cycles (p. 2-50,
// PDF 73); a transfer of control empties the queue and fetching restarts at the target (PDF 29); the queue-status
// events first byte (F), subsequent byte (S) and queue emptied (E) of Table 4-4 (p. 4-21). The EU performs one step
// of the teaching model (microops.js, [EDU]) per clock, waits for a byte when the queue is empty and for the BIU when
// it posts a bus request. Everything finer -- the two-clock prefetch hold, pre-emption before T1, the EU posting its
// request early, hidden address states -- is reverse engineering or measured behaviour and belongs to L3 (B7); it is
// switched off here. Clock counts of this model are not the 8086's. The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { runMicro } from './microops.js';
import { phys } from './cpu.js';
import { MicroModel, replay } from './micro-model.js';

/** Queue length in bytes ([INTEL] PDF 29). */
export const QUEUE_SIZE = 6;
/** Empty queue bytes needed before the 8086 BIU starts a fetch ([INTEL] PDF 29). */
export const FETCH_FREE = 2;
/** Clocks kept for step back. */
const JOURNAL_KEEP = 1_000_000;

/**
 * The bus cycles of one EU request (a `bus` step's record): a byte, or a word at an even address, is one cycle; a word
 * at an odd address, or one whose second byte wraps, is two byte cycles ([INTEL] PDF 73). I/O ports likewise.
 * Each cycle: {kind: 'read'|'write'|'in'|'out', address, size: 8|16}.
 */
export function busCycles(r) {
  const kind = r.op;
  if (kind === 'in' || kind === 'out') {
    const p = r.port & 0xffff;
    if (r.size === 8) return [{ kind, address: p, size: 8 }];
    if (!(p & 1)) return [{ kind, address: p, size: 16 }];
    return [{ kind, address: p, size: 8 }, { kind, address: (p + 1) & 0xffff, size: 8 }];
  }
  if (r.size === 8) return [{ kind, address: r.address, size: 8 }];
  if (!(r.address & 1) && r.address2 === r.address + 1) return [{ kind, address: r.address, size: 16 }];
  return [{ kind, address: r.address, size: 8 }, { kind, address: r.address2, size: 8 }];
}

/**
 * The BIU, the queue and the EU's waiting, clock by clock. The EU's steps come from a driver:
 *   driver.step      the step the EU performs next, or null (halted)
 *   driver.regs      the registers before that step (CS and IP: where its queue byte must come from)
 *   driver.prefixes  the number of prefix bytes of the current instruction
 *   driver.perform() performs the step; returns true when it finished the instruction
 * `read(address)` gives a memory byte for a code fetch. `queue` is the initial queue, [{a, v}] from the head.
 */
export class BiuCore {
  constructor({ read, ip, queue = [], waitStates = 0 }) {
    this.read = read;
    this.waitStates = waitStates;
    this.s = {
      clock: 0,
      q: queue.map(({ a, v }) => ({ a, v })), // the queue, head first: physical address and byte
      fetch: (ip + queue.length) & 0xffff, // the offset (in CS) of the next code fetch: the BIU's own pointer
      rd: 0, // the read pointer over the six cells (for the display; reset by a flush; the simulator's)
      cycle: null, // {kind: 'code'|'read'|'write'|'in'|'out', address, size, t: 'T1'|'T2'|'T3'|'Tw'|'T4', w, cs?, offset?, discard?}
      req: null, // the EU's request: {cycles, started, done}
      pos: 0, // the next byte's index in the current instruction (F or S)
    };
  }

  save() { const s = this.s; return { ...s, q: s.q.slice(), req: s.req && { ...s.req } }; }
  load(snap) { this.s = { ...snap, q: snap.q.slice(), req: snap.req && { ...snap.req } }; }

  /**
   * One clock. Order: the bus cycle in progress advances (a code fetch entering T4 puts its bytes in the queue); the EU
   * acts on the queue; if the bus is free, a cycle starts (the EU's request before a code fetch); a cycle in T4 ends
   * (the EU's request, when its last cycle ends, completes its step in this clock). Returns the
   * clock's record: {n, t, cycle, qs: 'F'|'S'|'E'|null, eu: 'step'|'queue-wait'|'bus-wait'|'halt', step, performed,
   * finished, took?: {a, v, stale}, flushTo?, q: queue length after the clock}.
   */
  clock(driver) {
    const s = this.s;
    const rec = { n: s.clock, t: 'Ti', cycle: null, qs: null, eu: 'halt', step: null, performed: false, finished: false };
    const perform = () => { rec.performed = true; rec.eu = 'step'; if (driver.perform()) { rec.finished = true; s.pos = 0; } };

    // 1. the cycle in progress
    if (s.cycle) {
      const c = s.cycle;
      let t;
      if (c.t === 'T1') t = 'T2';
      else if (c.t === 'T2') t = 'T3';
      else if (c.w < this.waitStates) t = 'Tw';
      else t = 'T4';
      s.cycle = { ...c, t, w: t === 'Tw' ? c.w + 1 : c.w };
      // read data is sampled in T3 (after any Tw) ([INTEL] PDF 245): fetched bytes are in the queue from T4
      if (t === 'T4' && c.kind === 'code' && !c.discard) {
        const n = c.size / 8;
        for (let i = 0; i < n; i++) {
          const a = phys(c.cs, c.offset + i);
          s.q.push({ a, v: this.read(a) & 0xff });
        }
        s.fetch = (c.offset + n) & 0xffff;
      }
    }

    // 2. the EU
    const step = driver.step;
    rec.step = step;
    if (step) {
      const fromQ = step.transfers?.find((t) => t.from === 'Q'); // a `queue` step, or a prefix (`hardwired`)
      if (fromQ) {
        if (s.q.length) {
          const regs = driver.regs;
          const head = s.q.shift();
          s.rd = (s.rd + 1) % QUEUE_SIZE;
          const want = fromQ.value;
          rec.took = { a: head.a, v: head.v, expected: phys(regs.CS, regs.IP), stale: head.v !== want };
          rec.qs = s.pos <= driver.prefixes ? 'F' : 'S';
          s.pos += 1;
          perform();
        } else rec.eu = 'queue-wait';
      } else if (step.kind === 'bus') {
        if (!s.req) s.req = { cycles: busCycles(step.bus), started: 0, done: 0 };
        rec.eu = 'bus-wait';
      } else if (step.kind === 'jump') {
        perform();
        const r = driver.regs; // after the jump: the target
        s.q = []; s.rd = 0; s.fetch = r.IP;
        rec.qs = 'E';
        rec.flushTo = { cs: r.CS, ip: r.IP };
        // a fetch still under way runs to its end on the bus; its bytes are thrown away (the simulator's choice)
        if (s.cycle?.kind === 'code' && s.cycle.t !== 'T4') s.cycle = { ...s.cycle, discard: true };
      } else if (step.kind === 'idle') rec.eu = 'idle'; // the checks' tail: no instruction to run, the BIU goes on
      else perform();
    }

    // 3. a new cycle on a free bus: the EU's request first ([INTEL] PDF 29), else a code fetch with two bytes free
    const halted = !driver.step && !s.req;
    if (!s.cycle) {
      if (s.req && s.req.started < s.req.cycles.length) {
        s.cycle = { ...s.req.cycles[s.req.started], t: 'T1', w: 0, eu: true };
        s.req.started += 1;
        rec.start = { free: QUEUE_SIZE - s.q.length };
      } else if (!halted && !s.req && s.q.length <= QUEUE_SIZE - FETCH_FREE) {
        const cs = driver.regs.CS;
        const size = s.fetch & 1 ? 8 : 16; // an odd address: one byte, then words ([INTEL] PDF 29)
        s.cycle = { kind: 'code', address: phys(cs, s.fetch), size, t: 'T1', w: 0, cs, offset: s.fetch };
        rec.start = { free: QUEUE_SIZE - s.q.length };
      }
    }

    // 4. this clock's T state; the end of a cycle
    if (s.cycle) {
      const c = s.cycle;
      rec.t = c.t;
      rec.cycle = { kind: c.kind, address: c.address, size: c.size, ...(c.discard ? { discard: true } : {}) };
      if (c.t === 'T4') {
        if (c.kind !== 'code') {
          s.req.done += 1;
          if (s.req.done === s.req.cycles.length) { s.req = null; perform(); }
        }
        s.cycle = null;
      }
    }
    rec.q = s.q.length;
    s.clock += 1;
    return rec;
  }
}

/**
 * A driver over one instruction run from a given state (the [TEST] replay and hand cases): its steps from runMicro, the
 * registers before each from the step records (micro-model.js `replay`). `mem` is a Map or a read function.
 */
export function instructionDriver(regs, mem, { emptyVector = false } = {}) {
  const read0 = typeof mem === 'function' ? mem : (a) => mem.get(a) ?? 0;
  const overlay = new Map();
  const read = (a) => (overlay.has(a & 0xfffff) ? overlay.get(a & 0xfffff) : read0(a & 0xfffff));
  const c = { ...regs };
  const temps = { IND: 0, OPR: 0, tmpA: 0, tmpB: 0, tmpC: 0, 'Σ': 0 };
  const start = { ...regs, ...temps };
  const res = runMicro(c, { read, peek: read, write: (a, v) => overlay.set(a & 0xfffff, v & 0xff) }, { emptyVector, temps: { ...temps } });
  const steps = res.error ? [] : res.steps;
  const after = res.error ? [] : replay(start, steps);
  let k = 0;
  return {
    res,
    final: c,
    overlay,
    get step() { return steps[k] ?? null; },
    get regs() { return k === 0 ? start : after[k - 1]; },
    get prefixes() { return res.d?.prefixes?.length ?? 0; },
    perform() { k += 1; return k === steps.length; },
  };
}

/**
 * Run one instruction clock by clock until it finishes (or `limit` clocks). Returns the clock records. With `tail`, the
 * BIU then runs on for up to `tail` clocks with an idle EU (no next instruction is known), stopping at the first code
 * fetch that starts after a flush: the [TEST] records go on past the instruction's end.
 */
export function runClocked(core, driver, { limit = 100_000, tail = 0 } = {}) {
  const out = [];
  for (let i = 0; i < limit && driver.step; i++) out.push(core.clock(driver));
  if (tail && out.some((r) => r.qs === 'E')) {
    const e = out.findLastIndex((r) => r.qs === 'E');
    if (!out.slice(e).some((r) => r.start && r.cycle.kind === 'code')) {
      const idle = { step: { kind: 'idle' }, regs: driver.regs, prefixes: 0, perform: () => false };
      for (let i = 0; i < tail; i++) {
        const r = core.clock(idle);
        r.tail = true;
        out.push(r);
        if (r.start && r.cycle.kind === 'code') break;
      }
    }
  }
  return out;
}

/**
 * The model of one program, one clock at a time (the view's model in clock mode): the teaching model's steps
 * (MicroModel, B4) performed by the EU when it can, with the BIU and the queue of BiuCore. Step back goes one clock.
 */
export class ClockModel {
  constructor(program, { waitStates = 0 } = {}) {
    this.mm = new MicroModel(program);
    this.waitStates = waitStates;
    const mm = this.mm;
    this.driver = {
      get step() { return mm.next; },
      get regs() { return mm.regs; },
      get prefixes() { return mm.cur.res.d?.prefixes?.length ?? 0; },
      perform() { const n = mm.retired; mm.step(); return mm.retired !== n; },
    };
    this.reset();
  }

  reset() {
    this.mm.reset();
    this.core = new BiuCore({ read: (a) => this.mm.byte(a), ip: this.mm.c.IP, waitStates: this.waitStates });
    this.journal = [];
    this.dropped = 0;
  }

  get halted() { return this.mm.halted; }
  get error() { return this.mm.error; }
  get clocks() { return this.core.s.clock; }
  /** The record of the last clock, or null. */
  get last() { return this.journal.at(-1)?.rec ?? null; }

  /** One clock: 'step', 'halt' or 'error'. */
  clock() {
    const mm = this.mm;
    if (mm.halted) return mm.error ? 'error' : 'halt';
    if (!mm.next) { mm.step(); return mm.error ? 'error' : 'halt'; } // an instruction that cannot run: the model's error
    const snap = this.core.save();
    const rec = this.core.clock(this.driver);
    this.journal.push({ snap, rec });
    if (this.journal.length > JOURNAL_KEEP) { this.journal.splice(0, 1000); this.dropped += 1000; }
    if (mm.halted) return mm.error ? 'error' : 'halt';
    return 'step';
  }

  /** Clocks until the current instruction is finished. */
  stepInstruction() {
    const n = this.mm.retired;
    let r = 'step';
    while (r === 'step' && this.mm.retired === n) r = this.clock();
    return r;
  }

  /** One clock back. */
  back() {
    const mm = this.mm;
    if (mm.error) { mm.back(); return true; } // the error is withdrawn first (no clock was spent on it)
    const j = this.journal.pop();
    if (!j) return false;
    if (j.rec.performed) mm.back();
    this.core.load(j.snap);
    return true;
  }

  /**
   * Back to the clock after the one that finished the previous instruction (the start of this one), or, when already
   * there, to the start of the one before.
   */
  backInstruction() {
    if (this.mm.error) this.mm.back();
    if (!this.journal.length) return false;
    do this.back(); while (this.journal.length && !this.journal.at(-1).rec.finished);
    return true;
  }

  /** Whether the EU stands at the start of an instruction: no clock yet, or the last clock finished one. */
  get atStart() { return !this.mm.halted && this.mm.k === 0 && (!this.journal.length || this.last.finished); }

  /**
   * The record the next clock would give, without changing the model (the view shows what the next click does), or
   * null when no clock can run.
   */
  peek() {
    const mm = this.mm;
    if (mm.halted || !mm.next) return null;
    const snap = this.core.save();
    const rec = this.core.clock(this.driver);
    if (rec.performed) mm.back();
    this.core.load(snap);
    return rec;
  }
}
