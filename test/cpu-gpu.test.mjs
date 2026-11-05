// The CPU + GPU tool (GPU-7, decision G30): the GPU device joins the platform only when asked (the tool's pages), the
// tool is a hosted tool of the RISC-V module reached from the GPU entry of the switcher, its template is what
// tools/gpu/host-templates.mjs writes, and that host program runs its kernel on the GPU: on the single-cycle processor
// (the tool's views) and on the instruction-level model (its Instructions view) it leaves y = |x| in its own memory
// and in the GPU's, and step back on the instruction-level model returns every state.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GpuDevice, GPU_BASE, GPU_REG } from '../src/mem/gpu.js';
import { Platform } from '../src/mem/platform.js';
import { Session, STOP } from '../src/core/session.js';
import { MemorySystem } from '../src/mem/system.js';
import { SingleCycle } from '../src/uarch/single.js';
import { assemble } from '../src/asm/assembler.js';
import { defaultPlatform, normalisePlatform } from '../src/shell/share.js';
import { PLATFORM_ARCHS, HOSTED_TOOLS, currentTool, switchTargets, toolViews } from '../src/shell/platform-archs.js';
import { GPU_DP } from '../src/arch/riscv/gpu-datapath.js';
import { withDeviceSignals, npuPart } from '../src/mem/npu-wave.js';
import { gpuPart, GPU_WAVE_SIGNALS } from '../src/mem/gpu.js';
import { kernelWords, hostText } from '../src/arch/gpu/rvsimt/host-words.js';
import { assemble as simtAssemble } from '../src/arch/gpu/rvsimt/language.js';
import { buildMemsys, defaultConfig } from '../src/mem/config.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TEMPLATE = readFileSync(join(ROOT, 'content/templates/cpu-gpu-abs.s'), 'utf8');
const X = [5, -3, 0, -7, 2, -1, 4, -8];
const ABS = X.map(Math.abs);

test('the GPU joins the platform only when asked; the setting keeps it; the RISC-V pages have no GPU', () => {
  assert.equal(new Platform().gpu, null);
  assert.ok(new Platform({ gpu: true }).gpu instanceof GpuDevice);
  assert.ok(new Platform({ gpu: true }).devices().some((d) => d.base === GPU_BASE && d.device instanceof GpuDevice));
  assert.equal(defaultPlatform().gpu, false);
  assert.equal(normalisePlatform({ gpu: true }).gpu, true);
});

test('the CPU + GPU tool: a hosted tool of the RISC-V module, within the GPU entry; no switcher entry of its own', async () => {
  const { descriptor } = await import('../src/arch/riscv/index.js');
  const t = currentTool('riscv', '?arch=riscv&tool=cpu-gpu');
  assert.equal(t, HOSTED_TOOLS[0]);
  assert.deepEqual([t.within, t.view, t.profile, t.platform.gpu], ['gpu', 'gpu-host', 'ch11', true]);
  assert.deepEqual(toolViews(descriptor, t).map((v) => v.id), ['isa', 'gpu-single', 'gpu-host']);
  assert.ok(!PLATFORM_ARCHS.some((a) => a.id === 'cpu-gpu'));
  const dev = { protocol: 'http:', href: 'http://127.0.0.1:8000/', release: false };
  assert.ok(!switchTargets('riscv', dev).some((x) => x.id === 'cpu-gpu'));
  assert.deepEqual(toolViews(descriptor, currentTool('riscv', '')).map((v) => v.id), ['isa', 'single', 'multi', 'pipe', 'compare']);
});

test('the template is the generator\'s; the template index shows it on the tool\'s page only', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools/gpu/host-templates.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const ix = JSON.parse(readFileSync(join(ROOT, 'content/templates/index.json'), 'utf8'));
  const e = ix.templates.find((x) => x.id === 'cpu-gpu-abs');
  assert.deepEqual([e.tool, e.view, e.group, Boolean(ix.groups[e.group])], ['cpu-gpu', 'gpu-host', 'gpu', true]);
});

