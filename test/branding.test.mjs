// branding.test.mjs -- the MAVILERA identity: the logo files are
// plain vector SVG (a view box, no raster images, no external references,
// a title for standalone use, the rights line), every colour in them is a
// value of the interface's tokens in theme.css (the logo follows the GUI's
// palette), the page carries the name, description and SVG favicon, and the
// earlier name no longer appears in the application's code.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STRINGS } from '../src/ui/strings.js';
import { RISCV_STRINGS } from '../src/arch/riscv/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const LOGOS = ['mavilera-logo.svg', 'mavilera-full.svg', 'mavilera-lockup.svg', 'mavilera-wordmark.svg', 'mavilera-mark.svg', 'mavilera-icon.svg', 'mavilera-light.svg', 'mavilera-dark.svg', 'mavilera-mono.svg'];
const BR = 'content/branding/mavilera';

test('the name, the module name and the tagline', () => {
  assert.equal(STRINGS.appName, 'MAVILERA');
  assert.equal(RISCV_STRINGS.appFull, 'RISC-V Laboratory'); // the module's name, merged over the shell's
  assert.equal(STRINGS.tagline, 'Visualize. Execute. Understand.');
});

for (const file of LOGOS) {
  test(`${file}: native vector SVG, self-contained, titled, rights line present`, () => {
    const svg = read('content', 'branding', 'mavilera', file);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    assert.doesNotMatch(svg, /<image|<foreignObject|<filter|base64|@import|@font-face/i);
    assert.doesNotMatch(svg.replace('xmlns="http://www.w3.org/2000/svg"', ''), /https?:\/\/|href=/i, 'no external references');
    assert.match(svg, /<title id="[\w-]+">MAVILERA(?: RISC-V)?<\/title>/);
    assert.match(svg, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./);
    assert.match(svg, /Rights class: content/);
  });
}

test('every colour of the logo is a value of the interface tokens (theme.css)', () => {
  const css = read('src', 'ui', 'theme.css').toLowerCase();
  for (const file of LOGOS) {
    const colours = read('content', 'branding', 'mavilera', file).toLowerCase().match(/#[0-9a-f]{6}\b/g) ?? [];
    assert.ok(colours.length > 0, file);
    for (const c of colours) assert.ok(['#000000', '#ffffff'].includes(c) || css.includes(c), `${file}: ${c} is not a colour of theme.css`);
  }
  assert.match(css, /--mv-navy: #0b2a55/);
});

test('the page: title, description, SVG favicon that exists', () => {
  const html = read('index.html');
  assert.match(html, /<title>MAVILERA: RISC-V Laboratory<\/title>/);
  assert.match(html, /<meta name="description" content="MAVILERA RISC-V Laboratory/);
  const icon = /<link rel="icon" type="image\/svg\+xml" href="([^"]+)">/.exec(html);
  assert.ok(icon && existsSync(join(ROOT, icon[1])), 'favicon file');
});

/** Width and height of a PNG from its IHDR chunk, after checking the signature. */
function pngSize(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

test('the web-app manifest and the raster icons it and the page name', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.short_name, 'MAVILERA');
  assert.match(m.name, /MAVILERA: RISC-V Laboratory/);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  for (const i of m.icons) {
    const buf = readFileSync(join(ROOT, i.src));
    if (i.type === 'image/png') assert.deepEqual(pngSize(buf), i.sizes.split('x').map(Number), i.src);
  }
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]* href="([^"]+)">/g)) assert.ok(existsSync(join(ROOT, href)), href);
  assert.deepEqual(pngSize(readFileSync(join(ROOT, BR, 'apple-touch-icon.png'))), [180, 180]);
  // favicon.ico: an icon directory of three PNG entries, 16, 32 and 48 px
  const ico = readFileSync(join(ROOT, BR, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const sizes = [0, 1, 2].map((k) => {
    const off = ico.readUInt32LE(6 + 16 * k + 12);
    return pngSize(ico.subarray(off))[0];
  });
  assert.deepEqual(sizes, [16, 32, 48]);
});

// (the exercise mode of WS-F-148 is a feature of the tool and may say xercise; a numbered exercise of the book may not)
test('the interface names no book: chapters, sections, figures, tables, exercises or laboratories', () => {
  const lines = read('src', 'ui', 'strings.js').split('\n').filter((l) => !/^\s*\/\//.test(l));
  const bad = lines.filter((l) => /Chapter \d|Chapter \$\{|\bChapters?\b|the book|book's|textbook|§\d|\btab:|FIG-\d|LAB-\d|PRB-\d|exercise \d|exercise PRB|Guided Self-study/.test(l));
  assert.deepEqual(bad, []);
});

test('the earlier name is not the application\'s identity any more', () => {
  const files = ['index.html', ...readdirSync(join(ROOT, 'src'), { recursive: true }).map((f) => join('src', f)),
    ...readdirSync(join(ROOT, 'tools')).map((f) => join('tools', f))].filter((f) => /\.(m?js|html|css)$/.test(f));
  const bad = files.filter((f) => /Pip(?:'|\\')s RISC-V Lab|pips-run/.test(read(f)));
  assert.deepEqual(bad, []);
  assert.equal(JSON.parse(read('package.json')).name, 'mavilera');
  assert.ok(existsSync(join(ROOT, 'tools', 'risc-vista-run.mjs')));
});
