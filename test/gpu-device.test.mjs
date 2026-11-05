// The RISC-V SIMT core as a device of the RISC-V laboratory (GPU-7, decision G30; src/mem/gpu.js, design
// docs/architecture/gpu-host.md): the register map; writes ignored while busy; the launch; one warp-instruction per
// host cycle, so that BUSY lasts as many cycles as the kernel issues; every laboratory program run through the device
// leaves the data memory and counters the GPU module's own run leaves; faults and the deadlock code; snapshot and
// restore give back the same state.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../src/arch/gpu/rvsimt/language.js';
import { loadProgram, runCore } from '../src/arch/gpu/rvsimt/engine.js';
import { GpuDevice, GPU_REG, GPU_CTRL, GPU_STATUS, GPU_DEADLOCK, gpuRegister } from '../src/mem/gpu.js';

const LAB = ['uniform', 'ifelse', 'nested', 'vadd_tail', 'reverse_bar', 'fault_div', 'fault_join'];
const program = (text) => {
  const p = assemble([{ name: 'k.s', text }], { profile: 'lab' });
  assert.ok(p.ok, p.diagnostics.map((d) => d.message).join('; '));
  return p;
};
const template = (id) => program(readFileSync(new URL(`../content/gpu/rvsimt/templates/${id}.s`, import.meta.url), 'utf8'));

/** A host that writes one word per cycle and reads STATUS until DONE, as a polling program would. */
function host(dev) {
  let t = 0;
  return {
    get t() { return t; },
    write(offset, value) { dev.tick(t); dev.write(offset, 4, value, { cycle: t + 1 }); t += 1; },
    read(offset) { dev.tick(t); const v = dev.read(offset, 4, { cycle: t }); t += 1; return v; },
    idle(n = 1) { t += n; dev.tick(t); },
  };
}

function load(dev, h, p) {
  const { prog, data } = loadProgram(p);
  prog.forEach((w, i) => h.write(GPU_REG.IMEM + 4 * i, w));
  data.forEach((w, i) => { if (w) h.write(GPU_REG.DMEM + 4 * i, w); });
}

function runThrough(p) {
  const dev = new GpuDevice();
  const h = host(dev);
  load(dev, h, p);
  h.write(GPU_REG.CTRL, GPU_CTRL.START);
  const launch = h.t; // the edge that ends the START cycle launched the kernel
  let s; let busy = 0;
  while (((s = h.read(GPU_REG.STATUS)) & GPU_STATUS.BUSY) && h.t < 100000) busy += 1;
  const dmem = Array.from({ length: 256 }, (_, i) => dev.peek(GPU_REG.DMEM + 4 * i));
  return { dev, h, s, dmem, launch, busy, counters: [GPU_REG.CYCLES, GPU_REG.ISSUED, GPU_REG.ACTIVE].map((o) => dev.peek(o)) };
}

test('the register map: names, reset values, unused offsets read 0', () => {
  const dev = new GpuDevice();
  assert.deepEqual([0x000, 0x004, 0x008, 0x00c, 0x010, 0x014, 0x018, 0x400, 0x4fc, 0x800, 0xbfc, 0x01c, 0x500].map(gpuRegister),
    ['CTRL', 'STATUS', 'ARGS', 'BLOCK', 'CYCLES', 'ISSUED', 'ACTIVE', 'IMEM[0]', 'IMEM[63]', 'DMEM[0]', 'DMEM[255]', '—', '—']);
  for (const o of [0x000, 0x004, 0x008, 0x010, 0x400, 0x800, 0x01c, 0xffc]) assert.equal(dev.peek(o), 0, o.toString(16));
  const h = host(dev);
  h.write(GPU_REG.ARGS, 0x40); h.write(GPU_REG.BLOCK, 3); h.write(GPU_REG.IMEM + 8, 0x1234); h.write(GPU_REG.DMEM + 0x3fc, 7); h.idle();
  assert.deepEqual([dev.peek(GPU_REG.ARGS), dev.peek(GPU_REG.BLOCK), dev.peek(GPU_REG.IMEM + 8), dev.peek(GPU_REG.DMEM + 0x3fc)], [0x40, 3, 0x1234, 7]);
});

