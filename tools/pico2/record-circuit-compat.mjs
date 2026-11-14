// tools/pico2/record-circuit-compat.mjs -- the P1-B2 compatibility fixtures (design docs/architecture/pico2-p1b2-user-circuits.md
// §5.1): every pico2 template run for a fixed machine time, plus input scenarios (button presses, knob turns, pin drives,
// environment), and what a student sees recorded: the UART text, the pin log (cycle, pin, state), steps, halt, the ADC volts.
// Recorded once on the code before P1-B2 (main bc2e446); test/pico2-circuit-compat.test.mjs runs the same scenarios through the
// circuit model with no user parts and compares. `--check` compares instead of writing.
//   node tools/pico2/record-circuit-compat.mjs [--check]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { descriptor } from '../../src/arch/pico2/index.js';
import { STOP } from '../../src/arch/contract.js';

const root = new URL('../../', import.meta.url);
const dir = new URL('content/pico2/templates/', root);
export const FIXTURE = new URL('test/fixtures/pico2-circuit-compat.json', root);
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
const cc = await descriptor.language.extraLanguages.find((x) => x.id === 'c').load();

/** Build a template as the shell's Lite edition does (C through the pico2 target, the companion with it). */
export function build(t, clock = '4') {
  const text = t.text ?? readFileSync(new URL(t.file, dir), 'utf8'); // (B2-4 tests: a program's own text)
  const companions = t.companion ? [{ name: t.companion, text: readFileSync(new URL(t.companion, dir), 'utf8') }] : [];
  const options = { clock };
  let files = [{ name: t.file, text }, ...companions];
  if (t.lang === 'c') {
    const r = cc.compile(text, { name: t.file, profile: 'hazard3', companions, options });
    if (!r.ok) throw new Error(`${t.file}: ${JSON.stringify(r.diagnostics.slice(0, 2))}`);
    files = [{ name: t.file.replace(/\.c$/, '.s'), text: r.text }];
  }
  const p = descriptor.language.assemble(files, { profile: 'hazard3', options });
  if (!p.ok) throw new Error(`${t.file}: ${JSON.stringify(p.diagnostics.slice(0, 2))}`);
  return p;
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * The scenarios: [name, template id, clock, inputs [[seconds, input]], seconds to run]. Inputs are given when the machine time
 * passes their second (Engine.input stamps them there).
 */
export const SCENARIOS = [
  // the templates of `bc2e446` (B2-4's circuit templates, with circuits of their own, came later: test/pico2-templates.test.mjs)
  ...index.templates.filter((t) => !t.circuit).map((t) => [`run:${t.id}`, t.id, '4', [], 2]),
  ['button-5', 'gpio-button', '4', [0.02, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2].map((s, i) => [s, { kind: 'pin', pin: 15, level: i % 2 ? -1 : 0 }]), 2],
  ['button-high-low', 'gpio-button', '1', [[0.03, { kind: 'pin', pin: 15, level: 1 }], [0.06, { kind: 'pin', pin: 15, level: 0 }], [0.09, { kind: 'pin', pin: 15, level: -1 }],
    [0.12, { kind: 'pin', pin: 15, level: 0 }], [0.15, { kind: 'pin', pin: 15, level: -1 }]], 1],
  ['knob', 'adc-knob', '4', [[0.15, { kind: 'adc', channel: 0, volts: 1.65 }], [0.75, { kind: 'adc', channel: 0, volts: 3.3 }], [1.5, { kind: 'adc', channel: 0, volts: 0.42 }]], 4],
  ['knob-12', 'adc-knob', '12', [[0.1, { kind: 'adc', channel: 0, volts: 2.2 }]], 2],
  ['temperature', 'temperature', '4', [[0.2, { kind: 'env', key: 'temp', value: 40 }]], 2],
  ['drives', 'blink-c', '4', [[0.01, { kind: 'pin', pin: 3, level: 1 }], [0.02, { kind: 'pin', pin: 25, level: 0 }], [0.03, { kind: 'pin', pin: 3, level: -1 }],
    [0.04, { kind: 'pin', pin: 26, level: 1 }], [0.05, { kind: 'pin', pin: 26, level: -1 }]], 0.5],
];

export function runScenario([name, id, clock, inputs, seconds]) {
  const t = index.templates.find((x) => x.id === id);
  const e = descriptor.engine.create(build(t, clock), { runLimit: Infinity });
  if (t.opts) e.configure(t.opts);
  const m = e.machine;
  const todo = inputs.slice();
  let r = { stop: STOP.CHUNK };
  while (r.stop === STOP.CHUNK && e.clock().timeNs < seconds * 1e9) {
    while (todo.length && e.clock().timeNs >= todo[0][0] * 1e9) e.input(todo.shift()[1]);
    r = e.advance({ cycles: Math.max(1, Math.ceil(m.freq.sys * 0.005)) });
  }
  const st = e.state(), lg = m.pins.log;
  return { name, steps: st.steps, halted: st.halted, error: st.error ?? null, output: sha(st.output), outputLength: st.output.length,
    pins: sha(JSON.stringify([lg.cycles, lg.pins, lg.states])), pinEvents: lg.base + lg.pins.length,
    levels: Array.from(m.pins.level).join(''), inMask: m.pins.inMask >>> 0, volts: m.adc.volts.map((v) => Math.round(v * 1e6) / 1e6) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = SCENARIOS.map(runScenario);
  if (process.argv.includes('--check')) {
    const want = JSON.parse(readFileSync(FIXTURE, 'utf8')).scenarios;
    let bad = 0;
    for (const s of out) { const w = want.find((x) => x.name === s.name); if (JSON.stringify(w) !== JSON.stringify(s)) { bad++; console.log('differs:', s.name, JSON.stringify(w), JSON.stringify(s)); } }
    console.log(`${out.length - bad}/${out.length} equal`);
    process.exit(bad ? 1 : 0);
  }
  writeFileSync(FIXTURE, JSON.stringify({ _copyright: 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code (test fixture).',
    recorded: 'main bc2e446 (before P1-B2), tools/pico2/record-circuit-compat.mjs', scenarios: out }, null, 1) + '\n');
  console.log(`${out.length} scenarios recorded`);
}
