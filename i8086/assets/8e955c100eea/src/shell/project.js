// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const PROJECT_VERSION = 1;
export const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
export const LIMITS = Object.freeze({ files: 64, bytes: 2 * 1024 * 1024, projectName: 64 });
export class ProjectError extends Error {
 constructor(code, message, data = {}) {
 super(message);
 this.code = code;
 this.data = data;
 }
}
const enc = new TextEncoder();
const extOf = (name) => (name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '');
const stemOf = (name) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);
export const projectBytes = (p) => p.files.reduce((n, f) => n + enc.encode(f.text).length, 0);
export function checkName(name, extensions) {
 if (typeof name !== 'string' || !FILE_NAME.test(name)) throw new ProjectError('name', `not a valid file name: ${JSON.stringify(String(name))}`, { name });
 if (extensions?.length && !extensions.includes(extOf(name)) && !extensions.includes(name.toLowerCase())) {
 throw new ProjectError('extension', `${name}: only ${extensions.join(', ')} files`, { name, extensions });
 }
 return name;
}
function checkLimits(p) {
 if (p.files.length > LIMITS.files) throw new ProjectError('limit', `more than ${LIMITS.files} files`, { limit: 'files' });
 if (projectBytes(p) > LIMITS.bytes) throw new ProjectError('limit', `more than ${LIMITS.bytes / 1024 / 1024} MiB of text`, { limit: 'bytes' });
 return p;
}
export function createProject({ id, module, name = 'Project', files, entry, extensions, compiler, now = Date.now() }) {
 if (!Array.isArray(files) || files.length === 0) throw new ProjectError('missing', 'a project needs at least one file');
 const seen = new Set();
 const list = files.map((f) => {
 checkName(f.name, extensions);
 if (seen.has(f.name)) throw new ProjectError('exists', `two files named ${f.name}`, { name: f.name });
 seen.add(f.name);
 return { name: f.name, text: typeof f.text === 'string' ? f.text : '' };
 });
 const first = list[0].name;
 const e = entry ?? first;
 if (!seen.has(e)) throw new ProjectError('missing', `the entry ${e} is not a file of the project`, { name: e });
 return checkLimits({
 v: PROJECT_VERSION, id: id ?? newId(), module, name: projectName(name), files: list, entry: e,
 open: [e], active: e, created: now, modified: now, ...(COMPILER.test(compiler ?? '') ? { compiler } : {}),
 });
}
const COMPILER = /^[a-z][a-z0-9-]{0,31}$/;
export function setCompiler(p, compiler, now) {
 if (compiler !== null && !COMPILER.test(compiler)) throw new ProjectError('name', `not a compiler id: ${compiler}`);
 const { compiler: _old, ...rest } = p;
 return touch(compiler === null ? rest : { ...rest, compiler }, {}, now);
}
export function projectName(name) {
 const s = String(name ?? '').trim().slice(0, LIMITS.projectName);
 return s || 'Project';
}
export function newId() {
 const r = globalThis.crypto?.getRandomValues ? Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(16).slice(2, 14);
 return `p${Date.now().toString(36)}-${r}`;
}
const touch = (p, changes, now = Date.now()) => checkLimits({ ...p, ...changes, modified: now });
const has = (p, name) => p.files.some((f) => f.name === name);
const need = (p, name) => { if (!has(p, name)) throw new ProjectError('missing', `no file ${name}`, { name }); };
export const fileText = (p, name) => p.files.find((f) => f.name === name)?.text;
export function setText(p, name, text, now) {
 need(p, name);
 return touch(p, { files: p.files.map((f) => (f.name === name ? { name, text } : f)) }, now);
}
export function addFile(p, name, text = '', { extensions, now } = {}) {
 checkName(name, extensions);
 if (has(p, name)) throw new ProjectError('exists', `${name} exists`, { name });
 return touch(p, { files: [...p.files, { name, text }], open: [...p.open, name], active: name }, now);
}
export function renameFile(p, from, to, { extensions, now } = {}) {
 need(p, from);
 if (from === to) return p;
 checkName(to, extensions);
 if (has(p, to)) throw new ProjectError('exists', `${to} exists`, { name: to });
 const r = (n) => (n === from ? to : n);
 return touch(p, { files: p.files.map((f) => (f.name === from ? { name: to, text: f.text } : f)), entry: r(p.entry), open: p.open.map(r), active: r(p.active) }, now);
}
export function copyName(p, name) {
 const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
 for (let i = 1; ; i++) {
 const n = `${stemOf(name).slice(0, 50)}-copy${i === 1 ? '' : i}${ext}`;
 if (!has(p, n)) return n;
 }
}
export function duplicateFile(p, name, now) {
 need(p, name);
 const copy = copyName(p, name);
 const i = p.files.findIndex((f) => f.name === name);
 const files = [...p.files.slice(0, i + 1), { name: copy, text: p.files[i].text }, ...p.files.slice(i + 1)];
 return touch(p, { files, open: [...p.open, copy], active: copy }, now);
}
export function deleteFile(p, name, now) {
 need(p, name);
 if (p.files.length === 1) throw new ProjectError('last', 'a project keeps at least one file', { name });
 const files = p.files.filter((f) => f.name !== name);
 const entry = p.entry === name ? files[0].name : p.entry;
 let open = p.open.filter((n) => n !== name);
 if (open.length === 0) open = [entry];
 const active = p.active === name ? open[Math.max(0, p.open.indexOf(name) - 1)] ?? open[0] : p.active;
 return touch(p, { files, entry, open, active: open.includes(active) ? active : open[0] }, now);
}
export function setEntry(p, name, now) {
 need(p, name);
 return touch(p, { entry: name }, now);
}
export function openTab(p, name) {
 need(p, name);
 return { ...p, open: p.open.includes(name) ? p.open : [...p.open, name], active: name };
}
export function closeTab(p, name) {
 if (!p.open.includes(name) || p.open.length === 1) return p;
 const i = p.open.indexOf(name);
 const open = p.open.filter((n) => n !== name);
 return { ...p, open, active: p.active === name ? open[Math.max(0, i - 1)] : p.active };
}
export const renameProject = (p, name, now) => touch(p, { name: projectName(name) }, now);
export function buildPlan(p, { asmExtensions = ['.s'], cExtension = '.c' } = {}) {
 if (extOf(p.entry) === cExtension) return { lang: 'c', file: p.files.find((f) => f.name === p.entry) };
 const asm = p.files.filter((f) => asmExtensions.includes(extOf(f.name)));
 const ordered = [...asm.filter((f) => f.name === p.entry), ...asm.filter((f) => f.name !== p.entry)];
 return { lang: 'asm', files: ordered };
}
export function fromSingle({ module, name, text, projectTitle, now }) {
 return createProject({ module, name: projectTitle ?? stemOf(name), files: [{ name, text }], now });
}
export function readProject(obj, { extensions } = {}) {
 if (!obj || obj.v !== PROJECT_VERSION || !Array.isArray(obj.files)) throw new ProjectError('format', 'not a project of this version');
 const p = createProject({ id: obj.id, module: obj.module, name: obj.name, files: obj.files, entry: obj.entry, extensions, compiler: obj.compiler, now: obj.created ?? Date.now() });
 const open = (Array.isArray(obj.open) ? obj.open : []).filter((n) => has(p, n));
 return { ...p, open: open.length ? open : [p.entry], active: has(p, obj.active) && open.includes(obj.active) ? obj.active : (open[0] ?? p.entry), modified: obj.modified ?? p.created };
}
