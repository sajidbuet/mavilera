// tools/i8086/biu-check.mjs -- the checks of milestone 8086-B5 (docs/architecture/i8086-biu.md §6): the clocked BIU and
// queue (src/arch/i8086/biu-model.js, L2) on every SingleStepTests/8086 v1 case ([TEST]; MIT; a CMOS P80C86A-2; read
// from outside the repository, never copied). Development tool.
//
//   node tools/i8086/biu-check.mjs [--limit N] [--only 00,8B,F6.7] [--waits N] [--json out.json]
//
// Per test, from the test's registers, memory and initial queue: (1) the model's invariants (invariantProblems);
// (2) the queue events of the model and the test, counted: first bytes (F), subsequent bytes (S), flushes (E);
// (3) the EU's data bus cycles (MEMR, MEMW, IOR, IOW) equal in order, address and width (byte or word); (4) after a
// flush, the first code fetch has the test's address and width. None of these depends on clock counts: L2 makes no
// claim about them (roadmap §5).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normFlags, CPU_REGS, phys } from '../../src/arch/i8086/cpu.js';
import { BiuCore, instructionDriver, runClocked, QUEUE_SIZE, FETCH_FREE } from '../../src/arch/i8086/biu-model.js';
import { available, files, load, exclusion, SST_DIR, SST_COMMIT } from './sst.mjs';

const hex = (v, n = 5) => v.toString(16).toUpperCase().padStart(n, '0');
const KIND = { MEMR: 'read', MEMW: 'write', IOR: 'in', IOW: 'out' };
const cyc = (c) => `${c.kind}:${hex(c.address)}/${c.size}`;

/**
 * The model's invariants over a list of clock records (design §6): queue length 0-6; a code fetch starts only with two
 * bytes free; a flush leaves the queue empty and the first code fetch after it is at the target, one byte when the
 * target is odd; every bus cycle runs T1 T2 T3 (Tw × waitStates) T4; every byte the EU takes comes from the address
 * its IP names. `bytes` (optional) is the list of instruction byte lists, in order, that the EU must take.
 */
export function invariantProblems(records, { waitStates = 0, bytes = null } = {}) {
  const p = [];
  const seq = ['T1', 'T2', 'T3', ...Array(waitStates).fill('Tw'), 'T4'];
  let pos = -1; let afterFlush = null;
  const taken = []; let cur = [];
  for (const r of records) {
    if (r.q < 0 || r.q > QUEUE_SIZE) p.push(`clock ${r.n}: queue length ${r.q}`);
    if (r.t === 'Ti') { if (pos >= 0) p.push(`clock ${r.n}: cycle cut short`); pos = -1; } else {
      pos = r.t === 'T1' ? 0 : pos + 1;
      if (seq[pos] !== r.t) p.push(`clock ${r.n}: ${r.t} where ${seq[pos] ?? 'nothing'} was due`);
      if (r.t === 'T4') pos = -1;
    }
    if (r.start && r.cycle.kind === 'code' && r.start.free < FETCH_FREE) p.push(`clock ${r.n}: fetch started with ${r.start.free} free`);
    if (r.qs === 'E') {
      if (r.q !== 0) p.push(`clock ${r.n}: queue not empty after the flush`);
      afterFlush = r.flushTo;
    }
    if (afterFlush && r.start && r.cycle.kind === 'code') {
      const a = phys(afterFlush.cs, afterFlush.ip);
      if (r.cycle.address !== a) p.push(`clock ${r.n}: first fetch after the flush at ${hex(r.cycle.address)}, target ${hex(a)}`);
      if ((afterFlush.ip & 1) !== (r.cycle.size === 8 ? 1 : 0)) p.push(`clock ${r.n}: first fetch after the flush ${r.cycle.size} bits, target ${hex(a)}`);
      afterFlush = null;
    }
    if (r.took) {
      if (r.took.a !== r.took.expected) p.push(`clock ${r.n}: byte from ${hex(r.took.a)}, IP names ${hex(r.took.expected)}`);
      cur.push(r.took.v);
    }
    if (r.finished) { taken.push(cur); cur = []; }
  }
  if (bytes) {
    const want = JSON.stringify(bytes); const got = JSON.stringify(taken);
    if (want !== got) p.push(`bytes taken ${got}, instruction bytes ${want}`);
  }
  return p;
}

/** The test's per-clock record, reduced to what L2 can be compared on. */
export function testBus(t) {
  const letters = { F: 0, S: 0, E: 0 };
  const data = []; const code = [];
  let firstE = -1;
  t.cycles.forEach((c, i) => {
    if (c[9] in letters) letters[c[9]] += 1;
    if (c[9] === 'E' && firstE < 0) firstE = i;
    if (!(c[0] & 1)) return; // ALE: T1
    const io = c[7] === 'IOR' || c[7] === 'IOW';
    const a = c[1] & (io ? 0xffff : 0xfffff);
    const size = !(a & 1) && c[5] === 0 ? 16 : 8; // BHE active at an even address: a word
    if (KIND[c[7]]) data.push({ kind: KIND[c[7]], address: a, size });
    else if (c[7] === 'CODE') code.push({ i, kind: 'code', address: a, size });
  });
  const afterE = firstE < 0 ? null : code.find((c) => c.i >= firstE) ?? null;
  return { letters, data, afterE };
}

