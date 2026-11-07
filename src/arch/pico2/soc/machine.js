// machine.js -- the Pico 2 machine of the pico2 module (P1-M2; research repository design pico2-p1m2-platform.md): one Hazard3
// hart (core 1 is parked and not modelled, decision Q7), the bus with the RP2350 address map, the peripheral models, the event
// scheduler and the high-level boot of SDK images (ADR-0008).
// Time: the hart's `ticks` is the clk_sys cycle count; since P1-M3 each step advances it by the Hazard3 cost model's cycles
// (core/timing.js; perfect bus). Devices compute their state from it when accessed and schedule their next visible event
// (ADR-0003 §3); the engine services the scheduler when `ticks` reaches `deadline`, before the next instruction, so an interrupt
// raised by an event is taken at the first instruction boundary at or after it; a div/rem in progress is cancelled by it
// (the hart calls serviceDue() at the deadline, D15-2). A timeline maps cycles to simulated nanoseconds across clk_sys changes.
// Inputs from the host (pin drives, UART bytes) are queued with the cycle at which they apply, so that a run can be replayed
// exactly from a checkpoint (save/load) for step back (decision Q2).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Hart } from '../core/hart.js';
import { Bus, SRAM_BASE, SRAM_SIZE, XIP_BASE } from './bus.js';
import { Storage, Unmodelled, Resets, SysInfo, Watchdog, BootRam } from './device.js';
import { Clocks, Xosc, Pll, Ticks, XOSC_HZ, ROSC_HZ } from './clocks.js';
import { Timer } from './timer.js';
import { Uart } from './uart.js';
import { Pins, IoBank0, PadsBank0 } from './gpio.js';
import { Sio } from './sio.js';
import { SVD_BLOCKS } from './regs.generated.js';
import { buildRom, romLookup, romCodeName } from '../boot/rom.js';

/** Host inputs applied at given cycles (a device of the scheduler). */
class Inputs {
  constructor(m) { this.m = m; this.q = []; this.next = Infinity; }
  add(cycle, kind, a, b) {
    let i = this.q.length; while (i > 0 && this.q[i - 1][0] > cycle) i--;
    this.q.splice(i, 0, [cycle, kind, a, b]);
    this.next = this.q[0][0]; this.m.schedule(this);
  }
  event(now) {
    while (this.q.length && this.q[0][0] <= now) {
      const [, kind, a, b] = this.q.shift();
      if (kind === 'pin') this.m.pins.drive(a, b);
      else if (kind === 'uart') this.m.uart[a].receive(b);
    }
    this.next = this.q.length ? this.q[0][0] : Infinity;
  }
  reset() { this.q = []; this.next = Infinity; }
  save() { return this.q.map((e) => e.slice()); }
  load(s) { this.q = s.map((e) => e.slice()); this.next = this.q.length ? this.q[0][0] : Infinity; }
}

