// project-session.test.mjs -- src/shell/project-session.js (pico2 P1-F1, research decision D31): starting (open the last
// project, else migrate, else create), auto-save after the delay with its status, undo of a delete (place and entry),
// switching projects, deleting the open project, and .zip export and import through the session.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

import { ProjectSession, SAVE_DELAY } from '../src/shell/project-session.js';
import { memoryStore } from '../src/shell/project-store.js';
import { createProject, ProjectError } from '../src/shell/project.js';

const EXT = ['.s', '.c', '.h'];
/** A memory store that reports itself as persistent (as IndexedDB would), so that the status shows Saving/Saved. */
const persistentStore = () => ({ ...memoryStore(), kind: 'indexeddb' });
const session = (store = persistentStore(), seen = []) => new ProjectSession({ store, module: 'pico2', extensions: EXT, onChange: (w) => seen.push(w) });
const DEFAULTS = [{ name: 'main.s', text: 'nop\n' }];

test('start: migrate a kept program on the first start, then open the last project; create when nothing is kept', async () => {
  const store = persistentStore();
  const s = session(store);
  const r = await s.start({ id: null, migrate: () => [{ name: 'main.c', text: 'int main(void){return 0;}\n' }, { name: 'main.s', text: 'ret\n' }], defaults: DEFAULTS, title: 'My program' });
  assert.equal(r.how, 'migrated');
  assert.equal(r.project.name, 'My program');
  assert.equal(r.project.entry, 'main.c');
  const again = await session(store).start({ id: r.project.id, migrate: () => { throw new Error('not called'); }, defaults: DEFAULTS });
  assert.equal(again.how, 'opened');
  assert.deepEqual(again.project.files, r.project.files);
  const created = await session(persistentStore()).start({ id: null, migrate: () => [], defaults: DEFAULTS, title: 'T' });
  assert.equal(created.how, 'created');
  assert.deepEqual(created.project.files, DEFAULTS);
});

test('auto-save: a change is stored after the delay; the status goes Saving → Saved (a memory store says not kept)', async () => {
  const store = persistentStore();
  const seen = [];
  const s = session(store, seen);
  await s.start({ id: null, defaults: DEFAULTS });
  s.setText('main.s', 'addi a0, a0, 1\n');
  assert.equal(s.status, 'saving');
  assert.equal((await store.get(s.project.id)).files[0].text, 'nop\n', 'not yet stored');
  await sleep(SAVE_DELAY + 100);
  assert.equal(s.status, 'saved');
  assert.equal((await store.get(s.project.id)).files[0].text, 'addi a0, a0, 1\n');
  assert.ok(seen.includes('status') && seen.includes('text'));
  const m = session(memoryStore());
  await m.start({ id: null, defaults: DEFAULTS });
  assert.equal(m.status, 'notKept');
  assert.equal(m.persistent, false);
});

test('undo of a delete: the file comes back at its place and as the entry if it was; once only', async () => {
  const s = session();
  await s.start({ id: null, defaults: [{ name: 'a.s', text: 'A' }, { name: 'b.s', text: 'B' }, { name: 'c.s', text: 'C' }] });
  s.deleteFile('a.s');
  assert.equal(s.project.entry, 'b.s');
  assert.equal(s.undoDelete(), 'a.s');
  assert.deepEqual(s.project.files.map((f) => f.name), ['a.s', 'b.s', 'c.s']);
  assert.equal(s.project.entry, 'a.s');
  assert.equal(s.undoDelete(), null, 'only once');
  assert.throws(() => s.addFile('d.txt'), (e) => e instanceof ProjectError && e.code === 'extension');
  assert.equal(s.freeName('b.s'), 'b-2.s');
  assert.equal(s.freeName('new.s'), 'new.s');
});

test('projects: new, list, open, rename, delete (the open one: the newest other opens, or a fallback)', async () => {
  const store = persistentStore();
  const seen = [];
  const s = session(store, seen);
  const first = (await s.start({ id: null, defaults: DEFAULTS, title: 'One' })).project;
  await s.newProject('Two', [{ name: 'x.s', text: '' }]);
  assert.ok(seen.includes('project'));
  assert.equal((await s.list()).length, 2);
  s.renameProject('Second');
  await s.saveNow();
  assert.ok((await s.list()).some((x) => x.name === 'Second'));
  await s.openProject(first.id);
  assert.equal(s.project.name, 'One');
  await s.deleteProject(first.id, () => createProject({ module: 'pico2', files: DEFAULTS }));
  assert.equal(s.project.name, 'Second', 'the remaining project opens');
  await s.deleteProject(s.project.id, () => createProject({ module: 'pico2', name: 'Fresh', files: DEFAULTS }));
  assert.equal(s.project.name, 'Fresh', 'with none left, the fallback');
  await assert.rejects(s.openProject('gone'), (e) => e instanceof ProjectError);
});

test('zip: export then import gives the same files, name and entry (archive comment); a re-export is byte-identical', async () => {
  const s = session();
  await s.start({ id: null, defaults: [{ name: 'util.s', text: 'u: ret\n' }, { name: 'main.s', text: 'call u\n' }], title: 'Blink demo — ধাপ ১' });
  s.setEntry('util.s');
  const { bytes, fileName } = await s.exportZip();
  assert.equal(fileName, 'Blink-demo.zip');
  const before = s.project;
  await s.importZip(bytes, 'renamed by the student.zip');
  assert.notEqual(s.project.id, before.id, 'a new project');
  assert.equal(s.project.name, before.name, 'the name, with non-ASCII letters, from the comment');
  assert.equal(s.project.entry, 'util.s', 'the entry from the comment, although main.s exists');
  assert.deepEqual(s.project.files, before.files);
  assert.deepEqual((await s.exportZip()).bytes, bytes, 'deterministic: the re-import exports the same bytes');
});

test('the C compiler (pico2 P1-F2, D33 Q5): set, cleared to the module default, kept in storage and through a .zip', async () => {
  const store = persistentStore();
  const s = session(store);
  await s.start({ id: null, defaults: [{ name: 'main.c', text: 'int main(void){return 0;}\n' }] });
  assert.equal(s.project.compiler, undefined, 'the module\'s first by default');
  s.setCompiler('sdk-c');
  assert.equal(s.project.compiler, 'sdk-c');
  await s.saveNow();
  assert.equal((await store.get(s.project.id)).compiler, 'sdk-c');
  const { bytes } = await s.exportZip();
  await s.importZip(bytes, 'copy.zip');
  assert.equal(s.project.compiler, 'sdk-c', 'carried in the archive comment');
  s.setCompiler(null);
  assert.ok(!('compiler' in s.project));
  assert.throws(() => s.setCompiler('Not An Id'), (e) => e instanceof ProjectError);
});

test('zip: an archive from another tool (no or a foreign comment): the name from the file name, main.* the entry', async () => {
  const { writeZip } = await import('../src/shell/zip.js');
  const files = [{ name: 'util.s', text: 'u: ret\n' }, { name: 'main.s', text: 'call u\n' }];
  for (const comment of ['', 'made by an archiver', '{"mavilera":"project","name":7,"entry":"gone.s"}']) {
    const s = session();
    await s.start({ id: null, defaults: DEFAULTS });
    await s.importZip(await writeZip(files, { comment }), 'Lab 3.zip');
    assert.equal(s.project.name, 'Lab 3', comment);
    assert.equal(s.project.entry, 'main.s', comment);
    assert.deepEqual(s.project.files, files);
  }
});
