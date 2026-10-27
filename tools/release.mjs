// release.mjs -- builds the published site in dist/, which GitHub Pages serves as
// https://sajidlab.org/mavilera/ (BASE_PATH, default /mavilera/; every path in the output is relative):
//   index.html                     MAVILERA landing page (site/index.html with the cards of site/architectures.json)
//   brand/, favicon.ico, icon.svg  the logo files and icons (content/branding/mavilera/)
//   screens/                       screenshots of the landing page (site/screens/)
//   riscv/index.html, manifest, sw.js   the RISC-V Laboratory shell and its service worker (WS-N-012)
//   riscv/docs/                    its documentation (content/help/docs/)
//   riscv/mavilera-riscv-<version>.html   single-file offline build (WS-N-002, tools/offline.mjs)
//   riscv/assets/<hash>/src|content  every other file, under a folder named by the hash of the
//                                  release's files (WS-N-010): a new release, a new folder
//   riscv/web-sim-validation.json  the record the release was built from (WS-V-040)
//   _headers, .nojekyll            cache lifetimes for hosts that read _headers; no Jekyll
// The release leaves out the optional JALR state (the answer of an exercise, W-D20) and marks
// its pages as the release edition, so the application does not look for it.
//   node tools/release.mjs            release build: refuses (exit 1, dist/ removed) while a gate fails
//   node tools/release.mjs --preview  same build with the gates reported only (fields left unfilled marked)
// Gates: a passing validation record of this version whose source hashes equal the files
// published and whose hash of this script is current (WS-V-041); smoke tests in the record
// (WS-V-031, tested browsers, WS-N-001); version above 0.0.0 and a release date; LICENSE and
// NOTICE (W-D1, at publication only); size (WS-N-004); no server code (WS-N-008).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT, listFiles, releaseFiles, hashFiles, hashOfHashes, sha256 } from './site-files.mjs';
import { buildOffline } from './offline.mjs';

const DIST = join(ROOT, 'dist');
const APP = join(DIST, 'riscv');
const BASE = process.env.BASE_PATH ?? '/mavilera/';
const SITE_URL = `${process.env.SITE_ORIGIN ?? 'https://sajidlab.org'}${BASE}`;
const REPO_URL = 'https://github.com/sajidbuet/mavilera';
const preview = process.argv.includes('--preview');
const gates = [];
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const put = (p, text) => { mkdirSync(dirname(join(DIST, p)), { recursive: true }); writeFileSync(join(DIST, p), text); };

const version = JSON.parse(read('package.json')).version;
const conf = JSON.parse(read('site/release.json'));
const files = releaseFiles();
const hashes = hashFiles(files);
const tag = hashOfHashes(hashes).slice(0, 12);
const ASSETS = `assets/${tag}`;

// --- the validation record (WS-V-040/041) -------------------------------------------------------
const recordPath = join(ROOT, 'web-sim-validation.json');
const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null;
let browsers = [];
if (!record) gates.push('web-sim-validation.json missing: run node tools/verify.mjs --smoke (WS-V-040)');
else {
  if (record.pass !== true) gates.push('the validation record does not record a pass (WS-V-041)');
  if (record.version !== version) gates.push(`the validation record is of version ${record.version}, not ${version}`);
  const recorded = record.simulator?.sources?.files ?? {};
  const differ = files.filter((p) => recorded[p] !== hashes[p]);
  if (differ.length) gates.push(`${differ.length} file(s) differ from the validation record, e.g. ${differ.slice(0, 3).join(', ')} (WS-V-041)`);
  for (const t of ['tools/release.mjs', 'tools/offline.mjs', 'tools/site-files.mjs']) {
    if (record.simulator?.tools?.files?.[t] !== sha256(readFileSync(join(ROOT, t)))) gates.push(`${t} changed since the validation record`);
  }
  if (!record.smoke) gates.push('no browser smoke tests in the validation record: run node tools/verify.mjs --smoke (WS-V-031)');
  else browsers = record.smoke.browsers.filter((b) => b.installed && b.results.every((x) => x.ok))
    .map((b) => `${b.name[0].toUpperCase()}${b.name.slice(1)} ${String(b.version).match(/\/(\d+)/)?.[1] ?? b.version}`);
}
if (version === '0.0.0') gates.push('package.json version is 0.0.0: set the release version (W-D18, W-D21)');
if (!conf.date) gates.push('site/release.json has no release date');
if (!browsers.length) gates.push('no browser passed the smoke tests in the record (WS-N-001)');

