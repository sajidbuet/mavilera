// Copyright (c) 2026 Sajid Muhaimin Choudhury. Licensed under the Apache License, Version 2.0.
// Rights class: code.
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
export const STAGE_PLACE = Object.freeze({
 split: { at: 'cpu', flow: null }, lookup: { at: 'cache', flow: null }, hit: { at: 'cache', flow: null }, miss: { at: 'cache', flow: null },
 victim: { at: 'cache', flow: null }, writeback: { at: 'mem', flow: 'toMem' }, fill: { at: 'cache', flow: 'toCache' },
 bypass: { at: 'mem', flow: 'toMem' }, word: { at: 'cache', flow: null }, through: { at: 'mem', flow: 'toMem' },
});
