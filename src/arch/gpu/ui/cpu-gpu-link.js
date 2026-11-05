// gpu/ui/cpu-gpu-link.js -- the GPU Laboratory's way into the CPU + GPU system (GPU-7, decision G30; author, 2026-11-05:
// no switcher entry of its own): a view that says what the system is, shows the GPU's register map (MAVILERA's design,
// labelled so, decision G3), opens the RISC-V Laboratory's page with the GPU on the bus, and gives the kernel in the
// editor as words for a host program (author, 2026-11-05: "Export kernel for a host"; rvsimt/host-words.js).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el, download } from '../../../ui/dom.js';
import { HOSTED_TOOLS, toolUrl } from '../../../shell/platform-archs.js';
import { RVSIMT_STRINGS } from '../rvsimt/strings.js';
import { hostText } from '../rvsimt/host-words.js';

const X = () => RVSIMT_STRINGS.cpuGpu;

/** The address of the CPU + GPU tool from this page (a release page: its sibling; the development page: ?arch=). */
export function cpuGpuUrl(loc = globalThis.location, doc = globalThis.document) {
  const release = !!doc?.querySelector?.('meta[name="risc-vista-edition"][content="release"]');
  return toolUrl(HOSTED_TOOLS.find((t) => t.id === 'cpu-gpu'), { protocol: loc.protocol, href: loc.href, release });
}

/** What the kernel box shows for a program: {text} for a kernel of the hosted machine, else {note}. */
export function kernelForHost(program) {
  const T = X();
  if (!program) return { note: T.kernelNone };
  if (!(program.assembled ?? program.ok) || program.diagnostics?.some((d) => d.severity === 'error')) return { note: T.kernelErrors };
  if (program.profile !== 'lab') return { note: T.kernelProfile };
  return { text: hostText(program) };
}

export class CpuGpuLink {
  constructor() {
    const T = X();
    const url = cpuGpuUrl();
    this.kernelBox = el('div.gpu-kernel', { 'aria-live': 'polite' });
    this.text = null;
    this.root = el('div.col.an-view.gm-view', {}, el('div.scroll.an-body', {},
      el('h3', { text: T.heading }),
      ...T.paragraphs.map((p) => el('p.gm-intro', { text: p })),
      el('p', {}, el('a.btn.primary', { href: url, text: T.open })),
      el('table.listing.mem-table', {}, el('caption', { text: T.mapCaption }),
        el('thead', {}, el('tr', {}, T.mapCols.map((c) => el('th', { scope: 'col', text: c })))),
        el('tbody', {}, T.map.map(([o, n, m]) => el('tr', {}, el('td.mono', { text: o }), el('th', { scope: 'row', text: n }), el('td', { text: m }))))),
      el('p.note', { text: T.mapNote }),
      el('h3', { text: T.kernelHeading }), el('p.gm-intro', { text: T.kernelIntro }), this.kernelBox));
    this.load(null);
  }

  /** The session's assembled program (null: none): the kernel box follows it. */
  load(program) {
    const T = X();
    const k = kernelForHost(program);
    this.text = k.text ?? null;
    if (!k.text) { this.kernelBox.replaceChildren(el('p.note', { text: k.note })); return; }
    const area = el('textarea.mono.gpu-kernel-text', { readOnly: true, rows: Math.min(24, k.text.split('\n').length), 'aria-label': T.kernelHeading, spellcheck: 'false' });
    area.value = k.text;
    const status = el('span.note', { role: 'status' });
    this.kernelBox.replaceChildren(area, el('div.npu-tools', {},
      el('button.btn', { type: 'button', text: T.copy, onclick: async () => {
        try { await navigator.clipboard.writeText(k.text); status.textContent = T.copied; } catch { area.select(); status.textContent = T.copyByHand; }
      } }),
      el('button.btn', { type: 'button', text: T.download, onclick: () => download('kernel-for-host.s', k.text, 'text/plain') }), status));
  }
}

/** The view instance for the shell (kind compare: nothing to step; it reads the assembled program for the kernel box). */
export function cpuGpuInstance(v, STOP) {
  const none = () => STOP.NONE;
  return { root: v.root, title: X().title, infoTitle: '', tabs: [], load: (p) => v.load(p ?? null), step: none, back: () => false, state: () => null, render: () => {} };
}
