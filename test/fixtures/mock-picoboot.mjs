// mock-picoboot.mjs -- a mock WebUSB device for an RP2350 in BOOTSEL (pico2 P1-F3; research testing/usb-flashing-test-plan.md §1):
// the USBDevice methods the vendored picoflash command layer and MAVILERA's transport call, and the PICOBOOT protocol of RP-001
// §5.6 as they use it: 32-byte commands (magic 0x431fd10b), a data phase in the command's direction, an acknowledgement in the
// other; INTERFACE_RESET (0x41) and GET_COMMAND_STATUS (0x42) on endpoint 0; EXCLUSIVE_ACCESS, FLASH_ERASE, WRITE, READ (flash,
// SRAM, the ROM's 'M','u',2,version at 0x10), EXIT_XIP, REBOOT2 and GET_INFO (SYS chip info; UF2_TARGET_PARTITION); any other id
// stalls the endpoints with status UNKNOWN_CMD. Plus MockUsb (navigator.usb: chooser, granted devices, connect/disconnect events).
// Own code; runs in Node (tests) and in a page (tools/pico2-hardware-smoke.mjs). Mocks prove sequencing and error handling only,
// never that a real Pico 2 is written.
//
// Faults (constructor option `faults`, or device.faults later):
//   unplugAt: {cmd: 'write'|'erase'|'read', n}  the device disappears at the n-th such command (1-based)
//   corruptRead: address                        a READ covering it returns that byte inverted (a verify failure)
//   hangAt: {cmd, n}                            that command's acknowledgement never comes (a timeout; released by close())
//   claimFails: 'busy' | 'access'               claimInterface rejects (another program holds it / Windows gave no access)
//   openFails: 'access'                         open() rejects with SecurityError
//   partition: number                           GET_INFO UF2_TARGET_PARTITION's answer (default 0xff, absolute)
//   romVersion: number                          the ROM version byte (default 4)
//   noChipInfo: true                            GET_INFO SYS stalls (as a chip that is not an RP2350)
//   statusNotPermitted: 'erase' | 'write'       that command fails with status NOT_PERMITTED (10) and a stall
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const MAGIC = 0x431fd10b;
const FLASH = 0x10000000, FLASH_SIZE = 4 << 20, SRAM = [0x20000000, 0x20082000];
const ID = { EXCLUSIVE: 0x01, ERASE: 0x03, WRITE: 0x05, EXIT_XIP: 0x06, ENTER_XIP: 0x07, REBOOT2: 0x0a, READ: 0x84, GET_INFO: 0x8b };
const NAME = { [ID.ERASE]: 'erase', [ID.WRITE]: 'write', [ID.READ]: 'read', [ID.REBOOT2]: 'reboot2', [ID.EXCLUSIVE]: 'exclusive', [ID.GET_INFO]: 'getinfo', [ID.EXIT_XIP]: 'exitxip' };
const ST = { OK: 0, UNKNOWN_CMD: 1, INVALID_ADDRESS: 4, BAD_ALIGNMENT: 5, NOT_PERMITTED: 10 };
const domError = (name, message) => { const e = new Error(message); e.name = name; return e; };
const dv = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

