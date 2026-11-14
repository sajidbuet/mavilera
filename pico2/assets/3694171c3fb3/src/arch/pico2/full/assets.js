// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const CACHE_NAME = 'mavilera-pico-full-v1';
export class AssetError extends Error {
 constructor(code, message) { super(message); this.code = code; }
}
async function openCache() {
 try { return typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME); } catch { return null; }
}
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
async function json(url, cache) {
 try {
 const res = await fetch(url, { cache: 'no-store' });
 if (!res.ok) throw new AssetError('network', `${url}: HTTP ${res.status}`);
 const text = await res.text();
 if (cache) await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json' } })).catch(() => {});
 return JSON.parse(text);
 } catch (e) {
 const hit = cache && await cache.match(url);
 if (hit) return hit.json();
 throw e instanceof AssetError ? e : new AssetError('network', `${url}: ${e.message}`);
 }
}
export async function probe(base) {
 const cache = await openCache();
 const current = await json(new URL('current.json', base).href, cache);
 const manifestUrl = new URL(current.manifest, base).href;
 const m = await json(manifestUrl, cache);
 if (!m.compiler?.file || !m.pack?.file) throw new AssetError('manifest', 'the Pico Full manifest is incomplete');
 if (m.licences) m.licencesUrl = new URL(m.licences, manifestUrl).href;
 for (const k of ['compiler', 'pack']) {
 m[k].url = new URL(m[k].file, manifestUrl).href;
 m[k].cached = Boolean(cache && await cache.match(m[k].url));
 }
 const transfer = (e) => e.transferBytes ?? e.bytes;
 m.transfer = transfer(m.compiler) + transfer(m.pack);
 m.toDownload = (m.compiler.cached ? 0 : transfer(m.compiler)) + (m.pack.cached ? 0 : transfer(m.pack));
 m.cacheAvailable = Boolean(cache);
 return m;
}
function counted(stream, total, onProgress) {
 let loaded = 0, last = -Infinity;
 const report = (done) => {
 const now = performance.now();
 if (done || now - last > 100) { last = now; onProgress({ loaded, total, done }); }
 };
 report(false);
 return stream.pipeThrough(new TransformStream({
 transform(chunk, ctl) { loaded += chunk.byteLength; report(false); ctl.enqueue(chunk); },
 flush() { report(true); },
 }));
}
export async function getAsset(entry, { asModule = false, onProgress = () => {} } = {}) {
 const cache = await openCache();
 const hit = cache && await cache.match(entry.url);
 if (hit) {
 const n = entry.transferBytes ?? entry.bytes;
 onProgress({ loaded: n, total: n, done: true, fromCache: true });
 if (asModule) return WebAssembly.compileStreaming(new Response(hit.body, { headers: { 'content-type': 'application/wasm' } }));
 return new Uint8Array(await hit.arrayBuffer());
 }
 let res;
 try { res = await fetch(entry.url); } catch (e) { throw new AssetError('network', `${entry.file}: ${e.message}`); }
 if (!res.ok) throw new AssetError('network', `${entry.file}: HTTP ${res.status}`);
 let body = counted(res.body, entry.transferBytes ?? entry.bytes, onProgress);
 if (entry.encoding === 'gzip') body = body.pipeThrough(new DecompressionStream('gzip'));
 const [toCompile, toKeep] = asModule ? body.tee() : [null, body];
 const kept = new Response(toKeep).arrayBuffer().then(async (buf) => {
 const digest = hex(await crypto.subtle.digest('SHA-256', buf));
 if (buf.byteLength !== entry.bytes || digest !== entry.sha256) {
 throw new AssetError('integrity', `${entry.file} does not match its manifest (${buf.byteLength} bytes, SHA-256 ${digest.slice(0, 12)}…)`);
 }
 if (cache) await cache.put(entry.url, new Response(buf, { headers: { 'content-type': asModule ? 'application/wasm' : 'application/octet-stream' } })).catch(() => {});
 return new Uint8Array(buf);
 });
 if (!asModule) return kept;
 const [module] = await Promise.all([WebAssembly.compileStreaming(new Response(toCompile, { headers: { 'content-type': 'application/wasm' } })), kept]);
 return module;
}
export async function forget() {
 try { return typeof caches !== 'undefined' && await caches.delete(CACHE_NAME); } catch { return false; }
}
