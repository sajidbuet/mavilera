// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { STOP } from '../contract.js';
import { decode, immShift, STACK_TOP } from './language.js';
import { ARMV7_STRINGS as S } from './strings.js';
export const REGISTER_IDS = Object.freeze([...Array.from({ length: 16 }, (_, i) => `r${i}`), 'N', 'Z', 'C', 'V']);
const FLAGS = ['N', 'Z', 'C', 'V'];
const PAGE = 4096;
const CLS = Object.freeze({ dp: 0, load: 1, store: 2, block: 3, taken: 4, notTaken: 5, skipped: 6 });
const HALT = 1 << 3;
const HAS_REG = 1 << 12;
const EXTRA = 1 << 20;
export function passed(cond, { N, Z, C, V }) {
 switch (cond) {
 case 0: return Z === 1;
 case 1: return Z === 0;
 case 2: return C === 1;
 case 3: return C === 0;
 case 4: return N === 1;
 case 5: return N === 0;
 case 6: return V === 1;
 case 7: return V === 0;
 case 8: return C === 1 && Z === 0;
 case 9: return C === 0 || Z === 1;
 case 10: return N === V;
 case 11: return N !== V;
 case 12: return Z === 0 && N === V;
 case 13: return Z === 1 || N !== V;
 default: return true;
 }
}
export function shiftC(value, type, amount, carry) {
 const v = value >>> 0;
 if (type === 4) return [((carry << 31) | (v >>> 1)) >>> 0, v & 1];
 if (amount === 0) return [v, carry];
 switch (type) {
 case 0: return amount < 32 ? [(v << amount) >>> 0, (v >>> (32 - amount)) & 1] : [0, amount === 32 ? v & 1 : 0];
 case 1: return amount < 32 ? [v >>> amount, (v >>> (amount - 1)) & 1] : [0, amount === 32 ? v >>> 31 : 0];
 case 2: return amount < 32 ? [(v | 0) >> amount >>> 0, (v >>> (amount - 1)) & 1] : [v >>> 31 ? 0xffffffff : 0, v >>> 31];
 default: { const k = amount & 31; const r = k ? ((v >>> k) | (v << (32 - k))) >>> 0 : v; return [r, r >>> 31]; }
 }
}
export function addWithCarry(x, y, c) {
 const sum = (x >>> 0) + (y >>> 0) + c;
 const result = sum >>> 0;
 return [result, sum > 0xffffffff ? 1 : 0, (x | 0) + (y | 0) + c !== (result | 0) ? 1 : 0];
}
export class Memory {
 constructor(pages = new Map()) { this.pages = pages; }
 read8(a) { const p = this.pages.get(Math.floor(a / PAGE)); return p ? p[a % PAGE] : 0; }
 write8(a, v) {
 const k = Math.floor(a / PAGE);
 let p = this.pages.get(k);
 if (!p) { p = new Uint8Array(PAGE); this.pages.set(k, p); }
 p[a % PAGE] = v & 0xff;
 }
 read(a, size) { let v = 0; for (let i = size - 1; i >= 0; i--) v = v * 256 + this.read8((a + i) >>> 0); return v >>> 0; }
 write(a, size, v) { for (let i = 0; i < size; i++) this.write8((a + i) >>> 0, Math.floor(v / 2 ** (8 * i)) & 0xff); }
 clone() { return new Memory(new Map([...this.pages].map(([k, p]) => [k, p.slice()]))); }
}
export function execute(pc, R, F, mem) {
 const w = mem.read(pc, 4);
 const d = decode(w);
 if (d.bad) return { error: S.engine.notRun(w, pc, S.outOfScope[d.bad]) };
 if (d.unpredictable) return { error: S.engine.unpredictable(w, pc, S.unpredictable[d.unpredictable]) };
 const r = (n) => (n === 15 ? (pc + 8) >>> 0 : R[n]);
 const x = { d, word: w, executed: passed(d.cond, F), regs: [], flags: {}, mem: [], reads: [], nextPc: (pc + 4) >>> 0, cls: CLS.skipped, pcFromData: false, call: false };
 if (!x.executed) { if (d.cls === 'branch') x.cls = CLS.notTaken; return x; }
 let pcValue = null;
 switch (d.cls) {
 case 'dp': {
 x.cls = CLS.dp;
 let op2;
 let carry = F.C;
 if (d.form === 'imm') { op2 = d.imm32; if (d.rot) carry = op2 >>> 31; }
 else if (d.form === 'reg') [op2, carry] = shiftC(r(d.Rm), ...immShift(d.sh, d.shamt), F.C);
 else [op2, carry] = shiftC(R[d.Rm], d.sh, R[d.Rs] & 0xff, F.C);
 const n = r(d.Rn);
 const nop = ~op2 >>> 0;
 let res;
 let arith = null;
 switch (d.cmd) {
 case 0: case 8: res = (n & op2) >>> 0; break;
 case 1: case 9: res = (n ^ op2) >>> 0; break;
 case 2: case 10: arith = addWithCarry(n, nop, 1); break;
 case 3: arith = addWithCarry(~n >>> 0, op2, 1); break;
 case 4: case 11: arith = addWithCarry(n, op2, 0); break;
 case 5: arith = addWithCarry(n, op2, F.C); break;
 case 6: arith = addWithCarry(n, nop, F.C); break;
 case 7: arith = addWithCarry(~n >>> 0, op2, F.C); break;
 case 12: res = (n | op2) >>> 0; break;
 case 13: res = op2; break;
 case 14: res = (n & nop) >>> 0; break;
 default: res = nop; break;
 }
 if (arith) res = arith[0];
 const test = d.cmd >= 8 && d.cmd <= 11;
 if (!test) { if (d.Rd === 15) pcValue = res; else x.regs.push([d.Rd, res]); }
 if (d.S) x.flags = { N: res >>> 31, Z: res === 0 ? 1 : 0, C: arith ? arith[1] : carry, ...(arith ? { V: arith[2] } : {}) };
 break;
 }
 case 'mem': {
 const base = r(d.Rn);
 const offset = d.Ibar ? shiftC(R[d.Rm], ...immShift(d.sh, d.shamt), F.C)[0] : d.imm12;
 const offAddr = (d.U ? base + offset : base - offset) >>> 0;
 const address = d.P ? offAddr : base;
 const size = d.B ? 1 : 4;
 if (size === 4 && address & 3) return { error: S.engine.unaligned(d.L ? 'load' : 'store', address, pc) };
 if (d.L) {
 x.cls = CLS.load;
 x.reads.push({ address, size });
 const data = mem.read(address, size);
 if (d.wback) x.regs.push([d.Rn, offAddr]);
 if (d.Rd === 15) pcValue = data; else x.regs.push([d.Rd, data]);
 x.pcFromData = d.Rd === 15;
 } else {
 x.cls = CLS.store;
 const v = d.Rd === 15 ? (pc + 8) >>> 0 : R[d.Rd];
 x.mem.push([address, size, size === 1 ? v & 0xff : v]);
 if (d.wback) x.regs.push([d.Rn, offAddr]);
 }
 break;
 }
 case 'branch': {
 x.cls = CLS.taken;
 x.nextPc = (pc + 8 + d.offset) >>> 0;
 if (d.L) { x.regs.push([14, (pc + 4) >>> 0]); x.call = true; }
 break;
 }
 case 'block': {
 x.cls = CLS.block;
 const count = Array.from({ length: 16 }, (_, i) => (d.list >> i) & 1).reduce((a, b) => a + b, 0);
 const n = R[d.Rn];
 let a = (d.name === 'STMDB' ? n - 4 * count : n) >>> 0;
 if (a & 3) return { error: S.engine.unaligned(d.L ? 'load' : 'store', a, pc) };
 x.reads = d.L ? [{ address: a, size: 4 * count }] : [];
 for (let i = 0; i < 16; i++) {
 if (!((d.list >> i) & 1)) continue;
 if (d.L) {
 const v = mem.read(a, 4);
 if (i === 15) { pcValue = v; x.pcFromData = true; } else x.regs.push([i, v]);
 } else x.mem.push([a, 4, i === 15 ? (pc + 8) >>> 0 : R[i]]);
 a = (a + 4) >>> 0;
 }
 if (d.W) x.regs.push([d.Rn, (d.name === 'STMDB' ? n - 4 * count : n + 4 * count) >>> 0]);
 break;
 }
 default: break;
 }
 if (pcValue !== null) {
 if (pcValue & 1) return { error: S.engine.thumb(pcValue, pc) };
 if (pcValue & 2) return { error: S.engine.pcHalf(pcValue, pc) };
 x.nextPc = pcValue >>> 0;
 if (d.cls === 'dp') x.pcFromData = true;
 }
 return x;
}
export function create(program, { historyLimit = 1_000_000, runLimit = 10_000_000 } = {}) {
 const image = new Memory();
 for (const s of program.segments) for (let i = 0; i < s.bytes.length; i++) if (s.bytes[i]) image.write8(s.address + i, s.bytes[i]);
 const code = program.segments.filter((s) => s.executable).map((s) => [s.address, s.address + s.bytes.length]);
 const inCode = (a) => code.some(([lo, hi]) => a >= lo && a + 4 <= hi);
 const names = new Map(Object.entries(program.symbols ?? {}).map(([k, v]) => [v >>> 0, k]));
 const limit = Math.max(1, historyLimit);
 let mem, R, F, pc, halted, error, retired, steps, counts, frames;
 let pcA, wordA, infoA, regOld, memAddr, memOld, cap, start, size, dropped, extra, seq;
 const alloc = (n) => {
 const grow = (old) => { const a = new Uint32Array(n); if (old) for (let k = 0; k < size; k++) a[k] = old[(start + k) % old.length]; return a; };
 [pcA, wordA, infoA, regOld, memAddr, memOld] = [pcA, wordA, infoA, regOld, memAddr, memOld].map(grow);
 start = 0;
 cap = n;
 };
 const reset = () => {
 mem = image.clone();
 R = new Uint32Array(16);
 R[13] = STACK_TOP;
 F = { N: 0, Z: 0, C: 0, V: 0 };
 pc = program.entry >>> 0;
 halted = false; error = null; retired = 0; steps = 0;
 counts = new Array(7).fill(0);
 frames = [];
 pcA = null; size = 0; dropped = 0; extra = new Map(); seq = 0;
 alloc(Math.min(limit, 4096));
 };
 reset();
 const flagBits = () => (F.N << 3) | (F.Z << 2) | (F.C << 1) | F.V;
 const regsRecord = () => ({ ...Object.fromEntries(Array.from(R, (v, i) => [`r${i}`, i === 15 ? pc : v])), ...F });
 const state = () => ({ pc, registers: regsRecord(), halted, error, retired, steps, output: '', outputDropped: 0, historyDropped: dropped });
 const remember = (x, rec, call) => {
 if (size === cap && cap < limit) alloc(Math.min(limit, cap * 2));
 let i;
 if (size === cap) { i = start; start = (start + 1) % cap; extra.delete(seq - size); dropped += 1; } else { i = (start + size) % cap; size += 1; }
 const fmask = FLAGS.reduce((m, f, k) => m | (f in x.flags ? 8 >> k : 0), 0);
 let info = x.cls | (x.d.halt && x.executed ? HALT : 0) | (flagBits() << 4) | (fmask << 8);
 const regs = x.regs.map(([n]) => [n, R[n]]);
 const mems = rec.memory.map((m) => [m.address, m.size, m.old]);
 if (regs.length > 1 || mems.length > 1 || call) {
 info |= EXTRA;
 extra.set(seq, { regs, mems, call });
 } else {
 if (regs.length) { info |= HAS_REG | (regs[0][0] << 13); regOld[i] = regs[0][1]; }
 if (mems.length) { info |= mems[0][1] << 17; memAddr[i] = mems[0][0]; memOld[i] = mems[0][2]; }
 }
 pcA[i] = pc; wordA[i] = x.word; infoA[i] = info;
 seq += 1;
 };
 const entry = (k = 0) => {
 const i = (start + size - 1 - k) % cap;
 const info = infoA[i];
 if (info & EXTRA) return { pc: pcA[i], word: wordA[i], info, ...extra.get(seq - 1 - k) };
 return { pc: pcA[i], word: wordA[i], info, call: null,
 regs: info & HAS_REG ? [[(info >>> 13) & 15, regOld[i]]] : [], mems: (info >>> 17) & 7 ? [[memAddr[i], (info >>> 17) & 7, memOld[i]]] : [] };
 };
 const recordOf = (e) => {
 const fmask = (e.info >>> 8) & 15;
 const fold = (e.info >>> 4) & 15;
 return {
 pc: e.pc, word: e.word, size: 4, nextPc: pc,
 registers: [...e.regs.map(([n, old]) => ({ id: `r${n}`, old, value: R[n] })),
 ...FLAGS.filter((_, k) => fmask & (8 >> k)).map((f) => ({ id: f, old: (fold & (8 >> FLAGS.indexOf(f))) ? 1 : 0, value: F[f] }))],
 memory: e.mems.map(([address, sz, old]) => ({ address, size: sz, old, value: mem.read(address, sz) })),
 };
 };
 const step = () => {
 if (halted) return null;
 if (!inCode(pc)) { error = S.engine.noCode(pc); halted = true; return null; }
 const x = execute(pc, R, F, mem);
 if (x.error) { error = x.error; halted = true; return null; }
 const rec = {
 pc, word: x.word, size: 4, nextPc: x.nextPc,
 registers: [...x.regs.map(([n, v]) => ({ id: `r${n}`, old: R[n], value: v })),
 ...FLAGS.filter((f) => f in x.flags).map((f) => ({ id: f, old: F[f], value: x.flags[f] }))],
 memory: x.mem.map(([address, sz, value]) => ({ address, size: sz, old: mem.read(address, sz), value })),
 reads: x.reads, executed: x.executed,
 };
 let call = null;
 if (x.call) call = { push: { call: pc, target: x.nextPc, ret: (pc + 4) >>> 0, sp: R[13], args: [R[0], R[1], R[2], R[3]] } };
 else if (x.pcFromData) {
 const k = frames.findLastIndex((f) => f.ret === x.nextPc);
 if (k >= 0) call = { popped: frames.slice(k) };
 }
 remember(x, rec, call);
 for (const [n, v] of x.regs) R[n] = v;
 for (const f of FLAGS) if (f in x.flags) F[f] = x.flags[f];
 for (const [a, sz, v] of x.mem) mem.write(a, sz, v);
 if (call?.push) frames.push(call.push);
 if (call?.popped) frames.length -= call.popped.length;
 pc = x.nextPc;
 counts[x.cls] += 1;
 retired += 1;
 steps += 1;
 if (x.d.halt && x.executed) { halted = true; return { ...rec, halt: true }; }
 return rec;
 };
 const back = () => {
 if (error) { error = null; halted = false; return true; }
 if (!size) return false;
 const e = entry(0);
 for (let k = e.mems.length - 1; k >= 0; k--) mem.write(e.mems[k][0], e.mems[k][1], e.mems[k][2]);
 for (let k = e.regs.length - 1; k >= 0; k--) R[e.regs[k][0]] = e.regs[k][1];
 const fold = (e.info >>> 4) & 15;
 F = { N: (fold >> 3) & 1, Z: (fold >> 2) & 1, C: (fold >> 1) & 1, V: fold & 1 };
 if (e.call?.push) frames.pop();
 if (e.call?.popped) frames.push(...e.call.popped);
 pc = e.pc;
 counts[e.info & 7] -= 1;
 if (e.info & EXTRA) extra.delete(seq - 1);
 size -= 1;
 seq -= 1;
 halted = false;
 retired -= 1;
 steps -= 1;
 return true;
 };
 const run = ({ chunk = 100_000, breakpoints = new Set(), target = null, depth = null, resumed = false, watch = {} } = {}) => {
 const wr = watch.registers ?? new Set();
 const wm = watch.memory ?? new Set();
 for (let i = 0; i < chunk; i++) {
 if (halted) return error ? STOP.ERROR : STOP.HALT;
 if (steps >= runLimit) return STOP.BUDGET;
 if (i > 0 || resumed) {
 if (breakpoints.has(pc)) return STOP.BREAK;
 if (pc === target && (depth === null || frames.length <= depth)) return STOP.TARGET;
 }
 const rec = step();
 if (!rec) return STOP.ERROR;
 if (rec.halt) return STOP.HALT;
 if (wr.size && rec.registers.some((r) => wr.has(r.id))) return STOP.WATCH;
 if (wm.size && rec.memory.some((m) => Array.from({ length: m.size }, (_, k) => m.address + k).some((a) => wm.has(a) || wm.has(a & ~3)))) return STOP.WATCH;
 }
 return STOP.CHUNK;
 };
 const ordered = (a) => Uint32Array.from({ length: size }, (_, k) => a[(start + k) % cap]);
 const C = S.counterNames;
 return {
 reset, step, back, run, state,
 last: () => (size ? recordOf(entry(0)) : null),
 peek: (address, length) => Uint8Array.from({ length }, (_, i) => mem.read8((address + i) >>> 0)),
 callDepth: () => frames.length,
 stepOverTarget: () => {
 if (halted) return null;
 const d = decode(mem.read(pc, 4));
 return d.cls === 'branch' && d.L ? (pc + 4) >>> 0 : null;
 },
 stepOutTarget: () => (frames.length ? frames[frames.length - 1].ret : null),
 callStack: () => frames.map((f, k) => ({ depth: k + 1, ...(names.has(f.target) ? { name: names.get(f.target) } : {}), target: f.target, call: f.call,
 ret: f.ret, sp: f.sp, args: f.args.map((value, j) => ({ name: `R${j}`, value })) })).reverse(),
 loopRange: () => {
 if (!size) return null;
 const pcs = Array.from({ length: Math.min(64, size) }, (_, k) => entry(k).pc);
 return { from: Math.min(...pcs), to: Math.max(...pcs) };
 },
 counters: () => [[C.instructions, retired], [C.executed, retired - counts[CLS.skipped] - counts[CLS.notTaken]], [C.skipped, counts[CLS.skipped]],
 [C.dp, counts[CLS.dp]], [C.load, counts[CLS.load]], [C.store, counts[CLS.store]], [C.block, counts[CLS.block]],
 [C.branchTaken, counts[CLS.taken]], [C.branchNotTaken, counts[CLS.notTaken]]],
 dataAccess: () => {
 if (halted) return null;
 const d = decode(mem.read(pc, 4));
 if (d.bad || !passed(d.cond, F)) return null;
 const r = (n) => (n === 15 ? (pc + 8) >>> 0 : R[n]);
 if (d.cls === 'mem') {
 const off = d.Ibar ? shiftC(R[d.Rm], ...immShift(d.sh, d.shamt), F.C)[0] : d.imm12;
 return { address: d.P ? (d.U ? r(d.Rn) + off : r(d.Rn) - off) >>> 0 : r(d.Rn), size: d.B ? 1 : 4 };
 }
 if (d.cls === 'block' && d.Rn !== 15 && d.list) {
 const n = Array.from({ length: 16 }, (_, i) => (d.list >> i) & 1).reduce((a, b) => a + b, 0);
 return { address: (d.name === 'STMDB' ? R[d.Rn] - 4 * n : R[d.Rn]) >>> 0, size: 4 * n };
 }
 return null;
 },
 snapshot: () => {
 const first = seq - size;
 return { pages: [...mem.pages].map(([k, p]) => [k, p.slice()]), R: R.slice(), F: { ...F }, pc, halted, error, retired, steps, counts: counts.slice(),
 frames: frames.map((f) => ({ ...f, args: f.args.slice() })), dropped,
 history: { pc: ordered(pcA), word: ordered(wordA), info: ordered(infoA), regOld: ordered(regOld), memAddr: ordered(memAddr), memOld: ordered(memOld),
 extra: [...extra].map(([s, e]) => [s - first, e]) } };
 },
 restore: (s) => {
 mem = new Memory(new Map(s.pages.map(([k, p]) => [k, p.slice()])));
 R = Uint32Array.from(s.R); F = { ...s.F }; counts = s.counts.slice(); frames = s.frames.map((f) => ({ ...f, args: f.args.slice() }));
 ({ pc, halted, error, retired, steps, dropped } = s);
 const h = s.history;
 const n = h.pc.length;
 pcA = null; size = 0;
 alloc(Math.max(Math.min(limit, 4096), n));
 size = n;
 pcA.set(h.pc); wordA.set(h.word); infoA.set(h.info); regOld.set(h.regOld); memAddr.set(h.memAddr); memOld.set(h.memOld);
 seq = steps;
 const first = seq - n;
 extra = new Map(h.extra.map(([k, e]) => [k + first, e]));
 },
 };
}
