// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const ENV_DEFAULTS = Object.freeze({ temp: 25, pressure: 1013.25, humidity: 40, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, light: 300 });
export const ENV_KEYS = Object.freeze(Object.keys(ENV_DEFAULTS));
const ENV_RANGE = { temp: [-40, 85], pressure: [300, 1100], humidity: [0, 100], ax: [-2, 2], ay: [-2, 2], az: [-2, 2], gx: [-250, 250], gy: [-250, 250], gz: [-250, 250], light: [0, 100000] };
export const envClamp = (k, v) => { const r = ENV_RANGE[k]; return r ? Math.max(r[0], Math.min(r[1], Number(v))) : NaN; };
const CAL = { T1: 27504, T2: 26435, T3: -1000, P1: 36477, P2: -10685, P3: 3024, P4: 2855, P5: 140, P6: -7, P7: 15500, P8: -14600, P9: 6000,
 H1: 75, H2: 362, H3: 0, H4: 313, H5: 50, H6: 30 };
const i32 = (v) => v | 0;
function tFine(adcT) {
 const a = i32(Math.imul(i32((adcT >> 3) - (CAL.T1 << 1)), CAL.T2) >> 11);
 const d = i32((adcT >> 4) - CAL.T1);
 const b = i32(Math.imul(i32(Math.imul(d, d) >> 12), CAL.T3) >> 14);
 return i32(a + b);
}
const compT = (adcT) => i32(Math.imul(tFine(adcT), 5) + 128) >> 8;
function compP(adcP, tf) {
 let v1 = i32((tf >> 1) - 64000);
 let v2 = i32(Math.imul(i32(Math.imul(v1 >> 2, v1 >> 2) >> 11), CAL.P6));
 v2 = i32(v2 + i32(Math.imul(v1, CAL.P5) << 1));
 v2 = i32((v2 >> 2) + (CAL.P4 << 16));
 v1 = i32((i32(Math.imul(CAL.P3, i32(Math.imul(v1 >> 2, v1 >> 2) >> 13)) >> 3) + i32(Math.imul(CAL.P2, v1) >> 1)) >> 18);
 v1 = i32(Math.imul(i32(32768 + v1), CAL.P1) >> 15);
 if (v1 === 0) return 0;
 let p = Math.imul(((1048576 - adcP) - (v2 >> 12)) >>> 0, 3125) >>> 0;
 p = p < 0x80000000 ? Math.floor(((p << 1) >>> 0) / (v1 >>> 0)) >>> 0 : (Math.floor(p / (v1 >>> 0)) * 2) >>> 0;
 v1 = i32(Math.imul(CAL.P9, i32(Math.imul(p >>> 3, p >>> 3) >>> 13)) >> 12);
 v2 = i32(Math.imul(i32(p >>> 2), CAL.P8) >> 13);
 return (i32(p) + ((v1 + v2 + CAL.P7) >> 4)) >>> 0;
}
function compH(adcH, tf) {
 let v = i32(tf - 76800);
 const a = i32((i32((adcH << 14) - (CAL.H4 << 20) - Math.imul(CAL.H5, v)) + 16384) >> 15);
 const b = i32(Math.imul(i32((i32(Math.imul(i32(Math.imul(v, CAL.H6) >> 10), i32((Math.imul(v, CAL.H3) >> 11) + 32768)) >> 10) + 2097152)), CAL.H2) + 8192) >> 14;
 v = Math.imul(a, b);
 v = i32(v - i32(Math.imul(i32(Math.imul(v >> 15, v >> 15) >> 7), CAL.H1) >> 4));
 v = Math.max(0, Math.min(419430400, v));
 return v >>> 12;
}
function search(f, target, lo, hi, increasing) {
 while (lo < hi) {
 const mid = (lo + hi) >>> 1;
 if (increasing ? f(mid) >= target : f(mid + 1) >= target) { if (increasing) hi = mid; else lo = mid + 1; } else if (increasing) lo = mid + 1; else hi = mid;
 }
 return lo;
}
export function bmeRaw(env) {
 const best = (f, t, x, max) => [x - 1, x, x + 1].filter((v) => v >= 0 && v <= max).reduce((b, v) => (Math.abs(f(v) - t) < Math.abs(f(b) - t) ? v : b));
 const tT = Math.round(env.temp * 100), adcT = best(compT, tT, search(compT, tT, 0, 0xfffff, true), 0xfffff), tf = tFine(adcT);
 const fP = (x) => compP(x, tf), tP = Math.round(env.pressure * 100), adcP = best(fP, tP, search(fP, tP, 0, 0xfffff, false), 0xfffff);
 const fH = (x) => compH(x, tf), tH = Math.round(env.humidity * 1024), adcH = best(fH, tH, search(fH, tH, 0, 0xffff, true), 0xffff);
 return { adcT, adcP, adcH };
}
export const bmeCompensate = (adcT, adcP, adcH) => { const tf = tFine(adcT); return { t: compT(adcT) / 100, p: compP(adcP, tf), h: compH(adcH, tf) / 1024 }; };
class Bmx280 {
 constructor(env, { humidity, address = 0x76 }) { this.env = env; this.hum = humidity; this.address = address; this.reset(); }
 reset() { this.regs = new Uint8Array(256); this.ptr = 0; this.first = true; this.measured = false; this.cache = null; }
 calib() {
 const r = new Uint8Array(256);
 const w16 = (a, v) => { r[a] = v & 0xff; r[a + 1] = (v >>> 8) & 0xff; };
 ['T1', 'T2', 'T3', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'].forEach((k, i) => w16(0x88 + 2 * i, CAL[k]));
 if (this.hum) {
 r[0xa1] = CAL.H1; w16(0xe1, CAL.H2); r[0xe3] = CAL.H3;
 r[0xe4] = (CAL.H4 >> 4) & 0xff; r[0xe5] = (CAL.H4 & 0xf) | ((CAL.H5 & 0xf) << 4); r[0xe6] = (CAL.H5 >> 4) & 0xff; r[0xe7] = CAL.H6 & 0xff;
 }
 return r;
 }
 reg(a) {
 if (a === 0xd0) return this.hum ? 0x60 : 0x58;
 if ((a >= 0x88 && a <= 0xa1) || (a >= 0xe1 && a <= 0xe7)) return (this.cal ??= this.calib())[a];
 if (a >= 0xf7 && a <= 0xfe) {
 if (!this.measured) return a === 0xf7 || a === 0xfa || a === 0xfd ? 0x80 : 0;
 const e = this.env(), key = `${e.temp},${e.pressure},${e.humidity}`;
 if (this.cache?.key !== key) this.cache = { key, ...bmeRaw(e) };
 const { adcT, adcP, adcH } = this.cache;
 const v = [adcP >>> 12, (adcP >>> 4) & 0xff, (adcP & 0xf) << 4, adcT >>> 12, (adcT >>> 4) & 0xff, (adcT & 0xf) << 4, adcH >>> 8, adcH & 0xff];
 return a <= 0xfc || this.hum ? v[a - 0xf7] : 0;
 }
 if (a === 0xf3) return 0;
 return this.regs[a];
 }
 writeReg(a, v) {
 if (a === 0xe0) { if (v === 0xb6) { this.regs.fill(0); this.measured = false; } return; }
 if (a === 0xf4 || a === 0xf5 || (a === 0xf2 && this.hum)) { this.regs[a] = v; if (a === 0xf4 && (v & 3)) this.measured = true; }
 }
 start() { this.first = true; this.pair = 0; return true; }
 write(b) {
 if (this.first) { this.ptr = b; this.first = false; this.pair = 1; return true; }
 if (this.pair === 1) { this.writeReg(this.ptr, b); this.pair = 0; } else { this.ptr = b; this.pair = 1; }
 return true;
 }
 read() { const v = this.reg(this.ptr); this.ptr = (this.ptr + 1) & 0xff; return v; }
 stop() {}
 select(on) { this.sel = on; this.first = true; this.reading = false; this.pair = 0; }
 transfer(b) {
 if (!this.sel) return 0;
 if (this.first) { this.first = false; this.reading = (b & 0x80) !== 0; this.ptr = b | 0x80; this.pair = 1; return 0; }
 if (this.reading) { const v = this.reg(this.ptr); this.ptr = (this.ptr + 1) & 0xff; return v; }
 if (this.pair === 1) { this.writeReg(this.ptr, b); this.pair = 0; } else { this.ptr = b | 0x80; this.pair = 1; }
 return 0;
 }
 save() { return { regs: Array.from(this.regs), ptr: this.ptr, first: this.first, measured: this.measured, pair: this.pair ?? 0, sel: !!this.sel, reading: !!this.reading }; }
 load(s) { this.regs = Uint8Array.from(s.regs); this.ptr = s.ptr; this.first = s.first; this.measured = s.measured; this.pair = s.pair; this.sel = s.sel; this.reading = s.reading; this.cache = null; }
}
class Mpu6050 {
 constructor(env, address = 0x68) { this.env = env; this.address = address; this.reset(); }
 reset() { this.regs = new Uint8Array(128); this.regs[0x6b] = 0x40; this.regs[0x75] = 0x68; this.ptr = 0; this.first = true; }
 reg(a) {
 if (a >= 0x3b && a <= 0x48) {
 if (this.regs[0x6b] & 0x40) return 0;
 const e = this.env(), afs = (this.regs[0x1c] >> 3) & 3, gfs = (this.regs[0x1b] >> 3) & 3;
 const acc = (g) => Math.round(g * (16384 >> afs)), gyr = (d) => Math.round(d * (131 / (1 << gfs)));
 const v = [acc(e.ax), acc(e.ay), acc(e.az), Math.round((e.temp - 36.53) * 340), gyr(e.gx), gyr(e.gy), gyr(e.gz)].map((x) => Math.max(-32768, Math.min(32767, x)));
 const w = v[(a - 0x3b) >> 1] & 0xffff;
 return (a - 0x3b) & 1 ? w & 0xff : w >> 8;
 }
 return this.regs[a & 0x7f];
 }
 start() { this.first = true; return true; }
 write(b) {
 if (this.first) { this.ptr = b & 0x7f; this.first = false; return true; }
 if (this.ptr === 0x6b && (b & 0x80)) this.reset();
 else if (this.ptr !== 0x75 && !(this.ptr >= 0x3b && this.ptr <= 0x48)) this.regs[this.ptr] = b;
 this.ptr = (this.ptr + 1) & 0x7f;
 return true;
 }
 read() { const v = this.reg(this.ptr); this.ptr = (this.ptr + 1) & 0x7f; return v; }
 stop() {}
 save() { return { regs: Array.from(this.regs), ptr: this.ptr, first: this.first }; }
 load(s) { this.regs = Uint8Array.from(s.regs); this.ptr = s.ptr; this.first = s.first; }
}
class Mcp9808 {
 constructor(env, address = 0x18) { this.env = env; this.address = address; this.reset(); }
 reset() { this.r = [0, 0, 0, 0, 0, 0, 0x0054, 0x0400, 0x03]; this.ptr = 0; this.n = 0; this.rd = 0; }
 ta() {
 const t = Math.max(-2048, Math.min(2047.9375, this.env().temp)), raw = Math.round(t * 16) & 0x1fff;
 const signed = (v) => ((v & 0x1000) ? (v & 0x1fff) - 0x2000 : v & 0x1fff);
 const lim = (v) => signed(v & 0x1ffc), tv = signed(raw);
 return raw | (tv >= lim(this.r[4]) ? 0x8000 : 0) | (tv > lim(this.r[2]) ? 0x4000 : 0) | (tv < lim(this.r[3]) ? 0x2000 : 0);
 }
 word(p) { return p === 5 ? this.ta() : p < this.r.length ? this.r[p] : 0; }
 start() { this.n = 0; this.rd = 0; return true; }
 write(b) {
 if (this.n === 0) this.ptr = b & 0xf;
 else if (this.ptr === 8) this.r[8] = b & 3;
 else if (this.ptr >= 1 && this.ptr <= 4) { this.r[this.ptr] = this.n === 1 ? (b << 8) | (this.r[this.ptr] & 0xff) : (this.r[this.ptr] & 0xff00) | b; }
 this.n++;
 return true;
 }
 read() {
 const v = this.ptr === 8 ? this.r[8] : this.rd === 0 ? this.word(this.ptr) >>> 8 : this.word(this.ptr) & 0xff;
 this.rd++;
 return v & 0xff;
 }
 stop() {}
 save() { return { r: this.r.slice(), ptr: this.ptr, n: this.n, rd: this.rd }; }
 load(s) { this.r = s.r.slice(); this.ptr = s.ptr; this.n = s.n; this.rd = s.rd; }
}
export class Lcd1602 {
 constructor(address = 0x27) { this.address = address; this.reset(); }
 reset() {
 this.ddram = new Uint8Array(128).fill(0x20); this.ac = 0; this.inc = true; this.shift = false; this.disp = 0; this.on = false;
 this.cursor = false; this.blink = false; this.eight = true; this.twoLines = false; this.half = -1; this.port = 0xff; this.cg = false;
 }
 start() { return true; }
 write(b) {
 const old = this.port; this.port = b;
 if ((old & 0x4) && !(b & 0x4)) this.strobe(old);
 return true;
 }
 read() { return this.port; }
 stop() {}
 strobe(p) {
 const rs = p & 1, rw = p & 2, nib = p >>> 4;
 if (rw) return;
 if (this.eight) { this.exec(rs, nib << 4); return; }
 if (this.half < 0) { this.half = nib; return; }
 const v = (this.half << 4) | nib; this.half = -1;
 this.exec(rs, v);
 }
 exec(rs, v) {
 if (rs) {
 if (this.cg) return;
 this.ddram[this.ac] = v; this.move(this.inc ? 1 : -1);
 if (this.shift) this.disp += this.inc ? 1 : -1;
 return;
 }
 if (v & 0x80) { this.ac = v & 0x7f; this.cg = false; }
 else if (v & 0x40) this.cg = true;
 else if (v & 0x20) { this.eight = (v & 0x10) !== 0; this.twoLines = (v & 0x08) !== 0; this.half = -1; }
 else if (v & 0x10) { if (v & 0x08) this.disp += v & 0x04 ? 1 : -1; else this.move(v & 0x04 ? 1 : -1); }
 else if (v & 0x08) { this.on = (v & 4) !== 0; this.cursor = (v & 2) !== 0; this.blink = (v & 1) !== 0; }
 else if (v & 0x04) { this.inc = (v & 2) !== 0; this.shift = (v & 1) !== 0; }
 else if (v & 0x02) { this.ac = 0; this.disp = 0; this.cg = false; }
 else if (v & 0x01) { this.ddram.fill(0x20); this.ac = 0; this.disp = 0; this.inc = true; this.cg = false; }
 }
 move(d) {
 if (this.twoLines) {
 const line = this.ac >= 0x40 ? 1 : 0, col = (this.ac & 0x3f) + d;
 if (col > 0x27) this.ac = line ? 0x00 : 0x40; else if (col < 0) this.ac = line ? 0x27 : 0x67; else this.ac = line * 0x40 + col;
 } else this.ac = (this.ac + d + 80) % 80;
 }
 lines() {
 if (!this.on) return ['', ''];
 const row = (base, len) => { let s = ''; for (let i = 0; i < 16; i++) { const c = this.ddram[base + (((i + this.disp) % len) + len) % len]; s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?'; } return s; };
 return this.twoLines ? [row(0x00, 40), row(0x40, 40)] : [row(0x00, 80), ''];
 }
 save() { return { ddram: Array.from(this.ddram), ac: this.ac, inc: this.inc, shift: this.shift, disp: this.disp, on: this.on, cursor: this.cursor, blink: this.blink, eight: this.eight, twoLines: this.twoLines, half: this.half, port: this.port, cg: this.cg }; }
 load(s) { Object.assign(this, s, { ddram: Uint8Array.from(s.ddram) }); }
}
class Eeprom24c02 {
 constructor(address = 0x50) { this.address = address; this.mem = new Uint8Array(256).fill(0xff); this.ptr = 0; this.n = 0; }
 reset() { this.ptr = 0; this.n = 0; }
 start() { this.n = 0; return true; }
 write(b) {
 if (this.n === 0) this.ptr = b;
 else { this.mem[this.ptr] = b; this.ptr = (this.ptr & 0xf8) | ((this.ptr + 1) & 7); }
 this.n++;
 return true;
 }
 read() { const v = this.mem[this.ptr]; this.ptr = (this.ptr + 1) & 0xff; return v; }
 stop() {}
 save() { return { mem: Array.from(this.mem), ptr: this.ptr, n: this.n }; }
 load(s) { this.mem = Uint8Array.from(s.mem); this.ptr = s.ptr; this.n = s.n; }
}
export function createKit(env) {
 const bmp = new Bmx280(env, { humidity: false, address: 0x76 }), bme = new Bmx280(env, { humidity: true });
 const mpu = new Mpu6050(env), mcp = new Mcp9808(env), lcd = new Lcd1602(), rom = new Eeprom24c02();
 return {
 i2c: [{ sda: 4, scl: 5, parts: [bmp, mpu, mcp, lcd, rom] }, { sda: -1, scl: -1, parts: [] }],
 spi: [{ miso: 16, sck: 18, mosi: 19, parts: [{ cs: 17, part: bme }] }, { miso: -1, sck: -1, mosi: -1, parts: [] }],
 lcd,
 names: new Map([[bmp, 'BMP280'], [mpu, 'MPU-6050'], [mcp, 'MCP9808'], [lcd, 'LCD 16x2 (PCF8574)'], [rom, '24C02'], [bme, 'BME280']]),
 all: [bmp, mpu, mcp, lcd, rom, bme],
 reset() { for (const p of this.all) p.reset(); },
 save() { return this.all.map((p) => p.save()); },
 load(s) { this.all.forEach((p, i) => p.load(s[i])); },
 };
}
export function createModule(model, env, address) {
 switch (model) {
 case 'bmp280': return new Bmx280(env, { humidity: false, address: address ?? 0x76 });
 case 'bme280': return new Bmx280(env, { humidity: true });
 case 'mpu6050': return new Mpu6050(env, address ?? 0x68);
 case 'mcp9808': return new Mcp9808(env, address ?? 0x18);
 case 'lcd': return new Lcd1602(address ?? 0x27);
 case 'eeprom': return new Eeprom24c02(address ?? 0x50);
 default: return null;
 }
}
export function moduleKit(mods, env) {
 const modules = mods.map((x) => ({ ...x, part: createModule(x.model, env, x.address) })).filter((x) => x.part);
 return {
 modules,
 lcd: modules.find((x) => x.model === 'lcd')?.part ?? null,
 names: new Map(modules.map((x) => [x.part, `${x.id} (${x.name})`])),
 all: modules.map((x) => x.part),
 reset() { for (const p of this.all) p.reset(); },
 save() { return this.all.map((p) => p.save()); },
 load(s) { this.all.forEach((p, i) => { if (s?.[i]) p.load(s[i]); }); },
 };
}
