// tools/i8086/timing-check.mjs -- the per-clock comparison of milestone 8086-B7 (roadmap §7; design
// docs/architecture/i8086-timing.md): a clocked model of the BIU, the queue and the EU against the per-clock records of
// SingleStepTests/8086 v1 ([TEST]; MIT; recorded on a CMOS P80C86A-2, not an NMOS 8086; read from outside the
// repository, never copied). Development tool. Without a calibrated model it measures the teaching model (L2,
// biu-model.js), whose clock counts are not the 8086's: the result is the B7 baseline, not a claim.
//
//   node tools/i8086/timing-check.mjs [--model l2|l3] [--only 90,05,50,8B,EB,74,E8,D3.4] [--limit N] [--json out.json]
//
// --model l3 runs CalibratedCore (src/arch/i8086/timing.js); its results are given for the calibrated forms (a row of
// EU_TIMING), the others counted apart (they keep the teaching model's EU timing, B7-Q4).
//
// Per test, over the test's clocks 0 .. L-1 (clock 0 = the clock whose queue status reports the instruction's first
// byte; L = the number of records = clocks from that first byte to the next instruction's first byte, IFUM Fig 4-22's
// and the suite's convention, research notes §9A Q3):
//   length  the model's clocks from its first-byte read to the next instruction's first-byte read, against L;
//   bus     the T state and bus cycle kind of every clock (T1-T4, Tw, Ti; CODE, MEMR, MEMW, IOR, IOW);
//   qs      the queue status of every clock (F, S, E or none).
// Alignment: a queue status on the pins reports the operation of the clock before (IFUM Table 4-4, PDF 253); the
// model records the event in its own clock. Model clock m (m = 0: the first-byte read) is the test's clock m - 1; its
// queue event appears in the test's clock m.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normFlags, CPU_REGS, phys } from '../../src/arch/i8086/cpu.js';
import { BiuCore, instructionDriver } from '../../src/arch/i8086/biu-model.js';
import { CalibratedCore, timingOf } from '../../src/arch/i8086/timing.js';

/** The cores the checker can run. */
export const MODELS = { l2: (o) => new BiuCore(o), l3: (o) => new CalibratedCore(o) };
import { available, files, load, exclusion, SST_DIR, SST_COMMIT } from './sst.mjs';

/** The eight opcode files of Stage 3E (research notes §9A), the scope of B7 decided by the author on 2026-11-06. */
export const B7_FILES = ['90', '05', '50', '8B', 'EB', '74', 'E8', 'D3.4'];
const KIND = { code: 'CODE', read: 'MEMR', write: 'MEMW', in: 'IOR', out: 'IOW' };

/** The test's lanes: bus[k] = 'T1:CODE' … or 'Ti'; qs[k] = 'F'|'S'|'E'|null. */
export function testLanes(t) {
  const bus = []; const qs = [];
  let kind = null;
  for (const c of t.cycles) {
    if (c[0] & 1) kind = c[7]; // ALE: T1 carries the cycle's status
    const st = c[8];
    bus.push(st === 'Ti' ? 'Ti' : `${st}:${kind}`);
    if (st === 'T4') kind = null;
    qs.push(c[9] === '-' ? null : c[9]);
  }
  return { bus, qs, length: t.cycles.length };
}

/**
 * The model's lanes for one test: `makeCore` builds a core with BiuCore's interface ({read, ip, queue}). After the
 * instruction, the EU of the next instruction takes one byte as soon as the queue has one (a stand-in step: the next
 * instruction is not known); that clock ends the instruction.
 */
export function modelLanes(t, { makeCore = (o) => new BiuCore(o), limit = 400 } = {}) {
  const regs = {};
  for (const r of CPU_REGS) regs[r] = t.initial.regs[r.toLowerCase()];
  regs.FLAGS = normFlags(regs.FLAGS);
  const mem = new Map(t.initial.ram);
  const drv = instructionDriver(regs, mem);
  if (drv.res.error) return { error: drv.res.error };
  const queue = t.initial.queue.map((v, i) => ({ a: phys(regs.CS, regs.IP + i), v }));
  const core = makeCore({ read: (a) => mem.get(a) ?? 0, ip: regs.IP, queue, waitStates: 0, driver: drv });
  const recs = [];
  let length = null;
  for (let i = 0; i < limit && drv.step; i++) recs.push(core.clock(drv));
  if (drv.step) return { error: 'the instruction did not finish' };
  // the next instruction's first byte: from CS:IP after the instruction
  const fin = drv.regs;
  const next = { CS: fin.CS, IP: fin.IP };
  let took = false;
  const tail = {
    get step() { return took ? { kind: 'idle' } : { kind: 'queue', transfers: [{ from: 'Q', value: null }] }; },
    get regs() { return next; },
    prefixes: 0,
    perform() { took = true; return true; },
  };
  for (let i = 0; i < limit && length === null; i++) {
    const r = core.clock(tail);
    recs.push(r);
    if (took) length = recs.length - 1;
  }
  const bus = recs.map((r) => (r.t === 'Ti' ? 'Ti' : `${r.t}:${KIND[r.cycle.kind]}`));
  const qs = recs.map((r) => r.qs ?? null);
  return { recs, length, bus: bus.slice(1), qs, d: drv.res.d };
}