export class MockPicobootDevice {
  constructor({ serialNumber = 'E0C9125B0D9B2F34', productId = 0x000f, chipId = [0x0d9b2f34, 0xe0c9125b], faults = {}, msd = true } = {}) {
    this.vendorId = 0x2e8a;
    this.productId = productId;
    this.serialNumber = serialNumber;
    this.productName = 'RP2350 Boot';
    this.manufacturerName = 'Raspberry Pi';
    this.faults = { ...faults };
    this.chipId = chipId;
    this.opened = false;
    this.gone = false;
    this.claimed = new Set();
    // BOOTSEL: interface 0 mass storage (when enabled), then PICOBOOT (vendor 0xff/0/0, bulk OUT 3, bulk IN 4) (RP-001 §5.6.2)
    const pb = { interfaceNumber: msd ? 1 : 0, alternates: [{ alternateSetting: 0, interfaceClass: 0xff, interfaceSubclass: 0, interfaceProtocol: 0,
      endpoints: [{ endpointNumber: 3, direction: 'out', type: 'bulk', packetSize: 64 }, { endpointNumber: 4, direction: 'in', type: 'bulk', packetSize: 64 }] }] };
    const ms = { interfaceNumber: 0, alternates: [{ alternateSetting: 0, interfaceClass: 0x08, interfaceSubclass: 0x06, interfaceProtocol: 0x50,
      endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk', packetSize: 64 }, { endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 }] }] };
    this.configurations = [{ configurationValue: 1, interfaces: msd ? [ms, pb] : [pb] }];
    this.configuration = null;
    this.flash = new Map();     // sector address -> Uint8Array(4096); absent = erased (0xff)
    this.ram = new Map();       // address -> byte
    this.log = [];              // every command: {id, name, addr, size, token}
    this.counts = {};
    this.exclusive = 0;
    this.reboots = [];
    this.halted = false;
    this.status = { token: 0, code: ST.OK, cmdId: 0 };
    this.phase = 'idle';        // idle | out (data expected) | in (data to send) | ackIn | ackOut
    this.pending = new Set();   // promises that never settle until close()
    this.onGone = null;         // set by MockUsb
  }

  // ---- USBDevice ----
  async open() {
    this.#alive();
    if (this.faults.openFails === 'access') throw domError('SecurityError', 'Access denied.');
    this.opened = true;
  }
  async close() {
    this.opened = false;
    this.claimed.clear();
    for (const p of this.pending) p.reject(domError('AbortError', 'The transfer was cancelled.'));
    this.pending.clear();
  }
  async selectConfiguration(v) { this.#open(); this.configuration = this.configurations.find((c) => c.configurationValue === v); }
  async claimInterface(n) {
    this.#open();
    if (this.faults.claimFails === 'busy') throw domError('NetworkError', 'Unable to claim interface.');
    if (this.faults.claimFails === 'access') throw domError('SecurityError', 'Access denied.');
    this.claimed.add(n);
  }
  async releaseInterface(n) { this.#open(); this.claimed.delete(n); }
  async clearHalt() { this.#open(); this.halted = false; }
  async reset() { this.#open(); }
  async controlTransferOut(setup) {
    this.#claimed();
    if (setup.request === 0x41) { // INTERFACE_RESET: halts, the protocol state and exclusive access cleared
      this.halted = false; this.phase = 'idle'; this.exclusive = 0; this.status = { token: 0, code: ST.OK, cmdId: 0 };
      return { status: 'ok', bytesWritten: 0 };
    }
    return { status: 'stall', bytesWritten: 0 };
  }
  async controlTransferIn(setup, length) {
    this.#claimed();
    if (setup.request === 0x42) {
      const b = new Uint8Array(16), d = dv(b);
      d.setUint32(0, this.status.token, true); d.setUint32(4, this.status.code, true); b[8] = this.status.cmdId; b[9] = 0;
      return { status: 'ok', data: dv(b.slice(0, length)) };
    }
    if (setup.request === 0x00) return { status: 'ok', data: dv(new Uint8Array([this.halted ? 1 : 0, 0])) }; // GET_STATUS
    return { status: 'stall' };
  }
  async transferOut(ep, data) {
    this.#claimed();
    const u8 = new Uint8Array(data.buffer ? data.buffer.slice(data.byteOffset ?? 0, (data.byteOffset ?? 0) + data.byteLength) : data);
    if (this.halted) return { status: 'stall', bytesWritten: 0 };
    if (this.phase === 'idle') return this.#command(u8);
    if (this.phase === 'out') return this.#dataOut(u8);
    if (this.phase === 'ackOut') { this.phase = 'idle'; return this.#settle({ status: 'ok', bytesWritten: u8.length }); }
    return { status: 'stall', bytesWritten: 0 };
  }
  async transferIn(ep, length) {
    this.#claimed();
    if (this.halted) return { status: 'stall' };
    if (this.phase === 'in') { const d = this.inData; this.inData = null; this.phase = 'ackOut'; return { status: 'ok', data: dv(d) }; }
    if (this.phase === 'ackIn') { this.phase = 'idle'; return this.#settle({ status: 'ok', data: dv(new Uint8Array(0)) }); }
    return { status: 'stall' };
  }

  // ---- PICOBOOT ----
  #command(b) {
    if (b.length !== 32 || dv(b).getUint32(0, true) !== MAGIC) return this.#stall(0, ST.UNKNOWN_CMD);
    const d = dv(b), token = d.getUint32(4, true), id = b[8], len = d.getUint32(12, true), args = b.subarray(16, 32), a = dv(args);
    const entry = { id, name: NAME[id] ?? `0x${id.toString(16)}`, token, addr: a.getUint32(0, true), size: a.getUint32(4, true), args: [...args] };
    this.log.push(entry);
    this.cur = entry;
    this.status = { token, code: ST.OK, cmdId: id };
    const n = (this.counts[entry.name] = (this.counts[entry.name] ?? 0) + 1);
    if (this.faults.unplugAt && this.faults.unplugAt.cmd === entry.name && this.faults.unplugAt.n === n) { this.unplug(); throw domError('NetworkError', 'The device was disconnected.'); }
    this.hang = Boolean(this.faults.hangAt && this.faults.hangAt.cmd === entry.name && this.faults.hangAt.n === n);
    if (this.faults.statusNotPermitted === entry.name) return this.#stall(id, ST.NOT_PERMITTED);
    switch (id) {
      case ID.EXCLUSIVE: this.exclusive = args[0]; return this.#ack(b.length, 'in');
      case ID.EXIT_XIP: case ID.ENTER_XIP: return this.#ack(b.length, 'in');
      case ID.ERASE: {
        if (entry.addr % 4096 || entry.size % 4096) return this.#stall(id, ST.BAD_ALIGNMENT);
        if (entry.addr < FLASH || entry.addr + entry.size > FLASH + FLASH_SIZE) return this.#stall(id, ST.INVALID_ADDRESS);
        for (let s = entry.addr; s < entry.addr + entry.size; s += 4096) this.flash.delete(s);
        return this.#ack(b.length, 'in');
      }
      case ID.WRITE: {
        const inFlash = entry.addr >= FLASH && entry.addr + entry.size <= FLASH + FLASH_SIZE, inRam = entry.addr >= SRAM[0] && entry.addr + entry.size <= SRAM[1];
        if (!inFlash && !inRam) return this.#stall(id, ST.INVALID_ADDRESS);
        if (inFlash && entry.addr % 256) return this.#stall(id, ST.BAD_ALIGNMENT);
        this.phase = 'out'; this.outLeft = len; this.outAt = entry.addr; this.outFlash = inFlash;
        return { status: 'ok', bytesWritten: b.length };
      }
      case ID.READ: {
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i++) out[i] = this.peek(entry.addr + i);
        if (this.faults.corruptRead !== undefined && this.faults.corruptRead >= entry.addr && this.faults.corruptRead < entry.addr + len) out[this.faults.corruptRead - entry.addr] ^= 0xff;
        this.inData = out; this.phase = 'in';
        return { status: 'ok', bytesWritten: b.length };
      }
      case ID.GET_INFO: {
        const type = args[0], out = new Uint8Array(len), o = dv(out);
        if (type === 1) { // SYS, chip info: count, flags, package_sel, device id low, high (picoflash readChipInfo reads the last three)
          if (this.faults.noChipInfo) return this.#stall(id, ST.UNKNOWN_CMD);
          [4, 1, 0, this.chipId[0], this.chipId[1]].forEach((w, i) => o.setUint32(4 * i, w >>> 0, true));
        } else if (type === 3) { // UF2_TARGET_PARTITION (picotool: word 0 = 3, word 1 = the partition)
          [3, (this.faults.partition ?? 0xff) >>> 0, 0, 0].forEach((w, i) => o.setUint32(4 * i, w, true));
        } else return this.#stall(id, ST.UNKNOWN_CMD);
        this.inData = out; this.phase = 'in';
        return { status: 'ok', bytesWritten: b.length };
      }
      case ID.REBOOT2: {
        this.reboots.push({ flags: a.getUint32(0, true), delay: a.getUint32(4, true), p0: a.getUint32(8, true), p1: a.getUint32(12, true) });
        this.rebootAfterAck = true;
        return this.#ack(b.length, 'in');
      }
      default: return this.#stall(id, ST.UNKNOWN_CMD);
    }
  }
  #dataOut(u8) {
    for (let i = 0; i < u8.length; i++) this.poke(this.outAt + i, u8[i]);
    this.outAt += u8.length; this.outLeft -= u8.length;
    if (this.outLeft <= 0) this.phase = 'ackIn';
    return { status: 'ok', bytesWritten: u8.length };
  }
  #ack(n, dir) { this.phase = dir === 'in' ? 'ackIn' : 'ackOut'; return { status: 'ok', bytesWritten: n }; }
  #stall(id, code) { this.halted = true; this.phase = 'idle'; this.status = { ...this.status, code, cmdId: id }; return { status: 'stall', bytesWritten: 0 }; }
  /** The acknowledgement of the current command: never settles when it is to hang; a REBOOT2 then leaves the bus. */
  #settle(r) {
    if (this.hang) { this.hang = false; return new Promise((resolve, reject) => this.pending.add({ resolve, reject })); }
    if (this.rebootAfterAck) { this.rebootAfterAck = false; setTimeout(() => this.unplug(), 0); }
    return r;
  }

  /** A byte as the bootrom would read it: ROM header, flash (erased: 0xff), SRAM (unset: 0). */
  peek(a) {
    if (a >= 0x10 && a < 0x14) return [0x4d, 0x75, 0x02, this.faults.romVersion ?? 4][a - 0x10];
    if (a >= FLASH && a < FLASH + FLASH_SIZE) { const s = this.flash.get(a - (a % 4096)); return s ? s[a % 4096] : 0xff; }
    return this.ram.get(a) ?? 0;
  }
  poke(a, v) {
    if (a >= FLASH && a < FLASH + FLASH_SIZE) {
      const sa = a - (a % 4096);
      if (!this.flash.has(sa)) this.flash.set(sa, new Uint8Array(4096).fill(0xff));
      const s = this.flash.get(sa);
      s[a % 4096] &= v; // programming only clears bits, as NOR flash
    } else this.ram.set(a, v);
  }
  /** Bytes of the flash (or SRAM) from `a`. */
  bytes(a, n) { return Uint8Array.from({ length: n }, (_, i) => this.peek(a + i)); }
  /** The commands received, by name: e.g. ['getinfo', 'read', 'getinfo', 'exclusive', 'erase', ...]. */
  names() { return this.log.map((e) => e.name); }

  /** The device leaves the bus (unplugged, or rebooted). */
  unplug() {
    if (this.gone) return;
    this.gone = true; this.opened = false; this.claimed.clear();
    for (const p of this.pending) p.reject(domError('NetworkError', 'The device was disconnected.'));
    this.pending.clear();
    this.onGone?.(this);
  }
  #alive() { if (this.gone) throw domError('NotFoundError', 'The device was disconnected.'); }
  #open() { this.#alive(); if (!this.opened) throw domError('InvalidStateError', 'The device must be opened first.'); }
  #claimed() { this.#open(); if (this.gone) throw domError('NetworkError', 'The device was disconnected.'); }
}

/**
 * navigator.usb for tests: `devices` present on the bus; `granted` ones getDevices() returns; the chooser (requestDevice) picks
 * by `choose(list)` (default: the first matching device; return null to cancel, as closing the chooser). Fires 'connect' and
 * 'disconnect' events with {device}.
 */
export class MockUsb extends EventTarget {
  constructor({ choose = (list) => list[0] ?? null } = {}) {
    super();
    this.devices = [];
    this.granted = new Set();
    this.choose = choose;
    this.requests = [];
  }
  plug(device, { granted = false } = {}) {
    device.gone = false;
    device.onGone = (d) => { this.devices = this.devices.filter((x) => x !== d); this.#fire('disconnect', d); };
    this.devices.push(device);
    if (granted) this.granted.add(device);
    this.#fire('connect', device);
    return device;
  }
  async getDevices() { return this.devices.filter((d) => this.granted.has(d)); }
  async requestDevice({ filters = [] } = {}) {
    this.requests.push(filters);
    const list = this.devices.filter((d) => filters.some((f) => (f.vendorId === undefined || f.vendorId === d.vendorId) && (f.productId === undefined || f.productId === d.productId)));
    const d = await this.choose(list);
    if (!d) throw domError('NotFoundError', 'No device selected.');
    this.granted.add(d);
    return d;
  }
  #fire(type, device) {
    const ev = typeof Event === 'function' ? new Event(type) : { type };
    ev.device = device;
    this.dispatchEvent(ev);
  }
}
