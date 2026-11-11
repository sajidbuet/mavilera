// pico2-lite-smoke.mjs -- Pico Lite in a real browser (pico2 P1-L1, docs/architecture/pico2-p1l1-lite.md §4.2, research
// decision D34). Exit walkthrough (roadmap): template → build → run → C line view, without any file dialog. A fresh page
// opens in Lite (the switch says so; no Files pane, one primary button); the "Hello in C" template opens in the Instructions view (research D38: the C source
// view; an edit turns the primary button into Build, a click builds, the next runs (Pause while running), the end gives
// Run again; Step line in the toolbar steps the editor's C lines, a breakpoint in the editor's gutter stops a run; the text is kept across a
// reload; Save gives hello.c; a built program (.uf2) and a project (.zip) are refused with the reason; the switch reloads in
// Full and back with the Lite text unchanged; Open in Full copies an assembly program into a Full project; a project's
// link opened in Lite goes to Full; axe-core finds nothing in Lite with a C program. The C source view's tab is not offered (images only). No file chooser is opened
// at any point (the page's file inputs and pickers are counted).
//
//   node tools/pico2-lite-smoke.mjs [--browser chrome|edge] [--shots dir]
//
// Development only (axe-core is a dev dependency, THIRD_PARTY.md); nothing here is part of the site.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const HELLO = readFileSync(new URL('../content/pico2/templates/hello.c', import.meta.url), 'utf8');
const lineOf = (text, s) => text.split('\n').findIndex((l) => l.includes(s)) + 1;
const BP_LINE = lineOf(HELLO, 'print_num(i * i);');
const MAIN_LINE = lineOf(HELLO, 'int main(void)');
const SAY_LINE = lineOf(HELLO, 'print("Hello, Pico 2!');

const J = JSON.stringify;
const messages = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const primary = `document.querySelector('.tool-run')?.getAttribute('aria-label')`;
const area = `document.querySelector('textarea.ed-input')`;
const setText = (t) => `(() => { const a = ${area}; a.value = ${J(t)}; a.dispatchEvent(new Event('input')); return true; })()`;
const edition = `[...document.querySelectorAll('.edition-switch button')].map((b) => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')).join(' ')`;
const clickEdition = (label) => `[...document.querySelectorAll('.edition-switch button')].find((b) => b.textContent === ${J(label)}).click()`;
const fileMenu = (label) => `(() => { const m = [...document.querySelectorAll('details.menu')].find((d) => d.querySelector('summary')?.textContent.trim() === 'File');
  m.open = true; const b = [...m.querySelectorAll('.menu-list button')].find((x) => x.textContent.startsWith(${J(label)})); b.click(); return true; })()`;
const edNow = `document.querySelector('.ed-gutter .ed-num-cur')?.dataset.n`; // the editor's running line (D38)
// every way this page could open a file chooser, counted (none may be used in Lite's walkthrough)
const GUARD = `(() => { if (window.__guard) return true; window.__guard = true; window.__dialogs = 0;
  const c = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__dialogs++; return; } return c.call(this); };
  const sp = HTMLInputElement.prototype.showPicker; HTMLInputElement.prototype.showPicker = function () { if (this.type === 'file') { window.__dialogs++; return; } return sp?.call(this); };
  window.showOpenFilePicker = () => { window.__dialogs++; return Promise.reject(new Error('blocked')); };
  window.showDirectoryPicker = () => { window.__dialogs++; return Promise.reject(new Error('blocked')); };
  window.__saved = []; const a = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__saved.push(this.download); return; } return a.call(this); };
  return true; })()`;
