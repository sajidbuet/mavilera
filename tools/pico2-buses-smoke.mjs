// pico2-buses-smoke.mjs -- ADC, I2C and the lab kit in a real browser (pico2 P1-M7, docs/architecture/pico2-p1m7-adc-spi-i2c.md §4).
// Checks: the template "Text on an I2C LCD" chooses Parts: lab kit, builds in Lite and runs in Real time to its end, and the Pins
// panel's LCD shows its two lines; the I2C tab lists the transfers to 0x27 and shows the LCD; "Read a knob with the ADC" with GP26 set
// to 1.65 V in the Pins panel before Run prints 2048 = 1650 mV and the ADC tab shows RESULT 2048; axe-core finds nothing with the
// Pins panel, then each of the ADC, SPI and I2C tabs (research D43: three tabs), open.
//
//   node tools/pico2-buses-smoke.mjs [--browser chrome|edge|firefox] [--visible] [--json out.json]
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
const tab = (label) => `([...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === ${J(label)})?.click(), true)`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
const results = { date: new Date().toISOString(), browsers: {} };
try {
  for (const name of BROWSERS) {
    const b = name === 'firefox' ? await launchFirefox({ headless: !VISIBLE }) : await launch(name, { headless: !VISIBLE });
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    const R = results.browsers[name] = { version: b.version, checks: {} };
    console.log(`${name} (${b.version}), ADC, SPI, I2C`);
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
    const runToEnd = async (p) => {
      await p.eval(click);
      await p.waitFor(`/^Pause/.test(${primary})`, 10000);
      await p.waitFor(`!/^Pause/.test(${primary})`, 30000);
      await sleep(500);
    };
    try {
      const p = await b.newPage({ width: 1366, height: 900 });
      const page = `${origin}?arch=pico2&edition=lite&selftest`;
      await p.goto(page);
      await p.eval(`localStorage.clear(); true`);
      await p.goto(page);
      await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);

      await check('"Text on an I2C LCD" sets Parts: lab kit and runs in Real time; the Pins panel\'s LCD shows its two lines', async () => {
        await template(p, 'Text on an I2C LCD', 'i2c-lcd.c');
        await p.eval(tab('Pins'));
        await p.waitFor(`document.querySelector('select[aria-label="Parts"]')?.value === 'kit'`, 10000);
        await runToEnd(p);
        await p.waitFor(`document.querySelector('.pp-lcd') && !document.querySelector('.pp-lcd').hidden && document.querySelector('.pp-lcd').textContent.includes('count: 9')`, 10000);
        return J(await p.eval(`document.querySelector('.pp-lcd').textContent`));
      });

      await check('the I2C tab lists the transfers to the LCD at 0x27 and shows the LCD', async () => {
        await p.eval(tab('I2C'));
        await p.waitFor(`document.querySelector('.dv-i2c .dv-log li')?.textContent.includes('0x27') && document.querySelector('.dv-i2c .dv-lcd')?.textContent.includes('count: 9')`, 10000);
        return await p.eval(`document.querySelector('.dv-i2c .dv-log li:last-child').textContent`);
      });

      await check('"Read a knob with the ADC": GP26 set to 1.65 V in the Pins panel before Run reads 2048 = 1650 mV', async () => {
        await template(p, 'Read a knob with the ADC', 'adc-knob.c');
        await p.eval(tab('Pins'));
        await p.waitFor(`document.querySelector('input.pp-num[aria-label="GP26 (ADC 0)"]') && !document.querySelector('input.pp-num[aria-label="GP26 (ADC 0)"]').disabled`, 10000);
        await p.eval(`(() => { const i = document.querySelector('input.pp-num[aria-label="GP26 (ADC 0)"]'); i.value = '1.65'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await runToEnd(p);
        const out = await p.eval(`document.querySelector('pre.console-out')?.textContent ?? ''`);
        if (!out.includes('result 2048 = 1650 mV')) throw new Error(J(out.slice(-200)));
        await p.eval(tab('ADC'));
        await p.waitFor(`document.querySelector('.dv-adc')?.textContent.includes('RESULT 2048')`, 10000);
        return out.trim().split('\n').slice(-1)[0];
      });

      if (name !== 'firefox') {
        await check('axe-core: nothing found (Pins panel with the parts, then the ADC, SPI and I2C tabs)', async () => {
          await p.eval(AXE);
          const v = [];
          for (const t of ['Pins', 'ADC', 'SPI', 'I2C']) {
            await p.eval(tab(t)); await sleep(300);
            v.push(...(await p.eval(`axe.run(document, { runOnly: ${J(AXE_TAGS)} }).then((r) => r.violations.map((x) => ${J(t)} + ' ' + x.id + ': ' + x.nodes.length))`)));
          }
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
