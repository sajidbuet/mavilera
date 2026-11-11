// pico2-import-smoke.mjs -- browser checks of the pico2 module's import of SDK-built programs and its C source view (P1-C1, design
// docs/architecture/pico2-p1c1-image-import.md §6): the file input accepts .uf2/.elf/.bin; a UF2 of another family is refused with
// the validator's message; hello_uart.elf is imported through the file input; the C source view, given hello_uart.c through its
// own file input, sets a breakpoint on main's first line, runs to it, steps one C line and back; an axe-core scan of the view and
// of its program map in the light and dark schemes. The firmware is the research repository's pico-examples build
// (PICO2_FIRMWARE_DIR or %LOCALAPPDATA%\pico2sim-build\pico-examples-rv), the source its pinned pico-examples clone
// (PICO2_EXAMPLES_SRC or ../pico2sim-research/upstream/src/pico-examples); the check is skipped, with the reason, without them.
//
//   node tools/pico2-import-smoke.mjs [--browser chrome|edge] [--shots dir]
//
// Exit status 1 if a check fails. Development only (axe-core is a dev dependency, THIRD_PARTY.md).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const FW = process.env.PICO2_FIRMWARE_DIR ?? join(process.env.LOCALAPPDATA ?? '', 'pico2sim-build', 'pico-examples-rv');
const SRC = process.env.PICO2_EXAMPLES_SRC ?? join(ROOT, '..', 'pico2sim-research', 'upstream', 'src', 'pico-examples');
const ELF = join(FW, 'uart/hello_uart/hello_uart.elf'), UF2 = join(FW, 'uart/hello_uart/hello_uart.uf2'), C = join(SRC, 'uart/hello_uart/hello_uart.c');
if (![ELF, UF2, C].every(existsSync)) { console.log(`skipped: needs ${[ELF, UF2, C].filter((f) => !existsSync(f)).join(', ')}`); process.exit(0); }

