// mavilera-brand.test.mjs -- the final MAVILERA brand assets (logo concept D, W-D25): present, original
// (no external reference, no raster, no font), in the colours of theme.css, with the licence line.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'content/branding/mavilera');
const SVGS = ['mavilera-logo.svg', 'mavilera-icon.svg', 'mavilera-icon-small.svg', 'mavilera-light.svg', 'mavilera-dark.svg', 'mavilera-mono.svg'];
const theme = readFileSync(join(ROOT, 'src/ui/theme.css'), 'utf8').toLowerCase();

test('every SVG is self-contained, licensed and uses only theme colours (or black/white)', () => {
  for (const f of SVGS) {
    const s = readFileSync(join(DIR, f), 'utf8');
    assert.match(s, /Copyright \(c\) 2026 Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./, f);
    assert.doesNotMatch(s, /(?:href|src)\s*=|url\(\s*["']?(?!#)|<image|<text|font-family|@import/i, f);
    for (const hex of s.match(/#[0-9a-f]{6}\b/gi) ?? []) {
      assert.ok(['#000000', '#ffffff'].includes(hex.toLowerCase()) || theme.includes(hex.toLowerCase()), `${f}: ${hex} is not a colour of theme.css`);
    }
  }
});

test('raster icons exist; the favicon holds 16, 32 and 48 px PNGs; the social image is 1200 x 630', () => {
  for (const f of ['icon-16.png', 'icon-32.png', 'icon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'social-preview.png', 'favicon.ico']) {
    assert.ok(existsSync(join(DIR, f)), f);
  }
  const ico = readFileSync(join(DIR, 'favicon.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.deepEqual([0, 1, 2].map((k) => ico.readUInt8(6 + 16 * k)), [16, 32, 48]);
  const png = readFileSync(join(DIR, 'social-preview.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
});
