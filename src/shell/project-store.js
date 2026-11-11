// project-store.js -- where projects are kept (pico2 P1-F1, Q2 of research decision D31): IndexedDB in the browser,
// database 'mavilera-projects', object store 'projects' keyed by the project id with an index by module; and the same
// interface in memory, for the Node tests and as the fallback when IndexedDB cannot be opened (a private window may
// refuse it), in which case the shell says that projects are not kept. Every project written or read is checked by
// project.js (readProject). The last project open per module is remembered in localStorage by the shell, not here.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { readProject } from './project.js';

export const DB_NAME = 'mavilera-projects';
export const DB_VERSION = 1;
const STORE = 'projects';

/** A summary for the Projects list. */
const summary = (p) => ({ id: p.id, name: p.name, files: p.files.length, entry: p.entry, modified: p.modified });
const byNewest = (a, b) => b.modified - a.modified;

/**
 * The store interface: list(module) → summaries newest first; get(id) → project | null; put(project) → project;
 * remove(id); kind: 'indexeddb' | 'memory' (persistent or not).
 */
export function memoryStore() {
  const m = new Map();
  const clone = (p) => structuredClone(p);
  return {
    kind: 'memory',
    async list(module) { return [...m.values()].filter((p) => p.module === module).sort(byNewest).map(summary); },
    async get(id) { return m.has(id) ? clone(m.get(id)) : null; },
    async put(p) { const q = readProject(clone(p)); m.set(q.id, q); return clone(q); },
    async remove(id) { m.delete(id); },
  };
}

const request = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

/** Opens the IndexedDB store; rejects if the browser has no IndexedDB or refuses it. */
export async function indexedDbStore(idb = globalThis.indexedDB) {
  if (!idb) throw new Error('no IndexedDB');
  const open = idb.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }).createIndex('module', 'module');
  };
  const db = await request(open);
  const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    kind: 'indexeddb',
    async list(module) {
      const all = await request(tx('readonly').index('module').getAll(module));
      return all.sort(byNewest).map(summary);
    },
    async get(id) {
      const p = await request(tx('readonly').get(id));
      return p ? readProject(p) : null;
    },
    async put(p) {
      const q = readProject(structuredClone(p));
      await request(tx('readwrite').put(q));
      return q;
    },
    async remove(id) { await request(tx('readwrite').delete(id)); },
  };
}

/** IndexedDB if it opens, else memory (with kind 'memory' so that the shell can warn). */
export async function openProjectStore(idb) {
  try { return await indexedDbStore(idb); } catch { return memoryStore(); }
}
