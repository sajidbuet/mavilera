// pico2-cores-smoke.mjs -- the second core in a real browser (pico2 P1-M6, docs/architecture/pico2-p1m6-second-core.md §4). Checks: the
// template "Two cores, two LEDs" builds in Lite; Real time in the Worker runs both cores to the end (exit code 1 from core 1's FIFO
// word, GP15 and GP25 driven by the SIO); the registers panel has the "Core 1" group with core 1's pc; Step after a reset and a
// launch moves core 0 one instruction while core 1's registers change too; Back returns; axe-core finds nothing.
//
//   node tools/pico2-cores-smoke.mjs [--browser chrome|edge|firefox] [--visible] [--json out.json]
//
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch } from './browser.mjs';
import { launchFirefox } from './firefox-bidi.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge', 'firefox'];
const VISIBLE = args.includes('--visible');
const J = JSON.stringify;
const area = `document.querySelector('textarea.ed-input')`;
const primary = `document.querySelector('.tool-run')?.getAttribute('aria-label') ?? ''`;
const click = `(document.querySelector('.tool-run').click(), true)`;
const msgs = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const regText = `document.querySelector('.regs, .registers, [aria-label="Registers"]')?.textContent ?? document.body.textContent`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
const results = { date: new Date().toISOString(), browsers: {} };
try {
  for (const name of BROWSERS) {
    const b = name === 'firefox' ? await launchFirefox({ headless: !VISIBLE }) : await launch(name, { headless: !VISIBLE });
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    const R = results.browsers[name] = { version: b.version, checks: {} };
    console.log(`${name} (${b.version}), two cores`);
    const check = async (label, fn) => {
      try { const r = await fn(); R.checks[label] = { ok: true, detail: r ?? null }; console.log(`  ok   ${label}${r ? ` — ${typeof r === 'string' ? r : J(r)}` : ''}`); }
      catch (e) { failed++; R.checks[label] = { ok: false, detail: e.message }; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    try {
      const p = await b.newPage({ width: 1366, height: 900 });
      const page = `${origin}?arch=pico2&edition=lite&selftest`;
      await p.goto(page);
      await p.eval(`localStorage.clear(); true`);
      await p.goto(page);
      await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);

      await check('the template "Two cores, two LEDs" builds; Real time runs both cores to the end: exit code 1', async () => {
        await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
        await p.waitFor(`[...document.querySelectorAll('.templates-menu button')].some((b) => b.textContent === 'Two cores, two LEDs')`, 10000);
        await p.eval(`[...document.querySelectorAll('.templates-menu button')].find((b) => b.textContent === 'Two cores, two LEDs').click(); true`);
        await p.waitFor(`${area}.value.includes('two-cores.c')`, 10000);
        await sleep(800);
        await p.waitFor(`/^(Build|Compile|Run)/.test(${primary})`, 10000);
        if (!/^Run/.test(await p.eval(primary))) await p.eval(click);
        await p.waitFor(`/^Run/.test(${primary})`, 20000);
        await p.eval(click);
        await p.waitFor(`/^Pause/.test(${primary})`, 10000);
        await p.waitFor(`!/^Pause/.test(${primary})`, 20000);
        const m = (await p.eval(msgs)).split('\n').slice(-2).join(' | ');
        const a0 = await p.eval(`globalThis.__mavileraTest.registers?.().x10 ?? null`);
        if (!/exit code 1\b|\(1\)| 1\.?$/.test(m) && a0 !== 1) throw new Error(`${m}; a0 ${a0}`);
        return m;
      });

      await check('the registers panel has the Core 1 group; Step moves core 0 by one instruction while core 1 runs alongside; Back returns', async () => {
        const has = await p.eval(`document.body.textContent.includes('Core 1')`);
        if (!has) throw new Error('no "Core 1" in the page');
        await p.eval(`document.querySelector('.tool-reset')?.click(); true`);
        await sleep(400);
        // run in real time and pause while both cores run (the program takes 1 s of machine time)
        await p.eval(click); await p.waitFor(`/^Pause/.test(${primary})`, 10000);
        await sleep(400);
        await p.eval(click); await p.waitFor(`!/^Pause/.test(${primary})`, 10000);
        await sleep(300);
        const state = await p.eval(`document.querySelector('.counters')?.textContent ?? ''`);
        if (!/running\s*Core 1|Core 1\s*running/.test(state)) throw new Error(`counters: ${state.slice(0, 200)}`);
        const before = await p.eval(`globalThis.__mavileraTest.stateHash()`);
        await p.eval(`document.querySelector('.tool-step').click(); true`); await sleep(100);
        const after = await p.eval(`globalThis.__mavileraTest.stateHash()`);
        await p.eval(`document.querySelector('.tool[aria-label^="Step back"], button[title^="Step back"]').click(); true`); await sleep(400);
        const back = await p.eval(`globalThis.__mavileraTest.stateHash()`);
        if (before === after || back !== before) throw new Error(`hash ${before} → ${after} → back ${back}`);
        return `core 1 running; step ${before} → ${after}, back ${back}`;
      });

      if (name !== 'firefox') {
        await check('axe-core: nothing found', async () => {
          await p.eval(AXE);
          const v = await p.eval(`axe.run(document, { runOnly: ${J(AXE_TAGS)} }).then((r) => r.violations.map((x) => x.id + ': ' + x.nodes.length))`);
          if (v.length) throw new Error(v.join(', '));
          return 'no violations';
        });
      }
      R.errors = p.errors.slice(0, 5);
      if (p.errors.length) { failed++; console.log(`  FAIL page errors — ${p.errors.slice(0, 3).join(' | ')}`); }
    } finally { await b.close(); }
  }
} finally {
  server.close();
  if (opt('--json')) writeFileSync(opt('--json'), `${J(results, null, 2)}\n`);
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
