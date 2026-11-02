// make-mavilera-brand.mjs -- the MAVILERA brand assets of the web pages (logo of 2026-10-28, vectorised from
// assets/mavilera-source.png): the SVGs and the raster derivatives in content/branding/mavilera/, built from the
// fixed-colour masters in logo/. A master is flat paths in the classes n (navy), l (light blue) and p (pale blue);
// here the classes become the tokens --mv-navy, --mv-blue and --mv-pale of src/ui/theme.css, with the light values
// as fallbacks and the dark ones under prefers-color-scheme, so that a file follows the theme both when inlined
// (the tool's header) and as an image (the landing page).
//   node tools/make-mavilera-brand.mjs [--check]
// Rasters are drawn by a locally installed Chrome or Edge (tools/browser.mjs). Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser } from './browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MASTERS = join(ROOT, 'logo');
const OUT = join(ROOT, 'content/branding/mavilera');
const check = process.argv.includes('--check');

/** An ICO file whose entries are the given PNGs (each {size, png}). */
function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, png }, k) => {
    const at = 6 + 16 * k;
    head.writeUInt8(size, at);
    head.writeUInt8(size, at + 1);
    head.writeUInt16LE(1, at + 4); // colour planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.png)]);
}

// the colours of the logo (theme.css: --mv-navy, --mv-blue, --mv-pale); only the navy changes in the dark theme
const LIGHT = { n: '#0b2a55', l: '#5b9bd5', p: '#c8e1f4' };
const DARK = { n: '#f2f5fa', l: '#5b9bd5', p: '#c8e1f4' };
const MONO = { n: '#000000', l: '#000000', p: '#ffffff' };
const TOKEN = { n: '--mv-navy', l: '--mv-blue', p: '--mv-pale' };
const HEADER = `Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
     Rights class: content (Apache-2.0). Written by tools/make-mavilera-brand.mjs from logo/; edit those, not this file.
     The name MAVILERA is a provisional project name, not licensed as a trademark (TRADEMARKS.md).`;

/** The view box and the paths ({cls, d}) of a master in logo/. */
function master(file) {
  const s = readFileSync(join(MASTERS, file), 'utf8');
  const box = /viewBox="([^"]+)"/.exec(s)[1].trim().split(/[\s,]+/).map(Number);
  const paths = [...s.matchAll(/<path\b([^>]*)\/>/g)].map(([, a]) => ({ cls: /class="(\w)"/.exec(a)[1], d: /\bd="([^"]+)"/.exec(a)[1] }));
  if (!paths.length) throw new Error(`${file}: no paths`);
  return { box, paths };
}

