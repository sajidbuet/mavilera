// pico2-act-run.mjs -- runs the self-checking ELFs of riscv-arch-test (ACT4 framework, generated with Sail as the reference) on
// the pico2 module's hart (P1-M1 exit criterion E-CORE-1). The machine mimics the Hazard3 Verilator testbench the framework's
// Hazard3 configuration is written for: 16 MiB of RAM at 0x80000000 and an IO window at 0xc0000000 (print, exit, soft and external
// interrupt set/clear, global monitor enable, mtime and mtimecmp); every other address is a bus error. A test passes when it writes 0
// to the exit register. Development tool; not shipped.
//   node tools/pico2-act-run.mjs [--limit N] [--json FILE] [--quiet] [--trace] PATH...      (a PATH is an ELF or a directory searched for *.elf)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseElf } from '../src/arch/pico2/core/elf.js';
import { Hart } from '../src/arch/pico2/core/hart.js';
import { disassemble } from '../src/arch/pico2/core/disasm.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (n) => { const i = args.indexOf(`--${n}`); if (i < 0) return false; args.splice(i, 1); return true; };
const limit = Number(opt('limit', 20_000_000));
const jsonOut = opt('json', null);
const quiet = flag('quiet');
const trace = flag('trace');
// The standard pmpcfg bit layout is always used (the RTL's has R and X transposed: erratum RP2350-E6). --pmp-spec also takes the
// privileged specification's WARL choices (Sail's) where the pinned RTL differs: see Pmp's options
const pmpOpts = flag('pmp-spec') ? { specCfgBits: true, clearWriteOnly: true, specReadback: true } : { specCfgBits: true };
const RAM_BASE = 0x80000000, RAM_SIZE = 0x01000000, IO_BASE = 0xc0000000, IO_SIZE = 0x1000;

class ActMachine {
  constructor() {
    this.ram = new Uint8Array(RAM_SIZE);
    this.fault = false;
    this.exitCode = null; this.out = '';
    this.softirq = 0; this.irq = 0; this.globmon = 0;
    this.mtimecmp = Infinity;
    this.mtimeOffset = 0;   // mtime = hart steps (ticks, not mcycle: mcountinhibit must not stop the timer) + offset: the registers are writable
    this.hart = null;
  }
  mtime() { return this.hart.ticks + this.mtimeOffset; }
  setMtime(lo, hi) { this.mtimeOffset = (hi * 4294967296 + lo) - this.hart.ticks; }
  inRam(a, n) { return a >= RAM_BASE && a - RAM_BASE + n <= RAM_SIZE; }
  inIo(a, n) { return a >= IO_BASE && a - IO_BASE + n <= IO_SIZE; }
  peek(a, n) { if (!this.inRam(a, n)) return undefined; const o = a - RAM_BASE, r = this.ram; return n === 4 ? (r[o] | (r[o + 1] << 8) | (r[o + 2] << 16) | (r[o + 3] << 24)) : n === 2 ? r[o] | (r[o + 1] << 8) : r[o]; }
  read(a, n) {
    if (this.inRam(a, n)) return this.peek(a, n);
    if (this.inIo(a, n)) {
      const o = a - IO_BASE, t = this.mtime();
      if (o === 0x100) return t | 0;
      if (o === 0x104) return Math.floor(t / 4294967296) | 0;
      if (o === 0x108) return this.mtimecmp === Infinity ? -1 : this.mtimecmp | 0;
      if (o === 0x10c) return this.mtimecmp === Infinity ? -1 : Math.floor(this.mtimecmp / 4294967296) | 0;
      return 0;
    }
    this.fault = true; return 0;
  }
  write(a, n, v) {
    if (this.inRam(a, n)) { const o = a - RAM_BASE, r = this.ram; r[o] = v; if (n > 1) r[o + 1] = v >>> 8; if (n > 2) { r[o + 2] = v >>> 16; r[o + 3] = v >>> 24; } return; }
    if (this.inIo(a, n)) {
      const o = a - IO_BASE;
      switch (o) {
        case 0x000: this.out += String.fromCharCode(v & 0xff); break;
        case 0x008: this.exitCode = v | 0; break;
        case 0x010: this.softirq |= v & 1; break;
        case 0x014: this.softirq &= ~(v & 1); break;
        case 0x018: this.globmon = v & 1; break;
        case 0x020: this.irq |= v; break;
        case 0x030: this.irq &= ~v; break;
        case 0x100: this.setMtime(v >>> 0, Math.floor(this.mtime() / 4294967296)); break;
        case 0x104: this.setMtime(this.mtime() % 4294967296, v >>> 0); break;
        case 0x108: this.mtimecmp = (this.mtimecmp === Infinity ? 0xffffffff * 4294967296 : Math.floor(this.mtimecmp / 4294967296) * 4294967296) + (v >>> 0); break;
        case 0x10c: this.mtimecmp = (v >>> 0) * 4294967296 + (this.mtimecmp === Infinity ? 0xffffffff : this.mtimecmp % 4294967296); break;
        default: break;
      }
      return;
    }
    this.fault = true;
  }
  read8(a) { return this.read(a, 1) & 0xff; }
  read16(a) { return this.read(a, 2) & 0xffff; }
  read32(a) { return this.read(a, 4) | 0; }
  write8(a, v) { this.write(a, 1, v); }
  write16(a, v) { this.write(a, 2, v); }
  write32(a, v) { this.write(a, 4, v); }
  /** Interrupt inputs of the hart from the testbench registers (called after every step). */
  drive() {
    const h = this.hart;
    h.setIrq((this.softirq << 3) | ((this.mtime() >= this.mtimecmp ? 1 : 0) << 7));
    h.setExternalIrqs(this.irq >>> 0);
  }
}

