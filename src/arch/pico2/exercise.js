// pico2/exercise.js -- exercise files for the Pico 2 (contract v4 Descriptor.exercises, capability exercises; WS-F-148;
// P1-M9, design docs/architecture/pico2-p1m9-teaching-release.md §2.3, research D45 Q4-Q5): the shell's exercise format
// ("format": "risc-vista-exercise", version 1) with "arch": "pico2", run on the module's machine (engine.js) for a Pico Lite
// program in assembly or MAVILERA C. A test writes memory before the run (words, halves or bytes at a label of the program or
// an address), gives inputs at times of the machine's clock (a pin driven high, low or released; text typed into UART0), and
// checks what the program left when it stopped at its ebreak (the end of main in C): registers, the exit code (a0), memory, the
// UART0 text, pin levels, and the edges of a pin (how many, their period and high time, with a tolerance). The engine cannot set
// a register before a run (its first checkpoint would undo it), so "registers" as an input is refused with a reason; "entry",
// "abi" and "profile" are RISC-V exercise fields and refused too. Pure JavaScript, no DOM.
//
//   { "format": "risc-vista-exercise", "version": 1, "arch": "pico2", "title", "task", "lang": "asm" | "c", "starter",
//     "companion": {"name": "x.pio", "text": "…"} (a .pio file that comes with the starter), "options": {"parts": "kit"},
//     "tests": [{ "name", "memory": [{"at": "table", "words": [5]}],
//                 "inputs": [{"us": 1000, "pin": 15, "level": 0}, {"us": 5000, "uart": "hello\r"}],
//                 "expect": { "registers": {"a1": 3}, "exit": 0, "memory": [...], "output": "12\n", "pins": {"25": 1},
//                             "edges": [{"pin": 25, "count": 8, "periodUs": 500000, "highUs": 250000, "fromUs": 0, "tolerance": 0.01}],
//                             "maxCycles": 100000 },
//                 "limitMs": 2000 }] }
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { create } from './engine.js';
import { STOP } from '../contract.js';
import { PICO2_STRINGS as S } from './strings.js';

const ABI = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
/** Register number of `x7`, `a0`, `s0`/`fp`; null if none. */
function registerNumber(name) {
  const n = String(name).trim().toLowerCase();
  if (/^x([12]?\d|3[01])$/.test(n)) return Number(n.slice(1));
  if (n === 'fp') return 8;
  const i = ABI.indexOf(n);
  return i >= 0 ? i : null;
}

const X = S.exercise;
const FORMAT = 'risc-vista-exercise';
const SIZES = { words: 4, halves: 2, bytes: 1 };
const REFUSED = ['entry', 'profile'];

