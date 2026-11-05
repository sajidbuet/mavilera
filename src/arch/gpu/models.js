// gpu/models.js -- the analytical models of the GPU chapter that the Models view draws (GPU-4, gate K;
// docs/research/gpu-npu/roadmaps/GPU_DEVELOPMENT_ROADMAP.md): one loop on four machines, strip-mining with a run-time
// vector length, the thread indexing of a launch, blocks assigned to streaming multiprocessors, latency hiding by
// switching warps, occupancy against the register file, coalescing of a warp's addresses into transactions and
// shared-memory bank conflicts. Amdahl's law is the shared one (src/core/analytic.js).
// Pure functions of numbers, no DOM: the view (ui/models-view.js) only draws what these return. Where the chapter
// leaves a rule open, the rule here is MAVILERA's and is named so in the help: the scalar remainder of packed SIMD,
// the order in which blocks go to SMs, and the scheduler that stays with a warp until its load.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const whole = (v, name, min = 1, max = 1 << 20) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new RangeError(`${name}: a whole number from ${min} to ${max} is expected`);
  return v;
};
const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);

/** Lane 0 first, as the chapter writes masks: '1' for an active lane. */
export const maskText = (bits) => bits.map((b) => (b ? '1' : '0')).join('');

// --- one loop, four machines ---------------------------------------------------------------------------------------------

/**
 * The additions of c[i] = a[i] + b[i] for n elements as frames, a frame being what one instruction covers:
 *   scalar   one element per instruction;
 *   packed   `simd` elements per instruction while a whole group is left, then one scalar instruction per remaining
 *            element (the remainder code the chapter mentions; MAVILERA's choice of what it is);
 *   vector   strips of vl = min(AVL, VLMAX) elements, one instruction each;
 *   simt     one instruction per warp of `warp` threads, the last warp with only its threads below n active.
 * Each machine: {frames: [{from, to, kind?}], instructions}; the SIMT one also {warps, lastMask}.
 */
export function fourMachines(n, simd = 4, vlmax = 8, warp = 8) {
  whole(n, 'elements', 1, 4096); whole(simd, 'packed width', 1, 64); whole(vlmax, 'VLMAX', 1, 4096); whole(warp, 'warp size', 1, 64);
  const groups = (size) => Array.from({ length: ceilDiv(n, size) }, (_, g) => ({ from: g * size, to: Math.min(n, (g + 1) * size) - 1 }));
  const packed = [];
  const full = Math.floor(n / simd);
  for (let g = 0; g < full; g++) packed.push({ from: g * simd, to: g * simd + simd - 1, kind: 'packed' });
  for (let i = full * simd; i < n; i++) packed.push({ from: i, to: i, kind: 'scalar' });
  const warps = groups(warp);
  const lastCount = n - (warps.length - 1) * warp;
  return {
    n,
    scalar: { frames: groups(1), instructions: n },
    packed: { frames: packed, instructions: packed.length, remainder: n - full * simd },
    vector: { frames: groups(vlmax), instructions: ceilDiv(n, vlmax) },
    simt: { frames: warps.map((f) => ({ ...f, to: f.from + warp - 1 })), instructions: warps.length, warps: warps.length,
      lastMask: maskText(Array.from({ length: warp }, (_, l) => l < lastCount)) },
  };
}

// --- strip-mining (the V extension's vsetvli, LMUL = 1) ------------------------------------------------------------------

/**
 * The vector lengths vsetvli may return for an application vector length avl on a machine with VLMAX vlmax:
 * avl itself when avl <= VLMAX, VLMAX when avl >= 2 VLMAX, and in between any value from ceil(avl / 2) to VLMAX.
 */
export function allowedVl(avl, vlmax) {
  whole(avl, 'AVL', 0, 1 << 24); whole(vlmax, 'VLMAX', 1, 4096);
  if (avl <= vlmax) return { lo: avl, hi: avl };
  if (avl >= 2 * vlmax) return { lo: vlmax, hi: vlmax };
  return { lo: ceilDiv(avl, 2), hi: vlmax };
}

/**
 * The strips of a loop over n elements that advances by the returned vl. policy 'max' returns min(AVL, VLMAX), 'min'
 * the smallest permitted value. Each strip: {avl, vl, from, to, lo, hi} (lo..hi the permitted range).
 */
export function strips(n, vlmax, policy = 'max') {
  whole(n, 'elements', 1, 1 << 16); whole(vlmax, 'VLMAX', 1, 4096);
  if (policy !== 'max' && policy !== 'min') throw new RangeError('policy: max or min');
  const out = [];
  let avl = n, at = 0;
  while (avl > 0) {
    const r = allowedVl(avl, vlmax);
    const vl = policy === 'max' ? r.hi : r.lo;
    out.push({ avl, vl, from: at, to: at + vl - 1, lo: r.lo, hi: r.hi });
    at += vl;
    avl -= vl;
  }
  return out;
}

