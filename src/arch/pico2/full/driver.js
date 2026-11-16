// driver.js -- the Pico Full build driver (pico2 P1-F2, research D33): runs the compiler jobs recorded in the SDK pack
// (clang's own `-###` plans, made once by tools/pico-full/build-pack.mjs) on the WebAssembly clang/lld, each job in a
// fresh instance, over an in-memory file system holding the pack and the project. WASI cannot spawn processes, so the
// driver's subprocess jobs (cc1as, the link) are run here (R-CC-WASM-01 §3.3).
//
// Templates (pack meta.templates): arrays of arguments with the placeholders {src} {obj} {name} {tmp} {out} as whole
// arguments and {objs} for the list of objects. A C file is one cc1 job (with -include-pch when it starts by including
// the precompiled header's header); a .S file is a preprocess job and a cc1as job; the link is one ld.lld job.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Wasi, MemFS } from './wasi.js';

export const PROJECT_DIR = '/project';
export const OBJ_DIR = '/build';
const ENV = { PWD: PROJECT_DIR, TMPDIR: '/tmp', HOME: '/tmp' };

/** A file system with the pack's files (shared, not copied) and the working folders. */
export function packFS(files) {
  const fs = new MemFS();
  for (const [p, d] of files) fs.addFile(p, d);
  for (const d of [PROJECT_DIR, OBJ_DIR, '/tmp']) fs.mkdir(d);
  return fs;
}

/** The template with its placeholders filled; `{objs}` expands to the array `vars.objs`. */
export function expand(template, vars) {
  const out = [];
  for (const a of template) {
    if (a === '{objs}') out.push(...vars.objs);
    else if (/^\{\w+\}$/.test(a)) {
      const k = a.slice(1, -1);
      if (!(k in vars)) throw new Error(`template needs ${a}`);
      out.push(vars[k]);
    } else out.push(a);
  }
  return out;
}

/** Runs one job: argv[0] selects the tool of the multi-call module ('clang' with -cc1/-cc1as, 'ld.lld'). */
export async function runJob(module, fs, argv) {
  const wasi = new Wasi({ args: argv, env: ENV, fs });
  const t0 = performance.now();
  let code;
  try {
    const inst = await WebAssembly.instantiate(module, wasi.imports());
    code = wasi.start(inst);
  } catch (e) {
    code = 134;
    wasi.stderr.push(new TextEncoder().encode(`${argv[0]}: stopped (${e && e.message})\n`));
  }
  return { code, stdout: wasi.text('stdout'), stderr: wasi.text('stderr'), ms: performance.now() - t0 };
}

// ---- object sets (P1-R4, research D58; docs/architecture/pico2-p1r4-pack.md) ----
// The pack holds four sets of prebuilt SDK objects with their own compile and link templates: stdio over UART only or over
// UART and USB (the project option, P1-F3 Q3 A), each without or with pico_multicore. LIB_PICO_MULTICORE and
// LIB_PICO_STDIO_USB change shared SDK code (malloc's mutex, thread-safe statics, pico_flash, stdio), so one set of
// objects could not serve every program as CMake would build it.
export const PACK_SETS = Object.freeze(['uart', 'uart_mc', 'usb', 'usb_mc']);
export const DEFAULT_SET = 'uart';
export const STDIO_CHOICES = Object.freeze(['uart', 'usb']);
const MULTICORE_HEADER = 'pico/multicore.h';

/** Text without C comments (string literals are left alone: an include inside one is not a directive anyway). */
const uncomment = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');

/** True when `text` has a directive including `header` (<...> or "..."), anywhere in the file. */
export function includesHeader(text, header) {
  const h = header.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`^[ \\t]*#[ \\t]*include[ \\t]*[<"]${h}[>"]`, 'm').test(uncomment(text));
}

/**
 * The object set for a build: stdio from the project option (`uart` | `usb`), multicore when a C, header or assembly
 * file of the project includes "pico/multicore.h" (as a CMake project would link pico_multicore). Returns
 * {id, stdio, multicore}; `id` is null when the pack has no such set (a pack from before P1-R4 has only uart).
 */
export function chooseSet(meta, files, { stdio = 'uart' } = {}) {
  const io = STDIO_CHOICES.includes(stdio) ? stdio : 'uart';
  const multicore = files.some((f) => /\.(c|h|S)$/.test(f.name) && includesHeader(f.text, MULTICORE_HEADER));
  const id = `${io}${multicore ? '_mc' : ''}`;
  const have = meta.sets ? id in meta.sets : id === DEFAULT_SET;
  return { id: have ? id : null, stdio: io, multicore };
}

/** {templates, pch} of a set; a pack from before P1-R4 has the default set's fields only. */
export function setOf(meta, set = DEFAULT_SET) {
  if (meta.sets) {
    const s = meta.sets[set];
    if (!s) throw new Error(`the SDK pack has no object set ${set}`);
    return s;
  }
  if (set !== DEFAULT_SET) throw new Error(`the SDK pack has no object set ${set}`);
  return { templates: meta.templates, pch: meta.pch };
}

