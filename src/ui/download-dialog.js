// download-dialog.js -- the notice and progress of an image language's optional download (contract v10 draft; pico2 P1-F2:
// the Pico SDK compiler and files, ADR-0012 point 2, research D33). First a notice that states the size and asks; then one
// progress bar for each file with bytes, percentage and rate (the author's requirement, 2026-11-08); then "preparing".
// A modal <dialog>: focus moves into it and returns, Escape closes it (as Not now). Strings: STRINGS.download.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';
import { STRINGS } from './strings.js';

const S = () => STRINGS.download;
const MB = (n) => `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} MB`;

export class DownloadDialog {
  constructor() {
    this.heading = el('h2', { id: 'dl-title' });
    this.body = el('div');
    this.btns = el('div.dl-btns');
    this.root = el('dialog.dl-dialog', { 'aria-labelledby': 'dl-title' }, this.heading, this.body, this.btns);
    this.root.addEventListener('cancel', (e) => { if (this.busy) e.preventDefault(); }); // no Escape while downloading
    document.body.append(this.root);
    this.busy = false;
  }

  /** The notice: resolves true (Download) or false (Not now, Escape). `info`: {transfer, cacheAvailable}. */
  ask(label, info) {
    this.busy = false;
    this.heading.textContent = S().title(label);
    this.body.replaceChildren(el('p', { text: S().notice(label, MB(info.transfer)) }),
      ...(info.cacheAvailable ? [] : [el('p.dl-note', { text: S().noCache })]),
      ...(info.licences ? [el('p.dl-note', {}, S().licencesBefore, el('a', { href: info.licences, target: '_blank', rel: 'noopener', text: S().licences }), S().licencesAfter)] : []));
    return new Promise((resolve) => {
      const go = el('button.primary', { type: 'button', text: S().start });
      const no = el('button', { type: 'button', text: S().cancel });
      const done = (v) => { this.root.removeEventListener('close', onClose); this.root.close(); resolve(v); };
      const onClose = () => resolve(false);
      go.onclick = () => { this.root.removeEventListener('close', onClose); resolve(true); };
      no.onclick = () => done(false);
      this.root.addEventListener('close', onClose, { once: true });
      this.btns.replaceChildren(no, go);
      if (!this.root.open) this.root.showModal();
      go.focus();
    });
  }

  /** The progress view for `files` ([{id, label, bytes}]); returns update({file, loaded, total, done, fromCache}). */
  progress(label, files) {
    this.busy = true;
    this.heading.textContent = S().progressTitle(label);
    this.status = el('p.dl-status', { role: 'status' });
    const rows = new Map(files.map((f) => {
      const bar = el('progress', { max: f.bytes || 1, value: 0, 'aria-label': f.label });
      const stat = el('span.dl-file-stat', { text: S().fileProgress(MB(0), MB(f.bytes), 0, null) });
      const li = el('li.dl-file', {}, el('div.dl-file-name', {}, el('span', { text: f.label }), stat), bar);
      return [f.id, { li, bar, stat, t0: performance.now(), f }];
    }));
    this.body.replaceChildren(el('ul.dl-files', {}, ...[...rows.values()].map((r) => r.li)), this.status);
    this.btns.replaceChildren();
    if (!this.root.open) this.root.showModal();
    return (e) => {
      const r = rows.get(e.file);
      if (!r) return;
      const total = e.total || r.f.bytes || 1;
      r.bar.max = total;
      r.bar.value = e.loaded;
      if (e.fromCache) { r.stat.textContent = S().fromCache; return; }
      const s = (performance.now() - r.t0) / 1000;
      const rate = s > 0.3 && e.loaded ? MB(e.loaded / s) : null;
      r.stat.textContent = S().fileProgress(MB(e.loaded), MB(total), Math.floor((100 * e.loaded) / total), rate);
    };
  }

  preparing() { if (this.status) this.status.textContent = S().preparing; }

  /** An error with Try again and Close; resolves true for Try again. */
  failed(message) {
    this.busy = false;
    const p = el('p.dl-error', { role: 'alert', text: S().failed(message) });
    this.body.append(p);
    return new Promise((resolve) => {
      const again = el('button.primary', { type: 'button', text: S().retry, onclick: () => resolve(true) });
      const close = el('button', { type: 'button', text: S().close, onclick: () => { this.root.close(); resolve(false); } });
      this.btns.replaceChildren(close, again);
      again.focus();
    });
  }

  close() { this.busy = false; if (this.root.open) this.root.close(); }
}
