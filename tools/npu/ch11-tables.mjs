// ch11-tables.mjs -- writes content/data/ch11-tables.json (NPU-4) from the book's Chapter 11 at a git ref: the
// illustrative machines of Table 11.3, the kernels of FIG-0115, the fractions of FIG-0106, the laboratory cycles of
// Table 11.5 (the values FIG-0116 draws), and the laboratory data sets v1, v4, v16 (from the copies in
// test/fixtures/npu/ch11/data, hashes in its README) in compact form: v1 and v4 are v16 with NV = 1 or 4 and the
// later vectors zero, which the tool checks word for word.
//   node tools/npu/ch11-tables.mjs [--book ../book-MES] [--ref origin/main]           write
//   node tools/npu/ch11-tables.mjs --check                                            exit 1 if the file differs
// --check compares with the file only (it needs no book repository): it rebuilds the data sets from the fixtures
// and verifies the recorded hashes of the book files when the book is reachable.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const OUT = join(ROOT, 'content', 'data', 'ch11-tables.json');
const DATA = join(ROOT, 'test', 'fixtures', 'npu', 'ch11', 'data');
const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt; };
const BOOK = arg('--book', join(ROOT, '..', 'book-MES'));
const REF = arg('--ref', 'origin/main');
const check = process.argv.includes('--check');
const FILES = { chapter: 'chapters/chapter11/chapter11.tex', fig0106: 'figures/FIG-0106.tex', fig0115: 'figures/FIG-0115.tex', fig0116: 'figures/FIG-0116.tex' };

const sha = (text) => createHash('sha256').update(text).digest('hex');
const git = (...a) => execFileSync('git', ['-C', BOOK, ...a], { encoding: 'utf8', maxBuffer: 1 << 24 });
const fail = (m) => { console.error(`ch11-tables: ${m}`); process.exit(1); };

function between(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) fail(`not found: ${start}`);
  const b = text.indexOf(end, a);
  return text.slice(a, b < 0 ? undefined : b);
}

