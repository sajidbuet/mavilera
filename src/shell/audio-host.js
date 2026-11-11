// audio-host.js -- the page's side of the audio sink (contract v10 capability audio; pico2 P1-M5, research D39 Q6-Q7; ADR-0005,
// ADR-0007): an AudioContext at the module's sample rate with the AudioWorklet processor the descriptor names, made on the
// student's first click on Sound (browsers start audio only after a gesture). For a real-time run it gives the Worker a
// MessagePort to the processor (postMessage, the primary path) or a SharedArrayBuffer ring where the page is crossOriginIsolated;
// for Render and play it plays a buffer of frames. Only for modules with the capability: the other modules never make one.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { audioRingBuffer } from '../worker/audio-ring.js';

export class AudioHost {
  /** @param {{processorUrl: URL, sampleRate: number}} o */
  constructor({ processorUrl, sampleRate }) {
    this.url = processorUrl; this.rate = sampleRate;
    this.ctx = null; this.node = null; this.gain = null; this.source = null; this.ready = null;
  }
  get supported() { return typeof AudioContext === 'function' && typeof AudioWorkletNode === 'function'; }
  /** Make (once) and resume the context; call from a click. Resolves true when audio can play. */
  enable() {
    if (!this.supported) return Promise.resolve(false);
    if (!this.ready) {
      this.ready = (async () => {
        let ctx;
        try { ctx = new AudioContext({ sampleRate: this.rate, latencyHint: 'interactive' }); } catch { ctx = new AudioContext(); } // a browser without the rate resamples
        await ctx.audioWorklet.addModule(this.url);
        this.node = new AudioWorkletNode(ctx, 'mavilera-sink', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        this.gain = ctx.createGain(); this.gain.gain.value = 0.8;
        this.node.connect(this.gain).connect(ctx.destination);
        this.ctx = ctx;
        return true;
      })().catch(() => { this.ready = null; return false; });
    }
    return this.ready.then(async (ok) => { if (ok && this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch { /* still suspended */ } } return ok; });
  }
  /** Off: the context is suspended (no device use), the processor forgets its run. */
  async disable() { this.disconnect(); this.stopBuffer(); if (this.ctx && this.ctx.state === 'running') await this.ctx.suspend(); }
  get on() { return Boolean(this.ctx && this.ctx.state === 'running'); }
  /**
   * A run's link to the processor: {port} to transfer to the Worker, or {sab} when the page may share memory. null when off.
   */
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
  /** The processor's counts {calls, frames, underrunCalls, underrunFrames, maxFill} and its fill now. */
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
  /** Render and play: play `frames` (Float32Array, mono, at the module's rate) once; resolves when it ends. */
  playBuffer(frames) {
    if (!this.on || !frames.length) return Promise.resolve(false);
    this.stopBuffer();
    const buf = this.ctx.createBuffer(1, frames.length, this.rate);
    buf.copyToChannel(frames, 0);
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.gain);
    this.source = src;
    return new Promise((resolve) => { src.onended = () => { if (this.source === src) this.source = null; resolve(true); }; src.start(); });
  }
  stopBuffer() { try { this.source?.stop(); } catch { /* not started */ } this.source = null; }
}
