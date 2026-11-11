// gpio.js -- the 30 GPIO pins of the RP2350A (the Pico 2's chip; RP-002 p.4) with IO_BANK0 and PADS_BANK0 (RP-001 §9;
// R-RP-01 §3.8). Per pin: the function select (F2 UART, F5 SIO, F11 UART TX/RX on pins 4n+2/4n+3; other functions are reported as
// not modelled; RP-001 §9.4 Table 677), the CTRL overrides, the pad (IE, OD, PUE, PDE, ISO: pads reset isolated with input off,
// RP-001 §9.3), an external drive from the host, and edge/level interrupt detection for core 0 (IO_IRQ_BANK0 = 21, RP-001 §3.2).
// The pin level is the pad output when the pad drives, else the external drive, else the pull, else the last level.
// Every change of a pin's state is logged with its cycle, in the states 0, 1, in, pu, pd (the codes 0..4), which the P1-M2
// comparison with SIM-001 reads (research repository, experiments/p1m2-oracle).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';

export const NUM_PINS = 30;
const LOG_LIMIT = 1 << 20; // the state log keeps its newest entries (base counts the dropped ones)
export const PIN_STATES = Object.freeze(['0', '1', 'in', 'pu', 'pd']);
const F_SPI = 1, F_UART = 2, F_I2C = 3, F_PWM = 4, F_SIO = 5, F_UART_AUX = 11, F_NULL = 31;
const FUNCTION_NAMES = ['HSTX', 'SPI', 'UART', 'I2C', 'PWM', 'SIO', 'PIO0', 'PIO1', 'PIO2', 'clock/QMI/trace', 'USB', 'UART (alternate)'];
const PAD_PDE = 0x4, PAD_PUE = 0x8, PAD_IE = 0x40, PAD_OD = 0x80, PAD_ISO = 0x100;
const over = (v, o) => (o === 0 ? v : o === 1 ? v ^ 1 : o === 2 ? 0 : 1);

/** The UART instance on a pin for F2 (groups of four pins: 0 UART0, 1-2 UART1, 3-4 UART0, 5-6 UART1, 7 UART0). */
export const uartOfPin = (n) => (((n >>> 2) + 1) >>> 1) & 1;

