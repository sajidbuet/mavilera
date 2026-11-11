// The real-time run's pacing (src/worker/realtime.js; pico2 P1-M4, design docs/architecture/pico2-p1m4-realtime.md §4.1) on the
// pico2 engine with a fake wall clock: each Engine.advance costs wall time in proportion to the cycles it ran, at a chosen host
// speed. Machine time follows the wall clock when the host is fast enough (within 1 %), across the start-up's clock change;
// a slow host reaches its fraction and the catch-up cap drops the rest; a sleeping core waits; live states come about 30
// times a second with every UART byte once; a breakpoint and a pause end the run; an input is stamped at the run's cycle.
// The SharedArrayBuffer ring (src/worker/live-ring.js) gives the newest state and every UART byte.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { create } from '../src/arch/pico2/engine.js';
import { assemble } from '../src/arch/pico2/language.js';
import { STOP } from '../src/arch/contract.js';
import { runRealtime, Pacer } from '../src/worker/realtime.js';
import { LiveRing } from '../src/worker/live-ring.js';

const tpl = (f) => readFileSync(new URL(`../content/pico2/templates/${f}`, import.meta.url), 'utf8');
const build = (text, clock = '4') => { const p = assemble([{ name: 'm.s', text }], { options: { clock } }); assert.ok(p.ok, JSON.stringify(p.diagnostics.slice(0, 2))); return p; };
// blink.s blinking (nearly) for ever
const BLINK = tpl('blink.s').replace(/li\s+s2, 10\b/, 'li      s2, 1000000');
// hello once, then a loop for ever (UART bytes in the live states)
const HELLO_BLINK = tpl('hello-uart.s').replace(/call\s+puts\n\s+ebreak/, 'call    puts\nspin:   j       spin');

/**
 * A fake host: `hostHz` clock cycles per second of wall time (the engine's cost), a task queue for soon/later, and the wall
 * clock. Runs the loop until `untilMs` of wall time or its end; returns what it posted.
 */
function host(engine, { hostHz, untilMs, breakpoints, pauseAt = Infinity, each = null }) {
  let t = 0; const q = []; const posts = []; let end = null;
  const timed = {
    ...engine,
    advance: (b) => { const c0 = engine.clock().cycle; const r = engine.advance(b); t += ((engine.clock().cycle - c0) / hostHz) * 1000; return r; },
  };
  const loop = runRealtime({ engine: timed, breakpoints, now: () => t, soon: (f) => q.push([t, f]), later: (f, ms) => q.push([t + ms, f]),
    post: (m) => posts.push({ t, ...m }), paused: () => t >= pauseAt, onEnd: (s) => { end = s; } });
  while (q.length && end === null && t < untilMs) {
    q.sort((a, b) => a[0] - b[0]);
    const [at, f] = q.shift();
    if (at > t) t = at;
    t += 0.01; // the yield itself
    each?.(t);
    f();
  }
  loop.stop();
  return { end, posts, t, pacer: loop.pacer };
}

test('a fast host: machine time stays within 1 % of the wall clock over 3 s at 1, 4 and 12 MHz (and across the start-up from the ring oscillator)', () => {
  for (const clock of ['1', '4', '12']) {
    const e = create(build(BLINK, clock));
    const r = host(e, { hostHz: 40e6, untilMs: 3000 });
    const ns = e.clock().timeNs, wall = r.t * 1e6;
    assert.equal(r.end, null, `still running at ${clock} MHz`);
    assert.ok(Math.abs(ns - wall) / wall < 0.01, `${clock} MHz: machine ${ns / 1e6} ms, wall ${r.t} ms`);
    assert.equal(e.clock().clkSys, Number(clock) * 1e6);
    assert.ok(r.posts.at(-1).fraction > 0.99, `fraction ${r.posts.at(-1).fraction}`);
  }
});

test('a slow host: the run reaches its fraction of real time; the catch-up cap drops the rest', () => {
  const e = create(build(BLINK, '12'));
  const r = host(e, { hostHz: 6e6, untilMs: 3000 });
  const f = r.posts.at(-1).fraction;
  assert.ok(f > 0.4 && f < 0.6, `fraction ${f} (host at half the clock)`);
  assert.ok(r.pacer.droppedNs > 1.2e9, `dropped ${r.pacer.droppedNs / 1e6} ms`);
});

