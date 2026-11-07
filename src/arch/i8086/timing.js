// i8086/timing.js -- calibrated clock timing of the 8086's BIU, queue and EU (milestone 8086-B7, accuracy level L3 of
// roadmap §5; design docs/architecture/i8086-timing.md, B7-Q1 to Q8 decided by the author 2026-11-06). The rules are
// calibrated to the per-clock records of SingleStepTests/8086 v1 ([TEST], MIT), recorded on a CMOS P80C86A-2, not an
// NMOS 8086; no claim about the 8086 follows from them until the verification record exists (CLAUDE.md rule 7).
// CalibratedCore has BiuCore's interface (biu-model.js, L2, unchanged) and gives the same clock records:
//   R1 set-up     a bus cycle's T1 comes two clocks after the BIU decides on it; it decides in a clock in which the bus
//                 is idle (Ti) or in T3 of the cycle on it (then the next cycle follows back-to-back), never in T1, T2 or
//                 T4 ([TEST] research notes §9A Q1 c, Q2 iii-iv; [RE] KS hidden states TS, T0);
//   R2 fetch      a code fetch is decided when the queue and the word in flight leave at least two bytes free and the
//                 EU has no request ([INTEL] PDF 29 with the word in flight counted; [TEST] §9A Q1 a);
//   R3 hold       no code fetch is decided in the clock after a code fetch's T4 (one clock; two clocks fit 1,471 of the
//                 2,000 [TEST] 8B cases, one clock all 2,000; mechanism not identified, [TEST] only);
//   R4 pre-emption a code fetch decided on but not yet in T1 when the EU posts its request is dropped without bus
//                 activity; the EU's cycle is decided in the clock that would have been the fetch's T1 (a fetch decided
//                 in the EU's request clock costs the EU one clock, one decided a clock earlier none). A fetch already
//                 in T1 completes ([INTEL] PDF 29, 73; [TEST] §9A Q2). [RE] KS 2024-04 (8088): a microcode bus request
//                 pre-empts a prefetch that has gone through TS and T0, the state machine going from T0 back to TS;
//                 [INTEL] the Fig 4-22 narrative's aborted fetch (p. 4-37, PDF 276);
//   R7 readable   fetched bytes can be taken from the queue in the clock after T4 ([TEST] §9A bookkeeping).
//   R5 flush      a transfer stops prefetching and corrects the IP ('K': a decided fetch not in T1 is dropped; the EU
//                 waits while a cycle is in T1-T3), empties the queue four clocks later ('E'), and the target's fetch is
//                 decided in the next clock ([TEST] EB, 74, E8; [RE] KS 2024-04 SUSP and CORR);
//   R6 odd target the first fetch at an odd address is a byte cycle, then words ([INTEL] PDF 29; [TEST]).
// R3 and R4 are needed together: either alone fits 1,696 or 1,654 of the 2,000 8B cases (design §9).
// The EU follows a calibrated row of EU_TIMING when the instruction's form has one, otherwise the teaching model's
// steps one per clock (B7-Q4: "not calibrated"). The teaching steps (microops.js, [EDU]) still give the state: they are
// performed on the calibrated clocks, and an EU clock without one is "EU busy (calibrated)" (B7-Q2). Calibrated mode
// runs without wait states (B7-Q7). The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { phys } from './cpu.js';
import { busCycles, QUEUE_SIZE, ClockModel } from './biu-model.js';

/** Bytes queued plus in flight at which the BIU still decides on a code fetch (R2: two of six free). */
export const FETCH_LIMIT = QUEUE_SIZE - 2;
/** Clocks from the BIU's decision to T1 (R1). */
export const SETUP = 2;

/**
 * The rules that can be switched (design §6 item 4: a planted-fault test switches each off). Not offered in the
 * interface. `hold` (R3): true (after a code fetch's T4), 'any' (after any cycle's T4; the calibrated files do not tell
 * the two apart) or false. `preempt` (R4): 't0' (as stated in the header), 'late' (the withdrawn provisional rule: the
 * EU's cycle decided two clocks after its request) or false (the decided fetch runs).
 */
