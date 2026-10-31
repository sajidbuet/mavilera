// sap-2/exercise.js -- exercise files for SAP-2 (contract v4 Descriptor.exercises, capability exercises; WS-F-148;
// plan step 4 of docs/architecture/sap-2-plan.md): the shell's exercise format ("format": "risc-vista-exercise",
// version 1) with "arch": "sap-2", run on the SAP-2 engine. SAP-2 cannot set a register before a run, so a test sets
// memory bytes (at a label or an address) and enters inputs, as the ports' panel does: a key on port 1 (`key`) or the
// SERIAL IN switch (`serialIn`), each before the instruction counted by `at` (the engine's input log). It checks what
// the program left: registers A, B, C, S, Z, PC, OUT3 and OUT4, memory bytes, and `outputs`, every value written to
// port 3 in order. Fields of the RISC-V tests (registers set before a run, entry, words, halves, output text, exit,
// abi) are refused with a reason. Pure JavaScript, no DOM.
//
//   { "format": "risc-vista-exercise", "version": 1, "arch": "sap-2", "title", "task", "lang": "asm", "starter",
//     "tests": [{ "name", "memory": [{"at": "x" | 8192, "bytes": [5]}], "inputs": [{"at": 0, "key": 7}],
//                 "expect": { "registers": {"A": 15}, "memory": [...], "outputs": [15] }, "limit": 10000 }] }
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { create } from './engine.js';
import { MEMORY_BYTES, memoryImage, parseNumber } from './language.js';
import { SAP2_STRINGS as S } from './strings.js';

const X = S.exercise;
const FORMAT = 'risc-vista-exercise';
const REGISTERS = ['A', 'B', 'C', 'S', 'Z', 'PC', 'OUT3', 'OUT4'];
const RISCV_ONLY = ['entry', 'registers'];
const RISCV_EXPECT = ['output', 'exit', 'abi'];

/** Check an SAP-2 exercise file; returns it normalised, or throws an Error naming the first problem. */
export function parseExercise(o) {
  const fail = (m) => { throw new Error(m); };
  if (!o || typeof o !== 'object' || o.format !== FORMAT) fail(`not an exercise file (no "format": "${FORMAT}")`);
  if (o.version !== 1) fail(`version ${o.version} of the exercise format is not known to this version of MAVILERA`);
  if (o.arch !== 'sap-2') fail(X.notSap2);
  if (typeof o.title !== 'string' || !o.title.trim()) fail('the exercise has no title');
  if ((o.lang ?? 'asm') !== 'asm') fail(`unknown language "${o.lang}"`);
  if (o.entry !== undefined) fail(X.notHere('the exercise', 'entry'));
  if (!Array.isArray(o.tests) || !o.tests.length) fail('the exercise has no tests');
  const mem = (m, where) => {
    if (m === undefined) return [];
    if (!Array.isArray(m)) fail(`${where}: memory must be a list`);
    for (const b of m) if (b?.at === undefined || !Array.isArray(b.bytes) || b.words || b.halves) fail(X.bytesOnly(where));
    return m.map((b) => ({ at: b.at, bytes: b.bytes.map(Number) }));
  };
  const inputs = (list, where) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) fail(X.badInput(where));
    return list.map((x) => {
      const ok = x && Number.isInteger(x.at) && x.at >= 0 && (x.key !== undefined) !== (x.serialIn !== undefined)
        && (x.key === undefined || (Number.isInteger(x.key) && x.key >= 0 && x.key <= 255))
        && (x.serialIn === undefined || x.serialIn === 0 || x.serialIn === 1);
      if (!ok) fail(X.badInput(where));
      return x.key !== undefined ? { at: x.at, key: x.key } : { at: x.at, serialIn: x.serialIn };
    });
  };
  const tests = o.tests.map((t, i) => {
    const where = `test ${i + 1}${t?.name ? ` (${t.name})` : ''}`;
    if (!t || typeof t !== 'object') fail(`${where} is not an object`);
    for (const k of RISCV_ONLY) if (t[k] !== undefined) fail(k === 'registers' ? X.noRegisterInputs(where) : X.notHere(where, k));
    const e = t.expect ?? {};
    for (const k of RISCV_EXPECT) if (e[k] !== undefined) fail(X.notHere(`${where}, expect`, k));
    if (!Object.keys(e).length) fail(`${where} expects nothing`);
    const regs = e.registers ?? {};
    for (const k of Object.keys(regs)) if (!REGISTERS.includes(k.toUpperCase())) fail(X.notRegister(where, k));
    if (e.outputs !== undefined && !Array.isArray(e.outputs)) fail(`${where}: outputs must be a list of values`);
    return {
      name: String(t.name ?? `Test ${i + 1}`), memory: mem(t.memory, where), inputs: inputs(t.inputs, where),
      expect: { registers: Object.fromEntries(Object.entries(regs).map(([k, v]) => [k.toUpperCase(), v])), memory: mem(e.memory, `${where}, expect`),
        outputs: e.outputs === undefined ? null : e.outputs.map(Number) },
      limit: Number(t.limit ?? 10_000),
    };
  });
  return { title: o.title, task: String(o.task ?? ''), lang: 'asm', starter: o.starter === undefined ? null : String(o.starter), entry: null, tests };
}

