// view-mode.js -- the presentation of the workspace: Normal, Datapath focus or Full screen. One state for the page:
// the base mode, 'normal' or 'focus', which the page keeps, and the browser's full screen, which is not kept here but
// read from the Fullscreen API (document.fullscreenElement), so that the page never claims a full screen the browser
// has left (Esc, the browser's own controls) or refused. Full screen is the compact layout of the focus over the whole
// display; leaving it returns to the base mode it was entered from. Focus and Full screen are presentations only:
// what they hide (main.js, theme.css .workspace.focus) stays in the page with its state, the splits' saved layouts
// are not touched, and nothing of the mode is stored (a page always opens in Normal view).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const MODES = Object.freeze(['normal', 'focus', 'fullscreen']);

/** The mode shown: full screen over either base mode. */
export const presentation = ({ base, fullscreen }) => (fullscreen ? 'fullscreen' : base);

/** The compact layout (header, column of controls, auxiliary panes away): in Focus and in Full screen. */
export const isCompact = ({ base, fullscreen }) => base === 'focus' || Boolean(fullscreen);

/**
 * What choosing `mode` does from the state {base, fullscreen}: the base mode after it, and whether the browser's
 * full screen is to be entered or left ('enter', 'exit' or null). Full screen keeps the base mode, so that leaving
 * it returns there; Normal or Focus chosen in full screen leave it.
 */
export function plan(mode, { base, fullscreen }) {
  if (mode === 'fullscreen') return { base, fs: fullscreen ? null : 'enter' };
  return { base: mode === 'focus' ? 'focus' : 'normal', fs: fullscreen ? 'exit' : null };
}

/** The mode the Exit button (and Esc in focus) returns to: out of full screen to the base mode, out of focus to Normal. */
export const exitTarget = ({ base, fullscreen }) => (fullscreen ? base : 'normal');

export class ViewModes {
  /**
   * @param {object} o
   * @param {Element} [o.root]  the element made full screen (the page)
   * @param {Document} [o.doc]
   * @param {(state: {base: string, fullscreen: boolean, mode: string, compact: boolean}) => void} o.onChange
   *   after every change of the mode shown (also one the browser made)
   * @param {(error: Error) => void} [o.onError]  the browser refused full screen (the mode stays as it was)
   */
  constructor({ root = document.documentElement, doc = document, onChange, onError = null }) {
    Object.assign(this, { root, doc, onChange, onError });
    this.base = 'normal';
    this.queue = Promise.resolve(); // one change at a time: a request made while full screen is entered or left waits
    this.shown = null;
    doc.addEventListener('fullscreenchange', () => this.notify());
    doc.addEventListener('fullscreenerror', () => this.notify());
  }

  /** The browser shows the page full screen now (the only source of that state). */
  get fullscreen() { return Boolean(this.doc.fullscreenElement); }

  /** The browser can make the page full screen (an iPhone's Safari cannot; a frame may not be allowed to). */
  get supported() { return Boolean(this.doc.fullscreenEnabled && this.root.requestFullscreen); }

  get state() {
    const s = { base: this.base, fullscreen: this.fullscreen };
    return { ...s, mode: presentation(s), compact: isCompact(s) };
  }

  /** Tell the page, if what it shows has changed. */
  notify(force = false) {
    const s = this.state;
    const key = `${s.base}/${s.fullscreen}`;
    if (!force && key === this.shown) return;
    this.shown = key;
    this.onChange(s);
  }

  /**
   * Show `mode` ('normal', 'focus' or 'fullscreen'). Call from the user's action: the browser grants full screen only
   * to a click or key press. Resolves when done; a refusal is reported to onError and changes nothing.
   */
  set(mode) {
    const run = async () => {
      const p = plan(mode, { base: this.base, fullscreen: this.fullscreen });
      if (p.fs === 'enter' && !this.supported) { this.onError?.(new Error('unsupported')); this.notify(true); return; }
      this.base = p.base;
      let refused = false;
      if (p.fs === 'exit') {
        try { await this.doc.exitFullscreen(); } catch { /* already left */ }
      } else if (p.fs === 'enter') {
        try { await this.root.requestFullscreen(); } catch (e) { refused = true; this.onError?.(e); }
      }
      this.notify(refused); // a refusal redraws the mode as it is (a menu that showed Full screen chosen shows it again)
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /** Leave the mode shown: full screen to its base mode, focus to Normal. */
  exit() { return this.set(exitTarget({ base: this.base, fullscreen: this.fullscreen })); }

  /** F: into focus, or out of it (out of full screen too). */
  toggleFocus() { return this.set(this.state.compact ? 'normal' : 'focus'); }
}