export class Machine {
  /** @param {{flashSize?: number}} [opts] */
  constructor({ flashSize = 4 << 20 } = {}) {
    this.ready = false; this.touched = false; this.deadline = Infinity;
    this.diags = new Map();
    this.bus = new Bus(this, { flashSize });
    this.hart = new Hart(this.bus, { resetPc: 0 });
    this.hart.onUnblock = () => {}; // h3.unblock goes to core 1, which is not modelled
    this.hart.sched = this;         // deadline + serviceDue(): an interrupt due during a div cancels it
    this.rom = buildRom(); this.bus.rbytes.set(this.rom.bytes);
    this.freq = { ref: ROSC_HZ, sys: ROSC_HZ, peri: 0, usb: 0, adc: 0 };
    this.timeline = [[0, 0, ROSC_HZ]];
    this.coreBits = 0;

    this.resets = new Resets(this);
    this.clocks = new Clocks(this); this.xosc = new Xosc(this); this.ticks = new Ticks(this);
    this.pllSys = new Pll(this, 'PLL_SYS', 14); this.pllUsb = new Pll(this, 'PLL_USB', 15);
    this.timer = [new Timer(this, 0), new Timer(this, 1)];
    this.uart = [new Uart(this, 0), new Uart(this, 1)];
    this.pins = new Pins(this);
    this.io = new IoBank0(this); this.pads = new PadsBank0(this);
    this.sio = new Sio(this);
    this.inputs = new Inputs(this);
    const models = {
      RESETS: this.resets, CLOCKS: this.clocks, XOSC: this.xosc, TICKS: this.ticks, PLL_SYS: this.pllSys, PLL_USB: this.pllUsb,
      TIMER0: this.timer[0], TIMER1: this.timer[1], UART0: this.uart[0], UART1: this.uart[1], IO_BANK0: this.io, PADS_BANK0: this.pads,
      SYSINFO: new SysInfo(this), WATCHDOG: new Watchdog(this), BOOTRAM: new BootRam(this),
      ROSC: new Storage(this, 'ROSC'), SYSCFG: new Storage(this, 'SYSCFG', { resetBit: 20 }), PSM: new Storage(this, 'PSM'),
      IO_QSPI: new Storage(this, 'IO_QSPI', { resetBit: 7 }), PADS_QSPI: new Storage(this, 'PADS_QSPI', { resetBit: 10 }),
      ACCESSCTRL: new Storage(this, 'ACCESSCTRL'), BUSCTRL: new Storage(this, 'BUSCTRL', { resetBit: 1 }), POWMAN: new Storage(this, 'POWMAN'),
      XIP_CTRL: new Storage(this, 'XIP_CTRL'), QMI: new Storage(this, 'QMI'), USB: new Storage(this, 'USB'),
    };
    this.blocks = [];
    for (const [name, base] of SVD_BLOCKS) {
      const top = base >>> 28;
      if (name === 'SIO') { this.bus.sio = this.sio; this.blocks.push(this.sio); continue; }
      if (top !== 4 && top !== 5) continue;
      const dev = models[name] ?? new Unmodelled(this, name);
      if (top === 4) this.bus.mapApb(base, dev); else this.bus.mapAhb(base, dev);
      this.blocks.push(dev);
    }
    this.resettable = this.blocks.filter((d) => d.resetBit >= 0);
    this.events = [this.timer[0], this.timer[1], this.uart[0], this.uart[1], this.sio, this.inputs];
    this.image = null;   // chunks of a loaded SDK image or program, kept for reset
    this.powerOn();
  }

  // ---- reset and boot ----
  /** Chip reset: every block at its reset values, the hart at reset, time 0. */
  powerOn() {
    this.ready = false;
    this.hart.reset(); this.coreBits = 0;
    this.pins.reset();
    for (const d of this.blocks) d.reset();
    this.inputs.reset();
    this.bus.bytes.fill(0); this.bus.fbytes.fill(0xff);
    this.freq = { ref: ROSC_HZ, sys: ROSC_HZ, peri: 0, usb: 0, adc: 0 };
    this.timeline = [[0, 0, ROSC_HZ]];
    this.ready = true;
    this.pins.updateAll();
    this.pins.clearLog(); // the reset state is the start, not an event
    this.retime();
    this.recomputeDeadline();
  }

  /** Copy chunks [{address, bytes}] into flash or SRAM; returns null or the address of a chunk that does not fit. */
  loadChunks(chunks) {
    for (const c of chunks) {
      const a = c.address >>> 0, n = c.bytes.length;
      if (a >= SRAM_BASE && a + n <= SRAM_BASE + SRAM_SIZE) this.bus.bytes.set(c.bytes, a - SRAM_BASE);
      else if (a >= XIP_BASE && a + n <= XIP_BASE + this.bus.flashSize) this.bus.fbytes.set(c.bytes, a - XIP_BASE);
      else return a;
    }
    return null;
  }