export const RULES = Object.freeze({ hold: true, preempt: 't0' });

const takesQueue = (step) => Boolean(step?.transfers?.some((t) => t.from === 'Q'));

/**
 * The calibrated EU timing per instruction form: a list of EU clocks from the first byte, 'q' (take a queue byte; wait
 * while the queue is empty) or 'c' (an internal clock). A segment prefix adds ['q', 'c'] before the row ([TEST]: two
 * clocks per prefix, IFUM Table 2-20 note). Each row: {ops, sources}. Sources: the Table 2-21 count (IFUM 9800722-03,
 * page) and the [TEST] file with the tests it was fitted to (docs/verification/i8086-timing.md).
 */
export const EU_TIMING = Object.freeze({
  // NOP: 3 clocks. Table 2-21 NOP: 3 (p. 2-62, PDF 85). [TEST] 90.
  nop: { ops: ['q', 'c', 'c'], sources: 'Table 2-21 NOP = 3 (p. 2-62, PDF 85); [TEST] 90' },
  // MOV reg16, reg16: 2 clocks. Table 2-21 MOV register, register: 2 (p. 2-61, PDF 84). [TEST] 8B mod 3.
  movRR: { ops: ['q', 'q'], sources: 'Table 2-21 MOV register,register = 2 (p. 2-61, PDF 84); [TEST] 8B mod 3' },
  // ADD AX, imm16: 4 clocks; the immediate's bytes in the last two. Table 2-21 ADD accumulator, immediate: 4 (p. 2-52,
  // PDF 75). [TEST] 05.
  addAccImm: { ops: ['q', 'c', 'q', 'q'], sources: 'Table 2-21 ADD accumulator,immediate = 4 (p. 2-52, PDF 75); [TEST] 05' },
  // PUSH reg16: the write requested in the sixth clock, decided in the seventh at the earliest; the instruction ends in the write's T2 (the next first byte is
  // read in its T3): 10 clocks on an idle bus, 11 when a code fetch is on it. Table 2-21 PUSH register: 11 (p. 2-63,
  // PDF 86; D13). [TEST] 50.
  pushReg: { ops: ['q', 'c', 'c', 'c', 'c', 'r', 'w'], sources: 'Table 2-21 PUSH register = 11 (p. 2-63, PDF 86; D13: 10 on an idle bus); [TEST] 50' },
  // MOV reg16, mem16: 8 + EA clocks (built by movRM): the read requested in clock EA; the data in its T3; two clocks
  // more. Table 2-21 MOV register, memory: 8+EA (p. 2-61, PDF 84); Table 2-20 EA clocks (p. 2-51, PDF 74). [TEST] 8B.
  movRM: { ops: null, sources: 'Table 2-21 MOV register,memory = 8+EA (p. 2-61, PDF 84); Table 2-20 (p. 2-51, PDF 74); [TEST] 8B' },
  // JMP short: displacement in the third clock; prefetching stopped and the IP corrected in the fifth ('K', waiting
  // while a fetch is in T1-T3); the queue emptied four clocks later ('E'); the target's first byte is read in the
  // clock after its fetch's T4: 15 clocks on an idle bus. Table 2-21 JMP short-label: 15 (p. 2-58, PDF 81). [TEST] EB.
  jmpShort: { ops: ['q', 'c', 'q', 'c', 'K', 'c', 'c', 'c', 'E'], sources: 'Table 2-21 JMP short-label = 15 (p. 2-58, PDF 81); [TEST] EB' },
  // JZ short: not taken, the row ends after the fourth clock ('x'); taken, as JMP short one clock later. Table 2-21
  // JE/JZ: 16 or 4 (p. 2-57, PDF 80). [TEST] 74 (taken always with a fetch on the bus: the 16 is not observed).
  jccShort: { ops: ['q', 'c', 'q', 'x', 'c', 'K', 'c', 'c', 'c', 'E'], sources: 'Table 2-21 JE/JZ short-label = 16 or 4 (p. 2-57, PDF 80); [TEST] 74' },
  // CALL near: as JMP short with a two-byte displacement, then the push of the return address requested three clocks
  // after the flush (decided after the target's fetch); the instruction ends in the write's T2: 17 clocks on an idle
  // bus. Table 2-21 CALL near-proc: 19 (p. 2-52, PDF 75; D14). [TEST] E8.
  callNear: { ops: ['q', 'c', 'q', 'q', 'K', 'c', 'c', 'c', 'E', 'c', 'c', 'r', 'w'], sources: 'Table 2-21 CALL near-proc = 19 (p. 2-52, PDF 75; D14: 17 on an idle bus); [TEST] E8' },
  // SHL reg16, CL: 8 + 4 clocks per bit (CL not masked), built by shlCL. Table 2-21 SAL/SHL register, CL: 8+4/bit
  // (p. 2-65, PDF 88). [TEST] D3.4 mod 3.
  shlRegCL: { ops: null, sources: 'Table 2-21 SAL/SHL register,CL = 8+4/bit (p. 2-65, PDF 88); [TEST] D3.4' },
  // SHL mem16, CL: the read as MOV r16,mem; 10 + 4 per bit clocks from the read data's T3 to the write's request; the
  // instruction ends in the write's T2: 20 + EA + 4/bit on an idle bus. Table 2-21 SAL/SHL memory, CL: 20+EA+4/bit
  // (p. 2-65, PDF 88). [TEST] D3.4.
  shlMemCL: { ops: null, sources: 'Table 2-21 SAL/SHL memory,CL = 20+EA+4/bit (p. 2-65, PDF 88); [TEST] D3.4' },
  // MOV reg16, imm16: 4 clocks, the immediate's bytes in the last two. Table 2-21 MOV register, immediate: 4 (p. 2-61,
  // PDF 84). [TEST] B8.
  movRegImm: { ops: ['q', 'c', 'q', 'q'], sources: 'Table 2-21 MOV register,immediate = 4 (p. 2-61, PDF 84); [TEST] B8' },
  // ADD reg16, reg16: 3 clocks. Table 2-21 ADD register, register: 3 (p. 2-52, PDF 75). [TEST] 03 mod 3.
  addRR: { ops: ['q', 'q', 'c'], sources: 'Table 2-21 ADD register,register = 3 (p. 2-52, PDF 75); [TEST] 03 mod 3' },
  // ADD reg16, mem16: as MOV r16,mem with one clock more (built by addRM). Table 2-21 ADD register, memory: 9+EA
  // (p. 2-52, PDF 75). [TEST] 03.
  addRM: { ops: null, sources: 'Table 2-21 ADD register,memory = 9+EA (p. 2-52, PDF 75); [TEST] 03' },
  // ADD reg16, imm16: 4 clocks, one queue byte each. Table 2-21 ADD register, immediate: 4 (p. 2-52, PDF 75). [TEST] 81.0.
  addRegImm: { ops: ['q', 'q', 'q', 'q'], sources: 'Table 2-21 ADD register,immediate = 4 (p. 2-52, PDF 75); [TEST] 81.0 mod 3' },
  // ADD mem16, imm16: the read as MOV r16,mem; the immediate taken three and four clocks after the data's T3; the write
  // requested three clocks later; the instruction ends in the write's T2: 17+EA on an idle bus. Table 2-21 ADD memory,
  // immediate: 17+EA (p. 2-52, PDF 75). [TEST] 81.0.
  addMemImm: { ops: null, sources: 'Table 2-21 ADD memory,immediate = 17+EA (p. 2-52, PDF 75); [TEST] 81.0' },
});

