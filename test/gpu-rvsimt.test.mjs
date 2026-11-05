// The GPU module's RISC-V SIMT core (GPU-2; decisions G14, G16-G18; tests S1-S11 of docs/research/gpu-npu/
// verification/GOLDEN_TESTS.md). The book's laboratory programs (test/fixtures/gpu/lab/, hashes in its README)
// assemble to the words of GNU's prog.hex and run to their golden.hex (256 data words, cycles, issued, active_slots,
// fault code); every issue equals the supplied golden model's trace (simt_model.py --trace, run from the book
// repository: MES_BOOK, skipped with the reason without it); step back is exact; the faults and rules of the
// specification that no supplied program reaches, on directed programs; the templates are the generator's.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assemble } from '../src/arch/gpu/rvsimt/language.js';
import { runCore, initialCore, issue, create, FAULTS, MACHINES } from '../src/arch/gpu/rvsimt/engine.js';
import { decode, disassemble } from '../src/arch/gpu/rvsimt/isa.js';
import { descriptor } from '../src/arch/gpu/index.js';
import { STOP } from '../src/arch/contract.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIX = join(ROOT, 'test', 'fixtures', 'gpu', 'lab');
const PROGRAMS = ['uniform', 'ifelse', 'ifelse8', 'nested', 'vadd_tail', 'reverse_bar', 'fault_div', 'fault_join'];
const profileOf = (p) => (p === 'ifelse8' ? 'lab-l8' : 'lab');
const words = (f) => readFileSync(f, 'utf8').split(/\s+/).filter(Boolean).map((t) => parseInt(t, 16) >>> 0);
const bytesOf = (ws) => { const b = new Uint8Array(ws.length * 4); ws.forEach((v, i) => { b[4 * i] = v & 255; b[4 * i + 1] = (v >>> 8) & 255; b[4 * i + 2] = (v >>> 16) & 255; b[4 * i + 3] = v >>> 24; }); return b; };
/** A Program from instruction and data words (the testbench's $readmemh of prog.hex and data.hex). */
const fromHex = (profile, prog, data = []) => ({ profile, segments: [{ address: 0, bytes: bytesOf(prog), executable: true }, { address: 0, bytes: bytesOf(data), executable: false }] });
const fixture = (p) => ({ prog: words(join(FIX, p, 'prog.hex')), data: words(join(FIX, p, 'data.hex')), golden: words(join(FIX, p, 'golden.hex')) });
const dump = (c) => [...c.dmem, c.cycles, c.issued, c.active, c.fault].map((v) => v >>> 0);
const src = (text, profile = 'lab') => assemble([{ name: 'main.s', text: `        .include "simt.inc"\n${text}` }], { profile });

const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const MODEL = join(BOOK, 'code', 'chapter11a', 'model', 'simt_model.py');
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const noModel = !existsSync(MODEL) ? `the supplied model is not at ${MODEL} (set MES_BOOK to a book checkout with code/chapter11a)`
  : spawnSync(PYTHON, ['--version']).status !== 0 ? 'Python 3 not found' : false;

test('the fixtures are the files the README lists, and the programs those the assembly record hashes', () => {
  const readme = readFileSync(join(FIX, 'README.md'), 'utf8');
  const rows = [...readme.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)];
  assert.equal(rows.length, PROGRAMS.length * 4 + 2);
  for (const [, file, hash] of rows) assert.equal(createHash('sha256').update(readFileSync(join(FIX, file))).digest('hex'), hash, file);
  const rec = JSON.parse(readFileSync(join(FIX, 'assembly-record.json'), 'utf8'));
  for (const p of PROGRAMS) {
    const sha = (f) => createHash('sha256').update(readFileSync(join(FIX, p, f))).digest('hex');
    assert.equal(sha('prog.s'), rec.programs[p].prog_s_sha256, `${p}/prog.s`);
    assert.equal(sha('prog.hex'), rec.programs[p].prog_hex_sha256, `${p}/prog.hex`);
  }
});

