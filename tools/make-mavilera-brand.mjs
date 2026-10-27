// make-mavilera-brand.mjs -- the final MAVILERA brand assets (logo concept D, chosen 2026-10-27):
// the SVG masters and the raster derivatives in content/branding/mavilera/. The symbol is an M cut as a
// timing trace out of a tile, with the amber probe at the end of the trace; the wordmark is a geometric
// stroke alphabet (no font). Colours are the tokens of src/ui/theme.css (--rv-teal, --rv-amber, --ui-text),
// with the light values as fallbacks and the dark values under prefers-color-scheme, as in the RISC-VISTA files.
//   node tools/make-mavilera-brand.mjs [--check]
// Rasters are drawn by a locally installed Chrome or Edge (tools/browser.mjs). Development only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findBrowser } from './browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

const LIGHT = { t: '#145e56', a: '#a85a00', x: '#18343b' };
const DARK = { t: '#5fb3a8', a: '#e3a453', x: '#dde7e9' };
const MONO = { t: '#000000', a: '#000000', x: '#000000', mono: true };
const TOKEN = { t: '--rv-teal', a: '--rv-amber', x: '--ui-text' };
const HEADER = `Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
     Rights class: content (Apache-2.0). Written by tools/make-mavilera-brand.mjs; edit that script, not this file.
     The name MAVILERA is a provisional project name, not licensed as a trademark (TRADEMARKS.md).`;

const LETTERS = {
  M: [22, 'M0 24V0L11 15L22 0V24'], A: [20, 'M0 24L10 0L20 24M4 16H16'], V: [20, 'M0 0L10 24L20 0'], I: [0, 'M0 0V24'],
  L: [14, 'M0 0V24H14'], E: [14, 'M14 0H0V24H14M0 12H11'], R: [16, 'M0 24V0H9A6.5 6.5 0 0 1 9 13H0M8 13L16 24'],
};
const GAP = 6, SCALE = 28 / 24, TX = 62;
function wordmark() {
  let x = 0;
  const word = [...'MAVILERA'];
  // optical kerning: the diagonals of A and V leave a wide gap at the top
  const paths = word.map((ch, i) => { const [w, d] = LETTERS[ch]; const s = `<path transform="translate(${x} 0)" d="${d}"/>`; x += w + GAP - (ch === 'A' && word[i + 1] === 'V' ? 4 : 0); return s; });
  return { width: x - GAP, paths: paths.join('') };
}

/** The symbol; small = the variant for 16 to 32 px (heavier trace, larger probe). */
function symbol(small, mono) {
  const sw = small ? 5 : 4, r = small ? 4.3 : 3.4, cy = small ? 38.5 : 38;
  return `<defs><mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48"><rect width="48" height="48" fill="#fff"/>
      <path fill="none" stroke="#000" stroke-width="${sw}" d="M11 31V13H19V30H29V13H37V31"/>${mono ? `<circle cx="37" cy="${cy}" r="${r}" fill="#000"/>` : ''}</mask></defs>
    <rect class="tf" x="2" y="2" width="44" height="44" rx="9" mask="url(#m)"/>${mono ? '' : `<circle class="af" cx="37" cy="${cy}" r="${r}"/>`}`;
}

const rules = (p, tok) => ['t', 'a', 'x'].map((k) => `.${k === 'x' ? 'xs' : k + 'f'} { ${k === 'x' ? 'stroke' : 'fill'}: ${tok ? `var(${TOKEN[k]}, ${p[k]})` : p[k]}; }`).join(' ');
function svg({ lockup, small = false, p = null, title }) {
  const pal = p ?? LIGHT;
  const css = p ? rules(p, false) : `${rules(LIGHT, true)} @media (prefers-color-scheme: dark) { ${rules(DARK, true)} }`;
  const wm = wordmark();
  const w = lockup ? Math.round(TX + wm.width * SCALE + 4) : 48;
  const body = lockup
    ? `${symbol(small, pal.mono)}\n  <g transform="translate(${TX} 10) scale(${SCALE})" class="xs" fill="none" stroke-width="3" stroke-linejoin="round">${wm.paths}</g>`
    : symbol(small, pal.mono);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 48" width="${w}" height="48" role="img" aria-labelledby="mv-title">
  <!-- ${HEADER} -->
  <title id="mv-title">${title}</title>
  <style>${css}</style>
  ${body}
</svg>
`;
}

const SVGS = {
  'mavilera-logo.svg': svg({ lockup: true, title: 'MAVILERA' }),
  'mavilera-icon.svg': svg({ lockup: false, title: 'MAVILERA' }),
  'mavilera-icon-small.svg': svg({ lockup: false, small: true, title: 'MAVILERA' }),
  'mavilera-light.svg': svg({ lockup: true, p: LIGHT, title: 'MAVILERA' }),
  'mavilera-dark.svg': svg({ lockup: true, p: DARK, title: 'MAVILERA' }),
  'mavilera-mono.svg': svg({ lockup: true, p: MONO, title: 'MAVILERA' }),
};

// ---- rasters: [file, width, height, background or null, symbol share of the shorter side, svg file] ----
const SURFACE = '#ffffff', APP_BG = '#f3f6f7'; // --surface, --app-bg of the light theme
const RASTERS = [
  ['icon-16.png', 16, 16, null, 1, 'mavilera-icon-small.svg'], ['icon-32.png', 32, 32, null, 1, 'mavilera-icon-small.svg'],
  ['icon-48.png', 48, 48, null, 1, 'mavilera-icon-small.svg'],
  ['apple-touch-icon.png', 180, 180, SURFACE, 0.8, 'mavilera-icon.svg'], ['icon-192.png', 192, 192, SURFACE, 0.8, 'mavilera-icon.svg'],
  ['icon-512.png', 512, 512, SURFACE, 0.8, 'mavilera-icon.svg'], ['icon-maskable-512.png', 512, 512, SURFACE, 0.6, 'mavilera-icon.svg'],
  ['social-preview.png', 1200, 630, APP_BG, 0.7, 'mavilera-logo.svg'], // share = width share of the lockup
];

function render() {
  const srcs = Object.fromEntries(Object.entries(SVGS).map(([f, s]) => [f, `data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}`]));
  const page = `<!doctype html><meta charset="utf-8"><body><script>
const rasters = ${JSON.stringify(RASTERS)}, srcs = ${JSON.stringify(srcs)};
const load = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = u; });
(async () => {
  for (const [file, w, h, bg, share, svg] of rasters) {
    const img = await load(srcs[svg]);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    const lockup = img.width > img.height;
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
    const r = spawnSync(exe, ['--headless=new', '--disable-gpu', `--user-data-dir=${join(dir, 'profile')}`, '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(html).href],
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
process.exitCode = differ ? 1 : 0;
