// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { readPack } from './pack.js';
import { packFS, buildProject, preparePch, chooseSet, setOf, includeNames, includeSearchDirs, resolveInclude, DEFAULT_SET, PROJECT_DIR, OBJ_DIR } from './driver.js';
import { parseDiagnostics } from './diagnostics.js';
import { normalise } from './wasi.js';
export const BUILD_FILES = /\.(c|h|S|s)$/;
export class CompilerHost {
 constructor({ module, pack }) {
 this.module = module;
 const { meta, files } = readPack(pack);
 this.meta = meta;
 this.fs = packFS(files);
 this.pchs = new Map();
 }
 get pch() { return this.pchs.get(DEFAULT_SET) ?? null; }
 async prepare(set = DEFAULT_SET) {
 if (!this.pchs.has(set)) {
 const r = await preparePch(this.module, this.fs, this.meta, set);
 this.pchs.set(set, { ok: r.ok, ms: r.ms, stderr: r.ok ? '' : r.stderr });
 }
 return this.pchs.get(set);
 }
 clean() {
 for (const dir of [PROJECT_DIR, OBJ_DIR]) {
 for (const p of [...this.fs.files.keys()]) if (p.startsWith(`${dir}/`)) this.fs.files.delete(p);
 for (const d of [...this.fs.dirs]) if (d.startsWith(`${dir}/`)) this.fs.dirs.delete(d);
 }
 }
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
