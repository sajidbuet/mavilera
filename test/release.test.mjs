// release.test.mjs -- the release tooling (spec §16, W-D19 to W-D21): the files a release
// publishes (no JALR answer, W-D20), the module rewriting of the single-file offline build
// (WS-N-002: every module's exports as Node.js reads them, no unsupported syntax), and the
// in-app help (W-D20). The release build itself is exercised by tools/browser-smoke.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, shippedFiles, releaseFiles } from '../tools/site-files.mjs';
import { collect, transform, buildOffline } from '../tools/offline.mjs';

test('W-D20: a release publishes the application without the JALR answer and without the site documentation', () => {
  const all = shippedFiles();
  const rel = releaseFiles();
  assert.ok(all.includes('content/data/ch07-jalr.json'));
  assert.ok(!rel.includes('content/data/ch07-jalr.json'));
  assert.ok(!rel.some((p) => p.startsWith('content/help/docs/')));
  assert.ok(!rel.some((p) => p.startsWith('content/pip/') || p.endsWith('.md')));
  for (const p of ['index.html', 'manifest.webmanifest', 'src/main.js', 'src/worker/run.js', 'content/help/help.json']) assert.ok(rel.includes(p), p);
});

const BOOK = process.env.MES_BOOK ?? join(ROOT, '..', 'book-MES');
const PYTHON = process.env.PYTHON ?? 'python';
test('W-D20: the multicycle files, the JALR file included, are what tools/export_ch07.py writes from the book', {
  skip: existsSync(join(BOOK, 'code')) ? false : 'book repository not found beside this one',
}, () => {
  const r = spawnSync(PYTHON, ['-I', join(ROOT, 'tools', 'export_ch07.py'), '--book', BOOK, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('WS-N-002: every module of the offline build exports what Node.js reads from it', async () => {
  const mods = new Map([...collect(ROOT, 'src/main.js'), ...collect(ROOT, 'src/worker/run.js')]);
  const js = shippedFiles().filter((p) => p.endsWith('.js'));
  // every module of the application is reached from the two entries
  assert.deepEqual(js.filter((p) => !mods.has(p)), []);
  for (const [p, m] of mods) {
    if (p === 'src/main.js' || p === 'src/worker/run.js') continue; // entries: they run on import
    const real = Object.keys(await import(pathToFileURL(join(ROOT, p)))).sort();
    assert.deepEqual([...m.exports].sort(), real, p);
  }
});

test('WS-N-002: the offline rewriting refuses what it does not understand', () => {
  assert.throws(() => transform('src/x.js', "import x from './y.js';\n"), /unsupported/);
  assert.throws(() => transform('src/x.js', "export default 1;\n"), /unsupported/);
  assert.throws(() => transform('src/x.js', "const m = import(name);\n"), /unsupported/);
  assert.throws(() => transform('src/x.js', "import { a } from 'pkg';\n"), /not relative/);
  const t = transform('src/a/x.js', "import { b as c } from '../y.js';\nexport const k = c;\nconst u = import.meta.url;\n");
  assert.deepEqual(t.deps, ['src/y.js']);
  assert.deepEqual(t.exports, ['k']);
  assert.match(t.code, /const \{ b: c \} = __req\("src\/y\.js"\);/);
  assert.match(t.code, /"https:\/\/risc-vista\.invalid\/src\/a\/x\.js"/);
});

test('WS-N-002: the offline page holds the release content, marked as the release edition', () => {
  const { html } = buildOffline(ROOT, { files: releaseFiles(), version: '0.0.0-test' });
  assert.match(html, /<meta name="risc-vista-edition" content="release">/);
  const files = html.match(/<script type="application\/json" id="rv-files">([^<]*)<\/script>/)[1];
  assert.ok(!/exr:mc-jalr|"id": ?"JALR"|PRB-0129/.test(JSON.stringify(JSON.parse(files))), 'no JALR answer in the content');
  assert.ok(html.includes('"content/help/help.json"'));
  assert.ok(!/<script[^>]+src=/.test(html) && !/<link[^>]+href="(?!data:)/.test(html), 'nothing loaded from elsewhere');
});

test('W-D20: the in-app help has sections of known block kinds, and the documentation no unfilled fields', () => {
  const help = JSON.parse(readFileSync(join(ROOT, 'content/help/help.json'), 'utf8'));
  const ids = help.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of help.sections) {
    assert.ok(s.title && s.blocks.length, s.id);
    for (const b of s.blocks) assert.equal(Object.keys(b).filter((k) => ['p', 'ul', 'ol', 'dl'].includes(k)).length, 1, s.id);
  }
  const docs = readFileSync(join(ROOT, 'content/help/docs/index.html'), 'utf8');
  assert.ok(!/\{\{|chapter|figure \d|PRB-\d|exercise \d/i.test(docs.replace(/<!--[\s\S]*?-->/g, '')), 'no fields and no book references (W-D16)');
});
