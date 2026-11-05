// hero-variants.js -- the four candidate animations of the landing page's hero logo (docs/branding/logo-animation.md),
// for the author's choice: A "instruction run", B "blueprint", C "assemble", D "signal wave". Each plays on an
// inline SVG of the lockup's parts (tools/logo/lockup-parts.mjs: classes p-card-0..4, p-wires-left, p-m-left,
// p-m-right, p-m-road, p-arrow-in, p-wires-right, p-stage-if..wb, p-stage-arrows, p-letter-0..7, p-tri-1, p-tri-2,
// and the colour classes mv-n, mv-l, mv-p) and on the full-form line after it. Web Animations only: transform,
// opacity, clip-path, fill and filter; nothing moves under prefers-reduced-motion; every variant ends on the static
// logo. After the intro: a pulse through the pipeline every 8 s while the logo is on screen, and one on hover.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const EASE = 'cubic-bezier(.2,.7,.2,1)';
const SPRING = 'cubic-bezier(.34,1.56,.64,1)';
const STAGES = ['if', 'id', 'ex', 'mem', 'wb'];

const all = (root, sel) => [...root.querySelectorAll(sel)];
const play = (els, frames, opts) => [].concat(els).filter(Boolean).map((el) => el.animate(frames, { fill: 'both', easing: EASE, ...opts }));
const wipe = (dir) => ({ right: 'inset(0 100% 0 0)', up: 'inset(100% 0 0 0)', down: 'inset(0 0 100% 0)' }[dir]);
const parts = (root) => {
  const by = (p) => all(root, `.p-${p}`);
  return {
    cards: [0, 1, 2, 3, 4].map((i) => by(`card-${i}`)),
    bars: [0, 1, 2, 3, 4].map((i) => all(root, `.p-card-${i}.mv-l, .p-card-${i}.mv-p`)),
    wiresL: by('wires-left'), wiresR: by('wires-right'), arrowIn: by('arrow-in'),
    mL: by('m-left'), mR: by('m-right'), road: by('m-road'),
    stages: STAGES.map((s) => by(`stage-${s}`)), arrows: by('stage-arrows'),
    letters: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => by(`letter-${k}`)), tris: [by('tri-1'), by('tri-2')],
  };
};
const expansion = (root) => root.closest('.hero-logo-box')?.querySelector('.hero-expansion');

/** The pulse through the pipeline: each stage brightens in turn, the arrows after it light with it. */
export function pulse(svg, at = 0) {
  const P = parts(svg);
  const out = [];
  P.stages.forEach((els, i) => {
    out.push(...play(els, [{ filter: 'brightness(1)' }, { filter: 'brightness(1.9) saturate(1.3)', offset: 0.35 }, { filter: 'brightness(1)' }],
      { duration: 420, delay: at + 110 * i, fill: 'none', easing: 'ease-in-out' }));
  });
  out.push(...play(P.arrows, [{ opacity: 1 }, { opacity: 0.35, offset: 0.5 }, { opacity: 1 }], { duration: 600, delay: at + 80, fill: 'none' }));
  return out;
}

