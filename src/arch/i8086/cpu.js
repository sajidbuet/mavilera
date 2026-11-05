// i8086/cpu.js -- the 8086 instruction-level model ([IMPL], accuracy level L1 of the roadmap §5: architectural state
// only, no clocks): `execute(cpu, bus)` runs one instruction, its prefixes included, on a register record and a bus.
// Behaviour follows Intel's 8086 Family User's Manual (9800722-03), chapter 2 (instruction set, Table 2-21 flags) and
// the segment rules of Table 2-2 [INTEL]; where Intel leaves a result undefined the oracle is SingleStepTests/8086 v1
// [TEST] (a CMOS P80C86A-2), whose metadata masks the undefined flags (oracle policy, docs/references/
// INTEL-8086-SOURCE-INDEX.md §8). Forms the test metadata calls alias, undocumented or undefined are not executed: the
// step stops with a message (author's default of roadmap question 3). The simulator's own code (C4). No DOM.
//
// Details that are [TEST]-based and recorded in the oracle policy: the return address of a divide error is the next
// instruction's; a quotient of -128 (byte) or -32768 (word) from IDIV is a divide error on the 8086; PUSH SP pushes
// the decremented SP; a word at offset FFFFH takes its second byte from offset 0000H of the same segment; physical
// addresses wrap at 1 MiB; MOV to or from a segment register uses two bits of the reg field; IN reads FFH from every
// port unless the bus supplies a value; an interrupt reads its vector before the three pushes; a shift or rotate of a
// memory operand by CL = 0 reads it and writes it back unchanged. The order of reads and writes equals the order of the
// [TEST] data bus cycles (test/i8086-microops.test.mjs).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { decode, REG16, SREG, JCC } from './isa.js';

export const FLAG = Object.freeze({ CF: 0x0001, PF: 0x0004, AF: 0x0010, ZF: 0x0040, SF: 0x0080, TF: 0x0100, IF: 0x0200, DF: 0x0400, OF: 0x0800 });
const { CF, PF, AF, ZF, SF, TF, IF, DF, OF } = FLAG;
/** The FLAGS bits that exist; bits 1 and 12 to 15 read as 1 on the 8086, bits 3 and 5 as 0. */
export const FLAGS_USED = 0x0fd5;
export const normFlags = (v) => (v & FLAGS_USED) | 0xf002;
export const CPU_REGS = Object.freeze(['AX', 'BX', 'CX', 'DX', 'SP', 'BP', 'SI', 'DI', 'CS', 'DS', 'ES', 'SS', 'IP', 'FLAGS']);
export const phys = (seg, off) => ((seg << 4) + (off & 0xffff)) & 0xfffff;

const PARITY = new Uint8Array(256);
for (let v = 0; v < 256; v++) { let b = v, n = 0; while (b) { n += b & 1; b >>= 1; } PARITY[v] = n % 2 === 0 ? PF : 0; }
const sx8 = (v) => (v << 24) >> 24;
const sx16 = (v) => (v << 16) >> 16;
const STRING = new Set(['MOVSB', 'MOVSW', 'CMPSB', 'CMPSW', 'STOSB', 'STOSW', 'LODSB', 'LODSW', 'SCASB', 'SCASW']);

/** Whether the condition of jump `m` (a JCC name) holds on `f` (IFUM Table 2-15). */
export function condition(m, f) {
  const s = (f & SF) !== 0, o = (f & OF) !== 0, z = (f & ZF) !== 0, c = (f & CF) !== 0, p = (f & PF) !== 0;
  switch (m) {
    case 'JO': return o; case 'JNO': return !o; case 'JB': return c; case 'JAE': return !c;
    case 'JE': return z; case 'JNE': return !z; case 'JBE': return c || z; case 'JA': return !c && !z;
    case 'JS': return s; case 'JNS': return !s; case 'JP': return p; case 'JNP': return !p;
    case 'JL': return s !== o; case 'JGE': return s === o; case 'JLE': return z || s !== o; case 'JG': return !z && s === o;
    default: return false;
  }
}

