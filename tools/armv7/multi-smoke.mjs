// multi-smoke.mjs -- the browser smoke test of the ARM multicycle view (roadmap ARM-A3), on the development page
// ?arch=armv7 in a headless Chrome or Edge: Fig 7.60 assembled and run in the view to its end, with the registers and the
// stop message (cycles, instructions, CPI) equal to the Node.js model's; one cycle, the Cycle and Controller tabs, a whole
// instruction forward and back, step back; the state diagram in place of the datapath; a failed condition mutes the
// write paths; the states over time; an instruction outside the base design is refused by the assembler; screenshots in
// light and dark. The generic module checks (every view loads, axe-core) are tools/module-smoke.mjs --arch armv7.
//   node tools/armv7/multi-smoke.mjs [--browser chrome|edge] [--shots dir]
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';
import { startServer } from '../serve.mjs';
import { assemble } from '../../src/arch/armv7/language.js';
import { ArmMulti } from '../../src/arch/armv7/uarch/multi.js';
import { ArmMultiExt } from '../../src/arch/armv7/uarch/multi-ext.js';
import { STRINGS as SHELL } from '../../src/ui/strings.js';
import { ARMV7_STRINGS } from '../../src/arch/armv7/strings.js';
import { multiCriticalPath } from '../../src/arch/armv7/uarch/multi-timing.js';
import { delayMap } from '../../src/arch/armv7/uarch/timing.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const V = ARMV7_STRINGS.multiView;
const FIG = readFileSync(join(ROOT, 'content/armv7/templates/fig-7-60.s'), 'utf8');
const D = delayMap(JSON.parse(readFileSync(join(ROOT, 'content/armv7/data/single-delays.json'), 'utf8')));
const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`; // the shell's hex8: lower case

// the expected end state, from the model in Node.js
const want = new ArmMulti();
want.load(assemble([{ name: 'fig-7-60.s', text: FIG }], { profile: 'arm-multi' }));
if (want.run() !== 'halt') throw new Error('Fig 7.60 does not end in the model');
// a program of the Extended processor: BL, a shifted operand, LDRB, a negative offset, CMP (NoWrite)
const EXT_PROGRAM = 'MOV R4, #0x80\nMOV R1, #3\nMOV R2, #5\nBL f\nLDRB R5, [R4, #-4]\nADDS R3, R1, R2, LSL #2\nCMP R3, #0\nB .\n'
  + 'f: STR R2, [R4, #-4]\nMOV PC, LR\n';
const wantExt = new ArmMultiExt();
wantExt.load(assemble([{ name: 'ext.s', text: EXT_PROGRAM }], { profile: 'arm-multi', subset: 'extended' }));
if (wantExt.run() !== 'halt') throw new Error('the Extended program does not end in the model');

const setSource = (src) => `(() => { const a = document.querySelector('.p-editor textarea'); a.value = ${JSON.stringify(src)};
  a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const viewBtn = `[...document.querySelectorAll('.mode-btn')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(ARMV7_STRINGS.viewMulti)})`;
const tab = (name) => `(() => { [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === ${JSON.stringify(name)}).click(); return true; })()`;
const button = (text) => `(() => { [...document.querySelectorAll('.mc-tools button')].find((b) => b.textContent === ${JSON.stringify(text)}).click(); return true; })()`;
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

  await check('Fig 7.60 runs to its end in the multicycle view: registers and stop message (cycles, CPI) equal the model\'s', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.key('F5', { keyCode: 116 });
    const msg = V.halted(hex(want.pc), want.cycle, want.retired, (want.cycle / want.retired).toFixed(3));
    await p.waitFor(`${consoleText}.includes(${JSON.stringify(msg)})`);
    const bad = [];
    for (let i = 0; i < 13; i++) {
      const t = await p.eval(reg(`R${i}`));
      if (t === null || Number(t.startsWith('0x') ? t : `0x${t}`) !== want.R[i]) bad.push(`R${i} ${t} (want ${want.R[i]})`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
    return `${want.cycle} cycles, ${want.retired} instructions; R0-R12 match`;
  });

  await check('one cycle, the Cycle and Controller tabs, an instruction forward and back, step back', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.eval(tab(V.tabCycle));
    if (!await p.eval(`document.querySelector('.sc-cycle').textContent.includes('IR ← Mem[PC]')`)) throw new Error('Fetch without IR ← Mem[PC]');
    await p.key('F10', { keyCode: 121 });
    await p.waitFor(`${status}.startsWith('cycle 1 · Decode')`);
    const cyc = await p.eval(`document.querySelector('.sc-cycle').textContent`);
    for (const t of ['A ← R', 'WriteData ← R', 'CondEx ← ConditionCheck', 'Next state: Execute']) if (!cyc.includes(t)) throw new Error(`Cycle tab without "${t}"`);
    await p.eval(tab(V.tabFsm));
    const col = await p.eval(`document.querySelector('.mc-fsm th.sc-active')?.textContent ?? ''`);
    if (!col.includes('S1 Decode')) throw new Error(`active column "${col}"`);
    await p.eval(button(V.stepInstr));
    await p.waitFor(`${status}.startsWith('cycle 4 · Fetch')`);
    await p.eval(button(V.backInstr));
    await p.waitFor(`${status}.startsWith('cycle 0 · Fetch')`);
    await p.key('F10', { keyCode: 121 });
    await p.key('F10', { keyCode: 121, modifiers: 8 });
    await p.waitFor(`${status}.startsWith('cycle 0 ')`);
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('the state diagram in place of the datapath, with the current state', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.key('F10', { keyCode: 121 });
    await p.eval(button(V.drawFsm));
    await p.waitFor(`document.querySelector('svg.fsm').getBoundingClientRect().width > 0 && document.querySelector('svg.dp').getBoundingClientRect().width === 0`);
    const cur = await p.eval(`document.querySelector('svg.fsm .fsm-cur')?.dataset.state ?? ''`);
    if (cur !== 'Decode') throw new Error(`current state "${cur}"`);
    if (!await p.eval(`document.querySelectorAll('svg.fsm .fsm-taken').length === 1 && document.querySelectorAll('svg.fsm .fsm-next').length === 1`)) throw new Error('taken or next arc missing');
    await p.eval(button(V.drawDatapath));
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('a failed condition: in ALUWB, CondExDelayed = 0 mutes the write to the register file', async () => {
    const p = await fresh();
    await open(p, 'SUBS R0, R0, #0\nADDNE R6, R6, #1\nB .\n');
    for (let i = 0; i < 7; i++) await p.key('F10', { keyCode: 121 });
    await p.waitFor(`${status}.startsWith('cycle 7 · ALUWB')`);
    await p.eval(tab(V.tabCycle));
    if (!await p.eval(`document.querySelector('.sc-cycle').textContent.includes('CondExDelayed = 0')`)) throw new Error('no CondExDelayed = 0 line');
    for (const id of ['res_wd3', 'rm_res']) if (!await p.eval(wire(id, 'dp-muted'))) throw new Error(`${id} not muted`);
    const marks = await p.eval(`[...document.querySelectorAll('svg.dp .dp-annotations text')].map((t) => t.textContent).join('|')`);
    if (marks !== V.failedMark) throw new Error(`gate mark "${marks}"`);
    if (!await p.eval(`document.querySelector('svg.dp [data-id="g_regw"]').classList.contains('dp-hold')`)) throw new Error('RegWrite gate not marked');
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('the base-set template for this view opens in it and runs to R0 = 55', async () => {
    const p = await fresh();
    await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await p.waitFor(`[...document.querySelectorAll('.templates-menu .menu-list button')].some((b) => /Multicycle view/.test(b.textContent))`);
    await p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => /Multicycle view/.test(b.textContent)).click(); true`);
    await p.waitFor(`/base-sum/.test(document.querySelector('.p-editor textarea').value) && (${viewBtn})?.getAttribute('aria-selected') === 'true'`);
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes('the program ends after')`);
    const r0 = await p.eval(reg('R0'));
    if (Number(r0.startsWith('0x') ? r0 : `0x${r0}`) !== 55) throw new Error(`R0 ${r0}`);
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('the states over time: one row per instruction and the CPI so far', async () => {
    const p = await fresh();
    await open(p, FIG);
    for (let i = 0; i < 12; i++) await p.key('F10', { keyCode: 121 });
    await p.waitFor(`${status}.startsWith('cycle 12 ')`);
    await p.eval(tab(V.tabStrip));
    const rows = await p.eval(`document.querySelectorAll('.mc-strip tbody tr').length`);
    if (rows < 3) throw new Error(`${rows} rows`);
    if (!await p.eval(`document.querySelector('.mc-strip').textContent.includes('CPI = ')`)) throw new Error('no CPI');
    await p.eval(`document.querySelector('.mc-strip tbody tr td.pd-cell button').click(); true`);
    await p.waitFor(`!(${status}).startsWith('cycle 12 ')`);
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
    return `${rows} rows`;
  });

  await check('the Timing tab: this cycle\'s path, the clock period set by Decode, the run compared with the single-cycle processor', async () => {
    const p = await fresh();
    await open(p, FIG);
    for (let i = 0; i < 5; i++) await p.key('F10', { keyCode: 121 });
    await p.waitFor(`${status}.startsWith('cycle 5 ')`);
    await p.eval(tab(V.tabTiming));
    const text = await p.eval(`document.querySelector('.sc-timing').textContent`);
    const at5 = new ArmMulti();
    at5.load(assemble([{ name: 'fig-7-60.s', text: FIG }], { profile: 'arm-multi' }));
    for (let i = 0; i < 5; i++) at5.step();
    const cur = multiCriticalPath(D, at5.evaluate().signals).critical;
    for (const t of [`This cycle (Decode): ${cur.delay} ps, ending at the ${cur.end}`, 'Clock period: 490 ps, set by Decode', 'The single-cycle processor, with the same delays: 1 instructions × 990 ps']) {
      if (!text.includes(t)) throw new Error(`Timing tab without "${t}"`);
    }
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
  });

  await check('Extended datapath: chosen in the subset menu, its drawing and label shown, a tier-E program runs to the model\'s end state; Link in the state diagram', async () => {
    const p = await fresh();
    await open(p, EXT_PROGRAM);
    await p.eval(`(() => { const s = document.querySelector('select[aria-label=${JSON.stringify(SHELL.view.subset)}]'); s.value = 'extended';
      s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.waitFor(`[...document.querySelectorAll('svg.dp')].filter((s) => s.getBoundingClientRect().width > 0).length === 1
      && Boolean([...document.querySelectorAll('svg.dp')].find((s) => s.getBoundingClientRect().width > 0).querySelector('[data-id="sh"]'))`);
    if (!await p.eval(`[...document.querySelectorAll('.note')].some((n) => n.offsetParent && n.textContent === ${JSON.stringify(V.ext.badge)})`)) throw new Error('no Extended label');
    for (let i = 0; i < 14; i++) await p.key('F10', { keyCode: 121 }); // MOV, MOV, MOV (12 cycles), BL: Fetch, Decode → Link
    await p.waitFor(`${status}.startsWith('cycle 14 · Link')`);
    await p.eval(button(V.drawFsm));
    const cur = await p.eval(`[...document.querySelectorAll('svg.fsm')].find((s) => s.getBoundingClientRect().width > 0)?.querySelector('.fsm-cur')?.dataset.state ?? ''`);
    if (cur !== 'Link') throw new Error(`state diagram current "${cur}"`);
    await p.eval(button(V.drawDatapath));
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes(${JSON.stringify(V.halted(hex(wantExt.pc), wantExt.cycle, wantExt.retired, (wantExt.cycle / wantExt.retired).toFixed(3)))})`);
    const bad = [];
    for (let i = 0; i < 13; i++) {
      const t = await p.eval(reg(`R${i}`));
      if (t === null || Number(t.startsWith('0x') ? t : `0x${t}`) !== wantExt.R[i]) bad.push(`R${i} ${t} (want ${wantExt.R[i]})`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    await p.eval(tab(V.tabFsm));
    if (!await p.eval(`document.querySelector('.mc-fsm').textContent.includes('S11 BranchL') && document.querySelector('.mc-fsm').textContent.includes('NoWrite')`)) throw new Error('Controller tab');
    if (errors(p).length) throw new Error(errors(p).join('; '));
    await p.close();
    return `${wantExt.cycle} cycles; R0-R12 match`;
  });

  await check('an instruction outside the base design is refused by the assembler in this view', async () => {
    const p = await fresh();
    await open(p, 'MOV R0, #1\nB .\n');
    await p.waitFor(`${consoleText}.includes('outside this processor')`);
    await p.close();
  });

  if (SHOTS) await check('screenshots', async () => {
    mkdirSync(SHOTS, { recursive: true });
    const files = [];
    for (const scheme of ['light', 'dark']) {
      const p = await fresh(scheme);
      await open(p, FIG);
      for (let i = 0; i < 9; i++) await p.key('F10', { keyCode: 121 });
      await p.eval(tab(V.tabCycle));
      await settle(500);
      let f = join(SHOTS, `arm-multi-view-${scheme}.png`);
      writeFileSync(f, await p.screenshot('png'));
      files.push(f);
      await p.eval(button(V.drawFsm));
      await p.eval(tab(V.tabFsm));
      await settle(500);
      f = join(SHOTS, `arm-multi-view-fsm-${scheme}.png`);
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
