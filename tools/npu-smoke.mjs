// npu-smoke.mjs -- the NPU tab (NPU-3) in a headless Chrome or Edge: the laboratory template npu-mv on the profile
// with the devices, stepped into the NPU's run; each level of the tab drawn (subsystem, array, PE, system), with the
// controller's state, the active connections and the bus log; the array explorer's example and its four steps; an
// axe-core scan of the tab in the light and dark schemes and projector mode; no animation with reduced motion; no sideways scrolling at 360 px. Screenshots with --shots.
//
//   node tools/npu-smoke.mjs [--browser chrome|edge] [--shots dir]
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
const PREPARE = `(async () => { window.__S = (await import(new URL('ui/strings.js', document.querySelector('script[type=module][src$="main.js"]').src))).STRINGS; return true; })()`;
const axeRun = (sel) => `axe.run({ include: [[${JSON.stringify(sel)}]] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'] })
  .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`;

// the NPU tool's page (the RISC-V module with ?tool=npu: views ISA, Single-cycle with the NPU, NPU); query '' : RISC-V
async function open({ width = 1366, height = 900, scheme = 'light', storage = {}, query = '?tool=npu' } = {}) {
  const p = await b.newPage({ width, height, colorScheme: scheme, reducedMotion: 'reduce' });
  await p.goto(url);
  await p.eval(`localStorage.clear(); for (const [k, v] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(k, v); true`);
  p.errors.length = 0;
  await p.goto(`${url}${query}`);
  await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
  await p.eval(PREPARE);
  // the laboratory template: it sets the profile with the devices
  await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
  await p.waitFor(`document.querySelectorAll('.templates-menu .menu-list button').length > 30`);
  await p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((x) => /on the NPU: weights/.test(x.textContent)).click(); true`);
  await p.waitFor(`/STATUS/.test(document.querySelector('.p-editor textarea').value)`);
  await p.key('Enter', { keyCode: 13, modifiers: 2 });
  await sleep(300);
  return p;
}
// the NPU tool's NPU view (its main pane: the NPU at its four levels)
const tab = async (p) => {
  await p.eval(`(() => { const t = [...document.querySelectorAll('.ws-tab')].find((x) => /Datapath/.test(x.textContent)); t?.click(); return true; })()`);
  await p.eval(`[...document.querySelectorAll('.mode-btn')].find((x) => /NPU/.test(x.textContent)).click(); true`);
  await p.waitFor(`document.querySelector('.npu-main .npu-view')`);
};
const views = (p) => p.eval(`[...document.querySelectorAll('.mode-btn')].map((x) => x.textContent).join('|')`);
const level = (p, id) => p.eval(`[...document.querySelectorAll('.npu-levels button')].find((x) => x.textContent === __S.npu.levelNames.${id}).click(); true`);

// light, dark and projector mode (WS-U-012, light scheme); reduced motion is on in every page (open)
for (const mode of ['light', 'dark', 'projector']) {
  const scheme = mode === 'dark' ? 'dark' : 'light';
  await check(`${mode}: the NPU tab follows a run of npu-mv, each level drawn, axe-clean, nothing moves with reduced motion`, async () => {
    const p = await open({ scheme, storage: mode === 'projector' ? { 'pips.projector': '1' } : {} });
    if (mode === 'projector') must(await p.eval(`document.documentElement.hasAttribute('data-projector')`), 'projector mode is off');
    await tab(p);
    await p.waitFor(`document.querySelector('.npu-view svg.dp')`);
    for (let i = 0; i < 31; i++) await p.key('F10', { keyCode: 121 }); // into the run: LOADW at 28, RUN 0..7 at 29..36
    await sleep(200);
    const line = await p.eval(`document.querySelector('.npu-cycle').textContent`);
    must(/RUN, step \d/.test(line), `not in the run: ${line}`);
    const active = await p.eval(`document.querySelectorAll('.npu-view .dp-wire.dp-active').length`);
    must(active > 0, 'no active connection in the run');
    const busRows = await p.eval(`document.querySelectorAll('.npu-view .mem-table')[1]?.querySelectorAll('tr').length ?? 0`);
    must(busRows >= 10, `bus log ${busRows} rows`);
    // reduced motion (the page prefers it): no running animation or transition, and no flow line shown
    const moving = await p.eval(`document.getAnimations().filter((a) => a.playState === 'running').length
      + [...document.querySelectorAll('.dp-flowline')].filter((x) => getComputedStyle(x).display !== 'none').length`);
    must(moving === 0, `${moving} animations or flow lines with reduced motion`);
    await shot(p, `npu-subsystem-${mode}`);
    await p.eval(`document.querySelector('.npu-view .npu-tools input[type=checkbox]').click(); true`);
    await shot(p, `npu-subsystem-values-${mode}`);
    await p.eval(AXE);
    const found = [];
    found.push(...(await p.eval(axeRun('.npu-view'))).map((x) => `subsystem ${x}`));
    for (const id of ['array', 'pe', 'system']) {
      await level(p, id);
      await sleep(150);
      await shot(p, `npu-${id}-${mode}`);
      found.push(...(await p.eval(axeRun('.npu-view'))).map((x) => `${id} ${x}`));
      // the level's text only behind its i button: a tooltip, and a pop-up beside the button on a press
      const info = await p.eval(`(async () => {
        const body = document.querySelector('.npu-main .npu-view > div:last-child');
        const btn = document.querySelector('.npu-main .npu-head .npu-slot .info-btn'); // beside the level buttons
        if (!btn) return 'no i button';
        if ([...body.querySelectorAll('p.note')].some((n) => n.textContent.length > 120)) return 'a long note is still on the page';
        if (!btn.title) return 'no tooltip';
        btn.click();
        await new Promise((ok) => setTimeout(ok, 120));
        const pop = document.getElementById(btn.getAttribute('aria-controls'));
        const q = pop.getBoundingClientRect(), b = btn.getBoundingClientRect();
        const ok = pop.matches(':popover-open') && btn.getAttribute('aria-expanded') === 'true' && q.left >= 0 && q.right <= innerWidth && Math.abs(q.top - b.bottom) < 12;
        pop.hidePopover();
        return ok ? '' : 'the pop-up is not open beside its button';
      })()`);
      must(!info, `${id}: ${info}`);
      // the i button and (with a drawing) the zoom toolbar in the row of the level buttons, at its end
      const row = await p.eval(`(() => { const r = (x) => x?.getBoundingClientRect();
        const lv = [...document.querySelectorAll('.npu-main .npu-levels button')].map(r), last = lv[lv.length - 1];
        const mid = (b) => (b.top + b.bottom) / 2, onRow = (b) => b && mid(b) > last.top && mid(b) < last.bottom && b.left > last.right;
        const bar = r(document.querySelector('.npu-main .npu-slot .pz-bar')), i = r(document.querySelector('.npu-main .npu-slot .info-btn'));
        // on a pane too narrow for both (projector mode beside the side panes) they wrap below: allowed
        const fits = document.querySelector('.npu-main .npu-head').clientWidth >= document.querySelector('.npu-main .npu-levels').offsetWidth + document.querySelector('.npu-main .npu-slot').offsetWidth + 10;
        return [!fits || onRow(i), bar ? !fits || onRow(bar) : null, fits]; })()`);
      must(row[0], `${id}: the i button is not in the row of the level buttons`);
      must(id === 'array' ? row[1] === null : row[1], `${id}: the zoom toolbar ${row[1] === null ? 'is missing' : 'is not in the row of the level buttons'}`);
      if (mode === 'light') must(row[2], `${id}: the level's controls do not fit beside the level buttons at 1366 px`);
    }
    await level(p, 'array');
    await p.eval(`document.querySelector('.npu-view .npu-level input[type=checkbox]').click(); true`); // all steps
    await sleep(100);
    const panels = await p.eval(`document.querySelectorAll('.npu-panel').length`);
    must(panels === 4, `${panels} panels for the 2 x 2 example`);
    await shot(p, `npu-array-all-${mode}`);
    found.push(...(await p.eval(axeRun('.npu-view'))).map((x) => `array-all ${x}`));
    // the register boundaries (NPU-5): three cut lines per 2 x 2 panel, explained behind the i button, the panels' text says so
    await p.eval(`document.querySelectorAll('.npu-view .npu-level input[type=checkbox]')[1].click(); true`);
    await sleep(100);
    const bounds = await p.eval(`[document.querySelectorAll('.npu-panel .npu-bound').length, /register boundaries/i.test(document.querySelector('.npu-slot .info-btn')?.title ?? ''),
      [...document.querySelectorAll('.npu-panel')].every((x) => /Register boundaries/.test(x.getAttribute('aria-label')))]`);
    must(bounds[0] === 12 && bounds[1] && bounds[2], `register boundaries: ${bounds}`);
    await shot(p, `npu-array-bounds-${mode}`);
    found.push(...(await p.eval(axeRun('.npu-view'))).map((x) => `array-bounds ${x}`));
    must(!found.length, found.join('; '));
    must(!p.errors.length, p.errors.join('; '));
    await p.close();
    return `${line} ${active} active`;
  });
}