  /**
   * High-level boot of an SDK image (ADR-0008, design §5.3): chip reset, image in flash/SRAM, pc and sp from the IMAGE_DEF
   * ENTRY_POINT. What the bootrom leaves for a flash boot is taken as the chip-reset state, except that the QSPI pads and IO are
   * out of reset (the flash is in use). Not verifiable from the oracle, whose bootrom state of the clock tree is not modelled
   * (research repository, experiments/p1m2-oracle README).
   */
  bootImage(image) {
    this.powerOn();
    const bad = this.loadChunks(image.chunks);
    if (bad !== null) return bad;
    const o = this.resets.r.off('RESET');
    this.resets.r.set(o, this.resets.r.get(o) & ~((1 << 7) | (1 << 10)));
    this.hart.pc = image.entry.pc | 0; this.hart.x[2] = image.entry.sp | 0;
    this.image = image;
    return null;
  }

  // ---- scheduler ----
  schedule(dev) { if (dev.next < this.deadline) this.deadline = dev.next; }
  recomputeDeadline() { let d = Infinity; for (const e of this.events) if (e.next < d) d = e.next; this.deadline = d; }
  /** Run the events that are due at the present cycle. */
  service() {
    const now = this.hart.ticks;
    this.touched = true;
    for (const e of this.events) if (e.next <= now) e.event(now);
    this.recomputeDeadline();
  }
  /** Service until nothing is due at the present cycle (an event may schedule another at the same cycle; at most 8 rounds). */
  serviceDue() { let g = 0; do this.service(); while (this.hart.ticks >= this.deadline && ++g < 8); }
  /** Queue a host input at `cycle`: ('pin', n, level 0/1/-1) or ('uart', index, bytes). */
  at(cycle, kind, a, b) { this.inputs.add(Math.max(cycle, this.hart.ticks), kind, a, b); }

  // ---- running ----
  /**
   * A call into one of the ROM's slots, serviced in place of the instruction there (boot/rom.js): returns null when done (a0 set,
   * pc = ra, one cycle), or {kind, slot, ra} when it cannot be (a function that is not modelled, or the bootrom entry).
   */
  romCall(pc, slot) {
    const h = this.hart;
    let result = null;
    this.touched = true;
    if (slot.kind === 'lookup') {
      const r = romLookup(this.rom, h.x[10], h.x[11]);
      if (r.data) this.diag('romData', romCodeName(h.x[10]));
      result = r.value;
    } else if (slot.kind === 'entry' || !slot.implemented) return { kind: slot.kind, slot, ra: h.x[1] >>> 0 };
    const hist = h.hist;
    if (hist) hist.begin(pc, h.tState(), h.btb);
    if (result !== null) h.wr(10, result | 0);
    h.pc = h.x[1] & ~1;
    // one cycle (the ROM's own timing is not modelled), then a return to ra: no load result pending, the frontend restarts
    h.adv(1);
    h.ldRd = 0; h.ldExcl = false; h.redirect = true;
    h.lastPre = 0; h.lastCost = 1; h.lastCause = 0; h.lastD = null; h.lastFast = 0;
    if (hist) hist.end(!(h.mcountinhibit & 1), false, 1, h.btb);
    return null;
  }

  /**
   * Run up to n steps with the scheduler, the ROM calls and the sleep skip, without the engine's bookkeeping (benchmarks, the
   * real-time runner). Stops early with a reason: 'sleep' (a sleep nothing can end), 'rom' (a ROM call that is not modelled),
   * 'trap' (a trap while mtvec is 0: the engine's halting rule). Returns the steps taken; the reason is in this.stop.
   */
  run(n) {
    const h = this.hart;
    this.stop = null;
    let i = 0;
    for (; i < n; i++) {
      if (h.ticks >= this.deadline) this.serviceDue();
      const pc = h.pc >>> 0;
      if (pc < 0x8000) { const slot = this.rom.slots.get(pc); if (slot) { const r = this.romCall(pc, slot); if (r) { this.stop = 'rom'; this.stopInfo = r; return i; } continue; } }
      if (h.sleeping && !(h.mip & h.mie)) {
        if (h.mie === 0 || this.deadline === Infinity) { this.stop = 'sleep'; return i; }
        const skip = this.deadline - h.ticks - 1;
        if (skip > 0) { h.ticks += skip; if (!(h.mcountinhibit & 1)) h.cycles += skip; }
      }
      h.step();
      if (h.trapped && (h.mtvec & ~3) === 0) { this.stop = 'trap'; return i + 1; }
    }
    return i;
  }

