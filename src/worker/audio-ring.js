// audio-ring.js -- a single-producer, single-consumer ring of mono Float32 frames on a SharedArrayBuffer (contract v10 audio;
// pico2 P1-M5, research D39; D35 (5): used only where the page is crossOriginIsolated, postMessage otherwise; ADR-0007).
// Header Int32 [written, read]: frame counters that only grow (differences taken modulo 2^32); the Worker writes the first, the
// AudioWorklet the second. The capacity is a power of two. Own code (the research repository's audio benchmark has the same
// shape).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const HEADER = 8;
export const AUDIO_RING_FRAMES = 1 << 14; // 341 ms at 48 kHz

export const audioRingBuffer = (frames = AUDIO_RING_FRAMES) => new SharedArrayBuffer(HEADER + 4 * frames);

export class AudioRing {
  constructor(sab) {
    this.head = new Int32Array(sab, 0, 2);
    this.data = new Float32Array(sab, HEADER);
    this.mask = this.data.length - 1;
  }
  /** Frames written and not yet read. */
  fill() { return (Atomics.load(this.head, 0) - Atomics.load(this.head, 1)) | 0; }
  /** Producer: append up to src.length frames (as many as fit); returns the number written. */
  push(src) {
    const w = Atomics.load(this.head, 0), r = Atomics.load(this.head, 1);
    const n = Math.min(src.length, this.data.length - ((w - r) | 0));
    for (let i = 0; i < n; i++) this.data[(w + i) & this.mask] = src[i];
    Atomics.store(this.head, 0, (w + n) | 0);
    return n;
  }
  /** Consumer: take up to dst.length frames; returns the number read. */
  pull(dst) {
    const w = Atomics.load(this.head, 0), r = Atomics.load(this.head, 1);
    const n = Math.min(dst.length, (w - r) | 0);
    for (let i = 0; i < n; i++) dst[i] = this.data[(r + i) & this.mask];
    Atomics.store(this.head, 1, (r + n) | 0);
    return n;
  }
}
