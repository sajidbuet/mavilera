// project-session.js -- the open project of a page (pico2 P1-F1, research decision D31): which project is open, its
// changes (through project.js), auto-saving to the store (debounced, with a status the editor shows), the one-step undo
// of a deleted file, the projects list, migration of a stored single program, and .zip import and export. No DOM: the
// shell (main.js) and the explorer (src/ui/project-explorer.js) call it and render what it reports.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { createProject, setText, addFile, renameFile, duplicateFile, setEntry, setCompiler, deleteFile, openTab, closeTab, renameProject, fileText, ProjectError } from './project.js';
import { writeZip, readZip, readZipComment } from './zip.js';

/** {name?, entry?} from an archive comment written by exportZip; {} for anything else (never trusted beyond strings). */
function projectNote(comment) {
  try {
    const o = JSON.parse(comment);
    if (o?.mavilera !== 'project') return {};
    const str = (v) => (typeof v === 'string' ? v : undefined);
    return { name: str(o.name), entry: str(o.entry), compiler: str(o.compiler) };
  } catch { return {}; }
}

export const SAVE_DELAY = 400; // ms, as the workspace record (main.js saveSoon)

export class ProjectSession {
  /**
   * @param {object} o
   * @param {object} o.store         project-store.js interface
   * @param {string} o.module        the architecture id
   * @param {string[]} o.extensions  the file extensions a project may hold
   * @param {(what: string) => void} [o.onChange]  'project' (another project), 'files', 'tabs', 'text', 'status'
   */
  constructor({ store, module, extensions, onChange = () => {} }) {
    this.store = store;
    this.module = module;
    this.extensions = extensions;
    this.onChange = onChange;
    this.project = null;
    this.status = store.kind === 'memory' ? 'notKept' : 'saved';
    this.timer = null;
    this.deleted = null; // {name, text, index, entry} of the last deleted file, for one undo
  }

  get persistent() { return this.store.kind !== 'memory'; }

  /**
   * Open the project `id` if it exists; otherwise migrate (`migrate()` → [{name, text}] or null) or create one from
   * `defaults` ([{name, text}]). Returns {project, how: 'opened' | 'migrated' | 'created'}.
   */
  async start({ id, migrate, defaults, title }) {
    const p = id ? await this.store.get(id).catch(() => null) : null;
    if (p && p.module === this.module) { this.project = p; return { project: p, how: 'opened' }; }
    const list = await this.store.list(this.module).catch(() => []);
    if (list.length) { this.project = await this.store.get(list[0].id); if (this.project) return { project: this.project, how: 'opened' }; }
    const files = migrate?.() ?? null;
    const how = files?.length ? 'migrated' : 'created';
    this.project = createProject({ module: this.module, name: title, files: files?.length ? files : defaults, extensions: this.extensions });
    await this.saveNow();
    return { project: this.project, how };
  }

  /**
   * Apply a change made by project.js; it is saved after SAVE_DELAY (tabs too, so that a reload reopens them). Not
   * decided by `modified`: two changes in the same millisecond carry the same time.
   */
  apply(next, what = 'files') {
    this.project = next;
    this.saveSoon();
    this.onChange(what);
    return next;
  }

  saveSoon() {
    clearTimeout(this.timer);
    if (this.persistent) this.setStatus('saving');
    this.timer = setTimeout(() => this.saveNow(), SAVE_DELAY);
  }

