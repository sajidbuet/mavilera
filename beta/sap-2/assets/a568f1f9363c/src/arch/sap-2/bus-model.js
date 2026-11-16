// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { OUTPUT_KEEP } from '../contract.js';
import { BY_OPCODE, PORTS, RETURN_ADDRESS, memoryImage } from './language.js';
import { PORT_BITS, ROM_BYTES } from './engine.js';
import { SAP2_STRINGS as S } from './strings.js';
const JOURNAL_KEEP = 1_000_000;
export const SIGNALS = Object.freeze([
 ['Cp', 'PC'], ['Ep', 'PC'], ['Epl', 'PC'], ['Eph', 'PC'], ['Lpl', 'PC'], ['Lph', 'PC'],
 ['Lm', 'MAR'], ['Lml', 'MAR'], ['Lmh', 'MAR'], ['CE', 'MEM'], ['WE', 'MEM'], ['Lmd', 'MDR'], ['Li', 'IR'], ['Ein', 'IN'],
 ['Lf', 'FLAGS'], ['La', 'A'], ['Ea', 'A'], ['Eu', 'ALU'], ['Lt', 'TMP'], ['Et', 'TMP'], ['Lt2', 'TMP2'], ['Et2', 'TMP2'],
 ['Lb', 'B'], ['Eb', 'B'], ['Lc', 'C'], ['Ec', 'C'], ['Lout', 'OUT'], ['Ek', 'CTRL'], ['HLT', 'CTRL'],
].map(([name, unit]) => Object.freeze({ name, unit })));
const ENABLE = { PC: 'Ep', PCL: 'Epl', PCH: 'Eph', MEM: 'CE', A: 'Ea', TMP: 'Et', TMP2: 'Et2', B: 'Eb', C: 'Ec', ALU: 'Eu', K: 'Ek', IN: 'Ein' };
const LOAD = { MAR: 'Lm', MARL: 'Lml', MARH: 'Lmh', PCL: 'Lpl', PCH: 'Lph', IR: 'Li', MDR: 'Lmd', A: 'La', B: 'Lb', C: 'Lc', TMP: 'Lt',
 TMP2: 'Lt2', OUT: 'Lout' };
const mi = (o) => Object.freeze({ dst: [], ...o, dst: Object.freeze(o.dst ?? []) });
const idle = mi({});
const go = (src, ...dst) => mi({ src, dst });
const inc = mi({ inc: true });
const FETCH = [go('PC', 'MAR'), inc, go('MEM', 'IR')];
const BYTE = [go('PC', 'MAR'), inc];
const ADDR = [go('PC', 'MAR'), inc, go('MEM', 'TMP'), go('PC', 'MAR'), inc];
const ALU_OF = { ADD: 'add', SUB: 'sub', ANA: 'and', ORA: 'or', XRA: 'xor', ANI: 'and', ORI: 'or', XRI: 'xor', INR: 'inc', DCR: 'dec',
 CMA: 'cma', RAL: 'ral', RAR: 'rar' };
