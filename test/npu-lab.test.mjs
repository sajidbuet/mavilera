// npu-lab.test.mjs -- the Chapter 11 laboratory on MAVILERA's hosts (NPU-2, tests N17-N28 of
// docs/research/gpu-npu/verification/GOLDEN_TESTS.md): the book's programs sw_mv and npu_mv on the data sets v1, v4
// and v16 give the book's golden dumps (tb_npu_soc's format) on the instruction level (profile ch11) and on the
// single-cycle host with the platform devices, every word in full (the book's files place the NPU at 0x5000_0000,
// decision G1, since its commit c2dc4c4). Then Table 11.5's mul column, the offload breakdown of WE 11.9, the
// images, the sub-word fault (G5), the address map with the NPU (G1, Q6) and a RESULT read while busy (G5).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { assemble } from '../src/asm/assembler.js';
import { Hart } from '../src/core/iss.js';
import { Session, STOP } from '../src/core/session.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { Platform } from '../src/mem/platform.js';
import { buildMemsys, defaultConfig } from '../src/mem/config.js';
import { GPIO_BASE, TIMER_BASE, UART_BASE } from '../src/mem/devices.js';
import { NPU_BASE } from '../src/mem/npu.js';
import { parseHexWords } from '../src/shell/data-io.js';
import { descriptor as riscv } from '../src/arch/riscv/index.js';
import { ch07 } from './ch07-content.mjs';
import { ROOT } from './npu-fixtures.mjs';

const FIX = join(ROOT, 'test', 'fixtures', 'npu');
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const NPU_LINE = '.equ NPU,    0x50000000';
const SETS = ['v1', 'v4', 'v16'];

