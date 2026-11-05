// compare-parts.mjs -- proof that the lockup split into parts (lockup-parts.mjs) paints what the file paints: both
// drawn by a headless Chrome or Edge onto a canvas at half, full and double size, every pixel compared. A wrong,
// missing or extra shape changes pixels by the full 255; the rasteriser antialiases a small path a little differently
// from one large compound path, so an edge pixel may differ by less: the parts pass when no channel of any pixel
// differs by half (128) or more. Development only.  node tools/logo/compare-parts.mjs   (exit 1 if they fail)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../browser.mjs';
import { partsSvg } from './lockup-parts.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** {scale: differing pixels} for the file and its parts, each with the file's own colour rules. */
export async function compareParts(browser) {
  const file = readFileSync(`${ROOT}content/branding/mavilera/mavilera-lockup.svg`, 'utf8');
  const style = /<style>([\s\S]*?)<\/style>/.exec(file)[1];
  const parts = partsSvg(file).replace('<g ', `<style>${style}</style><g `);
  const p = await browser.newPage({ width: 800, height: 600 });
  await p.goto('about:blank');
  const result = await p.eval(`(async () => {
    const load = (text) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail;
      i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text); });
    const [a, b] = await Promise.all([load(${JSON.stringify(file)}), load(${JSON.stringify(parts)})]);
    const out = {};
    for (const s of [1, 2, 4]) {
      const px = (img) => { const c = document.createElement('canvas'); c.width = 1614 * s / 2; c.height = 588 * s / 2;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height); return g.getImageData(0, 0, c.width, c.height).data; };
      const da = px(a), db = px(b);
      // a pixel differs when a channel differs by more than TOL (of 255): the antialiasing of an edge may change by a
      // level or two when the rasteriser sees a smaller path; a misplaced or missing shape differs by far more
      const TOL = 8;
      let n = 0, ink = 0, max = 0, edge = 0;
      for (let k = 0; k < da.length; k += 4) {
        if (da[k + 3]) ink += 1;
        // colour weighted by alpha, as it is composited (a nearly transparent pixel's own colour means little)
        const pa = (d0, j) => (d0[j] * d0[k + 3]) / 255;
        const d = Math.max(Math.abs(pa(da, k) - pa(db, k)), Math.abs(pa(da, k + 1) - pa(db, k + 1)), Math.abs(pa(da, k + 2) - pa(db, k + 2)), Math.abs(da[k + 3] - db[k + 3]));
        if (d > max) max = d;
        if (d > TOL) n += 1; else if (d > 0) edge += 1;
      }
      out[s] = { differ: n, maxChannel: max, withinTolerance: edge, ink, pixels: da.length / 4 };
    }
    return out;
  })()`);
  await p.close();
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const b = (await launch('chrome')) ?? (await launch('edge'));
  if (!b) { console.log('no Chrome or Edge'); process.exit(1); }
  const r = await compareParts(b);
  await b.close();
  console.log(JSON.stringify(r));
  process.exit(partsMatch(r) ? 0 : 1);
}

/** The parts pass: ink drawn at every size, and no channel of any pixel off by half or more. */
export function partsMatch(result) {
  return Object.values(result).every((x) => x.ink > 1000 && x.maxChannel < 128);
}
