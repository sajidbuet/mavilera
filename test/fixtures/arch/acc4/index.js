// acc4 -- a four-instruction accumulator machine, test fixture of the architecture contract only (never shipped).
// It shows the conformance suite runs on something that is not RISC-V: 4-bit addresses, 16 bytes of memory, 8-bit
// registers, no register file. Instruction byte: opcode in the high nibble, address in the low nibble.
// LDA 0x0, ADD 0x1, STA 0x2, HLT 0xF; data with `DB n`.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { CONTRACT_VERSION, STOP } from '../../../../src/arch/contract.js';

const OPS = { LDA: 0x0, ADD: 0x1, STA: 0x2, HLT: 0xf };
const NAMES = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));

function assemble(files) {
  const diagnostics = [];
  const listing = [];
  const symbols = {};
  const bytes = new Uint8Array(16);
  const lines = files[0].text.split('\n');
  let at = 0;
  const rows = [];
  lines.forEach((raw, i) => {
    let t = raw.replace(/;.*/, '').trim();
    const m = /^(\w+):\s*(.*)$/.exec(t);
    if (m) { symbols[m[1]] = at; t = m[2]; }
    if (t) { rows.push({ t, line: i + 1, at }); at += 1; }
  });
  for (const { t, line, at: a } of rows) {
    const [op, arg] = t.split(/\s+/);
    const val = arg === undefined ? 0 : arg in symbols ? symbols[arg] : Number(arg);
    let word;
    if (op === 'DB') word = val & 0xff;
    else if (op.toUpperCase() in OPS) word = (OPS[op.toUpperCase()] << 4) | (val & 0xf);
    else { diagnostics.push({ severity: 'error', line, message: `unknown ${op}` }); continue; }
    if (a > 15) { diagnostics.push({ severity: 'error', line, message: 'memory full' }); continue; }
    bytes[a] = word;
    listing.push({ address: a, size: 1, word, text: t, line });
  }
  const ok = diagnostics.length === 0;
  return { ok, diagnostics, segments: [{ address: 0, bytes, executable: true }], entry: 0, listing, symbols };
}

function disassemble(word) {
  const op = NAMES[word >> 4];
  return op === undefined ? `DB ${word}` : op === 'HLT' ? 'HLT' : `${op} ${word & 0xf}`;
}

function create(program) {
  const image = program.segments[0].bytes;
  let mem, A, pc, halted, retired, journal;
  const reset = () => { mem = image.slice(); A = 0; pc = program.entry; halted = false; retired = 0; journal = []; };
  reset();
  const state = () => ({ pc, registers: { A, PC: pc }, halted, error: null, retired });
  const step = () => {
    if (halted) return null;
    const w = mem[pc];
    const op = w >> 4, addr = w & 0xf;
    const rec = { pc, word: w, size: 1, nextPc: (pc + 1) & 0xf, registers: [], memory: [] };
    if (op === OPS.HLT) { rec.nextPc = pc; rec.halt = true; halted = true; }
    else if (op === OPS.LDA || op === OPS.ADD) {
      const v = op === OPS.LDA ? mem[addr] : (A + mem[addr]) & 0xff;
      rec.registers.push({ id: 'A', old: A, value: v });
      A = v;
    } else if (op === OPS.STA) { rec.memory.push({ address: addr, size: 1, old: mem[addr], value: A }); mem[addr] = A; }
    journal.push(rec);
    pc = rec.nextPc;
    retired += 1;
    return rec;
  };
  const back = () => {
    const rec = journal.pop();
    if (!rec) return false;
    for (const r of rec.registers) if (r.id === 'A') A = r.old;
    for (const m of rec.memory) mem[m.address] = m.old;
    pc = rec.pc; halted = false; retired -= 1;
    return true;
  };
  const run = ({ chunk = 1000, breakpoints = new Set(), target = null } = {}) => {
    for (let i = 0; i < chunk; i++) {
      if (halted) return STOP.HALT;
      if (i > 0 && breakpoints.has(pc)) return STOP.BREAK;
      if (i > 0 && pc === target) return STOP.TARGET;
      step();
    }
    return halted ? STOP.HALT : STOP.CHUNK;
  };
  return {
    reset, step, back, run, state,
    last: () => journal[journal.length - 1] ?? null,
    peek: (address, length) => mem.slice(address, address + length),
    snapshot: () => ({ mem: mem.slice(), A, pc, halted, retired, journal: journal.slice() }),
    restore: (s) => { mem = s.mem.slice(); ({ A, pc, halted, retired } = s); journal = s.journal.slice(); },
  };
}

export const descriptor = {
  contract: CONTRACT_VERSION,
  id: 'acc4',
  name: 'Accumulator (test)',
  strings: {},
  capabilities: { assembler: true, backStep: true, breakpoints: true, worker: true, cLanguage: { enabled: false, reason: 'cRiscvOnly' } },
  language: {
    id: 'asm', extension: '.asm', comment: ';',
    defaultSource: 'LDA x\nADD y\nSTA z\nHLT\nx: DB 3\ny: DB 4\nz: DB 0\n',
    assemble, disassemble,
    fields: (w) => [{ name: 'op', bits: '7:4', value: w >> 4 }, { name: 'addr', bits: '3:0', value: w & 0xf }],
    editor: { mnemonics: Object.keys(OPS), registers: ['A'], directives: ['DB'] },
  },
  registers: { groups: [{ id: 'cpu', label: 'CPU', registers: [{ id: 'A', name: 'A', width: 8 }, { id: 'PC', name: 'PC', width: 4 }] }], pc: 'PC' },
  addressSpace: { addressBits: 4, unitBits: 8, wordBytes: 1, endianness: 'little', regions: [{ name: 'RAM', base: 0, size: 16, kind: 'ram' }] },
  engine: { create },
  views: [{ id: 'isa', label: 'Instructions', icon: 'chip', kind: 'isa' }],
};
