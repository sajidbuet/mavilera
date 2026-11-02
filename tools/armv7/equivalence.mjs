// equivalence.mjs -- ARM-A5 differential runner (roadmap ARM-A5, §8 "Architectural equivalence across modes"): runs a
// program on every ARMv7 model that accepts it (the instruction-level engine; the single-cycle, multicycle and pipelined
// processors, base design and Extended datapath) and compares the architectural state at every retired instruction
// (the address, R0-R14, N Z C V, the stores it made) and at the end (how the run stopped, the memory written). Also a
// generator of random programs in the base set (tier H) and in the Extended set (tier E). Used by
// test/armv7-equivalence.test.mjs and, as a command, for the verification record:
//
//   node tools/armv7/equivalence.mjs [--n 10000] [--seed 1] [--json out.json]
//
// Every model compared here is this application's own; agreement among them is not evidence about any hardware or HDL
// (CLAUDE.md rule 7). Development tool only, never shipped.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { assemble, decode } from '../../src/arch/armv7/language.js';
import { create, passed } from '../../src/arch/armv7/engine.js';
import { ArmSingle } from '../../src/arch/armv7/uarch/single.js';
import { ArmSingleExt } from '../../src/arch/armv7/uarch/single-ext.js';
import { ArmMulti } from '../../src/arch/armv7/uarch/multi.js';
import { ArmMultiExt } from '../../src/arch/armv7/uarch/multi-ext.js';
import { ArmPipe } from '../../src/arch/armv7/uarch/pipe.js';
import { ArmPipeExt } from '../../src/arch/armv7/uarch/pipe-ext.js';

const flagBits = (r) => (r.N << 3) | (r.Z << 2) | (r.C << 1) | r.V;
const regs15 = (r) => Array.from({ length: 15 }, (_, i) => r[`r${i}`] >>> 0);

/**
 * The models. `tier` is the highest instruction tier a model runs (H base, E Extended, I instruction-level);
 * `profile`/`subset` are what the assembler is given for it.
 */
export const MODELS = Object.freeze([
  { id: 'iss', tier: 'I', profile: 'arm-iss', subset: null },
  { id: 'single', tier: 'H', profile: 'arm-single', subset: null, make: () => new ArmSingle() },
  { id: 'multi', tier: 'H', profile: 'arm-multi', subset: null, make: () => new ArmMulti() },
  { id: 'pipe', tier: 'H', profile: 'arm-pipe', subset: null, make: () => new ArmPipe({ hazard: 'full' }) },
  { id: 'single-ext', tier: 'E', profile: 'arm-single', subset: 'extended', make: () => new ArmSingleExt() },
  { id: 'multi-ext', tier: 'E', profile: 'arm-multi', subset: 'extended', make: () => new ArmMultiExt() },
  { id: 'pipe-ext', tier: 'E', profile: 'arm-pipe', subset: 'extended', make: () => new ArmPipeExt({ hazard: 'full' }) },
]);

/**
 * A run's trace: {model, outcome: 'halt'|'error'|'limit', error, haltPc, entries: [{pc, regs|null, flags|null, stores}],
 * memory: Map(address -> word) of every word stored, read at the end}. `regs` null: the instruction completed but the
 * model stopped before it could be observed (the pipeline's older instructions when Execute raises an error).
 */
function result(model, outcome, extra) { return { model, outcome, error: null, haltPc: null, entries: [], ...extra }; }

function finish(t, mem) {
  const memory = new Map();
  for (const e of t.entries) for (const [a] of e.stores) memory.set(a, mem.read(a, 4));
  t.memory = memory;
  return t;
}

function runIss(program, limit) {
  const iss = create(program, { historyLimit: 1 });
  const t = result('iss', 'limit');
  for (let n = 0; n < limit; n++) {
    const rec = iss.step();
    if (!rec) { t.outcome = 'error'; t.error = iss.state().error; return finish(t, { read: () => 0 }); }
    if (rec.halt) { t.outcome = 'halt'; t.haltPc = rec.pc; break; }
    const r = iss.state().registers;
    t.entries.push({ pc: rec.pc, regs: regs15(r), flags: flagBits(r), stores: rec.memory.map((x) => [x.address, x.value]) });
  }
  // the engine's memory is private: rebuild the final words from the stores in order
  const words = new Map();
  for (const e of t.entries) for (const [a, v] of e.stores) words.set(a, v);
  t.memory = words;
  return t;
}

