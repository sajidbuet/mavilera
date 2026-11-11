// pico2-audio-smoke.mjs -- PWM, DMA and the speaker in a real browser (pico2 P1-M5, docs/architecture/pico2-p1m5-pwm-dma-audio.md
// §4, research D39). Exit criterion (roadmap P1-M5): the PWM + DMA sine example plays without underrun at the configured clock.
// Checks: the Speed menu offers Render and play; the Sound button starts off and turns on; the template "A sine from DMA and
// PWM" opens with GP14 as the speaker (its `opts`); built at clk_sys 4 MHz and run in Real time with Sound on for SECONDS
// (default 60) seconds, the AudioWorklet counts no underrun after the start and plays about SECONDS x 48000 frames; the status
// shows the run's share of real time; the PWM tab lists slice 7 on GP14 and the DMA tab channel 0 paced by PWM wrap 7; Render and
// play runs 2 s and plays them; axe-core finds nothing with the Pins, PWM and DMA tabs open.
//
//   node tools/pico2-audio-smoke.mjs [--browser chrome|edge|firefox] [--isolated] [--seconds 60] [--visible] [--json out.json]
//
// Headless browsers have no sound device: Chrome and Edge render the audio graph at the device's pace without one (R-AUD-01
// caveat 1); nobody listens here (the author's listening test is separate). Autoplay is allowed by a flag (Chrome, Edge) or a
// preference (Firefox) so that the context starts without a real click. Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch } from './browser.mjs';
import { launchFirefox } from './firefox-bidi.mjs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSERS = opt('--browser') ? [opt('--browser')] : ['chrome', 'edge', 'firefox'];
const ISOLATED = args.includes('--isolated');
const SECONDS = Number(opt('--seconds') ?? 60);
const VISIBLE = args.includes('--visible');
const J = JSON.stringify;

const area = `document.querySelector('textarea.ed-input')`;
const setText = (t) => `(() => { const a = ${area}; a.value = ${J(t)}; a.dispatchEvent(new Event('input')); return true; })()`;
const select = (label, v) => `(() => { const s = document.querySelector('select[aria-label=${J(label)}]'); s.value = ${J(v)}; s.dispatchEvent(new Event('change')); return s.value; })()`;
const primary = `document.querySelector('.tool-run')?.getAttribute('aria-label') ?? ''`;
const click = `(document.querySelector('.tool-run').click(), true)`;
const status = `document.querySelector('.run-status')?.textContent ?? ''`;
const msgs = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const openMemTab = (name) => `(() => { const t = [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === ${J(name)}); t?.click(); return Boolean(t); })()`;

