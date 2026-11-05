// The 8086 teaching model of micro-operations (src/arch/i8086/microops.js; milestone 8086-B3, design
// docs/architecture/i8086-microops.md, approved 2026-11-05) in lock-step with the instruction-level engine (cpu.js):
// registers, FLAGS under the undefined-flag mask, memory, and the bus requests in order, address, size and value; the
// form of every step list; the order of the requests against the data bus cycles of SingleStepTests/8086 v1 ([TEST], a
// CMOS P80C86A-2; skipped with a message when the suite is absent; the full replay is `node tools/i8086/lockstep.mjs`,
// recorded in docs/verification/i8086-microops.md); the six templates; 20 000 generated instructions; hand cases for the
// routines of design §5; planted faults. Agreement of two of the simulator's own models is not evidence about the
// 8086's microcode (CLAUDE.md rule 7); the [TEST] order check is evidence about the order of bus cycles only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execute, CPU_REGS } from '../src/arch/i8086/cpu.js';
import { runMicro, undefinedFlags, HARDWIRED, PLACES, STEP_KINDS } from '../src/arch/i8086/microops.js';
import { decodeBytes, BY_OPCODE } from '../src/arch/i8086/isa.js';
import { memoryImage } from '../src/arch/i8086/language.js';
import { initialRegisters } from '../src/arch/i8086/engine.js';
import { descriptor } from '../src/arch/i8086/index.js';
import { available, files, load, SST_DIR } from '../tools/i8086/sst.mjs';
import { compareOnce, lockstepFile, formProblems, requestAccesses, testAccesses } from '../tools/i8086/lockstep.mjs';

const skipSST = available() ? false : `SingleStepTests/8086 not found at ${SST_DIR}`;

// a small seeded generator (mulberry32)
const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const fillOf = (seed) => (a) => (Math.imul(a ^ seed, 2654435761) >>> 24) & 0xff;

/** One instruction from bytes, at CS:IP of `regs`, on a memory filled by `fill`. */
const at = (regs, bytes) => bytes.map((b, k) => [((regs.CS << 4) + ((regs.IP + k) & 0xffff)) & 0xfffff, b]);
const base = () => ({ AX: 0x1234, BX: 0x0100, CX: 3, DX: 0x5678, SP: 0x0200, BP: 0x0300, SI: 0x0010, DI: 0x0020, CS: 0x1000, DS: 0x2000, ES: 0x3000, SS: 0x4000, IP: 0x0100, FLAGS: 0xf002 });
const micro = (regs, bytes, fill = () => 0) => {
  const mem = new Map(at(regs, bytes));
  const c = { ...regs };
  const r = runMicro(c, { read: (a) => (mem.has(a) ? mem.get(a) : fill(a)), write: (a, v) => mem.set(a, v), peek: (a) => (mem.has(a) ? mem.get(a) : fill(a)) });
  return { r, c, mem };
};

test('i8086 B3: the places and step kinds are those of the design (§2, §3); hardwired instructions are not shown as microcoded (§4)', () => {
  assert.deepEqual(Object.keys(PLACES).filter((p) => PLACES[p] === 're').sort(), ['IND', 'OPR', 'tmpA', 'tmpB', 'tmpC', 'Σ'].sort());
  assert.deepEqual([...STEP_KINDS], ['queue', 'move', 'alu', 'bus', 'jump', 'hardwired', 'end']);
  for (const [m, op] of [['CLC', 0xf8], ['STC', 0xf9], ['CMC', 0xf5], ['CLI', 0xfa], ['STI', 0xfb], ['CLD', 0xfc], ['STD', 0xfd], ['HLT', 0xf4]]) {
    assert.ok(HARDWIRED.has(m));
    const { r } = micro(base(), [op]);
    assert.deepEqual(r.steps.map((s) => s.kind), ['queue', 'hardwired', 'end'], m);
  }
  // a prefix is a hardwired step; the instruction after it is not
  const { r } = micro(base(), [0x26, 0x8b, 0x07]); // MOV AX, ES:[BX]
  assert.equal(r.steps[0].kind, 'hardwired');
  assert.ok(r.steps.slice(1).every((s) => s.kind !== 'hardwired'));
});

