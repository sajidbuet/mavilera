// The pico2 speaker (P1-M5, research decision D39 Q4-Q5; ADR-0005, R-AUD-01): the audio tap turns a pin into 48 kHz frames of
// machine time with the pin-accurate converter (default) or the ideal DAC; a DMA channel paced by a PWM wrap streams a sine
// table into CC (the exit example's structure); Engine.configure / drainAudio / audioStatus and the snapshot.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Machine } from '../src/arch/pico2/soc/machine.js';
import { SAMPLE_RATE } from '../src/arch/pico2/audio/tap.js';
import { assemble } from '../src/arch/pico2/language.js';
import { create } from '../src/arch/pico2/engine.js';

const PWM = 0x400a8000, DMA = 0x50000000, RESETS = 0x40020000, IO = 0x40028000, PADS = 0x40038000, CLR = 0x3000, SRAM = 0x20000000;
const w = (m, a, v) => m.bus.write32(a >>> 0, v >>> 0);
function machine() { const m = new Machine(); w(m, RESETS + CLR, (1 << 2) | (1 << 16) | (1 << 6) | (1 << 9)); return m; }
function to(m, c) { m.hart.ticks = c; if (c >= m.deadline) m.serviceDue(); }
/** Run the machine's devices for `seconds` of machine time in steps, draining the tap; returns the frames. */
function collect(m, seconds) {
  const out = [], hz = m.freq.sys, end = m.hart.ticks + Math.round(seconds * hz), step = Math.round(hz / 1000);
  for (let c = m.hart.ticks + step; c <= end; c += step) { to(m, c); const r = m.audio.drain(1 << 20, Math.min(c, m.deadline)); if (r) out.push(...r.frames[0]); }
  return Float64Array.from(out);
}
/** Power at frequency f (Goertzel) relative to the total power of x (after the first `skip` frames). */
function tone(x, f, skip = 2400) {
  const s = x.subarray(skip), n = s.length, k = (2 * Math.PI * f) / SAMPLE_RATE;
  let a = 0, b = 0, tot = 0;
  for (let i = 0; i < n; i++) { a += s[i] * Math.cos(k * i); b += s[i] * Math.sin(k * i); tot += s[i] * s[i]; }
  const p = (2 * (a * a + b * b)) / (n * n), mean = tot / n;
  return { db: 10 * Math.log10(p / mean), rms: Math.sqrt(mean) };
}

test('a 1 kHz square wave from PWM on the speaker pin gives frames at 48 kHz of machine time, mostly at 1 kHz', () => {
  const m = machine(), hz = m.freq.sys; // the reset clock (ROSC)
  w(m, PADS + 4, 0x50); w(m, IO + 4, 4);
  w(m, PWM + 0x10, hz / 1000 - 1); w(m, PWM + 0xc, hz / 2000); w(m, PWM, 1);
  m.audio.configure({ pin: 0, converter: 'pin' });
  const x = collect(m, 0.25);
  assert.ok(Math.abs(x.length - 0.25 * SAMPLE_RATE) < 400, `${x.length} frames`);
  const t = tone(x, 1000);
  assert.ok(t.rms > 0.3, `loud: rms ${t.rms}`);
  assert.ok(t.db > -1.5, `the fundamental holds 8/pi^2 of a square wave's power: ${t.db.toFixed(2)} dB`);
});

test('PWM + DMA sine: a channel paced by the slice\'s wrap DREQ streams a 64-entry table into CC; both converters give the tone', () => {
  for (const converter of ['pin', 'ideal']) {
    const m = machine(), hz = m.freq.sys, top = 249, f = hz / (top + 1) / 64; // 64 periods per cycle of the sine
    const table = SRAM + 0x1000;
    for (let i = 0; i < 64; i++) w(m, table + 4 * i, Math.round((top + 1) * (0.5 + 0.4 * Math.sin((2 * Math.PI * i) / 64))));
    w(m, PADS + 4, 0x50); w(m, IO + 4, 4);
    w(m, PWM + 0x10, top);
    // channel 0: table -> slice 0 CC, 32-bit, read ring of 256 bytes, ENDLESS, paced by DREQ_PWM_WRAP0, no chain
    w(m, DMA + 0x0, table); w(m, DMA + 0x4, PWM + 0xc); w(m, DMA + 0x8, (0xf << 28) | 1);
    w(m, DMA + 0xc, 1 | (2 << 2) | (1 << 4) | (8 << 8) | (0 << 13) | (32 << 17));
    w(m, PWM, 1);
    m.audio.configure({ pin: 0, converter });
    assert.equal(m.audio.mode, converter);
    const x = collect(m, 0.3);
    const t = tone(x, f);
    assert.ok(t.db > -3, `${converter}: ${f.toFixed(1)} Hz holds most of the power (${t.db.toFixed(2)} dB)`);
    assert.ok(m.dma.transfers > 1000);
  }
});

test('the ideal DAC falls back to pin-accurate for a pin that is not a free-running trailing-edge PWM output', () => {
  const m = machine();
  w(m, PADS + 4, 0x50); w(m, IO + 4, 5); // SIO
  m.audio.configure({ pin: 0, converter: 'ideal' });
  assert.equal(m.audio.mode, 'pin'); assert.equal(m.audio.fallback, true);
  w(m, IO + 4, 4); w(m, PWM, 1 | 2); m.audio.drain(10, m.hart.ticks + 10);
  assert.equal(m.audio.mode, 'pin', 'phase-correct: not ideal');
  w(m, PWM, 1); m.audio.drain(10, m.hart.ticks + 20);
  assert.equal(m.audio.mode, 'ideal');
});

test('engine: configure from the shell\'s option values, drainAudio up to the present time, the setting survives reset and snapshot', () => {
  const src = '.text\n.globl _start\n_start:\n  li t0, 0x40028000\n  li t1, 5\n  sw t1, 0x7c(t0)\nloop:\n  j loop\n';
  const p = assemble([{ name: 't.s', text: src }]);
  assert.ok(p.ok, JSON.stringify(p.diagnostics));
  const e = create(p);
  assert.equal(e.drainAudio(100), null, 'no speaker: nothing');
  e.configure({ speaker: 'gp15', dac: 'pin' });
  assert.deepEqual(e.audioStatus(), { pin: 15, converter: 'pin', active: 'pin', fallback: false });
  e.advance({ cycles: 110_000 });
  const r = e.drainAudio(1 << 16);
  assert.ok(r && r.frames[0].length > 400, 'about 10 ms of frames');
  e.reset(); assert.equal(e.audioStatus().pin, 15);
  const snap = e.snapshot(); const e2 = create(p); e2.restore(snap); assert.equal(e2.audioStatus().pin, 15);
});
