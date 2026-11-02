// pipe-smoke.mjs -- the browser smoke test of the ARM pipelined view (roadmap ARM-A4), on the development page
// ?arch=armv7 in a headless Chrome or Edge: Fig 7.60 assembled and run in the view to its end, with the registers and the
// stop message (cycles, instructions, CPI) equal to the Node.js model's; one cycle, the stage strip, step back; the
// load-use stall's marks and reasons; the StallF correction (A4-Q2) named on the drawing; a failed condition marked on
// the gates; the hazard mode "Forwarding only" gives the stale result the model gives; the pipeline diagram and a cell
// that moves the cycle; the Lost cycles tab; stopping a run on a stall; the base-set template; the Timing tab; an
// instruction outside the base design refused; screenshots in light and dark. The generic module checks (every view loads, axe-core) are
// tools/module-smoke.mjs --arch armv7.
//   node tools/armv7/pipe-smoke.mjs [--browser chrome|edge] [--shots dir]
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';
import { startServer } from '../serve.mjs';
import { assemble } from '../../src/arch/armv7/language.js';
import { ArmPipe } from '../../src/arch/armv7/uarch/pipe.js';
import { ArmPipeExt } from '../../src/arch/armv7/uarch/pipe-ext.js';
import { stageNarrative } from '../../src/arch/armv7/uarch/pipe-narrative.js';
import { ARMV7_STRINGS } from '../../src/arch/armv7/strings.js';
import { createRequire } from 'node:module';
import { STRINGS as SHELL } from '../../src/ui/strings.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const V = ARMV7_STRINGS.pipeView;
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'); // dev dependency (THIRD_PARTY.md)
const FIG = readFileSync(join(ROOT, 'content/armv7/templates/fig-7-60.s'), 'utf8');
const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`; // the shell's hex8: lower case
const LOAD_USE = 'ADD R3, R3, #41\nSTR R3, [R0, #0x100]\nLDR R1, [R0, #0x100]\nADD R2, R1, #0\nB .\n';
const D15 = 'SUBS R0, R0, R0\nBEQ x\nADD R15, R14, #0\nADD R5, R5, #1\nx: ADD R6, R6, #1\nB .\n';

/** The model's end state for a program and hazard mode. */
function model(text, hazard = 'full') {
  const m = new ArmPipe({ hazard });
  m.load(assemble([{ name: 't.s', text }], { profile: 'arm-pipe' }));
  if (m.run() !== 'halt') throw new Error(`no halt: ${m.error}`);
  return m;
}
const want = model(FIG);
// a program of the Extended processor: BL, a shifted operand, LDRB, a negative offset, ADC, CMP (NoWrite)
const EXT_PROGRAM = 'MOV R4, #0x80\nMOV R1, #3\nMOV R2, #5\nBL f\nLDRB R5, [R4, #-4]\nADDS R3, R1, R2, LSL #2\nADC R6, R3, #1\nCMP R3, #0\nB .\n'
  + 'f: STR R2, [R4, #-4]\nMOV PC, LR\n';
const wantExt = new ArmPipeExt();
wantExt.load(assemble([{ name: 'ext.s', text: EXT_PROGRAM }], { profile: 'arm-pipe', subset: 'extended' }));
if (wantExt.run() !== 'halt') throw new Error(`the Extended program does not end in the model: ${wantExt.error}`);
const haltMsg = (m) => V.halted(hex(m.W.at), m.cycle, m.stats.retired + 1, (m.cycle / (m.stats.retired + 1)).toFixed(3));

const setSource = (src) => `(() => { const a = document.querySelector('.p-editor textarea'); a.value = ${JSON.stringify(src)};
  a.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
const viewBtn = `[...document.querySelectorAll('.mode-btn')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify(ARMV7_STRINGS.viewPipe)})`;
const tab = (name) => `(() => { [...document.querySelectorAll('.tabs button')].find((b) => b.textContent === ${JSON.stringify(name)}).click(); return true; })()`;
const status = `document.querySelector('.dp-status')?.textContent ?? ''`;
const consoleText = `document.querySelector('.p-console').textContent`;
const reg = (name) => `(() => { const tr = [...document.querySelectorAll('.regs tr')].find((r) => r.querySelector('.reg-x')?.textContent.trim() === ${JSON.stringify(name)});
  return tr ? tr.querySelector('.reg-val').textContent.trim() : null; })()`;
const num = (t) => { const v = t.split(/\s+/).pop(); return Number(v.startsWith('0x') ? v : `0x${v}`); }; // after the ◆ of a changed register
const has = (id, cls) => `document.querySelector('svg.dp [data-id="${id}"]').classList.contains('${cls}')`;
const notes = `[...document.querySelectorAll('svg.dp .dp-annotations text')].map((t) => t.textContent).join('|')`;
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
  const steps = async (p, n) => {
    for (let i = 0; i < n; i++) await p.key('F10', { keyCode: 121 });
    await p.waitFor(`${status}.startsWith('cycle ${n} ')`);
  };
  const errors = (p) => p.errors.filter((e) => !e.includes('favicon'));
  const done = async (p) => { if (errors(p).length) throw new Error(errors(p).join('; ')); await p.close(); };

  await check('Fig 7.60 runs to its end in the pipelined view: registers and stop message (cycles, CPI) equal the model\'s', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes(${JSON.stringify(haltMsg(want))})`);
    const bad = [];
    for (let i = 0; i < 13; i++) {
      const t = await p.eval(reg(`R${i}`));
      if (t === null || num(t) !== want.R[i]) bad.push(`R${i} ${t} (want ${want.R[i]})`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    await done(p);
    return `${want.cycle} cycles; R0-R12 match`;
  });

  await check('one cycle at a time: the stage strip names the instruction in each stage; step back', async () => {
    const p = await fresh();
    await open(p, FIG);
    await steps(p, 4);
    const strip = await p.eval(`[...document.querySelectorAll('.pp-stage .pp-stage-instr')].map((x) => x.textContent)`);
    if (!/SUB/.test(strip[4]) || !/ORR/.test(strip[0])) throw new Error(`strip ${JSON.stringify(strip)}`);
    await p.key('F10', { keyCode: 121, modifiers: 8 });
    await p.waitFor(`${status}.startsWith('cycle 3 ')`);
    await done(p);
    return strip.join(' | ');
  });

  await check('the load-use stall: PC and IF/ID held, ID/EX cleared, LDRstall in the Hazards tab, R2 = 41 at the end', async () => {
    const p = await fresh();
    await open(p, LOAD_USE);
    await steps(p, 4); // LDR in EX, ADD R2, R1 in ID
    for (const [id, cls] of [['pc', 'dp-hold'], ['fd', 'dp-hold'], ['de', 'dp-clear']]) if (!await p.eval(has(id, cls))) throw new Error(`${id} not ${cls}`);
    await p.eval(tab(V.tabHazards));
    if (!await p.eval(`document.querySelector('.pp-hazards').textContent.includes('(LDRstall)')`)) throw new Error('no LDRstall reason');
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes('reached WB')`);
    if (num(await p.eval(reg('R2'))) !== 41) throw new Error(`R2 ${await p.eval(reg('R2'))}`);
    await done(p);
  });

  await check('the Stages tab tells each stage of the load-use stall as the model gives it; axe-core passes on it (ARM-A6)', async () => {
    const p = await fresh();
    await open(p, LOAD_USE);
    await steps(p, 4);
    await p.eval(tab(V.tabStages));
    const shown = await p.eval(`[...document.querySelectorAll('.pp-stages li')].map((l) => l.textContent).join('|')`);
    const m = new ArmPipe({ hazard: 'full' });
    m.load(assemble([{ name: 't.s', text: LOAD_USE }], { profile: 'arm-pipe' }));
    for (let k = 0; k < 4; k++) m.step();
    const want = stageNarrative(m.evaluate()).flatMap((x) => x.lines.map((l) => `${l.rtn}${l.val ?? ''}`)).join('|');
    if (shown !== want) throw new Error(`shown "${shown}"\nmodel "${want}"`);
    for (const t of [V.stageRtn.heldD, V.stageRtn.bubbleE, V.stageRtn.pcHeld]) if (!shown.includes(t)) throw new Error(`missing "${t}"`);
    await p.eval(AXE);
    const v = await p.eval(`axe.run({ include: [['.pp-stages']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })
      .then((r) => r.violations.map((x) => x.id + ' (' + x.nodes.length + ')'))`);
    if (v.length) throw new Error(v.join('; '));
    await done(p);
    return `${shown.split('|').length} lines`;
  });

  await check('A4-Q2: a taken branch with a write to R15 behind it: the correction is named on the drawing and in the Hazards tab', async () => {
    const p = await fresh();
    await open(p, D15);
    await steps(p, 3); // BEQ in EX, ADD R15 in ID
    if (!(await p.eval(notes)).includes(V.correctedMark)) throw new Error(`annotations "${await p.eval(notes)}"`);
    await p.eval(tab(V.tabHazards));
    if (!await p.eval(`document.querySelector('.pp-hazards').textContent.includes('D15')`)) throw new Error('no D15 reason');
    const m = model(D15);
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes(${JSON.stringify(haltMsg(m))})`);
    if (num(await p.eval(reg('R6'))) !== 1 || num(await p.eval(reg('R5'))) !== 0) throw new Error('wrong path ran');
    await done(p);
  });

  await check('a failed condition in EX is marked on the gates', async () => {
    const p = await fresh();
    await open(p, 'SUBS R0, R0, #0\nADDNE R6, R6, #1\nB .\n');
    await steps(p, 3);
    if (!(await p.eval(notes)).includes(V.failedMark)) throw new Error(`annotations "${await p.eval(notes)}"`);
    if (!await p.eval(has('g_regw', 'dp-hold'))) throw new Error('RegWrite gate not marked');
    await done(p);
  });

  await check('hazard handling "Forwarding only": the load\'s address is forwarded, R2 ends as the model gives it', async () => {
    const p = await fresh();
    await open(p, LOAD_USE);
    await p.eval(`(() => { const s = document.querySelector('select[aria-label=${JSON.stringify(V.hazard)}]'); s.value = 'forward';
      s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await settle();
    const m = model(LOAD_USE, 'forward');
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes('reached WB')`);
    const r2 = num(await p.eval(reg('R2')));
    if (r2 !== m.R[2] || r2 === 41) throw new Error(`R2 ${r2}, model ${m.R[2]}`);
    await done(p);
    return `R2 = ${hex(r2)} (the address)`;
  });

  await check('the pipeline diagram: rows with a held cell and a bubble; a cell moves the view to its cycle; the Lost cycles tab', async () => {
    const p = await fresh();
    await open(p, LOAD_USE);
    await steps(p, 8);
    await p.eval(tab(V.tabDiagram));
    const text = await p.eval(`document.querySelector('.pp-diagram').textContent`);
    if (!text.includes('ID‖') || !text.includes('EX○')) throw new Error('no held cell or bubble');
    await p.eval(`document.querySelector('.pp-diagram tbody tr td.pd-cell button').click(); true`);
    await p.waitFor(`!(${status}).startsWith('cycle 8 ')`);
    await p.eval(tab(V.tabSummary));
    if (!await p.eval(`document.querySelector('.pp-summary').textContent.includes(${JSON.stringify(V.causes.loadUse)})`)) throw new Error('no load-use row');
    await done(p);
  });

  await check('Stop on a stall: a run stops at the load-use stall', async () => {
    const p = await fresh();
    await open(p, LOAD_USE);
    await p.eval(`(() => { const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('summary')?.textContent.startsWith(${JSON.stringify(V.stopOn)}));
      d.querySelector('input').click(); return true; })()`);
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes('Stopped on a stall')`);
    await done(p);
  });

  await check('the base-set template for this view opens in it and runs to R0 = 55', async () => {
    const p = await fresh();
    await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
    await p.waitFor(`[...document.querySelectorAll('.templates-menu .menu-list button')].some((b) => /Pipelined view/.test(b.textContent))`);
    await p.eval(`[...document.querySelectorAll('.templates-menu .menu-list button')].find((b) => /Pipelined view/.test(b.textContent)).click(); true`);
    await p.waitFor(`/base-sum/.test(document.querySelector('.p-editor textarea').value) && (${viewBtn})?.getAttribute('aria-selected') === 'true'`);
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes('reached WB')`);
    if (num(await p.eval(reg('R0'))) !== 55) throw new Error(`R0 ${await p.eval(reg('R0'))}`);
    await done(p);
  });

  await check('the Timing tab: 380 ps set by a taken branch into the PC; Fig 7.60 on the three processors', async () => {
    const p = await fresh();
    await open(p, FIG);
    await p.eval(tab(V.tabTiming));
    const text = await p.eval(`document.querySelector('.sc-timing').textContent`);
    for (const t of ['Clock period: 380 ps, set by EX: PC register', '990 ps', '490 ps', `${want.cycle} (CPI`]) {
      if (!text.includes(t)) throw new Error(`Timing tab without "${t}"`);
    }
    await done(p);
  });

  await check('Extended datapath: chosen in the subset menu, its drawing and label shown, a tier-E program runs to the model\'s end state; the Timing tab gives 500 ps', async () => {
    const p = await fresh();
    await open(p, EXT_PROGRAM);
    await p.eval(`(() => { const s = document.querySelector('select[aria-label=${JSON.stringify(SHELL.view.subset)}]'); s.value = 'extended';
      s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await p.key('Enter', { keyCode: 13, modifiers: 2 });
    await p.waitFor(`[...document.querySelectorAll('svg.dp')].filter((s) => s.getBoundingClientRect().width > 0).length === 1
      && Boolean([...document.querySelectorAll('svg.dp')].find((s) => s.getBoundingClientRect().width > 0).querySelector('[data-id="sh"]'))`);
    if (!await p.eval(`[...document.querySelectorAll('.note')].some((n) => n.offsetParent && n.textContent === ${JSON.stringify(V.ext.badge)})`)) throw new Error('no Extended label');
    await p.key('F5', { keyCode: 116 });
    await p.waitFor(`${consoleText}.includes(${JSON.stringify(haltMsg(wantExt))})`);
    const bad = [];
    for (let i = 0; i < 13; i++) {
      const t = await p.eval(reg(`R${i}`));
      if (t === null || num(t) !== wantExt.R[i]) bad.push(`R${i} ${t} (want ${wantExt.R[i]})`);
    }
    if (bad.length) throw new Error(bad.join(', '));
    await p.eval(tab(V.tabTiming));
    if (!await p.eval(`document.querySelector('.sc-timing').textContent.includes('Clock period: 500 ps')`)) throw new Error('Timing tab');
    await done(p);
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
      await open(p, LOAD_USE);
      await steps(p, 4);
      await p.eval(tab(V.tabHazards));
      await settle(500);
      const f = join(SHOTS, `arm-pipe-view-${scheme}.png`);
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
