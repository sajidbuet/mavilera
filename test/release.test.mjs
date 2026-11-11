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

import { ROOT, shippedFiles, releaseFiles, registry, archFiles, archOverrides, archPage, SHARED } from '../tools/site-files.mjs';
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
  // three entries: the page, its Worker and (contract v10 capability audio, pico2 P1-M5) the AudioWorklet module
  const ENTRIES = ['src/main.js', 'src/worker/run.js', 'src/worker/audio-processor.js'];
  const mods = new Map(ENTRIES.flatMap((e) => [...collect(ROOT, e)]));
  const js = shippedFiles().filter((p) => p.endsWith('.js'));
  // every module of the application is reached from the two entries; src/mem/ (the memory
  // hierarchy of M7) is not wired into the interface yet and is exempt, as is the viewer's model
  // (phase 5) until the viewer panel that uses it is wired into a view
  const pending = new Set(['src/ui/mem-viewmodel.js']);
  // src/arch/pico2/ is registered for the development page only (P1-M1) and left out of every release (tools/site-files.mjs
  // RELEASE_EXCLUDE) until it is released; exempt until then
  assert.deepEqual(js.filter((p) => !mods.has(p) && !p.startsWith('src/mem/') && !p.startsWith('src/arch/pico2/') && !pending.has(p)), []);
  for (const [p, m] of mods) {
    if (ENTRIES.includes(p)) continue; // entries: they run on import
    const real = Object.keys(await import(pathToFileURL(join(ROOT, p)))).sort();
    assert.deepEqual([...m.exports].sort(), real, p);
  }
});

