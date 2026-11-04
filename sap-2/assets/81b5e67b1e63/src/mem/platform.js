// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { Gpio, Timer, Uart, PeripheralWindow, GPIO_BASE, TIMER_BASE, UART_BASE, PERIPH_LO, PERIPH_SIZE, BUTTON_BIT } from './devices.js';
import { Npu, NPU_BASE } from './npu.js';
const MTI = 7;
export class Journal {
 constructor(snapshot) {
 this.snapshot = snapshot;
 this.saved = null;
 }
 reset() { this.saved = null; }
 touch() { if (this.saved === null) this.saved = this.snapshot(); }
}
const NO_JOURNAL = Object.freeze({ touch() {}, reset() {}, saved: null });
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
 constructor({ stimulus = [], rx = [], mtimeDiv = 1, uart = true, txCycles = 4, npu = true, npuStop = false } = {}) {
 this.config = { stimulus, rx, mtimeDiv, uart, txCycles, npu, npuStop };
 this.window = new PeripheralWindow();
 this.gpio = new Gpio({ stimulus });
 this.timer = new Timer({ div: mtimeDiv });
 this.uart = uart ? new Uart({ txCycles, rx }) : null;
 this.npu = npu ? new Npu({ stopOnBusyResult: npuStop }) : null;
 this.log = [];
 this.open = new Map();
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
 get parts() { return [this.gpio, this.timer, ...(this.uart ? [this.uart] : []), ...(this.npu ? [this.npu] : [])]; }
 devices() {
 return [{ base: PERIPH_LO, device: this.window }, { base: GPIO_BASE, device: this.gpio }, { base: TIMER_BASE, device: this.timer },
 ...(this.uart ? [{ base: UART_BASE, device: this.uart }] : []), ...(this.npu ? [{ base: NPU_BASE, device: this.npu }] : [])];
 }
 setJournal(j) {
 this.journal = j;
 for (const d of [this.window, ...this.parts]) d.journal = j;
 }
 static claims(addr) { return addr >= PERIPH_LO && addr < PERIPH_LO + PERIPH_SIZE; }
 tick(cycle) { for (const d of this.parts) d.tick(cycle); }
 get now() { return this.timer.now; }
 mtip(cycle) { return this.timer.mtip(cycle); }
 meip() { return this.gpio.irq() || Boolean(this.uart?.irq()); }
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
 describe(addr) {
 for (const { base, device } of this.devices()) {
 if (device === this.window) continue;
 if (addr >= base && addr < base + device.size) return `${device.name}.${device.registers.find((r) => r.offset === addr - base)?.name ?? ''}`.replace(/\.$/, '');
 }
 return '';
 }
 measurement() {
 const markers = this.gpio.changes.map((c) => ({ ...c }));
 const spans = markers.slice(1).map((m, k) => ({ from: markers[k].out, to: m.out, cycles: m.cycle - markers[k].cycle }));
 return { markers, spans, npu: this.npu ? { ...this.npu.counters } : null };
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
