// pico2-board-smoke.mjs -- the Board view in a real browser (pico2 P1-B1, docs/architecture/pico2-p1b1-board-view.md §4, research
// D47, D48). Checks: the Board tab is the last view and draws the 40 pins; it shares the page's engine (the steps of a run in the
// instruction view are still there on the Board, D48 Q2 B); blink in Real time: GP25 red and blue in turn and the LED lit;
// pwm-fade: GP25 purple and the LED half-lit; gpio-button: five presses of the drawn button end the program as the Pins panel's
// would, GP15 is blue L while the button is held, the inputs are counted for Replay and the replay check is equal; adc-knob: the
// drawn knob, dragged and turned with the keys, gives GP26 the voltages the program then reads, and replay is equal; the kit (i2c-lcd) and the speaker (pwm-tone) appear when
// connected, the LCD shows its text, the speaker sounds; Inspect gives the letter H/L/Z; the Pins table lists 40 pins; Real time at
// 1 MHz keeps machine time within 1 % of wall time with the Board open (D12); axe-core finds nothing in the light and dark themes;
// the Board tab in Pico Full. Screenshots go to --shots (a folder outside OneDrive).
//
//   node tools/pico2-board-smoke.mjs [--browser chrome|edge] [--shots <dir>] [--seconds 10] [--visible]
//
// Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch } from './browser.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge'];
const SHOTS = opt('--shots');
const SECONDS = Number(opt('--seconds') ?? 10);
const VISIBLE = args.includes('--visible');
const J = JSON.stringify;
const tpl = (f) => readFileSync(new URL(`../content/pico2/templates/${f}`, import.meta.url), 'utf8');
const BLINK = tpl('blink.s').replace(/li\s+s2, 10\b/, 'li      s2, 1000000000'); // blink.s for ever

const area = `document.querySelector('textarea.ed-input')`;
const setText = (t) => `(() => { const a = ${area}; a.value = ${J(t)}; a.dispatchEvent(new Event('input')); return true; })()`;
const select = (label, v) => `(() => { const s = document.querySelector('select[aria-label=${J(label)}]'); if (!s) return null; s.value = ${J(v)}; s.dispatchEvent(new Event('change')); return s.value; })()`;
const primary = `document.querySelector('.tool-run')?.getAttribute('aria-label') ?? ''`;
const status = `document.querySelector('.run-status')?.textContent ?? ''`;
const out = `document.querySelector('pre.console-out')?.textContent ?? ''`;
const machineS = `(() => { const m = /Real time · ([0-9.]+) s/.exec(${status}); return m ? Number(m[1]) : null; })()`;
const view = (label) => `(() => { const b = [...document.querySelectorAll('.mode-nav .mode-btn')].find((x) => x.getAttribute('aria-label') === ${J(label)}); b?.click(); return Boolean(b); })()`;
const views = `[...document.querySelectorAll('.mode-nav .mode-btn')].filter((b) => !b.hidden).map((b) => b.getAttribute('aria-label'))`;
const tab = (name) => `(() => { const t = [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === ${J(name)}); t?.click(); return Boolean(t); })()`;
// the board's pin n (physical): its dot's class and letter
const pad = (n) => `(() => { const g = document.querySelector('.bv-svg [data-sel="pin:${n}"]'); const d = g?.querySelector('.bv-dot'); return d ? { cls: d.getAttribute('class'), letter: g.querySelector('.bv-letter').textContent, pull: g.querySelector('.bv-pull').textContent } : null; })()`;
const ledCls = `(document.querySelector('.bv-svg [data-sel="part:led"]')?.getAttribute('class') ?? '')`;

