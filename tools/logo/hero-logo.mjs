// hero-logo.mjs -- the animated MAVILERA lockup chosen by the author (2026-11-05: variant A, "instruction run", of
// docs/branding/logo-animation.md), as inline SVG and CSS: the landing page's hero (tools/release.mjs) and the
// loading screen of every tool page (tools/make-boot-screen.mjs into index.html and src/ui/theme.css) use the same
// two. CSS keyframes only, so that it plays from the first paint, before any script: the instruction cards slide in
// and their bars fill, the wires wipe into the M, the arches rise, the road runs up, the right-hand wires and the
// stages come in, a pulse runs through the pipeline, MAVILERA wipes in letter by letter and the triangles snap in.
// It plays while an ancestor has the class `mvh-play`; `mvh-beat` runs one pulse through the pipeline; `mvh-loop`
// repeats the pulse (the loading screen, until the tool is ready). --mvh-t scales every time (1: about 2.5 s). At
// rest, and always under prefers-reduced-motion, the logo is the lockup file as drawn (tools/logo/compare-parts.mjs).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { partsSvg } from './lockup-parts.mjs';

/** The lockup as inline SVG of parts; `label` names it for assistive technology, else it is hidden from it. */
export function heroSvg(lockupText, { rootClass = 'mvh', label = null } = {}) {
  const svg = partsSvg(lockupText, { rootClass });
  return label ? svg.replace(/aria-label="[^"]*"/, `aria-label="${label}"`)
    : svg.replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true" focusable="false"');
}

const EASE = 'cubic-bezier(.2,.7,.2,1)';
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const STAGES = ['if', 'id', 'ex', 'mem', 'wb'];
const t = (ms) => `calc(${ms}ms * var(--mvh-t, 1))`;
const run = (name, dur, delay, ease = EASE) => `${name} ${t(dur)} ${ease} ${t(delay)} both`;

/** The CSS of the animation (and of the logo's colours), scoped to `.mvh` and to the classes above. */
export function heroCss() {
  const P = '.mvh-play';
  const rules = [
    '.mvh .mv-n { fill: var(--mv-navy, #0b2a55); } .mvh .mv-l { fill: var(--mv-blue, #5b9bd5); } .mvh .mv-p { fill: var(--mv-pale, #c8e1f4); }',
    '.mvh { overflow: visible; } .mvh path { transform-box: fill-box; transform-origin: 50% 50%; }',
    '.mvh .p-m-left, .mvh .p-m-right { transform-origin: 50% 100%; }',
    '.mvh .p-wires-left, .mvh .p-wires-right, .mvh .p-arrow-in, .mvh .mv-l[class*="p-card-"], .mvh .mv-p[class*="p-card-"] { transform-origin: 0 50%; }',
    '@keyframes mvh-slide { from { transform: translateX(-46px); opacity: 0; } }',
    '@keyframes mvh-grow { from { transform: scaleX(0); } }',
    '@keyframes mvh-wipe { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }',
    '@keyframes mvh-wipe-up { from { clip-path: inset(100% 0 0 0); } to { clip-path: inset(0 0 0 0); } }',
    '@keyframes mvh-rise { from { transform: translateY(50px) scaleY(.35); opacity: 0; } }',
    '@keyframes mvh-drop { from { transform: translateY(-14px); opacity: 0; } }',
    '@keyframes mvh-letter { from { clip-path: inset(0 100% 0 0); opacity: .2; } to { clip-path: inset(0 0 0 0); opacity: 1; } }',
    '@keyframes mvh-pop { 0% { transform: scale(0); opacity: 0; } 70% { transform: scale(1.18); opacity: 1; } 100% { transform: none; opacity: 1; } }',
    '@keyframes mvh-flash { 0%, 100% { filter: none; } 35% { filter: brightness(1.9) saturate(1.3); } }',
    '@keyframes mvh-blink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }',
    '@keyframes mvh-up { from { opacity: 0; transform: translateY(6px); } }',
    // the pulse repeated every 2 s (the loading screen): the flash in the first fifth of the period
    '@keyframes mvh-flash-loop { 0%, 22%, 100% { filter: none; } 8% { filter: brightness(1.9) saturate(1.3); } }',
  ];
  for (let i = 0; i < 5; i++) {
    rules.push(`${P} .p-card-${i} { animation: ${run('mvh-slide', 380, 60 * i)}; }`);
    // the bar of a card: it slides with its card (opacity) and fills from the left (the transform is the fill's)
    rules.push(`${P} .p-card-${i}.mv-l, ${P} .p-card-${i}.mv-p { animation: ${run('mvh-slide', 380, 60 * i)}, ${run('mvh-grow', 320, 60 * i + 220)}; }`);
  }
  rules.push(`${P} .p-wires-left { animation: ${run('mvh-wipe', 420, 420)}; }`);
  rules.push(`${P} .p-m-left { animation: ${run('mvh-rise', 620, 760, SPRING)}; }`);
  rules.push(`${P} .p-m-right { animation: ${run('mvh-rise', 620, 860, SPRING)}; }`);
  rules.push(`${P} .p-m-road { animation: ${run('mvh-wipe-up', 520, 1080)}; }`);
  rules.push(`${P} .p-arrow-in, ${P} .p-wires-right { animation: ${run('mvh-wipe', 480, 1220)}; }`);
  STAGES.forEach((s, i) => {
    rules.push(`${P} .p-stage-${s} { animation: ${run('mvh-drop', 300, 1300 + 70 * i)}, ${run('mvh-flash', 420, 1760 + 110 * i, 'ease-in-out')}; }`);
    rules.push(`.mvh-beat .p-stage-${s} { animation: mvh-flash 420ms ease-in-out ${110 * i}ms both; }`);
    rules.push(`${P}.mvh-loop .p-stage-${s} { animation: ${run('mvh-drop', 300, 1300 + 70 * i)}, mvh-flash-loop 2s ease-in-out calc(${t(1760)} + ${110 * i}ms) infinite; }`);
  });
  rules.push(`${P} .p-stage-arrows { animation: ${run('mvh-wipe', 400, 1420)}, ${run('mvh-blink', 600, 1840)}; }`);
  rules.push('.mvh-beat .p-stage-arrows { animation: mvh-blink 600ms ease 80ms both; }');
  for (let k = 0; k < 8; k++) rules.push(`${P} .p-letter-${k} { animation: ${run('mvh-letter', 340, 1580 + 55 * k)}; }`);
  rules.push(`${P} .p-tri-1 { animation: ${run('mvh-pop', 360, 2060)}; } ${P} .p-tri-2 { animation: ${run('mvh-pop', 360, 2150)}; }`);
  rules.push(`${P} .hero-expansion { animation: ${run('mvh-up', 520, 1900)}; }`);
  rules.push('@media (prefers-reduced-motion: reduce) { .mvh *, .mvh-play .hero-expansion { animation: none !important; } }');
  return rules.join('\n');
}

/** The length of the intro at --mvh-t = 1, in ms (the last animation's end). */
export const HERO_MS = 2510;