/** Check a Pico 2 exercise file; returns it normalised, or throws an Error naming the first problem. */
export function parseExercise(o) {
  const fail = (m) => { throw new Error(m); };
  if (!o || typeof o !== 'object' || o.format !== FORMAT) fail(`not an exercise file (no "format": "${FORMAT}")`);
  if (o.version !== 1) fail(`version ${o.version} of the exercise format is not known to this version of MAVILERA`);
  if (o.arch !== 'pico2') fail(X.notPico2);
  if (typeof o.title !== 'string' || !o.title.trim()) fail('the exercise has no title');
  const lang = o.lang ?? 'asm';
  if (lang !== 'asm' && lang !== 'c') fail(`unknown language "${o.lang}"`);
  for (const k of REFUSED) if (o[k] !== undefined) fail(X.notHere('the exercise', k));
  let companion = null;
  if (o.companion !== undefined) {
    if (typeof o.companion?.name !== 'string' || !/\.pio$/i.test(o.companion.name) || typeof o.companion.text !== 'string') fail(X.badCompanion);
    companion = { name: o.companion.name, text: o.companion.text };
  }
  const options = {};
  for (const [k, v] of Object.entries(o.options ?? {})) {
    if (!['parts', 'speaker', 'dac'].includes(k)) fail(X.badOption(k));
    options[k] = String(v);
  }
  if (!Array.isArray(o.tests) || !o.tests.length) fail('the exercise has no tests');
  const mem = (m, where) => {
    if (m === undefined) return [];
    if (!Array.isArray(m)) fail(`${where}: memory must be a list`);
    return m.map((b) => {
      const kinds = Object.keys(SIZES).filter((k) => Array.isArray(b?.[k]));
      if (b?.at === undefined || kinds.length !== 1) fail(X.oneSize(where));
      return { at: b.at, [kinds[0]]: b[kinds[0]].map(Number) };
    });
  };
  const tests = o.tests.map((t, i) => {
    const where = `test ${i + 1}${t?.name ? ` (${t.name})` : ''}`;
    if (!t || typeof t !== 'object') fail(`${where} is not an object`);
    if (t.registers !== undefined) fail(X.noRegisterInputs(where));
    for (const k of REFUSED) if (t[k] !== undefined) fail(X.notHere(where, k));
    const inputs = (t.inputs ?? []).map((x, j) => {
      const w = `${where}, input ${j + 1}`;
      if (!Number.isFinite(x?.us) || x.us < 0) fail(X.badInput(w));
      if (typeof x.uart === 'string') return { us: x.us, uart: x.uart };
      if (Number.isInteger(x.pin) && x.pin >= 0 && x.pin < 30 && [1, 0, -1].includes(x.level)) return { us: x.us, pin: x.pin, level: x.level };
      return fail(X.badInput(w));
    }).sort((a, b) => a.us - b.us);
    const e = t.expect ?? {};
    if (e.abi !== undefined) fail(X.notHere(`${where}, expect`, 'abi'));
    if (!Object.keys(e).length) fail(`${where} expects nothing`);
    const regs = {};
    for (const [k, v] of Object.entries(e.registers ?? {})) {
      if (registerNumber(k) === null) fail(X.notRegister(where, k));
      regs[k.trim().toLowerCase()] = Number(v);
    }
    const pins = {};
    for (const [k, v] of Object.entries(e.pins ?? {})) {
      const n = Number(k);
      if (!Number.isInteger(n) || n < 0 || n >= 30 || (v !== 0 && v !== 1)) fail(X.badPin(where, k));
      pins[n] = v;
    }
    const edges = (e.edges ?? []).map((g) => {
      if (!Number.isInteger(g?.pin) || g.pin < 0 || g.pin >= 30) fail(X.badPin(where, g?.pin));
      return { pin: g.pin, count: g.count ?? null, periodUs: g.periodUs ?? null, highUs: g.highUs ?? null, fromUs: Number(g.fromUs ?? 0),
        toUs: g.toUs ?? null, tolerance: Number(g.tolerance ?? 0.01) };
    });
    return { name: String(t.name ?? `Test ${i + 1}`), memory: mem(t.memory, where), inputs,
      expect: { registers: regs, memory: mem(e.memory, `${where}, expect`), pins, edges,
        ...(e.output !== undefined ? { output: String(e.output) } : {}), ...(e.exit !== undefined ? { exit: Number(e.exit) } : {}),
        ...(e.maxCycles !== undefined ? { maxCycles: Number(e.maxCycles) } : {}) },
      limitMs: Number(t.limitMs ?? 2000) };
  });
  return { title: o.title, task: String(o.task ?? ''), lang, starter: o.starter === undefined ? null : String(o.starter), entry: null,
    companion, options, tests };
}

const hex = (v, n = 8) => `0x${(v >>> 0).toString(16).padStart(n, '0')}`;
const show = (v, size) => `${size === 4 ? v | 0 : v} (${hex(v, 2 * size)})`;

