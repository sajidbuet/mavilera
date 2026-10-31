// mem-viewmodel.js -- what the cache viewer shows, computed from a Cache without touching the DOM
// (docs/architecture/memory-hierarchy.md §11 phase 5, WS-F-112): the split of an address into tag,
// index and offset (the "address mapping" of the viewer), one row per line with its state and data,
// and the line an address would use. Reading never changes the cache and counts no access.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

const hex = (v, digits) => (v >>> 0).toString(16).padStart(digits, '0');

/**
 * The fields of `addr` for `cache`: {tag, index, offset} with their widths in bits, the block address
 * and, when the address is held, where ({set, way}); `held` is false otherwise. No access is counted.
 */
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

/**
 * One row per line, in set order then way order: {set, way, valid, dirty, tag, blockAddr, bytes, next}
 * where `next` marks the way the replacement policy would evict from this set (the first way not
 * valid, else the head of the policy order; random is unknown until it is drawn: null).
 */
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

/** The bytes of a row as hexadecimal words, lowest address first (little-endian words, as the memory pane). */
export function rowWords(row, block) {
  if (!row.bytes) return [];
  const words = [];
  for (let i = 0; i + 4 <= block; i += 4) {
    words.push(hex(((row.bytes[i + 3] << 24) | (row.bytes[i + 2] << 16) | (row.bytes[i + 1] << 8) | row.bytes[i]) >>> 0, 8));
  }
  return words;
}

/** Whether the word at `addr` lies in a dirty line of any of `caches` (main memory is out of date there). */
export function isDirty(caches, addr) {
  return caches.some((c) => c && c.find(addr)?.line.dirty);
}

/**
 * The data access an instruction word makes, from the registers `x`: {addr, size, store} for a load
 * or store of the base ISA, else null. Used for the "accessed" mark of the memory panel.
 */
export function dataAccessOf(word, x) {
  const op = word & 0x7f;
  if (op !== 0x03 && op !== 0x23) return null;
  const f3 = (word >>> 12) & 7;
  const size = [1, 2, 4, 4, 1, 2][f3] ?? 4; // lb lh lw - lbu lhu
  const store = op === 0x23;
  const imm = store ? (((word >> 25) << 5) | ((word >>> 7) & 31)) : (word >> 20);
  return { addr: ((x[(word >>> 15) & 31] + imm) >>> 0), size, store };
}

/** Plain-text summary of the geometry: "1 KiB, 16-byte blocks, 2-way, 32 sets; tag 22, index 5, offset 4 bits". */
export function geometry(cache) {
  const { size, block, ways } = cache.cfg;
  const kib = size >= 1024 ? `${size / 1024} KiB` : `${size} B`;
  const assoc = ways === 1 ? 'direct-mapped' : cache.nSets === 1 ? 'fully associative' : `${ways}-way`;
  return {
    text: `${kib}, ${block}-byte blocks, ${assoc}, ${cache.nSets} set${cache.nSets === 1 ? '' : 's'}`,
    tagBits: 32 - cache.idxBits - cache.offBits, indexBits: cache.idxBits, offsetBits: cache.offBits,
  };
}
