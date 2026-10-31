// make-sap2-exercises.mjs -- writes the SAP-2 practice exercises of content/sap-2/exercises/ (WS-F-148; plan step 4
// of docs/architecture/sap-2-plan.md, approved as drafted by the author, 2026-10-30): tasks written for MAVILERA, not taken from any
// textbook, each with a starter program and tests whose expected values are computed here by plain arithmetic modulo
// 256, not by the simulator. The data sit in the RAM (from 0800H), where a program may also store. No solution
// program is written to content/; the model solutions the tests run live in test/fixtures/exercise-solutions/sap-2/
// and are not published.
//   node tools/make-sap2-exercises.mjs [--check]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'content/sap-2/exercises');
const check = process.argv.includes('--check');
const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). A practice exercise written for MAVILERA (spec WS-F-148), not taken from a textbook; produced by tools/make-sap2-exercises.mjs.';
const b = (v) => ((v % 256) + 256) % 256; // a byte: arithmetic modulo 256, as SAP-2's ALU
const hx = (v) => `${b(v).toString(16).toUpperCase().padStart(2, '0')}H`;

const head = (id, task, hint) => `; ${id} -- practice exercise (MAVILERA, SAP-2)\n; ${task}\n; ${hint}\n`;
/** The data of a starter in the RAM: one DB 0 per label, from 0800H. */
const tail = (labels) => `\n        ORG 0800H     ; the data, in the RAM\n${labels.map((l) => `${`${l}:`.padEnd(8)}DB 0\n`).join('')}`;
const yours = '        HLT           ; replace with your code\n';
const ones = (v) => [...b(v).toString(2)].filter((c) => c === '1').length;

const EXERCISES = [
  {
    id: 'sum-to-n', group: 'loops', title: 'The sum of 1 to n',
    task: 'Show on port 3 the sum 1 + 2 + … + n of the byte at n, taken modulo 256 as the ALU does, then stop. For n = 0 the sum is 0: make sure your loop does not run 256 times. Keep the label n and its DB line: the tests write n there.',
    starter: head('sum-to-n', 'Show 1 + 2 + ... + n on port 3.', 'Hint: count n down in C with DCR and JNZ; test n = 0 before the loop.') + yours + tail(['n']),
    tests: [1, 5, 10, 22, 23, 0].map((n) => ({ name: `n = ${n}`, memory: [{ at: 'n', bytes: [n] }], expect: { outputs: [b((n * (n + 1)) / 2)] } })),
  },
  {
    id: 'count-ones', group: 'loops', title: 'Count the ones',
    task: 'Show on port 3 how many bits of the byte at x are 1, then stop. RAL and RAR do not set the flags: use ANI to test a bit. Keep the label x and its DB line; x is in the RAM, so your program may store into it.',
    starter: head('count-ones', 'Show on port 3 the number of 1 bits of x.', 'Hint: eight times, test bit 0 with ANI 01H, then rotate x.') + yours + tail(['x']),
    tests: [0, 1, 0xff, 0xa5, 0x80, 0x7e].map((x) => ({ name: `x = ${hx(x)}`, memory: [{ at: 'x', bytes: [x] }], expect: { outputs: [ones(x)] } })),
  },
  {
    id: 'swap', group: 'memory', title: 'Swap two bytes',
    task: 'Swap the bytes at p and q, in the RAM, then stop: p gets the byte that was at q, and q the byte that was at p. Keep the labels p and q and their DB lines.',
    starter: head('swap', 'Swap the bytes at p and q.', 'Hint: LDA and STA move one byte; keep one of them in B on the way.') + yours + tail(['p', 'q']),
    tests: [[1, 2], [0, 0xff], [7, 7], [0x80, 0x7f]].map(([p, q]) => ({
      name: `${hx(p)} and ${hx(q)}`, memory: [{ at: 'p', bytes: [p] }, { at: 'q', bytes: [q] }],
      expect: { memory: [{ at: 'p', bytes: [q] }, { at: 'q', bytes: [p] }] },
    })),
  },
  {
    id: 'times-four', group: 'memory', title: 'A subroutine that multiplies by four',
    task: 'Write a subroutine that multiplies A by 4 (modulo 256) and returns with RET. Load x, call it and show the result on port 3; call it again and show 16 times x; then stop. SAP-2 has no ADD A: copy A to another register first. Keep the label x and its DB line.',
    starter: head('times-four', 'Show 4 times x, then 16 times x, on port 3, with one subroutine called twice.', 'Hint: A + A twice is 4 times A.') + yours + tail(['x']),
    tests: [1, 3, 0x15, 0x40, 0xff].map((x) => ({ name: `x = ${hx(x)}`, memory: [{ at: 'x', bytes: [x] }], expect: { outputs: [b(4 * x), b(16 * x)] } })),
  },
  {
    id: 'add-two-keys', group: 'ports', title: 'Add two keys',
    task: 'Read two bytes from the keyboard on port 1 and show their sum (modulo 256) on port 3, then stop. Wait for READY (port 2, bit 0) before each read, and after each read set ACKNOWLEDGE (port 4, bit 7), which resets READY: otherwise the second read finds the first byte again. The tests press the keys at different moments.',
    starter: head('add-two-keys', 'Show on port 3 the sum of two keys from the keyboard.', 'Hint: IN 02H and ANI 01H test READY; OUT 04H with 80H acknowledges.') + yours,
    tests: [[5, 7, 0, 200], [0x0f, 0x0f, 50, 400], [0xff, 2, 10, 300], [3, 9, 0, 60]].map(([x, y, t1, t2]) => ({
      name: `${hx(x)} + ${hx(y)}, keys before instructions ${t1 + 1} and ${t2 + 1}`, inputs: [{ at: t1, key: x }, { at: t2, key: y }],
      expect: { outputs: [b(x + y)] }, limit: 2000,
    })),
  },
];

const GROUPS = { loops: 'Loops and flags', memory: 'Memory and subroutines', ports: 'Ports' };

let differ = 0;
const put = (name, obj) => {
  const path = join(DIR, name);
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  if (check) {
    let old = '';
    try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (old !== text) { console.log(`DIFFERS content/sap-2/exercises/${name}`); differ++; }
  } else writeFileSync(path, text);
};
if (!check) mkdirSync(DIR, { recursive: true });
for (const e of EXERCISES) {
  put(`${e.id}.json`, { _copyright: COPY, format: 'risc-vista-exercise', version: 1, arch: 'sap-2', title: e.title, task: e.task, lang: 'asm',
    starter: e.starter, tests: e.tests });
}
put('index.json', { _copyright: COPY, groups: GROUPS, exercises: EXERCISES.map((e) => ({ id: e.id, file: `${e.id}.json`, group: e.group, title: e.title, lang: 'asm' })) });
if (!check) console.log(`written ${EXERCISES.length} exercises and index.json in content/sap-2/exercises/`);
process.exitCode = differ ? 1 : 0;
