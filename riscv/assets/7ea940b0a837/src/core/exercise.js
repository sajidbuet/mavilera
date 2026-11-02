// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Hart, SimError } from './iss.js';
import { ABI_NAMES } from '../isa/encoding.js';
export const EXERCISE_FORMAT = 'risc-vista-exercise';
const RETURN_STOP = 0xfffffff0;
const SIZES = { words: 4, halves: 2, bytes: 1 };
export function registerNumber(name) {
 const n = String(name).trim().toLowerCase();
 if (/^x([12]?\d|3[01])$/.test(n)) return Number(n.slice(1));
 if (n === 'fp') return 8;
 const i = ABI_NAMES.indexOf(n);
 return i >= 0 ? i : null;
}
export const isExercise = (o) => Boolean(o && typeof o === 'object' && o.format === EXERCISE_FORMAT);
export function parseExercise(o) {
 const fail = (m) => { throw new Error(m); };
 if (!isExercise(o)) fail(`not an exercise file (no "format": "${EXERCISE_FORMAT}")`);
 if (o.version !== 1) fail(`version ${o.version} of the exercise format is not known to this version of MAVILERA`);
 if (o.arch !== undefined && o.arch !== 'riscv') fail(`this exercise is for ${o.arch}, not RISC-V (its file has "arch": "${o.arch}")`);
 if (typeof o.title !== 'string' || !o.title.trim()) fail('the exercise has no title');
 if (!Array.isArray(o.tests) || !o.tests.length) fail('the exercise has no tests');
 const lang = o.lang ?? 'asm';
 if (!['asm', 'c'].includes(lang)) fail(`unknown language "${lang}"`);
 const regs = (r, where) => {
 if (r === undefined) return {};
 if (typeof r !== 'object' || Array.isArray(r)) fail(`${where}: registers must be an object`);
 for (const [k, v] of Object.entries(r)) {
 if (registerNumber(k) === null) fail(`${where}: "${k}" is not a register`);
 if (typeof v !== 'number' && typeof v !== 'string') fail(`${where}: the value of ${k} must be a number or a label`);
 }
 return r;
 };
 const mem = (m, where) => {
 if (m === undefined) return [];
 if (!Array.isArray(m)) fail(`${where}: memory must be a list`);
 for (const b of m) {
 const kinds = Object.keys(SIZES).filter((k) => Array.isArray(b?.[k]));
 if (b?.at === undefined || kinds.length !== 1) fail(`${where}: each memory block needs "at" and one of words, halves or bytes`);
 }
 return m;
 };
 const tests = o.tests.map((t, i) => {
 const where = `test ${i + 1}${t?.name ? ` (${t.name})` : ''}`;
 if (!t || typeof t !== 'object') fail(`${where} is not an object`);
 const e = t.expect ?? {};
 if (!Object.keys(e).length) fail(`${where} expects nothing`);
 return {
 name: String(t.name ?? `Test ${i + 1}`), registers: regs(t.registers, where), memory: mem(t.memory, where),
 expect: { registers: regs(e.registers, `${where}, expect`), memory: mem(e.memory, `${where}, expect`),
 output: e.output === undefined ? null : String(e.output), exit: e.exit === undefined ? null : Number(e.exit), abi: e.abi === true },
 limit: Number(t.limit ?? 1_000_000),
 };
 });
 return { title: o.title, task: String(o.task ?? ''), lang, starter: o.starter === undefined ? null : String(o.starter),
 entry: o.entry === undefined ? null : String(o.entry), tests };
}
const h8 = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
function valueOf(v, program) {
 if (typeof v === 'number') return v >>> 0;
 const s = v.trim();
 if (/^-?(0x[0-9a-f]+|0b[01]+|\d+)$/i.test(s)) return Number(s.startsWith('-') ? -Number(s.slice(1)) : Number(s)) >>> 0;
 if (!program.symbols.has(s)) throw new Error(`the program has no label "${s}"`);
 return program.symbols.get(s) >>> 0;
}
export function runExercise(program, ex) {
 return ex.tests.map((t) => {
 const checks = [];
 let error = null;
 let h = null;
 try {
 h = new Hart(program, { profile: 'iss', abiCheck: true });
 if (ex.entry) {
 h.pc = valueOf(ex.entry, program);
 h.x[1] = RETURN_STOP;
 }
 for (const [k, v] of Object.entries(t.registers)) { const r = registerNumber(k); if (r) h.x[r] = valueOf(v, program); }
 if (ex.entry) h.abiTrack((RETURN_STOP - 4) >>> 0, 0b1101111, 1, h.pc);
 for (const b of t.memory) {
 const [kind] = Object.keys(SIZES).filter((k) => Array.isArray(b[k]));
 const size = SIZES[kind];
 const at = valueOf(b.at, program);
 b[kind].forEach((v, i) => h.mem.write((at + i * size) >>> 0, size, Number(v) >>> 0));
 }
 while (!h.halted && h.pc !== RETURN_STOP && h.instret < t.limit) h.stepFast();
 if (!h.halted && h.pc !== RETURN_STOP) error = `no halt within ${t.limit.toLocaleString('en-GB')} instructions`;
 } catch (e) {
 if (!(e instanceof SimError) && !/label/.test(e.message)) throw e;
 error = e.message;
 }
 if (h && !(error && /label/.test(error))) {
 const x = t.expect;
 for (const [k, v] of Object.entries(x.registers)) {
 const r = registerNumber(k);
 const want = valueOf(v, program);
 checks.push({ what: `${k}`, expected: show(want), actual: show(h.x[r]), ok: h.x[r] === want });
 }
 for (const b of x.memory) {
 const [kind] = Object.keys(SIZES).filter((k) => Array.isArray(b[k]));
 const size = SIZES[kind];
 const at = valueOf(b.at, program);
 b[kind].forEach((v, i) => {
 const addr = (at + i * size) >>> 0;
 const mask = size === 4 ? 0xffffffff : (1 << (8 * size)) - 1;
 const want = (Number(v) & mask) >>> 0;
 const got = h.mem.read(addr, size) >>> 0;
 checks.push({ what: `${typeof b.at === 'string' ? b.at : h8(at)}[${i}] (${h8(addr)})`, expected: show(want), actual: show(got), ok: got === want });
 });
 }
 if (x.output !== null) {
 const got = String.fromCharCode(...h.output);
 checks.push({ what: 'output', expected: JSON.stringify(x.output), actual: JSON.stringify(got), ok: got === x.output });
 }
 if (x.exit !== null) checks.push({ what: 'exit code', expected: String(x.exit), actual: h.exitCode === null ? '—' : String(h.exitCode | 0), ok: h.exitCode !== null && (h.exitCode | 0) === x.exit });
 if (x.abi) checks.push({ what: 'calling convention', expected: 'kept', actual: h.abiViolations.length ? h.abiViolations[0] : 'kept', ok: !h.abiViolations.length });
 }
 return { name: t.name, pass: !error && checks.every((c) => c.ok), error, checks, instructions: h?.instret ?? 0 };
 });
}
const show = (v) => `${v | 0} (${h8(v)})`;
