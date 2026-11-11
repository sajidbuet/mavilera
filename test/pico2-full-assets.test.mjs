// pico2-full-assets.test.mjs -- the Pico Full download (src/arch/pico2/full/assets.js; pico2 P1-F2, research D33) against
// a local server in Node (no Cache API here, as in a private window): current.json -> manifest -> files with absolute
// URLs; a download reports its progress up to the size; bytes that do not match the manifest's SHA-256 are refused;
// a gzip-encoded file is decoded before the check; a WebAssembly file comes back compiled; a missing server is a
// network error.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { probe, getAsset, AssetError } from '../src/arch/pico2/full/assets.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
// the smallest valid WebAssembly module: magic and version
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const PACK = Buffer.alloc(300000, 7);
const files = {
  '/pf/current.json': JSON.stringify({ version: 'v1', manifest: 'v1/manifest.json' }),
  '/pf/v1/manifest.json': JSON.stringify({ version: 'v1', compiler: { file: 'c.wasm', bytes: WASM.length, sha256: sha(WASM), encoding: null },
    pack: { file: 'p.bin', bytes: PACK.length, sha256: sha(PACK), encoding: null }, total: WASM.length + PACK.length }),
  '/pf/v1/c.wasm': WASM,
  '/pf/v1/p.bin': PACK,
  '/pf/v1/p.bin.gz': gzipSync(PACK),
  '/pf/v1/bad.bin': Buffer.concat([PACK.subarray(1), Buffer.from([8])]),
};
const server = createServer((req, res) => {
  const body = files[req.url];
  if (!body) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Length': Buffer.byteLength(body) }).end(body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/pf/`;
test.after(() => server.close());

test('probe: the manifest of the current version, with absolute URLs; nothing cached without Cache API', async () => {
  const m = await probe(base);
  assert.equal(m.version, 'v1');
  assert.equal(m.compiler.url, `${base}v1/c.wasm`);
  assert.equal(m.pack.url, `${base}v1/p.bin`);
  assert.equal(m.toDownload, WASM.length + PACK.length);
  assert.equal(m.cacheAvailable, false);
});

test('download: progress rises to the size and ends done; the bytes are those of the file', async () => {
  const m = await probe(base);
  const ev = [];
  const bytes = await getAsset(m.pack, { onProgress: (e) => ev.push(e) });
  assert.deepEqual(Buffer.from(bytes), PACK);
  assert.ok(ev.length >= 2);
  assert.ok(ev.every((e, i) => !i || e.loaded >= ev[i - 1].loaded));
  assert.deepEqual(ev[ev.length - 1], { loaded: PACK.length, total: PACK.length, done: true });
});

test('download: a WebAssembly file is compiled while it arrives', async () => {
  const m = await probe(base);
  const mod = await getAsset(m.compiler, { asModule: true });
  assert.ok(mod instanceof WebAssembly.Module);
});

test('integrity: a file whose SHA-256 differs from the manifest is refused', async () => {
  const m = await probe(base);
  await assert.rejects(getAsset({ ...m.pack, file: 'bad.bin', url: `${base}v1/bad.bin` }), (e) => e instanceof AssetError && e.code === 'integrity');
});

test('gzip-encoded files are decoded, then checked against the decoded size and hash', async () => {
  const m = await probe(base);
  const bytes = await getAsset({ ...m.pack, file: 'p.bin.gz', url: `${base}v1/p.bin.gz`, encoding: 'gzip' });
  assert.deepEqual(Buffer.from(bytes), PACK);
});

test('a server that does not answer is a network error', async () => {
  await assert.rejects(probe('http://127.0.0.1:9/pf/'), (e) => e instanceof AssetError && e.code === 'network');
});