/** The test's instruction, decoded (null if it cannot run). */
function decoded(t) {
  const regs = {};
  for (const r of CPU_REGS) regs[r] = t.initial.regs[r.toLowerCase()];
  regs.FLAGS = normFlags(regs.FLAGS);
  const res = instructionDriver(regs, new Map(t.initial.ram)).res;
  return res.error ? null : res.d;
}

/** Compare one test: {excluded?} or {length: [model, test], bus, qs (index of the first differing clock or -1), ok}. */
export function timingTest(t, file, opts = {}) {
  const why = exclusion(t, file);
  if (why) return { excluded: true, why };
  if (opts.calibratedOnly && !timingOf(decoded(t))) return { ok: false, calibrated: false };
  let m;
  try { m = modelLanes(t, opts); } catch (e) { return { ok: false, error: `model: ${e.message}` }; }
  if (m.error) return { ok: false, error: m.error };
  const w = testLanes(t);
  const first = (a, b) => { for (let k = 0; k < w.length; k++) if ((a[k] ?? 'none') !== (b[k] ?? 'none')) return k; return -1; };
  const bus = first(m.bus, w.bus);
  const qs = first(m.qs, w.qs);
  const ok = m.length === w.length && bus < 0 && qs < 0;
  return { ok, length: [m.length, w.length], bus, qs, model: m, test: w, calibrated: Boolean(timingOf(m.d)) };
}

/** One file: counts of exact tests, equal lengths, equal bus lanes, equal queue lanes; the length deltas. */
export function timingFile(file, { limit = Infinity, keep = 3, tests = load(file.name), ...opts } = {}) {
  const out = { name: file.name, total: 0, excluded: 0, errors: 0, uncalibrated: 0, exact: 0, length: 0, bus: 0, qs: 0, deltas: {}, failures: [] };
  tests.slice(0, limit).forEach((t, i) => {
    out.total += 1;
    const r = timingTest(t, file, opts);
    if (r.excluded) { out.excluded += 1; return; }
    if (r.error) { out.errors += 1; if (out.failures.length < keep) out.failures.push({ index: i, name: t.name, bytes: t.bytes, error: r.error }); return; }
    if (opts.calibratedOnly && !r.calibrated) { out.uncalibrated += 1; return; }
    if (r.ok) out.exact += 1;
    if (r.length[0] === r.length[1]) out.length += 1;
    if (r.bus < 0) out.bus += 1;
    if (r.qs < 0) out.qs += 1;
    const d = r.length[0] - r.length[1];
    out.deltas[d] = (out.deltas[d] ?? 0) + 1;
    if (!r.ok && out.failures.length < keep) {
      out.failures.push({ index: i, name: t.name, bytes: t.bytes, length: r.length, bus: r.bus, qs: r.qs,
        modelBus: r.model.bus.slice(0, r.length[1]).join(' '), testBus: r.test.bus.join(' ') });
    }
  });
  return out;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (!available()) { console.log(`SingleStepTests/8086 not found at ${SST_DIR}`); process.exit(2); }
  const only = (arg('--only')?.split(',') ?? B7_FILES).map((s) => s.toUpperCase());
  const limit = Number(arg('--limit') ?? Infinity);
  const model = (arg('--model') ?? 'l2').toLowerCase();
  if (!MODELS[model]) { console.log(`unknown model ${model}`); process.exit(2); }
  const calibratedOnly = model === 'l3';
  const list = files().filter((f) => only.includes(f.name) && existsSync(join(SST_DIR, `${f.name}.json.gz`)));
  const results = [];
  const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)} %` : '-');
  for (const f of list) {
    const r = timingFile(f, { limit, makeCore: MODELS[model], calibratedOnly });
    results.push(r);
    const n = r.total - r.excluded - r.errors - r.uncalibrated;
    if (calibratedOnly) console.log(`${f.name.padEnd(5)} uncalibrated ${r.uncalibrated}`);
    const deltas = Object.entries(r.deltas).sort((a, b) => a[0] - b[0]).map(([d, c]) => `${d > 0 ? '+' : ''}${d}:${c}`).join(' ');
    console.log(`${f.name.padEnd(5)} tests ${n}  exact ${pct(r.exact, n)}  length ${pct(r.length, n)}  bus ${pct(r.bus, n)}  qs ${pct(r.qs, n)}  errors ${r.errors}  length deltas (model - test) ${deltas}`);
  }
  for (const r of results) for (const x of r.failures) console.log(`  ${r.name} #${x.index} ${x.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}: ${x.error ?? `length ${x.length}, bus from ${x.bus}, qs from ${x.qs}\n    model ${x.modelBus}\n    test  ${x.testBus}`}`);
  console.log(`commit ${SST_COMMIT}; model: ${model === 'l3' ? 'calibrated (L3, timing.js), calibrated forms only' : 'teaching model (L2)'}, wait states 0`);
  const json = arg('--json');
  if (json) writeFileSync(json, JSON.stringify({ commit: SST_COMMIT, model, files: results }, null, 1));
}
