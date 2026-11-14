// browser.mjs -- development-only driver for a locally installed browser
// (WS-V-031, spec W-D18): Chrome or Edge over the Chrome DevTools Protocol,
// with Node's own WebSocket and no npm package. Used by the smoke tests.
//
//   const b = await launch('chrome');      // or 'edge'; null if not installed
//   const page = await b.newPage({ width: 1366, height: 768 });
//   await page.goto(url); await page.eval('document.title'); await b.close();
//
// Paths: CHROME_PATH / EDGE_PATH, else the usual install locations.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PF = process.env.ProgramFiles ?? 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
const CANDIDATES = {
  chrome: [process.env.CHROME_PATH, join(PF, 'Google/Chrome/Application/chrome.exe'), join(PF86, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'],
  edge: [process.env.EDGE_PATH, join(PF86, 'Microsoft/Edge/Application/msedge.exe'), join(PF, 'Microsoft/Edge/Application/msedge.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/microsoft-edge'],
};

/** The executable of a browser, or null. */
export function findBrowser(name) {
  return (CANDIDATES[name] ?? []).find((p) => p && existsSync(p)) ?? null;
}

/** Start a headless browser; null if it is not installed. */
export async function launch(name, { headless = true, extraArgs = [] } = {}) {
  const exe = findBrowser(name);
  if (!exe) return null;
  const profile = mkdtempSync(join(tmpdir(), `risc-vista-${name}-`));
  // extraArgs (pico2 P1-M5): e.g. --autoplay-policy=no-user-gesture-required for the audio smoke
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-sync', '--disable-background-networking', '--disable-component-update', '--metrics-recording-only',
    ...(headless ? ['--headless=new'] : []), ...extraArgs, 'about:blank'];
  const proc = spawn(exe, args, { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(50);
  let lines = [];
  for (let i = 0; i < 40; i++) {
    // Windows: the browser may still hold the file open while writing it (EBUSY); try again
    try { lines = existsSync(portFile) ? readFileSync(portFile, 'utf8').trim().split('\n') : []; } catch { lines = []; }
    if (lines.length >= 2) break;
    await sleep(50);
  }
  if (lines.length < 2) { proc.kill(); throw new Error(`${name}: no DevTools port`); }
  const cdp = await connect(`ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`);
  const version = (await cdp.send('Browser.getVersion')).product;
  return {
    name, version,
    async newPage(opts) { return openPage(cdp, opts); },
    async close() {
      try { await cdp.send('Browser.close'); } catch { /* already gone */ }
      cdp.ws.close();
      await new Promise((ok) => { if (proc.exitCode !== null) ok(); else { proc.once('exit', ok); setTimeout(() => { proc.kill(); ok(); }, 3000); } });
      for (let i = 0; i < 10; i++) {
        try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(200); } // Windows releases files late
      }
    },
  };
}

/** A CDP connection: send(method, params, sessionId) and event listeners. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error(`cannot connect to ${url}`)); });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { ok, fail } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) fail(new Error(`${m.error.message}${m.error.data ? `: ${m.error.data}` : ''}`)); else ok(m.result);
    } else if (m.method) for (const f of listeners) f(m);
  };
  return {
    ws,
    send(method, params = {}, sessionId) {
      const msg = { id: ++id, method, params, ...(sessionId ? { sessionId } : {}) };
      return new Promise((ok, fail) => { pending.set(msg.id, { ok, fail }); ws.send(JSON.stringify(msg)); });
    },
    on(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}

async function openPage(cdp, { width = 1366, height = 768, colorScheme = null, reducedMotion = null } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);
  const errors = [];
  const waiters = new Set();
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`.trim());
    for (const w of waiters) w(m);
  });
  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable')]);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const features = [];
  if (colorScheme) features.push({ name: 'prefers-color-scheme', value: colorScheme });
  if (reducedMotion) features.push({ name: 'prefers-reduced-motion', value: reducedMotion });
  if (features.length) await send('Emulation.setEmulatedMedia', { features });
  const event = (name, ms = 15000) => new Promise((ok, fail) => {
    const t = setTimeout(() => { waiters.delete(w); fail(new Error(`timeout waiting for ${name}`)); }, ms);
    const w = (m) => { if (m.method === name) { clearTimeout(t); waiters.delete(w); ok(m.params); } };
    waiters.add(w);
  });

  const page = {
    errors,
    /** A raw DevTools protocol call on this page's session. */
    send,
    /** Load `url` and wait for the load event, and for the loading screen of a tool page (#boot, src/ui/boot.js) to go:
     *  a check made while it fades would measure the transition, not the page. */
    async goto(url) {
      const loaded = event('Page.loadEventFired');
      const r = await send('Page.navigate', { url });
      if (r.errorText) throw new Error(`${url}: ${r.errorText}`);
      await loaded;
      await page.waitFor(`!document.getElementById('boot')`, 20000).catch(() => {});
    },
    /** Evaluate an expression (promises awaited) and return its value. */
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    /** Wait until `expression` is truthy (polled). */
    async waitFor(expression, ms = 15000) {
      const end = Date.now() + ms;
      for (;;) {
        const v = await page.eval(expression).catch(() => null);
        if (v) return v;
        if (Date.now() > end) throw new Error(`timeout: ${expression}`);
        await sleep(50);
      }
    },
    /**
     * A mouse event at page point (x, y): type 'mousePressed', 'mouseMoved' (with `down`: the left button held) or 'mouseReleased'.
     */
    async mouse(type, x, y, { down = false, clickCount = 1, modifiers = 0 } = {}) {
      const pressed = type === 'mousePressed' || (type === 'mouseMoved' && down);
      await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: pressed ? 1 : 0, clickCount, modifiers });
    },
    /** Text typed into the focused field, as the keyboard's text input gives it (Input.insertText). */
    async type(text) { await send('Input.insertText', { text }); },
    /**
     * A key press as the user makes it (keyDown and keyUp), with modifiers 1 Alt, 2 Ctrl, 4 Meta, 8 Shift. With `text` (Enter: '\r')
     * the key also gives its character, so that the browser's own default action follows (a native button's activation, a text
     * field's change).
     */
    async key(key, { code = key, keyCode = 0, modifiers = 0, text = undefined } = {}) {
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await send('Input.dispatchKeyEvent', text === undefined ? { type: 'rawKeyDown', ...base } : { type: 'keyDown', text, unmodifiedText: text, ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async screenshot(format = 'png', quality = undefined) {
      return Buffer.from((await send('Page.captureScreenshot', { format, quality })).data, 'base64');
    },
    async close() { await cdp.send('Target.closeTarget', { targetId }); },
  };
  return page;
}
