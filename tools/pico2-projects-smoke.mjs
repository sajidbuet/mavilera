// pico2-projects-smoke.mjs -- projects in the pico2 module (pico2 P1-F1, docs/architecture/pico2-p1f1-projects.md, research
// decision D31), in a real browser: a fresh page opens a project; three assembly files are made in the explorer, edited
// and built together (the entry first); a step follows the running line into another file's tab; an error is located in
// its file; rename, delete with undo and the entry; the project is kept across a reload (IndexedDB); export to .zip and
// import back give the same files; a share link v2 opens as a new project with the same files; the Projects dialog lists,
// opens and deletes; a new .c file is Pico SDK C (Pico Full, P1-L1); axe-core finds nothing with the explorer form and the
// dialog open. The page opens in Pico Full (?edition=full).
//
//   node tools/pico2-projects-smoke.mjs [--browser chrome|edge]
//
// Development only (axe-core is a dev dependency, THIRD_PARTY.md); nothing here is part of the site.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];

const FILES = {
  'main.s': '        .text\n_start: call    blink\n        call    pause\n        ebreak\n',
  'blink.s': 'blink:  li      a0, 25          # the LED pin\n        ret\n',
  'delay.s': 'pause:  li      t0, 3\nspin:   addi    t0, t0, -1\n        bnez    t0, spin\n        ret\n',
};
const C_MAIN = '#include <rp2350.h>\n\nint main(void) {\n    return 0;\n}\n';

// page-side helpers, as expressions
const J = JSON.stringify;
const messages = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const fileNames = `[...document.querySelectorAll('.proj-file .proj-file-name')].map((x) => x.textContent)`;
const activeTab = `document.querySelector('.ed-tabs [role=tab][aria-selected=true]')?.dataset.name`;
const activeArea = `document.querySelector('.ed-panel:not([hidden]) textarea.ed-input')`;
const ACTS = { 'New file': 'new', Rename: 'rename', Duplicate: 'duplicate', 'Make entry': 'entry', Delete: 'delete' }; // the explorer's icon buttons
const act = (label) => `document.querySelector('.proj-acts [data-act="${ACTS[label]}"]').click()`;
const menuItem = (label) => `(() => { const m = document.querySelector('.proj-menu'); m.open = true; [...m.querySelectorAll('.menu-list button')].find((b) => b.textContent === ${J(label)}).click(); return true; })()`;
const formSubmit = (value) => `(() => { const i = document.querySelector('.proj-form input'); i.value = ${J(value)}; document.querySelector('.proj-form button[type=submit]').click(); return true; })()`;
const openFile = (name) => `[...document.querySelectorAll('.proj-file')].find((b) => b.querySelector('.proj-file-name').textContent === ${J(name)}).click()`;
const setText = (text) => `(() => { const a = ${activeArea}; a.value = ${J(text)}; a.dispatchEvent(new Event('input')); return true; })()`;
const idbProjects = `new Promise((res, rej) => { const r = indexedDB.open('mavilera-projects'); r.onerror = () => rej(r.error);
  r.onsuccess = () => { const q = r.result.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => { res(q.result); r.result.close(); }; }; })`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