const rules = (p, tok, keys) => keys.map((k) => `.mv-${k} { fill: ${tok ? `var(${TOKEN[k]}, ${p[k]})` : p[k]}; }`).join(' ');
/** A brand SVG from a master: themed (p null) or in the fixed palette p; the view box starts at 0 0 with whole units. */
function svg(file, title, p = null) {
  const { box: [x, y, w, h], paths } = master(file);
  const W = Math.ceil(w), H = Math.ceil(h);
  const keys = Object.keys(TOKEN).filter((k) => paths.some((q) => q.cls === k));
  const css = p ? rules(p, false, keys)
    : `${rules(LIGHT, true, keys)}${keys.includes('n') ? ` @media (prefers-color-scheme: dark) { ${rules(DARK, true, ['n'])} }` : ''}`;
  const tx = +(-x + (W - w) / 2).toFixed(2), ty = +(-y + (H - h) / 2).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="mv-title">
  <!-- ${HEADER} -->
  <title id="mv-title">${title}</title>
  <style>${css}</style>
  <g transform="translate(${tx} ${ty})">${paths.map((q) => `<path class="mv-${q.cls}" d="${q.d}"/>`).join('')}</g>
</svg>
`;
}

const SVGS = {
  'mavilera-logo.svg': svg('mavilera-riscv-header.svg', 'MAVILERA RISC-V'), // the tool's header: MAVILERA, the microprocessor, RISC-V
  'mavilera-logo-sap-1.svg': svg('mavilera-sap1-header.svg', 'MAVILERA SAP-1'), // the same for the SAP-1 module (content.logo, contract v6)
  'mavilera-logo-sap-2.svg': svg('mavilera-sap2-header.svg', 'MAVILERA SAP-2'), // and for the SAP-2 module
  'mavilera-logo-armv7.svg': svg('mavilera-armv7-header.svg', 'MAVILERA ARMv7'), // and for the ARMv7 module (W-D35)
  'mavilera-full.svg': svg('mavilera-full.svg', 'MAVILERA'), // the landing page
  'mavilera-lockup.svg': svg('mavilera-lockup.svg', 'MAVILERA'), // the landing page on narrow screens: no subtitle
  'mavilera-wordmark.svg': svg('mavilera-wordmark.svg', 'MAVILERA'),
  'mavilera-mark.svg': svg('mavilera-mark.svg', 'MAVILERA'),
  'mavilera-icon.svg': svg('mavilera-icon.svg', 'MAVILERA'), // favicon and application icons
  'mavilera-light.svg': svg('mavilera-full.svg', 'MAVILERA', LIGHT),
  'mavilera-dark.svg': svg('mavilera-full.svg', 'MAVILERA', DARK),
  'mavilera-mono.svg': svg('mavilera-full.svg', 'MAVILERA', MONO),
};

// ---- rasters: [file, width, height, background or null, share (of the shorter side; of the width for a lockup), svg file] ----
const SURFACE = '#ffffff', APP_BG = '#f2f5fa'; // --surface, --app-bg of the light theme
const RASTERS = [
  ['icon-16.png', 16, 16, null, 1, 'mavilera-icon.svg'], ['icon-32.png', 32, 32, null, 1, 'mavilera-icon.svg'],
  ['icon-48.png', 48, 48, null, 1, 'mavilera-icon.svg'],
  ['apple-touch-icon.png', 180, 180, SURFACE, 0.84, 'mavilera-icon.svg'], ['icon-192.png', 192, 192, SURFACE, 0.84, 'mavilera-icon.svg'],
  ['icon-512.png', 512, 512, SURFACE, 0.84, 'mavilera-icon.svg'], ['icon-maskable-512.png', 512, 512, SURFACE, 0.64, 'mavilera-icon.svg'],
  ['social-preview.png', 1200, 630, APP_BG, 0.86, 'mavilera-full.svg'],
];

function render() {
  const srcs = Object.fromEntries(Object.entries(SVGS).map(([f, s]) => [f, `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`]));
  const page = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light"><body><script>
const rasters = ${JSON.stringify(RASTERS)}, srcs = ${JSON.stringify(srcs)};
const load = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = u; });
(async () => {
  for (const [file, w, h, bg, share, svg] of rasters) {
    const img = await load(srcs[svg]);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    const lockup = img.width > img.height * 1.5;
    const dw = lockup ? w * share : Math.min(w, h) * share, dh = dw * img.height / img.width;
    g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    const pre = document.createElement('pre'); pre.id = file; pre.textContent = c.toDataURL('image/png'); document.body.append(pre);
  }
  document.body.dataset.done = '1';
})();
</script></body>`;
  const exe = findBrowser('chrome') ?? findBrowser('edge');
  if (!exe) throw new Error('Chrome or Edge not found (set CHROME_PATH or EDGE_PATH)');
  const dir = mkdtempSync(join(tmpdir(), 'mavilera-brand-'));
  try {
    const html = join(dir, 'r.html');
    writeFileSync(html, page);
    const r = spawnSync(exe, ['--headless=new', '--disable-gpu', '--force-color-profile=srgb', `--user-data-dir=${join(dir, 'profile')}`, '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(html).href],
      { encoding: 'utf8', maxBuffer: 1 << 27 });
    if (r.status !== 0 || !r.stdout.includes('data-done="1"')) throw new Error(`browser run failed: ${r.stderr}`);
    const out = {};
    for (const [file] of RASTERS) {
      const m = new RegExp(`<pre id="${file.replace('.', '\\.')}">data:image/png;base64,([A-Za-z0-9+/=]+)</pre>`).exec(r.stdout);
      if (!m) throw new Error(`${file}: not rendered`);
      out[file] = Buffer.from(m[1], 'base64');
    }
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

mkdirSync(OUT, { recursive: true });
const pngs = render();
const files = { ...SVGS, ...pngs, 'favicon.ico': ico([16, 32, 48].map((size) => ({ size, png: pngs[`icon-${size}.png`] }))) };
let differ = 0;
for (const [file, data] of Object.entries(files)) {
  const path = join(OUT, file), buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (check) { if (!existsSync(path) || !readFileSync(path).equals(buf)) { console.log(`DIFFERS ${file}`); differ++; } }
  else { writeFileSync(path, buf); console.log(`written ${file} (${buf.length} bytes)`); }
}
// files of an earlier logo that this script no longer writes
for (const f of readdirSync(OUT)) if (!(f in files)) { console.log(`${check ? 'EXTRA' : 'not written by this script (remove it)'} ${f}`); if (check) differ++; }
process.exitCode = differ ? 1 : 0;
