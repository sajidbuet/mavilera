// info-button.js -- an "i" button for an explanation that need not stay on the page: hovering shows the text as a
// tooltip; a press opens it in a small pop-up beside the button (the HTML popover: Escape or a click elsewhere closes
// it, the focus returns to the button). Used by the NPU tool (NPU-3).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from './dom.js';

let seq = 0;
const GAP = 6; // px between the button and the pop-up
const EDGE = 8; // px kept free at the window's edges

/** Place the pop-up below the button (above it when there is no room), inside the window; its right edge under the button's. */
function place(button, pop) {
  const b = button.getBoundingClientRect();
  const w = Math.min(pop.offsetWidth || 384, innerWidth - 2 * EDGE); // before it is shown: its widest (24rem)
  const h = pop.offsetHeight || 0;
  const left = Math.max(EDGE, Math.min(b.right - w, innerWidth - EDGE - w));
  const below = b.bottom + GAP;
  const top = below + h > innerHeight - EDGE && b.top - GAP - h > EDGE ? b.top - GAP - h : below;
  Object.assign(pop.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
}

/**
 * An information button. `paragraphs`: the text, one string per paragraph; `label`: the button's name ("About ...").
 * Returns the element to place (the button and its pop-up).
 */
export function infoButton(paragraphs, label) {
  const id = `info-pop-${++seq}`;
  const text = paragraphs.join('\n\n');
  const pop = el('div.info-pop', { id, popover: 'auto', role: 'note', 'aria-label': label }, paragraphs.map((p) => el('p', { text: p })));
  const button = el('button.info-btn', { type: 'button', title: text, 'aria-label': label, 'aria-expanded': 'false', 'aria-controls': id, popovertarget: id }, 'i');
  if (!('popover' in pop)) { // a browser without popovers: the press toggles the text in place
    pop.removeAttribute('popover');
    pop.hidden = true;
    button.addEventListener('click', () => { pop.hidden = !pop.hidden; button.setAttribute('aria-expanded', String(!pop.hidden)); });
  } else {
    // placed before it shows (no frame at the window's corner), then again with its real size
    pop.addEventListener('beforetoggle', (e) => {
      const open = e.newState === 'open';
      button.setAttribute('aria-expanded', String(open));
      if (open) place(button, pop);
    });
    pop.addEventListener('toggle', (e) => { if (e.newState === 'open') place(button, pop); });
  }
  return el('span.info-wrap', {}, button, pop);
}
