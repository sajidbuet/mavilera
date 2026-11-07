// tools/i8086/make-exercises.mjs -- writes the 8086 practice exercises (WS-F-148; 8086-B8, decision B8-Q9 of the author,
// 2026-11-07) to content/i8086/exercises/: the task, a starter that assembles and fails, and tests whose expected values
// are worked out here in JavaScript (not by running a solution). No solution program is written to content/; the model
// solutions the tests run live in test/fixtures/exercise-solutions/i8086/ and are not published.
//
//   node tools/i8086/make-exercises.mjs
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'content', 'i8086', 'exercises');
const COPYRIGHT = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: content (Apache-2.0). '
  + 'A practice exercise written for MAVILERA (spec WS-F-148, roadmap 8086-B8), not taken from a textbook; produced by tools/i8086/make-exercises.mjs.';
const w16 = (v) => v & 0xffff;
const bytes = (s) => [...s].map((c) => c.charCodeAt(0));
const hex = (v, n) => { const s = v.toString(16).toUpperCase().padStart(n, '0'); return `${/^[A-F]/.test(s) ? '0' : ''}${s}H`; };

const EXERCISES = [
  {
    id: 'largest', group: 'data', title: 'The largest signed word of a table',
    task: 'count (a word, 1 to 16) words of table are signed numbers. Store the largest of them at big, then HLT. '
      + 'Keep the labels count, table and big and their DW lines: the tests write count and table and read big.',
    starter: `; largest -- practice exercise (MAVILERA, 8086)
; Store at big the largest signed word of table (count words).
; Hint: LODSW, CMP, a signed jump (JLE or JGE), LOOP.
        HLT                     ; replace with your code

count   DW   0                  ; the tests write the count here (1 to 16)
table   DW   16 DUP (0)         ; ... and the words here
big     DW   0                  ; your result
`,
    cases: [[5, -3, 12, 7, 0], [-5, -2, -9], [32767, -32768], [1], [-32768], [3, 3, 3], [-1, 0, -1, 2, -7, 2]],
    test: (xs) => ({ name: `[${xs.join(', ')}]`, memory: [{ at: 'count', words: [xs.length] }, { at: 'table', words: xs.map(w16) }],
      expect: { memory: [{ at: 'big', words: [w16(Math.max(...xs))] }] } }),
  },
  {
    id: 'count-char', group: 'strings', title: 'Count a character with REPNE SCASB',
    task: 'text holds len bytes (0 to 32). Store at found, as a word, how many of them equal the byte at key, then HLT. '
      + 'REPNE SCASB compares AL with the bytes at ES:DI and stops after the first that matches (ZF = 1) or when CX reaches 0; '
      + 'search again from there. ES = DS in this program (one segment). Keep the labels key, len, text and found.',
    starter: `; count-char -- practice exercise (MAVILERA, 8086)
; Store at found how many of the len bytes of text equal key.
; Hint: AL <- key, DI <- the offset of text, CX <- len; REPNE SCASB; JNE when it found none; JCXZ.
        HLT                     ; replace with your code

key     DB   0                  ; the tests write the character here
len     DW   0                  ; ... the length of the text (0 to 32)
text    DB   32 DUP (0)         ; ... and the text
found   DW   0                  ; your result
`,
    cases: [['hello, world', 'o'], ['', 'a'], ['aaaa', 'a'], ['Mississippi', 's'], ['abc', 'z'], ['a', 'a'], ['8086 or 8088', '8']],
    test: ([s, k]) => ({ name: `"${s}" and '${k}'`, memory: [{ at: 'key', bytes: bytes(k) }, { at: 'len', words: [s.length] }, ...(s ? [{ at: 'text', bytes: bytes(s) }] : [])],
      expect: { memory: [{ at: 'found', words: [[...s].filter((c) => c === k).length] }] } }),
  },
  {
    id: 'print-bcd', group: 'data', title: 'Print a packed BCD byte',
    task: 'The byte at value holds two decimal digits in packed BCD (00H to 99H: the high four bits are the tens). '
      + 'Print them on the console as two characters, tens first, with OUT 0E9H, AL, then HLT. Keep the label value and its DB line.',
    starter: `; print-bcd -- practice exercise (MAVILERA, 8086)
; Print the two BCD digits of value on the console (OUT 0E9H, AL).
; Hint: SHR AL, CL with CL = 4 for the tens; AND AL, 0FH for the units; ADD AL, '0'.
        HLT                     ; replace with your code

value   DB   0                  ; the tests write the packed BCD byte here
`,
    cases: [0x42, 0x07, 0x99, 0x00, 0x50, 0x86],
    test: (v) => ({ name: hex(v, 2), memory: [{ at: 'value', bytes: [v] }], expect: { output: `${v >> 4}${v & 15}` } }),
  },
  {
    id: 'keep-registers', group: 'stack', title: 'A subroutine that keeps the registers',
    task: 'Write sum3: AX <- a + b + c, the words at a, b and c (the sum modulo 10000H). It needs a pointer and a scratch '
      + 'register: use SI and DI, but leave every register except AX as the caller had it (save with PUSH, restore with POP '
      + 'in the reverse order), and return with RET. The main program is given; keep it and the DW lines.',
    starter: `; keep-registers -- practice exercise (MAVILERA, 8086)
; Write sum3: AX <- a + b + c; every other register as it was.
; Hint: PUSH SI and PUSH DI first, POP DI and POP SI before RET.
        MOV  BX, 1111H          ; values the subroutine must keep
        MOV  CX, 2222H
        MOV  DX, 3333H
        MOV  SI, 4444H
        MOV  DI, 5555H
        MOV  BP, 6666H
        CALL sum3
        MOV  total, AX
        HLT

sum3:   RET                     ; replace with your code

a       DW   0                  ; the tests write a, b and c
b       DW   0
c       DW   0
total   DW   0
`,
    cases: [[1, 2, 3], [0x1000, 0x2000, 0x3000], [0xffff, 1, 5], [0x7fff, 1, 0], [12345, 23456, 34567]],
    test: ([a, b, c]) => ({ name: `${a} + ${b} + ${c}`, memory: [{ at: 'a', words: [a] }, { at: 'b', words: [b] }, { at: 'c', words: [c] }],
      expect: { memory: [{ at: 'total', words: [w16(a + b + c)] }],
        registers: { BX: 0x1111, CX: 0x2222, DX: 0x3333, SI: 0x4444, DI: 0x5555, BP: 0x6666, SP: 0xfffe } } }),
  },
];

mkdirSync(DIR, { recursive: true });
for (const x of EXERCISES) {
  const file = { _copyright: COPYRIGHT, format: 'risc-vista-exercise', version: 1, arch: 'i8086', title: x.title, task: x.task, lang: 'asm',
    starter: x.starter, tests: x.cases.map(x.test) };
  writeFileSync(join(DIR, `${x.id}.json`), `${JSON.stringify(file, null, 1)}\n`);
}
const index = { _copyright: COPYRIGHT,
  groups: { data: 'Data and the flags', strings: 'Strings', stack: 'Subroutines and the stack' },
  exercises: EXERCISES.map((x) => ({ id: x.id, file: `${x.id}.json`, group: x.group, title: x.title, lang: 'asm' })) };
writeFileSync(join(DIR, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`${EXERCISES.length} exercises written to ${DIR}`);
