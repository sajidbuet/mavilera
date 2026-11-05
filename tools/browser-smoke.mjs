// browser-smoke.mjs -- interface smoke tests and accessibility scan in a
// headless browser (WS-V-031; spec W-D18). For each installed browser:
// the page loads without errors and without horizontal scrolling at
// 1366 x 768 (WS-U-011); assemble, step and back-step; a share link round
// trip (WS-F-122); export identity: the trace and golden-dump downloads equal
// the headless runner's files (WS-F-124, WS-F-126, WS-F-127); every tab stop
// shows a visible focus (WS-U-030); an axe-core scan of every view in both
// themes and in projector mode (WS-U-034). The drawings are scanned without
// the contrast rule (they keep the book's palette and meet WS-U-031 to
// WS-U-033 through their text alternative) and without label-in-name (pin
// numbers drawn inside a multiplexer's link).
//
//   node tools/browser-smoke.mjs [--browser chrome|edge] [--root dir --path sub/] [--offline file.html] [--out report.json] [--update-snapshot]
//
// --update-snapshot rewrites test/fixtures/dom-snapshot.json from the page instead of comparing with it (only on a
// deliberate change of the interface).
//
// --root and --path test a release build (node tools/release.mjs; --root dist --path riscv/): then also the
// release edition (no JALR switch, W-D20) and the service worker (the page reloads with the network off,
// WS-N-012). --offline adds the checks of the single-file build opened from the disk (WS-N-002).
//
// Exit status 1 if any check fails. Development only (axe-core is a dev
// dependency, THIRD_PARTY.md); nothing here is part of the site.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const VIEWS = ['isa', 'single', 'multi', 'pipe', 'compare'];
const TRACE_PROGRAM = 'content/examples/tests-arraysum.s';
const GOLDEN_PROGRAM = 'content/examples/ch08-loaduse.s';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];

