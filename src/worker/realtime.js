// realtime.js -- the real-time run (contract v10 capability realtime; pico2 P1-M4, docs/architecture/pico2-p1m4-realtime.md §2,
// research D36; ADR-0005 time base, ADR-0007 one simulation Worker). The engine's machine time follows the wall clock: every
// slice (about 8 ms of wall time) the loop computes how far machine time is behind the wall clock since the start, runs that
// many clock cycles with Engine.advance in pieces of at most 2 ms of machine time, and yields. A lag larger than the catch-up
// cap (50 ms of machine time) is dropped rather than run, so that a run that cannot keep up (or a tab that was throttled) does
// not race afterwards; the achieved fraction of real time over the last second is reported ("x % of real time", scaled mode).
// Ahead of the wall clock, or less than a quantum (2 ms) behind it, the loop waits. About 30 times a second it posts the
// live state (Engine.live: pc, registers, cycle, machine time, clk_sys, pins, new UART bytes) with the fraction.
// No DOM and no timers of its own: `now`, `soon` (yield, run again at once), `later` (run again after ms) and `post` are given,
// so that the arithmetic is tested in Node with a fake clock (test/realtime-pacing.test.mjs).
// P1-M5 (research D39 Q6-Q7; ADR-0005 decision 4): with sound on and a speaker chosen, machine time is paced by the audio
// buffer instead of the wall clock: the loop keeps about AUDIO_AHEAD frames produced and not yet played (`audio.ahead()`), and
// after every piece it moves the engine's new frames to the sink (`audio.pump()`). The fraction is still machine over wall time.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STOP } from '../arch/contract.js';

// quantumNs: the loop runs once machine time is at least this far behind (else it waits for it), so that a piece of advance is
// never a handful of instructions; it bounds how far machine time trails the wall clock (an input is stamped then)
export const PACING = Object.freeze({ sliceMs: 8, capNs: 50e6, pieceNs: 2e6, quantumNs: 2e6, liveMs: 1000 / 30, windowMs: 1000 });
/**
 * Frames the audio-paced loop keeps ahead of playback: 4096, about 85 ms at 48 kHz. ADR-0005 planned about 2048 (R-AUD-01: no
 * underrun at 2048 in headless Chrome); with the real models Firefox 159 underran at 2048 (29 short gaps in 20 s, the Worker's
 * timers firing late) and not at 4096 (P1-M5 smoke, 2026-11-10): a deviation recorded for the author.
 */
export const AUDIO_AHEAD = 4096;

/**
 * Pacing arithmetic: machine time against the wall clock, with the catch-up cap and the achieved fraction.
 * `now()` in ms (performance.now), machine time in ns.
 */
export class Pacer {
  constructor({ now, capNs = PACING.capNs, windowMs = PACING.windowMs } = {}) {
    this.now = now; this.capNs = capNs; this.windowMs = windowMs;
    this.wall0 = 0; this.sim0 = 0; this.droppedNs = 0; this.samples = [];
  }
  start(simNs) { this.wall0 = this.now(); this.sim0 = simNs; this.droppedNs = 0; this.samples = [[this.wall0, simNs]]; }
  /** The lag of machine time behind the wall clock in ns (negative: ahead), after the cap. */
  lag(simNs) {
    let lag = (this.now() - this.wall0) * 1e6 - (simNs - this.sim0);
    if (lag > this.capNs) { const ex = lag - this.capNs; this.wall0 += ex / 1e6; this.droppedNs += ex; lag = this.capNs; }
    return lag;
  }
  /** Note the machine time now, for the fraction. */
  sample(simNs) {
    const t = this.now();
    this.samples.push([t, simNs]);
    while (this.samples.length > 2 && t - this.samples[1][0] >= this.windowMs) this.samples.shift();
  }
  /** Machine time over wall time in the last second, at most 1 (null before there is a window). */
  fraction() {
    const s = this.samples, a = s[0], b = s[s.length - 1];
    const wall = (b[0] - a[0]) * 1e6;
    if (s.length < 2 || wall <= 0) return null;
    return Math.min(1, Math.max(0, (b[1] - a[1]) / wall));
  }
}

/**
 * Run `engine` in real time until a stop. `breakpoints` a Set of addresses; `resumed` as Engine.run's (a breakpoint at the
 * first instruction stops the run). `paused()` asks whether the page asked for a pause. `onEnd(stop)` at the end (STOP.PAUSE
 * after a pause). `uartFrom`: the UART byte count the page already shows. Returns {stop()} to end the loop without onEnd.
 */
export function runRealtime({ engine, breakpoints = new Set(), resumed = false, now, soon, later, post, paused = () => false, onEnd,
  uartFrom = 0, pacing = PACING, audio = null }) {
  const pacer = new Pacer({ now, capNs: pacing.capNs, windowMs: pacing.windowMs });
  pacer.start(engine.clock().timeNs);
  let first = true, ended = false, lastLive = -Infinity, uartAt = uartFrom;
  let retired0 = engine.live({ uartFrom: Infinity }).retired, wallRetired = now();
  const sendLive = (force = false) => {
    const t = now();
    if (!force && t - lastLive < pacing.liveMs) return;
    const s = engine.live({ uartFrom: uartAt });
    uartAt = s.uart.total;
    const dt = t - wallRetired;
    const ips = dt > 0 && Number.isFinite(lastLive) ? ((s.retired - retired0) * 1000) / dt : null;
    retired0 = s.retired; wallRetired = t; lastLive = t;
    post({ type: 'live', state: s, fraction: pacer.fraction(), ips, droppedNs: pacer.droppedNs });
  };
  const end = (stop) => { if (ended) return; ended = true; sendLive(true); onEnd(stop); };
  const tick = () => {
    if (ended) return;
    if (paused()) { end(STOP.PAUSE); return; }
    const t0 = now();
    let stop = STOP.CHUNK, ahead = 0;
    for (;;) {
      const c = engine.clock();
      const wallLag = pacer.lag(c.timeNs); // (kept current: it moves the wall reference when the cap drops time)
      const byAudio = audio?.active() === true;
      const lag = byAudio ? Math.min(pacing.capNs, ((AUDIO_AHEAD - audio.ahead()) / audio.rate) * 1e9) : wallLag;
      if (lag < pacing.quantumNs) { ahead = (pacing.quantumNs - lag) / 1e6; break; }
      const hz = c.clkSys || 1;
      const cycles = Math.max(1, Math.ceil((Math.min(lag, pacing.pieceNs) * hz) / 1e9));
      const r = engine.advance({ cycles, breakpoints, resumed: first ? resumed : true });
      first = false;
      audio?.pump();
      if (r.stop !== STOP.CHUNK) { stop = r.stop; break; }
      if (now() - t0 >= pacing.sliceMs) break;
    }
    pacer.sample(engine.clock().timeNs);
    if (stop !== STOP.CHUNK) { end(stop); return; }
    sendLive();
    if (ahead > 0) later(tick, Math.min(ahead, pacing.sliceMs)); else soon(tick);
  };
  soon(tick);
  return { stop: () => { ended = true; }, pacer };
}
