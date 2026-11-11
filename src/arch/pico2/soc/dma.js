// dma.js -- the DMA of the RP2350 (RP-001 §12.6; P1-M5, research decision D39 Q1-Q2): 16 channels with READ_ADDR, WRITE_ADDR,
// TRANS_COUNT and CTRL in four aliases whose last word is a trigger (Table 1253); TRANS_COUNT's reload value and MODE (normal,
// TRIGGER_SELF, ENDLESS, §12.6.2.2); increments, decrements and the "by two" step, rings on the read or write address, BSWAP;
// triggers by register, CHAIN_TO and MULTI_CHAN_TRIGGER, null triggers with IRQ_QUIET (§12.6.3); pacing by DREQ (PWM wraps
// 32-43 and UART0/1 TX/RX 28-31 are wired; other DREQs belong to blocks that are not modelled), by the four X/Y pacing timers
// (59-62) or unpaced (63) (§12.6.4, §12.6.8.1); the credit counter of each channel (6 bits, saturating, §12.6.4.2); INTR,
// INTE/INTF/INTS 0-3 on IRQ 10-13 (§12.6.5); bus errors halt the channel and raise its interrupt (§12.6.7); CHAN_ABORT with the
// first behaviour of erratum RP2350-E5 and the zero-length CHAIN_TO of RP2350-E8 (App. D.4); the sniffer (CRC-32, CRC-16-CCITT,
// both with reversed data, even parity, sum; OUT_INV, OUT_REV, BSWAP; §12.6.8.2). The security and MPU registers are stored and
// not enforced (the machine's programs run in M-mode, which is Secure-privileged).
// Timing (decision Q1): one transfer per clk_sys cycle at most, read and write in the same cycle, channels in rounds of the
// HIGH_PRIORITY ones and then one other, round robin; a triggered channel transfers from the next cycle, a chained one from the
// cycle after its predecessor's last write (RP2350-E8's description). Each transfer is an event of the machine at its cycle,
// through the bus, so devices see it (UART TX FIFO, PWM CC). Not stated, chosen (in the module's limitations): the credit counter
// starts at zero when the channel is triggered; a DREQ pulse allows a transfer from the next cycle; a timer's X > Y gives one
// request per cycle; TRANS_COUNT reads the live count with the reload value's MODE; a zero-length TRIGGER_SELF sequence is not
// restarted. Bus contention between the DMA and the core is not modelled (the core's bus is perfect, P1-M3).
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

import { Device } from './device.js';
import { RateCounter } from './counter.js';

export const NUM_CHANNELS = 16;
const IRQ_DMA0 = 10;
const C_EN = 0x1, C_HIGH = 0x2, C_IRQ_QUIET = 1 << 23, C_BSWAP = 1 << 24, C_SNIFF = 1 << 25, C_BUSY = 1 << 26;
const C_WERR = 1 << 29, C_RERR = 1 << 30, C_RW = 0x03ffffff;
const MODE_SELF = 1, MODE_ENDLESS = 0xf;
// per word of a channel's 0x40 bytes: which register (0 READ_ADDR, 1 WRITE_ADDR, 2 TRANS_COUNT, 3 CTRL); every fourth word triggers
const ALIAS = [0, 1, 2, 3, 3, 0, 1, 2, 3, 2, 0, 1, 3, 1, 2, 0];
const O_INTR = 0x400, O_TIMER0 = 0x440, O_MULTI = 0x450, O_SNIFF_CTRL = 0x454, O_SNIFF_DATA = 0x458, O_FIFO = 0x460, O_ABORT = 0x464, O_NCH = 0x468, O_DBG = 0x800;
const inte = (k) => 0x404 + 0x10 * k, intf = (k) => 0x408 + 0x10 * k, ints = (k) => 0x40c + 0x10 * k;

