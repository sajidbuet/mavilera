// host.js -- the Pico Full compiler host (pico2 P1-F2, research D33): holds the compiled clang/lld module and the SDK
// pack's file system, prepares the precompiled header once, and builds projects. It runs inside the compiler Worker
// (worker.js) and, for the tests, in Node; it never touches the page.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readPack } from './pack.js';
import { packFS, buildProject, preparePch, PROJECT_DIR, OBJ_DIR } from './driver.js';
import { parseDiagnostics } from './diagnostics.js';

/** Project files the compiler takes (sources and headers); anything else in a project is left out of the build. */
export const BUILD_FILES = /\.(c|h|S|s)$/;

export class CompilerHost {
  /** @param {{module: WebAssembly.Module, pack: Uint8Array}} p */
  constructor({ module, pack }) {
    this.module = module;
    const { meta, files } = readPack(pack);
    this.meta = meta;
    this.fs = packFS(files);
    this.pch = null; // {ok, ms} once prepared
  }

  /** Builds the precompiled header (once); a failure only means compiles run without it. */
  async prepare() {
    if (!this.pch) {
      const r = await preparePch(this.module, this.fs, this.meta);
      this.pch = { ok: r.ok, ms: r.ms, stderr: r.ok ? '' : r.stderr };
    }
    return this.pch;
  }

  /** Removes the previous build's project files and objects, so renamed or deleted files cannot linger. */
  clean() {
    for (const dir of [PROJECT_DIR, OBJ_DIR]) {
      for (const p of [...this.fs.files.keys()]) if (p.startsWith(`${dir}/`)) this.fs.files.delete(p);
      for (const d of [...this.fs.dirs]) if (d.startsWith(`${dir}/`)) this.fs.dirs.delete(d);
    }
  }

  /**
   * Builds `files` ([{name, text}]); returns {ok, elf?, diagnostics, log, times: {compile, link, total}, pch}.
   * `log` is each step with its tool output, for the console's details.
   */
  async build(files) {
    const t0 = performance.now();
    await this.prepare();
    this.clean();
    const r = await buildProject({ module: this.module, fs: this.fs, meta: this.meta, files: files.filter((f) => BUILD_FILES.test(f.name)), usePch: this.pch.ok });
    const diagnostics = r.jobs.flatMap((j) => parseDiagnostics(j.stderr));
    const sum = (pred) => Math.round(r.jobs.filter(pred).reduce((s, j) => s + j.ms, 0));
    return {
      ok: r.ok, elf: r.elf ?? null, reason: r.reason ?? null, diagnostics,
      log: r.jobs.map((j) => ({ file: j.file, step: j.step, code: j.code, stderr: j.stderr, ms: Math.round(j.ms) })),
      times: { compile: sum((j) => j.step !== 'link'), link: sum((j) => j.step === 'link'), total: Math.round(performance.now() - t0) },
      pch: this.pch.ok,
    };
  }
}