/** VLMAX = VLEN / SEW for LMUL = 1 (VLEN and SEW in bits). */
export function vlmaxOf(vlen, sew) {
  whole(vlen, 'VLEN', 8, 65536); whole(sew, 'SEW', 8, 64);
  if (vlen % sew) throw new RangeError('VLEN must be a multiple of SEW');
  return vlen / sew;
}

// --- a launch: grid, blocks, warps ---------------------------------------------------------------------------------------

/**
 * A launch of a kernel over n elements with blocks of `block` threads, split into warps of `warp` consecutive threads:
 * grid_size = ceil(n / block); thread i = block_index x block_size + thread_index; threads with i >= n are the tail.
 * Returns {blocks, threads, warpsPerBlock, warps, active, idle, partial: [{block, warp, from, mask, active}]} where
 * `partial` lists the warps whose mask is not full (lane 0 first; a lane past the block's last thread is 0).
 */
export function launch(n, block, warp) {
  whole(n, 'elements', 1, 1 << 24); whole(block, 'block size', 1, 4096); whole(warp, 'warp size', 1, 64);
  const blocks = ceilDiv(n, block);
  const warpsPerBlock = ceilDiv(block, warp);
  const partial = [];
  for (let b = 0; b < blocks; b++) for (let w = 0; w < warpsPerBlock; w++) {
    const bits = Array.from({ length: warp }, (_, l) => { const t = w * warp + l; return t < block && b * block + t < n; });
    const active = bits.filter(Boolean).length;
    if (active < warp) partial.push({ block: b, warp: w, from: b * block + w * warp, mask: maskText(bits), active });
  }
  return { n, block, warp, blocks, threads: blocks * block, warpsPerBlock, warps: blocks * warpsPerBlock, active: n, idle: blocks * block - n, partial };
}

/** The place of element i in a launch: {block, thread, warp, lane}. */
export function locate(i, block, warp) {
  whole(i, 'element', 0, 1 << 24); whole(block, 'block size'); whole(warp, 'warp size');
  const thread = i % block;
  return { block: Math.floor(i / block), thread, warp: Math.floor(thread / warp), lane: thread % warp };
}

/**
 * Whole blocks assigned to SMs (MAVILERA's declared order): block b goes to SM b mod sms; an SM holds at most
 * `perSm` blocks at a time, so the blocks run in waves of sms x perSm, a wave starting when the previous one has
 * finished. Returns {waves, sms: [[block...] per SM], wave: [wave of each block]}.
 */
export function assignBlocks(blocks, sms, perSm = 1) {
  whole(blocks, 'blocks', 1, 1 << 16); whole(sms, 'SMs', 1, 256); whole(perSm, 'blocks per SM', 1, 64);
  const per = sms * perSm;
  return {
    waves: ceilDiv(blocks, per),
    sms: Array.from({ length: sms }, (_, s) => Array.from({ length: blocks }, (_, b) => b).filter((b) => b % sms === s)),
    wave: Array.from({ length: blocks }, (_, b) => Math.floor(b / per)),
  };
}

// --- latency hiding and occupancy ----------------------------------------------------------------------------------------

/** The warps that hide a latency of L cycles when a warp issues k instructions per load: W >= (L - 1) / k + 1. */
export function warpsNeeded(k, L) {
  whole(k, 'instructions per load', 1, 1000); whole(L, 'latency', 1, 100000);
  const bound = (L - 1) / k + 1;
  return { bound, warps: Math.ceil(bound - 1e-12) };
}

/**
 * The declared model of the latency figure: W warps, each issuing k instructions per round, the k-th a load whose data
 * return L cycles after it issues (the warp may issue again from then on); one issue per cycle. The scheduler stays
 * with a warp until it has issued its load, then takes the next ready warp in round-robin order (MAVILERA's reading
 * of "picks ready warps in turn"); a cycle with no ready warp is idle. A warp ends after `rounds` rounds.
 * Returns {issues: [{warp, cycle, round, load}], perWarp: [[cycle...]], idle: [cycle...], cycles, needed, fraction}
 * where fraction = k W / (k - 1 + L), at most 1, is the steady-state share of cycles that issue.
 */
