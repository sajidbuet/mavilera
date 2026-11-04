// mobile-smoke.mjs -- the workspaces of a narrow screen (docs/ui/mobile-workspaces.md) in a headless Chrome or Edge,
// RISC-V and SAP-2 (two architectures with different panes): the tabs offered, the panes each shows, no sideways
// scrolling, the keyboard on the tabs, and what must survive a change of workspace: the editor's text, cursor, selection,
// scroll and undo history, breakpoints, watchpoints, a run in progress, the drawing's zoom, the console. Also the console
// sheet and its error badge, a turn of the screen, the change between narrow and wide, the wide layout untouched, and an
// axe-core scan of each workspace. Screenshots with --shots <dir>.
//
//   node tools/mobile-smoke.mjs [--browser chrome|edge] [--shots dir]
//
// Exit status 1 if any check fails. Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSER = opt('--browser') ?? 'chrome';
const SHOTS = opt('--shots');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const PHONES = [[320, 700], [360, 800], [390, 844], [430, 932], [768, 1024]];
const WIDE = [[1024, 768], [1280, 800], [1440, 900]];
// per architecture: its page, the index of a datapath view among the view buttons, a program for that view (null: the default one)
const ARCHS = [
  { id: 'riscv', comment: '#', path: '', dp: 1, dpSource: 'addi t0, zero, 5\naddi t1, t0, 7\nadd t2, t0, t1\naddi t3, t2, 1\n', base: ['code', 'listing', 'cpu', 'memory'], withDp: ['code', 'listing', 'datapath', 'cpu', 'memory'] },
  { id: 'sap-2', comment: ';', path: '?arch=sap-2', dp: 1, dpSource: null, base: ['code', 'listing', 'cpu', 'memory'], withDp: ['code', 'listing', 'datapath', 'cpu', 'memory'] },
];
// what each workspace shows (pane ids), for a pane that exists in the layout
const SHOWS = { code: ['editor'], listing: ['listing', 'inspector'], datapath: ['datapath', 'info'], cpu: ['registers', 'calls', 'counters'], memory: ['memory'] };
const SHOWS_DP = { ...SHOWS, listing: ['info'] };
const LOOP = 'li t0, 300000\nloop:\n  addi t0, t0, -1\n  bnez t0, loop\n  li a7, 93\n  ecall\n';