// every laboratory fixture as copied (hashes in test/fixtures/npu/README.md)
const HASHES = new Map([...readFileSync(join(FIX, 'README.md'), 'utf8').matchAll(/^\| `(ch11\/[^`]+)` \| [^|]+ \| `([0-9a-f]{64})` \|$/gm)]
  .map((m) => [m[1], m[2]]));
function fixture(path) {
  const buf = readFileSync(join(FIX, path));
  assert.equal(createHash('sha256').update(buf).digest('hex'), HASHES.get(path), `${path} as copied (README)`);
  return buf.toString('utf8');
}
const words = (text) => text.split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16) >>> 0);

test('the fixtures: fourteen files, each with the hash of its README row', () => {
  assert.equal(HASHES.size, 14);
  for (const path of HASHES.keys()) fixture(path);
});

/** The book's program, unchanged; npu_mv names the NPU at MAVILERA's address (decision G1), as the book now does. */
function source(prog) {
  const text = fixture(`ch11/programs/${prog}/prog.s`);
  if (prog === 'npu_mv') assert.ok(text.includes(NPU_LINE), 'the book\'s NPU at 0x5000_0000');
  return text;
}

/** The program with data.hex in the RAM from address 0, as tb_npu_soc's $readmemh. */
function program(prog, set, profile) {
  const p = assemble([{ name: 'prog.s', text: source(prog) }], { profile });
  assert.ok(p.ok && !p.profileErrors.length, [...p.errors, ...p.profileErrors].map((e) => e.message).join('; '));
  const bytes = parseHexWords(fixture(`ch11/data/${set}/data.hex`));
  assert.equal(bytes.length, 512);
  return { ...p, segments: [...p.segments, { address: 0, bytes, executable: false }] };
}

/** tb_npu_soc's dump: x0-x31, halt PC, cycles, RAM words 0-127, NPU accesses, STATUS reads, K, K (cycle, OUT) pairs. */
function dump({ x, pc, cycles, ram, platform }) {
  const { markers, npu } = platform.measurement();
  return [...Array.from(x), pc, cycles, ...ram, npu.accesses, npu.statusReads, markers.length, ...markers.flatMap((m) => [m.cycle, m.out])].map((v) => v >>> 0);
}

function onIss(prog, set) {
  const platform = new Platform();
  const h = new Hart(program(prog, set, 'ch11'), { profile: 'ch11', platform });
  while (!h.halted && h.instret < 100_000) h.stepFast();
  assert.ok(h.halted);
  assert.equal(h.cycle, h.instret, 'one cycle per instruction');
  return { h, platform, words: dump({ x: h.x, pc: h.pc, cycles: h.cycle, ram: Array.from({ length: 128 }, (_, i) => h.mem.read(4 * i, 4)), platform }) };
}

function singleOn(memOptions = {}) {
  const platform = new Platform();
  const { memsys } = buildMemsys({ ...defaultConfig(), words: 1024, devices: true, ...memOptions }, { platform });
  assert.ok(memsys?.platform === platform);
  return { m: new SingleCycle(T6, { memsys, historyLimit: 0 }), platform };
}

function onSingle(prog, set, onStep = null) {
  const { m, platform } = singleOn();
  m.load(program(prog, set, 'ch06'));
  let r;
  do { onStep?.(m, platform); r = m.step(); } while (r === 'step' && m.cycle < 100_000);
  assert.equal(r, 'halt', m.error ?? r);
  return { m, platform, words: dump({ x: m.x, pc: m.pc, cycles: m.cycle, ram: Array.from(m.dmem.words.slice(0, 128)), platform }) };
}

/** Compare with golden.hex: every word (x9 of npu_mv is the NPU's base, the same in the book and here). */
function compareGolden(got, prog, set) {
  const g = words(fixture(`ch11/programs/${prog}/${set}/golden.hex`));
  const n = 165 + 2 * g[164];
  assert.equal(got.length, n, 'as many OUT changes as the golden dump');
  if (prog === 'npu_mv') assert.equal(g[9], NPU_BASE, 'the book\'s x9: the NPU base of decision G1');
  for (let i = 0; i < n; i++) {
    const what = i < 32 ? `x${i}` : i === 32 ? 'halt PC' : i === 33 ? 'cycles' : i < 162 ? `RAM word ${i - 34}` : ['NPU accesses', 'STATUS reads', 'K'][i - 162] ?? `pair ${(i - 165) >> 1}`;
    assert.equal(got[i], g[i], `${prog} ${set}: ${what}`);
  }
}

for (const prog of ['sw_mv', 'npu_mv']) {
  for (const set of SETS) {
    test(`N17-N22: ${prog} ${set} gives golden.hex on the instruction level (ch11) and on the single-cycle host`, () => {
      const iss = onIss(prog, set);
      compareGolden(iss.words, prog, set);
      const sc = onSingle(prog, set);
      compareGolden(sc.words, prog, set);
      assert.deepEqual(sc.words, iss.words, 'the two hosts agree on every word');
    });
  }
}

test('Table 11.5: the cycles between the markers, shift-and-add and NPU (Icarus Verilog runs in the book)', () => {
  const span = (r, a, b) => r.platform.measurement().spans.filter((s) => s.from >= a && s.to <= b).reduce((t, s) => t + s.cycles, 0);
  assert.deepEqual(SETS.map((v) => span(onSingle('sw_mv', v), 1, 2)), [821, 3718, 15646]);
  assert.deepEqual(SETS.map((v) => span(onSingle('npu_mv', v), 1, 3)), [51, 153, 561]);
});

test('N23: sw_mv_m (mul) on the instruction level: marker spans 209, 818 and 3254 (Table 11.5, the book\'s simulator)', () => {
  const spans = SETS.map((v) => {
    const r = onIss('sw_mv_m', v);
    const s = r.platform.measurement().spans;
    assert.equal(s.length, 1);
    return s[0].cycles;
  });
  assert.deepEqual(spans, [209, 818, 3254]);
  const p = assemble([{ name: 'prog.s', text: source('sw_mv_m') }], { profile: 'ch06' });
  assert.ok(p.profileErrors.some((e) => e.mnemonic === 'mul'), 'the laboratory core (the single-cycle view) has no mul');
});

test('N24: WE 11.9 offload breakdown of npu_mv v4: 9 + 12 + 8 + 5 = 34 cycles per vector, 13 NPU transactions, 4 polls', () => {
  const p = program('npu_mv', 'v4', 'ch06');
  const vec = p.symbols.get('vec');
  const at = [];
  onSingle('npu_mv', 'v4', (m, pl) => { if (m.pc === vec) at.push({ cycle: m.cycle, ...pl.npu.counters }); });
  assert.equal(at.length, 5, 'four vectors, then the exit test');
  for (let k = 1; k < at.length; k++) {
    assert.equal(at[k].cycle - at[k - 1].cycle, 9 + 12 + 8 + 5, `vector ${k - 1}`);
    assert.equal(at[k].accesses - at[k - 1].accesses, 13);
    assert.equal(at[k].statusReads - at[k - 1].statusReads, 4);
    assert.equal(at[k].runs - at[k - 1].runs, 1);
  }
});

test('N25: MAVILERA assembles the book\'s sw_mv/prog.s and npu_mv/prog.s to the words of prog.hex', () => {
  for (const prog of ['sw_mv', 'npu_mv']) {
    const p = assemble([{ name: 'prog.s', text: fixture(`ch11/programs/${prog}/prog.s`) }], { profile: 'ch06' }); // the book's own text
    assert.ok(p.ok && !p.profileErrors.length);
    const code = p.segments.find((s) => s.executable).bytes;
    const got = Array.from({ length: code.length / 4 }, (_, i) => new DataView(code.buffer, code.byteOffset).getUint32(4 * i, true));
    const want = words(fixture(`ch11/programs/${prog}/prog.hex`));
    assert.equal(want.length, 256);
    assert.deepEqual(got, want.slice(0, got.length), prog);
    assert.ok(want.slice(got.length).every((w) => w === 0), 'the rest of the image is zero');
  }
});

test('the npu-mv template: the book\'s instructions, the NPU at the address of decision G1', () => {
  const book = assemble([{ name: 'a.s', text: source('npu_mv') }], { profile: 'ch06' });
  const tpl = assemble([{ name: 'npu-mv.s', text: readFileSync(join(ROOT, 'content', 'templates', 'npu-mv.s'), 'utf8') }], { profile: 'ch06' });
  assert.ok(tpl.ok && !tpl.profileErrors.length);
  const code = (p) => Array.from(p.segments.find((s) => s.executable).bytes);
  assert.deepEqual(code(tpl), code(book));
  const data = tpl.segments.find((s) => !s.executable);
  assert.equal(data.address, 0);
  assert.deepEqual(Array.from(data.bytes), Array.from(parseHexWords(fixture('ch11/data/v4/data.hex'))), 'the data set v4 at address 0');
});

test('the three laboratory templates are what tools/npu/lab-templates.mjs writes from the fixtures', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'npu', 'lab-templates.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

const SUBWORD ='        li   s1, 0x50000000\n        li   t0, 7\n        sb   t0, 0x10(s1)\n        halt\n';

test('N26: a byte store to the NPU is a bus fault "the NPU takes whole words" (decision G5)', () => {
  for (const profile of ['ch11', 'iss-priv']) {
    const s = new Session();
    s.profile = profile;
    s.files = [{ name: 'a.s', text: SUBWORD }];
    s.assemble();
    assert.ok(s.runnable, profile);
    assert.equal(s.run(), STOP.ERROR, profile);
    assert.match(s.error, /bus fault: NPU does not accept a 1-byte access \(the NPU takes whole words, Table 11\.4\)/, profile);
  }
  const { m } = singleOn();
  const p = assemble([{ name: 'a.s', text: '        li   s1, 0x50000000\n        lw   t0, 0x10(s1)\n        halt\n' }], { profile: 'ch06' });
  m.load(p);
  assert.equal(m.run(), 'halt', 'a word access is fine on the single-cycle host (it has no byte access)');
});

test('N27: the address map with the NPU: GPIO, TIMER, UART and NPU at their slots on every host with the devices', () => {
  const SLOTS = [[GPIO_BASE, 'GPIO'], [TIMER_BASE, 'TIMER'], [UART_BASE, 'UART'], [NPU_BASE, 'NPU'], [NPU_BASE + 0x3c, 'NPU']];
  const check = (map, what) => {
    for (const [a, name] of SLOTS) assert.equal(map.resolve(a).region.name, name, `${what}: 0x${a.toString(16)}`);
    assert.equal(map.resolve(NPU_BASE + 0x1000).region.name, 'ram', `${what}: past the NPU's slot`);
  };
  for (const profile of ['iss-priv', 'ch11']) check(new Hart({ segments: [], entry: 0 }, { profile }).mem.map, profile);
  const t7 = ch07({ jalr: false }).t7;
  for (const [kind, make] of [['single', (ms) => new SingleCycle(T6, { memsys: ms })], ['multi', (ms) => new Multicycle(T6, t7, { memsys: ms })],
    ['pipe', (ms) => new Pipeline(T6, { memsys: ms })]]) {
    for (const words of [256, 1024]) { // the chapter memories wrap (Q6): the device regions still win
      const { memsys } = buildMemsys({ ...defaultConfig(), words, devices: true }, { platform: new Platform() });
      const m = make(memsys);
      m.load({ segments: [] });
      check(memsys.ports.D.map, `${kind}, ${words} words`);
    }
  }
  assert.equal(new Hart({ segments: [], entry: 0 }, { profile: 'ch11', platformConfig: { npu: false } }).mem.map.resolve(NPU_BASE).region.name, 'ram',
    'the NPU can be left out');
});

