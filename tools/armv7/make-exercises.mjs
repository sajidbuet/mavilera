// make-exercises.mjs -- writes the ARMv7 practice exercises of content/armv7/exercises/ (WS-F-148; roadmap ARM-A6,
// drafted for the author's approval): tasks written for MAVILERA, not taken from Harris and Harris or any other
// textbook, each with a starter program and tests whose expected values are computed here by plain arithmetic, not by
// the simulator. Three groups: the base processor's instructions (they run in all three processor views in the base
// design), the Chapter 7 extensions (the Extended datapath) and the instruction-level forms (the Instructions view).
// The processors keep instructions and data apart, and an immediate operand there is 0 to 255, so the first two groups
// keep their data at fixed low addresses (0x800 on), named with .equ and reached as [Rbase, #name] with Rbase = 0; the
// third uses labels in .data and LDR Rd, =label. No solution program is written to content/; the model solutions the
// tests run live in test/fixtures/exercise-solutions/armv7/ and are not published.
//   node tools/armv7/make-exercises.mjs [--check]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIR = join(ROOT, 'content/armv7/exercises');
const check = process.argv.includes('--check');
const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). A practice exercise written for MAVILERA (spec WS-F-148, roadmap ARM-A6), not taken from a textbook; produced by tools/armv7/make-exercises.mjs.';
const u = (v) => Number(BigInt.asUintN(32, BigInt(v))); // a word, modulo 2^32
const hx = (v) => `0x${u(v).toString(16).toUpperCase()}`;

const head = (id, task, hint) => `; ${id} -- practice exercise (MAVILERA, ARMv7)\n; ${task}\n; ${hint}\n`;
/** The .equ lines of a starter whose data sit at fixed addresses. */
const equs = (pairs) => pairs.map(([n, a]) => `        .equ  ${n}, ${hx(a)}`.padEnd(32) + '; the tests write and read here\n').join('');
const yours = '\ndone:   B     done           ; replace with your code; B . ends the run\n';
const dataTail = (lines) => `\n        .data                ; the data (the tests write here)\n${lines.map(([l, d]) => `${`${l}:`.padEnd(8)}${d}\n`).join('')}`;
const BASE = 'Use only the base processor\'s instructions (ADD, SUB, AND, ORR, LDR, STR and B, each with a condition and with S) and immediates 0 to 255, so that the program also runs in the three processor views in the base design.';
const EXT = 'To run it in a processor view, choose "Extended datapath" in the instruction-set menu: immediates there are 0 to 255.';
const ISA = 'It uses instruction-level forms, so it runs in the Instructions view only.';
const KEEP = 'Keep the .equ lines: the tests write the data at those addresses.';
const bytesOf = (s) => [...Buffer.from(s, 'latin1')];

