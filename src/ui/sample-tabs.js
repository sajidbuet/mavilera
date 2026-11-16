// sample-tabs.js -- the language tabs of the Sample projects list (the author, 2026-11-15): where a module's samples are in more
// than one language (C and assembly; later MicroPython), a tab per language family above the list; one language, no tabs. Used
// by the toolbar's Sample projects menu and the example library (examples-dialog.js). Keyboard: the tabs are one stop (roving
// tabindex); Left/Right, Home and End move between them and show their samples at once (WAI-ARIA tabs, automatic activation).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';

/** The tab orders: C first, then assembly, then MicroPython; any other family after them, in the order first met. */
export const LANG_TAB_ORDER = Object.freeze(['c', 'asm', 'micropython']);

/**
 * The family of a template's language: 'asm' (no language, or 'asm'), 'c' (any C compiler of the module, `cIds`), else the
 * language's own id (a later 'micropython').
 */
export function langTabOf(t, cIds = ['c']) {
  if (!t.lang || t.lang === 'asm') return 'asm';
  return cIds.includes(t.lang) ? 'c' : t.lang;
}

/** The tabs a list needs, in order: none (an empty array) when its samples are all of one family. */
export function langTabsOf(templates, cIds = ['c']) {
  const seen = [...new Set(templates.map((t) => langTabOf(t, cIds)))];
  if (seen.length < 2) return [];
  return [...LANG_TAB_ORDER.filter((k) => seen.includes(k)), ...seen.filter((k) => !LANG_TAB_ORDER.includes(k))];
}

let next = 0;
/**
 * A tab bar and its panel. `fill(tab)` gives the panel's children for a tab; `onSelect(tab)` is told of a student's choice (to
 * keep it). Returns {root, bar, panel, select(tab)}.
 * @param {{tabs: string[], labels: Record<string, string>, label: string, selected: string, fill: (tab: string) => Node[],
 *   onSelect?: (tab: string) => void, panelTag?: string}} o
 */
export function sampleTabs({ tabs, labels, label, selected, fill, onSelect = () => {}, panelTag = 'div' }) {
  const id = `smp${++next}`;
  const buttons = tabs.map((k) => el('button.smp-tab', { type: 'button', role: 'tab', id: `${id}-${k}`, 'data-tab': k, 'aria-controls': `${id}-panel-${k}`,
    text: labels[k] ?? k, onclick: (e) => { e.stopPropagation(); select(k, true); } }));
  const bar = el('div.smp-tabs', { role: 'tablist', 'aria-label': label, onkeydown: (e) => key(e) }, buttons);
  // a panel per tab, all filled at once, the others hidden (WAI-ARIA tabs): what a tab shows is in the page whichever is chosen
  const panels = Object.fromEntries(tabs.map((k) => [k, el(`${panelTag}.smp-panel`, { role: 'tabpanel', id: `${id}-panel-${k}`, 'aria-labelledby': `${id}-${k}`, hidden: true }, ...fill(k))]));
  let current = null;
  function select(k, byUser = false) {
    if (!tabs.includes(k)) k = tabs[0];
    current = k;
    for (const b of buttons) {
      const on = b.dataset.tab === k;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      panels[b.dataset.tab].hidden = !on;
    }
    if (byUser) onSelect(k);
  }
  function key(e) {
    const i = tabs.indexOf(current);
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    e.stopPropagation();
    select(tabs[j], true);
    buttons[j].focus();
  }
  select(selected);
  return { root: el('div.smp', {}, bar, ...Object.values(panels)), bar, panels, select };
}