function runSingle(spec, program, limit) {
  const m = spec.make();
  m.load(program);
  const t = result(spec.id, 'limit');
  for (let n = 0; n < limit; n++) {
    const pc = m.registers().r15;
    const r = m.step();
    if (r === 'error') { t.outcome = 'error'; t.error = m.error; break; }
    if (r === 'halt') { t.outcome = 'halt'; t.haltPc = pc; break; }
    const g = m.registers();
    const st = m.last.mem;
    t.entries.push({ pc, regs: regs15(g), flags: flagBits(g), stores: st ? [[st[0], m.dmem.read(st[0], 4)]] : [] });
  }
  return finish(t, m.dmem);
}

function runMulti(spec, program, limit) {
  const m = spec.make();
  m.load(program);
  const t = result(spec.id, 'limit');
  for (let n = 0; n < limit; n++) {
    const pc = m.pc;
    const c0 = m.cycle;
    const r = m.stepInstruction();
    if (r === 'error') { t.outcome = 'error'; t.error = m.error; break; }
    if (r === 'halt') { t.outcome = 'halt'; t.haltPc = pc; break; }
    const g = m.registers();
    const stores = m.history.slice(c0 - m.cycle).map((h) => h.mem).filter(Boolean).map(([a]) => [a, m.mem.read(a, 4)]);
    t.entries.push({ pc, regs: regs15(g), flags: flagBits(g), stores });
  }
  return finish(t, m.mem);
}

function runPipe(spec, program, limit) {
  const m = spec.make();
  m.load(program);
  const t = result(spec.id, 'limit');
  const pending = new Map(); // seq -> stores made in MEM, attached when the instruction leaves WB
  for (let k = 0; k < limit * 8; k++) {
    const { W, M } = m;
    const r = m.step();
    if (r === 'error') {
      t.outcome = 'error';
      t.error = m.error;
      // Execute stopped the run: the instructions in WB and MEM are older and complete architecturally
      if (m.errorStage === 'EX') for (const x of [W, M]) if (!x.bubble) t.entries.push({ pc: x.at, regs: null, flags: null, stores: [] });
      break;
    }
    if (r === 'halt') { t.outcome = 'halt'; t.haltPc = m.W.at; break; }
    const h = m.last;
    if (h.mem) pending.set(M.seq, [...(pending.get(M.seq) ?? []), [h.mem[0], m.dmem.read(h.mem[0], 4)]]);
    if (W.bubble) continue;
    t.entries.push({ pc: W.at, regs: Array.from(m.R, (v) => v >>> 0), flags: W.flags, stores: pending.get(W.seq) ?? [] });
    pending.delete(W.seq);
    if (t.entries.length >= limit) break;
  }
  return finish(t, m.dmem);
}

const RUNNERS = { iss: runIss, single: runSingle, 'single-ext': runSingle, multi: runMulti, 'multi-ext': runMulti, pipe: runPipe, 'pipe-ext': runPipe };

/** Run one model on an assembled program. */
export function runModel(spec, program, limit = 100_000) {
  return spec.id === 'iss' ? runIss(program, limit) : RUNNERS[spec.id](spec, program, limit);
}

const hex = (v) => `0x${(v >>> 0).toString(16)}`;

