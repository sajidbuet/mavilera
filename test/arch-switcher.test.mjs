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
import { PLATFORM_ARCHS, switchTargets, homeUrl, archUrl, currentTool, toolViews, NAME_AT } from '../src/shell/platform-archs.js';
import { withBootScreen, withHeroCss, bootSvg } from '../tools/make-boot-screen.mjs';
import { HERO_MS } from '../tools/logo/hero-logo.mjs';
import { endBoot, MIN_MS } from '../src/ui/boot.js';
import { STRINGS } from '../src/ui/strings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const registry = JSON.parse(read('site/architectures.json')).architectures;

test('the views a tool shows: RISC-V its five, the NPU tool ISA, its single-cycle view and NPU (no multicycle, pipelined or comparison)', async () => {
  const { descriptor } = await import('../src/arch/riscv/index.js');
  const ids = (tool) => toolViews(descriptor, PLATFORM_ARCHS.find((a) => a.id === tool)).map((v) => v.id);
  assert.deepEqual(ids('riscv'), ['isa', 'single', 'multi', 'pipe', 'compare']);
  assert.deepEqual(ids('npu'), ['isa', 'npu-single', 'npu', 'npu-analysis']);
  assert.equal(toolViews(descriptor, null).length, descriptor.views.length, 'a module without a list shows every view');
  for (const a of PLATFORM_ARCHS.filter((x) => x.views)) {
    for (const id of a.views) assert.ok(descriptor.views.some((v) => v.id === id) || a.module !== 'riscv' && a.id !== 'riscv', `${a.id}: ${id}`);
  }
});

test('the switcher lists the available modules, in the registry order, then the NPU and GPU, each with a name lockup that exists; a planned module only as a preview', () => {
  const available = registry.filter((a) => a.status === 'available');
  const listed = PLATFORM_ARCHS.filter((a) => !a.preview && !a.module);
  assert.deepEqual(listed.map((a) => a.id), available.map((a) => a.id));
  assert.deepEqual(listed.map((a) => a.name), available.map((a) => a.name));
  assert.equal(PLATFORM_ARCHS[0].id, 'riscv', 'RISC-V stays on top');
  assert.deepEqual(PLATFORM_ARCHS.slice(-2).map((a) => a.id), ['npu', 'gpu'], 'the accelerators come last');
  for (const a of PLATFORM_ARCHS) {
    assert.ok(existsSync(join(ROOT, 'content/branding/mavilera', a.logo)), a.logo);
    assert.match(a.logo, /^mavilera-name-/, `${a.id}: an entry shows the name lockup, without MAVILERA`);
    assert.doesNotMatch(read(join('content/branding/mavilera', a.logo)), /<title id="mv-title">MAVILERA/);
    if (a.header) assert.ok(existsSync(join(ROOT, 'content/branding/mavilera', a.header)), a.header);
  }
  assert.ok(!listed.some((a) => registry.find((r) => r.id === a.id)?.status === 'planned'));
  // ARMv7: a preview on the development page until ARM-A6, available from 1.1.0 (author, 2026-11-02); the GPU is
  // one while the registry plans it
  assert.deepEqual(PLATFORM_ARCHS.filter((a) => a.preview).map((a) => a.id), registry.find((r) => r.id === 'gpu').status === 'planned' ? ['gpu'] : []);
  assert.equal(registry.find((r) => r.id === 'armv7').status, 'available');
  // the NPU is a tool of the RISC-V module (decision G2), on a view that module has (NPU-3, 2026-11-04)
  const npu = PLATFORM_ARCHS.find((a) => a.id === 'npu');
  assert.equal(npu.module, 'riscv');
  assert.match(read('src/arch/riscv/index.js'), new RegExp(`\\{ id: '${npu.view}', label:`));
  assert.ok(npu.views.includes(npu.view));
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
  assert.equal(homeUrl(dev), 'https://sajidlab.org/mavilera/', 'the development tree has no landing page: the site\'s (author, 2026-11-04)');
  assert.equal(archUrl('sap-2', dev), '?arch=sap-2');
});