test('i8086 B3: the effective-address routine (§5): [BX+SI+d8] in four steps, [d16] in two; BP-based forms use SS', () => {
  const eaSteps = (bytes) => { const { r } = micro(base(), bytes); return r.steps.slice(2, r.steps.findIndex((s) => s.kind === 'bus')); };
  assert.equal(eaSteps([0x8b, 0x40, 0x05]).length, 4); // MOV AX, [BX+SI+05H]
  assert.equal(eaSteps([0x8b, 0x06, 0x34, 0x12]).length, 2); // MOV AX, [1234H]
  const { r } = micro(base(), [0x8b, 0x46, 0x02]); // MOV AX, [BP+02H]
  assert.equal(r.requests[0].segment, 'SS');
  assert.equal(r.requests[0].address, (0x4000 << 4) + 0x0302);
});

test('i8086 B3: interrupt entry reads the vector before the three pushes ([TEST] order); the target and frame are right', () => {
  const regs = base();
  const vec = [[0x21 * 4, 0x00], [0x21 * 4 + 1, 0x05], [0x21 * 4 + 2, 0x00], [0x21 * 4 + 3, 0x60]];
  const mem = new Map([...at(regs, [0xcd, 0x21]), ...vec]);
  const c = { ...regs };
  const r = runMicro(c, { read: (a) => mem.get(a) ?? 0, write: (a, v) => mem.set(a, v), peek: (a) => mem.get(a) ?? 0 });
  assert.deepEqual(r.requests.map((q) => `${q.op} ${q.address.toString(16)}`), ['read 84', 'read 86', 'write 401fe', 'write 401fc', 'write 401fa']);
  assert.deepEqual([c.CS, c.IP, c.SP], [0x6000, 0x0500, 0x01fa]);
  assert.equal(mem.get(0x401fa) | (mem.get(0x401fb) << 8), 0x0102); // the return address: the next instruction
  assert.equal(r.steps.at(-2).kind, 'jump');
  assert.ok(r.steps.at(-2).flush);
});

test('i8086 B3: multiply and divide are loops of 8 or 16 steps (§5); a divisor of 0 and an IDIV quotient of -128 are divide errors', () => {
  const iters = (r) => r.steps.filter((s) => s.iteration && /multiply step|divide step/.test(s.alu?.op ?? '')).length;
  assert.equal(iters(micro({ ...base(), AX: 0x00f0, BX: 0x0003 }, [0xf6, 0xe3]).r), 8); // MUL BL
  assert.equal(iters(micro({ ...base(), AX: 0xfff0, BX: 0x0003 }, [0xf7, 0xe3]).r), 16); // MUL BX
  const imul = micro({ ...base(), AX: 0xfffd, BX: 0x0007 }, [0xf7, 0xeb]); // IMUL BX: -3 * 7
  assert.deepEqual([imul.c.DX, imul.c.AX], [0xffff, 0xffeb]);
  const div = micro({ ...base(), AX: 0x0064, BX: 0x0007 }, [0xf6, 0xf3]); // DIV BL: 100 / 7
  assert.equal(div.c.AX, 0x020e);
  const zero = micro({ ...base(), BX: 0 }, [0xf6, 0xf3], fillOf(1));
  assert.equal(zero.r.trap?.label, 'divide error');
  const m128 = micro({ ...base(), AX: 0xff80, BX: 0x0001 }, [0xf6, 0xfb], fillOf(2)); // IDIV BL: -128 / 1
  assert.equal(m128.r.interrupt, 0);
});

test('i8086 B3: REP MOVSB as iterations; a shift of memory by CL = 0 still reads and writes it back ([TEST])', () => {
  const { r } = micro({ ...base(), CX: 3 }, [0xf3, 0xa4], fillOf(3));
  assert.deepEqual([...new Set(r.steps.filter((s) => s.iteration).map((s) => s.iteration.n))], [1, 2, 3]);
  assert.equal(r.requests.length, 6);
  const sh = micro({ ...base(), CX: 0x0100 }, [0xd2, 0x27], fillOf(4)); // SHL BYTE PTR [BX], CL with CL = 0
  assert.deepEqual(sh.r.requests.map((q) => q.op), ['read', 'write']);
  assert.equal(sh.r.requests[1].value, sh.r.requests[0].value);
});

