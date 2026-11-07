// i8086/microops.js -- the 8086's teaching model of micro-operations ([EDU], accuracy level L2 of roadmap §5; milestone
// 8086-B3): `runMicro(cpu, bus)` runs one instruction as a list of steps over named places -- the programmer-visible
// registers [INTEL], the queue's head byte Q [INTEL], and the internal registers IND, OPR, tmpA, tmpB, tmpC and the
// ALU result Σ, whose names come from Ken Shirriff's die analysis [RE] -- and returns the steps with the same result
// record as cpu.js. The design (places, step kinds, routines, wording) is docs/architecture/i8086-microops.md, approved
// by the author on 2026-11-05. It is the simulator's own description, written from Intel's documented instruction
// semantics (IFUM chapter 2); it is NOT the 8086's microcode, which was neither used nor consulted, and a step is not a
// clock. Lock-step with cpu.js and the order of the bus requests against the [TEST] cycle records:
// test/i8086-microops.test.mjs and tools/i8086/lockstep.mjs. Only the decoder (isa.js) is shared with cpu.js; the ALU,
// the address arithmetic and the sequencing are this file's own, so that the lock-step compares two implementations.
// In B3 the queue always holds the instruction's bytes and every bus request completes within its step (the BIU and
// its timing are B5). The simulator's own code (C4). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { decode, REG8, REG16, SREG, JCC } from './isa.js';

/** The places and the class of their source: 'intel' (IFUM), 're' (reverse engineering, KS), 'edu' (the simulator). */
export const PLACES = Object.freeze({
  AX: 'intel', BX: 'intel', CX: 'intel', DX: 'intel', SP: 'intel', BP: 'intel', SI: 'intel', DI: 'intel',
  AL: 'intel', BL: 'intel', CL: 'intel', DL: 'intel', AH: 'intel', BH: 'intel', CH: 'intel', DH: 'intel',
  CS: 'intel', DS: 'intel', SS: 'intel', ES: 'intel', IP: 'intel', FLAGS: 'intel', Q: 'intel',
  IND: 're', OPR: 're', tmpA: 're', tmpB: 're', tmpC: 're', 'Σ': 're',
  decode: 'edu', // the instruction decoder: where op-code and ModR/M bytes go, and where constants come from
});
export const TEMPS = Object.freeze(['IND', 'OPR', 'tmpA', 'tmpB', 'tmpC', 'Σ']);
/** The step kinds of the design, §3. */
export const STEP_KINDS = Object.freeze(['queue', 'move', 'alu', 'bus', 'jump', 'hardwired', 'end']);
/** Instructions the 8086 handles without microcode ([RE] KS, HALT article note 1; microcode-engine article). */
export const HARDWIRED = Object.freeze(new Set(['CMC', 'CLC', 'STC', 'CLI', 'STI', 'CLD', 'STD', 'HLT']));

const CF = 0x0001, PF = 0x0004, AF = 0x0010, ZF = 0x0040, SF = 0x0080, TF = 0x0100, IF = 0x0200, DF = 0x0400, OF = 0x0800;
const ARITH = CF | PF | AF | ZF | SF | OF;
const STRING = new Set(['MOVSB', 'MOVSW', 'CMPSB', 'CMPSW', 'STOSB', 'STOSW', 'LODSB', 'LODSW', 'SCASB', 'SCASW']);
const SHIFT = new Set(['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAR']);
const G1_ALU = { ADD: 'add', ADC: 'add with carry', SUB: 'subtract', SBB: 'subtract with borrow', CMP: 'compare', AND: 'and', OR: 'or', XOR: 'exclusive or', TEST: 'test' };
const BASES = [['BX', 'SI'], ['BX', 'DI'], ['BP', 'SI'], ['BP', 'DI'], ['SI'], ['DI'], ['BP'], ['BX']];
const BYTE_REG = Object.fromEntries(REG8.map((n, i) => [n, [REG16[i & 3], i < 4 ? 0 : 8]]));

/**
 * The FLAGS bits an instruction leaves undefined: the masks of the [TEST] metadata (one value per file), which the
 * lock-step and the [TEST] replay compare under (oracle policy, source index §8). `d` is a decoded instruction.
 */
export function undefinedFlags(d) {
  const m = d.entry?.mnem;
  const byCL = d.operands?.[1]?.t === 'reg';
  switch (m) {
    case 'AND': case 'OR': case 'XOR': case 'TEST': return AF;
    case 'SHL': case 'SHR': case 'SAR': return byCL ? OF | AF : AF;
    case 'ROL': case 'ROR': case 'RCL': case 'RCR': return byCL ? OF : 0;
    case 'DAA': case 'DAS': return OF;
    case 'AAA': case 'AAS': return OF | SF | ZF | PF;
    case 'AAM': case 'AAD': return OF | AF | CF;
    case 'MUL': case 'IMUL': return SF | ZF | AF | PF;
    case 'DIV': case 'IDIV': return ARITH;
    default: return 0;
  }
}

const parity = (v) => { let b = v & 0xff, n = 0; while (b) { n += b & 1; b >>= 1; } return n % 2 === 0 ? PF : 0; };
const szp = (v, size) => {
  const mask = size === 8 ? 0xff : 0xffff;
  return ((v & mask) === 0 ? ZF : 0) | (v & (size === 8 ? 0x80 : 0x8000) ? SF : 0) | parity(v);
};

/**
 * The ALU: `op` on a and b (numbers) at `size`, with the FLAGS before; returns {v, f} (f the FLAGS after, unchanged when
 * the operation sets none). The simulator's implementation of the IFUM Table 2-21 flag rules ([TEST] for the details
 * the oracle policy records).
 */
