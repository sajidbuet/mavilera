// module-smoke.mjs -- the smoke tests every MAVILERA module passes (WS-V-031; spec W-D29, phase 6), written
// against the architecture contract only, so that they run on any architecture of src/arch/registry.js: the page
// loads without errors and without horizontal scrolling at 1366 x 768 (WS-U-011) and carries the module's name; it
// requests no other architecture's modules; the default program assembles, steps and steps back; every view loads,
// its drawings included; an axe-core scan of every view in both themes and in projector mode (WS-U-034; the drawings,
// as in tools/browser-smoke.mjs, without the contrast and label-in-name rules). On a release build also the service
// worker (the page reloads with the network off, WS-N-012), and with --offline the single-file build opened from
// the disk (WS-N-002). RISC-V's own, deeper checks are in tools/browser-smoke.mjs.
//
//   node tools/module-smoke.mjs --arch <id> [--browser chrome|edge] [--root dir --path sub/] [--offline file.html] [--out report.json]
//
// Without --root the development page is tested with ?arch=<id>. Exit status 1 if any check fails. Development
// only (axe-core is a dev dependency, THIRD_PARTY.md); nothing here is part of the site.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');
const AXE_VERSION = JSON.parse(readFileSync(join(AXE_PATH, '..', 'package.json'), 'utf8')).version;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const ID = opt('--arch');
const { ARCHITECTURES } = await import(pathToFileURL(join(ROOT, 'src/arch/registry.js')).href);
if (!ARCHITECTURES[ID]) throw new Error(`--arch: one of ${Object.keys(ARCHITECTURES).join(', ')}`);
const arch = (await ARCHITECTURES[ID]()).descriptor;
// the views the module's own page shows (a tool inside the module, as the NPU in RISC-V, has views of its own)
const { PLATFORM_ARCHS, toolViews } = await import(pathToFileURL(join(ROOT, 'src/shell/platform-archs.js')).href);
const PAGE_VIEWS = toolViews(arch, PLATFORM_ARCHS.find((a) => a.id === ID && !a.module));
const { STRINGS } = await import(pathToFileURL(join(ROOT, 'src/ui/strings.js')).href);
const TITLE = `${STRINGS.appName}: ${arch.strings.appFull}`;

const pc = `document.querySelector('.pc-val')?.textContent.trim()`;
const views = `document.querySelectorAll('.mode-btn').length`;
const activeView = `[...document.querySelectorAll('.mode-btn')].findIndex((b) => b.getAttribute('aria-selected') === 'true')`;
const view = (i) => `(async () => { document.querySelectorAll('.mode-btn')[${i}].click(); return true; })()`;
// a view has loaded when its tab is selected and no pane of the workspace says it is loading
const loaded = (i) => `${activeView} === ${i} && ![...document.querySelectorAll('.workspace .note')].some((n) => n.offsetParent && n.textContent.startsWith('Loading'))`;
// the modules of other architectures the page fetched
const foreign = `performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\\/src\\/arch\\/[^/]+\\//.test(n) && !n.includes('/src/arch/${ID}/'))`;

