// offline.mjs -- the single-file offline build (spec WS-N-002): the application with every
// module, the style sheet and the content files inlined in one .html that opens from the local
// disk, where browsers refuse to load ES-module files. Used by tools/release.mjs.
//
// The modules use only these forms (checked here; anything else stops the build):
//   import { a, b as c } from './x.js';     export function|class|const ...;
//   import('./x.js')                         import.meta.url
// Each module becomes a function that fills its export object (getters, so that a
// binding reads its current value); an import becomes a lookup of that object, evaluated on
// first use, as ES modules evaluate their dependencies first. import.meta.url becomes the
// module's path under a placeholder origin (https://risc-vista.invalid/, a reserved name that
// never resolves); fetch() of that origin is answered from the inlined content files, and the
// Worker of the run loop is started from a Blob of its own bundle. The page carries the
// release edition mark, so the optional JALR file is not looked for (W-D20).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

export const ORIGIN = 'https://risc-vista.invalid/';
const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Rewrite one module into a definition function; returns {code, deps, exports}. */
export function transform(path, source, { entry = false } = {}) {
  const deps = [];
  const resolve = (spec) => {
    if (!spec.startsWith('./') && !spec.startsWith('../')) throw new Error(`${path}: import of '${spec}' is not relative`);
    return posix.normalize(posix.join(posix.dirname(path), spec));
  };
  const keepLines = (m) => '\n'.repeat(m.split('\n').length - 1);
  let code = source.replace(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?/gm, (m, names, spec) => {
    const p = resolve(spec);
    deps.push(p);
    const binds = names.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [a, b] = s.split(/\s+as\s+/);
      if (!IDENT.test(a) || (b && !IDENT.test(b))) throw new Error(`${path}: cannot read import list {${names}}`);
      return b ? `${a}: ${b}` : a;
    });
    return `const { ${binds.join(', ')} } = __req(${JSON.stringify(p)});${keepLines(m)}`;
  });
  const exports = [];
  code = code.replace(/^export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (m, kw, name) => {
    exports.push(name);
    return `${kw} ${name}`;
  });
  code = code.replace(/\bimport\(\s*'([^']+)'\s*\)/g, (m, spec) => {
    const p = resolve(spec);
    deps.push(p);
    return `__import(${JSON.stringify(p)})`;
  });
  code = code.replace(/\bimport\.meta\.url\b/g, JSON.stringify(ORIGIN + path));
  const left = code.match(/^(import|export)\b.*$/m) ?? code.match(/\bimport\(/);
  if (left) throw new Error(`${path}: unsupported module syntax: ${left[0].slice(0, 80)}`);
  const getters = exports.map((n) => `${n}: { get: () => ${n}, enumerable: true }`).join(', ');
  // an entry module may await at its top level (main.js does); nothing imports it, so its
  // definition can be an async function whose promise nobody waits for
  return {
    code: `__defs[${JSON.stringify(path)}] = ${entry ? 'async ' : ''}function (__e) {\nObject.defineProperties(__e, { ${getters} });\n${code}\n};\n`,
    deps: [...new Set(deps)],
    exports,
  };
}

/** Every module reachable from `entry` (static and dynamic imports), transformed, in a stable order.
 *  `overrides` gives the source of a module in place of its file (one architecture's build, site-files.mjs);
 *  `prepare(path, text)` the text a release publishes (tools/minify.mjs; default the source). */
export function collect(root, entry, overrides = {}, prepare = (p, s) => s) {
  const out = new Map();
  const visit = (p) => {
    if (out.has(p)) return;
    const t = transform(p, prepare(p, overrides[p] ?? readFileSync(join(root, p), 'utf8')), { entry: p === entry });
    out.set(p, t);
    t.deps.forEach(visit);
  };
  visit(entry);
  return out;
}

const RUNTIME = `const __defs = {}, __mods = {};
function __req(p) {
  if (!(p in __mods)) {
    if (!__defs[p]) throw new Error('offline build: no module ' + p);
    __mods[p] = {};
    __defs[p](__mods[p]);
  }
  return __mods[p];
}
const __import = (p) => Promise.resolve().then(() => __req(p));
`;

