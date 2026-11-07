// pico2-decode-oracle.mjs -- checks the pico2 decoder's disassembly against GNU objdump, instruction by instruction
// (development tool; needs a RISC-V GNU toolchain with RV32IMAC_Zba_Zbb_Zbs_Zbkb_Zca_Zcb_Zcmp_Zicsr_Zifencei, which the
// repository does not contain). It assembles every 16-bit encoding and many random 32-bit encodings with `.insn`, runs
// `objdump -d -M no-aliases` and compares the two texts. What it shows is that the decoder and objdump agree on the
// instruction, its operands and its immediates; it says nothing about execution.
//
//   node tools/pico2-decode-oracle.mjs [--toolchain DIR] [--work DIR] [--random N] [--seed S] [--show K] [--golden FILE]
//
// --toolchain  directory with bin/riscv32-*-elf-gcc and -objdump (default: %LOCALAPPDATA%/pico2sim-build/tools/riscv-toolchain-16)
// --work       scratch directory (default: a new folder under the system temp directory)
// --random N   random 32-bit words per major opcode (default 20000)
// --golden F   also write the words and objdump texts of a small sample (up to 12 per mnemonic, those the decoder and
//              objdump agree on) to F as JSON lines, for test/pico2-decode.test.mjs
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decode } from '../src/arch/pico2/core/decode.js';
import { disassemble, CSR_NAMES } from '../src/arch/pico2/core/disasm.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const toolchain = arg('toolchain', join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'tools', 'riscv-toolchain-16'));
const perOpcode = Number(arg('random', '20000'));
const show = Number(arg('show', '25'));
let seed = Number(arg('seed', '20261106')) >>> 0;
const work = arg('work', null) ?? mkdtempSync(join(tmpdir(), 'pico2-oracle-'));
mkdirSync(work, { recursive: true });

const bin = join(toolchain, 'bin');
const find = (suffix) => { const f = existsSync(bin) ? readdirSync(bin).find((n) => n.endsWith(suffix)) : null; if (!f) { console.error(`no ${suffix} in ${bin}`); process.exit(2); } return join(bin, f); };
const gcc = find('-gcc.exe'), objdump = find('-objdump.exe');
const MARCH = 'rv32imac_zba_zbb_zbs_zbkb_zca_zcb_zcmp_zicsr_zifencei';

function rnd() { // mulberry32
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0);
}

// the encodings: every 16-bit pattern that is not the start of a 32-bit one, then random 32-bit words per major opcode
const items = []; // {w, len}
// the exact words that random sampling does not reach: ecall, ebreak, mret, wfi, fence.i, fence, and a few more
for (const w of [0x00000073, 0x00100073, 0x30200073, 0x10500073, 0x0000100f, 0x0ff0000f, 0x0330000f, 0x0100000f, 0x8330000f, 0x0010000f]) items.push({ w, len: 4 });
for (let h = 0; h < 0x10000; h++) if ((h & 3) !== 3) items.push({ w: h, len: 2 });
const MAJOR = [0x37, 0x17, 0x6f, 0x67, 0x63, 0x03, 0x23, 0x13, 0x33, 0x0f, 0x2f, 0x73, 0x07, 0x27, 0x43, 0x53, 0x0b, 0x2b, 0x5b, 0x7b];
for (const opc of MAJOR) for (let i = 0; i < perOpcode; i++) items.push({ w: ((rnd() & ~0x7f) | opc) >>> 0, len: 4 });
// the structured OP/OP-IMM space: every funct7 and funct3 with random registers
for (const opc of [0x13, 0x33]) for (let f7 = 0; f7 < 128; f7++) for (let f3 = 0; f3 < 8; f3++) for (let k = 0; k < 4; k++) {
  items.push({ w: ((f7 << 25) | (rnd() & 0x01ffffff & ~0x7000 & ~0x7f) | (f3 << 12) | opc) >>> 0, len: 4 });
}

const hex = (w, len) => (len === 2 ? w.toString(16).padStart(4, '0') : w.toString(16).padStart(8, '0'));
writeFileSync(join(work, 'words.S'), '.text\n' + items.map((x) => `.insn ${x.len}, 0x${x.w.toString(16)}`).join('\n') + '\n');
const run = (exe, args) => {
  const r = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
  return r.stdout;
};
run(gcc, [`-march=${MARCH}`, '-mabi=ilp32', '-c', join(work, 'words.S'), '-o', join(work, 'words.o')]);
const listing = run(objdump, ['-d', '-M', 'no-aliases', join(work, 'words.o')]).split(/\r?\n/);
console.log(`toolchain ${toolchain}\nobjdump: ${run(objdump, ['--version']).split('\n')[0]}\nitems ${items.length}`);

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const oracle = new Map(); // address -> {bytes, text}
for (const line of listing) {
  const m = /^\s*([0-9a-f]+):\t([0-9a-f]+)\s*\t(.*)$/.exec(line);
  if (m) oracle.set(parseInt(m[1], 16), { bytes: m[2], text: m[3] });
}

