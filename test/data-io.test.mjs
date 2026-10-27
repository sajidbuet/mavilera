// data-io.test.mjs -- data import and export (WS-F-145): numbers parsed from
// CSV and text in every accepted form, with their range checked; an array's
// room ends at the next data label; a load that does not fit is refused; the
// loads survive assembling again and reach the run; a range saved as CSV
// reads back as the same values, and .bin is little-endian.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseNumbers, dataArrays, readRange, saveCsv, saveBin, DataError } from '../src/core/data-io.js';
import { Session, STOP } from '../src/core/session.js';
import { assemble } from '../src/asm/assembler.js';

const words = (bytes) => Array.from(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4));

const SRC = `
        .data
vals:   .space 16           # four words
count:  .word 4
        .text
_start: la   t0, vals
        la   t1, count
        lw   t1, 0(t1)
        li   a0, 0
loop:   beqz t1, done
        lw   t2, 0(t0)
        add  a0, a0, t2
        addi t0, t0, 4
        addi t1, t1, -1
        j    loop
done:   li   a7, 93
        ecall
`;

test('WS-F-145: numbers from CSV and text', () => {
  assert.deepEqual(words(parseNumbers('1, 2, 3\n-4')), [1, 2, 3, 0xfffffffc]);
  assert.deepEqual(words(parseNumbers('value\n0x10\n0b11\n+7\n')), [16, 3, 7]); // a heading, hex, binary
  assert.deepEqual(words(parseNumbers('address,value\n0x00010000,5\n0x00010004,-1\n')), [5, 0xffffffff]); // as saveCsv writes
  assert.deepEqual(Array.from(parseNumbers('1;2 3\t4', 1)), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(parseNumbers('-1 65535', 2)), [0xff, 0xff, 0xff, 0xff]);
  assert.throws(() => parseNumbers('1, x2'), DataError);
  assert.throws(() => parseNumbers('256', 1), /does not fit 8 bits/);
  assert.throws(() => parseNumbers('-129', 1), /does not fit/);
  assert.equal(parseNumbers('').length, 0);
});

test('WS-F-145: an array has room up to the next data label', () => {
  const p = assemble(SRC);
  assert.deepEqual(dataArrays(p).map((a) => [a.name, a.room]), [['vals', 16], ['count', 4]]);
});

test('WS-F-145: a load reaches the run, survives a new assembly, and must fit', () => {
  const s = new Session();
  s.files = [{ name: 'd.s', text: SRC }];
  s.assemble();
  s.loadData('vals', parseNumbers('10, 20, 30, -5'), 'v.csv');
  s.assemble();
  assert.deepEqual(s.loadReport.applied, [{ label: 'vals', address: 0x10000, n: 16 }]);
  let r;
  do r = s.run(); while (r === STOP.CHUNK);
  assert.equal(r, STOP.HALT);
  assert.equal(s.hart.exitCode, 55);
  assert.throws(() => s.loadData('vals', parseNumbers('1 2 3 4 5')), /room for 16/);
  assert.throws(() => s.loadData('nope', parseNumbers('1')), /no data label/);
  // a label that disappears drops its load with a reason
  s.files = [{ name: 'd.s', text: SRC.replace(/vals/g, 'other') }];
  s.assemble();
  assert.deepEqual(s.loadReport.dropped, [{ label: 'vals', why: 'missing' }]);
  s.clearData();
  s.assemble();
  assert.deepEqual(s.loadReport, { applied: [], dropped: [] });
});

test('WS-F-145: a range saved as CSV reads back; .bin is little-endian', () => {
  const s = new Session();
  s.files = [{ name: 'd.s', text: SRC }];
  s.assemble();
  s.loadData('vals', parseNumbers('1 -2 0x7fffffff 4'), 'v.csv');
  s.assemble();
  const vals = readRange(s.hart.mem, 0x10000, 4);
  const csv = saveCsv(vals, 0x10000);
  assert.match(csv, /^address,value\n0x00010000,1\n0x00010004,-2\n/);
  assert.deepEqual(words(parseNumbers(csv)), vals);
  assert.deepEqual(Array.from(saveBin([0x11223344])), [0x44, 0x33, 0x22, 0x11]);
  assert.match(saveCsv([0xffff], 0, 2), /0x00000000,-1/);
});
