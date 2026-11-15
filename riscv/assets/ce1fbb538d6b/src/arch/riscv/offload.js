// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { bits } from '../../isa/encoding.js';
import { NPU_BASE, NPU_REG, NPU_CTRL } from '../../mem/npu.js';
import { GPIO_BASE } from '../../mem/devices.js';
export const OFFLOAD_CLASSES = Object.freeze(['weights', 'send', 'poll', 'copy', 'marker', 'control']);
const NPU_SIZE = 0x1000;
const GPIO_SIZE = 0x1000;
export function operands(w) {
 const op = w & 0x7f;
 const rd = bits(w, 11, 7), rs1 = bits(w, 19, 15), rs2 = bits(w, 24, 20);
 const nz = (a) => a.filter((r) => r !== 0);
 switch (op) {
 case 0x03: return { rd, data: [], addr: nz([rs1]), kind: 'load' };
 case 0x23: return { rd: 0, data: nz([rs2]), addr: nz([rs1]), kind: 'store' };
 case 0x63: return { rd: 0, data: nz([rs1, rs2]), addr: [], kind: 'branch' };
 case 0x33: return { rd, data: nz([rs1, rs2]), addr: [], kind: 'alu' };
 case 0x13: return { rd, data: nz([rs1]), addr: [], kind: 'alu' };
 case 0x37: case 0x17: return { rd, data: [], addr: [], kind: 'alu' };
 case 0x6f: return { rd, data: [], addr: [], kind: 'jump' };
 case 0x67: return { rd, data: [], addr: nz([rs1]), kind: 'jump' };
 default: return { rd: 0, data: [], addr: [], kind: 'other' };
 }
}
function seed(acc, npuBase, gpioBase) {
 if (!acc) return null;
 const { addr, write } = acc;
 if (addr >= npuBase && addr < npuBase + NPU_SIZE) {
 const off = (addr - npuBase) & 0xffc;
 if (write) return off >= NPU_REG.WEIGHT && off < NPU_REG.ACT ? 'weights' : 'send';
 return off === NPU_REG.STATUS ? 'poll' : 'copy';
 }
 if (write && addr >= gpioBase && addr < gpioBase + GPIO_SIZE) return 'marker';
 return null;
}
export function classify(steps, { npuBase = NPU_BASE, gpioBase = GPIO_BASE } = {}) {
 const n = steps.length;
 const ops = steps.map((s) => operands(s.word));
 const cls = new Array(n).fill(null);
 const taint = new Array(32).fill(null);
 for (let i = 0; i < n; i++) {
 const s = steps[i], o = ops[i];
 const acc = o.kind === 'load' && s.load != null ? { addr: s.load >>> 0, write: false }
 : o.kind === 'store' && s.store ? { addr: s.store.addr >>> 0, write: true } : null;
 let c = seed(acc, npuBase, gpioBase);
 if (!c && o.kind !== 'load') {
 const t = o.data.map((r) => taint[r]);
 c = t.includes('poll') ? 'poll' : t.includes('copy') ? 'copy' : null;
 }
 cls[i] = c;
 if (o.rd) taint[o.rd] = c === 'poll' || c === 'copy' ? c : null;
 }
 const readers = Array.from({ length: n }, () => []);
 const last = new Array(32).fill(-1);
 for (let i = 0; i < n; i++) {
 const o = ops[i];
 for (const r of o.data) if (last[r] >= 0) readers[last[r]].push({ at: i, addr: false });
 for (const r of o.addr) if (last[r] >= 0) readers[last[r]].push({ at: i, addr: true });
 if (o.rd) last[o.rd] = i;
 }
 for (let i = n - 1; i >= 0; i--) {
 if (cls[i]) continue;
 const rs = readers[i];
 if (!ops[i].rd || !rs.length || rs.some((r) => r.addr)) { cls[i] = 'control'; continue; }
 const k = cls[rs[0].at];
 cls[i] = (k === 'weights' || k === 'send' || k === 'marker') && rs.every((r) => cls[r.at] === k) ? k : 'control';
 }
 return cls;
}
const zero = () => Object.fromEntries(OFFLOAD_CLASSES.map((c) => [c, 0]));
const total = (o) => OFFLOAD_CLASSES.reduce((s, c) => s + o[c], 0);
export function breakdown(steps, cls, markers = [], { npuBase = NPU_BASE } = {}) {
 const all = zero();
 for (const c of cls) all[c]++;
 const at = (cycle) => steps.findIndex((s) => s.cycle >= cycle);
 const spans = markers.slice(1).map((m, k) => {
 const from = markers[k];
 const counts = zero();
 const a = at(from.cycle), b = at(m.cycle);
 for (let i = a; i >= 0 && i < (b < 0 ? steps.length : b); i++) counts[cls[i]]++;
 return { from: from.out, to: m.out, cycles: m.cycle - from.cycle, counts };
 });
 const inNpu = (a) => a != null && (a >>> 0) >= npuBase && (a >>> 0) < npuBase + NPU_SIZE;
 const starts = [];
 steps.forEach((s, i) => {
 if (s.store && inNpu(s.store.addr) && (((s.store.addr >>> 0) - npuBase) & 0xffc) === NPU_REG.CTRL && (s.store.value & NPU_CTRL.START)) starts.push(i);
 });
 const vectors = starts.slice(1).map((b, k) => {
 const counts = zero();
 let npu = 0, polls = 0;
 for (let i = starts[k]; i < b; i++) {
 counts[cls[i]]++;
 const s = steps[i];
 if (inNpu(s.load) || inNpu(s.store?.addr)) npu++;
 if (inNpu(s.load) && (((s.load >>> 0) - npuBase) & 0xffc) === NPU_REG.STATUS) polls++;
 }
 return { counts, cycles: steps[b].cycle - steps[starts[k]].cycle, npu, polls };
 });
 const same = vectors.length > 0 && vectors.every((v) => OFFLOAD_CLASSES.every((c) => v.counts[c] === vectors[0].counts[c]) && v.npu === vectors[0].npu && v.polls === vectors[0].polls);
 return { all, total: total(all), spans, starts: starts.length, vectors, perVector: same ? vectors[0] : null };
}
export function noArrayTime(v) {
 if (!v || !v.polls) return null;
 const pass = v.counts.poll / v.polls;
 const cycles = v.cycles - (v.polls - 1) * pass;
 return { cycles, ratio: v.cycles / cycles, pass };
}
export function traceRun(hart, limit = 200_000) {
 const steps = [];
 while (!hart.halted && hart.instret < limit) {
 const rec = hart.step();
 if (!rec || rec.halt) break;
 steps.push({
 pc: rec.pc, word: rec.word, cycle: rec.cycle ?? steps.length,
 load: hart.d_ldSize ? hart.d_ldAddr >>> 0 : null,
 store: rec.mem ? { addr: rec.mem.addr >>> 0, value: rec.mem.value >>> 0 } : null,
 });
 }
 return steps;
}
