// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
import { STRINGS } from './strings.js';
import { icon } from './icons.js';
function block(b, logo) {
 if (b.p) return el('p', { text: b.p });
 if (b.ul) return el('ul', {}, b.ul.map((t) => el('li', { text: t })));
 if (b.ol) return el('ol', {}, b.ol.map((t) => el('li', { text: t })));
 if (b.dl) return el('dl.help-dl', {}, b.dl.flatMap(([t, d]) => [el('dt', { text: t }), el('dd', { text: d })]));
 if (b.brand) return el('div.help-brand', {}, logo(), el('p.help-brand-name', { text: STRINGS.appFull }));
 if (b.refs) return el('ul.help-refs', {}, b.refs.map(([t, href, d]) => el('li', {},
 href ? el('a', { href, target: '_blank', rel: 'noopener', text: t }) : el('cite', { text: t }), d ? el('span', { text: ` ${d}` }) : null)));
 if (b.notice) return el('p.help-notice', { text: b.notice });
 return null;
}
export class HelpDialog {
 constructor({ index, docsUrl, onAbout, logo }) {
 this.index = index;
 this.logo = el('div.help-logo');
 logo?.().then((svg) => this.logo.append(svg), () => this.logo.append(el('strong', { text: STRINGS.appName })));
 this.help = null;
 const H = STRINGS.help;
 this.nav = el('nav.help-nav', { 'aria-label': H.sections });
 this.body = el('div.help-body.scroll', { tabindex: '0', 'aria-live': 'polite' }, el('p.note', { text: H.loading }));
 this.root = el('dialog.help-dialog', { 'aria-labelledby': 'help-title' },
 el('div.help-head', {}, el('h2', { id: 'help-title', text: H.title }),
 el('button.help-x', { type: 'button', 'aria-label': H.close, title: H.close, onclick: () => this.root.close() }, icon('close', { size: 18 }))),
 el('div.help-main', {}, this.nav, this.body),
 el('div.help-foot', {},
 docsUrl ? el('a.help-docs', { href: docsUrl, target: '_blank', rel: 'noopener', text: H.docs, title: H.docsTitle }) : null,
 el('button', { type: 'button', text: STRINGS.aboutTitle, onclick: () => { this.root.close(); onAbout(); } }),
 el('form', { method: 'dialog' }, el('button', { type: 'submit', text: STRINGS.aboutClose }))));
 }
 async open() {
 this.root.showModal();
 if (this.help) return;
 if (!this.index) { this.body.replaceChildren(el('p.note', { text: STRINGS.help.none })); return; }
 try {
 const r = await fetch(this.index);
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
 const nodes = s.blocks.map((b) => block(b, () => this.logo));
 this.body.replaceChildren(...(s.blocks[0]?.brand ? [nodes.shift()] : []), el('h3', { text: s.title }), ...nodes);
 this.body.scrollTop = 0;
 }
}
