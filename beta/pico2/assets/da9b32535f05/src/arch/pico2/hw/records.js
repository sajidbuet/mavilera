// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const MAX_BUILDS = 500;
export function openStore({ indexedDB = globalThis.indexedDB, name = 'mavilera-hw' } = {}) {
 if (!indexedDB) return memoryStore();
 let db = null;
 const ready = () => db ?? (db = new Promise((resolve, reject) => {
 const r = indexedDB.open(name, 1);
 r.onupgradeneeded = () => { for (const s of ['builds', 'boards']) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
 r.onsuccess = () => resolve(r.result);
 r.onerror = () => reject(r.error);
 }));
 const tx = async (store, mode, f) => {
 const d = await ready();
 return new Promise((resolve, reject) => { const t = d.transaction(store, mode); const q = f(t.objectStore(store)); t.oncomplete = () => resolve(q?.result); t.onerror = () => reject(t.error); });
 };
 const s = {
 kind: 'indexeddb',
 get: (store, key) => tx(store, 'readonly', (o) => o.get(key)),
 put: (store, key, value) => tx(store, 'readwrite', (o) => o.put(value, key)),
 delete: (store, key) => tx(store, 'readwrite', (o) => o.delete(key)),
 };
 return withFallback(s);
}
export function memoryStore() {
 const m = { builds: new Map(), boards: new Map() };
 return { kind: 'memory', get: async (s, k) => structuredClone(m[s].get(k)), put: async (s, k, v) => { m[s].set(k, structuredClone(v)); }, delete: async (s, k) => { m[s].delete(k); } };
}
function withFallback(s) {
 let mem = null;
 const wrap = (f) => async (...a) => { if (mem) return mem[f](...a); try { return await s[f](...a); } catch { mem = memoryStore(); return mem[f](...a); } };
 return { get kind() { return mem ? 'memory' : s.kind; }, get: wrap('get'), put: wrap('put'), delete: wrap('delete') };
}
export class Records {
 constructor(store = memoryStore()) { this.store = store; }
 async buildNumber(project, buildId) {
 const rec = (await this.store.get('builds', project)) ?? { next: 1, ids: [] };
 const known = rec.ids.find((x) => x.id === buildId);
 if (known) return { n: known.n, isNew: false };
 const n = rec.next;
 rec.ids.push({ id: buildId, n, time: Date.now() });
 rec.next = n + 1;
 if (rec.ids.length > MAX_BUILDS) rec.ids.splice(0, rec.ids.length - MAX_BUILDS);
 await this.store.put('builds', project, rec);
 return { n, isNew: true };
 }
 async numberOf(project, buildId) {
 const rec = await this.store.get('builds', project);
 return rec?.ids.find((x) => x.id === buildId)?.n ?? null;
 }
 async boardWritten(serial, { buildId, n, project, projectName, bytes, kind }) {
 const r = { buildId, n, project, projectName, bytes, kind, time: Date.now(), checked: null };
 await this.store.put('boards', serial, r);
 return r;
 }
 async boardChecked(serial, same) {
 const r = await this.store.get('boards', serial);
 if (!r) return null;
 r.checked = { same, time: Date.now() };
 await this.store.put('boards', serial, r);
 return r;
 }
 board(serial) { return this.store.get('boards', serial); }
 forgetBoard(serial) { return this.store.delete('boards', serial); }
}
export function badgeOf({ board, current, project, serial = null }) {
 if (!board || !serial) return { state: 'none', serial };
 if (board.project !== project) return { state: 'foreign', serial, board };
 if (current && board.buildId === current.buildId) return { state: 'same', serial, n: board.n, checked: board.checked?.same ?? null };
 return { state: 'other', serial, n: current?.n ?? null, m: board.n, checked: board.checked?.same ?? null };
}
