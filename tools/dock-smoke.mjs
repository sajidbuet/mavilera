// dock-smoke.mjs -- the execution controls docked on top, at the left and at the right (src/ui/dock.js), in a headless
// Chrome or Edge: the default (top), the layout of each place at desktop sizes (the row gone, a column the height of
// the workspace, nothing overlapping or outside the window, the drawing's zoom bar uncovered, the recovered height
// given to the workspace), the choice kept over a reload and a change of architecture, the narrow screen's row (the
// choice kept), the commands used from the column (assemble, run and pause, the steps, reset, the speed and the
// Architecture in their menus, memory, templates, file, Escape), the simulation, the drawing node and its zoom
// untouched by a change of place, and the fit to the drawing's height kept through it.
//
//   node tools/dock-smoke.mjs [--browser chrome|edge] [--shots dir]
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
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']; // as tools/browser-smoke.mjs
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSER = opt('--browser') ?? 'chrome';
const SHOTS = opt('--shots');
const DESKTOP = [[1920, 1080], [1650, 928], [1366, 768], [1280, 720]];
const NARROW = [[768, 1024], [390, 844]];
// per architecture: its page, the datapath view to open (pips.<arch>.view) and a program for it
const ARCHS = [
  { id: 'armv7', path: '?arch=armv7', view: 'pipe', key: 'pips.armv7.view',
    source: 'main:   SUB R0, R0, R0\n        ADD R1, R0, #5\n        ADD R2, R1, #7\n        ADD R3, R1, R2\n        STR R3, [R0, #64]\n        LDR R4, [R0, #64]\nloop:   B loop\n' },
  { id: 'riscv', path: '', view: 'pipe', key: 'pips.view',
    source: 'addi t0, zero, 5\naddi t1, t0, 7\nadd t2, t0, t1\nsw t2, 64(zero)\nlw t3, 64(zero)\nloop: j loop\n' },
  { id: 'sap-1', path: '?arch=sap-1', view: null, key: null, source: null },
];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const must = (c, msg) => { if (!c) throw new Error(msg); };

