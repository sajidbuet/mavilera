// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const SAMPLE_RATE = 48000;
const L = 16, TAPS = 255;
const FINE = SAMPLE_RATE * L;
const DC_POLE = 0.995;
const FIR = (() => {
 const f = new Float64Array(TAPS), fc = 20000 / FINE, M = TAPS - 1;
 let s = 0;
 for (let i = 0; i < TAPS; i++) {
 const x = i - M / 2;
 const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
 const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / M) + 0.08 * Math.cos((4 * Math.PI * i) / M);
 f[i] = sinc * w; s += f[i];
 }
 for (let i = 0; i < TAPS; i++) f[i] /= s;
 return f;
})();
export class AudioTap {
 constructor(m) {
 this.m = m;
 this.pin = -1; this.converter = 'pin'; this.fallback = false;
 this.out = []; this.outFrames = 0;
 this.restart(0);
 }
 configure({ pin = this.pin, converter = this.converter } = {}) {
 this.pin = Number.isInteger(pin) && pin >= 0 && pin < 30 ? pin : -1;
 this.converter = converter === 'ideal' ? 'ideal' : 'pin';
 this.m.pins.tapPin = this.pin;
 this.m.pins.tapLevel = this.pin >= 0 ? this.m.pins.level[this.pin] : 0;
 this.m.pwm.setTap(this.pin);
 this.restart(this.m.now);
 }
 active() {
 if (this.converter !== 'ideal' || this.pin < 0) return 'pin';
 return this.m.pwm.idealOk(this.pin) ? 'ideal' : 'pin';
 }
 restart(c) {
 const t = this.m.nsAt ? this.m.nsAt(c) / 1e9 : 0;
 this.level = this.pin >= 0 ? this.m.pins.level[this.pin] : 0;
 this.t = t;
 this.j = Math.floor(t * FINE);
 this.acc = 0;
 this.ring = new Float64Array(2 * TAPS); this.rpos = 0; this.same = TAPS; this.lastBin = 0;
 this.n = Math.ceil(t * SAMPLE_RATE);
 this.points = [];
 this.x1 = 0; this.y1 = 0; this.primed = false;
 this.out = []; this.outFrames = 0;
 this.mode = this.active(); this.fallback = this.converter === 'ideal' && this.mode !== 'ideal';
 if (this.pin >= 0 && this.m.ready && this.m.pwm?.tapSlice >= 0) this.m.pwm.wake(this.m.pwm.tapSlice);
 }
 edge(level, c) {
 if (this.pin < 0) return;
 const t = this.m.nsAt(c) / 1e9;
 if (this.mode === 'pin') this.advanceTo(t);
 this.level = level;
 }
 duty(c, d, periodCycles) {
 if (this.mode !== 'ideal') return;
 const t0 = this.m.nsAt(c) / 1e9, T = periodCycles / this.m.freq.sys;
 this.points.push([t0 + T / 2, d]);
 if (this.points.length > 4096) this.points.splice(0, 2048);
 }
 advanceTo(t) {
 if (t <= this.t) return;
 const v = this.level === 1 ? 1 : 0, jt = Math.floor(t * FINE);
 if (jt > this.j) {
 const end = (this.j + 1) / FINE;
 this.bin((this.acc + (v ? end - this.t : 0)) * FINE); this.j++;
 let k = jt - this.j;
 while (k > 0 && (this.j % L !== 0 || this.same < TAPS || this.lastBin !== v)) { this.bin(v); this.j++; k--; }
 if (k >= L) {
 const f = Math.floor(k / L);
 for (let i = 0; i < f; i++) this.emit(v);
 this.j += f * L; k -= f * L;
 }
 while (k > 0) { this.bin(v); this.j++; k--; }
 this.acc = 0; this.t = this.j / FINE;
 }
 if (v) this.acc += t - this.t;
 this.t = t;
 }
 bin(x) {
 const r = this.ring, p0 = this.rpos;
 r[p0] = x; r[p0 + TAPS] = x;
 this.rpos = p0 + 1 === TAPS ? 0 : p0 + 1;
 if (x === this.lastBin) this.same++; else { this.same = 1; this.lastBin = x; }
 if ((this.j + 1) % L !== 0) return;
 const a = this.rpos, M = TAPS - 1;
 let acc = FIR[M >> 1] * r[a + (M >> 1)];
 for (let k = 0; k < M >> 1; k++) acc += FIR[k] * (r[a + k] + r[a + M - k]);
 this.emit(acc);
 }
 emit(x) {
 if (!this.primed) { this.x1 = x; this.primed = true; }
 const y = x - this.x1 + DC_POLE * this.y1;
 this.x1 = x; this.y1 = y;
 const last = this.out[this.out.length - 1];
 if (!last || last.n === last.a.length) this.out.push({ a: new Float32Array(1024), n: 0 });
 const piece = this.out[this.out.length - 1];
 piece.a[piece.n++] = y; this.outFrames++;
 }
 idealTo(t) {
 const pts = this.points;
 for (;;) {
 const tn = this.n / SAMPLE_RATE;
 if (tn > t) break;
 while (pts.length >= 2 && pts[1][0] <= tn) pts.shift();
 let d;
 if (pts.length >= 2 && pts[0][0] <= tn) { const [a, b] = pts; d = a[1] + ((b[1] - a[1]) * (tn - a[0])) / (b[0] - a[0]); }
 else if (pts.length >= 1 && (pts[0][0] > tn || t - pts[0][0] > 0.05)) d = pts[0][1];
 else break;
 this.emit(d); this.n++;
 }
 }
 drain(maxFrames, c) {
 if (this.pin < 0) return null;
 const mode = this.active();
 if (mode !== this.mode) { this.restart(c); }
 const t = this.m.nsAt(c) / 1e9;
 if (this.mode === 'pin') this.advanceTo(t); else this.idealTo(t);
 if (!this.outFrames) return null;
 const n = Math.min(maxFrames, this.outFrames), a = new Float32Array(n);
 let k = 0;
 while (k < n) {
 const p = this.out[0], take = Math.min(n - k, p.n);
 a.set(p.a.subarray(0, take), k); k += take;
 if (take === p.n) this.out.shift(); else { p.a.copyWithin(0, take, p.n); p.n -= take; }
 }
 this.outFrames -= n;
 return { frames: [a], atCycle: c };
 }
}
