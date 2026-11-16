// mock-serial.mjs -- a mock Web Serial API for the "Serial (board)" monitor (pico2 P1-F3 stage F3-3; research
// testing/usb-flashing-test-plan.md §1: "mock Web Serial port"): navigator.serial (requestPort with filters, getPorts, connect and
// disconnect events) and SerialPort (getInfo, open, close, readable, writable, setSignals, forget). A port can be fed bytes,
// records what is written and the signals set, can be unplugged and plugged back (as a Pico's USB port re-enumerates after a
// load), and can refuse to open as a port another program holds. Own code; Node and pages (tools/pico2-hardware-smoke.mjs).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const domError = (name, message) => { const e = new Error(message); e.name = name; return e; };

export class MockSerialPort extends EventTarget {
  constructor({ usbVendorId = 0x2e8a, usbProductId = 0x0009, busy = false } = {}) {
    super();
    this.info = { usbVendorId, usbProductId };
    this.busy = busy;
    this.opened = null;      // the options of the open call
    this.readable = null; this.writable = null;
    this.written = [];       // Uint8Arrays written
    this.signals = [];       // setSignals calls
    this.present = true;
    this.forgotten = false;
    this.owner = null;       // MockSerial
  }
  getInfo() { return { ...this.info }; }
  async open(o) {
    if (!this.present) throw domError('NetworkError', 'Failed to open serial port.');
    if (this.busy) throw domError('NetworkError', 'Failed to open serial port.');
    if (this.opened) throw domError('InvalidStateError', 'The port is already open.');
    if (!o || typeof o.baudRate !== 'number') throw new TypeError('baudRate required');
    this.opened = { ...o };
    this.#streams();
  }
  #streams() {
    this.readable = new ReadableStream({ start: (c) => { this.ctl = c; } });
    this.writable = new WritableStream({ write: (chunk) => { this.written.push(new Uint8Array(chunk)); } });
  }
  async setSignals(s) { if (!this.opened) throw domError('InvalidStateError', 'The port is closed.'); this.signals.push({ ...s }); }
  async close() {
    if (!this.opened) throw domError('InvalidStateError', 'The port is already closed.');
    try { this.ctl?.close(); } catch { /* closed */ }
    this.opened = null; this.readable = null; this.writable = null;
  }
  async forget() { this.forgotten = true; this.owner?.granted.delete(this); }
  /** Bytes (or a string, UTF-8) arriving from the board. */
  feed(data) { this.ctl?.enqueue(typeof data === 'string' ? new TextEncoder().encode(data) : data); }
  /** All text written by the page so far. */
  sent() { return new TextDecoder().decode(Uint8Array.from(this.written.flatMap((b) => [...b]))); }
  /** The device leaves (unplugged, or rebooting): the stream errors, the port closes, 'disconnect' fires. */
  unplug() {
    this.present = false;
    try { this.ctl?.error(domError('NetworkError', 'The device has been lost.')); } catch { /* closed */ }
    this.opened = null; this.readable = null; this.writable = null;
    this.owner?.fire('disconnect', this);
  }
  /** The device comes back (same port object, as Chrome keeps a granted port's identity across re-enumeration). */
  replug() { this.present = true; this.owner?.fire('connect', this); }
}

export class MockSerial extends EventTarget {
  constructor({ choose = (list) => list[0] ?? null } = {}) {
    super();
    this.ports = []; this.granted = new Set(); this.choose = choose; this.requests = [];
  }
  add(port, { granted = false } = {}) { port.owner = this; this.ports.push(port); if (granted) this.granted.add(port); return port; }
  async getPorts() { return [...this.granted].filter((p) => !p.forgotten); }
  async requestPort(o = {}) {
    this.requests.push(o);
    const f = o.filters ?? [];
    const list = this.ports.filter((p) => p.present && (!f.length || f.some((x) => (x.usbVendorId === undefined || x.usbVendorId === p.info.usbVendorId) && (x.usbProductId === undefined || x.usbProductId === p.info.usbProductId))));
    const p = await this.choose(list);
    if (!p) throw domError('NotFoundError', 'No port selected by the user.');
    this.granted.add(p);
    return p;
  }
  fire(type, port) { const e = typeof Event === 'function' ? new Event(type) : { type }; Object.defineProperty(e, 'port', { value: port }); this.dispatchEvent(e); }
}
