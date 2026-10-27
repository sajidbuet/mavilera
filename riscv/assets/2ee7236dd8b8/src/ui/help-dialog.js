// help-dialog.js -- the in-app help (spec W-D20): the sections of
// content/help/help.json, one at a time, chosen from a list; a link to the
// detailed documentation and the About dialog. The text is fetched the first
// time the dialog opens (WS-N-011).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { STRINGS } from './strings.js';

/** One block of a help section: {p}, {ul}, {ol} or {dl: [[term, text], …]}. */
function block(b) {
  if (b.p) return el('p', { text: b.p });
  if (b.ul) return el('ul', {}, b.ul.map((t) => el('li', { text: t })));
  if (b.ol) return el('ol', {}, b.ol.map((t) => el('li', { text: t })));
  if (b.dl) return el('dl.help-dl', {}, b.dl.flatMap(([t, d]) => [el('dt', { text: t }), el('dd', { text: d })]));
  return null;
}

export class HelpDialog {
  /** @param {{base: URL, docsUrl: string, onAbout: () => void}} hooks */
  constructor({ base, docsUrl, onAbout }) {
    this.base = base;
    this.help = null;
    const H = STRINGS.help;
    this.nav = el('nav.help-nav', { 'aria-label': H.sections });
    this.body = el('div.help-body.scroll', { tabindex: '0', 'aria-live': 'polite' }, el('p.note', { text: H.loading }));
    this.root = el('dialog.help-dialog', { 'aria-labelledby': 'help-title' },
      el('h2', { id: 'help-title', text: H.title }),
      el('div.help-main', {}, this.nav, this.body),
      el('div.help-foot', {},
        el('a.help-docs', { href: docsUrl, target: '_blank', rel: 'noopener', text: H.docs, title: H.docsTitle }),
        el('button', { type: 'button', text: STRINGS.aboutTitle, onclick: () => { this.root.close(); onAbout(); } }),
        el('form', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose }))));
  }

  async open() {
    this.root.showModal();
    if (this.help) return;
    try {
      const r = await fetch(new URL('content/help/help.json', this.base));
      if (!r.ok) throw new Error(`help.json: ${r.status}`);
      this.help = await r.json();
    } catch (e) {
      this.body.replaceChildren(el('p.note', { text: STRINGS.help.failed(e.message) }));
      return;
    }
    this.buttons = this.help.sections.map((s, i) => el('button', { type: 'button', text: s.title,
      'aria-current': i === 0 ? 'true' : null, onclick: () => this.show(i) }));
    this.nav.replaceChildren(...this.buttons);
    this.show(0);
    this.buttons[0].focus();
  }

  show(i) {
    const s = this.help.sections[i];
    this.buttons.forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    this.body.replaceChildren(el('h3', { text: s.title }), ...s.blocks.map(block));
    this.body.scrollTop = 0;
  }
}