// --- in the page ---------------------------------------------------------------------------------------------------
const choose = (place) => `(() => { const r = document.querySelector('input[name="tb-dock"][value="${place}"]'); r.checked = true; r.dispatchEvent(new Event('change')); return true; })()`;
const cmd = (c) => `(() => { const n = document.querySelector('[data-cmd="${c}"]'); (n.tagName === 'DETAILS' ? n.querySelector('summary') : n).click(); return true; })()`;
const setSource = (text) => `(() => { const a = document.querySelector('.ed-input'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const placeNow = `document.getElementById('app').dataset.dock ?? 'top'`;
// the layout of the toolbar and the workspace
const LAYOUT = `(() => {
  const vis = (e) => !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const tb = document.querySelector('.toolbar'), ws = document.querySelector('.workspace'), hd = document.querySelector('.app-header');
  const out = { tb: R(tb), ws: R(ws), hd: R(hd), inner: [innerWidth, innerHeight], scroll: document.documentElement.scrollWidth, problems: [] };
  const P = (m) => out.problems.push(m);
  if (out.scroll > innerWidth) P('page ' + out.scroll + ' px wide in ' + innerWidth);
  const place = document.getElementById('app').dataset.dock ?? 'top';
  if (place !== 'top') {
    if (out.tb.w < 50 || out.tb.w > 60) P('column ' + out.tb.w + ' px wide');
    if (Math.abs(out.tb.t - out.hd.b) > 1) P('column starts at ' + out.tb.t + ', header ends at ' + out.hd.b);
    if (Math.abs(out.tb.b - innerHeight) > 1) P('column ends at ' + out.tb.b);
    if (Math.abs(out.ws.t - out.hd.b) > 1) P('a row is left above the workspace (' + out.ws.t + ' vs ' + out.hd.b + ')');
    if (place === 'left' && (out.tb.l !== 0 || out.ws.l < out.tb.r - 0.5)) P('left column misplaced');
    if (place === 'right' && (Math.abs(out.tb.r - innerWidth) > 0.5 || out.ws.r > out.tb.l + 0.5)) P('right column misplaced');
    // the controls of the column: one under another, inside it, none moved into a More menu
    const items = [...tb.querySelectorAll('.tb-group > *, .tb-group')].filter((n) => n.parentElement.classList.contains('tb-group') && vis(n));
    for (const n of items) { const b = R(n); if (b.l < out.tb.l - 0.5 || b.r > out.tb.r + 0.5) P(n.className + ' sticks out of the column'); }
    for (let i = 1; i < items.length; i++) if (R(items[i]).t < R(items[i - 1]).b - 0.5) P(items[i - 1].className + ' overlaps ' + items[i].className);
    if (tb.querySelector('.ovf .ovf-body [data-cmd]')) P('a control is in the More menu');
    if (tb.querySelector('[data-cmd="speed"]').checkVisibility()) P('the speed shows in the column'); // a closed menu's content has rects in Chrome
  } else if (out.tb.b > out.ws.t + 0.5) P('toolbar covers the workspace');
  const bar = document.querySelector('.pz-bar');
  if (bar && vis(bar)) { const b = R(bar); if (b.r > out.ws.r + 0.5 || b.l < out.ws.l - 0.5 || (place !== 'top' && (b.l < out.tb.r && b.r > out.tb.l))) P('the zoom bar is covered or outside the workspace'); }
  return out;
})()`;
// what a change of place must not change: the simulation's state, the program, the drawing's node and zoom
const STATE = `(() => ({
  regs: document.querySelector('.p-regs')?.innerText, counters: document.querySelector('.p-counters')?.innerText,
  head: document.querySelector('.p-datapath h2.with-status')?.textContent ?? null, pc: document.querySelector('table.listing tr.pc')?.textContent ?? null,
  src: document.querySelector('.ed-input')?.value, level: document.querySelector('.pz-level')?.textContent ?? null,
  sameSvg: window.__svg ? window.__svg === document.querySelector('svg.pz-svg') : null,
  sameBar: window.__tbNode ? window.__tbNode === document.querySelector('.toolbar') : null }))()`;
const MARK = `(() => { window.__svg = document.querySelector('svg.pz-svg'); window.__tbNode = document.querySelector('.toolbar'); return true; })()`;
// the drawing in its pane: its drawn top and bottom (pane pixels) and the pane's height, from the viewBox and the transform
const DRAWN = `(() => {
  const s = [...document.querySelectorAll('svg.pz-svg')].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 0);
  if (!s) return null;
  const pane = { w: s.clientWidth || s.parentElement.clientWidth, h: s.getBoundingClientRect().height / (new DOMMatrix(getComputedStyle(s).transform).a || 1) };
  const vb = s.viewBox.baseVal; const f = Math.min(pane.w / vb.width, pane.h / vb.height);
  const dh = vb.height * f, dy = (pane.h - dh) / 2;
  const m = new DOMMatrix(getComputedStyle(s).transform);
  return { paneH: pane.h, top: m.f + m.a * dy, bottom: m.f + m.a * (dy + dh), k: m.a,
    fitPressed: [...s.parentElement.querySelectorAll(':scope > .pz-bar .pz-btn[aria-pressed]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label')) };
})()`;

const { server, url } = await startServer({ port: 0 });
const b = await launch(BROWSER);
if (!b) { console.log(`${BROWSER}: not installed`); process.exit(1); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = async (name, f) => {
  try { const d = await f(); results.push({ name, ok: true, d }); } catch (e) { results.push({ name, ok: false, e: String(e.message ?? e) }); }
};
const shot = async (p, name) => { if (SHOTS) writeFileSync(join(SHOTS, `${name}.png`), await p.screenshot('png')); };

/** A page of `A` at `w` x `h`, storage cleared (then `dock` saved, if given), its datapath view open. */
async function open(A, [w, h], { dock = null, touch = false, scheme = 'light' } = {}) {
  const p = await b.newPage({ width: w, height: h, colorScheme: scheme, reducedMotion: 'reduce' });
  if (touch) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await p.goto(url + A.path);
  await p.eval(`localStorage.clear(); ${A.key ? `localStorage.setItem('${A.key}', '${A.view}');` : ''} ${dock ? `localStorage.setItem('pips.toolbarDock', '${dock}');` : ''} true`);
  p.errors.length = 0;
  await p.goto(url + A.path);
  await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('.workspace')`);
  await sleep(600);
  return p;
}
async function assemble(p, A) {
  if (!A.source) return;
  await p.eval(setSource(A.source));
  await p.eval(cmd('assemble'));
  await sleep(400);
}

