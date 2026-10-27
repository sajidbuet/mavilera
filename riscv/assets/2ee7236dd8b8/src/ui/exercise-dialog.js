// exercise-dialog.js -- the exercise mode (spec WS-F-148): the practice exercises of the tool
// (content/exercises/, written for it and unlike the textbook's, W-D24) or an exercise file
// opened from the user's computer; the task, its tests run on the program in the editor, and
// expected against actual for each. No solutions are shipped (C5).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { STRINGS } from './strings.js';

export class ExerciseDialog {
  /**
   * @param {{onRun: () => Promise<object[]|null>, onStarter: (source: string, lang: string) => void,
   *   onClose: () => void, onOpenFile: () => void, list: () => Promise<object>, onPick: (entry) => void}} hooks
   */
  constructor({ onRun, onStarter, onClose, onOpenFile, list, onPick }) {
    Object.assign(this, { onRun, onStarter, onClose, onOpenFile, list, onPick });
    this.ex = null;
    this.X = STRINGS.exercise;
    this.title = el('h2', { id: 'exd-title' });
    this.body = el('div.exd-body');
    this.results = el('div.exd-results', { 'aria-live': 'polite' });
    this.root = el('dialog.exercise-dialog', { 'aria-labelledby': 'exd-title' },
      this.title, this.body, this.results,
      el('form.exd-foot', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose })));
  }

  /** Show the exercise `ex`, or with null the list of practice exercises. */
  set(ex) {
    this.ex = ex;
    this.results.replaceChildren();
    const X = this.X;
    if (!ex) {
      this.title.textContent = X.title;
      const listBox = el('div.exd-list', {}, el('p.note', { text: X.loading }));
      this.body.replaceChildren(el('p', { text: X.none }), listBox,
        el('div.exd-actions', {}, el('button', { type: 'button', text: X.open, onclick: () => this.onOpenFile() })),
        el('p.note', { text: X.privacy }));
      this.fillList(listBox);
      return;
    }
    this.title.textContent = ex.title;
    this.body.replaceChildren(
      el('p.exd-task', { text: ex.task || X.noTask }),
      el('p.note', { text: X.about(ex.tests.length, ex.lang, ex.entry) }),
      el('div.exd-actions', {},
        el('button.primary', { type: 'button', text: X.run, onclick: () => this.run() }),
        ex.starter ? el('button', { type: 'button', text: X.starter, title: X.starterTitle, onclick: () => this.onStarter(ex.starter, ex.lang) }) : null,
        el('button', { type: 'button', text: X.unload, title: X.unloadTitle, onclick: () => { this.onClose(); this.set(null); } })),
      el('p.note', { text: X.privacy }));
  }

  async fillList(box) {
    const X = this.X;
    let ix;
    try { ix = await this.list(); } catch (e) { box.replaceChildren(el('p.note', { text: X.listFailed(e.message) })); return; }
    box.replaceChildren(el('h3', { text: X.practice }), el('p.note', { text: X.practiceNote }),
      ...Object.entries(ix.groups).map(([g, title]) => {
        const items = ix.exercises.filter((e) => e.group === g);
        return items.length ? el('section.exd-group', {}, el('h4', { text: title }),
          el('ul', {}, items.map((e) => el('li', {}, el('button.ex-item', { type: 'button', onclick: () => this.onPick(e) },
            el('span.ex-title', { text: e.title }), el('span.ex-file.mono', { text: e.lang === 'c' ? 'C' : 'asm' })))))) : null;
      }));
  }

  open() { this.root.showModal(); }

  async run() {
    const X = this.X;
    this.results.replaceChildren(el('p.note', { text: X.running }));
    const res = await this.onRun();
    if (!res) { this.results.replaceChildren(el('p.note', { text: X.cannotRun })); return; }
    const passed = res.filter((t) => t.pass).length;
    this.results.replaceChildren(
      el(`p.exd-summary${passed === res.length ? '.ok' : '.bad'}`, { text: X.summary(passed, res.length) }),
      ...res.map((t) => el('details.exd-test', { open: !t.pass },
        el('summary', {}, el('span.exd-mark', { text: t.pass ? '✓' : '✗', 'aria-label': t.pass ? X.pass : X.fail }), ` ${t.name}`),
        t.error ? el('p.exd-error', { text: X.error(t.error) }) : null,
        t.checks.length ? el('table.exd-table', {},
          el('thead', {}, el('tr', {}, el('th', { text: X.colWhat }), el('th', { text: X.colExpected }), el('th', { text: X.colActual }), el('th', { text: '' }))),
          el('tbody', {}, t.checks.map((c) => el(`tr${c.ok ? '' : '.bad'}`, {},
            el('td.mono', { text: c.what }), el('td.mono', { text: c.expected }), el('td.mono', { text: c.actual }),
            el('td', { text: c.ok ? '✓' : '✗', 'aria-label': c.ok ? X.pass : X.fail }))))) : null,
        el('p.note', { text: X.instructions(t.instructions) }))));
  }
}
