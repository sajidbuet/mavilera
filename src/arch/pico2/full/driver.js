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

/**
 * Builds the precompiled header from its source in the pack (once per loaded pack: it is not shipped, 3.8 MB raw).
 * Returns the job result with `ok`.
 */
export async function preparePch(module, fs, meta) {
  if (!meta.pch || !meta.templates.pch) return { ok: false, code: -1, stdout: '', stderr: 'the pack has no precompiled header', ms: 0 };
  const r = await runJob(module, fs, meta.templates.pch);
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
export async function buildProject({ module, fs, meta, files, usePch = true }) {
  const t = meta.templates;
  const enc = new TextEncoder();
  const jobs = [], objects = [];
  for (const f of files) fs.write(`${PROJECT_DIR}/${f.name}`, enc.encode(f.text));
  let failed = false;
  for (const f of files) {
    if (!C_FILE.test(f.name) && !ASM_FILE.test(f.name)) continue;
    const src = `${PROJECT_DIR}/${f.name}`, obj = `${OBJ_DIR}/${stem(f.name)}.${C_FILE.test(f.name) ? 'c' : 'S'}.o`;
    if (C_FILE.test(f.name)) {
      const pch = usePch && meta.pch && fs.stat(meta.pch.path) && startsWithPchHeader(f.text, meta.pch.header);
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
