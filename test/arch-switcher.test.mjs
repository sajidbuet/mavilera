// arch-switcher.test.mjs -- the header logo's switcher, home link and loading screen (docs/architecture/arch-switcher.md):
// the list pinned to the registry, the address rules, the loading screen's markup in step with the logo file, and the
// timing of its removal. The interactive behaviour is checked in a browser (tools/module-smoke.mjs and by hand).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_ARCHS, switchTargets, homeUrl, archUrl } from '../src/shell/platform-archs.js';
import { withBootScreen, bootSvg } from '../tools/make-boot-screen.mjs';
import { endBoot, MIN_MS } from '../src/ui/boot.js';
import { STRINGS } from '../src/ui/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const registry = JSON.parse(read('site/architectures.json')).architectures;

test('the switcher lists the available modules, in the registry order, each with a logo file that exists; a planned module only as a preview', () => {
  const available = registry.filter((a) => a.status === 'available');
  const listed = PLATFORM_ARCHS.filter((a) => !a.preview);
  assert.deepEqual(listed.map((a) => a.id), available.map((a) => a.id));
  assert.deepEqual(listed.map((a) => a.name), available.map((a) => a.name));
  assert.equal(PLATFORM_ARCHS[0].id, 'riscv', 'RISC-V stays on top');
  for (const a of PLATFORM_ARCHS) assert.ok(existsSync(join(ROOT, 'content/branding/mavilera', a.logo)), a.logo);
  assert.ok(!listed.some((a) => registry.find((r) => r.id === a.id)?.status === 'planned'));
  // ARMv7: a preview on the development page until ARM-A6, available from 1.1.0 (author, 2026-11-02); no preview now
  assert.deepEqual(PLATFORM_ARCHS.filter((a) => a.preview).map((a) => a.id), []);
  assert.equal(registry.find((r) => r.id === 'armv7').status, 'available');
  // a preview entry is still kept from a release page and the offline file
  const list = [...PLATFORM_ARCHS, { id: 'x', name: 'X', logo: 'x.svg', preview: true }];
  assert.ok(switchTargets('riscv', { protocol: 'https:', href: 'https://sajidlab.org/mavilera/riscv/', release: true }, list).every((t) => t.id !== 'x'));
  assert.ok(switchTargets('riscv', { protocol: 'http:', href: 'http://127.0.0.1:8000/', release: false }, list).some((t) => t.id === 'x'));
});

test('addresses: a release page links to its siblings, the offline file to the site, the development page to ?arch=', () => {
  const rel = { protocol: 'https:', href: 'https://sajidlab.org/mavilera/sap-2/index.html?x=1#y', release: true };
  assert.equal(homeUrl(rel), 'https://sajidlab.org/mavilera/');
  assert.equal(archUrl('riscv', rel), 'https://sajidlab.org/mavilera/riscv/');
  const file = { protocol: 'file:', href: 'file:///C:/x/mavilera-sap-2-1.0.0.html', release: true };
  assert.equal(homeUrl(file), 'https://sajidlab.org/mavilera/');
  assert.equal(archUrl('sap-1', file), 'https://sajidlab.org/mavilera/sap-1/');
  const dev = { protocol: 'http:', href: 'http://127.0.0.1:8000/', release: false };
  assert.equal(homeUrl(dev), null, 'the development tree has no landing page');
  assert.equal(archUrl('sap-2', dev), '?arch=sap-2');
});

test('the targets leave out the current architecture and keep the order', () => {
  const dev = { protocol: 'http:', href: 'http://127.0.0.1:8000/', release: false };
  assert.deepEqual(switchTargets('riscv', dev).map((t) => t.id), ['sap-1', 'sap-2', 'armv7']);
  assert.deepEqual(switchTargets('sap-2', dev).map((t) => t.id), ['riscv', 'sap-1', 'armv7']);
  assert.deepEqual(switchTargets('sap-1', dev).map((t) => t.url), ['?arch=riscv', '?arch=sap-2', '?arch=armv7']);
  assert.deepEqual(switchTargets('armv7', dev).map((t) => t.id), ['riscv', 'sap-1', 'sap-2']);
  // a release page and the offline file offer the same modules
  const rel = { protocol: 'https:', href: 'https://sajidlab.org/mavilera/riscv/', release: true };
  assert.deepEqual(switchTargets('riscv', rel).map((t) => t.id), ['sap-1', 'sap-2', 'armv7']);
  assert.deepEqual(switchTargets('sap-1', { protocol: 'file:', href: 'file:///x.html', release: true }).map((t) => t.id), ['riscv', 'sap-2', 'armv7']);
  assert.ok(switchTargets('riscv', dev).every((t) => !('preview' in t)));
});

