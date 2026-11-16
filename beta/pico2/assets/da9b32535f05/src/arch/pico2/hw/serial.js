// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
import { HardwareError, toHardwareError } from './errors.js';
export const BAUD_RATES = Object.freeze([9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600]);
export const DEFAULT_BAUD = 115200;
export const FORBIDDEN_BAUD = 1200;
export const LINE_ENDINGS = Object.freeze({ cr: '\r', lf: '\n', crlf: '\r\n', none: '' });
export const PICO_USB_FILTER = Object.freeze({ usbVendorId: 0x2e8a, usbProductId: 0x0009 });
export const KEEP_CHARS = 1 << 20;
export class LineSplitter {
 constructor() { this.part = ''; this.cr = false; }
 push(text) {
 const lines = [];
 for (const ch of text) {
 if (this.cr) { this.cr = false; if (ch === '\n') continue; }
 if (ch === '\r') { lines.push(this.part); this.part = ''; this.cr = true; }
 else if (ch === '\n') { lines.push(this.part); this.part = ''; }
 else this.part += ch;
 }
 return { lines, partial: this.part };
 }
}
const portIds = (p) => { const i = p.getInfo?.() ?? {}; return { vid: i.usbVendorId ?? null, pid: i.usbProductId ?? null }; };
const sameIds = (a, b) => a.vid === b.vid && a.pid === b.pid;
export function textLines(text) {
 const t = String(text ?? '').replace(/\r\n?/g, '\n');
 const lines = t.split('\n');
 if (lines.length && lines[lines.length - 1] === '') lines.pop();
 return lines;
}
export function compareOutputs(boardText, simText) {
 const b = textLines(boardText), s = textLines(simText);
 const n = Math.min(b.length, s.length);
 for (let i = 0; i < n; i++) if (b[i] !== s[i]) return { agree: i, compared: n, board: b.length, sim: s.length, first: { line: i + 1, board: b[i], sim: s[i] } };
 return { agree: n, compared: n, board: b.length, sim: s.length, first: null };
}
export const hexBytes = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join(' ');
export class SerialMonitor {
 constructor({ serial = globalThis.navigator?.serial ?? null, onLine = () => {}, onPartial = () => {}, onState = () => {}, onBytes = () => {}, now = () => Date.now() } = {}) {
 this.serial = serial;
 this.onLine = onLine; this.onPartial = onPartial; this.onState = onState; this.onBytes = onBytes; this.now = now;
 this.port = null; this.ids = null; this.baud = DEFAULT_BAUD;
 this.reader = null; this.state = 'closed';
 this.text = ''; this.dropped = 0;
 this.counts = { lines: 0, bytes: 0 };
 this.split = new LineSplitter();
 this.wanted = false;
 if (serial?.addEventListener) {
 const portOf = (e) => e.port ?? (e.target !== serial ? e.target : null);
 serial.addEventListener('connect', (e) => this.#onConnect(portOf(e)));
 serial.addEventListener('disconnect', (e) => this.#onDisconnect(portOf(e)));
 }
 }
 get supported() { return Boolean(this.serial?.requestPort); }
 #set(state, info = {}) { this.state = state; this.onState({ state, ...info }); }
 async choose({ pico = false } = {}) {
 if (!this.supported) throw new HardwareError('unsupported', 'no Web Serial');
 try { return await this.serial.requestPort(pico ? { filters: [PICO_USB_FILTER] } : {}); } catch (e) { throw toHardwareError(e, 'choose port'); }
 }
 async open(port, baud = DEFAULT_BAUD) {
 if (baud === FORBIDDEN_BAUD || !BAUD_RATES.includes(baud)) throw new HardwareError('not-permitted', `${baud} bit/s is not offered`);
 await this.close({ keepWanted: false });
 try {
 await port.open({ baudRate: baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
 } catch (e) { throw toHardwareError(e, 'open port'); }
 try { await port.setSignals?.({ dataTerminalReady: true }); } catch { }
 this.port = port; this.ids = portIds(port); this.baud = baud; this.wanted = true;
 this.#set('open', { ids: this.ids, baud });
 this.#read(port);
 return this.ids;
 }
 async #read(port) {
 const decoder = new TextDecoder('utf-8', { fatal: false });
 while (port === this.port && port.readable) {
 let reader;
 try { reader = port.readable.getReader(); } catch { break; }
 this.reader = reader;
 try {
 for (;;) {
 const { value, done } = await reader.read();
 if (done) break;
 this.counts.bytes += value.length;
 try { this.onBytes(value); } catch { }
 this.#receive(decoder.decode(value, { stream: true }));
 }
 } catch { } finally {
 try { reader.releaseLock(); } catch { }
 this.reader = null;
 }
 if (port !== this.port) return;
 if (!port.readable) break;
 }
 }
 #receive(text) {
 const { lines, partial } = this.split.push(text);
 for (const l of lines) { this.#keep(`${l}\n`); this.counts.lines++; this.onLine(l); }
 this.onPartial(partial);
 }
 #keep(s) {
 this.text += s;
 if (this.text.length > 2 * KEEP_CHARS) { const cut = this.text.length - KEEP_CHARS; this.dropped += cut; this.text = this.text.slice(cut); }
 }
 async send(line, end = 'cr') {
 if (!this.port?.writable) throw new HardwareError('disconnected', 'no port is open');
 const w = this.port.writable.getWriter();
 try { await w.write(new TextEncoder().encode(String(line) + (LINE_ENDINGS[end] ?? '\r'))); } catch (e) { throw toHardwareError(e, 'send'); } finally { w.releaseLock(); }
 }
 async close({ keepWanted = false } = {}) {
 const p = this.port;
 this.port = null;
 if (!keepWanted) this.wanted = false;
 if (!p) return;
 try { await this.reader?.cancel(); } catch { }
 try { await p.close(); } catch { }
 if (!keepWanted) this.#set('closed');
 }
 clear() { this.text = ''; this.dropped = 0; this.split = new LineSplitter(); this.counts = { lines: 0, bytes: 0 }; }
 async forget() { const p = this.port; await this.close(); await p?.forget?.().catch(() => {}); this.ids = null; }
 async #onDisconnect(port) {
 if (!port || port !== this.port) return;
 await this.close({ keepWanted: true });
 this.#set('waiting', { ids: this.ids });
 }
 async #onConnect(port) {
 if (!this.wanted || this.port || !this.ids || !port) return;
 const granted = (await this.serial.getPorts()).filter((p) => sameIds(portIds(p), this.ids));
 if (granted.length > 1) { this.#set('ask', { ids: this.ids }); return; }
 if (!granted.includes(port) || !sameIds(portIds(port), this.ids)) return;
 try { await this.open(port, this.baud); } catch (e) { this.#set('waiting', { ids: this.ids, error: toHardwareError(e).code }); }
 }
}
