// cpu-gpu-smoke.mjs -- the CPU + GPU tool (GPU-7, decision G30) in a headless Chrome or Edge: the GPU Laboratory's
// "CPU + GPU" view links to riscv?tool=cpu-gpu; that page shows the views ISA, Single-cycle and GPU with the GPU
// lockup, and the switcher shows the GPU entry as current; its template runs to the end, the GPU view says the kernel
// ended and the Interface tab reads STATUS = DONE; the drawing and tabs are axe-clean in light and dark; step back
// works; the plain RISC-V page offers no CPU + GPU template; no sideways scrolling at 390 px. Screenshots with --shots.
//
//   node tools/cpu-gpu-smoke.mjs [--browser chrome|edge] [--shots dir]
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
const PREPARE = `(async () => { window.__S = (await import(new URL('ui/strings.js', document.querySelector('script[type=module][src$="main.js"]').src))).STRINGS; return true; })()`;

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
const axeRun = (sel) => `axe.run({ include: [[${JSON.stringify(sel)}]] }, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, resultTypes: ['violations'],
  rules: { 'color-contrast': { enabled: false }, 'label-content-name-mismatch': { enabled: false } } })
  .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`;

async function page(path, { width = 1366, height = 900, scheme = 'light' } = {}) {
  const p = await b.newPage({ width, height, colorScheme: scheme, reducedMotion: 'reduce' });
  await p.goto(url);
  await p.eval('localStorage.clear(); true');
  p.errors.length = 0;
  await p.goto(`${url}${path}`);
  await p.waitFor(`document.querySelector('.toolbar') && document.querySelectorAll('.mode-btn').length`);
  await p.eval(PREPARE); // the interface strings, as window.__S
  return p;
}
const modes = (p) => p.eval(`[...document.querySelectorAll('.mode-btn')].map((x) => x.textContent.trim())`);
const templateTitles = async (p) => {
  await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
  await p.waitFor(`document.querySelectorAll('.templates-menu .menu-list button').length > 10`);
  return p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].map((x) => x.textContent)`);
};

await check('the GPU Laboratory\'s CPU + GPU view links to the RISC-V page with tool=cpu-gpu', async () => {
  const p = await page('?arch=gpu');
  await p.eval(`[...document.querySelectorAll('.mode-btn')].find((x) => /CPU \\+ GPU/.test(x.textContent)).click(); true`);
  await p.waitFor(`document.querySelector('.gm-view a.btn')`);
  const href = await p.eval(`document.querySelector('.gm-view a.btn').getAttribute('href')`);
  // the default program (profile lab) as words for a host
  await p.key('Enter', { keyCode: 13, modifiers: 2 });
  await p.waitFor(`/\\.word +0x[0-9a-f]{8} +# /.test(document.querySelector('.gpu-kernel-text')?.value ?? '')`);
  must(href === '?arch=riscv&tool=cpu-gpu', href);
  await p.eval(AXE);
  const v = await p.eval(axeRun('.gm-view'));
  must(!v.length, v.join('; '));
  must(!p.errors.length, p.errors.join('; '));
  await shot(p, 'cpu-gpu-link');
  await p.close();
  return href;
});

