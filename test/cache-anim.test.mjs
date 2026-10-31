// cache-anim.test.mjs -- phase 7 of the memory hierarchy: the stages of the cache-access animation
// (address split, hit, miss, fill, eviction, write-back, write-through) follow the access record of the
// Cache engine, and every stage has its text and its colour class in strings.js.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Memory } from '../src/core/memory.js';
import { Cache, RamLevel } from '../src/mem/cache.js';
import { accessStages } from '../src/ui/cache-anim-model.js';
import { STRINGS } from '../src/ui/strings.js';

const make = (cfg) => new Cache(cfg, new RamLevel(new Memory()), 'D');
const ids = (c) => accessStages(c.last, c).map((s) => s.id);
const A = STRINGS.mem.cv.anim;

test('no access: no stages', () => assert.deepEqual(accessStages(null, make({ size: 64, block: 16, ways: 1 })), []));

test('a read miss on an empty line: split, lookup, miss, fill, word', () => {
  const c = make({ size: 64, block: 16, ways: 1 });
  c.access('read', 0x24, 4);
  assert.deepEqual(ids(c), ['split', 'lookup', 'miss', 'fill', 'word']);
  const [split, , miss, fill, word] = accessStages(c.last, c);
  assert.deepEqual([split.tagBits, split.indexBits, split.offsetBits], [26, 2, 4]);
  assert.deepEqual([split.set, split.offset, split.tag], [2, 4, 0]);
  assert.equal(miss.kind, 'compulsory');
  assert.deepEqual([fill.block, fill.set, fill.way], [0x20, 2, 0]);
  assert.deepEqual([word.word, word.op], [1, 'read']);
});

test('a hit: split, lookup, hit, word; no fill', () => {
  const c = make({ size: 64, block: 16, ways: 2 });
  c.access('read', 0x10, 4);
  c.access('read', 0x14, 4);
  assert.deepEqual(ids(c), ['split', 'lookup', 'hit', 'word']);
});

test('replacing a clean line gives a victim stage, a dirty one also a write-back', () => {
  const c = make({ size: 64, block: 16, ways: 1, write: 'wb' });
  c.access('read', 0x00, 4);
  c.access('read', 0x40, 4); // same set, clean victim
  assert.deepEqual(ids(c), ['split', 'lookup', 'miss', 'victim', 'fill', 'word']);
  assert.equal(accessStages(c.last, c).find((s) => s.id === 'victim').dirty, false);
  c.access('write', 0x40, 4, 7); // hit: the line is dirty now
  c.access('read', 0x00, 4);
  assert.deepEqual(ids(c), ['split', 'lookup', 'miss', 'victim', 'writeback', 'fill', 'word']);
  assert.equal(accessStages(c.last, c).find((s) => s.id === 'writeback').block, 0x40);
});

test('no-write-allocate: the miss bypasses the cache and writes through; write-through hit adds a memory stage', () => {
  const nwa = make({ size: 64, block: 16, ways: 1, write: 'wt' });
  nwa.access('write', 0x08, 4, 1);
  assert.deepEqual(ids(nwa), ['split', 'lookup', 'miss', 'bypass', 'through']);
  nwa.access('read', 0x08, 4);
  nwa.access('write', 0x08, 4, 2);
  assert.deepEqual(ids(nwa), ['split', 'lookup', 'hit', 'word', 'through']);
});

test('every stage that can occur has a text and a colour class', () => {
  const all = ['split', 'lookup', 'hit', 'miss', 'victim', 'writeback', 'fill', 'bypass', 'word', 'through'];
  for (const id of all) {
    assert.equal(typeof A.stages[id], 'function', id);
    assert.ok(A.kindOf[id], id);
    assert.match(A.stages[id]({ addr: '0x0', tag: '0x0', set: 0, offset: 0, tagBits: 1, indexBits: 1, offsetBits: 1, ways: 1, way: 0, block: '0x0', kind: 'x', op: 'read', word: 0 }), /\S/);
  }
});

test('every stage has a place in the drawing: a box, and an arrow only for data moving between cache and memory', async () => {
  const { STAGE_PLACE } = await import('../src/ui/cache-anim-model.js');
  for (const id of Object.keys(A.stages)) assert.ok(['cpu', 'cache', 'mem'].includes(STAGE_PLACE[id]?.at), id);
  assert.equal(STAGE_PLACE.fill.flow, 'toCache');
  assert.equal(STAGE_PLACE.writeback.flow, 'toMem');
  assert.equal(STAGE_PLACE.hit.flow, null);
});
