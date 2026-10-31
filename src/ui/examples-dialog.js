// examples-dialog.js -- the example library (WS-F-123): the teaching templates of
// content/templates/ first, then the programs of content/examples/ (exported from the book by
// tools/export_examples.py), grouped by topic and processor. Choosing one opens it in the view of
// its processor. The indexes are fetched the first time the dialog opens (WS-N-011).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { STRINGS } from './strings.js';

export class ExamplesDialog {
  /**
   * @param {{index: URL | null, onOpen: (example, text) => void, templates?: () => Promise<object>,
   *   onTemplate?: (t) => void, templateItems?: (index, make) => Element[]}} hooks; index, the examples' index (the architecture's
   *   content.examples), or null: templates only
   */
  constructor({ index, onOpen, templates = null, onTemplate = null, templateItems = null }) {
    Object.assign(this, { indexUrl: index, onOpen, templates, onTemplate, templateItems });
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
      if (this.indexUrl) {
        const r = await fetch(this.indexUrl);
        if (!r.ok) throw new Error(`index.json: ${r.status}`);
        this.index = await r.json();
      } else this.index = { examples: [] };
    } catch (e) {
      this.list.replaceChildren(el('p.note', { text: E.failed(e.message) }));
      return;
    }
    const item = (title, file, onclick) => el('li', {}, el('button.ex-item', { type: 'button', onclick },
      el('span.ex-title', { text: title }), el('span.ex-file.mono', { text: file })));
    const templates = tpl?.templates.length ? el('section.ex-group.ex-templates', {}, el('h3', { text: STRINGS.templates.heading }),
      el('p.note', { text: STRINGS.templates.note }),
      el('ul', {}, this.templateItems(tpl, (t) => item(t.title, t.file, () => { this.root.close(); this.onTemplate(t); }))
        .map((n) => (n.tagName === 'P' ? el('li.ex-sub', {}, n) : n)))) : null;
    // the topics in the order of the architecture's strings (examples.topics), then any other of the index
    const topics = [...new Set([...Object.keys(E.topics), ...this.index.examples.map((x) => x.topic)])];
    if (!templates && !this.index.examples.length) { this.list.replaceChildren(el('p.note', { text: E.none })); return; }
    this.list.replaceChildren(templates, ...topics.map((t) => {
      const items = this.index.examples.filter((x) => x.topic === t);
      if (!items.length) return null;
      return el('section.ex-group', {}, el('h3', { text: E.topics[t] ?? t }),
        el('ul', {}, items.map((x) => item(x.title, x.file, () => this.choose(x)))));
    }));
  }

  async choose(x) {
    const r = await fetch(new URL(x.file, this.indexUrl));
    if (!r.ok) { this.list.prepend(el('p.note', { text: STRINGS.examples.failed(`${x.file}: ${r.status}`) })); return; }
    this.root.close();
    this.onOpen(x, await r.text());
  }
}
