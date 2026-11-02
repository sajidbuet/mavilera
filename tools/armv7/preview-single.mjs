// preview-single.mjs -- screenshots of the draft ARM single-cycle drawing (tools/armv7/preview-single.html), one per
// case, light and dark, in a headless Chrome or Edge, for the author's review (roadmap ARM-A2; spec W-D32 Q8).
//   node tools/armv7/preview-single.mjs <output directory> [--browser chrome|edge]
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
mkdirSync(out, { recursive: true });

const { server, url } = await startServer({ port: 0 });
const b = await launch(browser);
try {
  for (const colorScheme of ['light', 'dark']) {
    for (const [ext, k] of [...Array.from({ length: 8 }, (_, i) => [0, i]), ...Array.from({ length: 8 }, (_, i) => [1, i])]) {
      const p = await b.newPage({ width: 1600, height: 1150, colorScheme, reducedMotion: 'reduce' });
      await p.goto(new URL(`tools/armv7/preview-single.html?case=${k}&ext=${ext}`, url).href);
      await p.waitFor(`document.body.dataset.ready === '1'`);
      const errors = p.errors.filter((e) => !e.includes('favicon'));
      if (errors.length) throw new Error(`case ${k}: ${errors.join('; ')}`);
      const file = join(out, `arm-single${ext ? '-ext' : ''}-${k}-${colorScheme}.png`);
      writeFileSync(file, await p.screenshot('png'));
      console.log(file);
      await p.close();
    }
  }
} finally {
  await b.close();
  server.close();
}
