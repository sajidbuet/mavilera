// client.js -- the page's side of the Pico Full compiler (pico2 P1-F2, research D33): starts the compiler Worker and
// talks to it with promises. `probe()` says what a first Build would download; `load(onProgress)` downloads (or reads
// from the cache) and prepares; `build(files)` builds a project. One Worker per page; it is started on first use only,
// so Pico Lite and the simulator never load any of it (ADR-0012 point 2).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** Where the site serves the compiler files (tools/pico-full/stage.mjs), relative to the page. */
export const PICO_FULL_BASE = 'pico-full/';

export class FullCompilerError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export class FullCompiler {
  constructor({ base = new URL(PICO_FULL_BASE, document.baseURI).href } = {}) {
    this.base = base;
    this.worker = null;
    this.pending = new Map();
    this.next = 1;
    this.ready = null; // the load result once loaded
  }

  call(type, data = {}, onProgress = null) {
    if (!this.worker) {
      this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data: m }) => {
        const p = this.pending.get(m.id);
        if (!p) return;
        if (m.type === 'progress') { p.onProgress?.(m); return; }
        this.pending.delete(m.id);
        if (m.type === 'result') p.resolve(m.value);
        else p.reject(new FullCompilerError(m.code, m.message));
      };
      this.worker.onerror = (e) => {
        for (const p of this.pending.values()) p.reject(new FullCompilerError('worker', e.message || 'the compiler stopped'));
        this.pending.clear();
        this.worker = null;
        this.ready = null;
      };
    }
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, type, base: this.base, ...data });
    });
  }

  /** What a load would need: {version, compiler, pack, toDownload, cacheAvailable}. */
  probe() { return this.call('probe'); }

  /** Downloads or reads the compiler and pack, and prepares them; onProgress({file, loaded, total, done, fromCache}). */
  async load(onProgress) {
    this.ready ??= await this.call('load', {}, onProgress);
    return this.ready;
  }

  /** Builds `files` ([{name, text}]): {ok, elf, diagnostics, log, times, pch}. */
  build(files) { return this.call('build', { files: files.map((f) => ({ name: f.name, text: f.text })) }); }

  /** Removes the cached files (they download again on the next load). */
  async forget() { this.ready = null; return this.call('forget'); }

  /** Asks the browser not to evict the cached files (window only; a browser may say no). */
  static async persist() {
    try { return Boolean(await navigator.storage?.persist?.()); } catch { return false; }
  }
}