class Channel {
  constructor(i) { this.i = i; this.clear(); }
  clear() {
    this.read = 0; this.write = 0; this.count = 0; this.reload = 0; this.ctrl = 0; // ctrl: RW fields and the two error flags
    this.busy = false; this.mode = 0; this.startAt = 0; this.zero = false;
    this.credit = 0; this.tUsed = 0;
  }
  get treq() { return (this.ctrl >>> 17) & 0x3f; }
  save() { return [this.read, this.write, this.count, this.reload, this.ctrl, this.busy ? 1 : 0, this.mode, this.startAt, this.zero ? 1 : 0, this.credit, this.tUsed]; }
  load(s) { let b, z; [this.read, this.write, this.count, this.reload, this.ctrl, b, this.mode, this.startAt, z, this.credit, this.tUsed] = s; this.busy = b === 1; this.zero = z === 1; }
}

const bswap = (v, size) => (size === 4 ? (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) >>> 0
  : size === 2 ? ((v & 0xff) << 8) | ((v >>> 8) & 0xff) : v);
const rev = (v, bits) => { let r = 0; for (let i = 0; i < bits; i++) r = (r << 1) | ((v >>> i) & 1); return r >>> 0; };

export class Dma extends Device {
  constructor(m) {
    super(m, 'DMA', { resetBit: 2 });
    this.ch = Array.from({ length: NUM_CHANNELS }, (_, i) => new Channel(i));
    this.timers = [new RateCounter(), new RateCounter(), new RateCounter(), new RateCounter()];
    this.reset();
  }
  reset() {
    if (this.lines && this.m.ready) for (let k = 0; k < 4; k++) if ((this.lines >>> k) & 1) this.m.irq(IRQ_DMA0 + k, 0);
    super.reset();
    for (const c of this.ch) c.clear();
    for (const t of this.timers) t.setRate(0, 0, 1);
    this.lines = 0; this.sniffAcc = 0; this.lastWriter = -1; this.hiPtr = NUM_CHANNELS - 1; this.loPtr = NUM_CHANNELS - 1; this.served = 0; this.lastIssue = -1;
    this.listen = [0, 0]; // DREQ numbers some busy, enabled channel waits on (bits 0-31, 32-63)
    this.transfers = 0;
    if (this.m.ready) this.relisten();
  }

  // ---- triggering and completion ----
  /** Start channel ch from cycle `at` (a trigger write, a chain, MULTI_CHAN_TRIGGER, TRIGGER_SELF). */
  trigger(ch, at) {
    if (!(ch.ctrl & C_EN) || ch.busy || (ch.ctrl & (C_RERR | C_WERR))) return;
    ch.busy = true; ch.mode = ch.reload >>> 28; ch.count = ch.reload & 0x0fffffff; ch.startAt = at;
    ch.zero = ch.count === 0; // completes on the next cycle without a bus access (RP2350-E8)
    ch.credit = 0; const t = ch.treq; if (t >= 59 && t <= 62) ch.tUsed = this.timers[t - 59].value(at);
    this.relisten();
  }
  complete(ch, c) {
    ch.busy = false;
    if (!(ch.ctrl & C_IRQ_QUIET)) this.raise(ch.i);
    const to = (ch.ctrl >>> 13) & 0xf;
    const wrote = !ch.zero || this.lastWriter === ch.i; // RP2350-E8: a zero-length sequence chains only if it wrote last
    if (ch.mode === MODE_SELF && !ch.zero) this.trigger(ch, c + 1);
    if (to !== ch.i && wrote) this.trigger(this.ch[to], c + 1);
    ch.zero = false;
    this.relisten();
  }
  raise(i) { this.r.set(O_INTR, this.r.get(O_INTR) | (1 << i)); this.updateIrq(); }
  abort(ch, c) {
    if (!ch.busy) return;
    ch.busy = false; ch.count = 0; ch.zero = false;
    // RP2350-E5 (first behaviour): the aborted channel's CHAIN_TO fires if it completed the last write
    const to = (ch.ctrl >>> 13) & 0xf;
    if (this.lastWriter === ch.i && to !== ch.i) this.trigger(this.ch[to], c + 1);
    this.relisten();
  }

