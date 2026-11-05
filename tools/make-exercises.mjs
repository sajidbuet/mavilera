// make-exercises.mjs -- writes the practice exercises of content/exercises/ (spec WS-F-148,
// W-D24): tasks written for MAVILERA, unlike any exercise of the textbook, each with a starter
// program and tests whose expected values are computed here by a plain JavaScript model of the
// task. No solution program is written to content/; the model solutions that the tests run live in
// test/fixtures/exercise-solutions/ and are not published.
//   node tools/make-exercises.mjs [--check]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'content/exercises');
const check = process.argv.includes('--check');
const COPY = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). A practice exercise written for MAVILERA (spec W-D24), not taken from the textbook; produced by tools/make-exercises.mjs.';
const u = (v) => v >>> 0;
const s = (v) => v | 0;

// the models: what each procedure must return
const M = {
  popcount: (x) => { let n = 0; for (let v = u(x); v; v >>>= 1) n += v & 1; return n; },
  gray: (x) => u(u(x) ^ (u(x) >>> 1)),
  clamp: (x, lo, hi) => (s(x) < s(lo) ? s(lo) : s(x) > s(hi) ? s(hi) : s(x)),
  gcd: (a, b) => { let x = u(a); let y = u(b); while (y) [x, y] = [y, x % y]; return x; },
  digitSum: (x) => [...String(u(x))].reduce((t, d) => t + Number(d), 0),
  collatz: (n) => { let k = 0; for (let v = n; v !== 1; k++) v = v % 2 ? 3 * v + 1 : v / 2; return k; },
  isqrt: (x) => { let r = Math.floor(Math.sqrt(u(x))); while (r * r > u(x)) r--; while ((r + 1) * (r + 1) <= u(x)) r++; return r; },
  palindrome: (t) => (t === [...t].reverse().join('') ? 1 : 0),
  horner: (c, x) => c.reduce((acc, k) => s(Math.imul(acc, x) + k), 0),
  primes: (n) => { let c = 0; for (let k = 2; k < n; k++) { let p = true; for (let d = 2; d * d <= k; d++) if (k % d === 0) { p = false; break; } if (p) c++; } return c; },
  find: (a, key) => a.indexOf(key),
  // the NPU of the laboratory profile (NPU-4): RESULT[i] += sum_j W[i][j] x[j], INT8 operands, 32-bit wrap
  npu: (W, x) => W.map((row) => row.reduce((t, w, j) => s(t + w * x[j]), 0)),
  longestRun: (a) => { let best = 0; let run = 0; a.forEach((v, i) => { run = i && a[i - 1] === v ? run + 1 : 1; best = Math.max(best, run); }); return best; },
};
const bytesOf = (text) => [...Buffer.from(`${text}\0`, 'latin1')];

const pack = (row) => u(row.reduce((t, w, j) => t | ((w & 0xff) << (8 * j)), 0)); // W[i][j] in bits 8j+7..8j
const npuHead = (name, task, how, data) => `${head(name, task, how)}# Laboratory profile: the NPU at 0x5000_0000 (CTRL 0x00, STATUS 0x04, WEIGHT 0x10, ACT 0x20, RESULT 0x30).
        .equ NPU, 0x50000000
        .data
${data}        .text
main:   # your code
        halt
`;
const head = (name, task, how) => `# ${name} -- practice exercise (MAVILERA)\n# ${task}\n# ${how}\n`;
const proc = (label, comment, body = '        li   a0, 0              # replace with your code') => `        .text\n${label}:\n        # ${comment}\n${body}\n        ret\n`;

