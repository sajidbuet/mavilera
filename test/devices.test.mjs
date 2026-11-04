// devices.test.mjs -- the platform devices (GPIO, timer, UART) as Device subclasses (WS-F-111, W-D26):
// their registers and rules, peek without side effects, side effects exactly once (also when an access
// waits several cycles in a timed memory system), the address map of the platform, and step back on the
// profile iss-priv (devices and privileged state restored together).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assemble } from '../src/asm/assembler.js';
import { Session, STOP } from '../src/core/session.js';
import { Hart } from '../src/core/iss.js';
import { MemorySystem } from '../src/mem/system.js';
import { Gpio, Timer, Uart, UART_BASE, GPIO_BASE, TIMER_BASE, UART_STATUS } from '../src/mem/devices.js';
import { Platform, parseStimulus } from '../src/mem/platform.js';
import { Controller } from '../src/mem/controller.js';
import { SingleCycle } from '../src/uarch/single.js';
import { Pipeline } from '../src/uarch/pipe.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const json = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const ctx = (cycle, source = 'D') => ({ cycle, source });

test('GPIO: OUT, OUT_SET, OUT_CLR, OUT_TGL, DIR and the read-only IN', () => {
  const g = new Gpio();
  g.write(0x00, 4, 0xa5, ctx(1));
  g.write(0x0c, 4, 0x0f, ctx(2));
  assert.equal(g.peek(0x00), 0xaf);
  g.write(0x10, 4, 0x81, ctx(3));
  assert.equal(g.peek(0x00), 0x2e);
  g.write(0x14, 4, 0xff, ctx(4));
  assert.equal(g.peek(0x00), 0xd1);
  g.write(0x08, 4, 0xff, ctx(5));
  assert.equal(g.peek(0x08), 0xff);
  g.write(0x04, 4, 0xffffffff, ctx(6)); // IN ignores writes
  assert.equal(g.peek(0x04), 0);
  assert.equal(g.peek(0x20), 0, 'an offset with no register reads 0');
  assert.deepEqual(g.registers.map((r) => r.name), ['OUT', 'IN', 'DIR', 'OUT_SET', 'OUT_CLR', 'OUT_TGL', 'IRQ_EN', 'IRQ_PEND']);
});

test('GPIO: a rising input sets its IRQ_PEND bit; the request needs IRQ_EN; writing 1 clears it', () => {
  const g = new Gpio({ stimulus: parseStimulus('10 btn 1\n20 btn 0\n30 btn 1') });
  g.tick(5);
  assert.equal(g.peek(0x04), 0);
  g.tick(10);
  assert.equal(g.peek(0x04), 0x100);
  assert.equal(g.peek(0x1c), 0x100, 'pending');
  assert.equal(g.irq(), false, 'not enabled');
  g.write(0x18, 4, 0x100, ctx(11));
  assert.equal(g.irq(), true);
  g.tick(20); // the button is released: the pending bit stays
  assert.equal(g.peek(0x04), 0);
  assert.equal(g.irq(), true);
  g.write(0x1c, 4, 0x100, ctx(21));
  assert.equal(g.irq(), false);
  g.tick(30);
  assert.equal(g.irq(), true, 'a new rising edge');
});

test('timer: MTIME counts, MTIMECMP starts as all ones, MTIP = MTIME >= MTIMECMP, writes to MTIME and the divider', () => {
  const t = new Timer();
  t.tick(100);
  assert.equal(t.peek(0x00), 100);
  assert.equal(t.peek(0x08), 0xffffffff);
  assert.equal(t.peek(0x0c), 0xffffffff);
  assert.equal(t.mtip(), false);
  t.write(0x08, 4, 150, ctx(101));
  t.write(0x0c, 4, 0, ctx(102));
  assert.equal(t.mtip(149), false);
  assert.equal(t.mtip(150), true);
  t.write(0x00, 4, 1000, ctx(110)); // MTIME := 1000 at cycle 110
  assert.equal(t.mtime(110), 1000n);
  assert.equal(t.mtime(120), 1010n);
  const slow = new Timer({ div: 4 });
  assert.equal(slow.mtime(40), 10n);
  assert.throws(() => new Timer({ div: 0 }), /at least 1/);
});

