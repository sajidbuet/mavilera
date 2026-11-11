// check-pack.mjs -- builds pico-examples programs from the SDK pack with the browser's build driver (in Node, the same
// WASI host and templates) and compares each loadable image with CMake's build of the same profile (build-check.ps1).
//
//   node tools/pico-full/check-pack.mjs [pack.bin]     (env: PICO_FULL_WORK, PICO_EXAMPLES_SRC)
//
// Programs that use only pico_stdlib must give identical images (the pack links CMake's objects in CMake's order).
// Programs with further libraries link those from the archive, after the base objects, so addresses may differ; their
// equivalence is shown by running them (the P1-M2 gate, stage 6). Writes out/check.json.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { readPack } from '../../src/arch/pico2/full/pack.js';
import { packFS, buildProject, preparePch } from '../../src/arch/pico2/full/driver.js';

const W = process.env.PICO_FULL_WORK, EX = process.env.PICO_EXAMPLES_SRC;
if (!W || !EX) { console.error('set PICO_FULL_WORK and PICO_EXAMPLES_SRC'); process.exit(2); }
const out = join(W, 'out');
const packFile = process.argv[2] ?? join(out, JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')).sdkPack.file);
const PROGRAMS = [
  ['hello_uart', 'uart/hello_uart/hello_uart.c', true], ['blink', 'blink/blink.c', true],
  ['timer_lowlevel', 'timer/timer_lowlevel/timer_lowlevel.c', true], ['hello_gpio_irq', 'gpio/hello_gpio_irq/hello_gpio_irq.c', true],
  ['hello_timer', 'timer/hello_timer/hello_timer.c', true], ['hello_watchdog', 'watchdog/hello_watchdog/hello_watchdog.c', true],
  ['hello_pwm', 'pwm/hello_pwm/hello_pwm.c', false], ['hello_adc', 'adc/hello_adc/hello_adc.c', false],
];

function loadable(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const phoff = dv.getUint32(28, true), es = dv.getUint16(42, true), n = dv.getUint16(44, true);
  const segs = [];
  for (let i = 0; i < n; i++) {
    const o = phoff + i * es;
    if (dv.getUint32(o, true) !== 1) continue;
    const off = dv.getUint32(o + 4, true), paddr = dv.getUint32(o + 12, true), filesz = dv.getUint32(o + 16, true);
    if (filesz) segs.push({ paddr, bytes: Buffer.from(b.subarray(off, off + filesz)) });
  }
  return segs;
}
const same = (a, b) => { const x = loadable(a), y = loadable(b); return x.length === y.length && x.every((s, i) => s.paddr === y[i].paddr && s.bytes.equals(y[i].bytes)); };
const size = (b) => loadable(b).reduce((n, s) => n + s.bytes.length, 0);

const { meta, files } = readPack(readFileSync(packFile));
const module = await WebAssembly.compile(readFileSync(join(W, 'build', 'llvm.wasm')));
const results = [];
for (const usePch of [false, true]) {
  for (const [name, src, stdlibOnly] of PROGRAMS) {
    const fs = packFS(files);
    if (usePch) { const p = await preparePch(module, fs, meta); if (!p.ok) throw new Error(p.stderr); }
    const text = readFileSync(join(EX, src), 'utf8');
    const r = await buildProject({ module, fs, meta, files: [{ name: basename(src), text }], usePch });
    const ref = new Uint8Array(readFileSync(join(W, 'build', 'check', `${name}.elf`)));
    const row = { name, usePch, ok: r.ok, ms: Math.round(r.jobs.reduce((s, j) => s + j.ms, 0)), steps: r.jobs.map((j) => j.step) };
    if (r.ok) Object.assign(row, { identical: same(r.elf, ref), packImage: size(r.elf), cmakeImage: size(ref), stdlibOnly });
    else row.error = r.jobs.filter((j) => j.code !== 0).map((j) => j.stderr).join('\n').slice(0, 600);
    results.push(row);
    console.log(`${usePch ? 'pch ' : '    '}${name.padEnd(16)} ${r.ok ? `built ${row.ms} ms; image ${row.packImage} B (CMake ${row.cmakeImage} B); identical: ${row.identical}` : `FAILED ${row.error}`}`);
  }
}
const bad = results.filter((r) => !r.ok || (r.stdlibOnly && !r.identical));
writeFileSync(join(out, 'check.json'), JSON.stringify({ pack: basename(packFile), when: new Date().toISOString(), results }, null, 2));
console.log(bad.length ? `${bad.length} problem(s)` : 'all built; every pico_stdlib-only program identical to CMake');
process.exitCode = bad.length ? 1 : 0;
