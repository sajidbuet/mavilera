// lab-templates.mjs -- writes the Chapter 11 laboratory templates (NPU-2) of content/templates/ from the book's
// programs and data as copied to test/fixtures/npu/ch11/ (hashes in its README): the book's instructions unchanged
// (the NPU at 0x5000_0000, decision G1, in the book since its commit c2dc4c4), and the data set v4 as the data array
// `ram` at address 0.
//   node tools/npu/lab-templates.mjs           write the templates
//   node tools/npu/lab-templates.mjs --check   exit 1 if a template differs from what would be written
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const FIX = join(ROOT, 'test', 'fixtures', 'npu', 'ch11');
const OUT = join(ROOT, 'content', 'templates');
const NPU_LINE = '.equ NPU,    0x50000000';
// the book commit each program was copied from (test/fixtures/npu/README.md)
const COMMIT = { sw_mv: '9e99307', npu_mv: 'c2dc4c4', sw_mv_m: '9e99307' };

const TEMPLATES = [
  { file: 'sw-mv.s', source: 'sw_mv', title: 'software baseline: y = W x on the RV32I core alone (shift-and-add products)',
    how: ['Opens in the single-cycle view with the platform devices on and 1024 words of memory, as the laboratory SoC.',
      'Run to the halt: the counters panel gives the cycles from marker 1 to marker 2 (3718 for these four vectors).'] },
  { file: 'npu-mv.s', source: 'npu_mv', title: 'accelerated version: y = W x on the NPU, polled',
    how: ['Opens in the single-cycle view with the platform devices on and 1024 words of memory, as the laboratory SoC.',
      'The NPU sits at 0x5000_0000. The counters panel gives the cycles between the markers (for these four vectors:',
      '10 from 1 to 2, 143 from 2 to 3: 153 in all), the NPU accesses and the STATUS reads; the NPU view shows the',
      'NPU\'s registers, and the Analysis view where the cycles go.'] },
  { file: 'sw-mv-m.s', source: 'sw_mv_m', title: 'comparison only: the software baseline with mul',
    how: ['The laboratory core has no M extension, so this runs on the instruction level only: the profile',
      '"Laboratory SoC with the NPU", one cycle per instruction (818 cycles for these four vectors).'] },
];

/** The book's program without its header comment (the lines before the first .equ). */
function body(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((l) => /^\s*\.equ\b/.test(l));
  return { header: lines.slice(0, first), code: lines.slice(first).join('\n').replace(/\n+$/, '\n') };
}

function template(t) {
  // the tool names no book (author, 2026-11-04): the program's own header comment is not carried over
  const { code } = body(readFileSync(join(FIX, 'programs', t.source, 'prog.s'), 'utf8'));
  if (t.source === 'npu_mv' && !code.includes(NPU_LINE)) throw new Error('npu_mv: the book\'s NPU line has changed');
  const words = readFileSync(join(FIX, 'data', 'v4', 'data.hex'), 'utf8').split(/\s+/).filter(Boolean);
  if (words.length !== 128) throw new Error('data.hex: 128 words expected');
  const data = [];
  for (let i = 0; i < words.length; i += 8) data.push(`        .word ${words.slice(i, i + 8).map((w) => `0x${w}`).join(', ')}`);
  return [
    `# ${t.file} -- laboratory program, ${t.title}.`,
    '# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.',
    `# Rights class: content (Apache-2.0); provenance of ${t.source}/prog.s and data set v4 (commit ${COMMIT[t.source]}):`,
    '# test/fixtures/npu/README.md. Written by tools/npu/lab-templates.mjs; do not edit by hand.',
    '#',
    ...t.how.map((l) => `# ${l}`),
    '# Data: four vectors from 0x040 (NV at 0x000, W at 0x010). The Analysis view also runs the sets of 1 and 16',
    '# vectors; or load a data file of 128 words into the array ram (Data menu), then assemble again.',
    '        .text',
    code,
    '        .data                   # RAM words 0-127: the data set v4 (data.hex)',
    'ram:',
    ...data,
    '',
  ].join('\n');
}

const check = process.argv.includes('--check');
let bad = 0;
for (const t of TEMPLATES) {
  const text = template(t);
  const path = join(OUT, t.file);
  if (check) {
    let old = null;
    try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (old !== text) { console.error(`${t.file}: differs from the generator`); bad++; }
  } else {
    writeFileSync(path, text);
    console.log(`wrote ${t.file}`);
  }
}
process.exit(bad ? 1 : 0);
