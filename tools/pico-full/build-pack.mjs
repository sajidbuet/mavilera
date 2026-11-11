// build-pack.mjs -- step 5 of the Pico Full toolchain (pico2 P1-F2, research D33): the SDK pack from the built profile.
//
//   node tools/pico-full/build-pack.mjs        (env: PICO_FULL_WORK, PICO_SDK_PATH; the compile daemon must be running)
//
// 1. Objects: the `base` program's objects (pico_stdlib, CMake's link order) are linked whole; the further libraries'
//    objects (sources only `full` compiles) go into one archive. Sources both compile must give identical objects (else
//    the pack would differ from a CMake build), checked here. Sections the SDK's assembly declares without flags
//    (`.time_critical.*`, not allocated) get alloc+exec, as GNU ld effectively treats them; lld refuses relocations in
//    unallocated sections (found 2026-11-09, hardware_exception/exception_table_riscv.S).
// 2. Templates: clang's own `-###` plans (through the daemon) for the profile's C file, an SDK .S file and the link,
//    with host paths mapped to the pack's guest paths and placeholders for the file names.
// 3. Files: every header of the include directories, the linker scripts, libc/libm, builtins, objects, archive.
// 4. A precompiled header of pico/stdlib.h, built INSIDE the pack's file system with the WASI host the browser uses.
// 5. Self-check in that file system: the profile's main.c built from the templates (with and without the precompiled
//    header) links to the same loadable image as CMake's base.elf.
// Output: PICO_FULL_WORK\out\sdk-pack-<sha12>.bin and manifest.json (sizes, SHA-256, gzip size).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writePack, readPack } from '../../src/arch/pico2/full/pack.js';
import { packFS, buildProject, preparePch, expand } from '../../src/arch/pico2/full/driver.js';

const PF = dirname(fileURLToPath(import.meta.url));
const W = process.env.PICO_FULL_WORK, SDK = process.env.PICO_SDK_PATH;
if (!W || !SDK) { console.error('set PICO_FULL_WORK and PICO_SDK_PATH'); process.exit(2); }
const PINS = JSON.parse(readFileSync(join(PF, 'pins.json'), 'utf8'));
const PB = join(W, 'build', 'profile'), SYSROOT = join(W, 'build', 'sysroot-rv32');
const RESOURCE = join(W, 'build', 'clang-wasm', 'lib', 'clang', '23');
const AR = join(W, 'tools', PINS.wasiSdk.folder, 'bin', 'llvm-ar.exe');
const OUT = join(W, 'out');
const PORT = Number(process.env.CCD_PORT || 47321);

