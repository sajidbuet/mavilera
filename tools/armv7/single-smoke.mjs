// single-smoke.mjs -- the browser smoke test of the ARM single-cycle view (roadmap ARM-A2), on the development page
// ?arch=armv7 in a headless Chrome or Edge: Fig 7.60 assembled and run in the view to its end, with the registers, the
// cycle count and the stop message equal to the Node.js model's; one step, step back; the Cycle tab's register-transfer
// lines and the Control tab's active row; a class path; a failed condition mutes the write paths; an instruction outside
// the base design is refused by the assembler; screenshots in light and dark. The generic module checks (every view
// loads, axe-core) are tools/module-smoke.mjs --arch armv7.
//   node tools/armv7/single-smoke.mjs [--browser chrome|edge] [--shots dir]
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';
import { startServer } from '../serve.mjs';
import { assemble } from '../../src/arch/armv7/language.js';
import { ArmSingle } from '../../src/arch/armv7/uarch/single.js';
import { ARMV7_STRINGS } from '../../src/arch/armv7/strings.js';
import { ArmSingleExt } from '../../src/arch/armv7/uarch/single-ext.js';
import { STRINGS as SHELL } from '../../src/ui/strings.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const V = ARMV7_STRINGS.singleView;
const FIG = readFileSync(join(ROOT, 'content/armv7/templates/fig-7-60.s'), 'utf8');

// the expected end state, from the model in Node.js
const want = new ArmSingle();
want.load(assemble([{ name: 'fig-7-60.s', text: FIG }], { profile: 'arm-single' }));
if (want.run() !== 'halt') throw new Error('Fig 7.60 does not end in the model');
// a program of the Extended datapath: Euclid's GCD with CMP and conditional SUB, a call, a shifted operand and a byte load
const EXT_PROGRAM = 'MOV R0, #12\nMOV R1, #18\nBL gcd\nMOV R3, R0, LSL #2\nMOV R4, #0x80\nSTR R3, [R4, #0]\nLDRB R5, [R4, #0]\nB .\n'
  + 'gcd: CMP R0, R1\nSUBGT R0, R0, R1\nSUBLT R1, R1, R0\nBNE gcd\nMOV PC, LR\n';
const wantExt = new ArmSingleExt();
wantExt.load(assemble([{ name: 'gcd.s', text: EXT_PROGRAM }], { profile: 'arm-single', subset: 'extended' }));
if (wantExt.run() !== 'halt') throw new Error('the Extended program does not end in the model');