const show = (v, digits = 2) => `${v} (${v.toString(16).toUpperCase().padStart(digits, '0')}H)`;
const MASK = { PC: 0xffff, S: 1, Z: 1 };

/** An address: a number (any of the assembler's notations) or a label of the program. */
function addressOf(at, program) {
  const n = typeof at === 'number' ? at : parseNumber(String(at)) ?? program.symbols[String(at).trim()];
  if (n === undefined || n === null) throw new Error(X.noLabel(at));
  if (n < 0 || n >= MEMORY_BYTES) throw new Error(X.outside(n));
  return n;
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
    const outs = [];
    try {
      const image = memoryImage(program);
      for (const b of t.memory) {
        const at = addressOf(b.at, program);
        b.bytes.forEach((v, i) => { image[(at + i) & 0xffff] = v & 0xff; });
      }
      e = create({ ...program, segments: [{ address: 0, bytes: image, executable: true }], entry: program.entry ?? 0 }, { historyLimit: 1, inputs: t.inputs });
      for (let n = 0; n < t.limit; n++) {
        const r = e.step();
        if (!r) break;
        if (r.output) outs.push(r.registers.find((w) => w.id === 'OUT3').value);
        if (r.halt) break;
      }
      const s = e.state();
      if (s.error) error = s.error;
      else if (!s.halted) error = X.noHalt(t.limit);
    } catch (err) {
      error = err.message;
    }
    if (e) {
      const s = e.state();
      for (const [k, v] of Object.entries(t.expect.registers)) {
        const want = Number(v) & (MASK[k] ?? 0xff);
        const digits = k === 'PC' ? 4 : 2;
        checks.push({ what: k, expected: show(want, digits), actual: show(s.registers[k], digits), ok: s.registers[k] === want });
      }
      for (const b of t.expect.memory) {
        let at;
        try { at = addressOf(b.at, program); } catch (err) { error ??= err.message; continue; }
        const got = e.peek(at, b.bytes.length);
        b.bytes.forEach((v, i) => {
          const want = v & 0xff;
          checks.push({ what: `${typeof b.at === 'string' ? b.at : at}[${i}]`, expected: show(want), actual: show(got[i]), ok: got[i] === want });
        });
      }
      if (t.expect.outputs) {
        const want = t.expect.outputs.map((v) => v & 0xff);
        checks.push({ what: X.outputs, expected: want.join(', ') || '—', actual: outs.join(', ') || '—',
          ok: want.length === outs.length && want.every((v, i) => v === outs[i]) });
      }
    }
    return { name: t.name, pass: !error && checks.every((c) => c.ok), error, checks, instructions: e?.state().retired ?? 0 };
  });
}