// --- A: an instruction runs through the logo ---------------------------------------------------------------------
function runA(svg) {
  const P = parts(svg);
  const a = [];
  P.cards.forEach((els, i) => a.push(...play(els, [{ transform: 'translateX(-46px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: 60 * i })));
  P.bars.forEach((els, i) => a.push(...play(els, [{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 320, delay: 60 * i + 220 })));
  a.push(...play(P.wiresL, [{ clipPath: wipe('right') }, { clipPath: 'inset(0 0 0 0)' }], { duration: 420, delay: 420 }));
  a.push(...play(P.mL, [{ transform: 'translateY(50px) scaleY(.35)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, delay: 760, easing: SPRING }));
  a.push(...play(P.mR, [{ transform: 'translateY(50px) scaleY(.35)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 620, delay: 860, easing: SPRING }));
  a.push(...play(P.road, [{ clipPath: wipe('up') }, { clipPath: 'inset(0 0 0 0)' }], { duration: 520, delay: 1080 }));
  a.push(...play([...P.arrowIn, ...P.wiresR], [{ clipPath: wipe('right') }, { clipPath: 'inset(0 0 0 0)' }], { duration: 480, delay: 1220 }));
  P.stages.forEach((els, i) => a.push(...play(els, [{ transform: 'translateY(-14px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, delay: 1300 + 70 * i })));
  a.push(...play(P.arrows, [{ clipPath: wipe('right') }, { clipPath: 'inset(0 0 0 0)' }], { duration: 400, delay: 1420 }));
  a.push(...pulse(svg, 1760));
  P.letters.forEach((els, k) => a.push(...play(els, [{ clipPath: wipe('right'), opacity: 0.2 }, { clipPath: 'inset(0 0 0 0)', opacity: 1 }], { duration: 340, delay: 1580 + 55 * k })));
  P.tris.forEach((els, k) => a.push(...play(els, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1.18)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 360, delay: 2060 + 90 * k })));
  return a;
}

// --- B: drawn as a blueprint, then filled ------------------------------------------------------------------------
function runB(svg) {
  const a = [];
  const paths = all(svg, 'path');
  const W = svg.viewBox.baseVal.width;
  for (const p of paths) {
    const b = p.getBBox();
    const x = Math.max(0, Math.min(1, (b.x - 81.9) / W)); // the group's translate: local x - 81.9 is the view box's
    const layer = p.classList.contains('mv-n') ? 0 : p.classList.contains('mv-l') ? 1 : 2;
    // the outline draws on (its own property only), then the fill comes in as the outline fades (theirs only)
    a.push(...play(p, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 900, delay: 520 * x, easing: 'ease-in-out' }));
    a.push(...play(p, [{ fillOpacity: 0, strokeOpacity: 1 }, { fillOpacity: 1, strokeOpacity: 0 }], { duration: 520, delay: 1050 + 160 * layer + 260 * x }));
  }
  a.push(...pulse(svg, 1900));
  return a;
}

// --- C: the parts assemble from their own sides ------------------------------------------------------------------
function runC(svg) {
  const P = parts(svg);
  const a = [];
  P.cards.forEach((els, i) => a.push(...play(els, [{ transform: 'translateX(-160px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: 50 * i, easing: SPRING })));
  a.push(...play(P.wiresL, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 300 }));
  a.push(...play(P.mL, [{ transform: 'translate(-90px, 70px) rotate(-8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 420, easing: SPRING }));
  a.push(...play(P.mR, [{ transform: 'translate(90px, 70px) rotate(8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700, delay: 500, easing: SPRING }));
  a.push(...play(P.road, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, delay: 900, easing: SPRING }));
  a.push(...play([...P.arrowIn, ...P.wiresR], [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, delay: 980 }));
  P.stages.forEach((els, i) => a.push(...play(els, [{ transform: 'translateY(-90px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 1040 + 60 * i, easing: SPRING })));
  a.push(...play(P.arrows, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 1420 }));
  P.letters.forEach((els, k) => a.push(...play(els, [{ transform: 'translateY(80px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 560, delay: 1180 + 55 * k, easing: SPRING })));
  P.tris.forEach((els, k) => a.push(...play(els, [{ transform: 'scale(0) rotate(-90deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, delay: 1800 + 100 * k, easing: SPRING })));
  a.push(...pulse(svg, 1950));
  return a;
}

// --- D: a signal wave lights the logo from left to right ---------------------------------------------------------
function runD(svg) {
  const a = [];
  const W = svg.viewBox.baseVal.width;
  for (const p of all(svg, 'path')) {
    const b = p.getBBox();
    const x = Math.max(0, Math.min(1, (b.x - 81.9) / W)); // the group's translate: local x - 81.9 is the view box's
    a.push(...play(p, [{ opacity: 0.12, filter: 'brightness(1)' }, { opacity: 1, filter: 'brightness(1.9)', offset: 0.45 }, { opacity: 1, filter: 'brightness(1)' }],
      { duration: 700, delay: 150 + 1350 * x }));
  }
  const scan = svg.querySelector('.p-scan');
  if (scan) a.push(...play(scan, [{ transform: 'translateX(0)', opacity: 0 }, { opacity: 0.9, offset: 0.08 }, { opacity: 0.9, offset: 0.9 }, { transform: `translateX(${W + 80}px)`, opacity: 0 }], { duration: 1750, delay: 100, easing: 'linear', fill: 'none' }));
  a.push(...pulse(svg, 1900));
  return a;
}

export const VARIANTS = { a: runA, b: runB, c: runC, d: runD };

/** The full-form line after the logo fades up near the end of every intro. */
function lineUp(svg) {
  const line = expansion(svg);
  return line ? play(line, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 1900 }) : [];
}

/**
 * Animate `svg` with variant `v`: the intro now (unless reduced motion), then a pipeline pulse every 8 s while it is on
 * screen and the page is visible, and one on hover. Returns {replay(), stop()}.
 */
export function animate(svg, v, { reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  let running = [];
  let visible = true;
  let idle = null;
  const cancel = () => { running.forEach((x) => x.cancel()); running = []; };
  const intro = () => {
    cancel();
    if (reduced()) return;
    svg.classList.add(`mvh-${v}`);
    const mine = [...VARIANTS[v](svg), ...lineUp(svg)];
    running = mine;
    // when this run ends (and only if it is still the current one: a replay cancels it), the logo rests as drawn
    Promise.all(mine.map((x) => x.finished.catch(() => null))).then(() => {
      if (running !== mine) return;
      cancel();
      svg.classList.remove(`mvh-${v}`);
    });
  };
  const beat = () => { if (!reduced() && visible && !document.hidden) pulse(svg); };
  if (typeof IntersectionObserver === 'function') new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(svg);
  idle = setInterval(beat, 8000);
  svg.addEventListener('pointerenter', beat);
  intro();
  return { replay: intro, stop: () => { cancel(); clearInterval(idle); } };
}
