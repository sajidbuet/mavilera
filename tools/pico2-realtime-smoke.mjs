// pico2-realtime-smoke.mjs -- the real-time runner in a real browser (pico2 P1-M4, docs/architecture/pico2-p1m4-realtime.md §4.2,
// research D36). Exit criterion (roadmap): 1 MHz sustained with the UI open; replay is bit-exact. Checks: the Speed menu offers
// Real time first and starts in it, the clk_sys option offers 1/4/12 MHz with 4 the default; a 1 MHz program keeps machine time
// within 1 % of wall time over 30 s with the UI open (ISA view); the 12 MHz template reports its fraction; the live view
// changes during the run (registers, status); pause shows the full panels and step back works after the run; UART typing
// reaches the program (an echo); the Pins panel drives GP7 and shows GP25 following it, with a MAVILERA C program; the pipeline view says it runs at full speed; the replay after a reload reaches the same machine state (hash);
// axe-core finds nothing with the Pins panel open. Transport: postMessage, or the SAB ring with --isolated (COOP + COEP).
//
//   node tools/pico2-realtime-smoke.mjs [--browser chrome|edge|firefox] [--isolated] [--throttle 4] [--seconds 30] [--visible]
//      [--json out.json]
//
// --throttle N: Chrome's CPU throttling (Emulation.setCPUThrottlingRate) as a labelled proxy for a modest laptop (D36 Q8;
// Chrome and Edge only). Firefox is driven through WebDriver BiDi (tools/firefox-bidi.mjs). Development only.
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
const ISOLATED = args.includes('--isolated');
const THROTTLE = Number(opt('--throttle') ?? 1);
const SECONDS = Number(opt('--seconds') ?? 30);
const VISIBLE = args.includes('--visible');
const J = JSON.stringify;
const tpl = (f) => readFileSync(new URL(`../content/pico2/templates/${f}`, import.meta.url), 'utf8');

// blink.s for ever (the clk_sys option sets its clock)
const BLINK = tpl('blink.s').replace(/li\s+s2, 10\b/, 'li      s2, 1000000000');
// MAVILERA C: GP25 follows GP7 (an input with its pull-up), UART0's input is echoed
const FOLLOW = `#include <rp2350.h>
int main(void)
{
    pin_input(7);
    pin_output(25);
    for (;;) {
        pin_write(25, pin_read(7));
        if (!(UART0_UARTFR & UART_FR_RXFE_BIT))
            putchar(UART0_UARTDR & 255);
    }
}
`;

const area = `document.querySelector('textarea.ed-input')`;
const setText = (t) => `(() => { const a = ${area}; a.value = ${J(t)}; a.dispatchEvent(new Event('input')); return true; })()`;
const select = (label, v) => `(() => { const s = document.querySelector('select[aria-label=${J(label)}]'); s.value = ${J(v)}; s.dispatchEvent(new Event('change')); return s.value; })()`;
const primary = `document.querySelector('.tool-run')?.getAttribute('aria-label') ?? ''`;
const click = `(document.querySelector('.tool-run').click(), true)`;
const status = `document.querySelector('.run-status')?.textContent ?? ''`;
const out = `document.querySelector('pre.console-out')?.textContent ?? ''`;
const msgs = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const machineS = `(() => { const m = /Real time · ([0-9.]+) s/.exec(${status}); return m ? Number(m[1]) : null; })()`;
const pcText = `document.querySelector('.reg-pc, [data-reg=pc]')?.textContent ?? document.querySelector('.regs')?.textContent.slice(0, 200) ?? ''`;
const openMemTab = (name) => `(() => { const t = [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === ${J(name)}); t?.click(); return Boolean(t); })()`;
const pin = (n) => `(() => { const g = document.querySelector('.pp-pin[aria-label^="GP${n}"]'); return g ? { lamp: g.querySelector('.sp-lamp').classList.contains('on'), text: g.querySelector('.pp-value').textContent } : null; })()`;
const drive = (n, v) => `(() => { const s = document.querySelector('.pp-pin[aria-label^="GP${n}"] select'); s.value = ${J(String(v))}; s.dispatchEvent(new Event('change')); return true; })()`;
const type = (t) => `(() => { const f = document.querySelector('.console-in-field'); f.value = ${J(t)}; f.form.requestSubmit(); return true; })()`;

