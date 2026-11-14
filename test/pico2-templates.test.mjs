// The Pico 2 templates (content/pico2/templates, P1-L1, list approved by the author 2026-11-09, research D34 Q8): each builds
// (assembly, or MAVILERA C with the pico2 target), runs to its ebreak, and shows what its comment says: UART text, the LED's
// changes and their spacing, the registers it names, the C source record of the C ones. The index opens each in a view the
// module has, in Pico Lite's languages. P1-M5 (research D39 Q10): four more (PWM fade, PWM tone, DMA + PWM sine, DMA copy);
// the sound ones choose the speaker pin (`opts`), and their pin's PWM edges give the note or the sine's carrier. Research D43
// (P1-M8 Q3 B): the PIO ones come as a pair, the program and its .pio file (`companion`), built together as the shell builds them.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { descriptor } from '../src/arch/pico2/index.js';
import { STOP, withEdition } from '../src/arch/contract.js';
import { parseExercise, runExercise } from '../src/arch/pico2/exercise.js';

const dir = new URL('../content/pico2/templates/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const C = descriptor.language.extraLanguages.find((x) => x.id === 'c');
const cc = await C.load();

/** Build and run a template to its end: {state, engine, program}. */
function run(t) {
  const text = readFileSync(new URL(t.file, dir), 'utf8');
  const companions = t.companion ? [{ name: t.companion, text: readFileSync(new URL(t.companion, dir), 'utf8') }] : [];
  let files = [{ name: t.file, text }, ...companions];
  const opts = { profile: 'hazard3' };
  if (t.lang === 'c') {
    const r = cc.compile(text, { name: t.file, profile: 'hazard3', companions });
    assert.ok(r.ok, `${t.file}: ${JSON.stringify(r.diagnostics)}`);
    files = [{ name: t.file.replace(/\.c$/, '.s'), text: r.text }];
    opts.source = { file: t.file, text, lines: r.lines };
  }
  const p = descriptor.language.assemble(files, opts);
  assert.ok(p.ok, `${t.file}: ${JSON.stringify(p.diagnostics.slice(0, 3))}`);
  const e = descriptor.engine.create(p, { runLimit: 10_000_000 }); // the shell's run limit (WS-F-090)
  if (t.opts) e.configure(t.opts); // P1-M7: the parts (and the speaker) as the shell applies a template's options
  if (t.circuit) e.configure({ circuit: readFileSync(new URL(t.circuit, dir), 'utf8') }); // B2-4: the template's circuit file
  for (const i of TEST_INPUTS[t.id] ?? []) e.input(i); // P1-M7: what a student would set in the Pins panel first
  // B2-4: inputs at machine times (ms) while it runs: a bouncing button, a change of light
  for (const [ms, i] of TIMED_INPUTS[t.id] ?? []) {
    // in small steps: the clock changes at start-up, so a step sized by the present frequency could pass the input's time
    while (e.clock().timeNs < ms * 1e6) assert.equal(e.advance({ cycles: Math.min(2000, Math.max(1, Math.ceil(((ms * 1e6 - e.clock().timeNs) / 1e9) * e.machine.freq.sys))) }).stop, STOP.CHUNK, `${t.file}: ended before ${ms} ms`);
    e.input(i);
  }
  if (t.endless) { // a template that plays until paused (`endless` in the index): run 4 s of machine time
    while (e.clock().timeNs < 4e9) assert.equal(e.advance({ cycles: 400_000 }).stop, STOP.CHUNK, `${t.file}: ${e.state().error}`);
    return { state: e.state(), engine: e, program: p };
  }
  let s;
  do s = e.run({ chunk: 1_000_000, resumed: true }); while (s === STOP.CHUNK);
  assert.equal(s, STOP.HALT, `${t.file}: ${e.state().error ?? s}`);
  return { state: e.state(), engine: e, program: p };
}
const x = (st, n) => st.registers[`x${n}`] >>> 0;
/** The times (ms) of GP25's changes after its first event (the pin becoming an output, low). */
function ledChanges(engine) {
  const m = engine.machine, log = m.pins.log, t = [];
  for (let i = 0; i < log.pins.length; i++) if (log.pins[i] === 25) t.push(m.nsAt(log.cycles[i]) / 1e6);
  return t.slice(1);
}
const spacedBy = (t, ms) => t.slice(1).every((v, i) => Math.abs(v - t[i] - ms) < ms * 0.01);
/** Pin n's rising edges (ms) and the high time of each period that follows (fraction), from its 0/1 log entries. */
function pwmOf(engine, n) {
  const m = engine.machine, log = m.pins.log, ev = [];
  for (let i = 0; i < log.pins.length; i++) if (log.pins[i] === n && log.states[i] <= 1) ev.push([m.nsAt(log.cycles[i]) / 1e6, log.states[i]]);
  const rises = [], duty = [];
  for (let i = 0; i < ev.length; i++) if (ev[i][1] === 1 && ev[i + 1]?.[1] === 0 && ev[i + 2]?.[1] === 1) { rises.push(ev[i][0]); duty.push((ev[i + 1][0] - ev[i][0]) / (ev[i + 2][0] - ev[i][0])); }
  return { rises, duty };
}
const hz = (rises, from, to) => { const r = rises.filter((x) => x >= from && x < to); return (r.length - 1) / ((r[r.length - 1] - r[0]) / 1000); };

const EXPECT = {
  tour: ({ state: s }) => { assert.equal(x(s, 12), 150); assert.equal(x(s, 13), 4); assert.equal(x(s, 10), 22500); },
  'hello-uart': ({ state: s }) => assert.equal(s.output, 'Hello from Hazard3 on the Pico 2!\n'),
  'blink-asm': ({ engine }) => { const t = ledChanges(engine); assert.equal(t.length, 10); assert.ok(spacedBy(t, 100), t.join(', ')); },
  'timer-irq': ({ engine }) => { const t = ledChanges(engine); assert.equal(t.length, 5); assert.ok(spacedBy(t, 50), t.join(', ')); },
  'load-use': ({ state: s }) => { assert.equal(x(s, 12), 31); assert.equal(x(s, 13), 31); assert.equal(x(s, 19) - x(s, 20), 8); },
  'zcmp-call': ({ state: s }) => assert.equal(x(s, 10), 720),
  'blink-c': ({ engine }) => { const t = ledChanges(engine); assert.equal(t.length, 10); assert.ok(spacedBy(t, 100), t.join(', ')); },
  'hello-c': ({ state: s }) => assert.equal(s.output, 'Hello, Pico 2! Squares: 1 4 9 16 25\n'),
  'sum-array': ({ state: s }) => assert.equal(x(s, 10), 140),
  'time-us': ({ state: s }) => { assert.match(s.output, /^1000 additions took \d+ us\n$/); assert.equal(x(s, 10), 499500); },
  // P1-M5: GP25's duty rises to 100 % and falls back (a 1000-cycle period), ending at level 0
  'pwm-fade': ({ state: s, engine }) => {
    const { duty } = pwmOf(engine, 25);
    assert.equal(x(s, 10), 0); assert.ok(duty.length > 100, `${duty.length} periods`);
    const top = Math.max(...duty); assert.ok(top > 0.9 && top < 1, `highest duty ${top}`);
    assert.ok(duty[0] < 0.1 && duty[duty.length - 1] < 0.1, 'starts and ends dark');
  },
  // five square-wave notes, 300 ms each, on GP14 (the speaker): C5 D5 E5 G5 C6 within 1 %
  'pwm-tone': ({ engine }) => {
    const { rises, duty } = pwmOf(engine, 14), t0 = rises[0];
    [523, 587, 659, 784, 1047].forEach((f, k) => { const got = hz(rises, t0 + 300 * k + 20, t0 + 300 * k + 280); assert.ok(Math.abs(got - f) / f < 0.01, `note ${k}: ${got} Hz`); });
    assert.ok(duty.filter((d) => Math.abs(d - 0.5) < 0.01).length > 0.98 * duty.length, 'square waves (but the periods where a note starts)');
  },
  // the carrier at clk_sys / 100 (40 kHz at the default 4 MHz) for 3 s; its duty follows the table: 0.05 to 0.95, 64 periods per cycle
  'dma-sine': ({ engine }) => {
    const { rises, duty } = pwmOf(engine, 14);
    assert.ok(Math.abs(hz(rises, 100, 2900) - 40000) < 40, 'carrier 40 kHz');
    const d = duty.slice(1000, 1064).map((v) => Math.round(v * 100));
    assert.ok(Math.min(...d) === 5 && Math.max(...d) === 95, `levels ${Math.min(...d)}..${Math.max(...d)}`);
    assert.equal(duty[1000 + 64] !== undefined && Math.round(duty[1000 + 64] * 100), d[0], 'period of the sine: 64 carrier periods');
    assert.ok(engine.machine.dma.transfers > 100000, `${engine.machine.dma.transfers} DMA transfers`);
  },
  // P1-M6: two cores. GP25 ten changes 100 ms apart on core 0, GP15 six 150 ms apart on core 1, exit code 1 from core 1's FIFO word
  'two-cores': ({ state: s, engine }) => {
    const m = engine.machine, log = m.pins.log, at = (n) => { const t = []; for (let i = 0; i < log.pins.length; i++) if (log.pins[i] === n) t.push(m.nsAt(log.cycles[i]) / 1e6); return t.slice(1); };
    const a = at(25), b = at(15);
    assert.equal(a.length, 10); assert.ok(spacedBy(a, 100), a.join(', '));
    assert.equal(b.length, 6); assert.ok(spacedBy(b, 150), b.join(', '));
    assert.ok(Math.abs(b[0] - a[0]) < 1, 'both cores start within a millisecond');
    assert.equal(x(s, 10), 1); assert.equal(m.core1.parked, true, 'core 1 returned to the bootrom');
  },
  'fifo-message': ({ state: s, engine }) => { assert.equal(x(s, 10), 50); assert.equal(engine.machine.core1.launches, 1); },
  // the author's request (2026-11-10): the tune in a loop; its first nine notes in the first 4 s (C C G G A A G-, F F), each within 1 %
  twinkle: ({ engine }) => {
    const { rises } = pwmOf(engine, 14), t0 = rises[0];
    const tune = [523, 523, 784, 784, 880, 880, 784, 0, 698, 698]; // 0: the second beat of the long G
    tune.forEach((f, k) => { if (!f) return; const got = hz(rises, t0 + 400 * k + 20, t0 + 400 * k + 340); assert.ok(Math.abs(got - f) / f < 0.01, `note ${k}: ${got} Hz, not ${f}`); });
    assert.equal(engine.state().halted, false, 'still playing');
  },
  'dma-copy': ({ state: s, engine }) => { assert.equal(x(s, 10), 136); assert.ok(x(s, 11) >= 2, `polls ${x(s, 11)}`); assert.equal(engine.machine.dma.transfers, 16); },
  // P1-M7 (design Q6): GP26 at 1.65 V reads 2048 = 1650 mV ten times; the die at 25 °C prints 24.86 C; the kit's MCP9808 at 21.5 °C
  // prints 21.5000 C three times; the LCD shows the greeting and the last count; SPI loopback sums its four bytes to 0xaa
  'adc-knob': ({ state: s, engine }) => {
    assert.equal(s.output, `GP26 (ADC input 0):\n${'result 2048 = 1650 mV\n'.repeat(10)}`); assert.equal(engine.machine.adc.conversions, 10);
  },
  temperature: ({ state: s }) => assert.equal(s.output, 'result 881, temperature 24.86 C\n'.repeat(5)),
  'i2c-mcp9808': ({ state: s, engine }) => {
    assert.equal(s.output, 'MCP9808: 21.5000 C\n'.repeat(3)); assert.equal(engine.machine.i2c[0].log.filter((e) => e.addr === 0x18).length, 6);
  },
  'i2c-lcd': ({ engine }) => assert.deepEqual(engine.machine.kit.lcd.lines(), [' Hello, Pico 2! ', 'count: 9        ']),
  'spi-loopback': ({ state: s, engine }) => { assert.equal(x(s, 10), 0xaa); assert.equal(engine.machine.spi[0].frames, 4); },
  // P1-M8 (design Q7): GP25 by PIO, 250 ms per half period over two seconds; 440 Hz on GP14 within 1 %; four popcounts through the FIFOs
  'pio-blink': ({ engine }) => { const t = ledChanges(engine); assert.ok(t.length >= 7, `${t.length} changes`); assert.ok(spacedBy(t.slice(1, 7), 250), t.join(', ')); },
  'pio-square': ({ engine }) => { const { rises } = pwmOf(engine, 14); const f = hz(rises, rises[1], rises[rises.length - 1] + 1); assert.ok(Math.abs(f - 440) / 440 < 0.01, `${f} Hz`); },
  'pio-popcount': ({ state: s }) => assert.equal(s.output, '0x00000001 has 1 ones\n0x0000ffff has 16 ones\n0x80000001 has 2 ones\n0xdeadbeef has 24 ones\n'),
  // P1-M9 (research D45 Q3): inputs at their times, through the module's exercise runner (TIMED below)
  'gpio-button': () => {},
  'uart-echo': () => {},
  // P1-B2 B2-4 (research D54 Q6 A): the circuit templates, with their circuit files; the hand calculations in each comment
  'circuit-led': ({ engine }) => {
    const m = engine.machine, log = m.pins.log, t = [];
    for (let i = 0; i < log.pins.length; i++) if (log.pins[i] === 16) t.push(m.nsAt(log.cycles[i]) / 1e6);
    assert.ok(spacedBy(t.slice(-10), 200), t.join(', '));
    // half the time at about 5.7 mA ((3.3 − 1.65)/(45 + 220 + 25); a little less with GP16's pull-down): a mean of 2.4-2.9 mA
    const led = engine.live().circuit.leds.find((x) => x.part === 'D1');
    assert.ok(led.mA > 2.4 && led.mA < 2.9, `${led.mA} mA`);
  },
  'traffic-light': ({ state: s }) => assert.equal(s.output, 'red\nred and yellow\ngreen\nyellow\n'.repeat(2)),
  'divider-adc': ({ state: s }) => assert.equal(s.output, 'GP27: 2048 = 1650 mV\n'.repeat(3)),
  'npn-switch': ({ state: s, engine }) => {
    assert.equal(s.output, 'base high: the transistor conducts, the LED is on\nbase low: the transistor is cut off, the LED is off\n'.repeat(3));
    // saturated: (3.3 − 1.8425 − 0.0575)/(330 + 18.75 + 1.25) = 4.0 mA half the time
    const led = engine.live().circuit.leds.find((x) => x.part === 'D1');
    assert.ok(led.mA > 1.7 && led.mA < 2.1, `${led.mA} mA`);
  },
  // two presses, each bouncing three times 0.1 ms apart: the capacitor keeps GP14 low between bounces, so each counts once
  'rc-debounce': ({ state: s }) => { assert.equal(s.output, 'press 1\npress 2\n'); assert.equal(x(s, 10), 2); },
  'pwm-rc-dac': ({ state: s }) => {
    const mv = [...s.output.matchAll(/: (\d+) mV/g)].map((k) => Number(k[1]));
    [825, 1650, 2475].forEach((want, i) => assert.ok(Math.abs(mv[i] - want) <= 10, `${s.output}`));
  },
  'ldr-night-light': ({ state: s }) => assert.equal(s.output, 'light: LED off\ndark: LED on\n'),
  'ntc-thermometer': ({ state: s }) => assert.match(s.output, /^(GP28 = 11[34]\d mV: about 40 C\n){3}$/),
};
/** B2-4: inputs given while a template runs: [ms of machine time, input]. */
const press = (ms) => [[ms, 1], [ms + 0.1, 0], [ms + 0.2, 1], [ms + 0.3, 0], [ms + 0.4, 1], [ms + 50, 0]].map(([t, v]) => [t, { kind: 'part', id: 'SW1', value: v }]);
const TIMED_INPUTS = { 'rc-debounce': [...press(100), ...press(300)], 'ldr-night-light': [[350, { kind: 'env', key: 'light', value: 2 }]] };
/** Templates that wait for inputs given while they run: the inputs and what to see, as a Pico 2 exercise test (exercise.js). */
const TIMED = {
  'gpio-button': { inputs: [{ us: 0, pin: 15, level: 1 }, ...[5, 15, 25, 35, 45].flatMap((ms) => [{ us: ms * 1000, pin: 15, level: 0 }, { us: (ms + 3) * 1000, pin: 15, level: 1 }])],
    expect: { output: [1, 2, 3, 4, 5].map((n) => `press ${n}\n`).join(''), exit: 5, pins: { 25: 1 } } },
  'uart-echo': { inputs: [{ us: 2000, uart: 'Hello, Pico 2!\r' }], expect: { output: 'HELLO, PICO 2!\n', exit: 0 } },
};
const TEST_INPUTS = { 'adc-knob': [{ kind: 'adc', channel: 0, volts: 1.65 }], 'i2c-mcp9808': [{ kind: 'env', key: 'temp', value: 21.5 }],
  'ntc-thermometer': [{ kind: 'env', key: 'temp', value: 40 }] };

test('pico2 templates: the sixteen of the approved lists (D34 Q8, D39 Q10) and of P1-M6 (design Q8), in views and languages of Pico Lite', () => {
  assert.equal(index.templates.length, 35); // and Twinkle, Twinkle (the author's request, 2026-11-10); P1-M7's five (design Q6); P1-M8's three (design Q7); P1-M9's two (research D45 Q3); P1-B2's eight circuits (research D54 Q6 A)
  for (const t of index.templates) if (t.circuit) assert.ok(readFileSync(new URL(t.circuit, dir), 'utf8').includes('"mavilera-pico2-circuit"'), `${t.id}: circuit ${t.circuit}`);
  for (const t of index.templates) if (t.opts) for (const [k, v] of Object.entries(t.opts)) assert.ok(descriptor.language.options.find((o) => o.id === k)?.values.some((o) => o.id === v), `${t.id}: opts ${k}=${v}`);
  assert.deepEqual(Object.keys(EXPECT).sort(), index.templates.map((t) => t.id).sort());
  const lite = withEdition(descriptor, 'lite');
  const langs = ['asm', ...lite.language.extraLanguages.map((l) => l.id)];
  for (const t of index.templates) {
    assert.ok(descriptor.views.some((v) => v.id === t.view), `${t.id}: view ${t.view}`);
    assert.ok(langs.includes(t.lang), `${t.id}: language ${t.lang}`);
    assert.ok(Object.hasOwn(index.groups, t.group), `${t.id}: group ${t.group}`);
    assert.ok(t.file.endsWith(t.lang === 'c' ? '.c' : '.s'));
    for (const f of [t.file, ...(t.companion ? [t.companion] : [])]) {
      const head = readFileSync(new URL(f, dir), 'utf8').split('\n').slice(0, 3).join('\n');
      assert.match(head, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./, f);
    }
    if (t.companion) assert.ok(t.companion.endsWith(descriptor.language.companion.extension), `${t.id}: companion ${t.companion}`);
  }
  // research D43: the three PIO templates are pairs; none other has a companion
  assert.deepEqual(index.templates.filter((t) => t.companion).map((t) => t.id), ['pio-blink', 'pio-square', 'pio-popcount']);
});

for (const t of index.templates) {
  test(`pico2 template ${t.id} (${t.file}): runs to its end and shows what its comment says`, () => {
    if (TIMED[t.id]) { // built as run() builds it, run with its inputs at their times
      const text = readFileSync(new URL(t.file, dir), 'utf8');
      const src = t.lang === 'c' ? cc.compile(text, { name: t.file, profile: 'hazard3' }).text : text;
      const p = descriptor.language.assemble([{ name: t.file.replace(/\.c$/, '.s'), text: src }], { profile: 'hazard3' });
      assert.ok(p.ok, JSON.stringify(p.diagnostics?.slice(0, 3)));
      const ex = parseExercise({ format: 'risc-vista-exercise', version: 1, arch: 'pico2', title: t.id, tests: [{ name: t.id, limitMs: 500, ...TIMED[t.id] }] });
      const [res] = runExercise(p, ex);
      assert.ok(res.pass, `: ${res.error ?? ''} ${JSON.stringify(res.checks.filter((c) => !c.ok))}`);
      return;
    }
    const r = run(t);
    EXPECT[t.id](r);
    if (t.lang === 'c') assert.ok(r.program.debug?.lineTable.linesOf(0).length > 3, 'C lines for the source view');
  });
}