try {
  for (const name of BROWSERS) {
    const b = await launch(name);
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    console.log(`${name} (${b.version}), pico2 projects`);
    const check = async (label, fn) => {
      try { const r = await fn(); console.log(`  ok   ${label}${r ? ` — ${r}` : ''}`); } catch (e) { failed++; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    try {
      const p = await b.newPage({ width: 1366, height: 768 });
      const page = `${origin}?arch=pico2&edition=full`;
      const fresh = `localStorage.clear(); new Promise((r) => { const d = indexedDB.deleteDatabase('mavilera-projects'); d.onsuccess = d.onerror = d.onblocked = () => r(true); })`;
      await p.goto(page);

      await check('migration: a program kept before projects (assembly and C, C in use) becomes the project "My program", C the entry', async () => {
        await p.eval(fresh);
        await p.eval(`localStorage.setItem('pips.pico2.source', ${J(FILES['blink.s'])}); localStorage.setItem('pips.pico2.source.c', ${J(C_MAIN)});
          localStorage.setItem('pips.pico2.lang', 'c'); true`);
        await p.goto(page);
        await p.waitFor(`document.querySelector('.proj-explorer .proj-file')`);
        await p.waitFor(`${messages}.includes('My program')`);
        const names = await p.eval(fileNames);
        const entry = await p.eval(`document.querySelector('.proj-entry').closest('.proj-file').querySelector('.proj-file-name').textContent`);
        const stored = (await p.eval(idbProjects))[0];
        const kept = await p.eval(`localStorage.getItem('pips.pico2.source') !== null`);
        if (names.join() !== 'main.c,main.s' || entry !== 'main.c') throw new Error(`files ${names}, entry ${entry}`);
        if (stored.files.find((f) => f.name === 'main.s').text !== FILES['blink.s'] || stored.files.find((f) => f.name === 'main.c').text !== C_MAIN) throw new Error('texts differ');
        if (!kept) throw new Error('the old localStorage key was removed');
        return `${stored.name}: ${names}, entry ${entry}; old keys kept`;
      });

      await p.eval(fresh);
      await p.goto(page);
      await p.waitFor(`document.querySelector('.proj-explorer .proj-file') && document.querySelector('table.listing tbody tr')`);
      p.errors.length = 0;

      await check('the Files pane is its own pane left of the editor and folds (author, 2026-11-09)', async () => {
        const geo = await p.eval(`(() => { const x = document.querySelector('[data-pane="explorer"]'), e = document.querySelector('[data-pane="editor"]');
          return x && e ? { x: x.getBoundingClientRect().right, e: e.getBoundingClientRect().left, w: x.getBoundingClientRect().width,
            inEditor: Boolean(e.querySelector('.proj-explorer')) } : null; })()`);
        if (!geo) throw new Error('no explorer pane');
        if (geo.inEditor || geo.x > geo.e + 1) throw new Error(`explorer not left of the editor: ${JSON.stringify(geo)}`);
        await p.eval(`document.querySelector('[data-pane="explorer"] .pane-toggle, .p-explorer .pane-toggle').click(); true`);
        await p.waitFor(`document.querySelector('[data-pane="explorer"]').classList.contains('collapsed') || document.querySelector('.p-explorer').classList.contains('collapsed')`);
        await p.eval(`document.querySelector('[data-pane="explorer"] .pane-toggle, .p-explorer .pane-toggle').click(); true`);
        await p.waitFor(`!document.querySelector('.p-explorer').classList.contains('collapsed')`);
        return `${Math.round(geo.w)} px wide, left of the editor; folds and opens`;
      });

      await check('a fresh page opens a project with the example as main.s, the entry', async () => {
        const names = await p.eval(fileNames);
        const entry = await p.eval(`document.querySelector('.proj-file .proj-entry')?.closest('.proj-file').querySelector('.proj-file-name').textContent`);
        if (names.join() !== 'main.s' || entry !== 'main.s') throw new Error(`files ${names}, entry ${entry}`);
        return `${await p.eval(`document.querySelector('.proj-name').textContent`)}: ${names}`;
      });

      await check('three files made in the explorer, edited, and built together (the entry first)', async () => {
        await p.eval(setText(FILES['main.s']));
        for (const f of ['blink.s', 'delay.s']) {
          await p.eval(act('New file')); await p.eval(formSubmit(f));
          await p.waitFor(`${activeTab} === ${J(f)}`);
          await p.eval(setText(FILES[f]));
        }
        await p.eval(`document.querySelector('.tool-build').click(); true`);
        await p.waitFor(`${messages}.includes('Assembled')`);
        const names = await p.eval(fileNames);
        if (names.join() !== 'main.s,blink.s,delay.s') throw new Error(`files ${names}`);
        const tabs = await p.eval(`[...document.querySelectorAll('.ed-tabs [role=tab]')].map((t) => t.dataset.name).join()`);
        return `${(await p.eval(messages)).split('\n').find((x) => x.includes('Assembled')).trim()}; tabs ${tabs}`;
      });

      await check('a step follows the running line into the tab of another file', async () => {
        await p.eval(openFile('main.s'));
        await p.waitFor(`${activeTab} === 'main.s'`);
        for (let i = 0; i < 4 && (await p.eval(activeTab)) !== 'blink.s'; i++) await p.eval(`document.querySelector('.tool-step').click(); true`);
        const t = await p.eval(activeTab);
        if (t !== 'blink.s') throw new Error(`active tab ${t}`);
        const line = await p.eval(`document.querySelector('.ed-panel:not([hidden]) .ed-cur, .ed-panel:not([hidden]) [class*=current]') ? 'marked' : 'no marker class found'`);
        return `now in blink.s (${line})`;
      });

      await check('an error is located in its file: the console names delay.s, its editor is marked invalid', async () => {
        await p.eval(openFile('delay.s'));
        await p.eval(setText(FILES['delay.s'].replace('li      t0, 3', 'lix     t0, 3')));
        await p.eval(`document.querySelector('.tool-build').click(); true`);
        await p.waitFor(`${messages}.includes('delay.s')`);
        const invalid = await p.eval(`${activeArea}.getAttribute('aria-invalid')`);
        const mainInvalid = await p.eval(`(() => { const a = [...document.querySelectorAll('.ed-panel')].find((x) => x.getAttribute('aria-labelledby') === document.querySelector('.ed-tabs [role=tab][data-name="main.s"]').id); return a.querySelector('textarea').getAttribute('aria-invalid'); })()`);
        if (invalid !== 'true' || mainInvalid === 'true') throw new Error(`delay.s aria-invalid ${invalid}, main.s ${mainInvalid}`);
        await p.eval(setText(FILES['delay.s']));
        return (await p.eval(messages)).split('\n').find((x) => x.includes('delay.s')).trim().slice(0, 80);
      });

      await check('rename (delay.s → wait.s), delete with undo, and the entry: the project builds after each', async () => {
        await p.eval(openFile('delay.s'));
        await p.eval(act('Rename')); await p.eval(formSubmit('wait.s'));
        await p.waitFor(`${fileNames}.join() === 'main.s,blink.s,wait.s'`);
        await p.waitFor(`${messages}.includes('Assembled')`);
        await p.eval(openFile('blink.s'));
        await p.eval(act('Delete'));
        await p.eval(`document.querySelector('.proj-form .proj-danger').click(); true`);
        await p.waitFor(`${fileNames}.join() === 'main.s,wait.s'`);
        const missing = await p.eval(messages);
        await p.eval(`[...document.querySelectorAll('.proj-msg button')].find((x) => x.textContent === 'Undo').click(); true`);
        await p.waitFor(`${fileNames}.join() === 'main.s,blink.s,wait.s'`);
        await p.waitFor(`${messages}.includes('Assembled')`);
        await p.eval(openFile('wait.s')); await p.eval(act('Make entry'));
        await p.waitFor(`document.querySelector('.proj-on .proj-entry') !== null`);
        await p.eval(openFile('main.s')); await p.eval(act('Make entry'));
        await p.waitFor(`document.querySelector('.proj-on .proj-entry') !== null`);
        return `without blink.s: ${/blink/.test(missing) ? 'an error naming blink' : 'built'}; undo restored it`;
      });

      let before = null;
      await check('the project is kept across a reload (IndexedDB), texts unchanged', async () => {
        await p.waitFor(`document.querySelector('.proj-status').textContent === 'Saved'`);
        before = (await p.eval(idbProjects))[0];
        await p.goto(page);
        await p.waitFor(`document.querySelector('.proj-explorer .proj-file')`);
        const after = (await p.eval(idbProjects))[0];
        const names = await p.eval(fileNames);
        if (names.join() !== 'main.s,blink.s,wait.s') throw new Error(`files after reload ${names}`);
        if (JSON.stringify(after.files) !== JSON.stringify(before.files)) throw new Error('stored files differ');
        await p.eval(openFile('wait.s'));
        const text = await p.eval(`${activeArea}.value`);
        if (text !== FILES['delay.s']) throw new Error('wait.s text differs');
        return `${after.files.length} files, ${after.name}`;
      });

      await check('exit walkthrough: export .zip, delete the project, re-import: files, name and entry unchanged; a re-export is byte-identical', async () => {
        await p.eval(openFile('wait.s')); await p.eval(act('Make entry')); // an entry that is not main.*, so that it must travel in the archive
        await p.waitFor(`document.querySelector('.proj-on .proj-entry') !== null`);
        await p.waitFor(`document.querySelector('.proj-status').textContent === 'Saved'`);
        const orig = (await p.eval(idbProjects))[0];
        await p.eval(`window.__blobs = []; const o = URL.createObjectURL; URL.createObjectURL = (x) => { window.__blobs.push(x); return o.call(URL, x); }; true`);
        await p.eval(menuItem('Export .zip'));
        await p.waitFor(`window.__blobs.length === 1`);
        await p.eval(`window.__bytes = (b) => b.arrayBuffer().then((a) => Array.from(new Uint8Array(a))); true`);
        const first = await p.eval(`window.__bytes(window.__blobs[0])`);
        await p.eval(menuItem('Delete project…'));
        await p.eval(`document.querySelector('.proj-form .proj-danger').click(); true`);
        await p.waitFor(`document.querySelector('.proj-name').textContent !== ${J(orig.name)} || ${fileNames}.join() !== 'main.s,blink.s,wait.s'`);
        const left = await p.eval(idbProjects);
        if (left.some((x) => x.id === orig.id)) throw new Error('the project is still stored');
        await p.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([window.__blobs[0]], 'downloaded (1).zip', { type: 'application/zip' }));
          const i = document.querySelector('.proj-explorer input[type=file]'); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()`);
        await p.waitFor(`document.querySelector('.proj-name').textContent === ${J(orig.name)} && ${fileNames}.join() === 'main.s,blink.s,wait.s'`);
        await p.waitFor(`document.querySelector('.proj-status').textContent === 'Saved'`);
        const back = (await p.eval(idbProjects)).find((x) => x.name === orig.name);
        if (JSON.stringify(back.files) !== JSON.stringify(orig.files)) throw new Error('re-imported files differ');
        if (back.entry !== orig.entry) throw new Error(`entry ${back.entry}, was ${orig.entry}`);
        await p.eval(menuItem('Export .zip'));
        await p.waitFor(`window.__blobs.length === 2`);
        const second = await p.eval(`window.__bytes(window.__blobs[1])`);
        if (second.length !== first.length || second.some((x, i) => x !== first[i])) throw new Error('the re-export differs from the first export');
        const entryShown = await p.eval(`document.querySelector('.proj-entry').closest('.proj-file').dataset.name`);
        if (entryShown !== orig.entry) throw new Error(`explorer shows entry ${entryShown}`);
        await p.eval(openFile('main.s')); await p.eval(act('Make entry'));
        await p.waitFor(`document.querySelector('.proj-on .proj-entry') !== null`);
        return `${first.length} bytes; "${orig.name}", ${back.files.length} files, entry ${back.entry}; re-export identical`;
      });

      await check('a share link v2 opens as a new project with the same files', async () => {
        await p.eval(`navigator.clipboard.writeText = (t) => { window.__link = t; return Promise.resolve(); }; true`);
        await p.eval(`[...document.querySelectorAll('button')].find((x) => x.textContent === 'Copy share link').click(); true`);
        await p.waitFor(`typeof window.__link === 'string'`);
        const link = await p.eval(`window.__link`);
        if (!/#rv2z\./.test(link)) throw new Error(`not a v2 link: ${link.slice(0, 60)}`);
        const q = await b.newPage({ width: 1366, height: 768 });
        await q.goto(link);
        await q.waitFor(`[...document.querySelectorAll('.messages li')].some((l) => l.textContent.includes('new project'))`);
        const names = await q.eval(fileNames);
        const all = await q.eval(idbProjects);
        await q.close();
        if (names.join() !== 'main.s,blink.s,wait.s') throw new Error(`files ${names}`);
        return `${link.length} characters; ${all.length} projects stored`;
      });

      await check('the Projects dialog lists, opens and deletes projects', async () => {
        await p.goto(page);
        await p.waitFor(`document.querySelector('.proj-explorer .proj-file')`);
        await p.eval(menuItem('Open project…'));
        await p.waitFor(`document.querySelector('.projects-dialog[open] .proj-dlg-item')`);
        const n = await p.eval(`document.querySelectorAll('.proj-dlg-item').length`);
        await p.eval(`document.querySelector('.projects-dialog .proj-dlg-item .proj-danger').click(); true`);
        await p.eval(`document.querySelector('.projects-dialog .proj-form-btns .proj-danger').click(); true`);
        await p.waitFor(`document.querySelectorAll('.proj-dlg-item').length === ${n - 1}`);
        await p.eval(`document.querySelector('.projects-dialog .proj-dlg-open').click(); true`);
        await p.waitFor(`!document.querySelector('.projects-dialog[open]')`);
        return `${n} listed, one deleted, one opened (${await p.eval(`document.querySelector('.proj-name').textContent`)})`;
      });

      await check('Pico Full\'s C is the Pico SDK\'s (P1-L1, D34 Q6): a new .c file starts with the SDK example; no compiler choice, no C subset options', async () => {
        await p.eval(act('New file')); await p.eval(formSubmit('app.c'));
        await p.waitFor(`${activeTab} === 'app.c'`);
        const text = await p.eval(`${activeArea}.value`);
        if (!text.includes('#include "pico/stdlib.h"')) throw new Error(`app.c starts with ${JSON.stringify(text.slice(0, 60))}`);
        const choice = await p.eval(`document.querySelectorAll('[data-compiler]').length`);
        const opts = await p.eval(`!document.querySelector('.cc-opts')?.hidden`);
        if (choice || opts) throw new Error(`compiler choices ${choice}, C subset options shown ${opts}`);
        return text.split('\n')[0];
      });

      await check('the explorer by keyboard: Down opens the next file, F2 asks to rename it, Escape closes; a double click renames; icons named', async () => {
        await p.eval(`document.querySelector('.proj-file').click(); document.querySelector('.proj-file').focus(); true`);
        const first = await p.eval(activeTab);
        await p.key('ArrowDown', { code: 'ArrowDown', keyCode: 40 });
        await p.waitFor(`${activeTab} !== ${J(first)}`);
        const second = await p.eval(activeTab);
        const focused = await p.eval(`document.activeElement?.dataset?.name`);
        await p.key('F2', { code: 'F2', keyCode: 113 });
        await p.waitFor(`document.querySelector('.proj-form input')?.value === ${J(second)}`);
        await p.key('Escape', { code: 'Escape', keyCode: 27 });
        await p.waitFor(`document.querySelector('.proj-form').hidden`);
        await p.eval(`document.querySelector('.proj-file.proj-on').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true`);
        await p.waitFor(`document.querySelector('.proj-form input')?.value === ${J(second)}`);
        await p.eval(`document.querySelector('.proj-form button[type=button]').click(); true`);
        const labels = await p.eval(`[...document.querySelectorAll('.proj-acts button')].map((b) => b.getAttribute('aria-label')).join(' | ')`);
        if (focused !== second || !labels.includes(`Rename ${second}`)) throw new Error(`focus ${focused}, labels ${labels}`);
        return `${first} → ${second}; ${labels}`;
      });

      await check('axe-core: no violations with the explorer form and the Projects dialog open', async () => {
        await p.eval(AXE);
        const run = `axe.run({ exclude: [['svg.pz-svg']] }, { runOnly: { type: 'tag', values: ${J(AXE_TAGS)} }, resultTypes: ['violations'] })
          .then((r) => r.violations.map((x) => \`\${x.id} (\${x.impact}, \${x.nodes.length}: \${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')})\`))`;
        await p.eval(act('Rename'));
        const v1 = await p.eval(run);
        await p.eval(`document.querySelector('.proj-form button[type=button]').click(); true`);
        await p.eval(menuItem('Open project…'));
        await p.waitFor(`document.querySelector('.projects-dialog[open]')`);
        const v2 = await p.eval(run);
        await p.eval(`document.querySelector('.projects-dialog').close(); true`);
        const v = [...v1, ...v2];
        if (v.length) throw new Error(v.join('; '));
        return 'form and dialog clean';
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
