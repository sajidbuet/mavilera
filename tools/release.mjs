// release.mjs -- builds the published site in dist/, which GitHub Pages serves as
// https://sajidlab.org/mavilera/ (BASE_PATH, default /mavilera/; every path in the output is relative):
//   index.html                     MAVILERA landing page (site/index.html with the cards of site/architectures.json)
//   brand/, favicon.ico, icon.svg  the logo files and icons (content/branding/mavilera/)
//   screens/                       screenshots of the landing page (site/screens/)
// and for each module of the registry whose status is `available`, built from src/arch/<id> (W-D29, phase 6;
// its files: tools/site-files.mjs archFiles), at its registry path <path> (riscv/, sap-1/, ...):
//   <path>index.html, manifest, sw.js   the module's page and its service worker (WS-N-012)
//   <path>docs/                    its documentation, where the architecture has one (content.docs; RISC-V: content/help/docs/)
//   <path>mavilera-<id>-<version>.html  single-file offline build (WS-N-002, tools/offline.mjs)
//   <path>assets/<hash>/src|content  every other file, under a folder named by the hash of the
//                                  module's files (WS-N-010): a new release, a new folder
//   <path>web-sim-validation.json  the record the release was built from (WS-V-040)
//   _headers, .nojekyll            cache lifetimes for hosts that read _headers; no Jekyll
// The release leaves out the optional JALR state (the answer of an exercise, W-D20) and marks
// its pages as the release edition, so the application does not look for it.
//   node tools/release.mjs            release build: refuses (exit 1, dist/ removed) while a gate fails
//   node tools/release.mjs --preview  same build with the gates reported only (fields left unfilled marked)
// Gates: a passing validation record of this version whose source hashes equal the files
// published and whose hash of this script is current (WS-V-041); smoke tests in the record, RISC-V's and
// each module's (WS-V-031, tested browsers, WS-N-001); version above 0.0.0 and a release date; LICENSE and
// NOTICE (W-D1, at publication only); size of each module (WS-N-004); no server code (WS-N-008);
// the registry's statuses and documentation links agree with what is built.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, listFiles, registry, archFiles, archPage, hashFiles, hashOfHashes, sha256 } from './site-files.mjs';
import { buildOffline } from './offline.mjs';
import { minify } from './minify.mjs';

const DIST = join(ROOT, 'dist');
const SIZE_LIMIT = 1310720; // WS-N-004 as raised by W-D31 (2026-10-31): 1.25 MB per application, without examples
const BASE = process.env.BASE_PATH ?? '/mavilera/';
const SITE_URL = `${process.env.SITE_ORIGIN ?? 'https://sajidlab.org'}${BASE}`;
const REPO_URL = 'https://github.com/sajidbuet/mavilera';
const preview = process.argv.includes('--preview');
const gates = [];
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const put = (p, text) => { mkdirSync(dirname(join(DIST, p)), { recursive: true }); writeFileSync(join(DIST, p), text); };

const version = JSON.parse(read('package.json')).version;
const conf = JSON.parse(read('site/release.json'));
const modules = registry().filter((a) => a.status === 'available');
const { ARCHITECTURES } = await import(pathToFileURL(join(ROOT, 'src/arch/registry.js')).href);
const { STRINGS } = await import(pathToFileURL(join(ROOT, 'src/ui/strings.js')).href);
const builds = [];
for (const a of modules) {
  if (!ARCHITECTURES[a.id]) throw new Error(`registry: ${a.id} is available but src/arch/registry.js does not know it`);
  const { files, overrides } = archFiles(a.id);
  builds.push({ entry: a, files, overrides, descriptor: (await ARCHITECTURES[a.id]()).descriptor });
}
const sources = [...new Set(builds.flatMap((b) => b.files))].sort();
const hashes = hashFiles(sources);