/**
 * Table 2-20 (IFUM p. 2-51, PDF 74): effective-address clocks by ModR/M mod and r/m (a segment override adds 2, here the
 * prefix's own two clocks). r/m: 0 BX+SI, 1 BX+DI, 2 BP+SI, 3 BP+DI, 4 SI, 5 DI, 6 BP (mod 0: displacement only), 7 BX.
 */
export function eaClocks(mod, rm) {
  if (mod === 0 && rm === 6) return 6; // displacement only
  const pair = rm < 4 ? ([0, 3].includes(rm) ? 7 : 8) : 5; // BX+SI, BP+DI 7; BX+DI, BP+SI 8; one register 5
  if (mod === 0) return pair;
  return rm < 4 ? pair + 4 : 9; // with a displacement: 11, 12; base or index 9
}

/**
 * The EU clocks of an instruction with a memory operand, up to its request: the op code and ModR/M bytes, internal
 * clocks, the displacement's bytes read from clock EA-4 (a direct address: EA-3) ([TEST] 8B), and the request ('r') in
 * clock EA.
 */
function toRequest(mod, rm) {
  const ea = eaClocks(mod, rm);
  const n = mod === 1 ? 1 : mod === 2 || (mod === 0 && rm === 6) ? 2 : 0;
  const at = mod === 0 && rm === 6 ? ea - 3 : ea - 4;
  const ops = ['q', 'q'];
  while (ops.length < (n ? at : ea)) ops.push('c');
  for (let k = 0; k < n; k++) ops.push('q');
  while (ops.length < ea) ops.push('c');
  ops.push('r'); // requested in clock EA; the read decided in clock EA + 1 at the earliest
  return ops;
}

