// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const gcd = (a, b) => { while (b) { const t = a % b; a = b; b = t; } return a; };
const LIMIT = 2 ** 52;
export class RateCounter {
 constructor() { this.base = 0; this.c0 = 0; this.num = 0; this.den = 1; }
 value(now) {
 if (this.num === 0) return this.base;
 let d = now - this.c0;
 if (d * this.num >= LIMIT) {
 const k = Math.floor(d / this.den);
 this.c0 += k * this.den; this.base += k * this.num; d = now - this.c0;
 }
 return this.base + Math.floor((d * this.num) / this.den);
 }
 setRate(now, num, den) {
 this.base = this.value(now); this.c0 = now;
 if (!num || !den) { this.num = 0; this.den = 1; return; }
 const g = gcd(num, den);
 this.num = num / g; this.den = den / g;
 }
 setValue(now, v) { this.base = v; this.c0 = now; }
 cycleFor(now, v) {
 const cur = this.value(now);
 if (v <= cur) return now;
 if (this.num === 0) return Infinity;
 return this.c0 + Math.ceil(((v - this.base) * this.den) / this.num);
 }
 save() { return [this.base, this.c0, this.num, this.den]; }
 load(s) { [this.base, this.c0, this.num, this.den] = s; }
}