  /** Save at once (also at pagehide); the status says whether it is kept. */
  async saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.project) return;
    try {
      await this.store.put(this.project);
      this.setStatus(this.persistent ? 'saved' : 'notKept');
    } catch {
      this.setStatus('notKept');
    }
  }

  setStatus(s) { if (s !== this.status) { this.status = s; this.onChange('status'); } }

  // --- files (each throws ProjectError with a reason; the explorer shows it) ---------------------------
  setText(name, text) { return this.apply(setText(this.project, name, text), 'text'); }
  addFile(name, text = '') { return this.apply(addFile(this.project, name, text, { extensions: this.extensions })); }
  renameFile(from, to) { return this.apply(renameFile(this.project, from, to, { extensions: this.extensions })); }
  duplicateFile(name) { return this.apply(duplicateFile(this.project, name)); }
  setEntry(name) { return this.apply(setEntry(this.project, name)); }
  /** The extra language that compiles the project's C (pico2 P1-F2); null: the module's first. */
  setCompiler(id) { return this.apply(setCompiler(this.project, id), 'compiler'); }
  deleteFile(name) {
    const index = this.project.files.findIndex((f) => f.name === name);
    this.deleted = { name, text: fileText(this.project, name), index, entry: this.project.entry === name };
    return this.apply(deleteFile(this.project, name));
  }
  /** Undo the last delete (once): the file comes back at its place, as the entry if it was. */
  undoDelete() {
    const d = this.deleted;
    if (!d) return null;
    this.deleted = null;
    let p = addFile(this.project, d.name, d.text, { extensions: this.extensions });
    const f = p.files.pop();
    p = { ...p, files: [...p.files.slice(0, d.index), f, ...p.files.slice(d.index)] };
    if (d.entry) p = setEntry(p, d.name);
    this.apply(p);
    return d.name;
  }
  openTab(name) { return this.apply(openTab(this.project, name), 'tabs'); }
  closeTab(name) { return this.apply(closeTab(this.project, name), 'tabs'); }

  /** A file name that is free in this project: `name`, else stem-2.ext, stem-3.ext, … */
  freeName(name) {
    if (!this.project.files.some((f) => f.name === name)) return name;
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let i = 2; ; i++) { const n = `${stem.slice(0, 55)}-${i}${ext}`; if (!this.project.files.some((f) => f.name === n)) return n; }
  }

  // --- projects --------------------------------------------------------------------------------------
  list() { return this.store.list(this.module); }

  /** Make `p` the open project (saved first), e.g. a new one or one from a link or a .zip. */
  async switchTo(p) {
    await this.saveNow();
    this.project = p;
    this.deleted = null;
    await this.saveNow();
    this.onChange('project');
    return p;
  }

  async newProject(name, files, entry) {
    return this.switchTo(createProject({ module: this.module, name, files, entry, extensions: this.extensions }));
  }

  async openProject(id) {
    const p = await this.store.get(id);
    if (!p) throw new ProjectError('missing', 'the project is no longer stored');
    return this.switchTo(p);
  }

  renameProject(name) { return this.apply(renameProject(this.project, name), 'files'); }

  /** Delete a stored project; deleting the open one opens the newest other (or `fallback()` → a new project). */
  async deleteProject(id, fallback) {
    await this.store.remove(id);
    if (this.project?.id !== id) return null;
    const rest = await this.list();
    clearTimeout(this.timer);
    this.project = null;
    if (rest.length) return this.openProject(rest[0].id);
    return this.switchTo(fallback());
  }

  /**
   * A project from a .zip (checked by zip.js and project.js); it becomes the open project. The project's name and entry
   * come from the archive comment that exportZip writes; without one (another archiver), the name is the file name and
   * the entry the first main.* file, else the first file.
   */
  async importZip(bytes, fileName) {
    const files = await readZip(bytes, { extensions: this.extensions });
    if (!files.length) throw new ProjectError('missing', 'the archive holds no files');
    const note = projectNote(readZipComment(bytes));
    const name = note.name ?? fileName.replace(/\.zip$/i, '');
    const entry = (note.entry && files.some((f) => f.name === note.entry) ? note.entry : null)
      ?? files.find((f) => /^main\./i.test(f.name))?.name ?? files[0].name;
    return this.switchTo(createProject({ module: this.module, name, files, entry, extensions: this.extensions, compiler: note.compiler }));
  }

  /** The open project as .zip bytes, with a file name (the project's name made safe); name, entry, compiler in the comment. */
  async exportZip() {
    const { name, entry, compiler } = this.project;
    const comment = JSON.stringify({ mavilera: 'project', v: 1, name, entry, ...(compiler ? { compiler } : {}) }).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const bytes = await writeZip(this.project.files, { comment });
    const base = this.project.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
    return { bytes, fileName: `${base}.zip` };
  }
}
