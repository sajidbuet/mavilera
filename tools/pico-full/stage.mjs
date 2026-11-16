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
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
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
    // 2026-11-14 (research research/licensing/pico-full-release-licence-review.md G1-G3)
    ['llvm-project/clang-LICENSE.TXT', 'clang: Apache-2.0 WITH LLVM-exception (its own legacy copyright line)'],
    ['llvm-project/lld-LICENSE.TXT', 'lld: Apache-2.0 WITH LLVM-exception (its own legacy copyright line)'],
    ['llvm-project/llvm-lib-Support-Unicode-NOTICE.txt', 'Unicode, Inc. notices of the UTF conversion and character-name code in LLVM Support'],
    ['llvm-project/libcxx-LICENSE.TXT', 'libc++ (linked into the compiler by wasi-sdk 34, llvm 895aa2c896ad): Apache-2.0 WITH LLVM-exception'],
    ['llvm-project/libcxxabi-LICENSE.TXT', 'libc++abi (linked into the compiler by wasi-sdk 34, llvm 895aa2c896ad): Apache-2.0 WITH LLVM-exception'],
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
    // P1-R4 (research D58): the USB object sets (output over UART and USB) contain TinyUSB 86ad6e5, the SDK's submodule
    ['tinyusb/LICENSE', 'TinyUSB (USB device stack in the SDK pack\'s USB object sets; in programs built with output over USB): MIT'],
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
  // the notice is the leading block of // lines of printf.c (until 2026-11-14 this cut at the first */ and copied 907 lines, G5)
  const printf = readFileSync(join(SDK, 'src', 'rp2_common', 'pico_printf', 'printf.c'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const notice = printf.slice(0, printf.findIndex((l) => !l.startsWith('//')));
  if (notice.length < 5 || !notice.some((l) => /Permission is hereby granted/.test(l))) throw new Error('pico_printf notice not found');
  writeFileSync(join(ld, 'pico_printf-NOTICE.txt'), notice.join('\n') + '\n');
  index.push('pico_printf-NOTICE.txt\n    pico_printf (Marco Paland), in every SDK program: MIT (the notice of printf.c)');
  // BSD-3-Clause files of the pack whose copyright holders are not (only) Raspberry Pi (G6): their copyright lines; the terms
  // are those of pico-sdk-LICENSE.TXT with the holders named here
  const other = [];
  const scan = (rel) => {
    const lines = readFileSync(join(SDK, ...rel.split('/')), 'utf8').split(/\r?\n/).filter((l) => /Copyright|SPDX-License-Identifier/.test(l));
    if (lines.some((l) => /Copyright/.test(l) && !/Raspberry Pi/.test(l))) other.push(`${rel}\n${lines.map((l) => '    ' + l.replace(/^[\s/*]+/, '')).join('\n')}`);
  };
  for (const f of ['src/rp2_common/pico_i2c_slave/i2c_slave.c', 'src/rp2_common/pico_i2c_slave/include/pico/i2c_slave.h',
    'src/rp2_common/pico_thread_local/include/picotls.h', 'src/rp2_common/pico_atomic/include/stdatomic.h']) scan(f);
  for (const f of readdirSync(join(SDK, 'src', 'boards', 'include', 'boards'))) if (f.endsWith('.h')) scan(`src/boards/include/boards/${f}`);
  writeFileSync(join(ld, 'pico-sdk-other-notices.txt'), ['Pico SDK files in this download with copyright holders besides Raspberry Pi. Each is under',
    'BSD-3-Clause: the terms of pico-sdk-LICENSE.TXT, with the holders below in place of Raspberry Pi.', '', ...other, ''].join('\n'));
  index.push('pico-sdk-other-notices.txt\n    Pico SDK files by further copyright holders (pico_i2c_slave, picotls.h, stdatomic.h, board headers): BSD-3-Clause');
  // P1-R4: TinyUSB in the pack: its headers (pack paths /pico/sdk/lib/tinyusb/...) and the sources of its objects
  // (/pico/lib/o/tinyusb-<file>-<sha>.o). Each must carry the MIT text or no licence text (then the repository's MIT LICENSE
  // applies); anything else stops the staging (2026-11-15: a Microchip header with use-only-with-Microchip terms had been
  // walked into the pack). The notice lists each distinct copyright line with its files.
  const tu = join(SDK, 'lib', 'tinyusb', 'src');
  if (!existsSync(tu)) throw new Error(`TinyUSB not found: ${tu} (fetch.ps1)`);
  const { readPack } = await import('../../src/arch/pico2/full/pack.js');
  const packFiles = [...readPack(packBytes).files.keys()];
  const tuSources = new Map();
  const walkTu = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walkTu(p); else if (n.name.endsWith('.c')) tuSources.set(n.name, p); } };
  walkTu(tu);
  const shipped = [
    ...packFiles.filter((p) => p.startsWith('/pico/sdk/lib/tinyusb/')).map((p) => join(SDK, ...p.slice('/pico/sdk/'.length).split('/'))),
    ...packFiles.filter((p) => p.startsWith('/pico/lib/o/tinyusb-')).map((p) => {
      const file = p.split('/').pop().replace(/^tinyusb-/, '').replace(/-[0-9a-f]{8}\.o$/, '');
      if (!tuSources.has(file)) throw new Error(`TinyUSB object without its source: ${p}`);
      return tuSources.get(file);
    })];
  const holders = new Map(), bad = [];
  for (const f of [...new Set(shipped)].sort()) {
    const text = readFileSync(f, 'utf8');
    const head = text.slice(0, 6000);
    const mit = /Permission is hereby granted, free of charge/.test(head) || /SPDX-License-Identifier:\s*MIT\b/.test(head);
    const other = /Redistribution and use in source and binary forms|Apache License|Subject to your compliance with these terms|GNU General Public/.test(head);
    if (!mit && other) bad.push(f);
    const rel = f.slice(tu.length + 1).replace(/\\/g, '/');
    const lines = head.split(/\r?\n/).map((l) => l.match(/Copyright\s*\(c\).*$/i)?.[0]).filter(Boolean);
    for (const k of (lines.length ? lines : ['(no copyright line; the repository\'s LICENSE: Copyright (c) 2018, hathach (tinyusb.org))']).map((x) => x.replace(/\s+/g, ' ').trim())) {
      if (!holders.has(k)) holders.set(k, []);
      holders.get(k).push(rel);
    }
  }
  if (bad.length) throw new Error(`TinyUSB files in the pack with a licence other than MIT: ${bad.join(', ')}`);
  writeFileSync(join(ld, 'tinyusb-notices.txt'), [`TinyUSB ${'86ad6e56c1700e85f1c5678607a762cfe3aa2f47'} (lib/tinyusb of the Pico SDK): the ${new Set(shipped).size} files of it`,
    'in this download (headers, and the sources of the prebuilt objects), each under the MIT terms of tinyusb-LICENSE;',
    'their copyright lines:', '',
    ...[...holders].sort(([a], [b]) => a.localeCompare(b)).map(([k, fs]) => `${k}\n    ${fs.join(', ')}`), ''].join('\n'));
  index.push('tinyusb-notices.txt\n    The copyright lines of the TinyUSB files in this download (MIT)');
  const patch = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'llvm-23.1.5-wasi.patch'), 'utf8');
  writeFileSync(join(ld, 'llvm-23.1.5-wasi.patch'), patch);
  // the patch keeps its pinned bytes (pins.json sha256); its notice of changes (Apache-2.0 §4(b), G7) is a file beside it
  const changed = [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((x) => '    ' + x[1]);
  writeFileSync(join(ld, 'llvm-23.1.5-wasi-NOTICE.txt'), ['Changes to llvm-project llvmorg-23.1.5 (392dfff97d29b59d77e5cac6d4b6ef2585fe7117) for',
    'wasm32-wasip1, in llvm-23.1.5-wasi.patch: a port of YoWASP\'s LLVM WebAssembly patch (https://github.com/YoWASP/clang)',
    'by Sajid Muhaimin Choudhury, 2026, under Apache-2.0 WITH LLVM-exception (as LLVM). Files changed:', ...changed, ''].join('\n'));
  index.push('llvm-23.1.5-wasi.patch, llvm-23.1.5-wasi-NOTICE.txt\n    The changes made to LLVM 23.1.5 for WebAssembly (WASI) in this compiler and the files they change (Apache-2.0 §4(b)); own port of YoWASP\'s patch');
  writeFileSync(join(ld, 'LICENCES.txt'), [
    `Pico SDK compiler and files for MAVILERA's Pico 2 Laboratory, version ${version}.`,
    'This download contains third-party software under the licences below. Programs you build with it contain Pico SDK,',
    'picolibc and pico_printf code under their BSD and MIT terms, as with the official GCC toolchain; with output over USB',
    'also TinyUSB code (MIT).', '',
    // acknowledgements some picolibc licences ask for in documentation (G4; COPYING.picolibc UCB-1/-2, Other-16, Other-22)
    'Acknowledgements (picolibc, the C library in the SDK pack):',
    '    This product includes software developed by the University of California, Berkeley and its contributors.',
    '    Parts of picolibc were developed at Cygnus Support, Inc.',
    '    getopt was written by Gregory Pietsch.', '',
    ...index, ''].join('\n'));
  licences = 'licences/LICENCES.txt';
} else console.warn('licences not staged: set PICO_FULL_LICENCES (research upstream/licenses) and PICO_SDK_PATH');
const manifest = { version, created: m.created, compiler, pack, total: compiler.bytes + pack.bytes, transfer: compiler.transferBytes + pack.transferBytes, ...(licences ? { licences } : {}) };
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(out, 'site', 'pico-full', 'current.json'), JSON.stringify({ version, manifest: `${version}/manifest.json` }, null, 2));
console.log(`staged ${version}: compiler ${compiler.bytes} B (gzip ${compiler.transferBytes}), pack ${pack.bytes} B (gzip ${pack.transferBytes}) -> ${join(out, 'site', 'pico-full')}`);
