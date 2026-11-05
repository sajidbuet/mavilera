// models-smoke.mjs -- the GPU module's Models view (GPU-4) in a headless Chrome or Edge: every tab drawn and axe-clean
// in the light and dark schemes and projector mode, with the worked numbers of the chapter's models as the defaults
// give them (eight, two, one and one instructions; strips 8, 8, 3; one tail warp 1000; no idle cycle with four warps;
// two transactions; one cycle at stride 1); no book named; keyboard navigation of the tabs; a changed input redraws;
// no sideways scrolling at 360 px. Screenshots with --shots.
//
//   node tools/models-smoke.mjs [--browser chrome|edge] [--shots dir]
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
const TABS = ['machines', 'amdahl', 'strips', 'index', 'hierarchy', 'latency', 'coalesce', 'banks'];

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
  await p.goto(`${url}?arch=gpu`);
  await p.waitFor(`document.querySelector('.toolbar') && [...document.querySelectorAll('.mode-btn')].some((x) => /Models/.test(x.textContent))`);
  await p.eval(`[...document.querySelectorAll('.mode-btn')].find((x) => /Models/.test(x.textContent)).click(); true`);
  await p.waitFor(`document.querySelector('.gm-view .an-box:not([hidden]) table')`);
  return p;
}
const tab = async (p, id) => { await p.eval(`document.getElementById('gm-tab-${id}').click(); true`); await sleep(120); };
const cells = (p, sel) => p.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((x) => x.textContent.trim())`);
const box = (id) => `#gm-box-${id}`;

/** The numbers each tab shows with its default inputs. */
const EXPECT = {
  machines: async (p) => { const v = await cells(p, `${box('machines')} tbody tr td:last-child`); must(v.join() === '8,2,1,1', `instructions ${v}`); },
  amdahl: async (p) => { const t = await cells(p, `${box('amdahl')} tbody tr td`); must(t.slice(0, 2).join() === '3.48,0.87', `amdahl at 4 lanes ${t.slice(0, 2)}`); },
  strips: async (p) => { const v = await p.eval(`[...document.querySelectorAll('${box('strips')} tbody tr')].map((r) => r.children[3].textContent).join()`); must(v === '8,8,3', `vl ${v}`); },
  index: async (p) => {
    const m = await cells(p, `${box('index')} table:nth-of-type(2) tbody td`);
    must(m.includes('1000'), `tail mask ${m}`);
    must(await p.eval(`document.querySelectorAll('${box('index')} .gm-cell.gm-idle').length === 3`), 'three idle threads not shaded');
  },
  hierarchy: async (p) => { const v = await cells(p, `${box('hierarchy')} table:first-of-type tbody td`); must(v[0] === '0 (1), 3 (2)', `SM 0 ${v[0]}`); },
  latency: async (p) => {
    const v = await cells(p, `${box('latency')} table:first-of-type tbody td`);
    must(v.slice(0, 3).join() === '3.67 → 4,24,0', `schedule ${v}`);
    const loads = await p.eval(`[...document.querySelectorAll('${box('latency')} .gm-timeline tbody tr')].slice(0, 4).map((r) => [...r.children].slice(1).map((c, i) => c.textContent === 'L' ? i : -1).filter((i) => i >= 0).join(' ')).join('|')`);
    must(loads === '2 14|5 17|8 20|11 23', `loads ${loads}`);
  },
  coalesce: async (p) => { const v = await cells(p, `${box('coalesce')} table:first-of-type tbody td`); must(v.join() === '2,128,128,100.0 %', `coalesce ${v}`); },
  banks: async (p) => { const c = await p.eval(`document.querySelector('${box('banks')} caption').textContent`); must(/1 cycle\b/.test(c), c); },
};

for (const mode of ['light', 'dark', 'projector']) {
  const scheme = mode === 'dark' ? 'dark' : 'light';
  await check(`${mode}: every Models tab drawn and axe-clean with the chapter's numbers, no book named`, async () => {
    const p = await open({ scheme, storage: mode === 'projector' ? { 'pips.projector': '1' } : {} });
    await p.eval(AXE);
    const found = [];
    for (const id of TABS) {
      await tab(p, id);
      await shot(p, `models-${id}-${mode}`);
      found.push(...(await p.eval(axeRun('.gm-view'))).map((x) => `${id} ${x}`));
      await EXPECT[id](p);
    }
    const named = await p.eval(`(() => { const t = document.querySelector('.p-compare').textContent + [...document.querySelectorAll('.gm-view .info-btn')].map((b) => b.title).join(' ');
      return (t.match(/chapter|book|textbook|table \\d|figure \\d|fig-\\d|worked example|we \\d|vortex|nvidia/gi) ?? []).join(', '); })()`);
    must(!named, `book references: ${named}`);
    const long = await p.eval(`[...document.querySelectorAll('.gm-view p.note')].filter((n) => n.offsetParent && n.textContent.length > 240).length`);
    must(!long, `${long} long notes in the view`);
    await tab(p, 'machines');
    await p.eval(`document.getElementById('gm-tab-machines').focus(); true`);
    await p.key('ArrowLeft', { keyCode: 37 });
    must(await p.eval(`document.activeElement.id === 'gm-tab-banks' && !document.getElementById('gm-box-banks').hidden`), 'arrow keys do not move between the tabs');
    must(!found.length, found.join('; '));
    must(!p.errors.length, p.errors.join('; '));
    await p.close();
    return 'ok';
  });
}

await check('an input redraws: three warps leave two idle cycles; stride 8 on 8 banks takes 8 cycles', async () => {
  const p = await open();
  const set = async (id, n, v) => p.eval(`(() => { const i = document.querySelectorAll('${box(id)} input')[${n}]; i.value = '${v}'; i.dispatchEvent(new Event('input')); return true; })()`);
  await tab(p, 'latency');
  await set('latency', 0, 3);
  const v = await cells(p, `${box('latency')} table:first-of-type tbody td`);
  must(v[2] === '2', `idle ${v}`);
  await tab(p, 'banks');
  await set('banks', 2, 8);
  const c = await p.eval(`document.querySelector('${box('banks')} caption').textContent`);
  must(/8 cycles/.test(c), c);
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
});

await check('360 px: no sideways scrolling of the page on any tab', async () => {
  const p = await open({ width: 360, height: 780 });
  const wide = [];
  for (const id of TABS) {
    await tab(p, id);
    if (await p.eval(`document.documentElement.scrollWidth > innerWidth + 1`)) wide.push(id);
    await shot(p, `models-${id}-360`);
  }
  must(!wide.length, `scrolls sideways: ${wide.join(', ')}`);
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
});

await b.close();
server.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : `: ${r.e}`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
