// boot.js -- the loading screen of index.html (#boot: the full MAVILERA logo, animated by theme.css) is taken away once the
// tool is ready, and not before MIN_MS have passed since the page began to load, so that the animation completes
// (docs/architecture/arch-switcher.md, AS-6). With reduced motion there is no animation and no minimum.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export const MIN_MS = 1200;
const FADE_MS = 250;

/** Wait until `ready` has settled and the minimum has passed, then fade the screen out and remove it. */
export async function endBoot(ready = Promise.resolve(), { now = () => performance.now(), min = MIN_MS } = {}) {
  const screen = document.getElementById('boot');
  if (!screen) return;
  await Promise.resolve(ready).catch(() => {});
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = still ? 0 : Math.max(0, min - now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  if (still) { screen.remove(); return; }
  screen.classList.add('boot-done');
  setTimeout(() => screen.remove(), FADE_MS + 50);
}