for (const p of PROGRAMS) {
  test(`S: ${p} assembles to GNU's prog.hex and runs to its golden.hex`, () => {
    const f = fixture(p);
    const a = assemble([{ name: 'prog.s', text: readFileSync(join(FIX, p, 'prog.s'), 'utf8') }], { profile: profileOf(p) });
    assert.ok(a.ok, JSON.stringify(a.diagnostics));
    const got = a.listing.map((r) => r.word >>> 0);
    assert.deepEqual(f.prog.map((w, i) => got[i] ?? 0), f.prog, 'the words of prog.hex (zero-padded to 64)');
    assert.equal(got.length, f.prog.findLastIndex((w) => w !== 0) + 1);
    const { core, stop } = runCore(fromHex(profileOf(p), f.prog, f.data), { limit: 5000 });
    assert.equal(stop, p.startsWith('fault') ? 'fault' : 'done');
    assert.deepEqual(dump(core), f.golden);
  });
}

test('S: the contract engine of the module gives the same dumps, and the counters panel the efficiency', () => {
  for (const p of PROGRAMS) {
    const f = fixture(p);
    const e = descriptor.engine.create(fromHex(profileOf(p), f.prog, f.data), {});
    const stop = e.run({ chunk: 10_000 });
    assert.equal(stop, p.startsWith('fault') ? STOP.ERROR : STOP.HALT, p);
    const r = e.state().registers;
    const mem = e.peek(0, 1024);
    const dm = Array.from({ length: 256 }, (_, i) => (mem[4 * i] | (mem[4 * i + 1] << 8) | (mem[4 * i + 2] << 16) | (mem[4 * i + 3] << 24)) >>> 0);
    assert.deepEqual([...dm, r.cycles, r.issued, r.active_slots, r.fault_code], f.golden, p);
    if (p.startsWith('fault')) assert.match(e.state().error, new RegExp(`^Fault ${r.fault_code} `));
    else assert.match(e.state().output, /^Done: every warp has ended/);
  }
});

