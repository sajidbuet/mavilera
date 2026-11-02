// armv7/exercise.js -- exercise files for ARMv7 (contract v4 Descriptor.exercises, capability exercises; WS-F-148;
// roadmap ARM-A6): the shell's exercise format ("format": "risc-vista-exercise", version 1) with "arch": "armv7", run on
// the instruction-level engine (engine.js). The engine cannot set a register before a run, so a test sets memory before
// it (words or bytes, at a label of the program or an address) and checks what the program left: registers R0-R15 (SP,
// LR and PC too) and the flags N, Z, C, V, and memory words or bytes. A run ends at B . (a branch to itself, W-D34);
// an error, or no end within the limit, fails the test. Fields of the RISC-V tests (registers set before a run, entry,
// halves, output text, exit, abi) are refused with a reason. Pure JavaScript, no DOM.
//
//   { "format": "risc-vista-exercise", "version": 1, "arch": "armv7", "title", "task", "lang": "asm", "starter",
//     "tests": [{ "name", "memory": [{"at": "list" | 2048, "words": [5]} | {"at": .., "bytes": [7]}],
//                 "expect": { "registers": {"R0": 15, "SP": 1048576, "Z": 1}, "memory": [...] }, "limit": 100000 }] }
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { create } from './engine.js';
import { ARMV7_STRINGS as S } from './strings.js';

const X = S.exercise;
const FORMAT = 'risc-vista-exercise';
const ALIASES = { SP: 13, LR: 14, PC: 15 };
const FLAGS = ['N', 'Z', 'C', 'V'];
const RISCV_ONLY = ['entry', 'registers'];
const RISCV_EXPECT = ['output', 'exit', 'abi'];

/** The engine's id of a register name (R0-R15, SP, LR, PC, N, Z, C, V), or null. */
function registerId(k) {
  const u = String(k).trim().toUpperCase();
  if (FLAGS.includes(u)) return u;
  if (u in ALIASES) return `r${ALIASES[u]}`;
  const m = /^R(\d{1,2})$/.exec(u);
  return m && Number(m[1]) <= 15 ? `r${Number(m[1])}` : null;
}

/** Check an ARMv7 exercise file; returns it normalised, or throws an Error naming the first problem. */
export function parseExercise(o) {
  const fail = (m) => { throw new Error(m); };
  if (!o || typeof o !== 'object' || o.format !== FORMAT) fail(`not an exercise file (no "format": "${FORMAT}")`);
  if (o.version !== 1) fail(`version ${o.version} of the exercise format is not known to this version of MAVILERA`);
  if (o.arch !== 'armv7') fail(X.notArmv7);
  if (typeof o.title !== 'string' || !o.title.trim()) fail('the exercise has no title');
  if ((o.lang ?? 'asm') !== 'asm') fail(`unknown language "${o.lang}"`);
  if (o.entry !== undefined) fail(X.notHere('the exercise', 'entry'));
  if (!Array.isArray(o.tests) || !o.tests.length) fail('the exercise has no tests');
  const mem = (m, where) => {
    if (m === undefined) return [];
    if (!Array.isArray(m)) fail(`${where}: memory must be a list`);
    return m.map((b) => {
      const words = Array.isArray(b?.words);
      const bytes = Array.isArray(b?.bytes);
      if (b?.at === undefined || words === bytes || b.halves) fail(X.wordsOrBytes(where));
      return words ? { at: b.at, words: b.words.map(Number) } : { at: b.at, bytes: b.bytes.map(Number) };
    });
  };
  const tests = o.tests.map((t, i) => {
    const where = `test ${i + 1}${t?.name ? ` (${t.name})` : ''}`;
    if (!t || typeof t !== 'object') fail(`${where} is not an object`);
    for (const k of RISCV_ONLY) if (t[k] !== undefined) fail(k === 'registers' ? X.noRegisterInputs(where) : X.notHere(where, k));
    const e = t.expect ?? {};
    for (const k of RISCV_EXPECT) if (e[k] !== undefined) fail(X.notHere(`${where}, expect`, k));
    if (!Object.keys(e).length) fail(`${where} expects nothing`);
    const regs = {};
    for (const [k, v] of Object.entries(e.registers ?? {})) {
      if (!registerId(k)) fail(X.notRegister(where, k));
      regs[k.trim().toUpperCase()] = Number(v);
    }
    return { name: String(t.name ?? `Test ${i + 1}`), memory: mem(t.memory, where), expect: { registers: regs, memory: mem(e.memory, `${where}, expect`) },
      limit: Number(t.limit ?? 100_000) };
  });
  return { title: o.title, task: String(o.task ?? ''), lang: 'asm', starter: o.starter === undefined ? null : String(o.starter), entry: null, tests };
}

