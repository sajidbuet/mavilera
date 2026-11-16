// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { MACHINES, initialCore, issue, done, loadProgram } from './engine.js';
import { DMEM_WORDS } from './isa.js';
import { RVSIMT_STRINGS as S } from './strings.js';
const X = S.exercise;
const FORMAT = 'risc-vista-exercise';
const FOREIGN_TEST = ['entry', 'registers'];
const FOREIGN_EXPECT = ['registers', 'output', 'exit', 'abi', 'outputs'];
export function parseExercise(o) {
 const fail = (m) => { throw new Error(m); };
 if (!o || typeof o !== 'object' || o.format !== FORMAT) fail(`not an exercise file (no "format": "${FORMAT}")`);
 if (o.version !== 1) fail(`version ${o.version} of the exercise format is not known to this version of MAVILERA`);
 if (o.arch !== 'gpu') fail(X.notGpu);
 if (typeof o.title !== 'string' || !o.title.trim()) fail('the exercise has no title');
 if ((o.lang ?? 'asm') !== 'asm') fail(`unknown language "${o.lang}"`);
 const profile = o.profile ?? 'lab';
 if (!MACHINES[profile]) fail(X.badProfile(profile));
 if (o.entry !== undefined) fail(X.notHere('the exercise', 'entry'));
 if (!Array.isArray(o.tests) || !o.tests.length) fail('the exercise has no tests');
 const mem = (m, where) => {
 if (m === undefined) return [];
 if (!Array.isArray(m)) fail(`${where}: memory must be a list`);
 for (const b of m) if (b?.at === undefined || !Array.isArray(b.words) || b.bytes || b.halves) fail(X.wordsOnly(where));
 return m.map((b) => ({ at: b.at, words: b.words.map(Number) }));
 };
 const tests = o.tests.map((t, i) => {
 const where = `test ${i + 1}${t?.name ? ` (${t.name})` : ''}`;
 if (!t || typeof t !== 'object') fail(`${where} is not an object`);
 for (const k of FOREIGN_TEST) if (t[k] !== undefined) fail(k === 'registers' ? X.noRegisterInputs(where) : X.notHere(where, k));
 const e = t.expect ?? {};
 for (const k of FOREIGN_EXPECT) if (e[k] !== undefined) fail(k === 'registers' ? X.noRegisterInputs(`${where}, expect`) : X.notHere(`${where}, expect`, k));
 if (!e.memory?.length) fail(`${where} expects nothing`);
 return { name: String(t.name ?? `Test ${i + 1}`), memory: mem(t.memory, where), expect: { memory: mem(e.memory, `${where}, expect`) },
 limit: Number(t.limit ?? 10_000) };
 });
 return { title: o.title, task: String(o.task ?? ''), lang: 'asm', profile, starter: o.starter === undefined ? null : String(o.starter), entry: null, tests };
}
const show = (v) => `${v | 0} (0x${(v >>> 0).toString(16).padStart(8, '0')})`;
function wordOf(at, program) {
 const sym = program.symbols instanceof Map ? program.symbols.get(String(at).trim()) : program.symbols?.[String(at).trim()];
 const a = typeof at === 'number' ? at : /^(0x[\da-f]+|\d+)$/i.test(String(at).trim()) ? Number(String(at).trim()) : sym;
 if (a === undefined || a === null) throw new Error(X.noLabel(at));
 if (a % 4) throw new Error(X.unaligned(a));
 if (a < 0 || a >= DMEM_WORDS * 4) throw new Error(X.outside(a));
 return a >>> 2;
}
export function coreFor(program, memory) {
 const { machine, prog, data } = loadProgram(program);
 const words = Array.from({ length: DMEM_WORDS }, (_, i) => data[i] ?? 0);
 for (const b of memory) {
 const w = wordOf(b.at, program);
 b.words.forEach((v, i) => {
 if (w + i >= DMEM_WORDS) throw new Error(X.outside((w + i) * 4));
 words[w + i] = v >>> 0;
 });
 }
 return initialCore(machine, prog, words);
}
export function runExercise(program, ex) {
 return ex.tests.map((t) => {
 const checks = [];
 let error = null;
 let c = null;
 try {
 if ((program.profile ?? 'lab') !== ex.profile) throw new Error(X.wrongProfile(ex.profile, program.profile));
 c = coreFor(program, t.memory);
 let n = 0;
 for (; n < t.limit; n++) {
 const r = issue(c);
 if (!r || r.fault) break;
 }
 if (c.fault) error = X.fault(c.fault);
 else if (!done(c)) error = n >= t.limit ? X.noEnd(t.limit) : X.deadlock;
 } catch (err) {
 error = err.message;
 }
 if (c) {
 for (const b of t.expect.memory) {
 let w;
 try { w = wordOf(b.at, program); } catch (err) { error ??= err.message; continue; }
 b.words.forEach((v, i) => {
 const want = v >>> 0, got = c.dmem[w + i] >>> 0;
 checks.push({ what: typeof b.at === 'string' ? `${b.at}[${i}]` : `${(w + i) * 4}`, expected: show(want), actual: show(got), ok: got === want });
 });
 }
 }
 return { name: t.name, pass: !error && checks.every((k) => k.ok), error, checks, instructions: c?.issued ?? 0 };
 });
}
