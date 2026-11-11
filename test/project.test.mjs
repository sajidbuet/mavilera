// project.test.mjs -- pico2 P1-F1 projects (docs/architecture/pico2-p1f1-projects.md, research decision D31): the
// project model (names, entry, tabs, rename/duplicate/delete, limits, build plan, read-back) and the in-memory store.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createProject, addFile, renameFile, duplicateFile, deleteFile, setEntry, setText, openTab, closeTab, buildPlan,
  readProject, fromSingle, checkName, copyName, fileText, projectBytes, LIMITS, ProjectError, PROJECT_VERSION,
} from '../src/shell/project.js';
import { memoryStore, openProjectStore } from '../src/shell/project-store.js';

const EXT = ['.s', '.c', '.h'];
const three = () => createProject({
  module: 'pico2', name: 'Blink', extensions: EXT, now: 1,
  files: [{ name: 'main.s', text: 'call blink\n' }, { name: 'blink.s', text: 'blink: ret\n' }, { name: 'delay.s', text: 'delay: ret\n' }],
});
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ProjectError, `not a ProjectError: ${e}`); return e.code; } return null; };

test('P1-F1: a project has files, an entry (the first file by default), one open tab and a version', () => {
  const p = three();
  assert.equal(p.v, PROJECT_VERSION);
  assert.equal(p.entry, 'main.s');
  assert.deepEqual(p.open, ['main.s']);
  assert.equal(p.active, 'main.s');
  assert.match(p.id, /^p[0-9a-z]+-[0-9a-f]+$/);
  assert.equal(fileText(p, 'blink.s'), 'blink: ret\n');
});

test('P1-F1: file names are flat and checked; extensions follow the module', () => {
  for (const ok of ['main.s', 'a_b-c.d.s', 'X1.h']) assert.equal(checkName(ok, EXT), ok);
  for (const bad of ['', '.hidden.s', '-x.s', 'dir/a.s', 'a\\b.s', '../a.s', 'a b.s', 'ä.s', `${'x'.repeat(63)}.s`]) assert.equal(code(() => checkName(bad, EXT)), 'name', bad);
  assert.equal(code(() => checkName('notes.txt', EXT)), 'extension');
  assert.equal(code(() => createProject({ module: 'pico2', files: [{ name: 'a.s' }, { name: 'a.s' }] })), 'exists');
  assert.equal(code(() => createProject({ module: 'pico2', files: [] })), 'missing');
  assert.equal(code(() => createProject({ module: 'pico2', files: [{ name: 'a.s' }], entry: 'b.s' })), 'missing');
});

test('P1-F1: changes return a new project and leave the old one untouched', () => {
  const p = three();
  const before = structuredClone(p);
  const q = setText(p, 'blink.s', 'blink: nop\n', 2);
  assert.deepEqual(p, before);
  assert.equal(fileText(q, 'blink.s'), 'blink: nop\n');
  assert.equal(q.modified, 2);
});

test('P1-F1: add, rename (entry and tabs follow), duplicate, delete (entry moves, last file kept)', () => {
  let p = addFile(three(), 'util.s', 'u: ret\n', { extensions: EXT });
  assert.deepEqual(p.open, ['main.s', 'util.s']);
  assert.equal(p.active, 'util.s');
  assert.equal(code(() => addFile(p, 'util.s')), 'exists');
  p = renameFile(p, 'main.s', 'start.s', { extensions: EXT });
  assert.equal(p.entry, 'start.s');
  assert.deepEqual(p.open, ['start.s', 'util.s']);
  assert.equal(code(() => renameFile(p, 'start.s', 'util.s')), 'exists');
  p = duplicateFile(p, 'util.s');
  assert.deepEqual(p.files.map((f) => f.name), ['start.s', 'blink.s', 'delay.s', 'util.s', 'util-copy.s']);
  assert.equal(copyName(p, 'util.s'), 'util-copy2.s');
  assert.equal(p.active, 'util-copy.s');
  p = deleteFile(p, 'start.s');
  assert.equal(p.entry, 'blink.s', 'the entry moves to the first remaining file');
  assert.ok(!p.open.includes('start.s'));
  for (const n of ['blink.s', 'delay.s', 'util.s']) p = deleteFile(p, n);
  assert.deepEqual(p.files.map((f) => f.name), ['util-copy.s']);
  assert.equal(code(() => deleteFile(p, 'util-copy.s')), 'last');
  assert.deepEqual(p.open, ['util-copy.s']);
});