export function schedule(W, k, L, rounds = 2) {
  whole(W, 'warps', 1, 32); whole(k, 'instructions per load', 1, 64); whole(L, 'latency', 1, 1000); whole(rounds, 'rounds', 1, 16);
  const ready = new Array(W).fill(0), done = new Array(W).fill(0), pos = new Array(W).fill(0);
  const issues = [], idle = [], perWarp = Array.from({ length: W }, () => []);
  let cur = 0, mid = false, t = 0;
  const limit = rounds * W * (k + L) + 1;
  while (done.some((r) => r < rounds)) {
    if (t > limit) throw new Error('schedule: no progress');
    let w = -1;
    if (mid) w = cur;
    else for (let j = 0; j < W; j++) { const c = (cur + j) % W; if (done[c] < rounds && ready[c] <= t) { w = c; break; } }
    if (w < 0) { idle.push(t); t++; continue; }
    const load = pos[w] === k - 1;
    issues.push({ warp: w, cycle: t, round: done[w], load });
    perWarp[w].push(t);
    if (load) { ready[w] = t + L; done[w]++; pos[w] = 0; mid = false; cur = (w + 1) % W; } else { pos[w]++; mid = true; cur = w; }
    t++;
  }
  const need = warpsNeeded(k, L);
  return { W, k, L, rounds, issues, perWarp, idle, cycles: t, needed: need.warps, bound: need.bound, fraction: Math.min(1, (k * W) / (k - 1 + L)) };
}

/**
 * Occupancy against the register file: a warp of `warp` threads with `regs` registers per thread needs warp x regs
 * registers; floor(regFile / that) warps fit (at most maxWarps when given). With k instructions per load of latency L,
 * the SM issues in min(1, k W_res / (k - 1 + L)) of its cycles.
 */
export function occupancy({ regFile, warp, regs, k, L, maxWarps = null }) {
  whole(regFile, 'register file', 1, 1 << 24); whole(warp, 'warp size', 1, 64); whole(regs, 'registers per thread', 1, 1024);
  const perWarp = warp * regs;
  let resident = Math.floor(regFile / perWarp);
  if (maxWarps !== null) resident = Math.min(resident, whole(maxWarps, 'warp limit', 1, 1024));
  const need = warpsNeeded(k, L);
  return { perWarp, resident, needed: need.warps, bound: need.bound, hidden: resident >= need.bound,
    fraction: resident ? Math.min(1, (k * resident) / (k - 1 + L)) : 0 };
}

// --- coalescing ----------------------------------------------------------------------------------------------------------

/**
 * A warp's load: lane i reads the word of `word` bytes at byte base + i x stride x word. Memory delivers aligned
 * blocks of `blockBytes`; every block that at least one lane needs costs one transaction (a word that straddles two
 * blocks needs both). Returns {addresses, laneBlocks: [[block...] per lane], blocks: [sorted], transactions,
 * delivered, used (distinct bytes read), efficiency}.
 */
export function coalesce({ lanes = 32, word = 4, stride = 1, base = 0, blockBytes = 64 }) {
  whole(lanes, 'lanes', 1, 64); whole(word, 'word bytes', 1, 16); whole(stride, 'stride', 0, 1024);
  whole(base, 'first byte', 0, 1 << 20); whole(blockBytes, 'block bytes', 1, 4096);
  const addresses = Array.from({ length: lanes }, (_, i) => base + i * stride * word);
  const laneBlocks = addresses.map((a) => { const lo = Math.floor(a / blockBytes), hi = Math.floor((a + word - 1) / blockBytes); return hi > lo ? [lo, hi] : [lo]; });
  const blocks = [...new Set(laneBlocks.flat())].sort((a, b) => a - b);
  const bytes = new Set();
  for (const a of addresses) for (let j = 0; j < word; j++) bytes.add(a + j);
  const delivered = blocks.length * blockBytes;
  return { addresses, laneBlocks, blocks, transactions: blocks.length, delivered, used: bytes.size, efficiency: bytes.size / delivered };
}

// --- shared-memory banks -------------------------------------------------------------------------------------------------

/**
 * Lane l reads word base + stride x l of a shared memory of `banks` banks, word a in bank a mod banks. A bank delivers
 * one word per cycle and broadcasts a word that several lanes read; the access takes as many cycles as the largest
 * number of distinct words in one bank (the conflict degree). Returns {words, bank: [bank of each lane],
 * perBank: [{words: [distinct words], lanes: [lane...]}], cycles}.
 */
export function bankAccess({ lanes = 8, banks = 8, stride = 1, base = 0 }) {
  whole(lanes, 'lanes', 1, 64); whole(banks, 'banks', 1, 64); whole(stride, 'stride', 0, 1024); whole(base, 'first word', 0, 1 << 20);
  const words = Array.from({ length: lanes }, (_, l) => base + stride * l);
  const bank = words.map((w) => w % banks);
  const perBank = Array.from({ length: banks }, () => ({ words: [], lanes: [] }));
  words.forEach((w, l) => { const p = perBank[bank[l]]; p.lanes.push(l); if (!p.words.includes(w)) p.words.push(w); });
  return { words, bank, perBank, cycles: Math.max(...perBank.map((p) => p.words.length)) };
}
