// release-zips.mjs -- the two downloads of a MAVILERA release, attached to its GitHub release (author, 2026-11-05: the
// download page links to the release, the site does not host the archives):
//   mavilera-<version>-offline.zip   every laboratory as one HTML file (tools/offline.mjs) and a start page; unzip and
//                                    open index.html: no server, no network (WS-N-002)
//   mavilera-<version>-site.zip      the complete site (laboratories, documentation, landing pages); it needs a local
//                                    web server, since browsers do not load ES modules from files opened directly
// from a built site (default dist/, after `npm run release`), into release-assets/ (not tracked).
//   node tools/release-zips.mjs [--site dist] [--version 1.2.0] [--out release-assets]
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SITE = join(ROOT, opt('--site', 'dist'));
const VERSION = opt('--version', JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
const OUT = join(ROOT, opt('--out', 'release-assets'));
const COPYRIGHT = 'Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.';
if (!existsSync(join(SITE, 'index.html'))) throw new Error(`no built site in ${SITE} (run npm run release first)`);

const walk = (dir) => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const registry = JSON.parse(readFileSync(join(ROOT, 'site/architectures.json'), 'utf8'));
const names = Object.fromEntries(registry.architectures.map((a) => [a.path.replace(/\/$/, ''), `${a.name} Laboratory`]));
// the landing page's order (site/architectures.json `landing`); folders it does not name come last
const rank = (dir) => { const a = registry.architectures.find((x) => x.path === `${dir}/`); const i = (registry.landing ?? []).indexOf(a?.id); return i < 0 ? 1e9 : i; };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// the single-file laboratories of this release: <module>/mavilera-<id>-<version>.html, in the site's folder order
const singles = readdirSync(SITE).filter((d) => statSync(join(SITE, d)).isDirectory())
  .flatMap((d) => readdirSync(join(SITE, d)).filter((f) => f === `mavilera-${d}-${VERSION}.html`).map((f) => ({ dir: d, file: f })))
  .sort((x, y) => rank(x.dir) - rank(y.dir));
if (!singles.length) throw new Error(`no single-file laboratory of version ${VERSION} in ${SITE}`);
const licence = ['LICENSE', 'NOTICE'].map((f) => [f, join(SITE, singles[0].dir, f)]).filter(([, p]) => existsSync(p));

const start = `<!doctype html>
<!-- MAVILERA ${VERSION}: the start page of the offline download (tools/release-zips.mjs). ${COPYRIGHT} -->
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MAVILERA ${VERSION}, offline</title>
<style>
  :root { --bg: #f2f5fa; --surface: #fff; --border: #d8e0eb; --text: #0b2a55; --text-2: #5a6b82; --primary: #1a4f8b; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a1120; --surface: #101a2b; --border: #24344d; --text: #e3eaf4; --text-2: #94a5bd; --primary: #5b9bd5; color-scheme: dark; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 40px 16px; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  p { color: var(--text-2); }
  ul { list-style: none; padding: 0; display: grid; gap: 10px; }
  li a { display: block; padding: 14px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; color: var(--primary); font-weight: 600; text-decoration: none; }
  li a:hover, li a:focus-visible { border-color: var(--primary); }
  :focus-visible { outline: 3px solid #a85a00; outline-offset: 2px; }
  small { color: var(--text-2); }
</style>
</head>
<body>
<main>
  <h1>MAVILERA ${VERSION}</h1>
  <p>Each laboratory is one file that runs in your browser without a network connection. Open one:</p>
  <ul>
${singles.map((s) => `    <li><a href="${esc(s.file)}">${esc(names[s.dir] ?? s.dir)}</a></li>`).join('\n')}
  </ul>
  <p><small>Online: <a href="https://sajidlab.org/mavilera/">sajidlab.org/mavilera</a> · source: <a href="https://github.com/sajidbuet/mavilera">github.com/sajidbuet/mavilera</a>.
    A simulation is a teaching model; it is not evidence of how a hardware implementation behaves.
    ${COPYRIGHT}</small></p>
</main>
</body>
</html>
`;
const readmeOffline = `MAVILERA ${VERSION}: the laboratories for offline use

Open index.html in a web browser (double-click it), then choose a laboratory.
Each laboratory is a single HTML file and needs no installation, server or network.

Online: https://sajidlab.org/mavilera/
Source: https://github.com/sajidbuet/mavilera

${COPYRIGHT} See LICENSE and NOTICE.
`;
const readmeSite = `MAVILERA ${VERSION}: the complete site (laboratories, documentation and landing pages)

Browsers do not load this site's program modules from files opened directly, so serve this folder
with a local web server and open the address it gives. For example, with Python 3, in this folder:

    python -m http.server 8000

then open http://localhost:8000/ in a web browser. Any static web server works.
To use a laboratory without a server, download mavilera-${VERSION}-offline.zip instead.

Online: https://sajidlab.org/mavilera/
Source: https://github.com/sajidbuet/mavilera

${COPYRIGHT} See LICENSE and NOTICE.
`;

const offTop = `mavilera-${VERSION}-offline`;
const offline = [
  { name: `${offTop}/index.html`, data: Buffer.from(start) },
  { name: `${offTop}/README.txt`, data: Buffer.from(readmeOffline) },
  ...singles.map((s) => ({ name: `${offTop}/${s.file}`, data: readFileSync(join(SITE, s.dir, s.file)) })),
  ...licence.map(([f, p]) => ({ name: `${offTop}/${f}`, data: readFileSync(p) })),
];
const siteTop = `mavilera-${VERSION}`;
const site = [
  { name: `${siteTop}/README.txt`, data: Buffer.from(readmeSite) },
  ...licence.map(([f, p]) => ({ name: `${siteTop}/${f}`, data: readFileSync(p) })),
  ...walk(SITE).map((p) => relative(SITE, p).split('\\').join('/')).sort()
    .map((rel) => ({ name: `${siteTop}/${rel}`, data: readFileSync(join(SITE, rel)) })),
];
mkdirSync(OUT, { recursive: true });
for (const [file, entries] of [[`${offTop}.zip`, offline], [`mavilera-${VERSION}-site.zip`, site]]) {
  const buf = zip(entries);
  writeFileSync(join(OUT, file), buf);
  console.log(`${relative(ROOT, join(OUT, file))}: ${entries.length} files, ${Math.round(buf.length / 1024)} kB`);
}