const SEG = new Set([0x26, 0x2e, 0x36, 0x3e]);

/**
 * The calibrated row of a decoded instruction, or null (not calibrated). `d` as decodeBytes gives it; `regs` the
 * registers before it (a shift by CL; without them CL counts as 0, enough to tell whether a row exists).
 */
export function timingOf(d, regs = null) {
  if (!d || d.error || !d.bytes) return null;
  const pre = d.prefixes ?? [];
  if (pre.some((p) => !SEG.has(p))) return null; // LOCK, REP: not calibrated
  const k = pre.length;
  const op = d.bytes[k];
  let row = null;
  const mod = d.bytes[k + 1] >> 6; const rm = d.bytes[k + 1] & 7;
  if (op === 0x90) row = EU_TIMING.nop;
  else if (op === 0x8b && mod === 3) row = EU_TIMING.movRR;
  else if (op === 0x8b) return { ops: [...pre.flatMap(() => ['q', 'c']), ...toRequest(mod, rm), 'W', 'c', 'c'], row: EU_TIMING.movRM };
  else if (op === 0x03 && mod === 3) row = EU_TIMING.addRR;
  else if (op === 0x03) return { ops: [...pre.flatMap(() => ['q', 'c']), ...toRequest(mod, rm), 'W', 'c', 'c', 'c'], row: EU_TIMING.addRM };
  else if (op === 0x81 && ((d.bytes[k + 1] >> 3) & 7) === 0) {
    if (mod === 3) row = EU_TIMING.addRegImm;
    else return { ops: [...pre.flatMap(() => ['q', 'c']), ...toRequest(mod, rm), 'W', 'c', 'c', 'q', 'q', 'c', 'c', 'r', 'w'], row: EU_TIMING.addMemImm };
  } else if (op === 0xb8) row = EU_TIMING.movRegImm;
  else if (op === 0xd3 && ((d.bytes[k + 1] >> 3) & 7) === 4) {
    const bits = 4 * ((regs?.CX ?? 0) & 0xff);
    const c = (n) => Array(n).fill('c');
    const ops = mod === 3 ? ['q', 'q', ...c(6 + bits)] : [...toRequest(mod, rm), 'W', ...c(9 + bits), 'r', 'w'];
    return { ops: [...pre.flatMap(() => ['q', 'c']), ...ops], row: mod === 3 ? EU_TIMING.shlRegCL : EU_TIMING.shlMemCL };
  }
  else if (op === 0x05) row = EU_TIMING.addAccImm;
  else if (op >= 0x50 && op <= 0x57) row = EU_TIMING.pushReg;
  else if (op === 0xeb) row = EU_TIMING.jmpShort;
  else if (op === 0x74) row = EU_TIMING.jccShort; // JZ only: the other Jcc files are not calibrated
  else if (op === 0xe8) row = EU_TIMING.callNear;
  if (!row) return null;
  return { ops: [...pre.flatMap(() => ['q', 'c']), ...row.ops], row };
}