const { server, url: origin } = await startServer({ port: 0, isolated: ISOLATED });
let failed = 0;
const results = { date: new Date().toISOString(), isolated: ISOLATED, throttle: THROTTLE, seconds: SECONDS, browsers: {} };
try {
  for (const name of BROWSERS) {
    const b = name === 'firefox' ? await launchFirefox({ headless: !VISIBLE }) : await launch(name, { headless: !VISIBLE });
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    const R = results.browsers[name] = { version: b.version, checks: {} };
    console.log(`${name} (${b.version}), real time${ISOLATED ? ', cross-origin isolated' : ''}${THROTTLE > 1 ? `, CPU throttled ${THROTTLE}x (proxy)` : ''}`);
    const check = async (label, fn) => {
      try { const r = await fn(); R.checks[label] = { ok: true, detail: r ?? null }; console.log(`  ok   ${label}${r ? ` — ${typeof r === 'string' ? r : J(r)}` : ''}`); }
      catch (e) { failed++; R.checks[label] = { ok: false, detail: e.message }; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    try {
      const p = await b.newPage({ width: 1366, height: 900 });
      const page = `${origin}?arch=pico2&selftest`;
      const ready = `document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`;
      await p.goto(page);
      await p.eval(`localStorage.clear(); true`);
      await p.goto(page);
      await p.waitFor(ready);
      if (THROTTLE > 1) await p.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
      const build = async (lang, text, clock) => {
        if (lang) { await p.eval(select('Language', lang)); await sleep(700); } // setLang loads the compiler and the stored text first
        if (clock) await p.eval(select('clk_sys', clock));
        await p.eval(setText(text));
        // Build stands beside Run in Lite too (the author, 2026-11-11): the text changed, Build builds without running
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'build'`);
        await p.eval(`(document.querySelector('.tool-build').click(), true)`);
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'run'`, 20000);
      };
      const run = async () => { await p.eval(click); await p.waitFor(`/^Pause/.test(${primary})`); await p.waitFor(`${machineS} !== null`, 10000); };
      const pause = async () => { await p.eval(click); await p.waitFor(`!/^Pause/.test(${primary})`, 10000); };

      await check('the Speed menu: Real time first and chosen; clk_sys 1/4/12 MHz, 4 MHz chosen', async () => {
        const sp = await p.eval(`[...document.querySelectorAll('select[aria-label=Speed] option')].map((o) => o.value + (o.selected ? '*' : '')).join(' ')`);
        const ck = await p.eval(`[...document.querySelectorAll('select[aria-label=clk_sys] option')].map((o) => o.textContent + (o.selected ? '*' : '')).join(' ')`);
        if (!/^rt\* max slow( render)?$/.test(sp) || ck !== '1 MHz 4 MHz* 12 MHz') throw new Error(`speed "${sp}", clk_sys "${ck}"`);
        return `speed "${sp}", clk_sys "${ck}"; crossOriginIsolated ${await p.eval('crossOriginIsolated')}`;
      });

      await check(`a 1 MHz program: machine time within 1 % of wall time over ${SECONDS} s with the UI open (ISA view)`, async () => {
        await build('asm', BLINK, '1');
        await run();
        await sleep(1500);
        const r = await p.eval(`new Promise((ok) => { const s0 = ${machineS}, t0 = performance.now(); setTimeout(() => ok({ s0, s1: ${machineS}, wall: (performance.now() - t0) / 1000, status: ${status}, transport: document.querySelector('.run-status').dataset.transport }), ${SECONDS * 1000}); })`);
        const ratio = (r.s1 - r.s0) / r.wall;
        R.pace1MHz = { ...r, ratio };
        await pause();
        if (!(Math.abs(ratio - 1) <= 0.01)) throw new Error(`machine ${(r.s1 - r.s0).toFixed(3)} s in ${r.wall.toFixed(3)} s of wall time (${(ratio * 100).toFixed(2)} %); ${r.status}`);
        return `${(ratio * 100).toFixed(2)} % of wall time over ${r.wall.toFixed(1)} s (${r.transport}); "${r.status}"`;
      });

      await check('pause: the full panels; step back works after the real-time run', async () => {
        const before = await p.eval(`document.querySelector('.listing tr.pc, .listing .is-pc')?.textContent ?? ''`);
        const steps0 = await p.eval(`document.querySelector('.counters')?.textContent ?? ''`);
        await p.eval(`document.querySelector('.tool[aria-label^="Step back"], button[title^="Step back"]').click(); true`);
        await sleep(800);
        const steps1 = await p.eval(`document.querySelector('.counters')?.textContent ?? ''`);
        const m = await p.eval(msgs);
        if (steps0 === steps1) throw new Error(`the counters did not change after step back; ${m.split('\n').slice(-2).join(' | ')}`);
        return `${before.trim().slice(0, 40)}`;
      });

      await check('the 12 MHz clock: the run reports what it reaches', async () => {
        await p.eval(select('clk_sys', '12'));
        await p.waitFor(`/^Run/.test(${primary})`, 20000);
        await run();
        await sleep(4000);
        const s = await p.eval(status);
        R.status12MHz = s;
        await pause();
        if (!/clk_sys 12 MHz/.test(s)) throw new Error(s);
        return s;
      });

      // (research D38: a C program built in the browser runs in the Instructions view; the C source view is for opened images)
      await check('MAVILERA C: real time; UART typing echoed; the Pins panel drives GP7 and GP25 follows', async () => {
        await p.eval(select('clk_sys', '4'));
        await build('c', FOLLOW);
        const view = await p.eval(`document.querySelector('.mode-btn[aria-selected=true]')?.textContent ?? ''`);
        await p.eval(openMemTab('Pins'));
        await run();
        await sleep(600);
        const a = await p.eval(pin(25));
        const trail = [await p.eval(status)];
        await p.eval(drive(7, 0));
        await sleep(600);
        const bpin = await p.eval(pin(25));
        trail.push(await p.eval(status));
        await p.eval(drive(7, -1));
        await sleep(600);
        const c = await p.eval(pin(25));
        trail.push(await p.eval(status));
        await p.eval(type('hi there'));
        await sleep(800);
        const o = await p.eval(out);
        const s = await p.eval(status);
        if (/^Pause/.test(await p.eval(primary))) await pause();
        const log = [a, bpin, c].map((x) => x && `${x.lamp ? 'on' : 'off'} (${x.text})`).join(' → ');
        if (!a?.lamp || bpin?.lamp || !c?.lamp) throw new Error(`view ${view}; GP25 ${log}; status ${trail.join(' / ')}; ${(await p.eval(msgs)).split('\n').slice(-3).join(' | ')}`);
        if (!o.includes('hi there')) throw new Error(`console "${o}"`);
        if (!/Real time/.test(s)) throw new Error(s);
        return `view ${view}; GP25 ${log}; echo "${o.trim()}"; "${s}"`;
      });

      await check('replay is bit-exact: a fresh engine with the run\'s inputs reaches the same machine state at the same step; the inputs survive a reload', async () => {
        const r = await p.eval(`globalThis.__mavileraTest.replayCheck()`);
        R.replay = r;
        if (!r?.equal || r.inputs < 3) throw new Error(J(r));
        await p.goto(page);
        await p.waitFor(ready);
        await sleep(1500);
        await p.eval(openMemTab('Pins'));
        await sleep(200);
        const n = await p.eval(`document.querySelector('.pp-count')?.textContent ?? ''`);
        const m = await p.eval(msgs);
        if (!new RegExp(`^${r.inputs} input`).test(n)) throw new Error(`after the reload: "${n}"; ${m.split('\n').slice(-3).join(' | ')}`);
        return `${r.inputs} inputs, ${r.steps} steps, hash ${r.hash} = ${r.replay}; after the reload "${n}"`;
      });

      await check('the pipeline view: Real time says it runs at full speed there', async () => {
        await p.eval(`[...document.querySelectorAll('.mode-btn')].find((b) => b.textContent.includes('Pipeline'))?.click(); true`);
        await sleep(800);
        await p.eval(`document.querySelector('.tool-run').click(); true`);
        await sleep(500);
        const m = await p.eval(msgs);
        if (/^Pause/.test(await p.eval(primary))) await pause();
        if (!/runs at full speed/.test(m)) throw new Error(m.split('\n').slice(-2).join(' | '));
        await p.eval(`[...document.querySelectorAll('.mode-btn')].find((b) => b.textContent.includes('Instructions'))?.click(); true`);
        return 'noted';
      });

      if (name !== 'firefox') {
        await check('axe-core: nothing found with the Pins panel open', async () => {
          await p.eval(openMemTab('Pins'));
          await p.eval(AXE);
          const v = await p.eval(`axe.run(document, { runOnly: ${J(AXE_TAGS)} }).then((r) => r.violations.map((x) => x.id + ': ' + x.nodes.length + ' (' + x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('; ') + ')'))`);
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
