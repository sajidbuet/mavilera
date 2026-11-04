// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
export const SPACE = 2 ** 32;
export class BusError extends Error {
 constructor(kind, message, addr = null) {
 super(message);
 this.name = 'BusError';
 this.kind = kind;
 this.addr = addr;
 }
}
const isPow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
const hex8 = (a) => '0x' + (a >>> 0).toString(16).padStart(8, '0');
export class AddressMap {
 constructor({ unmapped = 'fault' } = {}) {
 if (unmapped !== 'zero' && unmapped !== 'fault') throw new Error(`unknown unmapped policy ${unmapped}`);
 this.unmapped = unmapped;
 this.regions = [];
 this.nextId = 1;
 this.version = 0;
 }
 register(r) {
 const { name, base, size, kind, wrap = false, target } = r;
 if (!['ram', 'rom', 'device'].includes(kind)) throw new Error(`region ${name}: unknown kind ${kind}`);
 if (!Number.isInteger(base) || base < 0 || !Number.isInteger(size) || size <= 0 || base + size > SPACE) {
 throw new Error(`region ${name}: base ${base} and size ${size} are not a range of the 32-bit space`);
 }
 if (kind === 'device' && (!isPow2(size) || base % size)) {
 throw new Error(`region ${name}: a device region must be a power of two in size and aligned to it`);
 }
 if (wrap && (kind !== 'ram' || base !== 0 || !isPow2(size))) {
 throw new Error(`region ${name}: a wrapping region is a RAM region of power-of-two size at base 0`);
 }
 const lo = wrap ? 0 : base;
 const hi = wrap ? SPACE : base + size;
 for (const o of this.regions) {
 if (hi <= o.lo || o.hi <= lo) continue;
 const inside = lo >= o.lo && hi <= o.hi;
 const contains = o.lo >= lo && o.hi <= hi;
 const carve = (inside && o.kind === 'ram' && kind === 'device') || (contains && kind === 'ram' && o.kind === 'device')
 || (inside && o.window && kind === 'device' && !r.window);
 if (!carve) throw new Error(`region ${name} overlaps ${o.name}`);
 }
 const region = {
 id: this.nextId++, name, base, size, kind, wrap, target, lo, hi, window: Boolean(r.window),
 cacheable: kind === 'device' ? false : (r.cacheable ?? true),
 };
 this.regions.push(region);
 this.regions.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
 this.version++;
 return region.id;
 }
 unregister(id) {
 const i = this.regions.findIndex((r) => r.id === id);
 if (i < 0) return false;
 this.regions.splice(i, 1);
 this.version++;
 return true;
 }
 resolve(addr) {
 const a = addr >>> 0;
 for (const r of this.regions) {
 if (a >= r.lo && a < r.hi) {
 return { region: r, offset: r.wrap ? a & (r.size - 1) : a - r.base };
 }
 }
 return { unmapped: true };
 }
 fault(addr) {
 return new BusError('unmapped', `bus fault: no memory at ${hex8(addr)}`, addr >>> 0);
 }
}
