// analytic.js -- the analytical models of Chapter 11 shared by the modules (NPU-4; the `gpu` module reuses them,
// docs/research/gpu-npu/roadmaps/INTEGRATION_ROADMAP.md §2): parallel Amdahl (Eq. 11.1, WE 11.1, FIG-0106),
// roofline (Def. 11.3, Eq. 11.2, Table 11.3, WE 11.8, FIG-0115), the multiply-accumulates of a layer (FIG-0112),
// the accumulator width of INT8 products (WE 11.5) and scale and zero point (Example of Section 11.4.4).
// Pure functions of numbers, no DOM, no architecture: the panels (src/ui/analytic-panels.js) only draw what these
// return. Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const finite = (v, name) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`${name}: a finite number is expected`);
  return v;
};

// --- Amdahl's law for many lanes (Section 11.1.2) ---------------------------------------------------------------------

/**
 * Speed-up of a program whose fraction f (0 <= f <= 1) of the original time is spread over n lanes:
 * S = 1 / ((1 - f) + f / n) (Eq. 11.1). Returns {S, efficiency: S / n, ceiling: 1 / (1 - f) (Infinity at f = 1)}.
 */
export function amdahl(f, n) {
  finite(f, 'f'); finite(n, 'n');
  if (f < 0 || f > 1) throw new RangeError('f: a fraction from 0 to 1 is expected');
  if (n < 1) throw new RangeError('n: at least one lane is expected');
  const S = 1 / ((1 - f) + f / n);
  return { S, efficiency: S / n, ceiling: f === 1 ? Infinity : 1 / (1 - f) };
}

// --- roofline (Section 11.5) ------------------------------------------------------------------------------------------

/** The ridge point P_peak / B_mem of a machine {peak, bandwidth} (same time unit for both). */
export function ridge({ peak, bandwidth }) {
  finite(peak, 'peak'); finite(bandwidth, 'bandwidth');
  if (peak <= 0 || bandwidth <= 0) throw new RangeError('peak and bandwidth must be positive');
  return peak / bandwidth;
}

/**
 * Attainable performance of a kernel of intensity I (operations per byte) on a machine {peak, bandwidth}:
 * P = min(P_peak, I x B_mem) (Eq. 11.2). Returns {P, ridge, bound: 'memory' left of the ridge, 'compute' at or right
 * of it, fraction: P / P_peak}.
 */
export function roofline(machine, I) {
  finite(I, 'I');
  if (I <= 0) throw new RangeError('I: a positive intensity is expected');
  const r = ridge(machine);
  const P = Math.min(machine.peak, I * machine.bandwidth);
  return { P, ridge: r, bound: I < r ? 'memory' : 'compute', fraction: P / machine.peak };
}

/** Intensity of a kernel that performs `ops` operations while moving `bytes` bytes across the named interface. */
export function intensity(ops, bytes) {
  finite(ops, 'ops'); finite(bytes, 'bytes');
  if (ops <= 0 || bytes <= 0) throw new RangeError('operations and bytes must be positive');
  return ops / bytes;
}

// --- a layer is a set of multiply-accumulates (Section 11.4.1) ------------------------------------------------------

const count = (v, name) => {
  if (!Number.isSafeInteger(v) || v < 1) throw new RangeError(`${name}: a positive whole number is expected`);
  return v;
};

/**
 * A fully connected layer with m inputs and n outputs, per input vector: m x n MACs (= weights), 2mn operations
 * (a MAC counts as a multiplication and an addition).
 */
export function fcLayer(m, n) {
  count(m, 'inputs'); count(n, 'outputs');
  const macs = m * n;
  return { macs, ops: 2 * macs, weights: macs, inputs: m, outputs: n };
}

/**
 * A 3 x 3 convolution over C input channels to K output channels at P output positions, in the matrix form of the
 * chapter: a K x 9C weight matrix times a 9C x P matrix. MACs K x 9C x P, weights K x 9C.
 */
export function conv3x3(C, K, P) {
  count(C, 'input channels'); count(K, 'output channels'); count(P, 'output positions');
  const weights = K * 9 * C;
  const macs = weights * P;
  return { macs, ops: 2 * macs, weights, rows: K, cols: 9 * C, positions: P };
}

// --- accumulator width (Section 11.4.2, WE 11.5) ---------------------------------------------------------------------

/**
 * The accumulator for a sum of `terms` products of two signed b-bit integers (b = 8 for INT8):
 *   maxProduct = (-2^(b-1))^2, the largest product (2^14 for INT8),
 *   minProduct = -2^(b-1) (2^(b-1) - 1), the most negative one,
 *   maxSum, minSum = terms x those, width = the smallest signed width w with -2^(w-1) <= minSum and
 *   maxSum <= 2^(w-1) - 1, capacity = floor((2^(acc-1) - 1) / maxProduct) worst-case products in an acc-bit
 *   accumulator (acc = 32 by default).
 */
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

// --- scale and zero point (Section 11.4.4, self-study) ----------------------------------------------------------------

/** Round to the nearest integer, halves away from zero (the rounding the panels state). */
export const roundHalfAway = (v) => Math.sign(v) * Math.round(Math.abs(v)) + 0;

/**
 * The affine map r = S (q - Z) of a real range [rmin, rmax] onto the integers [qmin, qmax] (signed INT8 by default):
 * S = (rmax - rmin) / (qmax - qmin), Z = round(qmin - rmin / S). `zeroExact` tells whether Z lies inside
 * [qmin, qmax], so that the real 0 is represented exactly.
 */
export function quantParams(rmin, rmax, qmin = -128, qmax = 127) {
  finite(rmin, 'rmin'); finite(rmax, 'rmax');
  if (!(rmax > rmin)) throw new RangeError('the real range must have rmax > rmin');
  if (!Number.isInteger(qmin) || !Number.isInteger(qmax) || qmax <= qmin) throw new RangeError('integer range');
  const S = (rmax - rmin) / (qmax - qmin);
  const zReal = qmin - rmin / S;
  const Z = roundHalfAway(zReal);
  return { S, Z, zReal, qmin, qmax, zeroExact: Z >= qmin && Z <= qmax };
}

/**
 * Quantise a real value with {S, Z, qmin, qmax}: q = clamp(round(Z + r / S)); back = S (q - Z); error = back - r.
 * `clamped` tells whether r lay outside the representable range.
 */
export function quantise(p, r) {
  finite(r, 'r');
  const exact = p.Z + r / p.S;
  const rounded = roundHalfAway(exact);
  const q = Math.min(p.qmax, Math.max(p.qmin, rounded));
  const back = p.S * (q - p.Z);
  return { exact, q, back, error: back - r, clamped: q !== rounded };
}
