// gnu-oracle.mjs -- ARM-A5 oracle against the GNU Arm toolchain and QEMU user mode (roadmap ARM-A5, oracle item 4;
// W-D32 Q10, A5-Q1). Development tool only, never shipped; needs WSL with binutils-arm-linux-gnueabihf and qemu-user.
//
//   node tools/armv7/gnu-oracle.mjs [--words 20000] [--programs 1000] [--seed 1] [--distro Ubuntu] [--json out.json]
//
// 1. Encoding: words of the subset (every word of the generated programs and the templates, and random words that the
//    decoder accepts) are disassembled by this application's disassembler; GNU `as` (.syntax unified) assembles that
//    text and must give back the same word. This checks the disassembler's text and the encodings against GNU. A line GNU
//    refuses passes only if it matches GNU_ONLY_REFUSALS (a valid encoding GNU's assembler does not accept).
// 2. Execution: generated programs (tools/armv7/equivalence.mjs, base and Extended) are linked as raw words with a
//    harness (prologue: the models' reset state; the halt `B .` patched into a branch to a dump of R0-R14, the CPSR and
//    the data memory 0xF000-0x10FFF) and run in qemu-arm; the result must equal the instruction-level engine's.
// QEMU follows the full ARMv7 architecture; the programs stay inside the agreed subset (roadmap ARM-A5, risks).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { assemble, decode, disassemble, withinTier } from '../../src/arch/armv7/language.js';
import { create, Memory } from '../../src/arch/armv7/engine.js';
import { generate } from './equivalence.mjs';

const hex8 = (v) => (v >>> 0).toString(16).padStart(8, '0');
const wordsOf = (seg) => Array.from({ length: seg.bytes.length >> 2 }, (_, i) => (seg.bytes[4 * i] | (seg.bytes[4 * i + 1] << 8) | (seg.bytes[4 * i + 2] << 16) | (seg.bytes[4 * i + 3] << 24)) >>> 0);
const wslPath = (p) => p.replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');

/** Run a bash script in WSL; returns stdout. */
function wsl(distro, script, dir) {
  const f = join(dir, `run-${Date.now()}.sh`);
  writeFileSync(f, script.replace(/\r/g, ''));
  return execFileSync('wsl', ['-d', distro, '--', 'bash', wslPath(f)], { encoding: 'latin1', maxBuffer: 1 << 28 });
}

