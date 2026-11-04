// view-mode-smoke.mjs -- the workspace's presentations (src/ui/view-mode.js): Normal view, Datapath focus and Full
// screen, in a headless Chrome or Edge. Every transition (also a refused full screen, one the browser leaves, rapid
// changes); the compact layout in every view of Armv7, RISC-V and SAP-1 (one header row, a column of controls, the
// main pane alone with its stage strip and zoom bar, nothing outside the window); the simulation, the program, the
// breakpoints, the panes' sizes and folds, the maximised panes, the dock choice and the zoom kept or restored; explicit
// changes made in focus kept; the keys (F, Esc, not while typing or with a menu open); the narrow screen; axe-core;
// the drawing's area in each mode at each size. Screenshots with --shots dir.
//
//   node tools/view-mode-smoke.mjs [--browser chrome|edge] [--shots dir]
//
// Headless Chrome grants full screen without a display change (the window keeps its size): the checks see the
// browser's full-screen state and the layout, not a physical display. Exit status 1 if any check fails.
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']; // as tools/browser-smoke.mjs
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSER = opt('--browser') ?? 'chrome';
const SHOTS = opt('--shots');
const SIZES = [[1920, 1080], [1650, 928], [1366, 768], [1280, 720], [768, 1024, true], [390, 844, true]];
const A7 = { id: 'armv7', path: '?arch=armv7', key: 'pips.armv7.view',
  source: 'main:   SUB R0, R0, R0\n        ADD R1, R0, #5\n        ADD R2, R1, #7\n        ADD R3, R1, R2\n        STR R3, [R0, #64]\n        LDR R4, [R0, #64]\nloop:   B loop\n' };
const RV = { id: 'riscv', path: '', key: 'pips.view',
  source: 'addi t0, zero, 5\naddi t1, t0, 7\nadd t2, t0, t1\nsw t2, 64(zero)\nlw t3, 64(zero)\nloop: j loop\n' };
const S1 = { id: 'sap-1', path: '?arch=sap-1', key: 'pips.sap-1.view', source: null };
// the views of each architecture to check in the compact layout (main: the pane that stays)
const VIEWS = [[A7, 'single', 'datapath'], [A7, 'multi', 'datapath'], [A7, 'pipe', 'datapath'], [A7, 'isa', 'listing'],
  [RV, 'single', 'datapath'], [RV, 'multi', 'datapath'], [RV, 'pipe', 'datapath'], [RV, 'isa', 'listing'], [RV, 'compare', 'compare'], [S1, null, null]];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const must = (c, msg) => { if (!c) throw new Error(msg); };

// --- in the page ---------------------------------------------------------------------------------------------------
const modeNow = `document.documentElement.dataset.viewMode`;
/** Choose a mode in View ▸ Workspace (a click: the user's gesture full screen needs). */
const choose = (m) => `(async () => { const d = document.querySelector('[data-cmd="layout"]'); if (!d.open) d.querySelector('summary').click();
  await new Promise((ok) => setTimeout(ok, 60)); d.querySelector('input[name="view-mode"][value="${m}"]').click(); await new Promise((ok) => setTimeout(ok, 60));
  if (d.open) d.querySelector('summary').click(); return true; })()`;
