// tap.js -- the pico2 machine's audio tap (P1-M5, research decision D39 Q4-Q5; ADR-0005; R-AUD-01): one GPIO is the speaker,
// and its signal becomes 48 kHz mono frames of machine time (sample n at n / 48000 s of simulated time, never wall time).
// Two converters, ported from the research repository's experiments/audio-benchmarks (own code):
//   'pin'   pin-accurate (default, decision D3): the pin's level changes, stamped at their cycles, give the exact high time of
//           every bin of 1/768 kHz (16 bins per output sample); a 255-tap Blackman windowed-sinc low-pass (20 kHz) at the
//           decimated instants gives each frame (R-AUD-01 method 3b: -60 to -66 dBc aliasing in the benchmark). Never point
//           sampling (it aliases the carrier into the band at full power, R-AUD-01 §5).
//   'ideal' the "ideal DAC": the duty CC / (TOP + 1) that the speaker's PWM slice latches at each wrap, linearly interpolated
//           between the centres of the periods (method 5). Only for a pin that a PWM slice drives in free-running trailing-edge
//           mode (otherwise the tap falls back to 'pin' and says so in `fallback`).
// A DC blocker (one pole at about 38 Hz) follows both, so that a pin idling high or at 50 % is silence. The tap is not machine
// state: it observes (gpio.js calls edge() for the speaker pin; pwm.js calls duty() for its slice), and it restarts at the
// present machine time after a reset or a restored snapshot.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const SAMPLE_RATE = 48000;
const L = 16, TAPS = 255;              // bins per frame, filter length (R-AUD-01 method 3b)
const FINE = SAMPLE_RATE * L;          // 768 kHz
const DC_POLE = 0.995;