/**
 * The BIU, the queue and the EU, clock by clock, calibrated (L3). Same constructor, `clock(driver)`, `save`, `load` and
 * clock record as BiuCore; the driver also gives the decoded instruction (`driver.decoded` or `driver.res.d`).
 */
export class CalibratedCore {
  constructor({ read, ip, queue = [], waitStates = 0, rules = {}, uncalibratedWaits = false }) {
    // B7-Q7: calibrated mode runs without wait states; `uncalibratedWaits` lets a test check the Fig 4-22 total with one
    // wait state ([INTEL] 64 clocks, a total only), with each Tw after T3 and the next cycle decided in the last Tw
    if (waitStates && !uncalibratedWaits) throw new Error('calibrated timing runs without wait states (B7-Q7)');
    this.waitStates = waitStates;
    this.read = read;
    this.rules = { ...RULES, ...rules };
    this.s = {
      codeT4: null, // the clock of the last code fetch's T4 (R3)
      suspended: false, // prefetching stopped ('K') until the queue is emptied ('E')
      jumpLater: false, // the queue was emptied before the teaching model's jump step (CALL near)
      clock: 0,
      q: queue.map(({ a, v }) => ({ a, v })), // readable bytes, head first
      arriving: null, // the bytes of a code fetch that ended in T4 last clock: readable from this clock (R7)
      fetch: (ip + queue.length) & 0xffff, // the offset of the next code fetch
      rd: 0,
      cycle: null, // the cycle on the bus: {kind, address, size, t, cs?, offset?, discard?, eu?}
      next: null, // the cycle decided on: {cycle, at (its T1 clock)}
      req: null, // the EU's request {cycles, started, done}
      pos: 0, // the next byte's index in the instruction (F or S)
      ops: undefined, // the EU's calibrated clocks for this instruction (null: the teaching model's)
      i: 0, // the next of them
      calibrated: false,
    };
  }

  save() { const s = this.s; return { ...s, q: s.q.slice(), req: s.req && { ...s.req }, ops: s.ops && s.ops.slice() }; }
  load(snap) { this.s = { ...snap, q: snap.q.slice(), req: snap.req && { ...snap.req }, ops: snap.ops && snap.ops.slice() }; }

  /** Bytes in the queue and on the way (R2's count): queued, arriving, and a code fetch on the bus or decided. */
  occupancy() {
    const s = this.s;
    let n = s.q.length;
    if (s.cycle?.kind === 'code' && !s.cycle.discard) n += s.cycle.size / 8;
    if (s.next?.cycle.kind === 'code') n += s.next.cycle.size / 8;
    return n;
  }

