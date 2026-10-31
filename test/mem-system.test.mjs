// mem-system.test.mjs -- phase 1 of the memory hierarchy (docs/architecture/memory-hierarchy.md):
// the address map, the device base class, the memory-system facade with its sample/begin/commit
// port in ideal mode, and the baseline: with a memory system attached (and no device) the ISS and
// the three processor models give exactly the traces and counts they give without one.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assemble } from '../src/asm/assembler.js';
import { Hart, run } from '../src/core/iss.js';
import { Memory, WordMemory } from '../src/core/memory.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Multicycle } from '../src/uarch/multi.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { AddressMap, BusError } from '../src/mem/bus.js';
import { Device } from '../src/mem/device.js';
import { MemorySystem } from '../src/mem/system.js';
import { ch07 } from './ch07-content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const T6 = JSON.parse(readFileSync(join(ROOT, 'content', 'data', 'ch06-tables.json'), 'utf8'));
const T7 = ch07().t7;

// ---- address map -----------------------------------------------------------------------------

test('AddressMap: narrowest region wins; a device is carved out of RAM and is never cacheable', () => {
  const m = new AddressMap();
  const ram = m.register({ name: 'ram', base: 0, size: 2 ** 32, kind: 'ram', target: {} });
  const dev = m.register({ name: 'gpio', base: 0x40000000, size: 0x1000, kind: 'device', cacheable: true, target: {} });
  assert.equal(m.resolve(0x1234).region.name, 'ram');
  assert.equal(m.resolve(0x1234).region.cacheable, true);
  const d = m.resolve(0x40000004);
  assert.equal(d.region.name, 'gpio');
  assert.equal(d.offset, 4);
  assert.equal(d.region.cacheable, false, 'enforced in register, not an option');
  assert.equal(m.resolve(0x40001000).region.name, 'ram');
  const v = m.version;
  assert.ok(m.unregister(dev));
  assert.ok(m.version > v);
  assert.equal(m.resolve(0x40000004).region.name, 'ram');
  assert.ok(m.unregister(ram));
  assert.deepEqual(m.resolve(0), { unmapped: true });
});

test('AddressMap: overlaps, size 0, misaligned devices and bad wrap regions are errors', () => {
  const m = new AddressMap();
  m.register({ name: 'a', base: 0, size: 0x1000, kind: 'ram', target: {} });
  assert.throws(() => m.register({ name: 'b', base: 0x800, size: 0x1000, kind: 'ram', target: {} }), /overlaps a/);
  assert.throws(() => m.register({ name: 'c', base: 0x2000, size: 0, kind: 'ram', target: {} }), /not a range/);
  assert.throws(() => m.register({ name: 'd', base: 0x2100, size: 0x1000, kind: 'device', target: {} }), /aligned/);
  assert.throws(() => m.register({ name: 'e', base: 0, size: 0x1800, kind: 'ram', wrap: true, target: {} }), /wrapping/);
  m.register({ name: 'g', base: 0x400, size: 0x100, kind: 'device', target: {} });
  assert.throws(() => m.register({ name: 'h', base: 0x400, size: 0x100, kind: 'device', target: {} }), /overlaps g/);
});

test('AddressMap: a wrapping RAM region repeats over the space (offset = address & (size - 1))', () => {
  const m = new AddressMap();
  m.register({ name: 'ram', base: 0, size: 1024, kind: 'ram', wrap: true, target: {} });
  assert.equal(m.resolve(0x10000008).offset, 8);
  assert.equal(m.resolve(0xfffffffc).offset, 1020);
});

test('AddressMap: unmapped addresses fault, or read zero under the policy "zero"', () => {
  const store = new Memory();
  const sys = new MemorySystem({ unmapped: 'fault' });
  const p = sys.attach(store, store).D;
  p.map.unregister(p.map.regions[0].id);
  assert.throws(() => p.sample(0x100, 4), (e) => e instanceof BusError && e.kind === 'unmapped');
  p.map.unmapped = 'zero';
  assert.equal(p.sample(0x100, 4), 0);
  assert.equal(p.write(0x100, 4, 7), 0);
});

// ---- ports and devices -----------------------------------------------------------------------

class Counter extends Device {
  constructor() {
    super({ name: 'ctr', size: 0x100, registers: [{ offset: 0, name: 'VALUE', width: 4, access: 'ro' }] });
    this.reset();
    this.pops = 0;
    this.written = [];
  }
  reset() { this.n = 10; }
  peek() { return this.n; }
  read() { this.pops++; return this.n++; } // a side effect: each real read advances the counter
  write(offset, size, value, ctx) { this.written.push([offset, size, value, ctx.source]); }
}

test('port: sample() is pure, begin()+commit() runs the device read and write exactly once', () => {
  const store = new Memory();
  const sys = new MemorySystem();
  const dev = new Counter();
  sys.addDevice(0x40000000, dev);
  const { D } = sys.attach(store, store);
  for (let i = 0; i < 5; i++) assert.equal(D.sample(0x40000000, 4), 10); // evaluation, repeated
  assert.equal(dev.pops, 0);
  assert.equal(D.begin({ op: 'read', addr: 0x40000000, size: 4 }), 1);
  assert.equal(D.commit().value, 10);
  assert.equal(dev.pops, 1);
  D.begin({ op: 'write', addr: 0x40000008, size: 4, data: 0xabcd });
  D.commit();
  assert.deepEqual(dev.written, [[8, 4, 0xabcd, 'D']]);
  assert.throws(() => D.commit(), /no request/);
  D.begin({ op: 'read', addr: 0x40000000, size: 4 });
  assert.throws(() => D.begin({ op: 'read', addr: 0, size: 4 }), /already pending/);
});

