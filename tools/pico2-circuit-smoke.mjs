// pico2-circuit-smoke.mjs -- the student's own parts on the Board in a real browser (pico2 P1-B2 stage B2-1,
// docs/architecture/pico2-p1b2-user-circuits.md §5.6, research D50, D51). Checks: the Board view has a Circuit tab; parts are added
// and wired from its list only (form controls); they are drawn below the board with their nets; gpio-button.c counts five presses
// of a user push button from GP15 to GND, pressed from the keyboard, and the replay check is equal; an LED and 220 Ω on GP16 glow
// while a program drives GP16 high, and Inspect gives the current of the hand calculation; the circuit is kept across a reload;
// axe-core finds nothing serious on the Circuit tab in the light and dark themes. Screenshots go to --shots (outside OneDrive).
//
//   node tools/pico2-circuit-smoke.mjs [--browser chrome|edge] [--shots <dir>] [--visible]
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
const VISIBLE = args.includes('--visible');
const J = JSON.stringify;
const tpl = (f) => readFileSync(new URL(`../content/pico2/templates/${f}`, import.meta.url), 'utf8');
const GP16_HIGH = '#include <rp2350.h>\n\nint main(void) {\n    pin_output(16);\n    pin_write(16, 1);\n    delay_ms(3000);\n    return 0;\n}\n';