/** An address: a number, a hex or decimal string, or a label of the program. */
function addressOf(at, program) {
  const s = String(at).trim();
  const n = typeof at === 'number' ? at : /^(0x[0-9a-f]+|\d+)$/i.test(s) ? Number(s) : program.symbols?.[s];
  if (n === undefined || n === null || !Number.isInteger(n)) throw new Error(X.noLabel(at));
  return n >>> 0;
}
const blockSize = (b) => (b.words ? 4 : b.halves ? 2 : 1);
const blockValues = (b) => b.words ?? b.halves ?? b.bytes;
/** The bytes of a memory block, little-endian. */
const blockBytes = (b) => { const n = blockSize(b); return blockValues(b).flatMap((v) => Array.from({ length: n }, (_, i) => (v >>> (8 * i)) & 0xff)); };

/** The program's segments with the test's memory written into them (a new segment where none covers it). */
export function withMemory(program, memory) {
  const segments = program.segments.map((s) => ({ ...s, bytes: Uint8Array.from(s.bytes) }));
  for (const b of memory) {
    const at = addressOf(b.at, program);
    blockBytes(b).forEach((v, i) => {
      const a = (at + i) >>> 0;
      let s = segments.find((x) => a >= x.address && a < x.address + x.bytes.length);
      if (!s) { s = { address: a, bytes: new Uint8Array(1) }; segments.push(s); }
      s.bytes[a - s.address] = v;
    });
  }
  return { ...program, segments };
}

/** Pin n's levels from the machine's pin log: [[time in µs, 0 | 1], …], a change per entry (the first entry is the first level). */
function pinLevels(m, n) {
  const l = m.pins.log, out = [];
  for (let i = 0; i < l.pins.length; i++) {
    if (l.pins[i] !== n || l.states[i] > 1) continue;
    if (out.length && out[out.length - 1][1] === l.states[i]) continue;
    out.push([m.nsAt(l.cycles[i]) / 1000, l.states[i]]);
  }
  return out;
}
const near = (got, want, tol) => Math.abs(got - want) <= Math.max(tol * want, 1);
const us = (v) => `${v.toFixed(v < 100 ? 2 : 0)} µs`;

/** The checks of one `edges` expectation. */
function edgeChecks(m, g) {
  const lv = pinLevels(m, g.pin);
  const ch = lv.slice(1).filter(([t]) => t >= g.fromUs && (g.toUs === null || t <= g.toUs));
  const checks = [];
  const what = (k) => X.edgeWhat(g.pin, k);
  if (g.count !== null) checks.push({ what: what('count'), expected: String(g.count), actual: String(ch.length), ok: ch.length === g.count });
  const rises = ch.filter(([, v]) => v === 1).map(([t]) => t);
  if (g.periodUs !== null) {
    const p = rises.slice(1).map((t, i) => t - rises[i]);
    const bad = p.find((x) => !near(x, g.periodUs, g.tolerance));
    checks.push({ what: what('period'), expected: `${us(g.periodUs)} ± ${g.tolerance * 100} %`,
      actual: p.length ? (bad === undefined ? `${us(p[0])}${p.length > 1 ? ` (${p.length} periods)` : ''}` : us(bad)) : X.noPeriod, ok: p.length > 0 && bad === undefined });
  }
  if (g.highUs !== null) {
    const h = [];
    for (let i = 0; i < ch.length - 1; i++) if (ch[i][1] === 1 && ch[i + 1][1] === 0) h.push(ch[i + 1][0] - ch[i][0]);
    const bad = h.find((x) => !near(x, g.highUs, g.tolerance));
    checks.push({ what: what('high'), expected: `${us(g.highUs)} ± ${g.tolerance * 100} %`,
      actual: h.length ? (bad === undefined ? us(h[0]) : us(bad)) : X.noPeriod, ok: h.length > 0 && bad === undefined });
  }
  return checks;
}

/**
 * Run every test of `ex` on an assembled program. Returns, per test, {name, pass, error, checks: [{what, expected, actual, ok}],
 * instructions}, as the shell's exercise dialog shows them. The run is at full speed in machine time; inputs are given when the
 * machine's clock reaches their time; the run ends at the program's ebreak, an error, or `limitMs` of machine time.
 */
