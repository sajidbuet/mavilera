// pico2/engine.js -- the pico2 module's instruction-level engine on the contract (Engine, spec W-D29). P1-M2: one Hazard3 hart on
// the Pico 2 machine (soc/machine.js): the RP2350 address map, the peripherals of the milestone, the event scheduler and the
// high-level boot of SDK images (ADR-0008). An assembler program starts at its entry with the chip-reset state and the stack at
// the top of SRAM; an SDK image (program.image, from boot/image.js) starts at its IMAGE_DEF ENTRY_POINT.
// Each step: the scheduler's due events run first (ADR-0003); a call into the module's ROM is serviced in place (boot/rom.js);
// a sleeping hart (wfi, h3.block) with nothing pending skips to the next event in one step.
// Halting rule (the simulator's, documented in the module's strings): with no trap handler installed (mtvec is 0) an ebreak
// ends the program, and any other trap stops the run with an error naming the cause; in both cases the instruction is shown
// as not executed. With a handler installed, traps are taken as on the chip. A sleep that nothing can end stops with an error.
// Step back: through the hart's history ring when the step touched no device; otherwise by restoring the latest machine
// checkpoint and re-running the steps (decision Q2): the machine is deterministic and host inputs are queued by cycle.
// The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP } from '../contract.js';
import { CAUSE } from './core/hart.js';
import { HistoryRing } from './core/history.js';
import { Machine } from './soc/machine.js';
import { ROM_SIZE } from './soc/bus.js';
import { STACK_TOP } from './language.js';
import { PICO2_STRINGS as S } from './strings.js';
import { ENV_KEYS } from './parts/kit.js';

/** The CSRs the register panel shows, after x0 to x31: [id, read(hart)]. mcycle and minstret are the low 32 bits. */
export const CSR_VIEW = Object.freeze([
  ['mstatus', (h) => h.mstatus], ['mie', (h) => h.mie], ['mip', (h) => h.mip], ['mtvec', (h) => h.mtvec], ['mepc', (h) => h.mepc],
  ['mcause', (h) => h.mcause], ['mscratch', (h) => h.mscratch], ['mcycle', (h) => h.cycles], ['minstret', (h) => h.instret], ['priv', (h) => h.priv],
]);
/** P1-M6 (design Q4 A): core 1's registers, in their own group: x0-x31, pc and a few CSRs, as c1x0 … c1pc, c1mstatus … */
export const CORE1_VIEW = Object.freeze([['mstatus', (h) => h.mstatus], ['mie', (h) => h.mie], ['mip', (h) => h.mip], ['mtvec', (h) => h.mtvec],
  ['mepc', (h) => h.mepc], ['mcause', (h) => h.mcause], ['mcycle', (h) => h.cycles], ['minstret', (h) => h.instret]]);
// the CSRs a step record lists when they changed (from the step's snapshot; the counters and mip change without a write)
const SYS_DIFF = Object.freeze([['mstatus', 'mstatus'], ['mie', 'mie'], ['mtvec', 'mtvec'], ['mepc', 'mepc'], ['mcause', 'mcause'], ['mscratch', 'mscratch'], ['priv', 'priv']]);
const OK_RETIRED = 1, OK_DEVICE = 2; // per-step flags kept for step back
const OK_WINDOW = 1 << 16;

/**
 * An input from the interface in the engine's form (P1-M4): {kind: 'pin', pin, level 1 | 0 | -1} or {kind: 'uart', uart, bytes};
 * P1-M7: {kind: 'adc', channel 0-3, volts} (the voltage on GPIO 26 + channel) or {kind: 'env', key, value} (the lab kit's
 * environment: temp, pressure, humidity, ax, ay, az, gx, gy, gz; temp is also the chip's die temperature).
 */
