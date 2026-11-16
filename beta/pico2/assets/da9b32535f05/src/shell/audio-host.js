// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { audioRingBuffer } from '../worker/audio-ring.js';
export class AudioHost {
 constructor({ processorUrl, sampleRate }) {
 this.url = processorUrl; this.rate = sampleRate;
 this.ctx = null; this.node = null; this.gain = null; this.source = null; this.ready = null;
 }
 get supported() { return typeof AudioContext === 'function' && typeof AudioWorkletNode === 'function'; }
 enable() {
 if (!this.supported) return Promise.resolve(false);
 if (!this.ready) {
 this.ready = (async () => {
 let ctx;
 try { ctx = new AudioContext({ sampleRate: this.rate, latencyHint: 'interactive' }); } catch { ctx = new AudioContext(); }
 await ctx.audioWorklet.addModule(this.url);
 this.node = new AudioWorkletNode(ctx, 'mavilera-sink', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
 this.gain = ctx.createGain(); this.gain.gain.value = 0.8;
 this.node.connect(this.gain).connect(ctx.destination);
 this.ctx = ctx;
 return true;
 })().catch(() => { this.ready = null; return false; });
 }
 return this.ready.then(async (ok) => { if (ok && this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { } } return ok; });
 }
 async disable() { this.disconnect(); this.stopBuffer(); if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend(); }
 get on() { return Boolean(this.ctx && this.ctx.state === 'running'); }
 connect({ shared = false } = {}) {
 if (!this.on) return null;
 if (shared && globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function') {
 const sab = audioRingBuffer();
 this.node.port.postMessage({ type: 'connect', sab });
 return { sab, transport: 'sab' };
 }
 const ch = new MessageChannel();
 this.node.port.postMessage({ type: 'connect', port: ch.port1 }, [ch.port1]);
 return { port: ch.port2, transport: 'postMessage' };
 }
 disconnect() { this.node?.port.postMessage({ type: 'disconnect' }); }
 stats() {
 if (!this.node) return Promise.resolve(null);
 return new Promise((resolve) => {
 const h = (e) => { if (e.data?.type === 'stats') { this.node.port.removeEventListener('message', h); resolve({ ...e.data.stats, fill: e.data.fill }); } };
 this.node.port.addEventListener('message', h); this.node.port.start();
 this.node.port.postMessage({ type: 'stats' });
 setTimeout(() => resolve(null), 1000);
 });
 }
 resetStats() { this.node?.port.postMessage({ type: 'resetStats' }); }
 playBuffer(frames) {
 if (!this.on || !frames.length) return Promise.resolve(false);
 this.stopBuffer();
 const buf = this.ctx.createBuffer(1, frames.length, this.rate);
 buf.copyToChannel(frames, 0);
 const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.gain);
 this.source = src;
 return new Promise((resolve) => { src.onended = () => { if (this.source === src) this.source = null; resolve(true); }; src.start(); });
 }
 stopBuffer() { try { this.source?.stop(); } catch { } this.source = null; }
}