export function alu(op, a, b, size, flags) {
  const mask = size === 8 ? 0xff : 0xffff; const msb = size === 8 ? 0x80 : 0x8000;
  const cin = flags & CF ? 1 : 0;
  const addf = (x, y, c, keepCF) => {
    const r = x + y + c; const v = r & mask;
    let f = flags & ~(PF | AF | ZF | SF | OF | (keepCF ? 0 : CF));
    if (!keepCF && r > mask) f |= CF;
    if ((x ^ v) & (y ^ v) & msb) f |= OF;
    if ((x ^ y ^ v) & 0x10) f |= AF;
    return { v, f: f | szp(v, size) };
  };
  const subf = (x, y, c, keepCF) => {
    const r = x - y - c; const v = r & mask;
    let f = flags & ~(PF | AF | ZF | SF | OF | (keepCF ? 0 : CF));
    if (!keepCF && r < 0) f |= CF;
    if ((x ^ y) & (x ^ v) & msb) f |= OF;
    if ((x ^ y ^ v) & 0x10) f |= AF;
    return { v, f: f | szp(v, size) };
  };
  const logic = (v) => ({ v: v & mask, f: (flags & ~ARITH) | szp(v, size) });
  const shiftf = (v, carry, kind) => {
    const top = v & msb ? 1 : 0; const second = v & (msb >> 1) ? 1 : 0;
    const of = kind === 'left' ? top ^ carry : kind === 'sar' ? 0 : top ^ second;
    let f = (flags & ~(CF | OF)) | (carry ? CF : 0) | (of ? OF : 0);
    return f;
  };
  switch (op) {
    case 'pass': return { v: a & mask, f: flags };
    case 'add': return addf(a, b, 0, false);
    case 'add with carry': return addf(a, b, cin, false);
    case 'subtract': case 'compare': return subf(a, b, 0, false);
    case 'subtract with borrow': return subf(a, b, cin, false);
    case 'and': case 'test': return logic(a & b);
    case 'or': return logic(a | b);
    case 'exclusive or': return logic(a ^ b);
    case 'increment': return addf(a, 1, 0, true);
    case 'decrement': return subf(a, 1, 0, true);
    case 'negate': return subf(0, a, 0, false);
    case 'not': return { v: ~a & mask, f: flags };
    case 'ROL': { const c = a & msb ? 1 : 0; const v = ((a << 1) | c) & mask; return { v, f: shiftf(v, c, 'left') }; }
    case 'ROR': { const c = a & 1; const v = (a >> 1) | (c ? msb : 0); return { v, f: shiftf(v, c, 'right') }; }
    case 'RCL': { const c = a & msb ? 1 : 0; const v = ((a << 1) | cin) & mask; return { v, f: shiftf(v, c, 'left') }; }
    case 'RCR': { const c = a & 1; const v = (a >> 1) | (cin ? msb : 0); return { v, f: shiftf(v, c, 'right') }; }
    case 'SHL': case 'SHR': case 'SAR': {
      const c = op === 'SHL' ? (a & msb ? 1 : 0) : a & 1;
      const v = op === 'SHL' ? (a << 1) & mask : op === 'SHR' ? a >> 1 : (a >> 1) | (a & msb);
      return { v, f: (shiftf(v, c, op === 'SHL' ? 'left' : op === 'SAR' ? 'sar' : 'right') & ~(SF | ZF | PF | AF)) | szp(v, size) };
    }
    case 'decimal adjust (add)': case 'decimal adjust (subtract)': {
      const plus = op.endsWith('(add)');
      const oldAF = flags & AF; let v = a; let f = flags & ~(CF | AF);
      if ((a & 0x0f) > 9 || oldAF) { v = plus ? v + 6 : v - 6; f |= AF; }
      if (cin || a > (oldAF ? 0x9f : 0x99)) { v = plus ? v + 0x60 : v - 0x60; f |= CF; }
      v &= 0xff;
      return { v, f: (f & ~(SF | ZF | PF)) | szp(v, 8) };
    }
    case 'ASCII adjust (add)': case 'ASCII adjust (subtract)': { // a = AX
      const plus = op.endsWith('(add)');
      let al = a & 0xff; let ah = a >> 8; let f = flags;
      if ((al & 0x0f) > 9 || flags & AF) { al = plus ? al + 6 : al - 6; ah = plus ? ah + 1 : ah - 1; f |= AF | CF; } else f &= ~(AF | CF);
      return { v: ((ah & 0xff) << 8) | (al & 0x0f), f };
    }
    case 'ASCII adjust (multiply)': { // a = AL, b = the base (not 0)
      const v = (Math.floor(a / b) << 8) | (a % b);
      return { v, f: (flags & ~(SF | ZF | PF)) | szp(v & 0xff, 8) };
    }
    case 'ASCII adjust (zero base)': return { v: a, f: (flags & ~(SF | ZF | PF)) | ZF | PF }; // AAM 0 [TEST]
    case 'ASCII adjust (divide)': { // a = AX, b = the base
      const v = ((a & 0xff) + (a >> 8) * b) & 0xff;
      return { v, f: (flags & ~(SF | ZF | PF)) | szp(v, 8) };
    }
    case 'sign-extend': return { v: size === 8 ? (a & 0x80 ? 0xff00 | a : a & 0xff) : (a & 0x8000 ? 0xffff : 0), f: flags };
    case 'times 4': return { v: (a << 2) & 0xffff, f: flags };
    default: throw new Error(`ALU operation ${op}`);
  }
}

const phys = (seg, off) => ((seg << 4) + (off & 0xffff)) & 0xfffff; // the BIU's address adder ([INTEL] Fig 2-18)
const hex = (v, n) => `${v.toString(16).toUpperCase().padStart(n, '0')}H`;