const area = `document.querySelector('textarea.ed-input')`;
const setText = (t) => `(() => { const a = ${area}; a.value = ${J(t)}; a.dispatchEvent(new Event('input')); return true; })()`;
const select = (label, v) => `(() => { const s = document.querySelector('select[aria-label=${J(label)}]'); if (!s) return null; s.value = ${J(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`;
const primary = `document.querySelector('.tool-run')?.getAttribute('aria-label') ?? ''`;
const out = `document.querySelector('pre.console-out')?.textContent ?? ''`;
const view = (label) => `(() => { const b = [...document.querySelectorAll('.mode-nav .mode-btn')].find((x) => x.getAttribute('aria-label') === ${J(label)}); b?.click(); return Boolean(b); })()`;
const tab = (name) => `(() => { const t = [...document.querySelectorAll('[role=tab]')].find((b) => b.textContent.trim() === ${J(name)}); t?.click(); return Boolean(t); })()`;
const circ = `document.querySelector('.bv-circ')`;
const msgs = `[...document.querySelectorAll('.messages li')].map((l) => l.textContent).join('\\n')`;
const DEMO = ['BTN', 'GND1', 'GND2', 'KNOB', 'PWR1']; // the demo circuit's parts (circuit/demo.js, research D52), in the list's order
const partIds = `[...([...(${circ}?.querySelectorAll('table') ?? [])].find((t) => t.caption?.textContent === 'Your parts')?.querySelectorAll('tbody th[scope=row]') ?? [])].map((t) => t.textContent)`;
const clickText = (t) => `(() => { const b = [...${circ}.querySelectorAll('button')].find((x) => x.textContent === ${J(t)}); b?.click(); return Boolean(b); })()`;

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
    const shot = async (file) => { if (SHOTS && existsSync(SHOTS)) writeFileSync(join(SHOTS, `${name}-circuit-${file}.png`), await p.screenshot()); };
    try {
      const page = `${origin}?arch=pico2&selftest`;
      await p.goto(page);
      await p.eval(`localStorage.clear(); true`);
      await p.goto(page);
      await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
      const build = async (lang, text) => {
        if (lang) { await p.eval(select('Language', lang)); await sleep(700); }
        await p.eval(setText(text));
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'build'`);
        await p.eval(`(document.querySelector('.tool-build').click(), true)`);
        await p.waitFor(`document.querySelector('.tool-run').dataset.action === 'run'`, 20000);
      };
      const run = async () => { await p.eval(`(document.querySelector('.tool-run').click(), true)`); await p.waitFor(`/^Pause/.test(${primary})`); };
      const add = async (type) => { await p.eval(select('Part to add', type)); await p.eval(clickText('Add part')); await sleep(300); };

      await check('the Board view has a Circuit tab listing the demo circuit\'s parts (button, knob, ground and power; research D52)', async () => {
        await p.eval(select('clk_sys', '4'));
        await p.eval(view('Board'));
        await p.waitFor(`document.querySelectorAll('.bv-svg [data-sel^="pin:"]').length === 40`);
        if (!(await p.eval(tab('Circuit')))) throw new Error('no Circuit tab');
        await p.waitFor(`${circ} && ${partIds}.length === 5`);
        const ids = await p.eval(partIds);
        if (J(ids) !== J(DEMO)) throw new Error(J(ids));
        return J(ids);
      });

      await check('a push button from the list, wired GP15 to GND from its pin menus; drawn with its nets', async () => {
        await add('button');
        await p.eval(select('SW1: Pin 1 connects to', 'GP15'));
        await sleep(300);
        await p.eval(select('SW1: Pin 2 connects to', 'GND'));
        await sleep(400);
        const ids = await p.eval(partIds);
        const labels = await p.eval(`[...document.querySelectorAll('.bv-svg [data-sel="upart:SW1"] .bv-nl')].map((t) => t.textContent)`);
        if (J(ids.filter((x) => !DEMO.includes(x))) !== J(['SW1']) || !labels.some((t) => t.startsWith('GP15')) || !labels.some((t) => t.startsWith('GND'))) throw new Error(`${J(ids)} ${J(labels)}`);
        return `parts ${J(ids)}, labels ${J(labels)}`;
      });

      await check('gpio-button.c: five presses of SW1 from the keyboard end the program; replay equal', async () => {
        await p.eval(tab('Circuit'));
        await build('c', tpl('gpio-button.c'));
        await run();
        await sleep(800);
        const btn = `[...${circ}.querySelectorAll('button')].find((x) => x.textContent === 'Press')`;
        for (let i = 0; i < 5; i++) {
          await p.eval(`(${btn}.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })), true)`);
          await sleep(150);
          await p.eval(`(${btn}.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })), true)`);
          await sleep(150);
        }
        await p.waitFor(`!/^Pause/.test(${primary})`, 10000);
        const o = await p.eval(out);
        const r = await p.eval(`globalThis.__mavileraTest.replayCheck()`);
        await shot('button');
        if (!/press 5/.test(o) || !r?.equal || r.inputs !== 10) throw new Error(`output ${J(o.slice(-80))}, replay ${J(r)}`);
        return `replay ${r.steps} steps, ${r.inputs} inputs, hash ${r.hash}`;
      });

      await check('an LED and 220 Ω on GP16 glow while the program drives GP16 high; Inspect gives the current', async () => {
        await add('resistor');
        const v = `[...${circ}.querySelectorAll('input[aria-label="R1 value"]')][0]`;
        await p.eval(`(() => { const i = ${v}; i.value = '220'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await sleep(300);
        await p.eval(select('R1: Pin 1 connects to', 'GP16')); await sleep(300);
        await p.eval(select('R1: Pin 2 connects to', '\u0000new')); await sleep(300);
        await add('led');
        await p.eval(select('D1: Pin A connects to', 'N1')); await sleep(300);
        await p.eval(select('D1: Pin K connects to', 'GND')); await sleep(300);
        await build('c', GP16_HIGH);
        await run();
        await sleep(900);
        const glow = await p.eval(`Number(document.querySelector('.bv-svg [data-sel="upart:D1"] .bv-uglow')?.getAttribute('opacity') ?? -1)`);
        await p.eval(`(document.querySelector('.bv-svg [data-sel="upart:D1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })), true)`);
        await sleep(400);
        const insp = await p.eval(`document.querySelector('.bv-tab table')?.textContent ?? ''`);
        await shot('led');
        // (3.3 V − 1.65 V) / (45 Ω + 220 Ω + 25 Ω) = 5.69 mA (B2-4: the red LED's knee and R_s from the Kingbright WP7113ID curve), a little less with GP16's reset pull-down (64 kΩ)
        const mA = Number(/Current([0-9.]+) mA/.exec(insp)?.[1]);
        if (!(glow > 0.5) || !(mA > 5.6 && mA < 5.7)) throw new Error(`glow ${glow}, inspect ${J(insp.slice(0, 300))}`);
        await p.waitFor(`!/^Pause/.test(${primary})`, 15000);
        return `glow ${glow}, ${mA} mA`;
      });

      await check('a capacitor (B2-2): 100 µF on the LED\'s net N1 charges after GP16 rises; the Nets table follows it', async () => {
        await p.eval(tab('Circuit'));
        await add('capacitor');
        const v = `[...${circ}.querySelectorAll('input[aria-label="C1 value"]')][0]`;
        await p.eval(`(() => { const i = ${v}; i.value = '100u'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await sleep(300);
        await p.eval(select('C1: Pin 1 connects to', 'N1')); await sleep(300);
        await p.eval(select('C1: Pin 2 connects to', 'GND')); await sleep(300);
        await build('c', GP16_HIGH);
        await run();
        // N1's voltage in the Nets table, sampled while it charges (τ ≈ 100 µF × (45 + 220) Ω ∥ … ≈ 20 ms; in Real time at 4 MHz)
        const volts = `(() => { const t = [...${circ}.querySelectorAll('table')].find((x) => x.caption?.textContent === 'Nets'); const r = [...(t?.querySelectorAll('tbody tr') ?? [])].find((x) => x.querySelector('th')?.textContent === 'N1'); return r ? parseFloat(r.lastElementChild.textContent) : null; })()`;
        const s = [];
        for (let i = 0; i < 12; i++) { s.push(await p.eval(volts)); await sleep(15); }
        await shot('capacitor');
        await p.waitFor(`!/^Pause/.test(${primary})`, 15000);
        const finite = s.filter((x) => Number.isFinite(x));
        if (finite.length < 3 || !(Math.max(...finite) > Math.min(...finite) + 0.05)) throw new Error(J(s));
        return `N1 ${finite[0].toFixed(3)} V … ${finite[finite.length - 1].toFixed(3)} V`;
      });

      await check('the same bits in the browser as in Node: own exp/log and a capacitor\'s crossing time (design §5.4)', async () => {
        const fn = `async () => {
          const { exp, log } = await import('/src/arch/pico2/circuit/mathx.js');
          const { compile } = await import('/src/arch/pico2/circuit/netlist.js');
          const { validateCircuit } = await import('/src/arch/pico2/circuit/format.js');
          const { CapIsland } = await import('/src/arch/pico2/circuit/transient.js');
          const out = [];
          for (let i = 0; i < 4000; i++) { const x = i / 50 - 40; out.push(exp(x), log(Math.abs(x) + 1e-3)); }
          const c = validateCircuit({ format: 'mavilera-pico2-circuit', version: 1, parts: [{ id: 'R1', type: 'resistor', value: '4k7', x: 0, y: 0 }, { id: 'C1', type: 'capacitor', value: '470n', x: 0, y: 0 }],
            wires: [{ a: 'GP16', b: 'R1.1' }, { a: 'R1.2', b: 'C1.1' }, { a: 'C1.2', b: 'GND' }, { a: 'C1.1', b: 'GP17' }] });
          const k = compile(c), isl = k.islands[k.padIsland[16]], ci = new CapIsland(isl);
          const af = ci.affine(isl.pads.map((g) => (g === 16 ? 6 : 0)), new Map(), new Uint8Array(isl.prims.length));
          const tr = ci.trajectory(af, [0.3]);
          out.push(ci.nextTime(tr, af, [0.3], [{ j: isl.padNodeOf[17], thr: 1.75 }]), af.A[0], af.tau[0]);
          const dv = new DataView(new ArrayBuffer(8)); let h = 0x811c9dc5;
          for (const v of out) { dv.setFloat64(0, v); for (let b = 0; b < 8; b++) h = Math.imul(h ^ dv.getUint8(b), 0x01000193); }
          return (h >>> 0).toString(16);
        }`;
        const inPage = await p.eval(`(${fn})()`);
        const inNode = await eval(`(${fn.replaceAll("'/src/", "'../src/")})`)();
        if (inPage !== inNode) throw new Error(`page ${inPage}, Node ${inNode}`);
        return `digest ${inPage} in both`;
      });

      await check('the circuit is kept across a reload', async () => {
        await p.goto(page);
        await p.waitFor(`document.querySelector('.toolbar')`);
        await p.eval(view('Board'));
        await p.waitFor(`document.querySelectorAll('.bv-svg [data-sel^="pin:"]').length === 40`);
        await p.eval(tab('Circuit'));
        await sleep(400);
        const ids = await p.eval(partIds);
        if (J([...ids].sort()) !== J([...DEMO, 'C1', 'D1', 'R1', 'SW1'].sort())) throw new Error(J(ids));
        return J(ids);
      });

      // --- B2-3: the schematic editor (design §2.8-§2.9, §5.6) --------------------------------------------------------------
      // a fresh page: the circuits below are built on the drawing with the keyboard only
      const SHIFT = 8, CTRL = 2;
      const KEYCODE = { Enter: 13, Escape: 27, Tab: 9, Delete: 46, Backspace: 8, F2: 113, F5: 116 };
      const key = async (k, n = 1, mods = 0) => { for (let i = 0; i < n; i++) { await p.key(k, { modifiers: mods, keyCode: KEYCODE[k] ?? 0, text: k === 'Enter' ? '\r' : undefined }); await sleep(35); } };
      const said = async () => { await sleep(90); return p.eval(`document.querySelector('.bv-view .sr-only[role=status]')?.textContent ?? ''`); };
      const expectSaid = async (re) => { const t = await said(); if (!re.test(t)) throw new Error(`announced ${J(t)}, expected ${re}`); return t; };
      const circuitText = `(() => { const r = globalThis.__mavileraTest?.companion?.('circuit'); if (r !== undefined) return r; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/vcompanion/.test(k)) { const v = localStorage.getItem(k); return v ? JSON.parse(v).text : null; } } return null; })()`;
      const fileNow = async () => { const t = await p.eval(circuitText); return t ? JSON.parse(t) : null; };
      const toggle = async () => { await p.eval(`(document.querySelector('.bv-edit-toggle').focus(), true)`); await key('Enter'); await sleep(250); };
      const editing = `document.querySelector('.bv-edit-toggle')?.getAttribute('aria-pressed') === 'true'`;
      // F2 from the drawing: Inspect's first field; its text replaced by `text` (typed), Enter, then Esc back to the drawing
      const f2 = async (text, field) => {
        await key('F2'); await sleep(150);
        const lab = await p.eval(`document.activeElement?.getAttribute('aria-label') ?? ''`);
        if (field && lab !== field) throw new Error(`F2 focused ${J(lab)}, expected ${J(field)}`);
        if (text !== null) { await p.type(text); await key('Enter'); await sleep(250); } // F2 selects the field's text: typing replaces it
        await key('Escape'); await sleep(100);
      };
      await check('B2-3: the Board view has an Edit circuit toggle; on, Run is held with the reason and F5 answers it', async () => {
        await p.eval(`localStorage.clear(); true`);
        await p.goto(page);
        await p.waitFor(`document.querySelector('.toolbar') && document.querySelector('table.listing tbody tr')`);
        await p.eval(select('clk_sys', '4'));
        await p.eval(view('Board'));
        await p.waitFor(`document.querySelectorAll('.bv-svg [data-sel^="pin:"]').length === 40 && document.querySelector('.bv-edit-toggle')`);
        await toggle();
        if (!(await p.eval(editing))) throw new Error('not on');
        await expectSaid(/^Editing the circuit/);
        const held = await p.eval(`[document.querySelector('.tool-run').getAttribute('aria-disabled'), document.querySelector('.tool-run').title]`);
        if (held[0] !== 'true' || !/Edit circuit is on/.test(held[1])) throw new Error(J(held));
        await key('F5'); await sleep(300);
        const m = await p.eval(msgs);
        if (!/Edit circuit is on: turn it off to run the program/.test(m) || /^Pause/.test(await p.eval(primary))) throw new Error(`messages ${J(m.slice(-200))}`);
        return held[1];
      });
      await check('B2-3: Ctrl+A and the delete-part icon remove everything, the demo parts too; the file is then an empty circuit', async () => {
        await key('a', 1, CTRL); await expectSaid(/objects selected/);
        await p.eval(`(document.querySelector('.bv-ed-tools [aria-label^="Delete parts"]').click(), true)`);
        await expectSaid(/^Removed \d+ objects/);
        const c = await fileNow();
        if (!c || c.parts.length || c.wires.length) throw new Error(J(c));
        await p.eval(`(document.querySelector('.bv-view').focus(), true)`);
        return 'an empty circuit file';
      });
      await check('B2-3: LED and resistor built with keys only (A, arrows, Enter, W, L, F2): R1 220 Ω, R1 pin 1 labelled GP16, D1 to a GND pad by a drawn wire', async () => {
        await key('a'); await key('Enter'); await key('Enter');            // a resistor at the cursor
        await expectSaid(/^R1 placed at row/);
        await key('ArrowRight', 2, SHIFT);
        await key('a'); await key('ArrowDown', 4); await key('Enter'); await key('Enter'); // an LED twenty steps right
        await expectSaid(/^D1 placed at row/);
        await key('ArrowLeft', 1, SHIFT); await key('ArrowLeft', 5);
        await expectSaid(/^On R1 pin 2/);
        await key('w'); await key('ArrowRight', 10);
        await expectSaid(/^On D1 pin A/);
        await key('Enter');
        await expectSaid(/^Wire from R1 pin 2 to D1 pin A/);
        await key('ArrowRight', 10); await key('w');                        // from D1 pin K up 27 steps, then right to the GND pad
        await key('ArrowUp', 2, SHIFT); await key('ArrowUp', 7); await key('ArrowRight', 1, SHIFT);
        await expectSaid(/^On GND/);
        await key('Enter');
        await expectSaid(/^Wire from D1 pin K to GND/);
        // R1: N selects objects in reading order
        for (let i = 0; i < 8 && !/Selected R1/.test(await said()); i++) await key('n');
        await expectSaid(/^Selected R1/);
        await f2('220', 'Change R1: value');
        await key('Escape');                                               // the selection cleared; the cursor at R1's centre
        await key('ArrowLeft', 5);
        await expectSaid(/^On R1 pin 1/);
        await key('l');
        await expectSaid(/^Net label N1 on R1 pin 1/);
        await f2('GP16', 'Net name');
        const c = await fileNow();
        const wires = c?.wires.map((w) => `${w.a}-${w.b}`).sort();
        const ok = J(c?.parts.map((x) => [x.id, x.type, x.value ?? null])) === J([['D1', 'led', null], ['R1', 'resistor', '220']])
          && J(wires) === J(['D1.A-R1.2', 'D1.K-GND']) && J(c.labels.map((l) => [l.net, l.at])) === J([['GP16', 'R1.1']])
          && c.wires.find((w) => w.b === 'GND').via?.length === 1;
        await shot('editor-led');
        if (!ok) throw new Error(J(c));
        return `${J(wires)}, label GP16 on R1.1, the GND wire with ${c.wires.find((w) => w.b === 'GND').via.length} bend`;
      });
      await check('B2-3: Edit circuit off; GP16 high: the keyboard-built LED glows, Inspect gives the list-built circuit\'s current', async () => {
        await toggle();
        if (await p.eval(editing)) throw new Error('still on');
        if (await p.eval(`document.querySelector('.tool-run').getAttribute('aria-disabled')`)) throw new Error('Run still held');
        await build('c', GP16_HIGH);
        await run();
        await sleep(900);
        const glow = await p.eval(`Number(document.querySelector('.bv-svg [data-sel="upart:D1"] .bv-uglow')?.getAttribute('opacity') ?? -1)`);
        await p.eval(`(document.querySelector('.bv-svg [data-sel="upart:D1"]').dispatchEvent(new MouseEvent('click', { bubbles: true })), true)`);
        await sleep(400);
        const insp = await p.eval(`document.querySelector('.bv-tab table')?.textContent ?? ''`);
        const mA = Number(/Current([0-9.]+) mA/.exec(insp)?.[1]);
        await p.waitFor(`!/^Pause/.test(${primary})`, 15000);
        if (!(glow > 0.5) || !(mA > 5.6 && mA < 5.7)) throw new Error(`glow ${glow}, inspect ${J(insp.slice(0, 300))}`);
        return `glow ${glow}, ${mA} mA`;
      });
      let before = null, after = null, steps = 0;
      await check('B2-3: a traffic light with keys only: Ctrl+A, Ctrl+C, Ctrl+V twice; labels GP17, GP18 and colours yellow, green by F2', async () => {
        await toggle();
        before = await p.eval(circuitText);
        await key('a', 1, CTRL); await expectSaid(/objects selected/);
        await key('c', 1, CTRL); await expectSaid(/^Copied 2 objects/);
        // the cursor to D1's centre, then 15 steps down: the copy's first part (D1's copy) goes to the cursor
        for (let i = 0; i < 8 && !/Selected D1/.test(await said()); i++) await key('n');
        await key('Escape');
        for (const [n, net, colourSteps] of [[2, 'GP17', 1], [3, 'GP18', 2]]) {
          await key('ArrowDown', 1, SHIFT); await key('ArrowDown', 5);
          await key('v', 1, CTRL); await expectSaid(/^Pasted 2 objects/);
          await key('Escape');
          // the LED's colour: Enter selects it at the cursor, F2 to its colour, arrows down the list
          await key('Enter'); await expectSaid(new RegExp(`^Selected D${n}`));
          await key('F2'); await sleep(150);
          if ((await p.eval(`document.activeElement?.getAttribute('aria-label')`)) !== `Change D${n}: color`) throw new Error('F2 did not reach the colour');
          await key('ArrowDown', colourSteps); await sleep(250);
          await key('Escape'); await key('Escape');
          // the label: R's pin 1 is 25 steps left of the LED's centre, its label one step up
          await key('ArrowLeft', 2, SHIFT); await key('ArrowLeft', 5); await key('ArrowUp');
          await key('Enter'); await expectSaid(/^Selected net label GP16/);
          await f2(net, 'Net name');
          await key('Escape');
          await key('ArrowRight', 2, SHIFT); await key('ArrowRight', 5); await key('ArrowDown'); // back to the LED's centre
        }
        after = await p.eval(circuitText);
        const c = JSON.parse(after);
        const leds = c.parts.filter((x) => x.type === 'led').map((x) => [x.id, x.color ?? 'red']);
        const labels = c.labels.map((l) => [l.net, l.at]).sort();
        await shot('editor-traffic');
        if (J(leds) !== J([['D1', 'red'], ['D2', 'yellow'], ['D3', 'green']]) || J(labels) !== J([['GP16', 'R1.1'], ['GP17', 'R2.1'], ['GP18', 'R3.1']]) || c.wires.length !== 6) throw new Error(J(c));
        return `${J(leds)} ${J(labels)}, ${c.wires.length} wires`;
      });
      await check('B2-3: undo back to the circuit before the copies and redo forward again give equal files', async () => {
        for (; steps < 40; steps++) { await key('z', 1, CTRL); const t = await said(); if (/Nothing to undo/.test(t) || (await p.eval(circuitText)) === before) { if (!/Nothing/.test(t)) steps++; break; } }
        const back = await p.eval(circuitText);
        if (back !== before) throw new Error(`after ${steps} undos the file differs`);
        for (let i = 0; i < steps; i++) await key('y', 1, CTRL);
        const fwd = await p.eval(circuitText);
        if (fwd !== after) throw new Error(`after ${steps} redos the file differs`);
        await key('y', 1, CTRL); await expectSaid(/Nothing to redo/);
        return `${steps} steps back and forward`;
      });
      await check('B2-3: the traffic light runs: GP16, GP17 and GP18 high light D1, D2 and D3', async () => {
        await toggle();
        await build('c', '#include <rp2350.h>\n\nint main(void) {\n    for (int p = 16; p <= 18; p++) { pin_output(p); pin_write(p, 1); }\n    delay_ms(3000);\n    return 0;\n}\n');
        await run();
        await sleep(900);
        const glow = await p.eval(`['D1', 'D2', 'D3'].map((d) => Number(document.querySelector('.bv-svg [data-sel="upart:' + d + '"] .bv-uglow')?.getAttribute('opacity') ?? -1))`);
        await shot('editor-traffic-run');
        await p.waitFor(`!/^Pause/.test(${primary})`, 15000);
        if (!glow.every((g) => g > 0.5)) throw new Error(J(glow));
        return J(glow);
      });
      await check('B2-3 pointer: a part from the tray placed by a click, dragged, deleted, the deletion undone', async () => {
        await toggle();
        const pt = (sx, sy) => p.eval(`(() => { const s = document.querySelector('.bv-svg'), m = s.getScreenCTM(); return [m.a * ${sx} + m.e, m.d * ${sy} + m.f]; })()`);
        await p.eval(`([...document.querySelectorAll('.bv-ed-tray button')].find((b) => b.getAttribute('aria-label') === 'Capacitor').click(), true)`);
        // right of the board, below the knob: a free place on the sheet (grid row 55, column 39)
        const [x, y] = await pt(495.3, 698.5);
        await p.mouse('mouseMoved', x, y); await p.mouse('mousePressed', x, y); await p.mouse('mouseReleased', x, y); await sleep(300);
        await expectSaid(/^C1 placed at row 55, column 39/);
        const [x1, y1] = await pt(495.3, 698.5), [x2, y2] = await pt(495.3 + 127, 698.5); // after the placement (the sheet may have grown)
        await p.mouse('mousePressed', x1, y1); for (let i = 1; i <= 5; i++) await p.mouse('mouseMoved', x1 + ((x2 - x1) * i) / 5, y1, { down: true }); await p.mouse('mouseReleased', x2, y2); await sleep(300);
        await expectSaid(/^C1 \(Capacitor\) moved to row 55, column 49/);
        await key('Delete'); await expectSaid(/^Removed C1/);
        await key('z', 1, CTRL); await expectSaid(/^Undone: Removed C1/);
        const c = await fileNow();
        const c1 = c.parts.find((q) => q.id === 'C1');
        await shot('editor-pointer');
        if (!c1 || c1.x !== 622.3 || c1.y !== 698.5) throw new Error(J(c1));
        return `C1 at (${c1.x}, ${c1.y})`;
      });
      await check('B2-3 icons and symbols: ground and power placed on their own, wired to C1 with the wire tool (connection nodes hollow, then filled); the delete-wire and delete-part tools', async () => {
        const pt = (sx, sy) => p.eval(`(() => { const s = document.querySelector('.bv-svg'), m = s.getScreenCTM(); return [m.a * ${sx} + m.e, m.d * ${sy} + m.f]; })()`);
        const click = async (sx, sy) => { const [x, y] = await pt(sx, sy); await p.mouse('mouseMoved', x, y); await p.mouse('mousePressed', x, y); await p.mouse('mouseReleased', x, y); await sleep(250); };
        const tray = (label) => p.eval(`([...document.querySelectorAll('.bv-ed-tray button')].find((b) => b.getAttribute('aria-label') === ${J(label)}).click(), true)`);
        const tool = (name) => p.eval(`(document.querySelector('.bv-ed-tools [aria-label^=${J(name)}]').click(), true)`);
        const marks = (id) => p.eval(`[document.querySelectorAll('.bv-svg [data-sel="upart:${id}"] rect.bv-pinmark').length, document.querySelectorAll('.bv-svg [data-sel="upart:${id}"] circle.bv-pinmark-on').length]`);
        // C1 at (622.3, 698.5): pin 1 at x 558.8, pin 2 at x 685.8; ground below pin 2, power above pin 1
        await tray('Ground'); await click(685.8, 787.4); await expectSaid(/^GND1 placed/);
        await tray('Power'); await click(558.8, 609.6); await expectSaid(/^PWR1 placed/);
        const before = await marks('GND1');
        await tool('Draw wires');
        await click(685.8, 698.5); await click(685.8, 762); await expectSaid(/^Wire from C1 pin 2 to GND1 pin 1/);
        await click(558.8, 698.5); await click(558.8, 635); await expectSaid(/^Wire from C1 pin 1 to PWR1 pin 1/);
        const after = await marks('GND1');
        await shot('editor-rails');
        // the wire to power deleted by its icon, then the power symbol by the part icon
        await tool('Delete wires'); await click(558.8, 667); await expectSaid(/^Removed the wire from C1 pin 1 to PWR1 pin 1/);
        await tool('Delete parts'); await click(558.8, 609.6); await expectSaid(/^Removed PWR1/);
        await tool('Select and move');
        const c = await fileNow();
        const wires = c.wires.map((w) => `${w.a}-${w.b}`).filter((w) => w.includes('C1')).sort();
        if (J(before) !== J([1, 0]) || J(after) !== J([0, 1]) || J(wires) !== J(['C1.2-GND1.1']) || c.parts.some((x) => x.id === 'PWR1')) throw new Error(J({ before, after, wires, parts: c.parts.map((x) => x.id) }));
        return `GND1 node hollow ${J(before)} → filled ${J(after)}; ${J(wires)}; PWR1 deleted`;
      });
      await check('B2-3: the demo parts restored from the Circuit tab, wired as before (button GP15 to ground, knob 3V3/GP26/ground)', async () => {
        await p.eval(tab('Circuit'));
        await p.eval(`([...${circ}.querySelectorAll('button')].find((b) => /^Restore the demo parts/.test(b.textContent)).click(), true)`);
        await sleep(400);
        const c = await fileNow();
        const ids = c.parts.map((x) => x.id);
        const w = c.wires.map((x) => `${x.a}-${x.b}`);
        if (!['BTN', 'KNOB', 'PWR1'].every((id) => ids.includes(id)) || !w.includes('BTN.2-GP15') || !w.includes('GP26-KNOB.W')) throw new Error(J({ ids, w }));
        return `${ids.filter((x) => /^(BTN|KNOB|PWR|GND)/.test(x)).join(', ')}`;
      });

      await check('B2-4: Define a part: the example definition added from the Circuit tab, then offered and added as a part', async () => {
        await p.eval(tab('Circuit'));
        await p.eval(`(${circ}.querySelector('details.bv-define').open = true, true)`);
        await p.eval(`([...${circ}.querySelectorAll('button')].find((b) => b.textContent === 'Add the definition').click(), true)`);
        await sleep(400);
        const offered = await p.eval(`[...document.querySelectorAll('select[aria-label="Part to add"] option')].some((o) => o.value === 'ledbar2')`);
        if (!offered) throw new Error('ledbar2 not offered');
        await add('ledbar2');
        const c = await fileNow();
        const u = c.parts.find((x) => x.type === 'ledbar2');
        if (!u || !c.defs.some((d) => d.type === 'ledbar2') || !(await p.eval(`Boolean(document.querySelector('.bv-svg [data-sel="upart:${u.id}"]'))`))) throw new Error(JSON.stringify(c.defs));
        return `${u.id} (ledbar2) placed and drawn`;
      });

      for (const theme of ['light', 'dark']) {
        await check(`axe-core: nothing serious on the Circuit tab and the editor with its key list (${theme} theme)`, async () => {
          if (!(await p.eval(editing))) await toggle();
          await key('?');
          await p.eval(`(document.documentElement.dataset.theme = ${J(theme)}, true)`);
          await p.eval(tab('Circuit'));
          await sleep(300);
          await p.eval(AXE + '; true');
          const r = await p.eval(`axe.run(document, { runOnly: { type: 'tag', values: ${J(AXE_TAGS)} } }).then((r) => r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes.slice(0, 2).map((x) => x.target.join(' ')) })))`);
          await shot(`axe-${theme}`);
          await key('?');
          if (r.length) throw new Error(J(r));
        });
      }
      await check('the Board details pane to the third column (author, 2026-11-13): the drawing gets the middle column; kept across a reload; back again', async () => {
        if (await p.eval(editing)) await toggle();
        const where = `document.querySelector('.p-info')?.closest('[data-pane="right"], [data-pane="mid"]')?.dataset.pane`;
        const wide = () => p.eval(`Math.round(document.querySelector('.p-datapath').getBoundingClientRect().height)`);
        const h0 = await wide();
        await p.eval(`(document.querySelector('.pane-side').click(), true)`); await sleep(400);
        const a = [await p.eval(where), await wide(), await p.eval(`document.querySelector('.pane-side').getAttribute('aria-label')`)];
        await shot('details-side');
        await p.goto(page); await p.waitFor(`document.querySelector('.toolbar')`); await p.eval(view('Board'));
        await p.waitFor(`document.querySelector('.bv-edit-toggle')`); await sleep(300);
        const kept = await p.eval(where);
        await p.eval(`(document.querySelector('.pane-side').click(), true)`); await sleep(400);
        const back = await p.eval(where);
        if (a[0] !== 'right' || !(a[1] > h0 + 100) || !/^Put Board details back/.test(a[2]) || kept !== 'right' || back !== 'mid') throw new Error(J({ h0, a, kept, back }));
        return `drawing ${h0} → ${a[1]} px high; "${a[2]}"`;
      });
      await check('a pane fills its column (author, 2026-11-13): Registers fills the right column, the other panes and their headings hidden; back with the button', async () => {
        const col = `[...document.querySelectorAll('[data-split="right"] > .pane')].map((n) => n.dataset.pane + ':' + (n.offsetParent ? 'shown' : 'hidden')).join(' ')`;
        const h0 = await p.eval(`Math.round(document.querySelector('.p-regs').getBoundingClientRect().height)`);
        await p.eval(`(document.querySelector('.p-regs .pane-fill').click(), true)`); await sleep(300);
        const on = [await p.eval(col), await p.eval(`Math.round(document.querySelector('.p-regs').getBoundingClientRect().height)`), await p.eval(`document.querySelector('.p-regs .pane-fill').getAttribute('aria-pressed')`)];
        await shot('fill-column');
        await p.eval(`(document.querySelector('.p-regs .pane-fill').click(), true)`); await sleep(300);
        const off = await p.eval(col);
        if (!/registers:shown/.test(on[0]) || /(counters|console):shown/.test(on[0]) || !(on[1] > h0 + 100) || on[2] !== 'true' || /hidden/.test(off)) throw new Error(J({ h0, on, off }));
        return `registers ${h0} → ${on[1]} px; ${on[0]}`;
      });
    } finally { await b.close(); }
  }
} finally { server.close(); }
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