/** The first difference between two traces, as a sentence, or null. */
export function compare(a, b) {
  const n = Math.min(a.entries.length, b.entries.length);
  for (let i = 0; i < n; i++) {
    const x = a.entries[i];
    const y = b.entries[i];
    const at = `instruction ${i} at ${hex(x.pc)}`;
    if (x.pc !== y.pc) return `${at}: address ${hex(x.pc)} (${a.model}) vs ${hex(y.pc)} (${b.model})`;
    if (!x.regs || !y.regs) continue;
    for (let r = 0; r < 15; r++) if (x.regs[r] !== y.regs[r]) return `${at}: R${r} ${hex(x.regs[r])} (${a.model}) vs ${hex(y.regs[r])} (${b.model})`;
    if (x.flags !== y.flags) return `${at}: NZCV ${x.flags.toString(2).padStart(4, '0')} (${a.model}) vs ${y.flags.toString(2).padStart(4, '0')} (${b.model})`;
    if (JSON.stringify(x.stores) !== JSON.stringify(y.stores)) return `${at}: stores ${JSON.stringify(x.stores)} (${a.model}) vs ${JSON.stringify(y.stores)} (${b.model})`;
  }
  if (a.entries.length !== b.entries.length) return `retired ${a.entries.length} (${a.model}) vs ${b.entries.length} (${b.model})`;
  if (a.outcome !== b.outcome) return `stopped by ${a.outcome} (${a.model}${a.error ? `: ${a.error}` : ''}) vs ${b.outcome} (${b.model}${b.error ? `: ${b.error}` : ''})`;
  if (a.outcome === 'halt') {
    if (a.haltPc !== b.haltPc) return `halt at ${hex(a.haltPc)} (${a.model}) vs ${hex(b.haltPc)} (${b.model})`;
    for (const [addr, v] of a.memory) if (b.memory.get(addr) !== v) return `final memory at ${hex(addr)}: ${hex(v)} (${a.model}) vs ${hex(b.memory.get(addr) ?? 0)} (${b.model})`;
    if (a.memory.size !== b.memory.size) return `final memory: ${a.memory.size} words written (${a.model}) vs ${b.memory.size} (${b.model})`;
  }
  return null;
}

const TIER_RANK = { H: 0, E: 1, I: 2 };

/**
 * Assemble `text` for every model and run each that accepts it. The highest tier the program needs is that of the
 * least capable model that accepts it. Every accepting model must produce the same words as the engine's assembly.
 * Returns {tier, traces, refused: [model ids], divergences: [{a, b, what}]}; the engine's trace is the reference.
 */
export function differential(text, { limit = 100_000, models = MODELS } = {}) {
  const files = [{ name: 't.s', text }];
  const base = assemble(files, { profile: 'arm-iss' });
  if (!base.ok) throw new Error(`the instruction-level assembler refuses the program: ${JSON.stringify(base.diagnostics.slice(0, 3))}`);
  const image = JSON.stringify(base.segments.map((s) => [s.address, Array.from(s.bytes)]));
  const traces = [];
  const refused = [];
  const divergences = [];
  let tier = 'I';
  for (const spec of models) {
    const p = spec.id === 'iss' ? base : assemble(files, { profile: spec.profile, subset: spec.subset });
    if (!p.ok) { refused.push(spec.id); continue; }
    if (JSON.stringify(p.segments.map((s) => [s.address, Array.from(s.bytes)])) !== image) {
      divergences.push({ a: 'iss', b: spec.id, what: 'the assembled words differ from the instruction-level assembly' });
      continue;
    }
    if (TIER_RANK[spec.tier] < TIER_RANK[tier]) tier = spec.tier;
    traces.push(runModel(spec, p, limit));
  }
  const ref = traces[0];
  if (ref.outcome === 'limit') divergences.push({ a: 'iss', b: 'iss', what: `no halt within ${limit} instructions` });
  for (const t of traces.slice(1)) {
    const what = compare(ref, t);
    if (what) divergences.push({ a: ref.model, b: t.model, what });
  }
  return { tier, traces, refused, divergences };
}

// ---- random programs ----------------------------------------------------------------------------------------------

/** A seeded linear congruential generator (Numerical Recipes constants); rnd(n) in 0..n-1. */
function rng(seed) {
  let s = seed >>> 0;
  return (n) => { s = (s * 1664525 + 1013904223) >>> 0; return Math.floor((s / 2 ** 32) * n); };
}

