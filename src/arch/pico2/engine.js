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

/** The CSRs the register panel shows, after x0 to x31: [id, read(hart)]. mcycle and minstret are the low 32 bits. */
export const CSR_VIEW = Object.freeze([
  ['mstatus', (h) => h.mstatus], ['mie', (h) => h.mie], ['mip', (h) => h.mip], ['mtvec', (h) => h.mtvec], ['mepc', (h) => h.mepc],
  ['mcause', (h) => h.mcause], ['mscratch', (h) => h.mscratch], ['mcycle', (h) => h.cycles], ['minstret', (h) => h.instret], ['priv', (h) => h.priv],
]);
// the CSRs a step record lists when they changed (from the step's snapshot; the counters and mip change without a write)
const SYS_DIFF = Object.freeze([['mstatus', 'mstatus'], ['mie', 'mie'], ['mtvec', 'mtvec'], ['mepc', 'mepc'], ['mcause', 'mcause'], ['mscratch', 'mscratch'], ['priv', 'priv']]);
const OK_RETIRED = 1, OK_DEVICE = 2; // per-step flags kept for step back
const OK_WINDOW = 1 << 16;

/** The engine for one program (contract Engine). */
export function create(program, { historyWords = 1 << 22, runLimit = 50_000_000, checkpointEvery = 1 << 20, checkpointsKept = 8 } = {}) {
  const m = new Machine();
  const hart = m.hart, bus = m.bus;
  const ring = new HistoryRing(historyWords);
  hart.attachHistory(ring);
  const image = program.image ?? null;
  let halted, error, retired, steps, haltRec, okLog, okBase, cps;
  let stages = null; // a StageModel (uarch/stages.js) fed after every step while the pipeline view is open

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
    halted = false; error = null; retired = 0; steps = 0; haltRec = null; okLog = []; okBase = 0; cps = [];
    m.touched = false;
    if (stages) stages.reset();
    checkpoint();
  };
  reset();

  const regs = () => {
    const r = {};
    for (let i = 0; i < 32; i++) r[`x${i}`] = hart.x[i] >>> 0;
    for (const [id, read] of CSR_VIEW) r[id] = read(hart) >>> 0;
    return r;
  };
  const OUT_SHOWN = 65536; // the output shows UART0's newest bytes
  const state = () => {
    const u = m.uart[0].out, from = Math.max(0, u.bytes.length - OUT_SHOWN);
    return { pc: hart.pc >>> 0, registers: regs(), halted, error, retired, steps, output: m.uart[0].text(from), outputDropped: u.base + from, historyDropped: ring.dropped };
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
  /** One step under the halting rule: 'ok', 'halt' or 'error'. */
  const stepCore = () => {
    m.touched = false;
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

  const step = () => {
    if (halted) return null;
    const st = stepCore();
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
    const last = okLog.length && steps - 1 >= okBase ? okLog[okLog.length - 1] : undefined;
    let ok;
    if (last !== undefined && !(last & OK_DEVICE) && ring.count > 0) {
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
        if (breakpoints.has(pc)) return STOP.BREAK;
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

  return {
    reset, step, back, run, state,
    last: () => (halted && haltRec ? { ...haltRec } : record()),
    peek: (address, length) => { const out = new Uint8Array(length); for (let i = 0; i < length; i++) out[i] = bus.viewByte(address + i); return out; },
    counters: () => [[S.counterNames.instructions, retired], [S.counterNames.steps, steps], [S.counterNames.cycles, hart.ticks], [S.counterNames.cacheHits, hart.cacheHits]],
    snapshot: () => ({ m: m.save(), retired, steps, halted, error, haltRec }),
    restore: (s) => {
      m.load(s.m); ring.clear(); okLog = []; okBase = s.steps;
      ({ retired, steps, halted, error, haltRec } = s);
      cps = [{ steps, retired, state: s.m }];
      if (stages) stages.reset();
    },
    /** Feed `model` (a StageModel) with every step from now on; null stops it (the pipeline view, P1-M3). */
    attachStages: (model) => { stages = model; hart.detail = model !== null; },
    /** Messages for what the program used that the machine does not model (each once). */
    diagnostics: () => [...m.diags.values()].map((d) => ({ cycle: d.cycle, count: d.count, text: S.diag[d.kind] ? S.diag[d.kind](...d.args) : d.kind })),
    machine: m,
  };
}