test('on the single-cycle host: the template runs its kernel on the GPU and copies y = |x| back', () => {
  const T6 = JSON.parse(readFileSync(join(ROOT, 'content/data/ch06-tables.json'), 'utf8'));
  const ms = new MemorySystem();
  const gpu = new GpuDevice();
  ms.addDevice(GPU_BASE, gpu);
  const m = new SingleCycle(T6, { memsys: ms });
  const p = assemble([{ name: 'cpu-gpu-abs.s', text: TEMPLATE }], { profile: 'ch06' });
  assert.ok(p.ok, p.errors.map((e) => e.message).join());
  m.load(p);
  let r;
  do r = m.step(); while (r === 'step' && m.cycle < 5000);
  assert.equal(r, 'halt', m.error ?? '');
  const y = p.symbols.get('y');
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => m.dmem.read(y + 4 * i, 4) | 0), ABS, 'host memory');
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => gpu.peek(GPU_REG.DMEM + 32 + 4 * i) | 0), ABS, 'GPU memory');
  assert.equal(gpu.peek(GPU_REG.STATUS), 2, 'DONE, no fault');
  assert.equal(gpu.counters.launches, 1);
  // the poll loop is three instructions: the host reads STATUS once in three GPU issues while the kernel runs
  const issued = gpu.peek(GPU_REG.ISSUED);
  assert.ok(gpu.counters.statusReads >= Math.floor(issued / 3) && gpu.counters.statusReads <= Math.ceil(issued / 3) + 1,
    `${gpu.counters.statusReads} STATUS reads for ${issued} issues`);
});

test('on the instruction-level model (profile ch11, the tool\'s platform): the same result; step back over every step', () => {
  const s = new Session();
  s.profile = 'ch11';
  s.files = [{ name: 'cpu-gpu-abs.s', text: TEMPLATE }];
  s.platformConfig = normalisePlatform({ gpu: true });
  s.assemble();
  assert.ok(s.program.ok, s.program.errors?.map((e) => e.message).join());
  const gpu = s.hart.platform.gpu;
  assert.ok(gpu instanceof GpuDevice);
  const print = () => JSON.stringify({ x: Array.from(s.hart.x), pc: s.hart.pc, regs: [0, 4, 0x10, 0x14, 0x18, 0x800, 0x820, 0x83c].map((o) => gpu.peek(o)) });
  const prints = [print()];
  let n = 0;
  while (s.step() === STOP.NONE && n < 5000) { prints.push(print()); n++; }
  assert.equal(s.hart.halted, true, s.error);
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => gpu.peek(GPU_REG.DMEM + 32 + 4 * i) | 0), ABS);
  for (let i = prints.length - 1; i >= 0; i--) {
    assert.equal(print(), prints[i], `at step ${i}`);
    if (i > 0) assert.ok(s.back(), `back from ${i}`);
  }
});

test('the single-cycle drawing with the GPU: the block at 0x5000_1000, MAVILERA\'s names, a GPU access routed to it', () => {
  const g = GPU_DP.extend({ alt: 'x', elements: [{ id: 'dm', at: [10, 0] }], wires: [{ id: 'dm_rm', points: [[0, 0]], signal: 'rdata' }], control: [], labels: [], junctions: [] });
  assert.ok(g.elements.some((e) => e.id === 'gpu'));
  assert.ok(g.labels.some((l) => l.text === 'GPU\n0x5000_1000'));
  assert.deepEqual(Object.keys(GPU_DP.info).sort(), ['gpu_rdata', 'ram_rdata', 'sel_gpu', 'sel_ram']);
  const s = { MemWrite: 0, ResultSel: 1, alu_y: GPU_BASE + 4, rdata: 2 };
  assert.deepEqual(GPU_DP.values(s), { sel_gpu: 1, sel_ram: 0, gpu_rdata: 2, ram_rdata: 0 });
  assert.ok(GPU_DP.path(s, { wires: ['alu_dm', 'result_rf'], elements: ['dm'] }).elements.has('gpu'));
});