test('S9: every issue equals the supplied model\'s trace (cycle, warp, PC, mask before and after, stack)', { skip: noModel }, () => {
  const lanes = (v, L) => Array.from({ length: L }, (_, l) => (v >> l) & 1).join('');
  for (const p of PROGRAMS) {
    const { machine } = { machine: MACHINES[profileOf(p)] };
    const r = spawnSync(PYTHON, ['-I', MODEL, join(FIX, p, 'prog.hex'), join(FIX, p, 'data.hex'), '--lanes', String(machine.lanes), '--warps', String(machine.warps), '--trace'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const want = r.stdout.split(/\r?\n/).map((l) => /^\s*(\d+) w(\d+) ([0-9a-f]+) .*? mask ([01]+)->([01]+) \[(.*)\](?: FAULT (\d+))?$/.exec(l)).filter(Boolean)
      .map((m) => `${m[1]} w${m[2]} ${parseInt(m[3], 16)} ${m[4]}->${m[5]} [${m[6]}]${m[7] ? ` F${m[7]}` : ''}`);
    const f = fixture(p);
    const mine = [];
    runCore(fromHex(profileOf(p), f.prog, f.data), { limit: 5000, onIssue: (x, c) => {
      const st = c.stacks[x.w].map((e) => `${e.kind}:${lanes(e.mask, c.L)}${e.kind === 'E' ? `@${e.pc.toString(16).padStart(4, '0')}` : ''}`).join(' ');
      mine.push(`${c.cycles} w${x.w} ${x.pc} ${lanes(x.maskIn, c.L)}->${lanes(c.mask[x.w], c.L)} [${st}]${x.fault ? ` F${x.fault}` : ''}`);
    } });
    assert.ok(want.length > 0, `${p}: no trace lines`);
    assert.deepEqual(mine, want, p);
  }
});

test('S: step back is exact through every program (state, data memory, last record)', () => {
  for (const p of PROGRAMS) {
    const f = fixture(p);
    const e = create(fromHex(profileOf(p), f.prog, f.data), {});
    const seen = [[JSON.stringify(e.state()), [...e.peek(0, 1024)].join()]];
    for (let n = 0; n < 5000 && e.step(); n++) seen.push([JSON.stringify(e.state()), [...e.peek(0, 1024)].join()]);
    for (let i = seen.length - 2; i >= 0; i--) {
      assert.ok(e.back(), `${p}: back ${i}`);
      assert.deepEqual([JSON.stringify(e.state()), [...e.peek(0, 1024)].join()], seen[i], `${p}: after stepping back to step ${i}`);
    }
    assert.equal(e.back(), false);
    assert.equal(e.last(), null);
  }
});

test('S: a snapshot restores the state and its history (the Worker)', () => {
  const f = fixture('reverse_bar');
  const e = create(fromHex('lab', f.prog, f.data), {});
  e.run({ chunk: 30 });
  const snap = structuredClone(e.snapshot());
  const e2 = create(fromHex('lab', f.prog, f.data), {});
  e2.restore(snap);
  assert.deepEqual(e2.state(), e.state());
  e.run({ chunk: 10_000 }); e2.run({ chunk: 10_000 });
  assert.deepEqual(e2.state(), e.state());
  for (let i = 0; i < 40; i++) { e.back(); e2.back(); }
  assert.deepEqual(e2.state(), e.state());
});

// --- S10: the faults no supplied program reaches, and S11: the stated rules (Chapter 11A brief §16) -------------
const run = (text, profile = 'lab') => {
  const a = src(text, profile);
  assert.ok(a.assembled, JSON.stringify(a.diagnostics));
  return runCore(a, { limit: 1000 });
};

test('S10: illegal instruction (2): a word outside the subset faults, and the assembler marks it', () => {
  for (const ins of ['auipc t0, 0', 'jalr zero, 0(ra)', 'lb t0, 0(zero)', 'sh t0, 0(zero)', 'ecall', 'ebreak', 'fence', 'csrr t0, mstatus', 'csrrw t0, 0xcc0, t1', 'mul t0, t1, t2']) {
    const a = src(`        .text\n        ${ins}\n`);
    assert.ok(a.diagnostics.some((d) => d.kind === 'profile'), ins);
    const { core, stop } = runCore(a, { limit: 10 });
    assert.equal([stop, core.fault, core.cycles, core.issued, core.active].join(), 'fault,2,1,1,4', ins);
  }
  // a fetch past the 64-word instruction memory
  const { core } = runCore(fromHex('lab', Array(64).fill(0x00000013)), { limit: 100 });
  assert.equal([core.fault, core.issued].join(), '2,65');
});

test('S10: reconvergence stack overflow (3): two nested divergent splits fit, a third does not', () => {
  // thread_index 0..3 in warp 0: bit 0 divides, then bit 1, then bit 0 again
  const splits = ['split t0', 'split t1', 'split t0'];
  const body = (n) => ['        .text', '        csrr t0, THREAD_INDEX', '        srli t1, t0, 1', ...splits.slice(0, n).map((s) => `        ${s}`), '        tmc zero', ''].join('\n');
  assert.equal(run(body(2)).core.fault, FAULTS.TMC_STACK, 'two splits: the stack holds four entries, so tmc finds it non-empty');
  const r = run(body(3));
  assert.equal([r.core.fault, r.core.stacks[0].length].join(), '3,4');
});

test('S10: tmc with a non-empty stack (5); a uniform split pushes only the reconverge entry', () => {
  const r = run('        .text\n        li t0, 1\n        split t0\n        tmc zero\n');
  assert.equal(r.core.fault, FAULTS.TMC_STACK);
  assert.deepEqual(r.core.stacks[0].map((e) => e.kind), ['R'], 'uniform predicate: nothing more pushed');
  assert.equal(r.core.mask[0], 0b1111);
});

test('S10: warp-control operand errors (6): wspawn outside warp 0, past WARPS or with a warp active; bar ids and counts', () => {
  assert.equal(run('        .text\n        li t0, 3\n        wspawn t0, zero\n').core.fault, FAULTS.OPERAND, 'wspawn 3 > WARPS 2');
  // warp 1 loops at k, so it is still running when warp 0 issues its second wspawn
  const twice = run('        .text\n        li t0, 2\n        la t1, k\n        wspawn t0, t1\n        wspawn t0, t1\nk:      j k\n');
  assert.equal(twice.core.fault, FAULTS.OPERAND, 'a second wspawn while warp 1 runs');
  assert.equal(run('        .text\n        li t0, 2\n        li t1, 1\n        bar t0, t1\n').core.fault, FAULTS.OPERAND, 'barrier id 2');
  assert.equal(run('        .text\n        bar zero, zero\n').core.fault, FAULTS.OPERAND, 'zero warps');
  assert.equal(run('        .text\n        li t1, 3\n        bar zero, t1\n').core.fault, FAULTS.OPERAND, 'three warps > WARPS');
  // wspawn in warp 1: warp 1 tries to spawn
  const w1 = run('        .text\n        li t0, 2\n        la t1, k\n        wspawn t0, t1\n        tmc zero\nk:      li t0, 2\n        wspawn t0, zero\n');
  assert.equal(w1.core.fault, FAULTS.OPERAND, 'wspawn from warp 1');
});

test('S10: bad data address (7): unaligned or past the 256-word data memory, for any active thread', () => {
  assert.equal(run('        .text\n        lw t0, 2(zero)\n').core.fault, FAULTS.ADDRESS);
  assert.equal(run('        .text\n        li t1, 1024\n        sw t1, 0(t1)\n').core.fault, FAULTS.ADDRESS);
  assert.equal(run('        .text\n        csrr t0, LANE_ID\n        slli t0, t0, 8\n        lw t1, 0(t0)\n        tmc zero\n').core.fault, 0, 'lane 3 reads 0x300: inside');
  assert.equal(run('        .text\n        csrr t0, LANE_ID\n        slli t0, t0, 9\n        lw t1, 0(t0)\n').core.fault, FAULTS.ADDRESS, 'lane 2 reads 0x400: outside');
});

test('S10 (MAVILERA): a barrier no other warp reaches stops the run before the cycle, as an error; step back clears it', () => {
  const a = src('        .text\n        li t0, 0\n        li t1, 2\n        bar t0, t1\n        tmc zero\n');
  const e = create(a, {});
  assert.equal(e.run({ chunk: 100 }), STOP.ERROR);
  const s = e.state();
  assert.match(s.error, /waits at a barrier/);
  assert.equal(s.registers.cycles, 3, 'no cycle counted for the deadlock');
  assert.ok(e.back());
  assert.equal(e.state().error, null);
});

test('S10: the directed programs give the supplied model\'s fault code and counters', { skip: noModel }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gpu-s10-'));
  try {
    const progs = {
      illegal: '        .text\n        auipc t0, 0\n',
      overflow: '        .text\n        csrr t0, THREAD_INDEX\n        srli t1, t0, 1\n        split t0\n        split t1\n        split t0\n',
      tmcStack: '        .text\n        li t0, 1\n        split t0\n        tmc zero\n',
      wspawn: '        .text\n        li t0, 3\n        wspawn t0, zero\n',
      wspawnTwice: '        .text\n        li t0, 2\n        la t1, k\n        wspawn t0, t1\n        wspawn t0, t1\nk:      j k\n',
      barId: '        .text\n        li t0, 2\n        li t1, 1\n        bar t0, t1\n',
      address: '        .text\n        csrr t0, LANE_ID\n        slli t0, t0, 9\n        lw t1, 0(t0)\n',
      lowest: '        .text\n        li t1, 14\n        tmc t1\n        csrr t0, LANE_ID\n        addi t0, t0, 6\n        tmc t0\n        csrr t2, THREAD_INDEX\n        sw t2, 0(zero)\n        tmc zero\n',
      sameWord: '        .text\n        li t0, 2\n        la t1, k\n        wspawn t0, t1\nk:      csrr t0, THREAD_INDEX\n        sw t0, 0(zero)\n        tmc zero\n',
    };
    for (const [name, text] of Object.entries(progs)) {
      const a = src(text);
      const { core } = runCore(a, { limit: 5000 });
      const ph = join(dir, `${name}.hex`); const dh = join(dir, `${name}.data.hex`);
      writeFileSync(ph, a.listing.map((r) => `${(r.word >>> 0).toString(16).padStart(8, '0')}\n`).join(''));
      writeFileSync(dh, '');
      const r = spawnSync(PYTHON, ['-I', MODEL, ph, dh, '--lanes', '4', '--warps', '2'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const m = /cycles (\d+) issued (\d+) active_slots (\d+) fault (\d+)/.exec(r.stdout);
      assert.ok(m, r.stdout);
      assert.deepEqual([core.cycles, core.issued, core.active, core.fault], m.slice(1, 5).map(Number), name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A random program of the subset: ALU and CSR reads, loads and stores in the data memory, splits with joins, forward
 * branches (uniform or not), tmc, wspawn; no bar (a lone barrier deadlocks, where the model counts to its limit). */
function randomProgram(rnd, lanes, warps) {
  const R = ['t0', 't1', 't2', 'a0', 'a1', 'a2', 's0', 's1'];
  const r = () => R[Math.floor(rnd() * R.length)];
  const lines = [];
  if (warps > 1 && rnd() < 0.7) lines.push(`        li t0, ${1 + Math.floor(rnd() * warps)}`, '        la t1, k', '        wspawn t0, t1');
  lines.push('k:      csrr s0, THREAD_INDEX', '        csrr s1, LANE_ID');
  let open = 0; let label = 0;
  const n = 6 + Math.floor(rnd() * 22);
  for (let i = 0; i < n && lines.length < 58; i++) {
    const x = rnd();
    if (x < 0.30) lines.push(`        ${['add', 'sub', 'xor', 'or', 'and', 'slt', 'sltu', 'sll', 'srl', 'sra'][Math.floor(rnd() * 10)]} ${r()}, ${r()}, ${r()}`);
    else if (x < 0.45) lines.push(`        ${['addi', 'xori', 'ori', 'andi', 'slti', 'sltiu'][Math.floor(rnd() * 6)]} ${r()}, ${r()}, ${Math.floor(rnd() * 4096) - 2048}`);
    else if (x < 0.50) lines.push(`        ${['slli', 'srli', 'srai'][Math.floor(rnd() * 3)]} ${r()}, ${r()}, ${Math.floor(rnd() * 32)}`);
    else if (x < 0.55) lines.push(`        lui ${r()}, ${Math.floor(rnd() * 0x100000)}`);
    else if (x < 0.62) lines.push(`        andi a3, ${r()}, 252`, `        ${rnd() < 0.5 ? 'lw' : 'sw'} ${r()}, 0(a3)`);
    else if (x < 0.74 && open < 2) { lines.push(`        andi a4, ${r()}, 1`, '        split a4'); open += 1; }
    else if (x < 0.84 && open > 0) { lines.push('        join'); open -= 1; }
    else if (x < 0.92) { const L = `f${label++}`; lines.push(`        ${['beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu'][Math.floor(rnd() * 6)]} ${rnd() < 0.5 ? 'zero' : r()}, ${r()}, ${L}`, `        addi ${r()}, ${r()}, 1`, `${L}:`); }
    else if (x < 0.96 && open === 0) lines.push(`        tmc ${r()}`);
    else lines.push(`        csrr ${r()}, ${['THREAD_INDEX', 'LANE_ID', 'WARP_ID', 'BLOCK_SIZE'][Math.floor(rnd() * 4)]}`);
  }
  while (open-- > 0) lines.push('        join');
  lines.push('        tmc zero');
  return `        .text\n${lines.join('\n')}\n`;
}

// the batch driver of the supplied model stays in the private repository (tools/site-files.mjs PRIVATE_ONLY)
const noBatch = noModel || (!existsSync(join(ROOT, 'tools', 'gpu', 'model_batch.py')) && 'tools/gpu/model_batch.py is in the private repository only');
test('S: 400 random programs give the supplied model\'s data memory, counters and fault', { skip: noBatch }, (t) => {
  let seed = 20261105;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
  const jobs = []; const mine = [];
  for (let i = 0; i < 400; i++) {
    const profile = i % 4 === 3 ? 'lab-l8' : 'lab';
    const { lanes, warps } = MACHINES[profile];
    const a = src(randomProgram(rnd, lanes, warps), profile);
    assert.ok(a.assembled, JSON.stringify(a.diagnostics));
    const data = Array.from({ length: 256 }, () => Math.floor(rnd() * 2 ** 32) >>> 0);
    const prog = a.listing.map((row) => row.word >>> 0);
    jobs.push({ prog, data, lanes, warps });
    const { core, stop } = runCore(fromHex(profile, prog, data), { limit: 5000 });
    mine.push({ core, stop });
  }
  const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'gpu', 'model_batch.py'), BOOK], { input: JSON.stringify(jobs), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const want = JSON.parse(r.stdout);
  const kinds = { done: 0, fault: 0, limit: 0 };
  want.forEach((w, i) => {
    const { core, stop } = mine[i];
    kinds[stop] = (kinds[stop] ?? 0) + 1;
    assert.equal(stop === 'limit', w.timeout, `program ${i}: timeout`);
    assert.deepEqual([core.cycles, core.issued, core.active, core.fault], [w.cycles, w.issued, w.active_slots, w.fault], `program ${i}: counters`);
    assert.deepEqual([...core.dmem], w.dmem, `program ${i}: data memory`);
  });
  t.diagnostic(`ends: ${JSON.stringify(kinds)}`);
  assert.ok(kinds.done > 50 && kinds.fault > 50, `a mix of ends: ${JSON.stringify(kinds)}`);
});

test('S11: scalar operands from the lowest active thread; the highest lane wins a same-word store; CSRs; x0', () => {
  // tmc from lane 1 (lanes 1-3 active after a first tmc): its t0 = lane_id + 6 = 7 → mask 0111
  const t = run('        .text\n        li t1, 14\n        tmc t1\n        csrr t0, LANE_ID\n        addi t0, t0, 6\n        tmc t0\n        sw zero, 0(zero)\n        tmc zero\n');
  assert.equal(t.core.fault, 0);
  const trace = [];
  runCore(src('        .text\n        li t1, 14\n        tmc t1\n        csrr t0, LANE_ID\n        addi t0, t0, 6\n        tmc t0\n        tmc zero\n'), { onIssue: (x, c) => trace.push(c.mask[0]) });
  assert.equal(trace[4], 0b0111, 'operand of lane 1 (the lowest active), 7');
  // every thread stores its thread_index to word 0: lane 3 of the warp writes last
  const s = run('        .text\n        csrr t0, THREAD_INDEX\n        sw t0, 0(zero)\n        tmc zero\n');
  assert.equal(s.core.dmem[0], 3);
  // the identity CSRs of thread (1, 2) on the laboratory core and x0
  const c = run(`        .text
        li t0, 2
        la t1, k
        wspawn t0, t1
        tmc zero
k:      csrr a0, THREAD_INDEX
        csrr a1, LANE_ID
        csrr a2, WARP_ID
        csrr a3, BLOCK_INDEX
        csrr a4, BLOCK_SIZE
        csrr a5, KERNEL_ARGS
        addi zero, zero, 5
        tmc zero
`);
  const reg = (w, l, k) => c.core.regs[((w * 4) + l) * 32 + k];
  assert.deepEqual([10, 11, 12, 13, 14, 15].map((k) => reg(1, 2, k)), [6, 2, 1, 0, 8, 0]);
  assert.equal(reg(1, 2, 0), 0, 'x0 stays 0');
  // registers are 0 at launch (warp 1 too, after wspawn)
  assert.equal(reg(1, 0, 5), 0);
});

test('the disassembly names the warp-control instructions and the identity CSRs; decoding is total', () => {
  const a = src('        .text\n        tmc t0\n        wspawn t0, t1\n        split a0\n        join\n        bar zero, t2\n        csrr s0, KERNEL_ARGS\n');
  assert.deepEqual(a.listing.map((r) => disassemble(r.word, r.address)), ['tmc t0', 'wspawn t0, t1', 'split a0', 'join', 'bar zero, t2', 'csrr s0, kernel_args']);
  for (let i = 0; i < 20000; i++) { const w = (Math.random() * 2 ** 32) >>> 0; const d = decode(w); assert.ok(d.op === null || typeof d.op === 'string'); disassemble(w, 0); }
});

test('the profiles: lab is two warps of four lanes, lab-l8 one warp of eight', () => {
  assert.deepEqual(MACHINES, { lab: { lanes: 4, warps: 2 }, 'lab-l8': { lanes: 8, warps: 1 } });
  const c = initialCore(MACHINES['lab-l8']);
  assert.equal([c.L, c.W, c.mask[0]].join(), '8,1,255');
  assert.equal(issue(initialCore(MACHINES.lab, [0x0000000b], [])).fault, 0, 'tmc zero (word 0x0000000b) ends warp 0');
});

test('the templates are the generator\'s, and each runs to its program\'s golden.hex', async () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'gpu', 'lab-templates.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const index = JSON.parse(readFileSync(join(ROOT, 'content', 'gpu', 'rvsimt', 'templates', 'index.json'), 'utf8'));
  assert.deepEqual(index.templates.map((t) => t.id), PROGRAMS);
  for (const t of index.templates) {
    const a = assemble([{ name: t.file, text: readFileSync(join(ROOT, 'content', 'gpu', 'rvsimt', 'templates', t.file), 'utf8') }], { profile: t.profile });
    assert.ok(a.ok, `${t.id}: ${JSON.stringify(a.diagnostics)}`);
    assert.ok(descriptor.engine.profiles.some((p) => p.id === t.profile && !p.variant));
    const { core } = runCore(a, { limit: 5000 });
    assert.deepEqual(dump(core), fixture(t.id).golden, t.id);
  }
});

test('the default program assembles and gives |x|', () => {
  const a = assemble([{ name: 'main.s', text: descriptor.language.defaultSource }], { profile: 'lab' });
  assert.ok(a.ok, JSON.stringify(a.diagnostics));
  const { core, stop } = runCore(a);
  assert.equal(stop, 'done');
  assert.deepEqual([...core.dmem.slice(8, 16)], [5, 3, 0, 7, 2, 1, 4, 8]);
});

test('the shared assembler is unchanged for RISC-V: no warp-control mnemonic, no .include, no numeric labels', async () => {
  const { assemble: rv } = await import('../src/asm/assembler.js');
  for (const text of ['tmc t0', '.include "simt.inc"', '1: j 1b', 'csrr t0, THREAD_INDEX']) {
    assert.equal(rv([{ name: 'a.s', text }]).ok, false, text);
  }
  assert.ok(rv([{ name: 'a.s', text: 'csrr t0, mstatus' }], { profile: 'iss-priv' }).ok);
});

test('the Threads panel: one table per warp, a column per lane, the non-zero registers (all with the option)', async () => {
  const { threadTables } = await import('../src/arch/gpu/rvsimt/threads-panel.js');
  const f = fixture('ifelse');
  const e = create(fromHex('lab', f.prog, f.data), {});
  for (let i = 0; i < 12; i++) e.step();
  const t = threadTables(e.state().registers);
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((x) => x.lanes.length), [4, 4]);
  assert.ok(t[0].rows.length > 0 && t[0].rows.every((row) => row.cells.some((c) => c.value !== 0)));
  assert.equal(threadTables(e.state().registers, { all: true })[0].rows.length, 31);
  assert.equal(t[0].rows.find((row) => row.name === 'a0'), undefined, 'a0 holds kernel_args, 0 here: not listed');
});
