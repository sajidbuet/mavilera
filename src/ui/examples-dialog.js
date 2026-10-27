// examples-dialog.js -- the example library (WS-F-123): the teaching templates of
// content/templates/ first, then the programs of content/examples/ (exported from the book by
// tools/export_examples.py), grouped by topic and processor. Choosing one opens it in the view of
// its processor. The indexes are fetched the first time the dialog opens (WS-N-011).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { STRINGS } from './strings.js';

const TOPICS = ['basics', 'control', 'tests', 'single', 'multi', 'pipe'];

export class ExamplesDialog {
  /**
   * @param {{base: URL, onOpen: (example, text) => void, templates?: () => Promise<object>,
   *   onTemplate?: (t) => void, templateItems?: (index, make) => Element[]}} hooks
   */
  constructor({ base, onOpen, templates = null, onTemplate = null, templateItems = null }) {
    Object.assign(this, { base, onOpen, templates, onTemplate, templateItems });
    this.index = null;
    const E = STRINGS.examples;
    this.list = el('div.ex-list', {}, el('p.note', { text: E.loading }));
    this.root = el('dialog.examples-dialog', { 'aria-labelledby': 'ex-title' },
      el('h2', { id: 'ex-title', text: E.title }),
      el('p.note', { text: E.note }),
      this.list,
      el('form', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose })));
  }

  async open() {
    this.root.showModal();
    if (this.index) return;
    const E = STRINGS.examples;
    let tpl = null;
    try {
      if (this.templates) tpl = await this.templates();
      const r = await fetch(new URL('content/examples/index.json', this.base));
      if (!r.ok) throw new Error(`index.json: ${r.status}`);
      this.index = await r.json();
    } catch (e) {
      this.list.replaceChildren(el('p.note', { text: E.failed(e.message) }));
      return;
    }
    const item = (title, file, onclick) => el('li', {}, el('button.ex-item', { type: 'button', onclick },
      el('span.ex-title', { text: title }), el('span.ex-file.mono', { text: file })));
    const templates = tpl ? el('section.ex-group.ex-templates', {}, el('h3', { text: STRINGS.templates.heading }),
      el('p.note', { text: STRINGS.templates.note }),
      el('ul', {}, this.templateItems(tpl, (t) => item(t.title, t.file, () => { this.root.close(); this.onTemplate(t); }))
        .map((n) => (n.tagName === 'P' ? el('li.ex-sub', {}, n) : n)))) : null;
    this.list.replaceChildren(templates, ...TOPICS.map((t) => {
      const items = this.index.examples.filter((x) => x.topic === t);
      if (!items.length) return null;
      return el('section.ex-group', {}, el('h3', { text: E.topics[t] }),
        el('ul', {}, items.map((x) => item(x.title, x.file, () => this.choose(x)))));
    }));
  }

  async choose(x) {
    const r = await fetch(new URL(`content/examples/${x.file}`, this.base));
    if (!r.ok) { this.list.prepend(el('p.note', { text: STRINGS.examples.failed(`${x.file}: ${r.status}`) })); return; }
    this.root.close();
    this.onOpen(x, await r.text());
  }
}
