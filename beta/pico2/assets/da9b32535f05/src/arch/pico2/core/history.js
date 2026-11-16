// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const F_CY = 1 << 8, F_IR = 1 << 9, F_SYS = 1 << 10, F_BTB = 1 << 11, COST_SHIFT = 12;
const SCRATCH = 256;
export class HistoryRing {
 constructor(words = 1 << 20) {
 this.cap = words;
 this.buf = new Uint32Array(words);
 this.start = 0;
 this.used = 0;
 this.count = 0;
 this.dropped = 0;
 this.seq = 0;
 this.sys = new Map();
 this.cur = new Uint32Array(SCRATCH);
 this.n = 0;
 this.nreg = 0; this.nmem = 0; this.pc = 0; this.hasSys = false; this.deviceWrites = 0; this.t0 = 0; this.btb0 = -1;
 }
 begin(pc, t = 0, btb = -1) { this.pc = pc | 0; this.t0 = t; this.btb0 = btb; this.n = 0; this.nreg = 0; this.nmem = 0; this.hasSys = false; this.pendingSys = null; }
 reg(r, old) { this.cur[this.n++] = r; this.cur[this.n++] = old | 0; this.nreg++; }
 mem(addr, size, old, device = false) {
 if (!this.memBuf) this.memBuf = new Uint32Array(SCRATCH);
 const k = this.nmem * 3;
 this.memBuf[k] = addr >>> 0; this.memBuf[k + 1] = size | (device ? 0x100 : 0); this.memBuf[k + 2] = old | 0;
 this.nmem++;
 }
 snapshot(s) { if (!this.hasSys) { this.hasSys = true; this.pendingSys = s; } }
 get snapshotTaken() { return this.hasSys; }
 end(cy, ir, cost = 1, btb = this.btb0) {
 const nb = btb !== this.btb0 ? 1 : 0;
 const payload = 2 + this.n + this.nmem * 3 + nb;
 const total = payload + 2;
 if (total > this.cap) return;
 while (this.used + total > this.cap) this.dropOldest();
 const flags = (cy ? F_CY : 0) | (ir ? F_IR : 0) | (this.hasSys ? F_SYS : 0) | (nb ? F_BTB : 0) | payload | (cost << COST_SHIFT);
 const counts = this.nreg | (this.nmem << 8) | (this.t0 << 16);
 const buf = this.buf, cap = this.cap;
 let p = this.start + this.used; if (p >= cap) p -= cap;
 if (p + total <= cap) {
 buf[p] = total; buf[p + 1] = this.pc; buf[p + 2] = counts;
 let q = p + 3;
 for (let i = 0; i < this.n; i++) buf[q++] = this.cur[i];
 for (let i = 0, k = this.nmem * 3; i < k; i++) buf[q++] = this.memBuf[i];
 if (nb) buf[q++] = this.btb0;
 buf[q] = flags;
 } else {
 const put = (v) => { buf[p] = v; if (++p === cap) p = 0; };
 put(total); put(this.pc); put(counts);
 for (let i = 0; i < this.n; i++) put(this.cur[i]);
 for (let i = 0; i < this.nmem * 3; i++) put(this.memBuf[i]);
 if (nb) put(this.btb0);
 put(flags);
 }
 this.used += total; this.count++;
 if (this.hasSys) { this.sys.set(this.seq, this.pendingSys); this.pendingSys = null; }
 this.seq++;
 for (let i = 0; i < this.nmem; i++) if (this.memBuf[i * 3 + 1] & 0x100) this.deviceWrites++;
 }
 dropOldest() {
 const len = this.buf[this.start];
 if (this.sys.size) this.sys.delete(this.seq - this.count);
 this.start += len; if (this.start >= this.cap) this.start -= this.cap;
 this.used -= len; this.count--; this.dropped++;
 }
 undo(h) {
 if (this.count === 0) return false;
 const last = (this.start + this.used - 1) % this.cap;
 const flags = this.buf[last];
 const payload = flags & 0xff;
 const total = payload + 2;
 const first = (last - total + 1 + this.cap) % this.cap;
 const at = (k) => this.buf[(first + k) % this.cap];
 const pc = at(1), counts = at(2), nreg = counts & 0xff, nmem = (counts >>> 8) & 0xff;
 const cost = flags >>> COST_SHIFT;
 const memBase = 3 + nreg * 2;
 for (let i = nmem - 1; i >= 0; i--) {
 const addr = at(memBase + i * 3), sz = at(memBase + i * 3 + 1), old = at(memBase + i * 3 + 2) | 0;
 if (sz & 0x100) continue;
 const size = sz & 0xff;
 if (h.bus.restore) h.bus.restore(addr, size, old);
 else if (size === 4) h.bus.write32(addr, old); else if (size === 2) h.bus.write16(addr, old & 0xffff); else h.bus.write8(addr, old & 0xff);
 }
 for (let i = nreg - 1; i >= 0; i--) { const r = at(3 + i * 2); if (r) h.x[r] = at(4 + i * 2) | 0; }
 h.pc = pc | 0;
 this.used -= total; this.count--; this.seq--;
 if (flags & F_SYS) { h.restoreSys(this.sys.get(this.seq)); this.sys.delete(this.seq); }
 else { if (flags & F_CY) h.cycles -= cost; if (flags & F_IR) h.instret--; }
 h.ticks -= cost;
 h.setTState(counts >>> 16);
 if (flags & F_BTB) h.btb = at(memBase + nmem * 3) | 0;
 h.trapped = false;
 return true;
 }
 newest() {
 if (this.count === 0) return null;
 const last = (this.start + this.used - 1) % this.cap;
 const flags = this.buf[last];
 const first = (last - ((flags & 0xff) + 2) + 1 + this.cap) % this.cap;
 const at = (k) => this.buf[(first + k) % this.cap];
 const counts = at(2), nreg = counts & 0xff, nmem = (counts >>> 8) & 0xff;
 const regs = [], mem = [];
 for (let i = 0; i < nreg; i++) regs.push([at(3 + i * 2), at(4 + i * 2) | 0]);
 const memBase = 3 + nreg * 2;
 for (let i = 0; i < nmem; i++) { const sz = at(memBase + i * 3 + 1); mem.push([at(memBase + i * 3), sz & 0xff, at(memBase + i * 3 + 2) | 0, (sz & 0x100) !== 0]); }
 return { pc: at(1) | 0, regs, mem, sys: (flags & F_SYS) ? this.sys.get(this.seq - 1) ?? null : null, cost: flags >>> COST_SHIFT };
 }
 get topPc() {
 if (!this.count) return -1;
 const last = (this.start + this.used - 1) % this.cap;
 const first = (last - ((this.buf[last] & 0xff) + 2) + 1 + this.cap) % this.cap;
 return this.buf[(first + 1) % this.cap] | 0;
 }
 clear() { this.start = 0; this.used = 0; this.count = 0; this.dropped = 0; this.seq = 0; this.sys.clear(); this.deviceWrites = 0; }
 get bytes() { return this.cap * 4; }
}
