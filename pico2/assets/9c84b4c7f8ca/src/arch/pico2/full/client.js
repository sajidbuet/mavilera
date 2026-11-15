// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
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
 this.ready = null;
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
 probe() { return this.call('probe'); }
 async load(onProgress) {
 this.ready ??= await this.call('load', {}, onProgress);
 return this.ready;
 }
 build(files) { return this.call('build', { files: files.map((f) => ({ name: f.name, text: f.text })) }); }
 async forget() { this.ready = null; return this.call('forget'); }
 static async persist() {
 try { return Boolean(await navigator.storage?.persist?.()); } catch { return false; }
 }
}