test('UART: TXDATA sends when ready and the transmitter is busy for txCycles; RXDATA pops; STATUS and CTRL', () => {
  const u = new Uart({ txCycles: 4, rx: [{ cycle: 10, byte: 0x41 }, { cycle: 10, byte: 0x42 }] });
  assert.equal(u.peek(0x08) & UART_STATUS.TXRDY, UART_STATUS.TXRDY);
  u.write(0x00, 4, 0x48, ctx(1)); // 'H'
  u.tick(2);
  assert.equal(u.peek(0x08) & UART_STATUS.TXRDY, 0, 'busy');
  u.write(0x00, 4, 0x49, ctx(3)); // lost
  assert.deepEqual(u.tx, [0x48]);
  assert.ok(u.peek(0x08) & UART_STATUS.TXOVR);
  u.write(0x08, 4, UART_STATUS.TXOVR, ctx(4)); // write 1 to clear
  assert.equal(u.peek(0x08) & UART_STATUS.TXOVR, 0);
  u.tick(5);
  assert.equal(u.peek(0x08) & UART_STATUS.TXRDY, UART_STATUS.TXRDY, 'ready again after txCycles');
  u.tick(10);
  assert.ok(u.peek(0x08) & UART_STATUS.RXVALID);
  assert.equal(u.peek(0x04), 0x41);
  assert.equal(u.peek(0x04), 0x41, 'peek does not take the byte');
  assert.equal(u.read(0x04, 4, ctx(11)), 0x41);
  assert.equal(u.read(0x04, 4, ctx(12)), 0x42);
  assert.equal(u.read(0x04, 4, ctx(13)), 0, 'empty reads 0');
  assert.equal(u.peek(0x08) & UART_STATUS.RXVALID, 0);
  u.write(0x0c, 4, 0xff, ctx(14));
  assert.equal(u.peek(0x0c), 3, 'only RXIE and TXIE exist');
});

test('UART: the receiver holds 8 bytes; the ninth is lost and RXOVR is set', () => {
  const u = new Uart({ rx: Array.from({ length: 9 }, (_, i) => ({ cycle: i, byte: 65 + i })) });
  u.tick(20);
  assert.equal(u.rxFifo.length, 8);
  assert.ok(u.peek(0x08) & UART_STATUS.RXOVR);
});

test('UART: the interrupt request follows CTRL and the status', () => {
  const u = new Uart({ rx: [{ cycle: 5, byte: 1 }] });
  u.tick(6);
  assert.equal(u.irq(), false, 'RXIE is off');
  u.write(0x0c, 4, 1, ctx(7));
  assert.equal(u.irq(), true);
  u.read(0x04, 4, ctx(8));
  assert.equal(u.irq(), false);
  u.write(0x0c, 4, 2, ctx(9)); // TXIE: ready now
  assert.equal(u.irq(), true);
});

test('peek has no side effects on any device, whatever the number of times it is called', () => {
  const p = new Platform({ stimulus: parseStimulus('3 btn 1'), rx: [{ cycle: 2, byte: 7 }] });
  p.tick(10);
  const before = JSON.stringify(p.parts.map((d) => d.snapshot()), (k, v) => (typeof v === 'bigint' ? String(v) : v));
  for (const { device } of p.devices()) for (const r of device.registers) for (let i = 0; i < 5; i++) device.peek(r.offset, 4);
  const after = JSON.stringify(p.parts.map((d) => d.snapshot()), (k, v) => (typeof v === 'bigint' ? String(v) : v));
  assert.equal(after, before);
});