// --- the validation record (WS-V-040/041) -------------------------------------------------------
const recordPath = join(ROOT, 'web-sim-validation.json');
const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null;
let browsers = [];
if (!record) gates.push('web-sim-validation.json missing: run node tools/verify.mjs --smoke (WS-V-040)');
else {
  if (record.pass !== true) gates.push('the validation record does not record a pass (WS-V-041)');
  if (record.version !== version) gates.push(`the validation record is of version ${record.version}, not ${version}`);
  const recorded = record.simulator?.sources?.files ?? {};
  const differ = sources.filter((p) => recorded[p] !== hashes[p]);
  if (differ.length) gates.push(`${differ.length} file(s) differ from the validation record, e.g. ${differ.slice(0, 3).join(', ')} (WS-V-041)`);
  for (const t of ['tools/release.mjs', 'tools/offline.mjs', 'tools/site-files.mjs', 'tools/minify.mjs']) {
    if (record.simulator?.tools?.files?.[t] !== sha256(readFileSync(join(ROOT, t)))) gates.push(`${t} changed since the validation record`);
  }
  if (!record.smoke) gates.push('no browser smoke tests in the validation record: run node tools/verify.mjs --smoke (WS-V-031)');
  else {
    browsers = record.smoke.browsers.filter((b) => b.installed && b.results.every((x) => x.ok))
      .map((b) => `${b.name[0].toUpperCase()}${b.name.slice(1)} ${String(b.version).match(/\/(\d+)/)?.[1] ?? b.version}`);
    // every module's own build passed the smoke tests of the contract (tools/module-smoke.mjs, phase 6)
    for (const { entry: a } of builds) {
      const m = record.smoke.modules?.[a.id];
      if (!m?.browsers?.some((b) => b.installed && b.results.every((x) => x.ok))) gates.push(`${a.id}: no passing module smoke tests in the validation record (tools/module-smoke.mjs, WS-V-031)`);
    }
  }
}
if (version === '0.0.0') gates.push('package.json version is 0.0.0: set the release version (W-D18, W-D21)');
if (!conf.date) gates.push('site/release.json has no release date');
if (!browsers.length) gates.push('no browser passed the smoke tests in the record (WS-N-001)');