test('the GPU\'s signals join the waveform frames: a start, busy for the kernel\'s issues, the coming warp and mask', () => {
  const T6 = JSON.parse(readFileSync(join(ROOT, 'content/data/ch06-tables.json'), 'utf8'));
  const platform = new Platform({ gpu: true });
  const memsys = buildMemsys({ ...defaultConfig(), devices: true }, { platform }).memsys;
  const m = new SingleCycle(T6, { memsys });
  const p = assemble([{ name: 'cpu-gpu-abs.s', text: TEMPLATE }], { profile: 'ch06' });
  m.load(p);
  const x = withDeviceSignals({ model: m, signals: [] }, [npuPart(platform), gpuPart(platform)].filter(Boolean));
  assert.deepEqual(x.signals.filter((s) => s.kind === 'gpu').map((s) => s.name), GPU_WAVE_SIGNALS.map((s) => s.name));
  const frames = [];
  for (let k = 0; k < 5000; k++) { const f = x.model.evaluate().signals; frames.push(f); if (x.model.step() !== 'step') break; }
  assert.equal(frames.filter((f) => f['gpu.start']).length, 1, 'one start');
  const busy = frames.filter((f) => f['gpu.busy']).length;
  assert.equal(busy, platform.gpu.peek(GPU_REG.ISSUED), 'busy in as many cycles as the kernel issues');
  assert.ok(frames.some((f) => f['gpu.busy'] && f['gpu.mask'] !== 0b1111), 'a divergent mask while busy');
  assert.ok(frames.every((f) => !f['gpu.sel'] || f['gpu.d_addr'] >= GPU_BASE), 'the bus side carries the GPU addresses');
});

test('a kernel as words for a host: the template\'s kernel lines are the helper\'s; data words follow; notes for other programs', async () => {
  const kernelSrc = TEMPLATE.split('\n').filter((l) => /^\s+\.word\s+0x[0-9a-f]{8}\s+#/.test(l));
  const src = '.include "simt.inc"\n_start: li t0, 2\n        la t1, kernel\n        wspawn t0, t1\nkernel: csrr t0, THREAD_INDEX\n        slli t0, t0, 2\n        lw t1, 0(t0)\n'
    + '        slt t2, t1, zero\n        split t2\n        beqz t2, 1f\n        sub t1, zero, t1\n1:      join\n        sw t1, 32(t0)\n        tmc zero\n';
  const k = simtAssemble([{ name: 'k.s', text: src }], { profile: 'lab' });
  assert.ok(k.ok);
  assert.deepEqual(kernelWords(k).code.map((l) => l.replace(/\s+#.*/, '').trim()), kernelSrc.map((l) => l.replace(/\s+#.*/, '').trim()));
  const withData = simtAssemble([{ name: 'k.s', text: `${src}        .data\nx: .word 5, -3\n` }], { profile: 'lab' });
  const text = hostText(withData);
  assert.match(text, /^kernel:$/m);
  assert.match(text, /^kernel_data:\n {8}\.word {2}0x00000005, 0xfffffffd$/m);
  const host = assemble([{ name: 'h.s', text: `.data\n${text}` }], { profile: 'ch06' });
  assert.ok(host.ok, host.errors?.map((e) => e.message).join('; '));
  const { kernelForHost } = await import('../src/arch/gpu/ui/cpu-gpu-link.js');
  assert.ok(kernelForHost(withData).text);
  assert.match(kernelForHost(null).note, /Assemble a kernel/);
  assert.match(kernelForHost(simtAssemble([{ name: 'k.s', text: 'tmc zero\n' }], { profile: 'lab-l8' })).note, /two warps of four lanes/);
});
