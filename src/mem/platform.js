// platform.js -- the SoC laboratory platform: the GPIO, the timer and the UART at their slots, the
// window around them, and what the trap mechanism needs from them (the interrupt requests of mip,
// the next event for wfi, the interrupt log). It also keeps the journal of the machine's state:
// the first change in a step saves the state as it was before the step (docs/architecture/
// memory-hierarchy.md §8), so that a step back restores devices and privileged state together.
// Time and events follow rvpriv.py (the book's reference model); the UART is new and not in it.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Gpio, Timer, Uart, PeripheralWindow, GPIO_BASE, TIMER_BASE, UART_BASE, PERIPH_LO, PERIPH_SIZE, BUTTON_BIT } from './devices.js';

const MTI = 7;

/** Saves the state once per step, at the first change. `snapshot()` is given by the machine. */
export class Journal {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.saved = null;
  }

  reset() { this.saved = null; }

  touch() { if (this.saved === null) this.saved = this.snapshot(); }
}

const NO_JOURNAL = Object.freeze({ touch() {}, reset() {}, saved: null });

/** Pin events: lines 'CYCLE NAME VALUE' as the --irq file of rvsim.py: NAME btn, sw0..sw3 or sw (4 bits). */
export function parseStimulus(text) {
  const out = [];
  let last = -1;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const parts = lines[n].split('#', 1)[0].trim().split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length !== 3) throw new Error(`line ${n + 1}: expected 'CYCLE NAME VALUE'`);
    const cycle = Number(parts[0]);
    const val = Number(parts[2]);
    const name = parts[1].toLowerCase();
    if (!Number.isInteger(cycle) || !Number.isInteger(val)) throw new Error(`line ${n + 1}: the cycle and the value are integers`);
    if (cycle < last) throw new Error(`line ${n + 1}: cycles must not decrease`);
    last = cycle;
    if (name === 'btn') out.push({ cycle, mask: 1 << BUTTON_BIT, value: (val & 1) << BUTTON_BIT });
    else if (name === 'sw') out.push({ cycle, mask: 0xf0, value: (val & 0xf) << 4 });
    else if (/^sw[0-3]$/.test(name)) { const b = 4 + Number(name[2]); out.push({ cycle, mask: 1 << b, value: (val & 1) << b }); }
    else throw new Error(`line ${n + 1}: unknown pin '${parts[1]}' (btn, sw, sw0..sw3)`);
  }
  return out;
}

export class Platform {
  /**
   * @param {{stimulus?: Array, rx?: Array, mtimeDiv?: number, uart?: boolean, txCycles?: number}} o
   *   stimulus: pin events of the GPIO inputs; rx: bytes arriving at the UART ({cycle, byte}); uart: false
   *   leaves the slot at 0x4000_2000 to the window (reads 0), as rvsim.py has no UART.
   */
  constructor({ stimulus = [], rx = [], mtimeDiv = 1, uart = true, txCycles = 4 } = {}) {
    this.config = { stimulus, rx, mtimeDiv, uart, txCycles };
    this.window = new PeripheralWindow();
    this.gpio = new Gpio({ stimulus });
    this.timer = new Timer({ div: mtimeDiv });
    this.uart = uart ? new Uart({ txCycles, rx }) : null;
    this.log = []; // every interrupt request: {source, rise, taken, ack}
    this.open = new Map(); // source -> the request being served
    this.journal = NO_JOURNAL;
    const events = {
      open: (source, rise) => {
        if (this.open.has(source)) return;
        const ev = { source, rise, taken: null, ack: null };
        this.open.set(source, ev);
        this.log.push(ev);
      },
      ack: (source, cycle) => {
        const ev = this.open.get(source);
        if (!ev) return;
        this.open.delete(source);
        ev.ack = cycle;
      },
    };
    for (const d of this.parts) d.events = events;
  }

  get parts() { return [this.gpio, this.timer, ...(this.uart ? [this.uart] : [])]; }

  /** [{base, device}] to register: the window first, then the devices inside it. */
  devices() {
    return [{ base: PERIPH_LO, device: this.window }, { base: GPIO_BASE, device: this.gpio }, { base: TIMER_BASE, device: this.timer },
      ...(this.uart ? [{ base: UART_BASE, device: this.uart }] : [])];
  }

  setJournal(j) {
    this.journal = j;
    for (const d of [this.window, ...this.parts]) d.journal = j;
  }

  /** Is `addr` in the platform's window (device registers take word accesses only)? */
  static claims(addr) { return addr >= PERIPH_LO && addr < PERIPH_LO + PERIPH_SIZE; }

  tick(cycle) { for (const d of this.parts) d.tick(cycle); }

  get now() { return this.timer.now; }

  mtip(cycle) { return this.timer.mtip(cycle); }

  /** mip.MEIP: the GPIO's enabled pending inputs and the UART's request. */
  meip() { return this.gpio.irq() || Boolean(this.uart?.irq()); }

  /** The next cycle at which an input changes, the timer matches or the UART acts. */
  nextEvent() {
    const c = this.parts.map((d) => d.nextEvent()).filter((v) => v !== null);
    return c.length ? Math.min(...c) : null;
  }

  markTaken(code, cycle) {
    this.journal.touch();
    const names = code === MTI ? ['timer'] : [...this.open.keys()].filter((s) => s !== 'timer');
    for (const s of names) {
      const ev = this.open.get(s);
      if (ev && ev.taken === null) ev.taken = cycle;
    }
  }

  /** Name of the register at `addr`, as rvsim.py's trace notes it ("GPIO.OUT"), or ''. */
  describe(addr) {
    for (const { base, device } of this.devices()) {
      if (device === this.window) continue;
      if (addr >= base && addr < base + device.size) return `${device.name}.${device.registers.find((r) => r.offset === addr - base)?.name ?? ''}`.replace(/\.$/, '');
    }
    return '';
  }

  snapshot() {
    return {
      parts: this.parts.map((d) => d.snapshot()),
      logLen: this.log.length,
      open: [...this.open].map(([source, ev]) => [source, ev, ev.taken, ev.ack]),
    };
  }

  restore(s) {
    this.parts.forEach((d, i) => d.restore(s.parts[i]));
    this.log.length = s.logLen;
    this.open = new Map(s.open.map(([source, ev, taken, ack]) => { ev.taken = taken; ev.ack = ack; return [source, ev]; }));
  }
}

/** Per source: events, how many were served, and latency ranges in cycles (rvpriv.latency_summary). */
export function latencySummary(log) {
  const out = {};
  for (const ev of log) {
    const s = out[ev.source] ??= { events: 0, taken: 0, acked: 0, to_handler: [], to_ack: [] };
    s.events++;
    if (ev.taken !== null) { s.taken++; s.to_handler.push(ev.taken - ev.rise); }
    if (ev.ack !== null) { s.acked++; s.to_ack.push(ev.ack - ev.rise); }
  }
  const range = (v) => (v.length ? { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length } : null);
  for (const s of Object.values(out)) { s.to_handler = range(s.to_handler); s.to_ack = range(s.to_ack); }
  return out;
}