try {
  // 1. the default, and each place at each desktop size: layout, and the height the workspace gains
  for (const A of ARCHS) {
    for (const size of DESKTOP) {
      await check(`${A.id} ${size.join('x')}: top by default; left and right columns lay out without overlap; the row's height goes to the workspace`, async () => {
        const p = await open(A, size);
        must((await p.eval(placeNow)) === 'top', 'not top by default');
        must(await p.eval(`document.querySelector('input[name="tb-dock"][value="top"]').checked`), 'Top not checked');
        must(await p.eval(`document.querySelector('[data-cmd="dock"] > summary').getAttribute('aria-label') === 'Dock execution controls'`), 'the dock button has another name');
        const top = await p.eval(LAYOUT);
        must(!top.problems.length, `top: ${top.problems.join('; ')}`);
        if (size[0] === 1366) await shot(p, `${A.id}-${size.join('x')}-top`);
        const notes = [];
        for (const place of ['left', 'right', 'top']) {
          await p.eval(choose(place));
          await sleep(350);
          must((await p.eval(placeNow)) === place, `${place}: shows ${await p.eval(placeNow)}`);
          const l = await p.eval(LAYOUT);
          must(!l.problems.length, `${place}: ${l.problems.join('; ')}`);
          if (place !== 'top') {
            const gained = l.ws.h - top.ws.h;
            must(Math.abs(gained - top.tb.h) <= 1, `${place}: the workspace gained ${gained} px of the row's ${top.tb.h}`);
            notes.push(`${place} +${Math.round(gained)} px`);
          } else must(Math.abs(l.ws.h - top.ws.h) <= 1 && Math.abs(l.tb.h - top.tb.h) <= 1, 'top again is not the row as before');
          if (size[0] === 1366 && place !== 'top') await shot(p, `${A.id}-${size.join('x')}-${place}`);
        }
        const errs = p.errors.slice();
        await p.close();
        must(!errs.length, errs.join('; '));
        return notes.join(', ');
      });
    }
  }

  // 2. the choice kept over a reload and in another architecture (one key for the platform)
  await check('the place chosen is kept over a reload and in another architecture', async () => {
    const p = await open(ARCHS[0], [1366, 768]);
    await p.eval(choose('right'));
    await sleep(200);
    must((await p.eval(`localStorage.getItem('pips.toolbarDock')`)) === 'right', 'not saved');
    await p.goto(url + ARCHS[0].path);
    await sleep(500);
    must((await p.eval(placeNow)) === 'right', 'lost on reload');
    for (const A of ARCHS.slice(1)) {
      await p.goto(url + A.path);
      await sleep(500);
      must((await p.eval(placeNow)) === 'right', `lost in ${A.id}`);
      must(await p.eval(`document.querySelector('input[name="tb-dock"][value="right"]').checked`), `${A.id}: Right not checked`);
    }
    await p.eval(`localStorage.setItem('pips.toolbarDock', 'sideways'); true`); // a bad value: the default
    await p.goto(url + ARCHS[0].path);
    await sleep(500);
    must((await p.eval(placeNow)) === 'top', 'a bad saved value is not read as top');
    await p.close();
  });

  // 3. narrow screens: the row, the choice kept; wide again: the column
  for (const size of NARROW) {
    await check(`${size.join('x')} (touch): a saved left dock shows the row; the choice stays and returns when wide`, async () => {
      const p = await open(ARCHS[0], size, { dock: 'left', touch: true });
      must((await p.eval(placeNow)) === 'top', `shows ${await p.eval(placeNow)}`);
      must(await p.eval(`document.querySelector('[data-cmd="dock"]').hidden`), 'the dock button shows on a narrow screen');
      const l = await p.eval(`(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth, tb: document.querySelector('.toolbar').getBoundingClientRect().width }))()`);
      must(l.scroll <= l.inner, `page ${l.scroll} px wide in ${l.inner}`);
      if (size[0] === 390) await shot(p, `armv7-${size.join('x')}-narrow-saved-left`);
      must((await p.eval(`localStorage.getItem('pips.toolbarDock')`)) === 'left', 'the choice was overwritten');
      await p.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
      await sleep(600);
      must((await p.eval(placeNow)) === 'left', `wide again: ${await p.eval(placeNow)}`);
      const w = await p.eval(LAYOUT);
      must(!w.problems.length, w.problems.join('; '));
      await p.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: true });
      await sleep(600);
      must((await p.eval(placeNow)) === 'top', 'narrow again: not the row');
      const errs = p.errors.slice();
      await p.close();
      must(!errs.length, errs.join('; '));
    });
  }

  // 4. the commands from the column, and a change of place leaves the simulation and the drawing as they were
  for (const A of ARCHS.slice(0, 2)) {
    for (const place of ['left', 'right']) {
      await check(`${A.id} ${place}: every command works from the column; a change of place keeps the state, the drawing and its zoom`, async () => {
        const p = await open(A, [1366, 768], { dock: place });
        must((await p.eval(placeNow)) === place, 'not docked');
        await assemble(p, A);
        const cycles = () => p.eval(`document.querySelector('.p-counters')?.innerText ?? ''`);
        const c0 = await cycles();
        for (let i = 0; i < 4; i++) { await p.eval(cmd('step')); await sleep(60); }
        const c1 = await cycles();
        must(c1 !== c0, 'Step did nothing');
        await p.eval(cmd('stepBack'));
        await sleep(100);
        must((await cycles()) !== c1, 'Step back did nothing');
        await p.eval(cmd('step'));
        await sleep(100);
        must((await cycles()) === c1, 'Step after Step back is not where it was');
        // disabled stays disabled (Step over and Step out follow the capability; Memory in Armv7)
        const dis = await p.eval(`['stepOver', 'stepOut', 'memory', 'runToCursor'].map((c) => [c, document.querySelector('[data-cmd="' + c + '"]').disabled])`);
        // the speed and the Architecture in their menus beside the column, toward the drawing, inside the window
        // (the Architecture menu holds the profile, or in a datapath view the subset; it is hidden when neither is offered)
        for (const [menu, field] of [['speedMenu', '[data-cmd="speed"]'], ['profileMenu', '.arch-ctx']]) {
          if (await p.eval(`document.querySelector('[data-cmd="${menu}"]').hidden`)) { must(await p.eval(`document.querySelector('.arch-ctx').hidden`), `${menu} hidden`); continue; }
          await p.eval(cmd(menu));
          await sleep(150);
          const r = await p.eval(`(() => { const m = document.querySelector('[data-cmd="${menu}"]'); const l = m.querySelector('.menu-list').getBoundingClientRect(); const s = m.querySelector('summary').getBoundingClientRect();
            const f = document.querySelector('${field}'); const a = document.activeElement;
            return { open: m.open, l: l.left, r: l.right, t: l.top, b: l.bottom, sl: s.left, sr: s.right, inMenu: m.contains(f), visible: f.checkVisibility(), focus: f.contains(a) && a.tagName === 'SELECT' }; })()`);
          must(r.open && r.inMenu && r.visible, `${menu}: ${JSON.stringify(r)}`);
          must(r.l >= 0 && r.r <= 1366 && r.t >= 0 && r.b <= 768, `${menu} leaves the window`);
          must(place === 'left' ? r.l >= r.sr : r.r <= r.sl, `${menu} opens over the column`);
          must(r.focus, `${menu}: the focus is not on its control`);
          await p.key('Escape', { code: 'Escape', keyCode: 27 });
          await sleep(100);
          must(!(await p.eval(`document.querySelector('[data-cmd="${menu}"]').open`)), `${menu}: Escape does not close it`);
          must(await p.eval(`document.activeElement === document.querySelector('[data-cmd="${menu}"] summary')`), `${menu}: the focus did not return`);
        }
        await p.eval(`(() => { const s = document.querySelector('[data-cmd="speed"]'); s.value = 'slow'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        must((await p.eval(`document.querySelector('[data-cmd="speedMenu"] summary').dispatchEvent(new Event('pointerenter')), document.querySelector('[data-cmd="speedMenu"] summary').title`)) === `Speed: ${await p.eval(`document.querySelector('[data-cmd="speed"]').selectedOptions[0].text`)}`, 'the speed button does not tell the speed');
        await p.eval(`(() => { const s = document.querySelector('[data-cmd="speed"]'); s.value = 'max'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        // Templates and File open beside the column
        for (const m of ['templates', 'file']) {
          await p.eval(cmd(m));
          await sleep(250);
          const r = await p.eval(`(() => { const d = document.querySelector('[data-cmd="${m}"]'); const l = d.querySelector('.menu-list').getBoundingClientRect(); return { open: d.open, l: l.left, r: l.right, t: l.top, b: l.bottom, n: d.querySelectorAll('.menu-list button').length }; })()`);
          must(r.open && r.n > 0, `${m} does not open`);
          must(r.l >= 0 && r.r <= 1366 && r.t >= 0 && r.b <= 768.5, `${m} leaves the window: ${JSON.stringify(r)}`);
          await p.eval(`document.body.click(), true`);
          await sleep(100);
          must(!(await p.eval(`document.querySelector('[data-cmd="${m}"]').open`)), `${m}: a click elsewhere does not close it`);
        }
        // Run and Pause (animated, so that the run is still going when Pause is pressed)
        const speed = (v) => p.eval(`(() => { const s = document.querySelector('[data-cmd="speed"]'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await speed('slow');
        await p.eval(cmd('run'));
        await sleep(200);
        const pressed = await p.eval(`document.querySelector('[data-cmd="run"]').getAttribute('aria-pressed')`);
        await p.eval(cmd('run'));
        await sleep(200);
        must(pressed === 'true' && (await p.eval(`document.querySelector('[data-cmd="run"]').getAttribute('aria-pressed')`)) === 'false', `Run and Pause do not alternate (${pressed})`);
        await speed('max');
        // a change of place: the same state, the same drawing node, the same zoom
        await p.eval(MARK);
        await p.eval(`document.querySelectorAll('.pz-bar .pz-btn')[2].click(), document.querySelectorAll('.pz-bar .pz-btn')[2].click(), true`); // zoom in twice
        await sleep(200);
        const before = await p.eval(STATE);
        for (const other of ['top', place === 'left' ? 'right' : 'left', place]) {
          await p.eval(choose(other));
          await sleep(300);
          const now = await p.eval(STATE);
          for (const k of ['regs', 'counters', 'head', 'pc', 'src', 'level']) must(now[k] === before[k], `${other}: ${k} changed (${JSON.stringify(before[k])?.slice(0, 80)} -> ${JSON.stringify(now[k])?.slice(0, 80)})`);
          must(now.sameSvg !== false && now.sameBar, `${other}: the drawing or the toolbar was rebuilt`);
        }
        // Reset from the column: the cycles start again
        await p.eval(cmd('reset'));
        await sleep(200);
        must((await cycles()) !== c1, 'Reset did nothing');
        // the shortcuts still work (F10: step) with the toolbar docked
        await p.eval(`document.querySelector('.pz-view')?.focus(), true`);
        const c2 = await cycles();
        await p.key('F10', { code: 'F10', keyCode: 121 });
        await sleep(150);
        must((await cycles()) !== c2, 'F10 does not step');
        const errs = p.errors.slice();
        await p.close();
        must(!errs.length, errs.join('; '));
        return `disabled: ${dis.filter(([, d]) => d).map(([c]) => c).join(', ') || 'none'}`;
      });
    }
  }

  // 5. Fit to height: the drawing exactly fills the pane's height, and stays so when the place changes
  await check('armv7 pipeline: Fit to height fills the drawing pane\'s height and is kept through a change of place', async () => {
    const p = await open(ARCHS[0], [1366, 768]);
    await assemble(p, ARCHS[0]);
    await p.eval(`[...document.querySelectorAll('.pz-bar .pz-btn')].find((x) => x.getAttribute('aria-label') === 'Fit the drawing to the height').click(), true`);
    await sleep(250);
    const out = [];
    for (const place of ['top', 'left', 'right', 'top']) {
      await p.eval(choose(place));
      await sleep(400);
      const d = await p.eval(DRAWN);
      must(d, 'no drawing');
      must(Math.abs(d.top) <= 1 && Math.abs(d.bottom - d.paneH) <= 1, `${place}: drawn ${d.top.toFixed(1)}..${d.bottom.toFixed(1)} in ${d.paneH.toFixed(1)}`);
      must(d.fitPressed.length === 1 && d.fitPressed[0] === 'Fit the drawing to the height', `${place}: pressed ${d.fitPressed}`);
      out.push(`${place} ${Math.round(d.paneH)} px`);
      if (place === 'left') await shot(p, 'armv7-pipe-1366x768-left-fit-height');
    }
    // Fit the whole drawing: back to k = 1
    await p.eval(`[...document.querySelectorAll('.pz-bar .pz-btn')].find((x) => x.getAttribute('aria-label').startsWith('Fit the whole')).click(), true`);
    await sleep(250);
    must((await p.eval(DRAWN)).k === 1, 'the whole-drawing fit is not restored');
    await p.close();
    return out.join(', ');
  });

  // 6. axe-core on the column, with each of its menus open, and on the header's Dock menu, in both themes (WS-U-034)
  const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  for (const A of ARCHS.slice(0, 2)) {
    for (const scheme of ['light', 'dark']) {
      await check(`${A.id} ${scheme}: the docked column, its open menus and the Dock menu pass the axe-core scan`, async () => {
        const p = await open(A, [1366, 768], { dock: 'left', scheme });
        await p.eval(`${axe}; true`);
        const run = (sel) => p.eval(`axe.run({ include: [['${sel}']] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } })
          .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`);
        const found = (await run('.toolbar')).map((v) => `column ${v}`);
        for (const m of ['speedMenu', 'profileMenu', 'templates', 'file']) {
          if (await p.eval(`document.querySelector('[data-cmd="${m}"]').hidden`)) continue;
          await p.eval(cmd(m));
          await sleep(250);
          found.push(...(await run(`[data-cmd="${m}"] > .menu-list`)).map((v) => `${m} ${v}`));
          await p.eval(`document.body.click(), true`);
        }
        await p.eval(cmd('dock'));
        await sleep(150);
        found.push(...(await run('[data-cmd="dock"]')).map((v) => `dock ${v}`));
        await p.close();
        if (found.length) throw new Error(found.join('; '));
      });
    }
  }

  // 7. keyboard: the dock menu by keys (radios: arrows choose)
  await check('the Dock menu works from the keyboard (arrows choose, Escape closes)', async () => {
    const p = await open(ARCHS[0], [1366, 768]);
    await p.eval(`document.querySelector('[data-cmd="dock"] summary').focus(), true`);
    // Enter with its character (a summary opens on the key press, which a raw key-down does not make)
    for (const type of ['keyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
    await sleep(150);
    must(await p.eval(`document.querySelector('[data-cmd="dock"]').open`), 'Enter does not open it');
    await p.eval(`document.querySelector('input[name="tb-dock"]:checked').focus(), true`);
    await p.key('ArrowDown', { code: 'ArrowDown', keyCode: 40 });
    await sleep(300);
    must((await p.eval(placeNow)) === 'left', `ArrowDown chose ${await p.eval(placeNow)}`);
    await p.key('Escape', { code: 'Escape', keyCode: 27 });
    await sleep(100);
    must(!(await p.eval(`document.querySelector('[data-cmd="dock"]').open`)), 'Escape does not close it');
    await p.close();
  });
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