test('the targets leave out the current tool and keep the order; the NPU opens the RISC-V module with tool=npu', () => {
  const dev = { protocol: 'http:', href: 'http://127.0.0.1:8000/', release: false };
  assert.deepEqual(switchTargets('riscv', dev).map((t) => t.id), ['sap-1', 'sap-2', 'armv7', 'i8086', 'npu', 'gpu']);
  assert.deepEqual(switchTargets('sap-2', dev).map((t) => t.id), ['riscv', 'sap-1', 'armv7', 'i8086', 'npu', 'gpu']);
  assert.deepEqual(switchTargets('sap-1', dev).map((t) => t.url), ['?arch=riscv', '?arch=sap-2', '?arch=armv7', '?arch=i8086', '?arch=riscv&tool=npu', '?arch=gpu']);
  assert.deepEqual(switchTargets('armv7', dev).map((t) => t.id), ['riscv', 'sap-1', 'sap-2', 'i8086', 'npu', 'gpu']);
  assert.deepEqual(switchTargets('npu', dev).map((t) => t.id), ['riscv', 'sap-1', 'sap-2', 'armv7', 'i8086', 'gpu']);
  assert.deepEqual(switchTargets('gpu', dev).map((t) => t.id), ['riscv', 'sap-1', 'sap-2', 'armv7', 'i8086', 'npu']);
  // a release page and the offline file offer the same tools (the GPU a preview module from 1.2.0)
  const rel = { protocol: 'https:', href: 'https://sajidlab.org/mavilera/riscv/', release: true };
  assert.deepEqual(switchTargets('riscv', rel).map((t) => t.id), ['sap-1', 'sap-2', 'armv7', 'i8086', 'npu', 'gpu']);
  assert.equal(switchTargets('riscv', rel).find((t) => t.id === 'npu').url, 'https://sajidlab.org/mavilera/riscv/?tool=npu');
  const file = { protocol: 'file:', href: 'file:///x.html', release: true };
  assert.deepEqual(switchTargets('sap-1', file).map((t) => t.id), ['riscv', 'sap-2', 'armv7', 'i8086', 'npu', 'gpu']);
  assert.equal(switchTargets('sap-1', file).find((t) => t.id === 'npu').url, 'https://sajidlab.org/mavilera/riscv/?tool=npu');
  assert.ok(switchTargets('riscv', dev).every((t) => Object.keys(t).join() === 'id,name,logo,url'));
});

test('the current tool: the module, or a tool of it named by tool=', () => {
  assert.equal(currentTool('riscv', '').id, 'riscv');
  assert.equal(currentTool('riscv', '?arch=riscv&tool=npu').id, 'npu');
  assert.equal(currentTool('riscv', '?tool=npu').header, 'mavilera-logo-npu.svg');
  assert.equal(currentTool('sap-1', '?arch=sap-1&tool=npu').id, 'sap-1', 'the NPU is not a tool of SAP-1');
  assert.equal(currentTool('riscv', '?tool=nothing').id, 'riscv');
  assert.equal(currentTool('gpu', '?arch=gpu').id, 'gpu');
});

test('the entries line up with the header: the name lockups begin where the header lockups have their chip', () => {
  const box = (f) => read(join('content/branding/mavilera', f)).match(/translate\((-?[\d.]+) /)[1];
  const headers = ['mavilera-logo.svg', 'mavilera-logo-sap-1.svg', 'mavilera-logo-sap-2.svg', 'mavilera-logo-armv7.svg', 'mavilera-logo-npu.svg', 'mavilera-logo-gpu.svg'];
  for (const h of headers) for (const a of PLATFORM_ARCHS) {
    const at = Number(box(h)) * -1, name = Number(box(a.logo)) * -1; // the files' left edges, in master units
    assert.ok(Math.abs((name - at) / 192 - NAME_AT) < 0.005, `${h} / ${a.logo}`);
  }
  assert.match(read('src/ui/theme.css'), new RegExp(`left: calc\\(var\\(--brand-h\\) \\* ${NAME_AT.toFixed(3).replace('.', '\\.')} - 17px\\)`));
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

test('the loading screen: in the page itself, the lockup animated as on the landing page (variant A), with the slow-load line and the no-script rule', () => {
  const index = read('index.html');
  const logo = read('content/branding/mavilera/mavilera-lockup.svg');
  assert.equal(withBootScreen(index, logo), index, 'run node tools/make-boot-screen.mjs');
  const css = read('src/ui/theme.css');
  assert.equal(withHeroCss(css), css, 'run node tools/make-boot-screen.mjs (the animation\'s CSS in theme.css)');
  assert.ok(index.indexOf('id="boot"') < index.indexOf('class="app-header"'), 'first in the body');
  assert.match(index, /<div id="boot" class="boot mvh-play mvh-loop"/, 'it plays from the first paint and pulses until the tool is ready');
  assert.match(index, /<noscript><style>\.boot \{ display: none; \}<\/style><\/noscript>/);
  assert.match(index, /class="boot-slow"/);
  const svg = bootSvg(logo);
  for (const part of ['card-0', 'card-4', 'wires-left', 'm-left', 'm-right', 'm-road', 'stage-if', 'stage-wb', 'letter-0', 'letter-7', 'tri-1', 'tri-2']) assert.match(svg, new RegExp(`p-${part}"`), part);
  assert.doesNotMatch(svg, /<title|role=|aria-labelledby/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(css, /\.boot \{[^}]*--mvh-t: 0\.6;/);
  assert.match(css, /@keyframes mvh-slide/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.mvh \*/);
  assert.equal(MIN_MS, Math.ceil(HERO_MS * 0.6 / 50) * 50, 'the screen stays until the shortened intro has played');
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
    assert.equal(MIN_MS, 1550);
  } finally { delete globalThis.document; delete globalThis.matchMedia; }
});