test('live states about 30 times a second; every UART byte once, in order', () => {
  const e = create(build(HELLO_BLINK, '4'));
  const r = host(e, { hostHz: 40e6, untilMs: 2000 });
  const live = r.posts.filter((m) => m.type === 'live');
  assert.ok(live.length >= 55 && live.length <= 62, `${live.length} live states in 2 s`);
  const text = String.fromCharCode(...live.flatMap((m) => m.state.uart.bytes));
  assert.equal(text, 'Hello from Hazard3 on the Pico 2!\n');
  assert.equal(live.at(-1).state.pins.level.length, 30);
  const b = host(create(build(BLINK, '4')), { hostHz: 40e6, untilMs: 1000 }).posts.filter((m) => m.type === 'live');
  assert.ok(b.some((m) => m.state.pins.level[25] === 1) && b.some((m) => m.state.pins.level[25] === 0), 'GP25 seen high and low');
});

test('a sleeping core: the loop waits ahead of the wall clock instead of spinning, and machine time still follows', () => {
  const e = create(build(tpl('timer-irq.s'), '4'));
  const r = host(e, { hostHz: 40e6, untilMs: 200 });
  assert.equal(r.end, null);
  assert.ok(Math.abs(e.clock().timeNs / 1e6 - r.t) < 2, `${e.clock().timeNs / 1e6} ms vs ${r.t} ms`);
  assert.ok(e.state().sleeping);
});

test('a breakpoint and a pause end the run; the program\'s end too', () => {
  const p = build(BLINK, '4');
  const e1 = create(p);
  const r1 = host(e1, { hostHz: 40e6, untilMs: 5000, breakpoints: new Set([p.symbols.wait]) });
  assert.equal(r1.end, STOP.BREAK);
  assert.equal(e1.state().pc, p.symbols.wait);
  const e2 = create(p);
  assert.equal(host(e2, { hostHz: 40e6, untilMs: 5000, pauseAt: 300 }).end, STOP.PAUSE);
  const e3 = create(build(tpl('blink.s'), '4')); // ten changes, then ebreak, after one second
  const r3 = host(e3, { hostHz: 40e6, untilMs: 5000 });
  assert.equal(r3.end, STOP.HALT);
  assert.ok(Math.abs(r3.t - 1000) < 30, `ended at ${r3.t} ms of wall time`);
});

test('an input during the run is stamped at the run\'s cycle and logged', () => {
  const e = create(build(BLINK, '4'));
  let given = null;
  host(e, { hostHz: 40e6, untilMs: 500, each: (t) => { if (given === null && t > 250) { given = e.clock().cycle; e.input({ kind: 'pin', pin: 7, level: 0 }); } } });
  const log = e.inputs();
  assert.equal(log.length, 1);
  assert.equal(log[0].cycle, given);
});

test('Pacer: the cap moves the reference; the fraction is machine time over wall time', () => {
  let t = 0;
  const p = new Pacer({ now: () => t, capNs: 50e6 });
  p.start(0);
  t = 100; // 100 ms of wall, machine at 0
  assert.equal(p.lag(0), 50e6);
  assert.equal(p.droppedNs, 50e6);
  p.sample(25e6); t = 200; p.sample(75e6);
  assert.ok(Math.abs(p.fraction() - 75e6 / 200e6) < 1e-9);
});

test('LiveRing: the newest state, every UART byte across writes, lost bytes counted when the page falls a ring behind', { skip: typeof SharedArrayBuffer === 'undefined' }, () => {
  const w = new LiveRing();
  const r = new LiveRing(w.sab);
  w.write({ type: 'live', fraction: 1, state: { pc: 1, pins: { level: new Uint8Array([1, 0]) }, uart: { bytes: [72, 105], total: 2 } } });
  w.write({ type: 'live', fraction: 0.5, state: { pc: 2, pins: { level: new Uint8Array([0, 1]) }, uart: { bytes: [33], total: 3 } } });
  const a = r.read();
  assert.equal(a.live.state.pc, 2);
  assert.deepEqual(a.live.state.pins.level, [0, 1]);
  assert.equal(a.live.state.uartTotal, 3);
  assert.equal(String.fromCharCode(...a.bytes), 'Hi!');
  const b = r.read();
  assert.equal(b.live, null);
  assert.deepEqual(b.bytes, []);
  w.write({ type: 'live', state: { pc: 3, uart: { bytes: new Array(70_000).fill(65), total: 70_003 } } });
  const c = r.read();
  assert.equal(c.bytes.length, 64 << 10);
  assert.equal(r.lost, 70_000 - (64 << 10));
});
