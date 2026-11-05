// make-boot-screen.mjs -- the loading screen of index.html (docs/architecture/arch-switcher.md, AS-6): the MAVILERA lockup
// animated as on the landing page (variant A of docs/branding/logo-animation.md, approved 2026-11-05; tools/logo/hero-logo.mjs),
// inline so that it plays from the first paint. Writes the lockup's parts between the markers `boot:begin` and `boot:end`
// of index.html, and the animation's CSS between `hero:begin` and `hero:end` of src/ui/theme.css, from
// content/branding/mavilera/mavilera-lockup.svg.
//   node tools/make-boot-screen.mjs [--check]
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heroSvg, heroCss } from './logo/hero-logo.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MARK = /(<!-- boot:begin[^>]*-->)[\s\S]*?(<!-- boot:end -->)/;
const CSS_MARK = /(\/\* hero:begin[^*]*\*\/)[\s\S]*?(\/\* hero:end \*\/)/;

/** The inline logo of the loading screen, from the text of mavilera-lockup.svg: its parts, hidden from assistive technology
 *  (the screen's role="status" text says what happens). */
export function bootSvg(source) {
  return heroSvg(source, { rootClass: 'mvh boot-logo' });
}

/** index.html with the logo between the markers rewritten. */
export function withBootScreen(index, source) {
  if (!MARK.test(index)) throw new Error('index.html: boot markers not found');
  return index.replace(MARK, (m, a, b) => `${a}\n    ${bootSvg(source)}\n    ${b}`);
}

/** theme.css with the animation's CSS between the markers rewritten. */
export function withHeroCss(css) {
  if (!CSS_MARK.test(css)) throw new Error('theme.css: hero markers not found');
  return css.replace(CSS_MARK, (m, a, b) => `${a}\n${heroCss()}\n${b}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const lockup = readFileSync(join(ROOT, 'content/branding/mavilera/mavilera-lockup.svg'), 'utf8');
  const files = [[join(ROOT, 'index.html'), (s) => withBootScreen(s, lockup)], [join(ROOT, 'src/ui/theme.css'), withHeroCss]];
  let differs = 0;
  for (const [path, make] of files) {
    const have = readFileSync(path, 'utf8');
    const want = make(have);
    if (have !== want) differs += 1;
    if (!process.argv.includes('--check') && have !== want) writeFileSync(path, want);
  }
  if (process.argv.includes('--check')) { console.log(differs ? 'boot screen: DIFFERS' : 'boot screen: up to date'); process.exitCode = differs ? 1 : 0; }
  else console.log(differs ? 'boot screen: written' : 'boot screen: unchanged');
}