// --- each module -------------------------------------------------------------------------------
rmSync(DIST, { recursive: true, force: true });
const headers = [];
for (const b of builds) {
  const { entry: a, files, overrides, descriptor } = b;
  const APP = join(DIST, a.path);
  const name = `${STRINGS.appName} ${descriptor.strings.appFull}`;
  // the folder of the assets is named by the files as published (the overrides in place of their sources)
  // (and the minifier, which shapes every published text file: a changed minifier, a new folder)
  const published = { ...Object.fromEntries(files.map((p) => [p, hashes[p]])),
    ...Object.fromEntries(Object.entries(overrides).map(([p, s]) => [p, sha256(s)])),
    'tools/minify.mjs': sha256(readFileSync(join(ROOT, 'tools/minify.mjs'))) };
  const ASSETS = `assets/${hashOfHashes(published).slice(0, 12)}`;
  b.tag = ASSETS.slice(7);
  // JavaScript, CSS and JSON are published without comments and indentation (tools/minify.mjs, WS-N-004)
  for (const p of files) {
    if (p === 'index.html' || p === 'manifest.webmanifest') continue;
    mkdirSync(dirname(join(APP, ASSETS, p)), { recursive: true });
    if (Object.hasOwn(overrides, p)) writeFileSync(join(APP, ASSETS, p), minify(p, overrides[p]));
    else if (/\.(m?js|css|json)$/.test(p)) writeFileSync(join(APP, ASSETS, p), minify(p, read(p)));
    else cpSync(join(ROOT, p), join(APP, ASSETS, p));
  }
  const { page, manifest } = archPage(a, { appName: STRINGS.appName, appFull: descriptor.strings.appFull });
  const at = (s) => s.replace(/(href|src)="(src|content)\//g, `$1="${ASSETS}/$2/`);
  const index = at(page)
    .replace(/(<meta name="application-name" content="[^"]*">)/,
      `$1\n  <meta name="risc-vista-edition" content="release">\n  <meta name="risc-vista-version" content="${version}">`)
    .replace('</body>', '  <script>if (\'serviceWorker\' in navigator && isSecureContext) navigator.serviceWorker.register(\'sw.js\').catch(() => {});</script>\n</body>');
  if (!index.includes(`src="${ASSETS}/src/main.js"`) || !index.includes('risc-vista-edition')) throw new Error('index.html: unexpected shape');
  put(`${a.path}index.html`, index);
  for (const i of manifest.icons) i.src = `${ASSETS}/${i.src}`;
  put(`${a.path}manifest.webmanifest`, `${JSON.stringify(manifest, null, 2)}\n`);

  // service worker (WS-N-012): the files of this release kept in the browser; index.html is
  // fetched from the host first (a cheap revalidation), from the cache when the host is unreachable
  const precache = ['./', 'index.html', 'manifest.webmanifest', ...files.filter((p) => p !== 'index.html' && p !== 'manifest.webmanifest').map((p) => `${ASSETS}/${p}`)];
  put(`${a.path}sw.js`, `// sw.js -- service worker of ${name} ${version} (spec WS-N-012), written by tools/release.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
const CACHE = 'mavilera-${a.id}-${b.tag}';
const FILES = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mavilera-${a.id}-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
const shell = new URL('./', self.location).pathname;
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(shell)) return;
  if (req.mode === 'navigate' || url.pathname === shell || url.pathname === shell + 'index.html') {
    e.respondWith(fetch(url.pathname, { cache: 'no-cache' })
      .then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)); } return r; })
      .catch(() => caches.match('index.html', { cacheName: CACHE })));
    return;
  }
  e.respondWith(caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
});
`);

  // record, licences, offline build, documentation
  if (record) cpSync(recordPath, join(APP, 'web-sim-validation.json'));
  for (const n of ['LICENSE', 'NOTICE']) {
    if (existsSync(join(ROOT, n))) cpSync(join(ROOT, n), join(APP, n));
    else if (b === builds[0]) gates.push(`${n} missing: added at publication on the author's instruction (W-D1)`);
  }
  b.offlineFile = `mavilera-${a.id}-${version}.html`;
  b.offline = buildOffline(ROOT, { files, version, overrides, page, prepare: minify });
  put(`${a.path}${b.offlineFile}`, b.offline.html);
  // the documentation is published beside the module (the help dialog links ./docs/ in a release)
  const docs = descriptor.content?.docs ? `${posix.dirname(descriptor.content.docs)}/` : null;
  if (Boolean(docs) !== Boolean(a.docs) || (a.docs && a.docs !== `${a.path}docs/`)) gates.push(`registry: ${a.id}'s docs link and its content.docs disagree`);
  if (docs && existsSync(join(ROOT, docs))) {
    for (const p of listFiles(join(ROOT, docs))) {
      const to = join(APP, 'docs', p.slice(docs.length));
      mkdirSync(dirname(to), { recursive: true });
      cpSync(join(ROOT, p), to);
    }
  } else if (docs) gates.push(`${docs} missing: ${a.id}'s documentation not yet written (W-D20)`);

  // size: WS-N-004 counts the site without examples; the teaching templates are examples too
  // (and not the validation record or the licence texts, which are published beside the site, not loaded by it)
  b.bytes = listFiles(APP, APP).filter((p) => !/\/content\/(?:[\w-]+\/)?(?:examples|templates)\//.test(p)
    && !p.startsWith('docs/') && p !== b.offlineFile && !['web-sim-validation.json', 'LICENSE', 'NOTICE'].includes(p))
    .reduce((n, p) => n + statSync(join(APP, p)).size, 0);
  if (b.bytes >= SIZE_LIMIT) gates.push(`${a.id}: application ${b.bytes} bytes without examples, over 1.25 MB (WS-N-004, W-D31)`);
  headers.push(`/${a.path}assets/*\n  Cache-Control: public, max-age=31556952, immutable\n/${a.path}sw.js\n  Cache-Control: no-cache\n/${a.path}index.html\n  Cache-Control: no-cache\n`);
}

