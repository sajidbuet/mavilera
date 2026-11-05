// tools/gpu/make-exercises.mjs -- writes the practice exercises of the GPU module's RISC-V SIMT core,
// content/gpu/rvsimt/exercises/ (WS-F-148, W-D24; GPU-4): tasks written for MAVILERA, unlike the laboratory programs
// and any exercise of the textbook, each with a starter program (data and labels only) and tests whose expected words
// are computed here by a plain JavaScript model of the task. No solution is written to content/; the model solutions
// the tests run live in test/fixtures/exercise-solutions/gpu/ and are not published.
//   node tools/gpu/make-exercises.mjs [--check]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIR = join(ROOT, 'content/gpu/rvsimt/exercises');
const check = process.argv.includes('--check');
const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). A practice exercise written for MAVILERA (W-D24), not taken from the textbook; produced by tools/gpu/make-exercises.mjs.';
const u = (v) => v >>> 0;
const MARK = 0x5a5a5a5a; // written to the output words before a run

// a fixed pseudo-random sequence (the files must not change between runs)
let seed = 0x5eed11a;
const rand = (lo, hi) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return lo + ((seed >>> 8) % (hi - lo + 1)); };
const randWords = (n, lo, hi) => Array.from({ length: n }, () => rand(lo, hi));

// the models: what the program must leave in memory
const M = {
  difference: (x, y) => x.map((v, i) => v - y[i]),
  clamp: (x, lo, hi) => x.map((v) => Math.min(hi, Math.max(lo, v))),
  sign: (x) => x.map((v) => Math.sign(v) + 0),
};

const starter = (name, what, profile, data) => [
  `# ${name} -- practice exercise (MAVILERA GPU Laboratory)`,
  `# ${what}`,
  `# Profile: ${profile === 'lab' ? 'two warps of four lanes (thread i = 0 to 7); start warp 1 with wspawn' : 'one warp of eight lanes (thread i = 0 to 7)'}.`,
  '        .include "simt.inc"',
  '        .text',
  '_start: # your code',
  '        tmc    zero',
  '        .data',
  ...data,
  '',
].join('\n');

const words = (v) => v.join(', ');