const b64 = (buf) => Buffer.from(buf).toString('base64');
// the UF2 with every block's family set to RP2040's (0xe48bff56): refused, naming the RP2040
const rp2040 = Buffer.from(readFileSync(UF2));
for (let o = 0; o < rp2040.length; o += 512) rp2040.writeUInt32LE(0xe48bff56, o + 28);
/** Put a file into a file input and fire its change event (the page's own handler reads it). */
const give = (sel, name, data) => `(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false;
  const bytes = Uint8Array.from(atob(${JSON.stringify(b64(data))}), (c) => c.charCodeAt(0));
  const dt = new DataTransfer(); dt.items.add(new File([bytes], ${JSON.stringify(name)})); i.files = dt.files;
  i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
const messages = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const clickText = (sel, text) => `(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true; })()`;
const nowLine = `Number(document.querySelector('.sv-line.sv-now .sv-num')?.textContent ?? 0)`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
try {
  for (const name of BROWSERS) {
    const b = await launch(name);
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    console.log(`${name} (${b.version}), pico2 import and C source view`);
    const check = async (label, fn) => {
      try { const r = await fn(); console.log(`  ok   ${label}${r ? ` — ${r}` : ''}`); } catch (e) { failed++; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    try {
      for (const scheme of ['light', 'dark']) {
        const p = await b.newPage({ width: 1366, height: 768, colorScheme: scheme });
        await p.goto(`${origin}?arch=pico2&edition=full`);
        await p.eval('localStorage.clear(); true');
        await p.goto(`${origin}?arch=pico2&edition=full`);
        await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
        p.errors.length = 0;
        await check(`${scheme}: the file input accepts .uf2, .elf and .bin; a UF2 for the RP2040 is refused naming it`, async () => {
          const acc = await p.eval(`[...document.querySelectorAll('input[type=file]')].map((i) => i.accept).find((a) => a.includes('.json')) ?? ''`);
          for (const k of ['.uf2', '.elf', '.bin']) if (!acc.split(',').includes(k)) throw new Error(`accept ${acc}`);
          if (!await p.eval(give('input[type=file][accept*=".uf2"]', 'rp2040.uf2', rp2040))) throw new Error('no file input');
          await p.waitFor(`${messages}.includes('rp2040.uf2:')`);
          const m = await p.eval(messages);
          if (!/RP2040/.test(m)) throw new Error(m);
          return m.split('\n').find((x) => x.includes('rp2040.uf2:')).trim().slice(0, 90);
        });
        await check(`${scheme}: hello_uart.elf imported through the file input; the validator's notes shown`, async () => {
          await p.eval(give('input[type=file][accept*=".uf2"]', 'hello_uart.elf', readFileSync(ELF)));
          await p.waitFor(`${messages}.includes('Program imported')`);
          const m = await p.eval(messages);
          if (!/would be written with zeros/.test(m)) throw new Error(m);
          return m.split('\n')[0].trim().slice(0, 80);
        });
        await check(`${scheme}: C source view: hello_uart.c loaded, breakpoint on main's first line reached by a run, step line and back line`, async () => {
          if (!await p.eval(clickText('.mode-btn', 'C source'))) throw new Error('no C source view tab');
          await p.waitFor(`document.querySelector('.sv-view') && document.querySelector('.sv-note')`);
          const before = await p.eval(`document.querySelector('.sv-note').textContent`);
          if (!/not loaded/.test(before)) throw new Error(`before loading: ${before}`);
          await p.eval(give('.sv-bar input[type=file]:not([webkitdirectory])', 'hello_uart.c', readFileSync(C)));
          await p.waitFor(`/1 of the program/.test(document.querySelector('.sv-bar .sv-loaded')?.textContent ?? '')`);
          // show hello_uart.c and set a breakpoint on main's first line with code
          await p.eval(`(() => { const s = document.querySelector('.sv-bar select'); const o = [...s.options].find((x) => x.text === 'hello_uart.c'); s.value = o.value; s.dispatchEvent(new Event('change')); return true; })()`);
          await p.waitFor(`document.querySelector('.sv-code:not([hidden]) .sv-line')`);
          const bp = await p.eval(`(() => { const rows = [...document.querySelectorAll('.sv-line')]; const m = rows.findIndex((r) => /int main/.test(r.textContent));
            const r = rows.slice(m).find((x) => x.classList.contains('sv-has')); r.querySelector('.sv-num').click(); return Number(r.querySelector('.sv-num').textContent); })()`);
          if (!await p.eval(`document.querySelector('#sv-l${bp} .sv-gut').textContent === '●'`)) throw new Error('breakpoint mark');
          await p.eval(`document.querySelector('.tool-run').click(); true`);
          await p.waitFor(`${messages}.includes('Breakpoint on hello_uart.c:${bp}')`, 30000);
          await p.waitFor(`${nowLine} === ${bp}`);
          if (!await p.eval(clickText('.sb-tools button', 'Step line'))) throw new Error('no Step line button');
          await p.waitFor(`${nowLine} !== ${bp} || !document.querySelector('.sv-line.sv-now')`);
          const after = await p.eval(`document.querySelector('.sv-where').textContent`);
          await p.eval(clickText('.sb-tools button', 'Back line'));
          await p.waitFor(`${nowLine} === ${bp}`);
          if (p.errors.length) throw new Error(p.errors.join('; '));
          return `breakpoint at line ${bp}; step line to ${after}; back line to ${bp}`;
        });
        await check(`${scheme}: axe-core passes on the C source view with a program and on its program map`, async () => {
          await p.eval(AXE);
          const scan = (ctx, rules = {}) => p.eval(`axe.run(${ctx}, { runOnly: { type: 'tag', values: ${JSON.stringify(AXE_TAGS)} }, rules: ${JSON.stringify(rules)}, resultTypes: ['violations'] })
            .then((r) => r.violations.map((v) => \`\${v.id} (\${v.impact}, \${v.nodes.length}: \${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')})\`))`);
          // the view's own regions (the shell around it is scanned by tools/module-smoke.mjs)
          const v1 = await scan(`{ include: [['.sv-view'], ['.sv-tab']], exclude: [['svg.pz-svg']] }`);
          const v2 = await scan(`{ include: [['svg.pz-svg']] }`, { 'color-contrast': { enabled: false }, 'label-content-name-mismatch': { enabled: false } });
          if (v1.length || v2.length) throw new Error([...v1, ...v2].join('; '));
        });
        if (opt('--shots')) { mkdirSync(opt('--shots'), { recursive: true }); writeFileSync(join(opt('--shots'), `pico2-source-${name}-${scheme}.png`), await p.screenshot()); }
        await p.close();
      }
    } finally { await b.close(); }
  }
} finally { server.close(); }
process.exit(failed ? 1 : 0);
