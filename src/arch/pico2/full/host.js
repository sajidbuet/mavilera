// host.js -- the Pico Full compiler host (pico2 P1-F2, research D33): holds the compiled clang/lld module and the SDK
// pack's file system, prepares the precompiled header once, and builds projects. It runs inside the compiler Worker
// (worker.js) and, for the tests, in Node; it never touches the page.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readPack } from './pack.js';
import { packFS, buildProject, preparePch, chooseSet, setOf, includeNames, includeSearchDirs, resolveInclude, DEFAULT_SET, PROJECT_DIR, OBJ_DIR } from './driver.js';
import { parseDiagnostics } from './diagnostics.js';
import { normalise } from './wasi.js';

/** Project files the compiler takes (sources and headers); anything else in a project is left out of the build. */
export const BUILD_FILES = /\.(c|h|S|s)$/;

export class CompilerHost {
  /** @param {{module: WebAssembly.Module, pack: Uint8Array}} p */
  constructor({ module, pack }) {
    this.module = module;
    const { meta, files } = readPack(pack);
    this.meta = meta;
    this.fs = packFS(files);
    this.pchs = new Map(); // set -> {ok, ms, stderr} once prepared
  }

  /** {ok, ms} of the default set's precompiled header (as before P1-R4). */
  get pch() { return this.pchs.get(DEFAULT_SET) ?? null; }

  /** Builds a set's precompiled header (once per set, when first used); a failure only means compiles run without it. */
  async prepare(set = DEFAULT_SET) {
    if (!this.pchs.has(set)) {
      const r = await preparePch(this.module, this.fs, this.meta, set);
      this.pchs.set(set, { ok: r.ok, ms: r.ms, stderr: r.ok ? '' : r.stderr });
    }
    return this.pchs.get(set);
  }

  /** Removes the previous build's project files and objects, so renamed or deleted files cannot linger. */
  clean() {
    for (const dir of [PROJECT_DIR, OBJ_DIR]) {
      for (const p of [...this.fs.files.keys()]) if (p.startsWith(`${dir}/`)) this.fs.files.delete(p);
      for (const d of [...this.fs.dirs]) if (d.startsWith(`${dir}/`)) this.fs.dirs.delete(d);
    }
  }

  /**
   * Builds `files` ([{name, text}]) with `options` {stdio: 'uart' | 'usb'} (P1-R4: the object set follows the option and
   * whether a file includes "pico/multicore.h"); returns {ok, elf?, diagnostics, log, times: {compile, link, total}, pch,
   * set: {id, stdio, multicore}}. `log` is each step with its tool output, for the console's details. A set the pack does
   * not have gives reason 'set' and no build.
   */
  async build(files, options = {}) {
    const t0 = performance.now();
    const sources = files.filter((f) => BUILD_FILES.test(f.name));
    const set = chooseSet(this.meta, sources, options);
    if (!set.id) return { ok: false, elf: null, reason: 'set', diagnostics: [], log: [], times: { compile: 0, link: 0, total: 0 }, pch: false, set };
    const pch = await this.prepare(set.id);
    this.clean();
    const r = await buildProject({ module: this.module, fs: this.fs, meta: this.meta, files: sources, usePch: pch.ok, set: set.id });
    const diagnostics = r.jobs.flatMap((j) => parseDiagnostics(j.stderr));
    const sum = (pred) => Math.round(r.jobs.filter(pred).reduce((s, j) => s + j.ms, 0));
    return {
      ok: r.ok, elf: r.elf ?? null, reason: r.reason ?? null, diagnostics,
      log: r.jobs.map((j) => ({ file: j.file, step: j.step, code: j.code, stderr: j.stderr, ms: Math.round(j.ms) })),
      times: { compile: sum((j) => j.step !== 'link'), link: sum((j) => j.step === 'link'), total: Math.round(performance.now() - t0) },
      pch: pch.ok, set,
    };
  }

  /**
   * The headers a project includes from outside itself (the Hardware tab's day, 2026-11-15: shown read-only in the file
   * explorer): each #include of the project's C, header and assembly files that is not a project file (nor the header a
   * project .pio file becomes), found where the build's compile command would find it (the set the build would use).
   * Returns [{name, path, kind: 'sdk' | 'c-library', text}] and, for one not found, {name, path: null}.
   */
  headers(files, options = {}) {
    const sources = files.filter((f) => BUILD_FILES.test(f.name));
    const own = new Set([...files.map((f) => f.name), ...files.filter((f) => /\.pio$/i.test(f.name)).map((f) => `${f.name}.h`)]);
    const set = chooseSet(this.meta, sources, options);
    const dirs = includeSearchDirs(setOf(this.meta, set.id ?? DEFAULT_SET).templates.c);
    const seen = new Set(), out = [];
    const td = new TextDecoder();
    for (const f of sources) {
      for (const { name, quoted } of includeNames(f.text)) {
        if (own.has(name) || seen.has(name)) continue;
        seen.add(name);
        const found = resolveInclude((p) => this.fs.files.has(normalise(p)), dirs, name, quoted);
        const path = found && normalise(found);
        if (!path) { out.push({ name, path: null }); continue; }
        const kind = /^\/pico\/(sysroot|clang)\//.test(path) ? 'c-library' : 'sdk';
        out.push({ name, path, kind, text: td.decode(this.fs.files.get(path)) });
      }
    }
    return out;
  }
}
