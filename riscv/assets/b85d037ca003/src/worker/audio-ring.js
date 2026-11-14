// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const HEADER = 8;
export const AUDIO_RING_FRAMES = 1 << 14;
export const audioRingBuffer = (frames = AUDIO_RING_FRAMES) => new SharedArrayBuffer(HEADER + 4 * frames);
export class AudioRing {
 constructor(sab) {
 this.head = new Int32Array(sab, 0, 2);
 this.data = new Float32Array(sab, HEADER);
 this.mask = this.data.length - 1;
 }
 fill() { return (Atomics.load(this.head, 0) - Atomics.load(this.head, 1)) | 0; }
 push(src) {
 const w = Atomics.load(this.head, 0), r = Atomics.load(this.head, 1);
 const n = Math.min(src.length, this.data.length - ((w - r) | 0));
 for (let i = 0; i < n; i++) this.data[(w + i) & this.mask] = src[i];
 Atomics.store(this.head, 0, (w + n) | 0);
 return n;
 }
 pull(dst) {
 const w = Atomics.load(this.head, 0), r = Atomics.load(this.head, 1);
 const n = Math.min(dst.length, (w - r) | 0);
 for (let i = 0; i < n; i++) dst[i] = this.data[(r + i) & this.mask];
 Atomics.store(this.head, 1, (r + n) | 0);
 return n;
 }
}
