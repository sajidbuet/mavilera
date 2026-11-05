// platform.test.mjs -- the MAVILERA platform layout (W-D25): the architecture registry that feeds the
// landing page, the landing page's fields and wording, and paths that stay relative so that the pages
// work under /mavilera/ and /mavilera/riscv/ (or any other base path).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const registry = JSON.parse(read('site/architectures.json')).architectures;

test('registry: unique ids and paths, a known status, the RISC-V, SAP-1 and SAP-2 modules available', () => {
  assert.equal(new Set(registry.map((a) => a.id)).size, registry.length);
  assert.equal(new Set(registry.map((a) => a.path)).size, registry.length);
  for (const a of registry) {
    assert.match(a.id, /^[a-z0-9-]+$/);
    assert.ok(a.name);
    assert.match(a.path, /^[a-z0-9-]+\/$/, 'a relative directory path, no leading slash');
    assert.ok(['available', 'planned'].includes(a.status), a.id);
    if (a.status === 'available') {
      assert.ok(a.description, `${a.id}: an available module needs a description`);
      assert.ok(a.content?.length, `${a.id}: an available module is built from src/arch/${a.id} and its content folders`);
    }
  }
  // updated deliberately (docs/ADDING-SIMULATORS.md): SAP-1 since phase 6 of the architecture contract (W-D29), SAP-2 since step 6 of its plan
  assert.deepEqual(registry.filter((a) => a.status === 'available').map((a) => a.id), ['riscv', 'sap-1', 'sap-2', 'armv7', 'i8086', 'gpu']);
  // `gpu` reserved as planned at GPU-0 (DECISIONS.md G9), published as a preview from 1.2.0 (author, 2026-11-04); the
  // planned `8086` became `i8086`, a preview (the beta of 8086-B0 to B2; author, 2026-11-05: id i8086, no contract change)
  assert.deepEqual(registry.map((a) => a.id), ['riscv', 'sap-1', 'sap-2', 'armv7', 'i8086', 'gpu', '6502', 'mips']);
  assert.deepEqual(registry.filter((a) => a.preview).map((a) => a.id), ['i8086', 'gpu']);
  // a tool inside a module: its card links into the module (the NPU in RISC-V, decision G2)
  const tools = JSON.parse(read('site/architectures.json')).tools;
  assert.deepEqual(tools.map((t) => [t.id, t.module, t.path]), [['npu', 'riscv', 'riscv/?tool=npu']]);
});

