// make-boot-screen.mjs -- the loading screen of index.html (docs/architecture/arch-switcher.md, AS-6): the full MAVILERA
// logo, inline so that it is on screen from the first paint, written between the markers `boot:begin` and `boot:end`
// from content/branding/mavilera/mavilera-full.svg. Each path gets pathLength="1" so that theme.css can draw its outline.
//   node tools/make-boot-screen.mjs [--check]
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MARK = /(<!-- boot:begin[^>]*-->)[\s\S]*?(<!-- boot:end -->)/;

/** The inline logo of the loading screen, from the text of mavilera-full.svg. */
export function bootSvg(source) {
  const box = /viewBox="([^"]+)"/.exec(source)?.[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(source)?.[1];
  const group = /<g transform="[^"]*">[\s\S]*<\/g>/.exec(source)?.[0];
  if (!box || !style || !group) throw new Error('mavilera-full.svg: unexpected shape');
  return `<svg class="boot-logo" viewBox="${box}" aria-hidden="true" focusable="false"><style>${style}</style>${group.replace(/<path /g, '<path pathLength="1" ')}</svg>`;
}

/** index.html with the logo between the markers rewritten. */
export function withBootScreen(index, source) {
  if (!MARK.test(index)) throw new Error('index.html: boot markers not found');
  return index.replace(MARK, (m, a, b) => `${a}\n    ${bootSvg(source)}\n    ${b}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = join(ROOT, 'index.html');
  const have = readFileSync(page, 'utf8');
  const want = withBootScreen(have, readFileSync(join(ROOT, 'content/branding/mavilera/mavilera-full.svg'), 'utf8'));
  if (process.argv.includes('--check')) { console.log(have === want ? 'boot screen: up to date' : 'boot screen: DIFFERS'); process.exitCode = have === want ? 0 : 1; }
  else { writeFileSync(page, want); console.log(have === want ? 'boot screen: unchanged' : 'boot screen: written'); }
}