  // ---- pacing ----
  /** The first cycle >= c at which channel ch may transfer, or Infinity. */
  readyAt(ch, c) {
    if (!ch.busy || !(ch.ctrl & C_EN) || (ch.ctrl & (C_RERR | C_WERR))) return Infinity;
    if (c < ch.startAt) c = ch.startAt;
    if (ch.zero) return c;
    const t = ch.treq;
    if (t === 63) return c;
    if (t >= 59) {
      const tm = this.timers[t - 59];
      if (t > 62) return Infinity;
      if (tm.value(c) - ch.tUsed > 63) ch.tUsed = tm.value(c) - 63; // the credit counter saturates
      return tm.cycleFor(c, ch.tUsed + 1);
    }
    if (t >= 32 && t <= 43) return ch.credit > 0 ? c : Infinity;
    if (t >= 28 && t <= 31) return this.m.uart[(t - 28) >>> 1].dreq(t & 1) ? c : Infinity;
    // P1-M7: SPI0/1 TX, RX (24-27), I2C0/1 TX, RX (44-47), ADC (48); P1-M8: PIO0-2 TX0-3, RX0-3 (0-23) (pico-sdk dreq.h)
    if (t >= 24 && t <= 27) return this.m.spi[(t - 24) >>> 1].dreq(t & 1) ? c : Infinity;
    if (t >= 44 && t <= 47) return this.m.i2c[(t - 44) >>> 1].dreq(t & 1) ? c : Infinity;
    if (t === 48) return this.m.adc.dreq() ? c : Infinity;
    if (t < 24 && this.m.pio) return this.m.pio.dev[t >>> 3].dreq(t & 7) ? c : Infinity;
    this.m.diag('dmaDreq', t);
    return Infinity;
  }
  /** One cycle's pulse(s) of DREQ n (PWM wraps): the channels waiting on it gain credit. */
  dreq(n, k = 1) {
    let woke = false;
    for (const ch of this.ch) {
      if (!ch.busy || ch.treq !== n) continue;
      ch.credit = Math.min(63, ch.credit + k); woke = true;
    }
    if (woke) this.plan(this.now + 1);
  }
  /** Is a busy, enabled channel paced by DREQ n? (the PWM schedules its wraps for it) */
  listening(n) { return ((this.listen[n >>> 5] >>> (n & 31)) & 1) === 1; }
  relisten() {
    const l = [0, 0];
    for (const ch of this.ch) if (ch.busy && (ch.ctrl & C_EN)) { const t = ch.treq; l[t >>> 5] |= 1 << (t & 31); }
    const pwmOld = ((this.listen[1] >>> 0) & 0xfff), pwmNew = l[1] & 0xfff;
    this.listen = l;
    let d = pwmOld ^ pwmNew;
    while (d) { const i = 31 - Math.clz32(d & -d); d &= d - 1; this.m.pwm?.wake(i); }
  }
  /** A UART's FIFOs or DMA enables changed (uart.js): channels paced by it may go on. */
  uartChanged() { if ((this.listen[0] >>> 28) & 0xf) this.plan(this.now + 1); }
  /** P1-M7: a level DREQ n (SPI, I2C, ADC, PIO) may have changed: channels paced by it may go on. */
  levelChanged(n) { if (this.listening(n)) this.plan(this.now + 1); }