test('port: device width fault, fetch from a device fault, RAM beside a device unaffected', () => {
  const store = new Memory();
  const sys = new MemorySystem();
  sys.addDevice(0x40000000, new Counter());
  const { I, D } = sys.attach(store, store);
  assert.throws(() => D.sample(0x40000000, 1), (e) => e.kind === 'width');
  assert.throws(() => I.sample(0x40000000, 4), (e) => e.kind === 'fetch');
  D.write(0x3ffffffc, 4, 0x1234);
  assert.equal(D.read(0x3ffffffc, 4), 0x1234);
  assert.equal(I.read(0x3ffffffc, 4), 0x1234);
});

test('port: a ROM region ignores stores; restore() undoes RAM only; attach() resets devices', () => {
  const store = new WordMemory(256);
  const sys = new MemorySystem();
  const dev = new Counter();
  sys.addDevice(0x40000000, dev);
  dev.n = 99;
  const { D } = sys.attach(store, store);
  assert.equal(dev.n, 10, 'reset at attach');
  assert.equal(D.write(8, 4, 5), 0);
  D.restore(8, 4, 0);
  assert.equal(D.read(8, 4), 0);
  D.restore(0x40000000, 4, 1); // no effect on a device
  assert.deepEqual(dev.written, []);
  assert.equal(D.map.resolve(0x10000008).offset, 8, 'chapter memory wraps');
  assert.equal(D.words, store.words);
});

test('Device: defaults; subscribers are notified and can unsubscribe', () => {
  const d = new Device({ name: 'd' });
  assert.deepEqual(d.latency, { read: 1, write: 1 });
  assert.deepEqual(d.widths, [4]);
  assert.equal(d.peek(0, 4), null);
  assert.equal(d.read(0, 4, {}), 0);
  assert.equal(d.irq(), false);
  let n = 0;
  const off = d.onChange(() => n++);
  d.emit(); off(); d.emit();
  assert.equal(n, 1);
});

// ---- baseline: ideal memory system gives the traces of the stores themselves -------------------

const SRC = `
        .text
_start: li    t0, 0x11223344
        sw    t0, 0x200(zero)
        lw    t1, 0x200(zero)
        addi  t1, t1, 1
        sw    t1, 0x204(zero)
        li    t2, 5
loop:   addi  t2, t2, -1
        sw    t2, 0x208(zero)
        lw    t3, 0x208(zero)
        bne   t2, zero, loop
        lw    t4, 0x204(zero)
        add   t5, t4, t3
        sw    t5, 0x20c(zero)
done:   jal   zero, done
`;

function image(profile) {
  const p = assemble([{ name: 't.s', text: SRC }], { profile });
  assert.deepEqual(p.errors, []);
  return p;
}

test('baseline ISS (iss profile): same registers, counts and memory with an ideal memory system', () => {
  const src = `
        .data
buf:    .space 32
        .text
_start: la    s0, buf
        li    t0, 0x01020304
        sw    t0, 0(s0)
        sh    t0, 4(s0)
        sb    t0, 6(s0)
        lw    a1, 0(s0)
        lbu   a2, 1(s0)
        lh    a3, 4(s0)
        li    a7, 93
        ecall
`;
  const prog = assemble([{ name: 't.s', text: src }], { profile: 'iss' });
  assert.deepEqual(prog.errors, []);
  const a = new Hart(prog);
  const b = new Hart(prog, { memsys: new MemorySystem() });
  run(a); run(b);
  assert.deepEqual(Array.from(b.x), Array.from(a.x));
  assert.equal(b.instret, a.instret);
  assert.equal(b.pc, a.pc);
  assert.deepEqual([...b.mem.copyPages()], [...a.mem.copyPages()]);
});

test('baseline ISS: a device at a peripheral address is reached by loads and stores', () => {
  const sys = new MemorySystem();
  const dev = new Counter();
  sys.addDevice(0x40000000, dev);
  const prog = assemble([{
    name: 't.s',
    text: 'lui t0, 0x40000\nsw t0, 8(t0)\nli a7, 93\necall\n',
  }], { profile: 'iss' });
  assert.deepEqual(prog.errors, []);
  const h = new Hart(prog, { memsys: sys });
  run(h);
  assert.deepEqual(dev.written, [[8, 4, 0x40000000, 'D']]);
});

const MODELS = {
  ch06: (memsys) => new SingleCycle(T6, { memsys }),
  ch07: (memsys) => new Multicycle(T6, T7, { jalr: true, memsys }),
  ch08: (memsys) => new Pipeline(T6, { memsys }),
};

for (const [profile, make] of Object.entries(MODELS)) {
  test(`baseline ${profile}: same cycles, registers and golden dump with an ideal memory system`, () => {
    const prog = image(profile);
    const a = make(null);
    const b = make(new MemorySystem());
    a.load(prog); b.load(prog);
    assert.equal(a.run(), 'halt');
    assert.equal(b.run(), 'halt');
    assert.equal(b.cycle, a.cycle);
    assert.deepEqual(Array.from(b.x), Array.from(a.x));
    assert.deepEqual(b.golden(), a.golden());
    // back-step to the start restores memory through the port
    const g0 = make(new MemorySystem());
    g0.load(prog);
    const blank = g0.golden();
    while (b.history.length) b.back();
    assert.deepEqual(b.golden(), blank);
  });
}
