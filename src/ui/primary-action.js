// primary-action.js -- the state-aware primary button of an edition with `primary` (contract v10 draft; pico2 Pico Lite,
// P1-L1, research D34 Q4-Q5, design docs/architecture/pico2-p1l1-lite.md §2): one button in place of Build and Run whose
// action follows the program's state. From a changed text it builds; only a second click runs, so that the listing and
// the errors are seen first (Q5 A). No DOM.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/** The actions of the button, with the icon and the shortcut each shows. */
export const PRIMARY = Object.freeze({
  build: Object.freeze({ icon: 'build', key: 'Control+Enter' }),
  run: Object.freeze({ icon: 'play', key: 'F5' }),
  pause: Object.freeze({ icon: 'pause', key: 'F5' }),
  again: Object.freeze({ icon: 'play', key: null }),
});

/**
 * The button's action for the program's state.
 * @param {{running: boolean, changed: boolean, runnable: boolean, ended: boolean}} s
 *   running: a run is going on; changed: the text changed since the last build (or was never built); runnable: the last
 *   build gave a program that runs; ended: the program stopped for good (halt or error) and needs a reset to run again
 * @returns {'build' | 'run' | 'pause' | 'again'}
 */
export function primaryAction({ running, changed, runnable, ended }) {
  if (running) return 'pause';
  if (changed || !runnable) return 'build';
  return ended ? 'again' : 'run';
}
