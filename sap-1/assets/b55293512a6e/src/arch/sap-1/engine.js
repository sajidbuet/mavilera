// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP, OUTPUT_KEEP } from '../contract.js';
import { OPCODES, MNEMONIC_OF, memoryImage } from './language.js';
import { SAP1_STRINGS as S } from './strings.js';
export const REGISTER_IDS = Object.freeze(['A', 'B', 'OUT', 'PC', 'IR', 'MAR']);
export function execute(op, addr, regs, mem) {
 switch (op) {
 case OPCODES.LDA: return [['MAR', addr], ['A', mem[addr]]];
 case OPCODES.ADD: return [['MAR', addr], ['B', mem[addr]], ['A', (regs.A + mem[addr]) & 0xff]];
 case OPCODES.SUB: return [['MAR', addr], ['B', mem[addr]], ['A', (regs.A - mem[addr]) & 0xff]];
 case OPCODES.OUT: return [['OUT', regs.A]];
 default: return [];
 }
}
const READS = new Set([OPCODES.LDA, OPCODES.ADD, OPCODES.SUB]);
function recordOf(regs, mem) {
 const pc = regs.PC;
 const word = mem[pc];
 const op = word >> 4;
 const after = { ...regs, PC: (pc + 1) & 0xf };
 const rec = { pc, word, size: 1, nextPc: after.PC, registers: [], memory: [], reads: READS.has(op) ? [{ address: word & 0xf, size: 1 }] : [] };
 for (const [id, value] of [['MAR', pc], ['IR', word], ...execute(op, word & 0xf, regs, mem)]) {
 const w = rec.registers.find((r) => r.id === id);
 if (w) w.value = value; else rec.registers.push({ id, old: regs[id], value });
 after[id] = value;
 }
 return { rec, after };
}
const pack = (r) => r.A + r.B * 2 ** 8 + r.OUT * 2 ** 16 + r.IR * 2 ** 24 + r.PC * 2 ** 32 + r.MAR * 2 ** 36;
const unpack = (n) => ({ A: n % 256, B: Math.floor(n / 2 ** 8) % 256, OUT: Math.floor(n / 2 ** 16) % 256, PC: Math.floor(n / 2 ** 32) % 16,
 IR: Math.floor(n / 2 ** 24) % 256, MAR: Math.floor(n / 2 ** 36) % 16 });
export function create(program, { historyLimit = 1_000_000, runLimit = 10_000_000 } = {}) {
 const image = memoryImage(program);
 const cap = Math.max(1, historyLimit);
 let mem, regs, counts, halted, error, retired, steps, dropped, output, outBase;
 let before, outLen, end, size;
 const reset = () => {
 mem = image.slice();
 regs = { A: 0, B: 0, OUT: 0, PC: program.entry & 0xf, IR: 0, MAR: 0 };
 counts = {};
 halted = false; error = null; retired = 0; steps = 0; dropped = 0; output = ''; outBase = 0;
 before = []; outLen = []; end = 0; size = 0;
 };
 reset();
 const remember = () => {
 before[end] = pack(regs);
 outLen[end] = outBase + output.length;
 end = (end + 1) % cap;
 if (size < cap) size += 1; else dropped += 1;
 };
 const newest = () => (end - 1 + cap) % cap;
 const state = () => ({ pc: regs.PC, registers: { ...regs }, halted, error, retired, output, outputDropped: outBase, historyDropped: dropped, steps });
 const step = () => {
 if (halted) return null;
 const op = mem[regs.PC] >> 4;
 if (MNEMONIC_OF[op] === undefined) {
 error = S.engine.badOpcode(op, regs.PC);
 halted = true;
 return null;
 }
 remember();
 const { rec, after } = recordOf(regs, mem);
 regs = after;
 counts[op] = (counts[op] ?? 0) + 1;
 retired += 1;
 steps += 1;
 const out = op === OPCODES.OUT ? S.engine.out(regs.OUT) : '';
 output += out;
 if (output.length > 2 * OUTPUT_KEEP) { const drop = output.length - OUTPUT_KEEP; output = output.slice(drop); outBase += drop; }
 if (op === OPCODES.HLT) halted = true;
 return { ...rec, ...(op === OPCODES.HLT ? { halt: true } : {}), ...(out ? { output: out } : {}) };
 };
 const back = () => {
 if (error) { error = null; halted = false; return true; }
 if (!size) return false;
 const i = newest();
 regs = unpack(before[i]);
 if (outLen[i] >= outBase) output = output.slice(0, outLen[i] - outBase);
 else { output = ''; outBase = outLen[i]; }
 counts[mem[regs.PC] >> 4] -= 1;
 end = i;
 size -= 1;
 halted = false;
 retired -= 1;
 steps -= 1;
 return true;
 };
 const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, resumed = false, watch = {} } = {}) => {
 const wr = watch.registers ?? new Set();
 for (let i = 0; i < chunk; i++) {
 if (halted) return error ? STOP.ERROR : STOP.HALT;
 if (steps >= runLimit) return STOP.BUDGET;
 if (i > 0 || resumed) {
 if (breakpoints.has(regs.PC)) return STOP.BREAK;
 if (regs.PC === target) return STOP.TARGET;
 }
 const rec = step();
 if (!rec) return STOP.ERROR;
 if (rec.halt) return STOP.HALT;
 if (wr.size && rec.registers.some((r) => wr.has(r.id))) return STOP.WATCH;
 }
 return STOP.CHUNK;
 };
 const ordered = (a) => Array.from({ length: size }, (_, k) => a[(end - size + k + cap) % cap]);
 return {
 reset, step, back, run, state,
 last: () => (size ? recordOf(unpack(before[newest()]), mem).rec : null),
 peek: (address, length) => {
 const out = new Uint8Array(length);
 for (let i = 0; i < length; i++) out[i] = mem[(address + i) & 0xf];
 return out;
 },
 loopRange: () => {
 if (!size) return null;
 const pcs = Array.from({ length: Math.min(64, size) }, (_, k) => unpack(before[(end - 1 - k + cap) % cap]).PC);
 return { from: Math.min(...pcs), to: Math.max(...pcs) };
 },
 counters: () => [[S.counterNames.instructions, retired], ...Object.entries(OPCODES).map(([m, op]) => [m, counts[op] ?? 0])],
 dataAccess: () => {
 if (halted) return null;
 const w = mem[regs.PC];
 return READS.has(w >> 4) ? { address: w & 0xf, size: 1 } : null;
 },
 snapshot: () => ({ mem: mem.slice(), regs: { ...regs }, counts: { ...counts }, halted, error, retired, steps, dropped, output, outBase,
 before: ordered(before), outLen: ordered(outLen) }),
 restore: (s) => {
 mem = s.mem.slice(); regs = { ...s.regs }; counts = { ...s.counts };
 ({ halted, error, retired, steps, dropped, output } = s);
 outBase = s.outBase ?? 0;
 before = s.before.slice(); outLen = s.outLen.slice(); size = before.length; end = size % cap;
 },
 };
}