/** The #include directives of a C, header or assembly text, in order without repeats: [{name, quoted}] (comments skipped). */
export function includeNames(text) {
  const out = [], seen = new Set();
  for (const m of uncomment(text).matchAll(/^[ \t]*#[ \t]*include[ \t]*(?:"([^"\n]+)"|<([^>\n]+)>)/gm)) {
    const name = (m[1] ?? m[2]).trim(), quoted = m[1] !== undefined;
    if (!seen.has(name)) { seen.add(name); out.push({ name, quoted }); }
  }
  return out;
}

// clang's search order whatever the command line's: "..." first in -iquote dirs, then -I, then -isystem, then the
// toolchain's own (-internal-isystem, -internal-externc-isystem), each group in command-line order
const SEARCH_GROUP = Object.freeze({ '-iquote': 'quote', '-I': 'user', '-isystem': 'system', '-internal-isystem': 'internal', '-internal-externc-isystem': 'internal' });
/** The include search directories of a compile template: {quote, user, system, internal}, each in command-line order. */
export function includeSearchDirs(args) {
  const d = { quote: [], user: [], system: [], internal: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (SEARCH_GROUP[a] && i + 1 < args.length) { d[SEARCH_GROUP[a]].push(args[++i]); continue; }
    const m = /^(-iquote|-isystem|-I)(.+)$/.exec(a);
    if (m) d[SEARCH_GROUP[m[1]]].push(m[2]);
  }
  return d;
}

/** Where the compiler finds `name` (an include outside the project): the pack path, or null. `has(path)` tests the pack. */
export function resolveInclude(has, dirs, name, quoted) {
  if (name.startsWith('/') || name.split('/').includes('..')) return null; // the samples never need these; never leave the dirs
  for (const dir of [...(quoted ? dirs.quote : []), ...dirs.user, ...dirs.system, ...dirs.internal]) {
    const p = `${dir.replace(/\/+$/, '')}/${name}`;
    if (has(p)) return p;
  }
  return null;
}

/**
 * Builds a set's precompiled header from its source in the pack (once per loaded pack and set: it is not shipped,
 * 3.8 MB raw). Returns the job result with `ok`.
 */
export async function preparePch(module, fs, meta, set = DEFAULT_SET) {
  const s = setOf(meta, set);
  if (!s.pch || !s.templates.pch) return { ok: false, code: -1, stdout: '', stderr: 'the pack has no precompiled header', ms: 0 };
  const r = await runJob(module, fs, s.templates.pch);
  return { ok: r.code === 0, ...r };
}

const stem = (name) => name.replace(/\.[^.]*$/, '');
const C_FILE = /\.c$/i, ASM_FILE = /\.(S|s|sx)$/;

/** True when the text's first preprocessor directive includes the precompiled header's header (comments allowed before). */
export function startsWithPchHeader(text, header) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean);
  const first = src.find((l) => l.startsWith('#'));
  return Boolean(first && new RegExp(`^#\\s*include\\s*[<"]${header.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[>"]$`).test(first));
}

/**
 * Builds a project: `files` [{name, text}] are written to /project; each .c and .S file is compiled; all objects are
 * linked. Returns {ok, elf?, objects, jobs: [{file, step, code, stderr, ms}]}. Stops at the first failing step but
 * compiles every file first, so that all compile errors are reported together.
 */
export async function buildProject({ module, fs, meta, files, usePch = true, set = DEFAULT_SET }) {
  const s = setOf(meta, set);
  const t = s.templates;
  const enc = new TextEncoder();
  const jobs = [], objects = [];
  for (const f of files) fs.write(`${PROJECT_DIR}/${f.name}`, enc.encode(f.text));
  let failed = false;
  for (const f of files) {
    if (!C_FILE.test(f.name) && !ASM_FILE.test(f.name)) continue;
    const src = `${PROJECT_DIR}/${f.name}`, obj = `${OBJ_DIR}/${stem(f.name)}.${C_FILE.test(f.name) ? 'c' : 'S'}.o`;
    if (C_FILE.test(f.name)) {
      const pch = usePch && s.pch && fs.stat(s.pch.path) && startsWithPchHeader(f.text, s.pch.header);
      const argv = expand(pch ? t.cPch : t.c, { src, obj, name: f.name });
      const r = await runJob(module, fs, argv);
      jobs.push({ file: f.name, step: pch ? 'compile (precompiled header)' : 'compile', ...r });
      if (r.code !== 0) failed = true; else objects.push(obj);
    } else {
      const tmp = `/tmp/${stem(f.name)}.s`;
      const pre = await runJob(module, fs, expand(t.asmPreprocess, { src, tmp, name: f.name }));
      jobs.push({ file: f.name, step: 'preprocess', ...pre });
      if (pre.code !== 0) { failed = true; continue; }
      const as = await runJob(module, fs, expand(t.asm, { tmp, obj, name: f.name }));
      jobs.push({ file: f.name, step: 'assemble', ...as });
      if (as.code !== 0) failed = true; else objects.push(obj);
    }
  }
  if (failed || objects.length === 0) return { ok: false, objects, jobs, reason: failed ? 'compile' : 'nothing' };
  const out = `${OBJ_DIR}/program.elf`;
  const r = await runJob(module, fs, expand(t.link, { objs: objects, out }));
  jobs.push({ file: null, step: 'link', ...r });
  if (r.code !== 0) return { ok: false, objects, jobs, reason: 'link' };
  return { ok: true, elf: fs.read(out), objects, jobs };
}