/**
 * Run the instruction at CS:IP. `cpu` holds the registers of CPU_REGS (numbers, 16 bits) and is changed in place;
 * `bus` has read(address) and write(address, byte) on the 20-bit memory, and optionally input(port, size) and
 * output(port, value, size). Options: `emptyVector` true stops (error 'noHandler') at an interrupt whose vector is
 * 0000:0000 rather than jumping there. Returns {d (the decoded instruction), length, writes [{address, size, old, value}],
 * reads [{address, size}], call (+1, -1 or 0), halt?, trap? {cause, label}, interrupt? (vector), out? [{port, value,
 * size}]} or {error, d} with nothing changed.
 */
export function execute(c, bus, { emptyVector = false } = {}) {
  const csBase = c.CS << 4;
  const startIP = c.IP;
  const d = decode((k) => bus.read((csBase + ((startIP + k) & 0xffff)) & 0xfffff));
  if (d.error) return { error: 'prefixes', d };
  if (d.status !== 'normal' && d.status !== 'fpu') return { error: d.status, d };
  const e = d.entry;
  const m = e.mnem;
  const next = (startIP + d.length) & 0xffff;
  const writes = [];
  const reads = [];
  const out = [];
  const res = { d, length: d.length, writes, reads, call: 0 };

  // memory, by segment and offset (a word's second byte at offset + 1 of the same segment)
  const rd8 = (seg, off) => { const a = phys(seg, off); reads.push({ address: a, size: 1 }); return bus.read(a); };
  const rd16 = (seg, off) => {
    const a = phys(seg, off); const b = phys(seg, off + 1);
    if (b === a + 1) reads.push({ address: a, size: 2 }); else reads.push({ address: a, size: 1 }, { address: b, size: 1 });
    return bus.read(a) | (bus.read(b) << 8);
  };
  const old = bus.peek ?? bus.read; // the byte a write replaces, without counting a read
  const wr8 = (seg, off, v) => { const a = phys(seg, off); writes.push({ address: a, size: 1, old: old(a), value: v & 0xff }); bus.write(a, v & 0xff); };
  const wr16 = (seg, off, v) => {
    const a = phys(seg, off); const b = phys(seg, off + 1);
    if (b === a + 1) writes.push({ address: a, size: 2, old: old(a) | (old(b) << 8), value: v & 0xffff });
    else writes.push({ address: a, size: 1, old: old(a), value: v & 0xff }, { address: b, size: 1, old: old(b), value: (v >> 8) & 0xff });
    bus.write(a, v & 0xff); bus.write(b, (v >> 8) & 0xff);
  };
  const rd = (seg, off, size) => (size === 8 ? rd8(seg, off) : rd16(seg, off));
  const wr = (seg, off, v, size) => (size === 8 ? wr8(seg, off, v) : wr16(seg, off, v));
  const push = (v) => { c.SP = (c.SP - 2) & 0xffff; wr16(c.SS, c.SP, v); };
  const pop = () => { const v = rd16(c.SS, c.SP); c.SP = (c.SP + 2) & 0xffff; return v; };

  // registers
  const getReg = (size, n) => (size === 16 ? c[REG16[n]] : n < 4 ? c[REG16[n]] & 0xff : c[REG16[n - 4]] >> 8);
  const setReg = (size, n, v) => {
    if (size === 16) c[REG16[n]] = v & 0xffff;
    else if (n < 4) c[REG16[n]] = (c[REG16[n]] & 0xff00) | (v & 0xff);
    else c[REG16[n - 4]] = (c[REG16[n - 4]] & 0x00ff) | ((v & 0xff) << 8);
  };
  // effective address (IFUM Table 2-2: BP-based forms default to SS)
  const ea = (o) => {
    if (o.direct) return o.disp & 0xffff;
    const base = [c.BX + c.SI, c.BX + c.DI, c.BP + c.SI, c.BP + c.DI, c.SI, c.DI, c.BP, c.BX][o.rm];
    return (base + o.disp) & 0xffff;
  };
  const segOf = (o) => (d.seg ? c[d.seg] : !o.direct && (o.rm === 2 || o.rm === 3 || o.rm === 6) ? c.SS : c.DS);
  const get = (o, size = o.size) => {
    switch (o.t) {
      case 'reg': return getReg(o.size, o.n);
      case 'sreg': return c[SREG[o.n]];
      case 'mem': return rd(segOf(o), ea(o), size);
      case 'imm': return o.value;
      case 'const': return o.value;
      default: throw new Error(`operand ${o.t}`);
    }
  };
  const set = (o, v, size = o.size) => {
    if (o.t === 'reg') setReg(o.size, o.n, v);
    else if (o.t === 'sreg') c[SREG[o.n]] = v & 0xffff;
    else if (o.t === 'mem') wr(segOf(o), ea(o), v, size);
    else throw new Error(`write to ${o.t}`);
  };

  // flags
  const flagsOf = (v, size) => (v & (size === 8 ? 0xff : 0xffff) ? 0 : ZF) | (v & (size === 8 ? 0x80 : 0x8000) ? SF : 0) | PARITY[v & 0xff];
  const add = (a, b, cin, size, keepCF = false) => {
    const mask = size === 8 ? 0xff : 0xffff; const sign = size === 8 ? 0x80 : 0x8000;
    const r = a + b + cin; const v = r & mask;
    let f = c.FLAGS & ~(PF | AF | ZF | SF | OF | (keepCF ? 0 : CF));
    if (!keepCF && r > mask) f |= CF;
    if ((a ^ v) & (b ^ v) & sign) f |= OF;
    if ((a ^ b ^ v) & 0x10) f |= AF;
    c.FLAGS = f | flagsOf(v, size);
    return v;
  };
  const sub = (a, b, cin, size, keepCF = false) => {
    const mask = size === 8 ? 0xff : 0xffff; const sign = size === 8 ? 0x80 : 0x8000;
    const r = a - b - cin; const v = r & mask;
    let f = c.FLAGS & ~(PF | AF | ZF | SF | OF | (keepCF ? 0 : CF));
    if (!keepCF && r < 0) f |= CF;
    if ((a ^ b) & (a ^ v) & sign) f |= OF;
    if ((a ^ b ^ v) & 0x10) f |= AF;
    c.FLAGS = f | flagsOf(v, size);
    return v;
  };
  const logic = (v, size) => { c.FLAGS = (c.FLAGS & ~(CF | PF | AF | ZF | SF | OF)) | flagsOf(v, size); return v; };
  const flag = (bit, on) => { c.FLAGS = on ? c.FLAGS | bit : c.FLAGS & ~bit; };
  const cf = () => (c.FLAGS & CF ? 1 : 0);

  // the vector is read before the three pushes: the order of the bus cycles in every [TEST] interrupt (INT, INT 3,
  // INTO, divide error; 8086-B3 study of 2026-11-05), so a push over the vector table does not change the target
  const interrupt = (n, ret) => {
    if (emptyVector && bus.read(4 * n) === 0 && bus.read(4 * n + 1) === 0 && bus.read(4 * n + 2) === 0 && bus.read(4 * n + 3) === 0) return false;
    const ip = rd16(0, 4 * n);
    const cs = rd16(0, 4 * n + 2);
    push(c.FLAGS);
    c.FLAGS &= ~(IF | TF);
    push(c.CS);
    push(ret);
    c.IP = ip;
    c.CS = cs;
    res.interrupt = n;
    res.call = 1;
    return true;
  };
  // a divide error (type 0): nothing of the division is stored; the return address is the next instruction's [TEST]
  const divideError = () => {
    if (!interrupt(0, next)) return fail('noHandler', 0);
    res.trap = { cause: 0, label: 'divide error' };
    return res;
  };
  const snapshot = { ...c };
  // an error after the decode (an interrupt without a handler): undo what was written and changed
  function fail(kind, vector) {
    for (let i = writes.length - 1; i >= 0; i--) {
      const w = writes[i];
      bus.write(w.address, w.old & 0xff);
      if (w.size === 2) bus.write((w.address + 1) & 0xfffff, w.old >> 8);
    }
    Object.assign(c, snapshot);
    return { error: kind, vector, d };
  }

  c.IP = next;
  const ops = d.operands;
  const [o0, o1] = ops;
  const size = o0?.t === 'reg' || o0?.t === 'mem' ? (o0.size === 32 ? 16 : o0.size) : null;

  switch (m) {
    case 'ADD': set(o0, add(get(o0), get(o1), 0, size)); break;
    case 'ADC': set(o0, add(get(o0), get(o1), cf(), size)); break;
    case 'SUB': set(o0, sub(get(o0), get(o1), 0, size)); break;
    case 'SBB': set(o0, sub(get(o0), get(o1), cf(), size)); break;
    case 'CMP': sub(get(o0), get(o1), 0, size); break;
    case 'AND': set(o0, logic(get(o0) & get(o1), size)); break;
    case 'OR': set(o0, logic(get(o0) | get(o1), size)); break;
    case 'XOR': set(o0, logic(get(o0) ^ get(o1), size)); break;
    case 'TEST': logic(get(o0) & get(o1), size); break;
    case 'INC': set(o0, add(get(o0), 1, 0, size, true)); break;
    case 'DEC': set(o0, sub(get(o0), 1, 0, size, true)); break;
    case 'NEG': set(o0, sub(0, get(o0), 0, size)); break;
    case 'NOT': set(o0, ~get(o0)); break;
    case 'MOV': set(o0, get(o1, o0.t === 'sreg' ? 16 : o0.size)); break;
    case 'XCHG': { const a = get(o0); const b = get(o1); set(o0, b); set(o1, a); break; }
    case 'LEA': set(o0, ea(o1)); break;
    case 'LDS': case 'LES': {
      const s = segOf(o1); const off = ea(o1);
      const lo = rd16(s, off); const hi = rd16(s, off + 2);
      set(o0, lo); c[m === 'LDS' ? 'DS' : 'ES'] = hi;
      break;
    }
    case 'PUSH':
      if (o0.t === 'reg' && o0.size === 16 && o0.n === 4) { c.SP = (c.SP - 2) & 0xffff; wr16(c.SS, c.SP, c.SP); } // PUSH SP: the new SP [TEST]
      else push(get(o0, 16));
      break;
    case 'POP': { const v = pop(); set(o0, v, 16); break; }
    case 'PUSHF': push(c.FLAGS); break;
    case 'POPF': c.FLAGS = normFlags(pop()); break;
    case 'LAHF': setReg(8, 4, c.FLAGS & 0xff); break;
    case 'SAHF': c.FLAGS = normFlags((c.FLAGS & 0xff00) | getReg(8, 4)); break;
    case 'CBW': c.AX = sx8(c.AX & 0xff) & 0xffff; break;
    case 'CWD': c.DX = c.AX & 0x8000 ? 0xffff : 0; break;
    case 'CLC': flag(CF, false); break; case 'STC': flag(CF, true); break; case 'CMC': flag(CF, !cf()); break;
    case 'CLD': flag(DF, false); break; case 'STD': flag(DF, true); break;
    case 'CLI': flag(IF, false); break; case 'STI': flag(IF, true); break;
    case 'NOP': case 'WAIT': case 'ESC': break;
    case 'HLT': res.halt = true; break;
    case 'XLAT': setReg(8, 0, rd8(d.seg ? c[d.seg] : c.DS, (c.BX + (c.AX & 0xff)) & 0xffff)); break;

    case 'MUL': case 'IMUL': {
      const v = get(o0);
      let f = c.FLAGS & ~(CF | OF);
      if (size === 8) {
        const r = m === 'MUL' ? (c.AX & 0xff) * v : sx8(c.AX & 0xff) * sx8(v);
        c.AX = r & 0xffff;
        if (m === 'MUL' ? r > 0xff : r !== sx8(r & 0xff)) f |= CF | OF;
        f = (f & ~(SF | ZF | PF)) | flagsOf(c.AX >> 8, 8); // SF, ZF, PF: undefined (masked in the [TEST] comparison)
      } else {
        const r = m === 'MUL' ? c.AX * v : sx16(c.AX) * sx16(v);
        c.AX = r & 0xffff;
        c.DX = m === 'MUL' ? Math.floor(r / 0x10000) & 0xffff : (r >> 16) & 0xffff;
        if (m === 'MUL' ? c.DX !== 0 : r !== sx16(r & 0xffff)) f |= CF | OF;
        f = (f & ~(SF | ZF | PF)) | flagsOf(c.DX, 16);
      }
      c.FLAGS = f;
      break;
    }
    case 'DIV': case 'IDIV': {
      const v = get(o0);
      if (v === 0) return divideError();
      if (size === 8) {
        if (m === 'DIV') {
          const q = Math.floor(c.AX / v);
          if (q > 0xff) return divideError();
          c.AX = ((c.AX % v) << 8) | q;
        } else {
          const a = sx16(c.AX); const b = sx8(v);
          const q = Math.trunc(a / b);
          if (q > 127 || q < -127) return divideError();
          c.AX = (((a - q * b) & 0xff) << 8) | (q & 0xff);
        }
      } else if (m === 'DIV') {
        const n = c.DX * 0x10000 + c.AX;
        const q = Math.floor(n / v);
        if (q > 0xffff) return divideError();
        c.AX = q; c.DX = n % v;
      } else {
        const n = (c.DX << 16) | c.AX; const b = sx16(v);
        const q = Math.trunc(n / b);
        if (q > 32767 || q < -32767) return divideError();
        c.AX = q & 0xffff; c.DX = (n - q * b) & 0xffff;
      }
      break;
    }
    case 'AAM': {
      const base = o0.value;
      // base 0: a divide error, after SF, ZF and PF are set as for a zero result [TEST]
      if (base === 0) { c.FLAGS = (c.FLAGS & ~(SF | ZF | PF)) | ZF | PF; return divideError(); }
      const al = c.AX & 0xff;
      c.AX = (Math.floor(al / base) << 8) | (al % base);
      c.FLAGS = (c.FLAGS & ~(SF | ZF | PF)) | flagsOf(c.AX & 0xff, 8);
      break;
    }
    case 'AAD': {
      const al = ((c.AX & 0xff) + (c.AX >> 8) * o0.value) & 0xff;
      c.AX = al;
      c.FLAGS = (c.FLAGS & ~(SF | ZF | PF)) | flagsOf(al, 8);
      break;
    }
    case 'AAA': case 'AAS': {
      let al = c.AX & 0xff; let ah = c.AX >> 8;
      if ((al & 0x0f) > 9 || c.FLAGS & AF) {
        al = m === 'AAA' ? al + 6 : al - 6; ah = m === 'AAA' ? ah + 1 : ah - 1;
        c.FLAGS |= AF | CF;
      } else c.FLAGS &= ~(AF | CF);
      c.AX = ((ah & 0xff) << 8) | (al & 0x0f);
      break;
    }
    case 'DAA': case 'DAS': {
      // the high digit is adjusted above 99H, or above 9FH when AF was set; CF comes from that adjustment only [TEST]
      const old = c.AX & 0xff; const oldCF = cf(); const oldAF = c.FLAGS & AF;
      let al = old; let f = c.FLAGS & ~(CF | AF);
      if ((old & 0x0f) > 9 || oldAF) { al = m === 'DAA' ? al + 6 : al - 6; f |= AF; }
      if (oldCF || old > (oldAF ? 0x9f : 0x99)) { al = m === 'DAA' ? al + 0x60 : al - 0x60; f |= CF; }
      al &= 0xff;
      c.FLAGS = (f & ~(SF | ZF | PF)) | flagsOf(al, 8);
      c.AX = (c.AX & 0xff00) | al;
      break;
    }

    case 'ROL': case 'ROR': case 'RCL': case 'RCR': case 'SHL': case 'SHR': case 'SAR': {
      const count = o1.t === 'const' ? 1 : getReg(8, 1);
      // a count of 0 changes nothing, but a memory operand is still read and written back unchanged [TEST]
      if (count === 0) { if (o0.t === 'mem') set(o0, get(o0)); break; }
      const mask = size === 8 ? 0xff : 0xffff; const msb = size === 8 ? 0x80 : 0x8000;
      let v = get(o0); let carry = cf();
      for (let i = 0; i < count; i++) {
        switch (m) {
          case 'ROL': carry = v & msb ? 1 : 0; v = ((v << 1) | carry) & mask; break;
          case 'ROR': carry = v & 1; v = (v >> 1) | (carry ? msb : 0); break;
          case 'RCL': { const o = v & msb ? 1 : 0; v = ((v << 1) | carry) & mask; carry = o; break; }
          case 'RCR': { const o = v & 1; v = (v >> 1) | (carry ? msb : 0); carry = o; break; }
          case 'SHL': carry = v & msb ? 1 : 0; v = (v << 1) & mask; break;
          case 'SHR': carry = v & 1; v >>= 1; break;
          default: carry = v & 1; v = (v >> 1) | (v & msb); break; // SAR
        }
      }
      const top = (v & msb ? 1 : 0); const second = (v & (msb >> 1) ? 1 : 0);
      const of = m === 'ROL' || m === 'RCL' || m === 'SHL' ? top ^ carry : m === 'SAR' ? 0 : top ^ second;
      let f = (c.FLAGS & ~(CF | OF)) | (carry ? CF : 0) | (of ? OF : 0);
      if (m === 'SHL' || m === 'SHR' || m === 'SAR') f = (f & ~(SF | ZF | PF | AF)) | flagsOf(v, size);
      c.FLAGS = f;
      set(o0, v);
      break;
    }

    case 'IN': {
      const port = o1.t === 'imm' ? o1.value : c.DX;
      const w = o0.size;
      const v = bus.input ? bus.input(port, w) : w === 8 ? 0xff : 0xffff;
      setReg(w, 0, v);
      res.port = { port, size: w, value: v, dir: 'in' };
      break;
    }
    case 'OUT': {
      const port = o0.t === 'imm' ? o0.value : c.DX;
      const w = o1.size;
      const v = getReg(w, 0);
      out.push({ port, value: v, size: w });
      if (bus.output) bus.output(port, v, w);
      res.out = out;
      break;
    }

    case 'JMP':
      if (o0.t === 'rel') c.IP = (next + o0.value) & 0xffff;
      else if (o0.t === 'far') { c.IP = o0.off; c.CS = o0.seg; }
      else if (o0.size === 32) { const s = segOf(o0); const off = ea(o0); const ip = rd16(s, off); c.CS = rd16(s, off + 2); c.IP = ip; }
      else c.IP = get(o0);
      break;
    case 'CALL':
      if (o0.t === 'rel') { push(next); c.IP = (next + o0.value) & 0xffff; }
      else if (o0.t === 'far') { push(c.CS); push(next); c.IP = o0.off; c.CS = o0.seg; }
      else if (o0.size === 32) {
        const s = segOf(o0); const off = ea(o0); const ip = rd16(s, off); const cs = rd16(s, off + 2);
        push(c.CS); push(next); c.CS = cs; c.IP = ip;
      } else { const t = get(o0); push(next); c.IP = t; }
      res.call = 1;
      break;
    case 'RET': c.IP = pop(); if (o0) c.SP = (c.SP + o0.value) & 0xffff; res.call = -1; break;
    case 'RETF': c.IP = pop(); c.CS = pop(); if (o0) c.SP = (c.SP + o0.value) & 0xffff; res.call = -1; break;
    case 'INT': if (!interrupt(o0.value, next)) return fail('noHandler', o0.value); break;
    case 'INTO': if (c.FLAGS & OF && !interrupt(4, next)) return fail('noHandler', 4); break;
    case 'IRET': c.IP = pop(); c.CS = pop(); c.FLAGS = normFlags(pop()); res.call = -1; break;
    case 'LOOP': c.CX = (c.CX - 1) & 0xffff; if (c.CX !== 0) c.IP = (next + o0.value) & 0xffff; break;
    case 'LOOPE': c.CX = (c.CX - 1) & 0xffff; if (c.CX !== 0 && c.FLAGS & ZF) c.IP = (next + o0.value) & 0xffff; break;
    case 'LOOPNE': c.CX = (c.CX - 1) & 0xffff; if (c.CX !== 0 && !(c.FLAGS & ZF)) c.IP = (next + o0.value) & 0xffff; break;
    case 'JCXZ': if (c.CX === 0) c.IP = (next + o0.value) & 0xffff; break;

    default:
      if (JCC.includes(m)) { if (condition(m, c.FLAGS)) c.IP = (next + o0.value) & 0xffff; break; }
      if (STRING.has(m)) { strings(c, d, m, rd, wr, sub); break; }
      throw new Error(`no semantics for ${m}`);
  }
  return res;
}

