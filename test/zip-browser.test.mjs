// zip-browser.test.mjs -- src/shell/zip.js, project export and import (pico2 P1-F1, Q7 of research decision D31): a
// round trip keeps names and texts; entries are deflated only when smaller; the output is deterministic; archives of
// tools/zip.mjs read back and ours read back through node:zlib; unsafe, nested, non-text, oversized and damaged
// archives are refused with a reason; one common top folder is removed.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zcrc32, inflateRawSync } from 'node:zlib';

import { writeZip, readZip, readZipComment, crc32, ZipError } from '../src/shell/zip.js';
import { zip as toolZip } from '../tools/zip.mjs';

const EXT = ['.s', '.c', '.h'];
const FILES = [
  { name: 'main.s', text: '# entry ✓ ünïcode\n' + '    addi a0, a0, 1\n'.repeat(200) },
  { name: 'tiny.s', text: 'ret\n' },
  { name: 'empty.h', text: '' },
];
const code = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof ZipError, `not a ZipError: ${e}`); return e.code; } return null; };
const te = new TextEncoder();

/** The entries of an archive through node:zlib (independent of zip.js). */
function nodeUnzip(buf) {
  const b = Buffer.from(buf);
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = b.readUInt16LE(end + 10);
  let p = b.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), cs = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28);
    const name = b.toString('utf8', p + 46, p + 46 + nl), loc = b.readUInt32LE(p + 42);
    const start = loc + 30 + b.readUInt16LE(loc + 26) + b.readUInt16LE(loc + 28);
    const data = method === 8 ? inflateRawSync(b.subarray(start, start + cs)) : b.subarray(start, start + cs);
    assert.equal(zcrc32(data) >>> 0, crc);
    out.push({ name, text: data.toString('utf8'), method });
    p += 46 + nl + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return out;
}

test('crc32 equals node:zlib', () => {
  for (const s of ['', 'a', 'The quick brown fox', 'ünïcode ✓']) assert.equal(crc32(te.encode(s)), zcrc32(Buffer.from(s)) >>> 0);
});

test('Q7: a round trip keeps names and texts; big text is deflated, tiny text stored; the output is deterministic', async () => {
  const z = await writeZip(FILES);
  assert.deepEqual(await readZip(z, { extensions: EXT }), FILES);
  const viaNode = nodeUnzip(z);
  assert.deepEqual(viaNode.map(({ name, text }) => ({ name, text })), FILES);
  assert.deepEqual(viaNode.map((e) => e.method), [8, 0, 0]);
  assert.deepEqual(await writeZip(FILES), z, 'same files, same archive');
});

test('archive comment (project name and entry, written by the session): kept, read back, files unaffected; non-ASCII refused', async () => {
  const comment = '{"mavilera":"project","v":1,"name":"Blink \\u09a7","entry":"tiny.s"}';
  const z = await writeZip(FILES, { comment });
  assert.equal(readZipComment(z), comment);
  const b = Buffer.from(z);
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(b.toString('latin1', end + 22, end + 22 + b.readUInt16LE(end + 20)), comment, 'in the end record (APPNOTE 4.3.16)');
  assert.deepEqual(await readZip(z, { extensions: EXT }), FILES);
  assert.deepEqual(nodeUnzip(z).map(({ name, text }) => ({ name, text })), FILES);
  assert.equal(readZipComment(await writeZip(FILES)), '');
  assert.equal(readZipComment(new Uint8Array(10)), '');
  assert.equal(await code(writeZip(FILES, { comment: 'ধাপ' })), 'format');
});

test('Q7: archives written by tools/zip.mjs read back', async () => {
  const z = toolZip(FILES.map((f) => ({ name: f.name, data: Buffer.from(f.text) })));
  assert.deepEqual(await readZip(new Uint8Array(z), { extensions: EXT }), FILES);
});

test('Q7: one common top folder is removed; folder entries are skipped; deeper folders are refused', async () => {
  const z = toolZip([{ name: 'blink/', data: Buffer.alloc(0) }, ...FILES.map((f) => ({ name: `blink/${f.name}`, data: Buffer.from(f.text) }))]);
  assert.deepEqual(await readZip(new Uint8Array(z), { extensions: EXT }), FILES);
  const deep = toolZip([{ name: 'p/src/a.s', data: Buffer.from('x') }, { name: 'p/b.s', data: Buffer.from('y') }]);
  assert.equal(await code(readZip(new Uint8Array(deep))), 'name');
  const two = toolZip([{ name: 'a/x.s', data: Buffer.from('x') }, { name: 'b/y.s', data: Buffer.from('y') }]);
  assert.equal(await code(readZip(new Uint8Array(two))), 'name', 'two top folders are not one project folder');
});

test('Q7: wrong extensions, non-UTF-8 text, too many files, too many bytes and damaged data are refused', async () => {
  assert.equal(await code(readZip(await writeZip([{ name: 'a.txt', text: 'x' }]), { extensions: EXT })), 'extension');
  const bin = toolZip([{ name: 'a.s', data: Buffer.from([0xff, 0xfe, 0x00, 0x80]) }]);
  assert.equal(await code(readZip(new Uint8Array(bin))), 'text');
  const many = await writeZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.s`, text: '' })));
  assert.equal(await code(readZip(many, { maxFiles: 4 })), 'limit');
  assert.equal(await code(readZip(await writeZip([{ name: 'a.s', text: 'x'.repeat(100) }]), { maxBytes: 99 })), 'limit');
  const z = await writeZip([{ name: 'a.s', text: 'hello world, stored as it is' }]);
  const bad = z.slice(); bad[30 + 4] ^= 0xff; // a byte of the stored data
  assert.equal(await code(readZip(bad)), 'crc');
  assert.equal(await code(readZip(new Uint8Array([1, 2, 3, 4]))), 'format');
});

test('Q7: unsafe names in an archive are refused; the writer refuses names a project cannot hold', async () => {
  // tools/zip.mjs refuses these names itself, so the archive is patched: same length, unsafe content
  const z = await writeZip([{ name: 'ab.s', text: 'x' }]);
  const patch = (from, to) => { const b = Buffer.from(z); for (let i = 0; i + from.length <= b.length; i++) if (b.toString('latin1', i, i + from.length) === from) b.write(to, i, 'latin1'); return new Uint8Array(b); };
  assert.equal(await code(readZip(patch('ab.s', '/b.s'))), 'name');
  assert.equal(await code(readZip(patch('ab.s', 'a\\.s'))), 'name');
  assert.equal(await code(readZip(patch('ab.s', '../a'))), 'name');
  assert.equal(await code(writeZip([{ name: 'dir/a.s', text: '' }])), 'name');
});
