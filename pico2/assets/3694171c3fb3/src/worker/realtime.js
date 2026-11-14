// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../arch/contract.js';
export const PACING = Object.freeze({ sliceMs: 8, capNs: 50e6, pieceNs: 2e6, quantumNs: 2e6, liveMs: 1000 / 30, windowMs: 1000 });
export const AUDIO_AHEAD = 4096;
export class Pacer {
 constructor({ now, capNs = PACING.capNs, windowMs = PACING.windowMs } = {}) {
 this.now = now; this.capNs = capNs; this.windowMs = windowMs;
 this.wall0 = 0; this.sim0 = 0; this.droppedNs = 0; this.samples = [];
 }
 start(simNs) { this.wall0 = this.now(); this.sim0 = simNs; this.droppedNs = 0; this.samples = [[this.wall0, simNs]]; }
 lag(simNs) {
 let lag = (this.now() - this.wall0) * 1e6 - (simNs - this.sim0);
 if (lag > this.capNs) { const ex = lag - this.capNs; this.wall0 += ex / 1e6; this.droppedNs += ex; lag = this.capNs; }
 return lag;
 }
 sample(simNs) {
 const t = this.now();
 this.samples.push([t, simNs]);
 while (this.samples.length > 2 && t - this.samples[1][0] >= this.windowMs) this.samples.shift();
 }
 fraction() {
 const s = this.samples, a = s[0], b = s[s.length - 1];
 const wall = (b[0] - a[0]) * 1e6;
 if (s.length < 2 || wall <= 0) return null;
 return Math.min(1, Math.max(0, (b[1] - a[1]) / wall));
 }
}
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
 const wallLag = pacer.lag(c.timeNs);
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
