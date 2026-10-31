// shell-format.test.mjs -- register values shown by width (W-D29 decision 2: ceil(width / 4) hexadecimal digits;
// RISC-V's 32-bit registers unchanged).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatValue } from '../src/ui/dom.js';

test('32-bit values are shown as before', () => {
  assert.equal(formatValue(-1, 'hex'), '0xffffffff');
  assert.equal(formatValue(-1, 'signed'), '-1');
  assert.equal(formatValue(-1, 'unsigned'), '4294967295');
  assert.equal(formatValue(5, 'binary'), '00000000 00000000 00000000 00000101');
  assert.equal(formatValue(-1, 'hex', 32), formatValue(-1, 'hex'));
});

test('narrower registers: ceil(width / 4) digits, signed and binary within the width', () => {
  assert.equal(formatValue(0xab, 'hex', 8), '0xab');
  assert.equal(formatValue(0x1ab, 'hex', 8), '0xab'); // bits above the width are not shown
  assert.equal(formatValue(0xf, 'hex', 4), '0xf');
  assert.equal(formatValue(0x3, 'hex', 9), '0x003');
  assert.equal(formatValue(0xff, 'signed', 8), '-1');
  assert.equal(formatValue(0x7f, 'signed', 8), '127');
  assert.equal(formatValue(0xff, 'unsigned', 8), '255');
  assert.equal(formatValue(5, 'binary', 8), '00000101');
  assert.equal(formatValue(5, 'binary', 12), '0000 00000101');
  assert.equal(formatValue(0xffff, 'signed', 16), '-1');
});
