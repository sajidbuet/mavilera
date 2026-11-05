// make-hero-variants.mjs -- writes the review page of the four hero-logo animations (docs/branding/logo-animation.md)
// into a folder, for the author's choice: each variant as the landing page's hero shows it (the lockup, the full form
// of the name after it), with Replay, a light/dark switch and a reduced-motion switch; the static file beside them
// for reference. Development only; nothing here ships until a variant is chosen.
//   node tools/logo/make-hero-variants.mjs <folder>     then: node tools/serve.mjs <port> <folder>
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { partsSvg } from './lockup-parts.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node tools/logo/make-hero-variants.mjs <folder>');
mkdirSync(OUT, { recursive: true });

const file = readFileSync(join(ROOT, 'content/branding/mavilera/mavilera-lockup.svg'), 'utf8');
const svg = partsSvg(file, { animated: true });
const FULL = '<b>M</b>icroprocessor <b>A</b>rchitecture <b>V</b>isualizer for <b>I</b>nteractive <b>L</b>earning, <b>E</b>xecution, and <b>R</b>untime <b>A</b>nalysis';
const VARIANTS = [
  ['a', 'A · Instruction run', 'The concept of the brief: the instruction cards slide in and their bars fill, the wires draw into the M, the arches rise, the road runs up, the stages light one after another, MAVILERA wipes in and the triangles snap in.'],
  ['b', 'B · Blueprint', 'Every part is first drawn as an outline, left to right, as on a drawing board; then the fills flow in, navy, then blue, then pale, and the outlines fade.'],
  ['c', 'C · Assemble', 'The parts fly in from their own sides: the cards from the left, the arches from below and the sides, the stages drop from above, the letters rise with a spring and the triangles spin into place.'],
  ['d', 'D · Signal wave', 'The logo starts as a faint ghost; a light front sweeps across it from left to right, lighting each part as it passes, as a signal propagates through a circuit.'],
];

const panel = ([v, name, text]) => `
  <section class="variant" id="v-${v}">
    <header><h2>${name}</h2><button type="button" data-replay="${v}">Replay</button></header>
    <p class="about">${text}</p>
    <div class="hero-logo-box">${svg}<p class="hero-expansion">${FULL}</p></div>
  </section>`;

const html = `<!doctype html>
<!-- Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code. -->
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MAVILERA hero logo: four animations for review</title>
<style>
  :root { --bg: #f4f7fb; --surface: #fff; --text: #14213d; --text-2: #4a5b78; --border: #d6dfeb; --primary: #1f5fa8;
          --mv-navy: #0b2a55; --mv-blue: #5b9bd5; --mv-pale: #c8e1f4; color-scheme: light; }
  :root[data-theme="dark"] { --bg: #0b1322; --surface: #111c30; --text: #e6edf7; --text-2: #a7b6cc; --border: #26364f; --primary: #7fb2ec;
          --mv-navy: #f2f5fa; color-scheme: dark; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, "Segoe UI", sans-serif; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 24px 16px 60px; }
  h1 { font-size: 24px; margin: 0 0 6px; } .lead { color: var(--text-2); margin: 0 0 16px; }
  .bar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin: 0 0 20px; }
  .bar label { display: inline-flex; gap: 6px; align-items: center; }
  button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
  button:hover { border-color: var(--primary); color: var(--primary); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(520px, 1fr)); gap: 18px; }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
  .variant { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 16px 20px 22px; }
  .variant header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .variant h2 { font-size: 19px; margin: 0; } .about { color: var(--text-2); font-size: 14px; margin: 6px 0 14px; min-height: 3em; }
  .hero-logo-box svg { display: block; width: 100%; height: auto; overflow: visible; }
  .hero-expansion { margin: 10px 0 0; font-size: 16px; font-weight: 600; color: var(--text-2); }
  .hero-expansion b { color: var(--primary); }
  .reference { margin-top: 22px; } .reference img { width: min(480px, 100%); display: block; }
  /* the logo's colours (the tokens of the site), and what the animations move */
  .mvh .mv-n { fill: var(--mv-navy); } .mvh .mv-l { fill: var(--mv-blue); } .mvh .mv-p { fill: var(--mv-pale); }
  .mvh path { transform-box: fill-box; transform-origin: 50% 50%; }
  .mvh .p-m-left, .mvh .p-m-right { transform-origin: 50% 100%; }
  .mvh .p-wires-left, .mvh .p-wires-right, .mvh .p-arrow-in, .mvh [class*="p-card-"].mv-l, .mvh [class*="p-card-"].mv-p { transform-origin: 0 50%; }
  .mvh .p-scan { fill: var(--mv-blue); opacity: 0; filter: blur(10px); pointer-events: none; }
  /* B: outlines while it draws (pathLength 1: one dash is the whole outline) */
  .mvh-b path { stroke-width: 2.4; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 0; }
  .mvh-b .mv-n { stroke: var(--mv-navy); } .mvh-b .mv-l { stroke: var(--mv-blue); } .mvh-b .mv-p { stroke: var(--mv-pale); }
</style></head>
<body><main class="wrap">
  <h1>MAVILERA hero logo: four animations</h1>
  <p class="lead">Each panel shows the landing page's hero as it would play on a first visit (about 2.5 s). After the intro, a pulse runs through the pipeline every 8 s while the logo is on screen, and once on hover. Under reduced motion the logo is static. Choose one, or name what to change.</p>
  <div class="bar">
    <button type="button" id="all">Replay all</button>
    <label><input type="checkbox" id="dark"> Dark theme</label>
    <label><input type="checkbox" id="rm"> Simulate reduced motion</label>
    <label>Speed <select id="speed"><option value="1">1×</option><option value="0.5">0.5× (slow, to inspect)</option><option value="0.25">0.25×</option></select></label>
  </div>
  <div class="grid">${VARIANTS.map(panel).join('')}</div>
  <section class="variant reference"><h2>Reference: the static logo (today's landing page)</h2><p class="about">The end state of every variant is this file, unchanged.</p>
    <div class="hero-logo-box"><img src="mavilera-lockup.svg" alt="MAVILERA"><p class="hero-expansion">${FULL}</p></div></section>
</main>
<script type="module">
  import { animate } from './hero-variants.js';
  const rm = document.getElementById('rm');
  const reduced = () => rm.checked || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const players = {};
  for (const s of document.querySelectorAll('.variant[id^="v-"]')) {
    const v = s.id.slice(2);
    players[v] = animate(s.querySelector('svg'), v, { reduced });
  }
  const rate = () => Number(document.getElementById('speed').value);
  const replay = (v) => { players[v].replay(); for (const a of document.getAnimations()) a.playbackRate = rate(); };
  for (const b of document.querySelectorAll('[data-replay]')) b.addEventListener('click', () => replay(b.dataset.replay));
  document.getElementById('all').addEventListener('click', () => Object.keys(players).forEach(replay));
  document.getElementById('speed').addEventListener('change', () => Object.keys(players).forEach(replay));
  document.getElementById('dark').addEventListener('change', (e) => { document.documentElement.dataset.theme = e.target.checked ? 'dark' : 'light'; });
  rm.addEventListener('change', () => Object.keys(players).forEach(replay));
</script>
</body></html>
`;
writeFileSync(join(OUT, 'index.html'), html);
copyFileSync(join(ROOT, 'tools/logo/hero-variants.js'), join(OUT, 'hero-variants.js'));
copyFileSync(join(ROOT, 'content/branding/mavilera/mavilera-lockup.svg'), join(OUT, 'mavilera-lockup.svg'));
console.log(`written ${join(OUT, 'index.html')}`);
