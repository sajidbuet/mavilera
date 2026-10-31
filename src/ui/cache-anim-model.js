// cache-anim-model.js -- the stages of one cache access, computed from the access record of the cache
// (cache.last) without touching the DOM (docs/architecture/memory-hierarchy.md §11 phase 7): the address
// is split, the set is read and its tags compared, then a hit, or a miss with its victim, write-back and
// fill, then the word moves. The player (cache-anim.js) shows them one after another; a test checks them.
// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.

/**
 * The ordered stages of an access. Each is {id, ...data}; the data are numbers, never text, so that the
 * wording stays in strings.js. ids: split, lookup, hit, miss, victim, writeback, fill, bypass, word, through.
 * @param {object} rec cache.last: {op, addr, tag, set, way, hit, kind, evicted, evictedDirty, filled, writeThrough, block}
 * @param {{offBits: number, idxBits: number, cfg: {block: number, ways: number}}} cache the cache that made it
 */
export function accessStages(rec, cache) {
  if (!rec) return [];
  const { block, ways } = cache.cfg;
  const offset = rec.addr & (block - 1);
  const stages = [
    { id: 'split', addr: rec.addr, tag: rec.tag, set: rec.set, offset, tagBits: 32 - cache.idxBits - cache.offBits, indexBits: cache.idxBits, offsetBits: cache.offBits },
    { id: 'lookup', set: rec.set, ways, tag: rec.tag },
  ];
  if (rec.hit) stages.push({ id: 'hit', set: rec.set, way: rec.way });
  else {
    stages.push({ id: 'miss', kind: rec.kind, block: rec.block });
    if (rec.filled) {
      if (rec.evicted !== null) {
        stages.push({ id: 'victim', set: rec.set, way: rec.way, block: rec.evicted, dirty: rec.evictedDirty });
        if (rec.evictedDirty) stages.push({ id: 'writeback', block: rec.evicted });
      }
      stages.push({ id: 'fill', block: rec.block, set: rec.set, way: rec.way });
    } else stages.push({ id: 'bypass' });
  }
  if (rec.hit || rec.filled) stages.push({ id: 'word', op: rec.op, offset, word: offset >> 2, set: rec.set, way: rec.way });
  if (rec.writeThrough) stages.push({ id: 'through', addr: rec.addr });
  return stages;
}

/**
 * Where a stage happens, for the drawing of the animation: `at` is the box that is active ('cpu': the address,
 * 'cache', 'mem': main memory) and `flow` the arrow that carries data between the cache and memory
 * ('toMem': a write-back or write-through, 'toCache': a fill, null: none).
 */
export const STAGE_PLACE = Object.freeze({
  split: { at: 'cpu', flow: null }, lookup: { at: 'cache', flow: null }, hit: { at: 'cache', flow: null }, miss: { at: 'cache', flow: null },
  victim: { at: 'cache', flow: null }, writeback: { at: 'mem', flow: 'toMem' }, fill: { at: 'cache', flow: 'toCache' },
  bypass: { at: 'mem', flow: 'toMem' }, word: { at: 'cache', flow: null }, through: { at: 'mem', flow: 'toMem' },
});