const EXERCISES = [
  {
    id: 'gpu-difference', title: 'Two warps: the difference of two arrays', profile: 'lab',
    task: 'For the profile with two warps of four lanes. Eight threads, i = 0 to 7 (the identity register THREAD_INDEX), each compute z[i] = x[i] − y[i] for the arrays x, y and z of eight words at the labels x, y and z. Start the second warp with wspawn, so that both warps run the same kernel; end every warp with tmc zero. No thread needs to branch.',
    starter: starter('gpu-difference', 'z[i] = x[i] - y[i] for i = 0 to 7, one thread per element.', 'lab',
      ['x:      .word  9, 8, 7, 6, 5, 4, 3, 2', 'y:      .word  1, 1, 2, 3, 5, 8, 13, 21', 'z:      .space 32']),
    cases: () => [
      [[9, 8, 7, 6, 5, 4, 3, 2], [1, 1, 2, 3, 5, 8, 13, 21]],
      [randWords(8, -1000, 1000), randWords(8, -1000, 1000)],
      [randWords(8, -100000, 100000), randWords(8, -100000, 100000)],
      [[0, 0, 0, 0, 0, 0, 0, 0], [-1, -2, -3, -4, -5, -6, -7, -8]],
    ].map(([x, y]) => ({ memory: [{ at: 'x', words: x.map(u) }, { at: 'y', words: y.map(u) }], expect: [{ at: 'z', words: M.difference(x, y).map(u) }] })),
  },
  {
    id: 'gpu-clamp', title: 'Clamp to a range with split and join', profile: 'lab',
    task: 'For the profile with two warps of four lanes. Each thread i = 0 to 7 writes y[i] = x[i] limited to the range from low to high: low if x[i] < low, high if x[i] > high, else x[i]. low and high are words at the labels low and high (low ≤ high). The threads of a warp may disagree, so bracket each decision with split and join and keep every branch uniform. Use both warps; end every warp with tmc zero.',
    starter: starter('gpu-clamp', 'y[i] = x[i] limited to [low, high]; the threads of a warp may take different paths.', 'lab',
      ['low:    .word  -5', 'high:   .word  10', 'x:      .word  -20, -5, 0, 7, 10, 11, 3, -6', 'y:      .space 32']),
    cases: () => [
      [[-20, -5, 0, 7, 10, 11, 3, -6], -5, 10],
      [[1, 2, 3, 4, 5, 6, 7, 8], 0, 100], // no thread diverges
      [[-9, -8, -7, -6, 50, 60, 70, 80], -1, 1], // every thread out of range, in two groups
      [randWords(8, -300, 300), -100, 150],
      [randWords(8, -50, 50), 7, 7],
    ].map(([x, lo, hi]) => ({ memory: [{ at: 'low', words: [u(lo)] }, { at: 'high', words: [u(hi)] }, { at: 'x', words: x.map(u) }],
      expect: [{ at: 'y', words: M.clamp(x, lo, hi).map(u) }] })),
  },
  {
    id: 'gpu-sign', title: 'The sign of each element: a split inside a split', profile: 'lab-l8',
    task: 'For the profile with one warp of eight lanes. Each thread i = 0 to 7 writes s[i] = −1 if x[i] < 0, 0 if x[i] = 0 and 1 if x[i] > 0, for the eight words at x and s. The second test needs a decision inside one path of the first: the reconvergence stack holds two nested splits. End the warp with tmc zero.',
    starter: starter('gpu-sign', 's[i] = -1, 0 or 1 by the sign of x[i].', 'lab-l8',
      ['x:      .word  5, -3, 0, -7, 2, 0, 4, -8', 's:      .space 32']),
    cases: () => [
      [5, -3, 0, -7, 2, 0, 4, -8],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [-1, -2, -3, -4, -5, -6, -7, -8],
      [3, 0, 3, 0, 3, 0, 3, 0], // no negative element
      randWords(8, -3, 3),
    ].map((x) => ({ memory: [{ at: 'x', words: x.map(u) }], expect: [{ at: 's', words: M.sign(x).map(u) }] })),
  },
];

const files = new Map();
const index = { _copyright: COPY.replace(/A practice exercise.*$/, 'The practice exercises of the GPU Laboratory (W-D24), written for MAVILERA; produced by tools/gpu/make-exercises.mjs.'),
  groups: { simt: 'RISC-V SIMT core' }, exercises: [] };
for (const e of EXERCISES) {
  // the output array is filled with a marker first: a program must write every element
  const tests = e.cases().map((c, i) => ({ name: `case ${i + 1}`, memory: [...c.memory, ...c.expect.map((x) => ({ at: x.at, words: x.words.map(() => MARK) }))],
    expect: { memory: c.expect }, limit: 2000 }));
  const file = `${e.id}.json`;
  files.set(file, { _copyright: COPY, format: 'risc-vista-exercise', version: 1, arch: 'gpu', title: e.title, task: e.task, lang: 'asm', profile: e.profile,
    starter: e.starter, tests });
  index.exercises.push({ id: e.id, file, group: 'simt', title: e.title, lang: 'asm' });
}
files.set('index.json', index);

let bad = 0;
if (!check) mkdirSync(DIR, { recursive: true });
for (const [name, obj] of files) {
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  const path = join(DIR, name);
  if (check) {
    let old = null;
    try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (old !== text) { console.error(`differs: ${name}`); bad++; }
  } else writeFileSync(path, text);
}
if (check) {
  const extra = readdirSync(DIR).filter((f) => !files.has(f));
  for (const f of extra) { console.error(`not written by this tool: ${f}`); bad++; }
}
if (bad) process.exit(1);
console.log(check ? 'gpu exercises: up to date' : `gpu exercises: ${files.size} files written to content/gpu/rvsimt/exercises/`);
