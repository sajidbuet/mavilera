// pico2-sdk-samples.test.mjs -- Pico Full's sample projects in Pico SDK C (design docs/architecture/pico2-hardware-tab.md §10.3,
// the author's choice H7, 2026-11-15): each `lang: "sdk-c"` entry of content/pico2/templates/index.json is built by the Pico
// Full compiler (with its .pio companion through withPioHeaders, as a project build) and run on the model with the inputs a
// student would give; what its comment says must show. The index part runs always; the builds need PICO_FULL_WORK (build/
// llvm.wasm and an SDK pack, tools/pico-full) and are skipped, with the reason, without it. A sample that does not build and
// run here is not listed.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { descriptor } from '../src/arch/pico2/index.js';
import { withEdition } from '../src/arch/contract.js';

const dir = new URL('../content/pico2/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const SDK = index.templates.filter((t) => t.lang === 'sdk-c');

const W = process.env.PICO_FULL_WORK;
const manifest = W && existsSync(join(W, 'out', 'manifest.json')) ? JSON.parse(readFileSync(join(W, 'out', 'manifest.json'), 'utf8')) : null;
const ready = Boolean(manifest && existsSync(join(W, 'build', 'llvm.wasm')) && existsSync(join(W, 'out', manifest.sdkPack.file)));
const SKIP = ready ? false : 'needs PICO_FULL_WORK with build/llvm.wasm and an SDK pack (tools/pico-full)';
let host = null;
async function getHost() {
  const { CompilerHost } = await import('../src/arch/pico2/full/host.js');
  host ??= new CompilerHost({ module: await WebAssembly.compile(readFileSync(join(W, 'build', 'llvm.wasm'))), pack: new Uint8Array(readFileSync(join(W, 'out', manifest.sdkPack.file))) });
  return host;
}

/** Build a sample as a Full project builds it: its file and companion, the .pio turned into its header. */
async function build(t) {
  const { withPioHeaders } = await import('../src/arch/pico2/pio/asm.js');
  const files = [{ name: t.file, text: readFileSync(new URL(t.file, dir), 'utf8') }];
  if (t.companion) files.push({ name: t.companion, text: readFileSync(new URL(t.companion, dir), 'utf8') });
  const pr = withPioHeaders(files);
  assert.ok(pr.ok, JSON.stringify(pr.diagnostics));
  const r = await (await getHost()).build(pr.files);
  assert.ok(r.ok, `${t.file}: ${JSON.stringify(r.diagnostics?.slice(0, 3))} ${r.log?.map((j) => j.stderr).join('').slice(0, 600)}`);
  return r;
}

/** Run an ELF on the model for `ms` of machine time with the sample's options and inputs ([ms, input] at their times). */
function run(t, elf, ms, { inputs = [], timed = [] } = {}) {
  const e = descriptor.engine.create(descriptor.language.loadImage(elf, 'elf', `${t.id}.elf`), { runLimit: Infinity });
  if (t.opts) e.configure(t.opts);
  for (const i of inputs) e.input(i);
  const steps = [...timed].sort((a, b) => a[0] - b[0]);
  const until = (tMs) => {
    for (let last = -1; e.clock().timeNs < tMs * 1e6 && e.clock().timeNs !== last;) {
      last = e.clock().timeNs;
      const left = Math.ceil(((tMs * 1e6 - e.clock().timeNs) / 1e9) * e.machine.freq.sys);
      e.advance({ cycles: Math.max(1, Math.min(500_000, left)) });
    }
    assert.equal(e.state().error ?? null, null, `${t.id}: the program runs without an engine error`);
  };
  for (const [at, i] of steps) { until(at); e.input(i); }
  until(ms);
  return { text: e.machine.uart[0].text(), engine: e };
}

/** GP25's levels in time order (ms), from the pin log. */
function pinTimes(engine, pin) {
  const m = engine.machine, l = m.pins.log, out = [];
  for (let i = 0; i < l.pins.length; i++) if (l.pins[i] === pin && l.states[i] <= 1) out.push([m.nsAt(l.cycles[i]) / 1e6, l.states[i]]);
  return out;
}
const lines = (s) => s.replace(/\r\n/g, '\n');

/** What each sample must show: [ms of machine time, run options, check({text, engine})]. */
const EXPECT = {
  'sdk-hello': [2200, {}, ({ text }) => assert.equal(lines(text), 'Hello, Pico 2! Squares: 1 4 9 16 25\nstill running: 1 s\nstill running: 2 s\n')],
  'sdk-blink': [1100, {}, ({ engine }) => {
    const t = pinTimes(engine, 25).filter(([, v], i, a) => i === 0 || v !== a[i - 1][1]);
    const d = t.slice(2).map(([ms], i) => ms - t[i + 1][0]);
    assert.ok(d.length >= 3 && d.every((x) => Math.abs(x - 250) < 1), `half periods ${d.join(', ')} ms`);
  }],
  'sdk-button-irq': [80, { timed: [5, 25, 45].flatMap((ms) => [[ms, { kind: 'pin', pin: 15, level: 0 }], [ms + 5, { kind: 'pin', pin: 15, level: -1 }]]) },
    ({ text, engine }) => { assert.equal(lines(text), 'Press the button on GP15.\npress 1\npress 2\npress 3\n'); assert.equal(pinTimes(engine, 25).at(-1)?.[1], 1, 'three presses: the LED on'); }],
  'sdk-timer': [1300, {}, ({ text }) => {
    const m = /^10 ticks took (\d+) us\n$/.exec(lines(text));
    assert.ok(m && Math.abs(Number(m[1]) - 1_000_000) < 2000, text);
  }],
  'sdk-uart-echo': [60, { timed: [[10, { kind: 'uart', uart: 0, bytes: [...Buffer.from('Hello, Pico 2!\r')] }]] },
    ({ text }) => assert.equal(lines(text), 'Type a line:\nHELLO, PICO 2!\n')],
  'sdk-adc-knob': [3200, { inputs: [{ kind: 'adc', channel: 0, volts: 1.65 }] },
    ({ text }) => assert.equal(lines(text), `GP26 (ADC input 0):\n${'result 2048 = 1650 mV\n'.repeat(10)}`)],
  'sdk-temperature': [2600, {}, ({ text }) => assert.match(lines(text), /^(result \d+, temperature 2\d\.\d\d C\n){5}$/)],
  'sdk-pwm-fade': [2300, {}, ({ text, engine }) => {
    assert.equal(lines(text), 'faded twice; slice 4\n');
    assert.ok(pinTimes(engine, 25).length > 100, 'GP25 driven by PWM');
  }],
  'sdk-pwm-tone': [1700, {}, ({ text }) => assert.equal(lines(text), ['523 Hz: top 4480', '587 Hz: top 3991', '659 Hz: top 3555', '784 Hz: top 2988', '1047 Hz: top 2237'] /* 150 MHz / 64 / f - 1, integer division */.map((x) => `${x}\n`).join(''))],
  'sdk-i2c-mcp9808': [2300, { inputs: [{ kind: 'env', key: 'temp', value: 21.5 }] }, ({ text }) => assert.equal(lines(text), 'MCP9808: 21.5000 C\n'.repeat(3))],
  'sdk-i2c-lcd': [2600, {}, ({ engine }) => assert.deepEqual(engine.machine.kit.lcd.lines(), [' Hello, Pico 2! ', 'count: 9        '])],
  'sdk-spi-loopback': [50, {}, ({ text }) => assert.equal(lines(text), 'sent 0x11, received 0x11\nsent 0x22, received 0x22\nsent 0x33, received 0x33\nsent 0x44, received 0x44\nsum 0xaa\n')],
  'sdk-dma-copy': [50, {}, ({ text }) => assert.match(lines(text), /^channel \d+ copied 64 words; 64 are equal\n$/)],
  'sdk-pio-led': [2300, {}, ({ text, engine }) => {
    assert.equal(lines(text), 'PIO program at offset 30\ndone\n'); // pio_add_program places a program at the top of the 32 instructions
    const v = pinTimes(engine, 25).map(([, x]) => x).filter((x, i, a) => i === 0 || x !== a[i - 1]);
    assert.ok(v.length >= 10, `GP25 changed ${v.length} times`);
  }],
  // the complete project, SOS in Morse code (author, 2026-11-15): the LCD shows the knob and the temperature; GP25 flashes
  // ... --- ... with 200 ms units (on 1/3 units, off 1 inside a letter, 3 between letters, 7 before the next SOS); GP14 beeps
  // exactly while GP25 is on, at 1 kHz, 2 kHz while the button (GP15) is held (2100-3300 ms, with a bounce); a line per SOS
  'sdk-demo': [8000, { inputs: [{ kind: 'adc', channel: 0, volts: 1.65 }],
    timed: [[2100, { kind: 'pin', pin: 15, level: 0 }], [2100.2, { kind: 'pin', pin: 15, level: -1 }], [2100.4, { kind: 'pin', pin: 15, level: 0 }],
      [3300, { kind: 'pin', pin: 15, level: -1 }]] }, ({ text, engine }) => {
    const [l1, l2] = engine.machine.kit.lcd.lines();
    assert.equal(l1, 'GP26: 1650 mV   ');
    assert.match(l2, /^Temp: 2\d\.\d C {4}$/);
    const out = lines(text).split('\n').filter(Boolean);
    assert.equal(out[0], 'MAVILERA demo: SOS on LED GP25 and tone GP14; knob GP26, LCD 0x27, button GP15');
    assert.match(out.find((l) => l.startsWith('SOS')) ?? '', /^SOS 1 sent, GP26 1650 mV, 2\d\.\d C$/);
    assert.deepEqual(out.filter((l) => l.startsWith('button')), ['button down: tone 2000 Hz', 'button up: tone 1000 Hz']);
    // the LED's changes after it is first driven: alternating on and off intervals
    const led = pinTimes(engine, 25).filter(([, v], i, a) => i === 0 || v !== a[i - 1][1]).filter(([, v], i, a) => i > 0 || v === 1);
    const firstOn = led.find(([, v]) => v === 1)[0];
    assert.ok(firstOn < 400, `the LED first on at ${firstOn} ms`);
    const on = [], off = [];
    for (let i = led.findIndex(([, v]) => v === 1); i + 1 < led.length; i++) (led[i][1] === 1 ? on : off).push(Math.round(led[i + 1][0] - led[i][0]));
    // one SOS: on . . . - - - . . . ; off 1 1 3 1 1 3 1 1 7 (units of 200 ms)
    assert.deepEqual(on.slice(0, 9), [200, 200, 200, 600, 600, 600, 200, 200, 200], `on ${on.join(' ')}`);
    assert.deepEqual(off.slice(0, 9), [200, 200, 600, 200, 200, 600, 200, 200, 1400], `off ${off.join(' ')}`);
    // the beep follows the LED: edges of GP14 only while it is on; 1 kHz, 2 kHz while the button is held
    const tone = pinTimes(engine, 14);
    const intervals = []; for (let i = 0; i + 1 < led.length; i++) intervals.push([led[i][0], led[i + 1][0], led[i][1]]);
    for (const [a, b, v] of intervals.slice(0, 18)) {
      const n = tone.filter(([ms]) => ms > a + 2 && ms < b - 2).length, ms = b - a - 4;
      if (v === 0) { assert.equal(n, 0, `silent while the LED is off (${a.toFixed(0)}-${b.toFixed(0)} ms)`); continue; }
      const held = a > 2100 && b < 3300, free = b < 2100 || a > 3300;
      if (!held && !free) continue; // the press or release falls inside this flash
      const hz = (n / 2) / (ms / 1000);
      assert.ok(Math.abs(hz - (held ? 2000 : 1000)) < 25, `${hz.toFixed(0)} Hz in the flash at ${a.toFixed(0)} ms (button ${held ? 'held' : 'up'})`);
    }
  }],  'sdk-two-cores': [60, {}, ({ text }) => assert.equal(lines(text), [1, 2, 3, 4, 5].map((n) => `core 1: ${n} squared is ${n * n}\n`).join(''))],
};

test('Full sample projects in Pico SDK C: listed in topic groups, shown only in Full, each with a check here', () => {
  assert.deepEqual(SDK.map((t) => t.id).sort(), Object.keys(EXPECT).sort());
  const full = withEdition(descriptor, 'full');
  const compiler = full.editions.find((e) => e.id === 'full').compiler;
  assert.equal(compiler, 'sdk-c');
  for (const t of SDK) {
    assert.ok(Object.hasOwn(index.groups, t.group), `${t.id}: group ${t.group}`);
    assert.ok(t.file.endsWith('.c') && t.file.startsWith('sdk-'), t.file);
    for (const f of [t.file, ...(t.companion ? [t.companion] : [])]) {
      const head = readFileSync(new URL(f, dir), 'utf8').split('\n').slice(0, 3).join('\n');
      assert.match(head, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./, f);
      assert.match(head, /Rights class: content/, f);
    }
  }
  // the shell's menu filter (src/main.js templateLangOk): Lite lists assembly and MAVILERA C, never Pico SDK C; Full lists
  // assembly and Pico SDK C, never MAVILERA C
  const ok = (ed, t) => !ed || !t.lang || t.lang === 'asm' || (ed.compiler ? t.lang === ed.compiler : (ed.languages ?? []).includes(t.lang));
  const ed = (id) => descriptor.editions.find((e) => e.id === id);
  const lite = index.templates.filter((t) => ok(ed('lite'), t)), fullList = index.templates.filter((t) => ok(ed('full'), t));
  assert.ok(!lite.some((t) => t.lang === 'sdk-c') && lite.some((t) => t.lang === 'c'));
  assert.ok(!fullList.some((t) => t.lang === 'c') && fullList.filter((t) => t.lang === 'sdk-c').length === SDK.length);
  // every topic group except "Inside Hazard3" has something in Full
  for (const g of Object.keys(index.groups).filter((x) => x !== 'cpu')) assert.ok(fullList.some((t) => t.group === g), `Full: group ${g} is empty`);
});

for (const t of SDK) {
  test(`Full sample ${t.id} (${t.file}): builds with the Pico SDK and shows what its comment says on the model`, { skip: SKIP }, async () => {
    const [ms, o, check] = EXPECT[t.id];
    const r = await build(t);
    check(run(t, r.elf, ms, o));
  });
}
