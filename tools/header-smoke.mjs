// header-smoke.mjs -- the header and the toolbar at phone, tablet and desktop widths, in a headless Chrome or Edge
// (WS-U-011, WS-U-030): each row keeps one line, nothing overlaps or makes the page scroll sideways, and every
// command is reached where the width puts it (in its row or in the row's More menu) and works from there:
// assemble, run and pause, the steps, reset, speed, Architecture, the views, File, Templates, View, theme,
// projector, full screen, keys, help and the memory model; the keyboard shortcuts; Escape and a click elsewhere
// close a More menu; a resize brings every control back. Screenshots with --shots <dir>.
//
//   node tools/header-smoke.mjs [--browser chrome|edge] [--shots dir]
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
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']; // as tools/browser-smoke.mjs
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSER = opt('--browser') ?? 'chrome';
const SHOTS = opt('--shots');
const SIZES = [[320, 700, true], [360, 800, true], [390, 844, true], [430, 932, true], [768, 1024, true], [820, 1180, true],
  [1024, 768, false], [1280, 800, false], [1440, 900, false], [1920, 1080, false]];
const ARCHS = [['riscv', ''], ['sap-2', '?arch=sap-2'], ['sap-1', '?arch=sap-1']];
const PROGRAM = readFileSync(join(ROOT, 'content/examples/tests-arraysum.s'), 'utf8');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// In the page: the shell's strings, downloads captured.
const PREPARE = `(async () => {
  window.__S = (await import(new URL('ui/strings.js', document.querySelector('script[type=module][src$="main.js"]').src))).STRINGS;
  window.__dl = [];
  HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push(this.download); return; } };
  return true;
})()`;
// the rows' layout: one line each, no overlap, inside the window, above the workspace
const LAYOUT = `(() => {
  const vis = (e) => !e.hidden && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none';
  const rows = ['.app-header', '.toolbar'].map((s) => document.querySelector(s));
  const out = { scroll: document.documentElement.scrollWidth, inner: innerWidth, problems: [], heights: rows.map((r) => Math.round(r.getBoundingClientRect().height)) };
  for (const r of rows) {
    const kids = [...r.children].filter(vis).filter((c) => !c.matches('.sep, .run-status, input')).map((c) => [c, c.getBoundingClientRect()]);
    for (const [c, b] of kids) if (b.right > innerWidth + 0.5 || b.left < -0.5) out.problems.push(r.className + ': ' + c.className + ' outside the window');
    for (let i = 1; i < kids.length; i++) if (kids[i][1].left < kids[i - 1][1].right - 0.5) out.problems.push(r.className + ': ' + kids[i - 1][0].className + ' overlaps ' + kids[i][0].className);
    // one line: every control shares a horizontal band with every other
    const top = Math.max(...kids.map(([, b]) => b.top)), bottom = Math.min(...kids.map(([, b]) => b.bottom));
    if (top >= bottom) out.problems.push(r.className + ': more than one line');
  }
  const ws = document.querySelector('.workspace').getBoundingClientRect().top;
  if (rows[1].getBoundingClientRect().bottom > ws + 0.5) out.problems.push('toolbar covers the workspace');
  if (out.scroll > out.inner) out.problems.push('page ' + out.scroll + ' px wide in ' + out.inner);
  return out;
})()`;
// Make command `cmd` visible where the width put it (open its More menu, and a menu inside it, if needed); its node or null.
const reach = (cmd, inner = null) => `(() => {
  const n = document.querySelector('[data-cmd="${cmd}"]');
  if (!n) return 'missing';
  document.querySelectorAll('details.ovf[open]').forEach((d) => { if (!d.contains(n)) d.open = false; });
  const ovf = n.closest('details.ovf');
  if (ovf && !ovf.open) ovf.querySelector('summary').click();
  let t = n;
  ${inner ? `if (n.tagName === 'DETAILS' && !n.open) n.querySelector('summary').click(); t = [...n.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(inner)})) ?? null; if (!t) return 'no item';` : ''}
  const b = t.getBoundingClientRect();
  if (!t.getClientRects().length || b.width === 0) return 'not visible';
  if (b.right > innerWidth + 0.5 || b.left < -0.5) return 'outside the window';
  return ovf ? 'menu' : 'bar';
})()`;
const pc = `document.querySelector('table.listing tr.pc')?.textContent ?? ''`;
const lastMsg = `[...document.querySelectorAll('.p-console .msg-text')].pop()?.textContent ?? ''`;
const click = (cmd) => `(() => { const n = document.querySelector('[data-cmd="${cmd}"]'); const t = n.tagName === 'DETAILS' ? n.querySelector('summary') : n; t.click(); return true; })()`;

