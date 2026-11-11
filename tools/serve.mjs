// serve.mjs -- development-only static file server (no dependencies).
// Serves the repository root (or another directory) on 127.0.0.1; ES modules
// do not load from file:// pages. Not part of the deployed site (WS-N-008).
//   node tools/serve.mjs [port] [directory] [--isolated]
// Also imported by the browser smoke tests (startServer, port 0: any free port).
// PICO_FULL_SITE (a folder made by tools/pico-full/stage.mjs) is served under /pico-full/: the Pico Full compiler and SDK
// pack (pico2 P1-F2), which are never in the repository.
// --isolated (or startServer({isolated: true}); pico2 P1-M4, research D36 Q6): every response carries
// Cross-Origin-Opener-Policy: same-origin and Cross-Origin-Embedder-Policy: require-corp, so that the page is
// crossOriginIsolated and the real-time run uses its SharedArrayBuffer ring, as on a site with the author's Cloudflare rule
// (ADR-0007, D6). Without it the server sends neither, as the live site does today.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.s': 'text/plain; charset=utf-8',
  '.hex': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.patch': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip',
};

/** The headers that make a page crossOriginIsolated (COOP + COEP; same-origin resources need no CORP header). */
export const ISOLATION_HEADERS = Object.freeze({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });

/** Serve `root` on 127.0.0.1:`port`; resolves to {server, url} once listening. */
export function startServer({ port = 8000, root = REPO, picoFull = process.env.PICO_FULL_SITE, isolated = false } = {}) {
  const ROOT = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let base = ROOT;
      if (picoFull && urlPath.startsWith('/pico-full/')) { base = resolve(picoFull); urlPath = urlPath.slice('/pico-full'.length); }
      let path = normalize(join(base, urlPath));
      if (path !== base && !path.startsWith(base + sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        ...(isolated ? ISOLATION_HEADERS : {}),
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rest = process.argv.slice(2);
  const isolated = rest.includes('--isolated');
  const pos = rest.filter((a) => a !== '--isolated');
  const port = Number(pos[0] ?? process.env.PORT ?? 8000);
  const { url } = await startServer({ port, root: pos[1] ?? REPO, isolated });
  console.log(`MAVILERA RISC-V Laboratory (development): ${url}${isolated ? ' (cross-origin isolated: COOP + COEP)' : ''}`);
}
