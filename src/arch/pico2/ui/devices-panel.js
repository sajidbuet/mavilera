// pico2/ui/devices-panel.js -- the PWM and DMA tabs of the memory pane (contract v8 Descriptor.panels; P1-M5, research D39 Q8)
// and the ADC, SPI and I2C tabs (P1-M7, design Q3, research D43: three tabs; the blocks one line each, the newest transfers of
// that bus, and on the I2C tab the lab kit's LCD):
// each PWM slice and DMA channel decoded from its registers (Engine.panelState: reads only, the machine is not changed). PWM:
// enable, mode, divider, TOP, the compare values (written and latched), the counter, the period's frequency and duty, the pins
// that show the slice. DMA: busy, addresses, the count (left and reload), size, increments, ring, chain, what paces it, IRQ and
// errors; the sniffer. Slices and channels still at their reset values are folded into one line. Shown after each step and
// when a run stops (a real-time run shows the pins live; these tables wait for the pause). Every value is text, never colour alone.
// The simulator's own layout (C4).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { el } from '../../../ui/dom.js';
import { PICO2_STRINGS } from '../strings.js';

const D = PICO2_STRINGS.devices;
const hex = (v) => `0x${(v >>> 0).toString(16).padStart(8, '0')}`;
const pct = (x) => `${(x * 100).toFixed(x > 0 && x < 0.01 ? 2 : 1)} %`;
const freq = (hz) => (hz === null || !Number.isFinite(hz) ? '—' : hz >= 1e6 ? `${(hz / 1e6).toFixed(3)} MHz` : hz >= 1e3 ? `${(hz / 1e3).toFixed(3)} kHz` : `${hz.toFixed(2)} Hz`);
const pinsOf = (mask) => { const out = []; for (let n = 0; n < 30; n++) if ((mask >>> n) & 1) out.push(`GP${n}`); return out.join(' '); };

/** A table with a caption, its header row and rows of text cells. */
function table(caption, head, rows) {
  return el('table.dv-table', {}, el('caption', { text: caption }),
    el('thead', {}, el('tr', {}, head.map((h) => el('th', { scope: 'col', text: h[0], title: h[1] ?? null })))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c, i) => (i === 0 ? el('th', { scope: 'row', text: c }) : el('td.mono', { text: c })))))));
}