function normInput(x) {
  if (x?.kind === 'pin' && Number.isInteger(x.pin) && x.pin >= 0 && x.pin < 48 && [1, 0, -1].includes(x.level)) return { kind: 'pin', pin: x.pin, level: x.level };
  if (x?.kind === 'uart' && (x.uart === 0 || x.uart === 1) && Array.isArray(x.bytes) && x.bytes.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
    return { kind: 'uart', uart: x.uart, bytes: x.bytes.slice() };
  }
  if (x?.kind === 'adc' && Number.isInteger(x.channel) && x.channel >= 0 && x.channel < 4 && Number.isFinite(x.volts)) return { kind: 'adc', channel: x.channel, volts: x.volts };
  if (x?.kind === 'env' && ENV_KEYS.includes(x.key) && Number.isFinite(x.value)) return { kind: 'env', key: x.key, value: x.value };
  throw new Error(`pico2: not an input: ${JSON.stringify(x)}`);
}
const queueArgs = (e) => (e.kind === 'pin' ? ['pin', e.pin, e.level] : e.kind === 'adc' ? ['adc', e.channel, e.volts] : e.kind === 'env' ? ['env', e.key, e.value] : ['uart', e.uart, e.bytes]);
const cloneEntry = (e) => ({ ...e, ...(e.bytes ? { bytes: e.bytes.slice() } : {}) });