test('the platform on a memory system: the window reads 0 and ignores writes, the devices sit at their slots, a byte access is a bus fault', () => {
  const pl = new Platform();
  const ms = new MemorySystem();
  for (const { base, device } of pl.devices()) ms.addDevice(base, device);
  const { D } = ms.attach(new (class { read() { return 0; } write() { return 0; } copyPages() {} })(), new (class { read() { return 0; } write() { return 0; } })());
  assert.equal(D.map.resolve(GPIO_BASE).region.name, 'GPIO');
  assert.equal(D.map.resolve(TIMER_BASE).region.name, 'TIMER');
  assert.equal(D.map.resolve(UART_BASE).region.name, 'UART');
  assert.equal(D.map.resolve(0x40ff0000).region.name, 'periph');
  assert.equal(D.sample(0x40ff0000, 4), 0);
  assert.throws(() => D.sample(GPIO_BASE, 1), /does not accept a 1-byte access/);
  assert.equal(D.map.resolve(0x4fffffff).region.name, 'periph');
  assert.equal(D.map.resolve(0x50000000).region.name, 'NPU', 'the NPU, outside the window (decision G1)');
  assert.equal(D.map.resolve(0x50001000).region.name, 'ram', 'past the NPU\'s slot');
  assert.equal(D.map.regions.find((r) => r.name === 'GPIO').cacheable, false, 'a device is never cached');
});

test('side effects once: a device access that waits in a timed memory system commits exactly once', () => {
  const ms = new MemorySystem();
  const u = new Uart();
  u.latency = { read: 3, write: 3 };
  ms.addDevice(UART_BASE, u);
  const store = { words: new Uint32Array(64), read: () => 0, write: () => 0 };
  const { D } = ms.attach(store, store, { caches: false });
  ms.configure({ mode: 'main', main: { overhead: 0, readLatency: 1, writeLatency: 1, busWidth: 4 }, ports: 1 });
  assert.equal(ms.accessCycles('D', 'write', UART_BASE, 4), 3);
  // the model asks for the edge until the request is served; only then does it perform it
  let waits = 0;
  while (ms.waitEdge({ D: { op: 'write', addr: UART_BASE, size: 4 } }) !== null) waits++;
  assert.equal(waits, 2, 'two wait edges for a 3-cycle access');
  assert.deepEqual(u.tx, [], 'nothing committed while it waits');
  D.write(UART_BASE, 4, 0x58);
  assert.deepEqual(u.tx, [0x58], 'committed once');
  ms.waitEdge({});
  assert.deepEqual(u.tx, [0x58]);
});

test('devices keep time on a memory system: every edge of a model ticks them, ideal memory included', () => {
  for (const mode of ['ideal', 'main']) {
    const ms = new MemorySystem();
    const t = new Timer();
    ms.addDevice(TIMER_BASE, t);
    const store = { words: new Uint32Array(64), read: () => 0, write: () => 0 };
    ms.attach(store, store, { caches: false });
    if (mode === 'main') ms.configure({ mode: 'main', main: { overhead: 0, readLatency: 0, writeLatency: 0, busWidth: 4 }, ports: 2 });
    for (let i = 0; i < 5; i++) ms.edge(i);
    assert.equal(t.now, 4, mode);
  }
});

test('a processor model reaches a device through the bus: the single-cycle and pipelined models drive the GPIO LEDs', () => {
  const T6 = json('content/data/ch06-tables.json');
  const src = '        lui  t0, 0x40000\n        li   t1, 0x5a\n        sw   t1, 0(t0)\n        lw   t2, 0(t0)\n        halt\n';
  for (const [name, make] of [['single-cycle', (memsys) => new SingleCycle(T6, { memsys })], ['pipelined', (memsys) => new Pipeline(T6, { memsys })]]) {
    const pl = new Platform({ uart: false });
    const ms = new MemorySystem();
    for (const { base, device } of pl.devices()) ms.addDevice(base, device);
    const m = make(ms);
    const p = assemble([{ name: 'a.s', text: src }], { profile: name === 'single-cycle' ? 'ch06' : 'ch08' });
    assert.ok(p.ok, p.errors.map((e) => e.message).join());
    m.load(p);
    let r;
    do r = m.step(); while (r === 'step' && m.cycle < 1000);
    assert.equal(r, 'halt', name);
    assert.equal(pl.gpio.out, 0x5a, `${name}: the store reached the GPIO`);
    assert.equal(m.x[7], 0x5a, `${name}: and the load read it back`);
  }
});

// --- step back on the profile iss-priv ------------------------------------------------------------

