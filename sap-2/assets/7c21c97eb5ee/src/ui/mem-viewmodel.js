// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
const hex = (v, digits) => (v >>> 0).toString(16).padStart(digits, '0');
export function addressFields(cache, addr) {
 const a = addr >>> 0;
 const { set, tag } = cache.split(a);
 const offset = a & (cache.cfg.block - 1);
 const f = cache.find(a);
 return {
 addr: a, tag, index: set, offset,
 tagBits: 32 - cache.idxBits - cache.offBits, indexBits: cache.idxBits, offsetBits: cache.offBits,
 blockAddr: (a - offset) >>> 0,
 held: Boolean(f), way: f ? f.way : null,
 };
}
export function lineRows(cache) {
 const rows = [];
 for (let set = 0; set < cache.nSets; set++) {
 const S = cache.sets[set];
 const free = S.lines.findIndex((l) => !l.valid);
 const victim = free >= 0 ? free : cache.cfg.repl === 'random' ? null : S.order[0] ?? 0;
 S.lines.forEach((l, way) => rows.push({
 set, way, valid: l.valid, dirty: l.valid && l.dirty, tag: l.tag,
 blockAddr: l.valid ? cache.blockAddr(l.tag, set) : null,
 bytes: l.valid ? Array.from(l.data) : null,
 next: victim === way,
 }));
 }
 return rows;
}
export function rowWords(row, block) {
 if (!row.bytes) return [];
 const words = [];
 for (let i = 0; i + 4 <= block; i += 4) {
 words.push(hex(((row.bytes[i + 3] << 24) | (row.bytes[i + 2] << 16) | (row.bytes[i + 1] << 8) | row.bytes[i]) >>> 0, 8));
 }
 return words;
}
export function isDirty(caches, addr) {
 return caches.some((c) => c && c.find(addr)?.line.dirty);
}
export function dataAccessOf(word, x) {
 const op = word & 0x7f;
 if (op !== 0x03 && op !== 0x23) return null;
 const f3 = (word >>> 12) & 7;
 const size = [1, 2, 4, 4, 1, 2][f3] ?? 4;
 const store = op === 0x23;
 const imm = store ? (((word >> 25) << 5) | ((word >>> 7) & 31)) : (word >> 20);
 return { addr: ((x[(word >>> 15) & 31] + imm) >>> 0), size, store };
}
export function geometry(cache) {
 const { size, block, ways } = cache.cfg;
 const kib = size >= 1024 ? `${size / 1024} KiB` : `${size} B`;
 const assoc = ways === 1 ? 'direct-mapped' : cache.nSets === 1 ? 'fully associative' : `${ways}-way`;
 return {
 text: `${kib}, ${block}-byte blocks, ${assoc}, ${cache.nSets} set${cache.nSets === 1 ? '' : 's'}`,
 tagBits: 32 - cache.idxBits - cache.offBits, indexBits: cache.idxBits, offsetBits: cache.offBits,
 };
}