/** The tool versions, or null when the toolchain is missing. */
export function probe(distro = 'Ubuntu') {
  try {
    const out = execFileSync('wsl', ['-d', distro, '--', 'bash', '-lc', 'arm-linux-gnueabihf-as --version | head -1; qemu-arm --version | head -1'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [as, qemu] = out.trim().split(/\r?\n/);
    return as?.startsWith('GNU assembler') && qemu?.startsWith('qemu-arm') ? { as, qemu } : null;
  } catch { return null; }
}

/** The disassembly in GNU's unified syntax: absolute targets (B, BL, ADR, literal) as offsets from `.`. */
export function gnuText(word, address) {
  return disassemble(word, address).replace(/(?<![#\w])0x([0-9A-F]+)$/, (_, h) => {
    const d = parseInt(h, 16) - address;
    return d >= 0 ? `.+${d}` : `.-${-d}`;
  });
}

/** Random words that the decoder accepts (not bad, not UNPREDICTABLE), any tier. */
export function randomWords(n, seed = 1) {
  let s = seed >>> 0;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s; };
  const out = [];
  while (out.length < n) {
    let w = next();
    // bias towards the classes in scope: op 00/01/10 and a condition other than 1111
    w = ((w & 0xf3ffffff) | ((next() % 3) << 26)) >>> 0;
    const d = decode(w);
    if (d.bad || d.unpredictable || d.cond === 15 || !withinTier(d.tier, 'I')) continue;
    out.push(w);
  }
  return out;
}

/**
 * Encoding check: [{index, word, address, text, source}] -> {refused, mismatches}. Item k is the k-th line after the
 * header and sits at k * 4; its targets are offsets from `.`, so the slot address does not matter. A line GNU refuses
 * is recorded and replaced by `.word 0`, and the file assembled again.
 */
export function encodingCheck(items, { distro = 'Ubuntu', dir }) {
  const HEAD = ['.syntax unified', '.arm', '.text'];
  const text = items.map((it) => it.text);
  const refused = [];
  for (let round = 0; round < 4; round++) {
    writeFileSync(join(dir, 'enc.s'), `${[...HEAD, ...text].join('\n')}\n`);
    const out = wsl(distro, `cd '${wslPath(dir)}'\narm-linux-gnueabihf-as -W -o enc.o enc.s 2> enc.err; echo "as=$?"\n`
      + 'arm-linux-gnueabihf-objcopy -O binary -j .text enc.o enc.bin 2>/dev/null; true\n', dir);
    const errs = readFileSync(join(dir, 'enc.err'), 'latin1').split(/\r?\n/).map((l) => /^enc\.s:(\d+): Error: (.*)$/.exec(l)).filter(Boolean);
    if (/as=0/.test(out) && !errs.length) {
      const bin = readFileSync(join(dir, 'enc.bin'));
      const mismatches = [];
      for (const it of items) {
        if (refused.some((r) => r.index === it.index)) continue;
        const g = bin.length >= it.index * 4 + 4 ? bin.readUInt32LE(it.index * 4) : null;
        if (g !== it.word) mismatches.push({ index: it.index, source: it.source, text: it.text, word: hex8(it.word), gnu: g === null ? null : hex8(g) });
      }
      return { assembled: true, refused, mismatches };
    }
    for (const [, line, msg] of errs) {
      const k = Number(line) - HEAD.length - 1;
      if (k < 0 || k >= items.length || text[k] === '.word 0') continue;
      refused.push({ index: k, source: items[k].source, text: items[k].text, word: hex8(items[k].word), error: msg, known: GNU_ONLY_REFUSALS.find((x) => x.test(items[k].word, msg))?.id ?? null });
      text[k] = '.word 0';
    }
  }
  return { assembled: false, refused, mismatches: [] };
}

/**
 * Lines GNU refuses although the encoding is valid: each entry matches narrowly and says why. Checked against
 * DDI 0406C.d before being added.
 */
export const GNU_ONLY_REFUSALS = Object.freeze([
  {
    id: 'str-pc-pc-unaligned',
    why: 'STR PC, [PC, #imm] with imm not a multiple of 4: GNU requires 4-byte alignment, but STR (immediate, ARM) allows '
      + 'Rt = PC and, for offset addressing, Rn = PC with any imm12 0-4095 (deprecated; DDI 0406C.d A8.8.205, pp. A8-675 '
      + 'and A8-676). The models stop such a store at run time as unaligned (W-D32 Q3).',
    test: (word, error) => {
      const d = decode(word);
      return /must be 4-byte aligned/.test(error) && d.cls === 'mem' && !d.L && !d.B && d.Rd === 15 && d.Rn === 15 && d.P && !d.W && !d.Ibar && (d.imm12 & 3) !== 0;
    },
  },
]);

const HALT = 0xeafffffe;

/** A GNU source running `program` (assembled by this application) under the harness; the halt at `haltPc`. */
function harness(program, haltPc) {
  const text = program.segments.find((s) => s.executable);
  const words = wordsOf(text);
  const dumpAt = 4 * words.length;
  const i = haltPc >>> 2;
  if (words[i] !== HALT) throw new Error(`no halt word at 0x${haltPc.toString(16)}`);
  words[i] = (0xea000000 | (((dumpAt - (haltPc + 8)) >> 2) & 0xffffff)) >>> 0;
  const data = new Memory();
  for (const s of program.segments) if (!s.executable) for (let k = 0; k < s.bytes.length; k++) data.write8(s.address + k, s.bytes[k]);
  const dataWords = Array.from({ length: 0x800 }, (_, k) => data.read(0xf000 + 4 * k, 4));
  return ['.syntax unified', '.arm', '.text', '.global _start',
    `.word ${words.map((w) => `0x${hex8(w)}`).join(', ')}`,
    // the dump: R0 through the user thread register, R1-R14 and the CPSR to buf, then buf and the data memory to stdout
    'dump: mcr p15, 0, r0, c13, c0, 2', 'ldr r0, =buf+4', 'stmia r0, {r1-r14}', 'mrs r1, apsr', 'str r1, [r0, #56]',
    'mrc p15, 0, r1, c13, c0, 2', 'str r1, [r0, #-4]',
    'mov r0, #1', 'ldr r1, =buf', 'mov r2, #64', 'mov r7, #4', 'svc 0',
    'mov r0, #1', 'ldr r1, =0xf000', 'mov r2, #0x2000', 'mov r7, #4', 'svc 0',
    'mov r0, #0', 'mov r7, #1', 'svc 0',
    // the models' reset state
    '_start: mov r0, #0', ...Array.from({ length: 12 }, (_, k) => `mov r${k + 1}, #0`), 'mov r14, #0', 'mov sp, #0x100000',
    'msr apsr_nzcvq, #0', 'b 0',
    '.ltorg', '.data', `.word ${dataWords.map((w) => `0x${hex8(w)}`).join(', ')}`, '.section .dump, "aw"', 'buf: .space 64', ''].join('\n');
}

/** The engine's end state: R0-R14, NZCV and the data words 0xF000-0x10FFF, and where it halted. */
function engineEnd(program) {
  const iss = create(program, { historyLimit: 1 });
  const mem = new Memory();
  for (const s of program.segments) if (!s.executable) for (let k = 0; k < s.bytes.length; k++) mem.write8(s.address + k, s.bytes[k]);
  for (let n = 0; n < 1_000_000; n++) {
    const rec = iss.step();
    if (!rec) throw new Error(`engine stopped: ${iss.state().error}`);
    for (const x of rec.memory) mem.write(x.address, x.size, x.value);
    if (rec.halt) {
      const r = iss.state().registers;
      return { haltPc: rec.pc, regs: Array.from({ length: 15 }, (_, i) => r[`r${i}`] >>> 0), nzcv: (r.N << 3) | (r.Z << 2) | (r.C << 1) | r.V,
        data: Array.from({ length: 0x800 }, (_, k) => mem.read(0xf000 + 4 * k, 4)) };
    }
  }
  throw new Error('no halt');
}

/** Execution check of generated programs under qemu-arm. */
export function executionCheck(programs, { distro = 'Ubuntu', dir }) {
  const ends = [];
  for (const [k, p] of programs.entries()) {
    const want = engineEnd(p.program);
    ends.push(want);
    writeFileSync(join(dir, `p${k}.s`), harness(p.qemuProgram ?? p.program, want.haltPc)); // qemuProgram: a planted-fault hook for tests
  }
  const script = [`cd '${wslPath(dir)}'`, `for k in $(seq 0 ${programs.length - 1}); do`,
    '  arm-linux-gnueabihf-as -o p$k.o p$k.s 2> p$k.err && arm-linux-gnueabihf-ld -z max-page-size=0x1000 -z common-page-size=0x1000 -Ttext=0 -Tdata=0xF000 --section-start=.dump=0x20000 -e _start -o p$k.elf p$k.o 2>> p$k.err && timeout 10 qemu-arm -B 0x40000000 ./p$k.elf > p$k.out 2>> p$k.err; echo "$k $?"',
    'done', ''].join('\n');
  const status = wsl(distro, script, dir).trim().split(/\r?\n/).map((l) => l.split(' ').map(Number));
  const failures = [];
  let compared = 0;
  for (const [k, code] of status) {
    const p = programs[k];
    const want = ends[k];
    if (code !== 0) { failures.push({ k, tier: p.tier, what: `exit ${code}: ${readFileSync(join(dir, `p${k}.err`), 'latin1').trim().slice(0, 300)}` }); continue; }
    const out = readFileSync(join(dir, `p${k}.out`));
    if (out.length !== 64 + 0x2000) { failures.push({ k, tier: p.tier, what: `dump of ${out.length} bytes` }); continue; }
    const regs = Array.from({ length: 15 }, (_, i) => out.readUInt32LE(4 * i));
    const nzcv = out.readUInt32LE(60) >>> 28;
    let what = null;
    for (let i = 0; i < 15 && !what; i++) if (regs[i] !== want.regs[i]) what = `R${i} qemu ${hex8(regs[i])} engine ${hex8(want.regs[i])}`;
    if (!what && nzcv !== want.nzcv) what = `NZCV qemu ${nzcv.toString(2).padStart(4, '0')} engine ${want.nzcv.toString(2).padStart(4, '0')}`;
    for (let i = 0; i < 0x800 && !what; i++) { const v = out.readUInt32LE(64 + 4 * i); if (v !== want.data[i]) what = `memory 0x${(0xf000 + 4 * i).toString(16)} qemu ${hex8(v)} engine ${hex8(want.data[i])}`; }
    if (what) failures.push({ k, tier: p.tier, seed: p.seed, what });
    else compared += 1;
  }
  return { programs: programs.length, agreed: compared, failures };
}

// ---- command line --------------------------------------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
  const distro = arg('--distro', 'Ubuntu');
  const nWords = Number(arg('--words', 20_000));
  const nProgs = Number(arg('--programs', 1000));
  const seed = Number(arg('--seed', 1));
  const out = arg('--json', null);
  const tools = probe(distro);
  if (!tools) { console.error('GNU binutils (arm-linux-gnueabihf) or qemu-arm not found in WSL'); process.exit(2); }
  const dir = mkdtempSync(join(tmpdir(), 'mavilera-gnu-'));
  const t0 = Date.now();

  // 1. encoding: generated programs' words, the templates' words, random words
  const items = [];
  const add = (word, address, source) => items.push({ index: items.length, word, address, source, text: gnuText(word, address) });
  const programs = [];
  for (let k = 0; k < nProgs; k++) {
    const tier = k % 2 ? 'E' : 'H';
    const s = (seed * 1_000_003 + k * 7919) >>> 0;
    const program = assemble([{ name: 't.s', text: generate(s, tier) }]);
    programs.push({ tier, seed: s, program });
    const text = program.segments.find((x) => x.executable);
    wordsOf(text).forEach((w, i) => add(w, text.address + 4 * i, `program ${k}`));
  }
  const tdir = new URL('../../content/armv7/templates/', import.meta.url);
  for (const f of readdirSync(tdir).filter((x) => x.endsWith('.s'))) {
    const p = assemble([{ name: f, text: readFileSync(new URL(f, tdir), 'utf8') }]);
    if (!p.ok) continue;
    for (const s of p.segments.filter((x) => x.executable)) wordsOf(s).forEach((w, i) => add(w, s.address + 4 * i, f));
  }
  for (const w of randomWords(nWords, seed)) add(w, 0x8000, 'random');
  const enc = encodingCheck(items, { distro, dir });

  // 2. execution
  const exe = executionCheck(programs, { distro, dir });

  const report = {
    _copyright: 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code (a generated record).',
    tool: 'tools/armv7/gnu-oracle.mjs', date: new Date().toISOString(), node: process.version, tools, seed, ms: Date.now() - t0,
    encoding: { words: items.length, random: items.filter((x) => x.source === 'random').length, assembled: enc.assembled,
      refused: enc.refused.length, refusedUnexplained: enc.refused.filter((r) => !r.known).length, knownRefusals: GNU_ONLY_REFUSALS.map(({ id, why }) => ({ id, why })),
      mismatches: enc.mismatches.length, refusedExamples: enc.refused.slice(0, 20), mismatchExamples: enc.mismatches.slice(0, 20) },
    execution: { programs: exe.programs, agreed: exe.agreed, failures: exe.failures.slice(0, 20) },
    scratch: dir,
  };
  report.pass = enc.assembled && enc.refused.every((r) => r.known) && enc.mismatches.length === 0 && exe.failures.length === 0;
  console.log(JSON.stringify(report, null, 2));
  if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.pass ? 0 : 1;
}
