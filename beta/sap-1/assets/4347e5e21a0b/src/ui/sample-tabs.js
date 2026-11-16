// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { el } from './dom.js';
export const LANG_TAB_ORDER = Object.freeze(['c', 'asm', 'micropython']);
export function langTabOf(t, cIds = ['c']) {
 if (!t.lang || t.lang === 'asm') return 'asm';
 return cIds.includes(t.lang) ? 'c' : t.lang;
}
export function langTabsOf(templates, cIds = ['c']) {
 const seen = [...new Set(templates.map((t) => langTabOf(t, cIds)))];
 if (seen.length < 2) return [];
 return [...LANG_TAB_ORDER.filter((k) => seen.includes(k)), ...seen.filter((k) => !LANG_TAB_ORDER.includes(k))];
}
let next = 0;
export function sampleTabs({ tabs, labels, label, selected, fill, onSelect = () => {}, panelTag = 'div' }) {
 const id = `smp${++next}`;
 const buttons = tabs.map((k) => el('button.smp-tab', { type: 'button', role: 'tab', id: `${id}-${k}`, 'data-tab': k, 'aria-controls': `${id}-panel-${k}`,
 text: labels[k] ?? k, onclick: (e) => { e.stopPropagation(); select(k, true); } }));
 const bar = el('div.smp-tabs', { role: 'tablist', 'aria-label': label, onkeydown: (e) => key(e) }, buttons);
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