// --- the application ---------------------------------------------------------------------------
rmSync(DIST, { recursive: true, force: true });
for (const p of files) {
  if (p === 'index.html' || p === 'manifest.webmanifest') continue;
  mkdirSync(dirname(join(APP, ASSETS, p)), { recursive: true });
  cpSync(join(ROOT, p), join(APP, ASSETS, p));
}
const at = (s) => s.replace(/(href|src)="(src|content)\//g, `$1="${ASSETS}/$2/`);
const index = at(read('index.html'))
  .replace('<meta name="application-name" content="MAVILERA RISC-V Laboratory">',
    `<meta name="application-name" content="MAVILERA RISC-V Laboratory">\n  <meta name="risc-vista-edition" content="release">\n  <meta name="risc-vista-version" content="${version}">`)
  .replace('</body>', '  <script>if (\'serviceWorker\' in navigator && isSecureContext) navigator.serviceWorker.register(\'sw.js\').catch(() => {});</script>\n</body>');
if (!index.includes(`src="${ASSETS}/src/main.js"`) || !index.includes('risc-vista-edition')) throw new Error('index.html: unexpected shape');
put('riscv/index.html', index);
const manifest = JSON.parse(read('manifest.webmanifest'));
for (const i of manifest.icons) i.src = `${ASSETS}/${i.src}`;
put('riscv/manifest.webmanifest', `${JSON.stringify(manifest, null, 2)}\n`);

// --- service worker (WS-N-012): the files of this release kept in the browser; index.html is
// fetched from the host first (a cheap revalidation), from the cache when the host is unreachable
const precache = ['./', 'index.html', 'manifest.webmanifest', ...files.filter((p) => p !== 'index.html' && p !== 'manifest.webmanifest').map((p) => `${ASSETS}/${p}`)];
put('riscv/sw.js', `// sw.js -- service worker of MAVILERA RISC-V Laboratory ${version} (spec WS-N-012), written by tools/release.mjs.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
const CACHE = 'mavilera-riscv-${tag}';
const FILES = ${JSON.stringify(precache)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mavilera-riscv-') && k !== CACHE).map((k) => caches.delete(k))))
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

// --- record, licences, offline build, landing page, documentation ----------------------------
if (record) cpSync(recordPath, join(APP, 'web-sim-validation.json'));
for (const name of ['LICENSE', 'NOTICE']) {
  if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(APP, name));
  else gates.push(`${name} missing: added at publication on the author's instruction (W-D1)`);
}
const offlineFile = `mavilera-riscv-${version}.html`;
const offline = buildOffline(ROOT, { files, version });
put(`riscv/${offlineFile}`, offline.html);
for (const s of ['workspace-light.jpg', 'workspace-dark.jpg', 'view-ch08.jpg']) {
  mkdirSync(join(DIST, 'screens'), { recursive: true });
  cpSync(join(ROOT, 'site/screens', s), join(DIST, 'screens', s));
}
if (existsSync(join(ROOT, 'content/help/docs'))) {
  for (const p of listFiles(join(ROOT, 'content/help/docs'))) {
    const to = join(APP, 'docs', p.slice('content/help/docs/'.length));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(ROOT, p), to);
  }
} else gates.push('content/help/docs/ missing: site documentation not yet written (W-D20)');
// the logo files and icons: brand/ for the landing page, icons at the site root for the documentation
for (const p of listFiles(join(ROOT, 'content/branding/mavilera'))) {
  const to = join(DIST, 'brand', p.slice('content/branding/mavilera/'.length));
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(ROOT, p), to);
}
// the architecture registry (site/architectures.json) is the source of the cards; a module is linked
// only when it is available and its build is present, and a planned one must not have a route
const registry = JSON.parse(read('site/architectures.json')).architectures;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cards = registry.map((a) => {
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
const unfilled = '[not built]';
const fields = {
  VERSION: version,
  CARDS: cards,
  SITE_URL,
  REPO_URL,
  DATE: conf.date ?? unfilled,
  BROWSERS: browsers.length ? browsers.join(', ') : unfilled,
  OFFLINE_FILE: offlineFile,
  OFFLINE_SIZE: `${Math.round(Buffer.byteLength(offline.html) / 1024)} kB`,
};
const landing = read('site/index.html').replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => fields[k] ?? m);
const left = landing.match(/\{\{[A-Z_]+\}\}/g);
if (left) gates.push(`landing page fields unfilled: ${[...new Set(left)].join(' ')}`);
put('index.html', landing);
// the icons at the site root, for the documentation (and browsers that ask for /favicon.ico there)
cpSync(join(ROOT, 'content/branding/mavilera/favicon.ico'), join(DIST, 'favicon.ico'));
cpSync(join(ROOT, 'content/branding/mavilera/mavilera-icon-small.svg'), join(DIST, 'icon.svg'));
// GitHub Pages runs Jekyll unless told not to, and Jekyll drops files whose names begin with _
put('.nojekyll', '');
// Cloudflare Pages and Netlify read _headers (WS-N-010); GitHub Pages does not: there a Cloudflare
// Cache Rule on ${BASE}riscv/assets/* sets the long lifetime (docs/DEPLOYMENT.md)
put('_headers', `/riscv/assets/*
  Cache-Control: public, max-age=31556952, immutable
/riscv/sw.js
  Cache-Control: no-cache
/riscv/index.html
  Cache-Control: no-cache
`);

// --- size and server code -----------------------------------------------------------------------
// WS-N-004 counts the site without examples; the teaching templates are examples too
// (and not the validation record or the licence texts, which are published beside the site, not loaded by it)
const appBytes = listFiles(APP, APP).filter((p) => !p.includes('/content/examples/') && !p.includes('/content/templates/')
  && !p.startsWith('docs/') && p !== offlineFile && !['web-sim-validation.json', 'LICENSE', 'NOTICE'].includes(p))
  .reduce((n, p) => n + statSync(join(APP, p)).size, 0);
if (appBytes >= 1024 * 1024) gates.push(`application ${appBytes} bytes without examples, over 1 MB (WS-N-004)`);
if (listFiles(DIST, DIST).some((p) => /^(functions\/|_worker\.js)/.test(p))) gates.push('server code in the output (WS-N-008)');
if (listFiles(DIST, DIST).some((p) => p.endsWith('ch07-jalr.json'))) throw new Error('the JALR answer is in the output (W-D20)');

console.log(`MAVILERA RISC-V Laboratory ${version}: ${listFiles(DIST, DIST).length} files in dist/ (assets ${tag}); application ${Math.round(appBytes / 1024)} kB without examples; offline build ${fields.OFFLINE_SIZE}, ${offline.modules} modules`);
if (gates.length) {
  console.log(`${preview ? 'Not yet releasable' : 'Release refused'}:`);
  for (const g of gates) console.log(`  - ${g}`);
  if (!preview) {
    rmSync(DIST, { recursive: true, force: true });
    process.exit(1);
  }
} else console.log('All release gates pass.');