const BUSY_READ = [
  '        li   s1, 0x50000000',
  '        li   t0, 0x01010101',
  '        sw   t0, 0x10(s1)   # WEIGHT0',
  '        li   t0, 5',
  '        sw   t0, 0x20(s1)   # ACT0',
  '        li   t0, 3',
  '        sw   t0, 0(s1)      # clear and start',
  '        nop',
  '        nop',
  '        lw   t1, 0x30(s1)   # RESULT0, 3 cycles after the start: busy',
  'poll:   lw   t2, 4(s1)',
  '        andi t2, t2, 2',
  '        beq  t2, zero, poll',
  '        lw   t3, 0x30(s1)   # RESULT0 when done',
  '        halt',
].join('\n') + '\n';

test('N28: a RESULT read while busy returns the partial value with a non-fatal diagnostic; the optional stop (G5)', () => {
  const run = (npuStop) => {
    const s = new Session();
    s.profile = 'ch11';
    s.platformConfig = { ...s.platformConfig, npuStop };
    s.files = [{ name: 'a.s', text: BUSY_READ }];
    s.assemble();
    return { s, stop: s.run() };
  };
  const free = run(false);
  assert.equal(free.stop, STOP.HALT);
  assert.equal(free.s.hart.x[6], 0, 't1: the partial value (nothing accumulated yet)');
  assert.equal(free.s.hart.x[28], 5, 't3: y0 = 1 x 5');
  const diag = free.s.hart.platform.npu.diagnostics;
  assert.equal(diag.length, 1);
  assert.equal(diag[0].code, 'result-busy');
  const eng = riscv.engine.create({ ...free.s.program, profile: 'ch11' }, { platformConfig: free.s.platformConfig });
  eng.run({});
  assert.ok(eng.diagnostics().some((d) => d.kind === 'npu' && /RESULT0 read while the NPU is busy/.test(d.message)), 'the engine reports it');
  assert.ok(eng.counters().some(([k, v]) => k === 'NPU runs started' && v === 1));
  const stopped = run(true);
  assert.equal(stopped.stop, STOP.WATCH, 'the run stops after the read');
  assert.equal(stopped.s.hart.pc, free.s.program.symbols.get('poll'));
  assert.equal(stopped.s.run({ resumed: true }), STOP.HALT, 'and continues to the halt');
});

