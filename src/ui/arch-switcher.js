// arch-switcher.js -- the header logo as two controls over one image: MAVILERA (home) and the architecture part (a
// drop-down of the other tools, each by its name lockup); choosing one slides the stack up to its place, then navigates
// (docs/architecture/arch-switcher.md, AS-1 to AS-5). Styles: theme.css (.brand-switch).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';

const SLIDE_MS = 380;

/**
 * Wrap the header lockup.
 * @param {object} o
 * @param {SVGElement} o.logo the lockup of the current architecture (already in the page's style)
 * @param {{id: string, name: string, logo: string, url: string}[]} o.targets the other architectures
 * @param {string|null} o.home the landing page's address, or null where there is none
 * @param {string} o.current the name of the current architecture
 * @param {(file: string) => Promise<SVGElement>} o.loadLogo the lockup file as an inline SVG
 * @param {{home: string, label: (name: string) => string, list: string, open: (name: string) => string}} o.strings
 * @param {(url: string) => void} [o.go] navigation (the page's `location.assign`; replaced in tests)
 * @param {number} [o.nameAt] where the name lockup stands in the header lockup, in lockup heights (platform-archs.js NAME_AT)
 * @returns {HTMLElement} the element that replaces the lockup in the header
 */
export function archSwitcher({ logo, targets, home, current, loadLogo, strings, go = (u) => location.assign(u), nameAt = 0 }) {
  const root = el('div.brand-switch', {}, logo);
  logo.classList.add('brand-logo-img');
  if (home) root.append(el('a.brand-home', { href: home, title: strings.home, 'aria-label': strings.home }));
  if (!targets.length) return root;

  let list = null, opened = false, busy = false, anim = [];
  const button = el('button.brand-arch', { type: 'button', title: strings.label(current), 'aria-label': strings.label(current),
    'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'arch-switch-list', onclick: () => toggle(), onkeydown: onButtonKey },
  el('span.brand-caret', { 'aria-hidden': 'true' }));
  root.append(button);

  const items = () => (list ? [...list.querySelectorAll('.switch-item')] : []);
  async function build() {
    if (list) return;
    const links = await Promise.all(targets.map(async (t) => {
      const svg = await loadLogo(t.logo).catch(() => null);
      return el('li', {}, el('a.switch-item', { href: t.url, 'aria-label': strings.open(t.name), onclick: (e) => choose(e, t), onkeydown: onItemKey },
        svg ?? el('span', { text: t.name })));
    }));
    list = el('ul.switch-list', { id: 'arch-switch-list', 'aria-label': strings.list, hidden: true }, links);
    for (const svg of list.querySelectorAll('svg')) svg.classList.add('brand-logo-img');
    root.append(list);
  }

  async function open(focusFirst = false) {
    if (opened || busy) return;
    await build();
    opened = true;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    root.classList.add('is-open');
    if (focusFirst) items()[0]?.focus();
  }
  function close(refocus = false) {
    if (!opened) return;
    opened = false;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    root.classList.remove('is-open');
    if (refocus) button.focus();
  }
  const toggle = () => (opened ? close() : open());

  function onButtonKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(true); }
  }
  function onItemKey(e) {
    const all = items(), at = all.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(at + 1) % all.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(at + all.length - 1) % all.length].focus(); }
  }
  // on the document: a button clicked with the mouse does not always take the focus (Safari)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && opened && !busy) { e.stopPropagation(); close(true); } });
  root.addEventListener('focusout', (e) => { if (opened && !busy && e.relatedTarget && !root.contains(e.relatedTarget)) close(); });
  document.addEventListener('pointerdown', (e) => { if (opened && !busy && !root.contains(e.target)) close(); });

  // A plain click slides the stack up until the chosen lockup stands where the current one is, then navigates; a
  // modified click, reduced motion or a browser without the Web Animations API navigates at once.
  function choose(e, target) {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (busy) return;
    const still = !root.animate || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { go(target.url); return; }
    busy = true;
    root.classList.add('is-switching');
    const chosen = e.currentTarget;
    // an entry is a name lockup (chip and name): it slides to the header's chip and name, not to its left edge
    const from = logo.getBoundingClientRect(), to = chosen.querySelector('svg, span').getBoundingClientRect();
    const dx = to.left - (from.left + nameAt * from.height), dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const slide = (node, extra = []) => node.animate(
      extra.length ? extra : [{ transform: 'translate(0, 0)' }, { transform: `translate(${-dx}px, ${-dy}px)` }],
      { duration: SLIDE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    const move = (opacity) => [{ transform: 'translate(0, 0)', opacity: 1 }, { transform: `translate(${-dx}px, ${-dy}px)`, opacity }];
    anim = [slide(logo, move(0)), slide(list, move(1))];
    for (const other of items()) if (other !== chosen) anim.push(other.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SLIDE_MS * 0.8, fill: 'forwards' }));
    Promise.all(anim.map((a) => a.finished)).then(() => setTimeout(() => go(target.url), 60), () => go(target.url));
  }

  // back/forward cache: the page returns as it was left, mid-slide
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    for (const a of anim) a.cancel();
    anim = [];
    busy = false;
    root.classList.remove('is-switching');
    close();
  });
  return root;
}
