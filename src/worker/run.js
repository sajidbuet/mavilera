// run.js -- Web Worker for long runs (spec §5.3): continues the page's engine from its snapshot (architecture
// contract, W-D29: the architecture by id, engine.create(program, options), restore(snapshot)), runs in slices of
// about 50 ms so that a "pause" message is seen between slices, reports progress, and returns the engine's
// snapshot, with the history of every step, so that stepping back after a run works as after single steps
// (WS-F-090). An "input" message (contract v8: a panel's input, SAP-2's keys) goes to the engine between
// slices; "done" says how many it applied, so that the page applies the ones that came too late.
// v10 (capability realtime; pico2 P1-M4, research D36): a run message with `realtime` paces the engine against the wall
// clock (realtime.js) and posts the live state about 30 times a second, through postMessage or, when the page gives a
// SharedArrayBuffer ring (`realtime.ring`, the page crossOriginIsolated), through the ring (live-ring.js).
// v10 capability audio (pico2 P1-M5, research D39 Q6-Q7): `realtime.audio` gives a MessagePort to the page's AudioWorklet, or a
// SharedArrayBuffer ring (audio-ring.js); the engine's frames (Engine.drainAudio) go there and pace the run (realtime.js). A run
// message with `render: {seconds}` runs that much machine time at full speed and returns the frames with the snapshot (Render
// and play, Q7). A "configure" message passes the module's engine settings (Engine.configure: pico2's speaker and converter).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { ARCHITECTURES } from '../arch/registry.js';
import { STOP } from '../arch/contract.js';
import { runRealtime } from './realtime.js';
import { LiveRing } from './live-ring.js';
import { AudioRing } from './audio-ring.js';

let engine = null;
let opts = null;
let pauseRequested = false;
let started = 0;
let applied = 0; // inputs given to the engine during this run
let loading = false; // the architecture is being loaded for a run
let queued = []; // inputs that came while it was loading

function slice() {
  const t0 = performance.now();
  let stop;
  do {
    stop = engine.run({ ...opts, chunk: 50_000, resumed: started > 0 });
    started += 1;
  } while (stop === STOP.CHUNK && !pauseRequested && performance.now() - t0 < 50);
  if (stop === STOP.CHUNK && pauseRequested) stop = STOP.PAUSE;
  if (stop === STOP.CHUNK) {
    postMessage({ type: 'progress', retired: engine.state().retired });
    setTimeout(slice, 0); // lets a pause message in
    return;
  }
  postMessage({ type: 'done', stop, snapshot: engine.snapshot(), applied });
  engine = null;
}

// a zero-delay yield that lets a pause or input message in (setTimeout(0) is clamped to 4 ms when nested)
const channel = new MessageChannel();
let pending = null;
channel.port1.onmessage = () => { const f = pending; pending = null; f?.(); };
const soon = (f) => { pending = f; channel.port2.postMessage(0); };
const later = (f, ms) => setTimeout(f, ms);

/** The engine's frames to the page's audio sink: over a MessagePort (sent - played known from the processor's reports) or a ring. */
function audioOut(eng, link, rate) {
  if (!link || !eng.drainAudio) return null;
  const ring = link.sab ? new AudioRing(link.sab) : null, port = link.port ?? null;
  let sent = 0, rx = 0, q = 0;
  if (port) port.onmessage = (e) => { rx = e.data.rx; q = e.data.q; };
  return {
    rate,
    active: () => (eng.audioStatus ? eng.audioStatus().pin >= 0 : true),
    ahead: () => (ring ? ring.fill() : sent - (rx - q)),
    pump: () => {
      for (let r = eng.drainAudio(1 << 14); r; r = eng.drainAudio(1 << 14)) {
        const f = r.frames[0], n = f.length; // (read before the transfer detaches the buffer)
        if (ring) ring.push(f); else port.postMessage(f, [f.buffer]);
        sent += n;
      }
    },
    close: () => { if (port) port.close(); },
  };
}

function realtime(m) {
  const rt = m.realtime;
  const ring = rt.ring ? new LiveRing(rt.ring) : null;
  const audio = audioOut(engine, rt.audio, rt.audio?.rate ?? 48000);
  runRealtime({
    engine, breakpoints: new Set(m.run?.breakpoints ?? []), resumed: Boolean(m.run?.resumed), uartFrom: rt.uartFrom ?? 0,
    now: () => performance.now(), soon, later, paused: () => pauseRequested, audio,
    post: (msg) => { if (ring && msg.type === 'live') ring.write(msg); else postMessage(msg); },
    onEnd: (stop) => { audio?.close(); postMessage({ type: 'done', stop, snapshot: engine.snapshot(), applied }); engine = null; },
  });
}

/** Render and play (P1-M5, Q7): `seconds` of machine time at full speed, the frames returned with the snapshot. */
function render(m) {
  const seconds = Math.max(0.1, Math.min(60, Number(m.render.seconds) || 5));
  const bps = new Set(m.run?.breakpoints ?? []);
  const end = engine.clock().timeNs + seconds * 1e9;
  const parts = []; let n = 0, first = true, stop = STOP.CHUNK;
  const drain = () => { if (!engine.drainAudio) return; for (let r = engine.drainAudio(1 << 16); r; r = engine.drainAudio(1 << 16)) { parts.push(r.frames[0]); n += r.frames[0].length; } };
  const step = () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 50) {
      const c = engine.clock();
      if (c.timeNs >= end) break;
      const cycles = Math.max(1, Math.ceil((Math.min(end - c.timeNs, 5e6) * (c.clkSys || 1)) / 1e9));
      const r = engine.advance({ cycles, breakpoints: bps, resumed: first ? Boolean(m.run?.resumed) : true });
      first = false;
      drain();
      if (r.stop !== STOP.CHUNK) { stop = r.stop; break; }
    }
    if (stop === STOP.CHUNK && pauseRequested) stop = STOP.PAUSE;
    if (stop === STOP.CHUNK && engine.clock().timeNs < end) {
      postMessage({ type: 'progress', retired: engine.live({ uartFrom: Infinity }).retired, render: 1 - (end - engine.clock().timeNs) / (seconds * 1e9) });
      setTimeout(step, 0);
      return;
    }
    drain();
    const frames = new Float32Array(n); let o = 0; for (const p of parts) { frames.set(p, o); o += p.length; }
    postMessage({ type: 'done', stop: stop === STOP.CHUNK ? STOP.PAUSE : stop, snapshot: engine.snapshot(), applied, audio: frames, rendered: true }, [frames.buffer]);
    engine = null;
  };
  step();
}

onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'run') {
    pauseRequested = false;
    loading = true;
    queued = [];
    const { descriptor } = await ARCHITECTURES[m.arch]();
    engine = descriptor.engine.create(m.program, m.options);
    engine.restore(m.snapshot);
    loading = false;
    opts = m.run;
    started = 0;
    applied = 0;
    for (const x of queued) if (x.configure) engine.configure?.(x.configure); else if (engine.input) { engine.input(x); applied += 1; } // before the first slice, as the page gave them
    if (m.render && engine.advance && engine.clock) render(m);
    else if (m.realtime && engine.advance && engine.clock && engine.live) realtime(m);
    else slice();
  } else if (m.type === 'pause') {
    pauseRequested = true;
  } else if (m.type === 'input') {
    if (loading) queued.push(m.x);
    else if (engine?.input) { engine.input(m.x); applied += 1; }
  } else if (m.type === 'configure') { // P1-M5: the module's engine settings (not an input: not logged, not counted)
    if (loading) queued.push({ configure: m.values });
    else engine?.configure?.(m.values);
  }
};
