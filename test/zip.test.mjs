// zip.test.mjs -- tools/zip.mjs: an archive read back through its central directory gives the same names and bytes
// (deflated and stored entries, UTF-8 names), the same input gives the same archive, and unsafe names are refused.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { zip } from '../tools/zip.mjs';

/** The entries of an archive, from its end record and central directory. */
function unzip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(buf.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(crc32(data), crc, name);
    out.push({ name, data, method });
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

test('zip: read back, the same names and bytes; text deflated, random bytes stored; deterministic', () => {
  const entries = [
    { name: 'mavilera/index.html', data: Buffer.from('<!doctype html>'.repeat(200)) },
    { name: 'mavilera/noise.bin', data: randomBytes(4096) },
    { name: 'mavilera/empty.txt', data: Buffer.alloc(0) },
    { name: 'mavilera/Überblick ×.txt', data: Buffer.from('UTF-8 name') },
  ];
  const a = zip(entries);
  const back = unzip(a);
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  for (let i = 0; i < entries.length; i++) assert.ok(back[i].data.equals(entries[i].data), entries[i].name);
  assert.equal(back[0].method, 8);
  assert.equal(back[1].method, 0);
  assert.ok(zip(entries).equals(a));
});

test('zip: names that leave the archive folder are refused', () => {
  for (const name of ['/etc/x', 'a/../../x', 'a\\b']) assert.throws(() => zip([{ name, data: Buffer.alloc(1) }]), /unsafe/, name);
});