const TIMER_IRQ = `
        la    t0, handler
        csrw  mtvec, t0
        li    s0, 0x40001000
        li    s3, 0x40000000
        lw    t0, 0(s0)
        addi  t0, t0, 40
        sw    t0, 8(s0)
        sw    zero, 12(s0)
        li    t0, 0x80
        csrs  mie, t0
        csrsi mstatus, 8
idle:   wfi
        li    t1, 4
        blt   s1, t1, idle
        li    t0, 0x40002000
        li    t1, 79
        sw    t1, 0(t0)
        halt
handler:
        lw    t0, 8(s0)
        addi  t0, t0, 40
        sw    t0, 8(s0)
        li    t1, 1
        sw    t1, 0x14(s3)
        addi  s1, s1, 1
        mret
`;

function privSession(text, platformConfig = {}) {
  const s = new Session();
  s.profile = 'iss-priv';
  s.files = [{ name: 'a.s', text }];
  s.platformConfig = { stimulus: [], rx: [], mtimeDiv: 1, uart: true, txCycles: 4, ...platformConfig };
  s.assemble();
  assert.ok(s.program.ok, s.program.errors.map((e) => e.message).join());
  return s;
}

/** Everything a step back must restore: registers, pc, counters, devices, privileged state. */
const fingerprint = (h) => JSON.stringify({
  x: Array.from(h.x), pc: h.pc, cycle: h.cycle, instret: h.instret, idle: h.idleCycles, traps: Object.fromEntries(Object.entries(h.trapCounts).filter(([, n]) => n > 0)), counts: Array.from(h.countArr),
  gpio: h.platform.gpio.snapshot(), uart: h.platform.uart.snapshot(), tx: h.platform.uart.tx,
  timer: { ...h.platform.timer.snapshot(), off: String(h.platform.timer.off), cmp: String(h.platform.timer.cmp) },
  priv: { ...h.priv.snapshot(), cycleOff: String(h.priv.cycleOff), instretOff: String(h.priv.instretOff) },
  log: h.platform.log.map((e) => ({ ...e })),
}, (k, v) => (typeof v === 'bigint' ? String(v) : v));

test('step back on iss-priv: stepping N and going back N restores the whole state, at every step of a run with interrupts', () => {
  const s = privSession(TIMER_IRQ);
  const prints = [fingerprint(s.hart)];
  let n = 0;
  while (s.step() === STOP.NONE && n < 5000) { prints.push(fingerprint(s.hart)); n++; }
  assert.equal(s.hart.halted, true, s.error);
  assert.ok(s.hart.traps >= 4 && s.hart.idleCycles > 0, 'the run takes interrupts and waits');
  const end = fingerprint(s.hart);
  for (let i = prints.length - 1; i >= 0; i--) {
    assert.deepEqual(JSON.parse(fingerprint(s.hart)), JSON.parse(prints[i]), `at step ${i}`);
    if (i > 0) assert.ok(s.back(), `back from ${i}`);
  }
  assert.equal(s.back(), false, 'at the start');
  for (let i = 0; i < n; i++) s.step();
  assert.equal(s.step() !== undefined && fingerprint(s.hart), end, 'forward again reaches the same end');
});

test('step back with pin events: switches pressed at a cycle are replayed after going back', () => {
  const s = privSession(`
        li    s0, 0x40000000
poll:   lw    t0, 4(s0)
        srli  t1, t0, 4
        andi  t1, t1, 0xf
        sw    t1, 0(s0)
        andi  t2, t0, 0x100
        beqz  t2, poll
        halt
`, { stimulus: parseStimulus('20 sw 3\n60 sw 12\n100 btn 1') });
  let n = 0;
  while (s.step() === STOP.NONE && n < 1000) n++;
  assert.equal(s.hart.platform.gpio.out, 12);
  const end = fingerprint(s.hart);
  while (s.back()) { /* all the way */ }
  assert.equal(s.hart.platform.gpio.inp, 0);
  assert.equal(s.hart.cycle, 0);
  while (s.step() === STOP.NONE) { /* again */ }
  assert.equal(fingerprint(s.hart), end);
});