const dialogs = `window.__dialogs`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
try {
  for (const name of BROWSERS) {
    const b = await launch(name);
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    console.log(`${name} (${b.version}), Pico Lite`);
    const check = async (label, fn) => {
      try { const r = await fn(); console.log(`  ok   ${label}${r ? ` — ${r}` : ''}`); } catch (e) { failed++; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    try {
      const p = await b.newPage({ width: 1366, height: 768 });
      const page = `${origin}?arch=pico2`;
      const ready = `document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`;
      const load = async (u = page) => { await p.goto(u); await p.waitFor(ready); await p.eval(GUARD); };
      await p.goto(page);
      await p.eval(`localStorage.clear(); new Promise((r) => { const d = indexedDB.deleteDatabase('mavilera-projects'); d.onsuccess = d.onerror = d.onblocked = () => r(true); })`);
      await load();
      p.errors.length = 0;

      // the author, 2026-11-11 (GUI walkthrough): Build stands beside the state-aware Run in Lite too
      await check('a fresh page opens in Lite: the switch shows it, one file without the Files pane, Build beside the state-aware Run', async () => {
        const ed = await p.eval(edition);
        const files = await p.eval(`Boolean(document.querySelector('.proj-explorer'))`);
        const build = await p.eval(`Boolean(document.querySelector('.toolbar .tool-build')?.checkVisibility())`);
        const lab = await p.eval(primary);
        if (ed !== 'Lite* Full' || files || !build || !/^Run\b/.test(lab)) throw new Error(`switch ${ed}, Files pane ${files}, Build button ${build}, primary ${lab}`);
        return `switch "${ed}"; primary "${lab}"; stored edition ${await p.eval(`localStorage.getItem('pips.pico2.edition')`)}`;
      });

      await check('the template "Hello in C" opens in the Instructions view, built, with Step line and Back line; no C source tab (D38)', async () => {
        await p.eval(`(() => { const m = document.querySelector('details.templates-menu'); m.open = true; return true; })()`);
        await p.waitFor(`[...document.querySelectorAll('.templates-menu .menu-list button')].some((b) => b.textContent === 'Hello in C')`);
        const groups = await p.eval(`[...document.querySelectorAll('.templates-menu .menu-head')].map((h) => h.textContent).join(' | ')`);
        const n = await p.eval(`document.querySelectorAll('.templates-menu .menu-list button').length`);
        await p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => b.textContent === 'Hello in C').click(); true`);
        await p.waitFor(`${area}.value.includes('Squares')`);
        await p.waitFor(`document.querySelector('.mode-btn[aria-selected=true]')?.textContent.includes('Instructions')`);
        await p.waitFor(`${messages}.includes('Compiled')`, 30000);
        await p.waitFor(`!document.querySelector('[data-cmd=lineStep]').hidden && !document.querySelector('[data-cmd=lineBack]').hidden`);
        const sourceTab = await p.eval(`[...document.querySelectorAll('.mode-btn')].find((b) => b.textContent.includes('C source'))?.hidden ?? 'absent'`);
        if (sourceTab !== true && sourceTab !== 'absent') throw new Error('the C source tab is offered for a program built in the browser');
        return `${n - 1} templates in ${groups}; Step line and Back line in the toolbar; C source tab hidden`;
      });
      await check('Build and Run: after an edit Run still reads Run and Build builds; Run runs (Pause while running), the end gives Run again; Run on a changed text builds first', async () => {
        const seen = [];
        await p.eval(setText(HELLO.replace('i <= 5', 'i <= 9')));
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'build' && /^Run\\b/.test(${primary})`); seen.push(await p.eval(primary));
        await p.eval(`document.querySelector('.tool-build').click(); true`);
        await p.waitFor(`${messages}.includes('Compiled') && document.querySelector('.tool-run').dataset.action === 'run'`, 30000); seen.push(await p.eval(primary));
        await p.eval(`window.__labels = []; new MutationObserver(() => window.__labels.push(document.querySelector('.tool-run').getAttribute('aria-label')))
          .observe(document.querySelector('.tool-run'), { attributes: true, attributeFilter: ['aria-label'] }); document.querySelector('.tool-run').click(); true`);
        await p.waitFor(`/^Run again/.test(${primary})`, 60000); seen.push(...(await p.eval(`window.__labels`)));
        const out = await p.eval(`document.querySelector('pre.console-out')?.textContent ?? ''`);
        if (!out.includes('Squares: 1 4 9 16 25 36 49 64 81')) throw new Error(`console ${J(out)}`);
        if (!seen.some((x) => /^Pause/.test(x))) throw new Error(`no Pause while running: ${seen.join(' → ')}`);
        await p.eval(`document.querySelector('.tool-run').click(); true`); // Run again: reset, then run
        await p.waitFor(`/^Run again/.test(${primary}) && (document.querySelector('pre.console-out')?.textContent.match(/Squares/g) ?? []).length === 1`, 20000)
          .catch(async () => { throw new Error(`after Run again: "${await p.eval(primary)}", console ${J(await p.eval(`document.querySelector('pre.console-out')?.textContent`))}`); });
        // Run on a changed text: one click builds and runs
        await p.eval(setText(HELLO.replace('i <= 5', 'i <= 3')));
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'build'`);
        await p.eval(`document.querySelector('.tool-run').click(); true`);
        await p.waitFor(`/^Run again/.test(${primary}) && /Squares: 1 4 9\\s*$/m.test(document.querySelector('pre.console-out')?.textContent ?? '')`, 60000)
          .catch(async () => { throw new Error(`Run on a changed text: "${await p.eval(primary)}", console ${J(await p.eval(`document.querySelector('pre.console-out')?.textContent`))}`); });
        await p.eval(setText(HELLO.replace('i <= 5', 'i <= 9'))); // as the next checks expect it
        await p.eval(`document.querySelector('.tool-build').click(); true`);
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'run'`, 30000);
        return [...new Set(seen)].join(' → ');
      });

      await check('Step line follows the C lines in the editor; Back line returns; a breakpoint in the editor\'s gutter stops the run there', async () => {
        await p.eval(`document.querySelector('[data-cmd=reset]').click(); true`);
        await p.eval(`document.querySelector('[data-cmd=lineStep]').click(); true`);
        await p.waitFor(`${edNow} === ${J(String(MAIN_LINE))}`);
        await p.eval(`document.querySelector('[data-cmd=lineStep]').click(); true`);
        await p.waitFor(`${edNow} === ${J(String(SAY_LINE))}`);
        await p.eval(`document.querySelector('[data-cmd=lineBack]').click(); true`);
        await p.waitFor(`${edNow} === ${J(String(MAIN_LINE))}`);
        await p.eval(`document.querySelector('.ed-gutter .ed-num[data-n="${BP_LINE}"]').click(); true`);
        await p.waitFor(`document.querySelector('.ed-gutter .ed-num[data-n="${BP_LINE}"]')?.classList.contains('ed-num-bp')`);
        await p.eval(`document.querySelector('.tool-run').click(); true`);
        await p.waitFor(`${edNow} === ${J(String(BP_LINE))}`, 30000);
        await p.eval(`document.querySelector('.ed-gutter .ed-num[data-n="${BP_LINE}"]').click(); true`); // breakpoint off
        if (await p.eval(dialogs)) throw new Error(`${await p.eval(dialogs)} file dialog(s)`);
        return `lines ${MAIN_LINE} → ${SAY_LINE} → back to ${MAIN_LINE}; then stopped at line ${BP_LINE}; file dialogs 0`;
      });
      await check('axe-core: no violations in Lite with a C program in the Instructions view', async () => {
        await p.eval(AXE);
        // excluded: the drawings, as module-smoke (the shell findings of pico2-p1l1-lite.md §8 are fixed: research D35)
        const v = await p.eval(`axe.run({ exclude: [['svg.pz-svg']] }, { runOnly: { type: 'tag', values: ${J(AXE_TAGS)} }, resultTypes: ['violations'] })
          .then((r) => r.violations.map((x) => \`\${x.id} (\${x.impact}, \${x.nodes.length}: \${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')})\`))`);
        if (v.length) throw new Error(v.join('; '));
        if (opt('--shots')) { mkdirSync(opt('--shots'), { recursive: true }); writeFileSync(join(opt('--shots'), `pico2-lite-${name}.png`), await p.screenshot()); }
        return 'clean';
      });

      let text = null;
      await check('auto-save: the text is kept across a reload; Save gives the file under its name (hello.c)', async () => {
        text = await p.eval(`${area}.value`);
        await load();
        await p.waitFor(`${area}.value.includes('Squares')`);
        if (await p.eval(`${area}.value`) !== text) throw new Error('the text differs after the reload');
        await p.eval(fileMenu('Save'));
        await p.waitFor(`window.__saved.length === 1`);
        const saved = await p.eval(`window.__saved[0]`);
        if (saved !== 'hello.c') throw new Error(`saved as ${saved}`); // the template's file name
        return `${text.length} characters kept; saved as ${saved}`;
      });

      await check('Lite refuses a built program (.uf2) and a project (.zip) with the reason (no file dialog: the file arrives by its input)', async () => {
        const give = (n) => `(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(512)], ${J(n)})); const i = document.querySelector('.toolbar input[type=file]');
          i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()`;
        await p.eval(give('blink.uf2'));
        await p.waitFor(`${messages}.includes('belong to Pico Full')`);
        const accept = await p.eval(`document.querySelector('.toolbar input[type=file]').accept`);
        await p.eval(`document.querySelector('.messages')?.replaceChildren(); true`);
        await p.eval(give('project.zip'));
        await p.waitFor(`${messages}.includes('belong to Pico Full')`);
        if (/uf2|elf|zip/.test(accept)) throw new Error(`the file input accepts ${accept}`);
        if (await p.eval(dialogs)) throw new Error('a file dialog was opened');
        return `accept ${accept}`;
      });

      await check('the switch reloads in Full (projects) and back in Lite: the Lite text is unchanged', async () => {
        await p.eval(clickEdition('Full'));
        await p.waitFor(`document.querySelector('.proj-explorer .proj-file') && document.querySelector('.edition-switch [aria-pressed=true]')?.textContent === 'Full'`, 20000);
        const full = await p.eval(`({ files: [...document.querySelectorAll('.proj-file')].map((x) => x.dataset.name).join(), build: Boolean(document.querySelector('.toolbar .tool-build')) })`);
        if (!full.build) throw new Error('Full has no Build button');
        await p.eval(clickEdition('Lite'));
        await p.waitFor(`!document.querySelector('.proj-explorer') && document.querySelector('.edition-switch [aria-pressed=true]')?.textContent === 'Lite' && ${area}`, 20000);
        await p.eval(GUARD);
        await p.waitFor(`${area}.value.includes('Squares')`);
        if (await p.eval(`${area}.value`) !== text) throw new Error('the Lite text changed');
        return `Full: files ${full.files}; back in Lite with the same text`;
      });

      await check('Open in Full copies an assembly program into a new Full project; a MAVILERA C program stays (reason given)', async () => {
        // the page after the switch must have finished starting (the start's build and replay clear the console)
        await p.waitFor(`!document.getElementById('boot') && ${messages}.includes('Back where you were')`, 20000).catch(() => {});
        await p.eval(fileMenu('Open in Full'));
        await p.waitFor(`${messages}.includes('stay in Lite')`, 10000)
          .catch(async () => { throw new Error(`no reason given; edition ${await p.eval(edition)}, messages ${J(await p.eval(messages))}`); });
        await p.eval(`(() => { const m = document.querySelector('details.templates-menu'); m.open = true; return true; })()`);
        await p.waitFor(`[...document.querySelectorAll('.templates-menu .menu-list button')].some((b) => b.textContent === 'Hello over UART')`);
        await p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => b.textContent === 'Hello over UART').click(); true`);
        await p.waitFor(`${area}.value.includes('hello-uart.s') && ${messages}.includes('Assembled')`);
        await p.eval(GUARD);
        await p.eval(fileMenu('Open in Full'));
        await p.waitFor(`document.querySelector('.edition-switch [aria-pressed=true]')?.textContent === 'Full' && document.querySelector('.proj-explorer .proj-file')`, 20000);
        await p.waitFor(`${messages}.includes('is now the project')`);
        const files = await p.eval(`[...document.querySelectorAll('.proj-file')].map((x) => x.dataset.name).join()`);
        const name = await p.eval(`document.querySelector('.proj-name').textContent`);
        if (files !== 'hello-uart.s') throw new Error(`files ${files}`);
        return `project "${name}": ${files}`;
      });

      await check('a project\'s link (v2) opened in Lite goes to Full', async () => {
        await p.eval(`navigator.clipboard.writeText = (t) => { window.__link = t; return Promise.resolve(); }; true`);
        await p.eval(`[...document.querySelectorAll('button')].find((x) => x.textContent === 'Copy share link').click(); true`);
        await p.waitFor(`typeof window.__link === 'string'`);
        const link = await p.eval(`window.__link`);
        await p.eval(`localStorage.setItem('pips.pico2.edition', 'lite'); true`);
        const q = await b.newPage({ width: 1366, height: 768 });
        await q.goto(link);
        await q.waitFor(`document.querySelector('.edition-switch [aria-pressed=true]')?.textContent === 'Full' && [...document.querySelectorAll('.messages li')].some((l) => l.textContent.includes('opened in Full'))`, 20000);
        const files = await q.eval(`[...document.querySelectorAll('.proj-file')].map((x) => x.dataset.name).join()`);
        await q.close();
        await p.eval(clickEdition('Lite'));
        await p.waitFor(`document.querySelector('.edition-switch [aria-pressed=true]')?.textContent === 'Lite'`, 20000);
        return `${/#rv2z\./.test(link) ? 'v2' : 'other'} link → Full, files ${files}`;
      });

      await check('no errors in the page', async () => {
        if (p.errors.length) throw new Error(p.errors.slice(0, 3).join(' | '));
      });
    } finally {
      await b.close();
    }
  }
} finally {
  server.close();
}
process.exitCode = failed ? 1 : 0;
