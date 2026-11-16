// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { AudioRing } from './audio-ring.js';
const FADE = 256;
class MavileraSink extends AudioWorkletProcessor {
 constructor() {
 super();
 this.ring = null; this.wport = null;
 this.queue = []; this.qOff = 0; this.qFill = 0; this.rx = 0;
 this.gain = 0;
 this.last = 0;
 this.started = false;
 this.stats = { calls: 0, frames: 0, underrunCalls: 0, underrunFrames: 0, maxFill: 0 };
 this.port.onmessage = (e) => {
 const m = e.data;
 if (m.type === 'connect') {
 this.wport = m.port ?? null; this.ring = m.sab ? new AudioRing(m.sab) : null;
 this.queue = []; this.qOff = 0; this.qFill = 0; this.rx = 0; this.started = false;
 if (this.wport) this.wport.onmessage = (ev) => { const f = ev.data; if (f?.length) { this.queue.push(f); this.qFill += f.length; this.rx += f.length; } };
 } else if (m.type === 'disconnect') {
 this.wport = null; this.ring = null; this.queue = []; this.qFill = 0; this.started = false;
 } else if (m.type === 'stats') {
 this.port.postMessage({ type: 'stats', stats: { ...this.stats }, fill: this.fill() });
 } else if (m.type === 'resetStats') {
 this.stats = { calls: 0, frames: 0, underrunCalls: 0, underrunFrames: 0, maxFill: 0 };
 }
 };
 }
 fill() { return this.ring ? this.ring.fill() : this.qFill; }
 pullPost(dst) {
 let n = 0;
 while (n < dst.length && this.queue.length) {
 const c = this.queue[0], take = Math.min(dst.length - n, c.length - this.qOff);
 dst.set(c.subarray(this.qOff, this.qOff + take), n);
 n += take; this.qOff += take;
 if (this.qOff === c.length) { this.queue.shift(); this.qOff = 0; }
 }
 this.qFill -= n;
 return n;
 }
 process(inputs, outputs) {
 const out = outputs[0][0];
 if (!out) return true;
 const s = this.stats, f = this.fill();
 if (f > s.maxFill) s.maxFill = f;
 const got = this.wport || this.ring ? (this.ring ? this.ring.pull(out) : this.pullPost(out)) : 0;
 if (got > 0) this.started = true;
 if (this.wport) this.wport.postMessage({ rx: this.rx, q: this.qFill });
 s.calls++;
 for (let i = 0; i < out.length; i++) {
 if (i < got) { this.gain = Math.min(1, this.gain + 1 / FADE); this.last = out[i]; out[i] *= this.gain; }
 else { this.gain = Math.max(0, this.gain - 1 / FADE); out[i] = this.last * this.gain; }
 }
 if (got < out.length && this.started) { s.underrunCalls++; s.underrunFrames += out.length - got; }
 s.frames += got;
 for (let ch = 1; ch < outputs[0].length; ch++) outputs[0][ch].set(out);
 return true;
 }
}
registerProcessor('mavilera-sink', MavileraSink);
