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
let applied = 0;
let loading = false;
let queued = [];
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
 setTimeout(slice, 0);
 return;
 }
 postMessage({ type: 'done', stop, snapshot: engine.snapshot(), applied });
 engine = null;
}
const channel = new MessageChannel();
let pending = null;
channel.port1.onmessage = () => { const f = pending; pending = null; f?.(); };
const soon = (f) => { pending = f; channel.port2.postMessage(0); };
const later = (f, ms) => setTimeout(f, ms);
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
 const f = r.frames[0], n = f.length;
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
 for (const x of queued) if (x.configure) engine.configure?.(x.configure); else if (engine.input) { engine.input(x); applied += 1; }
 if (m.render && engine.advance && engine.clock) render(m);
 else if (m.realtime && engine.advance && engine.clock && engine.live) realtime(m);
 else slice();
 } else if (m.type === 'pause') {
 pauseRequested = true;
 } else if (m.type === 'input') {
 if (loading) queued.push(m.x);
 else if (engine?.input) { engine.input(m.x); applied += 1; }
 } else if (m.type === 'configure') {
 if (loading) queued.push({ configure: m.values });
 else engine?.configure?.(m.values);
 }
};