/** The headless runner's output for one program (the reference of export identity). */
function runner(...a) {
  return execFileSync(process.execPath, [join(ROOT, 'tools/risc-vista-run.mjs'), ...a], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
}

// In the page: the strings module (the same instance main.js uses), downloads captured, the clipboard replaced.
const PREPARE = `(async () => {
  window.__S = (await import(new URL('ui/strings.js', document.querySelector('script[type=module][src$="main.js"]').src))).STRINGS;
  window.__dl = [];
  const blobs = new Map();
  const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = make(b); blobs.set(u, b); return u; };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && blobs.has(this.href)) { blobs.get(this.href).text().then((t) => window.__dl.push({ name: this.download, text: t })); return; }
    return click.call(this);
  };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__clip = t; } } });
  return true;
})()`;
const button = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === (${text}))`;
const setSource = (src) => `(() => { const a = document.querySelector('.p-editor textarea'); a.value = ${JSON.stringify(src)};
  a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const pc = `document.querySelector('.pc-val')?.textContent.trim()`;
const view = (i) => `(async () => { document.querySelectorAll('.mode-btn')[${i}].click(); return true; })()`;
// The DOM snapshot of one view (arch-contract phase 0): the open panes (folded ones marked -) and every visible control
// outside the drawings, each as its pane, role, name and state. Screenshot-free; compared with SNAPSHOT_FILE. The
// release's MAVILERA Home link is left out, and its missing JALR switch (W-D20) expected, so that a release build
// compares with the development page's snapshot.
const SNAPSHOT_FILE = 'test/fixtures/dom-snapshot.json';
const snapshot = `(() => {
  // a drawing's zoom level ("58 %: zoom to 100 %") follows the pane's size and the fonts: recorded as "N %"
  const clean = (t) => (t ?? '').replace(/\\s+/g, ' ').trim().replace(/^\\d+ %:/, 'N %:').slice(0, 60);
  const name = (e) => clean(e.getAttribute('aria-label') || (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName)
    ? e.labels?.[0]?.textContent || e.getAttribute('title') || e.getAttribute('placeholder') || e.name : e.textContent || e.getAttribute('title')));
  const panes = [...document.querySelectorAll('.workspace [data-pane]')].filter((n) => n.offsetParent)
    .map((n) => n.dataset.pane + (n.classList.contains('collapsed') ? '-' : ''));
  const controls = [...document.querySelectorAll('button, input, select, textarea, summary, a[href], [role=tab], [role=switch], [role=checkbox]')]
    .filter((e) => e.offsetParent !== null && !e.closest('svg') && !e.matches('a.brand-home'))
    .map((e) => {
      const pane = e.closest('[data-pane]')?.dataset.pane ?? (e.closest('header, .toolbar') ? 'toolbar' : '-');
      const role = e.getAttribute('role') || e.tagName.toLowerCase() + (e.tagName === 'INPUT' ? ':' + e.type : '');
      const st = [(e.disabled || e.getAttribute('aria-disabled') === 'true') && 'disabled', e.getAttribute('aria-selected') === 'true' && 'selected',
        e.getAttribute('aria-pressed') === 'true' && 'pressed', (e.checked || e.getAttribute('aria-checked') === 'true') && 'checked',
        e.tagName === 'SELECT' && 'value=' + e.value].filter(Boolean).join(',');
      return pane + ' ' + role + ' "' + name(e) + '"' + (st ? ' [' + st + ']' : '');
    });
  return { panes, controls };
})()`;
const activeView = `[...document.querySelectorAll('.mode-btn')].findIndex((b) => b.getAttribute('aria-selected') === 'true')`;

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
  // A page with cleared browser storage (the pages of one browser share it), plus the given keys.
  const fresh = async (opts = {}, storage = {}) => {
    const p = await b.newPage(opts);
    await p.goto(base);
    await p.eval(`localStorage.clear(); ${Object.entries(storage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('')}`);
    p.errors.length = 0; // count only the errors of the load that the checks use
    await p.goto(base);
    await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
    await p.eval(PREPARE);
    return p;
  };
  const p = await fresh();

  await check('loads without errors and without horizontal scrolling at 1366 x 768 (WS-U-011)', async () => {
    const w = await p.eval('[document.documentElement.scrollWidth, innerWidth]');
    if (w[0] > w[1]) throw new Error(`page ${w[0]} px wide in a ${w[1]} px window`);
    if (p.errors.length) throw new Error(p.errors.join('; '));
  });

  await check(`DOM snapshot of every view equals ${SNAPSHOT_FILE} (panes, controls, names, states)`, async () => {
    // reduced motion set, not taken from the machine: the "Signal flow" control is disabled under it, and the snapshot
    // was recorded so (a machine without the setting made it differ, §17 item 3)
    const d = await fresh({ reducedMotion: 'reduce' });
    const got = {};
    for (let i = 0; i < VIEWS.length; i++) {
      await d.eval(view(i));
      await d.waitFor(`${activeView} === ${i} && !document.querySelector('.p-datapath .note, .p-compare .note')?.textContent.startsWith('Loading')
        && (${i} === 0 || ${i} === 4 || Boolean(document.querySelector('svg.dp')))`);
      await new Promise((r) => setTimeout(r, 300));
      got[VIEWS[i]] = await d.eval(snapshot);
    }
    if (d.errors.length) throw new Error(d.errors.join('; '));
    const rel = await d.eval(`Boolean(document.querySelector('meta[name="risc-vista-edition"][content="release"]'))`);
    await d.close();
    const n = Object.values(got).reduce((s, v) => s + v.controls.length, 0);
    if (args.includes('--update-snapshot')) {
      const head = { _copyright: 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.', _source: 'node tools/browser-smoke.mjs --update-snapshot' };
      writeFileSync(join(ROOT, SNAPSHOT_FILE), `${JSON.stringify({ ...head, ...got }, null, 1)}\n`);
      return `written: ${n} controls`;
    }
    const want = JSON.parse(readFileSync(join(ROOT, SNAPSHOT_FILE), 'utf8'));
    // the snapshot is the development page's; the release edition has no JALR switch by design (W-D20)
    if (rel) for (const v of VIEWS) if (want[v]) want[v].controls = want[v].controls.filter((c) => !/reference JALR state/i.test(c));
    const diff = [];
    for (const v of VIEWS) for (const k of ['panes', 'controls']) {
      const a = want[v]?.[k] ?? [], g = got[v][k];
      for (let j = 0; j < Math.max(a.length, g.length); j++) if (a[j] !== g[j]) { diff.push(`${v} ${k}[${j}]: ${JSON.stringify(a[j])} -> ${JSON.stringify(g[j])}`); break; }
    }
    if (diff.length) throw new Error(diff.join('; '));
    return `${VIEWS.length} views, ${n} controls`;
  });

  await check('assemble, step three times, step back once (WS-F-090)', async () => {
    await p.eval(setSource(readFileSync(join(ROOT, TRACE_PROGRAM), 'utf8')));
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.waitFor(`${pc} === '0x00000000'`);
    const seen = [];
    for (let i = 0; i < 3; i++) { await p.key('F10', { keyCode: 121 }); seen.push(await p.eval(pc)); }
    await p.key('F10', { keyCode: 121, modifiers: 8 });
    const back = await p.eval(pc);
    if (new Set(seen).size !== 3) throw new Error(`PC did not advance: ${seen}`);
    if (back !== seen[1]) throw new Error(`step back gave ${back}, expected ${seen[1]}`);
    return `PC ${seen.join(' → ')}, back to ${back}`;
  });

  await check('trace export equals the headless runner (WS-F-126, WS-F-127)', async () => {
    await p.eval(`${button('__S.exportTrace')}.click()`);
    const got = await p.waitFor(`window.__dl.find((d) => d.name === 'trace.jsonl')?.text`);
    const want = runner('--profile', 'iss', '--trace-json', '-', TRACE_PROGRAM);
    if (got !== want) throw new Error(`differs (${got.length} vs ${want.length} characters)`);
    return `${want.trim().split('\n').length} records identical`;
  });

  await check('golden dump of the pipelined view equals the headless runner (WS-F-124)', async () => {
    await p.eval(view(3));
    await p.waitFor(`${activeView} === 3 && document.querySelector('svg.dp')`);
    await p.eval(setSource(readFileSync(join(ROOT, GOLDEN_PROGRAM), 'utf8')));
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.waitFor(`${button('__S.exportGolden')} && !${button('__S.exportGolden')}.hidden`);
    await p.eval(`${button('__S.exportGolden')}.click()`);
    const got = await p.waitFor(`window.__dl.find((d) => d.name === 'golden.hex')?.text`);
    const want = runner('--profile', 'ch08', '--model', '--golden', '-', GOLDEN_PROGRAM);
    if (got !== want) throw new Error('differs');
    return `${want.trim().split('\n').length} words identical`;
  });

  await check('share link round trip: program and view (WS-F-122)', async () => {
    await p.eval(`${button('__S.share.copyLink')}.click()`);
    const link = await p.waitFor('window.__clip');
    const text = await p.eval(`document.querySelector('.p-editor textarea').value`);
    const q = await b.newPage();
    await q.goto(link);
    await q.waitFor(`${activeView} === 3 && document.querySelector('svg.dp')`);
    const got = await q.eval(`document.querySelector('.p-editor textarea').value`);
    await q.close();
    if (got !== text) throw new Error('the program differs after the round trip');
    return `${link.length} characters`;
  });
  await p.close();

  for (const [vi, vname] of [[0, 'ISA'], [3, 'pipelined']]) await check(`every tab stop of the ${vname} view shows a visible focus (WS-U-030)`, async () => {
    const k = await fresh();
    if (vi) { await k.eval(view(vi)); await k.waitFor(`${activeView} === ${vi} && document.querySelector('svg.dp')`); }
    await k.eval('document.activeElement?.blur()');
    const bad = [];
    let stops = 0;
    for (; stops < 400; stops++) {
      // the editor keeps Tab for alignment; Escape then Tab leaves it (documented under Keys; WCAG 2.1.2)
      if (await k.eval(`document.activeElement?.tagName === 'TEXTAREA'`)) await k.key('Escape', { keyCode: 27 });
      await k.key('Tab', { keyCode: 9 });
      const f = await k.eval(`(() => {
        const e = document.activeElement;
        if (!e || e === document.body) return null;
        const s = getComputedStyle(e);
        // a link of the drawing shows its focus as a dashed outline of its shape (theme.css .dp-link)
        const shape = e instanceof SVGElement ? e.querySelector('.dp-shape, :scope > circle') : null;
        const shown = (parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none') || s.boxShadow !== 'none'
          || (shape && getComputedStyle(shape).strokeDasharray !== 'none');
        const id = e.tagName.toLowerCase() + (e.getAttribute('aria-label') ? '[' + e.getAttribute('aria-label') + ']' : e.textContent.trim() ? '"' + e.textContent.trim().slice(0, 30) + '"' : '');
        return { shown, id, first: e.dataset.smokeSeen === '1' };
      })()`);
      if (!f) break;
      if (f.first) break; // back at the start
      await k.eval(`document.activeElement.dataset.smokeSeen = '1'`);
      if (!f.shown) bad.push(f.id);
    }
    await k.close();
    if (bad.length) throw new Error(`no visible focus on: ${bad.join(', ')}`);
    return `${stops} tab stops`;
  });

  await check('projector mode: every view keeps the editor, its main pane and the registers open, and every pane reachable (WS-U-012)', async () => {
    const j = await fresh({}, { 'pips.projector': '1' });
    const seen = [];
    for (let i = 0; i < VIEWS.length; i++) {
      await j.eval(view(i));
      await j.waitFor(`${activeView} === ${i} && (${i} === 0 || ${i} === 4 || document.querySelector('svg.dp'))`);
      const panes = await j.eval(`[...document.querySelectorAll('.workspace [data-pane]')].filter((n) => n.offsetParent)
        .map((n) => n.dataset.pane + (n.classList.contains('collapsed') ? '-' : ''))`);
      const main = { isa: 'listing', compare: 'compare' }[VIEWS[i]] ?? 'datapath';
      for (const want of ['editor', main, 'registers']) if (!panes.includes(want)) throw new Error(`${VIEWS[i]}: ${want} not open (${panes.join(' ')})`);
      const all = VIEWS[i] === 'isa' || VIEWS[i] === 'compare' ? ['counters', 'calls', 'dock'] : ['counters', 'console', 'info'];
      for (const p of all) if (!panes.some((x) => x.replace(/-$/, '') === p)) throw new Error(`${VIEWS[i]}: ${p} missing (${panes.join(' ')})`);
      seen.push(`${VIEWS[i]}: ${panes.join(' ')}`);
    }
    if (await j.eval('document.documentElement.scrollWidth > innerWidth')) throw new Error('horizontal scrolling');
    await j.close();
    return 'folded panes marked -';
  });

  const edition = await b.newPage();
  await edition.goto(base);
  const release = await edition.eval(`Boolean(document.querySelector('meta[name="risc-vista-edition"][content="release"]'))`);
  await edition.close();
  if (release) {
    await check('release edition: the multicycle and comparison views offer no JALR state (W-D20)', async () => {
      const r = await fresh();
      for (const i of [2, 4]) {
        await r.eval(view(i));
        await r.waitFor(`${activeView} === ${i} && !document.querySelector('.p-datapath .note, .p-compare .note')?.textContent.startsWith('Loading')`);
        if (await r.eval(`[...document.querySelectorAll('label')].some((l) => /JALR/.test(l.textContent))`)) throw new Error(`${VIEWS[i]}: a JALR switch`);
      }
      if (r.errors.length) throw new Error(r.errors.join('; '));
      await r.close();
    });
    await check('service worker: after the first visit the page reloads with the network off (WS-N-012)', async () => {
      const w = await fresh();
      await w.waitFor(`navigator.serviceWorker.ready.then((r) => Boolean(r.active))`, 30000);
      await w.waitFor(`caches.keys().then((k) => k.some((n) => n.startsWith('mavilera-riscv-')))`);
      await w.send('Network.enable');
      await w.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      w.errors.length = 0;
      await w.goto(base);
      await w.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
      for (const i of [1, 3]) {
        await w.eval(view(i));
        await w.waitFor(`${activeView} === ${i} && document.querySelector('svg.dp')`);
      }
      if (w.errors.length) throw new Error(w.errors.join('; '));
      await w.close();
      return 'single-cycle and pipelined views loaded offline';
    });
  }

  if (opt('--offline')) await check('single-file build opened from the disk: runs, every view loads, no network request (WS-N-002)', async () => {
    const o = await b.newPage();
    await o.goto(pathToFileURL(resolve(opt('--offline'))).href);
    await o.waitFor(`document.querySelector('.toolbar') && document.querySelector('.p-editor textarea')`);
    await o.eval(setSource(readFileSync(join(ROOT, TRACE_PROGRAM), 'utf8')));
    await o.key('Enter', { keyCode: 13, modifiers: 2 });
    await o.waitFor(`${pc} === '0x00000000'`);
    await o.key('F10', { keyCode: 121 });
    if (await o.eval(pc) !== '0x00000004') throw new Error('step');
    for (let i = 1; i < VIEWS.length; i++) {
      await o.eval(view(i));
      await o.waitFor(`${activeView} === ${i} && !document.querySelector('.p-datapath .note, .p-compare .note')?.textContent.startsWith('Loading')
        && (${i} === 4 || Boolean(document.querySelector('svg.dp')))`);
    }
    const net = await o.eval(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => !n.startsWith('blob:') && !n.startsWith('data:'))`);
    if (net.length) throw new Error(`requests: ${net.join(', ')}`);
    if (o.errors.length) throw new Error(o.errors.join('; '));
    await o.close();
    return `${VIEWS.length} views`;
  });

  const axe = readFileSync(AXE_PATH, 'utf8');
  const axeRun = (context) => `axe.run(${context}, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'] })
    .then((r) => r.violations.map((v) => v.id + ' (' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ') + ')'))`;

  await check('help: the dialog opens with its topics, each topic shows, and it passes the axe-core scan (W-D20, WS-U-034)', async () => {
    const h = await fresh();
    await h.eval(`document.querySelector('.header-tools [aria-label="' + __S.help.button + '"]').click(); true`);
    await h.waitFor(`document.querySelectorAll('.help-nav button').length > 0`);
    const n = await h.eval(`document.querySelectorAll('.help-nav button').length`);
    for (let i = 0; i < n; i++) {
      await h.eval(`document.querySelectorAll('.help-nav button')[${i}].click(); true`);
      if (!await h.eval(`document.querySelector('.help-body h3')?.textContent === document.querySelectorAll('.help-nav button')[${i}].textContent`)) throw new Error(`topic ${i}`);
    }
    await h.eval(axe);
    const v = await h.eval(axeRun(`{ include: [['.help-dialog']] }`));
    if (v.length) throw new Error(v.join('; '));
    if (h.errors.length) throw new Error(h.errors.join('; '));
    await h.close();
    return `${n} topics`;
  });

  await check('templates: the toolbar menu opens a pipelined template in its view with its settings, without errors', async () => {
    const t = await fresh();
    await t.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await t.waitFor(`document.querySelectorAll('.templates-menu .menu-list button').length > 20`);
    await t.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => /1-bit and 2-bit/.test(b.textContent)).click(); true`);
    await t.waitFor(`${activeView} === 3 && document.querySelector('svg.dp') && /mispredict-pattern/.test(document.querySelector('.p-editor textarea').value)`);
    if (t.errors.length) throw new Error(t.errors.join('; '));
    await t.close();
  });

  await check('M7 phase 7: a cache template sets the Memory model; the Cache tab animates the last access, and it passes the axe-core scan', async () => {
    const c = await fresh();
    await c.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await c.waitFor(`document.querySelectorAll('.templates-menu .menu-list button').length > 20`);
    await c.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => /Spatial locality/.test(b.textContent)).click(); true`);
    await c.waitFor(`/cache-spatial/.test(document.querySelector('.p-editor textarea').value)`);
    await c.key('Enter', { keyCode: 13, modifiers: 2 });
    for (let i = 0; i < 6; i++) await c.key('F10', { keyCode: 121 });
    await c.eval(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent === __S.mem.tabCache).click(); true`);
    await c.waitFor(`document.querySelector('.ca-card .ca-step.ca-on')`);
    await c.eval(`document.querySelector('.ca-card .ca-controls button:nth-child(3)').click(); true`); // Show all steps
    const steps = await c.eval(`document.querySelectorAll('.ca-card .ca-step.ca-on').length`);
    if (steps < 4) throw new Error(`${steps} steps shown`);
    await c.eval(axe);
    const v = await c.eval(axeRun(`{ include: [['.cache-view']] }`));
    if (v.length) throw new Error(v.join('; '));
    if (c.errors.length) throw new Error(c.errors.join('; '));
    await c.close();
    return `${steps} steps`;
  });

  await check('M7 devices and traps: a template of the group Devices and traps runs on the profile with traps; the Peripherals tab shows the board, a switch and the button work from mouse and keyboard, and the panel passes the axe-core scan', async () => {
    const d = await fresh();
    await d.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await d.waitFor(`document.querySelectorAll('.templates-menu .menu-list button').length > 30`);
    await d.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => /button interrupt/.test(b.textContent)).click(); true`);
    await d.waitFor(`/button-interrupt/.test(document.querySelector('.p-editor textarea').value)`);
    await d.eval(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent === __S.mem.tabPeripherals).click(); true`);
    await d.key('Enter', { keyCode: 13, modifiers: 2 });
    await d.key('F5', { keyCode: 116 });
    await d.waitFor(`/Traps taken3/.test(document.querySelector('.pf-cpudl')?.textContent ?? '')`);
    if (!await d.eval(`document.querySelector('.pf-board') && document.querySelectorAll('.pf-led').length === 8 && document.querySelectorAll('.pf-switch').length === 4`)) throw new Error('no board');
    if (await d.eval(`document.querySelectorAll('.pf-led.on').length`) !== 2) throw new Error('the three presses show as 0b11 on the LEDs');
    await d.eval(`document.querySelector('.pf-switch').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
    if (await d.eval(`document.querySelector('.pf-switch').getAttribute('aria-checked')`) !== 'true') throw new Error('the switch did not turn on');
    await d.eval(`(() => { const b = document.querySelector('.pf-button'); b.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); return true; })()`);
    if (await d.eval(`document.querySelector('.pf-button').getAttribute('aria-pressed')`) !== 'true') throw new Error('the button did not go down');
    await d.eval(`document.querySelector('.pf-button').dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); true`);
    await d.eval(axe);
    const v = await d.eval(axeRun(`{ include: [['.platform']] }`));
    if (v.length) throw new Error(v.join('; '));
    if (d.errors.length) throw new Error(d.errors.join('; '));
    await d.close();
  });

  await check('M7 devices in a processor view: with the Memory setting on, the pipelined view shows the board, a switch works, a program writes the LEDs, and the panel passes axe', async () => {
    const q = await fresh({}, { 'pips.mem.v1': JSON.stringify({ devices: true }) });
    await q.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await q.waitFor(`document.querySelectorAll('.templates-menu .menu-list button').length > 30`);
    await q.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => /Data dependences and forwarding/.test(b.textContent)).click(); true`); // a program the pipelined processor can run
    await q.waitFor(`${activeView} === 3 && document.querySelector('svg.dp') && /forwarding/.test(document.querySelector('.p-editor textarea').value)`);
    await q.eval(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent === 'Peripherals').click(); true`);
    await q.waitFor(`document.querySelector('.pf-board')`);
    await q.eval(`document.querySelector('.pf-switch').dispatchEvent(new MouseEvent('click', { bubbles: true })); true`);
    if (await q.eval(`document.querySelector('.pf-switch').getAttribute('aria-checked')`) !== 'true') throw new Error('the switch did not turn on');
    if (!await q.eval(`/no traps in this view/.test(document.querySelector('.platform').textContent) && document.querySelector('.pf-set')`)) throw new Error('settings or the note on traps missing');
    await q.eval(axe);
    const v = await q.eval(axeRun(`{ include: [['.platform']] }`));
    if (v.length) throw new Error(v.join('; '));
    if (q.errors.length) throw new Error(q.errors.join('; '));
    await q.close();
  });

  await check('lower pane of the middle column (inspector, pipeline details): up arrow folds the pane above and grows upward, the down arrow opens it again; Maximise fills the workspace and Esc restores; axe', async () => {
    const q = await fresh();
    const vis = (sel) => `(() => { const n = document.querySelector('${sel}'); return Boolean(n) && n.offsetParent !== null && n.getBoundingClientRect().height > 20; })()`;
    for (const [name, v, pane, above] of [['inspector', 0, '.p-fields', '.p-listing'], ['pipeline details', 3, '.p-info', '.p-datapath']]) {
      await q.eval(view(v));
      await q.waitFor(`document.querySelector('${pane} .pane-up') && !document.querySelector('${pane} .pane-up').hidden && ${vis(above)}`);
      const h0 = await q.eval(`document.querySelector('${pane}').getBoundingClientRect().height`);
      await q.eval(`document.querySelector('${pane} .pane-up').click(); true`);
      await q.waitFor(`!${vis(above)}`);
      const h1 = await q.eval(`document.querySelector('${pane}').getBoundingClientRect().height`);
      if (!(h1 > h0)) throw new Error(`${name}: did not grow (${h0} -> ${h1})`);
      const label = await q.eval(`document.querySelector('${pane} .pane-up').getAttribute('aria-label')`);
      await q.eval(`document.querySelector('${pane} .pane-up').click(); true`);
      await q.waitFor(vis(above));
      await q.eval(`document.querySelector('${pane} .pane-max').click(); true`);
      await q.waitFor(`document.querySelector('.workspace.mid-max') && !${vis('.p-editor')} && !${vis('.p-regs')} && ${vis(pane)}`);
      await q.eval(axe);
      const ax = await q.eval(axeRun(`{ include: [['${pane} .pane-up'], ['${pane} .pane-max'], ['${pane} .pane-toggle']] }`)); // the controls; the fields' own colours are scanned with the view states
      if (ax.length) throw new Error(`${name}: ${ax.join('; ')}`);
      await q.eval(`document.querySelector('${pane}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
      await q.waitFor(`!document.querySelector('.workspace.mid-max') && ${vis('.p-editor')}`);
      if (!label) throw new Error(`${name}: no label`);
    }
    if (q.errors.length) throw new Error(q.errors.join('; '));
    await q.close();
  });
  await check('a reload keeps the program, the step reached, breakpoints and watchpoints', async () => {
    const k = await fresh();
    await k.eval(setSource(readFileSync(join(ROOT, TRACE_PROGRAM), 'utf8')));
    await k.key('Enter', { keyCode: 13, modifiers: 2 });
    await k.waitFor(`${pc} === '0x00000000'`);
    for (let i = 0; i < 4; i++) await k.key('F10', { keyCode: 121 });
    await k.eval(`document.querySelectorAll('table.listing .bp-btn')[6].click(); (() => { const w = document.querySelectorAll('.reg-watch input')[7]; w.checked = true; w.dispatchEvent(new Event('change')); })(); true`);
    const before = await k.eval(`[${pc}, document.querySelectorAll('table.listing tr.bp').length]`);
    await new Promise((r) => setTimeout(r, 600));
    await k.goto(base);
    await k.waitFor(`document.querySelector('table.listing tbody tr') && ${pc} === ${JSON.stringify(before[0])}`);
    const after = await k.eval(`[${pc}, document.querySelectorAll('table.listing tr.bp').length, document.querySelectorAll('.reg-watch input')[7].checked]`);
    if (after[1] !== before[1] || !after[2]) throw new Error(`after the reload: ${JSON.stringify(after)}`);
    if (k.errors.length) throw new Error(k.errors.join('; '));
    await k.close();
    return `pc ${after[0]}`;
  });

  await check('M8: waveforms of the pipelined view, a cycle chosen on them; the panel passes the axe-core scan (WS-F-146)', async () => {
    const w = await fresh();
    await w.eval(setSource(readFileSync(join(ROOT, GOLDEN_PROGRAM), 'utf8')));
    await w.eval(view(3));
    await w.waitFor(`${activeView} === 3 && document.querySelector('svg.dp')`);
    for (let i = 0; i < 8; i++) await w.key('F10', { keyCode: 121 });
    await w.eval(`[...document.querySelectorAll('.tabs button')].find((b) => b.textContent === __S.wave.title).click(); true`);
    await w.waitFor(`document.querySelectorAll('.wave-svg .wave-col').length === 9`);
    await w.eval(`(() => { const s = document.querySelector('.wave-svg'); const r = s.getBoundingClientRect(); const cw = r.width / 9;
      s.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 3.5 * cw, clientY: r.top + 30 })); return true; })()`);
    await w.waitFor(`/Cycle 3 /.test(document.querySelector('.dp-status').textContent)`);
    await w.eval(axe);
    const v = await w.eval(axeRun(`{ include: [['.wave']] }`));
    if (v.length) throw new Error(v.join('; '));
    if (w.errors.length) throw new Error(w.errors.join('; '));
    await w.close();
  });

  await check('M8: an exercise file opened from the disk runs its tests on the program; the dialog passes the axe-core scan (WS-F-148)', async () => {
    const x = await fresh();
    const file = readFileSync(join(ROOT, 'test/fixtures/exercise/sum.json'), 'utf8');
    await x.eval(`(() => { const i = document.querySelector('input[type=file]'); const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(file)}], 'sum.json', { type: 'application/json' })); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()`);
    await x.waitFor(`document.querySelector('.exercise-dialog[open]')`);
    await x.eval(`document.querySelector('.exercise-dialog').close(); true`);
    await x.eval(setSource('        .data\narr:    .space 64\n        .text\nsum:    li   t0, 0\nloop:   beqz a1, done\n        lw   t1, 0(a0)\n        add  t0, t0, t1\n'
      + '        addi a0, a0, 4\n        addi a1, a1, -1\n        j    loop\ndone:   mv   a0, t0\n        ret\n'));
    await x.eval(`[...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.trim() === __S.exercise.button).click(); true`);
    await x.eval(`[...document.querySelectorAll('.exd-actions button')].find((b) => b.textContent === __S.exercise.run).click(); true`);
    await x.waitFor(`document.querySelector('.exd-summary.ok')`);
    await x.eval(axe);
    const v = await x.eval(axeRun(`{ include: [['.exercise-dialog']] }`));
    if (v.length) throw new Error(v.join('; '));
    if (x.errors.length) throw new Error(x.errors.join('; '));
    await x.close();
    return '3 of 3 tests pass';
  });

  await check('M8: an uninitialised register read is reported in the console (WS-F-147)', async () => {
    const u = await fresh();
    await u.eval(setSource('add a0, t0, t1\nli a7, 93\necall\n'));
    await u.key('Enter', { keyCode: 13, modifiers: 2 });
    await u.waitFor(`${pc} === '0x00000000'`);
    await u.key('F10', { keyCode: 121 });
    await u.waitFor(`document.querySelector('.p-console').textContent.includes(__S.uninit(''))`);
    if (u.errors.length) throw new Error(u.errors.join('; '));
    await u.close();
  });

  if (release) await check('release site: the landing page and the documentation load and pass the axe-core scan in both themes (WS-U-034)', async () => {
    const out = [];
    for (const colorScheme of ['light', 'dark']) {
      for (const page of ['../', '../docs/', '../download/', 'docs/']) { // the landing, documentation and download pages, RISC-V's guide
        const s = await b.newPage({ colorScheme });
        await s.goto(new URL(page, base).href);
        await s.eval(axe);
        const v = await s.eval(axeRun('document'));
        if (v.length) throw new Error(`${page} ${colorScheme}: ${v.join('; ')}`);
        const w = await s.eval('[document.documentElement.scrollWidth, innerWidth]');
        if (w[0] > w[1]) throw new Error(`${page}: horizontal scrolling`);
        if (s.errors.length) throw new Error(`${page}: ${s.errors.join('; ')}`);
        out.push(`${page} ${colorScheme}`);
        await s.close();
      }
    }
    return out.join(', ');
  });
  const scans = [];
  for (const scheme of ['light', 'dark']) {
    for (const projector of [false, true]) {
      const s = await fresh({ colorScheme: scheme }, projector ? { 'pips.projector': '1' } : {});
      await s.eval(axe);
      for (let i = 0; i < VIEWS.length; i++) {
        await s.eval(view(i));
        await s.waitFor(`${activeView} === ${i} && !document.querySelector('.p-datapath .note, .p-compare .note')?.textContent.startsWith('Loading')`);
        await new Promise((r) => setTimeout(r, 300));
        // the interface without the drawings (all rules), then the drawings for their roles and names, with two
        // rules off: colour contrast (they keep the book's palette; WS-U-032 through the text alternative) and
        // label-in-name (a multiplexer's input numbers 0/1 are drawn inside its link but are not its label)
        const scan = (context, rules = {}) => s.eval(`axe.run(${context}, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, rules: ${JSON.stringify(rules)}, resultTypes: ['violations'] })
          .then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
            why: [...new Set(v.nodes.map((n) => n.failureSummary.split('\\n').slice(1).join(' ').trim()))].slice(0, 4) })))`);
        scans.push({ view: VIEWS[i], scheme, projector, violations: await scan(`{ exclude: [['svg.dp'], ['svg.fsm']] }`) });
        if (await s.eval(`Boolean(document.querySelector('svg.dp, svg.fsm'))`)) {
          scans.push({ view: `${VIEWS[i]} drawing`, scheme, projector, violations: await scan(`{ include: [['svg.dp'], ['svg.fsm']] }`,
            { 'color-contrast': { enabled: false }, 'label-content-name-mismatch': { enabled: false } }) });
        }
      }
      await s.close();
    }
  }
  const failing = scans.filter((s) => s.violations.length);
  out.push({ name: `axe-core ${AXE_VERSION} scan (${AXE_TAGS.join(', ')}) of ${scans.length} view states and drawings; drawings without the contrast and label-in-name rules (WS-U-034)`,
    ok: failing.length === 0, scans: failing.length ? failing : undefined, error: failing.length ? `${failing.length} view state(s) with violations` : undefined });
  return out;
}

const { server, url: origin } = await startServer({ port: 0, ...(opt('--root') ? { root: opt('--root') } : {}) });
const url = origin + (opt('--path') ?? '');
const report = { tool: 'tools/browser-smoke.mjs', date: new Date().toISOString(), axeCore: AXE_VERSION, browsers: [] };
let failed = false;
try {
  for (const name of BROWSERS) {
    const b = await launch(name);
    if (!b) { report.browsers.push({ name, installed: false }); console.log(`${name}: not installed, skipped`); continue; }
    try {
      const results = await checks(b, url);
      report.browsers.push({ name, version: b.version, results });
      console.log(`${name} (${b.version})`);
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
