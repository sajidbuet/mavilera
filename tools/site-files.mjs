// site-files.mjs -- the files of the shipped application (spec §16) and of each architecture's build (W-D29),
// shared by the release script and the verification record (WS-V-040/041), and SHA-256 helpers.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './offline.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every file below `dir`, as paths relative to `base` with forward slashes, sorted. */
export function listFiles(dir, base = ROOT) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(base, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** The application as published: index.html, the manifest, src/ and content/ without the
 *  reserved Pip folder, the logo's TeX master and the Markdown notes. */
export function shippedFiles(root = ROOT) {
  return ['index.html', 'manifest.webmanifest',
    ...listFiles(join(root, 'src'), root), ...listFiles(join(root, 'content'), root)]
    .filter((p) => !p.startsWith('content/pip/') && !p.startsWith('content/branding/source/') && !p.endsWith('.md'));
}

/** Shipped files that a release leaves out: the optional JALR state, which is the answer of an
 *  exercise (spec W-D20), and the site documentation, published beside the application. */
export const RELEASE_EXCLUDE = (p) => p === 'content/data/ch07-jalr.json' || /^content\/(?:[\w-]+\/)?help\/docs\//.test(p);

/** Files of the development repository that are not published in the public repository (W-D25): the
 *  scripts that read the private book repository, the tests that need it or hold exercise solutions,
 *  the verification script and the publication scripts. The validation record lists them as one group. */
export const PRIVATE_ONLY = (p) => /^tools\/[\w.-]+\.py$/.test(p) || /^tools\/(verify|export-public|make-brand-proposals)\.mjs$/.test(p)
  || p.startsWith('test/fixtures/exercise-solutions/') || /^test\/(rtl|rtl-multi|rtl-pipe|conformance|priv-conformance|practice-exercises|sap[12]-exercises|armv7-exercises)\.test\.mjs$/.test(p);

/** The application files of a release. */
export const releaseFiles = (root = ROOT) => shippedFiles(root).filter((p) => !RELEASE_EXCLUDE(p));

/** The architecture registry of the landing page (site/architectures.json). */
export const registry = (root = ROOT) => JSON.parse(readFileSync(join(root, 'site/architectures.json'), 'utf8')).architectures;

/** The modules one architecture's build replaces (spec W-D29, phase 6): a registry of that architecture alone (its line
 *  of src/arch/registry.js) and the architecture id fixed, so that the page needs no `?arch=` and reaches no other
 *  architecture's modules. */
export function archOverrides(id, root = ROOT) {
  const key = /^[A-Za-z_$][\w$]*$/.test(id) ? id : `'${id}'`;
  const line = readFileSync(join(root, 'src/arch/registry.js'), 'utf8').split('\n').find((l) => l.trimStart().startsWith(`${key}: () => import(`));
  if (!line) throw new Error(`src/arch/registry.js: no architecture ${id}`);
  const head = (what) => `// ${what} -- written by tools/release.mjs for the ${id} build (spec W-D29, phase 6).\n`
    + '// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.\n// Rights class: code.\n\n';
  return {
    'src/arch/registry.js': `${head('registry.js')}export const ARCHITECTURES = Object.freeze({\n${line}\n});\n`,
    'src/shell/arch-id.js': `${head('arch-id.js')}export const ARCH_ID = ${JSON.stringify(id)};\n`,
  };
}

/** The application files of one architecture (phase 6): the page, its manifest and style sheet, the modules reached
 *  from the page and the Worker with the architecture's overrides, the shared logo files and the content folders of
 *  its registry entry (`content`), without what a release leaves out. Returns the files and the overrides. */
export function archFiles(id, root = ROOT) {
  const entry = registry(root).find((a) => a.id === id);
  if (!entry?.content?.length) throw new Error(`site/architectures.json: ${id} names no content folders`);
  const overrides = archOverrides(id, root);
  const mods = new Set([...collect(root, 'src/main.js', overrides).keys(), ...collect(root, 'src/worker/run.js', overrides).keys()]);
  const page = new Set(['index.html', 'manifest.webmanifest', 'src/ui/theme.css']);
  // of the logo files, those the page, the manifest or a module names (icons, header lockup, about box; WS-N-004:
  // the others, the social preview and the variants for print, are the landing page's and the repository's)
  const named = new Set([...page, ...mods].flatMap((p) => readFileSync(join(root, p), 'utf8')
    .match(/\b(?:mavilera[\w-]*|icon-[\w-]+|apple-touch-icon|favicon)\.(?:svg|png|ico)\b/g) ?? []));
  const brand = (p) => p.startsWith('content/branding/mavilera/') && named.has(p.slice('content/branding/mavilera/'.length));
  const files = releaseFiles(root).filter((p) => page.has(p) || mods.has(p) || brand(p) || entry.content.some((c) => p.startsWith(c)));
  const missing = [...mods].filter((p) => !files.includes(p));
  if (missing.length) throw new Error(`${id}: modules outside the release files: ${missing.join(', ')}`);
  return { files, overrides };
}

/** The page and manifest of one architecture's build: the development index.html and manifest named after the
 *  architecture (`appFull`, its strings); an architecture whose page this is not also takes the registry entry's
 *  description. Returns {page: text, manifest: object}. */
export function archPage(entry, { appName, appFull }, root = ROOT) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const dev = readFileSync(join(root, 'index.html'), 'utf8');
  const name = `${appName} ${appFull}`;
  const own = dev.includes(`<meta name="application-name" content="${esc(name)}">`);
  if (!own && !entry.description) throw new Error(`site/architectures.json: ${entry.id} has no description`);
  const set = (s, re, v) => { if (!re.test(s)) throw new Error(`index.html: unexpected shape (${re})`); return s.replace(re, `$1${esc(v)}$2`); };
  let page = set(dev, /(<title>)[^<]*(<\/title>)/, `${appName}: ${appFull}`);
  page = set(page, /(<meta name="application-name" content=")[^"]*(">)/, name);
  page = set(page, /(index\.html -- application shell of )[^\n]*?(\.\n)/, name);
  if (!own) page = set(page, /(<meta name="description" content=")[^"]*(">)/, `${name}: ${entry.description}`);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  manifest.name = `${appName}: ${appFull}`;
  if (!own) manifest.description = entry.description;
  return { page, manifest };
}

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** {path: sha256} of `paths` under `base`. */
export function hashFiles(paths, base = ROOT) {
  return Object.fromEntries(paths.map((p) => [p, sha256(readFileSync(join(base, p)))]));
}

/** One hash over a {path: sha256} map (path and hash of each file, in path order). */
export function hashOfHashes(map) {
  return sha256(Object.keys(map).sort().map((p) => `${map[p]}  ${p}\n`).join(''));
}