const EXERCISES = [
  {
    id: 'popcount', group: 'bits', title: 'Count the 1 bits',
    task: 'Write the procedure popcount: a0 holds a 32-bit word; return in a0 how many of its bits are 1. Keep the calling convention.',
    entry: 'popcount', starter: head('popcount', 'Return in a0 the number of 1 bits of a0.', 'Hint: test the lowest bit, then shift right; srli does not copy the sign.') + proc('popcount', 'a0 = the word'),
    tests: [0, 1, 0xf0f0, 0x80000001, 0xffffffff, 0x12345678].map((x) => ({ name: `popcount(0x${u(x).toString(16)})`, registers: { a0: s(x) }, expect: { registers: { a0: M.popcount(x) }, abi: true } })),
  },
  {
    id: 'gray', group: 'bits', title: 'Binary to Gray code',
    task: 'Write the procedure gray: return in a0 the Gray code of the unsigned number in a0, in which consecutive numbers differ in exactly one bit: gray(n) = n XOR (n shifted right by one).',
    entry: 'gray', starter: head('gray', 'Return in a0 the Gray code of a0.', 'Hint: two instructions are enough.') + proc('gray', 'a0 = n'),
    tests: [0, 1, 2, 3, 7, 8, 0x80000000, 0xffffffff].map((x) => ({ name: `gray(${u(x)})`, registers: { a0: s(x) }, expect: { registers: { a0: s(M.gray(x)) }, abi: true } })),
  },
  {
    id: 'clamp', group: 'branches', title: 'Clamp a value to a range',
    task: 'Write the procedure clamp: return in a0 the signed value a0 limited to the range from a1 (lowest) to a2 (highest): a1 if a0 is below it, a2 if above, a0 otherwise. You may assume a1 <= a2.',
    entry: 'clamp', starter: head('clamp', 'Return a0 limited to [a1, a2] (signed).', 'Hint: two signed comparisons; mind the order of the operands of blt and bge.') + proc('clamp', 'a0 = value, a1 = lowest, a2 = highest', '        # your code'),
    tests: [[5, 0, 10], [-3, 0, 10], [12, 0, 10], [-100, -50, -20], [-30, -50, -20], [7, 7, 7], [0x7fffffff, -1, 1]]
      .map(([x, lo, hi]) => ({ name: `clamp(${x}, ${lo}, ${hi})`, registers: { a0: x, a1: lo, a2: hi }, expect: { registers: { a0: M.clamp(x, lo, hi) }, abi: true } })),
  },
  {
    id: 'gcd', group: 'loops', title: 'Greatest common divisor',
    task: 'Write the procedure gcd: return in a0 the greatest common divisor of the unsigned numbers in a0 and a1, by Euclid\'s algorithm (gcd(a, 0) = a). Use remu, or repeated subtraction.',
    entry: 'gcd', starter: head('gcd', 'Return gcd(a0, a1).', 'Hint: while b is not 0: (a, b) = (b, a mod b).') + proc('gcd', 'a0 = a, a1 = b', '        # your code'),
    tests: [[48, 18], [17, 5], [0, 9], [21, 0], [1071, 462], [65536, 1024]].map(([a, b]) => ({ name: `gcd(${a}, ${b})`, registers: { a0: a, a1: b }, expect: { registers: { a0: M.gcd(a, b) }, abi: true } })),
  },
  {
    id: 'digit-sum', group: 'loops', title: 'Sum of decimal digits',
    task: 'Write the procedure digitsum: return in a0 the sum of the decimal digits of the unsigned number in a0 (digitsum(1234) = 10).',
    entry: 'digitsum', starter: head('digitsum', 'Return the sum of the decimal digits of a0.', 'Hint: remu by 10 gives the last digit, divu by 10 removes it.') + proc('digitsum', 'a0 = n (unsigned)'),
    tests: [0, 9, 10, 1234, 99999, 4294967295].map((x) => ({ name: `digitsum(${x})`, registers: { a0: s(x) }, expect: { registers: { a0: M.digitSum(x) }, abi: true } })),
  },
  {
    id: 'collatz', group: 'loops', title: 'Collatz steps',
    task: 'Write the procedure collatz: a0 holds n >= 1. Count the steps to reach 1, where a step halves an even number and turns an odd one into 3n + 1. Return the count in a0 (collatz(6) = 8).',
    entry: 'collatz', starter: head('collatz', 'Return the number of Collatz steps from a0 to 1.', 'Hint: andi tests the lowest bit; 3n + 1 needs no multiply.') + proc('collatz', 'a0 = n >= 1'),
    tests: [1, 2, 6, 7, 27, 97].map((n) => ({ name: `collatz(${n})`, registers: { a0: n }, expect: { registers: { a0: M.collatz(n) }, abi: true }, limit: 200000 })),
  },
  {
    id: 'isqrt', group: 'loops', title: 'Integer square root',
    task: 'Write the procedure isqrt: return in a0 the largest r with r * r <= a0, for the unsigned number in a0 (isqrt(15) = 3). Any method is accepted, if it finishes within the test\'s limit of 100,000 instructions.',
    entry: 'isqrt', starter: head('isqrt', 'Return floor(sqrt(a0)) for unsigned a0.', 'Hint: a binary search over r, or the bit-by-bit method; beware r * r overflowing.') + proc('isqrt', 'a0 = x (unsigned)'),
    tests: [0, 1, 15, 16, 1000000, 2147483647, 4294967295].map((x) => ({ name: `isqrt(${x})`, registers: { a0: s(x) }, expect: { registers: { a0: M.isqrt(x) }, abi: true }, limit: 100000 })),
  },
  {
    id: 'reverse', group: 'memory', title: 'Reverse an array in place',
    task: 'Write the procedure reverse: a0 holds the address of an array of a1 words; reverse their order in place (the first word swaps with the last, and so on). Return nothing.',
    entry: 'reverse', starter: `${head('reverse', 'Reverse the a1 words at a0 in place.', 'Hint: two pointers, one from each end, until they meet.')}        .data\nbuf:    .space 64               # the tests put their arrays here\n${proc('reverse', 'a0 = address of the first word, a1 = number of words', '        # your code')}`,
    tests: [[1, 2, 3, 4], [5, 6, 7], [42], [], [9, -1, 9, -1, 0, 3]].map((a) => ({
      name: `reverse [${a.join(', ')}]`, registers: { a0: 'buf', a1: a.length },
      memory: a.length ? [{ at: 'buf', words: a }] : [],
      expect: a.length ? { memory: [{ at: 'buf', words: [...a].reverse() }], abi: true } : { abi: true },
    })),
  },
  {
    id: 'palindrome', group: 'memory', title: 'Is it a palindrome?',
    task: 'Write the procedure palindrome: a0 holds the address of a string of bytes ending in a zero byte. Return 1 in a0 if it reads the same backwards (the empty string does), 0 if not.',
    entry: 'palindrome', starter: `${head('palindrome', 'Return 1 if the zero-terminated string at a0 is a palindrome, else 0.', 'Hint: find the end first (lbu until 0), then compare from both ends.')}        .data\ntext:   .space 64               # the tests put their strings here\n${proc('palindrome', 'a0 = address of the string')}`,
    tests: ['level', 'risc', '', 'abba', 'a', 'abca', 'step on no pets'].map((t) => ({
      name: `palindrome("${t}")`, registers: { a0: 'text' }, memory: [{ at: 'text', bytes: bytesOf(t) }],
      expect: { registers: { a0: M.palindrome(t) }, abi: true },
    })),
  },
  {
    id: 'horner', group: 'memory', title: 'Evaluate a polynomial',
    task: 'Write the procedure poly: a0 holds the address of a1 signed word coefficients, the highest power first; return in a0 the value of the polynomial at x = a2, by Horner\'s rule: start from 0, then for each coefficient multiply by x and add it.',
    entry: 'poly', starter: `${head('poly', 'Return the polynomial with the a1 coefficients at a0 evaluated at a2.', 'Hint: one mul and one add per coefficient.')}        .data\ncoef:   .space 64               # the tests put their coefficients here\n${proc('poly', 'a0 = address of the coefficients, a1 = how many, a2 = x')}`,
    tests: [[[2, -3, 1], 4], [[5], 9], [[1, 0, 0, 0], 3], [[], 7], [[-1, 2, -1], -2], [[3, 0, -7, 1], 10]].map(([c, x]) => ({
      name: `poly([${c.join(', ')}], ${x})`, registers: { a0: 'coef', a1: c.length, a2: x },
      memory: c.length ? [{ at: 'coef', words: c }] : [], expect: { registers: { a0: M.horner(c, x) }, abi: true },
    })),
  },
  {
    id: 'print-number', group: 'output', title: 'Print a number in decimal',
    task: 'Write a program that prints the unsigned number stored at the label value in decimal, followed by a newline, with the write system call (a7 = 64), and then exits with code 0 (a7 = 93). The tests change the number at value.',
    entry: null, starter: `${head('print-number', 'Print the unsigned word at value in decimal, then a newline; exit with 0.', 'Hint: build the digits from the right into a buffer with remu/divu, then write them in one call.')}        .data\nvalue:  .word 1234\nbuf:    .space 12\n        .text\nmain:   # your code\n        li   a0, 0\n        li   a7, 93\n        ecall\n`,
    tests: [1234, 0, 7, 1000000, 4294967295].map((v) => ({ name: `value = ${v}`, memory: [{ at: 'value', words: [s(v)] }], expect: { output: `${v}\n`, exit: 0 } })),
  },
  {
    id: 'c-primes', group: 'c', title: 'C: count the primes below n', lang: 'c',
    task: 'Complete the C function count_primes(n): return how many prime numbers are smaller than n (count_primes(10) = 4: 2, 3, 5 and 7).',
    entry: 'count_primes', starter: '/* count_primes -- practice exercise (MAVILERA).\n * Return how many primes are smaller than n.\n * Hint: test each k from 2 with divisors d while d * d <= k. */\nint count_primes(int n)\n{\n    return 0;   /* your code */\n}\n\nint main(void)\n{\n    return count_primes(10);\n}\n',
    tests: [2, 3, 10, 30, 100].map((n) => ({ name: `count_primes(${n})`, registers: { a0: n }, expect: { registers: { a0: M.primes(n) }, abi: true }, limit: 300000 })),
  },
  {
    id: 'c-find', group: 'c', title: 'C: binary search', lang: 'c',
    task: 'Complete the C function find(a, n, key): the n ints at a are sorted in ascending order; return the index of key, or -1 if it is not there, looking at no more than about log2(n) + 1 elements (binary search).',
    entry: 'find', starter: '/* find -- practice exercise (MAVILERA).\n * The n ints at a are sorted; return the index of key, or -1.\n * Hint: keep a range [lo, hi) and halve it. */\nint table[16];\n\nint find(const int *a, int n, int key)\n{\n    return -1;  /* your code */\n}\n\nint main(void)\n{\n    return find(table, 0, 5);\n}\n',
    tests: [[[1, 3, 5, 7, 9, 11], 7], [[1, 3, 5, 7, 9, 11], 1], [[1, 3, 5, 7, 9, 11], 11], [[1, 3, 5, 7, 9, 11], 4], [[-8, -2, 0, 4], -8], [[], 5], [[2], 2]].map(([a, key]) => ({
      name: `find([${a.join(', ')}], ${key})`, registers: { a0: 'table', a1: a.length, a2: key },
      memory: a.length ? [{ at: 'table', words: a }] : [], expect: { registers: { a0: M.find(a, key) }, abi: true },
    })),
  },
  {
    id: 'c-longest-run', group: 'c', title: 'C: longest run of equal values', lang: 'c',
    task: 'Complete the C function longest_run(a, n): return the length of the longest stretch of consecutive equal values among the n ints at a (0 for an empty array).',
    entry: 'longest_run', starter: '/* longest_run -- practice exercise (MAVILERA).\n * Return the length of the longest run of equal neighbours in a[0..n-1]. */\nint data[16];\n\nint longest_run(const int *a, int n)\n{\n    return 0;   /* your code */\n}\n\nint main(void)\n{\n    return longest_run(data, 0);\n}\n',
    tests: [[1, 1, 2, 2, 2, 3], [5], [], [4, 4, 4, 4], [1, 2, 3], [7, 7, 1, 7, 7, 7, 2, 2]].map((a) => ({
      name: `longest_run([${a.join(', ')}])`, registers: { a0: 'data', a1: a.length },
      memory: a.length ? [{ at: 'data', words: a }] : [], expect: { registers: { a0: M.longestRun(a) }, abi: true },
    })),
  },
  {
    id: 'npu-accumulate', group: 'npu', title: 'NPU: add two products in the accumulators', profile: 'ch11',
    task: 'For the laboratory profile (the NPU at 0x5000_0000; register map in the Help). The four rows of a 4 × 4 INT8 matrix W are at w, one word per row with W[i][j] in bits 8j+7 to 8j; two vectors a and b are at xa and xb, one INT8 value per word. Using the NPU, compute y = W a + W b: load W into the NPU once, run the array on a and then on b, and let the accumulators add the two products (clear them only before the first run). Store RESULT[0] to RESULT[3] as four words at y, then halt.',
    starter: npuHead('npu-accumulate', 'y = W a + W b on the NPU, with one clear and two starts.', 'Hint: CTRL bit 0 starts, bit 1 clears; writes while the NPU is busy are ignored, so wait for STATUS bit 1 (done).',
      ['w:      .word 0x04030201, 0x08070605, 0xfcfdfeff, 0x00000000', 'xa:     .word 1, 2, 3, 4', 'xb:     .word -1, 0, 1, 2', 'y:      .space 16', ''].join('\n')),
    tests: [
      [[[1, 2, 3, 4], [5, 6, 7, 8], [-1, -2, -3, -4], [0, 0, 0, 0]], [1, 2, 3, 4], [-1, 0, 1, 2]],
      [[[127, -128, 0, 1], [-1, -1, -1, -1], [2, 0, 0, 0], [0, 0, 0, 127]], [127, 127, 5, -128], [-128, 1, 2, 3]],
      [[[10, 20, 30, 40], [0, 1, 0, 1], [-7, 3, -7, 3], [100, -100, 50, -50]], [0, 0, 0, 0], [9, -9, 9, -9]],
      [[[-128, -128, -128, -128], [127, 127, 127, 127], [1, -1, 1, -1], [3, 5, 7, 11]], [-128, -128, -128, -128], [-128, -128, -128, -128]],
    ].map(([W, a, b], k) => ({
      name: `case ${k + 1}`,
      memory: [{ at: 'w', words: W.map(pack) }, { at: 'xa', words: a.map(u) }, { at: 'xb', words: b.map(u) }],
      expect: { memory: [{ at: 'y', words: M.npu(W, a).map((v, i) => u(s(v + M.npu(W, b)[i]))) }] },
      limit: 2000,
    })),
  },
  {
    id: 'npu-two-layers', group: 'npu', title: 'NPU: two layers in a row', profile: 'ch11',
    task: 'For the laboratory profile (the NPU at 0x5000_0000; register map in the Help). Two 4 × 4 INT8 matrices W1 and W2 are at w1 and w2 (one word per row, W[i][j] in bits 8j+7 to 8j) and a vector x at x (one INT8 value per word). Using the NPU for both products, compute h = W1 x and store it as four words at h, then compute y = W2 h and store it as four words at y; then halt. The tests choose values for which every h[i] fits in INT8.',
    starter: npuHead('npu-two-layers', 'h = W1 x, then y = W2 h, both on the NPU.', 'Hint: ACT[j] takes bits 7..0 of the word written, so a result that fits in INT8 can be written back as it is; load W2 only when the first run is done.',
      ['w1:     .word 0x00000001, 0x00000100, 0x00010000, 0x01000000', 'w2:     .word 0x01010101, 0x00000000, 0x00000000, 0x00000000',
        'x:      .word 1, 2, 3, 4', 'h:      .space 16', 'y:      .space 16', ''].join('\n')),
    tests: [
      [[[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], [[1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], [1, 2, 3, 4]],
      [[[2, -1, 0, 1], [1, 1, 1, 1], [-3, 0, 2, 0], [0, 4, 0, -4]], [[1, 2, 3, 4], [-1, 0, 1, 0], [5, -5, 5, -5], [127, 0, 0, -128]], [3, -2, 5, 1]],
      [[[10, 0, 0, 0], [0, -10, 0, 0], [1, 1, 1, 1], [-1, -1, -1, -1]], [[3, 3, 3, 3], [1, -1, 1, -1], [0, 0, 0, 1], [-7, 7, -7, 7]], [12, 12, -20, 7]],
    ].map(([W1, W2, x], k) => {
      const h = M.npu(W1, x);
      if (h.some((v) => v < -128 || v > 127)) throw new Error(`npu-two-layers case ${k + 1}: h does not fit in INT8`);
      return {
        name: `case ${k + 1}`,
        memory: [{ at: 'w1', words: W1.map(pack) }, { at: 'w2', words: W2.map(pack) }, { at: 'x', words: x.map(u) }],
        expect: { memory: [{ at: 'h', words: h.map(u) }, { at: 'y', words: M.npu(W2, h).map(u) }] },
        limit: 2000,
      };
    }),
  },
];

const GROUPS = { bits: 'Bits and shifts', branches: 'Comparisons and branches', loops: 'Loops and arithmetic', memory: 'Arrays and strings', output: 'Output', c: 'C', npu: 'NPU (laboratory profile)' };

let differ = 0;
const put = (name, obj) => {
  const path = join(DIR, name);
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  if (check) {
    let old = '';
    try { old = readFileSync(path, 'utf8'); } catch { /* missing */ }
    if (old !== text) { console.log(`DIFFERS content/exercises/${name}`); differ++; }
  } else writeFileSync(path, text);
};
if (!check) mkdirSync(DIR, { recursive: true });
for (const e of EXERCISES) {
  put(`${e.id}.json`, { _copyright: COPY, format: 'risc-vista-exercise', version: 1, title: e.title, task: e.task, lang: e.lang ?? 'asm', ...(e.profile ? { profile: e.profile } : {}),
    starter: e.starter, ...(e.entry ? { entry: e.entry } : {}), tests: e.tests });
}
put('index.json', { _copyright: COPY, groups: GROUPS, exercises: EXERCISES.map((e) => ({ id: e.id, file: `${e.id}.json`, group: e.group, title: e.title, lang: e.lang ?? 'asm' })) });
if (!check) console.log(`written ${EXERCISES.length} exercises and index.json in content/exercises/`);
process.exitCode = differ ? 1 : 0;
