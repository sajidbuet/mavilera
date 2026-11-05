// tools/i8086/sst.mjs -- replays SingleStepTests/8086 v1 ([TEST]; MIT licence; a CMOS P80C86A-2) on the 8086 model
// (src/arch/i8086/cpu.js) under the oracle policy of docs/references/INTEL-8086-SOURCE-INDEX.md §8 (roadmap 8086-B0
// and B2). Development tool: the suite stays outside the repository (default ../reference-pips/...; or I8086_SST) and
// is read, never executed. Nothing of it is copied into the repository.
//
//   node tools/i8086/sst.mjs [--limit N] [--only 00,8B,F6.7] [--json out.json]
//
// Per test: the initial registers and RAM are loaded; one instruction (with its prefixes) runs; every final register
// (unchanged ones from `initial`) and every final RAM byte must match, FLAGS under the metadata's flags-mask; a write to
// an address the test does not list is a failure. A divide error pushes FLAGS, whose undefined bits are masked there too.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, normFlags, CPU_REGS } from '../../src/arch/i8086/cpu.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SST_DIR = process.env.I8086_SST
  ?? resolve(ROOT, '..', 'reference-pips', 'processor-architectures', 'Intel-8086', '07-timing-tests', 'singlesteptests-8086', 'v1');
export const SST_COMMIT = 'e71c68d215a6bb8c356bd4cb3842de3bef345ca9';
export const available = () => existsSync(join(SST_DIR, 'metadata.json'));
export const metadata = () => JSON.parse(readFileSync(join(SST_DIR, 'metadata.json'), 'utf8'));

/** Every test file of the metadata: {name ('8B', 'F6.7'), op, reg, status, mask}; unsplit files are named by op only. */
export function files(meta = metadata()) {
  const out = [];
  for (const [op, e] of Object.entries(meta.opcodes)) {
    const split = e.reg && existsSync(join(SST_DIR, `${op}.0.json.gz`));
    if (e.reg && split) for (const [r, x] of Object.entries(e.reg)) out.push({ name: `${op}.${r}`, op: parseInt(op, 16), reg: Number(r), status: x.status, mask: x['flags-mask'] ?? 0xffff });
    else {
      // an unsplit file of a group (8F, C6, C7): replayed if one reg form is normal; the others are excluded per test
      const status = e.status ?? (Object.values(e.reg ?? {}).some((x) => x.status === 'normal') ? 'normal' : 'undefined');
      out.push({ name: op, op: parseInt(op, 16), reg: null, status, mask: e['flags-mask'] ?? 0xffff, regs: e.reg ?? null });
    }
  }
  return out;
}
export const load = (name) => JSON.parse(gunzipSync(readFileSync(join(SST_DIR, `${name}.json.gz`))).toString('utf8'));

const PREFIX = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf1, 0xf2, 0xf3]);
const hex = (v, n = 4) => v.toString(16).toUpperCase().padStart(n, '0');

/**
 * Why a test is excluded by the oracle policy, or null: a REP or REPNE prefix before IMUL or IDIV (an undocumented
 * sign inversion), and in an unsplit file a ModR/M reg field the metadata calls other than normal.
 */
export function exclusion(t, file) {
  const bytes = t.bytes;
  let k = 0;
  while (PREFIX.has(bytes[k])) k += 1;
  const op = bytes[k];
  const reg = (bytes[k + 1] >> 3) & 7;
  if (file.regs && file.regs[String(reg)] && file.regs[String(reg)].status !== 'normal') return `reg ${reg}: ${file.regs[String(reg)].status}`;
  if ((op === 0xf6 || op === 0xf7) && (reg === 5 || reg === 7) && bytes.slice(0, k).some((b) => b === 0xf2 || b === 0xf3)) return 'REP before IMUL or IDIV';
  return null;
}

