// build-pack.mjs -- step 6 of the Pico Full toolchain (pico2 P1-F2, research D33; object sets P1-R4, research D58): the
// SDK pack from the built profile.
//
//   node tools/pico-full/build-pack.mjs        (env: PICO_FULL_WORK, PICO_SDK_PATH, SOURCE_DATE_EPOCH; the compile daemon
//                                               must be running)
//
// The profile (profile/CMakeLists.txt) builds four object sets -- uart, uart_mc, usb, usb_mc -- each as a pair of programs
// base_<set> (whole-linked) and full_<set> (every further library). For each set:
// 1. Objects: base_<set>'s objects (CMake's link order) are linked whole; the further libraries' objects (sources only
//    full_<set> compiles) are linked lazily (ld.lld --start-lib/--end-lib: an archive's semantics without an archive, so
//    an object shared by several sets is stored once). Sources both compile must give identical code (else the pack
//    would differ from a CMake build), checked here per set. Sections the SDK's assembly declares without flags
//    (`.time_critical.*`, not allocated) get alloc+exec, as GNU ld effectively treats them; lld refuses relocations in
//    unallocated sections (found 2026-11-09, hardware_exception/exception_table_riscv.S).
// 2. Templates: clang's own `-###` plans (through the daemon) for full_<set>'s C file, an SDK .S file and base_<set>'s link,
//    with host paths mapped to the pack's guest paths and placeholders for the file names.
// 3. Files: every header of the include directories, the linker scripts, libc/libm, builtins, objects (one copy each).
// 4. A precompiled header of pico/stdlib.h per set, built INSIDE the pack's file system with the WASI host the browser uses.
// 5. Self-check in that file system: the profile's main.c built from each set's templates (with and without the
//    precompiled header) links to the same loadable image as CMake's base_<set>.elf.
// Output: PICO_FULL_WORK\out\sdk-pack-<sha12>.bin and manifest.json (sizes, SHA-256, gzip size).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0. Rights class: code.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writePack, readPack } from '../../src/arch/pico2/full/pack.js';
import { packFS, buildProject, preparePch, expand, PACK_SETS, DEFAULT_SET } from '../../src/arch/pico2/full/driver.js';
import { tok } from './cmdline.mjs';

const PF = dirname(fileURLToPath(import.meta.url));
const W = process.env.PICO_FULL_WORK, SDK = process.env.PICO_SDK_PATH;
if (!W || !SDK) { console.error('set PICO_FULL_WORK and PICO_SDK_PATH'); process.exit(2); }
if (!/^\d+$/.test(process.env.SOURCE_DATE_EPOCH ?? '')) { console.error('set SOURCE_DATE_EPOCH (the pack\'s created time and build date)'); process.exit(2); }
const PINS = JSON.parse(readFileSync(join(PF, 'pins.json'), 'utf8'));
const PB = join(W, 'build', 'profile'), SYSROOT = join(W, 'build', 'sysroot-rv32');
const RESOURCE = join(W, 'build', 'clang-wasm', 'lib', 'clang', '23');
const OUT = join(W, 'out');
const PORT = Number(process.env.CCD_PORT || 47321);
const PROFILE_INFO = JSON.parse(readFileSync(join(PB, 'pack-libraries.json'), 'utf8'));
const SETS = PROFILE_INFO.sets.split(/\s+/).filter(Boolean);
if (SETS.join(' ') !== PACK_SETS.join(' ')) throw new Error(`the profile builds sets ${SETS.join(' ')}; the driver knows ${PACK_SETS.join(' ')}`);

const toGuest = (a) => a.replace(/[Cc]:[\\/]/g, '/').replace(/\\/g, '/');
const sha = (b) => createHash('sha256').update(b).digest('hex');
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

// Code and data must be identical: allocated sections and their relocations. Debug information may differ (the extra
// libraries' defines change how many header lines the preprocessor emits, so line numbers of .S labels move).
const codeOf = (b) => {
  const s = sections(b);
  const alloc = new Set(s.filter((x) => x.flags & 2).map((x) => x.name));
  return s.filter((x) => alloc.has(x.name) || (/^\.rela?/.test(x.name) && alloc.has(x.name.replace(/^\.rela?/, '')))).map((x) => [x.name, x.flags, Buffer.from(b.subarray(x.off, x.off + (x.type === 8 ? 0 : x.size)))]);
};
const sameCode = (a, b) => { const x = codeOf(a), y = codeOf(b); return x.length === y.length && x.every((s, i) => s[0] === y[i][0] && s[1] === y[i][1] && Buffer.compare(s[2], y[i][2]) === 0); };