const { server, url } = await startServer({ port: 0 });
const b = await launch(BROWSER);
if (!b) { console.log(`${BROWSER}: not installed`); process.exit(1); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = async (name, f) => {
  try { const d = await f(); results.push({ name, ok: true, d }); } catch (e) { results.push({ name, ok: false, e: String(e.message ?? e) }); }
};

async function open([w, h, touch], path, scheme = 'light') {
  const p = await b.newPage({ width: w, height: h, colorScheme: scheme, reducedMotion: 'reduce' });
  if (touch) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await p.goto(url + path);
  await p.eval('localStorage.clear(); true');
  p.errors.length = 0;
  await p.goto(url + path);
  await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
  await p.eval(PREPARE);
  await sleep(400);
  return p;
}
async function expect(p, cmd, inner = null) {
  const r = await p.eval(reach(cmd, inner));
  if (r !== 'bar' && r !== 'menu') throw new Error(`${cmd}: ${r}`);
  return r;
}

try {
  // 1. layout at every width, in both themes for two of them
  for (const [arch, path] of ARCHS) {
    for (const size of SIZES) {
      for (const scheme of size[0] === 360 || size[0] === 1280 ? ['light', 'dark'] : ['light']) {
        await check(`${arch} ${size[0]}x${size[1]} ${scheme}: one line per row, no overlap, no sideways scrolling`, async () => {
          const p = await open(size, path, scheme);
          const l = await p.eval(LAYOUT);
          if (SHOTS) writeFileSync(join(SHOTS, `${arch}-${size[0]}x${size[1]}-${scheme}.png`), await p.screenshot('png'));
          const errs = p.errors.slice();
          await p.close();
          if (errs.length) throw new Error(errs.join('; '));
          if (l.problems.length) throw new Error(l.problems.join('; '));
          return `rows ${l.heights.join(' + ')} px`;
        });
      }
    }
  }

  // 2. every command from where the width puts it, at a phone, a tablet and a desktop width
  for (const [arch, path] of ARCHS) {
    for (const size of [[320, 700, true], [768, 1024, true], [1440, 900, false]]) {
      const tag = `${arch} ${size[0]} px`;
      const p = await open(size, path);
      const where = {};
      const run = (name, f) => check(`${tag}: ${name}`, f);
      if (arch === 'riscv') await p.eval(`(() => { const a = document.querySelector('.p-editor textarea'); a.value = ${JSON.stringify(PROGRAM)}; a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await run('Assemble', async () => {
        where.assemble = await expect(p, 'assemble');
        await p.eval(click('assemble'));
        await p.waitFor(`${lastMsg}.startsWith('Assembled')`);
        if (where.assemble !== 'bar') throw new Error('Assemble is not in the toolbar');
      });
      const pc0 = await p.eval(pc);
      await run('Step (in the toolbar)', async () => {
        if ((where.step = await expect(p, 'step')) !== 'bar') throw new Error('Step is not in the toolbar');
        await p.eval(click('step'));
        await p.waitFor(`(${pc}) !== ${JSON.stringify(pc0)}`);
      });
      // a command whose capability is off stays offered, disabled, with its reason (capabilities.js gate)
      const off = (cmd) => p.eval(`document.querySelector('[data-cmd="${cmd}"]').disabled`);
      await run('Step back', async () => {
        where.stepBack = await expect(p, 'stepBack');
        if (await off('stepBack')) return 'disabled (capability off)';
        await p.eval(click('stepBack'));
        await p.waitFor(`(${pc}) === ${JSON.stringify(pc0)}`);
      });
      await run('Step over', async () => {
        where.stepOver = await expect(p, 'stepOver');
        if (await off('stepOver')) return 'disabled (capability off)';
        const before = await p.eval(pc);
        await p.eval(click('stepOver'));
        await p.waitFor(`(${pc}) !== ${JSON.stringify(before)}`);
      });
      await run('Step out (offered, enabled as its capability says)', async () => {
        where.stepOut = await expect(p, 'stepOut');
        if (await off('stepOut')) return 'disabled (capability off)';
        await p.eval(click('stepOut'));
        await sleep(300);
      });
      await run('Run to cursor (offered)', async () => { where.runToCursor = await expect(p, 'runToCursor'); });
      await run('Reset', async () => {
        where.reset = await expect(p, 'reset');
        await p.eval(click('reset'));
        await p.waitFor(`${lastMsg} === __S.resetDone`);
        if ((await p.eval(pc)) !== pc0) throw new Error('not back at the start');
      });
      await run('Speed', async () => {
        where.speed = await expect(p, 'speed');
        await p.eval(`(() => { const s = document.querySelector('[data-cmd="speed"]'); s.value = 'slow'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        if (await p.eval(`document.querySelector('[data-cmd="speed"]').value`) !== 'slow') throw new Error('not set');
      });
      await run('Run, then Pause (Animated), then Run to the end at full speed', async () => {
        if ((where.run = await expect(p, 'run')) !== 'bar') throw new Error('Run is not in the toolbar');
        const w0 = await p.eval(`document.querySelector('[data-cmd="run"]').offsetWidth`);
        await p.eval(click('run'));
        await p.waitFor(`document.querySelector('[data-cmd="run"]').getAttribute('aria-pressed') === 'true'`);
        const w1 = await p.eval(`document.querySelector('[data-cmd="run"]').offsetWidth`);
        const l = await p.eval(LAYOUT);
        await p.eval(click('run'));
        await p.waitFor(`document.querySelector('[data-cmd="run"]').getAttribute('aria-pressed') !== 'true'`);
        await p.eval(`(() => { const s = document.querySelector('[data-cmd="speed"]'); s.value = 'max'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        if (Math.abs(w1 - w0) > 1) throw new Error(`Run ${w0} px, Pause ${w1} px`);
        if (l.problems.length) throw new Error(`while running: ${l.problems.join('; ')}`);
      });
      await run('Architecture (profile)', async () => {
        where.profile = await expect(p, 'profile');
        const n = await p.eval(`document.querySelector('[data-cmd="profile"]').options.length`);
        if (n > 1) {
          await p.eval(`(() => { const s = document.querySelector('[data-cmd="profile"]'); s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
          await p.waitFor(`document.querySelector('.ed-prof').textContent === document.querySelector('[data-cmd="profile"]').selectedOptions[0].textContent`);
          await p.eval(`(() => { const s = document.querySelector('[data-cmd="profile"]'); s.selectedIndex = 0; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        }
        const label = await p.eval(`document.querySelector('[data-cmd="profile"]').getAttribute('aria-label')`);
        if (label !== 'Architecture') throw new Error(`labelled ${label}`);
        return `${n} option(s)`;
      });
      await run('views: the second view opens, then the first', async () => {
        where.views = await expect(p, 'views');
        for (const i of [1, 0]) {
          await p.eval(reach('views'));
          await p.eval(`document.querySelectorAll('.mode-btn')[${i}].click(), true`);
          await p.waitFor(`document.querySelectorAll('.mode-btn')[${i}].getAttribute('aria-selected') === 'true'`);
          await sleep(300);
        }
        if (await p.eval(`Boolean(document.querySelector('details.ovf[open]'))`)) throw new Error('the menu stayed open after the choice');
      });
      await run('File ▸ Save', async () => {
        where.file = await expect(p, 'file', 'Save .');
        await p.eval(`[...document.querySelectorAll('[data-cmd="file"] button')].find((b) => b.textContent.trim().startsWith('Save .')).click(), true`);
        await p.waitFor('window.__dl.length > 0');
      });
      await run('Templates: the list loads and a template opens', async () => {
        where.templates = await expect(p, 'templates');
        await p.eval(`(() => { const n = document.querySelector('[data-cmd="templates"]'); if (!n.open) n.querySelector('summary').click(); return true; })()`);
        await p.waitFor(`document.querySelector('[data-cmd="templates"]').querySelector('.menu-list').dataset.filled === '1'`);
        await p.eval(`document.querySelector('[data-cmd="templates"] .menu-list button').click(), true`);
        await p.waitFor(`${lastMsg}.startsWith('Opened the template')`, 20000);
      });
      await run('View ▸ Reset layout', async () => {
        where.layout = await expect(p, 'layout');
        await p.eval(`(() => { const n = document.querySelector('[data-cmd="layout"]'); if (!n.open) n.querySelector('summary').click(); return true; })()`);
        await p.eval(`[...document.querySelectorAll('[data-cmd="layout"] button')].find((b) => b.textContent.trim() === __S.layout.reset).click(), true`);
        await p.waitFor(`${lastMsg} === __S.layout.resetDone`);
      });
      // View ▸ Theme (author, 2026-11-10): a list in the View menu, applied when chosen
      await run('View ▸ Theme', async () => {
        where.theme = await expect(p, 'layout');
        const pick = (t) => `(() => { const n = document.querySelector('[data-cmd="layout"]'); if (!n.open) n.querySelector('summary').click();
          const s = n.querySelector('[data-cmd="theme"]'); s.value = ${JSON.stringify(t)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
        for (const t of ['dark', 'hc-light', 'black', '']) {
          await p.eval(reach('layout'));
          await p.eval(pick(t));
          if (await p.eval(`document.documentElement.dataset.theme ?? ''`) !== t) throw new Error(`not ${t || 'the system'}`);
        }
      });
      await run('Projector mode', async () => {
        where.projector = await expect(p, 'projector');
        await p.eval(click('projector'));
        if (!(await p.eval(`document.documentElement.hasAttribute('data-projector')`))) throw new Error('not on');
        await sleep(300);
        const l = await p.eval(LAYOUT);
        await p.eval(reach('projector')); await p.eval(click('projector'));
        if (l.problems.length) throw new Error(`in projector mode: ${l.problems.join('; ')}`);
      });
      await run('Full screen (offered; the browser may refuse it headless)', async () => {
        if (await p.eval(`document.querySelector('[data-cmd="fullScreen"]').hidden`)) return 'hidden: no Fullscreen API';
        where.fullScreen = await expect(p, 'fullScreen');
        const msg0 = await p.eval(lastMsg);
        await p.eval(click('fullScreen'));
        // the browser grants or refuses full screen asynchronously, sometimes after several hundred ms; full screen hides the
        // header (compact view), so wait for the answer and for the exit, or Keys and Help after this are not visible (D43 Q13)
        await p.waitFor(`Boolean(document.fullscreenElement) || (${lastMsg}) !== ${JSON.stringify(msg0)}`, 5000).catch(() => { throw new Error('no effect'); });
        await p.eval('document.fullscreenElement ? document.exitFullscreen().then(() => true) : true');
        await p.waitFor('!document.fullscreenElement', 5000);
        await sleep(300);
      });
      await run('Keys', async () => {
        where.keys = await expect(p, 'keys');
        await p.eval(`(() => { const n = document.querySelector('[data-cmd="keys"]'); n.querySelector('summary').click(); return true; })()`);
        const t = await p.eval(`(() => { const q = document.querySelector('[data-cmd="keys"] p'); return q.getClientRects().length ? q.textContent : ''; })()`);
        if (!t.startsWith('F5')) throw new Error('the list did not show'); // one key per line, F5 first (2026-11-11)
        await p.eval(`document.querySelector('[data-cmd="keys"]').open = false, true`);
      });
      await run('Help', async () => {
        where.help = await expect(p, 'help');
        await p.eval(click('help'));
        await p.waitFor(`document.querySelector('dialog[open]')`);
        await p.eval(`document.querySelector('dialog[open]').close(), true`);
      });
      await run('Memory model (or not shown, by capability)', async () => {
        if (await p.eval(`document.querySelector('[data-cmd="memory"]').hidden`)) return 'hidden (capability off)';
        where.memory = await expect(p, 'memory');
        if (await p.eval(`document.querySelector('[data-cmd="memory"]').disabled`)) return 'disabled (capability off)';
        await p.eval(click('memory'));
        await p.waitFor(`document.querySelector('dialog.mem-dialog[open]')`);
        await p.eval(`document.querySelector('dialog.mem-dialog[open]').close(), true`);
      });
      await run('More menus: Escape closes, and so does a click elsewhere', async () => {
        const m = await p.eval(`[...document.querySelectorAll('details.ovf')].filter((d) => !d.hidden).map((d) => d.dataset.cmd)`);
        for (const cmd of m) {
          await p.eval(`(() => { const d = document.querySelector('[data-cmd="${cmd}"]'); d.open = true; d.querySelector('summary').focus(); return true; })()`);
          await p.key('Escape', { keyCode: 27 });
          if (await p.eval(`document.querySelector('[data-cmd="${cmd}"]').open`)) throw new Error(`${cmd}: Escape (focus on ${await p.eval('document.activeElement.outerHTML.slice(0, 80)')}; dialogs open: ${await p.eval('[...document.querySelectorAll(`"dialog[open]`")].map((d) => d.className).join()')})`);
          if (!(await p.eval(`document.activeElement === document.querySelector('[data-cmd="${cmd}"] summary')`))) throw new Error(`${cmd}: the focus did not return`);
          await p.eval(`document.querySelector('[data-cmd="${cmd}"]').open = true, true`);
          await p.eval(`document.querySelector('.workspace').click(), true`);
          if (await p.eval(`document.querySelector('[data-cmd="${cmd}"]').open`)) throw new Error(`${cmd}: click elsewhere`);
        }
        return m.length ? m.join(', ') : 'none shown';
      });
      await run('shortcuts: Ctrl+Enter, F10, Shift+F10, F5 (from the editor too)', async () => {
        await p.eval(`document.querySelector('.p-editor textarea').focus(), true`);
        await p.key('Enter', { keyCode: 13, modifiers: 2 });
        await p.waitFor(`${lastMsg}.startsWith('Assembled')`);
        const a = await p.eval(pc);
        await p.key('F10', { keyCode: 121 });
        await p.waitFor(`(${pc}) !== ${JSON.stringify(a)}`);
        await p.key('F10', { keyCode: 121, modifiers: 8 });
        await p.waitFor(`(${pc}) === ${JSON.stringify(a)}`);
        await p.key('F5', { keyCode: 116 });
        await sleep(500);
      });
      await run('no errors in the console', async () => { if (p.errors.length) throw new Error(p.errors.join('; ')); });
      results.push({ name: `${tag}: where each command was reached`, ok: true, d: Object.entries(where).map(([k, v]) => `${k} ${v}`).join(', ') });
      await p.close();
    }
  }

  // 3. axe-core on the two rows with each More menu open, on a phone and a tablet, in both themes (WS-U-034)
  const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  for (const [arch, path] of ARCHS) {
    for (const size of [[360, 800, true], [768, 1024, true]]) {
      for (const scheme of ['light', 'dark']) {
        await check(`${arch} ${size[0]} px ${scheme}: the rows and their open More menus pass the axe-core scan`, async () => {
          const p = await open(size, path, scheme);
          await p.eval(`${axe}; true`);
          const found = [];
          for (const cmd of ['moreHeader', 'moreToolbar']) {
            const shown = await p.eval(`(() => { const d = document.querySelector('[data-cmd="${cmd}"]'); if (d.hidden) return false; d.open = true; return true; })()`);
            if (!shown) continue;
            // the open menu's own row: an open drop-down covers the row below it, as it should (axe target-size would count that)
            const row = cmd === 'moreHeader' ? '.app-header' : '.toolbar';
            const r = await p.eval(`axe.run({ include: [['${row}']] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} } })
              .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`);
            found.push(...r.map((v) => `${cmd} ${v}`));
            await p.eval(`document.querySelector('[data-cmd="${cmd}"]').open = false, true`);
          }
          await p.close();
          if (found.length) throw new Error(found.join('; '));
        });
      }
    }
  }

  // 4. a resize: phone, then desktop; every control comes back to its row
  await check('resize: 1440 -> 360 -> 1440 px, every control back in its row and the More menus hidden', async () => {
    const p = await open([1440, 900, false], '');
    const at = async (w, h, mobile) => { await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); await sleep(400); };
    const inMenus = `document.querySelectorAll('details.ovf .ovf-body > *').length`;
    await at(360, 800, true);
    const n = await p.eval(inMenus);
    const l = await p.eval(LAYOUT);
    await at(1440, 900, false);
    const back = await p.eval(inMenus);
    const shown = await p.eval(`[...document.querySelectorAll('details.ovf')].filter((d) => !d.hidden).length`);
    await p.close();
    if (!n) throw new Error('nothing moved at 360 px');
    if (l.problems.length) throw new Error(l.problems.join('; '));
    if (back || shown) throw new Error(`${back} control(s) still in a menu, ${shown} menu(s) shown`);
    return `${n} control(s) moved at 360 px and back`;
  });
} finally {
  await b.close();
  server.close();
}
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.d ? ` — ${r.d}` : ''}${r.e ? ` — ${r.e}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} ok, ${failed} failed (${b.version})`);
process.exit(failed ? 1 : 0);
