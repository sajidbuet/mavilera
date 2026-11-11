// project-explorer.js -- the files of the open project beside the editor, and the Projects dialog (pico2 P1-F1, research
// decision D31; the flat explorer of R-PICO-ED-01 §3.5). The explorer lists the files (the entry marked), opens one on
// click, and acts on the selected file with labelled buttons: New file, Rename, Duplicate, Delete (confirmed, undo once),
// Make entry. Names are asked for in an inline form, never in a browser prompt; a refused name shows the reason under it.
// The Project menu holds the project actions; the dialog lists the stored projects. No state of its own beyond the
// form: the shell passes the project and receives the user's choices (callbacks).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { STRINGS } from './strings.js';
import { icon } from './icons.js';

const S = () => STRINGS.projects;
/** The kind of a file for its icon colour: 's' (assembly), 'c', 'h', or '' (other). */
const kindOf = (name) => { const e = name.slice(name.lastIndexOf('.') + 1).toLowerCase(); return ['s', 'c', 'h'].includes(e) ? e : ''; };

export class ProjectExplorer {
  /**
   * @param {object} h  callbacks: onOpen(name), onNew(name), onRename(from, to), onDuplicate(name), onDelete(name),
   *   onUndo(), onEntry(name), onNewProject(name), onOpenProjects(), onRenameProject(name), onDeleteProject(),
   *   onImport(file), onExport(); each may throw an Error whose message is shown
   * @param {string[]} extensions  the allowed file extensions (for the hint)
   */
  constructor(h, extensions, compilers = []) {
    this.h = h;
    this.extensions = extensions;
    // contract v10 draft: a module with several C compilers offers the choice per project (onCompiler(id); pico2 P1-F2)
    this.compilers = compilers;
    this.compilerBtns = [];
    this.project = null;
    this.selected = null;
    this.title = el('h3.proj-name');
    this.status = el('span.proj-status', { role: 'status', title: S().savedTitle });
    this.list = el('ul.proj-files', { role: 'list', title: S().listHint, onkeydown: (e) => this.listKey(e) });
    this.form = el('div.proj-form', { hidden: true });
    this.msg = el('p.proj-msg', { role: 'alert', hidden: true });
    // the five file actions: one row of icon buttons, each named and with a tooltip for the selected file
    const b = (act, iconName, fn, cls = '') => el(`button.proj-ibtn${cls}`, { type: 'button', 'data-act': act, onclick: () => this.run(fn) }, icon(iconName, { size: 16 }));
    this.btn = {
      add: b('new', 'fileNew', () => this.askNew()),
      rename: b('rename', 'rename', () => this.askRename()),
      duplicate: b('duplicate', 'duplicate', () => this.h.onDuplicate(this.selected)),
      entry: b('entry', 'flag', () => this.h.onEntry(this.selected)),
      remove: b('delete', 'trash', () => this.askDelete(), '.proj-danger'),
    };
    this.acts = el('div.proj-acts', { role: 'group' }, Object.values(this.btn));
    this.menu = this.projectMenu();
    this.importInput = el('input', { type: 'file', accept: '.zip', hidden: true,
      onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) this.run(() => this.h.onImport(f)); } });
    this.root = el('div.proj-explorer', {}, // in the shell's Files pane, a labelled section (no landmark of its own)
      el('div.proj-head', {}, this.title, this.status), this.acts, this.form, this.msg, this.list, this.importInput);
    // this.menu (the Project menu) is placed by the shell in the pane's header
  }

  askNew() { this.ask(S().namePrompt, '', (n) => this.h.onNew(n)); }
  askRename() { this.ask(S().namePrompt, this.selected, (n) => this.h.onRename(this.selected, n)); }
  askDelete() { this.confirm(S().confirmDelete(this.selected), S().delete, () => this.h.onDelete(this.selected)); }

  /** The file list's keys: Up/Down move between files (and open them), F2 renames, Delete asks to delete. */
  listKey(e) {
    const btns = [...this.list.querySelectorAll('.proj-file')];
    const i = btns.indexOf(e.target.closest?.('.proj-file'));
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (j !== i) { const name = btns[j].dataset.name; this.run(() => this.h.onOpen(name)).then(() => this.focusFile(name)); }
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const name = btns[e.key === 'Home' ? 0 : btns.length - 1].dataset.name;
      this.run(() => this.h.onOpen(name)).then(() => this.focusFile(name));
    } else if (e.key === 'F2') { e.preventDefault(); this.askRename(); }
    else if (e.key === 'Delete') { e.preventDefault(); this.askDelete(); }
  }

  focusFile(name) { this.list.querySelector(`.proj-file[data-name="${CSS.escape(name)}"]`)?.focus(); }

  projectMenu() {
    const item = (label, fn) => el('button', { type: 'button', onclick: () => { menu.open = false; this.run(fn); } }, label);
    const menu = el('details.menu.proj-menu', {},
      // an icon button: its accessible name and tooltip say what it is
      el('summary.proj-menu-btn', { title: S().menuTitle, 'aria-label': S().projectMenu }, icon('more', { size: 16 })),
      el('div.menu-list', { role: 'group' },
        item(S().newProject, () => this.ask(S().projectName, S().untitled, (n) => this.h.onNewProject(n))),
        item(S().open, () => this.h.onOpenProjects()),
        item(S().renameProject, () => this.ask(S().projectName, this.project?.name ?? '', (n) => this.h.onRenameProject(n))),
        item(S().importZip, () => this.importInput.click()),
        item(S().exportZip, () => this.h.onExport()),
        ...(this.compilers.length > 1 ? [el('hr.menu-sep'),
          el('div.proj-menu-group', { role: 'group', 'aria-label': S().compiler, title: S().compilerTitle },
            el('span.proj-menu-label', { text: S().compiler, 'aria-hidden': 'true' }),
            ...(this.compilerBtns = this.compilers.map((c) => el('button.proj-choice', { type: 'button', 'data-compiler': c.id, 'aria-pressed': 'false',
              onclick: () => { menu.open = false; this.run(() => this.h.onCompiler(c.id)); } },
            el('span.proj-check', { 'aria-hidden': 'true' }, icon('check', { size: 12 })), el('span', { text: c.label })))))] : []),
        el('hr.menu-sep'),
        item(S().deleteProject, () => this.confirm(S().confirmDeleteProject(this.project?.name ?? ''), S().delete, () => this.h.onDeleteProject()))));
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { e.stopPropagation(); menu.open = false; menu.querySelector('summary').focus(); } });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
    // the list hangs from the button's right edge; where that would put it past the window's left edge (the Files pane
    // is the first column), it hangs from the left edge instead (GUI walkthrough, 2026-11-11: the items were cut off)
    menu.addEventListener('toggle', () => {
      const list = menu.querySelector('.menu-list');
      list.classList.remove('menu-from-left');
      if (menu.open && list.getBoundingClientRect().left < 4) list.classList.add('menu-from-left');
    });
    return menu;
  }

  /** Show `project`, `active` the selected file (the active tab); `status` 'saved' | 'saving' | 'notKept'. */
  render(project, active, status) {
    this.project = project;
    this.selected = active;
    this.title.textContent = project.name;
    this.title.title = project.name; // a long name is cut with an ellipsis; the tooltip has it whole
    this.list.replaceChildren(...project.files.map((f) => {
      const on = f.name === active, entry = f.name === project.entry, k = kindOf(f.name);
      return el('li', {}, el(`button.proj-file${on ? '.proj-on' : ''}`, { type: 'button', 'aria-current': on ? 'true' : null,
        'data-name': f.name, tabindex: on ? '0' : '-1', title: entry ? S().entryTitle : (k ? `${f.name} · ${S().kinds[k]}` : f.name),
        onclick: () => this.run(() => this.h.onOpen(f.name)), ondblclick: () => { if (f.name === this.selected) this.askRename(); } },
      el(`span.proj-ficon.proj-k-${k || 'x'}`, {}, icon('file', { size: 15 })),
      el('span.proj-file-name.mono', { text: f.name }),
      entry ? el('span.proj-entry', { title: S().entryTitle }, icon('flag', { size: 13 }), el('span.sr-only', { text: ` ${S().entryMark}` })) : null));
    }));
    // the actions name the selected file (the active tab)
    const name = active ?? '';
    const isEntry = active === project.entry;
    const label = (btn, text) => { btn.setAttribute('aria-label', text); btn.title = text; };
    label(this.btn.add, S().newFile);
    label(this.btn.rename, S().renameThis(name));
    label(this.btn.duplicate, S().duplicateThis(name));
    label(this.btn.entry, isEntry ? S().isEntry(name) : S().entryThis(name));
    label(this.btn.remove, S().deleteFile(name));
    this.btn.entry.setAttribute('aria-pressed', String(isEntry));
    this.btn.remove.disabled = project.files.length < 2; // a project keeps one file
    this.acts.setAttribute('aria-label', S().fileActions(name));
    const compiler = project.compiler ?? this.compilers[0]?.id;
    for (const b of this.compilerBtns) b.setAttribute('aria-pressed', String(b.dataset.compiler === compiler));
    this.setStatus(status);
  }

  setStatus(status) {
    const text = status === 'saving' ? S().saving : status === 'notKept' ? S().notKept : S().saved;
    this.status.replaceChildren(...(status === 'saved' ? [icon('check', { size: 12 })] : []), el('span', { text }));
    this.status.classList.toggle('proj-warn', status === 'notKept');
    this.status.classList.toggle('proj-busy', status === 'saving');
  }

  /** Run a user action; an Error's message is shown under the explorer. */
  async run(fn) {
    this.note(null);
    try { await fn(); } catch (e) { this.note(S().refused(e.message), 'error'); }
  }

  /** A message under the explorer (null: none); `action`: [label, fn] for a button such as Undo. */
  note(text, kind = 'info', action = null) {
    this.msg.hidden = !text;
    this.msg.className = `proj-msg${kind === 'error' ? ' proj-error' : ''}`;
    this.msg.replaceChildren(...(text ? [el('span', { text }), action ? el('button.proj-act', { type: 'button', onclick: () => { this.note(null); this.run(action[1]); } }, action[0]) : null] : []));
  }

  /** An inline form asking for a name; `done(name)` may throw (the reason stays under the field). */
  ask(label, value, done) {
    const input = el('input.proj-input.mono', { type: 'text', value: value ?? '', 'aria-label': label, spellcheck: 'false', autocomplete: 'off' });
    const err = el('p.proj-error', { role: 'alert', hidden: true });
    const close = () => { this.form.hidden = true; this.form.replaceChildren(); };
    const submit = async (e) => {
      e.preventDefault();
      try { await done(input.value.trim()); close(); } catch (x) { err.textContent = x.message; err.hidden = false; input.focus(); }
    };
    const exts = this.extensions.join(', ');
    this.form.replaceChildren(el('form', { onsubmit: submit, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
      el('label', {}, el('span', { text: label }), input),
      label === S().namePrompt ? el('p.note', { text: S().nameHint(exts) }) : null, err,
      el('div.proj-form-btns', {}, el('button', { type: 'submit' }, S().ok), el('button', { type: 'button', onclick: close }, S().cancel))));
    this.form.hidden = false;
    input.focus();
    input.select();
  }

  /** An inline confirmation. */
  confirm(text, label, done) {
    const close = () => { this.form.hidden = true; this.form.replaceChildren(); };
    this.form.replaceChildren(el('div', { role: 'group', onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
      el('p', { text }),
      el('div.proj-form-btns', {}, el('button.proj-danger', { type: 'button', onclick: () => { close(); this.run(done); } }, label),
        el('button', { type: 'button', onclick: close }, S().cancel))));
    this.form.hidden = false;
    this.form.querySelector('button:last-child')?.focus(); // Cancel first: a destructive action is never the default
  }
}

/** The stored projects of this architecture, newest first: Open or Delete each. */
export class ProjectsDialog {
  constructor({ list, onOpen, onDelete }) {
    Object.assign(this, { listFn: list, onOpen, onDelete });
    this.body = el('div.proj-dlg-list');
    this.root = el('dialog.projects-dialog', { 'aria-labelledby': 'proj-dlg-title' },
      el('h2', { id: 'proj-dlg-title', text: S().dialogTitle }), el('p.note', { text: S().dialogNote }), this.body,
      el('form', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose })));
  }

  async open(currentId) {
    this.root.showModal();
    await this.fill(currentId);
  }

  async fill(currentId) {
    const items = await this.listFn();
    if (!items.length) { this.body.replaceChildren(el('p.note', { text: S().none })); return; }
    const when = (t) => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    this.body.replaceChildren(el('ul', {}, items.map((p) => el('li.proj-dlg-item', {},
      el('button.proj-dlg-open', { type: 'button', 'aria-current': p.id === currentId ? 'true' : null, // its text is its name (WCAG 2.5.3)
        onclick: () => { this.root.close(); this.onOpen(p.id); } },
      el('span.proj-dlg-name', { text: p.name }), el('span.note', { text: `${S().filesCount(p.files)} · ${S().modifiedAt(when(p.modified))}` })),
      el('button.proj-act.proj-danger', { type: 'button', 'aria-label': S().deleteThis(p.name), onclick: (e) => this.askDelete(e.currentTarget, p, currentId) }, S().delete)))));
  }

  askDelete(btn, p, currentId) {
    const li = btn.closest('li');
    const box = el('div.proj-form-btns', { role: 'group' }, el('span', { text: S().confirmDeleteProject(p.name) }),
      el('button.proj-danger', { type: 'button', onclick: async () => { await this.onDelete(p.id); await this.fill(currentId === p.id ? null : currentId); } }, S().delete),
      el('button', { type: 'button', onclick: () => box.remove() }, S().cancel));
    li.append(box);
    box.querySelector('button:last-child').focus();
  }
}
