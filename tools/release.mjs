// release.mjs -- builds the published site in dist/, which GitHub Pages serves as
// https://sajidlab.org/mavilera/ (BASE_PATH, default /mavilera/; every path in the output is relative):
//   index.html                     MAVILERA landing page (site/index.html with the tiles and learning paths of site/architectures.json)
//   docs/index.html                the documentation page (site/docs.html): each laboratory's guide and offline version
//   download/index.html            the download page (site/download.html): links to the archives of the GitHub release
//                                  v<version> (tools/release-zips.mjs makes them) and the single files
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
import { heroSvg, heroCss } from './logo/hero-logo.mjs';
import { PLATFORM_ARCHS } from '../src/shell/platform-archs.js';

const DIST = join(ROOT, 'dist');
const SIZE_LIMIT = 2097152; // WS-N-004 as raised by W-D38 (draft, 2026-11-04; 1.25 MB by W-D31): 2 MB per application, without examples
const BASE = process.env.BASE_PATH ?? '/mavilera/';
const SITE_URL = `${process.env.SITE_ORIGIN ?? 'https://sajidlab.org'}${BASE}`;
const REPO_URL = 'https://github.com/sajidbuet/mavilera';
const preview = process.argv.includes('--preview');
// a beta (author, 2026-11-15: 1.7.0-beta.1 at /mavilera/beta/): the pages carry <meta name="mavilera-channel" content="beta">,
// so the development editions are offered (pico2's Pico Full with board loading), and every page says it is a beta.
// --pico-full <staged folder> (tools/pico-full/stage.mjs; research D58 hosting rules, release-gates doc §5) publishes the
// compiler download beside the Pico 2 page: current.json, <version>/manifest.json, the two .gz files and licences/ only
const BETA = process.argv.includes('--beta');
const argOf = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const PICO_FULL = argOf('--pico-full');
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
if (/-beta\b/.test(version) !== BETA) gates.push(BETA ? `--beta needs a beta version (package.json: ${version})` : `version ${version} is a beta: build it with --beta`);
if (PICO_FULL && !BETA) gates.push('--pico-full publishes Pico Full, a development edition: only in a beta until its gates pass (D29, F3-5)');
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
      `$1\n  <meta name="risc-vista-edition" content="release">\n  <meta name="risc-vista-version" content="${version}">${BETA ? '\n  <meta name="mavilera-channel" content="beta">' : ''}`)
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

  // Pico Full's compiler download (beta only): beside the page, where the client looks for it (full/client.js: pico-full/)
  if (PICO_FULL && a.id === 'pico2') b.picoFull = publishPicoFull(PICO_FULL, join(APP, 'pico-full'));
  // size: WS-N-004 counts the site without examples; the teaching templates are examples too
  // (and not the validation record or the licence texts, which are published beside the site, not loaded by it;
  // nor Pico Full's optional download, ADR-0012: outside the module's budget)
  b.bytes = listFiles(APP, APP).filter((p) => !/\/content\/(?:[\w-]+\/)?(?:examples|templates)\//.test(p)
    && !p.startsWith('docs/') && !p.startsWith('pico-full/') && p !== b.offlineFile && !['web-sim-validation.json', 'LICENSE', 'NOTICE'].includes(p))
    .reduce((n, p) => n + statSync(join(APP, p)).size, 0);
  if (b.bytes >= SIZE_LIMIT) gates.push(`${a.id}: application ${b.bytes} bytes without examples, over 2 MB (WS-N-004, W-D38)`);
  headers.push(`/${a.path}assets/*\n  Cache-Control: public, max-age=31556952, immutable\n/${a.path}sw.js\n  Cache-Control: no-cache\n/${a.path}index.html\n  Cache-Control: no-cache\n`);
  if (b.picoFull) headers.push(`/${a.path}pico-full/${b.picoFull.version}/*\n  Cache-Control: public, max-age=31556952, immutable\n/${a.path}pico-full/current.json\n  Cache-Control: no-cache\n`);
}
if (PICO_FULL && !builds.some((b) => b.picoFull)) gates.push('--pico-full: the pico2 module is not in this build');

/**
 * Publish a staged Pico Full folder (research D58, §5 rule 1): current.json, the current version's manifest, its compiler and
 * pack (.gz, as staged: the page decodes them) and licences/; nothing else (no raw .wasm or .bin). Each file is checked against
 * the manifest (transfer size; the SHA-256 there is of the decoded bytes, checked by the page). Returns {version, bytes}.
 */