/** A classic script that defines the modules and runs `entry`. */
function program(mods, entry, prelude = '') {
  return `(() => {\n'use strict';\n${RUNTIME}${prelude}${[...mods.values()].map((m) => m.code).join('')}__req(${JSON.stringify(entry)});\n})();\n`;
}

const TYPES = { '.json': 'application/json', '.svg': 'image/svg+xml', '.s': 'text/plain', '.c': 'text/plain', '.txt': 'text/plain' };
const PRELUDE = `const __files = JSON.parse(document.getElementById('rv-files').textContent);
const __types = ${JSON.stringify(TYPES)};
const __fetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(${JSON.stringify(ORIGIN)})) return __fetch(input, init);
  const p = decodeURIComponent(url.slice(${ORIGIN.length}).split(/[?#]/)[0]);
  if (!(p in __files)) return Promise.resolve(new Response('Not found', { status: 404 }));
  return Promise.resolve(new Response(__files[p], { status: 200, headers: { 'Content-Type': __types[p.slice(p.lastIndexOf('.'))] ?? 'text/plain' } }));
};
const __Worker = window.Worker;
window.Worker = class extends __Worker {
  constructor(url, opts) {
    if (String(url) === ${JSON.stringify(`${ORIGIN}src/worker/run.js`)}) {
      super(URL.createObjectURL(new Blob([document.getElementById('rv-worker').textContent], { type: 'text/javascript' })));
    } else super(url, opts);
  }
};
`;

/** Code safe inside a <script> element (no end tag, no comment opener: the build stops on either). */
const scriptSafe = (s) => {
  if (/<\/script|<!--/i.test(s)) throw new Error('offline build: "</script" or "<!--" in the code');
  return s;
};
/** JSON safe inside a <script> element: every < escaped (only strings can hold one). */
const jsonSafe = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

/**
 * The offline page.
 * @param {string} root repository root
 * @param {{files: string[], version: string, overrides?: Record<string, string>, page?: string}} o files: the shipped
 *   files (content/ text files are inlined); overrides: module sources of one architecture's build; page: its index.html;
 *   prepare: as for collect()
 * @returns {{html: string, modules: number}}
 */
export function buildOffline(root, { files, version, overrides = {}, page, prepare = (p, s) => s }) {
  const main = collect(root, 'src/main.js', overrides, prepare);
  const worker = collect(root, 'src/worker/run.js', overrides, prepare);
  const content = Object.fromEntries(files.filter((p) => p.startsWith('content/') && Object.hasOwn(TYPES, p.slice(p.lastIndexOf('.'))))
    .map((p) => [p, prepare(p, readFileSync(join(root, p), 'utf8'))]));
  const css = prepare('src/ui/theme.css', readFileSync(join(root, 'src/ui/theme.css'), 'utf8'));
  const icon = readFileSync(join(root, 'content/branding/mavilera/mavilera-icon.svg'), 'utf8');
  const index = page ?? readFileSync(join(root, 'index.html'), 'utf8');
  const body = index.slice(index.indexOf('<body>') + 6, index.lastIndexOf('</body>'));
  const title = index.match(/<title>([^<]*)<\/title>/)[1];
  const description = index.match(/<meta name="description" content="([^"]*)">/)[1];
  const name = index.match(/<meta name="application-name" content="([^"]*)">/)[1];
  const html = `<!doctype html>
<!--
  ${name} ${version}, single-file offline build (spec WS-N-002), made by tools/release.mjs from the
  sources recorded in web-sim-validation.json. Opens from the local disk; makes no network request.
  Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
  The name and logo are not licensed as trademarks (TRADEMARKS.md).
-->
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="application-name" content="${name}">
  <meta name="risc-vista-edition" content="release">
  <meta name="risc-vista-version" content="${version}">
  <meta name="theme-color" content="#0b2a55">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}">
  <style>
${css}
  </style>
</head>
<body>${body}
<script type="application/json" id="rv-files">${jsonSafe(content)}</script>
<script type="text/plain" id="rv-worker">${scriptSafe(program(worker, 'src/worker/run.js'))}</script>
<script>
${scriptSafe(program(main, 'src/main.js', PRELUDE))}</script>
</body>
</html>
`;
  return { html, modules: main.size, mainModules: [...main.keys()], workerModules: [...worker.keys()] };
}
