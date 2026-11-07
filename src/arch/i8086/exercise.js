// i8086/exercise.js -- exercise files for the 8086 (contract v4 Descriptor.exercises, capability exercises; WS-F-148;
// 8086-B8, B8-Q9): the shell's exercise format ("format": "risc-vista-exercise", version 1) with "arch": "i8086", run on
// the instruction-level engine (engine.js), one segment (the flat profile). The engine cannot set a register before a
// run, so a test sets memory before it (words of 16 bits or bytes, at a label of the program or a physical address)
// and checks what the program left: the registers AX to DI, the segment registers, IP and the flags (CF, PF, AF, ZF, SF,
// TF, IF, DF, OF), memory words or bytes, and the console text (OUT 0E9H). A run ends at HLT; an error, or no HLT within
// the limit, fails the test. The RISC-V fields "entry", "registers", "exit" and "abi" are refused with a reason. Pure
// JavaScript, no DOM.
//
//   { "format": "risc-vista-exercise", "version": 1, "arch": "i8086", "title", "task", "lang": "asm", "starter",
//     "tests": [{ "name", "memory": [{"at": "table", "words": [5]} | {"at": 66048, "bytes": [7]}],
//                 "expect": { "registers": {"AX": 15, "ZF": 1}, "memory": [...], "output": "12" }, "limit": 100000 }] }
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { create } from './engine.js';
import { CPU_REGS, FLAG } from './cpu.js';
import { I8086_STRINGS as S } from './strings.js';

const X = S.exercise;
const FORMAT = 'risc-vista-exercise';
const FLAGS = Object.keys(FLAG);
const RISCV_ONLY = ['entry', 'registers'];
const RISCV_EXPECT = ['exit', 'abi'];

/** The engine's id of a register or flag name, or null. */
function registerId(k) {
  const u = String(k).trim().toUpperCase();
  return FLAGS.includes(u) || CPU_REGS.includes(u) ? u : null;
}

/** Check an 8086 exercise file; returns it normalised, or throws an Error naming the first problem. */
export function parseExercise(o) {
  const fail = (m) => { throw new Error(m); };
  if (!o || typeof o !== 'object' || o.format !== FORMAT) fail(`not an exercise file (no "format": "${FORMAT}")`);
  if (o.version !== 1) fail(`version ${o.version} of the exercise format is not known to this version of MAVILERA`);
  if (o.arch !== 'i8086') fail(X.notI8086);
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
    return { name: String(t.name ?? `Test ${i + 1}`), memory: mem(t.memory, where),
      expect: { registers: regs, memory: mem(e.memory, `${where}, expect`), ...(e.output !== undefined ? { output: String(e.output) } : {}) },
      limit: Number(t.limit ?? 100_000) };
  });
  return { title: o.title, task: String(o.task ?? ''), lang: 'asm', starter: o.starter === undefined ? null : String(o.starter), entry: null, tests };
}

const hex = (v, n) => `${v.toString(16).toUpperCase().padStart(n, '0')}H`;
const showWord = (v) => `${v} (${hex(v, 4)})`;
const showByte = (v) => `${v} (${hex(v, 2)})`;

/** A physical address: a number or a label of the program. */
function addressOf(at, program) {
  const n = typeof at === 'number' ? at : /^(0x[0-9a-f]+|\d+)$/i.test(String(at).trim()) ? Number(String(at).trim()) : program.symbols?.[String(at).trim()];
  if (n === undefined || n === null || !Number.isInteger(n)) throw new Error(X.noLabel(at));
  if (n < 0 || n > 0xfffff) throw new Error(X.outside(n));
  return n;
}

/** The bytes of a memory block, little-endian 16-bit words. */
const blockBytes = (b) => (b.words ? b.words.flatMap((w) => [w & 0xff, (w >>> 8) & 0xff]) : b.bytes.map((v) => v & 0xff));

/** The program's segments with the test's memory written into them (a new segment where none covers it). */
export function withMemory(program, memory) {
  const segments = program.segments.map((s) => ({ ...s, bytes: Uint8Array.from(s.bytes) }));
  for (const b of memory) {
    const at = addressOf(b.at, program);
    blockBytes(b).forEach((v, i) => {
      const a = (at + i) & 0xfffff;
      let s = segments.find((x) => a >= x.address && a < x.address + x.bytes.length);
      if (!s) { s = { address: a, bytes: new Uint8Array(1) }; segments.push(s); }
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
        if (FLAGS.includes(id)) {
          const got = regs.FLAGS & FLAG[id] ? 1 : 0;
          checks.push({ what: k, expected: String(v & 1), actual: String(got), ok: got === (v & 1) });
        } else {
          const want = v & 0xffff; const got = regs[id] & 0xffff;
          checks.push({ what: k, expected: showWord(want), actual: showWord(got), ok: got === want });
        }
      }
      for (const b of t.expect.memory) {
        let at;
        try { at = addressOf(b.at, program); } catch (err) { error ??= err.message; continue; }
        const name = typeof b.at === 'string' && !/^(0x[0-9a-f]+|\d+)$/i.test(b.at.trim()) ? b.at.trim() : hex(at, 5);
        if (b.words) {
          b.words.forEach((v, i) => {
            const m = e.peek((at + 2 * i) & 0xfffff, 2);
            const got = m[0] | (m[1] << 8); const want = v & 0xffff;
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
      if (t.expect.output !== undefined) {
        const got = e.state().output ?? '';
        checks.push({ what: X.output, expected: JSON.stringify(t.expect.output), actual: JSON.stringify(got), ok: got === t.expect.output });
      }
    }
    return { name: t.name, pass: !error && checks.every((c) => c.ok), error, checks, instructions: e?.state().retired ?? 0 };
  });
}