/** The low-pass filter: Blackman-windowed sinc, cut-off 20 kHz at the fine rate, unity gain at DC. */
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
  /** @param {object} m the machine (nsAt, pins, pwm, freq) */
  constructor(m) {
    this.m = m;
    this.pin = -1; this.converter = 'pin'; this.fallback = false;
    this.out = []; this.outFrames = 0; // frames converted and not yet drained (an array of Float32Array pieces)
    this.restart(0);
  }

  /** Choose the speaker pin (-1: none) and the converter ('pin' | 'ideal'). */
  configure({ pin = this.pin, converter = this.converter } = {}) {
    this.pin = Number.isInteger(pin) && pin >= 0 && pin < 30 ? pin : -1;
    this.converter = converter === 'ideal' ? 'ideal' : 'pin';
    this.m.pins.tapPin = this.pin;
    this.m.pins.tapLevel = this.pin >= 0 ? this.m.pins.level[this.pin] : 0;
    this.m.pwm.setTap(this.pin);
    this.restart(this.m.now);
  }
  /** The converter in use: 'ideal' only while the speaker is a PWM output in free-running trailing-edge mode. */
  active() {
    if (this.converter !== 'ideal' || this.pin < 0) return 'pin';
    return this.m.pwm.idealOk(this.pin) ? 'ideal' : 'pin';
  }

  /** Start the stream at cycle c: the next frame is the first whose time is at or after it. */
  restart(c) {
    const t = this.m.nsAt ? this.m.nsAt(c) / 1e9 : 0;
    this.level = this.pin >= 0 ? this.m.pins.level[this.pin] : 0;
    this.t = t;                                  // seconds converted so far (the pin's level is known up to here)
    this.j = Math.floor(t * FINE);               // the open fine bin
    this.acc = 0;                                // high time (s) in the open bin before this.t
    this.ring = new Float64Array(2 * TAPS); this.rpos = 0; this.same = TAPS; this.lastBin = 0; // the filter starts at rest (zeros)
    this.n = Math.ceil(t * SAMPLE_RATE);         // the next frame's index (ideal converter)
    this.points = [];                            // ideal: [centre time (s), duty]
    this.x1 = 0; this.y1 = 0; this.primed = false; // DC blocker
    this.out = []; this.outFrames = 0;
    this.mode = this.active(); this.fallback = this.converter === 'ideal' && this.mode !== 'ideal';
    if (this.pin >= 0 && this.m.ready && this.m.pwm?.tapSlice >= 0) this.m.pwm.wake(this.m.pwm.tapSlice); // its wraps, if 'ideal'
  }

  // ---- inputs from the machine ----
  /** The speaker pin's level changed at cycle c (gpio.js). */
  edge(level, c) {
    if (this.pin < 0) return;
    const t = this.m.nsAt(c) / 1e9;
    if (this.mode === 'pin') this.advanceTo(t);
    this.level = level;
  }
  /** The speaker's slice latched duty d (0..1) at cycle c for a period of `periodCycles` (pwm.js; the ideal converter). */
  duty(c, d, periodCycles) {
    if (this.mode !== 'ideal') return;
    const t0 = this.m.nsAt(c) / 1e9, T = periodCycles / this.m.freq.sys;
    this.points.push([t0 + T / 2, d]);
    if (this.points.length > 4096) this.points.splice(0, 2048);
  }

  // ---- the pin-accurate converter ----
  /** Integrate the present level up to time t (s), closing the fine bins on the way. */
  advanceTo(t) {
    if (t <= this.t) return;
    const v = this.level === 1 ? 1 : 0, jt = Math.floor(t * FINE);
    if (jt > this.j) {
      const end = (this.j + 1) / FINE;
      this.bin((this.acc + (v ? end - this.t : 0)) * FINE); this.j++; // the open bin closes
      let k = jt - this.j;                                               // whole bins at the present level
      while (k > 0 && (this.j % L !== 0 || this.same < TAPS || this.lastBin !== v)) { this.bin(v); this.j++; k--; }
      if (k >= L) { // the filter holds v throughout: whole frames of v without the filter (a pin idle for a long time)
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
  /** Fine bin j closed with high fraction x; the bin that ends a frame gives the frame. */
  bin(x) {
    // the ring is kept twice over (rpos and rpos + TAPS), so that the newest TAPS bins are contiguous from rpos + 1
    const r = this.ring, p0 = this.rpos;
    r[p0] = x; r[p0 + TAPS] = x;
    this.rpos = p0 + 1 === TAPS ? 0 : p0 + 1;
    if (x === this.lastBin) this.same++; else { this.same = 1; this.lastBin = x; }
    if ((this.j + 1) % L !== 0) return;
    // the filter is symmetric: fold the window and multiply each coefficient once
    const a = this.rpos, M = TAPS - 1;
    let acc = FIR[M >> 1] * r[a + (M >> 1)];
    for (let k = 0; k < M >> 1; k++) acc += FIR[k] * (r[a + k] + r[a + M - k]);
    this.emit(acc);
  }

  // ---- output ----
  emit(x) {
    if (!this.primed) { this.x1 = x; this.primed = true; }
    const y = x - this.x1 + DC_POLE * this.y1;
    this.x1 = x; this.y1 = y;
    const last = this.out[this.out.length - 1];
    if (!last || last.n === last.a.length) this.out.push({ a: new Float32Array(1024), n: 0 });
    const piece = this.out[this.out.length - 1];
    piece.a[piece.n++] = y; this.outFrames++;
  }
  /** The ideal converter's frames up to time t (s). */
  idealTo(t) {
    const pts = this.points;
    for (;;) {
      const tn = this.n / SAMPLE_RATE;
      if (tn > t) break;
      while (pts.length >= 2 && pts[1][0] <= tn) pts.shift();
      let d;
      if (pts.length >= 2 && pts[0][0] <= tn) { const [a, b] = pts; d = a[1] + ((b[1] - a[1]) * (tn - a[0])) / (b[0] - a[0]); }
      else if (pts.length >= 1 && (pts[0][0] > tn || t - pts[0][0] > 0.05)) d = pts[0][1]; // before the first centre, or the slice stopped
      else break; // wait for the next period's centre
      this.emit(d); this.n++;
    }
  }

  /**
   * The frames converted up to cycle c (at most maxFrames; the rest wait for the next call): {frames: [Float32Array], atCycle}
   * or null. The caller passes a cycle no event can still change (the engine: the earlier of now and the next event).
   */
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
