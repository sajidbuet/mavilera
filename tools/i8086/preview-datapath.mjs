// preview-datapath.mjs -- screenshots of the draft 8086 BIU/EU drawing (tools/i8086/preview-datapath.html), one per
// case, light and dark, in a headless Chrome or Edge, for the author's review (milestone 8086-B4).
//   node tools/i8086/preview-datapath.mjs <output directory> [--browser chrome|edge] [--light] [--case n]
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch } from '../browser.mjs';
import { startServer } from '../serve.mjs';

const args = process.argv.slice(2);
const out = resolve(args[0] ?? '.');
const browser = args.includes('--browser') ? args[args.indexOf('--browser') + 1] : 'chrome';
const schemes = args.includes('--light') ? ['light'] : ['light', 'dark'];
const only = args.includes('--case') ? Number(args[args.indexOf('--case') + 1]) : null;
const CASES = 12;
mkdirSync(out, { recursive: true });

const { server, url } = await startServer({ port: 0 });
const b = await launch(browser);
let failed = 0;
try {
  for (const colorScheme of schemes) {
    for (let k = 0; k < CASES; k++) {
      if (only !== null && k !== only) continue;
      const p = await b.newPage({ width: 1600, height: 1150, colorScheme, reducedMotion: 'reduce' });
      await p.goto(new URL(`tools/i8086/preview-datapath.html?case=${k}`, url).href);
      try {
        await p.waitFor(`document.body.dataset.ready === '1'`);
      } catch (e) {
        console.error(`case ${k}: not ready; ${p.errors.join('; ')}`);
        failed += 1; await p.close(); continue;
      }
      const errors = p.errors.filter((e) => !e.includes('favicon'));
      if (errors.length) { console.error(`case ${k}: ${errors.join('; ')}`); failed += 1; }
      const file = join(out, `i8086-datapath-${k}-${colorScheme}.png`);
      writeFileSync(file, await p.screenshot('png'));
      console.log(file);
      await p.close();
    }
  }
} finally {
  await b.close();
  server.close();
}
process.exitCode = failed ? 1 : 0;