for (const scheme of ['light', 'dark']) {
  await check(`${scheme}: the tool page, its template run to the end, the GPU view and Interface tab, step back`, async () => {
    const p = await page('?arch=riscv&tool=cpu-gpu', { scheme });
    const m = await modes(p);
    must(m.join('|') === 'ISA|Single-cycle|GPU', `views ${m.join('|')}`);
    // a first visit opens with the tool's template (its own program, not the RISC-V Laboratory's)
    await p.waitFor(`/0x50001000/.test(document.querySelector('.p-editor textarea').value)`);
    const titles = await templateTitles(p);
    must(titles.some((x) => /CPU \+ GPU/.test(x)), 'no CPU + GPU template');
    await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await p.waitFor(`document.querySelector('.gpu-core')`);
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await sleep(400);
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`/kernel ended/.test(document.querySelector('.gpu-coming')?.textContent ?? '')`, 20000);
    const line = await p.eval(`document.querySelector('.gpu-coming').textContent`);
    await p.eval(`[...document.querySelectorAll('[role=tab], .tab-btn, button')].find((x) => x.textContent.trim() === 'Interface')?.click(); true`);
    await sleep(200);
    // the waveforms offer the GPU's signals
    await p.eval(`[...document.querySelectorAll('[role=tab], .tab-btn, button')].find((x) => x.textContent.trim() === __S.wave.title)?.click(); true`);
    await p.waitFor(`document.querySelector('.wave-picker')`);
    const groups = await p.eval(`[...document.querySelectorAll('.wave-group legend')].map((l) => l.textContent)`);
    must(groups.includes(await p.eval('__S.wave.gpu')), `no GPU signals: ${groups.join(', ')}`);
    await p.eval(`[...document.querySelectorAll('[role=tab], .tab-btn, button')].find((x) => x.textContent.trim() === 'Interface')?.click(); true`);
    await sleep(200);
    const status = await p.eval(`[...document.querySelectorAll('.gpu-iface tbody tr')].find((r) => /STATUS/.test(r.textContent))?.children[2].textContent`);
    must(status === '0x00000002', `STATUS ${status}`);
    await p.eval(AXE);
    const v = await p.eval(axeRun('.npu-main'));
    must(!v.length, v.join('; '));
    await shot(p, `cpu-gpu-${scheme}`);
    // step back over the copy-back loop (about 50 cycles) into the run of the kernel: the GPU is busy again
    for (let i = 0; i < 70; i++) await p.key('F10', { keyCode: 121, modifiers: 8 });
    await sleep(300);
    const back = await p.eval(`document.querySelector('.gpu-coming').textContent`);
    must(!/kernel ended/.test(back), `after stepping back: ${back}`);
    await shot(p, `cpu-gpu-${scheme}-back`);
    must(!p.errors.length, p.errors.join('; '));
    await p.close();
    return line;
  });
}

await check('the single-cycle view of the tool draws the GPU on the data bus', async () => {
  const p = await page('?arch=riscv&tool=cpu-gpu');
  await p.eval(`[...document.querySelectorAll('.mode-btn')].find((x) => /Single-cycle/.test(x.textContent)).click(); true`);
  await p.waitFor(`[...document.querySelectorAll('svg text')].some((t) => /0x5000_1000/.test(t.textContent))`);
  await shot(p, 'cpu-gpu-single');
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
});

await check('the plain RISC-V page offers no CPU + GPU template and no GPU view', async () => {
  const p = await page('?arch=riscv');
  must(!(await modes(p)).includes('GPU'), 'a GPU view');
  must(!(await templateTitles(p)).some((x) => /CPU \+ GPU/.test(x)), 'the CPU + GPU template is offered');
  await p.close();
});

await check('the tool keeps its own program: after it, the RISC-V Laboratory still has its own', async () => {
  const p = await page('?arch=riscv&tool=cpu-gpu');
  await p.waitFor(`/0x50001000/.test(document.querySelector('.p-editor textarea').value)`);
  await sleep(600); // the program is kept
  await p.goto(`${url}?arch=riscv`);
  await p.waitFor(`document.querySelector('.p-editor textarea')`);
  must(!/0x50001000/.test(await p.eval(`document.querySelector('.p-editor textarea').value`)), 'the tool\'s program appeared in the RISC-V Laboratory');
  await p.goto(`${url}?arch=riscv&tool=cpu-gpu`);
  await p.waitFor(`/0x50001000/.test(document.querySelector('.p-editor textarea')?.value ?? '')`);
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
});

await check('390 px: the tool page does not scroll sideways', async () => {
  const p = await page('?arch=riscv&tool=cpu-gpu', { width: 390, height: 844 });
  must(!(await p.eval(`document.documentElement.scrollWidth > innerWidth + 1`)), 'sideways scroll');
  must(!p.errors.length, p.errors.join('; '));
  await p.close();
});

await b.close();
server.close();
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? (r.d ? ` — ${r.d}` : '') : `: ${r.e}`}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