await check('360 px: the NPU tab has no sideways scrolling at every level', async () => {
  const p = await open({ width: 360, height: 800 });
  await p.eval(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent === __S.workspaces?.memory || /Memory/.test(x.textContent)); t?.click(); return true; })()`);
  await tab(p);
  await p.waitFor(`document.querySelector('.npu-view svg.dp')`);
  for (let i = 0; i < 31; i++) await p.key('F10', { keyCode: 121 });
  const wide = [];
  for (const id of ['subsystem', 'array', 'pe', 'system']) {
    await level(p, id);
    await sleep(150);
    const w = await p.eval('[document.documentElement.scrollWidth, innerWidth]');
    if (w[0] > w[1]) wide.push(`${id} ${w[0]} > ${w[1]}`);
    await shot(p, `npu-${id}-360`);
  }
  must(!wide.length, wide.join('; '));
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
});

await check('360 px: the subsystem regions at full width, the mini-map marks them and moves between them, axe-clean', async () => {
  const p = await open({ width: 360, height: 800 });
  await p.eval(`(() => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent === __S.workspaces?.memory || /Memory/.test(x.textContent)); t?.click(); return true; })()`);
  await tab(p);
  await p.waitFor(`document.querySelector('.npu-view svg.dp')`);
  for (let i = 0; i < 31; i++) await p.key('F10', { keyCode: 121 });
  const pick = (r) => p.eval(`(() => { const s = document.querySelector('.npu-sub select'); s.value = '${r}'; s.dispatchEvent(new Event('change')); return true; })()`);
  const vb = () => p.eval(`document.querySelector('.npu-sub svg.dp').getAttribute('viewBox')`);
  const whole = await vb();
  must(await p.eval(`document.querySelector('.npu-mm').hidden`), 'the mini-map shows with the whole drawing');
  const sizes = [];
  await p.eval(AXE);
  for (const r of ['iface', 'ctrl', 'array', 'sums']) {
    await pick(r);
    await sleep(100);
    const v = await vb();
    must(v !== whole, `${r}: the view box did not change`);
    must(!(await p.eval(`document.querySelector('.npu-mm').hidden`)), `${r}: no mini-map`);
    const w = await p.eval('[document.documentElement.scrollWidth, innerWidth]');
    must(w[0] <= w[1], `${r}: sideways scrolling ${w[0]} > ${w[1]}`);
    const text = await p.eval(`(() => { const t = document.querySelector('.npu-sub svg.dp .dp-eltext'); return t ? t.getBoundingClientRect().height : 0; })()`);
    sizes.push(`${r} ${text.toFixed(1)}px`);
    const ax = await p.eval(axeRun('.npu-view'));
    must(!ax.length, `${r}: ${ax.join('; ')}`);
    await shot(p, `npu-region-${r}-360`);
  }
  // the mini-map: a click on the array brings the array region
  await pick('iface');
  const moved = await p.eval(`(() => { const svg = document.querySelector('.npu-minimap'); const pe = svg.querySelector('.npu-mm-pe');
    const r = pe.getBoundingClientRect(); svg.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
    return document.querySelector('.npu-sub select').value; })()`);
  must(moved !== 'iface' && moved !== 'whole', `the mini-map click left ${moved}`);
  await pick('whole');
  must((await vb()) === whole, 'the whole drawing did not come back');
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
  return `${sizes.join(', ')}; mini-map to ${moved}`;
});

await check('NPU tool: views ISA, Single-cycle, NPU, Analysis (RISC-V keeps its five); the single-cycle datapath shows the NPU on the data bus, lit by an NPU store and load; the NPU view only the NPU', async () => {
  const r = await open({ query: '' });
  const plain = await views(r);
  must(plain === 'ISA|Single-cycle|Multicycle|Pipelined|Compare', `RISC-V views: ${plain}`);
  await r.close();
  const p = await open();
  const shown = await views(p);
  must(shown === 'ISA|Single-cycle|NPU|Analysis', `NPU tool views: ${shown}`);
  await tab(p);
  must(!(await p.eval(`Boolean(document.querySelector('.npu-main svg.dp:not(.npu-panel) [data-id="alu"]'))`)), 'the NPU view draws the processor');
  must(!(await p.eval(`[...document.querySelectorAll('.tabs button')].some((x) => x.textContent === __S.mem.tabNpu)`)), 'the Memory pane still has an NPU tab');
  await p.eval(`[...document.querySelectorAll('.mode-btn')].find((x) => /Single-cycle/.test(x.textContent)).click(); true`);
  await p.waitFor(`document.querySelector('svg.dp [data-id="npu"]')`);
  const activeIds = () => p.eval(`[...document.querySelectorAll('svg.dp .dp-wire.dp-active')].map((g) => g.dataset.id).join(' ')`);
  for (let i = 0; i < 5; i++) await p.key('F10', { keyCode: 121 }); // cycle 5: sw t0, WEIGHT+0(s1)
  await sleep(200);
  const store = await activeIds();
  must(/alu_npu/.test(store) && /rd2_npu/.test(store) && !/alu_dm/.test(store), `store to WEIGHT0: ${store}`);
  for (let i = 0; i < 37; i++) await p.key('F10', { keyCode: 121 }); // cycle 42: lw t1, RESULT+4(s1)
  await sleep(200);
  const load = await activeIds();
  must(/npu_dsel/.test(load) && /dsel_rm/.test(load), `load of RESULT1: ${load}`);
  await shot(p, 'npu-single-datapath');
  // the NPU block opens the NPU view: its drawings with the zoom toolbar, the note behind the i button only
  await p.eval(`(() => { const g = document.querySelector('svg.dp [data-id="npu"]'); g.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await p.waitFor(`document.querySelector('.mode-btn[aria-selected="true"]')?.textContent === 'NPU' && document.querySelector('.npu-main .npu-view svg.dp')`);
  await sleep(300);
  const bars = await p.eval(`document.querySelectorAll('.npu-main .pz-bar').length`);
  must(bars >= 1, 'no zoom toolbar on the NPU drawing');
  const h = await p.eval(`document.querySelector('.npu-main .npu-sub .pz-view').getBoundingClientRect().height`);
  must(h > 150, `the zoomable drawing is ${h}px high`);
  await p.eval(`document.querySelector('.npu-main .pz-bar button[aria-label="' + __S.panZoom.zoomIn + '"]').click(); true`);
  const zoomed = await p.eval(`document.querySelector('.npu-main .npu-sub svg.dp').style.transform`);
  must(/scale/.test(zoomed), `zoom in did nothing: '${zoomed}'`);
  const info = await p.eval(`document.querySelector('h2 .info-btn')?.title ?? ''`);
  must(/single-cycle processor with the platform devices/.test(info) && !/Chapter 6/.test(info), `info: ${info}`);
  must(!(await p.eval(`[...document.querySelectorAll('.npu-main p.note')].some((n) => /platform devices on the bus/.test(n.textContent))`)), 'the note is still in the pane');
  await shot(p, 'npu-view-zoom');
  await p.eval(AXE);
  const ax = await p.eval(axeRun('.npu-main'));
  must(!ax.length, ax.join('; '));
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
  return 'store and load paths lit';
});