test('a live pin event is part of the script: the interface adds it at the current cycle, a step back and forward replays it', () => {
  const s = privSession(`
        li    s0, 0x40000000
poll:   lw    t0, 4(s0)
        andi  t2, t0, 0x100
        beqz  t2, poll
        halt
`);
  for (let i = 0; i < 6; i++) s.step();
  const h = s.hart;
  h.platform.tick(h.cycle);
  h.platform.gpio.setPins(0x100, 0x100, h.cycle); // the button pressed now
  assert.equal(h.platform.gpio.inp, 0x100, 'seen at once');
  s.step(); s.step(); s.step(); // the load sees it
  assert.ok(h.x[7] & 0x100 || h.x[5] === 0x100, 'the program read the button');
  const here = fingerprint(h);
  s.back(); s.back(); s.back();
  s.step(); s.step(); s.step();
  assert.equal(fingerprint(h), here);
});

test('a trap with no handler is an error of the run, not an exception of the page', () => {
  const s = privSession('        ecall\n        halt\n');
  assert.equal(s.step(), STOP.ERROR);
  assert.match(s.error, /mtvec was never written/);
});

test('the profile iss-priv: ecall traps instead of stopping; the profile iss is unchanged', () => {
  const text = '        li a7, 93\n        li a0, 7\n        ecall\n        halt\n';
  const plain = new Hart(assemble([{ name: 'a.s', text }], { profile: 'iss' }), { profile: 'iss' });
  while (!plain.halted) plain.stepFast();
  assert.equal(plain.exitCode, 7);
  assert.equal(plain.priv, null);
  const s = privSession(text);
  s.step(); s.step();
  assert.equal(s.step(), STOP.ERROR, 'the ecall is a trap with nowhere to go');
});

test('Controller is untouched: this work adds devices, not a change to the controller', () => {
  assert.deepEqual(new Controller(1).plan({ I: 2, D: 2 }), ['data', 'fetch', 'arbitration']);
});

// --- devices in the processor models: time, load side effects, step back, the saved script ----------

import { Multicycle } from '../src/uarch/multi.js';
import { buildMemsys, readConfig, defaultConfig } from '../src/mem/config.js';
import { normalisePlatform, defaultPlatform } from '../src/shell/share.js';
import { createShare } from '../src/shell/share.js';
import { shareSchema } from '../src/shell/share-schema.js';
import { descriptor as riscvShare } from '../src/arch/riscv/index.js';
const { normalise, encodeFragment, decodeFragment, settingsFile, readSettingsFile } = createShare(shareSchema(riscvShare)); // the format with the RISC-V schema (contract v5)
import { ch07 } from './ch07-content.mjs';

const UART_RX_PROGRAM = [
  '        lui  t0, 0x40002',            // the UART
  '        lw   t1, 4(t0)',             // RXDATA: pops a byte
  '        lw   t2, 4(t0)',             // the next one
  '        lw   t3, 8(t0)',             // STATUS
  '        halt',
].join('\n') + '\n';

function modelOn(kind, platformConfig, mem = { mode: 'ideal', devices: true }) {
  const T6 = json('content/data/ch06-tables.json');
  const cfg = { ...defaultConfig(), ...mem };
  const platform = new Platform(platformConfig);
  const { memsys } = buildMemsys(cfg, { platform });
  assert.ok(memsys && memsys.platform === platform, 'the setting builds a system with the platform');
  const t7 = ch07({ jalr: false }).t7;
  const m = kind === 'single' ? new SingleCycle(T6, { memsys }) : kind === 'multi' ? new Multicycle(T6, t7, { memsys }) : new Pipeline(T6, { memsys });
  return { m, platform, memsys };
}