  // ---- the transfers ----
  plan(from = this.now + 1) {
    if (from <= this.lastIssue) from = this.lastIssue + 1;
    let n = Infinity;
    for (const ch of this.ch) if (ch.busy) { const t = this.readyAt(ch, from); if (t < n) n = t; }
    this.next = n;
    this.m.schedule(this);
  }
  /** The channel the arbiter issues at cycle c: the HIGH_PRIORITY ones in turn, then one other (RP-001 CTRL.HIGH_PRIORITY). */
  pick(c) {
    const N = NUM_CHANNELS, ready = (ch) => this.readyAt(ch, c) <= c;
    for (let k = 1; k <= N; k++) {
      const i = (this.hiPtr + k) % N, ch = this.ch[i];
      if ((ch.ctrl & C_HIGH) && !((this.served >>> i) & 1) && ready(ch)) { this.hiPtr = i; this.served |= 1 << i; return ch; }
    }
    this.served = 0;
    for (let k = 1; k <= N; k++) {
      const i = (this.loPtr + k) % N, ch = this.ch[i];
      if (!(ch.ctrl & C_HIGH) && ready(ch)) { this.loPtr = i; return ch; }
    }
    for (let k = 1; k <= N; k++) {
      const i = (this.hiPtr + k) % N, ch = this.ch[i];
      if ((ch.ctrl & C_HIGH) && ready(ch)) { this.hiPtr = i; this.served = 1 << i; return ch; }
    }
    return null;
  }
  event() {
    const c = this.next;
    const ch = this.pick(c);
    if (ch) {
      if (ch.zero) this.complete(ch, c);
      else { this.lastIssue = c; this.transfer(ch, c); }
    }
    this.plan(c + 1);
  }
  transfer(ch, c) {
    const ctrl = ch.ctrl, size = [1, 2, 4, 4][(ctrl >>> 2) & 3], bus = this.m.bus;
    const t = ch.treq;
    if (t >= 32 && t <= 43) ch.credit--; else if (t >= 59 && t <= 62) ch.tUsed++;
    bus.fault = false;
    const ra = ch.read >>> 0;
    let v = (ra >>> 28) === 0xd ? (bus.fault = true, 0) : size === 4 ? bus.read32(ra) >>> 0 : size === 2 ? bus.read16(ra) : bus.read8(ra);
    if (bus.fault) { bus.fault = false; this.busError(ch, C_RERR); return; }
    if (ctrl & C_BSWAP) v = bswap(v, size);
    const sc = this.r.get(O_SNIFF_CTRL);
    if ((sc & 1) && (ctrl & C_SNIFF) && ((sc >>> 1) & 0xf) === ch.i) this.sniff(v, size, sc);
    const wa = ch.write >>> 0;
    if ((wa >>> 28) === 0xd) bus.fault = true;
    else if (size === 4) bus.write32(wa, v | 0); else if (size === 2) bus.write16(wa, v); else bus.write8(wa, v);
    if (bus.fault) { bus.fault = false; this.busError(ch, C_WERR); return; }
    this.transfers++;
    this.lastWriter = ch.i;
    ch.read = this.step(ch.read, size, (ctrl >>> 4) & 3, (ctrl & (1 << 12)) === 0 ? (ctrl >>> 8) & 0xf : 0);
    ch.write = this.step(ch.write, size, (ctrl >>> 6) & 3, (ctrl & (1 << 12)) !== 0 ? (ctrl >>> 8) & 0xf : 0);
    if (ch.mode !== MODE_ENDLESS) ch.count--;
    if (ch.count <= 0 && ch.mode !== MODE_ENDLESS) this.complete(ch, c);
  }
  /** The next address: INCR (bit 0) and REV (bit 1) give -1, 0, +1 or +2 transfer sizes; a ring keeps the upper bits. */
  step(a, size, incr, ring) {
    const k = (incr & 1) ? ((incr & 2) ? -1 : 1) : ((incr & 2) ? 2 : 0);
    const n = (a + k * size) >>> 0;
    if (!ring) return n;
    const mask = ((1 << ring) - 1) >>> 0;
    return ((a & ~mask) | (n & mask)) >>> 0;
  }
  busError(ch, flag) {
    ch.ctrl |= flag; ch.busy = false;
    this.m.diag('dmaBusError', ch.i, flag === C_RERR ? 'read' : 'write', (flag === C_RERR ? ch.read : ch.write) >>> 0);
    this.raise(ch.i); // always, and no CHAIN_TO (RP-001 §12.6.7.1)
    this.relisten();
  }