  clock(driver) {
    const s = this.s;
    const rec = { n: s.clock, t: 'Ti', cycle: null, qs: null, eu: 'halt', step: null, performed: false, finished: false };

    // 1. bytes of last clock's T4 become readable (R7); the bus advances; a decided cycle reaches T1
    if (s.arriving) { s.q.push(...s.arriving); s.arriving = null; }
    if (s.cycle) {
      const c = s.cycle;
      const t = c.t === 'T3' || c.t === 'Tw' ? (c.wait ? 'Tw' : 'T4') : { T1: 'T2', T2: 'T3' }[c.t];
      s.cycle = t ? { ...c, t, wait: t === 'Tw' ? c.wait - 1 : c.wait } : null;
    }
    if (!s.cycle && s.next && s.next.at === s.clock) {
      s.cycle = { ...s.next.cycle, t: 'T1', wait: this.waitStates };
      rec.start = { free: QUEUE_SIZE - s.q.length };
      s.next = null;
    }

    // 2. the BIU decides (R1, R2) on the occupancy at the start of the clock, before the EU takes a byte
    const free = !s.cycle || ((s.cycle.t === 'T3' || s.cycle.t === 'Tw') && !s.cycle.wait); // T4 follows
    if (!s.next && free) {
      if (s.req && s.req.started < s.req.cycles.length && s.clock >= (s.req.earliest ?? 0)) {
        const last = s.req.started + 1 === s.req.cycles.length;
        s.next = { cycle: { ...s.req.cycles[s.req.started], eu: true, last }, at: s.clock + SETUP };
        s.req.started += 1;
      } else if ((!s.req || s.req.started === s.req.cycles.length) && driver.step && this.occupancy() <= FETCH_LIMIT
        && !s.suspended && !(this.rules.hold && s.codeT4 === s.clock - 1)) {
        const cs = driver.regs.CS;
        const size = s.fetch & 1 ? 8 : 16;
        s.next = { cycle: { kind: 'code', address: phys(cs, s.fetch), size, cs, offset: s.fetch }, at: s.clock + SETUP };
        s.fetch = (s.fetch + size / 8) & 0xffff;
      }
    }

    // 3. the EU
    this.eu(driver, rec);

    // 4. this clock's T state; the end of a cycle
    if (s.cycle) {
      const c = s.cycle;
      rec.t = c.t;
      rec.cycle = { kind: c.kind, address: c.address, size: c.size, ...(c.discard ? { discard: true } : {}) };
      if (c.t === 'T4') {
        if (c.kind === 'code' || this.rules.hold === 'any') s.codeT4 = s.clock;
        if (c.kind === 'code' && !c.discard) {
          s.arriving = [];
          for (let k = 0; k < c.size / 8; k++) { const a = phys(c.cs, c.offset + k); s.arriving.push({ a, v: this.read(a) & 0xff }); }
        }
        if (c.eu) {
          s.req.done += 1;
          if (s.req.done === s.req.cycles.length) {
            const auto = !s.req.calibrated; // the teaching model's EU completes its bus step here (L2 choice 3)
            s.req = null;
            if (auto) this.perform(driver, rec);
          }
        }
      }
    }
    rec.q = s.q.length;
    rec.calibrated = s.calibrated;
    s.clock += 1;
    return rec;
  }

  perform(driver, rec) {
    rec.performed = true;
    rec.steps = (rec.steps ?? 0) + 1; // a calibrated clock can perform several teaching steps (CalibratedClockModel.back)
    rec.eu = 'step';
    if (driver.perform()) { rec.finished = true; this.s.pos = 0; this.s.ops = undefined; this.s.i = 0; this.s.jumpLater = false; }
  }

  /** Take the head byte for the driver's queue step. */
  take(driver, rec) {
    const s = this.s;
    const regs = driver.regs;
    const head = s.q.shift();
    s.rd = (s.rd + 1) % QUEUE_SIZE;
    const want = driver.step.transfers.find((t) => t.from === 'Q').value;
    rec.took = { a: head.a, v: head.v, expected: phys(regs.CS, regs.IP), stale: want !== null && want !== undefined && head.v !== want };
    rec.qs = s.pos <= driver.prefixes ? 'F' : 'S';
    s.pos += 1;
    this.perform(driver, rec);
  }

