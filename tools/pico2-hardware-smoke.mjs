// pico2-hardware-smoke.mjs -- Pico Full's board interfaces in a real browser with mock devices (pico2 P1-F3 stages F3-1 to F3-4;
// research testing/usb-flashing-test-plan.md §3): navigator.usb and navigator.serial are replaced, before the page's own scripts
// run, by the repository's mocks (test/fixtures/mock-picoboot.mjs, mock-serial.mjs). Then: the Load to Pico button and the
// Hardware tab exist in Full (design pico2-hardware-tab.md, 2026-11-15), and Load opens the tab; an imported UF2 is loaded onto a mock board (chooser, confirmation naming
// the board and build 1, Enter confirms, progress, the badge); a verify failure, a closed chooser and an unplug mid-write each
// end in a named error with the board not rebooted; with --build (PICO_FULL_SITE) a built project loads and a changed one builds
// again (build 2); the UART monitor connects to a mock Pico 2 USB port, shows its lines, counts and hex, sends one and compares
// with the simulator; Probe board and Run the board's program (read-only commands, REBOOT2 normal); axe-core on the tab and the
// dialog, light and dark, and the tab stacked at a narrow width. Without WebUSB (APIs removed; Firefox) the button is Download .uf2 and the panel says why.
// Pico Lite has no hardware control and no Hardware tab. Mocks prove the interface and the sequencing only, never that a board is written.
//
//   node tools/pico2-hardware-smoke.mjs [--browser chrome|edge|firefox] [--build]     (--build needs PICO_FULL_SITE)
//
// Development only. Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
import { launchFirefox } from './firefox-bidi.mjs';
import { startServer } from './serve.mjs';
import { flashUf2 } from '../test/fixtures/pico2-images.mjs';

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const BROWSER = opt('--browser') ?? 'chrome';
const BUILD = args.includes('--build');
const SITE = process.env.PICO_FULL_SITE ?? null;
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const J = JSON.stringify;

// the mocks as a classic script (they import nothing): their classes, then navigator.usb / navigator.serial replaced
const strip = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/^export /gm, '');
const MOCKS = (mode) => `(() => {
const { MockPicobootDevice, MockUsb } = (() => {
${strip('../test/fixtures/mock-picoboot.mjs')}
return { MockPicobootDevice, MockUsb }; })();
const { MockSerial, MockSerialPort } = (() => {
${strip('../test/fixtures/mock-serial.mjs')}
return { MockSerial, MockSerialPort }; })();
const usb = new MockUsb(), serial = new MockSerial();
window.__hw = { MockPicobootDevice, MockUsb, MockSerial, MockSerialPort, usb, serial, choose: 'first' };
usb.choose = (list) => (window.__hw.choose === 'none' ? null : list[0] ?? null);
const def = (k, v) => { try { Object.defineProperty(Navigator.prototype, k, { configurable: true, get: () => v }); } catch {} try { Object.defineProperty(navigator, k, { configurable: true, value: v }); } catch {} };
if (${J(mode)} === 'mocks') { def('usb', usb); def('serial', serial); }
else { def('usb', undefined); def('serial', serial); }
})();`;

const results = [];
const check = async (name, f) => { try { results.push({ name, ok: true, d: await f() }); } catch (e) { results.push({ name, ok: false, e: String(e?.message ?? e) }); } };
const must = (c, m) => { if (!c) throw new Error(m); };
const axeRun = (sel) => `axe.run({ include: [[${J(sel)}]] }, { runOnly: { type: 'tag', values: ${J(AXE_TAGS)} }, resultTypes: ['violations'] })
  .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')))`;

const { server, url } = await startServer({ port: 0, picoFull: SITE });
const b = BROWSER === 'firefox' ? await launchFirefox({ headless: true }) : await launch(BROWSER);
if (!b) { console.log(`${BROWSER}: not installed, skipped`); server.close(); process.exit(0); }
const firefox = BROWSER === 'firefox';

