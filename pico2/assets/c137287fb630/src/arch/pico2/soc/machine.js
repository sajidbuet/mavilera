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
import { Pwm } from './pwm.js';
import { Dma } from './dma.js';
import { AudioTap } from '../audio/tap.js';
import { Core1, Psm } from './core1.js';
import { Adc } from './adc.js';
import { Spi } from './spi.js';
import { I2c } from './i2c.js';
import { Pio } from './pio.js';
import { createKit, ENV_DEFAULTS, envClamp } from '../parts/kit.js';
import { SVD_BLOCKS } from './regs.generated.js';
import { buildRom, romLookup, romCodeName } from '../boot/rom.js';
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
 else if (kind === 'adc') this.m.adc.setVolts(a, b);
 else if (kind === 'env') this.m.setEnv(a, b);
 }
 this.next = this.q.length ? this.q[0][0] : Infinity;
 }
 reset() { this.q = []; this.next = Infinity; }
 save() { return this.q.map((e) => e.slice()); }
 load(s) { this.q = s.map((e) => e.slice()); this.next = this.q.length ? this.q[0][0] : Infinity; }
}
export class Machine {
 constructor({ flashSize = 4 << 20 } = {}) {
 this.ready = false; this.touched = false; this.deadline = Infinity;
 this.cur = -1;
 this.diags = new Map();
 this.bus = new Bus(this, { flashSize });
 this.harts = [new Hart(this.bus, { resetPc: 0, hartid: 0 }), new Hart(this.bus, { resetPc: 0, hartid: 1 })];
 this.hart = this.harts[0];
 this.harts[0].onUnblock = () => { this.harts[1].unblockIn = true; };
 this.harts[1].onUnblock = () => { this.harts[0].unblockIn = true; };
 for (const h of this.harts) h.sched = this;
 this.core1 = new Core1(this); this.core1On = false;
 this.rom = buildRom(); this.bus.rbytes.set(this.rom.bytes);
 this.freq = { ref: ROSC_HZ, sys: ROSC_HZ, peri: 0, usb: 0, adc: 0 };
 this.timeline = [[0, 0, ROSC_HZ]];
 this.coreBits = [0, 0];
 this.resets = new Resets(this);
 this.clocks = new Clocks(this); this.xosc = new Xosc(this); this.ticks = new Ticks(this);
 this.pllSys = new Pll(this, 'PLL_SYS', 14); this.pllUsb = new Pll(this, 'PLL_USB', 15);
 this.timer = [new Timer(this, 0), new Timer(this, 1)];
 this.uart = [new Uart(this, 0), new Uart(this, 1)];
 this.pins = new Pins(this);
 this.io = new IoBank0(this); this.pads = new PadsBank0(this);
 this.sio = new Sio(this);
 this.pwm = new Pwm(this);
 this.dma = new Dma(this);
 this.env = { ...ENV_DEFAULTS };
 this.kit = createKit(() => this.env); this.kitOn = false;
 for (const b of this.kit.spi) for (const { cs } of b.parts) this.pins.csPins |= 1 << cs;
 this.adc = new Adc(this);
 this.spi = [new Spi(this, 0), new Spi(this, 1)];
 this.i2c = [new I2c(this, 0), new I2c(this, 1)];
 this.pio = new Pio(this);
 this.audio = new AudioTap(this);
 this.inputs = new Inputs(this);
 const models = {
 RESETS: this.resets, CLOCKS: this.clocks, XOSC: this.xosc, TICKS: this.ticks, PLL_SYS: this.pllSys, PLL_USB: this.pllUsb,
 TIMER0: this.timer[0], TIMER1: this.timer[1], PWM: this.pwm, DMA: this.dma,
 ADC: this.adc, SPI0: this.spi[0], SPI1: this.spi[1], I2C0: this.i2c[0], I2C1: this.i2c[1],
 PIO0: this.pio.dev[0], PIO1: this.pio.dev[1], PIO2: this.pio.dev[2], UART0: this.uart[0], UART1: this.uart[1], IO_BANK0: this.io, PADS_BANK0: this.pads,
 SYSINFO: new SysInfo(this), WATCHDOG: new Watchdog(this), BOOTRAM: new BootRam(this),
 ROSC: new Storage(this, 'ROSC'), SYSCFG: new Storage(this, 'SYSCFG', { resetBit: 20 }), PSM: new Psm(this),
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
 if (models[name] && this.blocks.includes(dev)) continue;
 this.blocks.push(dev);
 }
 this.resettable = this.blocks.filter((d) => d.resetBit >= 0);
 this.events = [this.timer[0], this.timer[1], this.uart[0], this.uart[1], this.sio, this.pwm, this.dma, this.adc, this.spi[0], this.spi[1], this.i2c[0], this.i2c[1], this.pio, this.inputs];
 this.image = null;
 this.powerOn();
 }
 powerOn() {
 this.ready = false;
 for (const h of this.harts) h.reset();
 this.hart = this.harts[0]; this.coreBits = [0, 0];
 this.core1.reset(); this.core1On = false;
 this.pins.reset();
 this.env = { ...ENV_DEFAULTS }; this.kit.reset(); this.adc.powerOn();
 this.pio.reset();
 for (const d of this.blocks) d.reset();
 this.inputs.reset();
 this.bus.bytes.fill(0); this.bus.fbytes.fill(0xff);
 this.freq = { ref: ROSC_HZ, sys: ROSC_HZ, peri: 0, usb: 0, adc: 0 };
 this.timeline = [[0, 0, ROSC_HZ]];
 this.ready = true;
 this.pins.updateAll();
 this.pins.clearLog();
 for (const u of this.uart) u.clearLog();
 this.retime();
 this.recomputeDeadline();
 this.audio?.restart(0);
 }
 loadChunks(chunks) {
 for (const c of chunks) {
 const a = c.address >>> 0, n = c.bytes.length;
 if (a >= SRAM_BASE && a + n <= SRAM_BASE + SRAM_SIZE) this.bus.bytes.set(c.bytes, a - SRAM_BASE);
 else if (a >= XIP_BASE && a + n <= XIP_BASE + this.bus.flashSize) this.bus.fbytes.set(c.bytes, a - XIP_BASE);
 else return a;
 }
 return null;
 }
 bootImage(image) {
 this.powerOn();
 const bad = this.loadChunks(image.chunks);
 if (bad !== null) return bad;
 const o = this.resets.r.off('RESET');
 this.resets.r.set(o, this.resets.r.get(o) & ~((1 << 7) | (1 << 10)));
 this.resets.updateHeld();
 this.hart.pc = image.entry.pc | 0; this.hart.x[2] = image.entry.sp | 0;
 this.image = image;
 return null;
 }
 get now() { return this.cur >= 0 ? this.cur : this.hart.ticks; }
 schedule(dev) { if (dev.next < this.deadline) this.deadline = dev.next; }
 recomputeDeadline() { let d = Infinity; for (const e of this.events) if (e.next < d) d = e.next; this.deadline = d; }
 service() {
 const now = this.hart.ticks, ev = this.events;
 this.touched = true;
 let at = Infinity;
 for (let guard = 0; guard < 1_000_000; guard++) {
 let best = null;
 at = Infinity;
 for (let i = 0; i < ev.length; i++) if (ev[i].next < at) { at = ev[i].next; best = ev[i]; }
 if (at > now) break;
 this.cur = at;
 best.event(at);
 }
 this.cur = -1;
 this.deadline = at;
 }
 serviceDue() { let g = 0; do this.service(); while (this.hart.ticks >= this.deadline && ++g < 8); }
 at(cycle, kind, a, b) { this.inputs.add(Math.max(cycle, this.hart.ticks), kind, a, b); }
 romCall(pc, slot) {
 const h = this.hart;
 let result = null;
 this.touched = true;
 if (slot.kind === 'core1Return') {
 if (h.hartid === 1) { this.core1.park(); return null; }
 return { kind: 'entry', slot, ra: h.x[1] >>> 0 };
 }
 if (slot.kind === 'lookup') {
 const r = romLookup(this.rom, h.x[10], h.x[11]);
 if (r.data) this.diag('romData', romCodeName(h.x[10]));
 result = r.value;
 } else if (slot.kind === 'entry' || !slot.implemented) return { kind: slot.kind, slot, ra: h.x[1] >>> 0 };
 const hist = h.hist;
 if (hist) hist.begin(pc, h.tState(), h.btb);
 if (result !== null) h.wr(10, result | 0);
 h.pc = h.x[1] & ~1;
 h.adv(1);
 h.ldRd = 0; h.ldExcl = false; h.redirect = true;
 h.lastPre = 0; h.lastCost = 1; h.lastCause = 0; h.lastD = null; h.lastFast = 0;
 if (hist) hist.end(!(h.mcountinhibit & 1), false, 1, h.btb);
 return null;
 }
 run(n) {
 if (this.core1On) return this.runDual(n);
 const h = this.hart;
 this.stop = null;
 let i = 0;
 for (; i < n; i++) {
 if (h.ticks >= this.deadline) { this.serviceDue(); if (this.core1On) return i + this.runDual(n - i); }
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
 runFor(n, { breakpoints = null, checkFirst = false, until = Infinity } = {}) {
 if (this.core1On) return this.runDual(n, { breakpoints, checkFirst, until });
 const h = this.hart;
 this.stop = null;
 let i = 0, retired = 0;
 for (; i < n; i++) {
 if (h.ticks >= until) { this.stop = 'until'; break; }
 if (h.ticks >= this.deadline) {
 this.serviceDue();
 if (this.core1On) { const k = this.runDual(n - i, { breakpoints, checkFirst: checkFirst || i > 0, until }); this.retired += retired; return i + k; }
 }
 const pc = h.pc >>> 0;
 if (breakpoints !== null && (i > 0 || checkFirst) && breakpoints.has(pc)) { this.stop = 'break'; break; }
 if (pc < 0x8000) { const slot = this.rom.slots.get(pc); if (slot) { const r = this.romCall(pc, slot); if (r) { this.stop = 'rom'; this.stopInfo = r; break; } continue; } }
 if (h.sleeping && !(h.mip & h.mie)) {
 if (h.mie !== 0 && this.deadline > until) { this.stop = 'idle'; break; }
 if (h.mie === 0 || this.deadline === Infinity) { this.stop = 'sleep'; break; }
 const skip = this.deadline - h.ticks - 1;
 if (skip > 0) { h.ticks += skip; if (!(h.mcountinhibit & 1)) h.cycles += skip; }
 }
 if (h.step()) retired++;
 if (h.trapped && (h.mtvec & ~3) === 0) { this.stop = 'trap'; i++; break; }
 }
 this.retired = retired;
 return i;
 }
 runDual(n, { breakpoints = null, checkFirst = false, until = Infinity } = {}) {
 const [a, b] = this.harts, bus = this.bus;
 const wakes = (h) => (h.mip & h.mie) !== 0 || (h.sleepBlock && h.unblockIn);
 const idle = (h, t) => { if (t > h.ticks) { const d = t - h.ticks; h.ticks = t; if (!(h.mcountinhibit & 1)) h.cycles += d; } };
 this.stop = null; this.stopHart = null;
 let i = 0, retired = 0;
 try {
 while (i < n) {
 if (!this.core1On) {
 this.hart = a;
 const k = this.runFor(n - i, { breakpoints, checkFirst: checkFirst || i > 0, until });
 this.retired += retired;
 return i + k;
 }
 const ra = !a.sleeping || wakes(a), rb = !b.sleeping || wakes(b);
 let h;
 if (ra && rb) h = b.ticks < a.ticks ? b : a;
 else if (ra) { h = a; idle(b, a.ticks); }
 else if (rb) { h = b; idle(a, b.ticks); }
 else {
 const t = Math.max(a.ticks, b.ticks);
 if (t >= until) { this.stop = 'until'; break; }
 if ((a.mie === 0 && b.mie === 0) || this.deadline === Infinity) { this.stop = 'sleep'; break; }
 if (this.deadline > until) { this.stop = 'idle'; break; }
 idle(a, Math.max(t, this.deadline)); idle(b, Math.max(t, this.deadline));
 this.hart = a; this.serviceDue();
 continue;
 }
 this.hart = h; this.lastHart = h;
 if (h.ticks >= until) { this.stop = 'until'; break; }
 if (h.ticks >= this.deadline) { this.serviceDue(); continue; }
 const pc = h.pc >>> 0;
 if (breakpoints !== null && (i > 0 || checkFirst) && breakpoints.has(pc)) { this.stop = 'break'; this.stopHart = h; break; }
 if (pc < 0x8000) {
 const slot = this.rom.slots.get(pc);
 if (slot) { const r = this.romCall(pc, slot); if (r) { this.stop = 'rom'; this.stopInfo = r; this.stopHart = h; break; } i++; continue; }
 }
 const o = h === a ? b : a, rv = o.reservation, before = rv !== -1 ? bus.peek(rv, 4) : 0;
 if (h.step()) retired++;
 i++;
 if (rv !== -1 && o.reservation === rv && bus.peek(rv, 4) !== before) o.reservation = -1;
 if (h.trapped && (h.mtvec & ~3) === 0) { this.stop = 'trap'; this.stopHart = h; break; }
 }
 } finally { this.hart = a; }
 this.retired = retired;
 return i;
 }
 core1Changed() { this.core1On = this.core1.running; this.deadline = -1; }
 setEnv(key, value) { const v = envClamp(key, value); if (Number.isFinite(v)) this.env[key] = v; }
 setKit(on) {
 this.kitOn = !!on;
 for (const s of this.spi) for (const { cs } of this.kit.spi[s.index].parts) s.pinLevel(cs, this.pins.level[cs]);
 }
 irq(n, level) { this.harts[0].irqc.setLine(n, level); this.harts[1].irqc.setLine(n, level); }
 irqCore(c, n, level) { this.harts[c].irqc.setLine(n, level); }
 coreIrq(c, bit, level) { const v = level ? this.coreBits[c] | (1 << bit) : this.coreBits[c] & ~(1 << bit); this.coreBits[c] = v; this.harts[c].setIrq(v); }
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
 diag(kind, ...args) {
 const key = args.length ? `${kind}:${args.join(',')}` : kind;
 const d = this.diags.get(key);
 if (d) d.count++; else this.diags.set(key, { kind, args, cycle: this.hart.ticks, count: 1 });
 }
 save() {
 const h = this.harts[0], h1 = this.harts[1];
 return {
 ram: this.bus.bytes.slice(), x: h.x.slice(), pc: h.pc, sys: h.saveSys(), ticks: h.ticks, lines: h.irqc.irq.slice(), coreBits: this.coreBits.slice(),
 core1: { x: h1.x.slice(), pc: h1.pc, sys: h1.saveSys(), ticks: h1.ticks, lines: h1.irqc.irq.slice(), launch: this.core1.save() },
 blocks: this.blocks.map((d) => d.save()), pins: this.pins.save(), inputs: this.inputs.save(), freq: { ...this.freq },
 env: { ...this.env }, kit: this.kit.save(), kitOn: this.kitOn,
 pio: this.pio.save(),
 timeline: this.timeline.map((e) => e.slice()), deadline: this.deadline,
 };
 }
 load(s) {
 const h = this.harts[0], h1 = this.harts[1];
 this.hart = h;
 this.bus.bytes.set(s.ram); h.x.set(s.x); h.pc = s.pc; h.restoreSys(s.sys); h.ticks = s.ticks; h.trapped = false;
 h.irqc.irq.set(s.lines); h.irqc.dirty = true; this.coreBits = s.coreBits.slice(); h.setIrq(this.coreBits[0]);
 const c = s.core1;
 h1.x.set(c.x); h1.pc = c.pc; h1.restoreSys(c.sys); h1.ticks = c.ticks; h1.trapped = false; h1.irqc.irq.set(c.lines); h1.irqc.dirty = true;
 h1.setIrq(this.coreBits[1]); h1.flushCache();
 this.core1.load(c.launch); this.core1On = this.core1.running;
 if (s.kit) { this.kit.load(s.kit); this.env = { ...s.env }; this.kitOn = s.kitOn; }
 this.blocks.forEach((d, i) => d.load(s.blocks[i]));
 if (s.pio) this.pio.load(s.pio);
 this.pins.load(s.pins); this.inputs.load(s.inputs); this.freq = { ...s.freq };
 this.timeline = s.timeline.map((e) => e.slice()); this.deadline = s.deadline;
 h.flushCache();
 }
}
