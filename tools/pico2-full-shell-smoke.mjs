// pico2-full-shell-smoke.mjs -- Pico SDK C in the pico2 page (pico2 P1-F2, research D33), in Pico Full (P1-L1, D34): a project
// of three files (main.c, led.c, led.h) builds with the Pico SDK compiler, Full's only C; that alone downloads nothing; Build shows
// the notice with the size; Download shows a progress bar per file and builds; the program runs and prints on UART0;
// run to cursor stops at a C line with the marker in main.c; steps follow into led.c; an error is located in led.c;
// after a reload the cached compiler builds without asking; axe-core finds nothing with the notice open.
//
//   node tools/pico2-full-shell-smoke.mjs [--browser chrome|edge]    (env: PICO_FULL_SITE, tools/pico-full/stage.mjs)
//
// Development only; skipped, with the reason, without PICO_FULL_SITE. axe-core is a dev dependency (THIRD_PARTY.md).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { existsSync, readFileSync } from 'node:fs';
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
const SITE = process.env.PICO_FULL_SITE;
if (!SITE || !existsSync(join(SITE, 'current.json'))) { console.log('skipped: needs PICO_FULL_SITE (tools/pico-full/stage.mjs)'); process.exit(0); }

const MAIN = '#include "pico/stdlib.h"\n#include <stdio.h>\n#include "led.h"\n\nint main(void) {\n    stdio_init_all();\n    led_init();\n    printf("Hello from the Pico SDK\\n");\n    while (true) {\n        led_toggle();\n        sleep_ms(100);\n    }\n}\n';
const LED_H = 'void led_init(void);\nvoid led_toggle(void);\n';
const LED_C = '#include "pico/stdlib.h"\n#include "led.h"\n\n#define LED 25\n\nvoid led_init(void) {\n    gpio_init(LED);\n    gpio_set_dir(LED, GPIO_OUT);\n}\n\nvoid led_toggle(void) {\n    gpio_xor_mask(1u << LED);\n}\n';
const TOGGLE_LINE = 10; // main.c: led_toggle();

const J = JSON.stringify;
const messages = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const activeTab = `document.querySelector('.ed-tabs [role=tab][aria-selected=true]')?.dataset.name`;
const activeArea = `document.querySelector('.ed-panel:not([hidden]) textarea.ed-input')`;
const curLine = `(() => { const p = document.querySelector('.ed-panel:not([hidden])'); const c = p?.querySelector('.ed-cur'); return c ? [...c.parentNode.children].indexOf(c) + 1 : null; })()`;
const act = (a) => `document.querySelector('.proj-acts [data-act="${a}"]').click()`;
const formSubmit = (v) => `(() => { const i = document.querySelector('.proj-form input'); i.value = ${J(v)}; document.querySelector('.proj-form button[type=submit]').click(); return true; })()`;
const openFile = (n) => `document.querySelector('.proj-file[data-name=${J(n)}]').click()`;
const setText = (t) => `(() => { const a = ${activeArea}; a.value = ${J(t)}; a.dispatchEvent(new Event('input')); return true; })()`;
const fresh = `localStorage.clear(); Promise.all([caches.delete('mavilera-pico-full-v1'), new Promise((r) => { const d = indexedDB.deleteDatabase('mavilera-projects'); d.onsuccess = d.onerror = d.onblocked = () => r(true); })]).then(() => true)`;