export function runExercise(program, ex) {
  return ex.tests.map((t) => {
    const checks = [];
    let error = null, e = null;
    try {
      e = create(withMemory(program, t.memory), { historyWords: 1 << 12, runLimit: 200_000_000 });
      e.configure(ex.options ?? {});
      const pend = t.inputs.slice(), limitNs = t.limitMs * 1e6;
      for (;;) {
        const c = e.clock();
        while (pend.length && c.timeNs >= pend[0].us * 1000) {
          const x = pend.shift();
          e.input(x.uart !== undefined ? { kind: 'uart', uart: 0, bytes: [...new TextEncoder().encode(x.uart)] } : { kind: 'pin', pin: x.pin, level: x.level });
        }
        // slices of at most 50 µs while an input is due: the program may change clk_sys inside a slice (its start-up does), and a
        // slice counted in the old clock's cycles would then overshoot the input's time
        let k = 250_000;
        if (pend.length) k = Math.max(1, Math.min(k, Math.ceil(c.clkSys * 50e-6), Math.ceil(((pend[0].us * 1000 - c.timeNs) * c.clkSys) / 1e9)));
        const r = e.advance({ cycles: k });
        if (r.stop === STOP.HALT) break;
        if (r.stop === STOP.ERROR) { error = e.state().error; break; }
        if (r.stop === STOP.BUDGET) { error = X.noHalt(t.limitMs); break; }
        if (e.clock().timeNs > limitNs) { error = X.noHalt(t.limitMs); break; }
      }
    } catch (err) {
      error = err.message;
    }
    if (e) {
      const st = e.state();
      for (const [k, v] of Object.entries(t.expect.registers)) {
        const got = st.registers[`x${registerNumber(k)}`] >>> 0, want = v >>> 0;
        checks.push({ what: k, expected: show(want, 4), actual: show(got, 4), ok: got === want });
      }
      if (t.expect.exit !== undefined) {
        const got = st.registers.x10 | 0, want = t.expect.exit | 0;
        checks.push({ what: X.exit, expected: String(want), actual: String(got), ok: !error && got === want });
      }
      for (const b of t.expect.memory) {
        let at;
        try { at = addressOf(b.at, program); } catch (err) { error ??= err.message; continue; }
        const name = typeof b.at === 'string' && !/^(0x[0-9a-f]+|\d+)$/i.test(b.at.trim()) ? b.at.trim() : hex(at);
        const n = blockSize(b), vals = blockValues(b);
        vals.forEach((v, i) => {
          const m = e.peek((at + n * i) >>> 0, n);
          let got = 0; for (let j = n - 1; j >= 0; j--) got = (got * 256) + m[j];
          const want = n === 4 ? v >>> 0 : v & (n === 2 ? 0xffff : 0xff);
          checks.push({ what: vals.length > 1 ? `${name}[${i}]` : name, expected: show(want, n), actual: show(got >>> 0, n), ok: got >>> 0 === want });
        });
      }
      if (t.expect.output !== undefined) {
        const got = st.output ?? '';
        checks.push({ what: X.output, expected: JSON.stringify(t.expect.output), actual: JSON.stringify(got), ok: got === t.expect.output });
      }
      for (const [n, v] of Object.entries(t.expect.pins)) {
        const got = e.machine.pins.level[n];
        checks.push({ what: X.pinWhat(n), expected: String(v), actual: String(got), ok: got === v });
      }
      for (const g of t.expect.edges) checks.push(...edgeChecks(e.machine, g));
      if (t.expect.maxCycles !== undefined) {
        const got = e.clock().cycle;
        checks.push({ what: X.cycles, expected: `≤ ${t.expect.maxCycles}`, actual: String(got), ok: got <= t.expect.maxCycles });
      }
    }
    return { name: t.name, pass: !error && checks.every((c) => c.ok), error, checks, instructions: e?.state().retired ?? 0 };
  });
}