export class Pins {
  constructor(m) {
    this.m = m; this.log = { cycles: [], pins: [], states: [], base: 0 };
    this.tapPin = -1; this.tapLevel = 0; // the speaker pin (P1-M5): its level changes go to m.audio; not machine state
    this.csPins = 0; // P1-M7: the pins that carry a kit part's chip select (set by the machine)
    this.reset();
  }
  reset() {
    this.ctrl = new Uint32Array(NUM_PINS).fill(F_NULL);
    this.pad = new Uint32Array(NUM_PINS);
    this.ext = new Int8Array(NUM_PINS).fill(-1);    // external drive: -1 none, 0, 1
    this.level = new Uint8Array(NUM_PINS);          // level on the pin
    this.input = new Uint8Array(NUM_PINS);          // input to the peripherals (after IE, ISO, INOVER)
    this.isoOut = new Uint8Array(NUM_PINS); this.isoOe = new Uint8Array(NUM_PINS); // pad values held while ISO is set
    this.padOut = new Uint8Array(NUM_PINS); this.padOe = new Uint8Array(NUM_PINS);
    this.state = new Uint8Array(NUM_PINS).fill(2);
    this.edges = new Uint8Array(NUM_PINS);          // latched EDGE_LOW (bit 2) / EDGE_HIGH (bit 3)
    this.inMask = 0;                                 // SIO GPIO_IN
  }
  /** Recompute pin n after a change of its function, pad, SIO output, peripheral output or external drive. */
  update(n) {
    const m = this.m, ctrl = this.ctrl[n], f = ctrl & 0x1f, pad = this.pad[n];
    let out = 0, oe = 0;
    if (f === F_SIO) { out = (m.sio.gpioOut >>> n) & 1; oe = (m.sio.gpioOe >>> n) & 1; }
    else if (f === F_UART) { const role = n & 3; if (role === 0 || role === 3) { out = 1; oe = 1; } } // TX idles high; RTS inactive high
    else if (f === F_UART_AUX) { if ((n & 3) === 2) { out = 1; oe = 1; } }
    else if (f === F_PWM) { const v = m.pwm.pinOut(n); out = v & 1; oe = v >>> 1; } // P1-M5: A always an output, B unless an input mode
    else if (f === F_SPI) { [out, oe] = m.spi[(n >>> 3) & 1].pinOut(n); } // P1-M7: SCK, TX, CSn driven by a master; RX an input
    else if (f === F_I2C) { /* P1-M7: open drain, released between transfers (bits on SDA/SCL are not modelled) */ }
    else if (f >= 6 && f <= 8) { [out, oe] = m.pio.pinOut(n, f - 6); } // P1-M8: PIO0-2's output registers
    else if (f !== F_NULL) m.diag('gpioFunction', n, FUNCTION_NAMES[f] ?? `F${f}`);
    out = over(out, (ctrl >>> 12) & 3); oe = over(oe, (ctrl >>> 14) & 3);
    if (pad & PAD_OD) oe = 0;
    if (pad & PAD_ISO) { out = this.isoOut[n]; oe = this.isoOe[n]; } else { this.isoOut[n] = out; this.isoOe[n] = oe; }
    this.padOut[n] = out; this.padOe[n] = oe;
    let level;
    if (oe) level = out;
    else if (this.ext[n] >= 0) level = this.ext[n];
    else if ((pad & PAD_PUE) && !(pad & PAD_PDE)) level = 1;
    else if ((pad & PAD_PDE) && !(pad & PAD_PUE)) level = 0;
    else level = this.level[n];
    const was = this.level[n];
    this.level[n] = level;
    const input = over((pad & PAD_IE) && !(pad & PAD_ISO) ? level : 0, (ctrl >>> 16) & 3);
    if (level !== was && (this.csPins >>> n) & 1) { m.spi[0].pinLevel(n, level); m.spi[1].pinLevel(n, level); } // P1-M7: a kit part's chip select
    if (n === this.tapPin && level !== this.tapLevel) { this.tapLevel = level; m.audio?.edge(level, m.now); } // P1-M5: the speaker
    if (input !== this.input[n]) {
      this.edges[n] |= input ? 0x8 : 0x4;
      this.input[n] = input;
      this.inMask = input ? (this.inMask | (1 << n)) >>> 0 : (this.inMask & ~(1 << n)) >>> 0;
      m.pio?.inputChanged(n, input, m.now); // P1-M8: the PIO's synchronisers and the state machines that wait on pins
      m.io.updateIrq(); // levels and edges come from the input only (UART RX from a pin is not modelled: no bit-level waveform)
      if (f === F_PWM) m.pwm.pinInput(n); // P1-M5: PWM channel B as an input (gate or edge counting)
    }
    const st = oe ? out : (pad & PAD_PDE) ? 4 : (pad & PAD_PUE) ? 3 : 2;
    if (st !== this.state[n]) {
      this.state[n] = st;
      const lg = this.log, now = m.now; // an event's own cycle while the scheduler runs it (P1-M5: PWM edges, DMA writes)
      lg.cycles.push(now); lg.pins.push(n); lg.states.push(st);
      if (lg.cycles.length > LOG_LIMIT) { const k = LOG_LIMIT >>> 1; lg.cycles.splice(0, k); lg.pins.splice(0, k); lg.states.splice(0, k); lg.base += k; }
      m.onPin?.(n, st, now);
    }
  }
  clearLog() { this.log.cycles.length = 0; this.log.pins.length = 0; this.log.states.length = 0; this.log.base = 0; }
  /** Recompute the pins of `mask`, lowest first (only the set bits are visited: a toggle of one pin costs one update). */
  updateMask(mask) {
    let rest = mask & ((1 << NUM_PINS) - 1);
    while (rest !== 0) { const n = 31 - Math.clz32(rest & -rest); rest &= rest - 1; this.update(n); }
  }
  updateAll() { for (let n = 0; n < NUM_PINS; n++) this.update(n); }
  /** Drive pin n from outside (-1 releases it). */
  drive(n, v) { this.ext[n] = v; this.update(n); }
  save() {
    return { ctrl: this.ctrl.slice(), pad: this.pad.slice(), ext: this.ext.slice(), level: this.level.slice(), input: this.input.slice(), isoOut: this.isoOut.slice(),
      isoOe: this.isoOe.slice(), padOut: this.padOut.slice(), padOe: this.padOe.slice(), state: this.state.slice(), edges: this.edges.slice(), inMask: this.inMask,
      logTotal: this.log.base + this.log.cycles.length };
  }
  load(s) {
    for (const k of ['ctrl', 'pad', 'ext', 'level', 'input', 'isoOut', 'isoOe', 'padOut', 'padOe', 'state', 'edges']) this[k].set(s[k]);
    this.inMask = s.inMask;
    const lg = this.log, keep = s.logTotal - lg.base;
    if (keep >= 0) { lg.cycles.length = Math.min(keep, lg.cycles.length); lg.pins.length = lg.cycles.length; lg.states.length = lg.cycles.length; }
    else { this.clearLog(); lg.base = s.logTotal; }
  }
}