  // ---- the sniffer ----
  sniff(v, size, sc) {
    const calc = (sc >>> 5) & 0xf, bits = 8 * size;
    if (sc & (1 << 9)) v = bswap(v, size);
    let a = this.sniffAcc >>> 0;
    if (calc === 0 || calc === 1) {
      const d = calc === 1 ? rev(v, bits) : v;
      for (let i = bits - 1; i >= 0; i--) { const b = ((a >>> 31) ^ (d >>> i)) & 1; a = ((a << 1) ^ (b ? 0x04c11db7 : 0)) >>> 0; }
    } else if (calc === 2 || calc === 3) {
      const d = calc === 3 ? rev(v, bits) : v;
      let x = a & 0xffff;
      for (let i = bits - 1; i >= 0; i--) { const b = ((x >>> 15) ^ (d >>> i)) & 1; x = ((x << 1) & 0xffff) ^ (b ? 0x1021 : 0); }
      a = ((a & 0xffff0000) | x) >>> 0;
    } else if (calc === 14) {
      let p = v; p ^= p >>> 16; p ^= p >>> 8; p ^= p >>> 4; p ^= p >>> 2; p ^= p >>> 1;
      a = (a ^ (p & 1)) >>> 0;
    } else if (calc === 15) a = (a + v) >>> 0;
    else this.m.diag('dmaSniffCalc', calc);
    this.sniffAcc = a;
  }
  sniffOut() {
    const sc = this.r.get(O_SNIFF_CTRL);
    let v = this.sniffAcc >>> 0;
    if (sc & (1 << 10)) v = rev(v, 32);
    if (sc & (1 << 11)) v = ~v >>> 0;
    return v;
  }

  // ---- registers ----
  read(off, addr) {
    if (this.held()) return super.read(off, addr);
    if (off < 0x400) {
      const ch = this.ch[off >>> 6], k = ALIAS[(off & 0x3f) >>> 2];
      if (k === 0) return ch.read >>> 0;
      if (k === 1) return ch.write >>> 0;
      if (k === 2) return (((ch.busy ? ch.mode : ch.reload >>> 28) << 28) | (ch.count & 0x0fffffff)) >>> 0;
      const err = ch.ctrl & (C_RERR | C_WERR);
      return ((ch.ctrl & C_RW) | (ch.busy ? C_BUSY : 0) | err | (err ? 0x80000000 : 0)) >>> 0;
    }
    if (off >= O_DBG && off < O_DBG + 0x40 * NUM_CHANNELS) {
      const ch = this.ch[(off - O_DBG) >>> 6];
      if ((off & 0x3f) === 0) return ch.credit;
      if ((off & 0x3f) === 4) return ch.reload >>> 0;
    }
    return super.read(off, addr);
  }
  readReg(off) {
    if (off >= 0x40c && off <= 0x43c && (off & 0xf) === 0xc) { const k = (off - 0x40c) >>> 4; return ((this.r.get(O_INTR) | this.r.get(intf(k))) & this.r.get(inte(k)) & 0xffff) >>> 0; }
    if (off === O_SNIFF_DATA) return this.sniffOut();
    if (off === O_MULTI || off === O_ABORT || off === O_FIFO) return 0; // aborts finish at once: nothing is in flight here
    if (off === O_NCH) return NUM_CHANNELS;
    return this.r.get(off);
  }
  write(off, value, alias, addr, size, raw) {
    if (this.held()) return super.write(off, value, alias, addr, size, raw);
    const c = this.now;
    if (off < 0x400) {
      const ch = this.ch[off >>> 6], word = (off & 0x3f) >>> 2, k = ALIAS[word], trig = (word & 3) === 3;
      const v = aliasValue(this.read(off, addr) & (k === 3 ? C_RW : 0xffffffff), value, alias);
      if (k === 0) ch.read = v;
      else if (k === 1) ch.write = v;
      else if (k === 2) ch.reload = v;
      else {
        ch.ctrl = (ch.ctrl & (C_RERR | C_WERR) & ~(value & (C_RERR | C_WERR))) | (v & C_RW); // the error flags clear by writing 1
        this.relisten();
      }
      if (trig) {
        if (v === 0) { if (ch.ctrl & C_IRQ_QUIET) this.raise(ch.i); } // a null trigger (RP-001 §12.6.3.3)
        else this.trigger(ch, c + 1); // TRANS_COUNT_TRIG: the value just written is the reload value it starts with
      }
      this.plan(c + 1);
      return;
    }
    if (off >= O_DBG && off < O_DBG + 0x40 * NUM_CHANNELS) { if ((off & 0x3f) === 0) { this.ch[(off - O_DBG) >>> 6].credit = 0; } return; }
    if (off >= 0x40c && off <= 0x43c && (off & 0xf) === 0xc) { // INTSn: write 1 to clear the channel's interrupt (WC)
      if (alias !== 3) { this.r.set(O_INTR, this.r.get(O_INTR) & ~(value & 0xffff)); this.updateIrq(); }
      return;
    }
    if (off === O_MULTI) { if (alias !== 3) { for (let i = 0; i < NUM_CHANNELS; i++) if ((value >>> i) & 1) this.trigger(this.ch[i], c + 1); this.plan(c + 1); } return; }
    if (off === O_ABORT) { if (alias !== 3) { for (let i = 0; i < NUM_CHANNELS; i++) if ((value >>> i) & 1) this.abort(this.ch[i], c); this.plan(c + 1); } return; }
    if (off === O_SNIFF_DATA) { this.sniffAcc = aliasValue(this.sniffAcc, value, alias); return; }
    super.write(off, value, alias, addr, size, raw);
  }
  onWrite(off, nv) {
    if (off >= O_TIMER0 && off < O_TIMER0 + 16) {
      const t = this.timers[(off - O_TIMER0) >>> 2], x = nv >>> 16, y = nv & 0xffff, c = this.now;
      t.setRate(c, y ? Math.min(x, y) : 0, y || 1);
      this.plan(c + 1);
      return;
    }
    this.updateIrq();
  }
  updateIrq() {
    const intr = this.r.get(O_INTR);
    let v = 0;
    for (let k = 0; k < 4; k++) if ((intr | this.r.get(intf(k))) & this.r.get(inte(k)) & 0xffff) v |= 1 << k;
    if (v === this.lines) return;
    for (let k = 0; k < 4; k++) if (((v ^ this.lines) >>> k) & 1) this.m.irq(IRQ_DMA0 + k, (v >>> k) & 1);
    this.lines = v;
  }

