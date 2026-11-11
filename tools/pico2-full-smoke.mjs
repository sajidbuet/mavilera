// pico2-full-smoke.mjs -- the Pico Full compiler in a real browser (pico2 P1-F2, research D33): with an empty cache the
// compiler and the SDK pack download with progress for each file and are checked and cached; a program builds to an
// ELF in the Worker; a compile error comes back located; after a reload everything comes from the cache; with the
// server's /pico-full/ gone (offline) the cached compiler still builds.
//
//   node tools/pico2-full-smoke.mjs [--browser chrome|edge]     (env: PICO_FULL_SITE, from tools/pico-full/stage.mjs)
//
// Development only; skipped, with the reason, without PICO_FULL_SITE.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const SITE = process.env.PICO_FULL_SITE;
if (!SITE || !existsSync(join(SITE, 'current.json'))) {
  console.log('skipped: needs PICO_FULL_SITE (a folder made by tools/pico-full/stage.mjs)');
  process.exit(0);
}
const HELLO = '#include "pico/stdlib.h"\n#include <stdio.h>\n\nint main(void) {\n    stdio_init_all();\n    printf("hello\\n");\n    return 0;\n}\n';
const BAD = '#include "pico/stdlib.h"\nint main(void) {\n    gpio_init(25)\n    return 0;\n}\n';
const J = JSON.stringify;

let failed = 0;
for (const name of BROWSERS) {
  let { server, url } = await startServer({ port: 0, picoFull: SITE });
  const port = new URL(url).port;
  const b = await launch(name);
  if (!b) { console.log(`${name}: not installed, skipped`); server.close(); continue; }
  console.log(`${name} (${b.version}), Pico Full compiler`);
  const check = async (label, fn) => {
    try { const r = await fn(); console.log(`  ok   ${label}${r ? ` — ${r}` : ''}`); } catch (e) { failed++; console.log(`  FAIL ${label} — ${e.message}`); }
  };
  try {
    const p = await b.newPage({ width: 1366, height: 768 });
    const page = `${url}?arch=pico2&edition=full`;
    await p.goto(page);
    await p.eval(`caches.delete('mavilera-pico-full-v1').then(() => true)`);
    const setup = `(async () => { const { FullCompiler } = await import('/src/arch/pico2/full/client.js'); window.__fc = new FullCompiler(); window.__ev = []; return true; })()`;
    await p.eval(setup);

    await check('empty cache: the probe offers the whole download', async () => {
      const m = await p.eval(`__fc.probe()`);
      if (m.toDownload !== m.transfer || m.compiler.cached || m.pack.cached) throw new Error(J(m));
      const mb = (n) => (n / 1e6).toFixed(1);
      return `version ${m.version}: ${mb(m.transfer)} MB to download (compiler ${mb(m.compiler.transferBytes ?? m.compiler.bytes)}, pack ${mb(m.pack.transferBytes ?? m.pack.bytes)}), ${mb(m.total)} MB kept`;
    });

    await check('load: progress for each file up to its size, then checked, cached and prepared', async () => {
      const t0 = Date.now();
      const r = await p.eval(`__fc.load((e) => __ev.push({ f: e.file, l: e.loaded, t: e.total, d: e.done }))`, 180000);
      const ev = await p.eval(`__ev`);
      for (const f of ['compiler', 'pack']) {
        const e = ev.filter((x) => x.f === f);
        if (e.length < 2) throw new Error(`${f}: ${e.length} progress events`);
        if (e.some((x, i) => i && x.l < e[i - 1].l)) throw new Error(`${f}: progress went backwards`);
        const last = e[e.length - 1];
        if (!last.d || last.l !== last.t) throw new Error(`${f}: ended at ${last.l} of ${last.t}`);
      }
      const cached = await p.eval(`__fc.probe().then((m) => m.toDownload)`);
      if (cached !== 0) throw new Error(`still to download after load: ${cached}`);
      return `${Date.now() - t0} ms (download+compile ${r.times.download} ms, precompiled header ${r.times.pch} ms); ${ev.length} progress events`;
    });

    await check('build: a program becomes an ELF in the Worker', async () => {
      const r = await p.eval(`__fc.build([{ name: 'main.c', text: ${J(HELLO)} }]).then((r) => ({ ok: r.ok, magic: r.elf && Array.from(r.elf.slice(0, 4)), times: r.times, pch: r.pch, d: r.diagnostics }))`, 60000);
      if (!r.ok || r.magic.join() !== '127,69,76,70') throw new Error(J(r));
      const again = await p.eval(`__fc.build([{ name: 'main.c', text: ${J(HELLO)} }]).then((r) => r.times)`);
      return `first ${r.times.total} ms, again ${again.total} ms (compile ${again.compile}, link ${again.link}); precompiled header ${r.pch}`;
    });

    await check('build: a compile error comes back with its file and line', async () => {
      const r = await p.eval(`__fc.build([{ name: 'main.c', text: ${J(BAD)} }])`);
      const e = r.diagnostics.find((d) => d.severity === 'error');
      if (r.ok || !e || e.file !== 'main.c' || e.line !== 3) throw new Error(J(r.diagnostics));
      return `main.c:${e.line}: ${e.message}`;
    });

    await check('reload: the compiler and pack come from the cache', async () => {
      await p.goto(page);
      await p.eval(setup);
      const t0 = Date.now();
      const r = await p.eval(`__fc.load((e) => __ev.push(e))`, 120000);
      const ev = await p.eval(`__ev`);
      if (!r.fromCache || !ev.every((e) => e.fromCache)) throw new Error(J({ r, ev: ev.slice(0, 3) }));
      return `${Date.now() - t0} ms to ready from the cache`;
    });

    await check('offline (the server no longer serves /pico-full/): the cached compiler still builds', async () => {
      server.close();
      ({ server } = await startServer({ port: Number(port), picoFull: null }));
      await p.goto(page);
      await p.eval(setup);
      const r = await p.eval(`__fc.load().then(() => __fc.build([{ name: 'main.c', text: ${J(HELLO)} }])).then((r) => r.ok)`, 120000);
      if (!r) throw new Error('build failed');
    });

    await check('no errors in the page', async () => { if (p.errors.length) throw new Error(p.errors.slice(0, 3).join(' | ')); });
  } finally {
    await b.close();
    server.close();
  }
}
process.exitCode = failed ? 1 : 0;
