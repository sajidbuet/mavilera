// stage.mjs -- step 8 of the Pico Full toolchain (pico2 P1-F2, research D33 Q1): the folder that is published with the
// site, `out/site/pico-full/`:
//   current.json                      {version, manifest}                      (fetched each time online; small)
//   <version>/manifest.json           {version, compiler, pack, created}       (each entry: file, bytes, sha256, encoding)
//   <version>/llvm-<sha12>.wasm       the compiler
//   <version>/sdk-pack-<sha12>.bin    the SDK pack
// File names carry their content hash, so the browser cache (by URL) never mixes versions. The development server serves
// this folder under /pico-full/ when PICO_FULL_SITE points to it (tools/serve.mjs).
//   node tools/pico-full/stage.mjs    (env: PICO_FULL_WORK; for the licences PICO_FULL_LICENCES and PICO_SDK_PATH)
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const W = process.env.PICO_FULL_WORK;
if (!W) { console.error('set PICO_FULL_WORK'); process.exit(2); }
const out = join(W, 'out');
const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
const wasm = readFileSync(join(W, 'build', 'llvm.wasm'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
// Files are stored gzip-compressed (level 9) and decoded in the browser (DecompressionStream), so the download size does
// not depend on the server compressing them; `bytes` and `sha256` are of the decoded file, `transferBytes` of the .gz.
const packBytes = readFileSync(join(out, m.sdkPack.file));
const entry = (name, data) => ({ file: `${name}.gz`, bytes: data.length, sha256: sha(data), encoding: 'gzip' });
const compiler = entry(`llvm-${sha(wasm).slice(0, 12)}.wasm`, wasm);
const pack = entry(m.sdkPack.file, packBytes);
const version = `${m.created.slice(0, 10).replace(/-/g, '')}-${sha(compiler.sha256 + pack.sha256).slice(0, 8)}`;
const dir = join(out, 'site', 'pico-full', version);
mkdirSync(dir, { recursive: true });
for (const [e, data] of [[compiler, wasm], [pack, packBytes]]) {
  const f = join(dir, e.file);
  if (!existsSync(f)) writeFileSync(f, gzipSync(data, { level: 9 }));
  e.transferBytes = statSync(f).size;
}
// The licences of what the download contains (research research/licensing/pico-full-compiler-licences.md §3): the texts
// tracked in the research repository (PICO_FULL_LICENCES = its upstream/licenses), the pico-sdk's LICENSE.TXT and
// pico_printf's notice (PICO_SDK_PATH), the WASI patch (its changes are marked, Apache-2.0 §4(b)); an index in LICENCES.txt.
let licences = null;
const LIC = process.env.PICO_FULL_LICENCES, SDK = process.env.PICO_SDK_PATH;
if (LIC && SDK && existsSync(LIC) && existsSync(SDK)) {
  const ld = join(dir, 'licences');
  mkdirSync(ld, { recursive: true });
  const take = [
    ['llvm-project/LICENSE.TXT', 'LLVM (clang, lld and the LLVM libraries in the compiler): Apache-2.0 WITH LLVM-exception'],
    ['llvm-project/compiler-rt-LICENSE.TXT', 'compiler-rt (builtins in the SDK pack; wasm32 runtime in the compiler)'],
    ['llvm-project/llvm-lib-Support-BLAKE3-LICENSE', 'BLAKE3 in LLVM Support: CC0-1.0 or Apache-2.0'],
    ['llvm-project/llvm-lib-Support-COPYRIGHT.regex', 'The regular expression code in LLVM Support (Henry Spencer, UC Regents)'],
    ['llvm-project/NOTICES-in-file-headers.txt', 'Notices in LLVM file headers (xxHash BSD-2-Clause, regstrlcpy ISC, MD5 public domain)'],
    ['picolibc/COPYING.picolibc', 'picolibc 1.8.12 (the C library in the SDK pack): all its notices'],
    ['wasi-libc/LICENSE', 'wasi-libc (linked into the compiler): Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT'],
    ['wasi-libc/LICENSE-APACHE', 'wasi-libc: Apache-2.0'], ['wasi-libc/LICENSE-APACHE-LLVM', 'wasi-libc: Apache-2.0 WITH LLVM-exception'],
    ['wasi-libc/LICENSE-MIT', 'wasi-libc: MIT'], ['wasi-libc/musl-COPYRIGHT', 'musl (in wasi-libc): MIT'],
    ['wasi-libc/cloudlibc-LICENSE', 'cloudlibc (in wasi-libc): BSD-2-Clause'], ['wasi-libc/musl-fts-COPYING', 'musl-fts (in wasi-libc): BSD-3-Clause'],
    ['wasi-libc/dlmalloc-notice.txt', 'dlmalloc (in wasi-libc): CC0'],
  ];
  const index = [];
  for (const [rel, what] of take) {
    const src = join(LIC, ...rel.split('/'));
    if (!existsSync(src)) throw new Error(`licence text missing: ${src}`);
    const name = rel.replace('/', '-');
    writeFileSync(join(ld, name), readFileSync(src));
    index.push(`${name}\n    ${what}`);
  }
  writeFileSync(join(ld, 'pico-sdk-LICENSE.TXT'), readFileSync(join(SDK, 'LICENSE.TXT')));
  index.push('pico-sdk-LICENSE.TXT\n    Raspberry Pi Pico SDK (headers, prebuilt objects, linker scripts in the SDK pack): BSD-3-Clause');
  const printf = readFileSync(join(SDK, 'src', 'rp2_common', 'pico_printf', 'printf.c'), 'utf8');
  writeFileSync(join(ld, 'pico_printf-NOTICE.txt'), printf.slice(0, printf.indexOf('*/') + 2) + '\n');
  index.push('pico_printf-NOTICE.txt\n    pico_printf (Marco Paland), in every SDK program: MIT (the notice of printf.c)');
  writeFileSync(join(ld, 'llvm-23.1.5-wasi.patch'), readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'llvm-23.1.5-wasi.patch')));
  index.push('llvm-23.1.5-wasi.patch\n    The changes made to LLVM 23.1.5 for WebAssembly (WASI) in this compiler (Apache-2.0 §4(b)); own port of YoWASP\'s patch');
  writeFileSync(join(ld, 'LICENCES.txt'), [
    `Pico SDK compiler and files for MAVILERA's Pico 2 Laboratory, version ${version}.`,
    'This download contains third-party software under the licences below. Programs you build with it contain Pico SDK,',
    'picolibc and pico_printf code under their BSD and MIT terms, as with the official GCC toolchain.', '', ...index, ''].join('\n'));
  licences = 'licences/LICENCES.txt';
} else console.warn('licences not staged: set PICO_FULL_LICENCES (research upstream/licenses) and PICO_SDK_PATH');
const manifest = { version, created: m.created, compiler, pack, total: compiler.bytes + pack.bytes, transfer: compiler.transferBytes + pack.transferBytes, ...(licences ? { licences } : {}) };
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(out, 'site', 'pico-full', 'current.json'), JSON.stringify({ version, manifest: `${version}/manifest.json` }, null, 2));
console.log(`staged ${version}: compiler ${compiler.bytes} B (gzip ${compiler.transferBytes}), pack ${pack.bytes} B (gzip ${pack.transferBytes}) -> ${join(out, 'site', 'pico-full')}`);