const setSource = (src) => `(() => { const a = document.querySelector('.p-editor textarea'); a.value = ${JSON.stringify(src)};
  a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const viewBtn = `[...document.querySelectorAll('.mode-btn')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(ARMV7_STRINGS.viewSingle)})`;
const tab = (name) => `(() => { [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === ${JSON.stringify(name)}).click(); return true; })()`;
const status = `document.querySelector('.dp-status')?.textContent ?? ''`;
const consoleText = `document.querySelector('.p-console').textContent`;
const reg = (name) => `(() => { const tr = [...document.querySelectorAll('.regs tr')].find((r) => r.querySelector('.reg-x')?.textContent.trim() === ${JSON.stringify(name)});
  return tr ? tr.querySelector('.reg-val').textContent.trim() : null; })()`;
const wire = (id, cls) => `document.querySelector('svg.dp [data-id="${id}"]').classList.contains('${cls}')`;
const settle = (ms = 300) => new Promise((ok) => setTimeout(ok, ms));

async function checks(b, url) {
  const out = [];
  const check = async (name, f) => {
    try { const detail = await f(); out.push({ name, ok: true, detail }); } catch (e) { out.push({ name, ok: false, error: String(e.message ?? e) }); }
  };
  const fresh = async (colorScheme = 'light') => {
    const p = await b.newPage({ width: 1600, height: 900, colorScheme, reducedMotion: 'reduce' });
    await p.goto(url);
    await p.eval('localStorage.clear(); true');
    p.errors.length = 0;
    await p.goto(url);
    await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('.p-editor textarea')`);
    return p;
  };
  const open = async (p, src) => {
    await p.eval(setSource(src));
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.eval(`(${viewBtn}).click(), true`);
    await p.waitFor(`(${viewBtn}).getAttribute('aria-selected') === 'true' && document.querySelector('svg.dp') && document.querySelector('.dp-status')`);
    await settle();
  };
  const errors = (p) => p.errors.filter((e) => !e.includes('favicon'));

  await check('Fig 7.60 runs to its end in the single-cycle view: registers, cycles and stop message equal the model\'s', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.key('F5', { keyCode: 116 });
    const msg = V.halted(`0x${want.pc.toString(16).padStart(8, '0')}`, want.cycle); // the shell's hex8: lower case
    await p.waitFor(`${consoleText}.includes(${JSON.stringify(msg)})`);
    const bad = [];
    for (let i = 0; i < 13; i++) {
      const t = await p.eval(reg(`R${i}`));
      if (t === null || Number(t.startsWith('0x') ? t : `0x${t}`) !== want.R[i]) bad.push(`R${i} ${t} (want ${want.R[i]})`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
    return `${want.cycle} cycles; R0-R12 match`;
  });

  await check('one step, the Cycle tab in register-transfer notation, the Control tab\'s active row, step back', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.key('F10', { keyCode: 121 });
    await p.waitFor(`${status}.startsWith('cycle 1 ')`);
    await p.eval(tab(V.tabCycle));
    const cyc = await p.eval(`document.querySelector('.sc-cycle').textContent`);
    for (const t of ['Instr ← IMem[PC]', 'CondEx ← ConditionCheck', 'ALUResult ← SrcA + SrcB', 'R2 ← ALUResult']) {
      if (!cyc.includes(t)) throw new Error(`Cycle tab without "${t}"`);
    }
    await p.eval(tab(V.tabControl));
    const row = await p.eval(`document.querySelector('.sc-control tr.sc-active')?.textContent ?? ''`);
    if (!row.includes(V.classes.dpImm)) throw new Error(`active row "${row}"`);
    await p.key('F10', { keyCode: 121, modifiers: 8 });
    await p.waitFor(`${status}.startsWith('cycle 0 ')`);
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('class path B: the target returns to the PC; a failed condition mutes the write paths', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.eval(`(() => { const s = document.querySelector('.panel-tools select'); s.value = 'b'; s.dispatchEvent(new Event('change')); return true; })()`);
    if (!await p.eval(wire('res_pcm', 'dp-active')) || !await p.eval(wire('pc8_rf', 'dp-active'))) throw new Error('B path');
    await open(p, 'SUBS R0, R0, #0\nADDNE R6, R6, #1\nB .\n');
    await p.key('F10', { keyCode: 121 });
    await p.waitFor(`${status}.startsWith('cycle 1 ')`);
    await p.eval(tab(V.tabCycle));
    if (!await p.eval(`document.querySelector('.sc-cycle').textContent.includes('CondEx = 0')`)) throw new Error('no CondEx = 0 line');
    for (const id of ['res_rf', 'res_pcm', 'alu_flags']) if (!await p.eval(wire(id, 'dp-muted'))) throw new Error(`${id} not muted`);
    const marks = await p.eval(`[...document.querySelectorAll('svg.dp .dp-annotations text')].map((t) => t.textContent).join('|')`);
    if (marks !== V.failedMark) throw new Error(`gate mark "${marks}"`); // A3-Q8
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('an instruction outside the base design is refused by the assembler in this view', async () => {
    const p = await fresh();
    await open(p, 'MOV R0, #1\nB .\n');
    await p.waitFor(`${consoleText}.includes('outside this processor')`);
    await p.close();
  });

  await check('Extended datapath: chosen in the subset menu, its drawing and label shown, a tier-E program runs to the model\'s end state', async () => {
    const p = await fresh();
    await open(p, EXT_PROGRAM);
    await p.eval(`(() => { const s = document.querySelector('select[aria-label=${JSON.stringify(SHELL.view.subset)}]'); s.value = 'extended';
      s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.waitFor(`[...document.querySelectorAll('svg.dp')].filter((s) => s.getBoundingClientRect().width > 0).length === 1
      && Boolean([...document.querySelectorAll('svg.dp')].find((s) => s.getBoundingClientRect().width > 0).querySelector('[data-id="sh"]'))`);
    if (!await p.eval(`[...document.querySelectorAll('.note')].some((n) => n.offsetParent && n.textContent === ${JSON.stringify(V.ext.badge)})`)) throw new Error('no Extended label');
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes(${JSON.stringify(V.halted(`0x${wantExt.pc.toString(16).padStart(8, '0')}`, wantExt.cycle))})`);
    const bad = [];
    for (let i = 0; i < 13; i++) {
      const t = await p.eval(reg(`R${i}`));
      if (t === null || Number(t.startsWith('0x') ? t : `0x${t}`) !== wantExt.R[i]) bad.push(`R${i} ${t} (want ${wantExt.R[i]})`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    await p.eval(tab(V.tabControl));
    if (!await p.eval(`document.querySelector('.sc-control').textContent.includes('NoWrite')`)) throw new Error('Control tab without NoWrite');
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
    return `${wantExt.cycle} cycles; R0-R12 match`;
  });

  await check('a program the base design refuses: the view says why and names the template; the template opens in the view and runs', async () => {
    const p = await fresh();
    await open(p, 'MOV R0, #1\nB .\n');
    await p.waitFor(`document.querySelector('.sc-hint') && !document.querySelector('.sc-hint').hidden && document.querySelector('.sc-hint').textContent.includes('Base instructions only')`);
    await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await p.waitFor(`[...document.querySelectorAll('.templates-menu .menu-list button')].some((b) => /Base instructions only/.test(b.textContent))`);
    await p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => /Base instructions only/.test(b.textContent)).click(); true`);
    await p.waitFor(`/base-sum/.test(document.querySelector('.p-editor textarea').value) && (${viewBtn}).getAttribute('aria-selected') === 'true'`);
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes('the program ends after')`);
    const r0 = await p.eval(reg('R0'));
    if (Number(r0.startsWith('0x') ? r0 : `0x${r0}`) !== 55) throw new Error(`R0 ${r0}`);
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('critical path: the path and its arrival times are drawn, and the Timing tab gives the clock period', async () => {
    const p = await fresh();
    await open(p, FIG);
    for (let i = 0; i < 15; i++) await p.key('F10', { keyCode: 121 }); // the LDR of Fig 7.60 (its 16th instruction run)
    await p.eval(`(() => { const c = [...document.querySelectorAll('.panel-tools label')].find((l) => l.textContent.trim() === ${JSON.stringify(V.criticalMode)}).querySelector('input'); c.click(); return true; })()`);
    await p.waitFor(`[...document.querySelectorAll('svg.dp')].find((s) => s.getBoundingClientRect().width > 0).querySelectorAll('.dp-annotations text').length > 3`);
    await p.eval(tab(V.tabTiming));
    const text = await p.eval(`document.querySelector('.sc-timing').textContent`);
    if (!text.includes('Clock period: 990 ps') || !text.includes('This instruction: 990 ps')) throw new Error(text.slice(0, 200));
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('the header names the module (ARMv7 logo) and the help opens with every topic', async () => {
    const p = await fresh();
    const vb = readFileSync(join(ROOT, 'content/branding/mavilera/mavilera-logo-armv7.svg'), 'utf8').match(/viewBox="([^"]+)"/)[1];
    if (await p.eval(`document.querySelector('.app-logo svg')?.getAttribute('viewBox')`) !== vb) throw new Error('the header does not show mavilera-logo-armv7.svg');
    await p.eval(`document.querySelector('.header-tools [aria-label="${SHELL.help.button}"]').click(); true`);
    await p.waitFor(`document.querySelectorAll('.help-nav button').length > 0`);
    const n = await p.eval(`document.querySelectorAll('.help-nav button').length`);
    for (let i = 0; i < n; i++) {
      await p.eval(`document.querySelectorAll('.help-nav button')[${i}].click(); true`);
      if (!await p.eval(`document.querySelector('.help-body h3')?.textContent === document.querySelectorAll('.help-nav button')[${i}].textContent`)) throw new Error(`topic ${i}`);
    }
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
    return `${n} topics`;
  });

  if (SHOTS) await check('screenshots', async () => {
    mkdirSync(SHOTS, { recursive: true });
    const files = [];
    for (const scheme of ['light', 'dark']) {
      const p = await fresh(scheme);
      await open(p, FIG);
      for (let i = 0; i < 16; i++) await p.key('F10', { keyCode: 121 });
      await p.eval(tab(V.tabCycle));
      await settle(500);
      const f = join(SHOTS, `arm-single-view-${scheme}.png`);
      writeFileSync(f, await p.screenshot('png'));
      files.push(f);
      await p.close();
    }
    return files.join(', ');
  });
  return out;
}

const { server, url: origin } = await startServer({ port: 0 });
const url = `${origin}?arch=armv7`;
let failed = false;
try {
  for (const name of BROWSERS) {
    const b = await launch(name);
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    try {
      console.log(`${name} (${b.version})`);
      for (const r of await checks(b, url)) {
        console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}${r.error ? ` — ${r.error}` : ''}`);
        if (!r.ok) failed = true;
      }
    } finally { await b.close(); }
  }
} finally { server.close(); }
process.exitCode = failed ? 1 : 0;
