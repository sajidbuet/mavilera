// platform-figure.js -- the drawing of the platform board (Peripherals tab): eight LEDs on the GPIO
// output, four switches and a push button on the GPIO input, the timer's count against its compare
// value, the UART's two lines, and the interrupt lines to the processor. Drawn for this application
// (original geometry; no reference to any board or simulator). The structure is built once; update()
// only changes classes and attributes, so that the CSS transitions animate the change (an LED
// glowing, a switch sliding, the button sinking, an interrupt line pulsing). The switches and the
// button are keyboard operable: Space or Enter. No DOM beyond SVG, no state of its own.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { STRINGS } from './strings.js';

const NS = 'http://www.w3.org/2000/svg';
const P = () => STRINGS.platform; // read when used: the architecture's strings are merged in after this module loads
const MAX64 = (1n << 64n) - 1n;

function s(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : String(v));
  for (const c of kids.flat()) if (c !== null && c !== undefined) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
}

const label = (x, y, t, cls = 'pf-label', anchor = 'middle') => s('text', { x, y, class: cls, 'text-anchor': anchor }, t);
const frame = (x, y, w, h, cls = 'pf-box') => s('rect', { x, y, width: w, height: h, rx: 8, class: cls });

/**
 * @param {{onSwitch: (n: number, up: boolean) => void, onButton: (down: boolean) => void}} handlers
 * @returns {{svg: SVGSVGElement, update: (st: object) => void}}
 */