const cmd = (c) => `(() => { const n = document.querySelector('[data-cmd="${c}"]'); (n.tagName === 'DETAILS' ? n.querySelector('summary') : n).click(); return true; })()`;
const setSource = (text) => `(() => { const a = document.querySelector('.ed-input'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
// the compact layout as shown
const LAYOUT = `(() => {
  const R = (e) => e.getBoundingClientRect();
  const hd = document.querySelector('.app-header'), tb = document.querySelector('.toolbar'), ws = document.querySelector('.workspace');
  const leaves = [...ws.querySelectorAll('[data-pane]')].filter((n) => !n.querySelector('[data-pane]') && n.checkVisibility()).map((n) => n.dataset.pane);
  const pz = [...document.querySelectorAll('.pz-view')].find((v) => v.checkVisibility());
  const pzr = pz && R(pz);
  const bar = pz?.querySelector('.pz-bar');
  const strip = [...document.querySelectorAll('.pp-strip')].find((s) => s.checkVisibility()) ?? null;
  const hk = [...hd.children].filter((c) => c.checkVisibility()).map((c) => R(c));
  const exit = document.querySelector('[data-cmd="viewExit"]');
  return { mode: document.documentElement.dataset.viewMode, fs: Boolean(document.fullscreenElement), header: R(hd).height, oneLine: hk.every((b) => b.top < Math.min(...hk.map((x) => x.bottom))),
    headerInside: hk.every((b) => b.right <= innerWidth + 0.5 && b.left >= -0.5), dock: document.getElementById('app').dataset.dock ?? 'top',
    toolbarH: R(tb).height, leaves, pz: pzr ? [Math.round(pzr.width), Math.round(pzr.height)] : null, bar: bar ? bar.checkVisibility() : null,
    strip: strip ? R(strip).height > 0 : null, exit: exit.checkVisibility() ? exit.getAttribute('aria-label') : null,
    views: document.querySelector('.mode-nav').checkVisibility(), scroll: document.documentElement.scrollWidth, inner: innerWidth };
})()`;
// what a change of mode must leave as it was
const STATE = `(() => ({
  // (textContent: a hidden panel has no rendered text to compare)
  regs: document.querySelector('.p-regs')?.textContent, counters: document.querySelector('.p-counters')?.textContent, memory: document.querySelector('.p-memory')?.textContent,
  head: document.querySelector('.p-datapath h2.with-status')?.textContent ?? null, pc: document.querySelector('table.listing tr.pc')?.textContent ?? null,
  strip: document.querySelector('.pp-strip')?.textContent ?? null, src: document.querySelector('.ed-input')?.value,
  breaks: [...document.querySelectorAll('.ed-num-bp')].map((n) => n.dataset.n).join(),
  speed: document.querySelector('[data-cmd="speed"]').value, profile: document.querySelector('[data-cmd="profile"]').value,
  // (the zoom level is not here: a fitted drawing is fitted again to the larger area, by design; check 8 covers zoom)
  sameSvg: window.__svg ? window.__svg === document.querySelector('svg.pz-svg') : null }))()`;
// the panes' sizes and folds, and the layouts the splits keep in storage
const PANES = `(() => JSON.stringify({ panes: [...document.querySelectorAll('[data-pane]')].map((n) => [n.dataset.pane, n.style.flex, n.classList.contains('collapsed')]),
  keys: Object.keys(localStorage).filter((k) => k.includes('layout')).sort().map((k) => [k, localStorage.getItem(k)]),
  max: ['zoomed', 'dock-max', 'mid-max'].filter((c) => document.querySelector('.workspace').classList.contains(c)) }))()`;
const DRAWN = `(() => {
  const s = [...document.querySelectorAll('svg.pz-svg')].find((x) => x.checkVisibility());
  const m = new DOMMatrix(getComputedStyle(s).transform);
  const pane = { w: s.clientWidth || s.parentElement.clientWidth, h: s.getBoundingClientRect().height / (m.a || 1) };
  const vb = s.viewBox.baseVal; const f = Math.min(pane.w / vb.width, pane.h / vb.height);
  const dh = vb.height * f, dy = (pane.h - dh) / 2;
  return { paneH: pane.h, top: m.f + m.a * dy, bottom: m.f + m.a * (dy + dh), level: s.parentElement.querySelector('.pz-level').textContent };
})()`;
const pzBtn = (label) => `[...[...document.querySelectorAll('.pz-view')].find((v) => v.checkVisibility()).querySelectorAll('.pz-btn')].find((b) => b.getAttribute('aria-label').startsWith(${JSON.stringify(label)})).click(), true`;

const { server, url } = await startServer({ port: 0 });
const b = await launch(BROWSER);
if (!b) { console.log(`${BROWSER}: not installed`); process.exit(1); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = async (name, f) => {
  try { const d = await f(); results.push({ name, ok: true, d }); } catch (e) { results.push({ name, ok: false, e: String(e.message ?? e) }); }
};
const shot = async (p, name) => { if (SHOTS) writeFileSync(join(SHOTS, `${name}.png`), await p.screenshot('png')); };

async function open(A, view, [w, h, touch = false] = [1366, 768], { dock = null, scheme = 'light' } = {}) {
  const p = await b.newPage({ width: w, height: h, colorScheme: scheme, reducedMotion: 'reduce' });
  if (touch) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await p.goto(url + A.path);
  await p.eval(`localStorage.clear(); ${view ? `localStorage.setItem('${A.key}', '${view}');` : ''} ${dock ? `localStorage.setItem('pips.toolbarDock', '${dock}');` : ''} true`);
  p.errors.length = 0;
  await p.goto(url + A.path);
  await p.waitFor(`document.querySelector('.toolbar') && document.documentElement.dataset.viewMode`);
  await sleep(600);
  return p;
}
async function to(p, m) { await p.eval(choose(m)); await sleep(350); }
async function assemble(p, A) {
  if (!A.source) return;
  await p.eval(setSource(A.source));
  await p.eval(cmd('assemble'));
  await sleep(400);
}

try {
  // 1. every view: Normal -> Focus -> Full screen -> Exit (Focus) -> Normal, the compact layout each time
  for (const [A, view, main] of VIEWS) {
    await check(`${A.id} ${view ?? 'default view'}: Normal, Focus, Full screen, Exit to Focus, Normal; the compact layout`, async () => {
      const p = await open(A, view);
      const n = await p.eval(LAYOUT);
      must(n.mode === 'normal' && n.views && n.exit === null, `not Normal at first: ${JSON.stringify(n)}`);
      const out = [];
      for (const [step, want] of [['focus', 'focus'], ['fullscreen', 'fullscreen'], ['exit', 'focus'], ['normal', 'normal']]) {
        if (step === 'exit') { await p.eval(cmd('viewExit')); await sleep(350); } else await to(p, step);
        const l = await p.eval(LAYOUT);
        must(l.mode === want, `${step}: shows ${l.mode}`);
        must(l.fs === (want === 'fullscreen'), `${step}: full screen ${l.fs}`);
        must(l.scroll <= l.inner, `${step}: page ${l.scroll} px wide`);
        must(l.oneLine && l.headerInside, `${step}: the header wraps or leaves the window`);
        if (want === 'normal') { must(l.views && l.exit === null && l.dock === 'top', `${step}: not the normal layout`); continue; }
        must(l.header <= 40.5, `${step}: header ${l.header} px`);
        must(!l.views, `${step}: the view tabs show`);
        must(l.exit === (want === 'fullscreen' ? 'Exit full screen' : 'Exit focus'), `${step}: exit ${l.exit}`);
        must(l.dock === 'left', `${step}: controls ${l.dock}`);
        if (main) must(l.leaves.length === 1 && l.leaves[0] === main, `${step}: panes ${l.leaves}`);
        else must(l.leaves.length >= 1, `${step}: no pane`);
        if (l.pz) must(l.bar, `${step}: the zoom bar is hidden`);
        if (view === 'pipe') must(l.strip, `${step}: the stage strip is hidden`);
        out.push(`${want} ${l.pz ? l.pz.join('x') : l.leaves}`);
      }
      const errs = p.errors.slice();
      await p.close();
      must(!errs.length, errs.join('; '));
      return out.slice(0, 2).join(', ');
    });
  }

  // 2. the drawing's area in each mode at each size (Armv7 and RISC-V pipelines)
  const areas = [];
  for (const A of [A7, RV]) {
    for (const size of SIZES) {
      await check(`${A.id} pipe ${size[0]}x${size[1]}: the drawing's area in Normal (top, left), Focus, Full screen`, async () => {
        const p = await open(A, 'pipe', size);
        await assemble(p, A);
        const m = {};
        if (size[2]) { await p.eval(`document.querySelector('[data-ws="datapath"]').click(), true`); await sleep(300); } // a narrow screen: its Datapath workspace
        m.top = (await p.eval(LAYOUT)).pz;
        if (A === A7 && size[0] === 1366) await shot(p, `1-normal-top-${A.id}-1366x768`);
        if (!size[2]) {
          await p.eval(`(() => { const r = document.querySelector('input[name="tb-dock"][value="left"]'); r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
          await sleep(300);
          m.left = (await p.eval(LAYOUT)).pz;
          if (A === A7 && size[0] === 1366) await shot(p, `2-normal-left-${A.id}-1366x768`);
          await p.eval(`(() => { const r = document.querySelector('input[name="tb-dock"][value="top"]'); r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
          await sleep(300);
        }
        await to(p, 'focus');
        const f = await p.eval(LAYOUT);
        must(f.scroll <= f.inner && f.oneLine && f.headerInside, `focus: ${JSON.stringify(f)}`);
        m.focus = f.pz;
        if (size[0] === 1366 || size[0] === 390) await shot(p, `${size[0] === 390 ? '6-mobile-focus' : '3-focus'}-${A.id}-${size[0]}x${size[1]}`);
        await to(p, 'fullscreen');
        m.full = (await p.eval(LAYOUT)).pz;
        if (size[0] === 1366) await shot(p, `4-fullscreen-${A.id}-1366x768`);
        await p.eval(cmd('viewExit'));
        await sleep(300);
        await to(p, 'normal');
        must(JSON.stringify((await p.eval(LAYOUT)).pz) === JSON.stringify(m.top), `restored: ${(await p.eval(LAYOUT)).pz} vs ${m.top}`);
        if (A === A7 && size[0] === 1366) await shot(p, `5-normal-restored-${A.id}-1366x768`);
        await p.close();
        areas.push({ arch: A.id, size: size.slice(0, 2).join('x'), ...m });
        const a = (x) => (x ? x[0] * x[1] : 0);
        return Object.entries(m).map(([k, v]) => `${k} ${v?.join('x')}`).join(', ') + ` (focus ${(a(m.focus) / a(m.top)).toFixed(2)}x the area)`;
      });
    }
  }

  // 3. the simulation, the program, the breakpoints and the drawing node through every transition
  for (const A of [A7, RV]) {
    await check(`${A.id} pipe: the state, the breakpoints, the settings and the drawing are kept through every transition`, async () => {
      const p = await open(A, 'pipe');
      await assemble(p, A);
      await p.eval(`document.querySelector('.ed-num[data-n="3"]').click(), true`); // a breakpoint
      for (let i = 0; i < 5; i++) { await p.eval(cmd('step')); await sleep(60); }
      await p.eval(`window.__svg = document.querySelector('svg.pz-svg'); true`);
      const before = await p.eval(STATE);
      must(before.breaks === '3', `breakpoint ${before.breaks}`);
      for (const m of ['focus', 'fullscreen', 'normal', 'fullscreen', 'focus', 'normal']) {
        await to(p, m);
        const now = await p.eval(STATE);
        for (const k of Object.keys(before)) if (k !== 'sameSvg') must(now[k] === before[k], `${m}: ${k} changed`);
        must(now.sameSvg, `${m}: the drawing was rebuilt`);
      }
      // stepping and running work in focus, from the column
      await to(p, 'focus');
      const c0 = await p.eval(`document.querySelector('.pp-strip').innerText`);
      await p.eval(cmd('step'));
      await sleep(100);
      must((await p.eval(`document.querySelector('.pp-strip').innerText`)) !== c0, 'Step in focus did not move the pipeline');
      const errs = p.errors.slice();
      await p.close();
      must(!errs.length, errs.join('; '));
    });
  }

  // 4. the layout comes back: sizes, folds, the maximised memory, Enlarge; an explicit change made in focus is kept
  await check('armv7 pipe: the panes\' sizes and folds, the saved layouts, Maximise and Enlarge come back after Focus and Full screen', async () => {
    const p = await open(A7, 'pipe');
    await assemble(p, A7);
    // a layout of the user's own: memory open, details folded, a divider moved
    await p.eval(`document.querySelector('.dock-bar').click(), true`);
    await p.eval(`document.querySelector('[data-pane="info"] .pane-toggle')?.click(), true`);
    await p.eval(`(() => { const d = document.querySelector('[data-split="work"] > .split-divider'); d.focus(); return true; })()`);
    await p.key('ArrowRight', { code: 'ArrowRight', keyCode: 39 });
    await sleep(200);
    const l0 = await p.eval(PANES);
    for (const m of ['focus', 'normal', 'fullscreen', 'normal']) { await to(p, m); if (m === 'normal') must((await p.eval(PANES)) === l0, `after ${m}: the layout changed`); }
    // Memory maximised before focus: back after
    await p.eval(`document.querySelector('.p-memory .pane-max').click(), true`);
    await sleep(100);
    const l1 = await p.eval(PANES);
    must(l1.includes('dock-max'), 'not maximised');
    await to(p, 'focus');
    must(!(await p.eval(PANES)).includes('dock-max'), 'maximised memory over the focus');
    await to(p, 'normal');
    must((await p.eval(PANES)) === l1, 'Maximise not restored');
    await p.eval(`document.querySelector('.p-memory .pane-max').click(), true`);
    // Enlarge before focus: back after
    await p.eval(`document.querySelector('.zoom-btn').click(), true`);
    await to(p, 'focus');
    await to(p, 'normal');
    must((await p.eval(PANES)).includes('zoomed'), 'Enlarge not restored');
    await p.eval(`document.querySelector('.zoom-btn').click(), true`);
    // an explicit change in focus (View ▸ Show: Counters off) is kept, not overwritten by what was before
    await to(p, 'focus');
    await p.eval(`(async () => { const d = document.querySelector('[data-cmd="layout"]'); d.querySelector('summary').click(); await new Promise((ok) => setTimeout(ok, 60));
      const c = [...d.querySelectorAll('label.menu-check')].find((l) => l.textContent.trim() === 'Counters').querySelector('input'); c.click(); d.querySelector('summary').click(); return true; })()`);
    await sleep(100);
    await to(p, 'normal');
    must(await p.eval(`document.querySelector('[data-pane="counters"]').classList.contains('collapsed')`), 'the change made in focus was undone');
    await p.close();
  });

  // 5. the dock: Top shows as a column in focus and comes back; Left and Right as chosen; changes made in focus
  await check('the dock: a chosen Top is a left column in focus and Top after it (the choice kept); Right stays Right; Right chosen in focus is kept; Top chosen in focus returns to Normal', async () => {
    const p = await open(A7, 'pipe');
    const dockNow = `document.getElementById('app').dataset.dock ?? 'top'`;
    const saved = `localStorage.getItem('pips.toolbarDock')`;
    const pick = (v) => p.eval(`(() => { const r = document.querySelector('input[name="tb-dock"][value="${v}"]'); r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`);
    await to(p, 'focus');
    must((await p.eval(dockNow)) === 'left' && (await p.eval(saved)) === null, 'Top in focus');
    await to(p, 'fullscreen');
    must((await p.eval(dockNow)) === 'left', 'Top in full screen');
    await to(p, 'normal');
    must((await p.eval(dockNow)) === 'top' && (await p.eval(saved)) === null, 'Top not restored');
    await pick('right');
    await to(p, 'focus');
    must((await p.eval(dockNow)) === 'right', 'Right in focus');
    await to(p, 'normal');
    must((await p.eval(dockNow)) === 'right', 'Right after');
    await pick('top');
    await to(p, 'focus');
    await pick('right'); // explicit, in focus
    await to(p, 'normal');
    must((await p.eval(dockNow)) === 'right' && (await p.eval(saved)) === 'right', 'Right chosen in focus not kept');
    await to(p, 'focus');
    await pick('top'); // explicit Top in focus: the normal view, with the row
    await sleep(300);
    must((await p.eval(modeNow)) === 'normal' && (await p.eval(dockNow)) === 'top' && (await p.eval(saved)) === 'top', 'Top in focus did not return to Normal with the row');
    await p.close();
  });

  // 6. full screen refused, left by the browser, rapid changes
  await check('full screen refused: the mode stays, a message tells it, the menu does not claim full screen', async () => {
    const p = await open(A7, 'pipe');
    await to(p, 'focus');
    await p.eval(`Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')); }; true`);
    const msgs = await p.eval(`document.querySelectorAll('.p-console .msg-text').length`);
    await p.eval(`(async () => { const d = document.querySelector('[data-cmd="layout"]'); d.querySelector('summary').click(); await new Promise((ok) => setTimeout(ok, 60));
      d.querySelector('input[name="view-mode"][value="fullscreen"]').click(); return true; })()`);
    await sleep(300);
    must((await p.eval(modeNow)) === 'focus', `shows ${await p.eval(modeNow)}`);
    must(!(await p.eval(`document.querySelector('[data-cmd="layout"]').open`)), 'the View menu stays open over the drawing');
    must(await p.eval(`document.activeElement === document.querySelector('[data-cmd="layout"] summary')`), 'the focus did not return to View');
    await p.eval(`document.querySelector('[data-cmd="layout"] summary').click(), true`); // opened again: it tells the mode shown
    await sleep(100);
    must(await p.eval(`document.querySelector('input[name="view-mode"][value="focus"]').checked`), 'the menu shows Full screen chosen');
    must((await p.eval(`document.querySelectorAll('.p-console .msg-text').length`)) > msgs, 'no message');
    must((await p.eval(`[...document.querySelectorAll('.p-console .msg-text')].pop().textContent`)).includes('refused'), 'not the refusal message');
    await p.close();
  });
  await check('full screen left by the browser (Esc, its controls): the page returns to the mode before it', async () => {
    const p = await open(A7, 'pipe');
    for (const base of ['normal', 'focus']) {
      await to(p, base);
      await to(p, 'fullscreen');
      must((await p.eval(modeNow)) === 'fullscreen', 'not full screen');
      await p.eval(`document.exitFullscreen().then(() => true)`); // as the browser does on Esc
      await sleep(300);
      must((await p.eval(modeNow)) === base && !(await p.eval(`Boolean(document.fullscreenElement)`)), `after ${base}: ${await p.eval(modeNow)}`);
      must(await p.eval(`document.querySelector('[data-cmd="fullScreen"]').getAttribute('aria-pressed') === 'false'`), 'the full-screen button still pressed');
    }
    await p.close();
  });
  await check('rapid changes (keys and clicks): the page ends in one consistent mode', async () => {
    const p = await open(A7, 'pipe');
    await p.eval(`document.body.focus(), true`);
    for (let i = 0; i < 7; i++) await p.key('f', { code: 'KeyF', keyCode: 70 }); // odd: focus
    await sleep(400);
    must((await p.eval(modeNow)) === 'focus', `after 7 F: ${await p.eval(modeNow)}`);
    await p.eval(`(() => { const b = document.querySelector('[data-cmd="fullScreen"]'); b.click(); b.click(); b.click(); return true; })()`); // hidden in focus; clicked anyway
    await sleep(600);
    const l = await p.eval(LAYOUT);
    must(l.mode === (l.fs ? 'fullscreen' : 'focus') && l.dock === 'left' && !l.views, `inconsistent: ${JSON.stringify(l)}`);
    await p.close();
  });

  // 7. keys: F and Esc; not while typing, not with a menu open
  await check('keys: F toggles the focus, Esc leaves it; F in the editor types; Esc with a menu open closes the menu first; the focus is never lost', async () => {
    const p = await open(A7, 'pipe');
    await p.eval(`document.querySelector('.ed-input').focus(), true`);
    await p.key('f', { code: 'KeyF', keyCode: 70 });
    await sleep(200);
    must((await p.eval(modeNow)) === 'normal', 'F in the editor changed the mode');
    await p.eval(`document.querySelector('[data-cmd="run"]').focus(), true`);
    await p.key('f', { code: 'KeyF', keyCode: 70 });
    await sleep(300);
    must((await p.eval(modeNow)) === 'focus', 'F did not focus');
    must(await p.eval(`document.activeElement.checkVisibility() && document.activeElement !== document.body`), 'the focus was lost');
    await p.eval(`document.querySelector('[data-cmd="layout"] summary').focus(), document.querySelector('[data-cmd="layout"] summary').click(), true`);
    await sleep(100);
    await p.key('Escape', { code: 'Escape', keyCode: 27 });
    await sleep(200);
    must((await p.eval(modeNow)) === 'focus' && !(await p.eval(`document.querySelector('[data-cmd="layout"]').open`)), 'Esc with the menu open');
    await p.key('Escape', { code: 'Escape', keyCode: 27 });
    await sleep(300);
    must((await p.eval(modeNow)) === 'normal', 'Esc did not leave the focus');
    must(await p.eval(`document.activeElement.checkVisibility() && document.activeElement !== document.body`), 'the focus was lost on leaving');
    // the hidden controls are out of the tab order (display none)
    await to(p, 'focus');
    must(!(await p.eval(`[...document.querySelectorAll('.mode-btn, [data-cmd="theme"], [data-cmd="help"], [data-pane="registers"] button')].some((n) => n.checkVisibility())`)), 'hidden controls still show');
    await p.close();
  });

  // 8. zoom: a fit is computed again for the new size; a manual zoom keeps its level
  await check('armv7 pipe: Fit to height holds in Focus and Full screen; a manual zoom keeps its level through Focus', async () => {
    const p = await open(A7, 'pipe');
    await assemble(p, A7);
    await p.eval(pzBtn('Fit the drawing to the height'));
    await sleep(200);
    for (const m of ['focus', 'fullscreen', 'normal']) {
      await to(p, m);
      const d = await p.eval(DRAWN);
      must(Math.abs(d.top) <= 1 && Math.abs(d.bottom - d.paneH) <= 1, `${m}: drawn ${d.top.toFixed(1)}..${d.bottom.toFixed(1)} in ${d.paneH.toFixed(1)}`);
    }
    await p.eval(pzBtn('Fit the whole'));
    await p.eval(pzBtn('Zoom in'));
    await p.eval(pzBtn('Zoom in'));
    await sleep(250);
    const lv = (await p.eval(DRAWN)).level;
    await to(p, 'focus');
    must((await p.eval(DRAWN)).level === lv, `manual zoom ${lv} became ${(await p.eval(DRAWN)).level} in focus`);
    await to(p, 'normal');
    must((await p.eval(DRAWN)).level === lv, 'manual zoom changed after focus');
    await p.close();
  });

  // 9. the narrow screen: its workspaces stay; focus shows the Datapath workspace, not stored; the one before comes back
  for (const size of [[768, 1024, true], [390, 844, true]]) {
    await check(`${size[0]}x${size[1]}: focus keeps the workspaces, shows the Datapath one alone (not stored) and gives back the one before`, async () => {
      const p = await open(A7, 'pipe', size);
      await p.eval(`document.querySelector('[data-ws="cpu"]').click(), true`);
      await sleep(200);
      await to(p, 'focus');
      const l = await p.eval(LAYOUT);
      must(l.mode === 'focus' && l.dock === 'top' && l.oneLine && l.headerInside && l.scroll <= l.inner, JSON.stringify(l));
      must(l.leaves.length === 1 && l.leaves[0] === 'datapath', `panes ${l.leaves}`);
      must((await p.eval(`localStorage.getItem('pips.armv7.workspace.tab')`)) === 'cpu', 'the focus stored its workspace');
      await to(p, 'normal');
      must((await p.eval(`document.querySelector('.workspace').dataset.ws`)) === 'cpu', 'the workspace before did not come back');
      const errs = p.errors.slice();
      await p.close();
      must(!errs.length, errs.join('; '));
    });
  }

  // 10. axe-core: the compact header, the View menu and the column, in both themes
  const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  for (const scheme of ['light', 'dark']) {
    await check(`${scheme}: the compact header, its View menu and the column pass the axe-core scan`, async () => {
      const p = await open(A7, 'pipe', [1366, 768], { scheme });
      await to(p, 'focus');
      await p.eval(`${axe}; true`);
      const run = (sel) => p.eval(`axe.run({ include: [['${sel}']] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } })
        .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`);
      const found = [...(await run('.app-header')), ...(await run('.toolbar'))];
      await p.eval(`document.querySelector('[data-cmd="layout"] summary').click(), true`);
      await sleep(150);
      found.push(...(await run('[data-cmd="layout"]')).map((v) => `View menu ${v}`));
      await p.close();
      if (found.length) throw new Error(found.join('; '));
    });
  }
  if (SHOTS) writeFileSync(join(SHOTS, 'areas.json'), JSON.stringify(areas, null, 1));
} finally {
  await b.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`ok   ${r.name}${r.d ? ` (${r.d})` : ''}`);
  else { failed++; console.log(`FAIL ${r.name}\n     ${r.e}`); }
}
console.log(`${results.length - failed}/${results.length} passed (${b.name} ${b.version})`);
process.exit(failed ? 1 : 0);