// --- landing page ------------------------------------------------------------------------------
for (const s of ['workspace-light.jpg', 'workspace-dark.jpg', 'view-ch08.jpg']) {
  mkdirSync(join(DIST, 'screens'), { recursive: true });
  cpSync(join(ROOT, 'site/screens', s), join(DIST, 'screens', s));
}
// the logo files and icons: brand/ for the landing page, icons at the site root for the documentation
for (const p of listFiles(join(ROOT, 'content/branding/mavilera'))) {
  const to = join(DIST, 'brand', p.slice('content/branding/mavilera/'.length));
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(ROOT, p), to);
}
// the architecture registry (site/architectures.json) is the source of the cards; a module is linked
// only when it is available and its build is present, and a planned one must not have a route
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cards = registry().map((a) => {
  const built = existsSync(join(DIST, a.path, 'index.html'));
  if (a.status === 'available' && !built) gates.push(`registry: ${a.id} is available but ${a.path}index.html is not built`);
  if (a.status !== 'available' && built) gates.push(`registry: ${a.id} is ${a.status} but its build is present`);
  if (a.status === 'available') {
    return `          <article class="card arch available"><h3>${esc(a.name)}<span class="status ok">Available</span></h3><p>${esc(a.description ?? '')}</p>
            <p class="path">Address: <code>${BASE}${a.path}</code></p>
            <div class="actions"><a class="btn btn-primary" href="${a.path}">Launch ${esc(a.name)} Laboratory</a>${a.docs ? `<a class="btn btn-secondary" href="${a.docs}">Documentation</a>` : ''}</div></article>`;
  }
  return `          <article class="card arch planned"><h3>${esc(a.name)}<span class="status">Planned</span></h3><p class="note">Not yet available.</p>
            <div class="actions"><span class="btn btn-disabled" aria-disabled="true">Not yet available</span></div></article>`;
}).join('\n');
// the landing page names every available module (author, 2026-10-29): RISC-V's launch button is the template's own,
// the others' follow it; one offline download per module; the footer lists the modules of the release
const unfilled = '[not built]';
const lab = (b) => `${esc(b.entry.name)} Laboratory`;
const fields = {
  VERSION: version,
  CARDS: cards,
  SITE_URL,
  REPO_URL,
  DATE: conf.date ?? unfilled,
  BROWSERS: browsers.length ? browsers.join(', ') : unfilled,
  LAUNCH_OTHERS: builds.filter((b) => b.entry.id !== 'riscv')
    .map((b) => `        <a class="btn btn-secondary" href="${b.entry.path}">Launch ${lab(b)}</a>`).join('\n'),
  DOWNLOADS: builds.map((b) => `<a href="${b.entry.path}${b.offlineFile}" download>Download the single-file offline version of the ${lab(b)} `
    + `(${Math.round(Buffer.byteLength(b.offline.html) / 1024)} kB)</a>`).join(' ·\n          '),
  MODULES: builds.map((b) => lab(b)).join(', '),
};
const landing = read('site/index.html').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => fields[k] ?? m);
const left = landing.match(/\{\{[A-Z_]+\}\}/g);
if (left) gates.push(`landing page fields unfilled: ${[...new Set(left)].join(' ')}`);
put('index.html', landing);
// the icons at the site root, for the documentation (and browsers that ask for /favicon.ico there)
cpSync(join(ROOT, 'content/branding/mavilera/favicon.ico'), join(DIST, 'favicon.ico'));
cpSync(join(ROOT, 'content/branding/mavilera/mavilera-icon.svg'), join(DIST, 'icon.svg'));
// GitHub Pages runs Jekyll unless told not to, and Jekyll drops files whose names begin with _
put('.nojekyll', '');
// Cloudflare Pages and Netlify read _headers (WS-N-010); GitHub Pages does not: there a Cloudflare
// Cache Rule on ${BASE}<path>assets/* sets the long lifetime (docs/DEPLOYMENT.md)
put('_headers', headers.join(''));

// --- server code -------------------------------------------------------------------------------
if (listFiles(DIST, DIST).some((p) => /^(functions\/|_worker\.js)/.test(p))) gates.push('server code in the output (WS-N-008)');
if (listFiles(DIST, DIST).some((p) => p.endsWith('ch07-jalr.json'))) throw new Error('the JALR answer is in the output (W-D20)');

console.log(`MAVILERA ${version}: ${listFiles(DIST, DIST).length} files in dist/`);
for (const b of builds) {
  console.log(`  ${b.entry.path}: assets ${b.tag}; application ${Math.round(b.bytes / 1024)} kB without examples; offline build ${Math.round(Buffer.byteLength(b.offline.html) / 1024)} kB, ${b.offline.modules} modules`);
}
if (gates.length) {
  console.log(`${preview ? 'Not yet releasable' : 'Release refused'}:`);
  for (const g of gates) console.log(`  - ${g}`);
  if (!preview) {
    rmSync(DIST, { recursive: true, force: true });
    process.exit(1);
  }
} else console.log('All release gates pass.');