const toGuest = (a) => a.replace(/[Cc]:[\\/]/g, '/').replace(/\\/g, '/');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const tok = (s) => [...s.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const log = (...a) => console.log(...a);

// host (as the guest sees it) -> pack paths, longest first
const MAP = [[toGuest(RESOURCE), '/pico/clang'], [toGuest(SYSROOT), '/pico/sysroot'], [toGuest(PB), '/pico/build'], [toGuest(SDK), '/pico/sdk']]
  .sort((a, b) => b[0].length - a[0].length);
const toPack = (g) => { for (const [h, p] of MAP) { if (g === h || g.startsWith(h + '/')) return p + g.slice(h.length); } return null; };
const mapArg = (a) => { let s = a; for (const [h, p] of MAP) s = s.split(h).join(p); return s; };
const hostOf = (packPath) => { for (const [h, p] of MAP) if (packPath === p || packPath.startsWith(p + '/')) return 'C:' + (h + packPath.slice(p.length)).replace(/\//g, '\\'); return null; };

async function ccd(tool, args, pwd) {
  const r = await fetch(`http://127.0.0.1:${PORT}/run`, { method: 'POST', body: JSON.stringify({ tool, args, pwd }) });
  const j = await r.json();
  return { code: j.code, stderr: Buffer.from(j.stderr, 'base64').toString() };
}
async function plan(tool, args, pwd) {
  const r = await ccd(tool, [...args, '-###'], pwd);
  if (r.code !== 0) throw new Error(`-### failed for ${tool}: ${r.stderr.slice(0, 500)}`);
  // Under WASI the driver prints the program as "" followed by the tool name (the multi-call module then dispatches on
  // that); a job here is the argv to run: ['clang', '-cc1', ...] or ['ld', ...].
  return r.stderr.split(/\r?\n/).filter((l) => l.startsWith(' "')).map((l) => [...l.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1')))
    .map((j) => (j[0] === '' ? j.slice(1) : j));
}

// ---- ELF helpers (32-bit little-endian) ----
function sections(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const shoff = dv.getUint32(32, true), shentsize = dv.getUint16(46, true), shnum = dv.getUint16(48, true), shstrndx = dv.getUint16(50, true);
  const sh = (i) => { const o = shoff + i * shentsize; return { o, name: dv.getUint32(o, true), type: dv.getUint32(o + 4, true), flags: dv.getUint32(o + 8, true), off: dv.getUint32(o + 16, true), size: dv.getUint32(o + 20, true) }; };
  const strtab = sh(shstrndx);
  const name = (n) => { let e = strtab.off + n; while (b[e]) e++; return new TextDecoder().decode(b.subarray(strtab.off + n, e)); };
  return Array.from({ length: shnum }, (_, i) => { const s = sh(i); return { ...s, name: name(s.name) }; });
}
/** Gives unallocated PROGBITS sections named .time_critical* the flags alloc+exec (see header). */
function fixSections(bytes) {
  const b = new Uint8Array(bytes);
  const dv = new DataView(b.buffer);
  const fixed = [];
  for (const s of sections(b)) if (s.type === 1 && !(s.flags & 2) && /^\.time_critical(\.|$)/.test(s.name)) { dv.setUint32(s.o + 8, s.flags | 2 | 4, true); fixed.push(s.name); }
  return { bytes: b, fixed };
}
/** The loadable image of an ELF: [{paddr, bytes}] of PT_LOAD segments with file size. */
function loadable(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const phoff = dv.getUint32(28, true), phentsize = dv.getUint16(42, true), phnum = dv.getUint16(44, true);
  const segs = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (dv.getUint32(o, true) !== 1) continue;
    const off = dv.getUint32(o + 4, true), paddr = dv.getUint32(o + 12, true), filesz = dv.getUint32(o + 16, true);
    if (filesz) segs.push({ paddr, bytes: b.subarray(off, off + filesz) });
  }
  return segs;
}
const sameImage = (a, b) => { const x = loadable(a), y = loadable(b); return x.length === y.length && x.every((s, i) => s.paddr === y[i].paddr && Buffer.compare(Buffer.from(s.bytes), Buffer.from(y[i].bytes)) === 0); };

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
}

// ---- 1. objects ----
const cc = JSON.parse(readFileSync(join(PB, 'compile_commands.json'), 'utf8'));
const target = (e) => (/[\\/]base\.dir[\\/]/.test(e.output) ? 'base' : /[\\/]full\.dir[\\/]/.test(e.output) ? 'full' : null);
const bySource = { base: new Map(), full: new Map() };
for (const e of cc) { const t = target(e); if (t) bySource[t].set(resolve(e.file).toLowerCase(), e); }
const objPath = (e) => resolve(e.directory, e.output);
const isProfileMain = (e) => /[\\/]main\.c\.obj$/.test(e.output) && /tools[\\/]pico-full[\\/]profile/.test(e.file);

// Code and data must be identical: allocated sections and their relocations. Debug information may differ (the extra
// libraries' defines change how many header lines the preprocessor emits, so line numbers of .S labels move).
const codeOf = (b) => {
  const s = sections(b);
  const alloc = new Set(s.filter((x) => x.flags & 2).map((x) => x.name));
  return s.filter((x) => alloc.has(x.name) || (/^\.rela?/.test(x.name) && alloc.has(x.name.replace(/^\.rela?/, '')))).map((x) => [x.name, x.flags, Buffer.from(b.subarray(x.off, x.off + (x.type === 8 ? 0 : x.size)))]);
};
const sameCode = (a, b) => { const x = codeOf(a), y = codeOf(b); return x.length === y.length && x.every((s, i) => s[0] === y[i][0] && s[1] === y[i][1] && Buffer.compare(s[2], y[i][2]) === 0); };
const differing = [], debugOnly = [];
for (const [src, eb] of bySource.base) {
  const ef = bySource.full.get(src);
  if (!ef || isProfileMain(eb)) continue;
  const a = new Uint8Array(readFileSync(objPath(eb))), b = new Uint8Array(readFileSync(objPath(ef)));
  if (Buffer.compare(a, b) === 0) continue;
  (sameCode(a, b) ? debugOnly : differing).push(basename(src));
}
log(`objects: base ${bySource.base.size}, full ${bySource.full.size}; shared sources: code differs ${differing.length ? differing.join(', ') : 'nowhere'}; debug information only ${debugOnly.join(', ') || 'nowhere'}`);
if (differing.length) throw new Error('the further libraries change shared code; the pack would not match CMake builds');

// base link order from the response file (ninja -d keeprsp), main.c first
unlinkSync(join(PB, 'base.elf'));   // relink only (ninja -t clean would remove the objects too)
execFileSync('ninja', ['-C', PB, '-d', 'keeprsp', 'base.elf'], { stdio: 'ignore' });
const rsp = readFileSync(join(PB, 'CMakeFiles', 'base.rsp'), 'utf8').split(/\s+/).filter(Boolean);
if (rsp.some((a) => !a.endsWith('.obj'))) throw new Error(`unexpected entries in base.rsp: ${rsp.filter((a) => !a.endsWith('.obj')).join(' ')}`);
const mainRel = rsp[0];
if (mainRel.replace(/\\/g, '/') !== 'CMakeFiles/base.dir/main.c.obj') throw new Error('main.c.obj is not first in base.rsp');
const baseOrder = rsp.slice(1);
const libName = (p) => { const m = toGuest(p).match(/\/src\/(?:common|rp2_common|rp2350)\/([^/]+)\//); return m ? m[1] : 'other'; };
const objName = (p, i) => `${String(i).padStart(2, '0')}-${libName(p)}-${basename(p).replace(/\.obj$/, '')}.o`;
const files = [], fixes = [];
const baseObjs = [];
baseOrder.forEach((rel, i) => {
  const host = join(PB, rel);
  const { bytes, fixed } = fixSections(readFileSync(host));
  if (fixed.length) fixes.push({ object: basename(host), sections: fixed });
  const p = `/pico/lib/base/${objName(host, i)}`;
  files.push([p, bytes]); baseObjs.push(p);
});
const baseSources = new Set([...bySource.base.keys()]);
const archived = [];
const tmpDir = join(OUT, 'tmp');
mkdirSync(tmpDir, { recursive: true });
const archiveMembers = [];
for (const [src, e] of bySource.full) {
  if (baseSources.has(src) || isProfileMain(e)) continue;
  if (!/\.(c|S)$/i.test(e.file)) continue;
  const { bytes, fixed } = fixSections(readFileSync(objPath(e)));
  if (fixed.length) fixes.push({ object: basename(e.file), sections: fixed });
  const name = `${libName(e.file)}-${basename(e.file)}.o`;
  writeFileSync(join(tmpDir, name), bytes);
  archiveMembers.push(name);
  archived.push(libName(e.file));
}
const archivePath = join(tmpDir, 'libpicosdk.a');
rmSync(archivePath, { force: true });
execFileSync(AR, ['rcsD', 'libpicosdk.a', ...archiveMembers.sort()], { cwd: tmpDir });
files.push(['/pico/lib/libpicosdk.a', new Uint8Array(readFileSync(archivePath))]);
log(`whole-linked objects ${baseObjs.length}; archive members ${archiveMembers.length}; section fixes ${JSON.stringify(fixes)}`);

// ---- 2. templates ----
// Students' files compile with the flags of `full` (the include directories of every pack library); its further LIB_*
// defines are read only by left-out libraries (checked: check-pack.mjs gives CMake-identical images for pico_stdlib programs).
const ccMain = cc.find((e) => target(e) === 'full' && isProfileMain(e));
const ccAsm = cc.find((e) => target(e) === 'full' && /crt0_riscv\.S$/.test(e.file));
const strip = (args, file) => { const out = []; for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (['-o', '-MT', '-MF'].includes(a)) { i++; continue; }
  if (['-c', '-MD'].includes(a) || a === file) continue;
  out.push(a);
} return out; };
const guestMain = toGuest(ccMain.file);
const cJobs = await plan('clang', [...strip(tok(ccMain.command).slice(1).map(toGuest), guestMain), '-c', guestMain, '-o', '/tmp/x.o'], toGuest(ccMain.directory));
if (cJobs.length !== 1 || cJobs[0][1] !== '-cc1') throw new Error('C compile: expected one cc1 job');
const placeholders = (job, vars) => job.map((a, i) => {
  for (const [k, v] of Object.entries(vars)) if (a === v) return `{${k}}`;
  if (job[i - 1] === '-main-file-name') return '{name}';
  if (/^-f(debug|coverage)-compilation-dir=/.test(a)) return a.replace(/=.*/, '=/project');
  return mapArg(a);
}).filter((a, i, arr) => !(a === '-dependency-file' || arr[i - 1] === '-dependency-file'));
const cTemplate = ['clang', ...placeholders(cJobs[0].slice(1), { src: guestMain, obj: '/tmp/x.o' })];
const guestAsm = toGuest(ccAsm.file);
const aJobs = await plan('clang', [...strip(tok(ccAsm.command).slice(1).map(toGuest), guestAsm), '-c', guestAsm, '-o', '/tmp/x.o'], toGuest(ccAsm.directory));
if (aJobs.length !== 2 || aJobs[0][1] !== '-cc1' || aJobs[1][1] !== '-cc1as') throw new Error('.S: expected cc1 -E and cc1as jobs');
const tmpS = aJobs[0][aJobs[0].indexOf('-o') + 1];
const asmPreprocess = ['clang', ...placeholders(aJobs[0].slice(1), { src: guestAsm, tmp: tmpS })];
const asmTemplate = ['clang', ...placeholders(aJobs[1].slice(1), { tmp: tmpS, obj: '/tmp/x.o' })];
// link: CMake's base.elf link command with its response file expanded
const linkCmd = execFileSync('ninja', ['-C', PB, '-t', 'commands', 'base.elf'], { encoding: 'utf8' }).trim().split(/\r?\n/).pop();
const linkArgs = tok(linkCmd.slice(linkCmd.indexOf('clang++.exe') + 'clang++.exe'.length, linkCmd.lastIndexOf(' && cd .')))
  .flatMap((a) => (a.startsWith('@') ? rsp : [a])).map(toGuest);
const lJobs = await plan('clang++', linkArgs, toGuest(PB));
if (lJobs.length !== 1) throw new Error('link: expected one job');
const lj = lJobs[0];
const firstObj = lj.findIndex((a) => a.endsWith('.obj'));
const objCount = lj.filter((a) => a.endsWith('.obj')).length;
if (lj.slice(firstObj, firstObj + objCount).some((a) => !a.endsWith('.obj'))) throw new Error('link: objects are not contiguous');
const linkTemplate = ['ld.lld', ...lj.slice(1, firstObj).map(mapArg), '{objs}', ...baseObjs, '/pico/lib/libpicosdk.a',
  ...lj.slice(firstObj + objCount).map((a, i, arr) => (arr[i - 1] === '-o' ? '{out}' : mapArg(a)))];
const templates = { c: cTemplate, asmPreprocess, asm: asmTemplate, link: linkTemplate };
for (const [k, t] of Object.entries(templates)) {
  const leak = t.filter((a) => /\/(Users|Research)\//.test(a));
  if (leak.length) throw new Error(`template ${k} keeps host paths: ${leak.slice(0, 3).join(' ')}`);
}

// ---- 3. files ----
const dirsAfter = (t, flags) => t.flatMap((a, i) => (flags.includes(t[i - 1]) ? [a] : flags.filter((f) => a.startsWith(f) && a.length > f.length).map((f) => a.slice(f.length))));
const incDirs = new Set(dirsAfter(cTemplate, ['-I', '-isystem', '-internal-isystem', '-internal-externc-isystem', '-iquote', '-idirafter']).filter((d) => d.startsWith('/pico/')));
const linkDirs = new Set([...dirsAfter(linkTemplate, ['-L']).filter((d) => d.startsWith('/pico/'))]);
for (const a of dirsAfter(linkTemplate, ['-T', '--script=', '--script'])) linkDirs.add(a.slice(0, a.lastIndexOf('/')));
const seen = new Set(files.map(([p]) => p));
// Generated headers name others by absolute host path (config_autogen.h includes the board header); they are rewritten
// to pack paths, and the files they name are added.
const named = [];
const add = (p, host) => {
  if (seen.has(p)) return;
  seen.add(p);
  let bytes = new Uint8Array(readFileSync(host));
  if (p.startsWith('/pico/build/generated/')) {
    const text = mapArg(new TextDecoder().decode(bytes));
    for (const m of text.matchAll(/#include\s+"(\/pico\/[^"]+)"/g)) named.push(m[1]);
    bytes = new TextEncoder().encode(text);
  }
  files.push([p, bytes]);
};
// clang's own headers: the generic C ones and the RISC-V intrinsics only (the rest are other targets' intrinsics and
// offload wrappers: 8 MB raw of 8.1)
const CLANG_KEEP = /^(__float_\w+|__stdarg_\w+|__stddef_\w+|float|inttypes|iso646|limits|stdalign|stdarg|stdatomic|stdbool|stdckdint|stdcountof|stddef|stddefer|stdint|stdnoreturn|tgmath|varargs|riscv_bitmanip|riscv_crypto|riscv_ntlh)\.h$/;
for (const d of incDirs) {
  const h = hostOf(d);
  if (!h || !existsSync(h)) continue;
  if (d === '/pico/clang/include') { for (const f of readdirSync(h)) if (CLANG_KEEP.test(f)) add(`${d}/${f}`, join(h, f)); continue; }
  for (const f of walk(h)) if (/\.(h|inc|def)$/i.test(f) || !/\.[^\\/]+$/.test(basename(f))) add(toPack(toGuest(f)), f);
}
for (const d of linkDirs) { const h = hostOf(d); if (!h || !existsSync(h)) continue; for (const f of readdirSync(h)) { const p = join(h, f); if (statSync(p).isFile() && /\.(ld|incl|a)$/.test(f)) add(`${d}/${f}`, p); } }
for (const p of named) { const h = hostOf(p); if (!h || !existsSync(h)) throw new Error(`generated header names a missing file: ${p}`); add(p, h); }
log(`include directories ${incDirs.size}, link directories ${linkDirs.size}; files ${files.length}`);

// ---- 4. precompiled header: a recorded job, run by the driver after loading the pack (3.8 MB raw / 1.8 MB gzip if
// shipped, about 0.3 s to build in a browser, R-CC-WASM-01 §6.5); its source is in the pack ----
const PCH = { header: 'pico/stdlib.h', source: '/pico/pch/stdlib.h', path: '/pico/pch/stdlib.pch' };
const pchBuild = cTemplate.map((a) => (a === '-emit-obj' ? '-emit-pch' : a));
const xi = pchBuild.indexOf('-x');
if (xi < 0 || pchBuild[xi + 1] !== 'c') throw new Error('C template: no "-x c" before the input');
pchBuild[xi + 1] = 'c-header';
templates.pch = expand(pchBuild, { src: PCH.source, obj: PCH.path, name: 'stdlib.h' });
templates.cPch = [...cTemplate.slice(0, cTemplate.indexOf('-x')), '-include-pch', PCH.path, ...cTemplate.slice(cTemplate.indexOf('-x'))];
files.push([PCH.source, new TextEncoder().encode(`#include "${PCH.header}"\n`)]);
const module = await WebAssembly.compile(readFileSync(join(W, 'build', 'llvm.wasm')));

// ---- 5. self-check in a fresh file system from the pack bytes ----
const meta = {
  created: new Date().toISOString(), pins: PINS, board: 'pico2', platform: 'rp2350-riscv', profile: '-Og -g (CMake Debug with -g)',
  stdio: 'uart', pch: { header: PCH.header, source: PCH.source, path: PCH.path }, templates,
  libraries: { base: [...new Set(baseObjs.map((p) => basename(p).split('-')[1]))], archive: [...new Set(archived)].sort(),
    excluded: JSON.parse(readFileSync(join(PF, 'excluded.json'), 'utf8')) },
  fixes,
};
const packBytes = writePack(meta, files);
const back = readPack(packBytes);
const main = readFileSync(ccMain.file, 'utf8');
const check = {};
for (const usePch of [false, true]) {
  const fs = packFS(back.files);
  if (usePch) {
    const pr = await preparePch(module, fs, back.meta);
    if (!pr.ok) throw new Error(`precompiled header: ${pr.stderr.slice(0, 800)}`);
    check.pch = { bytes: fs.read(PCH.path).length, ms: Math.round(pr.ms) };
  }
  const r = await buildProject({ module, fs, meta: back.meta, files: [{ name: 'main.c', text: main }], usePch });
  if (!r.ok) throw new Error(`self-check build failed: ${r.jobs.map((j) => `${j.step}: ${j.stderr}`).join('\n').slice(0, 1500)}`);
  const same = sameImage(r.elf, new Uint8Array(readFileSync(join(PB, 'base.elf'))));
  check[usePch ? 'withPch' : 'withoutPch'] = { sameLoadableImageAsCMake: same, ms: Math.round(r.jobs.reduce((s, j) => s + j.ms, 0)) };
  if (!same) throw new Error(`self-check (${usePch ? 'with' : 'without'} precompiled header): the loadable image differs from CMake's base.elf`);
}
log(`self-check: ${JSON.stringify(check)}`);

// ---- output ----
mkdirSync(OUT, { recursive: true });
const hash = sha(packBytes);
const name = `sdk-pack-${hash.slice(0, 12)}.bin`;
writeFileSync(join(OUT, name), packBytes);
const gz = gzipSync(packBytes, { level: 9 }).length;
const manifest = { sdkPack: { file: name, bytes: packBytes.length, sha256: hash, gzipBytes: gz, files: files.length }, created: meta.created, check, fixes, libraries: meta.libraries };
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
log(`pack ${name}: ${packBytes.length} bytes (gzip -9 ${gz}), ${files.length} files -> ${OUT}`);
