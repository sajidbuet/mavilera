// device.js -- the base class of memory-mapped devices (docs/architecture/memory-hierarchy.md §4).
// peek() has no side effects and serves the combinational evaluation, the memory viewer and the
// debugger; read() and write() may have side effects and are called exactly once, when the
// request commits at the clock edge. A device adds no code to the cache, the controller or the
// processor models: it is registered as a region of the address map.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

export class Device {
  /**
   * @param {{name: string, size?: number, registers?: Array<{offset: number, name: string, width: number,
   *   access: 'rw'|'ro'|'wo'|'w1c'}>, latency?: {read?: number, write?: number}, widths?: number[]}} o
   */
  constructor({ name, size = 0x1000, registers = [], latency = {}, widths = [4] }) {
    this.name = name;
    this.size = size;
    this.registers = registers;
    this.latency = { read: latency.read ?? 1, write: latency.write ?? 1 }; // CPU cycles of one access
    this.widths = widths;
    this.listeners = new Set();
    this.journal = null; // {touch()}: called before every change of state, so that the machine can save it (back-step)
    this.window = false; // a region that other devices may be placed inside (the platform's peripheral window)
  }

  touch() { this.journal?.touch(); }

  reset() {}

  /** Value without side effects, or null when the register has no readable value. */
  peek(offset, size) { return null; } // eslint-disable-line no-unused-vars

  /** Value of a read at the clock edge; side effects allowed. ctx = {cycle, source: 'I'|'D'}. */
  read(offset, size, ctx) { return this.peek(offset, size) ?? 0; } // eslint-disable-line no-unused-vars

  write(offset, size, value, ctx) {} // eslint-disable-line no-unused-vars

  /** One CPU cycle of device time. */
  tick(cycle) {} // eslint-disable-line no-unused-vars

  /** Level of the interrupt output; reserved for traps. */
  irq() { return false; }

  snapshot() { return null; }

  restore(state) {} // eslint-disable-line no-unused-vars

  /** Subscribe to state changes (for a later UI); returns the unsubscribe function. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }
}