class DevicesPanel {
  constructor(kind) {
    this.kind = kind;
    this.note = el('p.note.dv-note', { text: D.noProgram });
    this.body = el('div.dv-body');
    // a scrolling region reachable by the keyboard (WCAG 2.1.1; axe scrollable-region-focusable)
    this.root = el(`div.pico2-devices.dv-${kind}`, { tabindex: '0', role: 'region', 'aria-label': D[`${kind}Caption`] }, this.note, this.body);
    this.last = '';
  }
  update(state, { running }) {
    const p = state?.panel;
    if (!p) { this.note.textContent = running ? D.running : D.noProgram; if (!running) this.body.replaceChildren(); return; }
    const k = this.kind;
    const key = JSON.stringify(k === 'pwm' ? p.pwm : k === 'dma' ? [p.dma, p.sniff] : k === 'adc' ? p.adc : k === 'spi' ? p.spi : [p.i2c, p.parts?.on && p.parts.lcd]);
    if (key === this.last) return;
    this.last = key;
    this.note.textContent = k === 'pwm' ? D.pwmIntro(p.clkSys) : k === 'dma' ? D.dmaIntro(p.transfers) : k === 'adc' ? D.adcIntro(p.adc.en, p.adc.clkAdc) : k === 'spi' ? D.spiIntro : D.i2cIntro;
    this.body.replaceChildren(...this[k](p));
  }
  pwm(p) {
    const used = p.pwm.filter((s) => s.en || s.pins || s.top !== 0xffff || s.ccA || s.ccB || s.div !== 1 || s.counter || s.mode);
    const rows = used.map((s) => {
      const per = s.periodCycles, dA = s.latched.ccA / (s.latched.top + 1), dB = s.latched.ccB / (s.latched.top + 1);
      return [D.slice(s.slice), s.en ? D.yes : D.no, D.modes[s.mode] + (s.phaseCorrect ? `, ${D.phaseCorrect}` : ''), String(s.div),
        `${s.top}${s.top !== s.latched.top ? ` (${s.latched.top})` : ''}`,
        `${s.ccA}${s.ccA !== s.latched.ccA ? ` (${s.latched.ccA})` : ''}`, s.mode === 0 ? `${s.ccB}${s.ccB !== s.latched.ccB ? ` (${s.latched.ccB})` : ''}` : D.input,
        String(s.counter), s.mode === 0 ? freq(p.clkSys / per) : '—', pct(Math.min(1, dA)) + (s.aInv ? ` ${D.inv}` : ''), s.mode === 0 ? pct(Math.min(1, dB)) + (s.bInv ? ` ${D.inv}` : '') : '—',
        pinsOf(s.pins) || '—'];
    });
    const out = [];
    if (rows.length) out.push(table(D.pwmCaption, D.pwmHead, rows));
    const rest = 12 - used.length;
    if (rest) out.push(el('p.note', { text: D.atReset(rest, 'slice') }));
    return out;
  }
  dma(p) {
    const used = p.dma.filter((c) => c.busy || c.en || c.read || c.write || c.reload || c.irq || c.error || c.treq || c.chainTo !== 0);
    const rows = used.map((c) => [D.channel(c.channel), c.busy ? D.busy : D.idle, c.en ? D.yes : D.no, hex(c.read), hex(c.write),
      `${c.count} / ${c.reload}`, D.countModes[c.mode] ?? `${c.mode}`, `${c.size}`, `${D.incr[c.incrRead]} / ${D.incr[c.incrWrite]}`,
      c.ring ? D.ring(1 << c.ring, c.ringWrite) : '—', c.chainTo === c.channel ? '—' : D.channel(c.chainTo), D.treq(c.treq),
      [c.irq ? D.irqRaised : '', c.quiet ? D.quiet : ''].filter(Boolean).join(', ') || '—', c.error ? D.error(c.error) : '—']);
    const out = [];
    if (rows.length) out.push(table(D.dmaCaption, D.dmaHead, rows));
    const rest = 16 - used.length;
    if (rest) out.push(el('p.note', { text: D.atReset(rest, 'channel') }));
    if (p.sniff.ctrl & 1) out.push(el('p.note', { text: D.sniffer((p.sniff.ctrl >>> 1) & 0xf, (p.sniff.ctrl >>> 5) & 0xf, hex(p.sniff.data)) }));
    return out;
  }
  /** P1-M7: the ADC (input, mode, result, FIFO). */
  adc(p) {
    return p.adc.en ? [el('p.mono', { text: D.adcRow(p.adc) }), el('p.mono', { text: D.adcFifo(p.adc) })] : [];
  }
  /** P1-M7: the two SPI blocks one line each and their newest transfers. */
  spi(p) {
    return [...p.spi.map((v) => el('p.mono', { text: D.spiRow(v) })), ...log(p.spi.flatMap((v) => v.log.map((e) => [e.cycle, D.spiLog(v.index, e)])))];
  }
  /** P1-M7: the two I2C blocks one line each, the lab kit's LCD, and their newest transfers. */
  i2c(p) {
    const out = p.i2c.map((v) => el('p.mono', { text: D.i2cRow(v) }));
    if (p.parts?.on && p.parts.lcd) out.push(el('pre.dv-lcd.mono', { role: 'group', 'aria-label': PICO2_STRINGS.parts.lcd, text: p.parts.lcd.join('\n') }));
    return [...out, ...log(p.i2c.flatMap((v) => v.log.map((e) => [e.cycle, D.i2cLog(v.index, e)])))];
  }
}

/** A bus log, its newest 24 entries in order of the cycle they ended on. */
function log(entries) {
  const list = entries.sort((a, b) => a[0] - b[0]).slice(-24);
  return [el('h4', { text: D.logHead }), list.length ? el('ol.dv-log.mono', {}, list.map(([, t]) => el('li', { text: t }))) : el('p.note', { text: D.noLog })];
}

export const PwmPanel = class extends DevicesPanel { constructor() { super('pwm'); } };
export const DmaPanel = class extends DevicesPanel { constructor() { super('dma'); } };
export const AdcPanel = class extends DevicesPanel { constructor() { super('adc'); } };
export const SpiPanel = class extends DevicesPanel { constructor() { super('spi'); } };
export const I2cPanel = class extends DevicesPanel { constructor() { super('i2c'); } };