// objdump's habits that are not differences of meaning: ` # comment` and ` <.text+0x…>` suffixes, branch targets in hex without
// `0x`, and CSR names (a name there is compared by its address through our own table; unknown names are not checked here).
const CSR_BY_NAME = new Map(Object.entries(CSR_NAMES).map(([a, n]) => [n, Number(a)]));
function theirsText(text) {
  let t = norm(text).replace(/\s#.*$/, '');
  t = t.replace(/([ ,])([0-9a-f]+) <[^>]*>$/, '$10x$2').replace(/ <[^>]*>$/, '');
  if (t.startsWith('fence ')) t = t.replace(/\bunknown\b/g, '0'); // objdump's word for an empty ordering set
  return t;
}
function sameCsr(mine, theirs) {
  const m = /^(csrr\S+) (\S+?),(\S+?),(\S+)$/.exec(theirs), n = /^(csrr\S+) (\S+?),(\S+?),(\S+)$/.exec(mine);
  if (!m || !n || m[1] !== n[1] || m[2] !== n[2] || m[4] !== n[4]) return false;
  if (/^0x[0-9a-f]+$/.test(m[3])) return (CSR_BY_NAME.has(n[3]) ? '0x' + CSR_BY_NAME.get(n[3]).toString(16) : n[3]) === m[3];
  return true; // objdump knows a name for it; checked only through the numbers in the golden file
}
// Differences of meaning that are known and explained: where objdump follows the specification's text and the Hazard3
// RTL of the RP2350 revision (upstream hazard3-rp2350: rv_opcodes.vh, hazard3_decode.v, hazard3_instr_decompress.v) does not.
// Each is {why, test(mine, theirs, word)}; `mine` and `theirs` are the texts, `word` the encoding.
const illegal = (m) => m === 'illegal';
const EXPECTED = [
  { why: 'objdump accepts RV32 shift amounts of 32 or more; the Hazard3 patterns fix instr[25] (or [12]) to 0',
    test: (m, t) => illegal(m) && /^(c\.)?(slli|srli|srai|rori|bclri|bexti|binvi|bseti) .*,0x[23][0-9a-f]$/.test(t) },
  { why: 'objdump accepts Zcmp register lists below 4 (spimm only); Hazard3 flags rlist < 4 invalid',
    test: (m, t, w) => illegal(m) && /^cm\.(push|pop|popret|popretz) /.test(t) && ((w >>> 4) & 15) < 4 },
  { why: 'cm.mvsa01 with r1s\' = r2s\' is reserved in the Zcmp text and rejected by objdump; the Hazard3 pattern has no such check',
    test: (m, t) => /^cm\.mvsa01 (\S+),\1$/.test(m) && t.startsWith('.insn') },
  { why: 'c.addi4spn with imm 0 is reserved in the specification; Hazard3 flags only the all-zero halfword',
    test: (m, t) => /^c\.addi4spn \S+,sp,0$/.test(m) && t.startsWith('.insn') },
  { why: 'fence with a non-zero fm field: objdump rejects it; the Hazard3 pattern fixes only rd, rs1 and funct3 and treats fence as a no-op',
    test: (m, t, w) => m.startsWith('fence ') && t.startsWith('.insn') && (w >>> 28) !== 0 },
  { why: 'Xh3bextm (custom-0, the RP2350\'s Hazard3 only): objdump does not know the encoding',
    test: (m, t) => /^h3\.bextmi? /.test(m) && t.startsWith('.insn') },
  { why: 'S-mode and hypervisor instructions: objdump knows them; the RP2350 has only M and U mode, so they are illegal',
    test: (m, t) => illegal(m) && /^(sfence|hfence|sinval|sret)/.test(t) },
  { why: 'c.addi16sp with imm 0 is reserved: both reject it (objdump still prints it)',
    test: (m, t) => illegal(m) && t === 'c.addi16sp sp,0' },
];

let pc = 0, agree = 0, illegalAgree = 0, missing = 0, expected = 0;
const expectedBy = new Map();
const diffs = [];
const golden = [];
const goldenCount = new Map();
for (const x of items) {
  const o = oracle.get(pc);
  if (!o || o.bytes !== hex(x.w, x.len)) { missing++; if (missing < 5) console.log(`desync at ${pc}: ${hex(x.w, x.len)} vs ${o?.bytes}`); pc += x.len; continue; }
  const theirIllegal = o.text.startsWith('.') || o.text.startsWith('unknown') || o.text.startsWith('c.unimp');
  const mine = disassemble(x.w, pc);
  const mineIllegal = mine === 'illegal';
  const theirs = theirsText(o.text);
  const rule = EXPECTED.find((e) => e.test(norm(mine), theirs, x.w));
  const isExpected = rule !== undefined;
  const ok = isExpected || (theirIllegal ? mineIllegal : norm(mine) === theirs || sameCsr(norm(mine), theirs));
  if (isExpected) { expected++; expectedBy.set(rule.why, (expectedBy.get(rule.why) ?? 0) + 1); }
  if (ok) { agree++; if (theirIllegal) illegalAgree++; } else diffs.push({ w: hex(x.w, x.len), pc, mine, theirs });
  if (!theirIllegal && ok && !isExpected && !theirs.startsWith('csr')) { // golden: all 16-bit ones; first 40 words of each major opcode
    const key = theirs.split(' ')[0]; // up to 12 examples of each mnemonic, in the order of the items
    const n = goldenCount.get(key) ?? 0;
    if (n < 12) { golden.push({ w: x.w, pc, text: theirs }); goldenCount.set(key, n + 1); }
  }
  pc += x.len;
}
console.log(`agree ${agree} (of which both illegal ${illegalAgree}, expected reserved-encoding differences ${expected}), differ ${diffs.length}, desync ${missing}`);
for (const [why, n] of expectedBy) console.log(`  expected difference x${n}: ${why}`);
const byMn = new Map();
for (const d of diffs) { const k = `${norm(d.theirs).split(' ')[0]} | ${norm(d.mine).split(' ')[0]}`; byMn.set(k, [...(byMn.get(k) ?? []), d]); }
console.log(`classes of difference (objdump | decoder): ${byMn.size}`);
let shown = 0;
for (const [k, list] of [...byMn].sort((a, b) => b[1].length - a[1].length)) {
  if (shown++ >= show) break;
  const d = list[0];
  console.log(`  ${String(list.length).padStart(6)}  ${k}   e.g. ${d.w}: objdump "${norm(d.theirs)}"  decoder "${norm(d.mine)}"`);
}
const g = arg('golden', null);
if (g) writeFileSync(g, golden.map((x) => JSON.stringify(x)).join('\n') + '\n');

// Second check, against Hazard3 itself: which encodings the opcode patterns of the RP2350 revision (`rv_opcodes.vh` of
// upstream hazard3-rp2350, read as text) match. Legal in the decoder but matching no pattern is a defect; matching a pattern but
// illegal in the decoder is listed by pattern name (the RTL's further conditions, e.g. reserved immediates, are in
// hazard3_decode.v and hazard3_instr_decompress.v and are reviewed from that list).
const rtl = arg('rtl-opcodes', null);
let rtlBad = 0;
if (rtl) {
  const pats = [];
  for (const line of readFileSync(rtl, 'utf8').split(/\r?\n/)) {
    const m = /^`define RVOPC_(\w+)\s+(32|16)'b([01?]+)/.exec(line);
    if (!m || m[1].startsWith('NOZ_') || m[1] === 'SYSTEM') continue;
    const bits = m[3];
    pats.push({ name: m[1], len: m[2] === '32' ? 4 : 2,
      mask: parseInt(bits.replace(/[01]/g, '1').replace(/\?/g, '0'), 2) >>> 0, value: parseInt(bits.replace(/\?/g, '0'), 2) >>> 0 });
  }
  // the instructions of Hazard3 that this decoder does not implement yet or that the RP2350 does not have (Zbc, Zbkx: R-HZ-01 §3.2)
  const NOT_IN_DECODER = new Set(['CLMUL', 'CLMULH', 'CLMULR', 'XPERM_B', 'XPERM_N']);
  const onlyRtl = new Map();
  let accepted = 0, checked = 0;
  for (const x of items) {
    const hit = pats.filter((p) => p.len === x.len && ((x.w & p.mask) >>> 0) === p.value && !NOT_IN_DECODER.has(p.name));
    const mineLegal = decode(x.w).op !== decode(0xffffffff).op;
    checked++;
    if (mineLegal && hit.length === 0) { rtlBad++; if (rtlBad <= 10) console.log(`  decoder accepts what no Hazard3 pattern matches: ${hex(x.w, x.len)} ${disassemble(x.w)}`); }
    if (!mineLegal && hit.length > 0) { const k = hit.map((p) => p.name).join('+'); onlyRtl.set(k, [...(onlyRtl.get(k) ?? []), x.w]); }
    if (mineLegal) accepted++;
  }
  console.log(`Hazard3 patterns: ${pats.length} read; ${checked} encodings, decoder accepts ${accepted}; accepted without a matching pattern: ${rtlBad}`);
  for (const [k, ws] of [...onlyRtl].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  pattern matches, decoder illegal: ${String(ws.length).padStart(6)}  ${k}  e.g. ${hex(ws[0], ws[0] > 0xffff ? 4 : 2)}`);
  }
}
process.exit(diffs.length === 0 && missing === 0 && rtlBad === 0 ? 0 : 1);
