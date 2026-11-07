// tools/i8086/irq-smoke.mjs -- a browser check of the 8086 Interrupts panel (8086-B8): the page loads the template
// "NMI and INTR from the Interrupts panel", runs it to HLT, the panel says the processor is halted, NMI wakes it (the
// console shows N), INTR on with type 20H prints I until it is turned off; the panel's state follows; the page logs no
// error; axe-core finds no violation in the panel. Development only.
//
//   node tools/i8086/irq-smoke.mjs [--browser chrome|edge]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';
import { startServer } from '../serve.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const text = readFileSync(`${ROOT}content/i8086/templates/interrupt-inputs.asm`, 'utf8');
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

const { server, url } = await startServer({ port: 0 });
const b = await launch(arg('--browser', 'chrome'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
try {
  const page = await b.newPage({ width: 1366, height: 768 });
  await page.goto(`${url}?arch=i8086`);
  await page.waitFor('document.querySelector("textarea") !== null');
  await page.eval(`window.__errors = []; window.addEventListener('error', (e) => window.__errors.push(String(e.message)));`);
  // the program into the editor, then assemble and run
  await page.eval(`(() => { const a = document.querySelector('textarea'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await page.key('Enter', { code: 'Enter', keyCode: 13, modifiers: 2 });
  const out = () => page.eval(`[...document.querySelectorAll('.console, [class*=console]')].map((n) => n.textContent).join(' ')`);
  const run = async () => { await page.key('F5', { code: 'F5', keyCode: 116 }); await new Promise((r) => setTimeout(r, 1200)); };
  await run();
  // the Interrupts tab of the memory pane
  const opened = await page.eval(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find((n) => n.textContent.trim() === 'Interrupts'); if (t) t.click(); return Boolean(t); })()`);
  check('the Interrupts tab exists and opens', opened);
  await new Promise((r) => setTimeout(r, 300));
  const panel = (sel) => page.eval(`(() => { const p = document.querySelector('.i8-irq'); const n = p && p.querySelector(${JSON.stringify(sel)}); return n ? n.textContent : null; })()`);
  const nextText = async () => page.eval(`(() => { const p = document.querySelector('.i8-irq'); return p ? [...p.querySelectorAll('p.sp-value')].map((n) => n.hidden ? '' : n.textContent).join('') : null; })()`);
  check('after the run the panel says the processor is halted and waits', /Halted \(HLT\)/.test(await nextText() ?? ''), await nextText());
  const press = (label) => page.eval(`(() => { const p = document.querySelector('.i8-irq'); const btn = [...p.querySelectorAll('button')].find((n) => n.textContent.trim().startsWith(${JSON.stringify(label)})); if (!btn || btn.disabled) return false; btn.click(); return true; })()`);
  check('NMI can be pressed', await press('NMI'));
  check('the panel shows the NMI latched and due', /latched/.test(await panel('.sp-bit-v') ?? '') && /NMI entry/.test(await nextText() ?? ''), `${await panel('.sp-bit-v')} / ${await nextText()}`);
  await run();
  const o1 = await out();
  check('NMI wakes the processor: the console shows N after >', />N/.test(o1), o1.slice(-60));
  // INTR on with the default type 08H would have no handler; type 20H
  await page.eval(`(() => { const f = document.querySelector('.i8-irq input[aria-label^="The type"]'); f.value = '20'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('INTR can be switched on', await press('INTR'));
  for (let i = 0; i < 30; i++) await page.key('F10', { code: 'F10', keyCode: 121 });
  check('the switch shows on', (await page.eval(`document.querySelector('.i8-irq [role=switch]').getAttribute('aria-checked')`)) === 'true');
  check('INTR off again', await press('INTR'));
  await run();
  const o2 = await out();
  check('INTR printed I while it was on', />NI+/.test(o2), o2.slice(-60));
  // axe-core on the panel
  await page.eval(AXE);
  const v = await page.eval(`axe.run(document.querySelector('.i8-irq'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }).then((r) => r.violations.map((x) => x.id + ' (' + x.nodes.length + ')'))`);
  check('axe-core: no violations in the panel', !v.length, v.join(', '));
  const errors = await page.eval('window.__errors');
  check('no page errors', !errors.length, errors.join('; '));
} finally {
  await b.close(); server.close();
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
