// serve.mjs -- development-only static file server (no dependencies).
// Serves the repository root (or another directory) on 127.0.0.1; ES modules
// do not load from file:// pages. Not part of the deployed site (WS-N-008).
//   node tools/serve.mjs [port] [directory]
// Also imported by the browser smoke tests (startServer, port 0: any free port).
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
};

/** Serve `root` on 127.0.0.1:`port`; resolves to {server, url} once listening. */
export function startServer({ port = 8000, root = REPO } = {}) {
  const ROOT = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let path = normalize(join(ROOT, urlPath));
      if (path !== ROOT && !path.startsWith(ROOT + sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
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
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8000);
  const { url } = await startServer({ port, root: process.argv[3] ?? REPO });
  console.log(`MAVILERA RISC-V Laboratory (development): ${url}`);
}