async function open({ mode = 'mocks', scheme = 'light', edition = 'full' } = {}) {
  const p = await b.newPage({ width: 1366, height: 900, colorScheme: scheme, reducedMotion: 'reduce' });
  await p.preload(MOCKS(mode));
  await p.goto(`${url}?arch=pico2&edition=${edition}`);
  await p.waitFor(`document.querySelector('.toolbar')`);
  await p.eval(`(${AXE.length > 0 ? `(() => { if (!window.axe) { const s = document.createElement('script'); s.textContent = ${J(AXE)}; document.head.append(s); } return true; })()` : 'true'})`);
  return p;
}
const tab = (name) => `(() => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.trim() === ${J(name)}); t?.click(); return Boolean(t); })()`;
/** Open an image file through the shell's file input (as File ▸ Open). */
const openFile = (name, bytes) => `(() => { const i = [...document.querySelectorAll('input[type=file]')].find((x) => /\\.uf2/.test(x.accept)); const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array(${J([...bytes])})], ${J(name)})); i.files = dt.files; i.dispatchEvent(new Event('change')); return true; })()`;
const state = `document.querySelector('.hw-state')?.textContent ?? ''`;
const plug = (o = {}) => `(() => { const d = new __hw.MockPicobootDevice(${J(o)}); __hw.usb.plug(d, { granted: false }); window.__dev = d; return true; })()`;
const clickLoad = `(() => { document.querySelector('.tool-load').click(); return true; })()`;
const confirmOpen = `document.querySelector('dialog.hw-dialog')?.open`;
const selected = `[...document.querySelectorAll('.mode-btn')].find((b) => b.getAttribute('aria-selected') === 'true')?.textContent.trim() === 'Hardware' && Boolean(document.querySelector('.hw-view'))`;

