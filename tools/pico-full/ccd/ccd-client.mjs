// ccd-client.mjs -- client of the compile daemon (ccd-server.mjs), called by the stand-in executables (ccwrap.c) as
//   node ccd-client.mjs <tool> [args...]
// Rewrites C: paths to guest paths (also inside response files), sends the job, prints the tool's stdout/stderr and exits
// with its code. Port: CCD_PORT (default 47321). pico2 P1-F2 (from experiment E-CC-WASM-1); development tool only.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

// Every backslash becomes '/' (Windows relative paths such as CMakeFiles\x.d too); arguments of these builds never need
// a literal backslash.
const toGuest = (a) => a.replace(/[Cc]:[\\/]/g, '/').replace(/\\/g, '/');
const [tool, ...args] = process.argv.slice(2);
let tmp = null;
const out = args.map((a) => {
  if (a.startsWith('@')) {
    const text = readFileSync(a.slice(1), 'utf8');
    const conv = text.replace(/[Cc]:[\\/]/g, '/').replace(/\\(?!")/g, '/');
    tmp ??= mkdtempSync(join(tmpdir(), 'ccd-'));
    const f = join(tmp, `r${Math.random().toString(36).slice(2)}.rsp`);
    writeFileSync(f, conv);
    return '@' + toGuest(f);
  }
  return toGuest(a);
});
const body = JSON.stringify({ tool, args: out, pwd: toGuest(process.cwd()) });
const port = Number(process.env.CCD_PORT || 47321);
const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/run', headers: { 'content-type': 'application/json' } }, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const r = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    process.stdout.write(Buffer.from(r.stdout, 'base64'));
    process.stderr.write(Buffer.from(r.stderr, 'base64'));
    process.exitCode = r.code;
  });
});
req.on('error', (e) => { console.error(`ccd-client: daemon not reachable on ${port}: ${e.message}`); process.exitCode = 125; });
req.end(body);