  eu(driver, rec) {
    const s = this.s;
    const step = driver.step;
    rec.step = step;
    if (!step) return;
    if (step.kind === 'idle') { rec.eu = 'idle'; return; }
    if (s.ops === undefined) {
      const t = timingOf(driver.decoded ?? driver.res?.d ?? null, driver.regs);
      s.ops = t ? t.ops.slice() : null;
      s.i = 0;
      s.calibrated = Boolean(t);
    }
    if (!s.ops) return this.teaching(driver, rec);
    const op = s.ops[s.i];
    const last = s.i === s.ops.length - 1;
    // steps that take no clock of their own in the calibrated row: the internal ones before a queue step; at the row's
    // end also the end step and a jump step whose flush came earlier (CALL near: the teaching model pushes first)
    const catchUp = (all = false) => {
      const due = (k) => k !== 'bus' && (k !== 'jump' || (all && s.jumpLater)) && (all || k !== 'end');
      while (!rec.finished && driver.step && !takesQueue(driver.step) && due(driver.step.kind)) this.perform(driver, rec);
    };
    // an internal step of the teaching model in this clock, if one is due; otherwise "EU busy (calibrated)" (B7-Q2)
    const internal = () => {
      if (step && !takesQueue(step) && !['bus', 'jump', 'end'].includes(step.kind) && !last) this.perform(driver, rec);
      else rec.eu = 'busy';
    };
    if (op === 'q') {
      catchUp();
      if (!s.q.length) { rec.eu = 'queue-wait'; return; }
      if (!takesQueue(driver.step)) throw new Error(`calibrated row: a queue clock where the teaching model has ${driver.step?.kind}`);
      this.take(driver, rec);
    } else if (op === 'r') { // post the request of the teaching model's bus step (decided from the next clock, R1)
      catchUp();
      if (driver.step?.kind !== 'bus') throw new Error(`calibrated row: a request where the teaching model has ${driver.step?.kind}`);
      // the request is seen by the BIU from the next clock
      s.req = { cycles: busCycles(driver.step.bus), started: 0, done: 0, calibrated: true };
      // R4 pre-emption: a code fetch decided on (TS) but not yet in T1 is dropped; the EU's cycle is decided in the
      // clock of the fetch's would-be T1 ([RE] KS: T0, then TS of the instruction's cycle); nothing on the pins
      if (s.next?.cycle.kind === 'code' && this.rules.preempt) {
        s.fetch = s.next.cycle.offset;
        s.req.earliest = this.rules.preempt === 't0' ? s.next.at : s.clock + SETUP;
        s.next = null;
        rec.abandoned = true;
      }
      rec.eu = 'bus-wait';
    } else if (op === 'w' || op === 'W') { // wait until the request's last cycle is in T2 (a write) or T3 (read data)
      const c = s.cycle;
      const at = op === 'w' ? c?.t === 'T2' : (c?.t === 'T3' || c?.t === 'Tw') && !c.wait; // read data: the last T3/Tw
      if (!(c?.eu && c.last && at)) { rec.eu = 'bus-wait'; return; }
      this.perform(driver, rec);
    } else if (op === 'K') {
      // stop prefetching and correct the IP: from this clock no code fetch is decided, and one decided but not yet in
      // T1 is dropped ([RE] KS 2024-04: SUSP pre-empts a prefetch after T0); the EU then waits while a cycle is in T1 to
      // T3 (KS: CORR runs internal TS and T0 states, which need the bus state machine idle; [TEST] EB, 74, E8: the
      // flush comes four clocks after the T4 of a fetch on the bus)
      if (!s.suspended) {
        s.suspended = true;
        if (s.next?.cycle.kind === 'code') { s.fetch = s.next.cycle.offset; s.next = null; rec.abandoned = true; }
      }
      if (s.cycle && s.cycle.t !== 'T4') { rec.eu = 'bus-wait'; return; }
      internal();
    } else if (op === 'E') {
      // empty the queue (QS E) and fetch from the target, decided from the next clock (R5); prefetching resumes
      catchUp();
      let to;
      if (driver.step?.kind === 'jump') { this.perform(driver, rec); to = driver.regs; } else { to = driver.final; s.jumpLater = true; }
      s.q = []; s.arriving = null; s.rd = 0; s.fetch = to.IP; s.suspended = false;
      if (s.next?.cycle.kind === 'code') s.next = null;
      if (s.cycle?.kind === 'code' && s.cycle.t !== 'T4') s.cycle = { ...s.cycle, discard: true };
      rec.qs = 'E';
      rec.flushTo = { cs: to.CS, ip: to.IP };
    } else if (op === 'x') {
      // a conditional transfer's test: not taken (the teaching model has no jump step), the row ends here
      internal();
      if (driver.step?.kind === 'end') catchUp(true);
    } else internal();
    s.i += 1;
    if (last && !rec.finished) {
      catchUp(true);
      if (!rec.finished) throw new Error('calibrated row ended before the teaching model\'s steps');
    }
  }