test('i8086 B3: 20 000 generated instructions agree with the instruction-level engine', () => {
  const next = rng(8086);
  const ops = [];
  for (let op = 0; op < 256; op++) {
    const e = BY_OPCODE[op];
    if (!e) continue;
    if (Array.isArray(e) ? e.every((x) => !x || x.status !== 'normal') : e.status !== 'normal') continue;
    ops.push(op);
  }
  const bad = [];
  let ran = 0;
  for (let i = 0; i < 20000; i++) {
    const r16 = () => Math.floor(next() * 0x10000);
    const pre = [];
    if (next() < 0.15) pre.push([0x26, 0x2e, 0x36, 0x3e][Math.floor(next() * 4)]);
    const op = ops[Math.floor(next() * ops.length)];
    if (next() < 0.5 && ((op >= 0xa4 && op <= 0xa7) || (op >= 0xaa && op <= 0xaf))) pre.push(next() < 0.5 ? 0xf3 : 0xf2);
    const bytes = [...pre, op, ...Array.from({ length: 6 }, () => Math.floor(next() * 256))];
    const d = decodeBytes(bytes);
    if (d.error || d.status !== 'normal') continue;
    const regs = Object.fromEntries(CPU_REGS.map((k) => [k, r16()]));
    regs.FLAGS = (regs.FLAGS & 0x0fd5) | 0xf002;
    if (d.rep) regs.CX &= 0x7f;
    const res = compareOnce(regs, at(regs, bytes.slice(0, d.length)), { fill: fillOf(i) });
    ran += 1;
    if (res.diffs.length) bad.push(`${bytes.slice(0, d.length).map((b) => b.toString(16).padStart(2, '0')).join(' ')}: ${res.diffs.slice(0, 3).join('; ')}`);
    if (bad.length > 5) break;
  }
  assert.deepEqual(bad, []);
  assert.ok(ran > 15000, `${ran} ran`);
});

test('i8086 B3: the six templates run to HLT in lock-step (registers and memory after every instruction)', () => {
  const dir = new URL('../content/i8086/templates/', import.meta.url);
  const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
  for (const t of index.templates) {
    for (const profile of t.id === 'segments' ? ['flat', 'segmented'] : ['flat']) {
      const p = descriptor.language.assemble([{ name: t.file, text: readFileSync(new URL(t.file, dir), 'utf8') }], { profile });
      assert.ok(p.ok, t.id);
      const memA = memoryImage(p); const memB = memA.slice();
      const busOf = (mem) => ({ read: (a) => mem[a & 0xfffff], write: (a, v) => { mem[a & 0xfffff] = v; }, peek: (a) => mem[a & 0xfffff], output: () => {} });
      const a = initialRegisters(p); const b = { ...a };
      let n = 0;
      for (; n < 200000; n++) {
        const l1 = execute(a, busOf(memA), { emptyVector: true });
        const mi = runMicro(b, busOf(memB), { emptyVector: true });
        assert.equal(mi.error ?? null, l1.error ?? null, `${t.id} at ${n}`);
        const mask = ~undefinedFlags(mi.d) & 0xffff;
        for (const r of CPU_REGS) assert.equal((a[r] ^ b[r]) & (r === 'FLAGS' ? mask : 0xffff), 0, `${t.id}: ${r} after instruction ${n}`);
        assert.deepEqual(mi.writes, l1.writes, `${t.id}: writes of instruction ${n}`);
        assert.deepEqual(formProblems(mi), [], `${t.id}: instruction ${n}`);
        if (l1.halt || l1.error) break;
        // the undefined flags may differ (masked above); both models go on from the same FLAGS
        if (a.FLAGS !== b.FLAGS) b.FLAGS = a.FLAGS;
      }
      assert.ok(n < 200000, `${t.id} halts`);
      assert.ok(memA.every((v, i) => v === memB[i]), `${t.id}: memory`);
    }
  }
});

