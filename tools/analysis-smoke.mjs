// analysis-smoke.mjs -- the NPU tool's Analysis view (NPU-4) in a headless Chrome or Edge: the laboratory template
// npu-mv assembled; Offload gives WE 11.9's per-vector breakdown, Compare Table 11.5 with every MAVILERA value equal to
// the book's, Roofline the two plots with the run's point; every tab drawn and axe-clean in the light and dark schemes
// and projector mode; keyboard navigation of the tabs; no sideways scrolling at 360 px. Screenshots with --shots.
//
//   node tools/analysis-smoke.mjs [--browser chrome|edge] [--shots dir]
//
// Exit status 1 if any check fails. Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSER = opt('--browser') ?? 'chrome';
const SHOTS = opt('--shots');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const TABS = ['offload', 'compare', 'roofline', 'amdahl', 'layer', 'accumulator', 'quant'];

const { server, url } = await startServer({ port: 0 });
const b = await launch(BROWSER);
if (!b) { console.log(`${BROWSER}: not installed`); process.exit(1); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = async (name, f) => {
  try { results.push({ name, ok: true, d: await f() }); } catch (e) { results.push({ name, ok: false, e: String(e.message ?? e) }); }
};
const must = (c, m) => { if (!c) throw new Error(m); };
const shot = async (p, name) => { if (SHOTS) writeFileSync(join(SHOTS, `${name}.png`), await p.screenshot()); };
const axeRun = (sel) => `axe.run({ include: [[${JSON.stringify(sel)}]] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'] })
  .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`;

async function open({ width = 1366, height = 900, scheme = 'light', storage = {} } = {}) {
  const p = await b.newPage({ width, height, colorScheme: scheme, reducedMotion: 'reduce' });
  await p.goto(url);
  await p.eval(`localStorage.clear(); for (const [k, v] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(k, v); true`);
  p.errors.length = 0;
  await p.goto(`${url}?tool=npu`);
  await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
  await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
  await p.waitFor(`document.querySelectorAll('.templates-menu .menu-list button').length > 30`);
  await p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((x) => /on the NPU: weights/.test(x.textContent)).click(); true`);
  await p.waitFor(`/STATUS/.test(document.querySelector('.p-editor textarea').value)`);
  await p.key('Enter', { keyCode: 13, modifiers: 2 });
  await sleep(300);
  await p.eval(`(() => { const t = [...document.querySelectorAll('.ws-tab')].find((x) => /Datapath|Compar/.test(x.textContent)); t?.click(); return true; })()`);
  await p.eval(`[...document.querySelectorAll('.mode-btn')].find((x) => /Analysis/.test(x.textContent)).click(); true`);
  await p.waitFor(`document.querySelector('.an-view .an-box:not([hidden]) table')`);
  return p;
}
const tab = async (p, id) => { await p.eval(`document.getElementById('an-tab-${id}').click(); true`); await sleep(120); };
const cells = (p, sel) => p.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((x) => x.textContent.trim())`);

for (const mode of ['light', 'dark', 'projector']) {
  const scheme = mode === 'dark' ? 'dark' : 'light';
  await check(`${mode}: every Analysis tab drawn and axe-clean, no book named; Offload, Compare and Roofline give the laboratory's numbers`, async () => {
    const p = await open({ scheme, storage: mode === 'projector' ? { 'pips.projector': '1' } : {} });
    await p.eval(AXE);
    const found = [];
    // Offload: the per-vector column (v4, the template's own data)
    const head = await cells(p, '#an-box-offload table:first-of-type thead th');
    const per = head.indexOf('Per vector');
    must(per > 0, `no per-vector column: ${head.join('|')}`);
    const col = await p.eval(`[...document.querySelectorAll('#an-box-offload table:first-of-type tbody tr')].map((r) => r.children[${per}].textContent)`);
    must(col.join(',') === '0,9,12,8,0,5,34', `per vector ${col.join(',')}`);
    for (const id of TABS) {
      await tab(p, id);
      await shot(p, `analysis-${id}-${mode}`);
      found.push(...(await p.eval(axeRun('.an-view'))).map((x) => `${id} ${x}`));
      if (id === 'compare') {
        const rows = await p.eval(`[...document.querySelectorAll('#an-box-compare tbody tr')].map((r) => [...r.children].slice(1).map((c) => c.textContent).join(','))`);
        const want = ['821,3718,15 646,994', '209,818,3254,203', '51,153,561,34', '16.1,24.3,27.9,', '4.1,5.3,5.8,', '51,153,561,34'];
        must(JSON.stringify(rows) === JSON.stringify(want), `compare: ${rows.join(' | ')}`);
      }
      if (id === 'roofline') {
        const plots = await p.eval(`document.querySelectorAll('#an-box-roofline svg.an-plot').length`);
        must(plots === 2, `${plots} roofline plots`);
        must(await p.eval(`document.querySelectorAll('#an-box-roofline .an-mark').length === 1`), 'no measured point');
      }
      if (id === 'amdahl') {
        const t = await cells(p, '#an-box-amdahl tbody tr td');
        must(t.slice(0, 2).join(',') === '3.48,0.87', `amdahl at 4 lanes: ${t.slice(0, 2)}`);
      }
    }
    // the tool names no book or chapter (author, 2026-11-04): every tab, its i pop-ups and the heading
    const named = await p.eval(`(() => { const t = document.querySelector('.p-compare').textContent + [...document.querySelectorAll('.an-view .info-btn')].map((b) => b.title).join(' ');
      return (t.match(/chapter|book|textbook|table \\d|figure \\d|fig-\\d|worked example|we \\d/gi) ?? []).join(', '); })()`);
    must(!named, `book references: ${named}`);
    // the explanations stand behind i buttons: no long note in the view
    const long = await p.eval(`[...document.querySelectorAll('.an-view p.note')].filter((n) => n.offsetParent && n.textContent.length > 160).length`);
    must(!long, `${long} long notes in the view`);
    // the tabs by keyboard: ArrowLeft from Offload goes to the last
    await tab(p, 'offload');
    await p.eval(`document.getElementById('an-tab-offload').focus(); true`);
    await p.key('ArrowLeft', { keyCode: 37 });
    must(await p.eval(`document.activeElement.id === 'an-tab-quant' && !document.getElementById('an-box-quant').hidden`), 'arrow keys do not move between the tabs');
    must(!found.length, found.join('; '));
    must(!p.errors.length, p.errors.join('; '));
    await p.close();
    return 'ok';
  });
}

await check('360 px: no sideways scrolling of the page on any tab', async () => {
  const p = await open({ width: 360, height: 780 });
  const wide = [];
  for (const id of TABS) {
    await tab(p, id);
    if (await p.eval(`document.documentElement.scrollWidth > innerWidth + 1`)) wide.push(id);
    await shot(p, `analysis-${id}-360`);
  }
  must(!wide.length, `scrolls sideways: ${wide.join(', ')}`);
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
});

await b.close();
server.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : `: ${r.e}`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