const { server, url: origin } = await startServer({ port: 0, isolated: ISOLATED });
let failed = 0;
const results = { date: new Date().toISOString(), isolated: ISOLATED, seconds: SECONDS, browsers: {} };
try {
  for (const name of BROWSERS) {
    const b = name === 'firefox'
      ? await launchFirefox({ headless: !VISIBLE, extraPrefs: ['media.autoplay.default', 0, 'media.autoplay.blocking_policy', 0] })
      : await launch(name, { headless: !VISIBLE, extraArgs: ['--autoplay-policy=no-user-gesture-required'] });
    if (!b) { console.log(`${name}: not installed, skipped`); continue; }
    const R = results.browsers[name] = { version: b.version, checks: {} };
    console.log(`${name} (${b.version}), audio${ISOLATED ? ', cross-origin isolated' : ''}`);
    const check = async (label, fn) => {
      try { const r = await fn(); R.checks[label] = { ok: true, detail: r ?? null }; console.log(`  ok   ${label}${r ? ` — ${typeof r === 'string' ? r : J(r)}` : ''}`); }
      catch (e) { failed++; R.checks[label] = { ok: false, detail: e.message }; console.log(`  FAIL ${label} — ${e.message}`); }
    };
    try {
      const p = await b.newPage({ width: 1366, height: 900 });
      const page = `${origin}?arch=pico2&edition=lite&selftest`;
      const ready = `document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`;
      await p.goto(page);
      await p.eval(`localStorage.clear(); true`);
      await p.goto(page);
      await p.waitFor(ready);
      const pause = async () => { await p.eval(click); await p.waitFor(`!/^Pause/.test(${primary})`, 15000); };

      await check('the Speed menu offers Render and play; Sound starts off and turns on', async () => {
        const sp = await p.eval(`[...document.querySelectorAll('select[aria-label=Speed] option')].map((o) => o.value + (o.selected ? '*' : '')).join(' ')`);
        if (sp !== 'rt* max slow render') throw new Error(`speed "${sp}"`);
        const before = await p.eval(`document.querySelector('.tool-sound')?.getAttribute('aria-pressed')`);
        await p.eval(`document.querySelector('.tool-sound').click(); true`);
        // On a failure, say why: what the page reported and whether this browser can run an AudioContext at all here (the
        // check failed on 2026-11-11 in a session that had run short of memory, and passed unchanged an hour later)
        await p.waitFor(`document.querySelector('.tool-sound')?.getAttribute('aria-pressed') === 'true'`, 10000).catch(async () => {
          const why = await p.eval(`(async () => {
            const out = { messages: ${msgs}.split('\\n').slice(-2) };
            try { const c = new AudioContext({ sampleRate: 48000 }); await Promise.race([c.resume(), new Promise((ok) => setTimeout(ok, 2000))]);
              out.context = c.state; out.rate = c.sampleRate; await c.close(); } catch (e) { out.context = String(e); }
            try { out.outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').length; } catch (e) { out.outputs = String(e); }
            return out; })()`).catch((e) => ({ probe: e.message }));
          throw new Error(`Sound did not turn on in 10 s: ${J(why)}`);
        });
        return `speed "${sp}"; Sound ${before} → on`;
      });

      await check('the template "A sine from DMA and PWM" opens with GP14 as the speaker; it builds at 4 MHz', async () => {
        await p.eval(`document.querySelector('.templates-menu summary').click(); true`);
        await p.waitFor(`[...document.querySelectorAll('.templates-menu button')].some((b) => b.textContent === 'A sine from DMA and PWM')`, 10000);
        await p.eval(`[...document.querySelectorAll('.templates-menu button')].find((b) => b.textContent === 'A sine from DMA and PWM').click(); true`);
        await p.waitFor(`${area}.value.includes('dma-sine.c')`, 10000);
        await sleep(800);
        const t = await p.eval(`${area}.value`);
        await p.eval(setText(t.replace('#define SECONDS 3', `#define SECONDS ${SECONDS + 30}`)));
        await p.eval(select('clk_sys', '4'));
        await p.waitFor(`/^(Build|Compile|Run)/.test(${primary})`, 10000);
        if (!/^Run/.test(await p.eval(primary))) await p.eval(click);
        await p.waitFor(`/^Run/.test(${primary})`, 20000);
        await p.eval(openMemTab('Pins'));
        await sleep(300);
        const sp = await p.eval(`document.querySelector('select[aria-label=Speaker]')?.value`);
        const tag = await p.eval(`document.querySelector('.pp-pin[aria-label^="GP14"] .pp-speaker')?.textContent ?? ''`);
        if (sp !== 'gp14' || tag !== 'speaker') throw new Error(`speaker "${sp}", tag "${tag}"; ${(await p.eval(msgs)).split('\n').slice(-2).join(' | ')}`);
        return `speaker ${sp}, GP14 tagged`;
      });

      await check(`Real time with Sound on: ${SECONDS} s of the sine without an underrun (counted by the AudioWorklet)`, async () => {
        await p.eval(click);
        await p.waitFor(`/^Pause/.test(${primary})`, 10000);
        await sleep(3000); // the start: the context and the first frames
        const transport = await p.eval(`document.querySelector('.run-status').dataset.audio ?? ''`);
        if (!transport) throw new Error(`no audio link; status "${await p.eval(status)}"; ${(await p.eval(msgs)).split('\n').slice(-2).join(' | ')}`);
        const machineS = `(() => { const m = /Real time · ([0-9.]+) s/.exec(${status}); return m ? Number(m[1]) : null; })()`;
        await p.eval(`globalThis.__mavileraTest.audioResetStats(); true`);
        const t0 = Date.now(), m0 = await p.eval(machineS);
        await sleep(SECONDS * 1000);
        const st = await p.eval(`globalThis.__mavileraTest.audioStats()`);
        const wall = (Date.now() - t0) / 1000, s = await p.eval(status), m1 = await p.eval(machineS);
        const pace = (m1 - m0) / wall;
        R.audio = { ...st, wall, status: s, transport, machineS: m1 - m0, pace };
        await pause();
        const expect = wall * 48000;
        if (!st || st.underrunCalls !== 0) throw new Error(`${J(st)}; machine ${(pace * 100).toFixed(2)} % of wall time; "${s}"`);
        if (!(st.frames > 0.95 * expect)) throw new Error(`${st.frames} frames played in ${wall.toFixed(1)} s (expected about ${Math.round(expect)}); ${J(st)}`);
        if (!(Math.abs(pace - 1) < 0.02)) throw new Error(`machine time ${(m1 - m0).toFixed(3)} s in ${wall.toFixed(1)} s of wall time: not paced by the sound`);
        return `${st.frames} frames in ${wall.toFixed(1)} s, 0 underruns, ${st.calls} render calls, machine ${(pace * 100).toFixed(2)} % of wall time, buffer up to ${st.maxFill} frames (${transport}); "${s}"`;
      });

      await check('the PWM tab lists slice 7 on GP14; the DMA tab channel 0 paced by PWM wrap 7', async () => {
        await p.eval(openMemTab('PWM'));
        await sleep(300);
        const pwm = await p.eval(`[...document.querySelectorAll('.dv-pwm tbody tr')].map((r) => r.textContent).join(' | ')`);
        await p.eval(openMemTab('DMA'));
        await sleep(300);
        const dma = await p.eval(`[...document.querySelectorAll('.dv-dma tbody tr')].map((r) => r.textContent).join(' | ')`);
        if (!/GP14/.test(pwm) || !/PWM wrap 7/.test(dma)) throw new Error(`PWM "${pwm}"; DMA "${dma}"`);
        return `PWM "${pwm.slice(0, 90)}"; DMA "${dma.slice(0, 90)}"`;
      });

      await check('Render and play: 2 s at full speed, then played', async () => {
        await p.eval(select('Speed', 'render'));
        await p.eval(`(() => { const i = document.querySelector('.render-secs'); i.value = '2'; i.dispatchEvent(new Event('change')); return true; })()`);
        await p.eval(`document.querySelector('.tool-reset')?.click(); true`);
        await sleep(300);
        await p.eval(click);
        await p.waitFor(`/Playing [0-9.]+ s/.test(${msgs})`, 60000);
        const m = (await p.eval(msgs)).split('\n').filter((l) => /Playing/.test(l)).pop();
        await p.eval(select('Speed', 'rt'));
        return m;
      });

      if (name !== 'firefox') {
        await check('axe-core: nothing found with the Pins, PWM and DMA tabs open', async () => {
          await p.eval(AXE);
          const found = [];
          for (const tab of ['Pins', 'PWM', 'DMA']) {
            await p.eval(openMemTab(tab)); await sleep(200);
            const v = await p.eval(`axe.run(document, { runOnly: ${J(AXE_TAGS)} }).then((r) => r.violations.map((x) => x.id + ': ' + x.nodes.length + ' (' + x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join('; ') + ')'))`);
            if (v.length) found.push(`${tab}: ${v.join(', ')}`);
          }
          if (found.length) throw new Error(found.join(' / '));
          return 'no violations';
        });
      }
      R.errors = p.errors.slice(0, 5);
      if (p.errors.length) { failed++; console.log(`  FAIL page errors — ${p.errors.slice(0, 3).join(' | ')}`); }
    } finally { await b.close(); }
  }
} finally {
  server.close();
  if (opt('--json')) writeFileSync(opt('--json'), `${J(results, null, 2)}\n`);
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