function publishPicoFull(from, to) {
  const cur = JSON.parse(readFileSync(join(from, 'current.json'), 'utf8'));
  const man = JSON.parse(readFileSync(join(from, cur.manifest), 'utf8'));
  const dir = posix.dirname(cur.manifest);
  if (man.version !== cur.version || dir !== cur.version) throw new Error(`--pico-full: current.json names ${cur.version}, its manifest ${man.version}`);
  const files = [cur.manifest, `${dir}/${man.compiler.file}`, `${dir}/${man.pack.file}`];
  for (const [f, e] of [[man.compiler.file, man.compiler], [man.pack.file, man.pack]]) {
    if (!/\.gz$/.test(f) || e.encoding !== 'gzip') gates.push(`--pico-full: ${f} is not a .gz file (D58 rule 1)`);
    const size = statSync(join(from, dir, f)).size;
    if (size !== e.transferBytes) gates.push(`--pico-full: ${f} is ${size} bytes, the manifest says ${e.transferBytes}`);
  }
  for (const p of listFiles(join(from, dir, 'licences'))) files.push(`${dir}/licences/${posix.basename(p)}`);
  if (!files.some((f) => f.endsWith('/licences/LICENCES.txt'))) gates.push('--pico-full: licences/LICENCES.txt missing');
  mkdirSync(to, { recursive: true });
  cpSync(join(from, 'current.json'), join(to, 'current.json'));
  for (const f of files) { mkdirSync(dirname(join(to, f)), { recursive: true }); cpSync(join(from, f), join(to, f)); }
  const bytes = files.reduce((n, f) => n + statSync(join(to, f)).size, 0);
  console.log(`  pico2/pico-full/: ${cur.version}, ${files.length + 1} files, ${Math.round(bytes / 1048576)} MB`);
  return { version: cur.version, bytes };
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
// the architecture registry (site/architectures.json) is the source of the landing page's tiles and learning paths and
// of the documentation page; a module is linked only when it is available and its build is present, and a planned one
// must not have a route. Minimal layout (author, 2026-11-05): each laboratory once, as one tile; the planned ones in
// one line; the learning paths by topic; documentation, offline versions and the release record on docs/.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const site = JSON.parse(read('site/architectures.json'));
const tools = site.tools ?? [];
// a module's name lockup (chip and name) where one exists (author, 2026-11-04); `alt` names the link it stands in.
// The file is the one the header switcher names (src/shell/platform-archs.js), since it is not always
// mavilera-name-<id>.svg: the 8086's is mavilera-name-8086.svg (its id is i8086), fixed 2026-11-11.
const nameFile = (id) => PLATFORM_ARCHS.find((a) => a.id === id)?.logo ?? `mavilera-name-${id}.svg`;
const logoOf = (id, cls, alt, up = '') => (existsSync(join(ROOT, 'content/branding/mavilera', nameFile(id)))
  ? `<img class="${cls}" src="${up}brand/${nameFile(id)}" alt="${esc(alt)}" width="${(/viewBox="0 0 (\d+) 192"/.exec(read(`content/branding/mavilera/${nameFile(id)}`)) ?? [0, 820])[1]}" height="192">` : '');
// the laboratories that can be opened: the built modules and the tools inside them (the NPU in RISC-V, which links into it)
const labOf = new Map();
for (const a of registry()) {
  const built = existsSync(join(DIST, a.path, 'index.html'));
  if (a.status === 'available' && !built) gates.push(`registry: ${a.id} is available but ${a.path}index.html is not built`);
  if (a.status !== 'available' && built) gates.push(`registry: ${a.id} is ${a.status} but its build is present`);
  if (a.status === 'available') labOf.set(a.id, { ...a, href: a.path, build: builds.find((b) => b.entry.id === a.id) });
}
for (const t of tools) {
  const m = labOf.get(t.module);
  if (!m) gates.push(`registry: the tool ${t.id} lives in ${t.module}, which is not available`);
  else labOf.set(t.id, { ...t, href: t.path, within: m.name });
}
for (const [id, e] of labOf) if (!e.tagline) gates.push(`registry: ${id} needs a tagline for its landing tile`);
// the order of the registry's `landing` list (author, 2026-11-05: three to a row): every module and tool once
const planned = registry().filter((a) => a.status !== 'available');
const order = site.landing ?? [...labOf.keys(), ...planned.map((a) => a.id)];
const named = [...labOf.keys(), ...planned.map((a) => a.id)];
const unordered = named.filter((id) => !order.includes(id));
const unknown = order.filter((id) => !named.includes(id));
if (unordered.length || unknown.length || new Set(order).size !== order.length) {
  gates.push(`registry: the landing order must name every module and tool once (missing: ${unordered.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'})`);
}
const labIds = [...order.filter((id) => labOf.has(id)), ...unordered.filter((id) => labOf.has(id))];
const labName = (e) => `${e.name} Laboratory`;
const tagsOf = (e) => `${e.preview ? '<span class="status preview">Preview</span>' : ''}${e.within ? `<span class="status">In ${esc(e.within)}</span>` : ''}`;
const tile = (e) => `          <article class="lab"><h3><a class="lab-link" href="${esc(e.href)}">${logoOf(e.id, 'lab-logo', labName(e)) || esc(labName(e))}</a></h3>
            <p class="lab-tagline">${esc(e.tagline ?? '')}</p>
            <p class="lab-meta">${tagsOf(e)}${e.docs ? `<a href="${e.docs}">Documentation</a>` : ''}<span class="lab-go" aria-hidden="true">Open →</span></p></article>`;
const plannedNames = order.map((id) => planned.find((a) => a.id === id)).filter(Boolean).map((a) => esc(a.name));
// the learning paths by topic (author, 2026-11-05): each step opens a laboratory and names the view to choose there
const learn = (site.learn ?? []).map((p) => `          <article class="path"><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p>
            <ol class="steps">
${p.steps.map((s) => {
    const e = labOf.get(s.lab);
    if (!e) { gates.push(`learn: "${p.title}" opens ${s.lab}, which is not available`); return ''; }
    return `              <li><a href="${esc(e.href)}">${esc(e.name)}</a>${s.view ? ` <span class="step-view">· ${esc(s.view)} view</span>` : ''}<span class="step-text">${esc(s.text)}</span></li>`;
  }).filter(Boolean).join('\n')}
            </ol></article>`).join('\n');
if (!site.learn?.length) gates.push('learn: the registry names no learning path');
// the documentation page: each laboratory's guide (or that it has none yet) and its single-file offline version
const kB = (b) => Math.round(Buffer.byteLength(b.offline.html) / 1024);
const docCard = (e) => `          <article class="doc"><h3>${logoOf(e.id, 'doc-logo', labName(e), '../') || esc(labName(e))}${tagsOf(e)}</h3>
            <ul>
              <li>${e.docs ? `<a href="../${e.docs}">Documentation</a>` : '<span class="none">Documentation: not yet available</span>'}</li>
              <li><a href="../${esc(e.href)}">Open the laboratory</a></li>
              <li>${e.build ? `<a href="../${e.path}${e.build.offlineFile}" download>Offline version</a> (${kB(e.build)} kB)` : '<span class="none">No separate offline version</span>'}</li>
            </ul></article>`;
const unfilled = '[not built]';
// the release channel's note on the landing, documentation and download pages (author, 2026-11-15). The pages of a beta are one
// folder below the stable site (BASE_PATH /mavilera/beta/), so `..` from the beta's root is the stable site; `up` reaches the
// beta's root from a page in a sub-folder (docs/, download/)
const channelNote = (up) => (BETA
  ? `        <p class="channel-note" role="note"><strong>Beta ${esc(version)}:</strong> Pico Full with loading onto a real Pico 2 (the Hardware tab), to be tested; board loading has not yet been tried on a real board. For teaching, use the <a href="${up}../">stable release</a>. Report problems on <a href="${REPO_URL}/issues">GitHub</a>.</p>`
  : conf.beta ? `        <p class="channel-note" role="note"><strong>Try the beta ${esc(conf.beta.version)}:</strong> ${esc(conf.beta.summary)} <a href="${up}${esc(conf.beta.path)}">Open the beta</a>.</p>` : '');
const fields = {
  SITE_CSS: read('site/site.css'),
  VERSION: version,
  SITE_URL,
  REPO_URL,
  DATE: conf.date ?? unfilled,
  BROWSERS: browsers.length ? browsers.join(', ') : unfilled,
  // the hero's animated lockup (variant A, approved 2026-11-05): the same parts and CSS as the tools' loading screen
  HERO_LOGO: heroSvg(read('content/branding/mavilera/mavilera-lockup.svg'), { label: 'MAVILERA' }),
  HERO_CSS: heroCss(),
  LABS: labIds.map((id) => tile(labOf.get(id))).join('\n'),
  COMING: plannedNames.length ? `        <p class="coming">Coming: ${plannedNames.join(' · ')}</p>` : '',
  LEARN: learn,
  DOC_CARDS: labIds.map((id) => docCard(labOf.get(id))).join('\n'),
  MODULES: builds.map((b) => esc(labName(b.entry))).join(', '),
  // the download page (author, 2026-11-05): the archives of tools/release-zips.mjs live on the GitHub release v<version>,
  // not on the site; the single files are the site's own
  RELEASES_URL: `${REPO_URL}/releases`,
  RELEASE_URL: `${REPO_URL}/releases/tag/v${version}`,
  ZIP_OFFLINE: `${REPO_URL}/releases/download/v${version}/mavilera-${version}-offline.zip`,
  ZIP_SITE: `${REPO_URL}/releases/download/v${version}/mavilera-${version}-site.zip`,
  SINGLE_FILES: builds.map((b) => `          <li><a href="../${b.entry.path}${b.offlineFile}" download>${esc(labName(b.entry))}</a> (${kB(b)} kB)</li>`).join('\n'),
};
const fill = (template, out) => {
  const f = { ...fields, CHANNEL_NOTE: channelNote(out.includes('/') ? '../' : '') };
  const page = read(template).replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => f[k] ?? m);
  const left = page.match(/\{\{[A-Z_]+\}\}/g);
  if (left) gates.push(`${template}: fields unfilled: ${[...new Set(left)].join(' ')}`);
  put(out, page);
};
fill('site/index.html', 'index.html');
fill('site/docs.html', 'docs/index.html');
fill('site/download.html', 'download/index.html');
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