/**
 * Run the instruction at CS:IP as steps. `cpu` (registers of cpu.js's CPU_REGS) is changed in place; `bus` as for
 * cpu.js execute(). Options: `emptyVector` (as cpu.js), `temps` (an object holding IND, OPR, tmpA, tmpB, tmpC and Σ
 * across instructions; a fresh one by default); `repStop` as cpu.js (8086-B8: a REP string instruction stopped between
 * repetitions for an interrupt; IP then points at the prefix before the op code); `entry` {kind: 'nmi'|'intr'|'trap',
 * type} (8086-B8): an interrupt entry instead of an instruction, with an INTA bus request ([EDU]: one request, the two
 * INTA cycles of IFUM p. 2-24) that returns the type for INTR. Returns cpu.js's result record (d, length, reads,
 * writes, call, halt?, interrupt?, trap?, port?, out?, repInterrupted?) plus `steps` and `requests` (the bus requests
 * in order), or {error, d, steps}. An entry's record has d = null and `entry`.
 */
export function runMicro(c, bus, { emptyVector = false, temps = null, repStop = null, entry = null } = {}) {
  const startIP = c.IP; const csBase = c.CS << 4;
  const d = entry ? null : decode((k) => bus.read((csBase + ((startIP + k) & 0xffff)) & 0xfffff));
  if (d?.error) return { error: 'prefixes', d, steps: [] };
  if (d && d.status !== 'normal' && d.status !== 'fpu') return { error: d.status, d, steps: [] };
  const t = temps ?? { IND: 0, OPR: 0, tmpA: 0, tmpB: 0, tmpC: 0, 'Σ': 0 };
  const snapshot = { ...c }; const tempsBefore = { ...t };
  const m = d?.entry.mnem ?? null;
  const ops = d?.operands ?? []; const [o0, o1] = ops;
  const steps = []; const reads = []; const writes = []; const requests = []; const out = [];
  const res = { d, length: d?.length ?? 0, steps, requests, reads, writes, call: 0, ...(entry ? { entry: { ...entry } } : {}) };
  let qi = 0;
  let iteration = null;

  // --- places
  const get = (p) => {
    if (typeof p === 'number') return p; // a constant from the decoder
    const b = BYTE_REG[p];
    if (b) return (c[b[0]] >> b[1]) & 0xff;
    if (p in t) return t[p];
    if (p in c) return c[p];
    throw new Error(`place ${p}`);
  };
  const put = (p, v, part = null) => {
    const b = BYTE_REG[p];
    if (b) { c[b[0]] = (c[b[0]] & ~(0xff << b[1])) | ((v & 0xff) << b[1]); return; }
    const cur = get(p);
    let nv = part === 'lo' ? (cur & 0xff00) | (v & 0xff) : part === 'hi' ? (cur & 0x00ff) | ((v & 0xff) << 8) : part === 'sx' ? ((v & 0x80 ? 0xff00 : 0) | (v & 0xff)) : v & 0xffff;
    if (p === 'FLAGS') nv = (nv & 0x0fd5) | 0xf002; // bits 1 and 12-15 read as 1, 3 and 5 as 0
    if (p in t) t[p] = nv; else c[p] = nv;
  };
  const step = (kind, o = {}) => { const s = { kind, ...o }; if (iteration) s.iteration = { ...iteration }; steps.push(s); return s; };

  // --- step kinds
  /** queue: the next instruction byte into a place (part lo, hi, sx = sign-extended, or whole); IP counts it. */
  const queue = (to, part = null, note = undefined) => {
    const v = d.bytes[qi++];
    c.IP = (c.IP + 1) & 0xffff;
    if (to !== 'decode') put(to, v, part);
    return step('queue', { transfers: [{ from: 'Q', to, part, value: v }], ...(note ? { note } : {}) });
  };
  const queueWord = (to) => { queue(to, 'lo'); queue(to, 'hi'); };
  /**
   * move: simultaneous transfers [from, to, part?] (all values read before any is written); `part` names the half of
   * a 16-bit destination; an 8-bit destination takes the low byte. `from` may be a constant from the decoder (a number).
   */
  const move = (pairs, note) => {
    const vals = pairs.map(([from]) => get(from));
    const transfers = pairs.map(([from, to, part], i) => ({ from, to, ...(part ? { part } : {}), value: vals[i] }));
    pairs.forEach(([, to, part], i) => put(to, vals[i], part ?? null));
    return step('move', { transfers, ...(note ? { note } : {}) });
  };
  /** alu: Σ = op(a, b); flags true writes FLAGS; Σ then goes to `to` (a place or a list). */
  const aluStep = (op, a, b, size, { flags = false, to = [], note } = {}) => {
    const r = alu(op, get(a), b === null ? 0 : get(b), size, c.FLAGS);
    t['Σ'] = r.v;
    const dest = Array.isArray(to) ? to : [to];
    for (const p of dest) put(p, r.v);
    if (flags) put('FLAGS', r.f);
    return step('alu', { alu: { op, a, b, size, flags, value: r.v, ...(flags ? { FLAGS: c.FLAGS } : {}) }, transfers: dest.map((p) => ({ from: 'Σ', to: p, value: r.v })), ...(note ? { note } : {}) });
  };
  /** bus: a request to the BIU; the offset from a place, the segment a register name or an absolute value. */
  const request = (op, segment, offset, size) => {
    const r = { op, segment, offset, size };
    if (op === 'inta') { // the interrupt controller puts the type on the bus in the second INTA cycle (IFUM p. 2-24)
      t.OPR = entry.type & 0xff; r.value = t.OPR;
      requests.push(r);
      return step('bus', { bus: { ...r } });
    }
    const off = get(offset) & 0xffff;
    const mask = size === 8 ? 0xff : 0xffff;
    if (op === 'in' || op === 'out') {
      r.port = off;
      if (op === 'in') {
        const v = bus.input ? bus.input(off, size) & mask : mask;
        t.OPR = v; r.value = v;
        res.port = { port: off, size, value: v, dir: 'in' };
      } else {
        const v = t.OPR & mask; r.value = v;
        out.push({ port: off, value: v, size }); res.out = out;
        if (bus.output) bus.output(off, v, size);
      }
    } else {
      const seg = typeof segment === 'number' ? segment : c[segment];
      const a = phys(seg, off); const b2 = phys(seg, off + 1);
      r.address = a;
      if (size === 16) r.address2 = b2; // the second byte: offset + 1 in the same segment
      if (op === 'read') {
        let v;
        if (size === 8) { reads.push({ address: a, size: 1 }); v = bus.read(a); } else {
          if (b2 === a + 1) reads.push({ address: a, size: 2 }); else reads.push({ address: a, size: 1 }, { address: b2, size: 1 });
          v = bus.read(a) | (bus.read(b2) << 8);
        }
        t.OPR = v; r.value = v;
      } else {
        const old = bus.peek ?? bus.read;
        const v = t.OPR & mask; r.value = v;
        if (size === 8) { writes.push({ address: a, size: 1, old: old(a), value: v }); bus.write(a, v); } else {
          if (b2 === a + 1) writes.push({ address: a, size: 2, old: old(a) | (old(b2) << 8), value: v });
          else writes.push({ address: a, size: 1, old: old(a), value: v & 0xff }, { address: b2, size: 1, old: old(b2), value: v >> 8 });
          bus.write(a, v & 0xff); bus.write(b2, v >> 8);
        }
      }
    }
    requests.push(r);
    return step('bus', { bus: { ...r, segment: typeof segment === 'number' ? hex(segment, 4) : segment } });
  };
  const jump = (pairs, note) => {
    const s = move(pairs, note);
    s.kind = 'jump'; s.flush = true;
    return s;
  };

  // --- shared routines
  const regName = (o) => (o.t === 'sreg' ? SREG[o.n] : o.size === 8 ? REG8[o.n] : REG16[o.n]);
  let eaSeg = null;
  /** The effective-address routine (design §5): leaves the offset in IND and the segment in eaSeg. */
  const ea = (o) => {
    if (o.direct) { queueWord('IND'); eaSeg = d.seg ?? 'DS'; return; }
    if (o.dispSize === 1) queue('tmpC', 'sx'); else if (o.dispSize === 2) queueWord('tmpC');
    const regs = BASES[o.rm];
    eaSeg = d.seg ?? (regs[0] === 'BP' ? 'SS' : 'DS');
    if (regs.length === 2) {
      move([[regs[0], 'tmpA'], [regs[1], 'tmpB']]);
      aluStep('add', 'tmpA', 'tmpB', 16, { to: o.dispSize ? 'tmpA' : 'IND' });
      if (o.dispSize) aluStep('add', 'tmpA', 'tmpC', 16, { to: 'IND' });
    } else if (o.dispSize) {
      move([[regs[0], 'tmpA']]);
      aluStep('add', 'tmpA', 'tmpC', 16, { to: 'IND' });
    } else move([[regs[0], 'IND']]);
  };
  const sizeOf = (o) => (o.t === 'sreg' ? 16 : o.size === 32 ? 16 : o.size);
  /** An operand into a temporary: a register or OPR as a pending transfer, an immediate straight from the queue. */
  const fetchOperand = (o, tmp, pending) => {
    if (o.t === 'reg' || o.t === 'sreg') pending.push([regName(o), tmp]);
    else if (o.t === 'mem') { request('read', eaSeg, 'IND', sizeOf(o)); pending.push(['OPR', tmp]); } else if (o.t === 'imm') {
      if (o.short) queue(tmp, 'sx'); else if (o.size === 8) queue(tmp, null); else queueWord(tmp);
    } else if (o.t === 'const') pending.push([o.value, tmp]);
  };
  const flushPending = (pending) => { if (pending.length) move(pending); pending.length = 0; };
  /** Write a value (in a place) to an operand: a register by a transfer, memory by OPR and a write request. */
  const storeTo = (o, from) => {
    if (o.t === 'mem') { if (from !== 'OPR') move([[from, 'OPR']]); request('write', eaSeg, 'IND', sizeOf(o)); } else move([[from, regName(o)]]);
  };
  const push = (from) => {
    aluStep('subtract', 'SP', 2, 16, { to: 'SP' });
    if (from !== 'OPR') move([[from, 'OPR']]);
    request('write', 'SS', 'SP', 16);
  };
  const pop = () => { request('read', 'SS', 'SP', 16); aluStep('add', 'SP', 2, 16, { to: 'SP' }); };
  const relTarget = (o) => { // the displacement into tmpB, then IP + tmpB into tmpB
    if (o.size === 8) queue('tmpB', 'sx'); else queueWord('tmpB');
  };
  const takeRel = () => { aluStep('add', 'IP', 'tmpB', 16, { to: 'tmpB' }); jump([['tmpB', 'IP']]); };
  const condition = (holds, note) => step('alu', { alu: { op: 'condition', a: 'FLAGS', b: null, size: 16, flags: false, value: holds ? 1 : 0 }, transfers: [], note });

  // an error after the decode (an interrupt without a handler): undo what was written and changed
  const fail = (kind, vector) => {
    for (let i = writes.length - 1; i >= 0; i--) {
      const w = writes[i];
      bus.write(w.address, w.old & 0xff);
      if (w.size === 2) bus.write((w.address + 1) & 0xfffff, w.old >> 8);
    }
    Object.assign(c, snapshot); Object.assign(t, tempsBefore);
    return { error: kind, vector, d, steps };
  };
  /** Interrupt entry (design §5): the vector is read before the three pushes ([TEST] order of the bus cycles). */
  const interrupt = (n, vectorFrom, note = 'the vector number from the decoder') => {
    if (emptyVector && [0, 1, 2, 3].every((k) => bus.read(4 * n + k) === 0)) return false;
    if (vectorFrom !== 'tmpC') move([[n, 'tmpC']], note);
    aluStep('times 4', 'tmpC', null, 16, { to: 'IND' });
    request('read', 0, 'IND', 16);
    move([['OPR', 'tmpB']]);
    aluStep('add', 'IND', 2, 16, { to: 'IND' });
    request('read', 0, 'IND', 16);
    move([['OPR', 'tmpA']]);
    push('FLAGS');
    put('FLAGS', c.FLAGS & ~(IF | TF));
    step('alu', { alu: { op: 'clear IF and TF', a: 'FLAGS', b: null, size: 16, flags: true, value: c.FLAGS, FLAGS: c.FLAGS }, transfers: [] });
    push('CS');
    push('IP');
    jump([['tmpB', 'IP'], ['tmpA', 'CS']]);
    res.interrupt = n; res.call = 1;
    return true;
  };
  const divideError = () => {
    if (!interrupt(0, null)) return fail('noHandler', 0);
    res.trap = { cause: 0, label: 'divide error' };
    step('end');
    return res;
  };

  // --- an interrupt entry (8086-B8): INTR fetches its type with the INTA request; NMI and single-step have theirs fixed
  if (entry) {
    if (entry.kind === 'intr') {
      request('inta', null, null, 8);
      move([['OPR', 'tmpC']], 'the type byte from the second INTA cycle');
    }
    const ok = interrupt(entry.type, entry.kind === 'intr' ? 'tmpC' : null,
      entry.kind === 'nmi' ? 'type 2: NMI (fixed)' : 'type 1: single-step (fixed)');
    if (!ok) return { ...fail('noHandler', entry.type), entry: { ...entry } };
    res.trap = { cause: entry.type, label: entry.kind };
    step('end');
    return res;
  }

  // --- prefixes, op code, ModR/M
  for (const p of d.prefixes) {
    const s = queue('decode', null, `prefix ${hex(p, 2)}: handled by logic outside the microcode`);
    s.kind = 'hardwired';
  }
  queue('decode', null, 'op code');
  if (d.modrm !== null) queue('decode', null, 'ModR/M byte');
  const memOp = ops.find((o) => o.t === 'mem' && !o.moffs);
  if (memOp) ea(memOp);
  const moffs = ops.find((o) => o.moffs);
  if (moffs) ea(moffs);
  const size = o0 && (o0.t === 'reg' || o0.t === 'mem') ? sizeOf(o0) : null;

  if (HARDWIRED.has(m)) {
    const s = step('hardwired', { note: 'handled by logic outside the microcode (reverse engineering)' });
    const f = c.FLAGS;
    switch (m) {
      case 'CLC': put('FLAGS', f & ~CF); break; case 'STC': put('FLAGS', f | CF); break; case 'CMC': put('FLAGS', f ^ CF); break;
      case 'CLD': put('FLAGS', f & ~DF); break; case 'STD': put('FLAGS', f | DF); break;
      case 'CLI': put('FLAGS', f & ~IF); break; case 'STI': put('FLAGS', f | IF); break;
      default: res.halt = true; // HLT
    }
    if (m !== 'HLT') s.FLAGS = c.FLAGS;
    step('end');
    return res;
  }

  const pending = [];
  switch (m) {
    case 'ADD': case 'ADC': case 'SUB': case 'SBB': case 'CMP': case 'AND': case 'OR': case 'XOR': case 'TEST': {
      fetchOperand(o0, 'tmpA', pending);
      fetchOperand(o1, 'tmpB', pending);
      flushPending(pending);
      const write = m !== 'CMP' && m !== 'TEST';
      if (write && o0.t === 'mem') { aluStep(G1_ALU[m], 'tmpA', 'tmpB', size, { flags: true, to: 'OPR' }); request('write', eaSeg, 'IND', size); } else aluStep(G1_ALU[m], 'tmpA', 'tmpB', size, { flags: true, to: write ? regName(o0) : [] });
      break;
    }
    case 'INC': case 'DEC': case 'NEG': case 'NOT': {
      fetchOperand(o0, 'tmpA', pending); flushPending(pending);
      const op = { INC: 'increment', DEC: 'decrement', NEG: 'negate', NOT: 'not' }[m];
      if (o0.t === 'mem') { aluStep(op, 'tmpA', null, size, { flags: m !== 'NOT', to: 'OPR' }); request('write', eaSeg, 'IND', size); } else aluStep(op, 'tmpA', null, size, { flags: m !== 'NOT', to: regName(o0) });
      break;
    }
    case 'MOV': {
      if (o1.t === 'imm') {
        if (o0.t === 'mem') { if (o1.size === 8) queue('OPR'); else queueWord('OPR'); request('write', eaSeg, 'IND', size); } else if (o1.size === 8) queue(regName(o0)); else queueWord(regName(o0));
      } else if (o1.t === 'mem') { request('read', eaSeg, 'IND', sizeOf(o0)); move([['OPR', regName(o0)]]); } else storeTo(o0, regName(o1));
      break;
    }
    case 'XCHG':
      if (o0.t === 'mem' || o1.t === 'mem') {
        const [mo, ro] = o0.t === 'mem' ? [o0, o1] : [o1, o0];
        request('read', eaSeg, 'IND', sizeOf(mo));
        move([[regName(ro), 'OPR'], ['OPR', regName(ro)]]);
        request('write', eaSeg, 'IND', sizeOf(mo));
      } else if (regName(o0) === regName(o1)) move([[regName(o0), regName(o0)]], 'a register exchanged with itself');
      else move([[regName(o0), regName(o1)], [regName(o1), regName(o0)]]);
      break;
    case 'NOP': case 'WAIT': case 'ESC': break;
    case 'LEA': move([['IND', regName(o0)]]); break;
    case 'LDS': case 'LES':
      request('read', eaSeg, 'IND', 16); move([['OPR', regName(o0)]]);
      aluStep('add', 'IND', 2, 16, { to: 'IND' });
      request('read', eaSeg, 'IND', 16); move([['OPR', m === 'LDS' ? 'DS' : 'ES']]);
      break;
    case 'PUSH':
      if (o0.t === 'mem') { request('read', eaSeg, 'IND', 16); push('OPR'); } else push(regName(o0));
      break;
    case 'POP':
      pop();
      if (o0.t === 'mem') request('write', eaSeg, 'IND', 16); else move([['OPR', regName(o0)]]);
      break;
    case 'PUSHF': push('FLAGS'); break;
    case 'POPF': pop(); move([['OPR', 'FLAGS']]); break;
    case 'LAHF': move([['FLAGS', 'AH']]); break;
    case 'SAHF': move([['AH', 'FLAGS', 'lo']]); break;
    case 'CBW': aluStep('sign-extend', 'AL', null, 8, { to: 'AX' }); break;
    case 'CWD': aluStep('sign-extend', 'AX', null, 16, { to: 'DX' }); break;
    case 'XLAT':
      move([['BX', 'tmpA'], ['AL', 'tmpB']]);
      aluStep('add', 'tmpA', 'tmpB', 16, { to: 'IND' });
      request('read', d.seg ?? 'DS', 'IND', 8);
      move([['OPR', 'AL']]);
      break;
    case 'DAA': case 'DAS': aluStep(m === 'DAA' ? 'decimal adjust (add)' : 'decimal adjust (subtract)', 'AL', null, 8, { flags: true, to: 'AL' }); break;
    case 'AAA': case 'AAS': aluStep(m === 'AAA' ? 'ASCII adjust (add)' : 'ASCII adjust (subtract)', 'AX', null, 16, { flags: true, to: 'AX' }); break;
    case 'AAM':
      queue('tmpB');
      if (t.tmpB === 0) { aluStep('ASCII adjust (zero base)', 'AL', null, 8, { flags: true, note: 'a base of 0 divides by zero' }); return divideError(); }
      aluStep('ASCII adjust (multiply)', 'AL', 'tmpB', 8, { flags: true, to: 'AX' });
      break;
    case 'AAD': queue('tmpB'); aluStep('ASCII adjust (divide)', 'AX', 'tmpB', 16, { flags: true, to: 'AX' }); break;

    case 'MUL': case 'IMUL': case 'DIV': case 'IDIV': {
      const r = multiplyDivide(m, o0, size);
      if (r === 'divide error') return divideError();
      break;
    }

    case 'ROL': case 'ROR': case 'RCL': case 'RCR': case 'SHL': case 'SHR': case 'SAR': {
      fetchOperand(o0, 'tmpA', pending);
      if (o1.t === 'reg') pending.push(['CL', 'tmpC']);
      flushPending(pending);
      if (o1.t === 'const') aluStep(m, 'tmpA', null, size, { flags: true, to: 'tmpA', note: `${m}: one place` });
      else {
        const n = t.tmpC & 0xff;
        for (let i = 1; i <= n; i++) {
          iteration = { n: i, of: n };
          aluStep(m, 'tmpA', null, size, { flags: true, to: 'tmpA', note: `${m}: one place; tmpC counts down` });
          t.tmpC = (t.tmpC - 1) & 0xffff;
          steps[steps.length - 1].count = { place: 'tmpC', value: t.tmpC };
        }
        iteration = null;
      }
      storeTo(o0, 'tmpA');
      break;
    }

    case 'IN':
      if (o1.t === 'imm') { queue('tmpC'); request('in', null, 'tmpC', o0.size); } else request('in', null, 'DX', o0.size);
      move([['OPR', regName(o0)]]);
      break;
    case 'OUT':
      if (o0.t === 'imm') queue('tmpC');
      move([[regName(o1), 'OPR']]);
      request('out', null, o0.t === 'imm' ? 'tmpC' : 'DX', o1.size);
      break;

    case 'JMP':
      if (o0.t === 'rel') { relTarget(o0); takeRel(); } else if (o0.t === 'far') { queueWord('tmpB'); queueWord('tmpA'); jump([['tmpB', 'IP'], ['tmpA', 'CS']]); } else if (o0.size === 32) {
        request('read', eaSeg, 'IND', 16); move([['OPR', 'tmpB']]);
        aluStep('add', 'IND', 2, 16, { to: 'IND' });
        request('read', eaSeg, 'IND', 16);
        jump([['tmpB', 'IP'], ['OPR', 'CS']]);
      } else if (o0.t === 'mem') { request('read', eaSeg, 'IND', 16); jump([['OPR', 'IP']]); } else jump([[regName(o0), 'IP']]);
      break;
    case 'CALL':
      if (o0.t === 'rel') { relTarget(o0); aluStep('add', 'IP', 'tmpB', 16, { to: 'tmpB' }); push('IP'); jump([['tmpB', 'IP']]); } else if (o0.t === 'far') {
        queueWord('tmpB'); queueWord('tmpA');
        push('CS'); push('IP');
        jump([['tmpB', 'IP'], ['tmpA', 'CS']]);
      } else if (o0.size === 32) {
        request('read', eaSeg, 'IND', 16); move([['OPR', 'tmpB']]);
        aluStep('add', 'IND', 2, 16, { to: 'IND' });
        request('read', eaSeg, 'IND', 16); move([['OPR', 'tmpA']]);
        push('CS'); push('IP');
        jump([['tmpB', 'IP'], ['tmpA', 'CS']]);
      } else {
        if (o0.t === 'mem') { request('read', eaSeg, 'IND', 16); move([['OPR', 'tmpB']]); } else move([[regName(o0), 'tmpB']]);
        push('IP');
        jump([['tmpB', 'IP']]);
      }
      res.call = 1;
      break;
    case 'RET': case 'RETF': {
      if (o0) queueWord('tmpC');
      pop(); move([['OPR', 'tmpB']]);
      if (m === 'RETF') { pop(); move([['OPR', 'tmpA']]); }
      if (o0) aluStep('add', 'SP', 'tmpC', 16, { to: 'SP' });
      jump(m === 'RETF' ? [['tmpB', 'IP'], ['tmpA', 'CS']] : [['tmpB', 'IP']]);
      res.call = -1;
      break;
    }
    case 'IRET':
      pop(); move([['OPR', 'tmpB']]);
      pop(); move([['OPR', 'tmpA']]);
      pop(); move([['OPR', 'FLAGS']]);
      jump([['tmpB', 'IP'], ['tmpA', 'CS']]);
      res.call = -1;
      break;
    case 'INT':
      if (o0.t === 'imm') queue('tmpC'); // INT n; INT 3 takes its vector from the decoder
      if (!interrupt(o0.value, o0.t === 'imm' ? 'tmpC' : null)) return fail('noHandler', o0.value);
      break;
    case 'INTO':
      condition((c.FLAGS & OF) !== 0, 'OF set?');
      if (c.FLAGS & OF && !interrupt(4, null)) return fail('noHandler', 4);
      break;
    case 'LOOP': case 'LOOPE': case 'LOOPNE': case 'JCXZ': {
      relTarget(o0);
      if (m !== 'JCXZ') aluStep('decrement', 'CX', null, 16, { to: 'CX', note: 'CX − 1; FLAGS unchanged' });
      const z = (c.FLAGS & ZF) !== 0;
      const take = m === 'JCXZ' ? c.CX === 0 : c.CX !== 0 && (m === 'LOOP' || (m === 'LOOPE' ? z : !z));
      condition(take, m === 'JCXZ' ? 'CX = 0?' : m === 'LOOP' ? 'CX ≠ 0?' : `CX ≠ 0 and ZF ${m === 'LOOPE' ? 'set' : 'clear'}?`);
      if (take) takeRel();
      break;
    }

    default:
      if (JCC.includes(m)) {
        relTarget(o0);
        const take = jccHolds(m, c.FLAGS);
        condition(take, `${m}: condition on FLAGS`);
        if (take) takeRel();
        break;
      }
      if (STRING.has(m)) { strings(); break; }
      throw new Error(`no step list for ${m}`);
  }
  step('end');
  return res;

  // --- multiply and divide as loops (design §5; the simulator's own loops, not the 8086's iteration count or order)
  function multiplyDivide(mn, o, n) {
    const lo = n === 8 ? 'AL' : 'AX'; const hi = n === 8 ? 'AH' : 'DX';
    const mask = n === 8 ? 0xff : 0xffff; const top = n === 8 ? 0x80 : 0x8000;
    const signed = mn === 'IMUL' || mn === 'IDIV';
    const p = [];
    fetchOperand(o, 'tmpB', p);
    const negate = (place, note) => aluStep('negate', place, null, n, { to: place, note });
    if (mn === 'MUL' || mn === 'IMUL') {
      p.push([lo, 'tmpC'], [0, 'tmpA']);
      move(p);
      const negA = signed && (t.tmpC & top) !== 0; const negB = signed && (t.tmpB & top) !== 0;
      if (negA) negate('tmpC', 'magnitude of the multiplier');
      if (negB) negate('tmpB', 'magnitude of the multiplicand');
      for (let i = 1; i <= n; i++) {
        iteration = { n: i, of: n };
        const sum = t.tmpC & 1 ? t.tmpA + t.tmpB : t.tmpA;
        t.tmpC = ((t.tmpC >> 1) | ((sum & 1) << (n - 1))) & mask;
        t.tmpA = (sum >> 1) & mask;
        t['Σ'] = t.tmpA;
        step('alu', { alu: { op: 'multiply step', a: 'tmpA', b: 'tmpB', size: n, flags: false, value: t.tmpA }, transfers: [{ from: 'Σ', to: 'tmpA', value: t.tmpA }, { from: 'Σ', to: 'tmpC', value: t.tmpC }], note: 'if the low bit of tmpC is 1, add tmpB to tmpA; shift tmpA:tmpC right one place' });
      }
      iteration = null;
      if (negA !== negB) {
        const borrow = t.tmpC !== 0 ? 1 : 0;
        negate('tmpC', 'the product is negative: low half');
        t.tmpA = (~t.tmpA + 1 - borrow) & mask;
        t['Σ'] = t.tmpA;
        step('alu', { alu: { op: 'negate with borrow', a: 'tmpA', b: null, size: n, flags: false, value: t.tmpA }, transfers: [{ from: 'Σ', to: 'tmpA', value: t.tmpA }], note: 'the product is negative: high half' });
      }
      const highIsExtension = signed ? t.tmpA === ((t.tmpC & top) ? mask : 0) : t.tmpA === 0;
      const f = (c.FLAGS & ~(CF | OF)) | (highIsExtension ? 0 : CF | OF);
      move([['tmpA', hi], ['tmpC', lo]]);
      put('FLAGS', f);
      step('alu', { alu: { op: 'product flags', a: hi, b: null, size: n, flags: true, value: highIsExtension ? 0 : 1, FLAGS: c.FLAGS }, transfers: [], note: signed ? 'CF and OF: the high half is not the sign of the low half' : 'CF and OF: the high half is not zero' });
      return 'ok';
    }
    // divide: dividend hi:lo in tmpA:tmpC, divisor in tmpB
    if (n === 8) p.push(['AH', 'tmpA'], ['AL', 'tmpC']); else p.push(['DX', 'tmpA'], ['AX', 'tmpC']);
    move(p);
    const negDividend = signed && (t.tmpA & top) !== 0; const negDivisor = signed && (t.tmpB & top) !== 0;
    if (negDividend) {
      const borrow = t.tmpC !== 0 ? 1 : 0;
      negate('tmpC', 'magnitude of the dividend: low half');
      t.tmpA = (~t.tmpA + 1 - borrow) & mask; t['Σ'] = t.tmpA;
      step('alu', { alu: { op: 'negate with borrow', a: 'tmpA', b: null, size: n, flags: false, value: t.tmpA }, transfers: [{ from: 'Σ', to: 'tmpA', value: t.tmpA }], note: 'magnitude of the dividend: high half' });
    }
    if (negDivisor) negate('tmpB', 'magnitude of the divisor');
    const fits = t.tmpA < t.tmpB;
    t['Σ'] = (t.tmpA - t.tmpB) & mask;
    step('alu', { alu: { op: 'compare', a: 'tmpA', b: 'tmpB', size: n, flags: false, value: fits ? 1 : 0 }, transfers: [], note: 'the quotient fits only if the high half of the dividend is below the divisor (a divisor of 0 never fits)' });
    if (!fits) return 'divide error';
    for (let i = 1; i <= n; i++) {
      iteration = { n: i, of: n };
      let rem = (t.tmpA << 1) | ((t.tmpC >> (n - 1)) & 1);
      t.tmpC = (t.tmpC << 1) & mask;
      if (rem >= t.tmpB) { rem -= t.tmpB; t.tmpC |= 1; }
      t.tmpA = rem & mask; t['Σ'] = t.tmpA;
      step('alu', { alu: { op: 'divide step', a: 'tmpA', b: 'tmpB', size: n, flags: false, value: t.tmpA }, transfers: [{ from: 'Σ', to: 'tmpA', value: t.tmpA }, { from: 'Σ', to: 'tmpC', value: t.tmpC }], note: 'shift tmpA:tmpC left one place; if tmpA is not below tmpB, subtract it and set the low bit of tmpC' });
    }
    iteration = null;
    if (signed) {
      // the 8086 refuses a quotient of -128 or -32768 as well [TEST]; magnitude at most 127 or 32767
      const ok = t.tmpC <= (top - 1);
      step('alu', { alu: { op: 'compare', a: 'tmpC', b: top - 1, size: n, flags: false, value: ok ? 1 : 0 }, transfers: [], note: 'a signed quotient must be at most 127 (byte) or 32767 (word) in magnitude' });
      if (!ok) return 'divide error';
      if (negDividend !== negDivisor) negate('tmpC', 'the quotient is negative');
      if (negDividend) negate('tmpA', 'the remainder takes the sign of the dividend');
    }
    move(n === 8 ? [['tmpC', 'AL'], ['tmpA', 'AH']] : [['tmpC', 'AX'], ['tmpA', 'DX']]);
    return 'ok';
  }

  // --- string instructions, with REP, REPE or REPNE: one iteration after another (design §5)
  function strings() {
    const n = m.endsWith('B') ? 8 : 16;
    const delta = (c.FLAGS & DF ? -1 : 1) * (n / 8);
    const acc = n === 8 ? 'AL' : 'AX';
    const src = d.seg ?? 'DS'; // DS:SI may be overridden; ES:DI may not
    const kind = m.slice(0, 4);
    const advance = (r) => aluStep('add', r, delta & 0xffff, 16, { to: r, note: `${r} ${delta > 0 ? '+' : '−'} ${Math.abs(delta)} (DF ${delta > 0 ? 'clear' : 'set'})` });
    const once = () => {
      switch (kind) {
        case 'MOVS': request('read', src, 'SI', n); request('write', 'ES', 'DI', n); advance('SI'); advance('DI'); break;
        case 'CMPS':
          request('read', src, 'SI', n); move([['OPR', 'tmpA']]);
          request('read', 'ES', 'DI', n); move([['OPR', 'tmpB']]);
          aluStep('compare', 'tmpA', 'tmpB', n, { flags: true }); advance('SI'); advance('DI'); break;
        case 'SCAS': request('read', 'ES', 'DI', n); move([[acc, 'tmpA'], ['OPR', 'tmpB']]); aluStep('compare', 'tmpA', 'tmpB', n, { flags: true }); advance('DI'); break;
        case 'LODS': request('read', src, 'SI', n); move([['OPR', acc]]); advance('SI'); break;
        default: move([[acc, 'OPR']]); request('write', 'ES', 'DI', n); advance('DI'); // STOS
      }
    };
    if (!d.rep) { once(); return; }
    const compares = kind === 'CMPS' || kind === 'SCAS';
    const total = c.CX;
    for (let i = 1; ; i++) {
      iteration = null;
      const more = c.CX !== 0;
      condition(more, 'CX ≠ 0?');
      if (!more) break;
      iteration = { n: i, of: total };
      once();
      aluStep('decrement', 'CX', null, 16, { to: 'CX', note: 'CX − 1; FLAGS unchanged' });
      if (compares) {
        const stop = d.rep === 'REP' ? !(c.FLAGS & ZF) : (c.FLAGS & ZF) !== 0;
        condition(!stop, d.rep === 'REP' ? 'REPE: ZF set?' : 'REPNE: ZF clear?');
        if (stop) break;
      }
      // 8086-B8: an interrupt accepted between repetitions; IP back to the prefix before the op code (AP-67 p. A-27)
      if (c.CX !== 0 && repStop && repStop()) {
        iteration = null;
        jump([[(startIP + d.prefixes.length - 1) & 0xffff, 'IP']], 'an interrupt between repetitions: IP back to the prefix before the string op code');
        res.repInterrupted = i;
        break;
      }
    }
    iteration = null;
  }
}

function jccHolds(m, f) {
  const s = (f & SF) !== 0, o = (f & OF) !== 0, z = (f & ZF) !== 0, cy = (f & CF) !== 0, p = (f & PF) !== 0;
  switch (m) {
    case 'JO': return o; case 'JNO': return !o; case 'JB': return cy; case 'JAE': return !cy;
    case 'JE': return z; case 'JNE': return !z; case 'JBE': return cy || z; case 'JA': return !cy && !z;
    case 'JS': return s; case 'JNS': return !s; case 'JP': return p; case 'JNP': return !p;
    case 'JL': return s !== o; case 'JGE': return s === o; case 'JLE': return z || s !== o; default: return !z && s === o; // JG
  }
}
