// pico2-full-accept.mjs -- P1-F2's acceptance builds (pico2 P1-F2, research D33; roadmap: "the P1-M2 pico-examples set compiled
// in the browser gives the same UART/GPIO results on the simulator as the GCC images"): the P1-M2 gate programs are built in a
// real browser by the page's own compiler client (Worker, cached download, as a student's Build) and their ELFs saved, with
// the build times, for the research repository's P1-M2 harness (experiments/p1m2-oracle: run-pico2.mjs --via import, then
// compare.mjs against the GCC builds of the same programs).
//
//   node tools/pico2-full-accept.mjs --out <dir> [--browser chrome|edge]   (env: PICO_FULL_SITE, PICO_EXAMPLES_SRC)
//
// Writes <dir>/<browser>/<program>.elf and <dir>/<browser>/builds.json. Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = opt('--out'), SITE = process.env.PICO_FULL_SITE, EX = process.env.PICO_EXAMPLES_SRC;
if (!OUT || !SITE || !EX) { console.error('needs --out, PICO_FULL_SITE and PICO_EXAMPLES_SRC'); process.exit(2); }
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const PROGRAMS = { hello_uart: 'uart/hello_uart/hello_uart.c', blink: 'blink/blink.c', timer_lowlevel: 'timer/timer_lowlevel/timer_lowlevel.c',
  hello_gpio_irq: 'gpio/hello_gpio_irq/hello_gpio_irq.c', hello_timer: 'timer/hello_timer/hello_timer.c' };
const J = JSON.stringify;

for (const name of BROWSERS) {
  const { server, url } = await startServer({ port: 0, picoFull: SITE });
  const b = await launch(name);
  if (!b) { console.log(`${name}: not installed, skipped`); server.close(); continue; }
  try {
    const p = await b.newPage({ width: 1366, height: 768 });
    await p.goto(`${url}?arch=pico2&edition=full`);
    await p.eval(`caches.delete('mavilera-pico-full-v1').then(() => true)`);
    const t0 = Date.now();
    const load = await p.eval(`(async () => { const { FullCompiler } = await import('/src/arch/pico2/full/client.js'); window.__fc = new FullCompiler(); return __fc.load(); })()`);
    const ready = Date.now() - t0;
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    const builds = { browser: b.version, when: new Date().toISOString(), loadFromEmptyCacheMs: ready, load, programs: {} };
    for (const [prog, src] of Object.entries(PROGRAMS)) {
      const text = readFileSync(join(EX, src), 'utf8');
      const files = J([{ name: basename(src), text }]);
      const r = await p.eval(`__fc.build(${files}).then((r) => ({ ok: r.ok, times: r.times, elf: r.elf ? Array.from(r.elf) : null, d: r.diagnostics }))`);
      if (!r.ok) throw new Error(`${prog}: ${J(r.d)}`);
      const warm = await p.eval(`__fc.build(${files}).then((r) => r.times)`);
      writeFileSync(join(dir, `${prog}.elf`), Uint8Array.from(r.elf));
      builds.programs[prog] = { elfBytes: r.elf.length, first: r.times, warm };
      console.log(`${name} ${prog}: ${r.elf.length} B ELF; first ${r.times.total} ms, warm ${warm.total} ms (compile ${warm.compile}, link ${warm.link})`);
    }
    writeFileSync(join(dir, 'builds.json'), JSON.stringify(builds, null, 2));
    console.log(`${name}: ready from an empty cache in ${ready} ms (local server); ELFs in ${dir}`);
  } finally {
    await b.close();
    server.close();
  }
}
