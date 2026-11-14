// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e+0;
const SQRT2 = 1.41421356237309514547;
const buf = new DataView(new ArrayBuffer(8));
function pow2(k) {
 if (k > 1023) return pow2(1023) * pow2(k - 1023);
 if (k < -1022) return pow2(-1022) * pow2(k + 1022);
 buf.setUint32(0, ((k + 1023) << 20) >>> 0); buf.setUint32(4, 0);
 return buf.getFloat64(0);
}
export function exp(x) {
 if (x !== x) return NaN;
 if (x > 709.782712893384) return Infinity;
 if (x < -745.1332191019412) return 0;
 const k = Math.round(x * INV_LN2);
 const r = (x - k * LN2_HI) - k * LN2_LO;
 let p = 1 / 87178291200;
 p = 1 / 6227020800 + r * p; p = 1 / 479001600 + r * p; p = 1 / 39916800 + r * p; p = 1 / 3628800 + r * p;
 p = 1 / 362880 + r * p; p = 1 / 40320 + r * p; p = 1 / 5040 + r * p; p = 1 / 720 + r * p; p = 1 / 120 + r * p;
 p = 1 / 24 + r * p; p = 1 / 6 + r * p; p = 0.5 + r * p; p = 1 + r * p; p = 1 + r * p;
 return p * pow2(k);
}
export function log(x) {
 if (x !== x || x < 0) return NaN;
 if (x === 0) return -Infinity;
 if (x === Infinity) return Infinity;
 let e = 0;
 if (x < 2.2250738585072014e-308) { x *= 18014398509481984; e = -54; }
 buf.setFloat64(0, x);
 const hi = buf.getUint32(0);
 e += ((hi >>> 20) & 0x7ff) - 1023;
 buf.setUint32(0, (hi & 0x000fffff) | 0x3ff00000);
 let m = buf.getFloat64(0);
 if (m > SQRT2) { m /= 2; e += 1; }
 const s = (m - 1) / (m + 1), s2 = s * s;
 let q = 1 / 25;
 for (let d = 23; d >= 1; d -= 2) q = 1 / d + s2 * q;
 return e * LN2_HI + (e * LN2_LO + 2 * s * q);
}