test('back-step on the instruction level (ch11): npu_mv v1 stepped to the halt and back gives every state again', () => {
  const s = new Session({ historyLimit: 10_000 });
  s.profile = 'ch11';
  s.program = program('npu_mv', 'v1', 'ch11');
  s.reset();
  // the NPU's registers, request and counters; its clock is no state while it is idle (docs/architecture/npu-device.md §2)
  const pl = () => { const p = s.hart.platform.snapshot(); const n = p.parts[3]; p.parts[3] = { s: n.s, pending: n.pending, counters: n.counters, diag: n.diagLen }; return p; };
  const snap = () => JSON.stringify({ x: Array.from(s.hart.x), pc: s.hart.pc, c: s.hart.cycle, pl: pl(),
    ram: Array.from({ length: 128 }, (_, i) => s.hart.mem.read(4 * i, 4)) }, (k, v) => (typeof v === 'bigint' ? String(v) : v));
  const states = [];
  let r;
  do { states.push(snap()); r = s.step(); } while (r === STOP.NONE);
  assert.equal(r, STOP.HALT);
  assert.equal(s.hart.platform.measurement().markers.length, 3);
  const arch = (t) => { const o = JSON.parse(t); delete o.pl; return o; }; // the halt's tick only advances the idle devices' time
  assert.deepEqual(arch(snap()), arch(states.at(-1)), 'the halt word changes nothing');
  for (let i = states.length - 2; i >= 0; i--) {
    assert.ok(s.back());
    assert.equal(snap(), states[i], `state ${i}`);
  }
  assert.equal(s.hart.platform.measurement().markers.length, 0, 'the markers are taken back with the steps');
});