/** The values of the book files. */
function fromBook(src) {
  const t113 = between(src.chapter, '\\label{tab:acc-machines}', '\\end{tabular}');
  const machines = [...t113.matchAll(/^\s*(CPU|GPU|NPU)\s*&\s*([\d.]+)\s*&\s*([\d.]+)\s*&\s*([\d.]+)\s*\\\\/gm)]
    .map((m) => ({ name: m[1], peak: +m[2], bandwidth: +m[3], ridge: +m[4] }));
  if (machines.length !== 3) fail('Table 11.3: three machines expected');
  for (const m of machines) if (m.peak / m.bandwidth !== m.ridge) fail(`Table 11.3: ${m.name} ridge`);
  const t115 = between(src.chapter, '\\label{tab:acc-lab-cycles}', '\\end{tabular}');
  const cycles = [...t115.matchAll(/^\s*(\d+)\s*&\s*(\d+)\s*&\s*(\d+)\s*&\s*(\d+)\s*&\s*([\d.]+)\s*&\s*([\d.]+)\s*\\\\/gm)]
    .map((m) => ({ vectors: +m[1], shiftAdd: +m[2], mul: +m[3], npu: +m[4], speedupShiftAdd: +m[5], speedupMul: +m[6] }));
  if (cycles.length !== 3) fail('Table 11.5: three rows expected');
  const k = src.fig0115.match(/\\foreach \\i\/\\lab in \{([^}]*\}[^}]*\}[^}]*\})\}/);
  if (!k) fail('FIG-0115: kernel list');
  const kernels = [...k[1].matchAll(/([\d.]+)\/\{([^}]*)\}/g)].map((m) => ({ name: m[2], intensity: +m[1] }));
  if (kernels.length !== 3) fail('FIG-0115: three kernels expected');
  const f = src.fig0106.match(/\\foreach \\f\/\\lab\/\\pos in \{(.*)\}\{/);
  if (!f) fail('FIG-0106: fraction list');
  const fractions = [...f[1].matchAll(/(0\.\d+)\//g)].map((m) => +m[1]);
  if (fractions.length !== 3) fail('FIG-0106: three fractions expected');
  // FIG-0116 draws Table 11.5: check its bar labels
  const bars = [...src.fig0116.matchAll(/anchor=south\] at \([\d.]+,[\d.]+\) \{(\d+)\}/g)].map((m) => +m[1]);
  const want = cycles.flatMap((c) => [c.shiftAdd, c.mul, c.npu]);
  if (JSON.stringify(bars) !== JSON.stringify(want)) fail('FIG-0116 does not draw Table 11.5');
  return { machines, kernels, fractions, cycles };
}

/** The data sets from the fixtures: {nv, weights, vectors} with v1/v4 checked as v16 cut short. */
function dataSets() {
  const words = (set) => readFileSync(join(DATA, set, 'data.hex'), 'utf8').split(/\s+/).filter(Boolean);
  const v16 = words('v16');
  if (v16.length !== 128 || parseInt(v16[0], 16) !== 16) fail('v16: 128 words, NV = 16');
  const weights = v16.slice(4, 8), vectors = v16.slice(16, 32);
  for (const n of [1, 4, 16]) {
    const got = words(`v${n}`);
    const made = expand(n, weights, vectors);
    if (JSON.stringify(got) !== JSON.stringify(made)) fail(`v${n} is not v16 with NV = ${n}`);
  }
  return { layout: { nv: '0x000', weights: '0x010', vectors: '0x040', words: 128 }, sets: [1, 4, 16], weights, vectors };
}

/** The 128 words of data set vn (hex strings, as data.hex). */
export function expand(n, weights, vectors) {
  const out = Array(128).fill('00000000');
  out[0] = n.toString(16).padStart(8, '0');
  weights.forEach((w, i) => { out[4 + i] = w; });
  vectors.slice(0, n).forEach((w, i) => { out[16 + i] = w; });
  return out;
}

function build() {
  let src = null, source = null;
  if (!check) {
    if (!existsSync(BOOK)) fail(`no book repository at ${BOOK}`);
    const commit = git('rev-parse', REF).trim();
    src = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, git('show', `${commit}:${p}`)]));
    source = { book_commit: commit, files: Object.fromEntries(Object.entries(FILES).map(([k, p]) => [p, sha(src[k])])), exported_by: 'tools/npu/ch11-tables.mjs' };
  }
  return { src, source };
}

const { src, source } = build();
let doc;
if (check) {
  const old = JSON.parse(readFileSync(OUT, 'utf8'));
  doc = { ...old, lab_data: dataSets() };
  if (existsSync(BOOK)) {
    const commit = old._source.book_commit;
    for (const [p, h] of Object.entries(old._source.files)) {
      let text = null;
      try { text = git('show', `${commit}:${p}`); } catch { /* commit not in this clone */ }
      if (text !== null && sha(text) !== h) fail(`${p}: hash differs at ${commit}`);
      if (text !== null && p === FILES.chapter) {
        const all = { chapter: text };
        for (const [k, q] of Object.entries(FILES)) if (k !== 'chapter') all[k] = git('show', `${commit}:${q}`);
        const v = fromBook(all);
        doc = { ...doc, machines: v.machines, kernels: v.kernels, amdahl_fractions: v.fractions, lab_cycles: v.cycles };
      }
    }
  }
  const text = JSON.stringify(doc, null, 1) + '\n';
  if (text !== readFileSync(OUT, 'utf8')) fail('content/data/ch11-tables.json differs from what would be written');
  console.log('ch11-tables: up to date');
} else {
  const v = fromBook(src);
  doc = {
    _copyright: 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (book-derived; Apache-2.0).',
    _source: source,
    _note: 'Table 11.3 (illustrative machines, Gop/s and GB/s), FIG-0115 kernels (op/B), FIG-0106 fractions, Table 11.5 (simulated cycles of the measured region; the NPU column includes the 10 weight-load cycles), the laboratory data sets (data.hex words: NV, W from 0x010, vectors from 0x040).',
    machines: v.machines,
    kernels: v.kernels,
    amdahl_fractions: v.fractions,
    lab_cycles: v.cycles,
    lab_data: dataSets(),
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`ch11-tables: wrote ${OUT}`);
}
