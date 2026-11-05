// tools/i8086/lockstep.mjs -- the lock-step check of milestone 8086-B3 (docs/architecture/i8086-microops.md §6): the
// teaching model (src/arch/i8086/microops.js) against the instruction-level engine (src/arch/i8086/cpu.js) on the same
// state, and the order of its bus requests against the data bus cycles that SingleStepTests/8086 v1 recorded ([TEST];
// MIT; a CMOS P80C86A-2; read from outside the repository, never copied). Development tool.
//
//   node tools/i8086/lockstep.mjs [--limit N] [--only 00,8B,F6.7] [--json out.json]
//
// Checks per instruction: (1) registers, FLAGS under the undefined-flag mask, and memory equal; (2) reads, writes and
// port accesses equal in order, address, size and value; (3) the requests, byte by byte, in the order of the test's
// MEMR, MEMW, IOR and IOW cycles; (4) the form of the step list (ends with `end`, Q read once per instruction byte, no
// place written twice in a step, known step kinds).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, normFlags, CPU_REGS } from '../../src/arch/i8086/cpu.js';
import { runMicro, undefinedFlags, STEP_KINDS } from '../../src/arch/i8086/microops.js';
import { available, files, load, exclusion, SST_DIR, SST_COMMIT } from './sst.mjs';

const hex = (v, n = 4) => v.toString(16).toUpperCase().padStart(n, '0');

/** The test's data bus cycles as byte accesses, in order: 'R1234F' (MEMR), 'W…' (MEMW), 'I…' (IOR), 'O…' (IOW). */
export function testAccesses(t) {
  const out = [];
  for (const c of t.cycles) {
    if (!(c[0] & 1)) continue; // ALE: the address is valid on T1
    const k = { MEMR: 'R', MEMW: 'W', IOR: 'I', IOW: 'O', INTA: 'A' }[c[7]];
    if (!k) continue;
    const a = c[1] & 0xfffff;
    const io = k === 'I' || k === 'O';
    const at = (x) => `${k}${hex(io ? x & 0xffff : x, 5)}`;
    out.push(at(a));
    if (!(a & 1) && c[5] === 0) out.push(at(a + 1)); // BHE active at an even address: a word
  }
  return out;
}

/** The teaching model's requests as byte accesses, in the same form. */
export function requestAccesses(requests) {
  const out = [];
  for (const r of requests) {
    const k = { read: 'R', write: 'W', in: 'I', out: 'O' }[r.op];
    if (r.op === 'in' || r.op === 'out') {
      out.push(`${k}${hex(r.port, 5)}`);
      if (r.size === 16) out.push(`${k}${hex((r.port + 1) & 0xffff, 5)}`);
    } else {
      out.push(`${k}${hex(r.address, 5)}`);
      if (r.size === 16) out.push(`${k}${hex(r.address2, 5)}`);
    }
  }
  return out;
}

/** Form checks of a step list (design §6, check 4). Returns a list of problems. */
export function formProblems(micro) {
  const p = [];
  const s = micro.steps;
  if (!s.length || s[s.length - 1].kind !== 'end') p.push('the list does not end with end');
  if (s.some((x) => !STEP_KINDS.includes(x.kind))) p.push('unknown step kind');
  const q = s.filter((x) => x.transfers?.some((tr) => tr.from === 'Q')).length;
  if (q !== micro.length) p.push(`Q read ${q} times for ${micro.length} bytes`);
  for (const x of s) {
    const to = (x.transfers ?? []).map((tr) => `${tr.to}:${tr.part ?? ''}`);
    if (new Set(to).size !== to.length) p.push(`a place written twice in one step (${to.join(', ')})`);
  }
  return p;
}

/**
 * Run both models from one state: `memory` is a Map or a list of [address, byte]; bytes it does not hold read as
 * `fill(address)`. `mask` is the FLAGS mask (1 = compared; by default the instruction's undefined flags are left out);
 * `micro` replaces the teaching model (planted-fault tests). Returns {diffs, l1, micro, a, b, memA, memB}.
 */