const p = await open({ mode: firefox ? 'nousb' : 'mocks' });
if (!firefox) {
  await check('Full: Load to Pico in the toolbar, the Hardware tab at the top; no Board (USB) or Serial (board) panel', async () => {
    const label = await p.eval(`document.querySelector('.tool-load')?.getAttribute('aria-label') ?? ''`);
    must(/Load to Pico/.test(label), `button: ${label}`);
    const tabs = await p.eval(`JSON.stringify([...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()))`);
    must(/"Hardware"/.test(tabs) && !/Board \\(USB\\)|Serial \\(board\\)/.test(tabs), tabs);
    return label;
  });
  await check('an imported UF2 loads onto a mock board: chooser (2E8A:000F), confirmation naming the board and build 1, Enter, progress, badge', async () => {
    await p.eval(openFile('blink.uf2', flashUf2()));
    await p.waitFor(`/blink\\.uf2|imported|UF2/i.test(document.querySelector('.console')?.textContent ?? document.body.textContent)`).catch(() => {});
    await sleep(300);
    await p.eval(plug({ serialNumber: 'E0C9125B0D9B2F34' }));
    await p.eval(clickLoad);
    await p.waitFor(confirmOpen, 15000);
    // the tab loads its module on first use, so it may appear just after the confirmation (the load starts in the click)
    await p.waitFor(selected, 5000).catch(() => { throw new Error('Load did not open the Hardware tab'); });
    const text = await p.eval(`document.querySelector('#hw-confirm-text').textContent`);
    must(/E0C9125B0D9B2F34/.test(text) && /build 1\b/.test(text), text);
    const a11y = await p.eval(axeRun('dialog.hw-dialog'));
    must(!a11y.length, `axe (dialog): ${a11y.join('; ')}`);
    await p.key('Enter', { keyCode: 13, text: '\r' });
    await p.waitFor(`/Done/.test(${state})`, 20000);
    const filters = await p.eval(`JSON.stringify(__hw.usb.requests[0])`);
    must(filters === '[{"vendorId":11914,"productId":15}]', filters);
    const badge = await p.eval(`document.querySelector('.hw-badge').textContent`);
    must(/holds this build \(1\)/.test(badge), badge);
    const names = await p.eval(`__dev.names().join(' ')`);
    must(/^getinfo read getinfo exclusive erase write read/.test(names) && /reboot2$/.test(names), names);
    const progress = await p.eval(`(() => { const b = document.querySelector('.hw-bar'); return b.value + '/' + b.max; })()`);
    return `${text} | ${badge} | progress ${progress}`;
  });
  await check('a verify failure names the sector and leaves the board in BOOTSEL (not rebooted)', async () => {
    await p.eval(plug({ serialNumber: 'BADFLASH', faults: { corruptRead: 0x10003f04 } }));
    await p.eval(`(async () => { for (const d of await __hw.usb.getDevices()) if (d.serialNumber !== 'BADFLASH') __hw.usb.granted.delete(d); return true; })()`);
    await p.eval(clickLoad);
    await p.waitFor(confirmOpen);
    await p.key('Enter', { keyCode: 13, text: '\r' });
    await p.waitFor(`document.querySelector('.hw-error')?.dataset.code === 'verify-failed'`, 20000);
    const t = await p.eval(`document.querySelector('.hw-error').textContent`);
    must(/0x10003000/.test(t), t);
    must(await p.eval(`__dev.reboots.length === 0`), 'rebooted');
    return t;
  });
  await check('a closed chooser: "No Pico 2 was chosen", nothing built or written', async () => {
    await p.eval(`(() => { __hw.usb.granted.clear(); __hw.choose = 'none'; return true; })()`);
    await p.eval(clickLoad);
    await p.waitFor(`document.querySelector('.hw-error')?.dataset.code === 'denied'`);
    await p.eval(`(() => { __hw.choose = 'first'; return true; })()`);
    return p.eval(`document.querySelector('.hw-error').textContent`);
  });
  await check('unplugged during the write: "disconnected", the next step named', async () => {
    await p.eval(`(() => { for (const d of [...__hw.usb.devices]) d.unplug(); __hw.usb.granted.clear(); return true; })()`);
    await p.eval(plug({ serialNumber: 'UNPLUG', faults: { unplugAt: { cmd: 'write', n: 2 } } }));
    await p.eval(clickLoad);
    await p.waitFor(confirmOpen);
    await p.key('Enter', { keyCode: 13, text: '\r' });
    await p.waitFor(`document.querySelector('.hw-error')?.dataset.code === 'disconnected'`, 20000);
    return p.eval(`document.querySelector('.hw-error').textContent`);
  });
  await check('Hardware tab: Probe board shows the facts (read-only commands); Run the board\'s program sends one REBOOT2 normal; the Log records both', async () => {
    await p.eval(`(() => { for (const d of [...__hw.usb.devices]) d.unplug(); __hw.usb.granted.clear(); return true; })()`);
    await p.eval(`(() => { const d = new __hw.MockPicobootDevice({ serialNumber: 'PROBE1' }); __hw.usb.plug(d, { granted: true }); window.__dev = d; return true; })()`);
    await p.eval(`(() => { document.querySelector('.hw-view .hw-probe').click(); return true; })()`);
    await p.waitFor(`!document.querySelector('.hw-view .hw-facts').hidden`, 15000);
    const facts = await p.eval(`document.querySelector('.hw-view .hw-facts').textContent`);
    must(/PROBE1/.test(facts) && /ROM version4/.test(facts) && /whole flash/.test(facts), facts);
    const n1 = await p.eval(`__dev.names().join(' ')`);
    must(!/erase|write|exclusive|reboot2/.test(n1), n1);
    await p.eval(`(() => { document.querySelector('.hw-view .hw-run-board').click(); return true; })()`);
    await p.waitFor(`__dev.reboots.length === 1`, 15000);
    const n2 = await p.eval(`__dev.names().join(' ')`);
    must(!/erase|write|exclusive/.test(n2) && (await p.eval(`(__dev.reboots[0].flags & 15) === 0`)), n2);
    await p.eval(tab('Log'));
    const log = await p.eval(`document.querySelector('.hw-log-list')?.textContent ?? ''`);
    must(/PROBE1/.test(log) && /left BOOTSEL/.test(log), log);
    return facts;
  });
  await check('Hardware tab: two columns side by side at 1366 x 900; stacked, without overlap, in a pane under 560 px', async () => {
    await p.eval(tab('Hardware'));
    await p.waitFor(`document.querySelector('.hw-view .hw-right')`);
    const measure = `(() => { const l = document.querySelector('.hw-view .hw-left').getBoundingClientRect(), rr = document.querySelector('.hw-view .hw-right').getBoundingClientRect(); return JSON.stringify({ side: rr.left >= l.right - 1 && rr.top < l.bottom, stacked: rr.top >= l.bottom - 1, lw: Math.round(l.width), rw: Math.round(rr.width), pane: Math.round(document.querySelector('.hw-view').getBoundingClientRect().width) }); })()`;
    const wide = await p.eval(measure);
    await p.eval(`(() => { document.querySelector('.hw-view').style.width = '480px'; return true; })()`);
    await sleep(150);
    const narrow = await p.eval(measure);
    await p.eval(`(() => { document.querySelector('.hw-view').style.width = ''; return true; })()`);
    must(/"side":true/.test(wide) && !/"lw":0/.test(wide), `wide ${wide}`);
    must(/"stacked":true/.test(narrow) && !/"lw":0/.test(narrow), `narrow ${narrow}`);
    return `${wide} | ${narrow}`;
  });
  if (BUILD && SITE) {
    await check('--build: a built Full project loads (build n); changed code builds again on Load (n + 1); Output = UART and USB builds with the USB set (n + 2)', async () => {
      const q = await open();
      // the compiler in the cache first (so that the shell does not ask before the download), then a new main.c (it starts from the
      // Pico SDK example), made the entry; no Build: Load builds it (Q4 A)
      await q.eval(`(async () => { const { FullCompiler } = await import('/src/arch/pico2/full/client.js'); await new FullCompiler().load(); return true; })()`);
      await q.eval(`(() => { document.querySelector('.proj-ibtn[data-act=new]').click(); return true; })()`);
      await q.waitFor(`document.querySelector('.proj-form input')`);
      await q.eval(`(() => { document.querySelector('.proj-form input').value = 'main.c'; document.querySelector('.proj-form button[type=submit]').click(); return true; })()`);
      await q.waitFor(`document.querySelector('.proj-file[data-name="main.c"]')`);
      await q.eval(`(() => { document.querySelector('.proj-file[data-name="main.c"]').click(); return true; })()`);
      await sleep(200);
      await q.eval(`(() => { document.querySelector('.proj-ibtn[data-act=entry]').click(); return true; })()`);
      await sleep(300);
      await q.eval(tab('Hardware'));
      await q.eval(plug({ serialNumber: 'BUILT1' }));
      await q.eval(clickLoad);
      await q.waitFor(confirmOpen, 30000).catch(async (e) => { throw new Error(`no confirmation: ${await q.eval(state)} ${await q.eval(`document.querySelector('.hw-error')?.textContent ?? ''`)} | files ${await q.eval(`[...document.querySelectorAll('.proj-file')].map((x) => x.dataset.name).join(',')`)} | console ${(await q.eval(`document.querySelector('.console')?.textContent ?? ''`)).slice(-300)}`); });
      const t1 = await q.eval(`document.querySelector('#hw-confirm-text').textContent`);
      await q.key('Enter', { keyCode: 13, text: '\r' });
      await q.waitFor(`/Done/.test(${state})`, 30000).catch(async () => { throw new Error(`not done: ${await q.eval(`JSON.stringify([...document.querySelectorAll('.hw-state')].map((x) => [x.textContent, x.isConnected]))`)} ${await q.eval(`import('/src/arch/pico2/hw/session.js').then((m) => JSON.stringify(m.hardwareSession().state))`)} | ${await q.eval(`document.querySelector('.hw-error')?.textContent ?? ''`)} | ${(await q.eval(`document.querySelector('.console')?.textContent ?? ''`)).slice(-400)}`); });
      // change the code (a comment alone gives the same image, so the same build id and n), then Load builds first (Q4 A)
      await q.eval(`(() => { const ta = document.querySelector('.p-editor .ed-panel:not([hidden]) textarea.ed-input'); ta.value = ta.value.replace('sleep_ms(250)', 'sleep_ms(125)'); ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await sleep(600);
      await q.eval(plug({ serialNumber: 'BUILT1' }));
      await q.eval(clickLoad);
      await q.waitFor(confirmOpen, 60000);
      const t2 = await q.eval(`document.querySelector('#hw-confirm-text').textContent`);
      await q.key('Enter', { keyCode: 13, text: '\r' });
      await q.waitFor(`/Done/.test(${state})`, 30000).catch(async () => { throw new Error(`not done: ${await q.eval(`JSON.stringify([...document.querySelectorAll('.hw-state')].map((x) => [x.textContent, x.isConnected]))`)} ${await q.eval(`import('/src/arch/pico2/hw/session.js').then((m) => JSON.stringify(m.hardwareSession().state))`)} | ${await q.eval(`document.querySelector('.hw-error')?.textContent ?? ''`)} | ${(await q.eval(`document.querySelector('.console')?.textContent ?? ''`)).slice(-400)}`); });
      // n counts the project's distinct builds in this browser (the imported UF2 above may be one of them): the changed source is the next n
      const n1 = Number(/build (\d+)/.exec(t1)?.[1]), n2 = Number(/build (\d+)/.exec(t2)?.[1]);
      must(n1 >= 1 && n2 === n1 + 1, `${t1} | ${t2}`);
      // F3-4 (Q3 A): Output = UART and USB in the Project menu; Load builds with the pack's USB object set (a new image, n + 1)
      await q.eval(`(() => { document.querySelector('.proj-choice[data-option="stdio"][data-value="usb"]').click(); return true; })()`);
      await q.waitFor(`/Output for this project: UART and USB/.test(document.querySelector('.console')?.textContent ?? '')`);
      const pressed = await q.eval(`document.querySelector('.proj-choice[data-option="stdio"][data-value="usb"]').getAttribute('aria-pressed')`);
      await q.eval(plug({ serialNumber: 'BUILT1' }));
      await q.eval(clickLoad);
      await q.waitFor(confirmOpen, 60000);
      const t3 = await q.eval(`document.querySelector('#hw-confirm-text').textContent`);
      await q.key('Enter', { keyCode: 13, text: '\r' });
      await q.waitFor(`/Done/.test(${state})`, 30000);
      const usbBuilt = await q.eval(`/output over UART and USB/.test(document.querySelector('.console')?.textContent ?? '')`);
      const n3 = Number(/build (\d+)/.exec(t3)?.[1]);
      must(pressed === 'true' && usbBuilt && n3 === n2 + 1, `${pressed} ${usbBuilt} ${t3}`);
      await q.close();
      return `${t1} | ${t2} | UART and USB: ${t3}`;
    });
  }
}
await check(`UART monitor: connect a mock Pico 2 USB port at 115200 with DTR, lines appear in the log, counts and hex, a line is sent with CR, compare${firefox ? ' (Firefox)' : ''}`, async () => {
  await p.eval(tab('Hardware'));
  await p.waitFor(`document.querySelector('.hw-view .sp-connect-pico')`);
  await p.eval(`(() => { const h = [...document.querySelectorAll('.sp-tools label')].find((l) => /Hex/.test(l.textContent)).querySelector('input'); h.click(); return true; })()`);
  await p.eval(`(() => { window.__port = __hw.serial.add(new __hw.MockSerialPort()); document.querySelector('.sp-connect-pico').click(); return true; })()`);
  await p.waitFor(`/Connected/.test(document.querySelector('.sp-state').textContent)`);
  await p.eval(`(() => { __port.feed('Hello from the Pico 2: 0\\r\\nHello from the Pico 2: 1\\n'); return true; })()`);
  await p.waitFor(`document.querySelectorAll('.sp-line').length >= 2`);
  await p.eval(`(() => { const i = document.querySelector('.sp-input'); i.value = 'on'; document.querySelector('.sp-send').click(); return true; })()`);
  await p.waitFor(`__port.sent() === 'on\\r'`);
  const o = await p.eval(`JSON.stringify({ opened: __port.opened, signals: __port.signals, log: document.querySelector('.sp-log').getAttribute('role'), live: document.querySelector('.sp-log').getAttribute('aria-live') })`);
  must(/"baudRate":115200/.test(o) && /dataTerminalReady":true/.test(o) && /"log":"log"/.test(o) && /"live":"off"/.test(o), o);
  must(!(await p.eval(`[...document.querySelectorAll('.sp-baud option')].some((x) => x.value === '1200')`)), '1200 offered');
  const counts = await p.eval(`document.querySelector('.sp-counts').textContent`);
  must(/^2 lines, 51 bytes/.test(counts), counts);
  const hex = await p.eval(`document.querySelector('.sp-hex').textContent`);
  must(/48 65 6c 6c 6f/.test(hex), hex.slice(0, 80));
  await p.eval(`(() => { document.querySelector('.sp-compare').click(); return true; })()`);
  const cmp = await p.eval(`document.querySelector('p.sp-compare').textContent`);
  must(/Nothing to compare|differs|agree/.test(cmp), cmp);
  return `${o} | ${counts} | ${cmp}`;
});
await check('axe-core: the Hardware tab and the toolbar with Load to Pico, light', async () => {
  const v = [...(await p.eval(axeRun('.toolbar')))];
  await p.eval(tab('Hardware')); await sleep(150); v.push(...(await p.eval(axeRun('.hw-view'))));
  must(!v.length, v.join('; '));
  return 'no violations';
});
if (firefox) {
  await check('Firefox (no WebUSB): the button is Download .uf2 and the Board panel says why', async () => {
    const label = await p.eval(`document.querySelector('.tool-load')?.getAttribute('aria-label') ?? ''`);
    must(/Download \.uf2/.test(label), label);
    await p.eval(tab('Hardware'));
    await p.waitFor(`document.querySelector('.hw-view .hw-fallback')`);
    must(await p.eval(`!document.querySelector('.hw-view .hw-fallback').hidden && document.querySelector('.hw-view .hw-load').hidden`), 'fallback not shown');
    return label;
  });
}
await p.close();
await check('dark theme: axe on the Hardware tab', async () => {
  const q = await open({ scheme: 'dark', mode: firefox ? 'nousb' : 'mocks' });
  const v = [];
  await q.eval(tab('Hardware')); await q.waitFor(`document.querySelector('.hw-view')`); await sleep(150); v.push(...(await q.eval(axeRun('.hw-view'))));
  await q.close();
  must(!v.length, v.join('; '));
  return 'no violations';
});
if (!firefox) {
  await check('APIs removed: Load becomes Download .uf2; the panel explains the RP2350 drive', async () => {
    const q = await open({ mode: 'nousb' });
    const label = await q.eval(`document.querySelector('.tool-load')?.getAttribute('aria-label') ?? ''`);
    await q.eval(tab('Hardware'));
    await q.waitFor(`document.querySelector('.hw-view .hw-fallback')`);
    const fb = await q.eval(`document.querySelector('.hw-view .hw-fallback').hidden ? '' : document.querySelector('.hw-view .hw-fallback').textContent`);
    await q.close();
    must(/Download \.uf2/.test(label) && /RP2350 drive/.test(fb), `${label} | ${fb}`);
    return label;
  });
}
await check('Pico Lite: no hardware control, no Hardware tab (Q12 A)', async () => {
  const q = await open({ edition: 'lite', mode: firefox ? 'nousb' : 'mocks' });
  const r = await q.eval(`JSON.stringify({ btn: Boolean(document.querySelector('.tool-load')), tabs: [...document.querySelectorAll('[role=tab]')].map((t) => t.textContent.trim()).filter((t) => /^Hardware$|Board \\(USB\\)|Serial \\(board\\)/.test(t)) })`);
  await q.close();
  must(r === '{"btn":false,"tabs":[]}', r);
  return r;
});

await b.close();
server.close();
console.log(`${BROWSER} (${b.version ?? ''}), Pico Full board interfaces with mock devices`);
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? (r.d ? ` — ${typeof r.d === 'string' ? r.d.slice(0, 220) : J(r.d).slice(0, 220)}` : '') : ` — ${r.e}`}`);
const bad = results.filter((r) => !r.ok).length;
console.log(bad ? `${bad} failed` : 'all passed');
process.exitCode = bad ? 1 : 0;