/** One [TEST] case: excluded, or {ok, diffs}. */
export function biuTest(t, file, { waitStates = 0 } = {}) {
  const why = exclusion(t, file);
  if (why) return { excluded: true, why };
  const regs = {};
  for (const r of CPU_REGS) regs[r] = t.initial.regs[r.toLowerCase()];
  regs.FLAGS = normFlags(regs.FLAGS);
  const mem = new Map(t.initial.ram);
  const drv = instructionDriver(regs, mem);
  if (drv.res.error) return { ok: false, diffs: [`stopped: ${drv.res.error}`] };
  const queue = t.initial.queue.map((v, i) => ({ a: phys(regs.CS, regs.IP + i), v }));
  const core = new BiuCore({ read: (a) => mem.get(a) ?? 0, ip: regs.IP, queue, waitStates });
  const recs = runClocked(core, drv, { tail: 12 });
  const diffs = invariantProblems(recs, { waitStates, bytes: [drv.res.d.bytes] });
  if (drv.step) diffs.push('the instruction did not finish');
  const want = testBus(t);
  const got = { F: 0, S: 0, E: 0 };
  for (const r of recs) if (r.qs) got[r.qs] += 1;
  for (const k of ['F', 'S', 'E']) if (got[k] !== want.letters[k]) diffs.push(`${k} events: model ${got[k]}, [TEST] ${want.letters[k]}`);
  const data = recs.filter((r) => r.start && r.cycle.kind !== 'code').map((r) => cyc(r.cycle)).join(' ');
  const wantData = want.data.map(cyc).join(' ');
  if (data !== wantData) diffs.push(`data cycles: model ${data}; [TEST] ${wantData}`);
  if (want.afterE) {
    const e = recs.findIndex((r) => r.qs === 'E');
    const first = recs.slice(e).find((r) => r.start && r.cycle.kind === 'code');
    const g = first ? cyc(first.cycle) : 'none'; const w = cyc(want.afterE);
    if (g !== w) diffs.push(`first fetch after the flush: model ${g}, [TEST] ${w}`);
  }
  return { ok: diffs.length === 0, diffs, clocks: recs.length };
}

/** Check a file of tests: {name, total, pass, fail, excluded, failures}. */
export function biuFile(file, { limit = Infinity, keep = 5, waitStates = 0, tests = load(file.name) } = {}) {
  const out = { name: file.name, total: 0, pass: 0, fail: 0, excluded: 0, failures: [] };
  tests.slice(0, limit).forEach((t, i) => {
    out.total += 1;
    const r = biuTest(t, file, { waitStates });
    if (r.excluded) out.excluded += 1; else if (r.ok) out.pass += 1;
    else {
      out.fail += 1;
      if (out.failures.length < keep) out.failures.push({ index: i, name: t.name, bytes: t.bytes, diffs: r.diffs.slice(0, 6) });
    }
  });
  return out;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (!available()) { console.log(`SingleStepTests/8086 not found at ${SST_DIR}`); process.exit(2); }
  const only = arg('--only')?.split(',').map((s) => s.toUpperCase());
  const limit = Number(arg('--limit') ?? Infinity);
  const waitStates = Number(arg('--waits') ?? 0);
  const list = files().filter((f) => f.status === 'normal' && existsSync(join(SST_DIR, `${f.name}.json.gz`)) && (!only || only.includes(f.name)));
  const results = []; const sum = { total: 0, pass: 0, fail: 0, excluded: 0 };
  for (const f of list) {
    const r = biuFile(f, { limit, waitStates });
    results.push(r);
    for (const k of Object.keys(sum)) sum[k] += r[k];
    if (r.fail) console.log(`${f.name}: ${r.fail} fail of ${r.total}\n  ${r.failures.map((x) => `${x.bytes.map((b) => hex(b, 2)).join(' ')}: ${x.diffs.join('; ')}`).join('\n  ')}`);
  }
  console.log(`commit ${SST_COMMIT}; files ${list.length}; wait states ${waitStates}; tests ${sum.total}; pass ${sum.pass}; fail ${sum.fail}; excluded ${sum.excluded}`);
  const json = arg('--json');
  if (json) writeFileSync(json, JSON.stringify({ commit: SST_COMMIT, waitStates, ...sum, files: results }, null, 1));
  process.exit(sum.fail ? 1 : 0);
}
