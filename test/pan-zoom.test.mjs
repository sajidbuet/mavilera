// Pan and zoom of a drawing (src/ui/pan-zoom.js; contract v7, arch-contract.md §20): the arithmetic (zoom
// around a point, the limits, fit, keeping the drawing in view) and the keyboard. The controller needs a browser.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, FIT, MARGIN, PAN_STEP, fitScale, drawnRect, zoomOf, clampK, clampPan, zoomAt, zoomTo, wheelFactor, keyAction }
  from '../src/ui/pan-zoom.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} ${a} != ${b}`);
const pane = { w: 800, h: 400 };
const box = { w: 1000, h: 400 }; // fitted by width: 0.8 px per unit, 80 px free above and below
const f = fitScale(pane, box);
const drawn = drawnRect(pane, box);
/** Where the transform `t` shows the pane point `p` of the untransformed drawing. */
const screen = (t, p) => ({ x: t.x + t.k * p.x, y: t.y + t.k * p.y });

test('fit: the drawing scaled to the narrower side and centred', () => {
  near(f, 0.8);
  assert.deepEqual(drawn, { x: 0, y: 40, w: 800, h: 320 });
  near(fitScale({ w: 800, h: 200 }, box), 0.5);
  assert.equal(fitScale(pane, { w: 0, h: 0 }), 1);
  assert.equal(zoomOf(FIT, f), f);
});

test('zoom around a point: the point under the pointer stays where it is', () => {
  for (const p of [{ x: 0, y: 0 }, { x: 123, y: 45 }, { x: 800, y: 400 }]) {
    let t = { ...FIT };
    for (const factor of [1.25, 1.25, 0.6, 3]) {
      // the drawing point under p before the zoom
      const q = { x: (p.x - t.x) / t.k, y: (p.y - t.y) / t.k };
      t = zoomAt(t, factor, p, f);
      const s = screen(t, q);
      near(s.x, p.x, 'x');
      near(s.y, p.y, 'y');
    }
  }
});

test('zoom limits: 25 % to 800 % of the drawing size; the fitted size is always allowed', () => {
  let t = zoomAt(FIT, 1000, { x: 400, y: 200 }, f);
  near(zoomOf(t, f), LIMITS.max);
  t = zoomAt(FIT, 1e-6, { x: 400, y: 200 }, f);
  near(zoomOf(t, f), LIMITS.min);
  // a pane so small that the fitted drawing is below 25 %: zoom out stops at the fit, not at 25 %
  const tiny = fitScale({ w: 100, h: 40 }, box); // 0.1
  near(clampK(0.5, tiny), 1);
  near(clampK(100, tiny), LIMITS.max / tiny);
  // a pane so large that the fit is above 800 %
  near(clampK(2, 10), 1);
});

test('zoom to 100 %: one pixel per drawing unit, around the centre of the pane', () => {
  const t = zoomTo(FIT, 1, pane, f);
  near(zoomOf(t, f), 1);
  const c = { x: (400 - FIT.x) / FIT.k, y: (200 - FIT.y) / FIT.k };
  near(screen(t, c).x, 400);
  near(screen(t, c).y, 200);
});

test('pan limits: the drawing cannot leave the pane; at least MARGIN pixels of it stay in view', () => {
  for (const k of [1, 2, 5]) {
    for (const [x, y] of [[1e6, 1e6], [-1e6, -1e6], [1e6, -1e6]]) {
      const t = clampPan({ k, x, y }, pane, drawn);
      const left = t.x + k * drawn.x;
      const right = left + k * drawn.w;
      const top = t.y + k * drawn.y;
      const bottom = top + k * drawn.h;
      assert.ok(Math.min(right, pane.w) - Math.max(left, 0) >= MARGIN - 1e-9, `k ${k}: ${left}..${right}`);
      assert.ok(Math.min(bottom, pane.h) - Math.max(top, 0) >= MARGIN - 1e-9, `k ${k}: ${top}..${bottom}`);
    }
  }
  assert.deepEqual(clampPan(FIT, pane, drawn), FIT); // the fitted drawing is left as it is
  const t = { k: 2, x: -100, y: -50 };
  assert.deepEqual(clampPan(t, pane, drawn), t); // inside the limits: unchanged
  // a drawing smaller than the margin: half of it stays in view
  const small = clampPan({ k: 1, x: 1e6, y: 0 }, pane, { x: 0, y: 0, w: 20, h: 20 });
  assert.equal(small.x, pane.w - 10);
});

test('wheel: down zooms out, up zooms in; lines and a touchpad pinch (Ctrl) are scaled', () => {
  assert.ok(wheelFactor({ deltaY: 100 }) < 1);
  assert.ok(wheelFactor({ deltaY: -100 }) > 1);
  near(wheelFactor({ deltaY: 100 }) * wheelFactor({ deltaY: -100 }), 1);
  near(wheelFactor({ deltaY: 3, deltaMode: 1 }), wheelFactor({ deltaY: 48 }));
  assert.ok(wheelFactor({ deltaY: -10, ctrlKey: true }) > wheelFactor({ deltaY: -10 }));
  near(wheelFactor({ deltaY: 1e5 }), wheelFactor({ deltaY: 200 })); // a burst is capped
});

test('keys: + and = zoom in, - zooms out, 0 fits, the arrows pan; not with Ctrl, Alt or Meta', () => {
  assert.deepEqual(keyAction({ key: '+' }), { zoom: 1 });
  assert.deepEqual(keyAction({ key: '=' }), { zoom: 1 });
  assert.deepEqual(keyAction({ key: '-' }), { zoom: -1 });
  assert.deepEqual(keyAction({ key: '0' }), { fit: true });
  assert.deepEqual(keyAction({ key: 'ArrowRight' }), { pan: [-PAN_STEP, 0] });
  assert.deepEqual(keyAction({ key: 'ArrowLeft' }), { pan: [PAN_STEP, 0] });
  assert.deepEqual(keyAction({ key: 'ArrowDown' }), { pan: [0, -PAN_STEP] });
  assert.deepEqual(keyAction({ key: 'ArrowUp', shiftKey: true }), { pan: [0, 4 * PAN_STEP] });
  for (const mod of ['ctrlKey', 'altKey', 'metaKey']) assert.equal(keyAction({ key: '+', [mod]: true }), null);
  for (const key of ['Enter', ' ', 'a', '1', 'Escape', 'F10']) assert.equal(keyAction({ key }), null);
});