  // ---- interrupts ----
  irq(n, level) { this.hart.irqc.setLine(n, level); }
  coreIrq(bit, level) { this.coreBits = level ? this.coreBits | (1 << bit) : this.coreBits & ~(1 << bit); this.hart.setIrq(this.coreBits); }

  // ---- clocks and time ----
  /** Recompute the clock frequencies and re-time the tick consumers (after a write to CLOCKS, XOSC, PLL or TICKS). */
  retime() {
    if (!this.ready) return;
    const src = { xosc: this.xosc.enabled ? XOSC_HZ : 0, rosc: ROSC_HZ, pllSys: 0, pllUsb: 0 };
    src.pllSys = this.pllSys.frequency(src.xosc); src.pllUsb = this.pllUsb.frequency(src.xosc);
    const f = this.clocks.frequencies(src);
    const now = this.hart.ticks;
    if (!f.sys) { this.diag('clkSysStopped'); f.sys = this.freq.sys; }
    if (f.sys !== this.freq.sys) {
      const last = this.timeline[this.timeline.length - 1];
      if (last[0] === now) this.timeline[this.timeline.length - 1] = [now, last[1], f.sys];
      else this.timeline.push([now, this.nsAt(now), f.sys]);
    }
    this.freq = f;
    for (const t of this.timer) t.retime(now);
    this.sio.retime(now);
  }
  /** Simulated nanoseconds at cycle c. */
  nsAt(c) {
    const tl = this.timeline; let i = tl.length - 1;
    while (i > 0 && tl[i][0] > c) i--;
    return tl[i][1] + ((c - tl[i][0]) * 1e9) / tl[i][2];
  }
  resetsChanged(old, now) {
    const released = old & ~now;
    for (const d of this.resettable) if ((released >>> d.resetBit) & 1) d.retime?.(this.hart.ticks);
    this.retime();
  }

  // ---- reports ----
  /** Record a diagnostic once per kind and arguments (the engine turns them into messages). */
  diag(kind, ...args) {
    const key = args.length ? `${kind}:${args.join(',')}` : kind;
    const d = this.diags.get(key);
    if (d) d.count++; else this.diags.set(key, { kind, args, cycle: this.hart.ticks, count: 1 });
  }

  // ---- checkpoints ----
  save() {
    const h = this.hart;
    return {
      ram: this.bus.bytes.slice(), x: h.x.slice(), pc: h.pc, sys: h.saveSys(), ticks: h.ticks, lines: h.irqc.irq.slice(), coreBits: this.coreBits,
      blocks: this.blocks.map((d) => d.save()), pins: this.pins.save(), inputs: this.inputs.save(), freq: { ...this.freq },
      timeline: this.timeline.map((e) => e.slice()), deadline: this.deadline,
    };
  }
  load(s) {
    const h = this.hart;
    this.bus.bytes.set(s.ram); h.x.set(s.x); h.pc = s.pc; h.restoreSys(s.sys); h.ticks = s.ticks; h.trapped = false;
    h.irqc.irq.set(s.lines); h.irqc.dirty = true; this.coreBits = s.coreBits; h.setIrq(s.coreBits);
    this.blocks.forEach((d, i) => d.load(s.blocks[i]));
    this.pins.load(s.pins); this.inputs.load(s.inputs); this.freq = { ...s.freq };
    this.timeline = s.timeline.map((e) => e.slice()); this.deadline = s.deadline;
    h.flushCache();
  }
}

