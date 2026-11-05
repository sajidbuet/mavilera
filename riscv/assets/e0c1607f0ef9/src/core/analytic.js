// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const finite = (v, name) => {
 if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name}: a finite number is expected`);
 return v;
};
export function amdahl(f, n) {
 finite(f, 'f'); finite(n, 'n');
 if (f < 0 || f > 1) throw new RangeError('f: a fraction from 0 to 1 is expected');
 if (n < 1) throw new RangeError('n: at least one lane is expected');
 const S = 1 / ((1 - f) + f / n);
 return { S, efficiency: S / n, ceiling: f === 1 ? Infinity : 1 / (1 - f) };
}
export function ridge({ peak, bandwidth }) {
 finite(peak, 'peak'); finite(bandwidth, 'bandwidth');
 if (peak <= 0 || bandwidth <= 0) throw new RangeError('peak and bandwidth must be positive');
 return peak / bandwidth;
}
export function roofline(machine, I) {
 finite(I, 'I');
 if (I <= 0) throw new RangeError('I: a positive intensity is expected');
 const r = ridge(machine);
 const P = Math.min(machine.peak, I * machine.bandwidth);
 return { P, ridge: r, bound: I < r ? 'memory' : 'compute', fraction: P / machine.peak };
}
export function intensity(ops, bytes) {
 finite(ops, 'ops'); finite(bytes, 'bytes');
 if (ops <= 0 || bytes <= 0) throw new RangeError('operations and bytes must be positive');
 return ops / bytes;
}
const count = (v, name) => {
 if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name}: a positive whole number is expected`);
 return v;
};
export function fcLayer(m, n) {
 count(m, 'inputs'); count(n, 'outputs');
 const macs = m * n;
 return { macs, ops: 2 * macs, weights: macs, inputs: m, outputs: n };
}
export function conv3x3(C, K, P) {
 count(C, 'input channels'); count(K, 'output channels'); count(P, 'output positions');
 const weights = K * 9 * C;
 const macs = weights * P;
 return { macs, ops: 2 * macs, weights, rows: K, cols: 9 * C, positions: P };
}
export function accumulator(terms, b = 8, acc = 32) {
 count(terms, 'terms');
 if (!Number.isInteger(b) || b < 2 || b > 16) throw new RangeError('operand width: 2 to 16 bits');
 if (!Number.isInteger(acc) || acc < 2 || acc > 64) throw new RangeError('accumulator width: 2 to 64 bits');
 const half = 2n ** BigInt(b - 1);
 const maxProduct = half * half;
 const minProduct = -half * (half - 1n);
 const maxSum = BigInt(terms) * maxProduct;
 const minSum = BigInt(terms) * minProduct;
 let w = 2;
 while (2n ** BigInt(w - 1) - 1n < maxSum || -(2n ** BigInt(w - 1)) > minSum) w++;
 const capacity = (2n ** BigInt(acc - 1) - 1n) / maxProduct;
 return {
 productBits: 2 * b, maxProduct: Number(maxProduct), minProduct: Number(minProduct),
 maxSum: Number(maxSum), minSum: Number(minSum), width: w, accBits: acc, capacity: Number(capacity),
 fits: w <= acc,
 };
}
export const roundHalfAway = (v) => Math.sign(v) * Math.round(Math.abs(v)) + 0;
export function quantParams(rmin, rmax, qmin = -128, qmax = 127) {
 finite(rmin, 'rmin'); finite(rmax, 'rmax');
 if (!(rmax > rmin)) throw new RangeError('the real range must have rmax > rmin');
 if (!Number.isInteger(qmin) || !Number.isInteger(qmax) || qmax <= qmin) throw new RangeError('integer range');
 const S = (rmax - rmin) / (qmax - qmin);
 const zReal = qmin - rmin / S;
 const Z = roundHalfAway(zReal);
 return { S, Z, zReal, qmin, qmax, zeroExact: Z >= qmin && Z <= qmax };
}
export function quantise(p, r) {
 finite(r, 'r');
 const exact = p.Z + r / p.S;
 const rounded = roundHalfAway(exact);
 const q = Math.min(p.qmax, Math.max(p.qmin, rounded));
 const back = p.S * (q - p.Z);
 return { exact, q, back, error: back - r, clamped: q !== rounded };
}