  /** A decoded view of channel i for the interface. */
  view(i) {
    const ch = this.ch[i], ctrl = ch.ctrl;
    return { channel: i, busy: ch.busy, en: (ctrl & C_EN) !== 0, read: ch.read >>> 0, write: ch.write >>> 0, count: ch.count, reload: ch.reload & 0x0fffffff,
      mode: ch.busy ? ch.mode : ch.reload >>> 28, size: [1, 2, 4, 4][(ctrl >>> 2) & 3], incrRead: (ctrl >>> 4) & 3, incrWrite: (ctrl >>> 6) & 3,
      ring: (ctrl >>> 8) & 0xf, ringWrite: (ctrl & (1 << 12)) !== 0, chainTo: (ctrl >>> 13) & 0xf, treq: ch.treq, quiet: (ctrl & C_IRQ_QUIET) !== 0,
      high: (ctrl & C_HIGH) !== 0, bswap: (ctrl & C_BSWAP) !== 0, sniff: (ctrl & C_SNIFF) !== 0, error: (ctrl & C_RERR) ? 'read' : (ctrl & C_WERR) ? 'write' : null,
      credit: ch.credit, irq: ((this.r.get(O_INTR) >>> i) & 1) === 1 };
  }

  save() {
    return { ...super.save(), ch: this.ch.map((x) => x.save()), timers: this.timers.map((t) => t.save()), lines: this.lines, sniffAcc: this.sniffAcc,
      lastWriter: this.lastWriter, hiPtr: this.hiPtr, loPtr: this.loPtr, served: this.served, lastIssue: this.lastIssue, listen: this.listen.slice(), transfers: this.transfers };
  }
  load(s) {
    super.load(s); s.ch.forEach((x, i) => this.ch[i].load(x)); s.timers.forEach((x, i) => this.timers[i].load(x));
    ({ lines: this.lines, sniffAcc: this.sniffAcc, lastWriter: this.lastWriter, hiPtr: this.hiPtr, loPtr: this.loPtr, served: this.served, lastIssue: this.lastIssue, transfers: this.transfers } = s);
    this.listen = s.listen.slice();
  }
}

function aliasValue(old, value, alias) {
  return alias === 1 ? (old ^ value) >>> 0 : alias === 2 ? (old | value) >>> 0 : alias === 3 ? (old & ~value) >>> 0 : value >>> 0;
}