/** Replay one test. Returns {ok, excluded?, why?, diffs?}. `file` is an entry of files(). */
export function replay(t, file) {
  const why = exclusion(t, file);
  if (why) return { ok: false, excluded: true, why };
  const mem = new Map(t.initial.ram);
  const listed = new Set(t.final.ram.map(([a]) => a));
  for (const [a] of t.initial.ram) listed.add(a);
  const diffs = [];
  const bus = {
    read: (a) => { if (!mem.has(a)) diffs.push(`read of unlisted ${hex(a, 5)}`); return mem.get(a) ?? 0; },
    write: (a, v) => { if (!listed.has(a)) diffs.push(`write to unlisted ${hex(a, 5)}`); mem.set(a, v); },
    peek: (a) => mem.get(a) ?? 0,
  };
  const cpu = {};
  for (const r of CPU_REGS) cpu[r] = t.initial.regs[r.toLowerCase()];
  cpu.FLAGS = normFlags(cpu.FLAGS);
  const r = execute(cpu, bus);
  if (r.error) return { ok: false, diffs: [`stopped: ${r.error}`] };
  const want = { ...t.initial.regs, ...t.final.regs };
  for (const name of CPU_REGS) {
    const w = want[name.toLowerCase()];
    const got = cpu[name];
    const mask = name === 'FLAGS' ? file.mask : 0xffff;
    if (((got ^ w) & mask) !== 0) diffs.push(`${name} ${hex(got)} want ${hex(w)}${name === 'FLAGS' ? ` (mask ${hex(mask)})` : ''}`);
  }
  // FLAGS pushed by a divide error: undefined bits masked
  const pushed = new Set();
  if (r.interrupt === 0) { const sp = want.sp; const ss = want.ss; pushed.add(((ss << 4) + ((sp + 4) & 0xffff)) & 0xfffff); pushed.add(((ss << 4) + ((sp + 5) & 0xffff)) & 0xfffff); }
  for (const [a, v] of t.final.ram) {
    const got = mem.get(a);
    if (pushed.has(a)) {
      const lowByte = a === [...pushed][0];
      const m = lowByte ? file.mask & 0xff : file.mask >> 8;
      if (((got ^ v) & m) !== 0) diffs.push(`[${hex(a, 5)}] ${hex(got, 2)} want ${hex(v, 2)} (pushed FLAGS, masked)`);
    } else if (got !== v) diffs.push(`[${hex(a, 5)}] ${hex(got ?? 0, 2)} want ${hex(v, 2)}`);
  }
  return { ok: diffs.length === 0, diffs };
}

/** Replay a file: {name, status, total, pass, fail, excluded, failures (the first few)}. */
export function replayFile(file, { limit = Infinity, keep = 5 } = {}) {
  const tests = load(file.name);
  const out = { name: file.name, status: file.status, total: 0, pass: 0, fail: 0, excluded: 0, failures: [], exclusions: {} };
  tests.slice(0, limit).forEach((t, i) => {
    out.total += 1;
    const r = replay(t, file);
    if (r.excluded) { out.excluded += 1; out.exclusions[r.why] = (out.exclusions[r.why] ?? 0) + 1; } else if (r.ok) out.pass += 1;
    else {
      out.fail += 1;
      if (out.failures.length < keep) out.failures.push({ idx: t.idx ?? i, name: t.name, bytes: t.bytes.map((b) => hex(b, 2)).join(' '), diffs: r.diffs.slice(0, 6) });
    }
  });
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  if (!available()) { console.error(`SingleStepTests not found at ${SST_DIR}`); process.exit(2); }
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
  const only = arg('--only')?.split(',');
  const all = files().filter((f) => existsSync(join(SST_DIR, `${f.name}.json.gz`)));
  const normal = all.filter((f) => f.status === 'normal' && (!only || only.includes(f.name)));
  const results = [];
  let pass = 0, fail = 0, excl = 0;
  for (const f of normal) {
    const r = replayFile(f, { limit });
    results.push(r);
    pass += r.pass; fail += r.fail; excl += r.excluded;
    if (r.fail) console.log(`${f.name}: ${r.fail} of ${r.total} fail\n${r.failures.map((x) => `  #${x.idx} ${x.name} [${x.bytes}]: ${x.diffs.join('; ')}`).join('\n')}`);
  }
  const skippedFiles = all.filter((f) => f.status !== 'normal').map((f) => `${f.name} (${f.status})`);
  console.log(`files replayed ${results.length}, tests ${pass + fail + excl}: pass ${pass}, fail ${fail}, excluded ${excl}; files not replayed (status): ${skippedFiles.length}`);
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ commit: SST_COMMIT, limit: Number.isFinite(limit) ? limit : null, pass, fail, excluded: excl, results, skippedFiles }, null, 1));
  process.exit(fail ? 1 : 0);
}