test('landing page: the required wording, the card slot, no claims for planned modules, no old name', () => {
  const html = read('site/index.html');
  // the hero (author, 2026-11-05): the logo, its full form and one introduction; no tagline, no small print
  const flat = html.slice(html.indexOf('<body')).replace(/\s+/g, ' '); // the visible page (the link preview's text is the head's)
  assert.ok(flat.includes('MAVILERA is an open-source educational platform for exploring microprocessor architecture through interactive simulation, visualization, and instruction execution. It runs entirely in your browser: no account, no installation, and no program or data is uploaded.'));
  assert.ok(!flat.includes('Visualize. Execute. Understand.') && !flat.includes('provisional project name') && !/<p class="(descriptor|note)">Runs entirely/.test(flat));
  // minimal layout (author, 2026-11-05): the tiles in the author's order, every module and tool once; no screenshot,
  // no row of launch buttons, no tabs; learning paths by topic; one documentation page for every laboratory
  const reg = JSON.parse(read('site/architectures.json'));
  assert.deepEqual(reg.landing, ['riscv', 'gpu', 'npu', 'sap-1', 'sap-2', 'armv7', 'i8086', 'mips', '6502']);
  assert.deepEqual([...reg.landing].sort(), [...registry.map((a) => a.id), ...reg.tools.map((t) => t.id)].sort());
  for (const s of ['{{LABS}}', '{{COMING}}', '{{LEARN}}', '{{SITE_CSS}}', '{{HERO_LOGO}}', '{{HERO_CSS}}', 'mvh-play',
    'href="#laboratories"', 'href="#learn"', 'href="docs/"']) assert.ok(html.includes(s), s);
  for (const s of ['{{CARDS}}', '{{LAUNCH_OTHERS}}', '{{DOWNLOADS}}', 'screens/workspace', 'lab-panel', 'riscv/docs/']) assert.ok(!html.includes(s), s);
  // each available module and tool has a tagline for its tile
  for (const a of [...registry.filter((x) => x.status === 'available'), ...reg.tools]) assert.ok(a.tagline, a.id);
  // the learning paths by topic: every step opens an available module or a tool
  const open = new Set([...registry.filter((x) => x.status === 'available').map((a) => a.id), ...reg.tools.map((t) => t.id)]);
  assert.deepEqual(reg.learn.map((p) => p.title), ['How a computer works', 'Instruction sets', 'Datapaths and pipelining', 'Parallel hardware']);
  for (const p of reg.learn) for (const s of p.steps) assert.ok(open.has(s.lab) && s.text, `${p.title}: ${s.lab}`);
  const docs = read('site/docs.html');
  for (const s of ['{{DOC_CARDS}}', '{{BROWSERS}}', '{{SITE_CSS}}', 'aria-current="page"', 'href="../download/"']) assert.ok(docs.includes(s), s);
  // the download page (author, 2026-11-05): the archives from the GitHub release, never hosted on the site; the single files
  const dl = read('site/download.html');
  for (const s of ['{{ZIP_OFFLINE}}', '{{ZIP_SITE}}', '{{RELEASE_URL}}', '{{SINGLE_FILES}}', '{{SITE_CSS}}', 'aria-current="page"']) assert.ok(dl.includes(s), s);
  assert.ok(!/href="[^"]*\.zip"/.test(dl), 'no archive on the site');
  assert.ok(html.includes('href="download/"'));
  const rel = read('tools/release.mjs');
  assert.match(rel, /ZIP_OFFLINE: `\$\{REPO_URL\}\/releases\/download\/v\$\{version\}\/mavilera-\$\{version\}-offline\.zip`/);
  assert.match(read('tools/release-zips.mjs'), /mavilera-\$\{VERSION\}-offline/);
  assert.ok(!/RISC-VISTA|riscvista/i.test(html));
  // planned modules are never linked from the page template
  for (const a of registry.filter((x) => x.status !== 'available')) assert.ok(!html.includes(`href="${a.path}"`), a.id);
});

test('paths stay relative: no root-absolute asset or link in the pages, the manifest or the service worker source', () => {
  const rootAbsolute = /\b(?:href|src|action)\s*=\s*["']\/(?!\/)/i;
  for (const f of ['index.html', 'site/index.html', 'site/docs.html', 'site/download.html', 'content/help/docs/index.html']) assert.doesNotMatch(read(f), rootAbsolute, f);
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  for (const i of m.icons) assert.ok(!i.src.startsWith('/'), i.src);
  assert.doesNotMatch(read('tools/release.mjs'), /new URL\(['"]\//, 'the service worker derives its scope from its own location');
});

test('the app links to MAVILERA Home only in a release (the logo does, test/arch-switcher.test.mjs), and the logo files it reads exist', () => {
  const main = read('src/main.js');
  assert.match(main, /homeUrl\(where\)/);
  assert.match(main, /STRINGS\.archSwitch/);
  for (const f of ['mavilera-logo.svg', 'mavilera-icon.svg']) assert.ok(existsSync(join(ROOT, 'content/branding/mavilera', f)), f);
});

test('the earlier product name appears nowhere user-facing: pages, strings, manifest, documentation', () => {
  const templates = readdirSync(join(ROOT, 'content/templates')).map((f) => `content/templates/${f}`);
  const exercises = readdirSync(join(ROOT, 'content/exercises')).map((f) => `content/exercises/${f}`);
  for (const f of ['index.html', 'manifest.webmanifest', 'src/ui/strings.js', 'content/help/help.json', 'content/help/docs/index.html', 'site/index.html',
    'site/architectures.json', 'content/README.md', ...templates, ...exercises]) {
    const text = read(f).replace(/risc-vista-(?:exercise|settings|edition|version)/g, '');
    assert.ok(!/RISC-VISTA|riscvista/i.test(text), f);
  }
});