test('W-D29 phase 6: each architecture builds from its own modules and content folders', () => {
  const all = releaseFiles();
  const own = { riscv: ['src/arch/riscv/', 'src/isa/', 'src/asm/', 'src/core/', 'src/uarch/', 'src/cc/'], 'sap-1': ['src/arch/sap-1/'], 'sap-2': ['src/arch/sap-2/'],
    armv7: ['src/arch/armv7/'], i8086: ['src/arch/i8086/'], pico2: ['src/arch/pico2/'], gpu: ['src/arch/gpu/'] };
  // the declared sharing (G18, GPU-4, G30): tools/site-files.mjs SHARED
  const shared = SHARED;
  const GPU_IN_RISCV = SHARED.riscv;
  const built = registry().filter((a) => a.content);
  assert.deepEqual(built.map((a) => a.id), ['riscv', 'sap-1', 'sap-2', 'armv7', 'i8086', 'pico2', 'gpu']); // pico2 from 1.5.0 (P1-M9, research D45)
  for (const a of built) {
    for (const c of a.content) assert.ok(existsSync(join(ROOT, c)), `${a.id}: ${c}`);
    const { files, overrides } = archFiles(a.id);
    const others = built.filter((b) => b !== a);
    // nothing of another architecture: neither its modules nor its content
    for (const b of others) {
      const theirs = [...own[b.id], ...b.content];
      assert.deepEqual(files.filter((p) => theirs.some((t) => p.startsWith(t)) && !(shared[a.id] ?? []).includes(p)), [], `${a.id} has ${b.id}'s files`);
    }
    for (const p of ['index.html', 'manifest.webmanifest', 'src/main.js', 'src/worker/run.js', 'src/ui/theme.css', 'content/branding/mavilera/mavilera-icon.svg']) assert.ok(files.includes(p), `${a.id}: ${p}`);
    // the overrides: one registry entry, importing what the development registry imports; the id fixed
    const reg = transform('src/arch/registry.js', overrides['src/arch/registry.js']);
    assert.deepEqual(reg.deps, [`src/arch/${a.id}/index.js`]);
    assert.deepEqual(reg.exports, ['ARCHITECTURES']);
    assert.match(overrides['src/shell/arch-id.js'], new RegExp(`^export const ARCH_ID = "${a.id}";$`, 'm'));
  }
  // the RISC-V build is the release files without SAP-1's, SAP-2's, ARMv7's, the 8086's and the GPU's (each built on its
  // own; the GPU available from 1.3.0, the 8086 a beta) and without the logo files no page, manifest or module
  // names (WS-N-004: the social preview and the print variants belong to the landing page and the repository)
  const rv = new Set(archFiles('riscv').files);
  const brand = 'content/branding/mavilera/';
  const unused = ['social-preview.png', 'mavilera-dark.svg', 'mavilera-light.svg', 'mavilera-mono.svg', 'mavilera-lockup.svg'];
  assert.deepEqual(all.filter((p) => !rv.has(p) && !p.startsWith(brand)),
    all.filter((p) => (/^(src\/arch|content)\/(sap-[12]|armv7|i8086|pico2|gpu)\//.test(p) || p === 'src/worker/audio-processor.js') && !GPU_IN_RISCV.includes(p)));
  // (from 1.5.0 the Pico 2's files too, and the AudioWorklet that only its build loads: P1-M9, research D45)
  for (const f of unused) assert.ok(!rv.has(brand + f), f);
  for (const f of ['favicon.ico', 'mavilera-icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'mavilera-logo.svg', 'mavilera-full.svg']) assert.ok(rv.has(brand + f), f);
  assert.ok(archFiles('sap-1').files.includes(`${brand}mavilera-logo-sap-1.svg`), 'SAP-1: its header lockup');
  assert.ok(archFiles('sap-2').files.includes(`${brand}mavilera-logo-sap-2.svg`), 'SAP-2: its header lockup');
  // the GPU's core view draws from RISC-V's geometry file, shared by decision (SHARED): its build carries it
  assert.ok(archFiles('gpu').files.includes('content/geometry/ch11a-gpu.json'), 'GPU: the core view\'s geometry');
  // the Pico 2's AudioWorklet is loaded by address (Descriptor.audio.processor), not imported: its build carries it
  assert.ok(archFiles('pico2').files.includes('src/worker/audio-processor.js'), 'Pico 2: the AudioWorklet');
  assert.throws(() => archOverrides('mips'), /no architecture mips/);
});

test('W-D29 phase 6: each module\'s page and manifest carry its name; RISC-V\'s are the development page\'s', () => {
  const dev = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const devManifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  const [rv, sap] = ['riscv', 'sap-1'].map((id) => registry().find((a) => a.id === id));
  const r = archPage(rv, { appName: 'MAVILERA', appFull: 'RISC-V Laboratory' });
  assert.equal(r.page, dev);
  assert.deepEqual(r.manifest, devManifest);
  const s = archPage({ ...sap, description: 'Sixteen bytes & one bus.' }, { appName: 'MAVILERA', appFull: 'SAP-1 Laboratory' });
  assert.match(s.page, /<title>MAVILERA: SAP-1 Laboratory<\/title>/);
  assert.match(s.page, /<meta name="application-name" content="MAVILERA SAP-1 Laboratory">/);
  assert.match(s.page, /<meta name="description" content="MAVILERA SAP-1 Laboratory: Sixteen bytes &amp; one bus\.">/);
  assert.match(s.page, /application shell of MAVILERA SAP-1 Laboratory\./);
  assert.ok(!/RISC-V/.test(s.page), 'no RISC-V text in the SAP-1 page');
  assert.equal(s.manifest.name, 'MAVILERA: SAP-1 Laboratory');
  assert.equal(s.manifest.description, 'Sixteen bytes & one bus.');
  assert.throws(() => archPage({ ...sap, description: undefined }, { appName: 'MAVILERA', appFull: 'SAP-1 Laboratory' }), /no description/);
  // the offline file of SAP-1: its page, its content, none of RISC-V's modules or content
  const { files, overrides } = archFiles('sap-1');
  const { html, mainModules, workerModules } = buildOffline(ROOT, { files, version: '0.0.0-test', overrides, page: s.page });
  assert.match(html, /<meta name="application-name" content="MAVILERA SAP-1 Laboratory">/);
  assert.ok(html.includes('"content/sap-1/templates/index.json"') && !html.includes('"content/help/help.json"'));
  assert.deepEqual([...mainModules, ...workerModules].filter((p) => !files.includes(p)), []);
  assert.ok(html.includes('export const ARCH_ID') === false && html.includes('const ARCH_ID = "sap-1"'));
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
  for (const dir of ['content/help', 'content/sap-1/help', 'content/sap-2/help', 'content/gpu/help']) {
    const help = JSON.parse(readFileSync(join(ROOT, dir, 'help.json'), 'utf8'));
    const ids = help.sections.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length, dir);
    for (const s of help.sections) {
      assert.ok(s.title && s.blocks.length, s.id);
      for (const b of s.blocks) assert.equal(Object.keys(b).filter((k) => ['p', 'ul', 'ol', 'dl', 'brand', 'refs', 'notice'].includes(k)).length, 1, s.id);
    }
    // the first page: the logo, the architecture's references (each linked over https, or a book without a page) and its notice
    const first = help.sections[0].blocks;
    assert.ok(first[0].brand && first.some((b) => b.refs) && first.some((b) => b.notice), `${dir}: first page`);
    for (const [t, url] of first.filter((b) => b.refs).flatMap((b) => b.refs)) assert.ok(t && (url === null || /^https:\/\//.test(url)), `${dir}: ${t}`);
    const docs = readFileSync(join(ROOT, dir, 'docs/index.html'), 'utf8');
    assert.ok(!/\{\{|<!--(ABOUT|RIGHTS)-->/.test(docs), `${dir}: no unfilled fields`);
  }
  const docs = readFileSync(join(ROOT, 'content/help/docs/index.html'), 'utf8');
  assert.ok(!/chapter|figure \d|PRB-\d|exercise \d/i.test(docs.replace(/<!--[\s\S]*?-->/g, '')), 'no book references (W-D16)');
});