export function compareOnce(regs, memory, { mask = null, emptyVector = false, fill = () => 0, micro: run = runMicro } = {}) {
  const memA = new Map(memory); const memB = new Map(memory);
  const busOf = (mem) => ({ read: (a) => (mem.has(a) ? mem.get(a) : fill(a)), write: (a, v) => mem.set(a, v), peek: (a) => (mem.has(a) ? mem.get(a) : fill(a)) });
  const a = { ...regs }; const b = { ...regs };
  const l1 = execute(a, busOf(memA), { emptyVector });
  const micro = run(b, busOf(memB), { emptyVector });
  const diffs = [];
  if (l1.error || micro.error) {
    if (l1.error !== micro.error) diffs.push(`stop: L1 ${l1.error ?? 'none'}, micro ${micro.error ?? 'none'}`);
    return { diffs, l1, micro, a, b, memA, memB };
  }
  const m = mask ?? (~undefinedFlags(micro.d) & 0xffff);
  for (const r of CPU_REGS) {
    const k = r === 'FLAGS' ? m : 0xffff;
    if (((a[r] ^ b[r]) & k) !== 0) diffs.push(`${r}: L1 ${hex(a[r])}, micro ${hex(b[r])}`);
  }
  const at = (mem, addr) => (mem.has(addr) ? mem.get(addr) : fill(addr));
  for (const addr of new Set([...memA.keys(), ...memB.keys()])) {
    if (at(memA, addr) !== at(memB, addr)) diffs.push(`[${hex(addr, 5)}]: L1 ${hex(at(memA, addr), 2)}, micro ${hex(at(memB, addr), 2)}`);
  }
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(l1.reads, micro.reads)) diffs.push(`reads: L1 ${JSON.stringify(l1.reads)}, micro ${JSON.stringify(micro.reads)}`);
  if (!same(l1.writes, micro.writes)) diffs.push(`writes: L1 ${JSON.stringify(l1.writes)}, micro ${JSON.stringify(micro.writes)}`);
  if (!same(l1.port ?? null, micro.port ?? null)) diffs.push('port read differs');
  if (!same(l1.out ?? null, micro.out ?? null)) diffs.push('port write differs');
  for (const k of ['call', 'halt', 'interrupt']) if ((l1[k] ?? null) !== (micro[k] ?? null)) diffs.push(`${k}: L1 ${l1[k]}, micro ${micro[k]}`);
  diffs.push(...formProblems(micro));
  return { diffs, l1, micro, a, b, memA, memB };
}

/** One [TEST] case: excluded, or {ok, diffs}. */
export function lockstepTest(t, file) {
  const why = exclusion(t, file);
  if (why) return { excluded: true, why };
  const regs = {};
  for (const r of CPU_REGS) regs[r] = t.initial.regs[r.toLowerCase()];
  regs.FLAGS = normFlags(regs.FLAGS);
  const r = compareOnce(regs, t.initial.ram, { mask: file.mask });
  const diffs = [...r.diffs];
  if (!r.micro.error) {
    const want = testAccesses(t).join(' '); const got = requestAccesses(r.micro.requests).join(' ');
    if (want !== got) diffs.push(`order: [TEST] ${want}; micro ${got}`);
  } else diffs.push(`stopped: ${r.micro.error}`);
  return { ok: diffs.length === 0, diffs };
}

/** Lock-step a file of tests (`tests` when already loaded): {name, total, pass, fail, excluded, failures}. */
export function lockstepFile(file, { limit = Infinity, keep = 5, tests = load(file.name) } = {}) {
  const out = { name: file.name, total: 0, pass: 0, fail: 0, excluded: 0, failures: [] };
  tests.slice(0, limit).forEach((t, i) => {
    out.total += 1;
    const r = lockstepTest(t, file);
    if (r.excluded) out.excluded += 1; else if (r.ok) out.pass += 1;
    else {
      out.fail += 1;
      if (out.failures.length < keep) out.failures.push({ idx: t.idx ?? i, name: t.name, bytes: t.bytes.map((b) => hex(b, 2)).join(' '), diffs: r.diffs.slice(0, 4) });
    }
  });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (!available()) { console.error(`SingleStepTests not found at ${SST_DIR}`); process.exit(2); }
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
  const only = arg('--only')?.split(',');
  const normal = files().filter((f) => f.status === 'normal' && existsSync(join(SST_DIR, `${f.name}.json.gz`)) && (!only || only.includes(f.name)));
  let pass = 0, fail = 0, excl = 0;
  const results = [];
  for (const f of normal) {
    const r = lockstepFile(f, { limit });
    results.push(r);
    pass += r.pass; fail += r.fail; excl += r.excluded;
    if (r.fail) console.log(`${f.name}: ${r.fail} of ${r.total} fail\n${r.failures.map((x) => `  #${x.idx} ${x.name} [${x.bytes}]: ${x.diffs.join('; ')}`).join('\n')}`);
  }
  console.log(`lock-step: files ${results.length}, tests ${pass + fail + excl}: pass ${pass}, fail ${fail}, excluded ${excl}`);
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ commit: SST_COMMIT, limit: Number.isFinite(limit) ? limit : null, pass, fail, excluded: excl, results: results.map(({ failures, ...x }) => x) }, null, 1));
  process.exit(fail ? 1 : 0);
}