  /** The teaching model's EU on the calibrated BIU (an uncalibrated instruction, B7-Q4). */
  teaching(driver, rec) {
    const s = this.s;
    const step = driver.step;
    if (takesQueue(step)) {
      if (s.q.length) this.take(driver, rec); else rec.eu = 'queue-wait';
    } else if (step.kind === 'bus') {
      if (!s.req) s.req = { cycles: busCycles(step.bus), started: 0, done: 0 };
      rec.eu = 'bus-wait';
    } else if (step.kind === 'jump') {
      this.perform(driver, rec);
      const r = driver.regs;
      s.q = []; s.arriving = null; s.rd = 0; s.fetch = r.IP;
      if (s.next?.cycle.kind === 'code') s.next = null;
      if (s.cycle?.kind === 'code' && s.cycle.t !== 'T4') s.cycle = { ...s.cycle, discard: true };
      rec.qs = 'E';
      rec.flushTo = { cs: r.CS, ip: r.IP };
    } else this.perform(driver, rec);
  }
}

/**
 * The program model in calibrated mode (B7-Q1: biu-model.js unchanged): ClockModel with CalibratedCore, no wait states
 * (B7-Q7), a driver that also gives the decoded instruction and its final registers (a transfer's target), and step back
 * that undoes every teaching step a clock performed.
 */
export class CalibratedClockModel extends ClockModel {
  constructor(program, { rules = {}, testWaitStates = 0 } = {}) {
    super(program, { waitStates: 0 });
    this.rules = rules;
    this.testWaitStates = testWaitStates; // a test only (B7-Q7: the interface runs calibrated mode at 0)
    const mm = this.mm;
    this.driver = {
      get step() { return mm.next; },
      get regs() { return mm.regs; },
      get prefixes() { return mm.cur.res.d?.prefixes?.length ?? 0; },
      get decoded() { return mm.cur.res.error ? null : mm.cur.res.d ?? null; },
      get final() { return mm.cur.final.c; },
      perform() { const n = mm.items; mm.step(); return mm.items !== n; }, // an instruction or an interrupt entry (B8)
    };
    this.reset();
  }

  reset() {
    this.mm.reset();
    this.core = new CalibratedCore({ read: (a) => this.mm.byte(a), ip: this.mm.c.IP, rules: this.rules ?? {},
      waitStates: this.testWaitStates ?? 0, uncalibratedWaits: Boolean(this.testWaitStates) });
    this.journal = [];
    this.dropped = 0;
  }

  /** One clock back: every step the clock performed is undone. */
  back() {
    const mm = this.mm;
    if (mm.error) { mm.back(); return true; }
    const j = this.journal.pop();
    if (!j) return false;
    for (let i = 0; i < (j.rec.steps ?? 0); i++) mm.back();
    this.core.load(j.snap);
    return true;
  }

  peek() {
    const mm = this.mm;
    if (mm.halted || !mm.next) return null;
    const snap = this.core.save();
    const rec = this.core.clock(this.driver);
    for (let i = 0; i < (rec.steps ?? 0); i++) mm.back();
    this.core.load(snap);
    return rec;
  }
}