let failed = 0;
for (const name of BROWSERS) {
  const { server, url } = await startServer({ port: 0, picoFull: SITE });
  const b = await launch(name);
  if (!b) { console.log(`${name}: not installed, skipped`); server.close(); continue; }
  console.log(`${name} (${b.version}), Pico SDK C in the pico2 page`);
  const check = async (label, fn) => {
    try { const r = await fn(); console.log(`  ok   ${label}${r ? ` — ${r}` : ''}`); } catch (e) { failed++; console.log(`  FAIL ${label} — ${e.message}`); }
  };
  try {
    const p = await b.newPage({ width: 1366, height: 768 });
    const page = `${url}?arch=pico2&edition=full`; // Pico Full (P1-L1, research D34)
    await p.goto(page);
    await p.eval(fresh);
    await p.goto(page);
    await p.waitFor(`document.querySelector('.proj-explorer .proj-file')`);

    await check('Pico Full: a project of main.c, led.c and led.h builds with Pico SDK C (no compiler choice, P1-L1 D34 Q6); a new .c starts with the SDK example; making it the entry downloads nothing', async () => {
      for (const [f, t] of [['main.c', MAIN], ['led.c', LED_C], ['led.h', LED_H]]) {
        await p.eval(act('new')); await p.eval(formSubmit(f));
        await p.waitFor(`${activeTab} === ${J(f)}`);
        if (f === 'main.c' && !(await p.eval(`${activeArea}.value.includes('pico/stdlib.h')`))) throw new Error('the first .c file does not start with the SDK example');
        await p.eval(setText(t));
      }
      await p.eval(openFile('main.c')); await p.eval(act('entry'));
      await p.eval(openFile('main.s')); await p.eval(act('delete'));
      await p.eval(`document.querySelector('.proj-form .proj-danger').click(); true`);
      await p.waitFor(`[...document.querySelectorAll('.proj-file')].map((x) => x.dataset.name).join() === 'main.c,led.c,led.h'`);
      await p.waitFor(`${messages}.includes('Pico SDK C')`);
      const choice = await p.eval(`document.querySelectorAll('[data-compiler]').length`);
      const dialog = await p.eval(`Boolean(document.querySelector('.dl-dialog[open]'))`);
      if (choice || dialog) throw new Error(`compiler choices ${choice}, dialog open ${dialog}`);
      return (await p.eval(messages)).split('\n').filter(Boolean).slice(-2).join(' | ');
    });

    await check('Build shows the notice with the download size; axe-core finds nothing with it open', async () => {
      await p.eval(`document.querySelector('.tool-build').click(); true`);
      await p.waitFor(`document.querySelector('.dl-dialog[open]')`);
      const text = await p.eval(`document.querySelector('.dl-dialog').textContent`);
      if (!/25 MB/.test(text)) throw new Error(text);
      const lic = await p.eval(`(() => { const a = document.querySelector('.dl-dialog a'); return a ? fetch(a.href).then((r) => r.ok && r.text()).then((t) => t && t.split('\\n')[0]) : null; })()`);
      if (!lic || !/Pico SDK compiler and files/.test(lic)) throw new Error(`licences link: ${lic}`);
      await p.eval(AXE);
      const v = await p.eval(`axe.run({ exclude: [['svg.pz-svg']] }, { runOnly: { type: 'tag', values: ${J(AXE_TAGS)} }, resultTypes: ['violations'] })
        .then((r) => r.violations.map((x) => \`\${x.id} (\${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')})\`))`);
      if (v.length) throw new Error(v.join('; '));
      return text.replace(/\s+/g, ' ').slice(0, 160);
    });

    await check('Download: a progress bar per file, then the project builds', async () => {
      const t0 = Date.now();
      await p.eval(`[...document.querySelectorAll('.dl-dialog button')].find((x) => x.textContent === 'Download').click(); true`);
      await p.waitFor(`document.querySelectorAll('.dl-dialog progress').length === 2`, 10000);
      await p.waitFor(`!document.querySelector('.dl-dialog[open]')`, 180000);
      await p.waitFor(`${messages}.includes('Built with Pico SDK C')`, 60000);
      const m = (await p.eval(messages)).split('\n').find((x) => x.includes('Built with'));
      return `${Date.now() - t0} ms; ${m.trim()}`;
    });

    await check('File ▸ Download the built program (.uf2): a UF2 for the RP2350\'s RISC-V cores; .elf the ELF', async () => {
      await p.eval(`window.__blobs = []; const o = URL.createObjectURL; URL.createObjectURL = (x) => { window.__blobs.push(x); return o.call(URL, x); }; true`);
      const click = (label) => `[...document.querySelectorAll('button')].find((b) => b.textContent === ${J(label)}).click()`;
      await p.eval(click('Download the built program (.uf2)'));
      await p.eval(click('Download the built program (.elf)'));
      await p.waitFor(`window.__blobs.length === 2`, 10000);
      const r = await p.eval(`Promise.all(window.__blobs.map((b) => b.arrayBuffer().then((a) => { const v = new DataView(a); return { n: a.byteLength, w0: v.getUint32(0, true), fam: a.byteLength > 512 ? v.getUint32(512 + 28, true) : 0 }; })))`);
      const uf2 = r.find((x) => x.w0 === 0x0a324655), elf = r.find((x) => x.w0 === 0x464c457f); // in the order they finish
      if (!uf2 || !elf || uf2.w0 !== 0x0a324655 || uf2.n % 512 || uf2.fam !== 0xe48bff5a || elf.w0 !== 0x464c457f) throw new Error(J(r));
      return `UF2 ${uf2.n} bytes (${uf2.n / 512} blocks, the E10 block first), ELF ${elf.n} bytes`;
    });

    await check('run to cursor at a C line: the marker is on that line of main.c; UART0 printed the greeting', async () => {
      await p.eval(openFile('main.c'));
      await p.eval(`(() => { const a = ${activeArea}; const off = a.value.split('\\n').slice(0, ${TOGGLE_LINE - 1}).join('\\n').length + 1; a.focus(); a.setSelectionRange(off, off); return true; })()`);
      await p.eval(`document.querySelector('[data-cmd="runToCursor"]').click(); true`);
      await p.waitFor(`${curLine} === ${TOGGLE_LINE} && ${activeTab} === 'main.c'`, 60000);
      await p.waitFor(`document.querySelector('pre.console-out')?.textContent.includes('Hello from the Pico SDK')`, 10000);
      return `main.c:${await p.eval(curLine)}; UART: ${J((await p.eval(`document.querySelector('pre.console-out').textContent`)).trim())}`;
    });

    await check('steps follow the running line into led.c', async () => {
      for (let i = 0; i < 30 && (await p.eval(activeTab)) !== 'led.c'; i++) await p.eval(`document.querySelector('.tool-step').click(); true`);
      if ((await p.eval(activeTab)) !== 'led.c') throw new Error(`active tab ${await p.eval(activeTab)}`);
      return `led.c:${await p.eval(curLine)}`;
    });

    await check('a compile error is located in led.c (console and editor)', async () => {
      await p.eval(openFile('led.c'));
      await p.eval(setText(LED_C.replace('gpio_init(LED);', 'gpio_init(LED)')));
      await p.eval(`document.querySelector('.tool-build').click(); true`);
      await p.waitFor(`${messages}.includes('error')`, 60000);
      const line = (await p.eval(messages)).split('\n').find((x) => /expected/.test(x));
      const invalid = await p.eval(`${activeArea}.getAttribute('aria-invalid')`);
      if (!line || invalid !== 'true') throw new Error(`${line}; aria-invalid ${invalid}`);
      await p.eval(setText(LED_C));
      return line.trim().slice(0, 90);
    });

    await check('after a reload the cached compiler builds without asking', async () => {
      await p.waitFor(`document.querySelector('.proj-status').textContent === 'Saved'`);
      await p.goto(page);
      await p.waitFor(`${messages}.includes('Built with Pico SDK C')`, 60000);
      if (await p.eval(`Boolean(document.querySelector('.dl-dialog[open]'))`)) throw new Error('the notice was shown again');
      return (await p.eval(messages)).split('\n').find((x) => x.includes('Built with')).trim();
    });

    await check('no errors in the page', async () => { if (p.errors.length) throw new Error(p.errors.slice(0, 3).join(' | ')); });
  } finally {
    await b.close();
    server.close();
  }
}
process.exitCode = failed ? 1 : 0;