const { server, url } = await startServer({ port: 0 });
const b = await launch(BROWSER);
if (!b) { console.log(`${BROWSER}: not installed`); process.exit(1); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = async (name, f) => {
  try { const d = await f(); results.push({ name, ok: true, d }); } catch (e) { results.push({ name, ok: false, e: String(e.message ?? e) }); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

async function open([w, h], path, { scheme = 'light', touch = true } = {}) {
  const p = await b.newPage({ width: w, height: h, colorScheme: scheme, reducedMotion: 'reduce' });
  await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: touch });
  await p.send('Emulation.setTouchEmulationEnabled', touch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await p.goto(url + path);
  await p.eval('localStorage.clear(); true');
  p.errors.length = 0;
  await p.goto(url + path);
  await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
  await sleep(400);
  return p;
}
const resize = async (p, w, h, touch = true) => {
  await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: touch });
  await sleep(500);
};
// in the page
const tabs = `[...document.querySelectorAll('.ws-tab')].map((t) => t.dataset.ws)`;
const active = `document.querySelector('.workspace').dataset.ws`;
const goTab = (id) => `document.querySelector('[data-ws="${id}"]').click(), true`;
const shown = `[...document.querySelectorAll('.workspace [data-pane]')].filter((n) => !n.querySelector('[data-pane]') && n.getClientRects().length > 0).map((n) => n.dataset.pane)`;
const cmd = (c) => `(() => { const n = document.querySelector('[data-cmd="${c}"]'); n.click(); return true; })()`;
const strip = `document.querySelector('.ws-state').textContent`;
const setSource = (text) => `(() => { const a = document.querySelector('.ed-input'); a.value = ${JSON.stringify(text)}; a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const viewButton = (i) => `(() => { document.querySelectorAll('.mode-btn')[${i}].click(); return true; })()`;
const sameSet = (a, b2) => JSON.stringify([...a].sort()) === JSON.stringify([...b2].sort());
const LAYOUT = `(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  const nav = r('.ws-nav'), tool = r('.toolbar'), ws = r('.workspace');
  const out = { scroll: document.documentElement.scrollWidth, inner: innerWidth, problems: [], ws: Math.round(ws.height), height: innerHeight };
  if (!nav || nav.width === 0) { out.problems.push('no tab row'); return out; }
  if (nav.top < tool.bottom - 0.5) out.problems.push('the tabs overlap the toolbar');
  if (ws.top < nav.bottom - 0.5) out.problems.push('the workspace overlaps the tabs');
  for (const t of document.querySelectorAll('.ws-tab')) {
    const b = t.getBoundingClientRect();
    if (b.right > innerWidth + 0.5 || b.left < -0.5) out.problems.push('tab ' + t.dataset.ws + ' outside the window');
    if (b.height < 34) out.problems.push('tab ' + t.dataset.ws + ' only ' + Math.round(b.height) + ' px high');
  }
  if (document.documentElement.scrollWidth > innerWidth) out.problems.push('page ' + document.documentElement.scrollWidth + ' px wide in ' + innerWidth);
  if (document.querySelector('.workspace').scrollWidth > document.querySelector('.workspace').clientWidth + 1) out.problems.push('the workspace scrolls sideways');
  return out;
})()`;

try {
  for (const A of ARCHS) {
    // 1. tabs, panes, layout at each phone and tablet size, in each workspace
    for (const size of PHONES) {
      await check(`${A.id} ${size[0]}x${size[1]}: tabs ${A.base.join(', ')}; each shows its panes; no sideways scrolling`, async () => {
        const p = await open(size, A.path);
        must(sameSet(await p.eval(tabs), A.base), `tabs ${await p.eval(tabs)}`);
        for (const id of A.base) {
          await p.eval(goTab(id));
          must((await p.eval(active)) === id, `${id} not active`);
          const pane = await p.eval(shown);
          const want = SHOWS[id].filter((x) => pane.includes(x) || true);
          must(pane.every((x) => want.includes(x)) && pane.length > 0, `${id} shows ${pane}`);
          const l = await p.eval(LAYOUT);
          if (l.problems.length) throw new Error(`${id}: ${l.problems.join('; ')}`);
          must(l.ws > l.height * 0.3, `${id}: the workspace is ${l.ws} of ${l.height} px`);
          if (SHOTS) writeFileSync(join(SHOTS, `${A.id}-${size[0]}x${size[1]}-${id}.png`), await p.screenshot('png'));
        }
        const errs = p.errors.slice();
        await p.close();
        if (errs.length) throw new Error(errs.join('; '));
        return 'ok';
      });
    }

    // 2. the keyboard on the tabs
    await check(`${A.id}: arrow keys, Home and End move between the tabs (one tab stop)`, async () => {
      const p = await open([390, 844], A.path);
      await p.eval(`document.querySelector('[data-ws="code"]').focus(), true`);
      const sel = () => p.eval(`document.querySelector('.ws-tab[aria-selected="true"]').dataset.ws + '/' + document.activeElement.dataset.ws + '/' + document.querySelectorAll('.ws-tab[tabindex="0"]').length`);
      await p.key('ArrowRight', { code: 'ArrowRight', keyCode: 39 });
      must((await sel()) === 'listing/listing/1', `ArrowRight: ${await sel()}`);
      await p.key('End', { code: 'End', keyCode: 35 });
      must((await sel()) === 'memory/memory/1', `End: ${await sel()}`);
      await p.key('ArrowRight', { code: 'ArrowRight', keyCode: 39 });
      must((await sel()) === 'code/code/1', `wrap: ${await sel()}`);
      await p.key('ArrowLeft', { code: 'ArrowLeft', keyCode: 37 });
      must((await sel()) === 'memory/memory/1', `ArrowLeft: ${await sel()}`);
      await p.key('Home', { code: 'Home', keyCode: 36 });
      must((await sel()) === 'code/code/1', `Home: ${await sel()}`);
      must((await p.eval(`document.querySelector('.ws-tabs').getAttribute('role')`)) === 'tablist', 'no tablist');
      must((await p.eval(`document.querySelector('.workspace').getAttribute('role')`)) === 'tabpanel', 'workspace is no tabpanel');
      await p.close();
      return 'ok';
    });

    // 3. the editor survives a change of workspace
    await check(`${A.id}: the editor keeps its text, cursor, selection, scroll and undo history across workspaces`, async () => {
      const p = await open([390, 844], A.path);
      const before = await p.eval(`(() => {
        const a = document.querySelector('.ed-input'); a.focus(); a.setSelectionRange(0, 0);
        document.execCommand('insertText', false, '${A.comment} pad\\n'.repeat(80));
        a.setSelectionRange(130, 142); a.scrollTop = 300;
        return { value: a.value, start: a.selectionStart, end: a.selectionEnd, top: a.scrollTop };
      })()`);
      must(before.top > 0, 'could not scroll the editor');
      const read = () => p.eval(`(() => { const a = document.querySelector('.ed-input'); return { value: a.value, start: a.selectionStart, end: a.selectionEnd, top: a.scrollTop,
        gutter: document.querySelector('.ed-gutter').scrollTop, code: document.querySelector('.ed-code').scrollTop }; })()`);
      // round the workspaces, nothing run: everything as it was, to the pixel
      for (const id of [...A.base.filter((x) => x !== 'code'), 'code']) { await p.eval(goTab(id)); await sleep(60); }
      const round = await read();
      must(round.value === before.value, 'the text changed');
      must(round.start === before.start && round.end === before.end, `selection ${round.start}-${round.end} was ${before.start}-${before.end}`);
      must(round.top === before.top, `scroll ${round.top} was ${before.top}`);
      must(round.gutter === round.top && round.code === round.top, `gutter ${round.gutter}, code layer ${round.code}, textarea ${round.top}`);
      // three steps in the CPU workspace: the text, the selection and the history stay; the current line is in view (the editor follows the PC)
      await p.eval(goTab('cpu'));
      for (let i = 0; i < 3; i++) { await p.eval(cmd('step')); await sleep(80); }
      await p.eval(goTab('code'));
      await sleep(200);
      const after = await read();
      must(after.value === before.value, 'the text changed after the steps');
      must(after.start === before.start && after.end === before.end, `selection ${after.start}-${after.end} was ${before.start}-${before.end} after the steps`);
      must(after.gutter === after.top && after.code === after.top, `gutter ${after.gutter}, code layer ${after.code}, textarea ${after.top}`);
      const cur = await p.eval(`(() => { const c = document.querySelector('.ed-line.ed-cur'); if (!c) return null; const r = c.getBoundingClientRect(), v = document.querySelector('.ed-body').getBoundingClientRect(); return r.top >= v.top - 1 && r.bottom <= v.bottom + 1; })()`);
      must(cur === true, `the line being executed is ${cur === null ? 'not marked' : 'out of view'}`);
      const undone = await p.eval(`(() => { const a = document.querySelector('.ed-input'); a.focus(); const n = a.value.length; document.execCommand('undo'); return n - a.value.length; })()`);
      must(undone > 0, 'undo history lost');
      await p.close();
      return `scroll ${before.top} -> ${round.top} -> ${after.top}`;
    });

    // 4. breakpoints, watchpoints and a run that goes on while the workspaces change
    await check(`${A.id}: breakpoints and watchpoints persist; a run goes on while workspaces change and ends as without`, async () => {
      const p = await open([390, 844], A.path);
      const cleanSource = A.id === 'riscv' ? LOOP : null;
      if (cleanSource) { await p.eval(setSource(cleanSource)); await p.eval(cmd('assemble')); await p.waitFor(`document.querySelectorAll('.p-console .msg-ok').length > 0`); }
      // a breakpoint in the listing, a watchpoint in the memory
      await p.eval(goTab('listing'));
      await p.eval(`document.querySelectorAll('table.code-listing .bp-btn')[1].click(), true`);
      await p.eval(goTab('memory'));
      await p.eval(`(() => { const i = document.querySelector('.p-memory .memory input'); i.value = '0x0'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); document.querySelector('.p-memory .memory .panel-tools button').click(); return true; })()`);
      await p.eval(goTab('cpu')); await p.eval(goTab('code')); await p.eval(goTab('listing')); await p.eval(goTab('memory'));
      must((await p.eval(`document.querySelectorAll('.p-memory td.watched').length`)) > 0, 'the watchpoint is not marked');
      await p.eval(goTab('listing'));
      must((await p.eval(`document.querySelectorAll('table.code-listing tr.bp').length`)) === 1, 'the breakpoint is gone');
      // it stops at the breakpoint
      await p.eval(cmd('run'));
      await p.waitFor(`/breakpoint|watchpoint|Halted/i.test(${strip}) && !/Running/.test(${strip})`, 8000);
      const stopped = await p.eval(strip);
      must(/breakpoint|watchpoint/i.test(stopped), `stopped as "${stopped}"`);
      // clear the break, run on while the workspaces change
      await p.eval(`document.querySelectorAll('table.code-listing .bp-btn')[1].click(), true`);
      await p.eval(cmd('run'));
      let moved = 0;
      for (const id of ['cpu', 'memory', 'code', 'listing', 'cpu', 'memory', 'listing']) {
        await p.eval(goTab(id)); moved += 1; await sleep(30);
      }
      await p.waitFor(`/Halted|Stopped|breakpoint|watchpoint/i.test(${strip})`, 15000);
      await p.eval(goTab('cpu'));
      const end = await p.eval(`({ status: ${strip}, regs: document.querySelector('.p-regs').textContent, counters: document.querySelector('.p-counters').textContent })`);
      // the same run without a change of workspace
      await p.eval(cmd('reset'));
      await p.eval(cmd('run'));
      await p.waitFor(`/Halted|Stopped|breakpoint|watchpoint/i.test(${strip})`, 15000);
      const plain = await p.eval(`({ status: ${strip}, regs: document.querySelector('.p-regs').textContent, counters: document.querySelector('.p-counters').textContent })`);
      must(end.regs === plain.regs && end.counters === plain.counters && end.status === plain.status, `different end: ${end.status} / ${plain.status}`);
      await p.close();
      return `${moved} changes during the run; ${end.status}`;
    });

    // 5. the console sheet and its error badge
    await check(`${A.id}: an error badges the console without leaving the workspace; the sheet opens, clears and closes (button, Escape)`, async () => {
      const p = await open([390, 844], A.path);
      await p.eval(goTab('cpu'));
      await p.eval(setSource('this is not an instruction at all\nneither is this\n'));
      await p.eval(cmd('assemble'));
      await sleep(300);
      must((await p.eval(active)) === 'cpu', 'the workspace changed');
      const badge = await p.eval(`(() => { const b = document.querySelector('.ws-badge'); return b.hidden ? '' : b.textContent; })()`);
      must(Number(badge) >= 1, `badge "${badge}"`);
      must((await p.eval(`document.querySelector('.ws-sheet').hidden`)), 'the sheet opened by itself');
      must(/error/.test(await p.eval(`document.querySelector('.ws-console').getAttribute('aria-label')`)), 'the button does not say there is an error');
      await p.eval(`document.querySelector('.ws-console').click(), true`);
      must(!(await p.eval(`document.querySelector('.ws-sheet').hidden`)), 'the sheet did not open');
      must((await p.eval(`document.querySelector('.ws-sheet .msg-error') !== null`)), 'no error in the sheet');
      must((await p.eval(`document.querySelector('.ws-badge').hidden`)), 'the badge stays after opening');
      const r = await p.eval(`(() => { const s = document.querySelector('.ws-sheet').getBoundingClientRect(); const w = document.querySelector('.ws-nav').getBoundingClientRect(); return { top: s.top, bottom: s.bottom, h: innerHeight, nav: w.bottom }; })()`);
      must(r.top > r.nav && r.bottom <= r.h + 0.5, `the sheet is at ${r.top}-${r.bottom} of ${r.h}`);
      await p.key('Escape', { code: 'Escape', keyCode: 27 });
      must((await p.eval(`document.querySelector('.ws-sheet').hidden`)), 'Escape did not close it');
      must((await p.eval(`document.activeElement === document.querySelector('.ws-console')`)), 'the focus did not return to the button');
      await p.eval(`document.querySelector('.ws-console').click(), true`);
      await p.eval(`document.querySelector('.sheet-close').click(), true`);
      must((await p.eval(`document.querySelector('.ws-sheet').hidden`)), 'the close button did not close it');
      // the same messages as on a wide screen: one list
      await p.eval(`document.querySelector('.ws-console').click(), true`);
      await p.eval(`document.querySelector('.ws-sheet .tool-small, .ws-sheet h2 button:not(.sheet-close)').click(), true`);
      must((await p.eval(`document.querySelectorAll('.ws-sheet .messages li').length`)) === 0, 'Clear did not clear');
      const errs = p.errors.slice();
      await p.close();
      if (errs.length) throw new Error(errs.join('; '));
      return `badge ${badge}`;
    });

    // 6. the datapath workspace of the datapath view
    await check(`${A.id}: the datapath workspace: tabs, drawing, zoom and pan by touch, state across workspaces`, async () => {
      const p = await open([390, 844], A.path);
      await p.eval(viewButton(A.dp));
      await p.waitFor(`document.querySelector('[data-ws="datapath"]')`);
      must(sameSet(await p.eval(tabs), A.withDp), `tabs ${await p.eval(tabs)}`);
      if (A.dpSource) { await p.eval(setSource(A.dpSource)); await p.eval(cmd('assemble')); await sleep(400); }
      await p.eval(goTab('datapath'));
      await sleep(300);
      const pane = await p.eval(shown);
      must(sameSet(pane, ['datapath', 'info']), `shows ${pane}`);
      const box = await p.eval(`(() => { const r = document.querySelector('.pz-view').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bar: document.querySelectorAll('.pz-bar .pz-btn').length }; })()`);
      must(box.w > 300 && box.h > 150, `the drawing is ${box.w} x ${box.h}`);
      must(box.bar === 7, `${box.bar} view buttons`); // zoom out, level, zoom in, fit, fit width, fit height, pan
      const level = () => p.eval(`document.querySelector('.pz-level').textContent`);
      const fit = await level();
      await p.eval(`document.querySelectorAll('.pz-bar .pz-btn')[2].click(), true`);
      await p.eval(`document.querySelectorAll('.pz-bar .pz-btn')[2].click(), true`);
      const zoomed = await level();
      must(zoomed !== fit, `zoom stays at ${fit}`);
      // a drag with one finger pans a zoomed drawing (Pan is on for touch)
      const tf0 = await p.eval(`document.querySelector('.pz-svg').style.transform`);
      const at = { x: Math.round(box.x + box.w / 2), y: Math.round(box.y + box.h / 3) };
      const touch = (type, x, y) => p.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await touch('touchStart', at.x, at.y);
      for (let i = 1; i <= 6; i++) await touch('touchMove', at.x - i * 12, at.y + i * 6);
      await touch('touchEnd', 0, 0);
      await sleep(200);
      const tf1 = await p.eval(`document.querySelector('.pz-svg').style.transform`);
      must(tf1 !== tf0, 'a touch drag did not pan the drawing');
      const head0 = await p.eval(`document.querySelector('.p-datapath h2.with-status').textContent`);
      // away: step while the drawing is hidden, then back
      await p.eval(goTab('cpu'));
      for (let i = 0; i < 3; i++) { await p.eval(cmd('step')); await sleep(80); }
      const strip1 = await p.eval(strip);
      await p.eval(goTab('datapath'));
      await sleep(200);
      must((await level()) === zoomed, `zoom ${await level()} was ${zoomed}`);
      must((await p.eval(`document.querySelector('.pz-svg').style.transform`)) === tf1, 'the pan was lost');
      const head1 = await p.eval(`document.querySelector('.p-datapath h2.with-status').textContent`);
      must(head1 !== head0, `the drawing still says "${head1}" after three steps`);
      // the Listing workspace here is the Listing tab of the details, and Datapath puts the first tab back
      await p.eval(goTab('listing'));
      must((await p.eval(`document.querySelector('.p-info .tabs [aria-selected="true"]').textContent`)) === 'Listing', 'Listing shows no listing');
      await p.eval(goTab('datapath'));
      must((await p.eval(`document.querySelector('.p-info .tabs [aria-selected="true"]').textContent`)) !== 'Listing', 'Datapath keeps the listing');
      // back to the instruction view: no datapath tab
      await p.eval(viewButton(0));
      await sleep(600);
      must(sameSet(await p.eval(tabs), A.base), `tabs ${await p.eval(tabs)}`);
      const errs = p.errors.slice();
      if (SHOTS) writeFileSync(join(SHOTS, `${A.id}-datapath-390.png`), await p.screenshot('png'));
      await p.close();
      if (errs.length) throw new Error(errs.join('; '));
      return `${fit} -> ${zoomed}; ${strip1}; "${String(head0).slice(0, 30)}" -> "${String(head1).slice(0, 30)}"`;
    });

    // 7. a turn of the screen, and the change between narrow and wide
    await check(`${A.id}: a turn of the screen, and narrow to wide and back, keep the editor, the workspace and the run state`, async () => {
      const p = await open([390, 844], A.path);
      await p.eval(`(() => { const a = document.querySelector('.ed-input'); a.focus(); document.execCommand('insertText', false, '; kept\\n'); a.setSelectionRange(3, 7); return true; })()`);
      await p.eval(goTab('memory'));
      await p.eval(cmd('step'));
      const state = () => p.eval(`(() => { const a = document.querySelector('.ed-input'); return { v: a.value, s: a.selectionStart, e: a.selectionEnd, pc: document.querySelector('.ws-state')?.textContent, dirty: document.querySelector('.ed-dirty')?.hidden }; })()`);
      const s0 = await state();
      await resize(p, 844, 390);
      let l = await p.eval(LAYOUT);
      must(l.problems.length === 0, `landscape: ${l.problems.join('; ')}`);
      must((await p.eval(active)) === 'memory', 'the workspace changed in landscape');
      must(l.ws >= 120, `landscape: the workspace is ${l.ws} px high`);
      if (SHOTS) writeFileSync(join(SHOTS, `${A.id}-landscape-memory.png`), await p.screenshot('png'));
      await resize(p, 1280, 800, false);
      must(!(await p.eval(`document.querySelector('.workspace').classList.contains('ws-mobile')`)), 'still narrow at 1280');
      must((await p.eval(`document.querySelector('.ws-nav').hidden`)), 'the tab row shows at 1280');
      const wide = await p.eval(shown);
      for (const id of ['editor', 'registers', 'memory']) must(wide.includes(id), `${id} is not shown at 1280 (${wide})`);
      must((await p.eval(`document.querySelectorAll('.ws-off, .ws-solo, .ws-force').length`)) === 0, 'traces of the narrow layout remain');
      must((await p.eval(`document.querySelector('.p-console').closest('.ws-sheet') === null`)), 'the console is still in the sheet');
      await resize(p, 390, 844, true);
      must((await p.eval(active)) === 'memory', `back narrow: ${await p.eval(active)}`);
      const s1 = await state();
      must(JSON.stringify(s0) === JSON.stringify(s1), `${JSON.stringify(s0)} then ${JSON.stringify(s1)}`);
      const errs = p.errors.slice();
      await p.close();
      if (errs.length) throw new Error(errs.join('; '));
      return 'ok';
    });

    // 8. the memory table: fewer bytes a row on a narrow screen, the same memory
    await check(`${A.id}: the memory table has 8 bytes a row narrow and 16 wide; the same words`, async () => {
      const p = await open([390, 844], A.path);
      await p.eval(goTab('memory'));
      const cols = () => p.eval(`document.querySelectorAll('.p-memory table.memtable tr:first-child th.mono').length`);
      const words = (n) => p.eval(`[...document.querySelectorAll('.p-memory table.memtable tr')].slice(1, 1 + ${n}).map((r) => [...r.querySelectorAll('td.mono:not(.addr)')].map((t) => t.textContent.replace(/[^0-9a-f]/g, '')).join('')).join('')`);
      const narrow = await cols();
      const w8 = await words(2);
      await resize(p, 1280, 800, false);
      const wide = await cols();
      const w16 = await words(1);
      await p.close();
      must(wide === narrow * 2, `${narrow} columns narrow, ${wide} wide`);
      must(w8.length > 0 && w8 === w16, `the first 16 bytes differ: ${w8} then ${w16}`);
      return `${narrow} / ${wide} columns`;
    });

    // 9. axe-core on each workspace, both themes
    await check(`${A.id}: axe-core on each workspace (390 px, light and dark) finds no violation`, async () => {
      const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
      const found = [];
      for (const scheme of ['light', 'dark']) {
        const p = await open([390, 844], A.path, { scheme });
        await p.eval(`${axe}; true`);
        for (const id of A.base) {
          await p.eval(goTab(id));
          await sleep(150);
          const r = await p.eval(`axe.run(document, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } }).then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`);
          found.push(...r.map((v) => `${scheme} ${id} ${v}`));
        }
        await p.close();
      }
      if (found.length) throw new Error(found.join(' | '));
      return 'no violations';
    });
  }

  // 10. the wide layout is the desktop's: every pane shown, no tab row, nothing hidden
  for (const A of ARCHS) {
    for (const size of WIDE) {
      await check(`${A.id} ${size[0]}x${size[1]}: the desktop layout (no tab row, no hidden pane, console in its split)`, async () => {
        const p = await open(size, A.path, { touch: false });
        must((await p.eval(`document.querySelector('.ws-nav').hidden`)), 'tab row shown');
        must(!(await p.eval(`document.querySelector('.workspace').classList.contains('ws-mobile')`)), 'ws-mobile');
        must((await p.eval(`document.documentElement.classList.contains('ws-mobile')`)) === false, 'ws-mobile on html');
        const pane = await p.eval(shown);
        for (const id of ['editor', 'listing', 'inspector', 'registers', 'counters', 'memory', 'console']) {
          if (A.id === 'riscv' || id !== 'inspector') must(pane.includes(id) || !(await p.eval(`document.querySelector('[data-pane="${id}"]')`)), `${id} hidden (${pane})`);
        }
        must((await p.eval(`document.querySelectorAll('.ws-off, .ws-solo, .ws-force, .ws-duo').length`)) === 0, 'classes of the narrow layout');
        must((await p.eval(`document.querySelectorAll('.split-divider').length`)) > 0 && (await p.eval(`getComputedStyle(document.querySelector('.split-divider')).display`)) !== 'none', 'dividers are hidden');
        if (SHOTS) writeFileSync(join(SHOTS, `${A.id}-${size[0]}x${size[1]}-desktop.png`), await p.screenshot('png'));
        const errs = p.errors.slice();
        await p.close();
        if (errs.length) throw new Error(errs.join('; '));
        return 'ok';
      });
    }
  }

  // 11. the help window has a close button (×) at its top right, on a phone and on a desktop
  for (const [size, touch] of [[[390, 844], true], [[1280, 800], false]]) {
    await check(`${size[0]} px: the help window has a × at its top right that closes it`, async () => {
      const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
      const p = await open(size, '', { touch });
      await p.eval(`document.querySelector('[data-cmd="help"]').click(), true`);
      await p.waitFor(`document.querySelector('.help-dialog[open]') && document.querySelectorAll('.help-nav button').length > 0`);
      const g = await p.eval(`(() => { const d = document.querySelector('.help-dialog').getBoundingClientRect(), x = document.querySelector('.help-x').getBoundingClientRect();
        return { dr: d.right, dt: d.top, xr: x.right, xt: x.top, xw: x.width, xh: x.height, label: document.querySelector('.help-x').getAttribute('aria-label') }; })()`);
      must(g.xr <= g.dr && g.dr - g.xr < 40 && g.xt - g.dt < 40, `the × is at ${Math.round(g.xr)},${Math.round(g.xt)} in a window ending ${Math.round(g.dr)},${Math.round(g.dt)}`);
      must(g.xw >= (touch ? 40 : 28) && g.xh >= (touch ? 40 : 28), `the × is ${g.xw} x ${g.xh} px`);
      must(g.label === 'Close help', `label "${g.label}"`);
      await p.eval(`${axe}; true`);
      const v = await p.eval(`axe.run({ include: [['.help-dialog']] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } }).then((r) => r.violations.map((v) => v.id))`);
      must(v.length === 0, `axe: ${v.join(', ')}`);
      await p.eval(`document.querySelector('.help-x').click(), true`);
      must(!(await p.eval(`document.querySelector('.help-dialog').open`)), 'the × did not close it');
      await p.close();
      return 'ok';
    });
  }
} finally {
  await b.close();
  server.close();
}

let failed = 0;
for (const r of results) {
  if (r.ok) console.log(`ok   ${r.name}${r.d ? `  [${r.d}]` : ''}`);
  else { failed += 1; console.log(`FAIL ${r.name}\n     ${r.e}`); }
}
console.log(`\n${results.length - failed} of ${results.length} checks passed (${b.name} ${b.version})`);
process.exit(failed ? 1 : 0);