export class IoBank0 extends Device {
  constructor(m) {
    super(m, 'IO_BANK0', { resetBit: 6 });
    this.oIntr = this.r.off('INTR0');
    // P1-M6: each core has its own enables, forces and status (PROC0_*, PROC1_*), and its own IO_IRQ_BANK0 (21, core-local, RP-001 §3.2)
    this.oInteC = [this.r.off('PROC0_INTE0'), this.r.off('PROC1_INTE0')]; this.oIntfC = [this.r.off('PROC0_INTF0'), this.r.off('PROC1_INTF0')];
    this.oIntsC = [this.r.off('PROC0_INTS0'), this.r.off('PROC1_INTS0')];
    this.oInte = this.oInteC[0]; this.oIntf = this.oIntfC[0]; this.oInts = this.oIntsC[0];
    this.line = 0; this.enabled = 0; // bit c: core c
  }
  get pins() { return this.m.pins; }
  /** The 4-bit INTR nibble of pin n: levels now, edges latched. */
  raw(n) { const i = this.pins.input[n]; return (i ? 0x2 : 0x1) | this.pins.edges[n]; }
  word(base, k, f) { let v = 0; for (let j = 0; j < 8; j++) { const n = 8 * k + j; if (n < 30) v |= f(n, ((this.r.get(base + 4 * k) >>> (4 * j)) & 0xf)) << (4 * j); } return v >>> 0; }
  ints(k, c = 0) {
    const fb = this.oIntfC[c];
    return this.word(this.oInteC[c], k, (n, inte) => {
      const f = (this.r.get(fb + 4 * k) >>> (4 * (n & 7))) & 0xf;
      return over2(((this.raw(n) & inte) | f) & 0xf, (this.pins.ctrl[n] >>> 28) & 3);
    });
  }
  readReg(off) {
    if (off < 0x180) { // GPIOn_STATUS / GPIOn_CTRL
      const n = off >>> 3;
      if (off & 4) return n < 30 ? this.pins.ctrl[n] : this.r.get(off);
      if (n >= 30) return 0;
      const p = this.pins, k = n >>> 3;
      const irq = ((this.ints(k, this.m.hart.hartid) >>> (4 * (n & 7))) & 0xf) ? 1 : 0; // to the core that reads it
      return ((p.padOut[n] << 9) | (p.padOe[n] << 13) | (p.level[n] << 17) | (irq << 26)) >>> 0;
    }
    if (off >= this.oIntr && off < this.oIntr + 24) { const k = (off - this.oIntr) >>> 2; return this.word(this.oIntr, k, (n) => this.raw(n)); }
    for (const c of [0, 1]) if (off >= this.oIntsC[c] && off < this.oIntsC[c] + 24) return this.ints((off - this.oIntsC[c]) >>> 2, c);
    return this.r.get(off);
  }
  write(off, value, alias, addr, size, raw) {
    if (!this.held() && off >= this.oIntr && off < this.oIntr + 24) { // write 1 to clear a latched edge (any alias that writes the bit)
      if (alias === 3) return;
      const k = (off - this.oIntr) >>> 2;
      for (let j = 0; j < 8; j++) { const n = 8 * k + j; if (n < 30) this.pins.edges[n] &= ~((value >>> (4 * j)) & 0xc); }
      this.updateIrq(); return;
    }
    super.write(off, value, alias, addr, size, raw);
  }
  onWrite(off, nv) {
    if (off < 0x180 && (off & 4) && (off >>> 3) < 30) {
      const n = off >>> 3, was = this.pins.ctrl[n] & 0x1f;
      this.pins.ctrl[n] = nv;
      if (was === F_PWM || (nv & 0x1f) === F_PWM) this.m.pwm.pinsChanged(); // P1-M5: which pins show which PWM slice
      this.pins.update(n);
    }
    this.enabled = 0;
    for (const c of [0, 1]) for (let k = 0; k < 6; k++) if (this.r.get(this.oInteC[c] + 4 * k) | this.r.get(this.oIntfC[c] + 4 * k)) this.enabled |= 1 << c;
    this.updateIrq(); // INTE, INTF, IRQOVER
  }
  updateIrq() {
    if (!this.enabled && !this.line) return; // no INTE/INTF bit set for either core: nothing can interrupt (the common case)
    for (const c of [0, 1]) {
      let any = 0;
      if ((this.enabled >>> c) & 1) for (let k = 0; k < 4 && !any; k++) any = this.ints(k, c) ? 1 : 0;
      if (any !== ((this.line >>> c) & 1)) { this.line ^= 1 << c; this.m.irqCore(c, 21, any); }
    }
  }
  reset() {
    super.reset();
    this.enabled = 0;
    if (this.m.pins) { this.m.pins.ctrl.fill(F_NULL); this.m.pins.edges.fill(0); if (this.m.ready) this.m.pwm.pinsChanged(); this.m.pins.updateAll(); }
  }
  save() { return { ...super.save(), line: this.line, enabled: this.enabled }; }
  load(s) { super.load(s); this.line = s.line; this.enabled = s.enabled; }
}
const over2 = (v, o) => (o === 0 ? v : o === 1 ? (~v & 0xf) : o === 2 ? 0 : 0xf);

export class PadsBank0 extends Device {
  constructor(m) { super(m, 'PADS_BANK0', { resetBit: 9 }); this.o0 = this.r.off('GPIO0'); }
  readReg(off) { const n = (off - this.o0) >>> 2; return off >= this.o0 && n < 30 ? this.m.pins.pad[n] : this.r.get(off); }
  onWrite(off, nv) { const n = (off - this.o0) >>> 2; if (off >= this.o0 && n < 30) { this.m.pins.pad[n] = nv; this.m.pins.update(n); } }
  reset() {
    super.reset();
    if (this.m.pins) { for (let n = 0; n < 30; n++) this.m.pins.pad[n] = this.r.get(this.o0 + 4 * n); this.m.pins.updateAll(); }
  }
}