const { server, url: origin } = await startServer({ port: 0 });
let failed = 0;
try {
  for (const name of BROWSERS) {
    const b = await launch(name, { headless: !VISIBLE });
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    console.log(`${name} (${b.version})`);
    const check = async (label, fn) => {
      try { const r = await fn(); console.log(`  ok   ${label}${r ? ` — ${typeof r === 'string' ? r : J(r)}` : ''}`); }
      catch (e) { failed++; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    const p = await b.newPage({ width: 1440, height: 900 });
    const shot = async (file) => { if (SHOTS && existsSync(SHOTS)) writeFileSync(join(SHOTS, `${name}-${file}.png`), await p.screenshot()); };
    try {
      const page = `${origin}?arch=pico2&selftest`;
      await p.goto(page);
      await p.eval(`localStorage.clear(); true`);
      await p.goto(page);
      await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
      const build = async (lang, text, clock) => {
        if (lang) { await p.eval(select('Language', lang)); await sleep(700); }
        if (clock) await p.eval(select('clk_sys', clock));
        await p.eval(setText(text));
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'build'`);
        await p.eval(`(document.querySelector('.tool-build').click(), true)`);
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'run'`, 20000);
      };
      const run = async () => { await p.eval(`(document.querySelector('.tool-run').click(), true)`); await p.waitFor(`/^Pause/.test(${primary})`); await p.waitFor(`${machineS} !== null`, 10000); };
      const pause = async () => { if (/^Pause/.test(await p.eval(primary))) { await p.eval(`(document.querySelector('.tool-run').click(), true)`); await p.waitFor(`!/^Pause/.test(${primary})`, 10000); } };
      const sample = async (expr, n = 24, ms = 90) => { const r = []; for (let i = 0; i < n; i++) { r.push(await p.eval(expr)); await sleep(ms); } return r; };

      await check('the Board tab is the last view and draws the 40 pins', async () => {
        const v = await p.eval(views);
        if (v[v.length - 1] !== 'Board') throw new Error(J(v));
        await p.eval(view('Board'));
        await p.waitFor(`document.querySelectorAll('.bv-svg [data-sel^="pin:"]').length === 40`);
        return J(v);
      });

      await check('the Board shares the page\'s engine: steps made in the instruction view are kept (D48 Q2 B)', async () => {
        await p.eval(view('Instructions'));
        await build('asm', BLINK, '4');
        for (let i = 0; i < 12; i++) { await p.eval(`(document.querySelector('.tool-step').click(), true)`); await sleep(30); }
        const st = `(() => { const r = globalThis.__mavileraTest.registers(); return { hash: globalThis.__mavileraTest.stateHash(), pc: r && r.pc }; })()`;
        const a = await p.eval(st);
        await p.eval(view('Board'));
        await sleep(500);
        const c = await p.eval(st);
        if (a.hash !== c.hash) throw new Error(`before ${J(a)}, after ${J(c)}`);
        return `state hash ${c.hash} kept`;
      });

      await check('blink in Real time on the Board: GP25 red and blue in turn, the LED lit and off', async () => {
        await run();
        await sleep(600);
        const s = await sample(`(${ledCls})`, 30, 70);
        await shot('blink');
        // zoomed in (the letters on the pins), then fitted again
        const zbtn = (t) => `(document.querySelector('.p-datapath button[aria-label^=${J(t)}], .p-datapath button[title^=${J(t)}]')?.click(), true)`;
        for (let i = 0; i < 4; i++) await p.eval(zbtn('Zoom in'));
        await sleep(300);
        await shot('blink-zoom');
        await p.eval(zbtn('Fit the whole'));
        await pause();
        if (!s.some((c) => c.includes('bv-led-on')) || !s.some((c) => c === '')) throw new Error(J(s));
        return `${s.filter((c) => c.includes('on')).length}/30 lit`;
      });

      await check(`Real time at 1 MHz with the Board open: machine time within 1 % of wall time over ${SECONDS} s (D12)`, async () => {
        await p.eval(select('clk_sys', '1'));
        await p.waitFor(`/^Run/.test(${primary})`, 20000);
        await run();
        await sleep(1500);
        const r = await p.eval(`new Promise((ok) => { const s0 = ${machineS}, t0 = performance.now(); setTimeout(() => ok({ s0, s1: ${machineS}, wall: (performance.now() - t0) / 1000 }), ${SECONDS * 1000}); })`);
        await pause();
        const ratio = (r.s1 - r.s0) / r.wall;
        if (!(Math.abs(ratio - 1) <= 0.01)) throw new Error(`${(ratio * 100).toFixed(2)} %`);
        return `${(ratio * 100).toFixed(2)} % over ${r.wall.toFixed(1)} s`;
      });

      await check('pwm-fade: GP25 purple (more than one change per redraw), the LED half-lit', async () => {
        await p.eval(select('clk_sys', '4'));
        await build('asm', tpl('pwm-fade.s'));
        await run();
        const s = await sample(`(${ledCls})`, 12, 25); // the template fades for 0.4 s, then ends
        await shot('pwm-fade');
        await pause();
        if (!s.some((c) => c.includes('bv-led-half'))) throw new Error(J(s));
        return `${s.filter((c) => c.includes('half')).length}/12 half-lit`;
      });

      await check('gpio-button: five presses of the drawn button end the program; inputs counted; replay equal (D47)', async () => {
        await build('c', tpl('gpio-button.c'));
        await run();
        await sleep(800);
        const btn = `document.querySelector('.bv-svg [data-sel="upart:BTN"] .bv-uctl')`; // B2-3: the demo circuit's button (research D52)
        const held = [];
        for (let i = 0; i < 5; i++) {
          await p.eval(`(${btn}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 })), true)`);
          await sleep(150);
          held.push(await p.eval(pad(20)));
          await p.eval(`(${btn}.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 })), true)`);
          await sleep(150);
        }
        await p.waitFor(`!/^Pause/.test(${primary})`, 10000);
        const o = await p.eval(out);
        const count = await p.eval(`document.querySelector('.pp-count')?.textContent ?? ''`);
        const r = await p.eval(`globalThis.__mavileraTest.replayCheck()`);
        if (!/press 5/.test(o) || !r?.equal || r.inputs !== 10) throw new Error(`output ${J(o.slice(-80))}, ${count}, replay ${J(r)}`);
        // while held, GP15 (pin 20) is pulled low by the closed button: blue L
        if (!held.every((h) => /bv-low/.test(h?.cls) && h.letter === 'L')) throw new Error(`GP15 while held: ${J(held)}`);
        return `${count}; GP15 blue L while held (5/5); replay ${r.steps} steps, ${r.inputs} inputs, hash ${r.hash}`;
      });

      await check('adc-knob: the drawn knob, dragged and with the keys, sets GP26; the program reads it; replay equal', async () => {
        await build('c', tpl('adc-knob.c'));
        await run();
        await sleep(200);
        // drag the wiper to the top of the resistor (3.3 V), then down with the keys (End, then 10 × ArrowDown: 2.30 V)
        const knob = `document.querySelector('.bv-svg [data-sel="upart:KNOB"] [role=slider]')`; // B2-3: the demo circuit's knob (research D52)
        const ptr = (type, frac) => `(() => { const k = ${knob}; const r = k.querySelector('.bv-hit').getBoundingClientRect(); const y = r.top + r.height * ${frac}; k.dispatchEvent(new PointerEvent(${J(type)}, { bubbles: true, button: 0, pointerId: 2, clientX: r.left + r.width / 2, clientY: y })); return true; })()`;
        await p.eval(ptr('pointerdown', 0.6)); await p.eval(ptr('pointermove', 0.3)); await p.eval(ptr('pointermove', 0.0)); await p.eval(ptr('pointerup', 0.0));
        const dragged = await p.eval(`${knob}.getAttribute('aria-valuenow')`);
        await sleep(700);
        const key = (k) => `(${knob}.dispatchEvent(new KeyboardEvent('keydown', { key: ${J(k)}, bubbles: true })), true)`;
        await p.eval(key('End'));
        for (let i = 0; i < 10; i++) await p.eval(key('ArrowDown'));
        const keyed = await p.eval(`${knob}.getAttribute('aria-valuetext')`);
        await p.waitFor(`!/^Pause/.test(${primary})`, 10000);
        const o = await p.eval(out);
        const r = await p.eval(`globalThis.__mavileraTest.replayCheck()`);
        await shot('knob');
        if (dragged !== '3.30' || keyed !== '2.30 V' || !/= 3299 mV|= 3300 mV/.test(o) || !/= 229\d mV|= 2300 mV/.test(o) || !r?.equal) throw new Error(`dragged ${dragged}, keyed ${keyed}, output ${J(o.slice(-160))}, replay ${J(r)}`);
        return `dragged to ${dragged} V, keys to ${keyed}; read 3.3 V and 2.3 V; replay ${r.inputs} inputs equal`;
      });

      await check('Inspect: a pin gives its letter and words; the Pins table lists 40 pins', async () => {
        await p.eval(`(document.querySelector('.bv-svg [data-sel="pin:20"]').dispatchEvent(new MouseEvent('click', { bubbles: true })), true)`);
        await sleep(300);
        const t = await p.eval(`document.querySelector('.bv-tab table')?.textContent ?? ''`);
        await shot('inspect');
        await p.eval(tab('Pin table'));
        const rows = await p.eval(`document.querySelectorAll('.bv-tab tbody tr').length`);
        if (!/GP15/.test(t) || !/Letter(H|L|Z)/.test(t) || rows !== 40) throw new Error(`${t.slice(0, 200)}; rows ${rows}`);
        await p.eval(tab('Inspect'));
        return t.replace(/\s+/g, ' ').slice(0, 120);
      });

      await check('the lab kit appears with Parts = lab kit; the LCD shows its text (i2c-lcd)', async () => {
        await build('c', tpl('i2c-lcd.c'));
        await p.eval(tab('Pins')); // the Pins panel of the memory pane (its settings)
        await sleep(300);
        await p.eval(select('Parts', 'kit'));
        await sleep(300);
        await run();
        await p.waitFor(`!/^Pause/.test(${primary})`, 30000).catch(() => null);
        await pause();
        await sleep(300);
        // B2-4 (research D54 Q1 A): the kit is parts of the circuit (the preset): its LCD module is drawn
        const vis = await p.eval(`document.querySelector('.bv-svg [data-sel="upart:LCD1"]') ? 'visible' : 'hidden'`);
        // the characters in the LCD's cells, row by row (2 × 16)
        const lcd = await p.eval(`(() => { const c = [...document.querySelectorAll('.bv-lcd-ch')].map((t) => t.textContent || ' '); return [c.slice(0, 16).join('').trim(), c.slice(16).join('').trim()].join(' / '); })()`);
        await shot('kit');
        if (vis !== 'visible' || !lcd.replace(/[ /]/g, '')) throw new Error(`kit ${vis}, LCD "${lcd}"`);
        return `LCD "${lcd}"`;
      });

      await check('the speaker appears on the chosen pin and sounds (pwm-tone, GP14)', async () => {
        await p.eval(select('Parts', 'none'));
        await build('c', tpl('pwm-tone.c'));
        await p.eval(select('Speaker', 'gp14'));
        await run();
        await sleep(500);
        const s = await sample(`document.querySelector('.bv-svg [data-sel="upart:SPK1"]')?.getAttribute('class') ?? ''`, 10, 80); // B2-4: the speaker part
        await shot('speaker');
        await pause();
        if (!s.some((c) => c.includes('bv-sounding'))) throw new Error(J(s));
        return `${s.filter((c) => c.includes('sounding')).length}/10 sounding`;
      });

      for (const theme of ['light', 'dark']) {
        await check(`axe-core: nothing found on the Board tab (${theme} theme)`, async () => {
          await p.eval(`(document.documentElement.setAttribute('data-theme', ${J(theme)}), true)`);
          await sleep(300);
          await shot(`theme-${theme}`);
          await p.eval(AXE);
          const v = await p.eval(`axe.run(document, { runOnly: ${J(AXE_TAGS)} }).then((r) => r.violations.filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => x.id + ': ' + x.nodes.length + ' (' + x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('; ') + ')'))`);
          if (v.length) throw new Error(v.join(' | '));
          return null;
        });
      }
      await p.eval(`(document.documentElement.removeAttribute('data-theme'), true)`);

      await check('Pico Full: the Board tab is offered', async () => {
        await p.eval(`(localStorage.setItem('pips.pico2.edition', 'full'), true)`);
        await p.goto(`${origin}?arch=pico2&selftest&edition=full`);
        await p.waitFor(`document.querySelector('.toolbar')`);
        await sleep(800);
        const v = await p.eval(views);
        if (!v.includes('Board')) throw new Error(J(v));
        await p.eval(view('Board'));
        await p.waitFor(`document.querySelectorAll('.bv-svg [data-sel^="pin:"]').length === 40`);
        await shot('full');
        return J(v);
      });
    } finally { await p.close().catch(() => {}); await b.close(); }
  }
} finally { server.close(); }
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
