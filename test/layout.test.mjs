// layout.test.mjs -- repository rules that must hold from the first commit:
// copyright line and rights class in every file (spec C9, WS-N-006), Pip
// assets only in content/pip/ and listed (WS-U-044), no licence files before
// publication (W-D1), no server-side code (WS-N-008), no third-party network
// references in the shipped site (WS-N-005).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const COPYRIGHT = /Copyright \(c\) 20\d\d(?:[-–]20\d\d)? Sajid Muhaimin Choudhury\. Licensed under the Apache License, Version 2\.0\./;
const PIP_LINE = 'Pip character design and artwork © Sajid Muhaimin Choudhury. All rights reserved. Not covered by the code licence.';
const COMMENTED = new Set(['.js', '.mjs', '.css', '.html']);
const IMAGES = new Set(['.svg', '.png', '.webp', '.jpg', '.jpeg', '.gif', '.ico']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(relative(ROOT, path).split(sep).join('/'));
  }
  return out;
}

const FILES = walk(ROOT);

function rightsClass(path) {
  if (path.startsWith('content/pip/')) return 'pip';
  if (path.startsWith('content/')) return 'content';
  return 'code';
}

test('every code and content file carries the copyright line and its rights class', () => {
  const bad = [];
  for (const path of FILES) {
    const ext = extname(path).toLowerCase();
    const text = () => readFileSync(join(ROOT, path), 'utf8');
    if (/^src\/(?:arch\/[\w-]+\/)?vendor\//.test(path)) continue; // third-party code, checked below (pico2 P1-F3)
    if (COMMENTED.has(ext)) {
      const t = text();
      const cls = rightsClass(path);
      if (!COPYRIGHT.test(t)) bad.push(`${path}: no copyright line`);
      else if (cls !== 'pip' && !t.includes(`Rights class: ${cls}.`)) bad.push(`${path}: missing "Rights class: ${cls}."`);
    } else if (ext === '.json' && path.startsWith('content/')) {
      const copyright = JSON.parse(text())._copyright ?? '';
      if (!COPYRIGHT.test(copyright)) bad.push(`${path}: no "_copyright" field`);
    }
  }
  assert.deepEqual(bad, []);
});

// pico2 P1-F3 (research D20, ADR-0010 option A): third-party code vendored into the shipped site lives in a module's own
// src/arch/<id>/vendor/<name>/ (W-D29; or src/vendor/<name>/ for the shell) with its LICENSE and a VENDOR.json naming the pinned commit and each file's SHA-256; every file is byte-identical to that list (no
// local changes), and THIRD_PARTY.md (the commit) and NOTICE (the name) list the component
test('vendored third-party code is unchanged, licensed and listed', async () => {
  const { createHash } = await import('node:crypto');
  const bad = [];
  const dirs = [...new Set(FILES.map((p) => /^(src\/(?:arch\/[\w-]+\/)?vendor\/[^/]+)\//.exec(p)?.[1]).filter(Boolean))];
  const third = readFileSync(join(ROOT, 'THIRD_PARTY.md'), 'utf8'), notice = readFileSync(join(ROOT, 'NOTICE'), 'utf8');
  for (const d of dirs) {
    const base = d;
    if (!existsSync(join(ROOT, base, 'VENDOR.json')) || !existsSync(join(ROOT, base, 'LICENSE'))) { bad.push(`${base}: VENDOR.json and LICENSE needed`); continue; }
    const v = JSON.parse(readFileSync(join(ROOT, base, 'VENDOR.json'), 'utf8'));
    for (const p of FILES.filter((x) => x.startsWith(`${base}/`) && x !== `${base}/VENDOR.json`)) {
      const name = p.slice(base.length + 1);
      const h = createHash('sha256').update(readFileSync(join(ROOT, p))).digest('hex');
      if (v.files?.[name] !== h) bad.push(`${p}: not the pinned bytes`);
    }
    for (const name of Object.keys(v.files ?? {})) if (!existsSync(join(ROOT, base, name))) bad.push(`${base}/${name}: missing`);
    if (!third.includes(v.commit) || !notice.includes(base)) bad.push(`${base}: THIRD_PARTY.md (commit) and NOTICE must name it`);
  }
  assert.deepEqual(bad, []);
});

test('Pip artwork only in content/pip/, listed and marked', () => {
  const listed = readFileSync(join(ROOT, 'content/pip/ASSETS.md'), 'utf8');
  const bad = [];
  for (const path of FILES) {
    const ext = extname(path).toLowerCase();
    if (!IMAGES.has(ext)) continue;
    if (path.startsWith('content/pip/')) {
      const name = path.slice('content/pip/'.length);
      if (!listed.includes(name)) bad.push(`${path}: not listed in content/pip/ASSETS.md`);
      if (ext === '.svg' && !readFileSync(join(ROOT, path), 'utf8').includes(PIP_LINE)) {
        bad.push(`${path}: SVG lacks the Pip rights line`);
      }
    } else if (/pip/i.test(path.split('/').pop())) {
      bad.push(`${path}: Pip artwork outside content/pip/`);
    }
  }
  assert.deepEqual(bad, []);
});

test('LICENSE is the Apache License 2.0; NOTICE and TRADEMARKS.md exist (W-D25)', () => {
  assert.match(readFileSync(join(ROOT, 'LICENSE'), 'utf8'), /Apache License\s+Version 2\.0, January 2004/);
  assert.match(readFileSync(join(ROOT, 'NOTICE'), 'utf8'), /Apache License, Version 2\.0/);
  assert.equal(existsSync(join(ROOT, 'TRADEMARKS.md')), true);
});

test('no server-side code (WS-N-008)', () => {
  assert.equal(existsSync(join(ROOT, 'functions')), false, 'functions/ directory present');
  assert.deepEqual(FILES.filter((p) => p.split('/').pop() === '_worker.js'), []);
});

test('shipped site makes no third-party network references (WS-N-005)', () => {
  const external = [
    /\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i,
    /\bfrom\s+["']\s*(?:https?:)?\/\//i,
    /\b(?:import|fetch)\s*\(\s*["']\s*(?:https?:)?\/\//i,
    /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i,
  ];
  const bad = [];
  for (const path of FILES) {
    if (!(path === 'index.html' || path.startsWith('src/'))) continue;
    if (!COMMENTED.has(extname(path).toLowerCase())) continue;
    const t = readFileSync(join(ROOT, path), 'utf8');
    if (external.some((re) => re.test(t))) bad.push(path);
  }
  assert.deepEqual(bad, []);
});