/** FNV-1a (32 bits) over bytes, continued from `h`. */
function fnv(bytes, h = 0x811c9dc5) {
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

/** The engine for one program (contract Engine). `inputs` (contract v8): a log from Engine.inputs, replayed at its cycles. */
export function create(program, { historyWords = 1 << 22, runLimit = 50_000_000, checkpointEvery = 1 << 20, checkpointsKept = 8, inputs = [] } = {}) {
  const m = new Machine();
  const hart = m.hart, bus = m.bus;
  const ring = new HistoryRing(historyWords);
  hart.attachHistory(ring);
  const image = program.image ?? null;
  let halted, error, retired, steps, haltRec, okLog, okBase, cps;
  let lastCore = 0, marks = []; // P1-M6: the core of the newest step (0, 1; -1 while a two-core step is under way); Step starts
  let stages = null; // a StageModel (uarch/stages.js) fed after every step while the pipeline view is open
  // P1-M4 (research D36): the inputs given from the interface, each {cycle, step, kind, …}, stamped at the machine cycle when
  // it was given and queued in the machine (machine.at), so that a replay from reset gives the same machine state at every
  // cycle. `idleTo`: the cycle up to which a sleeping core has idled in real time without a step (Engine.advance); an input
  // given then is stamped there, not at the cycle the core fell asleep.
  const norm = (list) => list.map((e) => ({ cycle: Number(e.cycle) || 0, step: Number(e.step) || 0, ...normInput(e) }));
  let initial = norm(inputs);
  let log = [], idleTo = 0;
  /** The machine's input queue as the log says, from cycle `from` on (inputs before it have been applied). */
  const requeue = (from) => m.inputs.load(log.filter((e) => e.cycle >= from).sort((a, b) => a.cycle - b.cycle).map((e) => [e.cycle, ...queueArgs(e)]));

  const isEbreak = (pc) => { const lo = bus.peek(pc, 2); return lo === 0x9002 || (lo === 0x0073 && bus.peek(pc + 2, 2) === 0x0010); };
  const wordAt = (pc) => { const lo = bus.peek(pc, 2) ?? 0; return (lo & 3) === 3 ? (lo | ((bus.peek(pc + 2, 2) ?? 0) << 16)) | 0 : lo; };

  const boot = () => {
    if (image) {
      const bad = m.bootImage(image);
      if (bad !== null) throw new Error(S.engine.imageOutside(bad));
    } else {
      m.powerOn();
      m.loadChunks(program.segments.map((s) => ({ address: s.address, bytes: s.bytes })));
      hart.pc = program.entry | 0;
      hart.x[2] = STACK_TOP | 0;
    }
  };
  const checkpoint = () => {
    if (cps.length && cps[cps.length - 1].steps === steps) return;
    cps.push({ steps, retired, state: m.save() });
    if (cps.length > checkpointsKept + 1) cps.splice(1, 1); // keep the start and the newest ones
  };
  const reset = () => {
    boot();
    ring.clear();
    log = initial.map(cloneEntry); idleTo = 0; // contract v8: back to the inputs the engine was created with
    requeue(0); m.recomputeDeadline();
    halted = false; error = null; retired = 0; steps = 0; haltRec = null; okLog = []; okBase = 0; cps = []; marks = [];
    m.touched = false;
    if (stages) stages.reset();
    checkpoint();
  };
  reset();

  const h1 = m.harts[1];
  const regs = () => {
    const r = {};
    for (let i = 0; i < 32; i++) r[`x${i}`] = hart.x[i] >>> 0;
    for (const [id, read] of CSR_VIEW) r[id] = read(hart) >>> 0;
    for (let i = 0; i < 32; i++) r[`c1x${i}`] = h1.x[i] >>> 0; // P1-M6
    r.c1pc = h1.pc >>> 0;
    for (const [id, read] of CORE1_VIEW) r[`c1${id}`] = read(h1) >>> 0;
    return r;
  };
  /** Core 1's state for the counters: waiting in the bootrom, held off, running or asleep. */
  const core1State = () => (m.core1.off ? S.core1.off : m.core1.parked ? (m.core1.launches ? S.core1.returned : S.core1.waiting) : h1.sleeping ? S.core1.asleep : S.core1.running);
  const OUT_SHOWN = 65536; // the output shows UART0's newest bytes
  const state = () => {
    const u = m.uart[0].out, from = Math.max(0, u.bytes.length - OUT_SHOWN);
    const cycle = Math.max(hart.ticks, idleTo);
    return { pc: hart.pc >>> 0, registers: regs(), halted, error, retired, steps, output: m.uart[0].text(from), outputDropped: u.base + from, historyDropped: ring.dropped,
      cycle, timeNs: m.nsAt(cycle), clkSys: m.freq.sys, sleeping: Boolean(hart.sleeping) }; // P1-M4: machine time for the live view
  };

  const pushOk = (v) => {
    okLog.push(v);
    if (okLog.length > 2 * OK_WINDOW) { okLog.splice(0, OK_WINDOW); okBase += OK_WINDOW; }
  };

  /** A call into one of the ROM's slots, serviced by the machine in place of the instruction there; 'ok' or 'error'. */
  const romCall = (pc, slot, t0) => {
    const r = m.romCall(pc, slot);
    if (r) {
      error = r.kind === 'entry' ? S.engine.romEntry(pc) : S.engine.romNotModelled(r.slot.name, r.slot.tag, r.ra);
      halted = true; return 'error';
    }
    steps++; pushOk(OK_DEVICE);
    if (stages) stages.record(hart, pc, t0);
    return 'ok';
  };
  /**
   * P1-M6: one step while both cores run, by the machine's two-core loop (one instruction of the hart that is behind). Every
   * such step is marked as touching devices, so that step back replays from a checkpoint (the history ring is core 0's).
   * Core 0's trap without a handler follows the halting rule below; core 1's stops the run with an error naming the core.
   */
  const stepDual = () => {
    const t0 = hart.ticks, pc0 = hart.pc >>> 0;
    hart.attachHistory(ring);
    const k = m.runDual(1);
    const why = m.stop, who = m.stopHart;
    if (why === 'rom') { const r = m.stopInfo; error = S.core1.prefix(who.hartid, r.kind === 'entry' ? S.engine.romEntry(who.pc >>> 0) : S.engine.romNotModelled(r.slot.name, r.slot.tag, r.ra)); halted = true; return 'error'; }
    if (why === 'sleep') { error = S.core1.bothAsleep; halted = true; return 'error'; }
    if (why === 'trap' && who === h1) {
      const c = h1.mcause, irq = c < 0;
      error = S.core1.prefix(1, S.engine.noHandler(irq ? S.trapLabels[`irq${c & 0xf}`] : S.trapLabels[c] ?? `cause ${c}`, h1.mepc >>> 0));
      halted = true; return 'error';
    }
    if (why === 'trap') { // core 0: the halting rule, as stepCore's
      const cause = hart.mcause, irq = cause < 0, pc = hart.mepc >>> 0;
      hart.stepBack();
      if (!irq && cause === CAUSE.BREAKPOINT && isEbreak(pc)) {
        const word = wordAt(pc);
        haltRec = { pc, word, size: (word & 3) === 3 ? 4 : 2, nextPc: pc, registers: [], memory: [] };
        halted = true; return 'halt';
      }
      error = S.engine.noHandler(irq ? S.trapLabels[`irq${cause & 0xf}`] : S.trapLabels[cause] ?? `cause ${cause}`, pc);
      halted = true; return 'error';
    }
    if (k === 0) return 'ok';
    steps++; pushOk(OK_DEVICE | (m.retired ? OK_RETIRED : 0)); retired += m.retired;
    lastCore = m.lastHart?.hartid ?? 0;
    if (stages && lastCore === 0) stages.record(hart, pc0, t0);
    if (steps % checkpointEvery === 0) checkpoint();
    return 'ok';
  };
  /** One step under the halting rule: 'ok', 'halt' or 'error'. */
  const stepCore = () => {
    m.touched = false;
    if (m.core1On) { lastCore = -1; return stepDual(); }
    lastCore = 0;
    const t0 = hart.ticks;
    if (hart.ticks >= m.deadline) m.serviceDue();
    const pc = hart.pc >>> 0;
    if (pc < ROM_SIZE) { const slot = m.rom.slots.get(pc); if (slot) return romCall(pc, slot, t0); }
    if (hart.sleeping) {
      if (hart.mie === 0) { error = S.engine.sleepForever(pc); halted = true; return 'error'; }
      if (!(hart.mip & hart.mie)) {
        if (m.deadline === Infinity) { error = S.engine.sleepNoEvent(pc); halted = true; return 'error'; }
        const skip = m.deadline - hart.ticks - 1; // the last sleeping cycle is the step itself
        if (skip > 0) { hart.ticks += skip; if (!(hart.mcountinhibit & 1)) hart.cycles += skip; m.touched = true; }
      }
    }
    const ok = hart.step();
    if (hart.trapped && (hart.mtvec & ~3) === 0) {
      const cause = hart.mcause, irq = cause < 0;
      hart.stepBack(); // the trap is not taken: the instruction is shown as not executed
      if (!irq && cause === CAUSE.BREAKPOINT && isEbreak(pc)) {
        const word = wordAt(pc);
        haltRec = { pc, word, size: (word & 3) === 3 ? 4 : 2, nextPc: pc, registers: [], memory: [] };
        halted = true;
        return 'halt';
      }
      error = S.engine.noHandler(irq ? S.trapLabels[`irq${cause & 0xf}`] : S.trapLabels[cause] ?? `cause ${cause}`, pc);
      halted = true;
      return 'error';
    }
    steps++;
    pushOk((ok ? OK_RETIRED : 0) | (m.touched ? OK_DEVICE : 0));
    if (ok) retired++;
    if (stages) stages.record(hart, pc, t0);
    if (steps % checkpointEvery === 0) checkpoint();
    return 'ok';
  };

  /** The record of the newest step, from the history ring and the present state. */
  const record = () => {
    const n = ring.newest();
    if (!n) return null;
    const pc = n.pc >>> 0, word = wordAt(pc);
    const registers = [], seen = new Set();
    for (const [r, old] of n.regs) {
      if (r === 0 || seen.has(r)) continue;
      seen.add(r);
      registers.push({ id: `x${r}`, old: old >>> 0, value: hart.x[r] >>> 0 });
    }
    if (n.sys) {
      for (const [id, key] of SYS_DIFF) {
        const now = (id === 'priv' ? hart.priv : hart[key]) >>> 0, before = n.sys[key] >>> 0;
        if (now !== before) registers.push({ id, old: before, value: now });
      }
    }
    const memory = n.mem.map(([address, size, old]) => ({ address: address >>> 0, size, old: old >>> 0, value: (bus.peek(address, size) ?? 0) >>> 0 }));
    return { pc, word, size: (word & 3) === 3 ? 4 : 2, nextPc: hart.pc >>> 0, registers, memory };
  };

  // P1-M6: the step counts at which a Step of several engine steps began (core 1's steps alongside core 0's), so that Back
  // returns to the start of that Step (`marks` is declared with `lastCore`: reset() empties it)
  const step = () => {
    if (halted) return null;
    const s0 = steps;
    let st = stepCore();
    // P1-M6 (Q5 A): a step is one instruction of core 0; core 1's steps meanwhile run alongside (core 1 alone while core 0 sleeps)
    for (let g = 0; st === 'ok' && m.core1On && lastCore === 1 && !(hart.sleeping && !(hart.mip & hart.mie)) && g < 100_000; g++) st = stepCore();
    if (steps - s0 > 1) marks.push(s0);
    if (st === 'halt') return { ...haltRec, halt: true };
    if (st === 'error') return null;
    const rec = record();
    if (rec && hart.trapped) {
      const c = hart.mcause, irq = c < 0;
      rec.trap = { cause: c >>> 0, label: irq ? S.trapLabels[`irq${c & 0xf}`] : S.trapLabels[c] ?? `cause ${c}` };
    }
    return rec;
  };

  /** Restore the latest checkpoint at or before `target - 1` and re-run to `target` steps (the last one recorded). */
  const replayTo = (target) => {
    let cp = null;
    for (let i = cps.length - 1; i >= 0; i--) if (cps[i].steps <= Math.max(0, target - 1)) { cp = cps[i]; break; }
    if (!cp) return false;
    m.load(cp.state); steps = cp.steps; retired = cp.retired;
    requeue(cp.state.ticks); m.recomputeDeadline(); idleTo = 0; // the inputs as the log now has them (P1-M4)
    halted = false; error = null; haltRec = null; okLog = []; okBase = steps; ring.clear();
    const st = stages; stages = null; // the replayed steps are already in the stage model
    hart.attachHistory(null);
    while (steps < target - 1) if (stepCore() !== 'ok') break;
    hart.attachHistory(ring);
    if (steps < target) stepCore();
    stages = st;
    return steps === target;
  };

  const back = () => {
    if (halted) { halted = false; error = null; haltRec = null; return true; } // the halting or failing step changed nothing
    if (steps === 0) return false;
    // contract v8: stepping back past the step at which an input was given (its step count) withdraws it; the machine's queue
    // is rebuilt from the log by the replay
    while (marks.length && marks[marks.length - 1] >= steps) marks.pop();
    if (marks.length && marks[marks.length - 1] < steps - 1) { // P1-M6: back over a whole Step of several engine steps
      const target = marks.pop();
      if (log.some((e) => e.step >= target)) log = log.filter((e) => e.step < target);
      idleTo = 0;
      const ok = replayTo(target);
      if (stages) stages.rewindTo(hart.ticks);
      return ok;
    }
    const withdraw = log.some((e) => e.step >= steps);
    if (withdraw) log = log.filter((e) => e.step < steps);
    idleTo = 0;
    const last = okLog.length && steps - 1 >= okBase ? okLog[okLog.length - 1] : undefined;
    let ok;
    if (!withdraw && last !== undefined && !(last & OK_DEVICE) && ring.count > 0) {
      hart.stepBack(); steps--; okLog.pop(); if (last & OK_RETIRED) retired--;
      ok = true;
    } else ok = replayTo(steps - 1);
    if (stages) stages.rewindTo(hart.ticks);
    return ok;
  };

  const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, resumed = false, watch = {} } = {}) => {
    const wr = watch.registers ?? new Set(), wm = watch.memory ?? new Set();
    const watching = wr.size > 0 || wm.size > 0;
    for (let i = 0; i < chunk; i++) {
      if (halted) return error ? STOP.ERROR : STOP.HALT;
      if (steps >= runLimit) return STOP.BUDGET;
      const pc = hart.pc >>> 0;
      if (i > 0 || resumed) {
        if (breakpoints.has(pc) || (m.core1On && breakpoints.has(h1.pc >>> 0))) return STOP.BREAK; // P1-M6: either core
        if (pc === target) return STOP.TARGET;
      }
      const st = stepCore();
      if (st === 'halt') return STOP.HALT;
      if (st === 'error') return STOP.ERROR;
      if (watching) {
        const n = ring.newest();
        if (n.regs.some(([r]) => r !== 0 && wr.has(`x${r}`))) return STOP.WATCH;
        if (n.mem.some(([a, size]) => { for (let k = 0; k < size; k++) if (wm.has((a + k) >>> 0) || wm.has(((a + k) & ~3) >>> 0)) return true; return false; })) return STOP.WATCH;
      }
    }
    return STOP.CHUNK;
  };

  /**
   * Contract v10 (P1-M4, research D35 (5), D36): run about `cycles` clk_sys cycles without the step-back history ring (the
   * checkpoints are kept, so step back after a real-time run works by checkpoint + replay). A core asleep with nothing due
   * before the end of the slice idles to it without a step (`idleTo`), so that an input given meanwhile wakes it at the cycle
   * it was given, and a replay from reset meets the same steps. `breakpoints` stop the slice before the instruction, except at
   * its first one unless `resumed`. Returns {cycles run (or idled), stop}: STOP.CHUNK when the budget is used up.
   */
  const advance = ({ cycles = 0, breakpoints = null, resumed = true } = {}) => {
    if (halted) return { cycles: 0, stop: error ? STOP.ERROR : STOP.HALT };
    const start = Math.max(hart.ticks, idleTo), end = start + Math.max(1, Math.floor(cycles));
    let stop = STOP.CHUNK, first = !resumed;
    hart.attachHistory(null);
    try {
      // the machine's fast loop (soc/machine.js runFor: no per-step bookkeeping) while no stage model is fed; pieces end at the
      // checkpoint steps, so that the checkpoints fall where stepCore puts them
      while (!stages && hart.ticks < end) {
        if (steps >= runLimit) { stop = STOP.BUDGET; break; }
        if (hart.sleeping && !m.core1On) {
          if (hart.ticks >= m.deadline) m.serviceDue();
          if (!(hart.mip & hart.mie) && hart.mie !== 0 && m.deadline > end) { idleTo = end; break; }
        }
        const n = Math.min(end - hart.ticks, checkpointEvery - (steps % checkpointEvery), runLimit - steps);
        const k = m.runFor(n, { breakpoints: breakpoints?.size ? breakpoints : null, checkFirst: !first, until: end });
        first = false;
        const why = m.stop;
        steps += why === 'trap' ? k - 1 : k; // the trapped step is not one of the program's (the halting rule undoes it)
        retired += m.retired;
        if (why !== 'trap' && steps % checkpointEvery === 0) checkpoint();
        if (why === 'break') { stop = STOP.BREAK; break; }
        if (why === 'idle') { idleTo = end; break; }
        if (why === 'trap' || why === 'rom' || why === 'sleep') {
          // the halting rule (and the ROM and sleep errors) through the engine's own step: from the latest checkpoint with
          // the ring, the step that stopped the machine again (the replay restores `retired` from the checkpoint as well)
          hart.attachHistory(ring);
          replayTo(steps + 1);
          stop = !halted ? STOP.CHUNK : error ? STOP.ERROR : STOP.HALT;
          break;
        }
      }
      // with the pipeline view's stage model attached: step by step (stepCore feeds it)
      while (stages && hart.ticks < end) {
        if (steps >= runLimit) { stop = STOP.BUDGET; break; }
        if (!first && breakpoints?.has(hart.pc >>> 0)) { stop = STOP.BREAK; break; }
        first = false;
        // asleep, nothing pending, an interrupt enabled, the next event (if any) after the slice: idle to the slice's end (the
        // events due now first: an input may just have arrived; stepCore would service them first the same way)
        if (hart.sleeping && !m.core1On) {
          if (hart.ticks >= m.deadline) m.serviceDue();
          if (!(hart.mip & hart.mie) && hart.mie !== 0 && m.deadline > end) { idleTo = end; break; }
        }
        const st = stepCore();
        if (st !== 'ok') {
          // the halting rule undoes the trapping instruction through the history ring, which a slice runs without: run that
          // step again from the latest checkpoint with the ring attached (once, at the program's end)
          halted = false; error = null; haltRec = null;
          hart.attachHistory(ring);
          replayTo(steps + 1);
          stop = !halted ? STOP.CHUNK : error ? STOP.ERROR : STOP.HALT;
          break;
        }
      }
    } finally {
      hart.attachHistory(ring);
      if (!halted) { ring.clear(); okLog = []; okBase = steps; } // no step of the slice can be undone from the ring
    }
    return { cycles: Math.max(hart.ticks, idleTo) - start, stop };
  };

  /** Contract v8 (P1-M4): an input from the interface, stamped at the present machine cycle and logged with the step count. */
  const input = (x) => {
    const e = { cycle: Math.max(hart.ticks, idleTo), step: steps, ...normInput(x) };
    log.push(e);
    m.at(e.cycle, ...queueArgs(e));
  };

  /** A hash of the whole machine state (memory, core, devices, pins, queued inputs, clocks): equal states, equal hashes. */
  const stateHash = () => {
    const { ram, ...rest } = m.save();
    // the observation logs' counters (pin events, UART output) are not machine state: an engine restored from a snapshot starts
    // them empty
    const json = JSON.stringify(rest, (k, v) => (k === 'logTotal' || k === 'outTotal' ? undefined : ArrayBuffer.isView(v) ? Array.from(v) : v));
    return fnv(new TextEncoder().encode(json), fnv(ram)).toString(16).padStart(8, '0');
  };

  // the observation logs' newest OBS_KEPT entries for a snapshot (a run in the Worker adds to them; P1-M4)
  const OBS_KEPT = 1 << 16;
  const tail = (a) => a.slice(Math.max(0, a.length - OBS_KEPT));
  const saveObs = () => ({
    uart: m.uart.map((u) => ({ base: u.out.base + Math.max(0, u.out.bytes.length - OBS_KEPT), bytes: tail(u.out.bytes), cycles: tail(u.out.cycles) })),
    pins: (({ log: l }) => ({ base: l.base + Math.max(0, l.cycles.length - OBS_KEPT), cycles: tail(l.cycles), pins: tail(l.pins), states: tail(l.states) }))(m.pins),
    bus: { i2c: m.i2c.map((x) => x.log.slice()), spi: m.spi.map((x) => x.log.slice()) }, // P1-M7: the bus logs (the tab's list)
  });
  const loadObs = (o) => {
    o.uart.forEach((x, i) => { const out = m.uart[i].out; out.base = x.base; out.bytes = x.bytes.slice(); out.cycles = x.cycles.slice(); });
    const l = m.pins.log; l.base = o.pins.base; l.cycles = o.pins.cycles.slice(); l.pins = o.pins.pins.slice(); l.states = o.pins.states.slice();
    if (o.bus) { o.bus.i2c.forEach((x, i) => { m.i2c[i].log = x.slice(); }); o.bus.spi.forEach((x, i) => { m.spi[i].log = x.slice(); }); }
  };
  // P1-M5 (research D39 Q4-Q5): the speaker pin and the converter, module settings (Language.options with apply 'engine'):
  // configure() takes them from the shell after every create and at each change; the snapshot carries them to the Worker
  let audioCfg = { pin: -1, converter: 'pin' };
  /** Contract v10 draft (P1-M5): the engine's settings {speaker: 'none' | 'gpN', dac: 'pin' | 'ideal'} (not machine state). */
  const configure = (values = {}) => {
    if (values.speaker !== undefined) { const k = /^gp(\d+)$/.exec(String(values.speaker)); audioCfg.pin = k ? Number(k[1]) : -1; }
    if (values.dac !== undefined) audioCfg.converter = values.dac === 'ideal' ? 'ideal' : 'pin';
    m.audio.configure(audioCfg);
    if (values.parts !== undefined) { audioCfg.parts = values.parts === 'kit' ? 'kit' : 'none'; m.setKit(audioCfg.parts === 'kit'); } // P1-M7 (design Q2)
  };
  /**
   * Contract v10 (capability audio): the speaker's 48 kHz frames since the last call, up to the present machine time (no later
   * than the next event, which may still change the pin): {frames: [Float32Array], atCycle} or null.
   */
  const drainAudio = (maxFrames = 1 << 16) => m.audio.drain(maxFrames, Math.min(Math.max(hart.ticks, idleTo), m.deadline));
  /** P1-M5 (research D39 Q8): the PWM slices and DMA channels decoded for the PWM and DMA tabs (reads only). */
  const panelState = () => ({ clkSys: m.freq.sys, pwm: m.pwm.s.map((_, i) => m.pwm.view(i)), dma: m.dma.ch.map((_, i) => m.dma.view(i)),
    sniff: { ctrl: m.dma.r.get(0x454), data: m.dma.sniffOut() }, transfers: m.dma.transfers,
    // P1-M7: ADC, SPI0/1, I2C0/1 decoded, and the lab kit
    adc: m.adc.view(), spi: m.spi.map((x) => x.view()), i2c: m.i2c.map((x) => x.view()), parts: partsState(),
    pio: m.pio.view() }); // P1-M8: the three PIO blocks (the PIO tab)
  /** P1-M7: the lab kit as the Pins panel shows it: connected or not, the LCD's lines, the environment, the ADC voltages. */
  const partsState = () => ({ on: m.kitOn, lcd: m.kitOn ? m.kit.lcd.lines() : null, env: { ...m.env }, volts: m.adc.volts.slice(), adcOn: (m.adc.r.get(0) & 1) === 1 });
  /** The speaker as the interface shows it: {pin, converter, active ('pin' | 'ideal'), fallback}. */
  const audioStatus = () => ({ pin: audioCfg.pin, converter: audioCfg.converter, active: m.audio.mode, fallback: m.audio.fallback });
  /** Contract v10 draft (P1-M4): the machine's clock, cheap: {cycle, timeNs, clkSys} (the real-time loop reads it often). */
  const clock = () => { const cycle = Math.max(hart.ticks, idleTo); return { cycle, timeNs: m.nsAt(cycle), clkSys: m.freq.sys }; };
  /**
   * Contract v10 draft (P1-M4, D36 Q4): the live view's state during a real-time run: pc, registers, counts, machine time,
   * the 30 GPIOs (level, output enable, external drive) and UART0's bytes from the count `uartFrom` on (total: the count now).
   */
  const live = ({ uartFrom = 0 } = {}) => {
    const u = m.uart[0].out, total = u.base + u.bytes.length, from = Math.min(total, Math.max(uartFrom, u.base));
    const p = m.pins, N = 30;
    return { ...clock(), pc: hart.pc >>> 0, registers: regs(), retired, steps, sleeping: Boolean(hart.sleeping), halted, parts: partsState(),
      pins: { level: p.level.slice(0, N), oe: p.padOe.slice(0, N), ext: p.ext.slice(0, N), fn: Uint8Array.from(p.ctrl.subarray(0, N), (c) => c & 0x1f) },
      uart: { from, bytes: u.bytes.slice(from - u.base), total } };
  };

  return {
    reset, step, back, run, state, advance, input, stateHash, clock, live, configure, drainAudio, audioStatus, panelState,
    /** Contract v10 draft (P1-M4, D36 Q5): back to the start with `list` as the inputs to replay (and to keep across resets). */
    restart: (list = []) => { initial = norm(list); reset(); },
    inputs: () => log.map(cloneEntry),
    last: () => (halted && haltRec ? { ...haltRec } : record()),
    peek: (address, length) => { const out = new Uint8Array(length); for (let i = 0; i < length; i++) out[i] = bus.viewByte(address + i); return out; },
    counters: () => [[S.counterNames.instructions, retired], [S.counterNames.steps, steps], [S.counterNames.cycles, hart.ticks], [S.counterNames.cacheHits, hart.cacheHits],
      [S.core1.counter, core1State()], [S.core1.cycles, h1.ticks]], // P1-M6
    // P1-M4: the log and the checkpoints travel, so that step back after a run in the Worker works by checkpoint + replay
    // and the newest part of the observation logs (UART output, pin changes), which the machine state leaves out
    snapshot: () => ({ m: m.save(), retired, steps, halted, error, haltRec, inputs: log.map(cloneEntry), idleTo, cps: cps.slice(), obs: saveObs(), audio: { ...audioCfg } }),
    restore: (s) => {
      m.load(s.m); ring.clear(); okLog = []; okBase = s.steps;
      if (s.obs) loadObs(s.obs);
      ({ retired, steps, halted, error, haltRec } = s);
      log = (s.inputs ?? []).map(cloneEntry); idleTo = s.idleTo ?? 0;
      cps = [...(s.cps ?? []).filter((c) => c.steps < steps), { steps, retired, state: s.m }];
      if (s.audio) { audioCfg = { ...s.audio }; m.audio.configure(audioCfg); } else m.audio.restart(m.now); // P1-M5
      if (stages) stages.reset();
    },
    /** Feed `model` (a StageModel) with every step from now on; null stops it (the pipeline view, P1-M3). */
    attachStages: (model) => { stages = model; hart.detail = model !== null; },
    /** Messages for what the program used that the machine does not model (each once). */
    // contract v2 Engine.diagnostics ({kind, message}): one entry per distinct warning of the machine, in the order they came; the
    // shell shows each new one in the console once (P1-M9: the shape was {cycle, count, text}, which the shell never showed)
    diagnostics: () => [...m.diags.values()].map((d) => ({ kind: d.kind, message: S.diag[d.kind] ? S.diag[d.kind](...d.args) : d.kind, cycle: d.cycle, count: d.count })),
    machine: m,
  };
}