for (const kind of ['single', 'multi', 'pipe']) {
  test(`${kind}: a load from RXDATA takes the byte once, at its edge; a step back puts it back`, () => {
    const { m, platform } = modelOn(kind, { rx: [{ cycle: 0, byte: 65 }, { cycle: 0, byte: 66 }] });
    const p = assemble([{ name: 'a.s', text: UART_RX_PROGRAM }], { profile: kind === 'single' ? 'ch06' : kind === 'multi' ? 'ch07' : 'ch08' });
    assert.ok(p.ok, p.errors.map((e) => e.message).join());
    m.load(p);
    const states = [];
    const snap = () => JSON.stringify({ rx: platform.uart.rxFifo, x: Array.from(m.x), c: m.cycle });
    let r;
    do { states.push(snap()); r = m.step(); } while (r === 'step' && m.cycle < 200);
    assert.equal(r, 'halt');
    assert.equal(m.x[6], 65, 't1 is the first byte');
    assert.equal(m.x[7], 66, 't2 the second');
    assert.equal(m.x[28] & 2, 0, 'the receiver is empty afterwards: STATUS.RXVALID is 0');
    assert.deepEqual(platform.uart.rxFifo, []);
    assert.ok(m.back(), 'the first step back leaves the halt'); // the halt step changes nothing
    for (let i = states.length - 1; i >= 0; i--) {
      assert.equal(snap(), states[i], `at edge ${i}`);
      if (i > 0) assert.ok(m.back());
    }
  });
}

test('the models tick the platform timer with their own cycle: a polled MTIME grows by one per edge', () => {
  const { m, platform } = modelOn('single', {});
  const src = '        lui  t0, 0x40001\n        lw   a0, 0(t0)\n        nop\n        nop\n        lw   a1, 0(t0)\n        halt\n';
  m.load(assemble([{ name: 'a.s', text: src }], { profile: 'ch06' }));
  let r;
  do r = m.step(); while (r === 'step');
  assert.equal(m.x[11] - m.x[10], 3, 'three edges between the two reads');
  assert.equal(platform.timer.mtime(m.cycle) > 0n, true);
});

test('timed memory with devices: the pipeline waits for memory and the devices still keep the model\'s time', () => {
  const { m, platform } = modelOn('pipe', {}, { mode: 'main', devices: true, main: { preset: 'custom', overhead: 0, readLatency: 3, writeLatency: 3, busWidth: 4 }, ports: 1 });
  m.load(assemble([{ name: 'a.s', text: '        lui t0, 0x40000\n        li t1, 7\n        sw t1, 0(t0)\n        halt\n' }], { profile: 'ch08' }));
  let r;
  do r = m.step(); while (r === 'step' && m.cycle < 2000);
  assert.equal(r, 'halt');
  assert.equal(platform.gpio.out, 7);
  assert.ok(m.memsys.stats.waitCycles > 0);
});

test('the memory setting: devices default to off, are read back, and give no system on ideal memory without a platform', () => {
  assert.equal(defaultConfig().devices, false);
  assert.equal(readConfig({ devices: true }).devices, true);
  assert.equal(readConfig({ devices: 'yes' }).devices, false);
  assert.equal(buildMemsys({ ...defaultConfig(), devices: true }).memsys, null);
  assert.equal(buildMemsys(defaultConfig(), { platform: new Platform() }).memsys, null, 'the default setting is the book\'s processors, unchanged');
});

test('the script and the trap settings travel in links and settings files; the profile with traps is a known profile', async () => {
  const platform = normalisePlatform({ stimulus: [{ cycle: 60, mask: 0xf0, value: 0x50 }, { cycle: 10, mask: 0x100, value: 0x100 }], rx: [{ cycle: 5, byte: 0x141 }],
    mtimeDiv: 4, trapEntry: 5, mtvalZero: true, trapCheck: true, junk: 1 });
  assert.deepEqual(platform.stimulus.map((e) => e.cycle), [10, 60], 'in cycle order');
  assert.equal(platform.rx[0].byte, 0x41);
  assert.equal(platform.junk, undefined);
  const st = { view: 'isa', profile: 'iss-priv', lang: 'asm', source: 'halt\n', platform };
  const back = await decodeFragment(await encodeFragment(st));
  assert.equal(back.profile, 'iss-priv');
  assert.deepEqual(back.platform, platform);
  assert.deepEqual(readSettingsFile(settingsFile(st)).platform, platform);
  assert.equal(normalise({ source: 'x' }).platform, undefined, 'a state without a script has none');
  assert.deepEqual(normalisePlatform({ mtimeDiv: 0, trapEntry: -1, stimulus: 'x' }), { ...defaultPlatform() }, 'unusable values give the defaults');
});
