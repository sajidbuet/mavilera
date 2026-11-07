// counter.js -- a counter that advances at a rational rate per clk_sys cycle (num/den, reduced), for the tick-driven timers of
// the RP2350 (TIMER0/1 and the RISC-V platform timer count ticks of the TICKS block, which divides clk_ref: RP-001 §8.5, §12.8).
// value(now) = base + floor((now - c0) * num / den), exact in integer arithmetic on doubles: the base moves forward by whole
// periods of den cycles so that the products stay below 2^53. cycleFor(v) inverts it: the first cycle at which the count
// reaches v. Simulated time never depends on wall time (ADR-0003).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const gcd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
const LIMIT = 2 ** 52;

export class RateCounter {
  constructor() { this.base = 0; this.c0 = 0; this.num = 0; this.den = 1; }

  /** The count at cycle `now` (a whole number). */
  value(now) {
    if (this.num === 0) return this.base;
    let d = now - this.c0;
    if (d * this.num >= LIMIT) { // move the base by whole periods (den cycles = num counts) to keep the product exact
      const k = Math.floor(d / this.den);
      this.c0 += k * this.den; this.base += k * this.num; d = now - this.c0;
    }
    return this.base + Math.floor((d * this.num) / this.den);
  }

  /** Change the rate at `now` to `num` counts per `den` cycles (num 0: stopped); the count so far is kept. */
  setRate(now, num, den) {
    this.base = this.value(now); this.c0 = now;
    if (!num || !den) { this.num = 0; this.den = 1; return; }
    const g = gcd(num, den);
    this.num = num / g; this.den = den / g;
  }

  /** Set the count at `now` (a write of the timer). */
  setValue(now, v) { this.base = v; this.c0 = now; }

  /** The first cycle at which the count is at least `v` (now or later); Infinity if it never gets there. */
  cycleFor(now, v) {
    const cur = this.value(now);
    if (v <= cur) return now;
    if (this.num === 0) return Infinity;
    return this.c0 + Math.ceil(((v - this.base) * this.den) / this.num);
  }

  save() { return [this.base, this.c0, this.num, this.den]; }
  load(s) { [this.base, this.c0, this.num, this.den] = s; }
}