test('strings: the switcher\'s labels are British English text in the shell strings, and the old home link is gone', () => {
  const s = STRINGS.archSwitch;
  assert.equal(s.home, 'MAVILERA Home');
  assert.match(s.label('SAP-2'), /SAP-2/);
  assert.match(s.open('SAP-1'), /SAP-1/);
  assert.ok(s.list);
  assert.equal(STRINGS.homeLink, undefined);
  assert.doesNotMatch(read('src/main.js'), /home-link/);
  assert.doesNotMatch(read('src/ui/theme.css'), /home-link/);
});

test('the loading screen: in the page itself, written from the logo file, with the slow-load line and the no-script rule', () => {
  const index = read('index.html');
  const logo = read('content/branding/mavilera/mavilera-full.svg');
  assert.equal(withBootScreen(index, logo), index, 'run node tools/make-boot-screen.mjs');
  assert.ok(index.indexOf('id="boot"') < index.indexOf('class="app-header"'), 'first in the body');
  assert.match(index, /<noscript><style>\.boot \{ display: none; \}<\/style><\/noscript>/);
  assert.match(index, /class="boot-slow"/);
  const svg = bootSvg(logo);
  assert.equal((svg.match(/<path pathLength="1" /g) ?? []).length, 3);
  assert.doesNotMatch(svg, /<title|role=|aria-labelledby/);
  assert.match(svg, /aria-hidden="true"/);
  const css = read('src/ui/theme.css');
  assert.match(css, /@keyframes boot-draw/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\.boot/s);
  assert.match(read('src/main.js'), /endBoot\(brandReady\)/);
});

test('the header lockup is split where the files have their gap (MAVILERA ends at 1578, the chip begins at 1637 of 192 high)', () => {
  const css = read('src/ui/theme.css');
  assert.match(css, /--split: calc\(var\(--brand-h\) \* 8\.375\)/);
  assert.ok(1578 / 192 < 8.375 && 8.375 < 1637 / 192);
});

test('endBoot: waits for the minimum and for the tool, then fades and removes; reduced motion removes at once', async () => {
  const mk = (reduce) => {
    const calls = [];
    const classes = new Set();
    const screen = { classList: { add: (c) => classes.add(c) }, remove: () => calls.push('removed') };
    globalThis.document = { getElementById: (id) => (id === 'boot' ? screen : null) };
    globalThis.matchMedia = () => ({ matches: reduce });
    return { calls, classes };
  };
  try {
    let { calls, classes } = mk(false);
    const t0 = Date.now();
    await endBoot(Promise.resolve(), { now: () => 1000, min: 1200 }); // 200 ms to wait
    assert.ok(Date.now() - t0 >= 190);
    assert.ok(classes.has('boot-done'));
    await new Promise((r) => setTimeout(r, 340));
    assert.deepEqual(calls, ['removed']);

    ({ calls, classes } = mk(false));
    const t1 = Date.now();
    await endBoot(Promise.reject(new Error('logo')), { now: () => 5000 }); // a failed logo does not hold the screen
    assert.ok(Date.now() - t1 < 100);
    assert.ok(classes.has('boot-done'));

    ({ calls, classes } = mk(true));
    await endBoot(Promise.resolve(), { now: () => 0 });
    assert.deepEqual(calls, ['removed']);
    assert.equal(classes.size, 0);
    assert.equal(MIN_MS, 1200);
  } finally { delete globalThis.document; delete globalThis.matchMedia; }
});
