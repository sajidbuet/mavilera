// firefox-bidi.mjs -- development-only driver for a locally installed Firefox over WebDriver BiDi (Firefox's remote protocol;
// its CDP support was removed), with Node's own WebSocket and no npm package. The page object has the part of
// tools/browser.mjs's interface the pico2 smoke tests use: goto, eval (promises awaited; the value deserialised from BiDi's
// RemoteValue), waitFor, errors, close. Used by tools/pico2-realtime-smoke.mjs for the Firefox gate (pico2 P1-M4, D36 Q7).
//
//   const b = await launchFirefox();         // null if Firefox is not installed (FIREFOX_PATH, else the usual places)
//   const page = await b.newPage({ width: 1366, height: 768 }); await page.goto(url); await page.eval('document.title');
//
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PF = process.env.ProgramFiles ?? 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
const CANDIDATES = [process.env.FIREFOX_PATH, join(PF, 'Mozilla Firefox/firefox.exe'), join(PF86, 'Mozilla Firefox/firefox.exe'),
  '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox'];
// a quiet profile: no first-run pages, updates, telemetry or default-browser question
const PREFS = ['browser.shell.checkDefaultBrowser', false, 'browser.startup.homepage_override.mstone', '"ignore"', 'app.update.disabledForTesting', true,
  'datareporting.policy.dataSubmissionEnabled', false, 'toolkit.telemetry.reportingpolicy.firstRun', false, 'browser.aboutwelcome.enabled', false,
  'dom.disable_open_during_load', false, 'remote.prefs.recommended', true];

/** BiDi's RemoteValue as a plain value. */
function value(v) {
  if (!v) return undefined;
  switch (v.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': case 'boolean': return v.value;
    case 'number': return typeof v.value === 'number' ? v.value : { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 }[v.value];
    case 'bigint': return BigInt(v.value);
    case 'array': case 'set': return (v.value ?? []).map(value);
    case 'object': case 'map': return Object.fromEntries((v.value ?? []).map(([k, x]) => [typeof k === 'string' ? k : value(k), value(x)]));
    default: return v.value !== undefined ? v.value : `[${v.type}]`;
  }
}

/** Start Firefox with WebDriver BiDi; null if it is not installed. */
export async function launchFirefox({ headless = true, extraPrefs = [] } = {}) {
  const exe = CANDIDATES.find((p) => p && existsSync(p));
  if (!exe) return null;
  const profile = mkdtempSync(join(tmpdir(), 'mavilera-firefox-'));
  // extraPrefs (pico2 P1-M5): name/value pairs as PREFS, e.g. media.autoplay.default 0 for the audio smoke
  writeFileSync(join(profile, 'user.js'), [...PREFS, ...extraPrefs].reduce((s, x, i) => (i % 2 ? `${s}${x});\n` : `${s}user_pref(${JSON.stringify(x)}, `), ''));
  const port = 9300 + Math.floor(Math.random() * 600);
  const proc = spawn(exe, ['--remote-debugging-port', String(port), '--profile', profile, '--no-remote', ...(headless ? ['--headless'] : [])],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error('Firefox did not start its remote agent')), 30000);
    const on = (d) => { buf += d; const m = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); ok(m[1]); } };
    proc.stderr.on('data', on); proc.stdout.on('data', on);
    proc.once('exit', (c) => fail(new Error(`Firefox exited (${c})`)));
  });
  const ws = new WebSocket(`${url}/session`);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('BiDi connection failed')); });
  let id = 0;
  const pending = new Map(), listeners = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.type === 'error') p.fail(new Error(`${m.error}: ${m.message}`)); else p.ok(m.result);
    } else if (m.type === 'event') for (const f of listeners) f(m);
  };
  const send = (method, params = {}) => new Promise((ok, fail) => { const n = ++id; pending.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params })); });
  const s = await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  const version = `Firefox ${s.capabilities.browserVersion}`;
  return {
    version,
    async newPage({ width = 1366, height = 768 } = {}) {
      const { context } = await send('browsingContext.create', { type: 'tab' });
      await send('browsingContext.setViewport', { context, viewport: { width, height } });
      const errors = [];
      await send('session.subscribe', { events: ['log.entryAdded'], contexts: [context] });
      listeners.add((m) => { if (m.method === 'log.entryAdded' && m.params.level === 'error' && m.params.source?.context === context) errors.push(m.params.text); });
      const page = {
        errors,
        send: async () => { throw new Error('not available in Firefox (WebDriver BiDi)'); },
        async goto(u) {
          await send('browsingContext.navigate', { context, url: u, wait: 'complete' });
          await page.waitFor(`!document.getElementById('boot')`, 20000).catch(() => {});
        },
        async eval(expression) {
          const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true, userActivation: true,
            resultOwnership: 'none', serializationOptions: { maxObjectDepth: 12, maxDomDepth: 0 } });
          if (r.type === 'exception') throw new Error(r.exceptionDetails?.text ?? 'exception');
          return value(r.result);
        },
        async waitFor(expression, ms = 15000) {
          const end = Date.now() + ms;
          for (;;) {
            const v = await page.eval(expression).catch(() => null);
            if (v) return v;
            if (Date.now() > end) throw new Error(`timeout: ${expression}`);
            await sleep(50);
          }
        },
        async close() { await send('browsingContext.close', { context }).catch(() => {}); },
      };
      return page;
    },
    async close() {
      try { await send('browser.close'); } catch { /* gone */ }
      try { ws.close(); } catch { /* closed */ }
      await new Promise((ok) => { if (proc.exitCode !== null) ok(); else { proc.once('exit', ok); setTimeout(() => { proc.kill(); ok(); }, 5000); } });
      try { rmSync(profile, { recursive: true, force: true }); } catch { /* in use */ }
    },
  };
}