test('i8086 B3 [TEST]: lock-step and the order of bus requests, 25 tests of each normal SingleStepTests file; the undefined-flag masks equal the metadata', { skip: skipSST }, () => {
  const normal = files().filter((f) => f.status === 'normal' && existsSync(join(SST_DIR, `${f.name}.json.gz`)));
  assert.ok(normal.length >= 270);
  const bad = [];
  let pass = 0;
  for (const f of normal) {
    const tests = load(f.name);
    const r = lockstepFile(f, { limit: 25, keep: 1, tests });
    pass += r.pass;
    if (r.fail) bad.push(`${f.name}: ${r.failures.map((x) => `${x.name}: ${x.diffs.join('; ')}`).join(' | ')}`);
    const t = tests.find((x) => { const d = decodeBytes(x.bytes); return !d.error && d.status === 'normal'; });
    if (t && undefinedFlags(decodeBytes(t.bytes)) !== (~f.mask & 0xffff)) bad.push(`${f.name}: undefined flags ${undefinedFlags(decodeBytes(t.bytes)).toString(16)}, metadata mask ${f.mask.toString(16)}`);
  }
  assert.deepEqual(bad, []);
  assert.ok(pass > 6000, `${pass} passed`);
});

test('i8086 B3: planted faults are caught (a carry ignored, a wrong push, a missing read, the wrong default segment, a swapped order, a broken list)', async () => {
  const src = readFileSync(new URL('../src/arch/i8086/microops.js', import.meta.url), 'utf8')
    .replace("from './isa.js'", `from '${pathToFileURL(join(process.cwd(), 'src/arch/i8086/isa.js')).href}'`);
  const dir = mkdtempSync(join(tmpdir(), 'mavilera-microops-'));
  const plant = async (name, from, to) => {
    assert.ok(src.includes(from), `${name}: fault site`);
    const file = join(dir, `${name}.mjs`);
    writeFileSync(file, src.replace(from, to));
    return (await import(pathToFileURL(file).href)).runMicro;
  };
  const caught = (run, regs, bytes, fill = fillOf(5)) => compareOnce(regs, at(regs, bytes), { fill, micro: run }).diffs.length > 0;
  const adc = await plant('adc', "case 'add with carry': return addf(a, b, cin, false);", "case 'add with carry': return addf(a, b, 0, false);");
  assert.ok(caught(adc, { ...base(), FLAGS: 0xf003 }, [0x11, 0xd8])); // ADC AX, BX with CF set
  const pushFault = await plant('push', "aluStep('subtract', 'SP', 2, 16, { to: 'SP' });", "aluStep('subtract', 'SP', 4, 16, { to: 'SP' });");
  assert.ok(caught(pushFault, base(), [0x50])); // PUSH AX
  const xlat = await plant('xlat', "request('read', d.seg ?? 'DS', 'IND', 8);", '');
  assert.ok(caught(xlat, base(), [0xd7]));
  const seg = await plant('seg', "regs[0] === 'BP' ? 'SS' : 'DS'", "'DS'");
  assert.ok(caught(seg, base(), [0x8b, 0x46, 0x02])); // MOV AX, [BP+02H]
  // the order check: a reversed request list differs from the bus cycles it came from
  const { r } = micro(base(), [0xcd, 0x21], fillOf(6));
  const accesses = requestAccesses(r.requests);
  const fake = { cycles: r.requests.flatMap((q) => [[1, q.address, '--', '---', '---', q.size === 16 && !(q.address & 1) ? 0 : 1, 0, q.op === 'read' ? 'MEMR' : 'MEMW', 'T1', '-', 0]]) };
  assert.deepEqual(testAccesses(fake), accesses);
  assert.notDeepEqual(requestAccesses([...r.requests].reverse()), testAccesses(fake));
  // the form checks
  assert.ok(formProblems({ ...r, steps: r.steps.slice(0, -1) }).length > 0);
  assert.ok(formProblems({ ...r, length: r.length + 1 }).length > 0);
  assert.ok(formProblems({ ...r, steps: [{ kind: 'move', transfers: [{ from: 'AX', to: 'BX' }, { from: 'CX', to: 'BX' }] }, { kind: 'end' }] }).length > 0);
});