async function checks(b, base) {
  const out = [];
  const check = async (name, f) => {
    try {
      const detail = await f();
      out.push({ name, ok: true, ...(detail ? { detail } : {}) });
    } catch (e) {
      out.push({ name, ok: false, error: String(e.message ?? e) });
    }
  };
  // A page with cleared browser storage (the modules of one origin share it), plus the given keys.
  const fresh = async (opts = {}, storage = {}) => {
    const p = await b.newPage(opts);
    await p.goto(base);
    await p.eval(`localStorage.clear(); ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')}`);
    p.errors.length = 0;
    await p.goto(base);
    await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
    return p;
  };
  const visitViews = async (p) => {
    const n = await p.eval(views);
    for (let i = 0; i < n; i++) {
      await p.eval(view(i));
      await p.waitFor(loaded(i));
    }
    return n;
  };

  await check(`loads as "${TITLE}" without errors and without horizontal scrolling at 1366 x 768 (WS-U-011)`, async () => {
    const p = await fresh();
    const w = await p.eval('[document.documentElement.scrollWidth, innerWidth]');
    if (w[0] > w[1]) throw new Error(`page ${w[0]} px wide in a ${w[1]} px window`);
    if (await p.eval('document.title') !== TITLE) throw new Error(`title ${await p.eval('document.title')}`);
    if (p.errors.length) throw new Error(p.errors.join('; '));
    await p.close();
  });

  await check('assemble the default program, step three times, step back once (WS-F-090)', async () => {
    const p = await fresh();
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    const seen = [await p.eval(pc)];
    for (let i = 0; i < 3; i++) { await p.key('F10', { keyCode: 121 }); seen.push(await p.eval(pc)); }
    if (new Set(seen).size < 2) throw new Error(`PC stayed ${seen[0]}`);
    await p.key('F10', { keyCode: 121, modifiers: 8 });
    const back = await p.eval(pc);
    if (back !== seen[2]) throw new Error(`step back gave ${back}, expected ${seen[2]}`);
    if (p.errors.length) throw new Error(p.errors.join('; '));
    await p.close();
    return `PC ${seen.join(' → ')}, back to ${back}`;
  });

  await check('every view loads, a processor view with its drawing; no other architecture\'s module is fetched (W-D29)', async () => {
    const p = await fresh();
    const n = await p.eval(views);
    if (n !== PAGE_VIEWS.length) throw new Error(`${n} view tabs, ${PAGE_VIEWS.length} views`);
    const seen = [];
    for (let i = 0; i < n; i++) {
      await p.eval(view(i));
      await p.waitFor(loaded(i));
      // the drawings the shell attached pan and zoom to (ViewInstance.diagrams), as shown
      const d = await p.eval(`[...document.querySelectorAll('svg.pz-svg')].filter((s) => s.getBoundingClientRect().width > 0).length`);
      if (['datapath', 'bus'].includes(PAGE_VIEWS[i].kind) && !d) throw new Error(`${PAGE_VIEWS[i].id}: no drawing`);
      seen.push(`${PAGE_VIEWS[i].id} ${d}`);
    }
    const other = await p.eval(foreign);
    if (other.length) throw new Error(`fetched ${other.join(', ')}`);
    if (p.errors.length) throw new Error(p.errors.join('; '));
    await p.close();
    return `drawings per view: ${seen.join(', ')}`;
  });

  const edition = await b.newPage();
  await edition.goto(base);
  const release = await edition.eval(`Boolean(document.querySelector('meta[name="risc-vista-edition"][content="release"]'))`);
  await edition.close();
  if (release) {
    await check('service worker: after the first visit the page reloads with the network off (WS-N-012)', async () => {
      const w = await fresh();
      await w.waitFor(`navigator.serviceWorker.ready.then((r) => Boolean(r.active))`, 30000);
      await w.waitFor(`caches.keys().then((k) => k.some((n) => n.startsWith('mavilera-${ID}-')))`);
      await w.send('Network.enable');
      await w.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      w.errors.length = 0;
      await w.goto(base);
      await w.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
      const n = await visitViews(w);
      if (w.errors.length) throw new Error(w.errors.join('; '));
      await w.close();
      return `${n} views loaded offline`;
    });
  }

  if (opt('--offline')) await check('single-file build opened from the disk: runs, every view loads, no network request (WS-N-002)', async () => {
    const o = await b.newPage();
    await o.goto(pathToFileURL(resolve(opt('--offline'))).href);
    await o.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
    if (await o.eval('document.title') !== TITLE) throw new Error(`title ${await o.eval('document.title')}`);
    await o.key('Enter', { keyCode: 13, modifiers: 2 });
    const before = await o.eval(pc);
    await o.key('F10', { keyCode: 121 });
    if (await o.eval(pc) === before) throw new Error('step');
    const n = await visitViews(o);
    const net = await o.eval(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => !n.startsWith('blob:') && !n.startsWith('data:'))`);
    if (net.length) throw new Error(`requests: ${net.join(', ')}`);
    if (o.errors.length) throw new Error(o.errors.join('; '));
    await o.close();
    return `${n} views`;
  });

  const axe = readFileSync(AXE_PATH, 'utf8');
  const axeIn = (sel) => `axe.run({ include: [[${JSON.stringify(sel)}]] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'] })
    .then((r) => r.violations.map((v) => \`\${v.id} (\${v.impact}, \${v.nodes.length})\`))`;

  // the practice exercises of a module that has them (WS-F-148): the list, the first exercise and its starter, whose
  // tests run and do not all pass; the dialog in both states passes the axe-core scan
  if (arch.capabilities.exercises === true && arch.content?.exercises) {
    await check('practice exercises: the list opens, the first loads its starter, its tests run and fail on it; the dialog passes axe-core (WS-F-148)', async () => {
      const p = await fresh();
      await p.eval(axe);
      const click = (sel, text) => p.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
        if (!b) return false; b.click(); return true; })()`);
      if (!await click('button', STRINGS.exercise.menu)) throw new Error('no Exercise… menu item');
      await p.waitFor(`document.querySelector('.exercise-dialog[open] .ex-item')`);
      const n = await p.eval(`document.querySelectorAll('.exercise-dialog .ex-item').length`);
      const listViolations = await p.eval(axeIn('.exercise-dialog'));
      if (listViolations.length) throw new Error(`the list: ${listViolations.join('; ')}`);
      await p.eval(`document.querySelector('.exercise-dialog .ex-item').click(); true`);
      await p.waitFor(`document.querySelector('.exercise-dialog .exd-task')`);
      const title = await p.eval(`document.querySelector('.exercise-dialog h2, .exercise-dialog .exd-title')?.textContent ?? ''`);
      if (!await click('.exercise-dialog button', STRINGS.exercise.starter)) throw new Error('no starter button');
      await p.waitFor(`!document.querySelector('.exercise-dialog[open]')`);
      if (!await click('.toolbar button', STRINGS.exercise.button)) throw new Error('no Exercise button in the toolbar');
      await p.waitFor(`document.querySelector('.exercise-dialog[open]')`);
      await click('.exercise-dialog button', STRINGS.exercise.run);
      await p.waitFor(`document.querySelector('.exercise-dialog .exd-summary')`, 30000);
      const summary = await p.eval(`document.querySelector('.exercise-dialog .exd-summary').textContent`);
      if (await p.eval(`document.querySelector('.exercise-dialog .exd-summary').classList.contains('ok')`)) throw new Error(`the starter passes: ${summary}`);
      const v = await p.eval(axeIn('.exercise-dialog'));
      if (v.length) throw new Error(`the results: ${v.join('; ')}`);
      if (p.errors.length) throw new Error(p.errors.join('; '));
      await p.close();
      return `${n} exercises; ${title.trim() || 'the first'}: the starter gives "${summary}"`;
    });
  }

  const scans = [];
  for (const scheme of ['light', 'dark']) {
    for (const projector of [false, true]) {
      const s = await fresh({ colorScheme: scheme }, projector ? { 'pips.projector': '1' } : {});
      await s.eval(axe);
      const n = await s.eval(views);
      for (let i = 0; i < n; i++) {
        await s.eval(view(i));
        await s.waitFor(loaded(i));
        await new Promise((r) => setTimeout(r, 300));
        const name = await s.eval(`document.querySelectorAll('.mode-btn')[${i}].textContent.trim()`);
        const scan = (context, rules = {}) => s.eval(`axe.run(${context}, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, rules: ${JSON.stringify(rules)}, resultTypes: ['violations'] })
          .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) })))`);
        scans.push({ view: name, scheme, projector, violations: await scan(`{ exclude: [['svg.pz-svg']] }`) });
        if (await s.eval(`Boolean(document.querySelector('svg.pz-svg'))`)) {
          scans.push({ view: `${name} drawing`, scheme, projector, violations: await scan(`{ include: [['svg.pz-svg']] }`,
            { 'color-contrast': { enabled: false }, 'label-content-name-mismatch': { enabled: false } }) });
        }
      }
      if (s.errors.length) scans.push({ view: 'page', scheme, projector, violations: [{ id: 'errors', impact: 'error', nodes: s.errors.length, targets: s.errors.slice(0, 2) }] });
      await s.close();
    }
  }
  const failing = scans.filter((s) => s.violations.length);
  out.push({ name: `axe-core ${AXE_VERSION} scan (${AXE_TAGS.join(', ')}) of ${scans.length} view states and drawings; drawings without the contrast and label-in-name rules (WS-U-034)`,
    ok: failing.length === 0, scans: failing.length ? failing : undefined, error: failing.length ? `${failing.length} view state(s) with violations` : undefined });
  return out;
}

const { server, url: origin } = await startServer({ port: 0, ...(opt('--root') ? { root: opt('--root') } : {}) });
const url = origin + (opt('--root') ? opt('--path') ?? '' : `?arch=${encodeURIComponent(ID)}`);
const report = { tool: 'tools/module-smoke.mjs', arch: ID, date: new Date().toISOString(), axeCore: AXE_VERSION, browsers: [] };
let failed = false;
try {
  for (const name of BROWSERS) {
    const b = await launch(name);
    if (!b) { report.browsers.push({ name, installed: false }); console.log(`${name}: not installed, skipped`); continue; }
    try {
      const results = await checks(b, url);
      report.browsers.push({ name, version: b.version, results });
      console.log(`${name} (${b.version}), ${ID}`);
      for (const r of results) {
        console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}${r.error ? ` — ${r.error}` : ''}`);
        if (!r.ok) failed = true;
        for (const s of r.scans ?? []) for (const v of s.violations) {
          console.log(`        ${s.view}/${s.scheme}${s.projector ? '/projector' : ''}: ${v.id} (${v.impact}, ${v.nodes}) ${v.targets.join(' | ')}`);
        }
      }
    } finally { await b.close(); }
  }
} finally { server.close(); }
if (opt('--out')) writeFileSync(opt('--out'), `${JSON.stringify(report, null, 1)}\n`);
process.exitCode = failed ? 1 : 0;