const EXERCISES = [
  {
    id: 'max-word', group: 'base', title: 'The larger of two signed words',
    task: `Store the larger of the signed words at first (0x800) and second (0x804) at larger (0x808), then end with B . (a branch to itself). ${BASE} The base processor has no CMP: SUBS sets the flags of first − second, and GE and LT read N and V, so they stay right when the subtraction overflows. ${KEEP}`,
    starter: head('max-word', 'Store the larger of the signed words first and second at larger.', 'Hint: SUBS for the flags, then a conditional STR.')
      + equs([['first', 0x800], ['second', 0x804], ['larger', 0x808]]) + yours,
    tests: [[3, 7], [7, 3], [-5, 2], [0x7fffffff, -1], [-0x80000000, 1], [4, 4]].map(([a, b]) => ({
      name: `${a} and ${b}`, memory: [{ at: 0x800, words: [u(a), u(b)] }], expect: { memory: [{ at: 0x808, words: [u(Math.max(a, b))] }] },
    })),
  },
  {
    id: 'sum-words', group: 'base', title: 'The sum of n words',
    task: `Store at total (0x804) the sum, modulo 2^32, of the first n words of list (0x810), where n, 0 to 8, is the word at count (0x800); then end with B . . For n = 0 the sum is 0. ${BASE} An immediate operand of ADD is at most 255 there, but the offset of LDR reaches 4095: step an index register by 4 and load with LDR Rd, [Rindex, #list]. ${KEEP}`,
    starter: head('sum-words', 'Store the sum of the first n words of list at total.', 'Hint: count n down with SUBS; leave the loop with a conditional B.')
      + equs([['count', 0x800], ['total', 0x804], ['list', 0x810]]) + yours,
    tests: [[[], [5, 6, 7]], [[42]], [[10, -3, 7, 100]], [[0xffffffff, 2]], [[1, 2, 3, 4, 5, 6, 7, 8]], [[0x80000000, 0x80000000, 1, 0, 0, 0, 0, 9]]].map(([xs, rest = []]) => {
      const list = [...xs, ...rest].map(u);
      return { name: `n = ${xs.length}`, memory: [{ at: 0x800, words: [xs.length] }, ...(list.length ? [{ at: 0x810, words: list }] : [])],
        expect: { memory: [{ at: 0x804, words: [u(xs.reduce((s, v) => s + u(v), 0))] }] } };
    }),
  },
  {
    id: 'round-16', group: 'base', title: 'Round to a multiple of 16',
    task: `The word at x (0x800) is unsigned. Store x rounded down to a multiple of 16 at down (0x804), and x rounded up to a multiple of 16 at up (0x808), modulo 2^32; then end with B . . ${BASE} x AND 15 is what lies above the multiple below x; the base processor has no BIC, so subtract it. ${KEEP}`,
    starter: head('round-16', 'Store x rounded down and up to a multiple of 16.', 'Hint: AND with 15, SUB, then a conditional ADD.')
      + equs([['x', 0x800], ['down', 0x804], ['up', 0x808]]) + yours,
    tests: [0, 16, 17, 31, 0x12345678, 0xfffffff1].map((x) => {
      const down = u(x - (x % 16));
      return { name: `x = ${hx(x)}`, memory: [{ at: 0x800, words: [x] }], expect: { memory: [{ at: 0x804, words: [down, u(x % 16 ? down + 16 : down)] }] } };
    }),
  },
  {
    id: 'add64', group: 'extended', title: 'Add two 64-bit numbers',
    task: `a and b are 64-bit numbers, each in two words, the low word first: a at 0x800 and 0x804, b at 0x808 and 0x80C. Store a + b, modulo 2^64, at sum: the low word at 0x810, the high word at 0x814; then end with B . . Add the low words with ADDS and the high words with ADC, which adds the carry. ${EXT} ${KEEP}`,
    starter: head('add64', 'Store the 64-bit sum of a and b.', 'Hint: ADDS for the low words, ADC for the high words.')
      + equs([['alo', 0x800], ['ahi', 0x804], ['blo', 0x808], ['bhi', 0x80c], ['slo', 0x810], ['shi', 0x814]]) + yours,
    tests: [[1n, 2n], [0xffffffffn, 1n], [0xffffffffffffffffn, 1n], [0x0123456789abcdefn, 0xfedcba9876543211n], [0x7fffffff80000000n, 0x80000000n], [0x100000000n, 0xffffffffn]].map(([a, b]) => {
      const s = BigInt.asUintN(64, a + b);
      const w = (v) => [Number(v & 0xffffffffn), Number(v >> 32n)];
      return { name: `${hx(Number(a >> 32n))}:${hx(Number(a & 0xffffffffn))} + ${hx(Number(b >> 32n))}:${hx(Number(b & 0xffffffffn))}`,
        memory: [{ at: 0x800, words: [...w(a), ...w(b)] }], expect: { memory: [{ at: 0x810, words: w(s) }] } };
    }),
  },
  {
    id: 'count-byte', group: 'extended', title: 'Count a character in a string',
    task: `The string at text (0x820) ends with a zero byte. Store at count (0x804), as a word, how many of its bytes equal the byte at key (0x800); then end with B . . A key of 0 matches nothing: the zero ends the string. Read the string with LDRB and step an index by 1. ${EXT} ${KEEP}`,
    starter: head('count-byte', 'Count the bytes of text equal to key.', 'Hint: LDRB, CMP with 0 to stop, CMP with the key, ADDEQ.')
      + equs([['key', 0x800], ['count', 0x804], ['text', 0x820]]) + yours,
    tests: [['hello, world', 'o'], ['', 'a'], ['aaaa', 'a'], ['abc', '\0'], ['Mississippi', 's'], ['ARM', 'a']].map(([s, k]) => ({
      name: `"${s}" and ${k === '\0' ? 'the byte 0' : `'${k}'`}`,
      memory: [{ at: 0x800, bytes: [k.charCodeAt(0)] }, { at: 0x820, bytes: [...bytesOf(s), 0] }],
      expect: { memory: [{ at: 0x804, words: [k === '\0' ? 0 : [...s].filter((c) => c === k).length] }] },
    })),
  },
  {
    id: 'times-ten', group: 'extended', title: 'A subroutine that multiplies by ten',
    task: `Write a subroutine times10 that multiplies R0 by 10, modulo 2^32, and returns with MOV PC, LR. There is no multiply instruction: 10x = 2 × (x + 4x), and ADD R0, R0, R0, LSL #2 adds 4x in one instruction. The main program loads the word at x (0x800), calls times10 with BL and stores the result at x10 (0x804), calls it again on that result and stores 100x at x100 (0x808), then ends with B . . ${EXT} ${KEEP}`,
    starter: head('times-ten', 'Store 10x and 100x, with one subroutine called twice.', 'Hint: a shifted register operand, then LSL; MOV PC, LR returns.')
      + equs([['x', 0x800], ['x10', 0x804], ['x100', 0x808]]) + yours,
    tests: [0, 1, 7, 123456, -3, 0x1999999a].map((x) => ({
      name: `x = ${x}`, memory: [{ at: 0x800, words: [u(x)] }], expect: { memory: [{ at: 0x804, words: [u(Math.imul(x, 10)), u(Math.imul(x, 100))] }] },
    })),
  },
  {
    id: 'shift-multiply', group: 'extended', title: 'Multiply by shifting and adding',
    task: `The words at a (0x800) and b (0x804) are unsigned, each 0 to 65535. Store a × b at product (0x808), then end with B . . There is no multiply instruction: for each bit of b, from the lowest, add a shifted left by the bit's position when the bit is 1. LSRS R1, R1, #1 shifts the lowest bit of b into C and sets Z when no 1 bits are left; ADDCS adds only when that bit was 1. ${EXT} ${KEEP}`,
    starter: head('shift-multiply', 'Store a × b by shift and add.', 'Hint: LSRS, ADDCS, LSL, and BNE while bits are left.')
      + equs([['a', 0x800], ['b', 0x804], ['product', 0x808]]) + yours,
    tests: [[0, 5], [5, 0], [3, 4], [1234, 1], [255, 257], [65535, 65535]].map(([a, b]) => ({
      name: `${a} × ${b}`, memory: [{ at: 0x800, words: [a, b] }], expect: { memory: [{ at: 0x808, words: [u(a * b)] }] },
    })),
  },
  {
    id: 'reverse-words', group: 'isa', title: 'Reverse a list in place',
    task: `Reverse, in place, the first n words of list, where n, 0 to 8, is the word at count; the words after them stay as they are. Then end with B . . Take the addresses with LDR Rd, =label, and step a pointer with post-indexing: STR R5, [R2], #4 stores and then adds 4 to R2. ${ISA} Keep the labels count and list and their lines: the tests write there.`,
    starter: head('reverse-words', 'Reverse the first n words of list in place.', 'Hint: one pointer from the front, one from the back, until they meet.')
      + yours + dataTail([['count', '.word 0'], ['list', '.space 32']]),
    tests: [[0, [1, 2, 3]], [1, [9]], [2, [1, 2]], [5, [1, 2, 3, 4, 5, 6, 7]], [8, [8, 7, 6, 5, 4, 3, 2, 1]], [4, [-1, 0, 0x7fffffff, 5, 77]]].map(([n, xs]) => {
      const list = [...xs, ...new Array(8 - xs.length).fill(0)].map(u);
      return { name: `n = ${n}`, memory: [{ at: 'count', words: [n] }, { at: 'list', words: list }],
        expect: { memory: [{ at: 'list', words: [...list.slice(0, n).reverse(), ...list.slice(n)] }] } };
    }),
  },
  {
    id: 'recursive-sum', group: 'isa', title: 'A recursive sum with PUSH and POP',
    task: `Write a recursive subroutine sum that returns 1 + 2 + … + R0 in R0: 0 for R0 = 0, otherwise R0 + sum(R0 − 1). It saves R4 and LR with PUSH {R4, LR} and returns with POP {R4, PC}. The main program loads the word at n (0 to 100), calls sum with BL, stores the result at total and ends with B . . Every PUSH must be undone: the tests also check that SP is back at 0x00100000. ${ISA} Keep the labels n and total and their lines.`,
    starter: head('recursive-sum', 'Store 1 + 2 + ... + n at total, with a recursive subroutine.', 'Hint: MOVS R4, R0 keeps n and sets Z for the case n = 0.')
      + yours + dataTail([['n', '.word 0'], ['total', '.word 0']]),
    tests: [0, 1, 5, 10, 100].map((n) => ({
      name: `n = ${n}`, memory: [{ at: 'n', words: [n] }], expect: { registers: { SP: 0x00100000 }, memory: [{ at: 'total', words: [(n * (n + 1)) / 2] }] },
    })),
  },
];

const GROUPS = {
  base: 'The base processor (all three processor views)',
  extended: 'Chapter 7 extensions (Extended datapath)',
  isa: 'Instruction-level forms (Instructions view)',
};

let differ = 0;
const put = (name, obj) => {
  const path = join(DIR, name);
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  if (check) {
    let old = '';
    try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (old !== text) { console.log(`DIFFERS content/armv7/exercises/${name}`); differ++; }
  } else writeFileSync(path, text);
};
if (!check) mkdirSync(DIR, { recursive: true });
for (const e of EXERCISES) {
  put(`${e.id}.json`, { _copyright: COPY, format: 'risc-vista-exercise', version: 1, arch: 'armv7', title: e.title, task: e.task, lang: 'asm',
    starter: e.starter, tests: e.tests });
}
put('index.json', { _copyright: COPY, groups: GROUPS, exercises: EXERCISES.map((e) => ({ id: e.id, file: `${e.id}.json`, group: e.group, title: e.title, lang: 'asm' })) });
if (!check) console.log(`written ${EXERCISES.length} exercises and index.json in content/armv7/exercises/`);
process.exitCode = differ ? 1 : 0;
