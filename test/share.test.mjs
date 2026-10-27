// share.test.mjs -- the share link and settings file (WS-F-122, WS-F-144,
// WS-N-013): a state survives the link (compressed and plain) and the file
// unchanged; the link is in base64url for the fragment and carries its
// format version; another version, a damaged link and unknown values are
// refused with a reason; a long program compresses below the link limit.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeFragment, decodeFragment, isShareFragment, settingsFile, readSettingsFile, normalise, ShareError, LINK_LIMIT } from '../src/core/share.js';

const STATE = {
  view: 'pipe', profile: 'ch08', subset: null, lang: 'asm', name: 'loop.s',
  source: 'loop:   addi x1, x1, -1   # ünïcode ✓\n        bne  x1, x0, loop\n        jal  x0, 0\n',
  pipe: { hazard: 'stall', predictor: '2bit', entries: 16, resolution: 'ex' },
  cc: { mode: 'register', march: 'rv32i' },
};

test('WS-F-122/144: a state goes through a link unchanged, compressed or not', async () => {
  for (const compress of [true, false]) {
    const f = await encodeFragment(STATE, { compress });
    assert.match(f, compress ? /^rv1z\.[A-Za-z0-9_-]+$/ : /^rv1\.[A-Za-z0-9_-]+$/);
    assert.ok(isShareFragment(`#${f}`));
    assert.deepEqual(await decodeFragment(`#${f}`), normalise(STATE));
  }
  assert.equal(isShareFragment('#section-2'), false);
});

test('WS-F-144: the settings file carries format and version, and reads back', () => {
  const text = settingsFile(STATE);
  const obj = JSON.parse(text);
  assert.equal(obj.format, 'risc-vista-settings');
  assert.equal(obj.version, 1);
  assert.deepEqual(readSettingsFile(text), normalise(STATE));
});

test('WS-F-144: another version or format is refused with a message', async () => {
  await assert.rejects(decodeFragment('#rv2z.AAAA'), (e) => e instanceof ShareError && e.code === 'version' && e.data.version === 2);
  await assert.rejects(decodeFragment('#rv0.AAAA'), (e) => e.code === 'version');
  await assert.rejects(decodeFragment('#rv1z.@@@'), (e) => e.code === 'corrupt');
  await assert.rejects(decodeFragment('#rv1z.AAAA'), (e) => e.code === 'corrupt');
  assert.throws(() => readSettingsFile(JSON.stringify({ format: 'risc-vista-settings', version: 7, source: '' })), (e) => e.code === 'version');
  assert.throws(() => readSettingsFile('{"format": "other"}'), (e) => e.code === 'format');
  assert.throws(() => readSettingsFile('not json'), (e) => e.code === 'corrupt');
  assert.throws(() => normalise({ ...STATE, view: 'cache' }), (e) => e.code === 'field' && e.data.field === 'view');
  assert.throws(() => normalise({ ...STATE, pipe: { entries: 3 } }), (e) => e.data.field === 'pipe.entries');
  assert.throws(() => normalise({ view: 'isa' }), (e) => e.data.field === 'source');
});

test('WS-N-013: a long program fits a link once compressed; unknown keys are dropped', async () => {
  const body = Array.from({ length: 300 }, (_, i) => `        addi  t${i % 7}, t${(i + 1) % 7}, ${i}   # step ${i}`).join('\n');
  const f = await encodeFragment({ source: body });
  assert.ok(f.length < LINK_LIMIT, `${f.length}`);
  const plain = await encodeFragment({ source: body }, { compress: false });
  assert.ok(plain.length > f.length * 3);
  const back = await decodeFragment(f);
  assert.equal(back.source, body);
  assert.equal(back.view, 'isa');
  assert.equal('secret' in normalise({ source: '', secret: 1 }), false);
});
