// platform.test.mjs -- the MAVILERA platform layout (W-D25): the architecture registry that feeds the
// landing page, the landing page's fields and wording, and paths that stay relative so that the pages
// work under /mavilera/ and /mavilera/riscv/ (or any other base path).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const registry = JSON.parse(read('site/architectures.json')).architectures;

test('registry: unique ids and paths, a known status, nothing but the RISC-V module available', () => {
  assert.equal(new Set(registry.map((a) => a.id)).size, registry.length);
  assert.equal(new Set(registry.map((a) => a.path)).size, registry.length);
  for (const a of registry) {
    assert.match(a.id, /^[a-z0-9-]+$/);
    assert.ok(a.name);
    assert.match(a.path, /^[a-z0-9-]+\/$/, 'a relative directory path, no leading slash');
    assert.ok(['available', 'planned'].includes(a.status), a.id);
    if (a.status === 'available') assert.ok(a.description, `${a.id}: an available module needs a description`);
  }
  assert.deepEqual(registry.filter((a) => a.status === 'available').map((a) => a.id), ['riscv']);
  assert.deepEqual(registry.map((a) => a.id), ['riscv', 'sap-1', 'sap-2', '6502', '8086', 'armv7', 'mips']);
});

test('landing page: the required wording, the card slot, no claims for planned modules, no old name', () => {
  const html = read('site/index.html');
  for (const s of ['Interactive Microprocessor Architecture Laboratory', 'Visualize. Execute. Understand.',
    'MAVILERA is an open-source educational platform for exploring microprocessor architecture through interactive simulation, visualization, and instruction execution.',
    'Launch RISC-V Laboratory', 'Explore Architectures', '{{CARDS}}']) assert.ok(html.includes(s), s);
  assert.ok(!/RISC-VISTA|riscvista/i.test(html));
  // planned modules are never linked from the page template
  for (const a of registry.filter((x) => x.status !== 'available')) assert.ok(!html.includes(`href="${a.path}"`), a.id);
});

test('paths stay relative: no root-absolute asset or link in the pages, the manifest or the service worker source', () => {
  const rootAbsolute = /\b(?:href|src|action)\s*=\s*["']\/(?!\/)/i;
  for (const f of ['index.html', 'site/index.html', 'content/help/docs/index.html']) assert.doesNotMatch(read(f), rootAbsolute, f);
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  for (const i of m.icons) assert.ok(!i.src.startsWith('/'), i.src);
  assert.doesNotMatch(read('tools/release.mjs'), /new URL\(['"]\//, 'the service worker derives its scope from its own location');
});

test('the app links to MAVILERA Home only in a release, and the logo files it reads exist', () => {
  const main = read('src/main.js');
  assert.match(main, /home-link/);
  assert.match(main, /STRINGS\.homeLink/);
  for (const f of ['mavilera-logo.svg', 'mavilera-icon.svg']) assert.ok(existsSync(join(ROOT, 'content/branding/mavilera', f)), f);
});

test('the earlier product name appears nowhere user-facing: pages, strings, manifest, documentation', () => {
  for (const f of ['index.html', 'manifest.webmanifest', 'src/ui/strings.js', 'content/help/help.json', 'content/help/docs/index.html', 'site/index.html']) {
    const text = read(f).replace(/risc-vista-(?:exercise|settings|edition|version)/g, '');
    assert.ok(!/RISC-VISTA|riscvista/i.test(text), f);
  }
});
