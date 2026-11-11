// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const HEAD = 16;
const STATE_MAX = 16 << 10;
const UART_SIZE = 64 << 10;
export const RING_BYTES = HEAD + STATE_MAX + UART_SIZE;
const plain = (v) => (ArrayBuffer.isView(v) ? Array.from(v) : v);
export class LiveRing {
 constructor(sab = new SharedArrayBuffer(RING_BYTES)) {
 this.sab = sab;
 this.head = new Int32Array(sab, 0, 4);
 this.state = new Uint8Array(sab, HEAD, STATE_MAX);
 this.uart = new Uint8Array(sab, HEAD + STATE_MAX, UART_SIZE);
 this.readSeq = 0; this.readUart = 0; this.lost = 0;
 this.enc = new TextEncoder(); this.dec = new TextDecoder();
 }
 write(msg) {
 const { uart, ...state } = msg.state;
 for (const b of uart?.bytes ?? []) { const w = Atomics.load(this.head, 2); this.uart[(w >>> 0) % UART_SIZE] = b; Atomics.store(this.head, 2, (w + 1) | 0); }
 const json = this.enc.encode(JSON.stringify({ ...msg, state: { ...state, uartTotal: uart?.total ?? 0 } }, (k, v) => plain(v)));
 if (json.length > STATE_MAX) return false;
 Atomics.add(this.head, 0, 1);
 this.state.set(json);
 Atomics.store(this.head, 1, json.length);
 Atomics.add(this.head, 0, 1);
 return true;
 }
 read() {
 let live = null;
 for (let tries = 0; tries < 4; tries++) {
 const s1 = Atomics.load(this.head, 0);
 if (s1 & 1 || s1 === this.readSeq) { if (!(s1 & 1)) break; continue; }
 const n = Atomics.load(this.head, 1);
 const copy = new Uint8Array(n);
 copy.set(this.state.subarray(0, n));
 if (Atomics.load(this.head, 0) !== s1) continue;
 this.readSeq = s1;
 live = JSON.parse(this.dec.decode(copy));
 break;
 }
 const w = Atomics.load(this.head, 2);
 let from = this.readUart;
 if (w - from > UART_SIZE) { this.lost += w - from - UART_SIZE; from = w - UART_SIZE; }
 const bytes = [];
 for (let i = from; i !== w; i = (i + 1) | 0) bytes.push(this.uart[(i >>> 0) % UART_SIZE]);
 this.readUart = w;
 return { live, bytes };
 }
}
