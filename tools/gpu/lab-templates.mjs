// lab-templates.mjs -- writes the RISC-V SIMT laboratory templates of content/gpu/rvsimt/templates/ (GPU-2, decision
// G17) from the programs and data copied to test/fixtures/gpu/lab/ (hashes in its README): each program's
// instructions unchanged after its own header comment, and its data.hex as a data section from address 0 (the data
// memory; the argument block the program reads through kernel_args = 0). As for the NPU templates, the tool names
// no book (author, 2026-11-04).
//   node tools/gpu/lab-templates.mjs           write the templates and their index
//   node tools/gpu/lab-templates.mjs --check   exit 1 if a file differs from what would be written
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const FIX = join(ROOT, 'test', 'fixtures', 'gpu', 'lab');
const OUT = join(ROOT, 'content', 'gpu', 'rvsimt', 'templates');

export const TEMPLATES = [
  { id: 'uniform', group: 'lab', profile: 'lab', title: 'No divergence: every thread takes the same path',
    how: 'Two warps of four threads; branches whose outcome every thread of the warp shares.' },
  { id: 'ifelse', group: 'lab', profile: 'lab', title: 'An if/else with split and join',
    how: 'y = 3x for x >= 0, else x / 2 rounded towards zero: the then-path runs first under split, join reconverges.' },
  { id: 'ifelse8', group: 'lab', profile: 'lab-l8', title: 'The if/else on one warp of eight lanes',
    how: 'The same kernel on one warp of eight lanes, so that the cycles compare with the masks-only count.' },
  { id: 'nested', group: 'lab', profile: 'lab', title: 'Nested divergence: a split inside a split',
    how: 'Two nested splits fill the reconvergence stack (four entries per warp).' },
  { id: 'vadd_tail', group: 'lab', profile: 'lab', title: 'Vector add with a tail: threads past n switched off',
    how: 'z = x + y for n = 6 elements on eight threads: the last threads of warp 1 are masked off.' },
  { id: 'reverse_bar', group: 'lab', profile: 'lab', title: 'Reverse an array through a barrier',
    how: 'Each thread writes one element, every warp waits at bar, then each reads its partner\'s element.' },
  { id: 'fault_div', group: 'faults', profile: 'lab', title: 'Fault: a divergent branch',
    how: 'A conditional branch whose outcome differs among the active threads: the core stops with fault 1.' },
  { id: 'fault_join', group: 'faults', profile: 'lab', title: 'Fault: join on an empty stack',
    how: 'A join with nothing on the reconvergence stack: the core stops with fault 4.' },
];

/** The program without its header comment (the lines before `.include`). */
function code(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((l) => /^\s*\.include\b/.test(l));
  if (first < 0) throw new Error('no .include line');
  return lines.slice(first).join('\n').replace(/\n+$/, '\n');
}

/** data.hex as `.word` lines, eight words each; all-zero lines become `.space`. */
function dataLines(hex) {
  const words = hex.split(/\s+/).filter(Boolean).map((t) => parseInt(t, 16) >>> 0);
  let last = words.length - 1;
  while (last >= 0 && words[last] === 0) last -= 1;
  const out = [];
  let skip = 0;
  for (let i = 0; i <= last; i += 8) {
    const row = words.slice(i, Math.min(i + 8, last + 1));
    if (row.every((w) => w === 0)) { skip += 4 * row.length; continue; }
    if (skip) { out.push(`        .space ${skip}`); skip = 0; }
    out.push(`        .word ${row.map((w) => `0x${w.toString(16).padStart(8, '0')}`).join(', ')}   # 0x${(4 * i).toString(16).padStart(3, '0')}`);
  }
  return out;
}

function template(t) {
  const src = readFileSync(join(FIX, t.id, 'prog.s'), 'utf8');
  const data = dataLines(readFileSync(join(FIX, t.id, 'data.hex'), 'utf8'));
  return [
    `# ${t.id}.s -- RISC-V SIMT laboratory program: ${t.title.charAt(0).toLowerCase()}${t.title.slice(1)}.`,
    '# Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.',
    `# Rights class: content (Apache-2.0); provenance of ${t.id}/prog.s and data.hex: test/fixtures/gpu/lab/README.md.`,
    '# Written by tools/gpu/lab-templates.mjs; do not edit by hand.',
    '#',
    `# ${t.how}`,
    `# Profile: ${t.profile === 'lab-l8' ? 'one warp of eight lanes' : 'two warps of four lanes'}. The data section is the data memory from`,
    '# address 0: the argument block (kernel_args = 0) and the arrays.',
    code(src),
    '        .data                   # the data memory, from address 0 (data.hex)',
    ...data,
    '',
  ].join('\n');
}

function index() {
  return `${JSON.stringify({
    _copyright: 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). '
      + 'RISC-V SIMT laboratory templates (GPU-2), written by tools/gpu/lab-templates.mjs; what each gives is checked by test/gpu-rvsimt.test.mjs.',
    groups: { lab: 'The laboratory programs', faults: 'Faults' },
    templates: TEMPLATES.map((t) => ({ id: t.id, file: `${t.id}.s`, group: t.group, view: 'isa', lang: 'asm', profile: t.profile, title: t.title })),
  }, null, 2)}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const files = [...TEMPLATES.map((t) => [`${t.id}.s`, template(t)]), ['index.json', index()]];
  let bad = 0;
  if (!check) mkdirSync(OUT, { recursive: true });
  for (const [name, text] of files) {
    const path = join(OUT, name);
    if (check) {
      let old = null;
      try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
      if (old !== text) { console.error(`${name}: differs from the generator`); bad += 1; }
    } else {
      writeFileSync(path, text);
      console.log(`wrote ${name}`);
    }
  }
  process.exit(bad ? 1 : 0);
}