for (const id of LAB) {
  test(`${id}: through the device, the data memory and counters equal the GPU module's run; BUSY lasts one cycle per issue`, () => {
    const p = template(id);
    const ref = runCore(p);
    const r = runThrough(p);
    assert.deepEqual(r.dmem, [...ref.core.dmem], 'data memory');
    assert.deepEqual(r.counters, [ref.core.cycles, ref.core.issued, ref.core.active], 'counters');
    const code = ref.core.fault;
    assert.equal(r.s, GPU_STATUS.DONE | (code ? GPU_STATUS.FAULT | (code << 8) : 0), 'STATUS');
    assert.equal(r.busy, ref.core.issued, 'busy cycles seen by the polling host');
  });
}

test('writes are ignored while busy and counted; CLEAR clears DONE and the fault; START with CLEAR launches', () => {
  const p = program('.include "simt.inc"\nli t0, 20\n1: addi t0, t0, -1\nbnez t0, 1b\nli t1, 9\nsw t1, 0(zero)\ntmc zero\n');
  const dev = new GpuDevice();
  const h = host(dev);
  load(dev, h, p);
  h.write(GPU_REG.CTRL, GPU_CTRL.START);
  h.write(GPU_REG.DMEM, 5); h.write(GPU_REG.IMEM, 0); h.write(GPU_REG.ARGS, 1);
  assert.equal(dev.counters.ignoredWrites, 3);
  while (h.read(GPU_REG.STATUS) & GPU_STATUS.BUSY);
  assert.equal(dev.peek(GPU_REG.DMEM), 9);
  assert.equal(dev.peek(GPU_REG.ARGS), 0);
  h.write(GPU_REG.CTRL, GPU_CTRL.CLEAR); h.idle();
  assert.equal(dev.peek(GPU_REG.STATUS), 0);
  h.write(GPU_REG.CTRL, GPU_CTRL.START | GPU_CTRL.CLEAR); h.idle();
  assert.equal(dev.peek(GPU_REG.STATUS) & GPU_STATUS.BUSY, GPU_STATUS.BUSY);
  assert.equal(dev.counters.launches, 2);
});

test('ARGS and BLOCK reach the identity registers kernel_args and block_index', () => {
  const p = program('.include "simt.inc"\ncsrr t0, KERNEL_ARGS\ncsrr t1, BLOCK_INDEX\nadd t0, t0, t1\nsw t0, 0(zero)\ntmc zero\n');
  const dev = new GpuDevice();
  const h = host(dev);
  load(dev, h, p);
  h.write(GPU_REG.ARGS, 100); h.write(GPU_REG.BLOCK, 23); h.write(GPU_REG.CTRL, GPU_CTRL.START);
  while (h.read(GPU_REG.STATUS) & GPU_STATUS.BUSY);
  assert.equal(dev.peek(GPU_REG.DMEM), 123);
});

test('a deadlock at a barrier ends the run with FAULT and code 8', () => {
  const p = program('.include "simt.inc"\nli t0, 2\nli t1, 2\nbar zero, t1\ntmc zero\n'); // one warp waits for two
  const r = runThrough(p);
  assert.equal(r.s, GPU_STATUS.DONE | GPU_STATUS.FAULT | (GPU_DEADLOCK << 8));
});

test('snapshot and restore give back the state; a back-step over a running kernel is exact', () => {
  const p = template('ifelse');
  const dev = new GpuDevice();
  const h = host(dev);
  load(dev, h, p);
  h.write(GPU_REG.CTRL, GPU_CTRL.START);
  h.idle(5);
  const snap = dev.snapshot();
  const before = Array.from({ length: 256 }, (_, i) => dev.peek(GPU_REG.DMEM + 4 * i)).join();
  const status = dev.peek(GPU_REG.STATUS);
  h.idle(60);
  assert.notEqual(Array.from({ length: 256 }, (_, i) => dev.peek(GPU_REG.DMEM + 4 * i)).join(), before);
  dev.restore(snap);
  assert.equal(Array.from({ length: 256 }, (_, i) => dev.peek(GPU_REG.DMEM + 4 * i)).join(), before);
  assert.equal(dev.peek(GPU_REG.STATUS), status);
});