const EXECUTE = {};
export const DEFERRED = {};
for (const ins of Object.values(BY_OPCODE)) {
 const { mnemonic: m, regs, opcode } = ins;
 let list;
 let notTaken = null;
 if (m === 'MOV') list = [go(regs[1], regs[0])];
 else if (m === 'NOP') list = [idle];
 else if (m === 'CMA' || m === 'RAL' || m === 'RAR') list = [mi({ src: 'ALU', dst: ['A'], alu: ALU_OF[m] })];
 else if ((m === 'INR' || m === 'DCR') && regs[0] === 'A') list = [mi({ src: 'ALU', dst: ['A'], alu: ALU_OF[m], x: 'A', flags: true })];
 else if (['ADD', 'SUB', 'ANA', 'ORA', 'XRA', 'INR', 'DCR'].includes(m)) {
 list = [go(regs[0], 'TMP')];
 const dst = m === 'INR' || m === 'DCR' ? regs[0] : 'A';
 DEFERRED[opcode] = mi({ inc: true, src: 'ALU', dst: [dst], alu: ALU_OF[m], x: 'TMP', flags: true, pending: true });
 } else if (m === 'HLT') list = [idle, mi({ halt: true })];
 else if (m === 'MVI') list = [...BYTE, go('MEM', regs[0]), idle];
 else if (m === 'ANI' || m === 'ORI' || m === 'XRI') list = [...BYTE, go('MEM', 'TMP'), mi({ src: 'ALU', dst: ['A'], alu: ALU_OF[m], flags: true })];
 else if (m === 'IN') list = [...BYTE, go('MEM', 'TMP'), go('IN', 'A'), idle, idle, idle];
 else if (m === 'OUT') list = [...BYTE, go('MEM', 'TMP'), go('A', 'OUT'), idle, idle, idle];
 else if (m === 'LDA') list = [...ADDR, go('MEM', 'MARH'), go('TMP', 'MARL'), go('MEM', 'A'), idle, idle];
 else if (m === 'STA') list = [...ADDR, go('MEM', 'MARH'), go('TMP', 'MARL'), go('A', 'MDR'), mi({ write: true }), idle];
 else if (m === 'JMP') list = [...ADDR, go('MEM', 'PCH'), go('TMP', 'PCL')];
 else if (m === 'JZ' || m === 'JNZ' || m === 'JM') {
 list = [mi({ ...ADDR[0], test: true }), ...ADDR.slice(1), go('MEM', 'PCH'), go('TMP', 'PCL')];
 notTaken = [mi({ ...ADDR[0], test: true }), inc, inc, idle];
 } else if (m === 'CALL') {
 list = [...ADDR, go('MEM', 'TMP2'), mi({ src: 'K', k: RETURN_ADDRESS, dst: ['MAR'] }), go('PCL', 'MDR'), mi({ write: true }),
 mi({ src: 'K', k: RETURN_ADDRESS + 1, dst: ['MAR'] }), go('PCH', 'MDR'), mi({ write: true }), go('TMP', 'PCL'), go('TMP2', 'PCH'), idle];
 } else if (m === 'RET') {
 list = [mi({ src: 'K', k: RETURN_ADDRESS, dst: ['MAR'] }), go('MEM', 'TMP'), mi({ src: 'K', k: RETURN_ADDRESS + 1, dst: ['MAR'] }),
 go('MEM', 'PCH'), go('TMP', 'PCL'), idle, idle];
 }
 EXECUTE[opcode] = Object.freeze({ taken: Object.freeze(list), notTaken: notTaken && Object.freeze(notTaken) });
}
Object.freeze(DEFERRED);
const takes = (op, s, z) => (BY_OPCODE[op].mnemonic === 'JZ' ? z === 1 : BY_OPCODE[op].mnemonic === 'JNZ' ? z === 0 : s === 1);
export function executeStates(op, s = 0, z = 0) {
 const e = EXECUTE[op];
 if (!e) return null;
 return e.notTaken && !takes(op, s, z) ? e.notTaken : e.taken;
}
export function microinstruction(t, ir, s = 0, z = 0) {
 if (t === 2) return DEFERRED[ir] ?? FETCH[1];
 if (t <= 3) return FETCH[t - 1];
 return executeStates(ir, s, z)?.[t - 4] ?? null;
}
export function signalsOf(m) {
 if (!m) return [];
 const on = new Set(m.dst.map((d) => LOAD[d]));
 if (m.src) on.add(ENABLE[m.src]);
 if (m.src === 'MEM') on.add('Lmd');
 if (m.inc) on.add('Cp');
 if (m.write) on.add('WE');
 if (m.flags) on.add('Lf');
 if (m.halt) on.add('HLT');
 return SIGNALS.filter((x) => on.has(x.name)).map((x) => x.name);
}
export function alu(f, a, tmp, x = 'A') {
 const v = x === 'TMP' ? tmp : a;
 switch (f) {
 case 'add': return (a + tmp) & 0xff;
 case 'sub': return (a - tmp) & 0xff;
 case 'and': return a & tmp;
 case 'or': return a | tmp;
 case 'xor': return a ^ tmp;
 case 'inc': return (v + 1) & 0xff;
 case 'dec': return (v - 1) & 0xff;
 case 'cma': return a ^ 0xff;
 case 'ral': return ((a << 1) | (a >> 7)) & 0xff;
 case 'rar': return (a >> 1) | ((a & 1) << 7);
 default: return 0;
 }
}
const REGS0 = { A: 0, B: 0, C: 0, S: 0, Z: 0, PC: 0, IR: 0, IN1: 0, IN2: 0, OUT3: 0, OUT4: 0, MAR: 0, MDR: 0, TMP: 0, TMP2: 0 };
export class BusModel {
 constructor(program) {
 this.image = program ? memoryImage(program) : new Uint8Array(0x10000);
 this.entry = (program?.entry ?? 0) & 0xffff;
 this.reset();
 }
 reset() {
 this.mem = this.image.slice();
 this.regs = { ...REGS0, PC: this.entry };
 this.t = 1;
 this.cycle = 0;
 this.retired = 0;
 this.halted = false;
 this.error = null;
 this.instrPc = this.entry;
 this.last = null;
 this.output = '';
 this.outBase = 0;
 this.journal = [];
 this.log = [];
 this.writes = [];
 }
 length() {
 const e = executeStates(this.regs.IR, this.regs.S, this.regs.Z);
 return e ? 3 + e.length : 3;
 }
 evaluate() {
 const r = this.regs;
 const m = microinstruction(this.t, r.IR, r.S, r.Z);
 const out = { t: this.t, mi: m, signals: signalsOf(m), bus: null, driver: null, loads: [], write: null, error: null };
 if (!m) { out.error = S.engine.badOpcode(r.IR, this.instrPc); return out; }
 const port = r.TMP;
 let bus = null;
 switch (m.src) {
 case 'PC': bus = r.PC; break;
 case 'PCL': bus = r.PC & 0xff; break;
 case 'PCH': bus = r.PC >> 8; break;
 case 'MEM': bus = this.mem[r.MAR]; break;
 case 'ALU': bus = alu(m.alu, r.A, r.TMP, m.x); break;
 case 'K': bus = m.k; break;
 case 'IN':
 if (!PORTS.IN.includes(port)) { out.error = S.engine.badPort('IN', port, this.instrPc); return out; }
 bus = r[`IN${port}`];
 break;
 case undefined: break;
 default: bus = r[m.src];
 }
 if (m.src) { out.bus = bus; out.driver = m.src === 'PCL' || m.src === 'PCH' ? 'PC' : m.src === 'K' ? 'CTRL' : m.src; }
 const L = out.loads;
 const b8 = (bus ?? 0) & 0xff;
 for (const d of m.dst) {
 if (d === 'MAR') L.push(['MAR', bus & 0xffff]);
 else if (d === 'MARL') L.push(['MAR', (r.MAR & 0xff00) | b8]);
 else if (d === 'MARH') L.push(['MAR', (r.MAR & 0xff) | (b8 << 8)]);
 else if (d === 'PCL') L.push(['PC', (r.PC & 0xff00) | b8]);
 else if (d === 'PCH') L.push(['PC', (r.PC & 0xff) | (b8 << 8)]);
 else if (d === 'OUT') {
 if (!PORTS.OUT.includes(port)) { out.error = S.engine.badPort('OUT', port, this.instrPc); return out; }
 L.push([`OUT${port}`, b8]);
 if (port === 4 && b8 & PORT_BITS.ACKNOWLEDGE && r.IN2 & PORT_BITS.READY) L.push(['IN2', r.IN2 & ~PORT_BITS.READY]);
 } else L.push([d, b8]);
 }
 if (m.src === 'MEM') L.push(['MDR', b8]);
 if (m.inc) L.push(['PC', (r.PC + 1) & 0xffff]);
 if (m.flags) L.push(['S', (bus >> 7) & 1], ['Z', bus === 0 ? 1 : 0]);
 if (m.write) {
 if (r.MAR < ROM_BYTES) { out.error = S.engine.romWrite(r.MAR, this.instrPc); return out; }
 out.write = { address: r.MAR, value: r.MDR };
 }
 return out;
 }
 step() {
 if (this.halted) return this.error ? 'error' : 'halt';
 const e = this.evaluate();
 if (e.error) { this.error = e.error; this.halted = true; return 'error'; }
 this.journal.push({ regs: { ...this.regs }, t: this.t, cycle: this.cycle, retired: this.retired, instrPc: this.instrPc, last: this.last,
 output: this.outBase + this.output.length, mem: e.write ? [e.write.address, this.mem[e.write.address]] : null, writes: this.writes.length });
 if (this.journal.length > 2 * JOURNAL_KEEP) this.journal.splice(0, JOURNAL_KEEP);
 for (const [id, v] of e.loads) this.regs[id] = v;
 if (e.write) { this.mem[e.write.address] = e.write.value; this.writes.push(['m', e.write.address, e.write.value]); }
 for (const [id, v] of e.loads) {
 if (id === 'OUT3' || id === 'OUT4') this.writes.push(['o', Number(id[3]), v]);
 if (id === 'OUT3') {
 this.output += S.engine.out(v);
 if (this.output.length > 2 * OUTPUT_KEEP) { const drop = this.output.length - OUTPUT_KEEP; this.output = this.output.slice(drop); this.outBase += drop; }
 }
 }
 if (this.writes.length > 2 * JOURNAL_KEEP) this.writes.splice(0, this.writes.length - JOURNAL_KEEP);
 this.cycle += 1;
 this.last = e;
 const end = this.t >= 4 && this.t === this.length();
 if (e.mi.halt) { this.halted = true; this.retired += 1; this.arrive(); return 'halt'; }
 if (end) { this.retired += 1; this.t = 1; this.instrPc = this.regs.PC; } else this.t += 1;
 this.arrive();
 return 'step';
 }
 arrive() { for (const x of this.log) if (x.at === this.cycle) this.apply(x); }
 apply({ key, serialIn }) {
 if (key !== undefined) { this.regs.IN1 = key & 0xff; this.regs.IN2 |= PORT_BITS.READY; }
 if (serialIn !== undefined) this.regs.IN2 = serialIn ? this.regs.IN2 | PORT_BITS.SERIAL_IN : this.regs.IN2 & ~PORT_BITS.SERIAL_IN;
 }
 input({ key, serialIn } = {}) {
 const x = { at: this.cycle, ...(key !== undefined ? { key: key & 0xff } : {}), ...(serialIn !== undefined ? { serialIn: serialIn ? 1 : 0 } : {}) };
 this.log.push(x);
 this.apply(x);
 }
 back() {
 if (this.error) { this.error = null; this.halted = false; return true; }
 const j = this.journal.pop();
 if (!j) return false;
 Object.assign(this, { regs: j.regs, t: j.t, cycle: j.cycle, retired: j.retired, instrPc: j.instrPc, last: j.last });
 if (j.mem) this.mem[j.mem[0]] = j.mem[1];
 if (this.writes.length >= j.writes) this.writes.length = j.writes;
 if (j.output >= this.outBase) this.output = this.output.slice(0, j.output - this.outBase);
 else { this.output = ''; this.outBase = j.output; }
 this.log = this.log.filter((x) => x.at <= this.cycle);
 this.halted = false;
 return true;
 }
 stepInstruction() {
 let r = this.step();
 while (r === 'step' && this.t !== 1) r = this.step();
 return r;
 }
 backInstruction() {
 if (!this.back()) return false;
 while (this.t !== 1 && this.back());
 return true;
 }
 pending() {
 return this.t <= 2 && !this.halted ? DEFERRED[this.regs.IR] ?? null : null;
 }
}