const hex = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const showWord = (v) => `${(v | 0)} (${hex(v)})`;
const showByte = (v) => `${v} (0x${v.toString(16).toUpperCase().padStart(2, '0')})`;

/** An address: a number or a label of the program. */
function addressOf(at, program) {
  const n = typeof at === 'number' ? at : /^(0x[0-9a-f]+|\d+)$/i.test(String(at).trim()) ? Number(String(at).trim()) : program.symbols?.[String(at).trim()];
  if (n === undefined || n === null || !Number.isInteger(n)) throw new Error(X.noLabel(at));
  if (n < 0 || n > 0xffffffff) throw new Error(X.outside(n));
  return n >>> 0;
}

/** The bytes of a memory block, little-endian words. */
const blockBytes = (b) => (b.words ? b.words.flatMap((w) => [w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff]) : b.bytes.map((v) => v & 0xff));

/** The program's segments with the test's memory written into them (a new data segment where none covers it). */
export function withMemory(program, memory) {
  const segments = program.segments.map((s) => ({ ...s, bytes: Uint8Array.from(s.bytes) }));
  for (const b of memory) {
    const at = addressOf(b.at, program);
    const bytes = blockBytes(b);
    bytes.forEach((v, i) => {
      const a = (at + i) >>> 0;
      let s = segments.find((x) => a >= x.address && a < x.address + x.bytes.length);
      if (!s) {
        s = segments.find((x) => !x.executable && x.address + x.bytes.length === a);
        if (s) { const grown = new Uint8Array(s.bytes.length + 1); grown.set(s.bytes); s.bytes = grown; } else { s = { address: a, bytes: new Uint8Array(1), executable: false }; segments.push(s); }
      }
      if (s.executable) throw new Error(X.inCode(hex(a)));
      s.bytes[a - s.address] = v;
    });
  }
  return { ...program, segments };
}

/**
 * Run every test of `ex` on an assembled program. Returns, per test, {name, pass, error, checks: [{what, expected,
 * actual, ok}], instructions}, as the shell's exercise dialog shows them.
 */
export function runExercise(program, ex) {
  return ex.tests.map((t) => {
    const checks = [];
    let error = null;
    let e = null;
    try {
      e = create(withMemory(program, t.memory), { historyLimit: 1 });
      for (let n = 0; n < t.limit; n++) {
        const r = e.step();
        if (!r || r.halt) break;
      }
      const s = e.state();
      if (s.error) error = s.error;
      else if (!s.halted) error = X.noHalt(t.limit);
    } catch (err) {
      error = err.message;
    }
    if (e) {
      const regs = e.state().registers;
      for (const [k, v] of Object.entries(t.expect.registers)) {
        const id = registerId(k);
        const flag = FLAGS.includes(id);
        const want = flag ? v & 1 : v >>> 0;
        const got = flag ? regs[id] : regs[id] >>> 0;
        checks.push({ what: k, expected: flag ? String(want) : showWord(want), actual: flag ? String(got) : showWord(got), ok: got === want });
      }
      for (const b of t.expect.memory) {
        let at;
        try { at = addressOf(b.at, program); } catch (err) { error ??= err.message; continue; }
        const name = typeof b.at === 'string' && !/^(0x[0-9a-f]+|\d+)$/i.test(b.at.trim()) ? b.at.trim() : hex(at);
        if (b.words) {
          b.words.forEach((v, i) => {
            const got = e.peek((at + 4 * i) >>> 0, 4).reduce((w, x, k) => (w | (x << (8 * k))) >>> 0, 0);
            const want = v >>> 0;
            checks.push({ what: b.words.length > 1 ? `${name}[${i}]` : name, expected: showWord(want), actual: showWord(got), ok: got === want });
          });
        } else {
          const got = e.peek(at, b.bytes.length);
          b.bytes.forEach((v, i) => {
            const want = v & 0xff;
            checks.push({ what: `${name} + ${i}`, expected: showByte(want), actual: showByte(got[i]), ok: got[i] === want });
          });
        }
      }
    }
    return { name: t.name, pass: !error && checks.every((c) => c.ok), error, checks, instructions: e?.state().retired ?? 0 };
  });
}