await check('waveforms: with the platform devices on, the single-cycle view offers the NPU signals and draws them in the run', async () => {
  const p = await open({ query: '', storage: { 'pips.mem.v1': JSON.stringify({ devices: true }) } }); // the RISC-V module's own single-cycle view
  await p.eval(`document.querySelectorAll('.mode-btn')[1].click(); true`);
  await p.waitFor(`document.querySelectorAll('.mode-btn')[1].getAttribute('aria-selected') === 'true' && document.querySelector('svg.dp')`);
  await p.eval(`[...document.querySelectorAll('.tabs button')].find((x) => x.textContent === __S.wave.title).click(); true`);
  await p.waitFor(`document.querySelector('.wave-picker')`);
  for (let i = 0; i < 40; i++) await p.key('F10', { keyCode: 121 });
  await sleep(300);
  const legends = await p.eval(`[...document.querySelectorAll('.wave-group legend')].map((l) => l.textContent)`);
  must(legends.includes(await p.eval('__S.wave.npu')), `no NPU group: ${legends.join(', ')}`);
  for (const name of ['npu.busy', 'npu.w_load', 'npu.step', 'npu.d_addr']) {
    await p.eval(`(() => { const box = [...document.querySelectorAll('.wave-pick')].find((l) => l.textContent.trim() === '${name}').querySelector('input'); if (!box.checked) box.click(); return true; })()`);
  }
  await sleep(200);
  const labels = await p.eval(`[...document.querySelectorAll('.wave-label')].map((l) => l.textContent)`);
  for (const name of ['npu.busy', 'npu.w_load', 'npu.step', 'npu.d_addr']) must(labels.includes(name), `${name} not drawn: ${labels.join(', ')}`);
  const cells = await p.eval(`[...document.querySelectorAll('.wave table.sr-only tr')].find((tr) => tr.firstChild.textContent === 'npu.busy')?.textContent ?? ''`);
  const at = await p.eval(`document.querySelector('.wave-cycles .note').textContent + ' | ' + [...document.querySelectorAll('.wave table.sr-only tr')].map((tr) => tr.textContent).join(' / ')`);
  must(/1/.test(cells.replace('npu.busy', '')), `npu.busy never 1 in the last cycles: ${at}`);
  await shot(p, 'npu-waveform');
  await p.eval(AXE);
  const ax = await p.eval(axeRun('.wave'));
  must(!ax.length, ax.join('; '));
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
  return labels.filter((l) => l.startsWith('npu.')).join(' ');
});

await b.close();
server.close();
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? (r.d ? ` (${r.d})` : '') : `\n     ${r.e}`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
