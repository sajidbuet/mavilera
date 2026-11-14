// pico2-pio-smoke.mjs -- PIO in a real browser (pico2 P1-M8, docs/architecture/pico2-p1m8-pio.md §4). Checks: "PIO blinks the LED"
// (assembly and its .pio file, research D43) opens as two editor tabs, builds in Lite and runs in Real time to its end: GP25 changed
// while the core only waited, and the PIO tab lists the program and state machine 0; "A square wave from PIO with side-set" runs in Real time at the default
// 4 MHz keeping up with real time (after its first 0.2 s, at most two status lines below 90 %); "PIO counts the 1 bits of a word" (MAVILERA C)
// prints its four counts; File ▸ Remove PIO file makes its build fail with the hint, Add PIO file brings the file back and it builds;
// an error in the .pio file is marked in that file's tab; axe-core finds nothing with the two editor tabs and the PIO tab open; a
// share link carries the pair (a new page shows both tabs); Open in Full makes the pair a two-file project that assembles.
//
//   node tools/pico2-pio-smoke.mjs [--browser chrome|edge|firefox] [--visible] [--json out.json]
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
const edTab = (name) => `([...document.querySelectorAll('.p-editor [role=tab]')].find((t) => t.textContent.trim() === ${J(name)})?.click(), true)`;
const menuItem = (text) => `([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${J(text)})?.click(), true)`;
const tab = (label) => `([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === ${J(label)})?.click(), true)`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
const results = { date: new Date().toISOString(), browsers: {} };
try {
  for (const name of BROWSERS) {
    const b = name === 'firefox' ? await launchFirefox({ headless: !VISIBLE }) : await launch(name, { headless: !VISIBLE });
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    const R = results.browsers[name] = { version: b.version, checks: {} };
    console.log(`${name} (${b.version}), PIO`);
    const check = async (label, fn) => {
      try { const r = await fn(); R.checks[label] = { ok: true, detail: r ?? null }; console.log(`  ok   ${label}${r ? ` — ${typeof r === 'string' ? r : J(r)}` : ''}`); }
      catch (e) { failed++; R.checks[label] = { ok: false, detail: e.message }; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    const template = async (p, title, file) => {
      await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
      await p.waitFor(`[...document.querySelectorAll('.templates-menu button')].some((b) => b.textContent === ${J(title)})`, 10000);
      await p.eval(`[...document.querySelectorAll('.templates-menu button')].find((b) => b.textContent === ${J(title)}).click(); true`);
      await p.waitFor(`${area}.value.includes(${J(file)})`, 10000);
      await sleep(800);
      await p.waitFor(`/^(Build|Compile|Run)/.test(${primary})`, 10000);
      if (!/^Run/.test(await p.eval(primary))) await p.eval(click);
      await p.waitFor(`/^Run/.test(${primary})`, 20000);
    };
    try {
      const p = await b.newPage({ width: 1366, height: 900 });
      const page = `${origin}?arch=pico2&edition=lite&selftest`;
      await p.goto(page);
      await p.eval(`localStorage.clear(); true`);
      await p.goto(page);
      await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);

      await check('"PIO blinks the LED" opens as two editor tabs, the program and its .pio file (D43)', async () => {
        await template(p, 'PIO blinks the LED', 'pio-blink.s');
        const tabs = await p.eval(`[...document.querySelectorAll('.p-editor [role=tab]')].map((t) => t.textContent.trim())`);
        if (J(tabs) !== J(['pio-blink.s', 'pio-blink.pio'])) throw new Error(`tabs ${J(tabs)}`);
        await p.eval(edTab('pio-blink.pio'));
        const shown = await p.eval(`document.querySelector('.p-editor .ed-panel:not([hidden]) textarea.ed-input').value`);
        if (!shown.includes('.program blink')) throw new Error('the .pio text is not shown');
        await p.eval(edTab('pio-blink.s'));
        return J(tabs);
      });

      await check('"PIO blinks the LED" runs in Real time to its end; GP25 changed; the PIO tab shows the program and SM0', async () => {
        await p.eval(tab('Pins'));
        await p.eval(`globalThis.__pioSeen = new Set(); globalThis.__pioObs = setInterval(() => { const c = document.querySelector('.pp-pin[aria-label^="GP25"]'); if (c) globalThis.__pioSeen.add(c.querySelector('.pp-value')?.textContent ?? ''); }, 20); true`);
        await p.eval(click);
        await p.waitFor(`/^Pause/.test(${primary})`, 10000);
        await p.waitFor(`!/^Pause/.test(${primary})`, 30000);
        await sleep(500);
        const seen = await p.eval(`(clearInterval(globalThis.__pioObs), [...globalThis.__pioSeen])`);
        if (!seen.some((v) => v.startsWith('1')) || !seen.some((v) => v.startsWith('0'))) throw new Error(`GP25 seen as ${J(seen)}`);
        await p.eval(tab('PIO'));
        await p.waitFor(`document.querySelector('.dv-pio')?.textContent.includes('jmp    x--')`, 10000);
        const t = await p.eval(`document.querySelector('.dv-pio').textContent`);
        if (!/SM0/.test(t)) throw new Error('no SM0 in the PIO tab');
        return `GP25 seen ${J(seen)}`;
      });

      await check('"A square wave from PIO with side-set" keeps up with real time at 4 MHz', async () => {
        await template(p, 'A square wave from PIO with side-set', 'pio-square.s');
        await p.eval(`globalThis.__rt = []; globalThis.__rtObs = setInterval(() => globalThis.__rt.push(document.querySelector('.run-status')?.textContent ?? ''), 50); true`);
        await p.eval(click);
        await p.waitFor(`/^Pause/.test(${primary})`, 10000);
        await p.waitFor(`!/^Pause/.test(${primary})`, 30000);
        const rt = await p.eval(`(clearInterval(globalThis.__rtObs), globalThis.__rt)`);
        // each status line once, after the first 0.2 s of machine time: before that the fraction covers a few milliseconds that
        // include the start (JIT warm-up), and a line sampled twice counted twice (failures seen at 0.000-0.029 s, 2026-11-14)
        const steady = [...new Set(rt)].filter((s) => { const m = /Real time · ([0-9.]+) s/.exec(s); return m && Number(m[1]) >= 0.2; });
        const slow = steady.filter((s) => /% of real time/.test(s));
        const late = slow.filter((s) => { const m = /(\d+) % of real time/.exec(s); return m && Number(m[1]) < 90; });
        if (late.length > 2) throw new Error(`below 90 % of real time: ${late.slice(0, 3).join(' | ')}`);
        return `${rt.length} status samples, ${slow.length} below 95 %`;
      });

      await check('"PIO counts the 1 bits of a word" (MAVILERA C) prints its four counts', async () => {
        await template(p, 'PIO counts the 1 bits of a word', 'pio-popcount.c');
        await p.eval(click);
        await p.waitFor(`/^Pause/.test(${primary}) || /^Run again/.test(${primary})`, 10000);
        await p.waitFor(`!/^Pause/.test(${primary})`, 30000);
        await sleep(500);
        const out = await p.eval(`document.querySelector('pre.console-out')?.textContent ?? ''`);
        if (!out.includes('0xdeadbeef has 24 ones')) throw new Error(J(out.slice(-200)));
        return out.trim().split('\n').slice(-1)[0];
      });

      await check('File ▸ Remove PIO file: the C program does not build, with the hint; Add PIO file brings the file back and it builds (D43)', async () => {
        await p.eval(menuItem('Remove PIO file'));
        await p.waitFor(`document.querySelectorAll('.p-editor [role=tab]').length === 0`, 5000);
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'build'`, 5000); // the text changed: Run builds first
        await p.eval(click);
        await p.waitFor(`[...document.querySelectorAll('.p-console li')].some((m) => /Add PIO file/.test(m.textContent))`, 10000);
        await p.eval(menuItem('Add PIO file'));
        await p.waitFor(`document.querySelectorAll('.p-editor [role=tab]').length === 2`, 5000);
        const text = await p.eval(`document.querySelector('.p-editor .ed-panel:not([hidden]) textarea.ed-input').value`);
        if (!text.includes('.program popcount')) throw new Error('not the removed text');
        await p.eval(edTab('pio-popcount.c'));
        await p.eval(click);
        await p.waitFor(`/^Run/.test(${primary})`, 20000);
        return 'removed, refused with the hint, added back, built';
      });

      await check('an error in the .pio file is marked in its own tab (D43)', async () => {
        await p.eval(edTab('pio-popcount.pio'));
        await p.eval(`(() => { const a = document.querySelector('.p-editor .ed-panel:not([hidden]) textarea.ed-input'); a.value = a.value.replace('push block', 'push sideways'); a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await p.eval(edTab('pio-popcount.c'));
        await p.eval(click);
        await p.waitFor(`document.querySelector('#ed-cpanel-1:not([hidden])')`, 10000); // the .pio tab comes to the front
        await p.waitFor(`document.querySelector('#ed-cpanel-1 .ed-marks')?.textContent.trim().length > 0 || document.querySelector('#ed-cpanel-1 .ed-err, #ed-cpanel-1 [class*=err]')`, 10000);
        await p.eval(`(() => { const a = document.querySelector('#ed-cpanel-1 textarea.ed-input'); a.value = a.value.replace('push sideways', 'push block'); a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await p.eval(click);
        await p.waitFor(`/^Run/.test(${primary})`, 20000);
        return 'marked, fixed, built';
      });

      if (name !== 'firefox') {
        await check('axe-core: nothing found with the two editor tabs and the PIO tab open', async () => {
          await p.eval(tab('PIO')); await sleep(300);
          await p.eval(AXE);
          const v = await p.eval(`axe.run(document, { runOnly: ${J(AXE_TAGS)} }).then((r) => r.violations.map((x) => x.id + ': ' + x.nodes.length))`);
          if (v.length) throw new Error(v.join(', '));
          return 'no violations';
        });
      }
      await check('a share link carries the program and its .pio file: a new page shows both tabs (D43)', async () => {
        await template(p, 'PIO blinks the LED', 'pio-blink.s');
        await p.eval(`navigator.clipboard.writeText = (t) => { window.__link = t; return Promise.resolve(); }; true`);
        await p.eval(menuItem('Copy share link'));
        await p.waitFor(`typeof window.__link === 'string'`, 5000);
        const link = await p.eval('window.__link');
        const q = await b.newPage({ width: 1366, height: 900 });
        try {
          await q.goto(link);
          await q.waitFor(`[...document.querySelectorAll('.p-editor [role=tab]')].map((t) => t.textContent.trim()).join() === 'pio-blink.s,pio-blink.pio'`, 20000);
          await q.eval(edTab('pio-blink.pio'));
          if (!(await q.eval(`document.querySelector('#ed-cpanel-1 textarea.ed-input').value.includes('.program blink')`))) throw new Error('no .pio text');
        } finally { await q.close(); }
        return `${link.length} characters`;
      });

      await check('Open in Full: the pair becomes a two-file project, which assembles (D43)', async () => {
        await p.eval(menuItem('Open in Full'));
        await p.waitFor(`document.querySelector('.edition-switch [aria-pressed=true]')?.textContent === 'Full' && document.querySelector('.proj-explorer .proj-file')`, 20000);
        const files = await p.eval(`[...document.querySelectorAll('.proj-file')].map((x) => x.dataset.name).sort().join()`);
        if (files !== 'pio-blink.pio,pio-blink.s') throw new Error(`files ${files}`);
        await p.waitFor(`[...document.querySelectorAll('.p-console li')].some((l) => /^✔ Assembled/.test(l.textContent.trim()))`, 20000);
        await p.eval(`localStorage.clear(); true`); // the next browser starts in Lite again
        return files;
      });

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
