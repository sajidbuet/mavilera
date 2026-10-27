// site-files.mjs -- the files of the shipped application (spec §16), shared by the release
// script and the verification record (WS-V-040/041), and SHA-256 helpers.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export const RELEASE_EXCLUDE = (p) => p === 'content/data/ch07-jalr.json' || p.startsWith('content/help/docs/');

/** Files of the development repository that are not published in the public repository (W-D25): the
 *  scripts that read the private book repository, the tests that need it or hold exercise solutions,
 *  the verification script and the publication scripts. The validation record lists them as one group. */
export const PRIVATE_ONLY = (p) => /^tools\/[\w.-]+\.py$/.test(p) || /^tools\/(verify|export-public|make-brand-proposals)\.mjs$/.test(p)
  || p.startsWith('test/fixtures/exercise-solutions/') || /^test\/(rtl|rtl-multi|rtl-pipe|conformance|practice-exercises)\.test\.mjs$/.test(p);

/** The application files of a release. */
export const releaseFiles = (root = ROOT) => shippedFiles(root).filter((p) => !RELEASE_EXCLUDE(p));

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** {path: sha256} of `paths` under `base`. */
export function hashFiles(paths, base = ROOT) {
  return Object.fromEntries(paths.map((p) => [p, sha256(readFileSync(join(base, p)))]));
}

/** One hash over a {path: sha256} map (path and hash of each file, in path order). */
export function hashOfHashes(map) {
  return sha256(Object.keys(map).sort().map((p) => `${map[p]}  ${p}\n`).join(''));
}
