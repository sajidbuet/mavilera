// make-sap1-exercises.mjs -- writes the SAP-1 practice exercises of content/sap-1/exercises/ (WS-F-148; approved as
// drafted by the author, 2026-10-29): tasks written for MAVILERA, not taken from any textbook, each with a starter program and
// tests whose expected values are computed here by plain arithmetic modulo 256, not by the simulator. SAP-1 has no
// jumps, so every task is a straight-line program that fits sixteen bytes. No solution program is written to
// content/; the model solutions the tests run live in test/fixtures/exercise-solutions/sap-1/ and are not published.
//   node tools/make-sap1-exercises.mjs [--check]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'content/sap-1/exercises');
const check = process.argv.includes('--check');
const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). A practice exercise written for MAVILERA (spec WS-F-148), not taken from a textbook; produced by tools/make-sap1-exercises.mjs.';
const b = (v) => ((v % 256) + 256) % 256; // a byte: arithmetic modulo 256, as SAP-1's adder-subtracter

const head = (id, task, hint) => `; ${id} -- practice exercise (MAVILERA, SAP-1)\n; ${task}\n; ${hint}\n`;
/** The data of a starter at the end of the memory: one DB 0 per label, from 16 minus their number. */
const tail = (labels) => {
  const at = 16 - labels.length;
  const org = `        ORG ${at.toString(16).toUpperCase().replace(/^([A-F])/, '0$1')}H`;
  return `\n${org.padEnd(22)}; the data at the end of the memory\n${labels.map((l) => `${`${l}:`.padEnd(8)}DB 0\n`).join('')}`;
};
const yours = '        HLT           ; replace with your code\n';
const out = (vals) => ({ outputs: vals.map(b), registers: { OUT: b(vals[vals.length - 1]) } });

const EXERCISES = [
  {
    id: 'sum-four', group: 'arith', title: 'Add four numbers',
    task: 'Show on OUT the sum of the four bytes at a, b, c and d, then stop. The sum is taken modulo 256, as the adder-subtracter does. Keep the four labels and their DB lines: the tests write the numbers there.',
    starter: head('sum-four', 'Show on OUT the sum of the bytes at a, b, c and d.', 'Hint: load one, add the others, then OUT and HLT.') + yours + tail(['a', 'b', 'c', 'd']),
    tests: [[1, 2, 3, 4], [100, 100, 50, 10], [255, 1, 0, 0], [17, 0, 0, 0]].map((v) => ({
      name: `${v.join(' + ')}`, memory: [{ at: 'a', bytes: [v[0]] }, { at: 'b', bytes: [v[1]] }, { at: 'c', bytes: [v[2]] }, { at: 'd', bytes: [v[3]] }],
      expect: out([v.reduce((s, x) => s + x, 0)]),
    })),
  },
  {
    id: 'negate', group: 'arith', title: 'The negative of a number',
    task: 'Show on OUT the two\'s-complement negative of the byte at x: the byte that gives 0 when added to x. SAP-1 has no negate instruction; the byte at zero holds 0. Keep the labels and their DB lines.',
    starter: head('negate', 'Show on OUT the byte that gives 0 when added to x.', 'Hint: 0 - x. The byte at zero is 0.') + yours + tail(['zero', 'x']),
    tests: [1, 0, 100, 128, 255].map((x) => ({ name: `-${x}`, memory: [{ at: 'x', bytes: [x] }], expect: out([-x]) })),
  },
  {
    id: 'running-total', group: 'output', title: 'A running total',
    task: 'Show on OUT, one after another, the byte at a, then the sum of a and b, then the sum of a, b and c (each modulo 256), then stop. Keep the labels and their DB lines.',
    starter: head('running-total', 'Show a, then a + b, then a + b + c on OUT.', 'Hint: OUT copies A and leaves it as it is.') + yours + tail(['a', 'b', 'c']),
    tests: [[5, 6, 7], [200, 50, 10], [0, 0, 1], [128, 128, 128]].map(([x, y, z]) => ({
      name: `${x}, ${y}, ${z}`, memory: [{ at: 'a', bytes: [x] }, { at: 'b', bytes: [y] }, { at: 'c', bytes: [z] }],
      expect: out([x, x + y, x + y + z]),
    })),
  },
  {
    id: 'both-differences', group: 'output', title: 'Both differences',
    task: 'Show on OUT the difference a - b, then the difference b - a (each modulo 256), then stop. Compare the two values in binary: what do they have in common? Keep the labels and their DB lines.',
    starter: head('both-differences', 'Show a - b, then b - a, on OUT.', 'Hint: A must be loaded again for the second difference.') + yours + tail(['a', 'b']),
    tests: [[9, 4], [4, 9], [7, 7], [0, 255]].map(([x, y]) => ({
      name: `${x} and ${y}`, memory: [{ at: 'a', bytes: [x] }, { at: 'b', bytes: [y] }], expect: out([x - y, y - x]),
    })),
  },
  {
    id: 'times-ten', group: 'arith', title: 'Ten times a number',
    task: 'Show on OUT ten times the byte at x (modulo 256), then stop. SAP-1 cannot multiply or shift, and an instruction can only add a byte of the memory: count the bytes your program needs, since the memory has sixteen. Keep the label x and its DB line.',
    starter: head('times-ten', 'Show 10 times x on OUT.', 'Hint: only additions; the program and x must fit the sixteen bytes.') + yours + tail(['x']),
    tests: [0, 3, 25, 26, 255].map((x) => ({ name: `10 × ${x}`, memory: [{ at: 'x', bytes: [x] }], expect: out([10 * x]) })),
  },
];

const GROUPS = { arith: 'Arithmetic without jumps', output: 'Several outputs' };

let differ = 0;
const put = (name, obj) => {
  const path = join(DIR, name);
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  if (check) {
    let old = '';
    try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (old !== text) { console.log(`DIFFERS content/sap-1/exercises/${name}`); differ++; }
  } else writeFileSync(path, text);
};
if (!check) mkdirSync(DIR, { recursive: true });
for (const e of EXERCISES) {
  put(`${e.id}.json`, { _copyright: COPY, format: 'risc-vista-exercise', version: 1, arch: 'sap-1', title: e.title, task: e.task, lang: 'asm',
    starter: e.starter, tests: e.tests });
}
put('index.json', { _copyright: COPY, groups: GROUPS, exercises: EXERCISES.map((e) => ({ id: e.id, file: `${e.id}.json`, group: e.group, title: e.title, lang: 'asm' })) });
if (!check) console.log(`written ${EXERCISES.length} exercises and index.json in content/sap-1/exercises/`);
process.exitCode = differ ? 1 : 0;
