// preview-multi.mjs -- screenshots of the draft ARM multicycle drawing and state diagram (tools/armv7/preview-multi.html),
// one per case, light and dark, in a headless Chrome or Edge, for the author's review (roadmap ARM-A3; spec W-D32 Q8).
//   node tools/armv7/preview-multi.mjs <output directory> [--browser chrome|edge] [--light]
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
const ext = args.includes('--ext'); // the Extended drawing (A3-Q3 to A3-Q5)
const CASES = ext ? [...Array.from({ length: 7 }, (_, i) => [0, i]), [1, 0], [1, 1]] : [...Array.from({ length: 12 }, (_, i) => [0, i]), [1, 1], [1, 6], [1, 9]];
mkdirSync(out, { recursive: true });

const { server, url } = await startServer({ port: 0 });
const b = await launch(browser);
try {
  for (const colorScheme of schemes) {
    for (const [fsm, k] of CASES) {
      const p = await b.newPage({ width: 1700, height: fsm ? 1000 : 1500, colorScheme, reducedMotion: 'reduce' });
      await p.goto(new URL(`tools/armv7/preview-multi.html?case=${k}&fsm=${fsm}${ext ? '&ext=1' : ''}`, url).href);
      await p.waitFor(`document.body.dataset.ready === '1'`);
      const errors = p.errors.filter((e) => !e.includes('favicon'));
      if (errors.length) throw new Error(`case ${k}: ${errors.join('; ')}`);
      const file = join(out, `arm-multi${ext ? '-ext' : ''}${fsm ? '-fsm' : ''}-${k}-${colorScheme}.png`);
      writeFileSync(file, await p.screenshot('png'));
      console.log(file);
      await p.close();
    }
  }
} finally {
  await b.close();
  server.close();
}
