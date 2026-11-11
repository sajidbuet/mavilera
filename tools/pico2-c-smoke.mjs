// pico2-c-smoke.mjs -- browser checks of the C subset on the pico2 module (P1-C2, design docs/architecture/pico2-p1c2-c-subset.md
// §5), in Pico Lite (P1-L1, research D34: the one-file editor; choosing C in its language menu shows the example and compiles
// it); it compiles, with the generated assembly beside the C and the
// start-up code in it; a run prints the example's UART text in the console and ends with exit code 0; the C view of the page
// passes axe-core in the light and dark schemes (the drawings excluded, as in tools/module-smoke.mjs).
//
//   node tools/pico2-c-smoke.mjs [--browser chrome|edge] [--shots dir]
//
// Exit status 1 if a check fails. Development only (axe-core is a dev dependency, THIRD_PARTY.md).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const messages = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
try {
  for (const name of BROWSERS) {
    const b = await launch(name);
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    console.log(`${name} (${b.version}), pico2 C subset`);
    const check = async (label, fn) => {
      try { const r = await fn(); console.log(`  ok   ${label}${r ? ` — ${r}` : ''}`); } catch (e) { failed++; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    try {
      for (const scheme of ['light', 'dark']) {
        const p = await b.newPage({ width: 1366, height: 768, colorScheme: scheme });
        // MAVILERA C is Pico Lite's C (P1-L1, research D34): the one-file editor with its language menu
        await p.goto(`${origin}?arch=pico2&edition=lite`);
        // a fresh start: no stored program and no projects
        await p.eval(`localStorage.clear(); new Promise((r) => { const d = indexedDB.deleteDatabase('mavilera-projects'); d.onsuccess = d.onerror = d.onblocked = () => r(true); })`);
        await p.goto(`${origin}?arch=pico2&edition=lite`);
        await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr') && document.querySelector('.ed-area, textarea.ed-input')`);
        p.errors.length = 0;
        await check(`${scheme}: C is offered and shows the example; it compiles with the start-up code in the assembly`, async () => {
          const sel = `[...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'c'))`;
          await p.eval(`(() => { const s = ${sel}; s.value = 'c'; s.dispatchEvent(new Event('change')); return true; })()`);
          await p.waitFor(`document.querySelector('textarea.ed-input')?.value.includes('#include <rp2350.h>')`);
          await p.waitFor(`${messages}.includes('Compiled')`, 30000);
          // the assembly is drawn in its tab when the tab is opened
          await p.eval(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim() === 'Generated assembly'); t?.click(); return Boolean(t); })()`);
          await p.waitFor(`document.body.textContent.includes('_start:')`, 10000);
          const asm = await p.eval(`document.body.textContent`);
          if (!/_start:/.test(asm) || !/CLK_REF_CTRL\.SRC = 2/.test(asm)) throw new Error('the start-up code is not in the generated assembly');
          return (await p.eval(messages)).split('\n').find((x) => x.includes('Compiled')).trim();
        });
        await check(`${scheme}: a run prints the example's text on UART0 and ends with exit code 0`, async () => {
          await p.eval(`document.querySelector('.tool-run').click(); true`);
          await p.waitFor(`document.querySelector('pre.console-out')?.textContent.includes('Hello from C on the Pico 2!')`, 60000);
          await p.waitFor(`!document.querySelector('.tool-run')?.getAttribute('aria-pressed') || document.querySelector('.tool-run').getAttribute('aria-pressed') === 'false'`, 60000);
          const a0 = await p.eval(`(() => { const row = [...document.querySelectorAll('tr')].find((r) => /a0\\s*x10/.test(r.textContent)); return row ? [...row.cells].map((c) => c.textContent.trim()).join(' ') : ''; })()`);
          if (!/0x0{8}\b/.test(a0)) throw new Error(`a0 after the run: ${a0 || 'register row not found'}`);
          if (p.errors.length) throw new Error(p.errors.join('; '));
          return `console: ${JSON.stringify(await p.eval(`document.querySelector('pre.console-out').textContent.trim()`))}; ${a0}`;
        });
        await check(`${scheme}: axe-core passes on the page in C mode`, async () => {
          await p.eval(AXE);
          const v = await p.eval(`axe.run({ exclude: [['svg.pz-svg']] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'] })
            .then((r) => r.violations.map((x) => \`\${x.id} (\${x.impact}, \${x.nodes.length}: \${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')})\`))`);
          if (v.length) throw new Error(v.join('; '));
        });
        if (opt('--shots')) { mkdirSync(opt('--shots'), { recursive: true }); writeFileSync(join(opt('--shots'), `pico2-c-${name}-${scheme}.png`), await p.screenshot()); }
        await p.close();
      }
    } finally { await b.close(); }
  }
} finally { server.close(); }
process.exit(failed ? 1 : 0);
