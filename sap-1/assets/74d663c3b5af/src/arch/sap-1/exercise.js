// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { create } from './engine.js';
import { MEMORY_BYTES, memoryImage, parseNumber } from './language.js';
import { SAP1_STRINGS as S } from './strings.js';
const X = S.exercise;
const FORMAT = 'risc-vista-exercise';
const REGISTERS = ['A', 'B', 'OUT', 'PC'];
const RISCV_ONLY = ['entry', 'registers'];
const RISCV_EXPECT = ['output', 'exit', 'abi'];
export function parseExercise(o) {
 const fail = (m) => { throw new Error(m); };
 if (!o || typeof o !== 'object' || o.format !== FORMAT) fail(`not an exercise file (no "format": "${FORMAT}")`);
 if (o.version !== 1) fail(`version ${o.version} of the exercise format is not known to this version of MAVILERA`);
 if (o.arch !== 'sap-1') fail(X.notSap1);
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
 name: String(t.name ?? `Test ${i + 1}`), memory: mem(t.memory, where),
 expect: { registers: Object.fromEntries(Object.entries(regs).map(([k, v]) => [k.toUpperCase(), v])), memory: mem(e.memory, `${where}, expect`),
 outputs: e.outputs === undefined ? null : e.outputs.map(Number) },
 limit: Number(t.limit ?? 1000),
 };
 });
 return { title: o.title, task: String(o.task ?? ''), lang: 'asm', starter: o.starter === undefined ? null : String(o.starter), entry: null, tests };
}
const show = (v) => `${v} (0x${v.toString(16).toUpperCase().padStart(2, '0')})`;
function addressOf(at, program) {
 const n = typeof at === 'number' ? at : parseNumber(String(at)) ?? program.symbols[String(at).trim()];
 if (n === undefined || n === null) throw new Error(X.noLabel(at));
 if (n < 0 || n >= MEMORY_BYTES) throw new Error(X.outside(n));
 return n;
}
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
 b.bytes.forEach((v, i) => { image[(at + i) & 0xf] = v & 0xff; });
 }
 e = create({ ...program, segments: [{ address: 0, bytes: image, executable: true }], entry: program.entry ?? 0 }, { historyLimit: 1 });
 for (let n = 0; n < t.limit; n++) {
 const r = e.step();
 if (!r) break;
 if (r.registers.some((w) => w.id === 'OUT')) outs.push(r.registers.find((w) => w.id === 'OUT').value);
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
 const want = Number(v) & (k === 'PC' ? 0xf : 0xff);
 checks.push({ what: k, expected: show(want), actual: show(s.registers[k]), ok: s.registers[k] === want });
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