/** MOVS, CMPS, SCAS, LODS and STOS, with REP, REPE or REPNE (IFUM pp. 2-40 to 2-43): all iterations in one step. */
function strings(c, d, m, rd, wr, sub) {
  const size = m.endsWith('B') ? 8 : 16;
  const delta = (c.FLAGS & FLAG.DF ? -1 : 1) * (size / 8);
  const src = d.seg ? c[d.seg] : c.DS; // DS:SI may be overridden; ES:DI may not
  const once = () => {
    switch (m.slice(0, 4)) {
      case 'MOVS': wr(c.ES, c.DI, rd(src, c.SI, size), size); c.SI = (c.SI + delta) & 0xffff; c.DI = (c.DI + delta) & 0xffff; break;
      case 'CMPS': { const a = rd(src, c.SI, size); const b = rd(c.ES, c.DI, size); sub(a, b, 0, size); c.SI = (c.SI + delta) & 0xffff; c.DI = (c.DI + delta) & 0xffff; break; }
      case 'SCAS': { const b = rd(c.ES, c.DI, size); sub(size === 8 ? c.AX & 0xff : c.AX, b, 0, size); c.DI = (c.DI + delta) & 0xffff; break; }
      case 'LODS': { const v = rd(src, c.SI, size); if (size === 8) c.AX = (c.AX & 0xff00) | v; else c.AX = v; c.SI = (c.SI + delta) & 0xffff; break; }
      default: wr(c.ES, c.DI, size === 8 ? c.AX & 0xff : c.AX, size); c.DI = (c.DI + delta) & 0xffff; break; // STOS
    }
  };
  if (!d.rep) { once(); return; }
  const compares = m.startsWith('CMPS') || m.startsWith('SCAS');
  while (c.CX !== 0) {
    once();
    c.CX = (c.CX - 1) & 0xffff;
    if (compares && (d.rep === 'REP' ? !(c.FLAGS & FLAG.ZF) : c.FLAGS & FLAG.ZF)) break;
  }
}
