// screenshots.mjs -- retakes the screenshots of site/screens/ (README and the landing page) from the current interface in a headless Chrome or Edge, so that they
// show the present name and wording. Development only.
//   node tools/screenshots.mjs [--browser chrome|edge]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'site/screens');
const PROGRAM = readFileSync(join(ROOT, 'content/examples/ch08-dep.s'), 'utf8');
const args = process.argv.slice(2);
const browser = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : 'chrome';

const setSource = (src) => `(() => { const a = document.querySelector('.p-editor textarea'); a.value = ${JSON.stringify(src)};
  a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const pc = `document.querySelector('.pc-val')?.textContent.trim()`;
const view = (i) => `(() => { document.querySelectorAll('.mode-btn')[${i}].click(); return true; })()`;
const settle = () => new Promise((ok) => setTimeout(ok, 600));

const { server, url } = await startServer({ port: 0 });
const b = await launch(browser);
try {
  // [file, colour scheme, view index, steps]
  const shots = [['workspace-light.jpg', 'light', 0, 6], ['workspace-dark.jpg', 'dark', 0, 6], ['view-ch08.jpg', 'light', 3, 7]];
  for (const [file, colorScheme, v, steps] of shots) {
    const p = await b.newPage({ width: 1568, height: 737, colorScheme, reducedMotion: 'reduce' });
    await p.goto(url);
    await p.eval('localStorage.clear(); true');
    await p.goto(url);
    await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('.p-editor textarea')`);
    if (v) {
      await p.eval(view(v));
      await p.waitFor(`document.querySelector('svg.dp')`);
    }
    await p.eval(setSource(PROGRAM));
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.waitFor(`${pc} === '0x00000000'`);
    for (let i = 0; i < steps; i++) await p.key('F10', { keyCode: 121 });
    await settle();
    if (p.errors.length) throw new Error(`${file}: ${p.errors.join('; ')}`);
    writeFileSync(join(OUT, file), await p.screenshot('jpeg', 88));
    console.log(`site/screens/${file}`);
    await p.close();
  }
} finally {
  await b.close();
  server.close();
}