/** The data table every generated program starts with (at 0x10000): the AddWithCarry corners, then two random words. */
const CORNERS = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff, 0x80000001, 0xfffffffe, 0x40000000, 0x3fffffff, 0xc0000000, 0x00ff00ff, 0x12345678];

const CONDS = ['', '', '', '', 'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL'];

/**
 * A random program in the base set (tier 'H': ADD, SUB, AND, ORR with and without S, conditions, LDR and STR with a
 * positive imm12, B) or the Extended set (tier 'E': adds MOV, the shifts and shifted operands, the tests, ADC, SBC, RSB,
 * EOR, BIC, LDRB, negative offsets, BL). Every register R0-R14 appears as destination and source except the reserved
 * ones: R11 the data base (0x10000, a table of corner values), R12 the loop counter. R15 is read as an operand, stored, and written by ADD and by LDR
 * (forward only). Branches go forward; counted loops go backward and always end, so every program halts.
 */
export function generate(seed, tier = 'H') {
  const rnd = rng(seed);
  const ext = tier === 'E';
  const pick = (a) => a[rnd(a.length)];
  const free = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14];
  const reg = () => `R${pick(free)}`;
  const src = () => (rnd(10) === 0 ? 'R15' : reg());
  const ops = ext ? ['AND', 'EOR', 'SUB', 'RSB', 'ADD', 'ADC', 'SBC', 'ORR', 'BIC'] : ['ADD', 'SUB', 'AND', 'ORR'];
  const shifts = ['LSL', 'LSR', 'ASR', 'ROR'];
  const amount = (s) => (s === 'LSL' || s === 'ROR' ? 1 + rnd(31) : 1 + rnd(32));
  const op2 = () => {
    const k = rnd(ext ? 4 : 2);
    if (k === 0) return `#${rnd(256)}`;
    if (k === 1) return src();
    const s = pick(shifts);
    return `${reg()}, ${s} #${amount(s)}`;
  };
  const offset = (word) => {
    const neg = ext && rnd(3) === 0;
    const v = word ? 4 * (rnd(2) ? rnd(CORNERS.length) : rnd(256)) : rnd(1024);
    return neg ? `#-${v}` : `#${v}`;
  };
  const lines = [];
  // set-up in the base set: R11 = 0x10000, the data segment (by doubling; far above the code, so no store reaches an
  // instruction); R0-R5 random small values; R6-R9 corner values loaded from the table at R11 (carry and overflow)
  lines.push('AND R11, R11, #0', 'ADD R11, R11, #128');
  for (let i = 0; i < 9; i++) lines.push('ADD R11, R11, R11');
  for (const r of [0, 1, 2, 3, 4, 5]) lines.push(`ADD R${r}, R${r}, #${rnd(256)}`);
  for (const r of [6, 7, 8, 9]) lines.push(`LDR R${r}, [R11, #${4 * rnd(CORNERS.length)}]`);
  const words = [...CORNERS, rnd(2 ** 31) * 2 + rnd(2), rnd(2 ** 31) * 2 + rnd(2)];
  let label = 0;
  const L = () => `L${label++}`;

  /** One straight-line instruction (no write to R15, R11 or R12). */
  const plain = () => {
    const k = rnd(ext ? 16 : 10);
    const c = pick(CONDS);
    const s = rnd(3) === 0 ? 'S' : '';
    if (k < 5) return `${pick(ops)}${c}${s} ${reg()}, ${src()}, ${op2()}`;
    if (k < 7) return `LDR${c} ${reg()}, [R11, ${offset(true)}]`;
    if (k < 9) return `STR${c} ${rnd(8) === 0 ? 'R15' : reg()}, [R11, ${offset(true)}]`;
    // arithmetic with flags on the corner values in R6-R9 (carry and overflow both ways); R6-R9 are kept
    if (k < 10) {
      const op = pick(['ADD', 'SUB', ...(ext ? ['ADC', 'SBC', 'RSB', 'CMP', 'CMN'] : [])]);
      const ab = `R${6 + rnd(4)}, R${6 + rnd(4)}`;
      return op.startsWith('CM') ? `${op}${c} ${ab}` : `${op}${c}S R${pick([0, 1, 2, 3, 4, 5, 10, 13, 14])}, ${ab}`;
    }
    if (k < 11) return `${pick(['TST', 'TEQ', 'CMP', 'CMN'])}${c} ${src()}, ${op2()}`;
    if (k < 12) return `MOV${c}${s} ${reg()}, ${op2()}`;
    if (k < 13) { const sh = pick(shifts); return `${sh}${c}${s} ${reg()}, ${reg()}, #${amount(sh)}`; }
    if (k < 14) return `LDRB${c} ${reg()}, [R11, ${offset(false)}]`;
    if (k < 15) { const r = reg(); return `LDR${rnd(2) ? 'B' : ''} ${r}, [R11, #${4 * rnd(64)}]\n${pick(ops)} ${reg()}, ${r}, ${op2()}`; }
    return `${pick(ops)}${c}S ${reg()}, ${src()}, ${op2()}`;
  };

  const n = 6 + rnd(30);
  for (let i = 0; i < n; i++) {
    const k = rnd(20);
    const c = pick(CONDS);
    if (k < 10) lines.push(plain());
    else if (k < 12) { const t = L(); lines.push(`B${c} ${t}`, plain(), `${t}:`); }
    else if (k < 13) {
      // ADD R15, R15, #4m at a goes to a + 8 + 4m: over 1 + m single instructions, to the label
      const t = L();
      const m = rnd(2);
      lines.push(`ADD${c} R15, R15, #${4 * m}`);
      for (let j = 0; j <= m; j++) lines.push(plain().split('\n')[0]);
      lines.push(`${t}:`);
    }
    else if (k < 14) {
      // LDR R15 (W-D32 rows "write via LDR"): ADD at a gives a + 8 + 4 + 4*skip, the first or second filler after the
      // LDR at a + 8; stored, then loaded into the PC
      const r = pick([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const off = 4 * rnd(64);
      lines.push(`ADD R${r}, R15, #${4 + 4 * rnd(2)}`, `STR R${r}, [R11, #${off}]`, `LDR${c} R15, [R11, #${off}]`);
      lines.push(plain().split('\n')[0], plain().split('\n')[0]);
    } else if (k < 17) {
      // a counted loop, backward: R12 from 1 to 4 down to 0; the body neither branches nor writes R12, R11, R15
      const top = L();
      lines.push('AND R12, R12, #0', `ADD R12, R12, #${1 + rnd(4)}`, `${top}:`);
      for (let j = 1 + rnd(4); j > 0; j--) lines.push(plain());
      lines.push('SUBS R12, R12, #1', `BNE ${top}`);
    } else if (ext && k < 19) lines.push(`BL${c} SUBR`);
    else lines.push(plain());
  }
  lines.push('B END', 'B END', 'END: B END');
  if (ext) lines.push('SUBR: ADD R10, R10, #1', 'MOV PC, LR');
  lines.push('.data', `CORNERS: .word ${words.map((w) => `0x${(w >>> 0).toString(16)}`).join(', ')}`);
  return lines.join('\n');
}

/**
 * What the engine's trace executed, counted into `cov`: per mnemonic (with S), executed and skipped; per condition
 * code, passed and failed; R0-R15 as Rd, Rn, Rm; writes to R15 by data processing and by LDR; STR of R15; branches
 * taken forward and backward and not taken.
 */
export function cover(cov, text, trace) {
  const p = assemble([{ name: 't.s', text }], { profile: 'arm-iss' });
  const code = new Map();
  for (const s of p.segments) for (let i = 0; i + 3 < s.bytes.length; i += 4) code.set(s.address + i, s.bytes[i] | (s.bytes[i + 1] << 8) | (s.bytes[i + 2] << 16) | (s.bytes[i + 3] << 24));
  const inc = (k) => { cov[k] = (cov[k] ?? 0) + 1; };
  let flags = 0;
  for (const e of trace.entries) {
    const d = decode(code.get(e.pc));
    const F = { N: (flags >> 3) & 1, Z: (flags >> 2) & 1, C: (flags >> 1) & 1, V: flags & 1 };
    const ok = passed(d.cond, F);
    inc(`cond ${CONDS_ALL[d.cond]} ${ok ? 'pass' : 'fail'}`);
    inc(`op ${d.name}${d.S ? 'S' : ''}${d.cls === 'mem' && !d.U ? ' -imm' : ''} ${ok ? 'run' : 'skip'}`);
    if (ok) {
      if (d.Rd !== undefined && d.cls !== 'branch' && !(d.cls === 'dp' && d.cmd >= 8 && d.cmd <= 11)) inc(`Rd R${d.Rd}`);
      if (d.Rn !== undefined && !(d.cls === 'dp' && d.cmd === 13)) inc(`Rn R${d.Rn}`);
      if (d.Rm !== undefined) inc(`Rm R${d.Rm}`);
      if (d.cls === 'dp' && d.Rd === 15 && !(d.cmd >= 8 && d.cmd <= 11)) inc('R15 written by data processing');
      if (d.cls === 'mem' && d.L && d.Rd === 15) inc('R15 written by LDR');
      if (d.cls === 'mem' && !d.L && d.Rd === 15) inc('R15 stored by STR');
      if (d.cls === 'branch') inc(`branch ${d.L ? 'BL' : 'B'} ${d.offset + 8 < 0 ? 'backward' : 'forward'}`);
    } else if (d.cls === 'branch') inc('branch not taken');
    if (e.flags !== null) flags = e.flags;
  }
}

const CONDS_ALL = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC', 'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL'];

/**
 * Run `n` generated programs from `seed` (half base, half Extended). Returns the counts, the coverage of the engine's
 * traces, and the divergences (at most `keep`, each with its program).
 */
export function campaign({ n = 1000, seed = 1, keep = 5, limit = 100_000 } = {}) {
  const stats = { programs: 0, base: 0, extended: 0, instructions: 0, comparisons: 0, models: {}, halted: 0, coverage: {} };
  const failures = [];
  for (let k = 0; k < n; k++) {
    const tier = k % 2 ? 'E' : 'H';
    const s = (seed * 1_000_003 + k * 7919) >>> 0;
    const text = generate(s, tier);
    let r;
    try { r = differential(text, { limit }); } catch (e) { failures.push({ k, seed: s, tier, what: e.message, text }); if (failures.length >= keep) break; continue; }
    stats.programs += 1;
    stats[tier === 'H' ? 'base' : 'extended'] += 1;
    const want = tier === 'H' ? 7 : 4;
    if (r.traces.length !== want) r.divergences.push({ a: 'iss', b: '-', what: `${r.traces.length} models accepted a tier-${tier} program (refused: ${r.refused.join(', ')})` });
    if (r.traces[0].outcome === 'halt') stats.halted += 1;
    stats.instructions += r.traces[0].entries.length;
    cover(stats.coverage, text, r.traces[0]);
    stats.comparisons += r.traces.length - 1;
    for (const t of r.traces) stats.models[t.model] = (stats.models[t.model] ?? 0) + 1;
    if (r.divergences.length) {
      failures.push({ k, seed: s, tier, what: r.divergences.map((d) => `${d.a}/${d.b}: ${d.what}`).join('; '), text });
      if (failures.length >= keep) break;
    }
  }
  return { stats, failures };
}

// ---- command line --------------------------------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
  const n = Number(arg('--n', 10_000));
  const seed = Number(arg('--seed', 1));
  const out = arg('--json', null);
  const t0 = Date.now();
  const { stats, failures } = campaign({ n, seed, keep: 10 });
  const ms = Date.now() - t0;
  const report = { _copyright: 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code (a generated record).', tool: 'tools/armv7/equivalence.mjs', date: new Date().toISOString(), node: process.version, n, seed, ms, pass: failures.length === 0 && stats.programs === n, stats, failures };
  console.log(JSON.stringify({ ...report, failures: failures.map(({ text, ...f }) => f) }, null, 2));
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.pass ? 0 : 1;
}