test('P1-F1: tabs open, close (a neighbour becomes active; the last tab stays) and do not change the content', () => {
  let p = openTab(openTab(three(), 'blink.s'), 'delay.s');
  assert.deepEqual(p.open, ['main.s', 'blink.s', 'delay.s']);
  assert.equal(p.active, 'delay.s');
  p = closeTab(p, 'delay.s');
  assert.equal(p.active, 'blink.s');
  p = closeTab(closeTab(p, 'blink.s'), 'main.s');
  assert.deepEqual(p.open, ['main.s']);
  assert.equal(p.modified, 1, 'tabs are not a content change');
});

test('Q3 (D31): Build assembles every assembly file, the entry first; a .c entry is compiled alone; headers are not built', () => {
  let p = setEntry(addFile(three(), 'pins.h', '#define LED 25\n', { extensions: EXT }), 'blink.s');
  assert.deepEqual(buildPlan(p), { lang: 'asm', files: ['blink.s', 'main.s', 'delay.s'].map((n) => ({ name: n, text: fileText(p, n) })) });
  p = setEntry(addFile(p, 'main.c', 'int main(void){return 0;}\n', { extensions: EXT }), 'main.c');
  assert.deepEqual(buildPlan(p), { lang: 'c', file: { name: 'main.c', text: 'int main(void){return 0;}\n' } });
  const upper = createProject({ module: 'pico2', files: [{ name: 'boot.S', text: 'x' }, { name: 'a.s', text: 'y' }] });
  assert.deepEqual(buildPlan(upper).files.map((f) => f.name), ['boot.S', 'a.s'], '.S counts as assembly');
});

test('Q7 (D31): limits of 64 files and 2 MiB of text', () => {
  const files = Array.from({ length: LIMITS.files }, (_, i) => ({ name: `f${i}.s`, text: '' }));
  const p = createProject({ module: 'pico2', files });
  assert.equal(code(() => addFile(p, 'one-more.s')), 'limit');
  const big = 'x'.repeat(LIMITS.bytes);
  assert.equal(code(() => createProject({ module: 'pico2', files: [{ name: 'a.s', text: big }, { name: 'b.s', text: 'y' }] })), 'limit');
  assert.equal(projectBytes(createProject({ module: 'pico2', files: [{ name: 'a.s', text: 'ü' }] })), 2, 'bytes are UTF-8');
});

test('P1-F1: a project reads back from storage; damaged tabs are repaired, another version is refused', () => {
  const p = openTab(three(), 'blink.s');
  assert.deepEqual(readProject(JSON.parse(JSON.stringify(p))), p);
  const odd = readProject({ ...p, open: ['gone.s'], active: 'gone.s' });
  assert.deepEqual(odd.open, ['main.s']);
  assert.equal(odd.active, 'main.s');
  assert.equal(code(() => readProject({ ...p, v: 99 })), 'format');
  assert.equal(code(() => readProject(null)), 'format');
});

test('P1-F1 migration: a single stored program becomes a one-file project named after it', () => {
  const p = fromSingle({ module: 'pico2', name: 'main.s', text: 'nop\n', now: 5 });
  assert.equal(p.name, 'main');
  assert.deepEqual(p.files, [{ name: 'main.s', text: 'nop\n' }]);
  assert.equal(p.entry, 'main.s');
});

test('Q2 (D31): the memory store lists by module, newest first, keeps copies and checks what it stores', async () => {
  const s = memoryStore();
  assert.equal(s.kind, 'memory');
  const a = await s.put({ ...three(), modified: 10 });
  const b = await s.put({ ...createProject({ module: 'pico2', name: 'Other', files: [{ name: 'x.s', text: '' }] }), modified: 20 });
  await s.put(createProject({ module: 'riscv', files: [{ name: 'y.s', text: '' }] }));
  assert.deepEqual((await s.list('pico2')).map((x) => x.id), [b.id, a.id]);
  assert.deepEqual((await s.list('pico2'))[1], { id: a.id, name: 'Blink', files: 3, entry: 'main.s', modified: 10 });
  const got = await s.get(a.id);
  got.files[0].text = 'changed';
  assert.equal((await s.get(a.id)).files[0].text, 'call blink\n', 'the store hands out copies');
  await assert.rejects(s.put({ ...a, files: [] }), (e) => e instanceof ProjectError);
  await s.remove(a.id);
  assert.equal(await s.get(a.id), null);
  assert.equal((await openProjectStore(undefined)).kind, 'memory', 'without IndexedDB the store falls back to memory');
});