const cc = JSON.parse(readFileSync(join(PB, 'compile_commands.json'), 'utf8'));
/** [kind 'base'|'full', set] of a compile command's target, from its object path (CMakeFiles/<kind>_<set>.dir/...). */
const targetOf = (e) => { const m = e.output.match(/[\\/](base|full)_([a-z_]+)\.dir[\\/]/); return m && SETS.includes(m[2]) ? [m[1], m[2]] : null; };
const objPath = (e) => resolve(e.directory, e.output);
const isProfileMain = (e) => /[\\/]main\.c\.obj$/.test(e.output) && /tools[\\/]pico-full[\\/]profile/.test(e.file);
const bySet = Object.fromEntries(SETS.map((s) => [s, { base: new Map(), full: new Map() }]));
for (const e of cc) { const t = targetOf(e); if (t) bySet[t[1]][t[0]].set(resolve(e.file).toLowerCase(), e); }

const libName = (p) => {
  const g = toGuest(p);
  if (/\/lib\/tinyusb\//.test(g)) return 'tinyusb';
  const m = g.match(/\/src\/(?:common|rp2_common|rp2350)\/([^/]+)\//);
  return m ? m[1] : 'other';
};
// one stored copy per distinct object: /pico/lib/o/<library>-<file>-<sha8>.o (sets share most of their objects)
const files = [], fixes = [], stored = new Map();
const store = (source, host) => {
  const { bytes, fixed } = fixSections(readFileSync(host));
  if (fixed.length && !fixes.some((f) => f.object === basename(source))) fixes.push({ object: basename(source), sections: fixed });
  const h = sha(bytes).slice(0, 8);
  const p = `/pico/lib/o/${libName(source)}-${basename(source).replace(/\.obj$/, '')}-${h}.o`;
  if (!stored.has(p)) { stored.set(p, bytes); files.push([p, bytes]); }
  return p;
};

// ---- 1. objects, per set ----
const sets = {}, setReport = {};
for (const set of SETS) {
  const { base, full } = bySet[set];
  const differing = [], debugOnly = [];
  for (const [src, eb] of base) {
    const ef = full.get(src);
    if (!ef || isProfileMain(eb)) continue;
    const a = new Uint8Array(readFileSync(objPath(eb))), b = new Uint8Array(readFileSync(objPath(ef)));
    if (Buffer.compare(a, b) === 0) continue;
    (sameCode(a, b) ? debugOnly : differing).push(basename(src));
  }
  log(`[${set}] objects: base ${base.size}, full ${full.size}; shared sources: code differs ${differing.length ? differing.join(', ') : 'nowhere'}; debug information only ${debugOnly.join(', ') || 'nowhere'}`);
  if (differing.length) throw new Error(`[${set}] the further libraries change shared code; the pack would not match CMake builds`);

  // base link order from the response file (ninja -d keeprsp), main.c first
  rmSync(join(PB, `base_${set}.elf`), { force: true });   // relink only (ninja -t clean would remove the objects too)
  execFileSync('ninja', ['-C', PB, '-d', 'keeprsp', `base_${set}.elf`], { stdio: 'ignore' });
  const rsp = readFileSync(join(PB, 'CMakeFiles', `base_${set}.rsp`), 'utf8').split(/\s+/).filter(Boolean);
  if (rsp.some((a) => !a.endsWith('.obj'))) throw new Error(`[${set}] unexpected entries in the response file: ${rsp.filter((a) => !a.endsWith('.obj')).join(' ')}`);
  if (rsp[0].replace(/\\/g, '/') !== `CMakeFiles/base_${set}.dir/main.c.obj`) throw new Error(`[${set}] main.c.obj is not first in the response file`);
  const srcOfObj = new Map([...base.values()].map((e) => [objPath(e).toLowerCase(), e.file]));
  const whole = rsp.slice(1).map((rel) => { const host = join(PB, rel); return store(srcOfObj.get(host.toLowerCase()) ?? host, host); });
  const lazy = [], lazyLibs = new Set();
  for (const [src, e] of full) {
    if (base.has(src) || isProfileMain(e) || !/\.(c|S)$/i.test(e.file)) continue;
    lazy.push(store(e.file, objPath(e)));
    lazyLibs.add(libName(e.file));
  }
  lazy.sort();
  sets[set] = { whole, lazy, rsp, libraries: { base: [...new Set(whole.map((p) => basename(p).split('-')[0]))], lazy: [...lazyLibs].sort() } };
  setReport[set] = { whole: whole.length, lazy: lazy.length, debugOnly };
}
log(`objects stored ${stored.size} (sets: ${SETS.map((s) => `${s} ${sets[s].whole.length}+${sets[s].lazy.length}`).join(', ')}); section fixes ${JSON.stringify(fixes)}`);
// evidence for the design note: the whole-linked objects of a set that differ from uart's (same source, other bytes)
const keyOf = (p) => basename(p).replace(/-[0-9a-f]{8}\.o$/, '');
const uartWhole = new Map(sets[DEFAULT_SET].whole.map((p) => [keyOf(p), p]));
for (const set of SETS) {
  const changed = sets[set].whole.filter((p) => uartWhole.has(keyOf(p)) && uartWhole.get(keyOf(p)) !== p).map(keyOf);
  const added = sets[set].whole.filter((p) => !uartWhole.has(keyOf(p))).map(keyOf);
  Object.assign(setReport[set], { changedFromUart: changed, addedToUart: added.length });
  if (set !== DEFAULT_SET) log(`[${set}] whole-linked objects differing from uart's: ${changed.join(', ') || 'none'}; added ${added.length}`);
}

// ---- 2. templates, per set ----
const strip = (args, file) => { const out = []; for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (['-o', '-MT', '-MF'].includes(a)) { i++; continue; }
  if (['-c', '-MD'].includes(a) || a === file) continue;
  out.push(a);
} return out; };
const placeholders = (job, vars) => job.map((a, i) => {
  for (const [k, v] of Object.entries(vars)) if (a === v) return `{${k}}`;
  if (job[i - 1] === '-main-file-name') return '{name}';
  if (/^-f(debug|coverage)-compilation-dir=/.test(a)) return a.replace(/=.*/, '=/project');
  return mapArg(a);
}).filter((a, i, arr) => !(a === '-dependency-file' || arr[i - 1] === '-dependency-file'));
const PCH = { header: 'pico/stdlib.h', source: '/pico/pch/stdlib.h' };
for (const set of SETS) {
  const s = sets[set];
  // Students' files compile with the flags of full_<set> (the include directories of every pack library); its further
  // LIB_* defines are read only by left-out libraries (checked: check-pack.mjs gives CMake-identical images).
  const fullCmds = [...bySet[set].full.values()];
  const ccMain = fullCmds.find(isProfileMain);
  const ccAsm = fullCmds.find((e) => /crt0_riscv\.S$/.test(e.file));
  const guestMain = toGuest(ccMain.file);
  const cJobs = await plan('clang', [...strip(tok(ccMain.command).slice(1).map(toGuest), guestMain), '-c', guestMain, '-o', '/tmp/x.o'], toGuest(ccMain.directory));
  if (cJobs.length !== 1 || cJobs[0][1] !== '-cc1') throw new Error(`[${set}] C compile: expected one cc1 job`);
  const cTemplate = ['clang', ...placeholders(cJobs[0].slice(1), { src: guestMain, obj: '/tmp/x.o' })];
  const guestAsm = toGuest(ccAsm.file);
  const aJobs = await plan('clang', [...strip(tok(ccAsm.command).slice(1).map(toGuest), guestAsm), '-c', guestAsm, '-o', '/tmp/x.o'], toGuest(ccAsm.directory));
  if (aJobs.length !== 2 || aJobs[0][1] !== '-cc1' || aJobs[1][1] !== '-cc1as') throw new Error(`[${set}] .S: expected cc1 -E and cc1as jobs`);
  const tmpS = aJobs[0][aJobs[0].indexOf('-o') + 1];
  const asmPreprocess = ['clang', ...placeholders(aJobs[0].slice(1), { src: guestAsm, tmp: tmpS })];
  const asmTemplate = ['clang', ...placeholders(aJobs[1].slice(1), { tmp: tmpS, obj: '/tmp/x.o' })];
  // link: CMake's base_<set>.elf link command with its response file expanded
  const linkCmd = execFileSync('ninja', ['-C', PB, '-t', 'commands', `base_${set}.elf`], { encoding: 'utf8' }).trim().split(/\r?\n/).pop();
  const linkArgs = tok(linkCmd.slice(linkCmd.indexOf('clang++.exe') + 'clang++.exe'.length, linkCmd.lastIndexOf(' && cd .')))
    .flatMap((a) => (a.startsWith('@') ? s.rsp : [a])).map(toGuest);
  const lJobs = await plan('clang++', linkArgs, toGuest(PB));
  if (lJobs.length !== 1) throw new Error(`[${set}] link: expected one job`);
  const lj = lJobs[0];
  const firstObj = lj.findIndex((a) => a.endsWith('.obj'));
  const objCount = lj.filter((a) => a.endsWith('.obj')).length;
  if (lj.slice(firstObj, firstObj + objCount).some((a) => !a.endsWith('.obj'))) throw new Error(`[${set}] link: objects are not contiguous`);
  const link = ['ld.lld', ...lj.slice(1, firstObj).map(mapArg), '{objs}', ...s.whole, '--start-lib', ...s.lazy, '--end-lib',
    ...lj.slice(firstObj + objCount).map((a, i, arr) => (arr[i - 1] === '-o' ? '{out}' : mapArg(a)))];
  const templates = { c: cTemplate, asmPreprocess, asm: asmTemplate, link };
  for (const [k, t] of Object.entries(templates)) {
    const leak = t.filter((a) => /\/(Users|Research)\//.test(a));
    if (leak.length) throw new Error(`[${set}] template ${k} keeps host paths: ${leak.slice(0, 3).join(' ')}`);
  }
  // precompiled header of pico/stdlib.h for this set: a recorded job, run by the driver when the set is first used
  // (3.8 MB raw / 1.8 MB gzip if shipped, about 0.3 s to build in a browser, R-CC-WASM-01 §6.5); its source is in the pack
  const pchPath = `/pico/pch/stdlib-${set}.pch`;   // beside its source (the in-memory file system has that folder)
  const pchBuild = cTemplate.map((a) => (a === '-emit-obj' ? '-emit-pch' : a));
  const xi = pchBuild.indexOf('-x');
  if (xi < 0 || pchBuild[xi + 1] !== 'c') throw new Error(`[${set}] C template: no "-x c" before the input`);
  pchBuild[xi + 1] = 'c-header';
  templates.pch = expand(pchBuild, { src: PCH.source, obj: pchPath, name: 'stdlib.h' });
  templates.cPch = [...cTemplate.slice(0, cTemplate.indexOf('-x')), '-include-pch', pchPath, ...cTemplate.slice(cTemplate.indexOf('-x'))];
  s.templates = templates;
  s.pch = { ...PCH, path: pchPath };
  s.ccMain = ccMain;
}

// ---- 3. files ----
const dirsAfter = (t, flags) => t.flatMap((a, i) => (flags.includes(t[i - 1]) ? [a] : flags.filter((f) => a.startsWith(f) && a.length > f.length).map((f) => a.slice(f.length))));
const incDirs = new Set(SETS.flatMap((set) => dirsAfter(sets[set].templates.c, ['-I', '-isystem', '-internal-isystem', '-internal-externc-isystem', '-iquote', '-idirafter']).filter((d) => d.startsWith('/pico/'))));
const linkDirs = new Set(SETS.flatMap((set) => dirsAfter(sets[set].templates.link, ['-L']).filter((d) => d.startsWith('/pico/'))));
for (const set of SETS) for (const a of dirsAfter(sets[set].templates.link, ['-T', '--script=', '--script'])) linkDirs.add(a.slice(0, a.lastIndexOf('/')));
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
for (const d of [...incDirs].sort()) {
  const h = hostOf(d);
  if (!h || !existsSync(h)) continue;
  if (d === '/pico/clang/include') { for (const f of readdirSync(h)) if (CLANG_KEEP.test(f)) add(`${d}/${f}`, join(h, f)); continue; }
  for (const f of walk(h)) {
    const p = toPack(toGuest(f));
    // P1-R4: of TinyUSB's ports only the RP2040/RP2350 one (the others are never included for this MCU, and some carry other
    // licences: a Microchip header's terms allow use only with Microchip products; research licence review addendum)
    if (/\/lib\/tinyusb\/src\/portable\//.test(p) && !/\/portable\/raspberrypi\/rp2040\//.test(p)) continue;
    if (/\.(h|inc|def)$/i.test(f) || !/\.[^\\/]+$/.test(basename(f))) add(p, f);
  }
}
for (const d of [...linkDirs].sort()) { const h = hostOf(d); if (!h || !existsSync(h)) continue; for (const f of readdirSync(h)) { const p = join(h, f); if (statSync(p).isFile() && /\.(ld|incl|a)$/.test(f)) add(`${d}/${f}`, p); } }
for (const p of named) { const h = hostOf(p); if (!h || !existsSync(h)) throw new Error(`generated header names a missing file: ${p}`); add(p, h); }
files.push([PCH.source, new TextEncoder().encode(`#include "${PCH.header}"\n`)]);
log(`include directories ${incDirs.size}, link directories ${linkDirs.size}; files ${files.length}`);

// ---- 4./5. meta and self-check in a fresh file system from the pack bytes ----
// SOURCE_DATE_EPOCH (seconds, the reproducible-builds convention) fixes `created`, so two builds give the same pack bytes
// (2026-11-14: the rebuild in two work folders gave 669 identical files, differing only here)
const CREATED = new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000);
const module = await WebAssembly.compile(readFileSync(join(W, 'build', 'llvm.wasm')));
const metaSets = Object.fromEntries(SETS.map((set) => [set, { templates: sets[set].templates, pch: sets[set].pch, libraries: sets[set].libraries }]));
const meta = {
  created: CREATED.toISOString(), pins: PINS, board: 'pico2', platform: 'rp2350-riscv', profile: '-Og -g (CMake Debug with -g)',
  buildDate: PROFILE_INFO.buildDate,
  // P1-R4: the object sets; the driver picks one per build (driver.js chooseSet): stdio from the project option, multicore
  // when a project file includes "pico/multicore.h"
  defaultSet: DEFAULT_SET, sets: metaSets,
  // the default set's fields as before P1-R4 (stdio over UART), so that a reader of format-1 packs keeps working
  stdio: 'uart', pch: sets[DEFAULT_SET].pch, templates: sets[DEFAULT_SET].templates,
  libraries: { base: sets[DEFAULT_SET].libraries.base, archive: sets[DEFAULT_SET].libraries.lazy,
    excluded: JSON.parse(readFileSync(join(PF, 'excluded.json'), 'utf8')) },
  fixes,
};
const packBytes = writePack(meta, files);
const back = readPack(packBytes);
const main = readFileSync(sets[DEFAULT_SET].ccMain.file, 'utf8');
const check = {};
for (const set of SETS) {
  check[set] = {};
  for (const usePch of [false, true]) {
    const fs = packFS(back.files);
    if (usePch) {
      const pr = await preparePch(module, fs, back.meta, set);
      if (!pr.ok) throw new Error(`[${set}] precompiled header: ${pr.stderr.slice(0, 800)}`);
      check[set].pch = { bytes: fs.read(back.meta.sets[set].pch.path).length, ms: Math.round(pr.ms) };
    }
    const r = await buildProject({ module, fs, meta: back.meta, files: [{ name: 'main.c', text: main }], usePch, set });
    if (!r.ok) throw new Error(`[${set}] self-check build failed: ${r.jobs.map((j) => `${j.step}: ${j.stderr}`).join('\n').slice(0, 1500)}`);
    const same = sameImage(r.elf, new Uint8Array(readFileSync(join(PB, `base_${set}.elf`))));
    check[set][usePch ? 'withPch' : 'withoutPch'] = { sameLoadableImageAsCMake: same, ms: Math.round(r.jobs.reduce((n, j) => n + j.ms, 0)) };
    if (!same) throw new Error(`[${set}] self-check (${usePch ? 'with' : 'without'} precompiled header): the loadable image differs from CMake's base_${set}.elf`);
  }
}
log(`self-check: ${JSON.stringify(check)}`);

// ---- output ----
mkdirSync(OUT, { recursive: true });
rmSync(join(OUT, 'tmp'), { recursive: true, force: true });   // the archive's members before P1-R4
const hash = sha(packBytes);
const name = `sdk-pack-${hash.slice(0, 12)}.bin`;
writeFileSync(join(OUT, name), packBytes);
const gz = gzipSync(packBytes, { level: 9 }).length;
const manifest = { sdkPack: { file: name, bytes: packBytes.length, sha256: hash, gzipBytes: gz, files: files.length }, created: meta.created,
  buildDate: meta.buildDate, sets: setReport, check, fixes, libraries: meta.libraries };
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
log(`pack ${name}: ${packBytes.length} bytes (gzip -9 ${gz}), ${files.length} files -> ${OUT}`);
