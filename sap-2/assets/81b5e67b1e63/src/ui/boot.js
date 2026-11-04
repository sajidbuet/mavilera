// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const MIN_MS = 1200;
const FADE_MS = 250;
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
