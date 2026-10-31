// mem-viewmodel.test.mjs -- phase 5 of the memory hierarchy: the cache viewer's model (address split,
// line rows, victim marker) is computed from a Cache, never changes it and counts no access.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Memory } from '../src/core/memory.js';
import { Cache, RamLevel } from '../src/mem/cache.js';
import { addressFields, lineRows, rowWords, geometry } from '../src/ui/mem-viewmodel.js';

const make = (cfg) => { const mem = new Memory(); return { mem, c: new Cache(cfg, new RamLevel(mem), 'D') }; };

test('address split: 1 KiB direct-mapped, 16-byte blocks = tag 22, index 6, offset 4', () => {
  const { c } = make({ size: 1024, block: 16, ways: 1 });
  const f = addressFields(c, 0x12345678);
  assert.deepEqual([f.tagBits, f.indexBits, f.offsetBits], [22, 6, 4]);
  assert.equal(f.offset, 0x8);
  assert.equal(f.index, (0x12345678 >>> 4) & 63);
  assert.equal(f.tag, 0x12345678 >>> 10);
  assert.equal(f.blockAddr, 0x12345670);
  assert.equal(f.held, false);
});

test('rows follow the cache; reading counts nothing', () => {
  const { mem, c } = make({ size: 64, block: 16, ways: 2 });
  mem.write(0x20, 4, 0xdeadbeef);
  c.access('read', 0x20, 4);
  const before = JSON.stringify(c.stats);
  const rows = lineRows(c);
  assert.equal(rows.length, 4); // 2 sets x 2 ways
  const held = rows.filter((r) => r.valid);
  assert.equal(held.length, 1);
  assert.equal(held[0].blockAddr, 0x20);
  assert.equal(rowWords(held[0], 16)[0], 'deadbeef');
  assert.equal(addressFields(c, 0x24).held, true);
  assert.equal(addressFields(c, 0x24).way, held[0].way);
  assert.equal(JSON.stringify(c.stats), before);
});

test('victim marker: a free way first, then the head of the LRU order', () => {
  const { c } = make({ size: 32, block: 16, ways: 2, repl: 'lru' }); // one set
  assert.equal(lineRows(c).find((r) => r.next).way, 0);
  c.access('read', 0x00, 4);
  assert.equal(lineRows(c).find((r) => r.next).way, 1);
  c.access('read', 0x10, 4);
  c.access('read', 0x00, 4); // way 0 is now the most recent: the victim is way 1
  assert.equal(lineRows(c).find((r) => r.next).way, 1);
});

test('geometry text', () => {
  assert.equal(geometry(make({ size: 1024, block: 16, ways: 1 }).c).text, '1 KiB, 16-byte blocks, direct-mapped, 64 sets');
  assert.match(geometry(make({ size: 64, block: 16, ways: 4 }).c).text, /fully associative, 1 set$/);
});