function runElf(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const elf = parseElf(bytes);
  const m = new ActMachine();
  for (const s of elf.segments) {
    if (s.paddr < RAM_BASE || s.paddr + s.memsz > RAM_BASE + RAM_SIZE) return { path, result: 'BAD-ELF', detail: `segment at 0x${s.paddr.toString(16)}` };
    m.ram.set(s.data, s.paddr - RAM_BASE);
  }
  const hart = new Hart(m, { resetPc: elf.entry, reservationShift: 6, xh3irq: false, pmp: pmpOpts }) // the Hazard3 testbench's exclusive monitor covers 64 bytes;
  m.hart = hart;
  // The framework's tests and its Sail model know no Xh3irq, and the upstream Hazard3 configuration is built without it: an external
  // interrupt line is mip.MEIP directly (the hart option xh3irq: false). With Xh3irq the handler would see MEIP drop once the
  // preemption level rises, which the tests do not expect.
  let steps = 0;
  while (m.exitCode === null && steps < limit) {
    const pc = hart.pc >>> 0, priv = hart.priv;
    hart.step(); steps++; m.drive();
    if (trace && hart.trapped) console.log(`  #${steps} trap at 0x${pc.toString(16)} ${disassemble(m.peek(pc, 4) | 0, pc).replace(/\s+/g, ' ')} priv=${priv} mcause=0x${(hart.mcause >>> 0).toString(16)} -> 0x${(hart.pc >>> 0).toString(16)} a5=0x${(hart.x[15] >>> 0).toString(16)} pmp=${[0,1,2,3,4,5,6,7].filter((i) => hart.pmp.a[i]).map((i) => `${i}:cfg${hart.csrRead(0x3a0 + (i >> 2)) >>> (8 * (i & 3)) & 0xff}/addr${(hart.pmp.addr[i] >>> 0).toString(16)}`).join(' ')}`);
  }
  const result = m.exitCode === null ? 'TIMEOUT' : m.exitCode === 0 ? 'PASS' : 'FAIL';
  return { path, result, exitCode: m.exitCode, steps, instret: hart.instret, pc: hart.pc >>> 0, mcause: hart.mcause >>> 0, out: m.out.slice(0, 3000) };
}

function* elfs(p) {
  if (statSync(p).isDirectory()) { for (const e of readdirSync(p).sort()) yield* elfs(join(p, e)); } else if (p.endsWith('.elf') && !p.endsWith('.sig.elf')) yield p;
}

const results = [];
for (const root of args) {
  for (const f of elfs(root)) {
    let r;
    try { r = runElf(f); } catch (e) { r = { path: f, result: 'CRASH', detail: String(e.stack ?? e).split('\n').slice(0, 3).join(' | ') }; }
    results.push(r);
    if (!quiet || r.result !== 'PASS') console.log(`${r.result.padEnd(8)} ${f.split(/[\\/]/).slice(-3).join('/')}${r.result === 'PASS' ? '' : `  pc=0x${(r.pc ?? 0).toString(16)} mcause=0x${(r.mcause ?? 0).toString(16)} steps=${r.steps ?? ''} ${r.detail ?? ''} ${r.out ? JSON.stringify(r.out.slice(0, 120)) : ''}`}`);
  }
}
const count = (k) => results.filter((r) => r.result === k).length;
console.log(`\n${results.length} ELFs: ${count('PASS')} pass, ${count('FAIL')} fail, ${count('TIMEOUT')} timeout, ${count('CRASH') + count('BAD-ELF')} crash/bad`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.result === 'PASS') && results.length > 0 ? 0 : 1);