export function buildBoard({ onSwitch, onButton }) {
  const svg = s('svg', { class: 'pf-board', viewBox: '0 0 600 266', role: 'group', 'aria-label': P().figureLabel, focusable: 'false' });

  // the interrupt lines first, so that the boxes cover their ends
  // the GPIO and the UART both feed the external interrupt (MEIP); the timer has its own line (MTIP)
  const irq = {
    gpio: s('path', { class: 'pf-irq', d: 'M 170 170 V 200 H 250' }),
    uart: s('path', { class: 'pf-irq', d: 'M 540 170 V 200 H 250' }),
    meip: s('path', { class: 'pf-irq', d: 'M 250 200 V 216' }),
    mtip: s('path', { class: 'pf-irq', d: 'M 590 49 H 596 V 236 H 400' }),
  };
  svg.append(irq.gpio, irq.uart, irq.meip, irq.mtip);

  // GPIO: LEDs on OUT, switches and button on IN
  svg.append(frame(10, 10, 300, 160), label(24, 28, P().boardLabels.gpio, 'pf-title', 'start'), label(24, 62, P().boardLabels.leds, 'pf-sub', 'start'));
  const leds = [];
  for (let i = 0; i < 8; i++) {
    const x = 120 + 24 * (7 - i);
    leds[i] = s('circle', { cx: x, cy: 58, r: 9, class: 'pf-led', role: 'img' });
    svg.append(leds[i], label(x, 82, String(i), 'pf-tick'));
  }

  svg.append(label(24, 112, P().boardLabels.switches, 'pf-sub', 'start'));
  const switches = [];
  for (let n = 3; n >= 0; n--) {
    const x = 148 + 50 * (3 - n);
    const knob = s('circle', { cx: x - 8, cy: 108, r: 7, class: 'pf-knob' });
    const g = s('g', { class: 'pf-switch', tabindex: 0, role: 'switch', 'aria-checked': 'false', 'aria-label': P().sw(n) },
      s('rect', { x: x - 20, y: 96, width: 40, height: 24, rx: 12, class: 'pf-track' }), knob);
    const flip = () => onSwitch(n, g.getAttribute('aria-checked') !== 'true');
    g.addEventListener('click', flip);
    g.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    switches[n] = { g, knob, x };
    svg.append(g, label(x, 134, String(n), 'pf-tick'));
  }

  svg.append(label(24, 158, P().boardLabels.button, 'pf-sub', 'start'));
  const cap = s('rect', { x: 142, y: 142, width: 44, height: 18, rx: 6, class: 'pf-cap' });
  const pb = s('g', { class: 'pf-button', tabindex: 0, role: 'button', 'aria-pressed': 'false', 'aria-label': P().button },
    s('rect', { x: 134, y: 138, width: 60, height: 28, rx: 8, class: 'pf-well' }), cap);
  let down = false;
  const press = (v) => { if (down !== v) { down = v; onButton(v); } };
  pb.addEventListener('pointerdown', (e) => { e.preventDefault(); pb.focus(); press(true); });
  for (const t of ['pointerup', 'pointerleave', 'pointercancel']) pb.addEventListener(t, () => press(false));
  pb.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(true); } });
  pb.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') press(false); });
  pb.addEventListener('blur', () => press(false));
  svg.append(pb);

  // timer: MTIME against MTIMECMP, and the request line
  svg.append(frame(330, 10, 260, 78), label(344, 28, P().boardLabels.timer, 'pf-title', 'start'));
  const bar = s('rect', { x: 344, y: 40, width: 0, height: 10, rx: 5, class: 'pf-fill' });
  const mtipLamp = s('circle', { cx: 570, cy: 24, r: 6, class: 'pf-lamp' });
  const timeText = label(344, 74, '', 'pf-mono', 'start');
  svg.append(s('rect', { x: 344, y: 40, width: 232, height: 10, rx: 5, class: 'pf-slot' }), bar, mtipLamp, label(558, 28, P().boardLabels.mtip, 'pf-tick', 'end'), timeText);

  // UART: the last byte sent, the transmitter and receiver lamps
  svg.append(frame(330, 98, 260, 72), label(344, 116, P().boardLabels.uart, 'pf-title', 'start'));
  const txBits = [];
  for (let b = 7; b >= 0; b--) {
    txBits[b] = s('rect', { x: 400 + 16 * (7 - b), y: 124, width: 12, height: 14, rx: 2, class: 'pf-bit' });
    svg.append(txBits[b]);
  }
  const txLamp = s('circle', { cx: 354, cy: 131, r: 6, class: 'pf-lamp' });
  const rxLamp = s('circle', { cx: 354, cy: 156, r: 6, class: 'pf-lamp' });
  const uartLamp = s('circle', { cx: 570, cy: 114, r: 6, class: 'pf-lamp' });
  svg.append(txLamp, label(368, 135, P().boardLabels.tx, 'pf-tick', 'start'), rxLamp, label(368, 160, P().boardLabels.rx, 'pf-tick', 'start'), uartLamp);

  // processor
  const modeText = label(380, 240, '', 'pf-title', 'end');
  svg.append(frame(200, 216, 200, 40, 'pf-box pf-cpu'), label(214, 240, P().boardLabels.cpu, 'pf-sub', 'start'), modeText,
    label(258, 212, P().boardLabels.meip, 'pf-tick', 'start'), label(590, 230, P().boardLabels.mtip, 'pf-tick', 'end'));

  /** st: {out, inp, mtime, cmp, mtip, meip, uart: {busy, last, rxWaiting, irq}|null, mode} */
  function update(st) {
    leds.forEach((c, i) => {
      const on = ((st.out >>> i) & 1) === 1;
      c.classList.toggle('on', on);
      c.setAttribute('aria-label', P().led(i, on));
    });
    switches.forEach(({ g, knob, x }, n) => {
      const up = ((st.inp >>> (4 + n)) & 1) === 1;
      g.setAttribute('aria-checked', String(up));
      g.classList.toggle('on', up);
      knob.setAttribute('cx', up ? x + 8 : x - 8);
    });
    const pressed = ((st.inp >>> 8) & 1) === 1;
    pb.setAttribute('aria-pressed', String(pressed));
    pb.classList.toggle('down', pressed);
    const armed = st.cmp !== MAX64;
    const frac = armed && st.cmp > 0n ? Math.min(1, Number(st.mtime) / Number(st.cmp)) : 0;
    bar.setAttribute('width', String(Math.round(232 * frac)));
    mtipLamp.classList.toggle('on', st.mtip);
    timeText.textContent = `${P().boardLabels.mtime} ${st.mtime}   ${P().boardLabels.cmp} ${armed ? st.cmp : '–'}`;
    irq.gpio.classList.toggle('active', Boolean(st.gpioIrq));
    irq.uart.classList.toggle('active', Boolean(st.uart?.irq));
    irq.meip.classList.toggle('active', st.meip);
    irq.mtip.classList.toggle('active', st.mtip);
    uartLamp.classList.toggle('on', Boolean(st.uart?.irq));
    txLamp.classList.toggle('on', Boolean(st.uart?.busy));
    rxLamp.classList.toggle('on', Boolean(st.uart?.rxWaiting));
    txBits.forEach((r, b) => r.classList.toggle('on', Boolean(st.uart) && ((st.uart.last >>> b) & 1) === 1));
    modeText.textContent = st.mode;
  }

  return { svg, update };
}
